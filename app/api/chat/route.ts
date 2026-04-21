import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { buildDMSystemPrompt, buildCombatStartPrompt } from "@/lib/dm-prompt";
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
} from "@/lib/combat/engine";
import type { CombatState } from "@/lib/combat/types";

// Your existing embed + retrieve functions
import { embedText, retrieveChunks } from "@/lib/rag";

export async function POST(req: NextRequest) {
  const { sessionId, message, history } = await req.json();
  const conversationHistory = Array.isArray(history) ? history : [];
  const supabase = supabaseAdmin;

  // 1. Embed the player message and retrieve relevant chunks
  const chunks = await retrieveChunks(message);
  const retrievedChunks = chunks.map((c: { content: string }) => c.content);

  // 2. Load current combat state from Supabase
  let combatState = await getCombatState(sessionId);

  // 3. Build the DM system prompt with combat state injected
  const systemPrompt = buildDMSystemPrompt({ retrievedChunks, combatState });

  // 4. Build messages array for the LLM
  const messages = [...history, { role: "user", content: message }];

  // 5. Call Ollama (streaming)
  const ollamaRes = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_CHAT_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: true,
    }),
  });

  // 6. Stream response back to client, collect full text for post-processing
  const encoder = new TextEncoder();
  let fullResponse = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const token = json.message?.content ?? "";
            fullResponse += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ token })}\n\n`),
            );
          } catch {}
        }
      }

      // 7. Post-stream: update combat state based on DM response
      combatState = await processCombatStateUpdate({
        sessionId,
        playerMessage: message,
        dmResponse: fullResponse,
        combatState,
      });

      // 8. Persist messages to DB
      await supabase.from("messages").insert([
        { session_id: sessionId, role: "user", content: message },
        { session_id: sessionId, role: "assistant", content: fullResponse },
      ]);

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Combat-Active": String(combatState?.is_active ?? false),
    },
  });
}

// --- Combat state post-processing ---

async function processCombatStateUpdate({
  sessionId,
  playerMessage,
  dmResponse,
  combatState,
}: {
  sessionId: string;
  playerMessage: string;
  dmResponse: string;
  combatState: CombatState | null;
}): Promise<CombatState | null> {
  // Case 1: Combat just started
  if (!combatState?.is_active && detectCombatStart(playerMessage, dmResponse)) {
    // You'll want to pass real monster data here — for now, stub with a goblin
    // In production, the LLM response or encounter data determines who to add
    const newState = await upsertCombatState({
      session_id: sessionId,
      is_active: true,
      round: 1,
      current_turn_index: 0,
      combatants: [], // populated by encounter loader (see note below)
      log: [
        {
          round: 1,
          turn: 0,
          actor: "DM",
          description: "Combat began.",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return newState;
  }

  if (!combatState?.is_active) return null;

  // Case 2: Combat ongoing — parse damage events and advance turn
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
        description: `${target.name} took ${event.amount} damage (HP: ${target.hp - event.amount}/${target.max_hp})`,
      });
    }
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

  // Advance the turn
  state = advanceTurn(state);
  await upsertCombatState(state);
  return state;
}
