import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sortByInitiative } from "@/lib/combat/engine";
import { appendLog } from "@/lib/combat/engine";
import type { CombatState } from "@/lib/combat/types";

// ─── GET /api/combat/[id] ─────────────────────────────────────────────────────
// Returns the current combat state for a session.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const { data, error } = await supabaseAdmin
    .from("combat_state")
    .select("*")
    .eq("session_id", id)
    .single();

  if (error) {
    // No combat state yet — return a neutral response, not a 500
    return NextResponse.json({ is_active: false }, { status: 200 });
  }

  return NextResponse.json(data);
}

// ─── PATCH /api/combat/[id] ───────────────────────────────────────────────────
// Called when the player submits their initiative roll.
// Body: { initiativeRoll: number }  (the d20 result — modifier applied server-side)

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { initiativeRoll } = await req.json();

  if (typeof initiativeRoll !== "number" || initiativeRoll < 1) {
    return NextResponse.json(
      { error: "Invalid initiative roll" },
      { status: 400 },
    );
  }

  // Load existing state
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("combat_state")
    .select("*")
    .eq("session_id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { error: "Combat state not found" },
      { status: 404 },
    );
  }

  const state = existing as CombatState & {
    awaiting_player_initiative?: boolean;
  };

  // Find the player combatant and apply their roll + modifier
  const player = state.combatants.find((c) => c.type === "player");
  if (!player) {
    return NextResponse.json(
      { error: "Player combatant not found" },
      { status: 400 },
    );
  }

  const finalInitiative = initiativeRoll + (player.initiative_mod ?? 0);

  // Update player's initiative
  const updatedCombatants = state.combatants.map((c) =>
    c.type === "player" ? { ...c, initiative: finalInitiative } : c,
  );

  // Sort all combatants by initiative now that we have the full picture
  const sorted = sortByInitiative(updatedCombatants);

  // Find the index of the highest-initiative combatant to start the first turn
  const firstTurnIndex = 0; // sorted descending, so index 0 goes first

  let updatedState: Partial<CombatState> & {
    awaiting_player_initiative: boolean;
  } = {
    ...state,
    combatants: sorted,
    current_turn_index: firstTurnIndex,
    awaiting_player_initiative: false,
  };

  // Log the initiative order
  const order = sorted.map((c) => `${c.name} (${c.initiative})`).join(", ");
  updatedState = appendLog(updatedState as CombatState, {
    round: 1,
    turn: 0,
    actor: "DM",
    description: `Initiative order: ${order}`,
  }) as typeof updatedState;

  const { data: saved, error: saveError } = await supabaseAdmin
    .from("combat_state")
    .update({
      combatants: updatedState.combatants,
      current_turn_index: updatedState.current_turn_index,
      log: updatedState.log,
      awaiting_player_initiative: false,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", id)
    .select()
    .single();

  if (saveError) {
    return NextResponse.json({ error: saveError.message }, { status: 500 });
  }

  return NextResponse.json(saved);
}
