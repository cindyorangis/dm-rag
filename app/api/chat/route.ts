import { NextRequest, NextResponse } from "next/server";
import type { supabaseAdminType } from "@/lib/supabase";
import type { CombatState, Combatant } from "@/lib/combat/types";
import { supabaseAdmin } from "@/lib/supabase";
import { buildDMSystemPrompt } from "@/lib/dm-prompt";
import { getCombatState, upsertCombatState } from "@/lib/combat/repository";
import {
  detectCombatStart,
  detectCombatEnd,
  parseDamageFromNarrative,
} from "@/lib/combat/detector";
import {
  applyDamage,
  advanceTurn,
  appendLog,
  endCombat,
  rollAllInitiatives,
  isPlayerDead,
  selectDeathResolution,
} from "@/lib/combat/engine";
import {
  detectEncounterKey,
  buildEncounterMonstersOnly,
} from "@/lib/combat/encounters";
import { v4 as uuidv4 } from "uuid";
import { retrieveChunks } from "@/lib/rag";
import {
  type LlmMessage,
  createLlmChatStream,
  getLlmProvider,
  parseLlmStreamChunk,
  readLlmError,
} from "@/lib/llmClient";
import { compressConversationHistory } from "@/lib/memory-compression";
import {
  applyNarrativeFlagOps,
  parseNarrativeFlagOpsFromText,
  sanitizeNarrativeFlags,
  stripNarrativeFlagOpsBlocks,
} from "@/lib/narrative/flags";

// Constants
const DEFAULT_PLAYER = {
  name: "Adventurer",
  hp: 10,
  ac: 12,
  dexMod: 0,
};

const DEFAULT_ADVENTURE_SLUG = "lost-mine-of-phandelver";

export async function POST(req: NextRequest) {
  const { sessionId, message, history } = await req.json();
  const conversationHistory = normalizeConversationHistory(history);
  const supabase = supabaseAdmin;
  const llmProvider = getLlmProvider();

  // 1. Load session
  const sessionContext = await loadSessionContext(sessionId, supabase);
  const sessionRow = sessionContext.data;

  const narrativeFlags = sanitizeNarrativeFlags(sessionRow?.narrative_flags);
  const adventureSlug: string =
    sessionRow?.adventure_slug ?? DEFAULT_ADVENTURE_SLUG;

  // 2. Embed and retrieve chunks
  const chunks = await retrieveChunks(message, adventureSlug);
  const retrievedChunks = chunks.map((c: { content: string }) => c.content);

  // 3. Load current combat state
  let combatState = await getCombatState(sessionId);

  // 4. Compress long histories into rolling memory
  let promptMemorySummary: string | null =
    typeof sessionRow?.memory_summary === "string"
      ? sessionRow.memory_summary
      : null;
  let messagesForModel = conversationHistory;

  try {
    const compressed = await compressConversationHistory({
      history: conversationHistory,
      provider: llmProvider,
      rollingSummary: promptMemorySummary,
      summarizedMessageCount: sessionRow?.memory_summary_message_count ?? 0,
    });

    promptMemorySummary = compressed.rollingSummary;
    messagesForModel = compressed.messagesForModel;

    if (compressed.summaryWasUpdated && sessionContext.memoryColumnsAvailable) {
      await supabase
        .from("sessions")
        .update({
          memory_summary: compressed.rollingSummary,
          memory_summary_message_count: compressed.summarizedMessageCount,
        })
        .eq("id", sessionId);
    }
  } catch (error) {
    console.warn("Memory compression skipped due to summarization failure.", {
      sessionId,
      error,
    });
    messagesForModel = conversationHistory;
  }

  // 4. Build DM system prompt
  const systemPrompt = buildDMSystemPrompt({
    retrievedChunks,
    combatState,
    narrativeFlags,
    adventureSlug,
    characterContext: sessionRow?.character_context ?? null,
    rollingSummary: promptMemorySummary,
  });

  // 5. Build messages array
  const messages = [...messagesForModel, { role: "user", content: message }];

  // 6. Call LLM
  const llmRes = await createLlmChatStream({
    provider: llmProvider,
    systemPrompt,
    messages,
  });

  if (!llmRes.ok) {
    const error = await readLlmError(llmRes, llmProvider);
    return NextResponse.json({ error }, { status: 500 });
  }

  // 7. Stream response
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = llmRes.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      let pending = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        pending += decoder.decode(value, { stream: true });
        const lastNewlineIndex = pending.lastIndexOf("\n");
        if (lastNewlineIndex === -1) {
          continue;
        }

        const completeChunk = pending.slice(0, lastNewlineIndex + 1);
        pending = pending.slice(lastNewlineIndex + 1);
        const parsedChunk = parseLlmStreamChunk(completeChunk, llmProvider);

        if (parsedChunk.error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: parsedChunk.error })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        for (const token of parsedChunk.tokens) {
          if (token) {
            fullResponse += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token })}\n\n`),
            );
          }
        }

        if (parsedChunk.done) {
          break;
        }
      }

      if (pending.trim()) {
        const parsedRemainder = parseLlmStreamChunk(
          `${pending}\n`,
          llmProvider,
        );
        if (parsedRemainder.error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: parsedRemainder.error })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        for (const token of parsedRemainder.tokens) {
          if (token) {
            fullResponse += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token })}\n\n`),
            );
          }
        }
      }

      const dmResponseForState = stripNarrativeFlagOpsBlocks(fullResponse);

      // 8. Post-stream: update combat state
      combatState = await processCombatStateUpdate({
        sessionId,
        playerMessage: message,
        dmResponse: dmResponseForState,
        combatState,
        characterContext: sessionRow?.character_context ?? null,
      });

      // 9. Persist narrative flags
      await updateNarrativeFlagsFromDmResponse({
        sessionId,
        dmResponse: fullResponse,
        supabase,
      });

      // 10. Persist messages to DB
      await supabase.from("messages").insert([
        { session_id: sessionId, role: "user", content: message },
        {
          session_id: sessionId,
          role: "assistant",
          content: dmResponseForState,
        },
      ]);

      // 11. Signal frontend
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            done: true,
            awaitingInitiative:
              combatState?.awaiting_player_initiative ?? false,
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

