import { supabaseAdmin } from "@/lib/supabase";
import { NextResponse } from "next/server";

const CHARACTERS_TABLE = "characters";
const NPC_FILTER = "is_npc";

export async function GET(request: Request) {
  const supabase = supabaseAdmin;

  // Parse query parameters
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);
  const race = searchParams.get("race");
  const classType = searchParams.get("class");
  const level = searchParams.get("level");

  // Build query with filters
  const query = supabase
    .from(CHARACTERS_TABLE)
    .select("*")
    .eq(NPC_FILTER, false);

  if (race) query.eq("race", race);
  if (classType) query.eq("class", classType);
  if (level) query.eq("level", parseInt(level, 10));

  // Add pagination
  const offset = (page - 1) * limit;
  query.range(offset, offset + limit - 1);

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        error: error.message,
        details:
          process.env.NODE_ENV === "development" ? error.details : undefined,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    characters: data,
    pagination: {
      page,
      limit,
      total: data.length,
    },
  });
}
