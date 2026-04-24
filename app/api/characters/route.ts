import { supabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = supabaseAdmin;

  const { data, error } = await supabase
    .from("characters")
    .select(
      "id, name, race, class, level, background, alignment, str, dex, con, int, wis, cha, ac, max_hp, speed, hit_dice, personality_traits, ideals, bonds, flaws, features_and_traits, equipment, notes, proficiency_bonus, passive_wisdom",
    )
    .eq("is_npc", false)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ characters: data });
}
