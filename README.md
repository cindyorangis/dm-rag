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

## Campaign: Lost Mine of Phandelver

The initial release is built around Lost Mine of Phandelver — a classic starter adventure set in the Forgotten Realms. The app has full knowledge of this module's locations, NPCs, factions, encounters, and story beats.

The four source documents loaded into the knowledge base are:

- Lost Mine of Phandelver — the adventure module
- Player's Handbook (PHB) — rules, spells, classes, races
- Dungeon Master's Guide (DMG) — rulings, tables, guidance
- Monster Manual (MM) — stat blocks and lore for all creatures

When you ask a rules question, describe an action, or enter combat, the app retrieves the most relevant passages from these books and uses them to ground its response — ensuring it plays by the actual rules, not hallucinated ones.

---

## How It Works

### 1. Document Ingestion (One-Time Setup)

Each source book is parsed, chunked into ~500 token sections, and converted into vector embeddings via Ollama. These embeddings are stored in a Supabase database using the pgvector extension, enabling semantic search across all four books simultaneously.

### 2. Character Creation

Before a session begins, the player is presented with an optional character sheet. They can fill in name, race, class, background, ability scores, HP, AC, level, and freeform notes (equipment, spells, traits, backstory). All fields are optional — if left blank, the DM generates an adventurer automatically and remembers it for the full session.

Character details are persisted to the session and injected into every DM system prompt, so the LLM always knows who it's talking to. A **"Who am I?"** button in the session header lets you ask the DM to describe your character at any time.

### 3. Opening Narration

When a new session is created, the app immediately generates an immersive opening narration — before the player types a single word. The DM sets the scene on the Triboar Trail, establishes the atmosphere, and drops the player directly into the goblin ambush. No "Welcome to the adventure." No prompts. Just the world.

### 4. RAG Pipeline (Every Message)

When you send a message — whether it's "I attack the goblin" or "What are the rules for grappling?" — the following happens:

- Your message is embedded into a vector using Ollama
- The top 6 most relevant chunks are retrieved from Supabase via cosine similarity search
- Those chunks are injected as context into the DM system prompt
- The LLM responds in character as your DM, grounded in the retrieved rules
- The response streams token-by-token to the UI
- Both messages are persisted to the database when the stream completes

### 5. Combat System

When combat begins, the app transitions into a structured turn-based mode:

- **Encounter detection** identifies which LMoP encounter is starting based on context (Triboar Trail ambush, Cragmaw Hideout, Redbrand alley, Wave Echo Cave, etc.) and spawns the correct monster stat blocks automatically
- **Monster initiatives** are rolled server-side; the **player rolls their own initiative** via an animated dice widget that appears inline in the chat
- **Combat state** is persisted to Supabase — surviving a refresh or reconnect
- The **DM system prompt** is rebuilt each turn with full combat context injected: initiative order, HP, AC, conditions, and recent action log
- **Turn ownership** is enforced strictly: on monster turns, the DM narrates and resolves enemy actions without prompting the player; on the player's turn, the DM emits a structured roll request
- **Dice roll widgets** appear inline in the chat whenever the DM requires a roll — attack rolls (with hit/miss resolved against target AC), ability checks, saving throws, and damage rolls all use the same animated d20/dX interface
- **Damage events** are parsed from the DM's narrative and applied to combatant HP
- **Conditions** (poisoned, prone, grappled, etc.) are tracked per combatant
- Combat ends when all monsters (or the player) reach 0 HP — the DM narrates the outcome and the session returns to exploration mode

Monster stat blocks for all Lost Mine of Phandelver encounters are pre-loaded (goblins, bugbears, the Goblin Boss, wolves, owlbear, Nezznar the Black Spider, and more).

### 6. Session Sidebar

The session page includes a persistent sidebar with three tabs:

- **Character** — name, race/class/level, background, HP, AC, and all six ability scores with modifiers calculated automatically. Falls back to an "Ask the DM" prompt if no sheet was filled in.
- **Combat** — live initiative order sorted by roll, HP bars that shift green → amber → red as combatants take damage, AC and initiative values, active conditions, and a scrollable combat log. Shows a "waiting for initiative roll" state when combat has just started. Auto-switches to this tab when combat begins.
- **Log** — session stats (message count, DM responses, combat rounds), a D&D 5e quick reference card, and clickable phrase shortcuts that pre-fill the input box.

