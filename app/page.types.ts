export interface CharacterFields {
  name: string;
  race: string;
  charClass: string;
  background: string;
  level: string;
  hp: string;
  ac: string;
  str: string;
  dex: string;
  con: string;
  int: string;
  wis: string;
  cha: string;
  notes: string;
}

// Matches the characters table schema
export interface PremadeCharacter {
  id: string;
  name: string;
  race: string | null;
  class: string | null;
  level: number | null;
  background: string | null;
  alignment: string | null;
  str: number | null;
  dex: number | null;
  con: number | null;
  int: number | null;
  wis: number | null;
  cha: number | null;
  ac: number | null;
  max_hp: number | null;
  speed: number | null;
  hit_dice: string | null;
  personality_traits: string | null;
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  features_and_traits: unknown[] | null;
  equipment: unknown[] | null;
  notes: string | null;
  proficiency_bonus: number;
  passive_wisdom: number;
}
