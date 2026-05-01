import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgrestResponse } from "@supabase/supabase-js";
import {
  performVectorSearch,
  performKeywordSearch,
  mergeHybridResults,
  rerankResults,
} from "./service";
import { supabaseAdmin } from "@/lib/supabase";
import type { SearchResult } from "@/lib/search/types";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: vi.fn(),
  },
}));

vi.mock("./config", () => ({
  getOllamaConfig: vi.fn(() => ({
    baseUrl: "http://localhost:11434",
    embedModel: "nomic-embed-text",
    rerankModel: "bge-reranker",
  })),
}));

global.fetch = vi.fn();

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe("Search Service", () => {
  const mockResults = [
    { id: "1", content: "Result One", similarity: 0.8 },
    { id: "2", content: "Result Two", similarity: 0.6 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("performVectorSearch", () => {
    it("should fetch embeddings and call Supabase RPC", async () => {
      // Mock Ollama embedding response
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      } as Response);

      // Mock Supabase RPC response
      vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
        data: mockResults,
        error: null,
      } as unknown as PostgrestResponse<typeof mockResults>);

      const result = await performVectorSearch("query", "lost-mine", 5);

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/embeddings"),
        expect.any(Object),
      );
      expect(supabaseAdmin.rpc).toHaveBeenCalledWith("match_chunks_scoped", {
        query_embedding: [0.1, 0.2, 0.3],
        adventure_slug: "lost-mine",
        match_count: 5,
      });
      expect(result).toEqual(mockResults);
    });

    it("should throw error if fetch fails in non-production", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
      } as Response);

      await expect(performVectorSearch("q", "slug", 1)).rejects.toThrow(
        "Embedding request failed: Bad Request",
      );
    });
  });

  describe("performKeywordSearch", () => {
    it("should call the keyword-specific Supabase RPC", async () => {
      vi.mocked(supabaseAdmin.rpc).mockResolvedValueOnce({
        data: mockResults,
        error: null,
      } as unknown as PostgrestResponse<typeof mockResults>);

      const result = await performKeywordSearch("goblin", "lost-mine", 5);

      expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
        "match_chunks_scoped_keywords",
        {
          query_embedding: null,
          adventure_slug: "lost-mine",
          query_text: "goblin",
          match_count: 5,
        },
      );
      expect(result).toHaveLength(2);
    });
  });

  describe("mergeHybridResults", () => {
    // Helper to create a complete SearchResult for tests
    const createMockResult = (
      overrides: Partial<SearchResult>,
    ): SearchResult => ({
      id: "default-id",
      content: "default content",
      similarity: 0,
      section: "default-section",
      adventureId: "default-adventure",
      metadata: {},
      ...overrides,
    });

    it("should correctly merge and weight results from both sources", () => {
      const vectorRes = [createMockResult({ id: "A", similarity: 0.8 })];
      const keywordRes = [createMockResult({ id: "B", similarity: 0.5 })];

      const merged = mergeHybridResults(vectorRes, keywordRes, 0.7, 0.3);

      // A: (0.8 * 0.7) + (0 * 0.3) = 0.56
      // B: (0 * 0.7) + (0.5 * 0.3) = 0.15
      expect(merged.find((r) => r.id === "A")?.similarity).toBeCloseTo(0.56);
      expect(merged.find((r) => r.id === "B")?.similarity).toBeCloseTo(0.15);
    });

    it("should apply keyword boost for overlapping results", () => {
      const vectorRes = [createMockResult({ id: "A", similarity: 0.5 })];
      const keywordRes = [createMockResult({ id: "A", similarity: 0.4 })]; // 0.4 > 0.3 threshold

      const merged = mergeHybridResults(vectorRes, keywordRes, 0.5, 0.5);
      const resultA = merged.find((r) => r.id === "A");

      // Boosted score: (0.4 * 1.2) = 0.48
      // Final: (0.5 * 0.5) + (0.48 * 0.5) = 0.25 + 0.24 = 0.49
      expect(resultA?.similarity).toBeCloseTo(0.49);

      // Using optional chaining and non-null assertion or checking existence
      expect(resultA?.metadata?.keywordScore).toBeCloseTo(0.48);
    });
  });

  describe("rerankResults", () => {
    it("should call rerank API and map results by index", async () => {
      const initialResults = [
        {
          id: "1",
          content: "A",
          similarity: 0.5,
          section: "default-section",
          adventureId: "default-adventure",
          metadata: {},
        },
        {
          id: "2",
          content: "B",
          similarity: 0.4,
          section: "default-section",
          adventureId: "default-adventure",
          metadata: {},
        },
      ];

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { index: 1, relevance_score: 0.99 }, // B is now top
            { index: 0, relevance_score: 0.8 }, // A is second
          ],
        }),
      } as Response);

      const reranked = await rerankResults("query", initialResults, 2);

      expect(reranked[0].id).toBe("2");
      expect(reranked[0].similarity).toBe(0.99);
      expect(reranked[1].id).toBe("1");
    });

    it("should fallback to original score order if reranking fails", async () => {
      const initialResults = [
        {
          id: "1",
          content: "A",
          similarity: 0.9,
          section: "default-section",
          adventureId: "default-adventure",
          metadata: {},
        },
        {
          id: "2",
          content: "B",
          similarity: 0.1,
          section: "default-section",
          adventureId: "default-adventure",
          metadata: {},
        },
      ];

      vi.mocked(fetch).mockRejectedValueOnce(new Error("Ollama Down"));

      const result = await rerankResults("query", initialResults, 2);

      expect(result[0].id).toBe("1");
      expect(result[0].metadata?.rerankScore).toBe(0.9);
    });
  });
});
