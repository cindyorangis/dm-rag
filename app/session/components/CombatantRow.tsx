import { Combatant } from "@/lib/combat/types";

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
      className={`space-y-2 rounded border p-2.5 transition-colors ${
        isCurrentTurn
          ? "border-amber-500/50 bg-amber-900/30"
          : "border-stone-700/60 bg-black/20"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isCurrentTurn && (
            <span className="shrink-0 text-xs text-amber-200">{">"}</span>
          )}
          <span
            className={`truncate font-serif text-base ${
              combatant.type === "player" ? "text-amber-200" : "text-stone-100"
            }`}
          >
            {combatant.name}
          </span>
          {combatant.type === "player" && (
            <span className="shrink-0 rounded border border-amber-700/70 bg-amber-900/50 px-1 text-[0.6rem] uppercase tracking-[0.12em] text-amber-200">
              You
            </span>
          )}
        </div>
        <div className="flex shrink-0 gap-2 text-xs text-stone-300">
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
        <span className="text-xs text-stone-300/90">
          {combatant.hp} / {combatant.max_hp} HP
        </span>
      </div>
      {combatant.conditions && combatant.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {combatant.conditions.map((c) => (
            <span
              key={c}
              className="rounded border border-red-700/60 bg-red-950/50 px-1.5 text-[0.65rem] uppercase tracking-[0.12em] text-red-200"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