async function loadSessionContext(
  sessionId: string,
  supabase: supabaseAdminType,
): Promise<{
  data: {
    narrative_flags?: Record<string, unknown>;
    adventure_slug?: string | null;
    character_context?: string | null;
    memory_summary?: string | null;
    memory_summary_message_count?: number | null;
  } | null;
  memoryColumnsAvailable: boolean;
}> {
  const withMemoryColumns =
    "narrative_flags, adventure_slug, character_context, memory_summary, memory_summary_message_count";
  const fallbackColumns = "narrative_flags, adventure_slug, character_context";

  const withMemory = await supabase
    .from("sessions")
    .select(withMemoryColumns)
    .eq("id", sessionId)
    .single();

  if (!withMemory.error) {
    return {
      data: withMemory.data ?? null,
      memoryColumnsAvailable: true,
    };
  }

  const missingColumn =
    withMemory.error.code === "42703" ||
    withMemory.error.message?.includes("memory_summary");
  if (!missingColumn) {
    return {
      data: null,
      memoryColumnsAvailable: false,
    };
  }

  const fallback = await supabase
    .from("sessions")
    .select(fallbackColumns)
    .eq("id", sessionId)
    .single();

  return {
    data: fallback.data ?? null,
    memoryColumnsAvailable: false,
  };
}

