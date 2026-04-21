"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Screen = "home" | "character";

interface CharacterFields {
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

const RACES = [
  "Human",
  "Elf",
  "Half-Elf",
  "Dwarf",
  "Halfling",
  "Gnome",
  "Half-Orc",
  "Tiefling",
  "Dragonborn",
];
const CLASSES = [
  "Barbarian",
  "Bard",
  "Cleric",
  "Druid",
  "Fighter",
  "Monk",
  "Paladin",
  "Ranger",
  "Rogue",
  "Sorcerer",
  "Warlock",
  "Wizard",
];
const BACKGROUNDS = [
  "Acolyte",
  "Criminal",
  "Folk Hero",
  "Noble",
  "Outlander",
  "Sage",
  "Soldier",
  "Urchin",
];

function buildCharacterContext(c: CharacterFields): string | undefined {
  const parts: string[] = [];
  if (c.name) parts.push(`Name: ${c.name}`);
  const identity = [c.race, c.charClass].filter(Boolean).join(" ");
  if (identity) parts.push(`${identity} (Level ${c.level || 1})`);
  if (c.background) parts.push(`Background: ${c.background}`);
  const stats = (["str", "dex", "con", "int", "wis", "cha"] as const)
    .map((s) => (c[s] ? `${s.toUpperCase()} ${c[s]}` : null))
    .filter(Boolean)
    .join(" | ");
  if (stats) parts.push(`Ability scores — ${stats}`);
  const combat = [c.hp ? `HP: ${c.hp}` : null, c.ac ? `AC: ${c.ac}` : null]
    .filter(Boolean)
    .join(", ");
  if (combat) parts.push(combat);
  if (c.notes) parts.push(c.notes);
  return parts.length ? parts.join("\n") : undefined;
}

export default function HomePage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("home");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [char, setChar] = useState<CharacterFields>({
    name: "",
    race: "",
    charClass: "",
    background: "",
    level: "1",
    hp: "",
    ac: "",
    str: "",
    dex: "",
    con: "",
    int: "",
    wis: "",
    cha: "",
    notes: "",
  });

  const set =
    (key: keyof CharacterFields) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setChar((prev) => ({ ...prev, [key]: e.target.value }));

