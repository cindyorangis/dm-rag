import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  embedText,
  performVectorSearch,
  calculateKeywordScores,
  retrieveChunks,
  rerankResults,
  retrieveChunksWithReRank,
  retrieveChunksVectorOnly,
  retrieveChunksKeywordOnly,
  type RAGChunk,
} from "./rag";

// ── Mocks ──────────────────────────────────────────────────────────────────

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
  }) as unknown as Awaited<ReturnType<typeof supabaseAdmin.rpc>>;

const rpcErr = (message: string) =>
  ({
    data: null,
    error: {
      message,
      details: "",
      hint: "",
      code: "",
      name: "PostgrestError",
    },
    count: null,
    status: 500,
    statusText: "Error",
  }) as unknown as Awaited<ReturnType<typeof supabaseAdmin.rpc>>;

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
    content: "Cragmaw Hideout\nA cave hideout in the woods.",
    similarity: 0.85,
  },
  {
    id: "chunk-3",
    content: "Phandalin Town\nA frontier town with a dark past.",
    similarity: 0.78,
  },
];

const MOCK_KEYWORD_RESULTS = [
  {
    id: "chunk-1",
    score: 0.88,
    content: "Goblin Ambush\nGoblins attack the road.",
  },
  {
    id: "chunk-4",
    score: 0.65,
    content: "Goblin Stats\nAC 15, HP 7, Speed 30ft.",
  },
];

const makeChunk = (overrides: Partial<RAGChunk> = {}): RAGChunk => ({
  id: "chunk-1",
  content: "Goblin Ambush\nGoblins attack the road.",
  similarity: 0.9,
  section: "Goblin Ambush",
  adventureId: MOCK_ADVENTURE_SLUG,
  ...overrides,
});

// ── embedText ──────────────────────────────────────────────────────────────

describe("embedText", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns an embedding array on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);

    const result = await embedText("What is the goblin's AC?");

    expect(result).toEqual(MOCK_EMBEDDING);
  });

  it("calls the Ollama API with the correct model and prompt", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);

    await embedText("test query");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/embeddings"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("test query"),
      }),
    );
  });

  it("uses OLLAMA_BASE_URL env variable when set", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://custom-host:11434");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);

    await embedText("test");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("http://custom-host:11434"),
      expect.anything(),
    );
  });

  it("uses OLLAMA_EMBED_MODEL env variable when set", async () => {
    vi.stubEnv("OLLAMA_EMBED_MODEL", "custom-embed-model");
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: MOCK_EMBEDDING }),
    } as Response);

    await embedText("test");

    expect(fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining("custom-embed-model"),
      }),
    );
  });

  it("throws when the Ollama API returns a non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: "Service Unavailable",
    } as Response);

    await expect(embedText("test")).rejects.toThrow("Ollama embed failed");
  });
});

// ── performVectorSearch ────────────────────────────────────────────────────

describe("performVectorSearch", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: MOCK_EMBEDDING }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns vector search results from Supabase RPC", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    const results = await performVectorSearch(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results).toEqual(MOCK_VECTOR_RESULTS);
    expect(mockRpc).toHaveBeenCalledWith("match_chunks_scoped", {
      query_embedding: MOCK_EMBEDDING,
      adventure_slug: MOCK_ADVENTURE_SLUG,
      match_count: 10,
    });
  });

  it("returns empty array when embedding fails in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Ollama down"));

    const results = await performVectorSearch(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results).toEqual([]);
  });

  it("throws when embedding fails in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Ollama down"));

    await expect(
      performVectorSearch("goblin", MOCK_ADVENTURE_SLUG, 10),
    ).rejects.toThrow("Ollama down");
  });

  it("throws when Supabase RPC returns an error", async () => {
    mockRpc.mockResolvedValueOnce(rpcErr("RPC failed"));

    await expect(
      performVectorSearch("goblin", MOCK_ADVENTURE_SLUG, 10),
    ).rejects.toThrow("Vector search failed");
  });

  it("returns an empty array when Supabase returns null data", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(null));

    const results = await performVectorSearch("goblin", MOCK_ADVENTURE_SLUG, 5);

    expect(results).toEqual([]);
  });
});

// ── calculateKeywordScores ─────────────────────────────────────────────────

