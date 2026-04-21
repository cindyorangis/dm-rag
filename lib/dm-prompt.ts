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

function formatCombatState(state: CombatState): string {
  const currentCombatant = state.combatants[state.current_turn_index];

  const lines = [
    `Round: ${state.round}`,
    `Current Turn: ${currentCombatant?.name ?? "Unknown"}`,
    ``,
    `INITIATIVE ORDER:`,
    ...state.combatants.map((c, i) =>
      formatCombatant(c, i === state.current_turn_index),
    ),
  ];

  // Include last 5 log entries for context
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

export interface BuildPromptOptions {
  retrievedChunks: string[];
  combatState: CombatState | null;
}

export function buildDMSystemPrompt({
  retrievedChunks,
  combatState,
}: BuildPromptOptions): string {
  let prompt = BASE_DM_PROMPT;

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

  // Combat-specific instructions
  if (combatState?.is_active) {
    prompt += `\n\n--- COMBAT INSTRUCTIONS ---
- It is currently ${combatState.combatants[combatState.current_turn_index]?.name}'s turn.
- If the player declares an attack, resolve it: ask for (or simulate) an attack roll vs target AC, then roll damage.
- For monster turns: describe the monster's action, roll attack vs player AC (assume ~14 if unknown), narrate the result.
- After resolving the current turn, advance to the next combatant in initiative order.
- If a combatant reaches 0 HP, declare them defeated and remove from the turn order.
- When all monsters are defeated, declare combat over and return to exploration.
- Always end your response by stating whose turn is next.
- Include all dice rolls explicitly in your narrative: e.g. "(rolled 14 + 3 = 17 vs AC 15 — hit!)"`;
  }

  return prompt;
}

// Utility: build a combat-start prompt injection
export function buildCombatStartPrompt(combatants: Combatant[]): string {
  const monsterNames = combatants
    .filter((c) => c.type === "monster")
    .map((c) => c.name)
    .join(", ");

  return `COMBAT HAS BEGUN. Roll for initiative and arrange the turn order.
Enemies: ${monsterNames}
Describe the start of combat dramatically, announce the initiative order, and prompt the player for their first action.`;
}
