export const SEARCH_DEFAULTS = {
  useHybridSearch: true,
  vectorWeight: 0.7,
  keywordWeight: 0.3,
  topKForReRank: 10,
  rerankTopN: 3,
} as const;

export const OLLAMA_DEFAULTS = {
  baseUrl: "http://localhost:11434",
  embedModel: "mxbai-embed-large",
  rerankModel: "bge-reranker-v2-m3",
} as const;

export function getOllamaConfig() {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? OLLAMA_DEFAULTS.baseUrl,
    embedModel: process.env.OLLAMA_EMBED_MODEL ?? OLLAMA_DEFAULTS.embedModel,
    rerankModel: process.env.OLLAMA_RERANK_MODEL ?? OLLAMA_DEFAULTS.rerankModel,
  };
}
