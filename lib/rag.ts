import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBED_MODEL = "mxbai-embed-large";

export async function embedText(text: string): Promise<number[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const embedModel =
    process.env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL;

  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: embedModel,
      prompt: text,
    }),
  });

  if (!res.ok) throw new Error(`Ollama embed failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding as number[];
}

export async function retrieveChunks(
  query: string,
  adventureSlug: string,
  matchCount = 6,
): Promise<{ id: string; content: string; similarity: number }[]> {
  let embedding: number[];
  try {
    embedding = await embedText(query);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "RAG embedding unavailable in production, skipping chunks:",
        error,
      );
      return [];
    }
    throw error;
  }

  const { data, error } = await supabaseAdmin.rpc("match_chunks_scoped", {
    query_embedding: embedding,
    adventure_slug: adventureSlug,
    match_count: matchCount,
  });

  if (error) throw new Error(`Supabase vector search failed: ${error.message}`);
  return data ?? [];
}
