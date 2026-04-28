import os
import sys
import time
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

# ── Config ─────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
BOOKS_DIR = Path(__file__).parent / "books"
CHUNK_SIZE = 500  # characters
CHUNK_OVERLAP = 100  # characters overlap between chunks
EMBED_MODEL = "mxbai-embed-large"  # local via Ollama, 1024 dimensions

# ── Clients ────────────────────────────────────────────────────────────────
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


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


def chunk_text(page_num: int, text: str) -> list[dict]:
    """Split page text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end]
        if chunk.strip():
            chunks.append({"page": page_num, "content": chunk.strip()})
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


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

    # Skip if already ingested (using title as unique key)
    if document_already_ingested(title):
        print(f"  ⚠️  {title} already ingested, skipping.")
        return

    print(f"  Processing: {title} ({category} / {adventure_slug or 'N/A'})")

    # 1. Create document record with new metadata
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

    # 2. Extract and Chunk
    pages = extract_text_from_pdf(pdf_path)
    all_chunks = []
    for page_num, page_text in pages:
        all_chunks.extend(chunk_text(page_num, page_text))

    # 3. Embed and insert
    for i, chunk in enumerate(all_chunks):
        try:
            embedding = get_embedding(chunk["content"])
            supabase.table("chunks").insert(
                {
                    "document_id": doc_id,
                    "content": chunk["content"],
                    "embedding": embedding,
                    "page": chunk["page"],
                }
            ).execute()
        except Exception as e:
            print(f"\n  ❌ Error on chunk {i + 1}: {e}")
            continue

    print(f"  ✅ Done — {len(all_chunks)} chunks inserted.")


if __name__ == "__main__":
    ingest_books()
