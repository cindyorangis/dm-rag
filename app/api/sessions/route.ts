import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);

const OPENING_SYSTEM_PROMPT = `You are the Dungeon Master for Lost Mine of Phandelver, a D&D 5e adventure set in the Forgotten Realms.

Your task right now is to deliver the opening narration for the adventure. Do not ask any questions. Do not prompt the player for input. Simply narrate.

Set the scene immersively: the dusty Triboar Trail east of Neverwinter, the wagon of supplies for Phandalin, the smell of pine and horse sweat, the quiet that feels a little too quiet. End the narration at the moment of the goblin ambush — describe what the player sees, hears, and can react to. Leave the player in the middle of the moment, not after it.

Tone: terse, atmospheric, Tolkien-adjacent. No "Welcome to the adventure!" No meta-commentary. Drop them straight in.`;

async function generateOpeningMessage(
  characterContext?: string,
): Promise<string> {
  const userContent = characterContext
    ? `My character: ${characterContext}\n\nBegin the adventure.`
    : "Begin the adventure.";

  const response = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_CHAT_MODEL, // "llama3" per your .env
      messages: [
        { role: "system", content: OPENING_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      stream: false,
    }),
  });

  const data = await response.json();
  return data.message?.content ?? "";
}

// POST /api/sessions — create a new session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const characterContext: string | undefined = body.characterContext;

    const now = new Date();
    const title = `Session — ${now.toLocaleDateString("en-CA", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`;

    // 1. Create the session
    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        title,
        status: "active",
        character_context: characterContext ?? null,
      })
      .select("id")
      .single();

    if (sessionError) throw new Error(sessionError.message);
    // 2. Generate the opening DM narration
    const openingMessage = await generateOpeningMessage(characterContext);

    // 3. Persist it as the first assistant message
    const { error: msgError } = await supabase.from("messages").insert({
      session_id: session.id,
      role: "assistant",
      content: openingMessage,
    });

    if (msgError) throw new Error(msgError.message);

    return NextResponse.json({ sessionId: session.id });
  } catch (err) {
    console.error("Sessions route error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/sessions — list all sessions (for journal page)
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("id, title, created_at, status, journal_entry")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ sessions: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
