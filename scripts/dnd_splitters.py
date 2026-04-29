"""
dnd_splitters.py
D&D-aware text splitting pipeline — Python port of lib/text-splitters/

Three splitters mirror the TypeScript originals:
  - DndTextSplitter   → splits on chapter/section headers first
  - TableSplitter     → extracts Markdown tables into structured chunks
  - SplitterFactory   → picks the right splitter for the content type
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal
from collections import Counter

# ── Types ──────────────────────────────────────────────────────────────────

DndTableType = Literal["monsters", "spells", "items", "unknown"]


@dataclass
class DndTable:
    table_type: DndTableType
    headers: list[str]
    rows: list[dict[str, str]]
    source: str


@dataclass
class Document:
    """Mirrors LangChain's Document — page_content + metadata dict."""

    page_content: str
    metadata: dict = field(default_factory=dict)


# ── Table type inference ───────────────────────────────────────────────────

_TABLE_TYPE_HINTS: dict[str, list[str]] = {
    "monsters": [
        "cr",
        "challenge",
        "hit points",
        "hp",
        "armor class",
        "ac",
        "monster",
        "creature",
    ],
    "spells": [
        "level",
        "casting time",
        "range",
        "components",
        "duration",
        "school",
        "spell",
    ],
    "items": [
        "weight",
        "cost",
        "damage",
        "properties",
        "item",
        "weapon",
        "armor",
        "gear",
    ],
}

# Patterns that identify non-content pages to skip entirely
_SKIP_PAGE_PATTERNS = [
    re.compile(r"^\s*table\s+of\s+contents", re.IGNORECASE),
    re.compile(r"^\s*contents\s*$", re.IGNORECASE),
    # TOC entries: lines ending in ".... 42" or "Chapter 3...... 18"
    re.compile(r"\.{3,}\s*\d+\s*$", re.MULTILINE),
]

# Pages where >40% of lines look like TOC entries are skipped
_TOC_LINE_RE = re.compile(r"\.{2,}\s*\d+\s*$")


def is_junk_page(text: str) -> bool:
    """Returns True for TOC pages, credits pages, and OCR garbage pages."""
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return True

    # Skip if any strong skip pattern matches
    for pattern in _SKIP_PAGE_PATTERNS:
        if pattern.search(text):
            return True

    # Skip if >40% of non-empty lines look like TOC entries
    toc_lines = sum(1 for l in lines if _TOC_LINE_RE.search(l))
    if toc_lines / len(lines) > 0.4:
        return True

    # Skip if average word length is suspiciously low (OCR garbage)
    words = text.split()
    if words:
        avg_word_len = sum(len(w) for w in words) / len(words)
        if avg_word_len < 2.5:
            return True

    return False


def _infer_table_type(headers: list[str], context_hint: str = "") -> DndTableType:
    haystack = " ".join(headers + [context_hint]).lower()
    for table_type, keywords in _TABLE_TYPE_HINTS.items():
        if any(kw in haystack for kw in keywords):
            return table_type  # type: ignore[return-value]
    return "unknown"


def clean_pdf_text(text: str) -> str:
    # Rejoin hyphenated line breaks ("loca-\ntions" → "locations")
    text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", text)

    # Remove page header/footer noise e.g. "CHAPTER1|THEBASICS 5"
    text = re.sub(r"\b[A-Z]+\d*\|[A-Z]+\s+\d+\b", "", text)

    # Remove standalone page numbers (line is just a number)
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)

    # Remove credits-style lines: "Name, Name, Name" with 3+ commas
    lines = text.splitlines()
    cleaned = []
    for line in lines:
        # Drop lines that are pure comma-separated names (credits/attribution)
        if line.count(",") >= 3 and re.match(r"^[\w\s,\.]+$", line.strip()):
            continue
        # Drop very short lines that are clearly TOC fragments
        stripped = line.strip()
        if stripped and len(stripped) < 4:
            continue
        cleaned.append(line)

    text = "\n".join(cleaned)

    # Collapse excess blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)

    return text.strip()


def build_boilerplate_blacklist(
    pages: list[tuple[int, str]],
    min_occurrences: int = 4,
    max_fragment_len: int = 120,
) -> set[str]:
    """
    Finds text fragments that repeat across many pages — these are
    headers, footers, sidebar callouts, and running marginalia that
    should be stripped from every page before chunking.
    """
    # Collect all non-trivial lines across all pages
    line_counts: Counter = Counter()
    for _, text in pages:
        for line in text.splitlines():
            stripped = line.strip()
            # Only consider lines of meaningful but bounded length
            if 8 < len(stripped) <= max_fragment_len:
                line_counts[stripped] += 1

    # Any line appearing on 4+ distinct pages is boilerplate
    return {line for line, count in line_counts.items() if count >= min_occurrences}


