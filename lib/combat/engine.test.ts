import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sortByInitiative,
  rollAllInitiatives,
  createCombatState,
  getCurrentCombatant,
  advanceTurn,
  applyDamage,
  applyHealing,
  addCondition,
  removeCondition,
  isCombatOver,
  isPlayerDead,
  selectDeathResolution,
} from "./engine";
import * as dice from "./dice";
import type { Combatant, CombatState } from "./types";

// Mock the dice module so we can control initiative rolls
vi.mock("./dice", () => ({
  rollInitiative: vi.fn(),
}));

// --- Test Fixtures ---
function createMockCombatant(overrides?: Partial<Combatant>): Combatant {
  return {
    id: "mock-id",
    name: "Goblin",
    type: "monster",
    hp: 10,
    max_hp: 10,
    ac: 10, // <-- Add a default Armor Class here
    is_alive: true,
    initiative: 10,
    initiative_mod: 2,
    conditions: [],
    ...overrides,
  };
}

function createMockState(
  combatants: Combatant[],
  currentTurn = 0,
): CombatState {
  return {
    id: "state-id",
    session_id: "session-123",
    is_active: true,
    round: 1,
    current_turn_index: currentTurn,
    combatants,
    log: [],
    updated_at: new Date().toISOString(),
  };
}

describe("Combat Engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("sortByInitiative", () => {
    it("should sort combatants by initiative descending", () => {
      const c1 = createMockCombatant({ id: "1", initiative: 10 });
      const c2 = createMockCombatant({ id: "2", initiative: 15 });
      const c3 = createMockCombatant({ id: "3", initiative: 5 });

      const sorted = sortByInitiative([c1, c2, c3]);
      expect(sorted.map((c) => c.id)).toEqual(["2", "1", "3"]);
    });

    it("should resolve ties using initiative_mod", () => {
      const c1 = createMockCombatant({
        id: "1",
        initiative: 10,
        initiative_mod: 2,
      });
      const c2 = createMockCombatant({
        id: "2",
        initiative: 10,
        initiative_mod: 5,
      });

      const sorted = sortByInitiative([c1, c2]);
      expect(sorted.map((c) => c.id)).toEqual(["2", "1"]);
    });
  });

  describe("createCombatState", () => {
    it("should roll initiatives, sort them, and initialize the state", () => {
      // Mock rolls to be predictable
      vi.mocked(dice.rollInitiative)
        .mockReturnValueOnce(15)
        .mockReturnValueOnce(20);

      const rawCombatants = [
        createMockCombatant({
          id: "player1",
          type: "player",
          initiative_mod: 2,
        }),
        createMockCombatant({
          id: "monster1",
          type: "monster",
          initiative_mod: 1,
        }),
      ];

      const state = createCombatState("session-123", rawCombatants);

      expect(state.session_id).toBe("session-123");
      expect(state.round).toBe(1);
      expect(state.combatants[0].id).toBe("monster1"); // Rolled 20
      expect(state.combatants[1].id).toBe("player1"); // Rolled 15
    });
  });

  describe("advanceTurn", () => {
    it("should advance to the next combatant", () => {
      const state = createMockState(
        [createMockCombatant({ id: "1" }), createMockCombatant({ id: "2" })],
        0,
      );

      const nextState = advanceTurn(state);
      expect(nextState.current_turn_index).toBe(1);
      expect(nextState.round).toBe(1);
    });

    it("should wrap around and increment the round", () => {
      const state = createMockState(
        [createMockCombatant({ id: "1" }), createMockCombatant({ id: "2" })],
        1,
      ); // Currently on the last combatant

      const nextState = advanceTurn(state);
      expect(nextState.current_turn_index).toBe(0);
      expect(nextState.round).toBe(2);
    });

    it("should skip dead combatants", () => {
      const state = createMockState(
        [
          createMockCombatant({ id: "1", is_alive: true }),
          createMockCombatant({ id: "2", is_alive: false }), // Should be skipped
          createMockCombatant({ id: "3", is_alive: true }),
        ],
        0,
      );

      const nextState = advanceTurn(state);
      expect(nextState.current_turn_index).toBe(2);
    });
  });

  describe("applyDamage & applyHealing", () => {
    it("should reduce HP and not drop below 0", () => {
      const state = createMockState([createMockCombatant({ id: "1", hp: 10 })]);

      const nextState = applyDamage(state, "1", 15);
      expect(nextState.combatants[0].hp).toBe(0);
      expect(nextState.combatants[0].is_alive).toBe(false);
    });

    it("should increase HP and not exceed max_hp", () => {
      const state = createMockState([
        createMockCombatant({ id: "1", hp: 5, max_hp: 10, is_alive: true }),
      ]);

      const nextState = applyHealing(state, "1", 20);
      expect(nextState.combatants[0].hp).toBe(10);
      expect(nextState.combatants[0].is_alive).toBe(true);
    });

    it("should revive a combatant if healed from 0", () => {
      const state = createMockState([
        createMockCombatant({ id: "1", hp: 0, max_hp: 10, is_alive: false }),
      ]);

      const nextState = applyHealing(state, "1", 5);
      expect(nextState.combatants[0].hp).toBe(5);
      expect(nextState.combatants[0].is_alive).toBe(true);
    });
  });

  describe("Conditions", () => {
    it("should add a condition without duplicating", () => {
      const state = createMockState([
        createMockCombatant({ id: "1", conditions: ["prone"] as any }),
      ]);

      // Add a new one
      let nextState = addCondition(state, "1", "poisoned" as any);
      expect(nextState.combatants[0].conditions).toEqual(["prone", "poisoned"]);

      // Attempt to add existing
      nextState = addCondition(nextState, "1", "prone" as any);
      expect(nextState.combatants[0].conditions).toEqual(["prone", "poisoned"]); // unchanged
    });

    it("should remove a condition", () => {
      const state = createMockState([
        createMockCombatant({ id: "1", conditions: ["prone"] as any }),
      ]);

      const nextState = removeCondition(state, "1", "prone" as any);
      expect(nextState.combatants[0].conditions).toEqual([]);
    });
  });

  describe("Win/Loss Conditions", () => {
    it("isCombatOver: returns player win if all monsters are dead", () => {
      const state = createMockState([
        createMockCombatant({ type: "player", is_alive: true }),
        createMockCombatant({ type: "monster", is_alive: false }),
      ]);

      expect(isCombatOver(state)).toEqual({
        over: true,
        winningSide: "player",
      });
    });

    it("isCombatOver: returns monster win if all players are dead", () => {
      const state = createMockState([
        createMockCombatant({ type: "player", is_alive: false }),
        createMockCombatant({ type: "monster", is_alive: true }),
      ]);

      expect(isCombatOver(state)).toEqual({
        over: true,
        winningSide: "monster",
      });
    });

    it("isPlayerDead: accurately detects dead players", () => {
      const state = createMockState([
        createMockCombatant({ type: "player", is_alive: false }),
        createMockCombatant({ type: "player", is_alive: true }),
      ]);
      expect(isPlayerDead(state)).toBe(true);
    });
  });

  describe("selectDeathResolution", () => {
    it("should return one of the valid death resolution types", () => {
      const result = selectDeathResolution();
      const validOptions = ["capture", "benefactor", "pact", "corpse_run"];
      expect(validOptions).toContain(result);
    });
  });
});