function normalizeConversationHistory(history: unknown): LlmMessage[] {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      (
        message,
      ): message is {
        role: "user" | "assistant";
        content: string;
      } =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        "content" in message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

async function updateNarrativeFlagsFromDmResponse({
  sessionId,
  dmResponse,
  supabase,
}: {
  sessionId: string;
  dmResponse: string;
  supabase: supabaseAdminType;
}) {
  const ops = parseNarrativeFlagOpsFromText(dmResponse);
  if (!ops) return;

  const { data: session } = await supabase
    .from("sessions")
    .select("narrative_flags")
    .eq("id", sessionId)
    .single();

  const current = sanitizeNarrativeFlags(session?.narrative_flags);
  const nextFlags = applyNarrativeFlagOps(current, ops);

  await supabase
    .from("sessions")
    .update({ narrative_flags: nextFlags })
    .eq("id", sessionId);
}

async function processCombatStateUpdate({
  sessionId,
  playerMessage,
  dmResponse,
  combatState,
  characterContext,
}: {
  sessionId: string;
  playerMessage: string;
  dmResponse: string;
  combatState: CombatState | null;
  characterContext: string | null;
}): Promise<CombatState | null> {
  // Mark deathResolution as applied
  if (combatState?.deathResolution && !combatState.deathResolution.applied) {
    combatState = {
      ...combatState,
      deathResolution: { ...combatState.deathResolution, applied: true },
    };
    await upsertCombatState(combatState);
    return combatState;
  }

  // Case 1: Combat just started
  if (!combatState?.is_active && detectCombatStart(playerMessage, dmResponse)) {
    const playerCombatant = buildPlayerCombatant(characterContext);
    const encounterKey = detectEncounterKey(playerMessage, dmResponse);
    const monsters = buildEncounterMonstersOnly(encounterKey);
    const monstersWithInitiative = rollAllInitiatives(monsters);

    const combatants: Combatant[] = [
      { ...playerCombatant, initiative: 0 },
      ...monstersWithInitiative,
    ];

    const newState = await upsertCombatState({
      session_id: sessionId,
      is_active: true,
      round: 1,
      current_turn_index: 0,
      combatants,
      log: [
        {
          round: 1,
          turn: 0,
          actor: "DM",
          description: "Combat began. Waiting for player initiative roll.",
          timestamp: new Date().toISOString(),
        },
      ],
      awaiting_player_initiative: true,
    } as Omit<CombatState, "id" | "updated_at">);

    return newState;
  }

  // Not in combat
  if (!combatState?.is_active) return null;

  // Still waiting for player initiative
  if (combatState.awaiting_player_initiative) return combatState;

  // Case 2: Combat ongoing
  let state = { ...combatState };

  const damageEvents = parseDamageFromNarrative(dmResponse);

  // Create a Map for O(1) lookup
  const combatantMap = new Map<string, Combatant>();
  state.combatants.forEach((c) => combatantMap.set(c.id, c));

  for (const event of damageEvents) {
    // event.targetName is "player" or monster name (e.g., "goblin")
    const target =
      combatantMap.get(event.targetName) || combatantMap.get("player");
    if (target) {
      state = applyDamage(state, target.id, event.amount);
      state = appendLog(state, {
        round: state.round,
        turn: state.current_turn_index,
        actor: "DM",
        description: `${target.name} took ${event.amount} damage (${target.hp - event.amount}/${target.max_hp} HP)`,
      });
    }
  }

  if (isPlayerDead(state) && !state.deathResolution) {
    const resolutionType = selectDeathResolution();

    state.combatants = state.combatants.map((c) =>
      c.type === "player" ? { ...c, hp: 1, currentHp: 1 } : c,
    );

    state.deathResolution = {
      type: resolutionType,
      applied: false,
      lingeringEffect:
        resolutionType === "corpse_run"
          ? "Marked by death: -2 to all d20 rolls until the corpse-run objective is completed."
          : undefined,
      d20RollModifier: resolutionType === "corpse_run" ? -2 : undefined,
    };

    state = appendLog(state, {
      round: state.round,
      turn: state.current_turn_index,
      actor: "DM",
      description: `Player fell to 0 HP. Death resolution: ${resolutionType}`,
    });
  }

  // Case 3: Combat ended
  if (detectCombatEnd(dmResponse)) {
    state = endCombat(state);
    state = appendLog(state, {
      round: state.round,
      turn: state.current_turn_index,
      actor: "DM",
      description: "Combat ended.",
    });
    await upsertCombatState(state);
    return state;
  }

  state = advanceTurn(state);
  await upsertCombatState(state);
  return state;
}

function buildPlayerCombatant(
  characterContext: string | null | undefined,
): Omit<Combatant, "initiative"> {
  const defaults = { ...DEFAULT_PLAYER };

  if (characterContext) {
    const parsed = parseCharacterContext(characterContext);
    defaults.name = parsed.name ?? defaults.name;
    defaults.hp = parsed.hp ?? defaults.hp;
    defaults.ac = parsed.ac ?? defaults.ac;
    defaults.dexMod = parsed.dexMod ?? defaults.dexMod;
  }

  return {
    id: uuidv4(),
    name: defaults.name,
    type: "player",
    hp: defaults.hp,
    max_hp: defaults.hp,
    ac: defaults.ac,
    initiative_mod: defaults.dexMod,
    conditions: [],
    is_alive: true,
  };
}

function parseCharacterContext(context: string): {
  name?: string;
  hp?: number;
  ac?: number;
  dexMod?: number;
} {
  const result: {
    name?: string;
    hp?: number;
    ac?: number;
    dexMod?: number;
  } = {};

  const nameMatch = context.match(/Name:\s*(.+)/);
  if (nameMatch) result.name = nameMatch[1].trim();

  const hpMatch = context.match(/HP:\s*(\d+)/);
  if (hpMatch) result.hp = parseInt(hpMatch[1]);

  const acMatch = context.match(/AC:\s*(\d+)/);
  if (acMatch) result.ac = parseInt(acMatch[1]);

  const dexMatch = context.match(/DEX\s+(\d+)/i);
  if (dexMatch) result.dexMod = Math.floor((parseInt(dexMatch[1]) - 10) / 2);

  return result;
}
