import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createLlmChatCompletion,
  getLlmProvider,
  readLlmChatContent,
} from "@/lib/llmClient";

type AdventureSlug =
  | "lost-mine-of-phandelver"
  | "ghosts-of-saltmarsh"
  | "tales-from-the-yawning-portal";

const OPENING_PROMPTS: Record<AdventureSlug, string> = {
  "lost-mine-of-phandelver": `You are the Dungeon Master for Lost Mine of Phandelver, a D&D 5e adventure.

You are telling a story to a young child, around 7 or 8 years old. Use very simple words and short sentences. No long paragraphs. Make it exciting and easy to understand, like a bedtime adventure story.

Set the scene: a dusty road through the woods, a wagon, and then goblins jumping out to ambush the player. End at the moment of the ambush — describe what the player sees and can do next.

Rules:
- Short sentences only
- Simple everyday words (no "oppressive", "malevolent", "cacophony")
- Fun and a little bit scary, but not too scary
- No meta-commentary or "Welcome!" — just start the story`,

  "ghosts-of-saltmarsh": `You are the Dungeon Master for Ghosts of Saltmarsh, a D&D 5e adventure.

You are telling a story to a young child, around 7 or 8 years old. Use very simple words and short sentences. No long paragraphs. Make it exciting and easy to understand, like a bedtime adventure story.

Set the scene: the salty sea air, the creaking docks of Saltmarsh, and rumours of a haunted mansion on the cliffs. End at the moment the player arrives in town and hears the first whisper of trouble.

Rules:
- Short sentences only
- Simple everyday words
- Fun and a little bit spooky, but not too scary
- No meta-commentary or "Welcome!" — just start the story`,

  "tales-from-the-yawning-portal": `You are the Dungeon Master for Tales from the Yawning Portal, a D&D 5e adventure anthology.

You are telling a story to a young child, around 7 or 8 years old. Use very simple words and short sentences. No long paragraphs. Make it exciting and easy to understand, like a bedtime adventure story.

Set the scene: the warm, noisy Yawning Portal tavern in Waterdeep, the huge well in the middle of the floor leading down into darkness, and a stranger at the bar with a job offer and a mysterious map.

Rules:
- Short sentences only
- Simple everyday words
- Fun and a little mysterious
- No meta-commentary or "Welcome!" — just start the story`,
};

const DEFAULT_SLUG: AdventureSlug = "lost-mine-of-phandelver";

async function generateOpeningMessage(
  adventureSlug: AdventureSlug,
  characterContext?: string,
): Promise<string> {
  const systemPrompt = OPENING_PROMPTS[adventureSlug];

  const userContent = characterContext
    ? `My character: ${characterContext}\n\nBegin the adventure.`
    : "Begin the adventure.";

  const provider = getLlmProvider();
  const response = await createLlmChatCompletion({
    provider,
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  return readLlmChatContent(response, provider);
}

// POST /api/sessions — create a new session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const characterContext: string | undefined = body.characterContext;
    const adventureSlug: AdventureSlug = OPENING_PROMPTS[
      body.adventureSlug as AdventureSlug
    ]
      ? (body.adventureSlug as AdventureSlug)
      : DEFAULT_SLUG;

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
        adventure_slug: adventureSlug,
        narrative_flags: {},
      })
      .select("id")
      .single();

    if (sessionError) throw new Error(sessionError.message);

    // 2. Generate the opening DM narration
    console.log("Using LLM provider:", getLlmProvider());
    console.log("Adventure slug:", adventureSlug);
    const openingMessage = await generateOpeningMessage(
      adventureSlug,
      characterContext,
    );
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
      .select(
        "id, title, created_at, status, journal_entry, narrative_flags, adventure_slug",
      )
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ sessions: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
