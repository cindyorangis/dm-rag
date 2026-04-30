import { describe, it, expect, vi, beforeEach } from "vitest";
import { roll, rollInitiative, rollAttack, rollDamage } from "./dice";

describe("Dice Logic", () => {
  // We mock Math.random so we can predict the outcomes
  beforeEach(() => {
    vi.spyOn(Math, "random");
  });

  it("roll: should return 1 when random is 0", () => {
    vi.mocked(Math.random).mockReturnValue(0);
    expect(roll(20)).toBe(1);
  });

  it("roll: should return the max side when random is nearly 1", () => {
    vi.mocked(Math.random).mockReturnValue(0.999);
    expect(roll(20)).toBe(20);
  });

  it("rollInitiative: should correctly add the Dexterity modifier", () => {
    // Force a natural 10
    vi.mocked(Math.random).mockReturnValue(0.45); // (0.45 * 20) = 9 -> floor(9)+1 = 10
    const dexMod = 3;
    expect(rollInitiative(dexMod)).toBe(13);
  });

  describe("rollAttack", () => {
    it("should report a critical hit on a natural 20", () => {
      vi.mocked(Math.random).mockReturnValue(0.999); // Natural 20
      const result = rollAttack(5);

      expect(result.natural).toBe(20);
      expect(result.total).toBe(25);
      expect(result.isCrit).toBe(true);
    });

    it("should not report a crit on a natural 19", () => {
      vi.mocked(Math.random).mockReturnValue(0.94); // Natural 19
      const result = rollAttack(5);

      expect(result.natural).toBe(19);
      expect(result.isCrit).toBe(false);
    });
  });

  describe("rollDamage", () => {
    it("should roll single dice on a normal hit", () => {
      // Force a 4 on a d6
      vi.mocked(Math.random).mockReturnValue(0.5);
      const damage = rollDamage(1, 6, 2, false); // 1d6 + 2

      // (floor(0.5 * 6) + 1) + 2 = 4 + 2 = 6
      expect(damage).toBe(6);
    });

    it("should double the number of dice on a critical hit", () => {
      // Mocking 0 makes every die a "1"
      vi.mocked(Math.random).mockReturnValue(0);

      // 2d6 + 5 critical should be (1 + 1) + 5 = 7
      expect(rollDamage(1, 6, 5, true)).toBe(7);
    });
  });
});
