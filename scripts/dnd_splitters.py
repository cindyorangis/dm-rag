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
    re.compile(r"\.{3,}\s*\d+\s*$", re.MULTILINE),
]

_TOC_LINE_RE = re.compile(r"\.{2,}\s*\d+\s*$")

# Real Markdown table: header row + separator row (used for routing in ingest)
_REAL_TABLE_RE = re.compile(
    r"^\|.+\|\s*\n\|[-| :]+\|",
    re.MULTILINE,
)

# Full Markdown table: header + separator + data rows (used for extraction)
_TABLE_RE = re.compile(
    r"^(\|.+\|[ \t]*)\n"
    r"(\|[-| :]+\|[ \t]*)\n"
    r"((?:\|.+\|[ \t]*\n?)+)",
    re.MULTILINE,
)

# Splits on ATX headings AND named D&D section labels
_SECTION_SPLIT_RE = re.compile(
    r"(?=^#{1,3}\s|^(?:Actions|Reactions|Traits|Lore|Stats|Legendary Actions|Lair Actions)\s*:?\s*$)",
    re.MULTILINE,
)

# Separator hierarchy for recursive fallback
_SEPARATORS = ["\n\n", "\n", ". ", ", ", " ", ""]

_CELL_MARKER_RE = re.compile(r"^[*_#\-]+|[*_#\-]+$")


def is_real_markdown_table(text: str) -> bool:
    """Returns True only if the text contains a proper Markdown table."""
    return bool(_REAL_TABLE_RE.search(text))


def is_junk_page(text: str) -> bool:
    """Returns True for TOC pages, credits pages, and OCR garbage pages."""
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return True

    for pattern in _SKIP_PAGE_PATTERNS:
        if pattern.search(text):
            return True

    toc_lines = sum(1 for l in lines if _TOC_LINE_RE.search(l))
    if toc_lines / len(lines) > 0.4:
        return True

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
    # Rejoin hyphenated line breaks
    text = re.sub(r"(\w+)-\n(\w+)", r"\1\2", text)
    # Remove page header/footer noise
    text = re.sub(r"\b[A-Z]+\d*\|[A-Z]+\s+\d+\b", "", text)
    # Remove standalone page numbers
    text = re.sub(r"^\s*\d+\s*$", "", text, flags=re.MULTILINE)

    lines = text.splitlines()
    cleaned = []
    for line in lines:
        if line.count(",") >= 3 and re.match(r"^[\w\s,\.]+$", line.strip()):
            continue
        stripped = line.strip()
        if stripped and len(stripped) < 4:
            continue
        cleaned.append(line)

    text = "\n".join(cleaned)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def build_boilerplate_blacklist(
    pages: list[tuple[int, str]],
    min_occurrences: int = 4,
    max_fragment_len: int = 120,
) -> set[str]:
    """
    Finds text fragments that repeat across many pages — headers, footers,
    sidebar callouts, and running marginalia to strip before chunking.
    """
    line_counts: Counter = Counter()
    for _, text in pages:
        for line in text.splitlines():
            stripped = line.strip()
            if 8 < len(stripped) <= max_fragment_len:
                line_counts[stripped] += 1

    return {line for line, count in line_counts.items() if count >= min_occurrences}


def remove_boilerplate(text: str, blacklist: set[str]) -> str:
    """Strip all blacklisted lines from a page's text."""
    lines = text.splitlines()
    cleaned = [l for l in lines if l.strip() not in blacklist]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned)).strip()


def html_tables_to_markdown(text: str) -> str:
    """Convert HTML tables to Markdown so TableSplitter can handle them."""

    def convert_table(m):
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", m.group(0), re.DOTALL | re.IGNORECASE)
        md_rows = []
        for i, row in enumerate(rows):
            cells = re.findall(
                r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.DOTALL | re.IGNORECASE
            )
            cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
            md_rows.append("| " + " | ".join(cells) + " |")
            if i == 0:
                md_rows.append("| " + " | ".join(["---"] * len(cells)) + " |")
        return "\n".join(md_rows)

    return re.compile(r"<table[^>]*>.*?</table>", re.DOTALL | re.IGNORECASE).sub(
        convert_table, text
    )


# ── DndTextSplitter ────────────────────────────────────────────────────────


