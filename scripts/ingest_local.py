import os
import re
import pymupdf  # fitz
import pymupdf4llm
from pathlib import Path

# ── Load .env.local ────────────────────────────────────────────────────────
env_path = Path(__file__).parent.parent / ".env.local"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

import ollama
from supabase import create_client

from dnd_splitters import (
    SplitterFactory,
    Document,
    is_junk_page,
    is_real_markdown_table,
    clean_pdf_text,
    build_boilerplate_blacklist,
    remove_boilerplate,
    html_tables_to_markdown,
)

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
# Use service role key for ingestion — bypasses RLS, guarantees inserts succeed
SUPABASE_KEY = os.environ["SUPABASE_SECRET_KEY"]
BOOKS_DIR = Path(__file__).parent / "books"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "mxbai-embed-large")

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Splitters ──────────────────────────────────────────────────────────────
table_splitter = SplitterFactory.create("table", CHUNK_SIZE, CHUNK_OVERLAP)
prose_splitter = SplitterFactory.create("dnd", CHUNK_SIZE, CHUNK_OVERLAP)


# ── Extraction ─────────────────────────────────────────────────────────────


def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    print(f"    Parsing {pdf_path.name}...")
    md_text = pymupdf4llm.to_markdown(str(pdf_path), page_chunks=True)

    pages = []
    low_text_pages = 0

    for chunk in md_text:
        page_num = chunk.get("metadata", {}).get("page", 0) + 1
        raw_text = chunk.get("text", "").strip()
        # Strip empty markdown headers to get real content length
        real_text = re.sub(r"^#+\s*$", "", raw_text, flags=re.MULTILINE).strip()
        if real_text:
            pages.append((page_num, raw_text))
        else:
            low_text_pages += 1

    # If more than 40% of pages have no extractable text, fall back to OCR
    total = len(md_text)
    if total > 0 and low_text_pages / total > 0.4:
        print(
            f"    ⚠️  {low_text_pages}/{total} pages empty — PDF appears scanned, switching to OCR..."
        )
        return extract_text_ocr(pdf_path)

    return pages


def extract_text_ocr(pdf_path: Path) -> list[tuple[int, str]]:
    """OCR fallback using PyMuPDF's built-in Tesseract integration."""
    doc = pymupdf.open(str(pdf_path))
    pages = []

    for page_num, page in enumerate(doc, start=1):
        try:
            # get_textpage_ocr requires Tesseract installed on the system
            tp = page.get_textpage_ocr(flags=pymupdf.TEXT_PRESERVE_WHITESPACE, dpi=300)
            text = page.get_text(textpage=tp).strip()
            if text and len(text) > 50:
                pages.append((page_num, text))
        except Exception as e:
            print(f"    ⚠️  OCR failed on page {page_num}: {e}")

    doc.close()
    print(f"    → OCR complete: {len(pages)} pages with text")
    return pages


# ── Chunking ───────────────────────────────────────────────────────────────


def chunk_page(page_num: int, text: str, source: str) -> list[Document]:
    if is_junk_page(text):
        return []

    # Strip image markdown and leftover HTML tags
    text = re.sub(r"!\[.*?\]\(.*?\)\n?", "", text)
    text = re.sub(r"==> picture \[.*?\] intentionally omitted <==\n?", "", text)

    # Only run HTML → Markdown conversion if HTML tags are actually present
    if "<table" in text.lower():
        text = html_tables_to_markdown(text)

    # Strip remaining HTML tags (non-table)
    text = re.sub(r"<[^>]+>", "", text)
    text = clean_pdf_text(text)

    if len(text.strip()) < 50:
        return []

    # Route on real Markdown table presence, not any "|" character
    if is_real_markdown_table(text):
        docs = table_splitter.create_documents([text], source=source)
    else:
        docs = prose_splitter.create_documents([text], source=source)

    for doc in docs:
        doc.metadata["page"] = page_num
        if "source" not in doc.metadata:
            doc.metadata["source"] = source

    return docs


# ── Helpers ────────────────────────────────────────────────────────────────


def get_embedding(text: str) -> list[float]:
    result = ollama.embed(model=EMBED_MODEL, input=text)
    return result.embeddings[0]


def find_document(title: str, category: str, adventure_slug: str | None) -> dict | None:
    query = (
        supabase.table("documents")
        .select("id")
        .eq("title", title)
        .eq("category", category)
    )
    if adventure_slug is None:
        query = query.filter("adventure_slug", "is", "null")
    else:
        query = query.eq("adventure_slug", adventure_slug)

    result = query.limit(1).execute()
    if result.data:
        return result.data[0]
    return None


