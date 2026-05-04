import { describe, it, expect, vi } from "vitest";
import { buildDMSystemPrompt, buildCombatStartPrompt } from "./dm-prompt";
import type { CombatState, Combatant } from "./combat/types";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("./narrative/adventure-meta", () => ({
  getAdventureMeta: vi.fn((slug) => ({
    title: slug === "lmop" ? "Lost Mine of Phandelver" : "Unknown Adventure",
    setting: "The Forgotten Realms",
    tone: "High fantasy and gritty combat",
  })),
}));

vi.mock("./narrative/death-resolutions", () => ({
  DEATH_RESOLUTION_SCRIPTS: {
    capture: "You have been captured by the enemy. You wake up in a cell.",
  },
}));

// ─── Mock Data Helpers ───────────────────────────────────────────────────────

const mockPlayer: Combatant = {
  id: "p1",
  name: "Valerius",
  type: "player",
  hp: 20,
  max_hp: 20,
  ac: 16,
  initiative: 15,
  initiative_mod: 2,
  is_alive: true,
  conditions: [],
};

const mockMonster: Combatant = {
  id: "m1",
  name: "Goblin",
  type: "monster",
  hp: 7,
  max_hp: 7,
  ac: 12,
  initiative: 10,
  initiative_mod: 1,
  is_alive: true,
  conditions: [],
};

const createMockCombatState = (
  overrides: Partial<CombatState> = {},
): CombatState => ({
  id: "state-123",
  session_id: "session-456",
  is_active: true,
  round: 1,
  current_turn_index: 0,
  combatants: [mockPlayer, mockMonster],
  log: [],
  updated_at: new Date().toISOString(),
  awaiting_player_initiative: false,
  ...overrides,
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("DM Prompt Builder", () => {
  describe("buildDMSystemPrompt", () => {
    it("assembles the base exploration prompt when no combat is active", () => {
      const prompt = buildDMSystemPrompt({
        retrievedChunks: ["Chunk 1: Phandalin is a small town."],
        combatState: null,
        characterContext: "Level 1 Paladin",
        adventureSlug: "lmop",
      });

      expect(prompt).toContain("The adventure is Lost Mine of Phandelver");
      expect(prompt).toContain("Level 1 Paladin");
      expect(prompt).toContain("Chunk 1: Phandalin is a small town.");
      expect(prompt).toContain("No combat active.");
      expect(prompt).toContain("[STATUS]"); // Ensures structured output rules are appended
    });

    it("includes a fallback character message if no context is provided", () => {
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState: null,
        adventureSlug: "lmop",
      });

      expect(prompt).toContain(
        "No character sheet provided. Generate a suitable adventurer",
      );
    });

    it("injects specific instructions when awaiting player initiative", () => {
      const combatState = createMockCombatState({
        awaiting_player_initiative: true,
      });
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState,
        adventureSlug: "lmop",
      });

      expect(prompt).toContain("COMBAT INSTRUCTIONS: AWAITING INITIATIVE");
      expect(prompt).toContain("The player is about to roll their initiative.");
    });

    it("formats the initiative order correctly during active combat", () => {
      const combatState = createMockCombatState({ current_turn_index: 0 }); // Player turn
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState,
        adventureSlug: "lmop",
      });

      expect(prompt).toContain("INITIATIVE ORDER:");
      expect(prompt).toContain("▶ Valerius (player) | HP: 20/20"); // Current turn marker
      expect(prompt).toContain("Goblin (monster) | HP: 7/7");
      expect(prompt).toContain("--- COMBAT INSTRUCTIONS: PLAYER'S TURN ---");
      expect(prompt).toContain("[ROLL: attack d20+<attack_bonus>");
    });

    it("provides monster turn instructions when it is the NPC's turn", () => {
      const combatState = createMockCombatState({ current_turn_index: 1 }); // Monster turn
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState,
        adventureSlug: "lmop",
      });

      expect(prompt).toContain("It is Goblin's turn (a MONSTER/NPC)");
      expect(prompt).toContain("NEVER show dice arithmetic");
      expect(prompt).toContain("Next: Valerius (player)");
    });

    it("injects death resolution scripts when a player is downed", () => {
      const combatState = createMockCombatState({
        deathResolution: {
          type: "capture",
          applied: false,
          lingeringEffect: "Weakened",
        },
      });
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState,
        adventureSlug: "lmop",
      });

      expect(prompt).toContain(
        "You have been captured by the enemy. You wake up in a cell.",
      );
      expect(prompt).toContain("LINGERING EFFECT: Weakened");
    });

    it("includes narrative flags in the prompt", () => {
      const narrativeFlags = { met_sildar: true, goblin_friend: false };
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState: null,
        narrativeFlags,
      });

      expect(prompt).toContain("met_sildar: true");
      expect(prompt).toContain("goblin_friend: false");
    });

    it("includes rolling memory when provided", () => {
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState: null,
        rollingSummary: "Active quest: Find Gundren. NPC trust: Sildar=high.",
      });

      expect(prompt).toContain("--- SESSION MEMORY (COMPRESSED) ---");
      expect(prompt).toContain("Active quest: Find Gundren");
    });

    it("includes structured memory when provided", () => {
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState: null,
        structuredMemory: {
          active_quests: [
            {
              name: "Find Gundren",
              status: "active",
              progress: "Following goblin tracks toward Cragmaw.",
              priority: "high",
            },
          ],
          npc_trust: [
            {
              npc: "Sildar Hallwinter",
              trust: "friendly",
              basis: "You rescued him from the hideout.",
            },
          ],
          inventory_changes: [
            {
              item: "Potion of Healing",
              change: "gained",
              quantity: "1",
              note: "Looted from Klarg's chest.",
            },
          ],
          unresolved_hooks: [
            {
              hook: "Who controls the Black Spider network?",
              urgency: "medium",
              note: "Still no confirmed identity.",
            },
          ],
        },
      });

      expect(prompt).toContain("--- SESSION MEMORY (STRUCTURED) ---");
      expect(prompt).toContain("ACTIVE QUESTS:");
      expect(prompt).toContain("NPC TRUST:");
      expect(prompt).toContain("INVENTORY CHANGES:");
      expect(prompt).toContain("UNRESOLVED HOOKS:");
    });

    it("injects low-confidence guidance when retrieval confidence is low", () => {
      const prompt = buildDMSystemPrompt({
        retrievedChunks: [],
        combatState: null,
        retrievalConfidence: {
          score: 0.21,
          level: "low",
          reason: "Weak retrieval match.",
          chunkCount: 1,
          requestedChunkCount: 4,
          avgSimilarity: 0.21,
          maxSimilarity: 0.21,
        },
      });

      expect(prompt).toContain("--- RETRIEVAL CONFIDENCE ---");
      expect(prompt).toContain("Level: LOW");
      expect(prompt).toContain("--- LOW CONFIDENCE BEHAVIOR ---");
      expect(prompt).toContain("Ask exactly ONE clarifying question");
    });
  });

  describe("buildCombatStartPrompt", () => {
    it("generates a dramatic start string with monster names", () => {
      const combatants = [mockPlayer, mockMonster];
      const prompt = buildCombatStartPrompt(combatants);

      expect(prompt).toContain("COMBAT HAS BEGUN");
      expect(prompt).toContain("Enemies: Goblin");
      expect(prompt).toContain("Announce that initiative is being determined");
    });
  });
});
