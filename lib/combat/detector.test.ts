import { describe, it, expect } from "vitest";
import {
  detectCombatStart,
  detectCombatEnd,
  parseDamageFromNarrative,
} from "./detector";

describe("Combat Detector", () => {
  describe("detectCombatStart", () => {
    it("should return true if the player triggers combat patterns", () => {
      const playerMsg = "I draw my sword and attack the bugbear!";
      const dmMsg = "The bugbear looks surprised.";
      expect(detectCombatStart(playerMsg, dmMsg)).toBe(true);
    });

    it("should return true if the DM confirms combat with initiative", () => {
      const playerMsg = "I try to sneak past.";
      const dmMsg = "A goblin spots you! Roll for initiative.";
      expect(detectCombatStart(playerMsg, dmMsg)).toBe(true);
    });

    it("should return false if no combat keywords are present", () => {
      const playerMsg = "I talk to the innkeeper.";
      const dmMsg = "He offers you a pint of ale.";
      expect(detectCombatStart(playerMsg, dmMsg)).toBe(false);
    });
  });

  describe("detectCombatEnd", () => {
    it("should confirm combat is over when enemies are defeated", () => {
      const dmMsg = "The last of the goblins lie dead. Combat is over.";
      expect(detectCombatEnd(dmMsg)).toBe(true);
    });

    it("should not end combat on generic narrative", () => {
      const dmMsg = "The goblin looks wounded but stays on its feet.";
      expect(detectCombatEnd(dmMsg)).toBe(false);
    });
  });

  describe("parseDamageFromNarrative", () => {
    it('should parse "you" as the "player"', () => {
      const text = "The arrow strikes true; you take 5 damage.";
      const result = parseDamageFromNarrative(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ targetName: "player", amount: 5 });
    });

    it("should parse named NPC damage correctly", () => {
      const text = "Klarg takes 12 slashing damage from your strike.";
      const result = parseDamageFromNarrative(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ targetName: "Klarg", amount: 12 });
    });

    it("should handle multiple damage events in one block of text", () => {
      const text = "You take 4 damage, and the Goblin takes 8 damage.";
      const result = parseDamageFromNarrative(text);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ targetName: "player", amount: 4 });
      expect(result[1]).toEqual({ targetName: "Goblin", amount: 8 });
    });

    it("should handle multi-word NPC names", () => {
      const text = "The Yeemik takes 10 damage.";
      const result = parseDamageFromNarrative(text);

      expect(result[0].targetName).toBe("Yeemik");
      expect(result[0].amount).toBe(10);
    });

    it("should return an empty array if no damage patterns match", () => {
      const text = "The goblin misses you widely.";
      expect(parseDamageFromNarrative(text)).toEqual([]);
    });
  });
});
