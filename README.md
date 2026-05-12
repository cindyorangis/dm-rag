# ⚔️ The Dungeon Master

An AI-Powered D&D Dungeon Master App
Solo play. Full adventure. No DM required.

---

## Overview

The Dungeon Master is a web application that lets you play Dungeons & Dragons solo — without needing a human DM. It acts as your narrator, rules referee, combat tracker, and storyteller, powered by a large language model grounded in official D&D source material.

You can explore dungeons, make decisions, roll dice, fight monsters, and experience a full campaign — all through a conversational chat interface. At the end of each session, the app generates a narrative journal entry capturing what happened, building a living record of your adventure.

---

## The Problem It Solves

Many D&D players face a common barrier: no one to DM. Scheduling a group is hard. Finding an experienced DM is harder. This app eliminates that bottleneck entirely.

- Play on your own schedule, any time
- No group coordination required
- Rules are looked up automatically — no need to memorize the PHB
- Consistent narrative quality driven by official source material
- A journal of your campaign builds automatically over time

---

## Supported Adventures

The app supports multiple official D&D adventures. Each adventure has its own knowledge base, opening narration, and DM tone. Only chunks from the active adventure (plus the core rulebooks) are retrieved during play — keeping the DM grounded in the right lore.

| Adventure                     | Setting                     | Levels | Status         |
| ----------------------------- | --------------------------- | ------ | -------------- |
| Lost Mine of Phandelver       | Phandalin, Forgotten Realms | 1–5    | ✅ Available   |
| Ghosts of Saltmarsh           | Saltmarsh, Greyhawk         | 1–12   | ✅ Available   |
| Tales from the Yawning Portal | Waterdeep + various         | 1–15   | 🔲 Coming soon |

### Source Documents

Each adventure draws from its own module plus the three shared core rulebooks:

- **Player's Handbook (PHB)** — rules, spells, classes, races
- **Dungeon Master's Guide (DMG)** — rulings, tables, guidance
- **Monster Manual (MM)** — stat blocks and lore for all creatures

When you ask a rules question, describe an action, or enter combat, the app retrieves the most relevant passages from the active adventure module and the core books — ensuring it plays by the actual rules, not hallucinated ones.

---

## Tech Stack

| Layer      | Choice                            | Notes                                                        |
| ---------- | --------------------------------- | ------------------------------------------------------------ |
| Frontend   | Next.js (App Router) + TypeScript | App Router, server and client components                     |
| Styling    | Tailwind CSS                      | Dark fantasy / parchment UI theme                            |
| LLM        | Ollama (Llama 3) / Groq           | Local inference or Groq API; configurable via `LLM_PROVIDER` |
| Embeddings | Ollama `mxbai-embed-large`        | Local 1024-dim embeddings; free, no API calls                |
| Reranking  | Cohere `rerank-english-v3.0`      | Cross-encoder reranking after retrieval (query-time only)    |
| Vector DB  | Qdrant Cloud                      | Cosine similarity; payload-indexed for scoped filtering      |
| Database   | Supabase (PostgreSQL)             | Sessions, messages, journal entries, combat state            |
| Hosting    | Vercel                            | Free tier, zero-config Next.js deploys                       |

---

## How It Works

### 1. Document Ingestion (One-Time Setup)

Source books are organized into a two-tier folder structure under `scripts/books/`:

```
scripts/books/
  core/                              ← PHB, DMG, MM (shared across all adventures)
  adventures/
    lost-mine-of-phandelver/         ← adventure slug = folder name
    ghosts-of-saltmarsh/
    tales-from-the-yawning-portal/
```

Each PDF is parsed, chunked into ~1000 character sections with 100-character overlap, and embedded via local Ollama `mxbai-embed-large`. Chunks are stored in Qdrant Cloud, tagged with their source document's `category` (`core` or `adventure`) and `adventure_slug`. This tagging enables scoped RAG retrieval — each session only searches chunks from its own adventure plus the core rulebooks.

Run ingestion once per new book:

```bash
python scripts/ingest.py
```

The script skips chunks already in Qdrant (by `source` + `chunk_index`), so it's safe to re-run after adding new PDFs.

---

## Project Structure

