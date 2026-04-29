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

### 2. D&D-Aware Text Splitting

Standard fixed-size chunking breaks D&D source material in ways that destroy meaning — a monster's stat block split across two chunks, a spell's casting time separated from its effect, a table row orphaned from its headers. The app uses a three-splitter pipeline specifically designed for D&D document structure.

#### `DndTextSplitter`

Splits text by structural section boundaries before falling back to size-based chunking. It first attempts to divide text on chapter titles (`# Monsters`), section headers (`## Actions`), sub-sections (`### Stats`), and named D&D sections (`Actions:`, `Reactions:`, `Traits:`, `Lore:`). Sections that still exceed `chunkSize` after this pass are handed to `RecursiveCharacterTextSplitter` with a D&D-aware separator hierarchy (`\n\n` → `\n` → `. ` → ` ` → character-level fallback).

#### `TableSplitter`

Markdown tables in D&D books (monster lists, spell tables, equipment lists) are structurally distinct from prose — they should not be mid-row chunked or mixed with surrounding text. `TableSplitter` extracts all Markdown tables from the input first, converts each to a set of labelled key-value `Document` objects, then strips the table rows from the remaining prose before passing it through the overlap-aware text chunker. This ensures every table row becomes its own retrievable document with clean metadata.

Table type (`monsters`, `spells`, `items`) is inferred automatically from headers and surrounding context using a keyword matching approach — headers like `CR`, `Hit Points`, `AC` resolve to `monsters`; `Casting Time`, `Duration`, `School` resolve to `spells`; and so on.

#### `SplitterFactory`

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

### 3. Adventure & Character Selection

Before a session begins, the player selects an adventure and a hero from a roster of premade characters stored in the database. The chosen `adventure_slug` is persisted to the session row and carried through every subsequent request — routing RAG queries, setting the DM's tone, and determining which encounter stat blocks to spawn in combat.

Each character comes fully built with name, race, class, background, ability scores, HP, AC, equipment, personality traits, ideals, bonds, flaws, and features.

Character details are persisted to the session and injected into every DM system prompt, so the LLM always knows who it's talking to. A **"Who am I?"** button in the session header lets you ask the DM to describe your character at any time.

### 4. Opening Narration

When a new session is created, the app immediately generates an immersive opening narration — before the player types a single word. Each adventure has its own scene-setting prompt:

- **Lost Mine of Phandelver** — the Triboar Trail, a wagon, goblins springing an ambush
- **Ghosts of Saltmarsh** — the salty docks, rumours of a haunted clifftop mansion
- **Tales from the Yawning Portal** — the warm tavern, the great well, a stranger with a map

No "Welcome to the adventure." No prompts. Just the world.

### 5. Advanced RAG Pipeline (Every Message)

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

### 6. Structured DM Output

Every DM response is structured into three parts via prompt instructions and parsed before rendering:

- **Narrative** — the pure story prose shown in the chat bubble
- **`[STATUS]` block** — 2–4 bullet points summarizing the current situation (active quests, known threats, key NPCs), rendered as a "Quest Status" card below the narrative instead of bleeding into the prose
- **`[HINTS]` block** — 3–4 suggested next actions tagged by type (Explore, Social, Action, Lore), rendered as a collapsible "What can I do?" panel the player can expand after any DM response

The raw tagged string is always stored in Supabase. Parsing is display-only, so journal generation, conversation history injection, and combat parsing all continue to operate on the full content unchanged.

Each DM message is rendered by `DMMessage` in `components/ChatMessage.tsx`, which calls `parseDMResponse(message.content)` at render time for historical messages and uses the hook's live `parsedDM` state for the actively streaming message. This ensures `[STATUS]` and `[HINTS]` are never shown as raw text — for new messages or messages loaded from the database.

A two-pass fallback parser handles legacy messages and cases where the LLM drifts from the format: pass 1 catches labeled blocks like `Combat State: * ...`; pass 2 catches status-flavored sentences at paragraph boundaries. Hints are only rendered for structured responses.

