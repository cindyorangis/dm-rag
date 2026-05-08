import pymupdf4llm
from pathlib import Path

pdf = Path("scripts/books/adventures/lost-mine-of-phandelver/LostMineofPhandelver.pdf")
pages = pymupdf4llm.to_markdown(str(pdf), page_chunks=True)

for p in pages[:3]:
    page_num = p.get("metadata", {}).get("page", "?")
    text = p.get("text", "")
    print(f"\n--- Page {page_num} ({len(text)} chars) ---")
    print(text[:500])
