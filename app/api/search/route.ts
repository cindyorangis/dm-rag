import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_EMBED_MODEL = "mxbai-embed-large";
const DEFAULT_OLLAMA_RERANK_MODEL = "bge-reranker-v2-m3";

export interface SearchRequest {
  query: string;
  adventureSlug: string;
  useHybridSearch?: boolean;
  vectorWeight?: number;
  keywordWeight?: number;
  topKForReRank?: number;
  rerankTopN?: number;
  enableSpellBoost?: boolean;
  enableItemBoost?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  similarity: number;
  section: string;
  adventureId: string;
  metadata?: {
    vectorScore?: number;
    keywordScore?: number;
    rerankScore?: number;
  };
}

// Perform vector search using embeddings
async function performVectorSearch(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<SearchResult[]> {
  let embedding: number[];
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
    const embedModel =
      process.env.OLLAMA_EMBED_MODEL || DEFAULT_OLLAMA_EMBED_MODEL;

    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embedModel,
        prompt: query,
      }),
    });

    if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);
    const data = await res.json();
    embedding = data.embedding as number[];
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      console.warn("Embedding unavailable, skipping vector search:", error);
      return [];
    }
    throw error;
  }

  const { data: vectorData, error: vectorError } = await supabaseAdmin.rpc(
    "match_chunks_scoped",
    {
      query_embedding: embedding,
      adventure_slug: adventureSlug,
      match_count: matchCount,
    },
  );

  if (vectorError)
    throw new Error(`Vector search failed: ${vectorError.message}`);

  return (vectorData as SearchResult[]) || [];
}

// Calculate keyword scores using Supabase full-text search
async function calculateKeywordScores(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<SearchResult[]> {
  const { data: keywordData, error: keywordError } = await supabaseAdmin.rpc(
    "match_chunks_scoped_keywords",
    {
      query_embedding: null,
      adventure_slug: adventureSlug,
      query_text: query,
      match_count: matchCount,
    },
  );

  if (keywordError) {
    console.warn(
      "Keyword search unavailable, using vector fallback:",
      keywordError,
    );
    return [];
  }

  return (keywordData as SearchResult[]) || [];
}

// Re-rank results using Ollama cross-encoder
async function rerankResults(
  query: string,
  results: SearchResult[],
  topN: number,
): Promise<SearchResult[]> {
  console.log(
    `🔄 Re-ranking ${results.length} results with Ollama cross-encoder. ..`,
  );

  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const rerankModel =
    process.env.OLLAMA_RERANK_MODEL || DEFAULT_OLLAMA_RERANK_MODEL;

  const rerankRequest = {
    model: rerankModel,
    query: query,
    top_n: topN,
    documents: results.map((r) => r.content),
  };

  try {
    const res = await fetch(`${baseUrl}/api/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rerankRequest),
    });

    if (!res.ok) {
      throw new Error(`Rerank API failed: ${res.statusText}`);
    }

    const data = await res.json();

    console.log(`✅ Rerank results received:`, data.results?.length || 0);

    // Map results to our format
    const rerankedResults = (data.results || []).map((result: any) => ({
      id: result.document.split(" ").slice(0, 3).join(" ") + ". ..",
      content: result.document,
      score: result.relevance_score,
      similarity: Math.abs(result.relevance_score),
      section: result.document.split("\n")[0] || "General",
      adventureId: "unknown",
      metadata: {
        rerankScore: result.relevance_score,
      },
    }));

    console.log(
      `✅ Re-ranking complete. Top ${rerankedResults.length} results selected.`,
    );
    return rerankedResults;
  } catch (error) {
    console.warn(
      "❌ Reranking failed, falling back to original results:",
      error,
    );
    // Return original results sorted by similarity
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN)
      .map((r) => ({
        ...r,
        metadata: {
          ...r.metadata,
          rerankScore: r.similarity,
        },
      }));
  }
}

// Main search handler
export async function POST(request: NextRequest) {
  try {
    const body: SearchRequest = await request.json();
    const {
      query,
      adventureSlug,
      useHybridSearch = true,
      vectorWeight = 0.7,
      keywordWeight = 0.3,
      topKForReRank = 10,
      rerankTopN = 3,
    } = body;

    if (!query || !adventureSlug) {
      return NextResponse.json(
        { error: "Missing query or adventureSlug" },
        { status: 400 },
      );
    }

    console.log(`🔍 Searching for: "${query}" in adventure: ${adventureSlug}`);

    let vectorResults: SearchResult[] = [];
    let keywordResults: SearchResult[] = [];

    // Stage 1: Perform searches
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

    // Stage 2: Combine results using weighted score
    const combinedMap = new Map<
      string,
      { id: string; vectorScore: number; keywordScore: number; content: string }
    >();

    // Add vector results
    vectorResults.forEach((result) => {
      const existing = combinedMap.get(result.id);
      if (!existing) {
        combinedMap.set(result.id, {
          id: result.id,
          vectorScore: Math.min(result.similarity, 1.0),
          keywordScore: 0,
          content: result.content,
        });
      }
    });

    // Add keyword results
    keywordResults.forEach((result) => {
      const existing = combinedMap.get(result.id);
      if (!existing) {
        combinedMap.set(result.id, {
          id: result.id,
          vectorScore: 0,
          keywordScore: result.similarity,
          content: result.content,
        });
      } else {
        // Boost existing entry if keyword score is good
        if (result.similarity > 0.3) {
          const boost = 1.2;
          const newVectorScore =
            existing.vectorScore * vectorWeight +
            result.similarity * keywordWeight * boost;
          combinedMap.set(result.id, {
            id: result.id,
            vectorScore: newVectorScore,
            keywordScore: existing.vectorScore,
            content: existing.content,
          });
        }
      }
    });

    // Convert to array and sort
    const combinedResults = Array.from(combinedMap.values()).map((item) => ({
      id: item.id,
      content: item.content,
      similarity:
        item.vectorScore * vectorWeight + item.keywordScore * keywordWeight,
      section: item.content.split("\n")[0] || "General",
      adventureId: adventureSlug,
      metadata: {
        vectorScore: item.vectorScore,
        keywordScore: item.keywordScore,
      },
    }));

    // Stage 3: Re-rank if enabled
    let finalResults: SearchResult[] = combinedResults;
    if (useHybridSearch && vectorResults.length > 0) {
      finalResults = await rerankResults(query, combinedResults, rerankTopN);
    }

    // Sort by similarity and take top results
    finalResults = finalResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, rerankTopN);

    console.log(`✅ Search complete. Found ${finalResults.length} results.`);

    return NextResponse.json({
      success: true,
      query,
      adventureSlug,
      results: finalResults,
      metadata: {
        vectorResultsCount: vectorResults.length,
        keywordResultsCount: keywordResults.length,
        hybridSearchEnabled: useHybridSearch,
      },
    });
  } catch (error) {
    console.error("❌ Search failed:", error);
    return NextResponse.json(
      { error: "Search failed", details: String(error) },
      { status: 500 },
    );
  }
}
