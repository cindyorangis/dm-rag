export type DieSize = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export function roll(sides: DieSize): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollMultiple(count: number, sides: DieSize): number[] {
  return Array.from({ length: count }, () => roll(sides));
}

export function rollSum(count: number, sides: DieSize, modifier = 0): number {
  return rollMultiple(count, sides).reduce((a, b) => a + b, 0) + modifier;
}

export function rollInitiative(dexMod: number): number {
  return roll(20) + dexMod;
}

export function rollAttack(attackBonus: number): {
  total: number;
  natural: number;
  isCrit: boolean;
} {
  const natural = roll(20);
  return {
    natural,
    total: natural + attackBonus,
    isCrit: natural === 20,
  };
}

export function rollDamage(
  diceCount: number,
  dieSides: DieSize,
  modifier: number,
  isCrit: boolean,
): number {
  // Crit: roll damage dice twice
  const rolls = isCrit
    ? rollMultiple(diceCount * 2, dieSides)
    : rollMultiple(diceCount, dieSides);
  return rolls.reduce((a, b) => a + b, 0) + modifier;
}
