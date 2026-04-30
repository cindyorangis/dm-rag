import { supabaseAdmin } from "@/lib/supabase";
import {
  createLlmChatCompletion,
  getLlmProvider,
  readLlmChatContent,
} from "@/lib/llmClient";
import { Message, JournalStatus, JournalResponseData } from "./types";
import { buildJournalPrompt } from "./prompt";

const LLM_TIMEOUT = 30000; // 30 seconds

export async function generateJournalEntry(
  messages: Message[],
): Promise<string> {
  const prompt = buildJournalPrompt(messages);
  const provider = getLlmProvider();

  const res = await Promise.race([
    createLlmChatCompletion({
      provider,
      messages: [{ role: "user", content: prompt }],
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM call timed out")), LLM_TIMEOUT),
    ),
  ]);

  return readLlmChatContent(res, provider);
}

export async function saveJournalEntry(
  sessionId: string,
  journalEntry: string,
  status: JournalStatus,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sessions")
    .update({ status, journal_entry: journalEntry })
    .eq("id", sessionId);

  if (error) {
    const errorMessage = error.message || "Unknown database error";
    const errorDetails = error.details || [];

    console.error(`Failed to save journal for session ${sessionId}:`, {
      error: errorMessage,
      details: errorDetails,
    });

    throw new Error(`Failed to save journal: ${errorMessage}`);
  }
}

export async function processJournalRequest(
  sessionId: string,
  messages: Message[],
  pause: boolean,
): Promise<JournalResponseData> {
  const cleanMessages = messages.filter((m) => m.content.trim().length > 0);

  const journalEntry = await generateJournalEntry(cleanMessages);
  const status = pause ? "paused" : "completed";
  const timestamp = new Date().toISOString();

  await saveJournalEntry(sessionId, journalEntry, status);

  return {
    journalEntry,
    status,
    timestamp,
  };
}
