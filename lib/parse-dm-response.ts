export interface ParsedDMResponse {
  narrative: string;
  statusItems: string[];
  hints: HintItem[];
}

export interface HintItem {
  text: string;
  tag: "explore" | "social" | "action" | "lore";
  prompt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HINT_TAG_MAP: Record<string, HintItem["tag"]> = {
  explore: "explore",
  social: "social",
  action: "action",
  lore: "lore",
};

/**
 * Matches the *start* of any known structured tag — including partial tokens
 * like "[STA", "[HIN", "[FLAG" that arrive mid-stream before the tag closes.
 * Uses a lookahead so it matches at the `[` boundary regardless of what
 * follows (including complete tags like `[FLAG_OPS]` with their closing `]`).
 */
const FIRST_STRUCTURED_TAG_RE = /\[(?=(?:STATUS|HINTS|FLAG_OPS|STA|HIN|FLAG))/i;

// ─── Strip Helpers ────────────────────────────────────────────────────────────

/**
 * Removes all structured tag blocks (STATUS, HINTS, FLAG_OPS) and their
 * contents from a string. Safe to call on partial streams — open-ended blocks
 * (no closing tag yet) are also stripped.
 */
function stripStructuredTags(text: string): string {
  return (
    text
      // Complete blocks
      .replace(/\[FLAG_OPS\][\s\S]*?\[\/FLAG_OPS\]/gi, "")
      .replace(/\[HINTS\][\s\S]*?\[\/HINTS\]/gi, "")
      .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/gi, "")
      // Open-ended / partial blocks still accumulating
      .replace(/\[(?:STATUS|HINTS|FLAG_OPS)[^\]]*[\s\S]*$/gi, "")
      // Stray partial tag noise like "[STA" at end of string
      .replace(/\[(?:STA|HIN|FLAG)[^\]]*$/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ─── Structured Block Parsers ─────────────────────────────────────────────────

function extractBlock(
  raw: string,
  openTag: string,
  closeTag: string,
): { inner: string; stripped: string } {
  const pattern = new RegExp(
    `\\[${openTag}\\]([\\s\\S]*?)\\[\\/${closeTag}\\]`,
    "i",
  );
  const match = raw.match(pattern);
  return {
    inner: match ? match[1].trim() : "",
    stripped: raw.replace(pattern, "").trim(),
  };
}

function parseBullets(block: string): string[] {
  if (!block) return [];
  return block
    .split("\n")
    .map((line) => line.replace(/^[*\-•]\s*/, "").trim())
    .filter(Boolean);
}

function parseHints(block: string): HintItem[] {
  if (!block) return [];

  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tagMatch = line.match(/^\[(\w+)\]/);
      const tag = tagMatch
        ? (HINT_TAG_MAP[tagMatch[1].toLowerCase()] ?? "action")
        : "action";
      const withoutTag = line.replace(/^\[\w+\]\s*/, "");
      const parts = withoutTag.split("|");
      const label = parts[0]?.trim() ?? withoutTag;
      const prompt = parts[1]?.trim() ?? label;

      return { text: label, tag, prompt };
    })
    .filter((h) => h.text.length > 0)
    .slice(0, 4);
}

// ─── Structured Parser ────────────────────────────────────────────────────────

function parseStructured(raw: string): ParsedDMResponse | null {
  if (!/\[STATUS\]/i.test(raw) && !/\[HINTS\]/i.test(raw)) return null;

  const { inner: statusBlock, stripped: afterStatus } = extractBlock(
    raw,
    "STATUS",
    "STATUS",
  );
  const { inner: hintsBlock, stripped: narrative } = extractBlock(
    afterStatus,
    "HINTS",
    "HINTS",
  );

  if (process.env.NODE_ENV === "development") {
    console.log("=== PARSED STRUCTURE ===\n", raw);
    console.log("Status block:", statusBlock);
    console.log("Hints block:", hintsBlock);
    console.log("Narrative:", narrative);
  }

  return {
    narrative: stripStructuredTags(narrative),
    statusItems: parseBullets(statusBlock),
    hints: parseHints(hintsBlock),
  };
}

// ─── Freeform Fallback Parser ─────────────────────────────────────────────────

/**
 * Sentences that read like status summaries rather than narrative prose.
 * Note: No `(?:^|\n)` anchor — these can appear anywhere in a paragraph,
 * e.g. "The Redbrands are watching you. You have arrived at the inn."
 * The `The ` branch has no leading space so it captures from the first char.
 */
const STATUS_SENTENCE_RE =
  /((?:You(?:'ve| have| are| were)|The (?:party|group|Redbrands?|goblins?)|Your (?:quest|goal|mission)|Currently)[^.!?]{10,100}[.!?])/g;

function extractFreeformStatus(raw: string): {
  statusItems: string[];
  cleaned: string;
} {
  const items: string[] = [];
  let cleaned = raw;

  // Pass 1: Explicit bullets — strip and collect
  cleaned = cleaned.replace(
    /(?:^|\n)\s*[*\-•]\s*(.+)/g,
    (_match, content: string) => {
      items.push(content.trim());
      return "";
    },
  );

  // Pass 2: Status-flavored sentences (no bullets found)
  // Requires 2+ matches to avoid cannibalizing narrative sentences
  if (items.length === 0) {
    const matches = Array.from(raw.matchAll(STATUS_SENTENCE_RE));
    if (matches.length >= 2) {
      for (const m of matches) {
        items.push(m[1].trim());
        cleaned = cleaned.replace(m[1], "");
      }
    }
  }

  return {
    statusItems: [...new Set(items)].slice(0, 5),
    cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseDMResponse(raw: string): ParsedDMResponse {
  if (process.env.NODE_ENV === "development" && raw.trim()) {
    console.log("=== RAW DM RESPONSE ===\n", raw);
  }

  const structured = parseStructured(raw);
  if (structured) return structured;

  const { statusItems, cleaned } = extractFreeformStatus(raw);
  return { narrative: cleaned, statusItems, hints: [] };
}

/**
 * Safe to call mid-stream. Renders narrative live while structured tag blocks
 * are still accumulating; resolves STATUS and HINTS once their blocks close.
 *
 * Strategy: split at the first structured-tag boundary (including partial
 * tokens like "[STA") so the narrative portion renders cleanly without noise,
 * then let parseDMResponse resolve STATUS/HINTS from whatever has arrived.
 */
export function parseDMResponsePartial(raw: string): ParsedDMResponse {
  const tagStart = raw.search(FIRST_STRUCTURED_TAG_RE);
  if (tagStart !== -1) {
    const narrative = raw.slice(0, tagStart).trim();
    const full = parseDMResponse(raw);
    return { ...full, narrative };
  }
  return parseDMResponse(raw);
}

export function getCleanNarrativeForSpeech(text: string): string {
  return text
    .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/g, "")
    .replace(/\[HINTS\][\s\S]*?\[\/HINTS\]/g, "")
    .replace(/\[ROLL:[^\]]*\]/g, "")
    .replace(/\*/g, "")
    .trim();
}