class DndTextSplitter:
    """
    Splits D&D source text on structural section boundaries first.
    Falls back to recursive character splitting for oversized sections.

    Fixes vs. original:
    - split_text uses _SECTION_SPLIT_RE (covers Actions/Traits/etc., not just #)
    - create_documents accepts and propagates `source`
    - _recursive_split applies chunk_overlap between chunks
    """

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 100) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def split_text(self, text: str) -> list[str]:
        # Pass 1 — split on D&D section headers AND named section labels
        raw_sections = re.split(_SECTION_SPLIT_RE, text)
        sections = [s.strip() for s in raw_sections if s and s.strip()]

        # Pass 2 — recursively split any section still over the size limit
        chunks: list[str] = []
        for section in sections:
            if len(section) > self.chunk_size:
                chunks.extend(self._recursive_split(section))
            else:
                chunks.append(section)

        # Pass 3 — apply overlap by appending the start of the next chunk
        # to the end of the current one
        return self._apply_overlap(chunks)

    def create_documents(
        self,
        texts: list[str],
        metadatas: list[dict] | None = None,
        source: str = "",
    ) -> list[Document]:
        docs: list[Document] = []
        for i, text in enumerate(texts):
            meta = dict((metadatas[i] if metadatas else {}) or {})
            if source:
                meta.setdefault("source", source)
            for chunk in self.split_text(text):
                docs.append(Document(page_content=chunk, metadata=dict(meta)))
        return docs

    # ── private ──────────────────────────────────────────────────────────

    def _apply_overlap(self, chunks: list[str]) -> list[str]:
        """
        Appends the first `chunk_overlap` characters of chunk[i+1] to
        chunk[i] so that boundary concepts appear in both chunks.
        """
        if self.chunk_overlap <= 0 or len(chunks) <= 1:
            return chunks

        overlapped: list[str] = []
        for i, chunk in enumerate(chunks):
            if i < len(chunks) - 1:
                tail = chunks[i + 1][: self.chunk_overlap].strip()
                overlapped.append(chunk + ("\n\n" + tail if tail else ""))
            else:
                overlapped.append(chunk)
        return overlapped

    def _recursive_split(self, text: str) -> list[str]:
        for sep in _SEPARATORS:
            if sep == "":
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
        chunks = []
        start = 0
        while start < len(text):
            end = start + self.chunk_size
            if end >= len(text):
                chunks.append(text[start:].strip())
                break

            last_space = text.rfind(" ", start, end)
            if last_space != -1 and last_space > start:
                end = last_space

            chunks.append(text[start:end].strip())
            start = end - self.chunk_overlap
        return [c for c in chunks if c]


# ── TableSplitter ──────────────────────────────────────────────────────────


def _normalise_key(header: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", header.lower()).strip("_")


def parse_dnd_tables(text: str, table_name: str = "") -> list[DndTable]:
    """
    Extract all Markdown tables from text and return DndTable objects.
    """
    tables: list[DndTable] = []

    for match in _TABLE_RE.finditer(text):
        header_line = match.group(1).strip()
        body_text = match.group(3).strip()

        headers = [h.strip() for h in header_line.split("|") if h.strip()]
        if not headers:
            continue

        rows: list[dict[str, str]] = []
        for line in body_text.splitlines():
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if len(cells) != len(headers):
                continue
            if all(re.match(r"^[-:]+$", c) for c in cells):
                continue

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
    """Convert a DndTable into a single Document for embedding."""
    context_header = f"Table: {table.source or table.table_type.title()}\n"
    rows_content = []
    for row in table.rows:
        row_str = "\n".join(
            f"{k.replace('_', ' ').title()}: {v}" for k, v in row.items()
        )
        rows_content.append(row_str)

    content = context_header + "\n\n".join(rows_content)
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

    Fix vs. original: section headers are NO LONGER stripped from the prose
    remainder — they provide essential context for the chunks that follow.
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
            extra = dict((metadatas[i] if metadatas else {}) or {})
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

        # 1. Extract and document tables
        for table in parse_dnd_tables(text, source):
            docs.append(create_document_from_table(table))

        # 2. Strip only the table rows from remaining prose.
        #    Section headers (## Goblins etc.) are intentionally kept —
        #    they anchor the prose chunks that follow them.
        remaining = _TABLE_RE.sub("", text)
        remaining = re.sub(r"\n{3,}", "\n\n", remaining).strip()

        # 3. Overlap-aware prose chunking
        if remaining:
            for chunk in self._chunk_with_overlap(remaining):
                docs.append(
                    Document(
                        page_content=chunk,
                        metadata={
                            "chunk_type": "text",
                            **({"source": source} if source else {}),
                        },
                    )
                )

        return docs

    def _chunk_with_overlap(self, text: str) -> list[str]:
        if len(text) <= self.chunk_size:
            stripped = text.strip()
            return [stripped] if stripped else []

        chunks: list[str] = []
        start = 0

        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            slice_ = text[start:end]

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

            slice_ = slice_.strip()
            if slice_:
                chunks.append(slice_)

            advance = len(slice_) - self.chunk_overlap
            start += max(advance, min(self.chunk_size // 2, len(slice_), 1))

            if start >= len(text):
                break

        return chunks


# ── SplitterFactory ────────────────────────────────────────────────────────

SplitterType = Literal["dnd", "standard", "table"]


class SplitterFactory:
    """
    Returns the appropriate splitter for the given content type.
    All three expose split_text() and create_documents().

    "dnd"      → DndTextSplitter  (pure prose, structure-boundary splitting)
    "table"    → TableSplitter    (mixed pages with Markdown tables)
    "standard" → DndTextSplitter  (generic fallback; recursive splitting)
    """

    @staticmethod
    def create(
        splitter_type: SplitterType,
        chunk_size: int = 1000,
        chunk_overlap: int = 100,
    ) -> DndTextSplitter | TableSplitter:
        if splitter_type == "table":
            return TableSplitter(chunk_size, chunk_overlap)
        return DndTextSplitter(chunk_size, chunk_overlap)
