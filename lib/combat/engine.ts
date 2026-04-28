import { rollInitiative } from "./dice";
import type {
  Combatant,
  CombatState,
  CombatLogEntry,
  Condition,
  DeathResolutionType,
} from "./types";

// Sort combatants by initiative descending; ties broken by initiative_mod
export function sortByInitiative(combatants: Combatant[]): Combatant[] {
  return [...combatants].sort((a, b) =>
    b.initiative !== a.initiative
      ? b.initiative - a.initiative
      : b.initiative_mod - a.initiative_mod,
  );
}

export function rollAllInitiatives(
  combatants: Omit<Combatant, "initiative">[],
): Combatant[] {
  return combatants.map((c) => ({
    ...c,
    initiative: rollInitiative(c.initiative_mod),
  }));
}

export function createCombatState(
  sessionId: string,
  rawCombatants: Omit<Combatant, "initiative">[],
): Omit<CombatState, "id" | "updated_at"> {
  const withInitiative = rollAllInitiatives(rawCombatants);
  const sorted = sortByInitiative(withInitiative);
  return {
    session_id: sessionId,
    is_active: true,
    round: 1,
    current_turn_index: 0,
    combatants: sorted,
    log: [],
  };
}

export function getCurrentCombatant(state: CombatState): Combatant | null {
  const alive = state.combatants.filter((c) => c.is_alive);
  if (alive.length === 0) return null;
  return state.combatants[state.current_turn_index] ?? null;
}

export function advanceTurn(state: CombatState): CombatState {
  const aliveCombatants = state.combatants.filter((c) => c.is_alive);
  if (aliveCombatants.length === 0) return state;

  let nextIndex = (state.current_turn_index + 1) % state.combatants.length;
  let newRound = state.round;

  // Skip dead combatants
  let safety = 0;
  while (
    !state.combatants[nextIndex]?.is_alive &&
    safety < state.combatants.length
  ) {
    nextIndex = (nextIndex + 1) % state.combatants.length;
    safety++;
  }

  // Detect round rollover
  if (nextIndex <= state.current_turn_index) {
    newRound += 1;
  }

  return { ...state, current_turn_index: nextIndex, round: newRound };
}

export function applyDamage(
  state: CombatState,
  targetId: string,
  damage: number,
): CombatState {
  const combatants = state.combatants.map((c) => {
    if (c.id !== targetId) return c;
    const newHp = Math.max(0, c.hp - damage);
    return { ...c, hp: newHp, is_alive: newHp > 0 };
  });
  return { ...state, combatants };
}

export function applyHealing(
  state: CombatState,
  targetId: string,
  amount: number,
): CombatState {
  const combatants = state.combatants.map((c) => {
    if (c.id !== targetId) return c;
    const newHp = Math.min(c.max_hp, c.hp + amount);
    return { ...c, hp: newHp, is_alive: true };
  });
  return { ...state, combatants };
}

export function addCondition(
  state: CombatState,
  targetId: string,
  condition: Condition,
): CombatState {
  const combatants = state.combatants.map((c) => {
    if (c.id !== targetId) return c;
    if (c.conditions.includes(condition)) return c;
    return { ...c, conditions: [...c.conditions, condition] };
  });
  return { ...state, combatants };
}

export function removeCondition(
  state: CombatState,
  targetId: string,
  condition: Condition,
): CombatState {
  const combatants = state.combatants.map((c) => {
    if (c.id !== targetId) return c;
    return {
      ...c,
      conditions: c.conditions.filter((cond) => cond !== condition),
    };
  });
  return { ...state, combatants };
}

export function appendLog(
  state: CombatState,
  entry: Omit<CombatLogEntry, "timestamp">,
): CombatState {
  const logEntry: CombatLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  return { ...state, log: [...state.log, logEntry] };
}

export function isCombatOver(state: CombatState): {
  over: boolean;
  winningSide: "player" | "monster" | null;
} {
  const playersAlive = state.combatants.some(
    (c) => c.type === "player" && c.is_alive,
  );
  const monstersAlive = state.combatants.some(
    (c) => c.type === "monster" && c.is_alive,
  );
  if (!monstersAlive) return { over: true, winningSide: "player" };
  if (!playersAlive) return { over: true, winningSide: "monster" };
  return { over: false, winningSide: null };
}

export function endCombat(state: CombatState): CombatState {
  return { ...state, is_active: false };
}

export function isPlayerDead(state: CombatState): boolean {
  return state.combatants.some(
    (c) => c.type === "player" && c.is_alive === false,
  );
}

export function selectDeathResolution(): DeathResolutionType {
  const options: DeathResolutionType[] = [
    "capture",
    "benefactor",
    "pact",
    "corpse_run",
  ];
  return options[Math.floor(Math.random() * options.length)];
}