def has_any_chunks(document_id: str) -> bool:
    result = (
        supabase.table("chunks")
        .select("id")
        .eq("document_id", document_id)
        .limit(1)
        .execute()
    )
    return len(result.data) > 0


def cleanup_failed_document(document_id: str):
    supabase.table("chunks").delete().eq("document_id", document_id).execute()
    supabase.table("documents").delete().eq("id", document_id).execute()


# ── Main Processing ────────────────────────────────────────────────────────


def process_file(pdf_path: Path, category: str, adventure_slug: str | None):
    title = pdf_path.name
    existing = find_document(title, category, adventure_slug)
    if existing:
        existing_id = existing["id"]
        if has_any_chunks(existing_id):
            print(
                f"  ⚠️  {title} already ingested for {category}/{adventure_slug or 'N/A'}, skipping."
            )
            return
        print(
            f"  ↻ Found incomplete ingest for {title} ({category} / {adventure_slug or 'N/A'}), resuming."
        )
        doc_id = existing_id
    else:
        doc_id = None

    print(f"  Processing: {title} ({category} / {adventure_slug or 'N/A'})")

    # 1. Extract all pages
    pages = extract_text_from_pdf(pdf_path)
    print(f"    → {len(pages)} pages extracted")

    # 2. Build boilerplate blacklist from repeating lines across pages
    boilerplate = build_boilerplate_blacklist(pages, min_occurrences=4)
    if boilerplate:
        print(f"    → Stripping {len(boilerplate)} boilerplate fragments")
        for sample in list(boilerplate)[:3]:
            print(f"      e.g. {repr(sample[:60])}")

    # 3. Insert document record
    if not doc_id:
        doc_result = (
            supabase.table("documents")
            .insert(
                {
                    "title": title,
                    "type": "rulebook",
                    "category": category,
                    "adventure_slug": adventure_slug,
                }
            )
            .execute()
        )
        doc_id = doc_result.data[0]["id"]

    # 4. Chunk all pages
    all_docs: list[Document] = []
    for page_num, page_text in pages:
        page_text = remove_boilerplate(page_text, boilerplate)
        page_text = clean_pdf_text(page_text)

        if is_junk_page(page_text) or len(page_text.strip()) < 50:
            continue

        all_docs.extend(chunk_page(page_num, page_text, source=title))

    print(f"    → {len(all_docs)} chunks produced")

    # 5. Embed and insert chunks
    inserted = 0
    skipped = 0
    failed = 0
    for i, doc in enumerate(all_docs):
        # Skip chunks that are too short to be useful
        if len(doc.page_content.strip()) < 30:
            skipped += 1
            continue

        try:
            embedding = get_embedding(doc.page_content)
            supabase.table("chunks").insert(
                {
                    "document_id": doc_id,
                    "content": doc.page_content,
                    "embedding": embedding,
                    "page": doc.metadata.get("page"),
                }
            ).execute()
            inserted += 1

            # Progress indicator every 50 chunks
            if inserted % 50 == 0:
                print(f"    → {inserted}/{len(all_docs)} chunks embedded...")

        except Exception as e:
            print(f"\n  ❌ Error on chunk {i + 1}: {e}")
            failed += 1

    if failed > 0:
        print(
            f"  ⚠️  Ingestion failed for {title}: {failed} chunk errors. Cleaning up partial rows so rerun is safe."
        )
        cleanup_failed_document(doc_id)
        return

    print(f"  ✅ Done — {inserted} inserted, {skipped} skipped (too short).")


# ── Entry Point ────────────────────────────────────────────────────────────


def ingest_books():
    core_dir = BOOKS_DIR / "core"
    if core_dir.exists():
        print(f"\nProcessing Core Rulebooks in {core_dir}")
        for pdf_path in sorted(core_dir.glob("*.pdf")):
            process_file(pdf_path, category="core", adventure_slug=None)
    else:
        print(f"⚠️  No core directory found at {core_dir}")

    adventures_dir = BOOKS_DIR / "adventures"
    if adventures_dir.exists():
        print(f"\nProcessing Adventures in {adventures_dir}")
        for adv_folder in sorted(adventures_dir.iterdir()):
            if adv_folder.is_dir():
                slug = adv_folder.name
                print(f"\n--- Adventure: {slug} ---")
                for pdf_path in sorted(adv_folder.glob("*.pdf")):
                    process_file(pdf_path, category="adventure", adventure_slug=slug)
    else:
        print(f"⚠️  No adventures directory found at {adventures_dir}")

    print("\n🎲 Ingestion complete!")


if __name__ == "__main__":
    ingest_books()
