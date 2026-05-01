"use client";

import { useState, useCallback, useEffect } from "react";
import { parseCharacterContext, CharacterData } from "@/lib/character";
import { CombatState } from "@/lib/combat/types";

interface UseSessionDataReturn {
  character: CharacterData;
  combatState: CombatState | null;
  setCombatState: React.Dispatch<React.SetStateAction<CombatState | null>>;
  activeTab: "character" | "combat" | "log";
  setActiveTab: React.Dispatch<
    React.SetStateAction<"character" | "combat" | "log">
  >;
  refresh: () => Promise<void>;
}

export function useSessionData(
  id: string,
  isStreaming: boolean,
): UseSessionDataReturn {
  const [character, setCharacter] = useState<CharacterData>({});
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [activeTab, setActiveTab] = useState<"character" | "combat" | "log">(
    "character",
  );

  const refresh = useCallback(async () => {
    try {
      const [sessionRes, combatRes] = await Promise.all([
        fetch(`/api/sessions/${id}`),
        fetch(`/api/combat/${id}`),
      ]);

      if (sessionRes.ok) {
        const session = await sessionRes.json();
        if (session.character_context) {
          setCharacter(parseCharacterContext(session.character_context));
        }
      }

      if (combatRes.ok) {
        const combat: CombatState = await combatRes.json();
        setCombatState(combat);
        if (combat?.is_active && !combat?.awaiting_player_initiative) {
          setActiveTab("combat");
        }
      }
    } catch {
      // silently fail — UI degrades gracefully
    }
  }, [id]);

  // Handles initial load AND stream completion
  // Use a single Effect for synchronization
  useEffect(() => {
    // If we're streaming, we don't want to refresh yet
    if (isStreaming) return;

    // Use a local variable to prevent state updates on unmounted components
    let ignore = false;

    async function startFetching() {
      const [sessionRes, combatRes] = await Promise.all([
        fetch(`/api/sessions/${id}`),
        fetch(`/api/combat/${id}`),
      ]);

      if (ignore) return;

      // Handle Session Data
      if (sessionRes.ok) {
        const session = await sessionRes.json();
        if (session.character_context) {
          setCharacter(parseCharacterContext(session.character_context));
        }
      }

      // Handle Combat Data
      if (combatRes.ok) {
        const combat: CombatState = await combatRes.json();
        setCombatState(combat);
        if (combat?.is_active && !combat?.awaiting_player_initiative) {
          setActiveTab("combat");
        }
      }
    }

    startFetching();

    return () => {
      ignore = true;
    };
  }, [id, isStreaming]); // id and isStreaming are the true "synchronization" triggers

  return {
    character,
    combatState,
    setCombatState,
    activeTab,
    setActiveTab,
    refresh,
  };
}
