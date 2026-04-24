import { PremadeCharacter } from "@/app/page.types";

// ── Class accent colours (used for card borders / glows) ─────────────────
const CLASS_COLOURS: Record<
  string,
  { border: string; glow: string; badge: string }
> = {
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
  border: "border-amber-950/60",
  glow: "rgba(120,70,15,0.12)",
  badge: "bg-amber-900/40 text-amber-300",
};

function classColour(cls: string | null) {
  return cls ? (CLASS_COLOURS[cls] ?? DEFAULT_COLOUR) : DEFAULT_COLOUR;
}

// ── Stat modifier helper ───────────────────────────────────────────────────
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
      className={`w-full text-left rounded-md border transition-all duration-200 overflow-hidden group
        ${
          selected
            ? `${colour.border} ring-1 ring-amber-700/40 bg-black/50`
            : "border-amber-950/40 bg-black/20 hover:bg-black/35 hover:border-amber-950/60"
        }`}
      style={selected ? { boxShadow: `0 0 20px ${colour.glow}` } : undefined}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-serif text-amber-200 text-base leading-tight truncate">
              {char.name}
            </span>
            {selected && (
              <span className="text-[0.55rem] tracking-widest uppercase text-amber-500/80 border border-amber-700/40 rounded px-1.5 py-0.5">
                Selected
              </span>
            )}
          </div>
          <p className="text-amber-900/70 font-serif italic text-xs mt-0.5">
            {[char.race, char.background].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`text-[0.6rem] tracking-widest uppercase rounded px-2 py-0.5 font-sans ${colour.badge}`}
          >
            {char.class ?? "Adventurer"}
          </span>
          <span className="text-[0.6rem] text-amber-900/50 font-sans">
            Level {char.level ?? 1}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-4 pb-3">
        <div className="grid grid-cols-8 gap-1 mt-1">
          {/* HP & AC */}
          <div className="col-span-2 flex gap-1">
            <div className="flex-1 bg-black/30 rounded text-center py-1">
              <div className="text-[0.5rem] uppercase tracking-widest text-amber-900/60">
                HP
              </div>
              <div className="text-amber-300/80 text-sm font-serif">
                {char.max_hp ?? "—"}
              </div>
            </div>
            <div className="flex-1 bg-black/30 rounded text-center py-1">
              <div className="text-[0.5rem] uppercase tracking-widest text-amber-900/60">
                AC
              </div>
              <div className="text-amber-300/80 text-sm font-serif">
                {char.ac ?? "—"}
              </div>
            </div>
          </div>
          {/* Six ability scores */}
          {scores.map((s) => (
            <div key={s} className="bg-black/30 rounded text-center py-1">
              <div className="text-[0.5rem] uppercase tracking-widest text-amber-900/60">
                {s}
              </div>
              <div className="text-amber-200/70 text-xs font-serif leading-tight">
                {char[s] ?? 10}
              </div>
              <div className="text-amber-900/60 text-[0.55rem]">
                {mod(char[s])}
              </div>
            </div>
          ))}
        </div>

        {/* Personality flavour */}
        {char.personality_traits && (
          <p className="mt-2 text-amber-950/80 font-serif italic text-[0.7rem] leading-relaxed line-clamp-2">
            "{char.personality_traits}"
          </p>
        )}
      </div>
    </button>
  );
}
