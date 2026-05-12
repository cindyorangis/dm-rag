import { CohereClient } from "cohere-ai";

let _cohereClient: CohereClient | null = null;

function getCohereClient(): CohereClient {
  if (!_cohereClient) {
    const token = process.env.COHERE_API_KEY;
    if (!token) throw new Error("COHERE_API_KEY is not set");
    _cohereClient = new CohereClient({ token });
  }
  return _cohereClient;
}

// ── Qdrant client ──────────────────────────────────────────────────────────

const QDRANT_URL = process.env.QDRANT_URL!;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY!;
const COLLECTION = process.env.QDRANT_COLLECTION ?? "dnd_chunks";

async function qdrantSearch(params: {
  vector: number[];
  filter: Record<string, unknown>;
  limit: number;
  withPayload?: boolean;
}): Promise<QdrantPoint[]> {
  const res = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY,
      },
      body: JSON.stringify({
        vector: params.vector,
        filter: params.filter,
        limit: params.limit,
        with_payload: params.withPayload ?? true,
        with_vector: false,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(`Qdrant search error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.result as QdrantPoint[];
}

async function qdrantKeywordSearch(params: {
  query: string;
  filter: Record<string, unknown>;
  limit: number;
}): Promise<QdrantPoint[]> {
  // Qdrant full-text search via scroll + payload filter on content field.
  // Requires a full-text index on "content" — create once in Qdrant Cloud console:
  //   PUT /collections/dnd_chunks/index
  //   { "field_name": "content", "field_schema": "text" }
  const res = await fetch(
    `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": QDRANT_API_KEY,
      },
      body: JSON.stringify({
        filter: {
          must: [
            ...((params.filter as any).should
              ? [{ should: (params.filter as any).should }]
              : []),
            {
              key: "content",
              match: { text: params.query },
            },
          ],
        },
        limit: params.limit,
        with_payload: true,
        with_vector: false,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Qdrant keyword search error: ${res.status} ${await res.text()}`,
    );
  }

  const data = await res.json();
  // scroll returns { result: { points: [...], next_page_offset } }
  return (data.result?.points ?? []) as QdrantPoint[];
}

interface QdrantPoint {
  id: string;
  score?: number; // present on /search, absent on /scroll
  payload: {
    content: string;
    source: string;
    category: "core" | "adventure";
    adventure_slug: string;
    chunk_index: number;
  };
}

/**
 * Qdrant filter scoped to core rulebooks OR the active adventure module.
 * Mirrors the original `match_chunks_scoped` Supabase RPC behaviour.
 */
function scopedFilter(adventureSlug: string): Record<string, unknown> {
  return {
    should: [
      { key: "category", match: { value: "core" } },
      {
        must: [
          { key: "category", match: { value: "adventure" } },
          { key: "adventure_slug", match: { value: adventureSlug } },
        ],
      },
    ],
  };
}

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

export type RetrievalConfidenceLevel = "high" | "medium" | "low";

export interface RetrievalConfidence {
  score: number;
  level: RetrievalConfidenceLevel;
  reason: string;
  chunkCount: number;
  requestedChunkCount: number;
  avgSimilarity: number | null;
  maxSimilarity: number | null;
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
  const response = await getCohereClient().embed({
    texts: [text],
    model: "embed-english-v3.0",
    inputType: "search_query",
    embeddingTypes: ["float"],
  });

  const embeddings = response.embeddings;
  const floatEmbeddings = Array.isArray(embeddings)
    ? embeddings
    : embeddings.float;
  const embedding = floatEmbeddings?.[0];
  if (!embedding) throw new Error("Cohere embed returned no embedding");
  return embedding;
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

  const results = await qdrantSearch({
    vector: embedding,
    filter: scopedFilter(adventureSlug),
    limit: matchCount,
  });

  return results.map((r) => ({
    id: String(r.id),
    content: r.payload.content,
    similarity: r.score ?? 0,
  }));
}

export async function calculateKeywordScores(
  query: string,
  adventureSlug: string,
  matchCount: number,
): Promise<KeywordSearchResult[]> {
  try {
    const results = await qdrantKeywordSearch({
      query,
      filter: scopedFilter(adventureSlug),
      limit: matchCount,
    });

    // Scroll results have no relevance score — assign 1.0 since they already
    // passed the text match filter. Cohere re-ranking differentiates them downstream.
    return results.map((r) => ({
      id: String(r.id),
      score: 1.0,
      content: r.payload.content,
    }));
  } catch (error) {
    console.warn("Keyword search unavailable, using vector fallback:", error);
    return [];
  }
}

// ── Retrieval ──────────────────────────────────────────────────────────────

/**
 * Primary retrieval function. Runs hybrid vector + keyword search,
 * combines scores with configurable weights, and returns ranked chunks.
 *
 * All splitting happens at ingestion time (scripts/ingest.py +
 * scripts/dnd_splitters.py). This function only reads pre-chunked rows
 * from Qdrant.
 */
export async function retrieveChunks(
  query: string,
  adventureSlug: string,
  matchCount = readMaxChunks(),
  config: RAGRetrievalConfig = {},
): Promise<RAGChunk[]> {
  const {
    useHybridSearch = true,
    vectorWeight = 0.7,
    keywordWeight = 0.3,
    topKForReRank = 20,
  } = config;
  const totalWeight = vectorWeight + keywordWeight;
  const safeVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.7;
  const safeKeywordWeight = totalWeight > 0 ? keywordWeight / totalWeight : 0.3;

  let vectorResults: VectorSearchResult[] = [];
  let keywordResults: KeywordSearchResult[] = [];

  if (useHybridSearch) {
    const [vectorAttempt, keywordAttempt] = await Promise.allSettled([
      performVectorSearch(query, adventureSlug, topKForReRank),
      calculateKeywordScores(query, adventureSlug, topKForReRank),
    ]);

    if (vectorAttempt.status === "fulfilled") {
      vectorResults = vectorAttempt.value;
    } else if (process.env.NODE_ENV === "production") {
      console.warn(
        "Hybrid vector search failed, continuing with keyword-only:",
        vectorAttempt.reason,
      );
    } else {
      throw vectorAttempt.reason;
    }

    if (keywordAttempt.status === "fulfilled") {
      keywordResults = keywordAttempt.value;
    } else {
      console.warn(
        "Hybrid keyword search failed, continuing with vector-only:",
        keywordAttempt.reason,
      );
    }
  } else {
    vectorResults = await performVectorSearch(
      query,
      adventureSlug,
      topKForReRank,
    );
  }

  // Explicit fallback: if hybrid produced nothing, try vector-only once.
  if (
    useHybridSearch &&
    vectorResults.length === 0 &&
    keywordResults.length === 0
  ) {
    vectorResults = await performVectorSearch(
      query,
      adventureSlug,
      topKForReRank,
    );
  }

  if (vectorResults.length === 0 && keywordResults.length === 0) {
    return [];
  }

  const normalizedVectorScores = normalizeByMinMax(
    vectorResults.map((r) => r.similarity),
  );
  const maxKeywordScore =
    keywordResults.length > 0
      ? Math.max(...keywordResults.map((r) => Math.max(0, r.score)))
      : 0;

  // Merge vector and keyword results, boosting chunks that appear in both
  const combinedMap = new Map<string, CombinedResult>();

  for (const [idx, result] of vectorResults.entries()) {
    combinedMap.set(result.id, {
      id: result.id,
      vectorScore: normalizedVectorScores[idx] ?? 0,
      keywordScore: 0,
      content: result.content,
    });
  }

  for (const result of keywordResults) {
    const normalizedKeywordScore =
      maxKeywordScore > 0 ? Math.max(0, result.score) / maxKeywordScore : 0;

    const existing = combinedMap.get(result.id);
    if (!existing) {
      combinedMap.set(result.id, {
        id: result.id,
        vectorScore: 0,
        keywordScore: normalizedKeywordScore,
        content: result.content,
      });
    } else if (normalizedKeywordScore > 0.3) {
      const boost = 1.2;
      combinedMap.set(result.id, {
        ...existing,
        vectorScore: existing.vectorScore,
        keywordScore: normalizedKeywordScore * boost,
      });
    }
  }

  const blended = Array.from(combinedMap.values())
    .map((item) => ({
      id: item.id,
      content: item.content,
      similarity:
        item.vectorScore * safeVectorWeight +
        item.keywordScore * safeKeywordWeight,
      section: item.content.split("\n")[0] || "General",
      adventureId: adventureSlug,
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const thresholdedCandidates = applySimilarityThreshold(
    blended,
    readSimilarityThreshold(),
  );

  const reranked = await rerankResults(
    query,
    thresholdedCandidates.slice(0, Math.max(matchCount, topKForReRank)),
    matchCount,
  );

  return reranked.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    similarity: chunk.similarity,
    section: chunk.section,
    adventureId: chunk.adventureId,
  }));
}

// ── Re-ranking ─────────────────────────────────────────────────────────────

/**
 * Re-ranks a result set using Cohere rerank-english-v3.0.
 * Falls back to blended score order if Cohere is unavailable.
 */
export async function rerankResults(
  query: string,
  results: RAGChunk[],
  topN = 3,
): Promise<RerankResult[]> {
  if (results.length === 0) return [];

  try {
    const response = await getCohereClient().rerank({
      model: "rerank-english-v3.0",
      query,
      documents: results.map((r) => r.content),
      topN,
    });

    const mapped = response.results
      .map((item) => {
        const original = results[item.index];
        if (!original) return null;
        return {
          ...original,
          score: item.relevanceScore,
          similarity: item.relevanceScore,
        } satisfies RerankResult;
      })
      .filter((item): item is RerankResult => item !== null);

    if (mapped.length > 0) return mapped;
  } catch (error) {
    console.warn("Re-ranking unavailable, using blended score order:", error);
  }

  return results
    .slice()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN)
    .map((r) => ({ ...r, score: r.similarity }));
}

/** Retrieve then re-rank in one call. */
export async function retrieveChunksWithReRank(
  query: string,
  adventureSlug: string,
  initialMatchCount = 10,
  finalMatchCount = 3,
  config: RAGRetrievalConfig = {},
): Promise<RerankResult[]> {
  const initial = await retrieveChunks(query, adventureSlug, finalMatchCount, {
    ...config,
    topKForReRank: initialMatchCount,
  });
  return initial.map((r) => ({ ...r, score: r.similarity }));
}

export function calculateRetrievalConfidence(params: {
  similarities: number[];
  requestedChunkCount?: number;
  minSimilarityThreshold?: number;
}): RetrievalConfidence {
  const similarities = params.similarities.filter((value) =>
    Number.isFinite(value),
  );
  const requestedChunkCount = Math.max(
    1,
    params.requestedChunkCount ?? readMaxChunks(),
  );
  const threshold = params.minSimilarityThreshold ?? readSimilarityThreshold();

  if (similarities.length === 0) {
    return {
      score: 0,
      level: "low",
      reason: "No relevant retrieval matches were returned.",
      chunkCount: 0,
      requestedChunkCount,
      avgSimilarity: null,
      maxSimilarity: null,
    };
  }

  const chunkCount = similarities.length;
  const avgSimilarity = average(similarities);
  const maxSimilarity = Math.max(...similarities);
  const aboveThreshold = similarities.filter((s) => s >= threshold).length;
  const hitRate = Math.min(1, chunkCount / requestedChunkCount);
  const thresholdRate = aboveThreshold / chunkCount;

  const score = round(
    avgSimilarity * 0.45 +
      maxSimilarity * 0.25 +
      hitRate * 0.15 +
      thresholdRate * 0.15,
  );

  const lowThreshold = readBoundedFloatEnv(
    "RAG_CONFIDENCE_LOW_THRESHOLD",
    0.38,
  );
  const highThreshold = readBoundedFloatEnv(
    "RAG_CONFIDENCE_HIGH_THRESHOLD",
    0.68,
  );

  const level: RetrievalConfidenceLevel =
    score >= highThreshold ? "high" : score <= lowThreshold ? "low" : "medium";

  const reason =
    level === "high"
      ? "Retrieved chunks are strong and consistent with the query."
      : level === "medium"
        ? "Retrieved context is partial; keep claims grounded to cited details."
        : "Retrieved context is weak; ask a clarifying question before asserting specific lore/rules.";

  return {
    score,
    level,
    reason,
    chunkCount,
    requestedChunkCount,
    avgSimilarity: round(avgSimilarity),
    maxSimilarity: round(maxSimilarity),
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function normalizeByMinMax(values: number[]): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((value) => (value - min) / (max - min));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readMaxChunks(): number {
  const raw = process.env.RAG_MAX_CHUNKS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) {
    return parsed;
  }
  return 4;
}

function readSimilarityThreshold(): number {
  const raw = process.env.RAG_MIN_SIMILARITY;
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  return 0.2;
}

function readBoundedFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
    return parsed;
  }
  return fallback;
}

function applySimilarityThreshold(
  chunks: RAGChunk[],
  threshold: number,
): RAGChunk[] {
  if (chunks.length <= 1 || threshold <= 0) return chunks;
  const filtered = chunks.filter((chunk) => chunk.similarity >= threshold);
  return filtered.length > 0 ? filtered : chunks.slice(0, 1);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

// ── Fallbacks ──────────────────────────────────────────────────────────────

/** Vector-only retrieval — legacy fallback. */
export async function retrieveChunksVectorOnly(
  query: string,
  adventureSlug: string,
  matchCount = readMaxChunks(),
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
  matchCount = readMaxChunks(),
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
