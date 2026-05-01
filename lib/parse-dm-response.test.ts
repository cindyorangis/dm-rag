import { describe, it, expect } from "vitest";
import {
  parseDMResponse,
  parseDMResponsePartial,
  getCleanNarrativeForSpeech,
} from "./parse-dm-response";

describe("DM Response Parser", () => {
  // ─── Structured Parser ──────────────────────────────────────────────────────

  describe("parseDMResponse (Structured)", () => {
    it("parses a fully-formed structured block", () => {
      const raw = `
        The goblin falls with a thud. You stand victorious in the cave.

        [STATUS]
        * The goblin is dead.
        * You are in Cragmaw Hideout.
        [/STATUS]

        [HINTS]
        [explore] Search the bodies | I want to search the goblin for any loot.
        [action] Move deeper | I head further into the tunnel.
        [/HINTS]
      `;

      const result = parseDMResponse(raw);

      expect(result.narrative).toBe(
        "The goblin falls with a thud. You stand victorious in the cave.",
      );
      expect(result.statusItems).toHaveLength(2);
      expect(result.statusItems[0]).toBe("The goblin is dead.");
      expect(result.hints).toHaveLength(2);
      expect(result.hints[0]).toEqual({
        tag: "explore",
        text: "Search the bodies",
        prompt: "I want to search the goblin for any loot.",
      });
    });

    it("uses the hint label as prompt when no pipe separator is present", () => {
      const raw = `
        [HINTS]
        [lore] Examine ruins
        [/HINTS]
      `;
      const result = parseDMResponse(raw);
      expect(result.hints[0].prompt).toBe("Examine ruins");
    });

    it("caps hints at 4 even when more are provided", () => {
      const raw = `
        Narrative text.
        [HINTS]
        [action] Do thing 1 | prompt 1
        [action] Do thing 2 | prompt 2
        [action] Do thing 3 | prompt 3
        [action] Do thing 4 | prompt 4
        [action] Do thing 5 | prompt 5
        [/HINTS]
      `;
      const result = parseDMResponse(raw);
      expect(result.hints).toHaveLength(4);
    });

    it("falls back to 'action' tag for unknown hint categories", () => {
      const raw = `
        [HINTS]
        [mystery] Investigate clue | Look around carefully.
        [/HINTS]
      `;
      const result = parseDMResponse(raw);
      expect(result.hints[0].tag).toBe("action");
    });
  });

  // ─── Freeform Fallback ──────────────────────────────────────────────────────

  describe("parseDMResponse (Freeform Fallback)", () => {
    it("extracts bullet points when no [STATUS] tags are present", () => {
      const raw = `
        You enter the tavern.
        * The air is thick with smoke.
        * A bard is playing a lute.
      `;
      const result = parseDMResponse(raw);

      expect(result.statusItems).toContain("The air is thick with smoke.");
      expect(result.narrative).toBe("You enter the tavern.");
    });

    it("extracts status-flavored sentences when no bullets are present", () => {
      const raw =
        "The Redbrands are watching you. You have arrived at the Sleeping Giant.";
      const result = parseDMResponse(raw);

      expect(result.statusItems).toContain("The Redbrands are watching you.");
      expect(result.statusItems).toContain(
        "You have arrived at the Sleeping Giant.",
      );
    });

    it("does not extract a status sentence when only one match exists (avoids narrative cannibalization)", () => {
      const raw = "You are standing in a quiet forest clearing.";
      const result = parseDMResponse(raw);
      // Single match — should NOT be pulled out as a status item
      expect(result.statusItems).toHaveLength(0);
    });

    it("returns empty hints for freeform responses", () => {
      const raw = "A wolf howls in the distance.";
      const result = parseDMResponse(raw);
      expect(result.hints).toHaveLength(0);
    });
  });

  // ─── Streaming (Partial) ────────────────────────────────────────────────────

  describe("parseDMResponsePartial (Streaming)", () => {
    it("strips a partial [STA tag from narrative mid-stream", () => {
      // LLM finished narrative and has started emitting [STATUS]
      const raw = "The door creaks open. [STA";
      const result = parseDMResponsePartial(raw);

      expect(result.narrative).toBe("The door creaks open.");
      expect(result.statusItems).toHaveLength(0);
    });

    it("strips open-ended tag blocks that bleed into narrative", () => {
      const raw = 'You win! [FLAG_OPS] {"internal": true}';
      const result = parseDMResponsePartial(raw);
      expect(result.narrative).toBe("You win!");
    });

    it("passes through clean narrative with no tag noise", () => {
      const raw = "You cautiously push the door open and step inside.";
      const result = parseDMResponsePartial(raw);
      expect(result.narrative).toBe(raw);
    });

    it("resolves STATUS items once the block is closed", () => {
      const raw = `
        You defeat the goblin.
        [STATUS]
        * Goblin defeated.
        [/STATUS]
      `;
      const result = parseDMResponsePartial(raw);
      expect(result.statusItems).toContain("Goblin defeated.");
    });
  });

  // ─── TTS / Speech Cleaning ──────────────────────────────────────────────────

  describe("getCleanNarrativeForSpeech", () => {
    it("strips [ROLL] tags, [STATUS] blocks, and markdown emphasis", () => {
      const raw = `
        You hit the *Goblin*! [ROLL: attack 18 vs 12]
        [STATUS]
        * Goblin is hurt.
        [/STATUS]
      `;
      const clean = getCleanNarrativeForSpeech(raw);

      expect(clean).not.toContain("ROLL");
      expect(clean).not.toContain("*");
      expect(clean).not.toContain("Goblin is hurt");
      expect(clean).toBe("You hit the Goblin!");
    });

    it("returns an empty string for a response that is all tags", () => {
      const raw = `
        [STATUS]
        * Only status here.
        [/STATUS]
      `;
      expect(getCleanNarrativeForSpeech(raw)).toBe("");
    });
  });
});
