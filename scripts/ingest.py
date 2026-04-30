import os
from pathlib import Path
from llama_cloud import LlamaCloud

# Load .env.local manually
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
    clean_pdf_text,
    build_boilerplate_blacklist,
    remove_boilerplate,
    html_tables_to_markdown,
)

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
LLAMA_CLOUD_API_KEY = os.environ["LLAMA_CLOUD_API_KEY"]
BOOKS_DIR = Path(__file__).parent / "books"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150
EMBED_MODEL = "mxbai-embed-large"

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Splitters ──────────────────────────────────────────────────────────────
table_splitter = SplitterFactory.create("table", CHUNK_SIZE, CHUNK_OVERLAP)
prose_splitter = SplitterFactory.create("dnd", CHUNK_SIZE, CHUNK_OVERLAP)


# ── Extraction Logic ───────────────────────────────────────────────────────
def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    print(f"    ☁️ Sending {pdf_path.name} to Llama Cloud...")

    client = LlamaCloud(api_key=LLAMA_CLOUD_API_KEY)

    # Split large PDFs into chunks before uploading
    pages_per_batch = 50
    all_pages: list[tuple[int, str]] = []

    try:
        import pypdf

        reader = pypdf.PdfReader(pdf_path)
        total_pages = len(reader.pages)
        print(f"    → {total_pages} pages total")
    except Exception:
        total_pages = None

    if total_pages and total_pages > pages_per_batch:
        # Process in batches
        import pypdf
        import tempfile

        reader = pypdf.PdfReader(pdf_path)
        batches = range(0, total_pages, pages_per_batch)
        print(
            f"    → Splitting into {len(list(batches))} batches of {pages_per_batch} pages"
        )

        for batch_start in range(0, total_pages, pages_per_batch):
            batch_end = min(batch_start + pages_per_batch, total_pages)
            print(f"    → Batch pages {batch_start + 1}–{batch_end}...")

            writer = pypdf.PdfWriter()
            for i in range(batch_start, batch_end):
                writer.add_page(reader.pages[i])

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp_path = Path(tmp.name)
                writer.write(tmp)

            try:
                batch_pages = _parse_pdf_bytes(
                    client, tmp_path, page_offset=batch_start
                )
                all_pages.extend(batch_pages)
            finally:
                tmp_path.unlink(missing_ok=True)
    else:
        all_pages = _parse_pdf_bytes(client, pdf_path, page_offset=0)

    return all_pages


def _parse_pdf_bytes(client, pdf_path: Path, page_offset: int) -> list[tuple[int, str]]:
    """Upload a single PDF (or batch chunk) to LlamaCloud and return (page_num, text) pairs."""
    with open(pdf_path, "rb") as f:
        file = client.files.create(file=f, purpose="parse")

    result = client.parsing.parse(
        file_id=file.id,
        tier="agentic",
        version="latest",
        expand=["markdown"],
    )

    pages = []
    if result.markdown and result.markdown.pages:
        for page in result.markdown.pages:
            # Use page_number from the object if available, else fall back to index
            page_num = getattr(page, "page_number", None)
            if page_num is None:
                page_num = len(pages) + 1 + page_offset
            else:
                page_num = page_num + page_offset

            text = page.markdown.strip() if page.markdown else ""
            if text:
                pages.append((page_num, text))

    return pages


def separate_tables_from_prose(text: str) -> tuple[str, str]:
    """Returns (prose_text, table_text)"""
    import re

    table_pattern = re.compile(r"(<table.*?</table>)", re.DOTALL | re.IGNORECASE)
    tables = table_pattern.findall(text)
    prose = table_pattern.sub("", text)
    return prose.strip(), "\n".join(tables)


# ── Helpers ────────────────────────────────────────────────────────────────
def chunk_page(page_num: int, text: str, source: str) -> list[Document]:
    if is_junk_page(text):
        return []

    # Strip image markdown lines — they're useless for RAG
    import re

    text = re.sub(r"!\[.*?\]\(.*?\)\n?", "", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_tables_to_markdown(text)
    text = clean_pdf_text(text)

    if len(text.strip()) < 50:
        return []

    has_table = "|" in text
    docs = (
        table_splitter.create_documents([text], source=source)
        if has_table
        else prose_splitter.create_documents([text])
    )

    for doc in docs:
        doc.metadata["page"] = page_num

    return docs


def get_embedding(text: str) -> list[float]:
    result = ollama.embed(model=EMBED_MODEL, input=text)
    return result.embeddings[0]


def document_already_ingested(title: str) -> bool:
    result = supabase.table("documents").select("id").eq("title", title).execute()
    return len(result.data) > 0


# ── Main Processing Logic ──────────────────────────────────────────────────
def process_file(pdf_path: Path, category: str, adventure_slug: str | None):
    title = pdf_path.name
    if document_already_ingested(title):
        print(f"  ⚠️  {title} already ingested, skipping.")
        return

    print(f"  Processing: {title} ({category} / {adventure_slug or 'N/A'})")

    # 1. Extract all pages via LlamaParse
    pages = extract_text_from_pdf(pdf_path)

    # 2. Build a blacklist of repeating headers/footers
    boilerplate = build_boilerplate_blacklist(pages, min_occurrences=4)
    if boilerplate:
        print(f"    → Stripping {len(boilerplate)} boilerplate fragments")
        for sample in list(boilerplate)[:3]:
            print(f"      e.g. {repr(sample[:60])}")

    # 3. Create document record
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

    # 4. Chunk with boilerplate removed
    all_docs: list[Document] = []
    for page_num, page_text in pages:
        page_text = remove_boilerplate(page_text, boilerplate)
        page_text = clean_pdf_text(page_text)

        if is_junk_page(page_text) or len(page_text.strip()) < 50:
            continue

        all_docs.extend(chunk_page(page_num, page_text, source=title))

    print(f"    → {len(pages)} pages → {len(all_docs)} chunks")

    # 5. Embed and insert
    inserted = 0
    for i, doc in enumerate(all_docs):
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
        except Exception as e:
            print(f"\n  ❌ Error on chunk {i + 1}: {e}")

    print(f"  ✅ Done — {inserted}/{len(all_docs)} chunks inserted.")


# ── Main Entry Point ───────────────────────────────────────────────────────
def ingest_books():
    core_dir = BOOKS_DIR / "core"
    if core_dir.exists():
        print(f"Processing Core Rulebooks in {core_dir}")
        for pdf_path in sorted(core_dir.glob("*.pdf")):
            process_file(pdf_path, category="core", adventure_slug=None)
    else:
        print(f"No core directory found at {core_dir}")

    adventures_dir = BOOKS_DIR / "adventures"
    if adventures_dir.exists():
        print(f"Processing Adventures in {adventures_dir}")
        for adv_folder in sorted(adventures_dir.iterdir()):
            if adv_folder.is_dir():
                slug = adv_folder.name
                print(f"--- Adventure: {slug} ---")
                for pdf_path in sorted(adv_folder.glob("*.pdf")):
                    process_file(pdf_path, category="adventure", adventure_slug=slug)
    else:
        print(f"No adventures directory found at {adventures_dir}")

    print("\n🎲 Ingestion complete!")


if __name__ == "__main__":
    ingest_books()