```
app/
 ├── api/
 │   ├── chat/route.ts                # RAG pipeline + combat state updates + death resolution
 │   ├── characters/route.ts          # Fetch premade character roster
 │   ├── sessions/route.ts            # Session CRUD + opening narration generation
 │   ├── sessions/[id]/route.ts       # Fetch a single session (character context etc.)
 │   ├── sessions/[id]/messages/route.ts # Fetch messages for a session
 │   ├── combat/[id]/route.ts         # GET combat state; PATCH to submit player initiative
 │   ├── journal/route.ts             # Journal generation (POST); accepts pause flag
 │   └── journal/[id]/route.ts        # Fetch or update a single journal entry (GET, PATCH)
 ├── journal/
 │   ├── [id]/                        # Single journal entry view
 │   │   ├── components/              # Route-specific UI
 │   │   │   ├── SessionCard.tsx
 │   │   │   └── StatusBadge.tsx
 │   │   └── page.tsx
 │   └── page.tsx                     # Journal list view
 ├── session/
 │   └── [id]/                        # Active play session
 │       ├── components/              # Combat & Sidebar UI logic
 │       │   ├── CombatantRow.tsx
 │       │   ├── DiceRoller.tsx
 │       │   ├── InitiativeRoller.tsx
 │       │   ├── SidebarSection.tsx
 │       │   └── StatBlock.tsx
 │       └── page.tsx
 ├── components/                      # Shared/Global UI components
 │   ├── CharacterCard.tsx
 │   ├── ChatMessage.tsx              # DMMessage + UserMessage — parses raw DM content
 |   |                                # at render time; uses hook's parsedDM for live stream
 │   ├── HintPanel.tsx                # Renders [HINTS] as a collapsible "What can I do?" panel
 │   └── StatusCard.tsx               # Renders [STATUS] items as a quest status card
 ├── layout.tsx
 ├── page.tsx                         # Landing / Adventure + Character Selection / Session Resume
 └── page.types.ts                    # Shared types for the entry flow
 lib/
 ├── combat/                          # Modularized Combat Engine
 │   ├── detector.ts                  # detectCombatStart(), parseDamageFromNarrative()
 │   ├── dice.ts                      # roll(), rollAttack(), rollDamage(), rollInitiative()
 │   ├── encounters.ts                # Monster stat blocks, encounter definitions,
 |   |                                # detectEncounterKey(), buildEncounterMonstersOnly()
 │   ├── engine.ts                    # Pure state machine: advanceTurn, applyDamage,
 |   |                                # isPlayerDead(), selectDeathResolution()
 │   ├── repository.ts                # getCombatState(), upsertCombatState()
 │   └── types.ts                     # Combatant, CombatState, CombatLogEntry,
 |                                    # DeathResolutionType types
 ├── character.ts                     # Character sheet utilities
 ├── dm-prompt.ts                     # DM system prompt builder — adventure-aware title,
 |                                    # setting, and tone via ADVENTURE_META; injects combat
 |                                    # state, character context, strict turn instructions,
 |                                    # death resolution narrative scripts,
 |                                    # and structured [STATUS]/[HINTS] output format
 ├── parse-dm-response.ts             # parseDMResponse() / parseDMResponsePartial() —
 |                                    # splits raw DM output into narrative, statusItems,
 |                                    # and hints; structured parser with freeform fallback
 ├── rag.ts                           # embedText() + retrieveChunks(query, adventureSlug) —
 |                                    # hybrid vector + keyword search via Qdrant Cloud;
 |                                    # Ollama embeddings; Cohere reranking; scoped to core
 |                                    # rulebooks + active adventure chunks
 └── supabase.ts                      # Supabase client (browser + admin)
 hooks/
 └── useChat.ts                       # Chat state, streaming, initiative flag
                                      # pendingRolls parsed from DM [ROLL:] tags,
                                      # parsedDM updated live as stream arrives
scripts/
 ├── dnd_splitters.py                 # D&D-aware document chunking pipeline
 |                                    # DndTextSplitter — splits on chapter/section headers
 |                                    # before falling back to RecursiveCharacterTextSplitter
 │                                    # parseDndTables(), createDocumentFromTable() —
 |                                    # extracts Markdown tables into typed Document objects;
 |                                    # infers tableType (monsters/spells/items) from headers
 │                                    # SplitterFactory — selects dnd/table/standard splitter;
 |                                    # TableSplitter with overlap-aware prose chunking;
 |                                    # shared DndSplitter interface for all three types
 └── ingest.py                        # Document ingestion pipeline — processes core/ and
                                      # adventures/ subdirectories; embeds via local Ollama
                                      # mxbai-embed-large; upserts to Qdrant Cloud with payload indexes for
                                      # scoped RAG filtering by category + adventure_slug
```

