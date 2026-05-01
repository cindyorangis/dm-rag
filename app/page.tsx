"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import CharacterCard from "@/components/CharacterCard";
import { PremadeCharacter } from "./page.types";

type Screen = "home" | "adventure" | "character";

interface Adventure {
  slug: string;
  title: string;
  subtitle: string;
  setting: string;
  levels: string;
  description: string;
  available: boolean;
}

const ADVENTURES: Adventure[] = [
  {
    slug: "lost-mine-of-phandelver",
    title: "Lost Mine of Phandelver",
    subtitle: "The Forgotten Realms",
    setting: "Phandalin, Forgotten Realms",
    levels: "Levels 1–5",
    description:
      "A mysterious map. A missing dwarf. The road to Phandalin winds through goblin-haunted forest and into the depths of Wave Echo Cave.",
    available: true,
  },
  {
    slug: "ghosts-of-saltmarsh",
    title: "Ghosts of Saltmarsh",
    subtitle: "The Azure Sea",
    setting: "Saltmarsh, Greyhawk",
    levels: "Levels 1–12",
    description:
      "A haunted manor. A seaside town on edge. Dark tides are rising off the coast of Saltmarsh, and only you can uncover what lurks beneath the waves.",
    available: true,
  },
  {
    slug: "tales-from-the-yawning-portal",
    title: "Tales from the Yawning Portal",
    subtitle: "Waterdeep & Beyond",
    setting: "Waterdeep + various",
    levels: "Levels 1–15",
    description:
      "Seven classic dungeons. Countless legends. Descend into the deadliest adventures ever told, from the sunken Tomb of Horrors to the White Plume Mountain.",
    available: false,
  },
];

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
  const [selectedAdventure, setSelectedAdventure] = useState<Adventure | null>(
    null,
  );
  const [premadeChars, setPremadeChars] = useState<PremadeCharacter[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingChars, setLoadingChars] = useState(true);
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
    if (isCreating || !selectedAdventure) return;
    setCreatingCharacterId(character.id);
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adventureSlug: selectedAdventure.slug,
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

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredChars = premadeChars.filter((char) => {
    if (!normalizedSearch) return true;
    const searchable = [
      char.name,
      char.class,
      char.race,
      char.background,
      char.alignment,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(normalizedSearch);
  });

  // ── Home screen ──────────────────────────────────────────────────────────
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
              Solo Adventure Awaits
            </p>
          </div>

          <div className="mx-auto flex max-w-xs items-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
            <div className="h-1.5 w-1.5 rotate-45 bg-amber-800" />
            <div className="h-px flex-1 bg-gradient-to-r from-transparent via-amber-900/60 to-transparent" />
          </div>

          <p className="px-4 font-serif text-lg leading-relaxed text-amber-100 italic">
            No DM required. No group needed.
            <br />
            Just you, the dice, and the world.
            <br />
            Your destiny awaits.
          </p>

          <button
            onClick={() => {
              setSelectedAdventure(null);
              setError(null);
              setScreen("adventure");
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

  // ── Adventure selection screen ────────────────────────────────────────────
  if (screen === "adventure") {
    return (
      <main
        className="min-h-screen bg-stone-950 text-amber-100 flex flex-col items-center justify-start px-4 py-10"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.12) 0%, #0d0a07 70%)",
        }}
      >
        <div className="w-full max-w-4xl space-y-6">
          <div className="text-center space-y-2">
            <h2 className="font-serif text-3xl tracking-[0.14em] text-amber-100">
              Choose Your Adventure
            </h2>
            <p className="font-serif text-lg text-amber-200/90 italic">
              Select a module to begin your campaign.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADVENTURES.map((adv) => (
              <button
                key={adv.slug}
                disabled={!adv.available}
                onClick={() => {
                  setSelectedAdventure(adv);
                  setIsCreating(false);
                  setCreatingCharacterId(null);
                  setError(null);
                  setSearchQuery("");
                  setScreen("character");
                }}
                className={[
                  "relative text-left rounded-lg border p-5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300",
                  adv.available
                    ? "border-amber-700/50 bg-black/30 hover:border-amber-500/70 hover:bg-amber-950/30 cursor-pointer"
                    : "border-amber-900/30 bg-black/15 opacity-50 cursor-not-allowed",
                ].join(" ")}
              >
                {!adv.available && (
                  <span className="absolute top-3 right-3 text-[10px] uppercase tracking-widest text-amber-500/60 font-sans border border-amber-800/40 rounded px-1.5 py-0.5">
                    Coming Soon
                  </span>
                )}
                <p className="font-serif text-xs uppercase tracking-[0.2em] text-amber-400/70 mb-1">
                  {adv.levels}
                </p>
                <h3 className="font-serif text-xl text-amber-200 leading-snug mb-2">
                  {adv.title}
                </h3>
                <p className="text-xs text-amber-300/60 font-sans mb-3">
                  {adv.setting}
                </p>
                <p className="font-serif text-sm text-amber-100/75 italic leading-relaxed">
                  {adv.description}
                </p>
              </button>
            ))}
          </div>

          <div className="text-center">
            <button
              onClick={() => setScreen("home")}
              className="font-serif italic text-amber-300/60 hover:text-amber-300 transition-colors text-sm"
            >
              ← Back
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Character selection screen ────────────────────────────────────────────
  return (
    <main
      className="min-h-screen bg-stone-950 text-amber-100 flex flex-col items-center justify-start px-4 py-10"
      style={{
        background:
          "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(120,70,15,0.12) 0%, #0d0a07 70%)",
      }}
    >
      <div className="w-full max-w-6xl space-y-6">
        <div className="mb-1 px-2 text-center">
          {selectedAdventure && (
            <p className="font-serif text-xs uppercase tracking-[0.22em] text-amber-400/70 mb-1">
              {selectedAdventure.title}
            </p>
          )}
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-sans text-sm text-amber-200/80">
                {filteredChars.length} of {premadeChars.length} heroes shown
              </p>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, class, race..."
                className="w-full rounded-md border border-amber-700/40 bg-black/35 px-3 py-2 text-sm text-amber-100 placeholder:text-amber-300/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:max-w-xs"
              />
            </div>

            {filteredChars.length === 0 ? (
              <div className="py-10 text-center font-serif text-base text-amber-300/75 italic">
                No heroes match your search.
              </div>
            ) : (
              <div className="max-h-[68vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredChars.map((c) => (
                    <CharacterCard
                      key={c.id}
                      char={c}
                      compact
                      selected={creatingCharacterId === c.id}
                      onSelect={() => startAdventure(c)}
                    />
                  ))}
                </div>
              </div>
            )}
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

        {!isCreating && (
          <div className="text-center">
            <button
              onClick={() => setScreen("adventure")}
              className="font-serif italic text-amber-300/60 hover:text-amber-300 transition-colors text-sm"
            >
              ← Back to adventures
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
