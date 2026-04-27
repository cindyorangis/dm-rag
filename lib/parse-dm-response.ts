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

// ─── Structured parser (prompt-controlled responses) ──────────────────────────

const TAG_PATTERNS = {
  status: /\[STATUS\]([\s\S]*?)\[\/STATUS\]/i,
  hints: /\[HINTS\]([\s\S]*?)\[\/HINTS\]/i,
};

function parseBlock(
  raw: string,
  pattern: RegExp,
): { inner: string; stripped: string } {
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

  const TAG_MAP: Record<string, HintItem["tag"]> = {
    explore: "explore",
    social: "social",
    action: "action",
    lore: "lore",
  };

  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tagMatch = line.match(/^\[(\w+)\]/);
      const tag = tagMatch
        ? (TAG_MAP[tagMatch[1].toLowerCase()] ?? "action")
        : "action";
      const withoutTag = line.replace(/^\[\w+\]\s*/, "");
      const [label, prompt] = withoutTag.split("|").map((s) => s.trim());
      return {
        text: label ?? withoutTag,
        tag,
        prompt: prompt ?? label ?? withoutTag,
      };
    })
    .filter((h) => h.text.length > 0)
    .slice(0, 4);
}

function stripTagRemnants(text: string): string {
  return text
    .replace(/\[HINTS\][\s\S]*$/i, "") // HINTS block with no closing tag
    .replace(/\[STATUS\][\s\S]*$/i, "") // STATUS block with no closing tag
    .replace(/\[\/?(?:STATUS|HINTS)\]/gi, "") // any stray open/close tags
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseStructured(raw: string): ParsedDMResponse | null {
  // Only attempt structured parse if we see at least one of our tags
  if (!/\[STATUS\]/i.test(raw) && !/\[HINTS\]/i.test(raw)) return null;

  const { inner: statusBlock, stripped: afterStatus } = parseBlock(
    raw,
    TAG_PATTERNS.status,
  );
  const { inner: hintsBlock, stripped: narrative } = parseBlock(
    afterStatus,
    TAG_PATTERNS.hints,
  );

  console.log("=== PARSED STRUCTURE ===\n", raw);

  return {
    narrative: narrative.trim(),
    statusItems: parseBullets(statusBlock),
    hints: parseHints(hintsBlock),
  };
}

// ─── Freeform fallback parser (legacy / LLM drift) ────────────────────────────

// Patterns the LLM tends to emit when it bleeds state into prose
const FREEFORM_STATUS_PATTERNS = [
  // "Combat State: * item * item"  or  "Quest Status: * item"
  /(?:combat\s+state|quest\s+status|situation|summary)\s*:\s*([\s\S]*?)(?:\n\n|$)/gi,
  // Standalone bullet run of 2+ lines not inside a sentence
  /^(?:[\*\-\•]\s+.+\n?){2,}/gm,
];

// Sentences that look like status summaries rather than narrative:
// - start with "You have", "You've", "The party", "Your quest"
// - are short (< 120 chars)
// - end with a period and aren't in the middle of a paragraph
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
      if (group) {
        parseBullets(group).forEach((b) => items.push(b));
        return "";
      }
      // Standalone bullet run
      parseBullets(match).forEach((b) => items.push(b));
      return "";
    });
  }

  // Pass 2 — status-flavored sentences at paragraph boundaries
  // Only extract if we didn't already find structured items,
  // to avoid cannibalising real narrative
  if (items.length === 0) {
    const sentenceMatches = [...raw.matchAll(STATUS_SENTENCE_RE)];
    // Only pull them out if there are 2+ — a single one is probably just narrative
    if (sentenceMatches.length >= 2) {
      sentenceMatches.forEach((m) => {
        items.push(m[1].trim());
        cleaned = cleaned.replace(m[1], "");
      });
    }
  }

  return {
    statusItems: [...new Set(items)].slice(0, 5), // dedup, cap at 5
    cleaned: cleaned.replace(/\n{3,}/g, "\n\n").trim(),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function parseDMResponse(raw: string): ParsedDMResponse {
  if (process.env.NODE_ENV === "development" && raw.trim()) {
    console.log("=== RAW DM RESPONSE ===\n", raw);
  }
  // Try structured first — clean, reliable
  const structured = parseStructured(raw);
  if (structured)
    return {
      ...structured,
      narrative: stripTagRemnants(structured.narrative),
    };

  // Fall back to heuristic extraction for free-form / legacy messages
  const { statusItems, cleaned } = extractFreeformStatus(raw);
  return {
    narrative: cleaned,
    statusItems,
    hints: [], // can't reliably extract hints from free-form prose
  };
}

// Safe to call mid-stream — narrative renders live, tags resolve once closed
export function parseDMResponsePartial(raw: string): ParsedDMResponse {
  const firstTag = Math.min(
    ...[raw.indexOf("[STATUS]"), raw.indexOf("[HINTS]")].map((i) =>
      i === -1 ? Infinity : i,
    ),
  );

  const narrative = firstTag === Infinity ? raw : raw.slice(0, firstTag).trim();
  const full = parseDMResponse(raw);

  return { ...full, narrative };
}
