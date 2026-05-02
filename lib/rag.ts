import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBED_MODEL = "mxbai-embed-large";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RAGRetrievalConfig {
  /** Enable hybrid vector + keyword search. Default: true */
  useHybridSearch?: boolean;
  /** Weight applied to vector similarity score (0.0–1.0). Default: 0.7 */
  vectorWeight?: number;
  /** Weight applied to keyword match score (0.0–1.0). Default: 0.3 */
  keywordWeight?: number;
  /** How many candidates to fetch before re-ranking. Default: 20 */
  topKForReRank?: number;
}

export interface RAGChunk {
  id: string;
  content: string;
  similarity: number;
  section: string;
  adventureId: string;
}

interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
}

interface KeywordSearchResult {
  id: string;
  score: number;
  content: string;
}

interface CombinedResult {
  id: string;
  vectorScore: number;
  keywordScore: number;
  content: string;
}

interface RerankResult {
  id: string;
  content: string;
  score: number;
  similarity: number;
  section: string;
  adventureId: string;
}

// ── Embedding ──────────────────────────────────────────────────────────────

export async function embedText(text: string): Promise<number[]> {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const embedModel =
    process.env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL;

  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, prompt: text }),
  });

  if (!res.ok) throw new Error(`Ollama embed failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding as number[];
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function performVectorSearch(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<VectorSearchResult[]> {
  let embedding: number[];
  try {
    embedding = await embedText(query);
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.warn("Embedding unavailable, skipping vector search:", error);
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
  return (data as VectorSearchResult[]) || [];
}

export async function calculateKeywordScores(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<KeywordSearchResult[]> {
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
    console.warn("Keyword search unavailable, using vector fallback:", error);
    return [];
  }

  return (data as KeywordSearchResult[]) || [];
}

// ── Retrieval ──────────────────────────────────────────────────────────────

/**
 * Primary retrieval function. Runs hybrid vector + keyword search,
 * combines scores with configurable weights, and returns ranked chunks.
 *
 * All splitting happens at ingestion time (scripts/ingest.py +
 * scripts/dnd_splitters.py). This function only reads pre-chunked rows
 * from Supabase.
 */
export async function retrieveChunks(
  query: string,
  adventureSlug: string,
  matchCount = 6,
  config: RAGRetrievalConfig = {},
): Promise<RAGChunk[]> {
  const {
    useHybridSearch = true,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    topKForReRank = 20,
  } = config;

  let vectorResults: VectorSearchResult[] = [];
  let keywordResults: KeywordSearchResult[] = [];

  if (useHybridSearch) {
    try {
      [vectorResults, keywordResults] = await Promise.all([
        performVectorSearch(query, adventureSlug, topKForReRank),
        calculateKeywordScores(query, adventureSlug, topKForReRank),
      ]);
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "Hybrid search unavailable, falling back to vector-only:",
          error,
        );
      } else {
        throw error;
      }
    }
  } else {
    vectorResults = await performVectorSearch(
      query,
      adventureSlug,
      topKForReRank,
    );
  }

  // Merge vector and keyword results, boosting chunks that appear in both
  const combinedMap = new Map<string, CombinedResult>();

  for (const result of vectorResults) {
    combinedMap.set(result.id, {
      id: result.id,
      vectorScore: Math.min(result.similarity, 1.0),
      keywordScore: 0,
      content: result.content,
    });
  }

  for (const result of keywordResults) {
    const existing = combinedMap.get(result.id);
    if (!existing) {
      combinedMap.set(result.id, {
        id: result.id,
        vectorScore: 0,
        keywordScore: result.score,
        content: result.content,
      });
    } else if (result.score > 0.3) {
      const boost = 1.2;
      combinedMap.set(result.id, {
        ...existing,
        vectorScore: existing.vectorScore,
        keywordScore: result.score * boost,
      });
    }
  }

  return Array.from(combinedMap.values())
    .map((item) => ({
      id: item.id,
      content: item.content,
      similarity:
        item.vectorScore * vectorWeight + item.keywordScore * keywordWeight,
      section: item.content.split("\n")[0] || "General",
      adventureId: adventureSlug,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
}

// ── Re-ranking ─────────────────────────────────────────────────────────────

/**
 * Re-ranks a result set. Currently uses the existing similarity score as
 * a proxy. Replace with a cross-encoder (e.g. FlashRank) for production.
 */
export async function rerankResults(
  query: string,
  results: RAGChunk[],
  topN = 3,
): Promise<RerankResult[]> {
  return results
    .map((r) => ({ ...r, score: r.similarity }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/** Retrieve then re-rank in one call. */
export async function retrieveChunksWithReRank(
  query: string,
  adventureSlug: string,
  initialMatchCount = 10,
  finalMatchCount = 3,
  config: RAGRetrievalConfig = {},
): Promise<RerankResult[]> {
  const initial = await retrieveChunks(
    query,
    adventureSlug,
    initialMatchCount,
    config,
  );
  return rerankResults(query, initial, finalMatchCount);
}

// ── Fallbacks ──────────────────────────────────────────────────────────────

/** Vector-only retrieval — legacy fallback. */
export async function retrieveChunksVectorOnly(
  query: string,
  adventureSlug: string,
  matchCount = 6,
): Promise<RAGChunk[]> {
  const results = await performVectorSearch(query, adventureSlug, matchCount);
  return results.map((chunk) => ({
    ...chunk,
    section: chunk.content.split("\n")[0] || "General",
    adventureId: adventureSlug,
  }));
}

/** Keyword-only retrieval — useful for proper nouns, spell/monster names. */
export async function retrieveChunksKeywordOnly(
  query: string,
  adventureSlug: string,
  matchCount = 6,
): Promise<RAGChunk[]> {
  const results = await calculateKeywordScores(
    query,
    adventureSlug,
    matchCount,
  );
  return results
    .map((chunk) => ({
      id: chunk.id,
      content: chunk.content,
      similarity: chunk.score,
      section: chunk.content.split("\n")[0] || "General",
      adventureId: adventureSlug,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
}
