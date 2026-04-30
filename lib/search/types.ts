export interface SearchRequest {
  query: string;
  adventureSlug: string;
  useHybridSearch?: boolean;
  vectorWeight?: number;
  keywordWeight?: number;
  topKForReRank?: number;
  rerankTopN?: number;
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

export interface SearchResponse {
  success: true;
  query: string;
  adventureSlug: string;
  results: SearchResult[];
  metadata: {
    vectorResultsCount: number;
    keywordResultsCount: number;
    hybridSearchEnabled: boolean;
  };
}

export interface RerankResult {
  document: string;
  relevance_score: number;
  index: number;
}
