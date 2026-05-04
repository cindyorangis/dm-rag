import type { CombatState } from "@/lib/combat/types";
import type { LlmMessage, LlmProvider } from "@/lib/llmClient";

const DEFAULT_RAG_MAX_CHUNKS = 4;
const DEFAULT_RAG_MIN_SIMILARITY = 0.2;

export interface RetrievalObservabilityInput {
  chunksRequested?: number;
  minSimilarityThreshold?: number;
  similarities: number[];
}

export interface TurnObservabilityInput {
  sessionId: string;
  adventureSlug: string;
  provider: LlmProvider;
  systemPrompt: string;
  messages: LlmMessage[];
  dmResponse: string;
  latencyMs: number;
  firstTokenLatencyMs: number | null;
  retrieval: RetrievalObservabilityInput;
  combatState: CombatState | null;
  awaitingPlayerInitiative: boolean;
}

export interface TurnObservabilityMetric {
  session_id: string;
  adventure_slug: string;
  provider: LlmProvider;
  prompt_tokens_estimated: number;
  completion_tokens_estimated: number;
  total_tokens_estimated: number;
  llm_latency_ms: number;
  first_token_latency_ms: number | null;
  rag_chunks_requested: number;
  rag_chunks_returned: number;
  rag_hit_rate: number;
  rag_avg_similarity: number | null;
  rag_high_confidence_rate: number | null;
  status_items_count: number;
  hint_count: number;
  hint_diversity_count: number;
  hint_quality_score: number;
  combat_rule_error_count: number;
  combat_rule_errors: string[];
}

export function buildTurnObservabilityMetric(
  input: TurnObservabilityInput,
): TurnObservabilityMetric {
  const promptTokenEstimate = estimateTokens(
    [input.systemPrompt, ...input.messages.map((m) => m.content)].join("\n"),
  );
  const completionTokenEstimate = estimateTokens(input.dmResponse);
  const retrieval = summarizeRetrieval(input.retrieval);
  const outputShape = parseOutputShape(input.dmResponse);
  const combatRuleErrors = detectCombatRuleErrors({
    dmResponse: input.dmResponse,
    combatState: input.combatState,
    awaitingPlayerInitiative: input.awaitingPlayerInitiative,
  });

  return {
    session_id: input.sessionId,
    adventure_slug: input.adventureSlug,
    provider: input.provider,
    prompt_tokens_estimated: promptTokenEstimate,
    completion_tokens_estimated: completionTokenEstimate,
    total_tokens_estimated: promptTokenEstimate + completionTokenEstimate,
    llm_latency_ms: clampInt(input.latencyMs),
    first_token_latency_ms:
      input.firstTokenLatencyMs === null
        ? null
        : clampInt(input.firstTokenLatencyMs),
    rag_chunks_requested: retrieval.chunksRequested,
    rag_chunks_returned: retrieval.chunksReturned,
    rag_hit_rate: retrieval.hitRate,
    rag_avg_similarity: retrieval.avgSimilarity,
    rag_high_confidence_rate: retrieval.highConfidenceRate,
    status_items_count: outputShape.statusItemsCount,
    hint_count: outputShape.hints.length,
    hint_diversity_count: outputShape.hintDiversityCount,
    hint_quality_score: outputShape.hintQualityScore,
    combat_rule_error_count: combatRuleErrors.length,
    combat_rule_errors: combatRuleErrors,
  };
}

function estimateTokens(text: string): number {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return 0;
  // Lightweight heuristic that tracks reasonably well for English prose.
  return Math.ceil(normalized.length / 4);
}

function summarizeRetrieval(input: RetrievalObservabilityInput): {
  chunksRequested: number;
  chunksReturned: number;
  hitRate: number;
  avgSimilarity: number | null;
  highConfidenceRate: number | null;
} {
  const chunksRequested = Math.max(
    1,
    input.chunksRequested ??
      readPositiveIntEnv("RAG_MAX_CHUNKS", DEFAULT_RAG_MAX_CHUNKS),
  );
  const similarities = input.similarities.filter((n) => Number.isFinite(n));
  const chunksReturned = similarities.length;
  const threshold =
    input.minSimilarityThreshold ??
    readBoundedFloatEnv("RAG_MIN_SIMILARITY", DEFAULT_RAG_MIN_SIMILARITY);

  if (chunksReturned === 0) {
    return {
      chunksRequested,
      chunksReturned: 0,
      hitRate: 0,
      avgSimilarity: null,
      highConfidenceRate: null,
    };
  }

  const avgSimilarity =
    similarities.reduce((sum, value) => sum + value, 0) / chunksReturned;
  const highConfidenceCount = similarities.filter((s) => s >= threshold).length;

  return {
    chunksRequested,
    chunksReturned,
    hitRate: round(chunksReturned / chunksRequested),
    avgSimilarity: round(avgSimilarity),
    highConfidenceRate: round(highConfidenceCount / chunksReturned),
  };
}