def remove_boilerplate(text: str, blacklist: set[str]) -> str:
    """Strip all blacklisted lines from a page's text."""
    lines = text.splitlines()
    cleaned = [l for l in lines if l.strip() not in blacklist]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned)).strip()


# ── DndTextSplitter ────────────────────────────────────────────────────────

# Matches ATX headings (# / ## / ###) and named D&D section labels
_SECTION_HEADER_RE = re.compile(
    r"^#{1,3}\s.+$"  # # Chapter / ## Section / ### Sub
    r"|^(Actions|Reactions|Traits|Lore|Stats)\s*:?$",  # named D&D sections
    re.MULTILINE,
)

# Separator hierarchy for the recursive fallback (most → least preferred break)
_SEPARATORS = ["\n\n", "\n", ". ", ", ", " ", ""]


class DndTextSplitter:
    """
    Splits D&D source text on structural section boundaries first.
    Falls back to recursive character splitting for oversized sections.
    """

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 100) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def split_text(self, text: str) -> list[str]:
        # Pass 1 — split on D&D section headers
        raw_sections = _SECTION_HEADER_RE.split(text)
        sections = [s.strip() for s in raw_sections if s and s.strip()]

        # Pass 2 — recursively split any section still over the size limit
        chunks: list[str] = []
        for section in sections:
            if len(section) > self.chunk_size:
                chunks.extend(self._recursive_split(section))
            else:
                chunks.append(section)

        return chunks

    def create_documents(
        self,
        texts: list[str],
        metadatas: list[dict] | None = None,
    ) -> list[Document]:
        docs: list[Document] = []
        for i, text in enumerate(texts):
            meta = (metadatas[i] if metadatas else {}) or {}
            for chunk in self.split_text(text):
                docs.append(Document(page_content=chunk, metadata=dict(meta)))
        return docs

    # ── private ──────────────────────────────────────────────────────────

    def _recursive_split(self, text: str) -> list[str]:
        """
        Tries each separator in order; if it produces chunks that are still
        too large, recurses with the next separator.
        """
        for sep in _SEPARATORS:
            if sep == "":
                # Hard character-level split as last resort
                return self._hard_split(text)

            parts = text.split(sep)
            good: list[str] = []
            leftovers: list[str] = []

            for part in parts:
                stripped = part.strip()
                if not stripped:
                    continue
                if len(stripped) <= self.chunk_size:
                    good.append(stripped)
                else:
                    leftovers.append(stripped)

            if not leftovers:
                return good

            # Some parts still too large — recurse on leftovers with next sep
            result = list(good)
            for leftover in leftovers:
                result.extend(
                    self._recursive_split_with_sep_index(
                        leftover, _SEPARATORS.index(sep) + 1
                    )
                )
            return result

        return self._hard_split(text)

    def _recursive_split_with_sep_index(self, text: str, sep_index: int) -> list[str]:
        if sep_index >= len(_SEPARATORS):
            return self._hard_split(text)
        sep = _SEPARATORS[sep_index]
        if sep == "":
            return self._hard_split(text)

        parts = [p.strip() for p in text.split(sep) if p.strip()]
        result: list[str] = []
        for part in parts:
            if len(part) <= self.chunk_size:
                result.append(part)
            else:
                result.extend(self._recursive_split_with_sep_index(part, sep_index + 1))
        return result

    def _hard_split(self, text: str) -> list[str]:
        """Character-level split with overlap as absolute last resort."""
        chunks: list[str] = []
        start = 0
        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            chunks.append(text[start:end].strip())
            start += max(self.chunk_size - self.chunk_overlap, 1)
        return [c for c in chunks if c]


# ── TableSplitter ──────────────────────────────────────────────────────────

# Full Markdown table: header row, separator row, one or more data rows
_TABLE_RE = re.compile(
    r"^(\|.+\|[ \t]*)\n"  # header row
    r"(\|[-| :]+\|[ \t]*)\n"  # separator row
    r"((?:\|.+\|[ \t]*\n?)+)",  # data rows
    re.MULTILINE,
)

# Strips leading markdown bold/italic markers from cell values
_CELL_MARKER_RE = re.compile(r"^[*_#\-]+|[*_#\-]+$")


# Normalises a header string to a dict key
def _normalise_key(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def parse_dnd_tables(text: str, table_name: str = "") -> list[DndTable]:
    """
    Extract all Markdown tables from text and return DndTable objects.
    Mirrors parseDndTables() in table-splitters.ts.
    """
    tables: list[DndTable] = []

    for match in _TABLE_RE.finditer(text):
        header_line = match.group(1).strip()
        body_text = match.group(3).strip()

        # Parse headers — drop empty cells from leading/trailing pipes
        headers = [h.strip() for h in header_line.split("|") if h.strip()]
        if not headers:
            continue

        rows: list[dict[str, str]] = []
        for line in body_text.splitlines():
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) != len(headers):
                continue
            if all(re.match(r"^[-:]+$", c) for c in cells):
                continue  # skip separator rows that slipped through

            row: dict[str, str] = {}
            for i, header in enumerate(headers):
                key = _normalise_key(header)
                row[key] = _CELL_MARKER_RE.sub("", cells[i]).strip()

            if row:
                rows.append(row)

        if rows:
            tables.append(
                DndTable(
                    table_type=_infer_table_type(headers, table_name),
                    headers=headers,
                    rows=rows,
                    source=table_name,
                )
            )

    return tables


