"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CharacterCard from "@/components/CharacterCard";
import { PremadeCharacter } from "./page.types";

type Screen = "home" | "character";

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

// ── Build context string from a premade DB character ─────────────────────
function buildCharacterContextFromDB(c: PremadeCharacter): string {
  const parts: string[] = [];
  parts.push(`Name: ${c.name}`);
  const identity = [c.race, c.class].filter(Boolean).join(" ");
  if (identity) parts.push(`${identity} (Level ${c.level ?? 1})`);
  if (c.background) parts.push(`Background: ${c.background}`);
  if (c.alignment) parts.push(`Alignment: ${c.alignment}`);
  const stats = (["str", "dex", "con", "int", "wis", "cha"] as const)
    .map((s) => (c[s] != null ? `${s.toUpperCase()} ${c[s]}` : null))
    .filter(Boolean)
    .join(" | ");
  if (stats) parts.push(`Ability scores — ${stats}`);
  const combat = [
    c.max_hp ? `HP: ${c.max_hp}` : null,
    c.ac ? `AC: ${c.ac}` : null,
    c.speed ? `Speed: ${c.speed}ft` : null,
    c.hit_dice ? `Hit Dice: ${c.hit_dice}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (combat) parts.push(combat);
  parts.push(`Proficiency Bonus: +${c.proficiency_bonus}`);
  parts.push(`Passive Wisdom: ${c.passive_wisdom}`);
  if (c.personality_traits) parts.push(`Personality: ${c.personality_traits}`);
  if (c.ideals) parts.push(`Ideals: ${c.ideals}`);
  if (c.bonds) parts.push(`Bonds: ${c.bonds}`);
  if (c.flaws) parts.push(`Flaws: ${c.flaws}`);
  if (Array.isArray(c.features_and_traits) && c.features_and_traits.length)
    parts.push(`Features & Traits: ${JSON.stringify(c.features_and_traits)}`);
  if (Array.isArray(c.equipment) && c.equipment.length)
    parts.push(`Equipment: ${JSON.stringify(c.equipment)}`);
  if (c.notes) parts.push(c.notes);
  return parts.join("\n");
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("home");
  const [premadeChars, setPremadeChars] = useState<PremadeCharacter[]>([]);
  const [selectedPremade, setSelectedPremade] =
    useState<PremadeCharacter | null>(null);
  const [loadingChars, setLoadingChars] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch premade characters when character screen mounts
  useEffect(() => {
    if (screen !== "character") return;
    setLoadingChars(true);
    fetch("/api/characters")
      .then((r) => r.json())
      .then(({ characters }) => {
        setPremadeChars(characters ?? []);
        // Auto-select first character if none selected yet
        if (!selectedPremade && characters?.length) {
          setSelectedPremade(characters[0]);
        }
      })
      .catch(() => setPremadeChars([]))
      .finally(() => setLoadingChars(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const startAdventure = async () => {
    if (!selectedPremade) {
      setError("Please select a character to continue.");
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterContext: buildCharacterContextFromDB(selectedPremade),
        }),
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

  // ── Home screen ───────────────────────────────────────────────────────
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

  // ── Character screen ──────────────────────────────────────────────────
  return (
    <main
      className="min-h-screen bg-stone-950 flex flex-col items-center justify-start px-4 py-10"
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.12) 0%, #0d0a07 70%)",
      }}
    >
      <div className="max-w-lg w-full space-y-4">
        <div className="text-center mb-2">
          <h2 className="font-serif text-xl text-amber-300 tracking-widest">
            Choose Your Hero
          </h2>
          <p className="text-amber-900/70 font-serif italic text-sm mt-1">
            Select your adventurer
          </p>
        </div>

        {loadingChars ? (
          <div className="text-center py-10 text-amber-900/50 font-serif italic">
            Summoning heroes from the Forgotten Realms…
          </div>
        ) : premadeChars.length === 0 ? (
          <div className="text-center py-10 text-amber-900/50 font-serif italic">
            No heroes found.
          </div>
        ) : (
          <div className="space-y-3">
            {premadeChars.map((c) => (
              <CharacterCard
                key={c.id}
                char={c}
                selected={selectedPremade?.id === c.id}
                onSelect={() => setSelectedPremade(c)}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-red-400/80 text-sm font-serif italic text-center">
            {error}
          </p>
        )}

        <button
          onClick={startAdventure}
          disabled={isCreating || (!selectedPremade && !loadingChars)}
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
      </div>
    </main>
  );
}
