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
CHUNK_SIZE = 1500  # characters
CHUNK_OVERLAP = 150  # characters overlap between chunks
EMBED_MODEL = "nomic-embed-text"  # local via Ollama, 768 dimensions

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


# ── Main ───────────────────────────────────────────────────────────────────
def ingest_books():
    pdf_files = sorted(BOOKS_DIR.glob("*.pdf"))

    if not pdf_files:
        print(f"No PDFs found in {BOOKS_DIR}")
        sys.exit(1)

    print(f"Found {len(pdf_files)} PDF(s) to process\n")

    for pdf_path in pdf_files:
        title = pdf_path.name
        print(f"{'=' * 60}")
        print(f"Processing: {title}")
        print(f"{'=' * 60}")

        # Skip if already ingested
        if document_already_ingested(title):
            print(f"  ⚠️  Already ingested, skipping.\n")
            continue

        # 1. Create document record
        doc_result = (
            supabase.table("documents")
            .insert({"title": title, "type": "rulebook"})
            .execute()
        )
        doc_id = doc_result.data[0]["id"]
        print(f"  ✅ Created document record (id: {doc_id})")

        # 2. Extract text page by page
        pages = extract_text_from_pdf(pdf_path)
        print(f"  📄 Extracted {len(pages)} pages with text")

        # 3. Chunk all pages
        all_chunks = []
        for page_num, page_text in pages:
            all_chunks.extend(chunk_text(page_num, page_text))
        print(f"  🔪 Split into {len(all_chunks)} chunks")

        # 4. Embed and insert each chunk
        inserted = 0
        errors = 0
        for i, chunk in enumerate(all_chunks):
            try:
                print(f"  Embedding chunk {i + 1}/{len(all_chunks)}...", end="\r")

                embedding = get_embedding(chunk["content"])

                supabase.table("chunks").insert(
                    {
                        "document_id": doc_id,
                        "content": chunk["content"],
                        "embedding": embedding,
                        "page": chunk["page"],
                    }
                ).execute()

                inserted += 1

            except Exception as e:
                print(f"\n  ❌ Error on chunk {i + 1}: {e}")
                errors += 1
                time.sleep(2)  # back off on error
                continue

        print(f"\n  ✅ Done — {inserted} chunks inserted, {errors} errors\n")

    print("🎲 Ingestion complete!")


if __name__ == "__main__":
    ingest_books()