def create_document_from_table(table: DndTable) -> Document:
    """
    Convert a DndTable into a Document for embedding.
    Mirrors createDocumentFromTable() in table-splitters.ts.
    """

    def _label(key: str) -> str:
        return key.replace("_", " ").title()

    content = "\n\n".join(
        "\n".join(f"{_label(k)}: {v}" for k, v in row.items()) for row in table.rows
    ).strip()

    first_row = table.rows[0] if table.rows else {}
    row_index = first_row.get("name") or first_row.get("spell") or "unknown"

    return Document(
        page_content=content,
        metadata={
            "table_type": table.table_type,
            "table_name": table.source,
            "row_index": row_index,
            "chunk_type": "table",
        },
    )


class TableSplitter:
    """
    Extracts Markdown tables first, then splits remaining prose with overlap.
    Mirrors TableSplitter in splitters.ts.
    """

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 100) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def split_text(self, text: str, source: str = "") -> list[str]:
        return [d.page_content for d in self._split_to_documents(text, source)]

    def create_documents(
        self,
        texts: list[str],
        metadatas: list[dict] | None = None,
        source: str = "",
    ) -> list[Document]:
        docs: list[Document] = []
        for i, text in enumerate(texts):
            extra = (metadatas[i] if metadatas else {}) or {}
            for doc in self._split_to_documents(text, source):
                docs.append(
                    Document(
                        page_content=doc.page_content,
                        metadata={**doc.metadata, **extra},
                    )
                )
        return docs

    # ── private ──────────────────────────────────────────────────────────

    def _split_to_documents(self, text: str, source: str = "") -> list[Document]:
        docs: list[Document] = []

        # 1. Extract tables
        for table in parse_dnd_tables(text, source):
            docs.append(create_document_from_table(table))

        # 2. Strip table rows and headings from remaining prose
        remaining = _TABLE_RE.sub("", text)
        remaining = re.sub(r"^#{1,3}\s.*$", "", remaining, flags=re.MULTILINE)
        remaining = re.sub(r"\n{3,}", "\n\n", remaining).strip()

        # 3. Overlap-aware prose chunking
        if remaining:
            for chunk in self._chunk_with_overlap(remaining):
                docs.append(
                    Document(
                        page_content=chunk,
                        metadata={"chunk_type": "text"},
                    )
                )

        return docs

    def _chunk_with_overlap(self, text: str) -> list[str]:
        # If the whole text fits in one chunk, don't bother splitting
        if len(text) <= self.chunk_size:
            stripped = text.strip()
            return [stripped] if stripped else []

        chunks: list[str] = []
        start = 0

        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            slice_ = text[start:end]

            # Try to break on a natural boundary if not at the end
            if end < len(text):
                threshold = self.chunk_size * 0.5

                para_break = slice_.rfind("\n\n")
                line_break = slice_.rfind("\n")
                sent_break = slice_.rfind(". ")

                if para_break > threshold:
                    slice_ = slice_[: para_break + 2]
                elif line_break > threshold:
                    slice_ = slice_[: line_break + 1]
                elif sent_break > threshold:
                    slice_ = slice_[: sent_break + 2]
                # else: hard cut at chunk_size

            slice_ = slice_.strip()
            if slice_:
                chunks.append(slice_)

            # Advance by at least 1 character beyond the current start,
            # but always make forward progress even when overlap is large
            advance = len(slice_) - self.chunk_overlap
            start += max(advance, min(self.chunk_size // 2, len(slice_), 1))

            # Safety: if we somehow haven't moved, break to avoid infinite loop
            if start >= len(text):
                break

        return chunks


# ── SplitterFactory ────────────────────────────────────────────────────────

SplitterType = Literal["dnd", "standard", "table"]


class SplitterFactory:
    """
    Returns the appropriate splitter for the given content type.
    All three expose split_text() and create_documents().
    """

    @staticmethod
    def create(
        splitter_type: SplitterType,
        chunk_size: int = 1000,
        chunk_overlap: int = 100,
    ) -> DndTextSplitter | TableSplitter:
        if splitter_type == "table":
            return TableSplitter(chunk_size, chunk_overlap)
        # "dnd" and "standard" both use DndTextSplitter
        # (in TS, "standard" uses RecursiveCharacterTextSplitter;
        #  in Python the recursive fallback inside DndTextSplitter is equivalent)
        return DndTextSplitter(chunk_size, chunk_overlap)