### 7. Combat System

When combat begins, the app transitions into a structured turn-based mode:

- **Encounter detection** identifies which encounter is starting based on context and spawns the correct monster stat blocks automatically
- **Monster initiatives** are rolled server-side; the **player rolls their own initiative** via an animated dice widget that appears inline in the chat
- **Combat state** is persisted to Supabase — surviving a refresh or reconnect
- The **DM system prompt** is rebuilt each turn with full combat context injected: initiative order, HP, AC, conditions, and recent action log
- **Turn ownership** is enforced strictly: on monster turns, the DM narrates and resolves enemy actions without prompting the player; on the player's turn, the DM emits a structured roll request
- **Dice roll widgets** appear inline in the chat whenever the DM requires a roll — attack rolls (with hit/miss resolved against target AC), ability checks, saving throws, and damage rolls all use the same animated d20/dX interface
- **Damage events** are parsed from the DM's narrative and applied to combatant HP
- **Conditions** (poisoned, prone, grappled, etc.) are tracked per combatant
- Combat ends when all monsters (or the player) reach 0 HP — the DM narrates the outcome and the session returns to exploration mode

### 8. Death Resolution System

Reaching 0 HP never ends the session. Instead, the app treats player death as a **narrative pivot point** — the story continues, but the situation changes dramatically. When the player drops to 0 HP, a resolution type is selected at random from four possible outcomes, each of which is narrated by the DM as a seamless story beat.

**Resolution Types:**

- **Capture** — The enemies choose not to kill the player. They stabilize them (1 HP), strip their weapons and gear, and drag them to a holding cell. The player awakens imprisoned; their task is to escape.
- **Mysterious Benefactor** — A cloaked figure arrives at the last moment, drives off the attackers, and stabilizes the player (1 HP). Their motives are unclear. This NPC becomes a story thread.
- **The Pact** — At the threshold of death, the player experiences a vision. A powerful entity — a deity, archfey, or devil — offers a second chance in exchange for a future, unspecified favor. The player awakens at 1 HP bearing a faint mark. A new quest thread begins.
- **Corpse Run** — A traveling priest discovers the body and performs a minor resurrection, reviving the player at 1 HP. The player is marked by death: a **Death Curse** condition (-2 to all d20 rolls) is applied and persists until they complete a specific task.

**How it works under the hood:**

When `applyDamage` brings the player to 0 HP, `isPlayerDead()` fires in `processCombatStateUpdate`. A resolution type is selected by `selectDeathResolution()`, the player's HP is immediately reset to 1 in the combatants array, and a `deathResolution: { type, applied: false }` object is written to `combat_state` in Supabase. On the `corpse_run` path, the Death Curse condition is also appended to the player's conditions array at this moment.

On the next chat turn, `buildDMSystemPrompt` detects the unresolved death (`applied: false`) and injects a detailed resolution script into the system prompt — instructing the DM exactly how to narrate the scene for that resolution type. The DM narrates the scene as pure story without prompting for dice rolls. After that response is processed, `applied` is set to `true` and normal combat logic resumes.

The resolution is stored in `combat_state.combatants` (JSONB), so it survives page refreshes and session resumes correctly.

### 9. Session Sidebar

The session page includes a persistent sidebar with three tabs:

- **Character** — name, race/class/level, background, HP, AC, and all six ability scores with modifiers calculated automatically.
- **Combat** — live initiative order sorted by roll, HP bars that shift green → amber → red as combatants take damage, AC and initiative values, active conditions, and a scrollable combat log. Shows a "waiting for initiative roll" state when combat has just started. Auto-switches to this tab when combat begins.
- **Log** — session stats (message count, DM responses, combat rounds), a D&D 5e quick reference card, and clickable phrase shortcuts that pre-fill the input box.

### 10. Session Journal & Save System

Sessions are never lost. When you're done playing, you have two options:

