import { PremadeCharacter } from "@/app/page.types";

const CLASS_COLOURS: Record<string, { border: string; glow: string; badge: string }> = {
  Barbarian: {
    border: "border-red-800/60",
    glow: "rgba(180,30,30,0.15)",
    badge: "bg-red-900/40 text-red-300",
  },
  Bard: {
    border: "border-purple-800/60",
    glow: "rgba(140,60,200,0.15)",
    badge: "bg-purple-900/40 text-purple-300",
  },
  Cleric: {
    border: "border-yellow-700/60",
    glow: "rgba(200,170,30,0.15)",
    badge: "bg-yellow-900/40 text-yellow-300",
  },
  Druid: {
    border: "border-green-800/60",
    glow: "rgba(30,120,60,0.15)",
    badge: "bg-green-900/40 text-green-300",
  },
  Fighter: {
    border: "border-slate-600/60",
    glow: "rgba(80,100,130,0.15)",
    badge: "bg-slate-800/40 text-slate-300",
  },
  Monk: {
    border: "border-teal-700/60",
    glow: "rgba(30,140,130,0.15)",
    badge: "bg-teal-900/40 text-teal-300",
  },
  Paladin: {
    border: "border-amber-600/60",
    glow: "rgba(200,160,30,0.15)",
    badge: "bg-amber-900/40 text-amber-300",
  },
  Ranger: {
    border: "border-emerald-700/60",
    glow: "rgba(30,110,70,0.15)",
    badge: "bg-emerald-900/40 text-emerald-300",
  },
  Rogue: {
    border: "border-zinc-600/60",
    glow: "rgba(80,80,80,0.2)",
    badge: "bg-zinc-800/40 text-zinc-300",
  },
  Sorcerer: {
    border: "border-rose-700/60",
    glow: "rgba(180,40,80,0.15)",
    badge: "bg-rose-900/40 text-rose-300",
  },
  Warlock: {
    border: "border-violet-700/60",
    glow: "rgba(100,30,180,0.15)",
    badge: "bg-violet-900/40 text-violet-300",
  },
  Wizard: {
    border: "border-blue-700/60",
    glow: "rgba(30,80,180,0.15)",
    badge: "bg-blue-900/40 text-blue-300",
  },
};

const DEFAULT_COLOUR = {
  border: "border-amber-900/45",
  glow: "rgba(120,70,15,0.12)",
  badge: "bg-amber-900/40 text-amber-300",
};

function classColour(cls: string | null) {
  return cls ? (CLASS_COLOURS[cls] ?? DEFAULT_COLOUR) : DEFAULT_COLOUR;
}

function mod(score: number | null): string {
  const s = score ?? 10;
  const m = Math.floor((s - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}

export default function CharacterCard({
  char,
  selected,
  onSelect,
}: {
  char: PremadeCharacter;
  selected: boolean;
  onSelect: () => void;
}) {
  const colour = classColour(char.class);
  const scores = ["str", "dex", "con", "int", "wis", "cha"] as const;

  return (
    <button
      onClick={onSelect}
      className={`w-full overflow-hidden rounded-lg border text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70
        ${
          selected
            ? `${colour.border} ring-1 ring-amber-500/50 bg-black/55`
            : "border-amber-900/35 bg-black/25 hover:border-amber-700/50 hover:bg-black/40"
        }`}
      style={selected ? { boxShadow: `0 0 20px ${colour.glow}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-2.5 pt-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-serif text-lg leading-tight text-amber-100">
              {char.name}
            </span>
            {selected && (
              <span className="rounded border border-amber-600/50 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-[0.14em] text-amber-300">
                Selected
              </span>
            )}
          </div>
          <p className="mt-0.5 font-serif text-sm text-amber-200/80 italic">
            {[char.race, char.background].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded px-2 py-0.5 font-sans text-[0.65rem] uppercase tracking-[0.14em] ${colour.badge}`}
          >
            {char.class ?? "Adventurer"}
          </span>
          <span className="font-sans text-[0.68rem] text-amber-300/70">
            Level {char.level ?? 1}
          </span>
        </div>
      </div>

      <div className="px-4 pb-3.5">
        <div className="mt-1 grid grid-cols-8 gap-1.5">
          <div className="col-span-2 flex gap-1.5">
            <div className="flex-1 rounded bg-black/35 py-1.5 text-center">
              <div className="text-[0.55rem] uppercase tracking-[0.14em] text-amber-300/70">
                HP
              </div>
              <div className="font-serif text-sm text-amber-100">{char.max_hp ?? "-"}</div>
            </div>
            <div className="flex-1 rounded bg-black/35 py-1.5 text-center">
              <div className="text-[0.55rem] uppercase tracking-[0.14em] text-amber-300/70">
                AC
              </div>
              <div className="font-serif text-sm text-amber-100">{char.ac ?? "-"}</div>
            </div>
          </div>

          {scores.map((ability) => (
            <div key={ability} className="rounded bg-black/35 py-1.5 text-center">
              <div className="text-[0.55rem] uppercase tracking-[0.14em] text-amber-300/70">
                {ability}
              </div>
              <div className="font-serif text-xs leading-tight text-amber-100">
                {char[ability] ?? 10}
              </div>
              <div className="text-[0.6rem] text-amber-300/80">{mod(char[ability])}</div>
            </div>
          ))}
        </div>

        {char.personality_traits && (
          <p className="mt-2.5 line-clamp-2 font-serif text-xs leading-relaxed text-amber-200/80 italic">
            {`"${char.personality_traits}"`}
          </p>
        )}
      </div>
    </button>
  );
}
