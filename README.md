# ⚔️  The Dungeon Master
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
Each source book is parsed, chunked into sections, and converted into vector embeddings. These embeddings are stored in a Supabase database using the pgvector extension, enabling semantic search across all four books simultaneously.

### 2. RAG Pipeline (Every Message)
When you send a message — whether it's 'I attack the goblin' or 'What are the rules for grappling?' — the following happens:

- Your message is embedded into a vector
- The top relevant chunks are retrieved from the knowledge base
- Those chunks are injected as context into the LLM prompt
- The LLM responds in character as your DM, grounded in the retrieved rules

### 3. Session Journal (End of Session)
When you end a session, the full conversation history is sent to the LLM with a journaling prompt. It generates a narrative summary written in the voice of a scribe or party member — capturing key events, decisions, and outcomes in a story format.
Each journal entry is saved to your session history and can be reviewed at any time.

---

## Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Next.js (App Router) + TypeScript | Familiar stack, fast iteration |
| Styling | Tailwind CSS | Dark fantasy / parchment UI theme |
| LLM | Gemini 2.0 Flash | Free tier, 1,500 req/day, large context |
| Embeddings | Gemini text-embedding-004 | Free, included with Gemini API |
| Vector DB | Supabase pgvector | Free tier, native similarity search |
| Database | Supabase (PostgreSQL) | Sessions, messages, journal entries |
| Auth | Supabase Auth | Single user DM login |
| Hosting | Vercel | Free tier, zero-config Next.js deploys |

All components operate within free tier limits. The only cost is your time.

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
One row per play session. Stores session date, title, a raw transcript reference, and the generated journal entry.

```
id, user_id, title, created_at, journal_entry, status
```

### messages
Every message in a session — both player and DM — stored in order for conversation history and journal generation.

```
id, session_id, role (user|assistant), content, created_at
```

---

## App Structure
### Pages
- `/`  — Home / new session
- `/session/[id]`  — Active play session (main chat UI)
- `/journal`  — Browse past session journal entries
- `/journal/[id]`  — Single session journal entry

### Key API Routes
- `POST /api/chat`  — Main RAG pipeline: embed query → retrieve chunks → call Gemini → stream response
- `POST /api/journal`  — End-of-session journal generation
- `POST /api/ingest`  — One-time document ingestion (admin only)

---

## UI & Experience
The interface is designed to feel like a D&D session, not a chat app. The aesthetic draws from dark fantasy — candlelit parchment tones, weathered textures, serif typography — while remaining clean and readable.

### Chat Interface
- DM responses appear as styled narrative blocks
- Player input is clean and minimal
- Dice rolls are surfaced visually when they occur
- Combat state (HP, initiative) shown in a sidebar panel

### Journal View
- Past sessions listed as aged scroll entries
- Each journal rendered as a narrative story excerpt
- Exportable as plain text or PDF

---

## Build Phases
### Phase 1 — Foundation
- Next.js project setup with Supabase
- Supabase schema (documents, chunks, sessions, messages)
- Document ingestion script (PDF → chunks → embeddings → pgvector)
- Basic chat UI shell

### Phase 2 — RAG Pipeline
- Query embedding and similarity search
- Gemini API integration with DM system prompt
- Streamed responses in the chat UI
- Conversation history management

### Phase 3 — DM Logic
- Combat tracking (initiative, HP, turn order)
- Dice roll parsing and resolution
- NPC and location state persistence
- Lost Mine of Phandelver story state tracking

### Phase 4 — Journal
- End-of-session journal generation prompt
- Journal storage and retrieval
- Styled journal view with session history

### Phase 5 — Polish
- Dark fantasy UI theme
- Mobile responsiveness
- Export journal as PDF
- Optional: dice roller UI

---

## Getting Started
### Prerequisites
- Node.js 18+
- Supabase account (free)
- Google AI Studio account for Gemini API key (free)
- Vercel account for deployment (free)

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_google_ai_studio_key
```

### Local Development
```
npm install
npm run dev
```

### Document Ingestion
Place your source PDFs in /scripts/books/ and run:

```
npm run ingest
```

This only needs to be run once. Chunks and embeddings are persisted in Supabase.

---

May your rolls be high and your traps be few.
🐉