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

| Layer      | Choice                            | Notes                                             |
| ---------- | --------------------------------- | ------------------------------------------------- |
| Frontend   | Next.js (App Router) + TypeScript | App Router, server and client components          |
| Styling    | Tailwind CSS                      | Dark fantasy / parchment UI theme                 |
| LLM        | Ollama (Llama 3)                  | Local inference, no API cost                      |
| Embeddings | Ollama (mxbai-embed-large)        | Local embeddings, matches ingestion model         |
| Vector DB  | Supabase pgvector                 | Cosine similarity via `<=>` operator              |
| Database   | Supabase (PostgreSQL)             | Sessions, messages, journal entries, combat state |
| Hosting    | Vercel                            | Free tier, zero-config Next.js deploys            |

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

Each PDF is parsed, chunked into ~1000 character sections with 100-character overlap, and converted into vector embeddings via Ollama. Chunks are stored in Supabase with `pgvector`, tagged with their source document's `category` (`core` or `adventure`) and `adventure_slug`. This tagging enables scoped RAG retrieval — each session only searches chunks from its own adventure plus the core rulebooks.

Run ingestion once per new book:

```bash
python scripts/ingest.py
```

The script skips documents already in the database, so it's safe to re-run after adding new PDFs.

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
 |                                    # scoped to core rulebooks + active adventure chunks
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
                                      # adventures/ subdirectories, tags each chunk with
                                      # category and adventure_slug for scoped RAG retrieval
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
- `POST /api/chat` — RAG pipeline: embed → scoped retrieve → stream LLM response + update combat state
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
- Ollama installed and running locally
- Supabase account (free)
- Vercel account for deployment (free)

### Pull required Ollama models

```bash
ollama pull llama3.1:8b
ollama pull mxbai-embed-large
```

> Run `ollama list` to verify your installed model names. The chat model name in your `.env.local` must exactly match what Ollama reports (e.g. `llama3.2` instead of `llama3`).

### Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_secret_key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=mxbai-embed-large
OLLAMA_CHAT_MODEL=llama3.1:8b
GROQ_API_KEY=your_groq_api_key
GROQ_BASE_URL=https://api.groq.com/v1
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
# Optional override. If omitted:
# - production uses groq
# - local development uses ollama
LLM_PROVIDER=
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

The folder name under `adventures/` becomes the `adventure_slug` stored in the database and must match the slug used when creating sessions. Then run:

```bash
pip install ollama supabase pypdf
python scripts/ingest.py
```

The script is idempotent — it checks for existing document titles and skips anything already ingested, so it's safe to re-run after adding new PDFs.

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
| 16    | Polish — UI theme, mobile, PDF export                               | 🔲 Upcoming |

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

````

---

## 2. API Documentation

You have many API routes - add OpenAPI/Swagger or inline docs:

```markdown
## API Documentation

See `docs/API_DOCS.md` for detailed OpenAPI spec.

Quick reference:

| Endpoint                    | Method   | Description                               |
| --------------------------- | -------- | ----------------------------------------- |
| `/api/chat`                 | POST     | RAG pipeline + combat state updates       |
| `/api/sessions`             | POST     | Create new session with opening narration |
| `/api/combat/[id]`         | PATCH    | Submit player initiative roll             |
| `/api/journal`              | POST     | Generate journal entry at session end     |
````

---

## 3. Data Model

You use Supabase - add a schema section:

```markdown
## Database Schema

Key tables:

- `sessions` — Active play sessions with character context
- `journal_entries` — End-of-session summaries
- `combat_states` — Combat tracker state
- `chat_messages` — Session conversation history
- `document_chunks` — Ingested knowledge chunks

See `docs/SETUP_AND_SCHEMA.md` for full schema.
```

---

## 4. Environment Variables Reference

Expand on your current section:

```markdown
## Environment Variables (Expanded)

### LLM Configuration

| Variable             | Default | Description                              |
| -------------------- | ------- | ---------------------------------------- |
| `LLM_PROVIDER`       | -       | `ollama` \| `groq` (overrides local/dev) |
| `OLLAMA_CHAT_MODEL`  | -       | Must match `ollama list` exactly         |
| `OLLAMA_EMBED_MODEL` | -       | Must match ingestion model               |
| `GROQ_CHAT_MODEL`    | -       | Model name for Groq API                  |

### Supabase

| Variable                               | Description               |
| -------------------------------------- | ------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client-side public key    |
| `SUPABASE_SECRET_KEY`                  | Server-side secret key    |
```

---

## 5. Troubleshooting Ollama

````markdown
## Ollama Setup

### Verify Installation

```bash
ollama list
# Ensure models match exactly:
# - ollama_chat_model = llama3.1:8b (not llama3)
# - ollama_embed_model = mxbai-embed-large
```
````

### Troubleshooting

- Ollama not responding? Run in another terminal: `ollama serve`
- Model not found? Run: `ollama pull <model_name>`
- Streaming issues? Check disk space and RAM

````

---

## 6. Deployment Guide

```markdown
## Deployment to Vercel

