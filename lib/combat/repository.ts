import { supabaseAdmin } from "@/lib/supabase";
import type { CombatState } from "./types";

export async function getCombatState(
  sessionId: string,
): Promise<CombatState | null> {
  const { data, error } = await supabaseAdmin
    .from("combat_state")
    .select("*")
    .eq("session_id", sessionId)
    .single();

  if (error || !data) return null;
  return data as CombatState;
}

export async function upsertCombatState(
  state: Omit<CombatState, "id" | "updated_at"> & { id?: string },
): Promise<CombatState> {
  const { data, error } = await supabaseAdmin
    .from("combat_state")
    .upsert(
      { ...state, updated_at: new Date().toISOString() },
      { onConflict: "session_id" },
    )
    .select()
    .single();

  if (error || !data)
    throw new Error(`Failed to upsert combat state: ${error?.message}`);
  return data as CombatState;
}

export async function deleteCombatState(sessionId: string): Promise<void> {
  await supabaseAdmin.from("combat_state").delete().eq("session_id", sessionId);
}
