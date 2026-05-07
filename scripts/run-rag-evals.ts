import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { runRagBenchmark } from "../lib/rag-evals";

async function main() {
  const summary = await runRagBenchmark();

  console.log("\nRAG Benchmark Summary");
  console.log("---------------------");
  console.log(`Total cases: ${summary.totalCases}`);
  console.log(`Passed: ${summary.passedCases}`);
  console.log(`Failed: ${summary.failedCases}`);
  console.log(`Average keyword coverage: ${summary.averageCoverage}`);
  console.log(`Average confidence: ${summary.averageConfidence}`);
  console.log("");

  for (const result of summary.results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `${status} ${result.id} | coverage=${result.keywordCoverage} confidence=${result.confidenceScore} (${result.confidenceLevel})`,
    );
    if (!result.passed) {
      for (const reason of result.failureReasons) {
        console.log(`  - ${reason}`);
      }
    }
  }

  if (summary.failedCases > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("RAG eval runner failed:", error);
  process.exit(1);
});
