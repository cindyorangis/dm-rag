export type NarrativeFlagValue = boolean | number | string;
export type NarrativeFlags = Record<string, NarrativeFlagValue>;

export interface NarrativeFlagOps {
  set?: Record<string, NarrativeFlagValue>;
  unset?: string[];
  inc?: Record<string, number>;
}

const FLAG_KEY_RE = /^[a-z0-9_]{2,64}$/;
const FLAG_BLOCK_RE = /\[FLAG_OPS\]([\s\S]*?)\[\/FLAG_OPS\]/gi;

function isNarrativeFlagValue(value: unknown): value is NarrativeFlagValue {
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }
  return false;
}

function isValidFlagKey(key: string): boolean {
  return FLAG_KEY_RE.test(key);
}

export function sanitizeNarrativeFlags(input: unknown): NarrativeFlags {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const out: NarrativeFlags = {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (!isValidFlagKey(rawKey)) continue;
    if (!isNarrativeFlagValue(value)) continue;
    out[rawKey] = value;
  }
  return out;
}

export function parseNarrativeFlagOpsFromText(
  raw: string,
): NarrativeFlagOps | null {
  const matches = Array.from(raw.matchAll(FLAG_BLOCK_RE));
  if (matches.length === 0) return null;

  const latest = matches[matches.length - 1][1]?.trim();
  if (!latest) return null;

  try {
    const parsed = JSON.parse(latest) as NarrativeFlagOps;
    return sanitizeNarrativeFlagOps(parsed);
  } catch {
    return null;
  }
}

export function sanitizeNarrativeFlagOps(
  input: unknown,
): NarrativeFlagOps | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const raw = input as {
    set?: unknown;
    unset?: unknown;
    inc?: unknown;
  };

  const out: NarrativeFlagOps = {};

  if (raw.set && typeof raw.set === "object" && !Array.isArray(raw.set)) {
    const set: Record<string, NarrativeFlagValue> = {};
    for (const [key, value] of Object.entries(raw.set)) {
      if (!isValidFlagKey(key)) continue;
      if (!isNarrativeFlagValue(value)) continue;
      set[key] = value;
    }
    if (Object.keys(set).length > 0) out.set = set;
  }

  if (Array.isArray(raw.unset)) {
    const unset = raw.unset
      .filter((k): k is string => typeof k === "string")
      .filter((k) => isValidFlagKey(k));
    if (unset.length > 0) out.unset = unset;
  }

  if (raw.inc && typeof raw.inc === "object" && !Array.isArray(raw.inc)) {
    const inc: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw.inc)) {
      if (!isValidFlagKey(key)) continue;
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      inc[key] = value;
    }
    if (Object.keys(inc).length > 0) out.inc = inc;
  }

  if (!out.set && !out.unset && !out.inc) return null;
  return out;
}

export function applyNarrativeFlagOps(
  current: NarrativeFlags,
  ops: NarrativeFlagOps,
): NarrativeFlags {
  const next: NarrativeFlags = { ...current };

  if (ops.set) {
    for (const [key, value] of Object.entries(ops.set)) {
      next[key] = value;
    }
  }

  if (ops.inc) {
    for (const [key, delta] of Object.entries(ops.inc)) {
      const base = typeof next[key] === "number" ? (next[key] as number) : 0;
      next[key] = base + delta;
    }
  }

  if (ops.unset) {
    for (const key of ops.unset) {
      delete next[key];
    }
  }

  return next;
}

export function stripNarrativeFlagOpsBlocks(raw: string): string {
  return raw.replace(FLAG_BLOCK_RE, "").trim();
}
