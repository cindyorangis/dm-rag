import { describe, it, expect } from "vitest";
import {
  spawnMonster,
  spawnMultiple,
  detectEncounterKey,
  buildEncounterMonstersOnly,
} from "./encounters";

describe("Encounter System", () => {
  describe("spawnMonster", () => {
    it("should create a monster from a valid template", () => {
      const monster = spawnMonster("bugbear");
      expect(monster.name).toBe("Bugbear");
      expect(monster.hp).toBe(27);
      expect(monster.id).toBeDefined(); // UUID generated
    });

    it("should apply overrides to the template", () => {
      const monster = spawnMonster("goblin", { hp: 10, name: "Elite Goblin" });
      expect(monster.hp).toBe(10);
      expect(monster.name).toBe("Elite Goblin");
      expect(monster.ac).toBe(15); // Original template value remains
    });

    it("should throw an error for unknown monster templates", () => {
      expect(() => spawnMonster("tiamat")).toThrow("Unknown monster: tiamat");
    });
  });

  describe("spawnMultiple", () => {
    it("should return the correct count of monsters", () => {
      const monsters = spawnMultiple("wolf", 3);
      expect(monsters).toHaveLength(3);
    });

    it("should append numbers to names when spawning multiples", () => {
      const monsters = spawnMultiple("goblin", 2);
      expect(monsters[0].name).toBe("Goblin 1");
      expect(monsters[1].name).toBe("Goblin 2");
    });

    it("should not append numbers when spawning a single monster", () => {
      const monsters = spawnMultiple("owlbear", 1);
      expect(monsters[0].name).toBe("Owlbear");
    });

    it("should ensure each monster has a unique ID", () => {
      const monsters = spawnMultiple("goblin", 2);
      expect(monsters[0].id).not.toBe(monsters[1].id);
    });
  });

  describe("detectEncounterKey", () => {
    it("should detect Cragmaw Hideout based on DM response", () => {
      const player = "I approach the cave mouth.";
      const dm = "You have reached the Cragmaw Hideout entrance.";
      expect(detectEncounterKey(player, dm)).toBe("cragmaw_hideout_entrance");
    });

    it("should detect the Black Spider boss fight via hints", () => {
      const player = "I challenge the wizard!";
      const dm = "Nezznar the Black Spider turns to face you.";
      expect(detectEncounterKey(player, dm)).toBe("wave_echo_cave_final");
    });

    it("should fall back to the ambush encounter if no hints match", () => {
      const player = "I walk through the forest.";
      const dm = "Something moves in the bushes.";
      expect(detectEncounterKey(player, dm)).toBe("triboar_trail_ambush");
    });
  });

  describe("buildEncounterMonstersOnly", () => {
    it("should build the correct monster list for a specific key", () => {
      // cragmaw_hideout_interior: 3 goblins + 1 goblin boss = 4 total
      const monsters = buildEncounterMonstersOnly("cragmaw_hideout_interior");
      expect(monsters).toHaveLength(4);
      expect(
        monsters.filter((m) => m.name.includes("Goblin Boss")),
      ).toHaveLength(1);
    });

    it("should return default encounter if key is missing", () => {
      const monsters = buildEncounterMonstersOnly("non_existent_key");
      // triboar_trail_ambush: 4 goblins
      expect(monsters).toHaveLength(4);
      expect(monsters[0].name).toContain("Goblin");
    });
  });
});
