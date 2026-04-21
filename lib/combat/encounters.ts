import { v4 as uuidv4 } from "uuid";
import type { Combatant } from "./types";
import { createCombatState } from "./engine";

// Stat blocks from the Monster Manual / LMoP
const MONSTER_TEMPLATES: Record<
  string,
  Omit<Combatant, "id" | "initiative">
> = {
  goblin: {
    name: "Goblin",
    type: "monster",
    hp: 7,
    max_hp: 7,
    ac: 15,
    initiative_mod: 2,
    conditions: [],
    is_alive: true,
  },
  goblin_boss: {
    name: "Goblin Boss",
    type: "monster",
    hp: 21,
    max_hp: 21,
    ac: 17,
    initiative_mod: 2,
    conditions: [],
    is_alive: true,
  },
  bugbear: {
    name: "Bugbear",
    type: "monster",
    hp: 27,
    max_hp: 27,
    ac: 16,
    initiative_mod: 1,
    conditions: [],
    is_alive: true,
  },
  wolf: {
    name: "Wolf",
    type: "monster",
    hp: 11,
    max_hp: 11,
    ac: 13,
    initiative_mod: 2,
    conditions: [],
    is_alive: true,
  },
  owlbear: {
    name: "Owlbear",
    type: "monster",
    hp: 59,
    max_hp: 59,
    ac: 13,
    initiative_mod: 1,
    conditions: [],
    is_alive: true,
  },
  nezznar: {
    name: "Nezznar the Black Spider",
    type: "monster",
    hp: 27,
    max_hp: 27,
    ac: 12,
    initiative_mod: 2,
    conditions: [],
    is_alive: true,
  },
};

export function spawnMonster(
  templateKey: string,
  overrides?: Partial<Combatant>,
): Omit<Combatant, "initiative"> {
  const template = MONSTER_TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown monster: ${templateKey}`);
  return { ...template, ...overrides, id: uuidv4() };
}

export function spawnMultiple(
  templateKey: string,
  count: number,
): Omit<Combatant, "initiative">[] {
  return Array.from({ length: count }, (_, i) => ({
    ...spawnMonster(templateKey),
    name:
      count > 1
        ? `${MONSTER_TEMPLATES[templateKey].name} ${i + 1}`
        : MONSTER_TEMPLATES[templateKey].name,
  }));
}

// Predefined encounter groups from LMoP locations
export const ENCOUNTERS: Record<string, () => Omit<Combatant, "initiative">[]> =
  {
    cragmaw_hideout_entrance: () => [...spawnMultiple("goblin", 2)],
    cragmaw_hideout_interior: () => [
      ...spawnMultiple("goblin", 3),
      spawnMonster("goblin_boss"),
    ],
    triboar_trail_ambush: () => [...spawnMultiple("goblin", 4)],
    phandalin_redbrand_alley: () => [
      ...spawnMultiple("bugbear", 1),
      ...spawnMultiple("goblin", 2),
    ],
    wave_echo_cave_final: () => [
      spawnMonster("nezznar"),
      ...spawnMultiple("wolf", 2),
    ],
  };

// Build a full combat state for a named encounter + player
export function buildEncounterState(
  sessionId: string,
  encounterKey: string,
  player: Omit<Combatant, "initiative">,
): ReturnType<typeof createCombatState> {
  const monsters = ENCOUNTERS[encounterKey]?.() ?? [];
  return createCombatState(sessionId, [player, ...monsters]);
}