function parseOutputShape(dmResponse: string): {
  statusItemsCount: number;
  hints: string[];
  hintDiversityCount: number;
  hintQualityScore: number;
} {
  const statusBlock = extractTaggedBlock(dmResponse, "STATUS");
  const hintsBlock = extractTaggedBlock(dmResponse, "HINTS");

  const statusItems = statusBlock
    ? statusBlock
        .split("\n")
        .map((line) => line.replace(/^[*\-\u2022]\s*/, "").trim())
        .filter(Boolean)
    : [];

  const hints = hintsBlock
    ? hintsBlock
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  const hintTags = hints
    .map((line) => {
      const match = line.match(/^\[(explore|social|action|lore)\]/i);
      return match?.[1]?.toLowerCase() ?? null;
    })
    .filter((tag): tag is string => Boolean(tag));

  const hintDiversityCount = new Set(hintTags).size;
  const hintsWithActionPrompt = hints.filter((line) => {
    const pipeIndex = line.indexOf("|");
    return pipeIndex > -1 && line.slice(pipeIndex + 1).trim().length >= 20;
  }).length;

  const hintCountScore = Math.min(hints.length / 4, 1);
  const hintDiversityScore = Math.min(hintDiversityCount / 4, 1);
  const hintPromptScore =
    hints.length > 0 ? hintsWithActionPrompt / hints.length : 0;
  const statusScore = Math.min(statusItems.length / 3, 1);

  const hintQualityScore = round(
    hintCountScore * 0.4 +
      hintDiversityScore * 0.25 +
      hintPromptScore * 0.25 +
      statusScore * 0.1,
  );

  return {
    statusItemsCount: statusItems.length,
    hints,
    hintDiversityCount,
    hintQualityScore,
  };
}

function detectCombatRuleErrors(input: {
  dmResponse: string;
  combatState: CombatState | null;
  awaitingPlayerInitiative: boolean;
}): string[] {
  const errors: string[] = [];
  const lower = input.dmResponse.toLowerCase();
  const hasStatus = /\[STATUS\][\s\S]*?\[\/STATUS\]/i.test(input.dmResponse);
  const hasHints = /\[HINTS\][\s\S]*?\[\/HINTS\]/i.test(input.dmResponse);

  if (!hasStatus) errors.push("missing_status_block");
  if (!hasHints) errors.push("missing_hints_block");

  if (
    /(\*rolls\*|rolls a d20|rolling for initiative|=\s*\d+)/i.test(
      input.dmResponse,
    )
  ) {
    errors.push("forbidden_dice_narration");
  }

  if (input.awaitingPlayerInitiative && /what do you do\??/i.test(lower)) {
    errors.push("prompted_player_during_initiative_wait");
  }

  const combatState = input.combatState;
  if (combatState?.is_active && !combatState.awaiting_player_initiative) {
    const current = combatState.combatants[combatState.current_turn_index];
    const hasAttackRollTag = /\[ROLL:\s*attack/i.test(input.dmResponse);
    const hasDamageRollTag = /\[ROLL:\s*damage/i.test(input.dmResponse);
    const hasAnyRollTag = /\[ROLL:/i.test(input.dmResponse);

    if (current?.type === "player" && hasAttackRollTag && hasDamageRollTag) {
      errors.push("combined_attack_and_damage_roll_tags");
    }

    if (current?.type === "monster" && hasAnyRollTag) {
      errors.push("roll_tag_emitted_on_monster_turn");
    }
  }

  return errors;
}

function extractTaggedBlock(text: string, tag: string): string | null {
  const regex = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function clampInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}
