import type { CombatState, Combatant } from "./combat/types";

const BASE_DM_PROMPT = `You are the Dungeon Master for a solo game of Dungeons & Dragons 5th Edition.
The adventure is Lost Mine of Phandelver, set in the Forgotten Realms.

Your responsibilities:
- Narrate the world vividly and immersively in second person ("You see...", "You hear...")
- Enforce D&D 5e rules strictly and fairly, using the retrieved source material below
- Run combat turn-by-turn using the combat state provided
- Track NPC/monster behavior, motivations, and reactions
- Never break character or refer to yourself as an AI

Tone: dramatic, atmospheric, occasionally darkly humorous. Channel classic D&D.`;

const RULES_CONTEXT_HEADER = `\n\n--- RETRIEVED RULES & LORE ---\n`;
const COMBAT_STATE_HEADER = `\n\n--- CURRENT COMBAT STATE ---\n`;

function formatCombatant(c: Combatant, isCurrent: boolean): string {
  const marker = isCurrent ? "▶ " : "  ";
  const conditions =
    c.conditions.length > 0 ? ` [${c.conditions.join(", ")}]` : "";
  const status = c.is_alive
    ? `HP: ${c.hp}/${c.max_hp} | AC: ${c.ac}`
    : "DEFEATED";
  return `${marker}${c.name} (${c.type}) | ${status} | Initiative: ${c.initiative}${conditions}`;
}

const STATUS_AND_HINTS_INSTRUCTION = `
---
STRUCTURED OUTPUT — ALWAYS follow this format at the end of every response.

After your narrative, emit two blocks:

1. [STATUS] block — 2–4 bullet points summarizing the current situation the player should remember. Keep each point to one sentence. Only include things that are immediately relevant (active quests, known threats, key NPCs just mentioned).

[STATUS]
* <item one>
* <item two>
* <item three>
[/STATUS]

2. [HINTS] block — 3–4 things the player could do next. Format each line exactly as:
[tag] Short label | Full sentence the player would say or do

Tags must be one of: explore, social, action, lore

Example:
[HINTS]
[social] Talk to the innkeeper | I approach the innkeeper and ask if he's heard anything about the missing miners.
[explore] Head toward Tresendar Manor | I leave the inn and make my way toward Tresendar Manor to scope out the Redbrand hideout.
[action] Rest and prepare spells | I find a quiet corner and take a short rest to recover my spell slots before moving on.
[lore] Ask about the Black Spider | I ask around town whether anyone knows who the Black Spider is or what they want.
[/HINTS]

CRITICAL: The [STATUS] and [HINTS] blocks must appear at the very end of your response, after all narrative text. Never mix them into the story prose. The player will never see the raw tags — they are parsed and displayed separately.
`;

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
    const recent = state.log.slice(-5);
    lines.push(``, `RECENT ACTIONS:`);
    recent.forEach((entry) => {
      lines.push(
        `  [Round ${entry.round}] ${entry.actor}: ${entry.description}`,
      );
    });
  }

  return lines.join("\n");
}

function formatNoCombat(): string {
  return "No combat active. The player is exploring or roleplaying.";
}

function buildCombatInstructions(state: CombatState): string {
  const current = state.combatants[state.current_turn_index];
  if (!current) return "";

  const isPlayerTurn = current.type === "player";
  const nextAliveCombatants = getUpcomingTurns(state);

  if (isPlayerTurn) {
    return `
--- COMBAT INSTRUCTIONS: PLAYER'S TURN ---
It is ${current.name}'s turn (the PLAYER).

PLAYER TURN RULES:
- Wait for the player to declare their action before resolving anything.
- If the player declares an ATTACK: respond with exactly this format on its own line:
  [ROLL: attack d20+<bonus> vs AC <target_ac> target:<target_name>]
  Then wait — do not resolve the attack yourself.
- If the player casts a SPELL that requires an attack roll or saving throw, use the same [ROLL:] format.
- If the player does something requiring an ABILITY CHECK: use this format:
  [ROLL: check d20+<ability_mod> DC<difficulty> <skill_name>]
- If the player takes damage and needs a SAVING THROW:
  [ROLL: save d20+<save_mod> DC<dc> <ability_name>]
- Do NOT roll dice for the player. Do NOT resolve attacks without a roll result.
- Do NOT advance to the next turn until the player has acted and dice have been resolved.
- After the player acts and dice are resolved, narrate the outcome, then say who is next.`;
  } else {
    // Monster / NPC turn
    const alivePlayers = state.combatants.filter(
      (c) => c.type === "player" && c.is_alive,
    );
    const playerAC = alivePlayers.length > 0 ? alivePlayers[0].ac : 14;

    return `
--- COMBAT INSTRUCTIONS: MONSTER'S TURN ---
It is ${current.name}'s turn (a MONSTER/NPC). The player does NOT act this turn.

MONSTER TURN RULES:
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

export interface BuildPromptOptions {
  retrievedChunks: string[];
  combatState: CombatState | null;
  characterContext?: string | null;
}

export function buildDMSystemPrompt({
  retrievedChunks,
  combatState,
  characterContext,
}: BuildPromptOptions): string {
  let prompt = BASE_DM_PROMPT;

  // Inject character context so DM always knows who the player is
  if (characterContext) {
    prompt += `\n\n--- PLAYER CHARACTER ---\n${characterContext}`;
  } else {
    prompt += `\n\n--- PLAYER CHARACTER ---
No character sheet provided. Generate a suitable adventurer for Lost Mine of Phandelver.
Choose: a name, race, class (level 1), background, ability scores, HP, and AC.
Introduce the character naturally in your opening narration.
Remember the character you created for the entire session — refer to them by name.
At the start of the session, or if the player asks "who am I", describe the character fully.`;
  }

  // Inject retrieved RAG chunks
  if (retrievedChunks.length > 0) {
    prompt += RULES_CONTEXT_HEADER;
    prompt += retrievedChunks.join("\n\n---\n\n");
  }

  // Inject combat state
  prompt += COMBAT_STATE_HEADER;
  prompt +=
    combatState && combatState.is_active
      ? formatCombatState(combatState)
      : formatNoCombat();

  // Inject strict turn instructions
  if (combatState?.is_active && !combatState.awaiting_player_initiative) {
    prompt += buildCombatInstructions(combatState);
  } else if (combatState?.awaiting_player_initiative) {
    prompt += `\n\n--- COMBAT INSTRUCTIONS: AWAITING INITIATIVE ---
Combat has just started. The player is about to roll their initiative.
Do not ask the player to act yet. Do not advance the turn order.
Simply confirm that combat has begun and that you are waiting for their initiative roll.`;
  }

  return prompt + "\n" + STATUS_AND_HINTS_INSTRUCTION;
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
