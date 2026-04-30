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

// Matches any of our known structured tags — used to find where narrative ends
// during streaming before the blocks are fully closed.
const FIRST_STRUCTURED_TAG_RE = /\[(?:STATUS|HINTS|FLAG_OPS)\]/i;

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
      .replace(/\[HINTS\][\s\S]*?\[\/HINTS\]/i, "")
      .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/i, "")
      // Open-ended blocks (stream not yet closed)
      .replace(/\[FLAG_OPS\][\s\S]*$/i, "")
      .replace(/\[HINTS\][\s\S]*$/i, "")
      .replace(/\[STATUS\][\s\S]*$/i, "")
      // Stray open/close tags with no content
      .replace(/\[\/?(?:STATUS|HINTS|FLAG_OPS)\]/gi, "")
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
    .map((line) => line.replace(/^[\*\-\•]\s*/, "").trim())
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

// Patterns the LLM tends to emit when it bleeds state into prose
const FREEFORM_STATUS_PATTERNS = [
  /(?:combat\s+state|quest\s+status|situation|summary)\s*:\s*([\s\S]*?)(?:\n\n|$)/gi,
  /^(?:[\*\-\•]\s+.+\n?){2,}/gm,
];

// Sentences that look like status summaries rather than narrative
const STATUS_SENTENCE_RE =
  /(?:^|\n)((?:You(?:'ve| have| are| were)| The (?:party|group|Redbrands?|goblins?)|Your (?:quest|goal|mission)|Currently)[^.!?]{10,100}[.!?])/g;

function extractFreeformStatus(raw: string): {
  statusItems: string[];
  cleaned: string;
} {
  const items: string[] = [];
  let cleaned = raw;

  // Pass 1 — labeled blocks like "Combat State: * foo * bar"
  for (const pattern of FREEFORM_STATUS_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match, group) => {
      parseBullets(group ?? match).forEach((b) => items.push(b));
      return "";
    });
  }

  // Pass 2 — status-flavored sentences at paragraph boundaries.
  // Only extract if we didn't already find structured items, to avoid
  // cannibalising real narrative. Also requires 2+ matches.
  if (items.length === 0) {
    const sentenceMatches = [...raw.matchAll(STATUS_SENTENCE_RE)];
    if (sentenceMatches.length >= 2) {
      sentenceMatches.forEach((m) => {
        items.push(m[1].trim());
        cleaned = cleaned.replace(m[1], "");
      });
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
 * Safe to call mid-stream. Renders narrative live while tags are still
 * accumulating; resolves STATUS and HINTS once their blocks are closed.
 *
 * Strategy: split the raw stream at the first structured tag boundary so the
 * narrative portion renders cleanly without tag noise, then let the full
 * parseDMResponse resolve STATUS/HINTS from whatever has arrived so far.
 */
export function parseDMResponsePartial(raw: string): ParsedDMResponse {
  const tagStart = raw.search(FIRST_STRUCTURED_TAG_RE);
  const narrative = tagStart === -1 ? raw : raw.slice(0, tagStart).trim();
  const full = parseDMResponse(raw);
  return { ...full, narrative };
}

export function getCleanNarrativeForSpeech(text: string): string {
  return text
    .replace(/\[STATUS\][\s\S]*?\[\/STATUS\]/g, "")
    .replace(/\[HINTS\][\s\S]*?\[\/HINTS\]/g, "")
    .replace(/\[ROLL:.*?\]/g, "")
    .replace(/\*.*?\*/g, "")
    .trim();
}
