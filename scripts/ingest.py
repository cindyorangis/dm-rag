"""
ingest.py — D&D RAG ingestion pipeline (Qdrant Cloud)

Usage (run from project root):
  python scripts/ingest.py

Required env vars (in .env.local):
  QDRANT_URL        https://your-cluster.qdrant.io
  QDRANT_API_KEY    from Qdrant Cloud console
  QDRANT_COLLECTION default: dnd_chunks
  COHERE_API_KEY    for embed-english-v3.0

pip install qdrant-client cohere pymupdf python-dotenv
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

# ── Load env ───────────────────────────────────────────────────────────────

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env.local")

# ── Imports ────────────────────────────────────────────────────────────────

import re
import fitz  # PyMuPDF
import cohere
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)

# dnd_splitters lives next to this script
sys.path.insert(0, str(Path(__file__).parent))
from dnd_splitters import (
    SplitterFactory,
    clean_pdf_text,
    build_boilerplate_blacklist,
    remove_boilerplate,
    html_tables_to_markdown,
    is_junk_page,
    is_real_markdown_table,
    Document,
)

# ── Config ─────────────────────────────────────────────────────────────────

QDRANT_URL = os.environ["QDRANT_URL"]
QDRANT_API_KEY = os.environ["QDRANT_API_KEY"]
COHERE_API_KEY = os.environ["COHERE_API_KEY"]
COLLECTION_NAME = os.getenv("QDRANT_COLLECTION", "dnd_chunks")
BOOKS_DIR = Path(__file__).parent.parent / "scripts" / "books"

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100
BATCH_SIZE = 100

# Cohere embed-english-v3.0 → 1024 dims
VECTOR_SIZE = 1024

# ── Clients ────────────────────────────────────────────────────────────────

qdrant = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY)
co = cohere.Client(COHERE_API_KEY)


def strip_html(text: str) -> str:
    """Remove any HTML tags that survived html_tables_to_markdown."""
    return re.sub(r"<[^>]+>", " ", text)


# ── Collection setup ───────────────────────────────────────────────────────


def ensure_collection() -> None:
    from qdrant_client.models import PayloadSchemaType

    existing = [c.name for c in qdrant.get_collections().collections]
    if COLLECTION_NAME not in existing:
        qdrant.create_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )
        print(f"✅ Created collection: {COLLECTION_NAME}")
    else:
        print(f"ℹ️  Collection exists: {COLLECTION_NAME}")

    # Payload indexes required for filtered scroll (deduplication check)
    for field, schema in [
        ("source", PayloadSchemaType.KEYWORD),
        ("chunk_index", PayloadSchemaType.INTEGER),
        ("category", PayloadSchemaType.KEYWORD),
        ("adventure_slug", PayloadSchemaType.KEYWORD),
    ]:
        try:
            qdrant.create_payload_index(
                collection_name=COLLECTION_NAME,
                field_name=field,
                field_schema=schema,
            )
        except Exception:
            pass  # index already exists — safe to ignore


# ── Deduplication ──────────────────────────────────────────────────────────


def chunk_already_ingested(source: str, chunk_index: int) -> bool:
    results, _ = qdrant.scroll(
        collection_name=COLLECTION_NAME,
        scroll_filter=Filter(
            must=[
                FieldCondition(key="source", match=MatchValue(value=source)),
                FieldCondition(key="chunk_index", match=MatchValue(value=chunk_index)),
            ]
        ),
        limit=1,
        with_payload=False,
        with_vectors=False,
    )
    return len(results) > 0


# ── Embedding ──────────────────────────────────────────────────────────────


def embed_batch(texts: list[str]) -> list[list[float]]:
    response = co.embed(
        texts=texts,
        model="embed-english-v3.0",
        input_type="search_document",
        embedding_types=["float"],
    )
    embeddings = response.embeddings
    floats = embeddings if isinstance(embeddings, list) else embeddings.float
    return floats


# ── PDF extraction ─────────────────────────────────────────────────────────


def extract_pages(pdf_path: Path) -> list[tuple[int, str]]:
    """Return (page_num, cleaned_text) for every non-junk page."""
    doc = fitz.open(str(pdf_path))
    pages: list[tuple[int, str]] = []

    for page_num, page in enumerate(doc):
        raw = page.get_text("html")  # preserves table structure
        raw = html_tables_to_markdown(raw)
        raw = strip_html(raw)  # remove residual HTML tags
        cleaned = clean_pdf_text(raw)
        if not is_junk_page(cleaned):
            pages.append((page_num, cleaned))

    doc.close()
    return pages


# ── Chunking ───────────────────────────────────────────────────────────────


def chunk_pages(pages: list[tuple[int, str]], source: str) -> list[Document]:
    """
    Route each page through the right splitter:
      - TableSplitter  → pages with real Markdown tables
      - DndTextSplitter → pure prose pages
    """
    # Build boilerplate blacklist from all pages first
    blacklist = build_boilerplate_blacklist(pages)

    table_splitter = SplitterFactory.create("table", CHUNK_SIZE, CHUNK_OVERLAP)
    prose_splitter = SplitterFactory.create("dnd", CHUNK_SIZE, CHUNK_OVERLAP)

    all_docs: list[Document] = []

    for page_num, text in pages:
        clean = remove_boilerplate(text, blacklist)
        if not clean.strip():
            continue

        splitter = table_splitter if is_real_markdown_table(clean) else prose_splitter
        docs = splitter.create_documents([clean], source=source)

        # Tag every doc with its page number
        for doc in docs:
            doc.metadata.setdefault("page", page_num)

        all_docs.extend(docs)

    return all_docs


# ── Upsert ─────────────────────────────────────────────────────────────────


def upsert_chunks(
    docs: list[Document],
    source: str,
    category: str,
    adventure_slug: str,
) -> None:
    pending_docs: list[Document] = []
    pending_idxs: list[int] = []

    def flush(batch_docs: list[Document], batch_idxs: list[int]) -> None:
        if not batch_docs:
            return
        vectors = embed_batch([d.page_content for d in batch_docs])
        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=vectors[i],
                payload={
                    "content": batch_docs[i].page_content,
                    "source": source,
                    "category": category,
                    "adventure_slug": adventure_slug,
                    "chunk_index": batch_idxs[i],
                    **batch_docs[i].metadata,
                },
            )
            for i in range(len(batch_docs))
        ]
        qdrant.upsert(collection_name=COLLECTION_NAME, points=points)
        print(f"    ↑ upserted {len(points)} chunks")

    skipped = 0
    for i, doc in enumerate(docs):
        if chunk_already_ingested(source, i):
            skipped += 1
            continue

        pending_docs.append(doc)
        pending_idxs.append(i)

        if len(pending_docs) >= BATCH_SIZE:
            flush(pending_docs, pending_idxs)
            pending_docs, pending_idxs = [], []

    flush(pending_docs, pending_idxs)

    if skipped:
        print(f"    ⏭  skipped {skipped} already-ingested chunks")


# ── Per-file entry point ────────────────────────────────────────────────────


def ingest_file(pdf_path: Path, category: str, adventure_slug: str) -> None:
    source = pdf_path.name
    print(f"\n📄 {source}  [{category}]")

    pages = extract_pages(pdf_path)
    if not pages:
        print("   ⚠️  No usable pages found, skipping.")
        return

    docs = chunk_pages(pages, source)
    print(f"   → {len(docs)} chunks from {len(pages)} pages")

    upsert_chunks(docs, source, category, adventure_slug)


def ingest_directory(directory: Path, category: str, adventure_slug: str = "") -> None:
    for pdf in sorted(directory.glob("*.pdf")):
        ingest_file(pdf, category, adventure_slug)


# ── Main ───────────────────────────────────────────────────────────────────


def main() -> None:
    ensure_collection()

    # Core rulebooks (PHB, DMG, MM) — shared across all adventures
    core_dir = BOOKS_DIR / "core"
    if core_dir.exists():
        ingest_directory(core_dir, category="core")
    else:
        print(f"⚠️  Core directory not found: {core_dir}")

    # Adventure modules — folder name becomes the adventure slug
    adventures_dir = BOOKS_DIR / "adventures"
    if adventures_dir.exists():
        for adventure_dir in sorted(adventures_dir.iterdir()):
            if adventure_dir.is_dir():
                ingest_directory(
                    adventure_dir,
                    category="adventure",
                    adventure_slug=adventure_dir.name,
                )
    else:
        print(f"⚠️  Adventures directory not found: {adventures_dir}")

    print("\n✅ Ingestion complete.")


if __name__ == "__main__":
    main()
