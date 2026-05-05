import { describe, it, expect } from "vitest";
import {
  sanitizeNarrativeFlags,
  parseNarrativeFlagOpsFromText,
  applyNarrativeFlagOps,
  stripNarrativeFlagOpsBlocks,
  type NarrativeFlags,
} from "./flags";

describe("Narrative Flags Logic", () => {
  describe("sanitizeNarrativeFlags", () => {
    it("should allow valid keys and values", () => {
      const input = {
        has_met_king: true,
        gold_amount: 150,
        current_city: "Neverwinter",
      };
      expect(sanitizeNarrativeFlags(input)).toEqual(input);
    });

    it("should strictly enforce lowercase, underscores, and numbers", () => {
      const input = {
        valid_123: true,
        No_Caps: false, // Stripped
        "no-hyphens": 10, // Stripped
        "no spaces": "oops", // Stripped
        "!!!": "symbols", // Stripped
        "": "empty", // Stripped (min length is 1)
      };
      const result = sanitizeNarrativeFlags(input);
      expect(result).toEqual({ valid_123: true });
    });

    it("should return empty object for non-object inputs", () => {
      expect(sanitizeNarrativeFlags(null)).toEqual({});
      expect(sanitizeNarrativeFlags([])).toEqual({});
    });
  });

  describe("parseNarrativeFlagOpsFromText", () => {
    it("should pick the LAST block if multiple are provided", () => {
      // Using 2+ character keys to be safe
      const raw =
        '[FLAG_OPS] {"set": {"flag_a": true}} [/FLAG_OPS] [FLAG_OPS] {"set": {"flag_b": true}} [/FLAG_OPS]';
      const result = parseNarrativeFlagOpsFromText(raw);
      expect(result).toEqual({ set: { flag_b: true } });
    });

    it("should handle LLM markdown garbage inside tags", () => {
      const raw =
        '[FLAG_OPS] ```json\n{ "inc": { "gold": 10 } }\n``` [/FLAG_OPS]';
      const result = parseNarrativeFlagOpsFromText(raw);
      expect(result).toEqual({ inc: { gold: 10 } });
    });

    it("should return null for invalid JSON", () => {
      const raw = "[FLAG_OPS] { not json } [/FLAG_OPS]";
      expect(parseNarrativeFlagOpsFromText(raw)).toBeNull();
    });
  });

  describe("applyNarrativeFlagOps", () => {
    it("should correctly set new values and overwrite old ones", () => {
      const current: NarrativeFlags = { gold: 10, name: "Grog" };
      const ops = { set: { gold: 20, is_happy: true } };
      const next = applyNarrativeFlagOps(current, ops);

      expect(next).toEqual({ gold: 20, name: "Grog", is_happy: true });
    });

    it("should increment numeric values", () => {
      const current: NarrativeFlags = { gold: 10 };
      const ops = { inc: { gold: 5, xp: 100 } };
      const next = applyNarrativeFlagOps(current, ops);

      expect(next.gold).toBe(15);
      expect(next.xp).toBe(100); // Should initialize to 0 then add 100
    });

    it("should remove keys via unset", () => {
      const current: NarrativeFlags = { temp_flag: true, permanent: true };
      const ops = { unset: ["temp_flag"] };
      const next = applyNarrativeFlagOps(current, ops);

      expect(next).toEqual({ permanent: true });
      expect(next).not.toHaveProperty("temp_flag");
    });
  });

  describe("stripNarrativeFlagOpsBlocks", () => {
    it("should remove the tags and content for clean UI display", () => {
      const raw =
        'The dragon falls! [FLAG_OPS] {"set": {"killed_dragon": true}} [/FLAG_OPS]';
      const clean = stripNarrativeFlagOpsBlocks(raw);
      expect(clean).toBe("The dragon falls!");
    });

    it("should handle multiple blocks and extra whitespace", () => {
      const raw =
        "Line 1\n[FLAG_OPS]...[/FLAG_OPS]\nLine 2\n[FLAG_OPS]...[/FLAG_OPS]";
      const clean = stripNarrativeFlagOpsBlocks(raw);
      expect(clean).toBe("Line 1\n\nLine 2");
    });
  });
});
