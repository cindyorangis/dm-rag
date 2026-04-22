export type CombatantType = "player" | "monster";

export type Condition =
  | "blinded"
  | "charmed"
  | "deafened"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious";

export interface Combatant {
  id: string;
  name: string;
  type: CombatantType;
  hp: number;
  max_hp: number;
  ac: number;
  initiative: number;
  initiative_mod: number;
  conditions: Condition[];
  is_alive: boolean;
}

export interface CombatLogEntry {
  round: number;
  turn: number;
  actor: string;
  description: string;
  timestamp: string;
}

export interface CombatState {
  id: string;
  session_id: string;
  is_active: boolean;
  round: number;
  current_turn_index: number;
  combatants: Combatant[];
  log: CombatLogEntry[];
  updated_at: string;
  // Set to true after combat starts but before the player has rolled initiative.
  // The frontend shows a dice roll prompt; once submitted, the backend sorts
  // combatants and clears this flag.
  awaiting_player_initiative?: boolean;
}
