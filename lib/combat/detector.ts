// Keywords that suggest combat is starting
const COMBAT_START_PATTERNS = [
  /\b(attack|charge|fight|draw (?:my |your )?(?:sword|weapon|bow)|cast (?:a )?(?:spell|fire bolt|magic missile)|ambush)\b/i,
  /\bgoblins? (?:leap|rush|attack|charge)\b/i,
  /\broll for initiative\b/i,
  /\bcombat (?:begins|starts)\b/i,
];

// Keywords in DM response that confirm combat started
const COMBAT_CONFIRM_PATTERNS = [
  /roll for initiative/i,
  /\bcombat (?:begins|starts|is underway)\b/i,
  /\btake your (?:first )?(?:action|turn)\b/i,
  /\binitiative order\b/i,
];

// Keywords in player message that suggest ending combat
const COMBAT_END_PATTERNS = [
  /\b(flee|run away|escape|retreat|disengage and run)\b/i,
];

// DM confirms combat over
const COMBAT_OVER_PATTERNS = [
  /\b(combat is over|all enemies (?:are )?(?:defeated|dead|fallen)|victory|enemies? (?:lie|lies) (?:dead|defeated))\b/i,
];

export function detectCombatStart(
  playerMessage: string,
  dmResponse: string,
): boolean {
  const playerTriggered = COMBAT_START_PATTERNS.some((p) =>
    p.test(playerMessage),
  );
  const dmConfirmed = COMBAT_CONFIRM_PATTERNS.some((p) => p.test(dmResponse));
  return playerTriggered || dmConfirmed;
}

export function detectCombatEnd(dmResponse: string): boolean {
  return COMBAT_OVER_PATTERNS.some((p) => p.test(dmResponse));
}

// Parse HP changes from DM narrative (best-effort)
// e.g. "The goblin takes 8 damage" or "You take 5 piercing damage"
export interface ParsedDamageEvent {
  targetName: string;
  amount: number;
}

export function parseDamageFromNarrative(text: string): ParsedDamageEvent[] {
  const events: ParsedDamageEvent[] = [];

  // Pattern: "<name> takes <N> damage" or "<name> takes <N> <type> damage"
  const pattern =
    /(\b[A-Z][a-z]+(?: [A-Z][a-z]+)*|you)\b (?:takes?|suffers?) (\d+)(?: \w+)? damage/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    events.push({
      targetName: match[1].toLowerCase() === "you" ? "player" : match[1],
      amount: parseInt(match[2], 10),
    });
  }

  return events;
}
