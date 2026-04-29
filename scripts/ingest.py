import os
from pathlib import Path

# Load .env.local manually (no dotenv dependency needed)
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
import pypdf

from dnd_splitters import SplitterFactory, Document

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
BOOKS_DIR = Path(__file__).parent / "books"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 100
EMBED_MODEL = "mxbai-embed-large"

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Splitters ──────────────────────────────────────────────────────────────
# Use the table splitter for pages that contain Markdown tables (stat blocks,
# spell lists, equipment tables) and the dnd splitter for pure prose.
# Both are constructed once and reused across all documents.
table_splitter = SplitterFactory.create("table", CHUNK_SIZE, CHUNK_OVERLAP)
prose_splitter = SplitterFactory.create("dnd", CHUNK_SIZE, CHUNK_OVERLAP)


# ── Helpers ────────────────────────────────────────────────────────────────
def extract_text_from_pdf(pdf_path: Path) -> list[tuple[int, str]]:
    """Returns list of (page_number, page_text) tuples."""
    pages = []
    reader = pypdf.PdfReader(str(pdf_path))
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            pages.append((i + 1, text))
    return pages


def chunk_page(page_num: int, text: str, source: str) -> list[Document]:
    """
    Route each page through the right splitter:
      - pages that contain Markdown tables → TableSplitter
        (extracts tables as structured docs, then chunks remaining prose)
      - pure prose pages → DndTextSplitter
        (splits on section headers, falls back to recursive char splitting)

    Every returned Document gets a 'page' key in its metadata.
    """
    # A pipe character on a line is a reliable proxy for a Markdown table row
    has_table = "|" in text

    if has_table:
        docs = table_splitter.create_documents([text], source=source)
    else:
        docs = prose_splitter.create_documents([text])

    # Stamp the source page number onto every chunk
    for doc in docs:
        doc.metadata["page"] = page_num

    return docs


def get_embedding(text: str) -> list[float]:
    result = ollama.embed(model=EMBED_MODEL, input=text)
    return result.embeddings[0]


def document_already_ingested(title: str) -> bool:
    result = supabase.table("documents").select("id").eq("title", title).execute()
    return len(result.data) > 0


# ── Main Entry Point ───────────────────────────────────────────────────────
def ingest_books():
    # 1. Process Core Rulebooks
    core_dir = BOOKS_DIR / "core"
    if core_dir.exists():
        print(f"Processing Core Rulebooks in {core_dir}")
        for pdf_path in sorted(core_dir.glob("*.pdf")):
            process_file(pdf_path, category="core", adventure_slug=None)
    else:
        print(f"No core directory found at {core_dir}")

    # 2. Process Adventures
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


# ── Processing Helper ──────────────────────────────────────────────────────
def process_file(pdf_path: Path, category: str, adventure_slug: str | None):
    title = pdf_path.name

    if document_already_ingested(title):
        print(f"  ⚠️  {title} already ingested, skipping.")
        return

    print(f"  Processing: {title} ({category} / {adventure_slug or 'N/A'})")

    # 1. Create document record
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

    # 2. Extract pages and chunk with D&D-aware splitters
    pages = extract_text_from_pdf(pdf_path)
    all_docs: list[Document] = []
    for page_num, page_text in pages:
        all_docs.extend(chunk_page(page_num, page_text, source=title))

    print(f"     → {len(pages)} pages → {len(all_docs)} chunks")

    # 3. Embed and insert each chunk
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
                    # Store chunk_type and table_type if present — useful for debugging
                    # and future filtered retrieval. These columns are optional; remove
                    # the lines below if your schema doesn't have them yet.
                    # "chunk_type":  doc.metadata.get("chunk_type"),
                    # "table_type":  doc.metadata.get("table_type"),
                }
            ).execute()
            inserted += 1
        except Exception as e:
            print(f"\n  ❌ Error on chunk {i + 1}: {e}")
            continue

    print(f"  ✅ Done — {inserted}/{len(all_docs)} chunks inserted.")


if __name__ == "__main__":
    ingest_books()
