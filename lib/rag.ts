import { supabaseAdmin } from "@/lib/supabase";
import { Document } from "@langchain/core/documents";
import { DndTextSplitter } from "./text-splitters/dnd-splitter";
import {
  parseDndTables,
  createDocumentFromTable,
} from "./text-splitters/table-splitters";

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

export class DnDRAGPipeline {
  private splitter: DndTextSplitter;
  private tableParser: typeof parseDndTables;

  constructor(chunkSize: number = 1000) {
    this.splitter = new DndTextSplitter(chunkSize);
    this.tableParser = parseDndTables;
  }

  async splitDndText(text: string, source: string): Promise<Document[]> {
    const documents: Document[] = [];

    // 1. Try to extract tables first
    const tables = this.tableParser(text, source);

    for (const table of tables) {
      const doc = createDocumentFromTable(table);
      documents.push(doc);
    }

    // 2. For remaining text, use custom splitter
    const remainingText = text
      .replace(/\|.*\|/g, " | ") // Break tables to not interfere with text splitting
      .replace(/#.*?#\s*\n/g, "\n"); // Break headers

    // splitText is async — must await before iterating
    const chunks = await this.splitter.splitText(remainingText);

    for (const chunk of chunks) {
      documents.push(
        new Document({
          pageContent: chunk,
          metadata: {
            source,
            chunkType: "text",
          },
        }),
      );
    }

    return documents;
  }

  async splitDndPdf(pdfContent: string, fileName: string): Promise<Document[]> {
    return await this.splitDndText(pdfContent, fileName);
  }
}

export default DnDRAGPipeline;

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

  // Combine results using weighted scores
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
      // Boost entries that appear in both result sets
      const boost = 1.2;
      combinedMap.set(result.id, {
        ...existing,
        vectorScore:
          existing.vectorScore * vectorWeight +
          result.score * keywordWeight * boost,
        keywordScore: result.score,
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

// Re-rank results using cross-encoder (simulated — replace with FlashRank in production)
export async function rerankResults(
  query: string,
  results: RAGChunk[],
  topN: number = 3,
): Promise<RerankResult[]> {
  console.log(`🔄 Re-ranking ${results.length} results...`);

  const reranked = results
    .map((result) => ({
      id: result.id,
      content: result.content,
      score: result.similarity,
      similarity: result.similarity,
      section: result.section,
      adventureId: result.adventureId,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  console.log(
    `✅ Re-ranking complete. Top ${reranked.length} results selected.`,
  );
  return reranked;
}

// Advanced retrieval with re-ranking
export async function retrieveChunksWithReRank(
  query: string,
  adventureSlug: string,
  initialMatchCount = 10,
  finalMatchCount = 3,
  config: RAGRetrievalConfig = {},
): Promise<RerankResult[]> {
  const initialResults = await retrieveChunks(
    query,
    adventureSlug,
    initialMatchCount,
    config,
  );
  return rerankResults(query, initialResults, finalMatchCount);
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
    body: JSON.stringify({ model: embedModel, prompt: text }),
  });

  if (!res.ok) throw new Error(`Ollama embed failed: ${res.statusText}`);
  const data = await res.json();
  return data.embedding as number[];
}
