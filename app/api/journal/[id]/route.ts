import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { data, error } = await supabaseAdmin
      .from("sessions")
      .select("id, title, created_at, journal_entry, status")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    if (!data)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ session: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
