"use client";

import { CombatState } from "@/lib/combat/types";

interface SessionHeaderProps {
  adventureTitle: string;
  combatState: CombatState | null;
  isStreaming: boolean;
  hasMessages: boolean;
  isEndingSession: boolean;
  onAskWhoAmI: () => void;
  onEndSession: () => void;
}

export function SessionHeader({
  adventureTitle,
  combatState,
  isStreaming,
  hasMessages,
  isEndingSession,
  onAskWhoAmI,
  onEndSession,
}: SessionHeaderProps) {
  const showCombatBadge =
    combatState?.is_active && !combatState.awaiting_player_initiative;

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-stone-700 px-5 py-3.5">
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-base uppercase tracking-[0.16em] text-amber-300 md:text-lg">
          {adventureTitle}
        </h1>
        {showCombatBadge && (
          <span className="animate-pulse rounded border border-red-700/70 bg-red-950/70 px-2.5 py-0.5 text-[0.65rem] uppercase tracking-[0.14em] text-red-200">
            Combat — Round {combatState!.round}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={onAskWhoAmI}
          disabled={isStreaming}
          className="font-serif text-sm italic text-stone-300 transition-colors hover:text-amber-200 disabled:opacity-40"
        >
          Who am I?
        </button>
        <button
          onClick={onEndSession}
          disabled={isStreaming || !hasMessages || isEndingSession}
          className="text-sm text-stone-300 transition-colors hover:text-stone-100 disabled:opacity-40"
        >
          {isEndingSession ? "Writing journal..." : "End Session"}
        </button>
      </div>
    </div>
  );
}