---

## App Structure

### Pages

- `/` — Home / adventure + character selection / resume paused session
- `/session/[id]` — Active play session (chat UI + character/combat/log sidebar)
- `/journal` — Browse past session journal entries
- `/journal/[id]` — Single session journal entry

### API Routes

- `POST /api/sessions` — Create a new session (accepts `adventureSlug` + `characterContext`), generate and persist the opening narration
- `GET /api/sessions` — List all sessions (for journal page)
- `GET /api/sessions/[id]` — Fetch a single session including character context and adventure slug
- `GET /api/sessions/[id]/messages` — Fetch all messages for a session
- `GET /api/characters` — Fetch the premade character roster
- `POST /api/chat` — RAG pipeline: embed → scoped retrieve → rerank → stream LLM response + update combat state
- `GET /api/combat/[id]` — Fetch current combat state for a session
- `PATCH /api/combat/[id]` — Submit player initiative roll; re-sorts combatants and clears awaiting flag
- `POST /api/journal` — End-of-session journal generation; accepts `pause: true` to set status to `paused` instead of `completed`
- `GET /api/journal/[id]` — Fetch a single session with journal entry
- `PATCH /api/journal/[id]` — Update journal entry text and/or session status

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.9+
- Ollama installed and running locally (for local LLM inference)
- Cohere account (free tier — reranking only, not embeddings)
- Qdrant Cloud account (free tier: 1GB)
- Supabase account (free)
- Vercel account for deployment (free)

### Pull required Ollama models

```bash
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
```

> Run `ollama list` to verify your installed model names. Both model names must exactly match what Ollama reports. `mxbai-embed-large` is used for ingestion and query-time embedding; `llama3.1:8b` for local chat inference.

### Environment Variables

```bash
# Supabase (sessions, messages, combat state, journal)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_secret_key

# Qdrant Cloud (vector store)
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key
QDRANT_COLLECTION=dnd_chunks

# Cohere (reranking only — embeddings use Ollama)
COHERE_API_KEY=your_cohere_api_key

# LLM + Embeddings — local Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=mxbai-embed-large
OLLAMA_CHAT_MODEL=llama3.1:8b

# LLM — Groq (faster; used in production by default)
GROQ_API_KEY=your_groq_api_key
GROQ_BASE_URL=https://api.groq.com/v1
GROQ_CHAT_MODEL=llama-3.3-70b-versatile

# Optional: override LLM provider. If omitted:
#   production → groq
#   local dev  → ollama
LLM_PROVIDER=

# RAG tuning (optional — defaults shown)
RAG_MAX_CHUNKS=4
RAG_MIN_SIMILARITY=0.2
RAG_CONFIDENCE_LOW_THRESHOLD=0.38
RAG_CONFIDENCE_HIGH_THRESHOLD=0.68
```

### Local Development

```bash
npm install
npm run dev
```

### Document Ingestion

Organise your PDFs under `scripts/books/` following the folder convention:

```
scripts/books/
  core/                              ← PHB, DMG, MM
  adventures/
    lost-mine-of-phandelver/
    ghosts-of-saltmarsh/
    tales-from-the-yawning-portal/
```

The folder name under `adventures/` becomes the `adventure_slug` stored in Qdrant and must match the slug used when creating sessions. Then run:

```bash
pip install qdrant-client pymupdf python-dotenv
python scripts/ingest.py
```

The script is idempotent — it checks whether any chunks from a given source file already exist in Qdrant and skips the whole file if so. Safe to re-run after adding new PDFs.

---

## RAG Evals

Run retrieval benchmark evals against built-in lore/rules queries:

```bash
npm run eval:rag
```

The eval runner reports keyword coverage + retrieval confidence per case and exits non-zero on failures.
See [docs/RAG_EVALS.md](docs/RAG_EVALS.md) for details.

---

## Failure Recovery UX

If a turn fails due to LLM/RAG/API issues, the session now:

