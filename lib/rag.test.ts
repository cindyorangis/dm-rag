import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cohereModule from "cohere-ai";
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

// Mock Cohere SDK
const { __mock } = cohereModule as unknown as CohereMockModule;

const mockEmbed = __mock.embed;
const mockRerank = __mock.rerank;

vi.mock("cohere-ai", () => {
  const mockEmbed = vi.fn();
  const mockRerank = vi.fn();

  return {
    CohereClient: class {
      embed = mockEmbed;
      rerank = mockRerank;
    },
    __mock: {
      embed: mockEmbed,
      rerank: mockRerank,
    },
  };
});

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
  },
}));

import { supabaseAdmin } from "@/lib/supabase";
const mockRpc = vi.mocked(supabaseAdmin.rpc);

// ── RPC helpers ────────────────────────────────────────────────────────────

const rpcOk = (data: unknown) =>
  ({
    data,
    error: null,
    count: null,
    status: 200,
    statusText: "OK",
  }) as unknown as Awaited<ReturnType<typeof supabaseAdmin.rpc>>; // Cast to any to bypass PostgrestFilterBuilder requirements

// ── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i * 0.001);
const MOCK_ADVENTURE_SLUG = "lost-mine-of-phandelver";

const MOCK_VECTOR_RESULTS = [
  {
    id: "chunk-1",
    content: "Goblin Ambush\nGoblins attack the road.",
    similarity: 0.92,
  },
  {
    id: "chunk-2",
    content: "Cragmaw Hideout\nA cave hideout.",
    similarity: 0.85,
  },
];

const MOCK_KEYWORD_RESULTS = [
  {
    id: "chunk-1",
    score: 0.88,
    content: "Goblin Ambush\nGoblins attack the road.",
  },
  { id: "chunk-4", score: 0.65, content: "Goblin Stats\nAC 15, HP 7." },
];

const makeChunk = (overrides: Partial<RAGChunk> = {}): RAGChunk => ({
  id: "chunk-1",
  content: "Goblin Ambush\nGoblins attack.",
  similarity: 0.9,
  section: "Goblin Ambush",
  adventureId: MOCK_ADVENTURE_SLUG,
  ...overrides,
});

// ── embedText ──────────────────────────────────────────────────────────────

describe("embedText", () => {
  it("returns an embedding array from Cohere", async () => {
    mockEmbed.mockResolvedValueOnce({
      embeddings: [MOCK_EMBEDDING], // Matches cohere.embed output
    });

    const result = await embedText("test query");
    expect(result).toEqual(MOCK_EMBEDDING);
  });

  it("throws when Cohere returns no embeddings", async () => {
    mockEmbed.mockResolvedValueOnce({ embeddings: [] });
    await expect(embedText("test")).rejects.toThrow(
      "Cohere embed returned no embedding",
    );
  });
});

// ── performVectorSearch ────────────────────────────────────────────────────

describe("performVectorSearch", () => {
  beforeEach(() => {
    mockEmbed.mockResolvedValue({ embeddings: [MOCK_EMBEDDING] });
  });

  it("returns vector search results from Supabase RPC", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    const results = await performVectorSearch(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results).toEqual(MOCK_VECTOR_RESULTS);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped",
      expect.objectContaining({
        query_embedding: MOCK_EMBEDDING,
      }),
    );
  });
});

// ── rerankResults ──────────────────────────────────────────────────────────

describe("rerankResults", () => {
  it("uses Cohere rerank API to sort results", async () => {
    const chunks = [makeChunk({ id: "a" }), makeChunk({ id: "b" })];
    mockRerank.mockResolvedValueOnce({
      results: [
        { index: 1, relevanceScore: 0.99 },
        { index: 0, relevanceScore: 0.82 },
      ],
    });

    const results = await rerankResults("query", chunks, 2);

    expect(results[0].id).toBe("b"); // Reranked to top
    expect(results[0].score).toBe(0.99);
  });

  it("falls back to blended score if rerank fails", async () => {
    const chunks = [makeChunk({ id: "a", similarity: 0.9 })];
    mockRerank.mockRejectedValueOnce(new Error("Down"));

    const results = await rerankResults("query", chunks, 1);
    expect(results[0].id).toBe("a");
    expect(results[0].score).toBe(0.9);
  });
});

// ── retrieveChunks ─────────────────────────────────────────────────────────

describe("retrieveChunks", () => {
  beforeEach(() => {
    mockEmbed.mockResolvedValue({ embeddings: [MOCK_EMBEDDING] });
    // Default rerank mock to return input order
    mockRerank.mockImplementation(
      async ({ documents }: { documents: unknown[] }) => ({
        results: documents.map((_, i: number) => ({
          index: i,
          relevanceScore: 0.9 - i * 0.1,
        })),
      }),
    );
  });

  it("performs hybrid search and handles the TS implementation correctly", async () => {
    // FIX: Use 'as any' to bypass the PostgrestFilterBuilder type error
    mockRpc.mockImplementation(((rpcName: string) => {
      if (rpcName === "match_chunks_scoped")
        return Promise.resolve(rpcOk(MOCK_VECTOR_RESULTS));
      if (rpcName === "match_chunks_scoped_keywords")
        return Promise.resolve(rpcOk(MOCK_KEYWORD_RESULTS));
      return Promise.resolve(rpcOk([]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG);

    expect(results.length).toBeGreaterThan(0);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped",
      expect.anything(),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped_keywords",
      expect.anything(),
    );
  });

  it("respects the topKForReRank limit during initial fetch", async () => {
    mockRpc.mockResolvedValue(rpcOk([]));

    await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 5, {
      topKForReRank: 50,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ match_count: 50 }),
    );
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
