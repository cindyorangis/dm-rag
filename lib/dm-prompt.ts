import type { CombatState, Combatant } from "./combat/types";
import type { SessionStructuredMemory } from "./memory-compression";
import type { NarrativeFlags } from "./narrative/flags";
import type { RetrievalConfidence } from "./rag";
import { getAdventureMeta } from "./narrative/adventure-meta";
import { DEATH_RESOLUTION_SCRIPTS } from "./narrative/death-resolutions";

// ─── Base Prompt ──────────────────────────────────────────────────────────────

function buildBasePrompt(slug: string | undefined | null): string {
  const meta = getAdventureMeta(slug);
  return `You are the Dungeon Master for a solo game of Dungeons & Dragons 5th Edition.
The adventure is ${meta.title}, set in ${meta.setting}.

ABSOLUTE OUTPUT RULES — these override everything else:
1. NEVER narrate dice rolls. Never write "*rolls*", "rolls a d20", "rolling for initiative", or show arithmetic like "14 + 4 = 18". The game UI handles all dice. Describe outcomes only.
2. ALWAYS end every single response with a [STATUS] block and a [HINTS] block, formatted exactly as shown at the bottom of this prompt. No exceptions.
3. NEVER include [STATUS] or [HINTS] content inside your narrative prose. They must only appear in the tagged blocks at the end.

Your responsibilities:
- Narrate the world vividly and immersively in second person ("You see...", "You hear...")
- Enforce D&D 5e rules strictly and fairly
- Run combat turn-by-turn using the combat state provided
- Track NPC/monster behavior, motivations, and reactions
- Never break character or refer to yourself as an AI

Tone: ${meta.tone}`;
}

function buildFallbackCharacter(slug: string | undefined | null): string {
  const meta = getAdventureMeta(slug);
  return `No character sheet provided. Generate a suitable adventurer for ${meta.title}.
Choose: a name, race, class (level 1), background, ability scores, HP, and AC.
Introduce the character naturally in your opening narration.
Remember the character you created for the entire session — refer to them by name.
At the start of the session, or if the player asks "who am I", describe the character fully.`;
}

// ─── Combat State Formatting ──────────────────────────────────────────────────

function formatCombatant(c: Combatant, isCurrent: boolean): string {
  const marker = isCurrent ? "▶ " : "  ";
  const conditions =
    c.conditions.length > 0 ? ` [${c.conditions.join(", ")}]` : "";
  const status = c.is_alive
    ? `HP: ${c.hp}/${c.max_hp} | AC: ${c.ac}`
    : "DEFEATED";
  return `${marker}${c.name} (${c.type}) | ${status} | Initiative: ${c.initiative}${conditions}`;
}

function getUpcomingTurns(state: CombatState): Combatant[] {
  const total = state.combatants.length;
  const upcoming: Combatant[] = [];
  let idx = (state.current_turn_index + 1) % total;
  let checked = 0;
  while (checked < total) {
    const c = state.combatants[idx];
    if (c?.is_alive) upcoming.push(c);
    if (upcoming.length >= 3) break;
    idx = (idx + 1) % total;
    checked++;
  }
  return upcoming;
}

function formatCombatState(state: CombatState): string {
  const currentCombatant = state.combatants[state.current_turn_index];

  const lines = [
    `Round: ${state.round}`,
    `Current Turn: ${currentCombatant?.name ?? "Unknown"} (${currentCombatant?.type ?? "?"})`,
    ``,
    `INITIATIVE ORDER:`,
    ...state.combatants.map((c, i) =>
      formatCombatant(c, i === state.current_turn_index),
    ),
  ];

  if (state.log.length > 0) {
    const recent = state.log.slice(-3);
    lines.push(``, `RECENT ACTIONS:`);
    recent.forEach((entry) => {
      lines.push(
        `  [Round ${entry.round}] ${entry.actor}: ${entry.description}`,
      );
    });
  }

  if (state.deathResolution?.lingeringEffect) {
    lines.push(
      ``,
      `LINGERING EFFECT: ${state.deathResolution.lingeringEffect}`,
    );
  }

  return lines.join("\n");
}

