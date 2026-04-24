export interface CharacterData {
  name?: string;
  identity?: string;
  background?: string;
  hp?: string;
  ac?: string;
  str?: string;
  dex?: string;
  con?: string;
  int?: string;
  wis?: string;
  cha?: string;
  notes?: string;
}

export interface Combatant {
  id: string;
  name: string;
  type: "player" | "monster";
  hp: number;
  max_hp: number;
  ac: number;
  initiative: number;
  initiative_mod: number;
  conditions?: string[];
  is_alive: boolean;
}

export interface CombatState {
  is_active: boolean;
  round: number;
  current_turn_index: number;
  combatants: Combatant[];
  log: { round: number; description: string }[];
  awaiting_player_initiative?: boolean;
}