### Setup

1. Connect your GitHub repo to Vercel
2. Add environment variables (`.env` → Vercel secrets)
3. Deploy: `vercel deploy --prod`

### Supabase

- Production project recommended
- Export `SUPABASE_SECRET_KEY` to Vercel
- Enable RLS (Row Level Security) for production
````

---

## 7. Document Ingestion Details

Expand on your ingestion section:

```markdown
## Document Ingestion Pipeline

### Supported Formats

- PDF (single/multiple pages per document)
- Markdown files (for quick testing)

### Chunking Strategy

- Default: ~1000 characters with 100-character overlap
- D&D-aware splitting via `DndTextSplitter`
- Preserves tables and structured content
- Tags chunks with `category` and `adventure_slug`

### Adding Custom Content

1. Place PDF in `scripts/books/<folder>/`
2. Run `python scripts/ingest.py`
3. Chunks appear in Supabase within seconds
```

---

## 8. Character System

```markdown
## Character System

### Premade Characters

- Available via `/api/characters`
- Includes standard D&D 5e races/classes
- Can customize stats manually

### Custom Characters

- Create from scratch via session creation
- Character context injected via `characterContext` field
- Supports custom homebrew content
```

---

## 9. Journal System

```markdown
## Journal System

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
```

---

## 10. Combat System Details

```markdown
## Combat System

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
```

---

## 11. RAG Pipeline Details

```markdown
## RAG Pipeline

### Components

- `lib/rag.ts` — Embeddings and retrieval
- `lib/search/` — Search service
- `lib/parse-dm-response.ts` — Response parsing

### How It Works

1. User asks question/enters action
2. Embed query via Ollama `mxbai-embed-large`
3. Retrieve relevant chunks from Supabase
4. Inject chunks into LLM prompt
5. Stream response via Ollama/Groq
6. Parse response for structured content
```

---

## 12. RAG Evaluation

````markdown
## RAG Evaluation

Run built-in evals to test retrieval quality:

```bash
npm run eval:rag
```
````

Test cases include:

- Rules queries (spell slots, ability checks)
- Lore queries (monster lore, location details)
- Cross-adventure isolation
- Confidence scoring

See `docs/RAG_EVALS.md` for details.

````

---

## 13. Error Handling

```markdown
## Error Handling

### Player-Facing Messages

- "DM is recovering" for failed LLM/API calls
- Retry turn functionality
- Preserved player actions for recovery

### Debug Mode

Enable verbose logging:

```bash
NODE_ENV=development npm run dev
````

See `lib/observability.ts` for logging utilities.

````

---

## 14. Performance Notes

```markdown
## Performance

### Document Size

Recommended:
- Core rulebooks: ~100 pages each
- Adventure modules: ~50-100 pages
- Total chunks: <50,000 for optimal performance

### Streaming

- Expected response time: 2-8 seconds
- Depends on Ollama model load
- Groq provides faster responses when enabled

### Memory

Ollama models require:
- `llama3.1:8b` — ~5GB RAM
- `mxbai-embed-large` — ~3GB RAM
````

---

## 15. Security Notes

```markdown
## Security

### Production Checklist

- Enable Supabase RLS (Row Level Security)
- Rotate keys periodically
- Use separate Supabase project for production
- Rate limit API routes
- Enable HTTPS (Vercel handles this)

### Secrets Management

- Never commit `.env` to Git
- Use `.env.local` for local development
- Add `.env.example` to repo with placeholders
```

---

## 16. Licensing

Add a licensing section:

```markdown
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
```

---

## 17. Showcase / Features

Expand your feature list:

```markdown
## Features

- ✨ **Immersive Storytelling** — AI DM with rich narrative
- 🎲 **Full Combat Tracker** — Initiative, attacks, damage
- 📚 **Scoped RAG** — Adventure-aware knowledge retrieval
- 📖 **Auto Journal** — Campaign journal built automatically
- 🧙 **Character Sheets** — Premade + custom character support
- 💀 **Death Resolution** — Narrative continues after player death
- 🔄 **Session Resume** — Pause and continue anytime
- 📱 **Mobile-Ready** — Touch-friendly interface
```

---

## 18. Roadmap

```markdown
## Roadmap

### Phase 1: Foundation (✅ Complete)

- Schema design
- Document ingestion
- Project setup

### Phase 2: Core Features (✅ Complete)

- RAG pipeline
- Combat tracking
- Journal system

### Phase 3: Polish (🔲 Planned)

- PDF export
- Advanced UI theming
- Multi-platform support
- Custom spell/monster editor
```

---

## 19. Credits

```markdown
## Credits

- **Base Models**: Ollama (Llama 3), Groq
- **Vector Embeddings**: mxbai-embed-large
- **Database**: Supabase (PostgreSQL + pgvector)
- **UI**: Tailwind CSS, Next.js

**Special Thanks**:

- D&D Open Game License content
- D&D Beyond (for inspiration)
- Open-source community
```
