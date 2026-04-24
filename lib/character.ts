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

export function parseCharacterContext(ctx: string): CharacterData {
  if (!ctx) return {};
  const lines = ctx
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const data: CharacterData = {};
  for (const line of lines) {
    if (line.startsWith("Name:")) {
      data.name = line.replace("Name:", "").trim();
      continue;
    }
    if (line.startsWith("Background:")) {
      data.background = line.replace("Background:", "").trim();
      continue;
    }
    if (line.startsWith("Ability scores")) {
      for (const pair of line
        .replace("Ability scores —", "")
        .trim()
        .split("|")) {
        const [stat, val] = pair.trim().split(" ");
        const key = stat?.toLowerCase() as keyof CharacterData;
        if (key && val) (data as Record<string, string>)[key] = val;
      }
      continue;
    }
    const hpMatch = line.match(/HP:\s*(\d+)/);
    if (hpMatch) data.hp = hpMatch[1];
    const acMatch = line.match(/AC:\s*(\d+)/);
    if (acMatch) data.ac = acMatch[1];
    if (line.match(/Level \d+/)) {
      data.identity = line;
      continue;
    }
    if (
      !line.startsWith("HP:") &&
      !line.startsWith("AC:") &&
      !line.startsWith("Name:") &&
      !line.startsWith("Background:") &&
      !line.startsWith("Ability")
    ) {
      if (!data.notes) data.notes = line;
      else data.notes += " " + line;
    }
  }
  return data;
}

export function modifier(score: string | undefined): string {
  if (!score) return "—";
  const n = parseInt(score);
  if (isNaN(n)) return "—";
  const mod = Math.floor((n - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}