describe("calculateKeywordScores", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns keyword results from Supabase RPC", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_KEYWORD_RESULTS));

    const results = await calculateKeywordScores(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results).toEqual(MOCK_KEYWORD_RESULTS);
    expect(mockRpc).toHaveBeenCalledWith("match_chunks_scoped_keywords", {
      query_embedding: null,
      adventure_slug: MOCK_ADVENTURE_SLUG,
      query_text: "goblin",
      match_count: 10,
    });
  });

  it("returns empty array and warns when RPC errors", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce(rpcErr("Function not found"));

    const results = await calculateKeywordScores(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
    );

    expect(results).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Keyword search unavailable"),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it("returns empty array when Supabase returns null data", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(null));

    const results = await calculateKeywordScores(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      5,
    );

    expect(results).toEqual([]);
  });
});

// ── retrieveChunks ─────────────────────────────────────────────────────────

describe("retrieveChunks", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: MOCK_EMBEDDING }),
      }),
    );
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("returns chunks sorted by combined score descending", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG);

    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(r.similarity).not.toBeNaN());
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(
        results[i + 1].similarity,
      );
    }
  });

  it("respects the matchCount limit", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 2);

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("boosts chunks that appear in both vector and keyword results", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 10);

    const boostedChunk = results.find((r) => r.id === "chunk-1");
    const vectorOnlyChunk = results.find((r) => r.id === "chunk-2");

    expect(boostedChunk).toBeDefined();
    expect(vectorOnlyChunk).toBeDefined();
    expect(boostedChunk!.similarity).not.toBeNaN();
    expect(vectorOnlyChunk!.similarity).not.toBeNaN();
    expect(boostedChunk!.similarity).toBeGreaterThan(
      vectorOnlyChunk!.similarity,
    );
  });

  it("deduplicates chunks that appear in both result sets", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 20);
    const ids = results.map((r) => r.id);

    expect(ids).toEqual([...new Set(ids)]);
  });

  it("includes chunks from keyword results not in vector results", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 20);
    const ids = results.map((r) => r.id);

    expect(ids).toContain("chunk-4");
  });

  it("falls back to vector-only when useHybridSearch is false", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 6, {
      useHybridSearch: false,
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped",
      expect.anything(),
    );
  });

  it("uses vectorWeight and keywordWeight from config", async () => {
    const keywordOnlyResult = [
      { id: "chunk-99", score: 1.0, content: "Pure keyword match\nContent." },
    ];

    // Robust mock implementation handling both RPC calls by name
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(keywordOnlyResult);
      }
      return rpcOk([]); // Fallback
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG, 10, {
      vectorWeight: 0.0,
      keywordWeight: 1.0,
    });

    // Ensure results were actually returned
    expect(results.length).toBeGreaterThan(0);

    // Verify chunk-99 exists in the combined results
    const chunk99 = results.find((r) => r.id === "chunk-99");
    expect(chunk99).toBeDefined();

    // With vectorWeight 0 and keywordWeight 1, similarity should equal keyword score (1.0)
    expect(chunk99?.similarity).toBe(1.0);
  });

  it("sets section from first line of content", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG);

    expect(results[0].section).toBe("Goblin Ambush");
  });

  it("sets adventureId from the adventure slug", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG);

    expect(results[0].adventureId).toBe(MOCK_ADVENTURE_SLUG);
  });

  it("falls back gracefully and returns [] in production when hybrid search throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Embedding service down"));

    const results = await retrieveChunks("goblin", MOCK_ADVENTURE_SLUG);

    expect(results).toEqual([]);
    consoleSpy.mockRestore();
  });
});

// ── rerankResults ──────────────────────────────────────────────────────────

describe("rerankResults", () => {
  it("returns top N results sorted by score descending", async () => {
    const chunks: RAGChunk[] = [
      makeChunk({ id: "a", similarity: 0.5 }),
      makeChunk({ id: "b", similarity: 0.9 }),
      makeChunk({ id: "c", similarity: 0.7 }),
    ];

    const results = await rerankResults("query", chunks, 2);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("b");
    expect(results[1].id).toBe("c");
  });

  it("uses similarity as the score proxy", async () => {
    const chunks = [makeChunk({ similarity: 0.88 })];

    const results = await rerankResults("query", chunks, 1);

    expect(results[0].score).toBe(0.88);
  });

  it("returns all results when topN exceeds result count", async () => {
    const chunks = [makeChunk({ id: "a" }), makeChunk({ id: "b" })];

    const results = await rerankResults("query", chunks, 10);

    expect(results).toHaveLength(2);
  });

  it("returns empty array for empty input", async () => {
    const results = await rerankResults("query", [], 3);

    expect(results).toEqual([]);
  });
});

