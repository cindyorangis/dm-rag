"use client";

import { useState } from "react";
import type { HintItem } from "@/lib/parse-dm-response";

interface HintPanelProps {
  hints: HintItem[];
  onSelect: (prompt: string) => void;
}

const tagColors: Record<string, string> = {
  explore: "text-sky-400/80 bg-sky-950/40 border-sky-900/50",
  social: "text-violet-400/80 bg-violet-950/40 border-violet-900/50",
  action: "text-red-400/80 bg-red-950/40 border-red-900/50",
  lore: "text-amber-400/80 bg-amber-950/40 border-amber-900/50",
};

export function HintPanel({ hints, onSelect }: HintPanelProps) {
  const [open, setOpen] = useState(false);
  if (!hints.length) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[0.6rem] tracking-widest uppercase text-stone-600 hover:text-amber-700/70 font-sans transition-colors"
      >
        <span
          className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        What can I do?
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {hints.map((hint, i) => {
            const colorClass =
              tagColors[hint.tag] ??
              "text-stone-400/80 bg-stone-800/40 border-stone-700/50";
            return (
              <button
                key={i}
                onClick={() => onSelect(hint.prompt)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded border border-stone-700/30 bg-stone-900/40 hover:bg-stone-800/60 hover:border-amber-800/40 transition-all group"
              >
                <span
                  className={`text-[0.45rem] tracking-widest uppercase px-1.5 py-0.5 rounded border font-sans shrink-0 ${colorClass}`}
                >
                  {hint.tag}
                </span>
                <span className="font-serif text-sm text-stone-400 group-hover:text-stone-200 transition-colors">
                  {hint.text}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
