import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBED_MODEL = "mxbai-embed-large";

export interface RAGRetrievalConfig {
  // Hybrid search configuration
  useHybridSearch?: boolean;
  // Weights for combining vector and keyword scores (0.0-1.0)
  vectorWeight?: number;
  keywordWeight?: number;
  // Re-ranking configuration
  topKForReRank?: number;
  // D&D-specific configuration
  enableSpellBoost?: boolean;
  enableItemBoost?: boolean;
}

export interface RAGChunk {
  id: string;
  content: string;
  similarity: number;
  section: string;
  adventureId: string;
}

// Vector search result type
interface VectorSearchResult {
  id: string;
  content: string;
  similarity: number;
}

// Keyword search result type
interface KeywordSearchResult {
  id: string;
  score: number;
  content: string;
}

// Combined result type for hybrid search
interface CombinedResult {
  id: string;
  vectorScore: number;
  keywordScore: number;
  content: string;
}

// Re-ranking result type
interface RerankResult {
  id: string;
  content: string;
  score: number;
  similarity: number;
  section: string;
  adventureId: string;
}

// Perform vector search using embeddings
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

// Calculate keyword scores using Supabase full-text search
// This implements a basic BM25-like approach for keyword matching
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

// Advanced RAG retrieval with hybrid search combining vector and keyword approaches
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

  // Perform both searches if hybrid search is enabled
  if (useHybridSearch) {
    try {
      vectorResults = await performVectorSearch(
        query,
        adventureSlug,
        topKForReRank,
      );
      keywordResults = await calculateKeywordScores(
        query,
        adventureSlug,
        topKForReRank,
      );
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        console.warn(
          "Hybrid search unavailable, falling back to vector-only:",
          error,
        );
        vectorResults = [];
        keywordResults = [];
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

  // Combine results using weighted score
  const combinedMap = new Map<string, CombinedResult>();

  // Add vector results
  vectorResults.forEach((result) => {
    const existing = combinedMap.get(result.id);
    if (!existing) {
      combinedMap.set(result.id, {
        id: result.id, // <-- Ensure id is set
        vectorScore: Math.min(result.similarity, 1.0),
        keywordScore: 0,
        content: result.content,
      });
    }
  });

  // Add keyword results (use exact IDs)
  keywordResults.forEach((result) => {
    const existing = combinedMap.get(result.id);
    if (!existing) {
      combinedMap.set(result.id, {
        id: result.id, // <-- Ensure id is set
        vectorScore: 0,
        keywordScore: result.score,
        content: result.content,
      });
    } else {
      // Boost existing entry if keyword score is good
      if (result.score > 0.3) {
        const boost = 1.2;
        const newVectorScore =
          existing.vectorScore * vectorWeight +
          result.score * keywordWeight * boost;
        combinedMap.set(result.id, {
          id: result.id, // <-- Ensure id is preserved
          vectorScore: newVectorScore,
          keywordScore: existing.vectorScore,
          content: existing.content,
        });
      }
    }
  });

  // Convert to array and sort
  const sortedResults = Array.from(combinedMap.values())
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

  return sortedResults;
}

// Re-rank results using cross-encoder (simulated for TypeScript)
// In production, you'd use FlashRank or similar
export async function rerankResults(
  query: string,
  results: RAGChunk[],
  topN: number = 3,
): Promise<RerankResult[]> {
  console.log(`🔄 Re-ranking ${results.length} results...`);

  // For now, we'll use a simple scoring approach
  // In production, integrate with FlashRank or similar
  const reranked = results.map((result) => ({
    id: result.id,
    content: result.content,
    score: result.similarity, // Placeholder - would use cross-encoder score
    similarity: result.similarity,
    section: result.section,
    adventureId: result.adventureId,
  }));

  // Sort by score and take top N
  const topResults = reranked.sort((a, b) => b.score - a.score).slice(0, topN);

  console.log(
    `✅ Re-ranking complete. Top ${topResults.length} results selected.`,
  );
  return topResults;
}

// Advanced retrieval with re-ranking
export async function retrieveChunksWithReRank(
  query: string,
  adventureSlug: string,
  initialMatchCount = 10,
  finalMatchCount = 3,
  config: RAGRetrievalConfig = {},
): Promise<RerankResult[]> {
  // Stage 1: Retrieve top candidates
  const initialResults = await retrieveChunks(
    query,
    adventureSlug,
    initialMatchCount,
    config,
  );

  // Stage 2: Re-rank results
  const rerankedResults = await rerankResults(
    query,
    initialResults,
    finalMatchCount,
  );

  return rerankedResults;
}

// Fallback: Vector-only search (legacy behavior)
export async function retrieveChunksVectorOnly(
  query: string,
  adventureSlug: string,
  matchCount = 6,
): Promise<RAGChunk[]> {
  const vectorResults = await performVectorSearch(
    query,
    adventureSlug,
    matchCount,
  );
  return vectorResults.map((chunk) => ({
    ...chunk,
    section: chunk.content.split("\n")[0] || "General",
    adventureId: adventureSlug,
  }));
}

// Fallback: Keyword-only search (useful for proper nouns, spell names)
export async function retrieveChunksKeywordOnly(
  query: string,
  adventureSlug: string,
  matchCount = 6,
): Promise<RAGChunk[]> {
  const keywordResults = await calculateKeywordScores(
    query,
    adventureSlug,
    matchCount,
  );
  return keywordResults
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