- shows a "DM is recovering" assistant response
- preserves the failed player action for retry
- queues additional player actions while recovery is in progress
- supports one-click **Retry Turn** without losing turn continuity

Implementation details are documented in [docs/GAME_MECHANICS.md](docs/GAME_MECHANICS.md).

---

## Build Status

| Phase | Description                                                         | Status      |
| ----- | ------------------------------------------------------------------- | ----------- |
| 1     | Foundation — schema, ingestion, project setup                       | ✅ Complete |
| 2     | RAG pipeline — embed, retrieve, stream, persist                     | ✅ Complete |
| 3     | DM logic — combat tracking, dice, NPC state                         | ✅ Complete |
| 4     | Journal — generation, storage, list + detail views                  | ✅ Complete |
| 5     | Character selection — premade roster, context injection             | ✅ Complete |
| 6     | Opening narration — immersive session intro                         | ✅ Complete |
| 7     | Session sidebar — character stats, combat tracker, log              | ✅ Complete |
| 8     | Player dice rolling — initiative, attacks, checks, saves, damage    | ✅ Complete |
| 9     | Turn enforcement — monsters resolve fully before player is prompted | ✅ Complete |
| 10    | Encounter detection — correct monsters spawned per LMoP location    | ✅ Complete |
| 11    | Structured DM output — status card + hint panel for new players     | ✅ Complete |
| 12    | Save & resume — pause sessions, continue where you left off         | ✅ Complete |
| 13    | Death resolution — 0 HP as narrative pivot, not game over           | ✅ Complete |
| 14    | Multi-adventure support — scoped RAG, per-adventure DM tone         | ✅ Complete |
| 15    | D&D-aware text splitting — structure-preserving chunking pipeline   | ✅ Complete |
| 16    | Qdrant migration — vector store moved off Supabase pgvector         | ✅ Complete |
| 17    | Polish — UI theme, mobile, PDF export                               | 🔲 Upcoming |

---

May your rolls be high and your traps be few.
🐉

---

## Contributing

### Adding a New Adventure

1. Create a new folder under `scripts/books/adventures/`
2. Add adventure module PDFs
3. Run `python scripts/ingest.py`
4. Update `lib/adventures/config.ts` with adventure metadata

### Testing

Run tests before submitting:

```bash
npm test
npm run eval:rag
```

### Code Style

- TypeScript strict mode enabled (`tsconfig.json`)
- Use existing utilities in `lib/`
- Write unit tests for new features
- Follow existing patterns in `lib/combat/`

---

## 2. API Documentation

See `docs/API_DOCS.md` for detailed OpenAPI spec.

Quick reference:

| Endpoint           | Method | Description                               |
| ------------------ | ------ | ----------------------------------------- |
| `/api/chat`        | POST   | RAG pipeline + combat state updates       |
| `/api/sessions`    | POST   | Create new session with opening narration |
| `/api/combat/[id]` | PATCH  | Submit player initiative roll             |
| `/api/journal`     | POST   | Generate journal entry at session end     |

---

## 3. Data Model

Key tables (Supabase):

- `sessions` — Active play sessions with character context
- `messages` — Session conversation history
- `combat_state` — Combat tracker state
- `characters` — Premade character roster
- `turn_metrics` — Per-turn observability data

Vector store (Qdrant Cloud):

- Collection `dnd_chunks` — All ingested chunks with Ollama `mxbai-embed-large` embeddings, indexed by `category`, `adventure_slug`, `source`, and `chunk_index`

See `docs/SETUP_AND_SCHEMA.md` for full schema.

---

## 4. Environment Variables Reference

### LLM Configuration

| Variable             | Default             | Description                                   |
| -------------------- | ------------------- | --------------------------------------------- |
| `LLM_PROVIDER`       | -                   | `ollama` \| `groq` (overrides auto-detect)    |
| `OLLAMA_EMBED_MODEL` | `mxbai-embed-large` | Must match `ollama list`; used for embeddings |
| `OLLAMA_CHAT_MODEL`  | -                   | Must match `ollama list`; used for chat       |
| `GROQ_CHAT_MODEL`    | -                   | Model name for Groq API                       |

### Cohere

| Variable         | Description                                     |
| ---------------- | ----------------------------------------------- |
| `COHERE_API_KEY` | Used for reranking only (embeddings use Ollama) |

