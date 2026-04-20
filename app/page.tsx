// app/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HomePage() {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startAdventure = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create session");
      const { sessionId } = await res.json();
      router.push(`/session/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsCreating(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-950 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-5xl font-serif text-amber-400 tracking-wide">
            The Dungeon Master
          </h1>
          <p className="text-stone-400 text-sm tracking-widest uppercase">
            Lost Mine of Phandelver
          </p>
        </div>

        <p className="text-stone-400 font-serif italic leading-relaxed">
          You stand at the edge of Neverwinter Wood. The road to Phandalin lies
          ahead. Your destiny awaits.
        </p>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          onClick={startAdventure}
          disabled={isCreating}
          className="w-full py-4 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 
                     text-white font-serif text-lg rounded-lg transition-colors 
                     tracking-wide border border-amber-600"
        >
          {isCreating ? "Preparing your adventure..." : "Begin Adventure"}
        </button>
        <a
          href="/journal"
          className="block text-stone-500 hover:text-stone-300 text-sm transition-colors"
        >
          Browse past sessions →
        </a>
      </div>
    </main>
  );
}
