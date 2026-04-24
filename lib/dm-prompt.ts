import type { CombatState, Combatant } from "./combat/types";

const BASE_DM_PROMPT = `You are the Dungeon Master for a solo game of Dungeons & Dragons 5th Edition.
The adventure is Lost Mine of Phandelver, set in the Forgotten Realms.

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

EXAMPLE of a correctly formatted response:
---
You push open the heavy oak door of the Stonehill Inn. The common room is warm and smoky, filled with tired farmers nursing their ales. The innkeeper, a stout dwarf named Toblen, looks up as you enter.

[STATUS]
* You have just arrived in Phandalin for the first time.
* The Redbrands are terrorizing the town and have been seen near Tresendar Manor.
* Toblen Stonehill may know useful information about local troubles.
[/STATUS]

[HINTS]
[social] Ask Toblen about the Redbrands | I lean on the bar and ask Toblen what he knows about the Redbrands causing trouble in town.
[explore] Look around the common room | I scan the room to see who else is here and if anyone looks like they might have useful information.
[lore] Ask about Phandalin's history | I ask Toblen how long he's lived here and what Phandalin was like before the Redbrands showed up.
[action] Get a room for the night | I ask Toblen for a room and a meal — I need to rest before doing anything else.
[/HINTS]
---
END EXAMPLE

Your response must end with [STATUS]...[/STATUS] followed immediately by [HINTS]...[/HINTS]. Never omit either block.
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
STRICT RULE: Never narrate dice rolls. Never write "*rolls*", "rolls a", "rolling for initiative", or show any numbers from dice rolls in your prose. The game UI handles all dice rolling. Describe only what happens narratively as a result — not the mechanical process of rolling.
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