### Qdrant

| Variable            | Description                             |
| ------------------- | --------------------------------------- |
| `QDRANT_URL`        | Your Qdrant Cloud cluster URL           |
| `QDRANT_API_KEY`    | Qdrant Cloud API key                    |
| `QDRANT_COLLECTION` | Collection name (default: `dnd_chunks`) |

### Supabase

| Variable                               | Description               |
| -------------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client-side public key    |
| `SUPABASE_SECRET_KEY`                  | Server-side secret key    |

### RAG Tuning

| Variable                        | Default | Description                            |
| ------------------------------- | ------- | -------------------------------------- |
| `RAG_MAX_CHUNKS`                | `4`     | Max chunks returned per query (1–12)   |
| `RAG_MIN_SIMILARITY`            | `0.2`   | Minimum similarity threshold (0.0–1.0) |
| `RAG_CONFIDENCE_LOW_THRESHOLD`  | `0.38`  | Below this → "low" confidence level    |
| `RAG_CONFIDENCE_HIGH_THRESHOLD` | `0.68`  | Above this → "high" confidence level   |

---

## 5. Troubleshooting

### Ollama

```bash
ollama list
# Ensure chat model matches exactly:
# - ollama_chat_model = llama3.1:8b (not llama3)
```

- Ollama not responding? Run in another terminal: `ollama serve`
- Model not found? Run: `ollama pull <model_name>`
- Embedding errors? Ensure `mxbai-embed-large` is pulled: `ollama pull mxbai-embed-large`
- Streaming issues? Check disk space and RAM

### Qdrant

- `400 Bad Request: Index required` — payload indexes weren't created. Re-run `ingest.py`; `ensure_collection()` creates them automatically.
- `QDRANT_URL KeyError` — `.env.local` not found. Run `ingest.py` from the project root, not from `scripts/`.
- Chunk count unexpectedly high — HTML tags leaked into text. Ensure you're on the latest `ingest.py` which calls `strip_html()` after `html_tables_to_markdown()`.

---

## 6. Deployment Guide

### Setup

1. Connect your GitHub repo to Vercel
2. Add environment variables in Vercel dashboard (all vars from `.env.local`)
3. Deploy: `vercel deploy --prod`

### Qdrant Cloud

- Create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io)
- Copy the cluster URL and API key into Vercel env vars
- Run ingestion locally before deploying — Qdrant Cloud is accessible from anywhere

### Supabase

- Production project recommended
- Export `SUPABASE_SECRET_KEY` to Vercel
- Enable RLS (Row Level Security) for production

---

## 7. Document Ingestion Pipeline

### Supported Formats

- PDF (single/multiple pages per document)

### Chunking Strategy

- Default: ~1000 characters with 100-character overlap
- D&D-aware splitting via `DndTextSplitter` (prose) and `TableSplitter` (pages with Markdown tables)
- `build_boilerplate_blacklist()` strips running headers/footers before chunking
- `is_junk_page()` skips TOC pages and OCR garbage
- Tags chunks with `category` and `adventure_slug` as Qdrant payload

### Adding Custom Content

1. Place PDF in `scripts/books/<folder>/`
2. Run `python scripts/ingest.py`
3. Chunks appear in Qdrant within seconds

---

## 8. Character System

### Premade Characters

- Available via `/api/characters`
- Includes standard D&D 5e races/classes
- Can customize stats manually

### Custom Characters

- Create from scratch via session creation
- Character context injected via `characterContext` field
- Supports custom homebrew content

---

## 9. Journal System

### What Gets Saved

- Session summary
- Key decisions made
- Combat outcomes
- Notable encounters

### Journal Generation

Triggered automatically when:

- Session marked as complete
- User requests pause
- Session duration threshold reached

Customize generation prompt in `app/api/journal/prompt.ts`

---

## 10. Combat System Details

### Components

- `lib/combat/dice.ts` — Dice rolling utilities
- `lib/combat/detector.ts` — Combat detection
- `lib/combat/engine.ts` — State machine
- `lib/combat/encounters.ts` — Encounter definitions

### Features

- Initiative tracking
- HP management
- Damage calculation
- Death resolution (narrative, not hard stop)
- Turn enforcement (monsters act before player)

