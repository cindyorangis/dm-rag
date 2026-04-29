import { Document } from "@langchain/core/documents";

export type DndTableType = "monsters" | "spells" | "items" | "unknown";

export interface DndTable {
  tableType: DndTableType;
  headers: string[];
  rows: Record<string, string>[];
  source: string;
}

// Keyword sets used to infer table type from surrounding context or headers
const TABLE_TYPE_HINTS: Record<Exclude<DndTableType, "unknown">, string[]> = {
  monsters: [
    "cr",
    "challenge",
    "hit points",
    "hp",
    "armor class",
    "ac",
    "monster",
    "creature",
  ],
  spells: [
    "level",
    "casting time",
    "range",
    "components",
    "duration",
    "school",
    "spell",
  ],
  items: [
    "weight",
    "cost",
    "damage",
    "properties",
    "item",
    "weapon",
    "armor",
    "gear",
  ],
};

/**
 * Infer table type from headers or surrounding text context.
 * Falls back to 'unknown' if no strong signal is found.
 */
function inferTableType(
  headers: string[],
  contextHint: string = "",
): DndTableType {
  const haystack = [...headers, contextHint].join(" ").toLowerCase();

  for (const [type, keywords] of Object.entries(TABLE_TYPE_HINTS)) {
    if (keywords.some((kw) => haystack.includes(kw))) {
      return type as Exclude<DndTableType, "unknown">;
    }
  }

  return "unknown";
}

/**
 * Parse Markdown tables out of a D&D source text.
 *
 * Handles the full Markdown table format:
 *   | Header 1 | Header 2 |
 *   |----------|----------|   ← separator row, intentionally skipped
 *   | Cell 1   | Cell 2   |
 */
export function parseDndTables(
  text: string,
  tableName: string = "",
): DndTable[] {
  // Match one or more consecutive pipe-delimited lines (a full table block)
  const tableRegex =
    /^(\|.+\|[ \t]*\n)(\|[-| :]+\|[ \t]*\n)((?:\|.+\|[ \t]*\n?)+)/gm;

  const tables: DndTable[] = [];

  for (const match of text.matchAll(tableRegex)) {
    const headerLine = match[1].trim();
    const bodyLines = match[3].trim();

    // Parse headers — drop empty cells produced by leading/trailing pipes
    const headers = headerLine
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);

    if (headers.length === 0) continue;

    // Parse data rows
    const rows: Record<string, string>[] = [];

    for (const line of bodyLines.split("\n")) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);

      // Skip rows with wrong column count or pure-separator rows
      if (cells.length !== headers.length) continue;
      if (cells.every((c) => /^[-:]+$/.test(c))) continue;

      const row: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        // Normalise key: lowercase, strip punctuation/spaces
        const key = headers[i]
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        // Strip leading markdown bold/italic markers from cell values
        row[key] = cells[i].replace(/^[*_#-]+|[*_#-]+$/g, "").trim();
      }

      if (Object.keys(row).length > 0) {
        rows.push(row);
      }
    }

    if (rows.length === 0) continue;

    tables.push({
      tableType: inferTableType(headers, tableName),
      headers,
      rows,
      source: tableName,
    });
  }

  return tables;
}

/**
 * Convert a parsed DndTable into a LangChain Document.
 * Each row becomes a labelled key-value block for clean embedding.
 */
export function createDocumentFromTable(table: DndTable): Document {
  const content = table.rows
    .map((row) =>
      Object.entries(row)
        .map(([key, value]) => {
          // "hit_points" → "Hit Points"
          const label = key
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          return `${label}: ${value}`;
        })
        .join("\n"),
    )
    .join("\n\n")
    .trim();

  return new Document({
    pageContent: content,
    metadata: {
      tableType: table.tableType,
      tableName: table.source,
      // First row's "name" or "spell" cell makes a useful display key
      rowIndex: table.rows[0]?.name ?? table.rows[0]?.spell ?? "unknown",
    },
  });
}

export default { parseDndTables, createDocumentFromTable };
