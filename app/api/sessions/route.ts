import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createLlmChatCompletion,
  getLlmProvider,
  readLlmChatContent,
} from "@/lib/llmClient";

const OPENING_SYSTEM_PROMPT = `You are the Dungeon Master for Lost Mine of Phandelver, a D&D 5e adventure.

You are telling a story to a young child, around 7 or 8 years old. Use very simple words and short sentences. No long paragraphs. Make it exciting and easy to understand, like a bedtime adventure story.

Set the scene: a dusty road through the woods, a wagon, and then goblins jumping out to ambush the player. End at the moment of the ambush — describe what the player sees and can do next.

Rules:
- Short sentences only
- Simple everyday words (no "oppressive", "malevolent", "cacophony")
- Fun and a little bit scary, but not too scary
- No meta-commentary or "Welcome!" — just start the story`;

async function generateOpeningMessage(
  characterContext?: string,
): Promise<string> {
  const userContent = characterContext
    ? `My character: ${characterContext}\n\nBegin the adventure.`
    : "Begin the adventure.";

  const provider = getLlmProvider();
  const response = await createLlmChatCompletion({
    provider,
    systemPrompt: OPENING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  return readLlmChatContent(response, provider);
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
    const { data: session, error: sessionError } = await supabaseAdmin
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
    console.log("Using LLM provider:", getLlmProvider());
    const openingMessage = await generateOpeningMessage(characterContext);
    console.log("Opening message length:", openingMessage.length);
    console.log("Opening message preview:", openingMessage.slice(0, 120));

    // 3. Persist it as the first assistant message
    const { error: msgError } = await supabaseAdmin.from("messages").insert({
      session_id: session.id,
      role: "assistant",
      content: openingMessage,
    });
    console.log("Message insert error:", msgError);

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
    const { data, error } = await supabaseAdmin
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