### 7. Session Journal (End of Session)

When you end a session, the full conversation history is sent to the LLM with a journaling prompt. It generates a narrative entry written in the voice of the player's character — capturing key events, decisions, and outcomes in first-person prose. Each journal entry is saved and can be reviewed at any time.

---

## Tech Stack

| Layer      | Choice                            | Notes                                             |
| ---------- | --------------------------------- | ------------------------------------------------- |
| Frontend   | Next.js (App Router) + TypeScript | App Router, server and client components          |
| Styling    | Tailwind CSS                      | Dark fantasy / parchment UI theme                 |
| LLM        | Ollama (Llama 3)                  | Local inference, no API cost                      |
| Embeddings | Ollama (nomic-embed-text)         | Local embeddings, matches ingestion model         |
| Vector DB  | Supabase pgvector                 | Cosine similarity via `<=>` operator              |
| Database   | Supabase (PostgreSQL)             | Sessions, messages, journal entries, combat state |
| Hosting    | Vercel                            | Free tier, zero-config Next.js deploys            |

---

## Database Schema

### documents

Stores metadata for each source book (name, type, version).

### chunks

Each chunk is a ~500 token passage from a source document, stored with its vector embedding. Indexed for fast similarity search with pgvector.

```
id, document_id, content, embedding (vector), page, section
```

### sessions

One row per play session. Stores session title, status, character context, and the generated journal entry.

```
id, user_id, title, created_at, journal_entry, status, character_context
```

### messages

Every message in a session — both player and DM — stored in order for conversation history and journal generation. The opening narration is stored here as the first assistant message when a session is created.

```
id, session_id, role (user|assistant), content, created_at
```

### combat_state

One row per active session. Persists the full combat snapshot — initiative order, HP, conditions, turn index, round number, action log, and whether the player still needs to roll their initiative.

```
id, session_id, is_active, round, current_turn_index,
combatants (jsonb), log (jsonb), awaiting_player_initiative (boolean),
updated_at
```

---

## Project Structure

```
app/
  api/
    chat/route.ts                     # RAG pipeline + combat state updates
    sessions/route.ts                 # Session CRUD + opening narration generation
    sessions/[id]/route.ts            # Fetch a single session (character context etc.)
    sessions/[id]/messages/route.ts   # Fetch messages for a session
    combat/[id]/route.ts              # GET combat state; PATCH to submit player initiative
    journal/route.ts                  # Journal generation
    journal/[id]/route.ts             # Fetch a single journal entry
  session/[id]/page.tsx               # Active play session (chat + sidebar UI)
  journal/page.tsx                    # Journal list
  journal/[id]/page.tsx               # Single journal entry
  page.tsx                            # Home + character creation flow
lib/
  supabase.ts                         # Supabase client (browser + admin)
  rag.ts                              # embedText() + retrieveChunks()
  dm-prompt.ts                        # DM system prompt builder — injects combat state,
                                      # character context, and strict turn instructions
  combat/
    types.ts                          # Combatant, CombatState, CombatLogEntry types
    dice.ts                           # roll(), rollAttack(), rollDamage(), rollInitiative()
    engine.ts                         # Pure state machine: advanceTurn, applyDamage, etc.
    detector.ts                       # detectCombatStart(), parseDamageFromNarrative()
    encounters.ts                     # LMoP monster stat blocks, encounter definitions,
                                      # detectEncounterKey(), buildEncounterMonstersOnly()
    repository.ts                     # getCombatState(), upsertCombatState()
hooks/
  useChat.ts                          # Chat state, streaming, initiative flag,
                                      # pendingRolls parsed from DM [ROLL:] tags
scripts/
  ingest.ts                           # One-time document ingestion pipeline
```

---

## App Structure

### Pages

- `/` — Home / character creation / start new session
- `/session/[id]` — Active play session (chat UI + character/combat/log sidebar)
- `/journal` — Browse past session journal entries
- `/journal/[id]` — Single session journal entry

### API Routes

