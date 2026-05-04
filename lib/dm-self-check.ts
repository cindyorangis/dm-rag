import type { CombatState } from "@/lib/combat/types";
import {
  createLlmChatCompletion,
  readLlmChatContent,
  readLlmError,
  type LlmProvider,
} from "@/lib/llmClient";
import { detectCombatEnd, detectCombatStart } from "@/lib/combat/detector";

type CombatTurnType = "none" | "player" | "monster" | "initiative_wait";

export interface SelfCheckIssue {
  code: string;
  message: string;
}

export interface SelfCheckContext {
  playerMessage: string;
  dmResponse: string;
  combatState: CombatState | null;
}

export interface RunSelfCheckParams {
  provider: LlmProvider;
  context: SelfCheckContext;
  repairEnabled: boolean;
  strictMode: boolean;
}

const REPAIR_PROMPT = `You are validating a D&D DM response.
Rewrite the response with minimal edits while preserving intent and scene details.
Requirements:
- Keep narrative style and continuity.
- Ensure [STATUS] and [HINTS] blocks exist and are well-formed.
- Avoid dice narration in prose.
- Respect combat roll-tag constraints from the listed violations.
- Keep [FLAG_OPS] (if present) valid and at the very end.
- Return only the corrected DM response.`;

export function shouldRunSelfCheckPreflight(input: {
  playerMessage: string;
  combatState: CombatState | null;
}): boolean {
  if (
    input.combatState?.is_active ||
    input.combatState?.awaiting_player_initiative
  ) {
    return true;
  }

  return /\b(attack|fight|initiative|cast|kill|death|dying|quest|spare|betray|accept|refuse|deal|promise|oath)\b/i.test(
    input.playerMessage,
  );
}

export function isCriticalTurn(context: SelfCheckContext): boolean {
  const { playerMessage, dmResponse, combatState } = context;

  if (combatState?.is_active || combatState?.awaiting_player_initiative) {
    return true;
  }

  if (
    detectCombatStart(playerMessage, dmResponse) ||
    detectCombatEnd(dmResponse)
  ) {
    return true;
  }

  if (/\[FLAG_OPS\][\s\S]*?\[\/FLAG_OPS\]/i.test(dmResponse)) {
    return true;
  }

  if (
    /\b(0 hp|falls to 0|death|dying|corpse[- ]run|captured|pact|benefactor)\b/i.test(
      dmResponse,
    )
  ) {
    return true;
  }

  return false;
}

