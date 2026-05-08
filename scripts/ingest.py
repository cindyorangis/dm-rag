import os
import time
from pathlib import Path

# Load .env.local manually (before any other imports that read env vars)
env_path = Path(__file__).parent.parent / ".env.local"
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

import cohere
from llama_cloud import LlamaCloud
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
COHERE_API_KEY = os.environ["COHERE_API_KEY"]
BOOKS_DIR = Path(__file__).parent / "books"
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150

# Cohere embed model — must match rag.ts embedText()
EMBED_MODEL = "embed-english-v3.0"
EMBED_DIMENSION = 1024  # embed-english-v3.0 output dimension

# Cohere rate limit: 100 calls/min on trial, 10k/min on production
# Batch up to 96 texts per call (Cohere max is 96)
EMBED_BATCH_SIZE = 96
EMBED_RATE_LIMIT_DELAY = 0.1  # seconds between batches (conservative)

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
co = cohere.Client(api_key=COHERE_API_KEY)

# ── Splitters ──────────────────────────────────────────────────────────────
table_splitter = SplitterFactory.create("table", CHUNK_SIZE, CHUNK_OVERLAP)
prose_splitter = SplitterFactory.create("dnd", CHUNK_SIZE, CHUNK_OVERLAP)


# ── Embedding ──────────────────────────────────────────────────────────────
def get_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts using Cohere embed-english-v3.0.

    Uses input_type='search_document' for ingestion (vs 'search_query' at retrieval time).
    This asymmetry is intentional and improves retrieval quality.
    """
    response = co.embed(
        texts=texts,
        model=EMBED_MODEL,
        input_type="search_document",
        embedding_types=["float"],
    )
    embeddings = response.embeddings
    # SDK returns EmbedByTypeResponseEmbeddings object; access .float attribute
    if hasattr(embeddings, "float"):
        return embeddings.float
    # Fallback: raw list
    return embeddings  # type: ignore


def get_embedding(text: str) -> list[float]:
    """Embed a single text. Use get_embeddings_batch for bulk ingestion."""
    return get_embeddings_batch([text])[0]


# ── Extraction Logic ───────────────────────────────────────────────────────
def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    print(f"    ☁️  Sending {pdf_path.name} to Llama Cloud...")

    client = LlamaCloud(api_key=LLAMA_CLOUD_API_KEY)

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
        import pypdf
        import tempfile

        reader = pypdf.PdfReader(pdf_path)
        print(f"    → Splitting into batches of {pages_per_batch} pages")

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
            page_num = getattr(page, "page_number", None)
            if page_num is None:
                page_num = len(pages) + 1 + page_offset
            else:
                page_num = page_num + page_offset

            text = page.markdown.strip() if page.markdown else ""
            if text:
                pages.append((page_num, text))

    return pages


# ── Chunking ───────────────────────────────────────────────────────────────
def chunk_page(page_num: int, text: str, source: str) -> list[Document]:
    if is_junk_page(text):
        return []

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


# ── Helpers ────────────────────────────────────────────────────────────────
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

    # 1. Extract pages via LlamaParse
    pages = extract_text_from_pdf(pdf_path)

    # 2. Strip repeating boilerplate (headers/footers)
    boilerplate = build_boilerplate_blacklist(pages, min_occurrences=4)
    if boilerplate:
        print(f"    → Stripping {len(boilerplate)} boilerplate fragments")

    # 3. Insert document record
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

    print(f"    → {len(pages)} pages → {len(all_docs)} chunks")

    if not all_docs:
        print("  ⚠️  No chunks produced, skipping insert.")
        return

    # 5. Embed in batches and insert
    inserted = 0
    errors = 0

    for batch_start in range(0, len(all_docs), EMBED_BATCH_SIZE):
        batch = all_docs[batch_start : batch_start + EMBED_BATCH_SIZE]
        texts = [doc.page_content for doc in batch]

        try:
            embeddings = get_embeddings_batch(texts)
        except Exception as e:
            print(f"\n  ❌ Embedding error on batch starting at {batch_start}: {e}")
            errors += len(batch)
            continue

        rows = [
            {
                "document_id": doc_id,
                "content": doc.page_content,
                "embedding": embedding,
                "page": doc.metadata.get("page"),
            }
            for doc, embedding in zip(batch, embeddings)
        ]

        try:
            supabase.table("chunks").insert(rows).execute()
            inserted += len(rows)
        except Exception as e:
            print(f"\n  ❌ Insert error on batch starting at {batch_start}: {e}")
            errors += len(batch)

        # Respect Cohere rate limits
        if batch_start + EMBED_BATCH_SIZE < len(all_docs):
            time.sleep(EMBED_RATE_LIMIT_DELAY)

        progress = min(batch_start + EMBED_BATCH_SIZE, len(all_docs))
        print(f"    → Embedded {progress}/{len(all_docs)} chunks...", end="\r")

    print(
        f"\n  ✅ Done — {inserted}/{len(all_docs)} chunks inserted. ({errors} errors)"
    )


# ── Main Entry Point ───────────────────────────────────────────────────────
def ingest_books():
    core_dir = BOOKS_DIR / "core"
    if core_dir.exists():
        print(f"\nProcessing Core Rulebooks in {core_dir}")
        for pdf_path in sorted(core_dir.glob("*.pdf")):
            process_file(pdf_path, category="core", adventure_slug=None)
    else:
        print(f"No core directory found at {core_dir}")

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
        print(f"No adventures directory found at {adventures_dir}")

    print("\n🎲 Ingestion complete!")


if __name__ == "__main__":
    ingest_books()
