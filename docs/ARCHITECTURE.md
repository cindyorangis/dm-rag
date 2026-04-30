## 1. D&D-Aware Text Splitting

Standard fixed-size chunking breaks D&D source material in ways that destroy meaning — a monster's stat block split across two chunks, a spell's casting time separated from its effect, a table row orphaned from its headers. The app uses a three-splitter pipeline specifically designed for D&D document structure.

### `DndTextSplitter`

Splits text by structural section boundaries before falling back to size-based chunking. It first attempts to divide text on chapter titles (`# Monsters`), section headers (`## Actions`), sub-sections (`### Stats`), and named D&D sections (`Actions:`, `Reactions:`, `Traits:`, `Lore:`). Sections that still exceed `chunkSize` after this pass are handed to `RecursiveCharacterTextSplitter` with a D&D-aware separator hierarchy (`\n\n` → `\n` → `. ` → ` ` → character-level fallback).

### `TableSplitter`

Markdown tables in D&D books (monster lists, spell tables, equipment lists) are structurally distinct from prose — they should not be mid-row chunked or mixed with surrounding text. `TableSplitter` extracts all Markdown tables from the input first, converts each to a set of labelled key-value `Document` objects, then strips the table rows from the remaining prose before passing it through the overlap-aware text chunker. This ensures every table row becomes its own retrievable document with clean metadata.

Table type (`monsters`, `spells`, `items`) is inferred automatically from headers and surrounding context using a keyword matching approach — headers like `CR`, `Hit Points`, `AC` resolve to `monsters`; `Casting Time`, `Duration`, `School` resolve to `spells`; and so on.

### `SplitterFactory`

A factory that selects the right splitter for the content being processed:

```ts
import { SplitterFactory } from "@/lib/text-splitters/splitters";

const splitter = SplitterFactory.create("dnd", {
  chunkSize: 1000,
  chunkOverlap: 100,
});
const chunks = await splitter.splitText(text);

const tableSplitter = SplitterFactory.create("table", {
  chunkSize: 1000,
  chunkOverlap: 100,
});
const docs = await tableSplitter.createDocuments([text], [{ source: "MM" }]);
```

| Type       | Best for                                                |
| ---------- | ------------------------------------------------------- |
| `dnd`      | Prose sections, rules text, lore passages               |
| `table`    | Monster lists, spell tables, item tables                |
| `standard` | Generic fallback; uses `RecursiveCharacterTextSplitter` |

All three splitter types implement the same `DndSplitter` interface (`splitText` + `createDocuments`), so they are interchangeable in the ingestion pipeline without any call-site changes.

#### Why This Matters for RAG Quality

Standard vector search alone struggles with D&D rules nuances — it cannot reliably distinguish "Action" from "Bonus Action" when those terms appear in the same chunk alongside unrelated content. Structure-aware splitting ensures that each chunk contains exactly one coherent rules concept, which dramatically improves retrieval precision. A query for "Goblin stat block" retrieves the goblin's full stat block as a single document rather than a fragment of it.

---

## 2. Advanced RAG Pipeline (Every Message)

When you send a message — whether it's "I attack the goblin" or "What are the rules for grappling?" — the following happens:

- Your message is embedded into a vector using Ollama
- **Hybrid Search**: Retrieves top 10 candidates using both vector search (semantic) and keyword search (exact term matching)
- **Re-ranking**: Cross-encoder re-ranks the combined results to the top 3 most relevant chunks
- Those chunks are injected as context into the DM system prompt
- The LLM responds in character as your DM, grounded in the retrieved rules
- The response streams token-by-token to the UI
- Both messages are persisted to the database when the stream completes

#### Why Hybrid Search?

Standard vector search alone fails at D&D rules nuances (e.g., distinguishing "Action" from "Bonus Action"). Hybrid search combines:

- **Vector Search**: Finds semantically similar content
- **Keyword Search**: Catches exact spell/monster/item names
- **Re-ranking**: Cross-encoder provides deep semantic analysis for final ranking

This ensures accurate rules lookup and prevents hallucinations.