export function validateCriticalTurnResponse(
  context: SelfCheckContext,
): SelfCheckIssue[] {
  const issues: SelfCheckIssue[] = [];
  const { dmResponse, combatState } = context;
  const lower = dmResponse.toLowerCase();

  const hasStatusBlock = /\[STATUS\][\s\S]*?\[\/STATUS\]/i.test(dmResponse);
  const hasHintsBlock = /\[HINTS\][\s\S]*?\[\/HINTS\]/i.test(dmResponse);

  if (!hasStatusBlock) {
    issues.push({
      code: "missing_status_block",
      message: "Missing [STATUS]...[/STATUS] block.",
    });
  }

  if (!hasHintsBlock) {
    issues.push({
      code: "missing_hints_block",
      message: "Missing [HINTS]...[/HINTS] block.",
    });
  }

  if (hasHintsBlock) {
    const hintsBlock = extractTagBlock(dmResponse, "HINTS");
    const hintLines = hintsBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (hintLines.length < 3) {
      issues.push({
        code: "too_few_hints",
        message: "Expected at least 3 hint lines in [HINTS].",
      });
    }

    const malformedHint = hintLines.some(
      (line) => !/^\[(action|explore|social|lore)\]\s+.+\|.+/i.test(line),
    );
    if (malformedHint) {
      issues.push({
        code: "malformed_hint_line",
        message: "One or more hint lines are malformed.",
      });
    }
  }

  if (
    /(\*rolls\*|rolls a d20|rolling for initiative|=\s*\d+)/i.test(dmResponse)
  ) {
    issues.push({
      code: "forbidden_dice_narration",
      message: "Narrative includes forbidden dice narration.",
    });
  }

  const rollTags = dmResponse.match(/\[ROLL:[^\]]+\]/gi) ?? [];
  if (rollTags.length > 1) {
    issues.push({
      code: "multiple_roll_tags",
      message: "More than one [ROLL:] tag was emitted.",
    });
  }

  const turnType = getCombatTurnType(combatState);
  const hasAttackRoll = /\[ROLL:\s*attack/i.test(dmResponse);
  const hasDamageRoll = /\[ROLL:\s*damage/i.test(dmResponse);
  const hasAnyRoll = rollTags.length > 0;

  if (turnType === "initiative_wait" && /what do you do\??/i.test(lower)) {
    issues.push({
      code: "prompted_player_during_initiative_wait",
      message: "Asked for player action while waiting for initiative.",
    });
  }

  if (turnType === "player" && hasAttackRoll && hasDamageRoll) {
    issues.push({
      code: "combined_attack_and_damage",
      message: "Attack and damage roll tags were combined in one response.",
    });
  }

  if (turnType === "monster" && hasAnyRoll) {
    issues.push({
      code: "roll_tag_on_monster_turn",
      message: "Roll tag emitted during a monster turn.",
    });
  }

  return dedupeIssues(issues);
}

export async function runCriticalTurnSelfCheck({
  provider,
  context,
  repairEnabled,
  strictMode,
}: RunSelfCheckParams): Promise<{
  response: string;
  issuesBefore: SelfCheckIssue[];
  issuesAfter: SelfCheckIssue[];
  repaired: boolean;
}> {
  const issuesBefore = validateCriticalTurnResponse(context);
  if (issuesBefore.length === 0) {
    return {
      response: context.dmResponse,
      issuesBefore,
      issuesAfter: issuesBefore,
      repaired: false,
    };
  }

  if (!repairEnabled) {
    const response = strictMode
      ? applyDeterministicFallback(context.dmResponse, context.combatState)
      : context.dmResponse;
    return {
      response,
      issuesBefore,
      issuesAfter: validateCriticalTurnResponse({
        ...context,
        dmResponse: response,
      }),
      repaired: strictMode,
    };
  }

  try {
    const repaired = await attemptLLMRepair(provider, context, issuesBefore);
    const issuesAfter = validateCriticalTurnResponse({
      ...context,
      dmResponse: repaired,
    });

    if (issuesAfter.length < issuesBefore.length || issuesAfter.length === 0) {
      return {
        response: repaired,
        issuesBefore,
        issuesAfter,
        repaired: true,
      };
    }
  } catch (error) {
    console.warn("Critical turn self-check repair failed.", error);
  }

  const fallback = strictMode
    ? applyDeterministicFallback(context.dmResponse, context.combatState)
    : context.dmResponse;
  return {
    response: fallback,
    issuesBefore,
    issuesAfter: validateCriticalTurnResponse({
      ...context,
      dmResponse: fallback,
    }),
    repaired: strictMode,
  };
}

async function attemptLLMRepair(
  provider: LlmProvider,
  context: SelfCheckContext,
  issues: SelfCheckIssue[],
): Promise<string> {
  const turnType = getCombatTurnType(context.combatState);
  const prompt = [
    `Combat turn type: ${turnType}`,
    "",
    "Violations:",
    ...issues.map((issue) => `- ${issue.code}: ${issue.message}`),
    "",
    "Player message:",
    context.playerMessage,
    "",
    "Original DM response:",
    context.dmResponse,
  ].join("\n");

  const completion = await createLlmChatCompletion({
    provider,
    systemPrompt: REPAIR_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  if (!completion.ok) {
    throw new Error(await readLlmError(completion, provider));
  }

  const repaired = await readLlmChatContent(completion, provider);
  return repaired.trim();
}

function applyDeterministicFallback(
  dmResponse: string,
  combatState: CombatState | null,
): string {
  let result = dmResponse;
  const turnType = getCombatTurnType(combatState);

  result = result.replace(/\*rolls\*/gi, "acts");
  result = result.replace(/rolls a d20[^.?!]*[.?!]?/gi, "");
  result = result.replace(/rolling for initiative[^.?!]*[.?!]?/gi, "");

  if (turnType === "monster") {
    result = result.replace(/\n?\[ROLL:[^\]]+\]/gi, "");
  }

  if (turnType === "player") {
    const rollTags = result.match(/\[ROLL:[^\]]+\]/gi) ?? [];
    if (rollTags.length > 1) {
      const firstTag = rollTags[0];
      result = result.replace(/\[ROLL:[^\]]+\]/gi, "");
      result = `${result.trim()}\n${firstTag}`;
    }
  }

  if (!/\[STATUS\][\s\S]*?\[\/STATUS\]/i.test(result)) {
    result += `\n\n[STATUS]\n* You continue pressing forward through the scene.\n* A meaningful threat or challenge remains active.\n* At least one NPC or location is relevant right now.\n[/STATUS]`;
  }

  if (!/\[HINTS\][\s\S]*?\[\/HINTS\]/i.test(result)) {
    result += `\n\n[HINTS]\n[action] Press the advantage | I take decisive action to push this moment forward.\n[explore] Inspect the surroundings | I carefully examine the area for tactical clues or hidden details.\n[social] Address a nearby character | I speak directly to the most relevant person here to gather leverage.\n[lore] Recall useful knowledge | I think back on what I know that could explain what we are facing.\n[/HINTS]`;
  }

  return result.trim();
}

function getCombatTurnType(combatState: CombatState | null): CombatTurnType {
  if (!combatState?.is_active) return "none";
  if (combatState.awaiting_player_initiative) return "initiative_wait";
  const current = combatState.combatants[combatState.current_turn_index];
  if (!current) return "none";
  return current.type === "player" ? "player" : "monster";
}

function extractTagBlock(text: string, tag: string): string {
  const regex = new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[\\/${tag}\\]`, "i");
  const match = text.match(regex);
  return match?.[1]?.trim() ?? "";
}

function dedupeIssues(issues: SelfCheckIssue[]): SelfCheckIssue[] {
  const seen = new Set<string>();
  const deduped: SelfCheckIssue[] = [];
  for (const issue of issues) {
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    deduped.push(issue);
  }
  return deduped;
}
