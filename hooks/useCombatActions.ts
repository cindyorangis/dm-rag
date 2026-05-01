"use client";

import { useCallback, useRef } from "react";
import { CombatState } from "@/lib/combat/types";
import type { RollRequest } from "@/hooks/useChat";

interface UseCombatActionsArgs {
  sessionId: string;
  pendingRolls: RollRequest[];
  setCombatState: React.Dispatch<React.SetStateAction<CombatState | null>>;
  setActiveTab: React.Dispatch<
    React.SetStateAction<"character" | "combat" | "log">
  >;
  dismissInitiative: () => void;
  dismissRolls: () => void;
  sendMessage: (text: string) => void;
}

interface UseCombatActionsReturn {
  handleInitiativeRoll: (total: number) => Promise<void>;
  handleRollResult: (resultText: string) => void;
}

export function useCombatActions({
  sessionId,
  pendingRolls,
  setCombatState,
  setActiveTab,
  dismissInitiative,
  dismissRolls,
  sendMessage,
}: UseCombatActionsArgs): UseCombatActionsReturn {
  // Track how many rolls in the current batch have been confirmed
  const confirmedCountRef = useRef(0);
  // Keep a stable reference to the current batch size to avoid stale closures
  const pendingRollsRef = useRef<RollRequest[]>(pendingRolls);
  pendingRollsRef.current = pendingRolls;

  const handleInitiativeRoll = useCallback(
    async (total: number) => {
      try {
        const res = await fetch(`/api/combat/${sessionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initiativeRoll: total }),
        });
        if (res.ok) {
          const updated: CombatState = await res.json();
          setCombatState(updated);
          setActiveTab("combat");
        }
      } catch (err) {
        console.error("Failed to submit initiative:", err);
      } finally {
        dismissInitiative();
      }
    },
    [sessionId, setCombatState, setActiveTab, dismissInitiative],
  );

  const handleRollResult = useCallback(
    (resultText: string) => {
      confirmedCountRef.current += 1;
      // Only unlock the input once every roll in this batch is confirmed
      if (confirmedCountRef.current >= pendingRollsRef.current.length) {
        confirmedCountRef.current = 0;
        dismissRolls();
      }
      sendMessage(resultText);
    },
    [dismissRolls, sendMessage],
  );

  return { handleInitiativeRoll, handleRollResult };
}