// ─── Combat Instructions ──────────────────────────────────────────────────────

function buildPlayerTurnInstructions(current: Combatant): string {
  return `
--- COMBAT INSTRUCTIONS: PLAYER'S TURN ---
It is ${current.name}'s turn (the PLAYER).

PLAYER TURN RULES — follow this exact sequence every turn:

━━ STEP 1: PLAYER DECLARES ACTION ━━
Wait for the player to describe what they do.
- Do NOT prompt them with "What do you do?" — they know it's their turn.
- Do NOT resolve anything until they speak.

━━ STEP 2: ATTACK ROLL ━━
If the player declares an attack (melee, ranged, or spell attack):
  → Output exactly this on its own line, then STOP. Do not write anything else.
  [ROLL: attack d20+<attack_bonus> vs AC <target_ac> target:<target_name>]

If the player does something requiring an ABILITY CHECK:
  [ROLL: check d20+<ability_mod> DC<dc> <skill_name>]

If the player needs a SAVING THROW:
  [ROLL: save d20+<save_mod> DC<dc> <ability_name>]

ONE [ROLL:] tag per response — never combine two roll tags in the same message.

━━ STEP 3: RESOLVE THE ATTACK ROLL ━━
The player sends back a message like: "Attack roll: 14 + 4 = 18 vs AC 15 — HIT!" or "— MISS."

On a MISS:
  - Write one sentence of miss flavour (blade deflected, arrow goes wide, etc.)
  - Do NOT emit a damage [ROLL:] tag
  - Proceed to the next turn

On a HIT:
  - Write exactly one sentence of hit flavour ("Your blade bites into the goblin's side.")
  - Then on the very next line, output the damage roll tag and STOP:
  [ROLL: damage <damage_dice> target:<target_name>]
  Use the correct damage dice for the player's weapon or spell from their character sheet.
  On a CRITICAL HIT (natural 20): double the damage dice (e.g. 2d6+3 instead of 1d6+3).

━━ STEP 4: RESOLVE THE DAMAGE ROLL ━━
The player sends back a message like: "Damage roll (1d6+3): rolled 7 (4+3)"

  - Narrate the damage vividly: describe the wound, the enemy staggering, flying back, etc.
  - Apply the damage to the target.
  - If the target reaches 0 HP, narrate its defeat dramatically.
  - State who acts next, then stop.

━━ IRON RULES ━━
- NEVER roll dice for the player.
- NEVER skip the attack roll step and go straight to damage.
- NEVER emit both [ROLL: attack ...] and [ROLL: damage ...] in the same response.
- NEVER advance the turn until BOTH the attack roll AND (on a hit) the damage roll have been received.`;
}

function buildMonsterTurnInstructions(
  current: Combatant,
  playerAC: number,
  nextAliveCombatants: Combatant[],
): string {
  return `
--- COMBAT INSTRUCTIONS: MONSTER'S TURN ---
It is ${current.name}'s turn (a MONSTER/NPC). The player does NOT act this turn.

MONSTER TURN RULES:
- NEVER show dice arithmetic. Instead of "rolls 13 + 4 = 17 vs AC 14 — HIT", write "The goblin's rusty blade finds a gap in your armor." Describe the outcome dramatically without numbers.
- Describe ${current.name}'s action dramatically and in full.
- Roll the monster's attack dice yourself and narrate the result, e.g.:
  "${current.name} lunges at you — (rolled 13 + 4 = 17 vs your AC ${playerAC} — HIT!) You take X slashing damage."
- Apply damage, conditions, or effects as appropriate.
- CRITICAL: Do NOT ask the player what they want to do. Do NOT say "What do you do?" or "It's your turn."
- CRITICAL: Do NOT prompt for any player input until the player's turn comes around.
- After fully resolving ${current.name}'s turn, briefly state who acts next:
  ${nextAliveCombatants
    .slice(0, 2)
    .map((c) => `"Next: ${c.name} (${c.type})"`)
    .join(", then ")}
- If the next turn is the player's, end with: "It is your turn — what do you do?"
- If the next turn is another monster, narrate that monster's turn too, chaining until you reach the player.`;
}

