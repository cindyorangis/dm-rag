import { supabaseAdmin } from "@/lib/supabase";
import { getOllamaConfig } from "./config";
import type { RerankResult, SearchResult } from "@/lib/search/types";

// ── Vector search ─────────────────────────────────────────────────────────────

export async function performVectorSearch(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<SearchResult[]> {
  const { baseUrl, embedModel } = getOllamaConfig();

  let embedding: number[];

  try {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embedModel, prompt: query }),
    });

    if (!res.ok) throw new Error(`Embedding request failed: ${res.statusText}`);

    const data = await res.json();
    embedding = data.embedding as number[];
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[search] Embedding unavailable, skipping vector search:",
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

  if (error) throw new Error(`Vector search failed: ${error.message}`);

  return (data as SearchResult[]) ?? [];
}

// ── Keyword search ────────────────────────────────────────────────────────────

export async function performKeywordSearch(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<SearchResult[]> {
  const { data, error } = await supabaseAdmin.rpc(
    "match_chunks_scoped_keywords",
    {
      query_embedding: null,
      adventure_slug: adventureSlug,
      query_text: query,
      match_count: matchCount,
    },
  );

  if (error) {
    console.warn("[search] Keyword search unavailable, skipping:", error);
    return [];
  }

  return (data as SearchResult[]) ?? [];
}

// ── Hybrid merge ──────────────────────────────────────────────────────────────

const KEYWORD_BOOST_THRESHOLD = 0.3;
const KEYWORD_BOOST_MULTIPLIER = 1.2;

export function mergeHybridResults(
  vectorResults: SearchResult[],
  keywordResults: SearchResult[],
  vectorWeight: number,
  keywordWeight: number,
): SearchResult[] {
  const map = new Map<
    string,
    { result: SearchResult; vectorScore: number; keywordScore: number }
  >();

  for (const r of vectorResults) {
    map.set(r.id, {
      result: r,
      vectorScore: Math.min(r.similarity, 1.0),
      keywordScore: 0,
    });
  }

  for (const r of keywordResults) {
    const existing = map.get(r.id);
    if (!existing) {
      map.set(r.id, { result: r, vectorScore: 0, keywordScore: r.similarity });
    } else if (r.similarity > KEYWORD_BOOST_THRESHOLD) {
      // Keyword match on a result already found via vector — boost it
      map.set(r.id, {
        result: existing.result,
        vectorScore: existing.vectorScore,
        keywordScore: r.similarity * KEYWORD_BOOST_MULTIPLIER,
      });
    }
  }

  return Array.from(map.values()).map(
    ({ result, vectorScore, keywordScore }) => ({
      ...result,
      similarity: vectorScore * vectorWeight + keywordScore * keywordWeight,
      metadata: { vectorScore, keywordScore },
    }),
  );
}

// ── Re-ranking ────────────────────────────────────────────────────────────────

export async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number,
): Promise<SearchResult[]> {
  const { baseUrl, rerankModel } = getOllamaConfig();

  try {
    const res = await fetch(`${baseUrl}/api/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: rerankModel,
        query,
        top_n: topN,
        documents: results.map((r) => r.content),
      }),
    });

    if (!res.ok) throw new Error(`Rerank request failed: ${res.statusText}`);

    const data = await res.json();
    const rerankItems: RerankResult[] = data.results ?? [];

    // Map back to original results by index so we preserve all fields
    return rerankItems.map((item) => {
      const original = results[item.index] ?? results[0];
      return {
        ...original,
        similarity: Math.abs(item.relevance_score),
        metadata: {
          ...original.metadata,
          rerankScore: item.relevance_score,
        },
      };
    });
  } catch (error) {
    console.warn(
      "[search] Re-ranking failed, falling back to score order:",
      error,
    );
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN)
      .map((r) => ({
        ...r,
        metadata: { ...r.metadata, rerankScore: r.similarity },
      }));
  }
}
