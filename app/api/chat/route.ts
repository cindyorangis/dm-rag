import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, // use service role for server-side
);

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3";

// --- 1. Embed the query ---
async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding;
}

// --- 2. Retrieve relevant chunks from Supabase ---
async function retrieveChunks(
  embedding: number[],
  topK = 6,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: topK,
  });
  if (error) throw new Error(`Chunk retrieval failed: ${error.message}`);
  return (data as { content: string }[]).map((row) => row.content);
}

// --- 3. Build the DM system prompt ---
function buildSystemPrompt(chunks: string[]): string {
  const context = chunks.join("\n\n---\n\n");
  return `You are the Dungeon Master for a solo game of Dungeons & Dragons 5th Edition.
The player is running the adventure "Lost Mine of Phandelver" in the Forgotten Realms.

Your role:
- Narrate the world vividly in second person ("You see...", "Before you stands...")
- Adjudicate rules strictly based on the D&D 5e source material provided
- Track combat using proper initiative, HP, and action economy
- Roleplay NPCs with distinct voices and motivations
- Ask for dice rolls when the rules require them (e.g. "Roll a DC 12 Perception check")
- Never break character unless the player explicitly asks an out-of-game question
- Keep responses focused and paced — don't over-narrate

When the player takes an action:
1. Determine if a roll is required and call for it
2. Describe the outcome narratively
3. Advance the scene naturally

Relevant rules and lore from the source books:
<context>
${context}
</context>

Use the above context to ground your rulings. If the context doesn't cover something, fall back on standard D&D 5e common rulings.`;
}

// --- 4. Stream response from Ollama ---
async function streamFromOllama(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
) {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CHAT_MODEL,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });

  if (!res.ok || !res.body)
    throw new Error(`Ollama chat failed: ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line);
        const token = parsed?.message?.content ?? "";
        if (token) {
          fullContent += token;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ token })}\n\n`),
          );
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Signal end of stream with full content for DB persistence
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ done: true, fullContent })}\n\n`),
  );
  controller.close();
  return fullContent;
}

// --- 5. Persist messages to Supabase ---
async function persistMessages(
  sessionId: string,
  userMessage: string,
  assistantMessage: string,
) {
  await supabase.from("messages").insert([
    { session_id: sessionId, role: "user", content: userMessage },
    { session_id: sessionId, role: "assistant", content: assistantMessage },
  ]);
}

// --- Route Handler ---
export async function POST(req: NextRequest) {
  try {
    const { sessionId, message, history } = await req.json();

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId and message are required" },
        { status: 400 },
      );
    }

    // RAG pipeline
    const embedding = await embedQuery(message);
    const chunks = await retrieveChunks(embedding);
    const systemPrompt = buildSystemPrompt(chunks);

    // Build conversation history for Ollama (last 10 turns to stay within context)
    const recentHistory = (history ?? []).slice(-10);

    const encoder = new TextEncoder();
    let fullContent = "";

    const stream = new ReadableStream({
      async start(controller) {
        try {
          fullContent = await streamFromOllama(
            systemPrompt,
            [...recentHistory, { role: "user", content: message }],
            encoder,
            controller,
          );
          // Persist after stream completes
          await persistMessages(sessionId, message, fullContent);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
