# Setup & Schema

---

## Database Schema (Supabase)

Supabase handles all relational data — sessions, messages, characters, combat state, and observability metrics. Vector storage has moved to Qdrant Cloud.

### documents

> **Deprecated** — No longer used for vector storage. Qdrant payload fields (`category`, `adventure_slug`, `source`) replace this table's role in scoped RAG filtering. This table can be retained for reference or dropped safely.

### sessions

One row per play session. Stores session title, status, character context, the active adventure slug, generated journal entry, and rolling memory-compression state for long chats (both narrative and structured memory).

```
id, user_id, title, created_at, journal_entry, status, character_context, adventure_slug, narrative_flags, memory_summary, memory_structured, memory_summary_message_count
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

### turn_metrics

One row per DM turn, used for observability dashboards and quality/cost tuning. Captures token estimates, latency, retrieval effectiveness, hint quality, and combat-format/rules violations.

```
id, session_id, adventure_slug, provider,
prompt_tokens_estimated, completion_tokens_estimated, total_tokens_estimated,
llm_latency_ms, first_token_latency_ms,
rag_chunks_requested, rag_chunks_returned, rag_hit_rate, rag_avg_similarity, rag_high_confidence_rate,
status_items_count, hint_count, hint_diversity_count, hint_quality_score,
combat_rule_error_count, combat_rule_errors (jsonb), created_at
```

---

## Supabase Setup

### combat_state

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

> **Note:** If you created `combat_state` before the initiative roll feature was added, run:
>
> ```sql
> alter table combat_state
>   add column if not exists awaiting_player_initiative boolean default false;
> ```

### turn_metrics

```sql
create table if not exists turn_metrics (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade not null,
  adventure_slug text not null,
  provider text not null,
  prompt_tokens_estimated int not null default 0,
  completion_tokens_estimated int not null default 0,
  total_tokens_estimated int not null default 0,
  llm_latency_ms int not null default 0,
  first_token_latency_ms int,
  rag_chunks_requested int not null default 0,
  rag_chunks_returned int not null default 0,
  rag_hit_rate numeric(6,3) not null default 0,
  rag_avg_similarity numeric(6,3),
  rag_high_confidence_rate numeric(6,3),
  status_items_count int not null default 0,
  hint_count int not null default 0,
  hint_diversity_count int not null default 0,
  hint_quality_score numeric(6,3) not null default 0,
  combat_rule_error_count int not null default 0,
  combat_rule_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists turn_metrics_session_id_idx
  on turn_metrics(session_id, created_at desc);
```

### characters

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

### sessions columns

```sql
alter table sessions add column if not exists character_context text;
alter table sessions add column if not exists adventure_slug text default 'lost-mine-of-phandelver';
alter table sessions add column if not exists narrative_flags jsonb default '{}'::jsonb;
alter table sessions add column if not exists memory_summary text;
alter table sessions add column if not exists memory_structured jsonb default '{}'::jsonb;
alter table sessions add column if not exists memory_summary_message_count int not null default 0;
```

---

## Qdrant Cloud Setup

Vector storage — chunk embeddings and scoped RAG retrieval — runs entirely in Qdrant Cloud. Supabase pgvector is no longer used.

### 1. Create a cluster

Sign up at [cloud.qdrant.io](https://cloud.qdrant.io) and create a free cluster. Copy the cluster URL and API key into your `.env.local`:

```bash
QDRANT_URL=https://your-cluster.qdrant.io
QDRANT_API_KEY=your_qdrant_api_key
QDRANT_COLLECTION=dnd_chunks
```

### 2. Run ingestion

The ingestion script creates the collection and all required payload indexes automatically on first run:

```bash
pip install qdrant-client cohere pymupdf python-dotenv
python scripts/ingest.py
```

This is the only setup step required. No manual collection or index creation is needed.

### 3. What gets created automatically

`ingest.py → ensure_collection()` creates:

**Collection** — `dnd_chunks` with cosine similarity, 1024-dimensional vectors (Cohere `embed-english-v3.0`):

```
VectorParams(size=1024, distance=Distance.COSINE)
```

**Payload indexes** — required for filtered scroll (deduplication) and scoped search:

| Field            | Type    | Used for                                      |
| ---------------- | ------- | --------------------------------------------- |
| `source`         | keyword | Deduplication check during ingestion          |
| `chunk_index`    | integer | Deduplication check during ingestion          |
| `category`       | keyword | Scoping search to `core` or `adventure`       |
| `adventure_slug` | keyword | Scoping search to the active adventure module |

**Full-text index on `content`** — required for keyword search leg of hybrid retrieval. Create this once manually via the Qdrant Cloud console or with a one-time request:

```bash
curl -X PUT \
  "$QDRANT_URL/collections/dnd_chunks/index" \
  -H "api-key: $QDRANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"field_name": "content", "field_schema": "text"}'
```

Without this index, `calculateKeywordScores()` will throw and gracefully fall back to vector-only retrieval.

### 4. Chunk payload schema

Each point stored in Qdrant has the following payload:

```json
{
  "content": "The goblin snarls and draws its blade...",
  "source": "DungeonMastersGuide2024.pdf",
  "category": "core",
  "adventure_slug": "",
  "chunk_index": 42,
  "chunk_type": "text",
  "page": 17
}
```

For adventure chunks, `category` is `"adventure"` and `adventure_slug` is the folder name (e.g. `"lost-mine-of-phandelver"`).

### 5. Scoped retrieval filter

`rag.ts → scopedFilter(adventureSlug)` builds a Qdrant `should` filter that matches core rulebooks **or** the active adventure:

```json
{
  "should": [
    { "key": "category", "match": { "value": "core" } },
    {
      "must": [
        { "key": "category", "match": { "value": "adventure" } },
        {
          "key": "adventure_slug",
          "match": { "value": "lost-mine-of-phandelver" }
        }
      ]
    }
  ]
}
```

This mirrors the behaviour of the original `match_chunks_scoped` Supabase RPC exactly.