  const startAdventure = async () => {
    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterContext: buildCharacterContext(char) }),
      });
      if (!res.ok) throw new Error("Failed to create session");
      const { sessionId } = await res.json();
      router.push(`/session/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsCreating(false);
    }
  };

  const inputCls =
    "w-full bg-black/40 border border-amber-950/60 border-b-amber-900/80 rounded px-2.5 py-2 text-amber-200/80 font-serif text-base outline-none focus:border-amber-800/60 focus:ring-1 focus:ring-amber-900/30 placeholder:text-amber-950/60 transition-colors";
  const labelCls =
    "font-sans text-[0.6rem] tracking-[0.2em] uppercase text-amber-800/70";

  if (screen === "home")
    return (
      <main
        className="min-h-screen bg-stone-950 flex flex-col items-center justify-center px-4"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.15) 0%, #0d0a07 70%)",
        }}
      >
        <div className="max-w-md w-full text-center space-y-6">
          <div
            className="text-5xl"
            style={{ filter: "drop-shadow(0 0 20px rgba(200,130,30,0.5))" }}
          >
            🐉
          </div>
          <div>
            <h1
              className="font-serif text-5xl text-amber-300 tracking-wide"
              style={{ textShadow: "0 0 40px rgba(220,170,60,0.3)" }}
            >
              The Dungeon Master
            </h1>
            <p className="text-[0.65rem] tracking-[0.35em] uppercase text-amber-900/80 mt-1">
              Lost Mine of Phandelver
            </p>
          </div>
          <div className="flex items-center gap-3 max-w-xs mx-auto">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
            <div className="w-1.5 h-1.5 bg-amber-800 rotate-45" />
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
          </div>
          <p className="font-serif italic text-amber-900/90 leading-relaxed text-lg px-4">
            You stand at the edge of Neverwinter Wood.
            <br />
            The road to Phandalin lies ahead.
            <br />
            Your destiny awaits.
          </p>
          <button
            onClick={() => setScreen("character")}
            className="w-full py-4 bg-gradient-to-br from-amber-900 to-amber-800 hover:from-amber-800 hover:to-amber-700 border border-amber-700/60 text-amber-100 font-serif text-lg rounded tracking-widest transition-all shadow-lg shadow-amber-950/50"
          >
            ⚔ Begin Adventure
          </button>
          <a
            href="/journal"
            className="block text-amber-900/60 hover:text-amber-700/80 text-sm font-serif italic transition-colors"
          >
            Browse past sessions →
          </a>
        </div>
      </main>
    );

  return (
    <main
      className="min-h-screen bg-stone-950 flex flex-col items-center justify-start px-4 py-10"
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.12) 0%, #0d0a07 70%)",
      }}
    >
      <div className="max-w-md w-full space-y-4">
        <div className="text-center mb-6">
          <h2 className="font-serif text-xl text-amber-300 tracking-widest">
            Character Sheet
          </h2>
          <p className="text-amber-900/70 font-serif italic text-sm mt-1">
            All fields optional — leave blank for a pre-made adventurer
          </p>
        </div>

        {/* Identity */}
        <div className="bg-black/30 border border-amber-950/50 rounded-md p-4 space-y-3">
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-amber-800/50 border-b border-amber-950/40 pb-2">
            Identity
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelCls}>Name</label>
              <input
                className={inputCls}
                value={char.name}
                onChange={set("name")}
                placeholder="Thalindra"
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Race</label>
              <select
                className={inputCls}
                value={char.race}
                onChange={set("race")}
              >
                <option value="">— Choose —</option>
                {RACES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Class</label>
              <select
                className={inputCls}
                value={char.charClass}
                onChange={set("charClass")}
              >
                <option value="">— Choose —</option>
                {CLASSES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Background</label>
              <select
                className={inputCls}
                value={char.background}
                onChange={set("background")}
              >
                <option value="">— Choose —</option>
                {BACKGROUNDS.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="bg-black/30 border border-amber-950/50 rounded-md p-4 space-y-3">
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-amber-800/50 border-b border-amber-950/40 pb-2">
            Ability Scores
          </p>
          <div className="grid grid-cols-6 gap-2">
            {(["str", "dex", "con", "int", "wis", "cha"] as const).map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <label className={labelCls}>{s.toUpperCase()}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={inputCls + " text-center px-1"}
                  value={char[s]}
                  onChange={set(s)}
                  placeholder="10"
                />
              </div>
            ))}
          </div>
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-amber-800/50 border-b border-amber-950/40 pb-2 mt-1">
            Combat
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className={labelCls}>Max HP</label>
              <input
                type="number"
                className={inputCls}
                value={char.hp}
                onChange={set("hp")}
                placeholder="10"
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>AC</label>
              <input
                type="number"
                className={inputCls}
                value={char.ac}
                onChange={set("ac")}
                placeholder="12"
              />
            </div>
            <div className="space-y-1">
              <label className={labelCls}>Level</label>
              <select
                className={inputCls}
                value={char.level}
                onChange={set("level")}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-black/30 border border-amber-950/50 rounded-md p-4 space-y-2">
          <p className="text-[0.6rem] tracking-[0.2em] uppercase text-amber-800/50 border-b border-amber-950/40 pb-2">
            Notes
          </p>
          <label className={labelCls}>
            Equipment, spells, traits, backstory…
          </label>
          <textarea
            className={inputCls + " min-h-[70px] resize-y"}
            value={char.notes}
            onChange={set("notes")}
            placeholder="Carries a family heirloom dagger. Speaks Elvish. Seeking a missing sister last seen near Phandalin..."
          />
        </div>

        {error && (
          <p className="text-red-400/80 text-sm font-serif italic text-center">
            {error}
          </p>
        )}

        <button
          onClick={startAdventure}
          disabled={isCreating}
          className="w-full py-4 bg-gradient-to-br from-amber-900 to-amber-800 hover:from-amber-800 hover:to-amber-700 disabled:opacity-50 border border-amber-700/60 text-amber-100 font-serif text-lg rounded tracking-widest transition-all shadow-lg shadow-amber-950/50"
        >
          {isCreating
            ? "Preparing your adventure…"
            : "⚔ Enter the Forgotten Realms"}
        </button>
        <button
          onClick={() => setScreen("home")}
          className="w-full py-2.5 bg-transparent border border-amber-950/40 hover:border-amber-900/60 text-amber-900/60 hover:text-amber-800/80 font-serif text-sm rounded tracking-widest transition-colors"
        >
          ← Back
        </button>
        <p className="text-center text-amber-950/60 font-serif italic text-sm">
          All fields optional — the DM will generate a character if left blank.
        </p>
      </div>
    </main>
  );
}
