import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sortByInitiative, appendLog } from "@/lib/combat/engine";
import type { CombatState } from "@/lib/combat/types";

// ─── Helper: Get combat state ─────────────────────────────────────────────────────
async function getCombatState(id: string): Promise<CombatState | null> {
  const { data, error } = await supabaseAdmin
    .from("combat_state")
    .select("*")
    .eq("session_id", id)
    .single();

  if (error) return null;
  return data;
}

// ─── Helper: Save combat state ───────────────────────────────────────────────────
async function saveCombatState(
  id: string,
  state: Partial<CombatState>,
): Promise<CombatState | null> {
  const { data, error } = await supabaseAdmin
    .from("combat_state")
    .update({
      ...state,
      updated_at: new Date().toISOString(),
    })
    .eq("session_id", id)
    .select()
    .single();

  if (error) return null;
  return data;
}

// ─── GET /api/combat/[id] ────────────────────────────────────────────────────────
// Returns the current combat state for a session.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const state = await getCombatState(id);

  if (!state) {
    return NextResponse.json({ is_active: false }, { status: 200 });
  }

  return NextResponse.json(state);
}

// ─── PATCH /api/combat/[id] ──────────────────────────────────────────────────────
// Called when the player submits their initiative roll.
// Body: { initiativeRoll: number }  (the d20 result — modifier applied server-side)

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { initiativeRoll } = await req.json();

  // Validate input
  if (
    typeof initiativeRoll !== "number" ||
    initiativeRoll < 1 ||
    initiativeRoll > 20
  ) {
    return NextResponse.json(
      { error: "Invalid initiative roll" },
      { status: 400 },
    );
  }

  // Load existing state
  const state = await getCombatState(id);
  if (!state) {
    return NextResponse.json(
      { error: "Combat state not found" },
      { status: 404 },
    );
  }

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

  // Log the initiative order
  const order = sorted.map((c) => `${c.name} (${c.initiative})`).join(", ");
  const stateWithLog = appendLog(state, {
    round: 1,
    turn: 0,
    actor: "DM",
    description: `Initiative order: ${order}`,
  });

  // Save updated state
  const saved = await saveCombatState(id, {
    combatants: sorted,
    current_turn_index: 0,
    awaiting_player_initiative: false,
    log: stateWithLog.log,
  });

  if (!saved) {
    return NextResponse.json(
      { error: "Failed to save combat state" },
      { status: 500 },
    );
  }

  return NextResponse.json(saved);
}
