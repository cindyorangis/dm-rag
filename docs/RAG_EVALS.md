# RAG Evals and Retrieval Confidence

This project now includes two complementary safeguards against RAG drift:

1. Runtime retrieval confidence in chat turns.
2. Offline benchmark evals for lore/rules retrieval quality.

## 1. Runtime Retrieval Confidence

Each chat turn computes a retrieval confidence score from returned chunk similarities.

- Location: `lib/rag.ts` via `calculateRetrievalConfidence(...)`
- Output:
  - `score` (0-1)
  - `level` (`high` | `medium` | `low`)
  - `reason`

The score is injected into the DM system prompt in `lib/dm-prompt.ts`.

When confidence is `low`, the DM receives explicit instructions to:

- avoid asserting uncertain specific lore/rules facts
- ask exactly one clarifying question
- provide cautious, generic options grounded in known context

This reduces hallucinated certainty on weak retrieval turns.

## 2. Benchmark Evals

Run the benchmark suite:

```bash
npm run eval:rag
```

Runner:

- `scripts/run-rag-evals.ts`

Benchmark logic and cases:

- `lib/rag-evals.ts`

The runner exits with code `1` if any case fails, so it can be used in CI.

Each case checks:

- keyword coverage in retrieved chunks
- retrieval confidence score threshold

Summary output includes pass/fail counts, average coverage, and average confidence.

## Environment Variables

Confidence thresholds are configurable:

```bash
RAG_CONFIDENCE_LOW_THRESHOLD=0.38
RAG_CONFIDENCE_HIGH_THRESHOLD=0.68
```

Retrieval controls that influence confidence:

```bash
RAG_MAX_CHUNKS=4
RAG_MIN_SIMILARITY=0.2
```
