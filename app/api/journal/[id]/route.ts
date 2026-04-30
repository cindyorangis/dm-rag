import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const validStatuses = ["active", "paused", "completed"] as const;

interface SessionData {
  id: string;
  title: string;
  created_at: string;
  journal_entry: string | null;
  status: string;
}

interface SessionUpdate {
  journal_entry?: string | null;
  status?: (typeof validStatuses)[number];
}

async function getSession(id: string): Promise<SessionData | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, title, created_at, journal_entry, status")
    .eq("id", id)
    .single();

  if (error) {
    console.error(`Error fetching session ${id}:`, error.message);
    return null;
  }

  return data;
}

async function updateSession(
  id: string,
  updates: SessionUpdate,
): Promise<SessionData | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .update(updates)
    .eq("id", id)
    .select("id, title, created_at, journal_entry, status")
    .single();

  if (error) {
    console.error(`Error updating session ${id}:`, error.message);
    return null;
  }

  return data;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);

    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("GET /api/journal/[id] error:", message);
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

    // Validate status if provided
    if (body.status && !validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: SessionUpdate = {};
    if (body.journal_entry !== undefined)
      updates.journal_entry = body.journal_entry;
    if (body.status !== undefined) updates.status = body.status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const session = await updateSession(id, updates);

    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("PATCH /api/journal/[id] error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
