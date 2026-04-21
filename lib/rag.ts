import { supabaseAdmin } from "@/lib/supabase";

// 1. Embed a string using Ollama
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${process.env.OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OLLAMA_EMBED_MODEL, // nomic-embed-text
      prompt: text,
    }),
  });

  if (!res.ok) throw new Error(`Ollama embed failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding as number[];
}

// 2. Retrieve top-k relevant chunks from Supabase via cosine similarity
export async function retrieveChunks(
  query: string,
  matchCount = 6,
): Promise<{ id: string; content: string; similarity: number }[]> {
  const embedding = await embedText(query);

  const { data, error } = await supabaseAdmin.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: matchCount,
  });

  if (error) throw new Error(`Supabase vector search failed: ${error.message}`);
  return data ?? [];
}
