import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3";

function buildJournalPrompt(
  messages: { role: string; content: string }[],
): string {
  const transcript = messages
    .map(
      (m) => `${m.role === "user" ? "PLAYER" : "DUNGEON MASTER"}: ${m.content}`,
    )
    .join("\n\n");

  return `You are a scribe chronicling the adventures of a brave hero in the Forgotten Realms.

Below is a transcript of a D&D session. Write a journal entry in the voice of the player's character — a first-person narrative account of what happened during this session.

Guidelines:
- Write in past tense, first person ("I descended into the cave...", "We fought...")
- Capture key events, decisions, encounters, and outcomes
- Include emotional beats — fear, triumph, curiosity, loss
- Mention notable NPCs, locations, and items encountered
- Keep it 2–4 paragraphs. Evocative prose, not a bullet summary
- Write as if the character is recording this in their personal journal by candlelight

SESSION TRANSCRIPT:
${transcript}

Write the journal entry now:`;
}

async function generateJournalEntry(
  messages: { role: string; content: string }[],
): Promise<string> {
  const prompt = buildJournalPrompt(messages);

  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Ollama request failed: ${res.statusText}`);

  const data = await res.json();
  return data.message?.content ?? "";
}

async function saveJournalEntry(
  sessionId: string,
  journalEntry: string,
  status: "paused" | "completed",
) {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ status, journal_entry: journalEntry })
    .eq("id", sessionId);

  if (error) throw new Error(`Failed to save journal: ${error.message}`);
}

// POST /api/journal
export async function POST(req: NextRequest) {
  try {
    const { sessionId, messages, pause = false } = await req.json();

    if (!sessionId || !messages?.length) {
      return NextResponse.json(
        { error: "sessionId and messages are required" },
        { status: 400 },
      );
    }

    const cleanMessages = messages.filter(
      (m: { role: string; content: string }) => m.content.trim().length > 0,
    );

    const journalEntry = await generateJournalEntry(cleanMessages);
    const status = pause ? "paused" : "completed";
    await saveJournalEntry(sessionId, journalEntry, status);

    return NextResponse.json({ journalEntry, status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
