import { NextRequest, NextResponse } from "next/server";
import { SEARCH_DEFAULTS } from "@/lib/search/config";
import {
  mergeHybridResults,
  performKeywordSearch,
  performVectorSearch,
  rerankResults,
} from "@/lib/search/service";
import type { SearchRequest, SearchResponse } from "@/lib/search/types";

export async function POST(request: NextRequest) {
  try {
    const body: SearchRequest = await request.json();
    const {
      query,
      adventureSlug,
      useHybridSearch = SEARCH_DEFAULTS.useHybridSearch,
      vectorWeight = SEARCH_DEFAULTS.vectorWeight,
      keywordWeight = SEARCH_DEFAULTS.keywordWeight,
      topKForReRank = SEARCH_DEFAULTS.topKForReRank,
      rerankTopN = SEARCH_DEFAULTS.rerankTopN,
    } = body;

    if (!query?.trim() || !adventureSlug?.trim()) {
      return NextResponse.json(
        { error: "query and adventureSlug are required" },
        { status: 400 },
      );
    }

    // Stage 1: Fetch candidates
    const [vectorResults, keywordResults] = useHybridSearch
      ? await Promise.all([
          performVectorSearch(query, adventureSlug, topKForReRank),
          performKeywordSearch(query, adventureSlug, topKForReRank),
        ])
      : [await performVectorSearch(query, adventureSlug, topKForReRank), []];

    // Stage 2: Merge
    const merged = useHybridSearch
      ? mergeHybridResults(
          vectorResults,
          keywordResults,
          vectorWeight,
          keywordWeight,
        )
      : vectorResults;

    // Stage 3: Re-rank (only when we have vector results to work with)
    const reranked =
      useHybridSearch && vectorResults.length > 0
        ? await rerankResults(query, merged, rerankTopN)
        : merged;

    const results = reranked
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, rerankTopN);

    const response: SearchResponse = {
      success: true,
      query,
      adventureSlug,
      results,
      metadata: {
        vectorResultsCount: vectorResults.length,
        keywordResultsCount: keywordResults.length,
        hybridSearchEnabled: useHybridSearch,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[search] Unhandled error:", error);
    return NextResponse.json(
      { error: "Search failed", details: String(error) },
      { status: 500 },
    );
  }
}
