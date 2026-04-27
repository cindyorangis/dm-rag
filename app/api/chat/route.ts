import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
} from "@/lib/combat/engine";
import {
  detectEncounterKey,
  buildEncounterMonstersOnly,
} from "@/lib/combat/encounters";
import { v4 as uuidv4 } from "uuid";
import type { CombatState, Combatant } from "@/lib/combat/types";
import { retrieveChunks } from "@/lib/rag";
import {
  createLlmChatStream,
  getLlmProvider,
  parseLlmStreamChunk,
  readLlmError,
} from "@/lib/llmClient";

export async function POST(req: NextRequest) {
  const { sessionId, message, history } = await req.json();
  const conversationHistory = Array.isArray(history) ? history : [];
  const supabase = supabaseAdmin;
  const llmProvider = getLlmProvider();

  // 1. Embed the player message and retrieve relevant chunks
  const chunks = await retrieveChunks(message);
  const retrievedChunks = chunks.map((c: { content: string }) => c.content);

  // 2. Load current combat state from Supabase
  let combatState = await getCombatState(sessionId);

  // 3. Build the DM system prompt with combat state injected
  const systemPrompt = buildDMSystemPrompt({ retrievedChunks, combatState });

  // 4. Build messages array for the LLM
  const messages = [...conversationHistory, { role: "user", content: message }];

  // 5. Call provider-backed LLM (streaming)
  const llmRes = await createLlmChatStream({
    provider: llmProvider,
    systemPrompt,
    messages,
  });

  if (!llmRes.ok) {
    const error = await readLlmError(llmRes, llmProvider);
    return NextResponse.json({ error }, { status: 500 });
  }

  // 6. Stream response back to client, collect full text for post-processing
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

      // 7. Post-stream: update combat state based on DM response
      combatState = await processCombatStateUpdate({
        sessionId,
        playerMessage: message,
        dmResponse: fullResponse,
        combatState,
        supabase,
      });

      // 8. Persist messages to DB
      await supabase.from("messages").insert([
        { session_id: sessionId, role: "user", content: message },
        { session_id: sessionId, role: "assistant", content: fullResponse },
      ]);

      // 9. Signal the frontend whether initiative is needed
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

// ─────────────────────────────────────────────────────────────────────────────
// Combat state post-processing
// ─────────────────────────────────────────────────────────────────────────────

async function processCombatStateUpdate({
  sessionId,
  playerMessage,
  dmResponse,
  combatState,
  supabase,
}: {
  sessionId: string;
  playerMessage: string;
  dmResponse: string;
  combatState: CombatState | null;
  supabase: SupabaseClient;
}): Promise<CombatState | null> {
  // ── Case 1: Combat just started ──────────────────────────────────────────
  if (!combatState?.is_active && detectCombatStart(playerMessage, dmResponse)) {
    // Load the session to get character_context for the player combatant
    const { data: session } = await supabase
      .from("sessions")
      .select("character_context")
      .eq("id", sessionId)
      .single();

    const playerCombatant = buildPlayerCombatant(session?.character_context);

    // Detect which encounter based on message context, fall back to trail ambush
    const encounterKey = detectEncounterKey(playerMessage, dmResponse);
    const monsters = buildEncounterMonstersOnly(encounterKey);

    // Roll initiatives for all NPCs (monsters only — player rolls their own)
    const monstersWithInitiative = rollAllInitiatives(monsters);

    // Player initiative is 0 for now; re-sorted after player rolls
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

  // ── Not in combat ────────────────────────────────────────────────────────
  if (!combatState?.is_active) return null;

  // ── Still waiting for player initiative — don't advance ─────────────────
  if (combatState.awaiting_player_initiative) return combatState;

  // ── Case 2: Combat ongoing — parse damage and advance turn ───────────────
  let state = { ...combatState };

  const damageEvents = parseDamageFromNarrative(dmResponse);
  for (const event of damageEvents) {
    const target = state.combatants.find(
      (c) =>
        c.name.toLowerCase().includes(event.targetName.toLowerCase()) ||
        (event.targetName === "player" && c.type === "player"),
    );
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

  // ── Case 3: Combat ended ─────────────────────────────────────────────────
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

  // Advance the turn
  state = advanceTurn(state);
  await upsertCombatState(state);
  return state;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a player Combatant from the character_context string
// ─────────────────────────────────────────────────────────────────────────────

function buildPlayerCombatant(
  characterContext: string | null | undefined,
): Omit<Combatant, "initiative"> {
  let name = "Adventurer";
  let hp = 10;
  let ac = 12;
  let dexMod = 0;

  if (characterContext) {
    const nameMatch = characterContext.match(/Name:\s*(.+)/);
    if (nameMatch) name = nameMatch[1].trim();

    const hpMatch = characterContext.match(/HP:\s*(\d+)/);
    if (hpMatch) hp = parseInt(hpMatch[1]);

    const acMatch = characterContext.match(/AC:\s*(\d+)/);
    if (acMatch) ac = parseInt(acMatch[1]);

    // DEX score → modifier
    const dexMatch = characterContext.match(/DEX\s+(\d+)/i);
    if (dexMatch) dexMod = Math.floor((parseInt(dexMatch[1]) - 10) / 2);
  }

  return {
    id: uuidv4(),
    name,
    type: "player",
    hp,
    max_hp: hp,
    ac,
    initiative_mod: dexMod,
    conditions: [],
    is_alive: true,
  };
}