// ── retrieveChunksWithReRank ───────────────────────────────────────────────

describe("retrieveChunksWithReRank", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: MOCK_EMBEDDING }),
      }),
    );
    mockRpc.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("returns finalMatchCount results", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunksWithReRank(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
      2,
    );

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are sorted by score descending", async () => {
    mockRpc.mockImplementation((async (rpcName: string) => {
      if (rpcName === "match_chunks_scoped") {
        return rpcOk(MOCK_VECTOR_RESULTS);
      }
      if (rpcName === "match_chunks_scoped_keywords") {
        return rpcOk(MOCK_KEYWORD_RESULTS);
      }
    }) as unknown as typeof supabaseAdmin.rpc);

    const results = await retrieveChunksWithReRank(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      10,
      3,
    );

    expect(results.length).toBeGreaterThan(0);
    results.forEach((r) => expect(r.score).not.toBeNaN());
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it("passes config through to retrieveChunks", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    await retrieveChunksWithReRank("goblin", MOCK_ADVENTURE_SLUG, 10, 3, {
      useHybridSearch: false,
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

// ── retrieveChunksVectorOnly ───────────────────────────────────────────────

describe("retrieveChunksVectorOnly", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embedding: MOCK_EMBEDDING }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("calls only the vector search RPC", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    await retrieveChunksVectorOnly("goblin", MOCK_ADVENTURE_SLUG);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped",
      expect.anything(),
    );
  });

  it("returns the correct number of chunks", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_VECTOR_RESULTS));

    const results = await retrieveChunksVectorOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results).toHaveLength(MOCK_VECTOR_RESULTS.length);
  });

  it("sets section and adventureId on each chunk", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk([MOCK_VECTOR_RESULTS[0]]));

    const results = await retrieveChunksVectorOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].section).toBe("Goblin Ambush");
    expect(results[0].adventureId).toBe(MOCK_ADVENTURE_SLUG);
  });

  it("uses first line of content as section", async () => {
    mockRpc.mockResolvedValueOnce(
      rpcOk([{ id: "x", content: "No newline content", similarity: 0.5 }]),
    );

    const results = await retrieveChunksVectorOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].section).toBe("No newline content");
  });

  it("falls back to 'General' section for empty content", async () => {
    mockRpc.mockResolvedValueOnce(
      rpcOk([{ id: "x", content: "", similarity: 0.5 }]),
    );

    const results = await retrieveChunksVectorOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].section).toBe("General");
  });
});

// ── retrieveChunksKeywordOnly ──────────────────────────────────────────────

describe("retrieveChunksKeywordOnly", () => {
  afterEach(() => vi.clearAllMocks());

  it("calls only the keyword search RPC", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_KEYWORD_RESULTS));

    await retrieveChunksKeywordOnly("goblin", MOCK_ADVENTURE_SLUG);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      "match_chunks_scoped_keywords",
      expect.anything(),
    );
  });

  it("returns the correct number of chunks", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_KEYWORD_RESULTS));

    const results = await retrieveChunksKeywordOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results).toHaveLength(MOCK_KEYWORD_RESULTS.length);
  });

  it("maps keyword score to similarity field", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk([MOCK_KEYWORD_RESULTS[0]]));

    const results = await retrieveChunksKeywordOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].similarity).toBe(MOCK_KEYWORD_RESULTS[0].score);
  });

  it("returns results sorted by similarity descending", async () => {
    const unsorted = [
      { id: "a", score: 0.4, content: "Low\nScore content" },
      { id: "b", score: 0.9, content: "High\nScore content" },
      { id: "c", score: 0.6, content: "Mid\nScore content" },
    ];
    mockRpc.mockResolvedValueOnce(rpcOk(unsorted));

    const results = await retrieveChunksKeywordOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].id).toBe("b");
    expect(results[1].id).toBe("c");
    expect(results[2].id).toBe("a");
  });

  it("respects matchCount limit", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk(MOCK_KEYWORD_RESULTS));

    const results = await retrieveChunksKeywordOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
      1,
    );

    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("sets adventureId from adventure slug", async () => {
    mockRpc.mockResolvedValueOnce(rpcOk([MOCK_KEYWORD_RESULTS[0]]));

    const results = await retrieveChunksKeywordOnly(
      "goblin",
      MOCK_ADVENTURE_SLUG,
    );

    expect(results[0].adventureId).toBe(MOCK_ADVENTURE_SLUG);
  });
});
