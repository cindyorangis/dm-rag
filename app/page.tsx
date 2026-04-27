"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CharacterCard from "@/components/CharacterCard";
import { PremadeCharacter } from "./page.types";

type Screen = "home" | "character";

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
  if (stats) parts.push(`Ability scores - ${stats}`);
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
  if (Array.isArray(c.features_and_traits) && c.features_and_traits.length) {
    parts.push(`Features & Traits: ${JSON.stringify(c.features_and_traits)}`);
  }
  if (Array.isArray(c.equipment) && c.equipment.length) {
    parts.push(`Equipment: ${JSON.stringify(c.equipment)}`);
  }
  if (c.notes) parts.push(c.notes);
  return parts.join("\n");
}

export default function HomePage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("home");
  const [premadeChars, setPremadeChars] = useState<PremadeCharacter[]>([]);
  const [loadingChars, setLoadingChars] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [creatingCharacterId, setCreatingCharacterId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (screen !== "character") return;

    fetch("/api/characters")
      .then((r) => r.json())
      .then(({ characters }) => {
        setPremadeChars(characters ?? []);
      })
      .catch(() => setPremadeChars([]))
      .finally(() => setLoadingChars(false));
  }, [screen]);

  const startAdventure = async (character: PremadeCharacter) => {
    if (isCreating) return;
    setCreatingCharacterId(character.id);
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterContext: buildCharacterContextFromDB(character),
        }),
      });

      if (!res.ok) throw new Error("Failed to create session");
      const { sessionId } = await res.json();
      router.push(`/session/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsCreating(false);
      setCreatingCharacterId(null);
    }
  };

  if (screen === "home") {
    return (
      <main
        className="min-h-screen bg-stone-950 text-amber-100 flex flex-col items-center justify-center px-4"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.15) 0%, #0d0a07 70%)",
        }}
      >
        <div className="max-w-md w-full text-center space-y-7">
          <div
            className="mx-auto h-14 w-14 rounded-full border border-amber-700/50 bg-amber-950/40"
            style={{ boxShadow: "0 0 24px rgba(200,130,30,0.35)" }}
            aria-hidden
          />

          <div>
            <h1
              className="font-serif text-5xl text-amber-300 tracking-wide"
              style={{ textShadow: "0 0 40px rgba(220,170,60,0.3)" }}
            >
              The Dungeon Master
            </h1>
            <p className="mt-1 text-xs uppercase tracking-[0.28em] text-amber-300/90">
              Lost Mine of Phandelver
            </p>
          </div>

          <div className="mx-auto flex max-w-xs items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
            <div className="h-1.5 w-1.5 rotate-45 bg-amber-800" />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
          </div>

          <p className="px-4 font-serif text-lg leading-relaxed text-amber-100 italic">
            You stand at the edge of Neverwinter Wood.
            <br />
            The road to Phandalin lies ahead.
            <br />
            Your destiny awaits.
          </p>

          <button
            onClick={() => {
              setLoadingChars(true);
              setIsCreating(false);
              setCreatingCharacterId(null);
              setError(null);
              setScreen("character");
            }}
            className="w-full rounded border border-amber-700/60 bg-gradient-to-br from-amber-900 to-amber-800 py-4 font-serif text-lg tracking-[0.12em] text-white shadow-lg shadow-amber-950/50 transition-all hover:from-amber-800 hover:to-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            Begin Journey
          </button>

          <Link
            href="/journal"
            className="block text-base font-serif italic text-amber-300/80 transition-colors hover:text-amber-200"
          >
            Browse past sessions
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-stone-950 text-amber-100 flex flex-col items-center justify-start px-4 py-10"
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.12) 0%, #0d0a07 70%)",
      }}
    >
      <div className="w-full max-w-2xl space-y-6">
        <div className="mb-1 px-2 text-center">
          <h2 className="font-serif text-3xl tracking-[0.14em] text-amber-100">
            Choose Your Hero
          </h2>
          <p className="mt-2 font-serif text-lg text-amber-200/90 italic">
            Select a premade adventurer to begin instantly.
          </p>
        </div>

        {loadingChars ? (
          <div className="py-12 text-center font-serif text-lg text-amber-300/75 italic">
            Summoning heroes from the Forgotten Realms...
          </div>
        ) : premadeChars.length === 0 ? (
          <div className="py-12 text-center font-serif text-lg text-amber-300/75 italic">
            No heroes found.
          </div>
        ) : (
          <div
            className={`space-y-4 rounded-xl border border-amber-800/30 bg-black/25 p-3 sm:p-4 ${
              isCreating ? "pointer-events-none opacity-80" : ""
            }`}
          >
            {premadeChars.map((c) => (
              <CharacterCard
                key={c.id}
                char={c}
                selected={creatingCharacterId === c.id}
                onSelect={() => startAdventure(c)}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="text-center font-serif text-base text-red-300 italic">
            {error}
          </p>
        )}

        {isCreating && (
          <p className="text-center font-serif text-base text-amber-200/90 italic">
            Opening your adventure...
          </p>
        )}
      </div>
    </main>
  );
}
