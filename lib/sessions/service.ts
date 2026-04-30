import { supabaseAdmin } from "@/lib/supabase";
import {
  createLlmChatCompletion,
  getLlmProvider,
  readLlmChatContent,
} from "@/lib/llmClient";
import { OPENING_PROMPTS, type AdventureSlug } from "@/lib/adventures/config";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  status: string;
  journal_entry: string | null;
  narrative_flags: Record<string, unknown>;
  adventure_slug: AdventureSlug;
}

export interface SessionDetail {
  id: string;
  title: string;
  created_at: string;
  status: string;
  character_context: string | null;
  narrative_flags: Record<string, unknown>;
}

// ── LLM ───────────────────────────────────────────────────────────────────────

export async function generateOpeningMessage(
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

// ── DB ────────────────────────────────────────────────────────────────────────

function buildSessionTitle(): string {
  return `Session — ${new Date().toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}`;
}

export async function createSession(
  adventureSlug: AdventureSlug,
  characterContext?: string,
): Promise<{ sessionId: string }> {
  // 1. Create session row
  const { data: session, error: sessionError } = await supabaseAdmin
    .from("sessions")
    .insert({
      title: buildSessionTitle(),
      status: "active",
      character_context: characterContext ?? null,
      adventure_slug: adventureSlug,
      narrative_flags: {},
    })
    .select("id")
    .single();

  if (sessionError) throw new Error(sessionError.message);

  // 2. Generate the opening DM narration
  const openingMessage = await generateOpeningMessage(
    adventureSlug,
    characterContext,
  );

  // 3. Persist as the first assistant message
  const { error: msgError } = await supabaseAdmin.from("messages").insert({
    session_id: session.id,
    role: "assistant",
    content: openingMessage,
  });

  if (msgError) throw new Error(msgError.message);

  return { sessionId: session.id };
}

export async function getSessionById(
  id: string,
): Promise<SessionDetail | null> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("id, title, created_at, status, character_context, narrative_flags")
    .eq("id", id)
    .single();

  // PGRST116 = "no rows returned" — a true 404, not a server error
  if (error?.code === "PGRST116") return null;
  if (error) throw new Error(error.message);

  return data as SessionDetail;
}

export async function listSessions(): Promise<SessionRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select(
      "id, title, created_at, status, journal_entry, narrative_flags, adventure_slug",
    )
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []) as SessionRow[];
}

export async function getMessagesBySessionId(
  sessionId: string,
): Promise<MessageRow[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("id, role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as MessageRow[];
}
