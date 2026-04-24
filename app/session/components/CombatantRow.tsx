import { Combatant } from "../[id]/page.types";

function hpPercent(hp: number, max: number) {
  return Math.max(0, Math.min(100, (hp / max) * 100));
}

function hpColor(pct: number) {
  if (pct > 60) return "bg-emerald-600";
  if (pct > 30) return "bg-amber-500";
  return "bg-red-600";
}

export default function CombatantRow({
  combatant,
  isCurrentTurn,
}: {
  combatant: Combatant;
  isCurrentTurn: boolean;
}) {
  const pct = hpPercent(combatant.hp, combatant.max_hp);

  return (
    <div
      className={`rounded p-2 space-y-1.5 transition-colors ${isCurrentTurn ? "bg-amber-900/25 border border-amber-700/40" : "bg-black/20 border border-transparent"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isCurrentTurn && (
            <span className="text-amber-400 text-[0.6rem] shrink-0">▶</span>
          )}
          <span
            className={`font-serif text-sm truncate ${combatant.type === "player" ? "text-amber-300" : "text-stone-300"}`}
          >
            {combatant.name}
          </span>
          {combatant.type === "player" && (
            <span className="text-[0.45rem] bg-amber-900/50 border border-amber-800/50 text-amber-600/80 px-1 rounded uppercase tracking-wider shrink-0">
              You
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0 text-[0.6rem] text-stone-500 font-sans">
          <span>Init {combatant.initiative}</span>
          <span>AC {combatant.ac}</span>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${hpColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[0.55rem] text-stone-500 font-sans">
          {combatant.hp} / {combatant.max_hp} HP
        </span>
      </div>
      {combatant.conditions && combatant.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {combatant.conditions.map((c) => (
            <span
              key={c}
              className="text-[0.5rem] bg-red-950/50 border border-red-900/50 text-red-400/80 px-1 rounded uppercase tracking-wider"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
