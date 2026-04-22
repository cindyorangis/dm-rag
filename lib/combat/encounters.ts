import { v4 as uuidv4 } from "uuid";
import type { Combatant } from "./types";
import { createCombatState } from "./engine";

// ─────────────────────────────────────────────────────────────────────────────
// Monster stat blocks
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Spawn helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Encounter definitions
// ─────────────────────────────────────────────────────────────────────────────

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
    generic_goblin: () => [...spawnMultiple("goblin", 2)],
  };

// ─────────────────────────────────────────────────────────────────────────────
// Detect which encounter is starting based on message context
// ─────────────────────────────────────────────────────────────────────────────

const ENCOUNTER_HINTS: Array<{
  patterns: RegExp[];
  key: string;
}> = [
  {
    patterns: [/triboar trail/i, /goblin ambush/i, /road to phandalin/i],
    key: "triboar_trail_ambush",
  },
  {
    patterns: [/cragmaw hideout/i, /hideout entrance/i],
    key: "cragmaw_hideout_entrance",
  },
  {
    patterns: [/cragmaw interior/i, /goblin boss/i, /klarg/i],
    key: "cragmaw_hideout_interior",
  },
  {
    patterns: [/redbrand/i, /sleeping giant/i, /phandalin alley/i],
    key: "phandalin_redbrand_alley",
  },
  {
    patterns: [/wave echo cave/i, /black spider/i, /nezznar/i],
    key: "wave_echo_cave_final",
  },
];

export function detectEncounterKey(
  playerMessage: string,
  dmResponse: string,
): string {
  const combined = `${playerMessage} ${dmResponse}`.toLowerCase();
  for (const hint of ENCOUNTER_HINTS) {
    if (hint.patterns.some((p) => p.test(combined))) {
      return hint.key;
    }
  }
  // Default: generic goblin skirmish (most common early encounter)
  return "triboar_trail_ambush";
}

// ─────────────────────────────────────────────────────────────────────────────
// Return only the monster combatants for an encounter (no player)
// ─────────────────────────────────────────────────────────────────────────────

export function buildEncounterMonstersOnly(
  encounterKey: string,
): Omit<Combatant, "initiative">[] {
  const factory =
    ENCOUNTERS[encounterKey] ?? ENCOUNTERS["triboar_trail_ambush"];
  return factory();
}

// ─────────────────────────────────────────────────────────────────────────────
// Build a full combat state for a named encounter + player (legacy helper)
// ─────────────────────────────────────────────────────────────────────────────

export function buildEncounterState(
  sessionId: string,
  encounterKey: string,
  player: Omit<Combatant, "initiative">,
): ReturnType<typeof createCombatState> {
  const monsters = buildEncounterMonstersOnly(encounterKey);
  return createCombatState(sessionId, [player, ...monsters]);
}
