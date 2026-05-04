import { describe, expect, it } from "vitest";
import { buildTurnObservabilityMetric } from "./observability";
import type { CombatState } from "./combat/types";

const baseCombatState: CombatState = {
  id: "combat-1",
  session_id: "session-1",
  is_active: true,
  round: 2,
  current_turn_index: 0,
  combatants: [
    {
      id: "player-1",
      name: "Aria",
      type: "player",
      hp: 10,
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
      hp: 4,
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

describe("buildTurnObservabilityMetric", () => {
  it("computes token, retrieval, and hint quality metrics", () => {
    const dmResponse = `You step between broken columns and raise your shield.

[STATUS]
* You are inside the ruined crypt.
* Goblins are trying to flank you.
* Sister Garaele is waiting in town for your report.
[/STATUS]

[HINTS]
[action] Strike the closest goblin | I rush the nearest goblin and slash with my longsword.
[explore] Check for side passages | I quickly scan the chamber for hidden exits or alcoves.
[social] Call for surrender | I shout for the goblins to drop their weapons and yield.
[lore] Recall crypt history | I search my memory for what this crypt was built to protect.
[/HINTS]`;

    const metric = buildTurnObservabilityMetric({
      sessionId: "session-1",
      adventureSlug: "lost-mine-of-phandelver",
      provider: "groq",
      systemPrompt: "You are the DM.",
      messages: [{ role: "user", content: "I move into the crypt." }],
      dmResponse,
      latencyMs: 1450,
      firstTokenLatencyMs: 320,
      retrieval: {
        chunksRequested: 4,
        minSimilarityThreshold: 0.2,
        similarities: [0.7, 0.5, 0.1],
      },
      combatState: baseCombatState,
      awaitingPlayerInitiative: false,
    });

    expect(metric.total_tokens_estimated).toBeGreaterThan(0);
    expect(metric.rag_chunks_requested).toBe(4);
    expect(metric.rag_chunks_returned).toBe(3);
    expect(metric.rag_hit_rate).toBe(0.75);
    expect(metric.rag_high_confidence_rate).toBe(0.667);
    expect(metric.hint_count).toBe(4);
    expect(metric.hint_diversity_count).toBe(4);
    expect(metric.hint_quality_score).toBeGreaterThan(0.8);
    expect(metric.combat_rule_error_count).toBe(0);
  });

  it("flags rule-shape violations for bad combat output", () => {
    const dmResponse = `The goblin *rolls* a d20 and strikes.
[ROLL: attack d20+5 vs AC 13 target:Goblin]
[ROLL: damage 1d8+3 target:Goblin]`;

    const metric = buildTurnObservabilityMetric({
      sessionId: "session-2",
      adventureSlug: "lost-mine-of-phandelver",
      provider: "ollama",
      systemPrompt: "You are the DM.",
      messages: [{ role: "user", content: "I attack." }],
      dmResponse,
      latencyMs: 500,
      firstTokenLatencyMs: null,
      retrieval: {
        chunksRequested: 4,
        similarities: [],
      },
      combatState: baseCombatState,
      awaitingPlayerInitiative: false,
    });

    expect(metric.combat_rule_error_count).toBeGreaterThanOrEqual(3);
    expect(metric.combat_rule_errors).toContain("missing_status_block");
    expect(metric.combat_rule_errors).toContain("missing_hints_block");
    expect(metric.combat_rule_errors).toContain("forbidden_dice_narration");
    expect(metric.combat_rule_errors).toContain(
      "combined_attack_and_damage_roll_tags",
    );
  });
});
