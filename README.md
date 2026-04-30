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
| Ghosts of Saltmarsh           | Saltmarsh, Greyhawk         | 1–12   | 🔲 Coming soon |
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

Each PDF is parsed, chunked into ~500 character sections with 100-character overlap, and converted into vector embeddings via Ollama. Chunks are stored in Supabase with `pgvector`, tagged with their source document's `category` (`core` or `adventure`) and `adventure_slug`. This tagging enables scoped RAG retrieval — each session only searches chunks from its own adventure plus the core rulebooks.

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
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
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
