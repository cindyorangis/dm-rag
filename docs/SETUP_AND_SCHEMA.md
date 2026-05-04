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

Create the turn metrics table:

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
alter table sessions add column if not exists memory_summary text;
alter table sessions add column if not exists memory_structured jsonb default '{}'::jsonb;
alter table sessions add column if not exists memory_summary_message_count int not null default 0;
```

> **Note:** If you created the `combat_state` table before the initiative roll feature was added, run this migration:
>
> ```sql
> alter table combat_state
>   add column if not exists awaiting_player_initiative boolean default false;
> ```
