## 1. Adventure & Character Selection

Before a session begins, the player selects an adventure and a hero from a roster of premade characters stored in the database. The chosen `adventure_slug` is persisted to the session row and carried through every subsequent request — routing RAG queries, setting the DM's tone, and determining which encounter stat blocks to spawn in combat.

Each character comes fully built with name, race, class, background, ability scores, HP, AC, equipment, personality traits, ideals, bonds, flaws, and features.

Character details are persisted to the session and injected into every DM system prompt, so the LLM always knows who it's talking to. A **"Who am I?"** button in the session header lets you ask the DM to describe your character at any time.

### Opening Narration

When a new session is created, the app immediately generates an immersive opening narration — before the player types a single word. Each adventure has its own scene-setting prompt:

- **Lost Mine of Phandelver** — the Triboar Trail, a wagon, goblins springing an ambush
- **Ghosts of Saltmarsh** — the salty docks, rumours of a haunted clifftop mansion
- **Tales from the Yawning Portal** — the warm tavern, the great well, a stranger with a map

No "Welcome to the adventure." No prompts. Just the world.

---

## 2. DM Response Format

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

### Structured DM Output

Every DM response is structured into three parts via prompt instructions and parsed before rendering:

- **Narrative** — the pure story prose shown in the chat bubble
- **`[STATUS]` block** — 2–4 bullet points summarizing the current situation (active quests, known threats, key NPCs), rendered as a "Quest Status" card below the narrative instead of bleeding into the prose
- **`[HINTS]` block** — 3–4 suggested next actions tagged by type (Explore, Social, Action, Lore), rendered as a collapsible "What can I do?" panel the player can expand after any DM response

The raw tagged string is always stored in Supabase. Parsing is display-only, so journal generation, conversation history injection, and combat parsing all continue to operate on the full content unchanged.

Each DM message is rendered by `DMMessage` in `components/ChatMessage.tsx`, which calls `parseDMResponse(message.content)` at render time for historical messages and uses the hook's live `parsedDM` state for the actively streaming message. This ensures `[STATUS]` and `[HINTS]` are never shown as raw text — for new messages or messages loaded from the database.

A two-pass fallback parser handles legacy messages and cases where the LLM drifts from the format: pass 1 catches labeled blocks like `Combat State: * ...`; pass 2 catches status-flavored sentences at paragraph boundaries. Hints are only rendered for structured responses.

---

## 3. Combat System

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

### Combat Flow

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

## 4. Death Resolution System

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

### Death Resolution Flow

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

## 4. Session Sidebar

The session page includes a persistent sidebar with three tabs:

- **Character** — name, race/class/level, background, HP, AC, and all six ability scores with modifiers calculated automatically.
- **Combat** — live initiative order sorted by roll, HP bars that shift green → amber → red as combatants take damage, AC and initiative values, active conditions, and a scrollable combat log. Shows a "waiting for initiative roll" state when combat has just started. Auto-switches to this tab when combat begins.
- **Log** — session stats (message count, DM responses, combat rounds), a D&D 5e quick reference card, and clickable phrase shortcuts that pre-fill the input box.

---

## 5. Session Journal & Save System

Sessions are never lost. When you're done playing, you have two options:

- **Save & Pause** — generates a narrative journal entry in the voice of your character, sets the session to `paused`, and returns you to the home screen. All state is preserved: messages, combat, character context. A "Continue Adventure" button on the home and journal screens picks up exactly where you left off, with a short re-entry narration from the DM to reorient you.
- **End Campaign** — generates the journal entry and marks the session `completed`. The session becomes read-only and is preserved in your journal archive.

Sessions carry one of three statuses: `active`, `paused`, or `completed`.

Journal entries are written in first-person past tense — evocative prose, not a bullet summary — capturing key events, decisions, encounters, and emotional beats. Each entry is saved and can be reviewed at any time from the journal page.

### Session Resume Flow

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

## 6. Failure Recovery UX

When a chat turn fails (LLM outage, RAG timeout, upstream API error), the app now degrades gracefully instead of dropping the turn:

- A synthetic DM recovery message is injected into chat: "DM is recovering..."
- The player's failed action is preserved as a **retryable turn**.
- Additional player actions submitted while recovering are **queued**.
- A **Retry Turn** action replays the failed turn using the original pre-turn history snapshot, so continuity is preserved and duplicate turns are avoided.

### Retry Semantics

`useChat` stores:

- `failedTurn.input` â€” the exact player message that failed
- `failedTurn.baseHistory` â€” conversation history before that turn was sent
- `failedTurn.recoveryMessageId` â€” to remove/replace recovery UI on retry

On retry:

1. Remove previous recovery assistant message.
2. Re-send the failed player input with the original `baseHistory`.
3. Stream new DM output into a fresh assistant message.
4. If retry succeeds, drain queued player actions in FIFO order.

This design keeps turn state deterministic and prevents message duplication when recovering from transient failures.
