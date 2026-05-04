import { describe, expect, it, vi } from "vitest";
import {
  isCriticalTurn,
  runCriticalTurnSelfCheck,
  shouldRunSelfCheckPreflight,
  validateCriticalTurnResponse,
} from "./dm-self-check";
import type { CombatState } from "./combat/types";

vi.mock("./llmClient", () => ({
  createLlmChatCompletion: vi.fn(),
  readLlmChatContent: vi.fn(),
  readLlmError: vi.fn(),
}));

const combatStatePlayerTurn: CombatState = {
  id: "combat-1",
  session_id: "session-1",
  is_active: true,
  round: 1,
  current_turn_index: 0,
  combatants: [
    {
      id: "player-1",
      name: "Aria",
      type: "player",
      hp: 12,
      max_hp: 12,
      ac: 15,
      initiative: 18,
      initiative_mod: 3,
      conditions: [],
      is_alive: true,
    },
    {
      id: "goblin-1",
      name: "Goblin",
      type: "monster",
      hp: 7,
      max_hp: 7,
      ac: 13,
      initiative: 12,
      initiative_mod: 2,
      conditions: [],
      is_alive: true,
    },
  ],
  log: [],
  awaiting_player_initiative: false,
  updated_at: new Date().toISOString(),
};

describe("dm self-check", () => {
  it("detects critical turns from combat state", () => {
    expect(
      isCriticalTurn({
        playerMessage: "I move forward.",
        dmResponse: "The corridor narrows.",
        combatState: combatStatePlayerTurn,
      }),
    ).toBe(true);
  });

  it("detects critical turns from FLAG_OPS quest updates", () => {
    expect(
      isCriticalTurn({
        playerMessage: "I spare him.",
        dmResponse:
          'You lower your blade.\n[STATUS]\n* test\n[/STATUS]\n[HINTS]\n[action] x | y\n[/HINTS]\n[FLAG_OPS]{"set":{"spared_goblin":true}}[/FLAG_OPS]',
        combatState: null,
      }),
    ).toBe(true);
  });

  it("preflight catches likely critical combat intents", () => {
    expect(
      shouldRunSelfCheckPreflight({
        playerMessage: "I attack the goblin.",
        combatState: null,
      }),
    ).toBe(true);
  });

  it("flags malformed critical-turn responses", () => {
    const issues = validateCriticalTurnResponse({
      playerMessage: "I attack",
      dmResponse:
        "The goblin *rolls* a d20.\n[ROLL: attack d20+5 vs AC 13 target:Goblin]\n[ROLL: damage 1d8+3 target:Goblin]",
      combatState: combatStatePlayerTurn,
    });

    const codes = issues.map((i) => i.code);
    expect(codes).toContain("missing_status_block");
    expect(codes).toContain("missing_hints_block");
    expect(codes).toContain("forbidden_dice_narration");
    expect(codes).toContain("multiple_roll_tags");
    expect(codes).toContain("combined_attack_and_damage");
  });

  it("strict mode applies deterministic fallback when repair is disabled", async () => {
    const result = await runCriticalTurnSelfCheck({
      provider: "ollama",
      context: {
        playerMessage: "I attack",
        dmResponse: "The goblin *rolls* a d20 and lunges.",
        combatState: combatStatePlayerTurn,
      },
      repairEnabled: false,
      strictMode: true,
    });

    expect(result.repaired).toBe(true);
    expect(result.response).toContain("[STATUS]");
    expect(result.response).toContain("[HINTS]");
    expect(result.issuesAfter.length).toBeLessThan(result.issuesBefore.length);
  });
});
