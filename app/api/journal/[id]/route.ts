import { NextResponse } from "next/server";
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { journal_entry, status } = body;

    // Validate status values
    const validStatuses = ["active", "paused", "completed"];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (journal_entry !== undefined) updates.journal_entry = journal_entry;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("sessions")
      .update(updates)
      .eq("id", id)
      .select("id, title, created_at, journal_entry, status")
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