- `POST /api/sessions` — Create a new session, generate and persist the opening narration
- `GET /api/sessions` — List all sessions (for journal page)
- `GET /api/sessions/[id]` — Fetch a single session including character context
- `GET /api/sessions/[id]/messages` — Fetch all messages for a session
- `POST /api/chat` — RAG pipeline: embed → retrieve → stream LLM response + update combat state
- `GET /api/combat/[id]` — Fetch current combat state for a session
- `PATCH /api/combat/[id]` — Submit player initiative roll; re-sorts combatants and clears awaiting flag
- `POST /api/journal` — End-of-session journal generation
- `GET /api/journal/[id]` — Fetch a single session with journal entry

---

## Combat Flow

```
Player message triggers combat
        ↓
detectCombatStart() fires in chat/route.ts
        ↓
detectEncounterKey() identifies the encounter from context
        ↓
buildEncounterMonstersOnly() spawns correct monster stat blocks
        ↓
rollAllInitiatives() rolls d20 + mod for every monster
        ↓
combat_state saved with awaiting_player_initiative: true
        ↓
SSE done event includes awaitingInitiative: true
        ↓
InitiativeRoller widget appears inline in chat
        ↓
Player clicks die → animated roll → confirms result
        ↓
PATCH /api/combat/[id] applies player total, sorts all combatants
        ↓
Combat sidebar populates with full initiative order + HP bars
        ↓
── Player's turn ──────────────────────────────────────────
DM prompt instructs: emit [ROLL: attack d20+X vs AC Y target:Z]
useChat parses [ROLL:] tags → DiceRoller widget appears
Player rolls → result sent back as player message
DM narrates outcome
        ↓
── Monster's turn ─────────────────────────────────────────
DM prompt instructs: resolve monster action fully, do NOT prompt player
DM narrates attack, rolls dice itself, applies damage
Chains through all monster turns until player's turn comes around
        ↓
Repeat until combat ends
```

---

## Supabase Setup

Enable the pgvector extension and create the similarity search function:

```sql
create extension if not exists vector;

create or replace function match_chunks(
  query_embedding vector,
  match_count int default 6
)
returns table (
  id uuid,
  content text,
  similarity float
)
language sql stable
as $$
  select
    id,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from chunks
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

Create the combat state table:

```sql
create table combat_state (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null unique,
  is_active boolean default false,
  round int default 1,
  current_turn_index int default 0,
  combatants jsonb default '[]'::jsonb,
  log jsonb default '[]'::jsonb,
  awaiting_player_initiative boolean default false,
  updated_at timestamptz default now()
);
```

Add the character context column to sessions:

```sql
alter table sessions add column if not exists character_context text;
```

> **Note:** If you created the `combat_state` table before the initiative roll feature was added, run this migration:
> ```sql
> alter table combat_state
>   add column if not exists awaiting_player_initiative boolean default false;
> ```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Ollama installed and running locally
- Supabase account (free)
- Vercel account for deployment (free)

### Pull required Ollama models

```bash
ollama pull llama3
ollama pull nomic-embed-text
```

> Run `ollama list` to verify your installed model names. The chat model name in your `.env.local` must exactly match what Ollama reports (e.g. `llama3.2` instead of `llama3`).

### Environment Variables

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=llama3
```

### Local Development

```bash
npm install
npm run dev
```

### Document Ingestion

Place your source PDFs in `/scripts/books/` and run:

```bash
npm run ingest
```

This only needs to be run once. Chunks and embeddings are persisted in Supabase.

---

## Build Status

| Phase | Description                                                       | Status      |
| ----- | ----------------------------------------------------------------- | ----------- |
| 1     | Foundation — schema, ingestion, project setup                     | ✅ Complete |
| 2     | RAG pipeline — embed, retrieve, stream, persist                   | ✅ Complete |
| 3     | DM logic — combat tracking, dice, NPC state                       | ✅ Complete |
| 4     | Journal — generation, storage, list + detail views                | ✅ Complete |
| 5     | Character creation — sheet UI, context injection                  | ✅ Complete |
| 6     | Opening narration — immersive session intro                       | ✅ Complete |
| 7     | Session sidebar — character stats, combat tracker, log            | ✅ Complete |
| 8     | Player dice rolling — initiative, attacks, checks, saves, damage  | ✅ Complete |
| 9     | Turn enforcement — monsters resolve fully before player is prompted| ✅ Complete |
| 10    | Encounter detection — correct monsters spawned per LMoP location  | ✅ Complete |
| 11    | Polish — UI theme, mobile, PDF export                             | 🔲 Upcoming |

---

May your rolls be high and your traps be few.
🐉