- **Save & Pause** — generates a narrative journal entry in the voice of your character, sets the session to `paused`, and returns you to the home screen. All state is preserved: messages, combat, character context. A "Continue Adventure" button on the home and journal screens picks up exactly where you left off, with a short re-entry narration from the DM to reorient you.
- **End Campaign** — generates the journal entry and marks the session `completed`. The session becomes read-only and is preserved in your journal archive.

Sessions carry one of three statuses: `active`, `paused`, or `completed`.

Journal entries are written in first-person past tense — evocative prose, not a bullet summary — capturing key events, decisions, encounters, and emotional beats. Each entry is saved and can be reviewed at any time from the journal page.

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

## Database Schema

### documents

Stores metadata for each source book. The `category` and `adventure_slug` columns are used by the scoped RAG function to filter chunks per session.

```
id, title, type, category ('core' | 'adventure'), adventure_slug
```

### chunks

Each chunk is a ~500 character passage from a source document, stored with its vector embedding. Indexed for fast similarity search with pgvector.

```
id, document_id, content, embedding (vector), page
```

### sessions

One row per play session. Stores session title, status, character context, the active adventure slug, and the generated journal entry.

```
id, user_id, title, created_at, journal_entry, status, character_context, adventure_slug, narrative_flags
```

### characters

One row per premade character. Stores the full character sheet including stats, equipment, personality, and traits.

```
id, name, race, class, background, alignment, level,
str, dex, con, int, wis, cha,
max_hp, ac, speed, hit_dice, proficiency_bonus, passive_wisdom,
personality_traits, ideals, bonds, flaws,
features_and_traits (jsonb), equipment (jsonb), notes
```

### messages

Every message in a session — both player and DM — stored in order for conversation history and journal generation. The opening narration is stored here as the first assistant message when a session is created. Message content is always stored as the raw tagged string (including `[STATUS]` and `[HINTS]` blocks); parsing is handled at render time.

```
id, session_id, role (user|assistant), content, created_at
```

### combat_state

One row per active session. Persists the full combat snapshot — initiative order, HP, conditions, turn index, round number, action log, whether the player still needs to roll their initiative, and the current death resolution (if any).

```
id, session_id, is_active, round, current_turn_index,
combatants (jsonb), log (jsonb), awaiting_player_initiative (boolean),
updated_at
```

The `combatants` JSONB array includes a `deathResolution` field on the combat state object when active:

```ts
deathResolution?: {
  type: 'capture' | 'benefactor' | 'pact' | 'corpse_run';
  applied: boolean;
}
```

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

## DM Response Format

The system prompt instructs the LLM to append two structured blocks at the end of every response. These are parsed by `lib/parse-dm-response.ts` and never shown to the player as raw text.

```
[STATUS]
* You've gathered supplies in Phandalin
* The Redbrands are rumored to be watching the temple
[/STATUS]

[HINTS]
[social] Talk to the priestess | I head to the Shrine of Luck and ask the priestess for her blessing.
[explore] Leave for the temple | I set out from Phandalin toward the lost temple.
[lore] Ask about the Black Spider | I ask around town if anyone knows who the Black Spider is.
[/HINTS]
```

Valid hint tags are `explore`, `social`, `action`, and `lore`. Each hint has a short display label (`text`) and a full prompt string (`prompt`) that fires into the chat when the player clicks it.

`parseDMResponse()` returns a `ParsedDMResponse` with three fields:

```ts
interface ParsedDMResponse {
  narrative: string; // pure story prose, [STATUS]/[HINTS] stripped
  statusItems: string[]; // bullet items from [STATUS]
  hints: HintItem[]; // { tag, text, prompt } from [HINTS]
}
```

`DMMessage` in `components/ChatMessage.tsx` calls this at render time for every message. The actively streaming message uses `parseDMResponsePartial()` via `parsedDM` from `useChat`, which exposes the narrative live as tokens arrive while holding back incomplete tag blocks.