---

## 11. RAG Pipeline Details

### Components

- `lib/rag.ts` — Embeddings, hybrid retrieval, and reranking
- `lib/parse-dm-response.ts` — Response parsing

### How It Works

1. User asks question / enters action
2. Embed query via local Ollama `mxbai-embed-large`
3. Run hybrid search against Qdrant: vector similarity + full-text keyword match, both scoped to core rulebooks + active adventure
4. Merge results with configurable vector/keyword weights (default 0.7/0.3)
5. Rerank top candidates via Cohere `rerank-english-v3.0`
6. Inject chunks into LLM prompt
7. Stream response via Ollama / Groq
8. Parse response for structured `[STATUS]` / `[HINTS]` content

---

## 12. RAG Evaluation

Run built-in evals to test retrieval quality:

```bash
npm run eval:rag
```

Test cases include:

- Rules queries (spell slots, ability checks)
- Lore queries (monster lore, location details)
- Cross-adventure isolation
- Confidence scoring

See `docs/RAG_EVALS.md` for details.

---

## 13. Error Handling

### Player-Facing Messages

- "DM is recovering" for failed LLM/API calls
- Retry turn functionality
- Preserved player actions for recovery

### Debug Mode

Enable verbose logging:

```bash
NODE_ENV=development npm run dev
```

See `lib/observability.ts` for logging utilities.

---

## 14. Performance Notes

### Document Size

Recommended:

- Core rulebooks: ~100 pages each
- Adventure modules: ~50–100 pages
- Total chunks: <50,000 for optimal Qdrant free tier performance

### Streaming

- Expected response time: 2–8 seconds
- Depends on LLM provider; Groq provides faster responses in production

### Cohere Rate Limits

- Cohere is used for reranking only — embeddings run locally via Ollama at no cost
- Free trial: 1,000 rerank calls/month; sufficient for light development use
- Upgrade to a Cohere production key for heavier usage

---

## 15. Security Notes

### Production Checklist

- Enable Supabase RLS (Row Level Security)
- Rotate keys periodically
- Use separate Supabase and Qdrant projects for production
- Rate limit API routes
- Enable HTTPS (Vercel handles this)

### Secrets Management

- Never commit `.env` to Git
- Use `.env.local` for local development
- Add `.env.example` to repo with placeholders

---

## 16. Licensing

## License

MIT License — See LICENSE file for details.

### Permitted Uses

- Personal play
- Non-commercial DMing
- Educational purposes
- Open-source projects

### Not Permitted

- Commercial distribution without permission
- Redistribution of source rulebooks
- Use with prohibited LLMs

---

## 17. Features

- ✨ **Immersive Storytelling** — AI DM with rich narrative
- 🎲 **Full Combat Tracker** — Initiative, attacks, damage
- 📚 **Scoped RAG** — Adventure-aware hybrid knowledge retrieval with Cohere reranking
- 📖 **Auto Journal** — Campaign journal built automatically
- 🧙 **Character Sheets** — Premade + custom character support
- 💀 **Death Resolution** — Narrative continues after player death
- 🔄 **Session Resume** — Pause and continue anytime
- 📱 **Mobile-Ready** — Touch-friendly interface

---

## 18. Roadmap

### Phase 1: Foundation (✅ Complete)

- Schema design
- Document ingestion
- Project setup

### Phase 2: Core Features (✅ Complete)

- RAG pipeline
- Combat tracking
- Journal system

### Phase 3: Infrastructure (✅ Complete)

- Qdrant Cloud vector store migration
- Ollama local embeddings (`mxbai-embed-large`)
- Cohere reranking
- Hybrid search (vector + keyword)

### Phase 4: Polish (🔲 Planned)

- PDF export
- Advanced UI theming
- Multi-platform support
- Custom spell/monster editor

---

## 19. Credits

- **Base Models**: Ollama (Llama 3), Groq
- **Embeddings**: Ollama `mxbai-embed-large` (local, free)
- **Reranking**: Cohere `rerank-english-v3.0`
- **Vector Store**: Qdrant Cloud
- **Database**: Supabase (PostgreSQL)
- **UI**: Tailwind CSS, Next.js

**Special Thanks**:

- D&D Open Game License content
- D&D Beyond (for inspiration)
- Open-source community
