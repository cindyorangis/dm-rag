import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cohereModule from "cohere-ai";

vi.stubEnv("QDRANT_URL", "http://mock-qdrant");
vi.stubEnv("QDRANT_API_KEY", "mock-key");
vi.stubEnv("OLLAMA_BASE_URL", "http://mock-ollama");

import {
  embedText,
  performVectorSearch,
  retrieveChunks,
  rerankResults,
  calculateRetrievalConfidence,
  type RAGChunk,
} from "./rag";

type CohereMockModule = {
  __mock: {
    embed: ReturnType<typeof vi.fn>;
    rerank: ReturnType<typeof vi.fn>;
  };
};

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock Cohere (Used for Reranking only)
vi.mock("cohere-ai", () => {
  const mockRerank = vi.fn();
  return {
    CohereClient: class {
      rerank = mockRerank;
    },
    __mock: { rerank: mockRerank },
  };
});

// Mock Global Fetch (Used for Ollama and Qdrant)
const mockFetch = vi.spyOn(global, "fetch");

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_EMBEDDING = [0.1, 0.2, 0.3];
const MOCK_ADVENTURE_SLUG = "lost-mine-of-phandelver";

const MOCK_QDRANT_RESPONSE = {
  result: [
    {
      id: "chunk-1",
      score: 0.92,
      payload: {
        content: "Goblin Ambush\nGoblins attack.",
        category: "core",
      },
    },
  ],
};

// ── embedText ──────────────────────────────────────────────────────────────

describe("embedText", () => {
  it("returns an embedding array from Ollama", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);

    const result = await embedText("test query");
    expect(result).toEqual(MOCK_EMBEDDING);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/embeddings"),
      expect.any(Object),
    );
  });
});

// ── performVectorSearch ────────────────────────────────────────────────────

describe("performVectorSearch", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    // First fetch: Ollama Embedding
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);
    // Second fetch: Qdrant Search
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_QDRANT_RESPONSE,
    } as Response);
  });

  it("returns search results from Qdrant", async () => {
    const results = await performVectorSearch(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results[0].id).toBe("chunk-1");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/collections/dnd_chunks/points/search"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ── rerankResults ──────────────────────────────────────────────────────────

describe("rerankResults", () => {
  it("uses Cohere rerank API", async () => {
    const { __mock } = cohereModule as any;
    const chunks: RAGChunk[] = [
      {
        id: "a",
        content: "...",
        similarity: 0.5,
        section: "A",
        adventureId: "slug",
      },
    ];

    __mock.rerank.mockResolvedValueOnce({
      results: [{ index: 0, relevanceScore: 0.99 }],
    });

    const results = await rerankResults("query", chunks, 1);
    expect(results[0].score).toBe(0.99);
  });
});

// ── calculateRetrievalConfidence ───────────────────────────────────────────

describe("calculateRetrievalConfidence", () => {
  it("returns high confidence for strong retrieval matches", () => {
    const result = calculateRetrievalConfidence({
      similarities: [0.91, 0.84, 0.77],
      requestedChunkCount: 3,
    });

    expect(result.level).toBe("high");
    expect(result.score).toBeGreaterThan(0.68);
  });
});