function buildCombatInstructions(state: CombatState): string {
  const current = state.combatants[state.current_turn_index];
  if (!current) return "";

  if (current.type === "player") {
    return buildPlayerTurnInstructions(current);
  }

  const alivePlayers = state.combatants.filter(
    (c) => c.type === "player" && c.is_alive,
  );
  const playerAC = alivePlayers[0]?.ac ?? 14;
  const nextAliveCombatants = getUpcomingTurns(state);

  return buildMonsterTurnInstructions(current, playerAC, nextAliveCombatants);
}

// ─── Narrative Flags ──────────────────────────────────────────────────────────

function formatNarrativeFlags(flags: NarrativeFlags | undefined): string {
  if (!flags || Object.keys(flags).length === 0) return "None recorded yet.";
  return Object.entries(flags)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

// ─── Structured Output Format ─────────────────────────────────────────────────

const STATUS_AND_HINTS_INSTRUCTION = `
---
REQUIRED FORMAT — append these two blocks at the end of EVERY response, no exceptions.

[STATUS]
* <one sentence about the current situation>
* <one sentence about a known threat or active quest>
* <one sentence about a key NPC or location>
[/STATUS]

[HINTS]
[action] <short label> | <full sentence the player would say or do>
[explore] <short label> | <full sentence the player would say or do>
[social] <short label> | <full sentence the player would say or do>
[lore] <short label> | <full sentence the player would say or do>
[/HINTS]

Your response must end with [STATUS]...[/STATUS] followed immediately by [HINTS]...[/HINTS]. Never omit either block.

When the player makes a meaningful choice with long-term consequences, append a hidden [FLAG_OPS] JSON block AFTER [/HINTS].
- Use lowercase snake_case keys only.
- Allowed operations:
  {"set":{"spared_goblin":true},"inc":{"redbrand_hostility":1},"unset":["temporary_flag"]}
- The [FLAG_OPS] block must contain valid JSON and no prose.
- Never mention [FLAG_OPS] in narrative text.
`;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BuildPromptOptions {
  retrievedChunks: string[];
  combatState: CombatState | null;
  characterContext?: string | null;
  narrativeFlags?: NarrativeFlags;
  adventureSlug?: string | null;
  rollingSummary?: string | null;
  structuredMemory?: SessionStructuredMemory | null;
  retrievalConfidence?: RetrievalConfidence | null;
}

export function buildDMSystemPrompt({
  retrievedChunks,
  combatState,
  characterContext,
  narrativeFlags,
  adventureSlug,
  rollingSummary,
  structuredMemory,
  retrievalConfidence,
}: BuildPromptOptions): string {
  const sections: string[] = [buildBasePrompt(adventureSlug)];

  // Character context
  const normalizedCharacterContext = normalizeCharacterContext(
    characterContext,
    adventureSlug,
  );
  sections.push(`\n--- PLAYER CHARACTER ---\n${normalizedCharacterContext}`);

  if (rollingSummary?.trim()) {
    sections.push(
      `\n--- SESSION MEMORY (COMPRESSED) ---\n${rollingSummary.trim()}`,
    );
  }

  const structuredMemorySection = formatStructuredMemory(structuredMemory);
  if (structuredMemorySection) {
    sections.push(
      `\n--- SESSION MEMORY (STRUCTURED) ---\n${structuredMemorySection}`,
    );
  }

  // RAG chunks
  if (retrievedChunks.length > 0) {
    sections.push(
      `\n--- RETRIEVED RULES & LORE ---\n${retrievedChunks.join("\n\n---\n\n")}`,
    );
  }

  if (retrievalConfidence) {
    sections.push(
      `\n--- RETRIEVAL CONFIDENCE ---\nLevel: ${retrievalConfidence.level.toUpperCase()} (score ${retrievalConfidence.score})\nReason: ${retrievalConfidence.reason}`,
    );

    if (retrievalConfidence.level === "low") {
      sections.push(`\n--- LOW CONFIDENCE BEHAVIOR ---
Your retrieved context is weak this turn.
- Do NOT invent specific rules, monster stats, quest facts, or named lore details.
- Ask exactly ONE clarifying question before asserting uncertain facts.
- Offer cautious, generic options grounded in what is already known.`);
    }
  }

  // Combat state
  sections.push(
    `\n--- CURRENT COMBAT STATE ---\n${
      combatState?.is_active
        ? formatCombatState(combatState)
        : "No combat active. The player is exploring or roleplaying."
    }`,
  );

  // Narrative flags
  sections.push(
    `\n--- NARRATIVE FLAGS ---\n${formatNarrativeFlags(narrativeFlags)}`,
  );

  // Death resolution — injected before combat instructions so the LLM reads the
  // narrative directive before it sees turn-order rules
  if (combatState?.deathResolution && !combatState.deathResolution.applied) {
    const script = DEATH_RESOLUTION_SCRIPTS[combatState.deathResolution.type];
    if (script) {
      sections.push(`\n--- SPECIAL CIRCUMSTANCE ---\n${script}\n`);
    } else {
      // Helpful for debugging if a script is missing from the config
      console.warn(
        `Missing death resolution script for: ${combatState.deathResolution.type}`,
      );
    }
  }

  // Combat turn instructions
  if (combatState?.is_active && !combatState.awaiting_player_initiative) {
    sections.push(buildCombatInstructions(combatState));
  } else if (combatState?.awaiting_player_initiative) {
    sections.push(`\n--- COMBAT INSTRUCTIONS: AWAITING INITIATIVE ---
Combat has just started. The player is about to roll their initiative.
STRICT RULE: Never narrate dice rolls. Never write "*rolls*", "rolls a", "rolling for initiative", or show any numbers from dice rolls in your prose. The game UI handles all dice rolling. Describe only what happens narratively as a result — not the mechanical process of rolling.
Do not ask the player to act yet. Do not advance the turn order.
Simply confirm that combat has begun and that you are waiting for their initiative roll.`);
  }

  return sections.join("") + "\n" + STATUS_AND_HINTS_INSTRUCTION;
}

function formatStructuredMemory(
  memory: SessionStructuredMemory | null | undefined,
): string {
  if (!memory) return "";

  const lines: string[] = [];

  if (memory.active_quests.length > 0) {
    lines.push("ACTIVE QUESTS:");
    for (const quest of memory.active_quests) {
      lines.push(
        `- ${quest.name} [${quest.status}|${quest.priority}]: ${quest.progress}`,
      );
    }
  }

  if (memory.npc_trust.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("NPC TRUST:");
    for (const npc of memory.npc_trust) {
      lines.push(`- ${npc.npc} [${npc.trust}]: ${npc.basis}`);
    }
  }

  if (memory.inventory_changes.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("INVENTORY CHANGES:");
    for (const item of memory.inventory_changes) {
      const quantity = item.quantity ? ` (${item.quantity})` : "";
      const note = item.note ? ` - ${item.note}` : "";
      lines.push(`- ${item.item}: ${item.change}${quantity}${note}`);
    }
  }

  if (memory.unresolved_hooks.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("UNRESOLVED HOOKS:");
    for (const hook of memory.unresolved_hooks) {
      const note = hook.note ? ` - ${hook.note}` : "";
      lines.push(`- ${hook.hook} [${hook.urgency}]${note}`);
    }
  }

  return lines.join("\n").trim();
}

function normalizeCharacterContext(
  characterContext: string | null | undefined,
  adventureSlug: string | undefined | null,
): string {
  if (!characterContext) {
    return buildFallbackCharacter(adventureSlug);
  }

  const maxChars = readPositiveIntEnv("CHARACTER_CONTEXT_MAX_CHARS", 1200);
  const trimmed = characterContext.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}\n...`;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function buildCombatStartPrompt(combatants: Combatant[]): string {
  const monsterNames = combatants
    .filter((c) => c.type === "monster")
    .map((c) => c.name)
    .join(", ");

  return `COMBAT HAS BEGUN. Enemies: ${monsterNames}.
Describe the start of combat dramatically. The player will roll their own initiative — do NOT roll it for them.
Announce that initiative is being determined and set a tense scene.`;
}
