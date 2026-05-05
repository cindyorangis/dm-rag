import { describe, it, expect } from "vitest";
import { parseCharacterContext, modifier } from "./character";

describe("Character Utilities", () => {
  describe("modifier", () => {
    it("calculates positive modifiers correctly", () => {
      expect(modifier("10")).toBe("+0");
      expect(modifier("12")).toBe("+1");
      expect(modifier("18")).toBe("+4");
      expect(modifier("20")).toBe("+5");
    });

    it("calculates negative modifiers correctly", () => {
      expect(modifier("8")).toBe("-1");
      expect(modifier("1")).toBe("-5");
    });

    it("handles undefined or invalid input gracefully", () => {
      expect(modifier(undefined)).toBe("—");
      expect(modifier("")).toBe("—");
      expect(modifier("abc")).toBe("—");
    });
  });

  describe("parseCharacterContext", () => {
    it("returns an empty object for empty input", () => {
      expect(parseCharacterContext("")).toEqual({});
    });

    it("parses name, background, and identity (Level X)", () => {
      const input = `
        Name: Klarg the Kind
        Level 1 Bugbear Cleric
        Background: A reformed monster seeking redemption.
      `;
      const result = parseCharacterContext(input);

      expect(result.name).toBe("Klarg the Kind");
      expect(result.identity).toBe("Level 1 Bugbear Cleric");
      expect(result.background).toBe("A reformed monster seeking redemption.");
    });

    it("parses HP and AC correctly", () => {
      const input = "HP: 12\nAC: 15";
      const result = parseCharacterContext(input);

      expect(result.hp).toBe("12");
      expect(result.ac).toBe("15");
    });

    it("parses complex ability score lines", () => {
      const input =
        "Ability scores — STR 15 | DEX 14 | CON 13 | INT 12 | WIS 10 | CHA 8";
      const result = parseCharacterContext(input);

      expect(result.str).toBe("15");
      expect(result.dex).toBe("14");
      expect(result.con).toBe("13");
      expect(result.int).toBe("12");
      expect(result.wis).toBe("10");
      expect(result.cha).toBe("8");
    });

    it("aggregates unrecognized lines into notes", () => {
      const input = `
        Name: Gimli
        He loves gold.
        He hates heights.
        HP: 10
      `;
      const result = parseCharacterContext(input);

      expect(result.name).toBe("Gimli");
      expect(result.hp).toBe("10");
      // Note the space joining the two freeform lines
      expect(result.notes).toBe("He loves gold. He hates heights.");
    });

    it("handles a full premade character block", () => {
      const input = `
        Name: Sildar Hallwinter
        Level 3 Human Fighter
        HP: 27
        AC: 16
        Ability scores — STR 14 | DEX 10 | CON 12 | INT 10 | WIS 11 | CHA 10
        Background: A veteran member of the Lords' Alliance.
        Sildar is a kindhearted man of nearly fifty years.
      `;

      const result = parseCharacterContext(input);

      expect(result).toMatchObject({
        name: "Sildar Hallwinter",
        identity: "Level 3 Human Fighter",
        hp: "27",
        ac: "16",
        str: "14",
        cha: "10",
        background: "A veteran member of the Lords' Alliance.",
        notes: "Sildar is a kindhearted man of nearly fifty years.",
      });
    });
  });
});