If the LLM drifts from this format, the fallback parser in `parseDMResponse()` attempts to extract status items heuristically from the raw prose. Hints are only rendered for properly structured responses.

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
── Player reaches 0 HP ────────────────────────────────────
isPlayerDead() fires in processCombatStateUpdate
selectDeathResolution() picks one of four outcomes at random
Player HP reset to 1; Death Curse condition applied if corpse_run
deathResolution: { type, applied: false } written to combat_state
        ↓
Next DM turn: buildDMSystemPrompt injects resolution narrative script
DM narrates the scene (capture / rescue / vision / resurrection)
No dice rolls prompted — pure story beat
        ↓
applied set to true; normal combat loop resumes
        ↓
Repeat until combat ends
```

---

## Death Resolution Flow

```
applyDamage() brings player to 0 HP
        ↓
isPlayerDead(state) returns true
        ↓
selectDeathResolution() returns one of:
  'capture' | 'benefactor' | 'pact' | 'corpse_run'
        ↓
Player HP reset to 1 in combatants array
If 'corpse_run': "Death Curse: -2 to all rolls" added to conditions
        ↓
state.deathResolution = { type, applied: false }
upsertCombatState() persists to Supabase
        ↓
── Next chat turn ─────────────────────────────────────────
buildDMSystemPrompt detects deathResolution.applied === false
Injects resolution-specific narrative instructions into system prompt
DM narrates the scene; no roll widgets, no turn advancement
        ↓
processCombatStateUpdate detects applied === false at turn start
Sets applied = true, upsertCombatState()
Returns early — skips damage parsing and turn advance for this turn
        ↓
Adventure continues from new narrative position
```

---

## Session Resume Flow

```
Player clicks "Save & Pause"
        ↓
POST /api/journal { sessionId, messages, pause: true }
        ↓
Journal entry generated from full conversation history
        ↓
PATCH /api/journal/[id] { journal_entry, status: "paused" }
        ↓
Session status set to "paused" — all state preserved in DB
        ↓
Player returns to home screen
        ↓
Paused session shown with "Continue Adventure" button
        ↓
Player clicks Continue → navigated to /session/[id]
        ↓
Session page detects status: "paused" + existing messages
        ↓
Opening narration skipped — message history loaded from DB
        ↓
One-time re-entry narration generated from journal entry
        ↓
Combat state rehydrated if a fight was in progress
        ↓
Adventure resumes
```

---

## Supabase Setup

Enable the pgvector extension:

```sql
create extension if not exists vector;
```

Add `category` and `adventure_slug` columns to the `documents` table:

```sql
alter table documents add column if not exists category text default 'core';
alter table documents add column if not exists adventure_slug text;
```

Create the scoped similarity search function (replaces the original `match_chunks`):

```sql
create or replace function match_chunks_scoped(
  query_embedding vector,
  adventure_slug text,
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
    c.id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where d.category = 'core'
     or d.adventure_slug = adventure_slug
  order by c.embedding <=> query_embedding
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

Create the characters table:

```sql
create table characters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  race text,
  class text,
  background text,
  alignment text,
  level int default 1,
  str int, dex int, con int, int int, wis int, cha int,
  max_hp int,
  ac int,
  speed int,
  hit_dice text,
  proficiency_bonus int,
  passive_wisdom int,
  personality_traits text,
  ideals text,
  bonds text,
  flaws text,
  features_and_traits jsonb default '[]'::jsonb,
  equipment jsonb default '[]'::jsonb,
  notes text
);
```

Add columns to the sessions table:

```sql
alter table sessions add column if not exists character_context text;
alter table sessions add column if not exists adventure_slug text default 'lost-mine-of-phandelver';
alter table sessions add column if not exists narrative_flags jsonb default '{}'::jsonb;
```

> **Note:** If you created the `combat_state` table before the initiative roll feature was added, run this migration:
>
> ```sql
> alter table combat_state
>   add column if not exists awaiting_player_initiative boolean default false;
> ```

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
OLLAMA_EMBED_MODEL=nomic-embed-text
OLLAMA_CHAT_MODEL=llama3
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
