import { describe, expect, it } from "vitest";
import { runRagBenchmark, type RagBenchmarkCase } from "./rag-evals";
import type { RAGChunk } from "./rag";

describe("runRagBenchmark", () => {
  it("scores coverage/confidence and reports pass/fail", async () => {
    const cases: RagBenchmarkCase[] = [
      {
        id: "case-pass",
        label: "Pass case",
        query: "initiative",
        adventureSlug: "lost-mine-of-phandelver",
        expectedKeywords: ["initiative", "dexterity"],
        minKeywordCoverage: 0.5,
        minConfidenceScore: 0.2,
      },
      {
        id: "case-fail",
        label: "Fail case",
        query: "rare lore",
        adventureSlug: "lost-mine-of-phandelver",
        expectedKeywords: ["black spider", "wave echo"],
        minKeywordCoverage: 0.8,
        minConfidenceScore: 0.8,
      },
    ];

    const retriever = async (query: string): Promise<RAGChunk[]> => {
      if (query === "initiative") {
        return [
          {
            id: "a",
            content: "Initiative is a Dexterity check in combat order.",
            similarity: 0.8,
            section: "Combat",
            adventureId: "lost-mine-of-phandelver",
          },
        ];
      }

      return [
        {
          id: "b",
          content: "General tavern description.",
          similarity: 0.15,
          section: "Lore",
          adventureId: "lost-mine-of-phandelver",
        },
      ];
    };

    const summary = await runRagBenchmark({ cases, retriever });

    expect(summary.totalCases).toBe(2);
    expect(summary.passedCases).toBe(1);
    expect(summary.failedCases).toBe(1);
    expect(summary.averageCoverage).toBeGreaterThan(0);
    expect(summary.averageConfidence).toBeGreaterThan(0);

    const fail = summary.results.find((r) => r.id === "case-fail");
    expect(fail?.passed).toBe(false);
    expect(fail?.failureReasons.length).toBeGreaterThan(0);
  });
});
