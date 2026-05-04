import {
  calculateRetrievalConfidence,
  retrieveChunks,
  type RAGChunk,
  type RetrievalConfidenceLevel,
} from "@/lib/rag";

export interface RagBenchmarkCase {
  id: string;
  label: string;
  query: string;
  adventureSlug: string;
  expectedKeywords: string[];
  minKeywordCoverage?: number;
  minConfidenceScore?: number;
}

export interface RagBenchmarkCaseResult {
  id: string;
  label: string;
  query: string;
  adventureSlug: string;
  keywordCoverage: number;
  confidenceScore: number;
  confidenceLevel: RetrievalConfidenceLevel;
  topSimilarity: number | null;
  passed: boolean;
  failureReasons: string[];
}

export interface RagBenchmarkSummary {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  averageCoverage: number;
  averageConfidence: number;
  results: RagBenchmarkCaseResult[];
}

export const DEFAULT_RAG_BENCHMARK: RagBenchmarkCase[] = [
  {
    id: "rules-initiative",
    label: "Initiative Rules",
    query: "How do I roll initiative in 5e and what modifier applies?",
    adventureSlug: "lost-mine-of-phandelver",
    expectedKeywords: ["initiative", "dexterity", "modifier"],
  },
  {
    id: "rules-advantage",
    label: "Advantage and Disadvantage",
    query: "Explain advantage and disadvantage for attack rolls.",
    adventureSlug: "lost-mine-of-phandelver",
    expectedKeywords: ["advantage", "disadvantage", "d20"],
  },
  {
    id: "rules-death-saves",
    label: "Death Saving Throws",
    query: "What happens at 0 HP and how do death saves work?",
    adventureSlug: "lost-mine-of-phandelver",
    expectedKeywords: ["death", "saving throw", "0 hit points"],
  },
  {
    id: "lore-phandalin",
    label: "Phandalin Lore",
    query: "Who are the Redbrands in Phandalin and why are they feared?",
    adventureSlug: "lost-mine-of-phandelver",
    expectedKeywords: ["redbrand", "phandalin"],
  },
  {
    id: "lore-cragmaw",
    label: "Cragmaw Context",
    query: "What is Cragmaw Hideout and who commands it?",
    adventureSlug: "lost-mine-of-phandelver",
    expectedKeywords: ["cragmaw", "hideout", "goblin"],
  },
];

export async function runRagBenchmark(options?: {
  cases?: RagBenchmarkCase[];
  retriever?: (query: string, adventureSlug: string) => Promise<RAGChunk[]>;
}): Promise<RagBenchmarkSummary> {
  const cases = options?.cases ?? DEFAULT_RAG_BENCHMARK;
  const retriever = options?.retriever ?? retrieveChunks;

  const results: RagBenchmarkCaseResult[] = [];

  for (const benchmarkCase of cases) {
    const chunks = await retriever(
      benchmarkCase.query,
      benchmarkCase.adventureSlug,
    );

    const keywordCoverage = computeKeywordCoverage(
      chunks,
      benchmarkCase.expectedKeywords,
    );
    const similarities = chunks.map((chunk) => chunk.similarity);
    const confidence = calculateRetrievalConfidence({
      similarities,
      requestedChunkCount: readPositiveIntEnv("RAG_MAX_CHUNKS", 4),
      minSimilarityThreshold: readBoundedFloatEnv("RAG_MIN_SIMILARITY", 0.2),
    });

    const minCoverage = benchmarkCase.minKeywordCoverage ?? 0.6;
    const minConfidence = benchmarkCase.minConfidenceScore ?? 0.45;
    const failureReasons: string[] = [];

    if (keywordCoverage < minCoverage) {
      failureReasons.push(
        `keyword_coverage_below_threshold (${keywordCoverage.toFixed(3)} < ${minCoverage.toFixed(3)})`,
      );
    }

    if (confidence.score < minConfidence) {
      failureReasons.push(
        `confidence_below_threshold (${confidence.score.toFixed(3)} < ${minConfidence.toFixed(3)})`,
      );
    }

    results.push({
      id: benchmarkCase.id,
      label: benchmarkCase.label,
      query: benchmarkCase.query,
      adventureSlug: benchmarkCase.adventureSlug,
      keywordCoverage: round(keywordCoverage),
      confidenceScore: confidence.score,
      confidenceLevel: confidence.level,
      topSimilarity:
        similarities.length > 0 ? round(Math.max(...similarities)) : null,
      passed: failureReasons.length === 0,
      failureReasons,
    });
  }

  const totalCases = results.length;
  const passedCases = results.filter((result) => result.passed).length;
  const failedCases = totalCases - passedCases;
  const averageCoverage =
    totalCases > 0
      ? round(
          results.reduce((sum, result) => sum + result.keywordCoverage, 0) /
            totalCases,
        )
      : 0;
  const averageConfidence =
    totalCases > 0
      ? round(
          results.reduce((sum, result) => sum + result.confidenceScore, 0) /
            totalCases,
        )
      : 0;

  return {
    totalCases,
    passedCases,
    failedCases,
    averageCoverage,
    averageConfidence,
    results,
  };
}

function computeKeywordCoverage(
  chunks: RAGChunk[],
  keywords: string[],
): number {
  if (keywords.length === 0) return 1;
  const corpus = chunks.map((chunk) => chunk.content.toLowerCase()).join("\n");
  const matchedCount = keywords.filter((keyword) =>
    corpus.includes(keyword.toLowerCase()),
  ).length;
  return matchedCount / keywords.length;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedFloatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? parsed
    : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
