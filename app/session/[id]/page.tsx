"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { parseCharacterContext, CharacterData } from "@/lib/character";
import { CombatState } from "@/lib/combat/types";
import { useChat } from "@/hooks/useChat";
import DiceRoller from "../components/DiceRoller";
import InitiativeRoller from "../components/InitiativeRoller";
import { Sidebar } from "../components/Sidebar";
import { DMMessage, UserMessage } from "@/components/ChatMessage";
import type { RollRequest } from "@/hooks/useChat";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    messages,
    isLoading,
    isStreaming,
    parsedDM,
    error,
    sendMessage,
    retryLastTurn,
    canRetryLastTurn,
    queuedInputCount,
    isRecovering,
    cancelStream,
    awaitingInitiative,
    dismissInitiative,
    pendingRolls,
    dismissRolls,
  } = useChat(id);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [character, setCharacter] = useState<CharacterData>({});
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [isEndingSession, setIsEndingSession] = useState(false);

  // ── Sidebar tab — derived from combatState, not driven by an effect ─────────
  // The user can explicitly pick a tab; that choice is stored as an override.
  // The override is cleared when combat ends so the tab resets to "character".
  const [tabOverride, setTabOverride] = useState<
    "character" | "combat" | "log" | null
  >(null);

  const combatIsLive =
    (combatState?.is_active ?? false) &&
    !(combatState?.awaiting_player_initiative ?? false);

  // Auto-show combat tab when combat goes live; fall back to user override or "character"
  const sidebarTab: "character" | "combat" | "log" =
    combatIsLive && tabOverride === null
      ? "combat"
      : // If combat just ended and override was "combat", reset to "character"
        !combatIsLive && tabOverride === "combat"
        ? "character"
        : (tabOverride ?? "character");

  const setSidebarTab = (tab: "character" | "combat" | "log") =>
    setTabOverride(tab);

  // ── Data fetching ───────────────────────────────────────────────────────────
  // Async function defined inside the effect — the React-recommended pattern
  // for data fetching. Avoids the react-hooks/set-state-in-effect lint error
  // that fires when a setState-containing useCallback is called from an effect.

  useEffect(() => {
    if (isStreaming) return;

    async function syncSessionData() {
      try {
        const [sessionRes, combatRes] = await Promise.all([
          fetch(`/api/sessions/${id}`),
          fetch(`/api/combat/${id}`),
        ]);

        if (sessionRes.ok) {
          const session = await sessionRes.json();
          if (session.character_context)
            setCharacter(parseCharacterContext(session.character_context));
        }

        if (combatRes.ok) {
          const combat = await combatRes.json();
          setCombatState(combat);
        }
      } catch (err) {
        console.error(err);
      }
    }

    syncSessionData();
  }, [id, isStreaming]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, awaitingInitiative, pendingRolls]);

  // ── Initiative submission ───────────────────────────────────────────────────

  const handleInitiativeRoll = useCallback(
    async (total: number) => {
      try {
        const res = await fetch(`/api/combat/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initiativeRoll: total }),
        });
        if (res.ok) {
          const updated = await res.json();
          setCombatState(updated);
          // sidebarTab auto-switches to "combat" via derived logic once
          // combatState.is_active && !awaiting_player_initiative is true
        }
      } catch (err) {
        console.error("Failed to submit initiative:", err);
      } finally {
        dismissInitiative();
      }
    },
    [id, dismissInitiative],
  );

  const pendingRollsRef = useRef<RollRequest[]>(pendingRolls);
  useEffect(() => {
    pendingRollsRef.current = pendingRolls;
  }, [pendingRolls]);
  const confirmedCountRef = useRef(0);

  const handleRollResult = useCallback(
    (resultText: string) => {
      confirmedCountRef.current += 1;
      if (confirmedCountRef.current >= pendingRollsRef.current.length) {
        confirmedCountRef.current = 0;
        dismissRolls();
      }
      sendMessage(resultText);
    },
    [dismissRolls, sendMessage],
  );

  // ── End session ─────────────────────────────────────────────────────────────

  const endSession = async () => {
    if (isStreaming || isEndingSession) return;
    setIsEndingSession(true);
    try {
      await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id, messages }),
      });
      router.push(`/journal/${id}`);
    } catch {
      setIsEndingSession(false);
    }
  };

  // ── Input handling ──────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const inputLocked =
    (awaitingInitiative || pendingRolls.length > 0) && !isStreaming;

  const dexMod = character.dex
    ? Math.floor((parseInt(character.dex) - 10) / 2)
    : 0;

  const streamingMsgId = messages.find((m) => m.streaming)?.id ?? null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[100dvh] overflow-hidden overflow-x-hidden bg-stone-950 text-stone-100">
      {/* ── Chat column ────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-stone-700 px-4 py-3 md:px-5 md:py-3.5">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-serif text-sm uppercase tracking-[0.12em] text-amber-300 truncate md:text-lg md:tracking-[0.16em]">
              Lost Mine of Phandelver
            </h1>
            {combatState?.is_active &&
              !combatState.awaiting_player_initiative && (
                <span className="shrink-0 animate-pulse rounded border border-red-700/70 bg-red-950/70 px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.12em] text-red-200">
                  ⚔ R{combatState.round}
                </span>
              )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() =>
                sendMessage(
                  "Who am I? Please describe my character — name, race, class, level, and key stats.",
                )
              }
              disabled={isStreaming}
              className="hidden sm:block font-serif text-sm italic text-stone-300 transition-colors hover:text-amber-200 disabled:opacity-40"
            >
              Who am I?
            </button>
            <button
              onClick={endSession}
              disabled={isStreaming || messages.length === 0 || isEndingSession}
              className="text-sm text-stone-300 transition-colors hover:text-stone-100 disabled:opacity-40 whitespace-nowrap"
            >
              {isEndingSession ? "Writing..." : "End Session"}
            </button>
          </div>
        </div>

        {/* Messages — pb-20 on mobile lifts content above fixed bottom tab bar */}
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-6 pb-20 md:pb-6 md:px-5">
          {isLoading ? (
            <p className="mt-20 animate-pulse text-center font-serif text-base italic text-stone-300/80">
              The torches flicker as your adventure loads...
            </p>
          ) : messages.length === 0 ? (
            <p className="mt-20 text-center font-serif text-base italic text-stone-300/80">
              Your adventure begins. What do you do?
            </p>
          ) : null}

          {messages.map((msg) =>
            msg.role === "user" ? (
              <UserMessage key={msg.id} message={msg} />
            ) : (
              <DMMessage
                key={msg.id}
                message={msg}
                streamingParsed={
                  msg.id === streamingMsgId ? parsedDM : undefined
                }
                onHintSelect={(prompt: string) => sendMessage(prompt)}
              />
            ),
          )}

          {awaitingInitiative && !isStreaming && (
            <InitiativeRoller dexMod={dexMod} onRoll={handleInitiativeRoll} />
          )}

          {pendingRolls.length > 0 && !isStreaming && (
            <div className="mx-auto max-w-3xl space-y-2">
              {pendingRolls.map((roll, i) => (
                <DiceRoller
                  key={i}
                  request={roll}
                  onResult={handleRollResult}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="mx-auto max-w-3xl rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 text-center">
              <p className="text-sm text-amber-100">
                DM is recovering. Your turn state is preserved.
              </p>
              <p className="mt-1 text-xs text-amber-200/80">{error}</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  onClick={retryLastTurn}
                  disabled={!canRetryLastTurn}
                  className="rounded-md bg-amber-700 px-3 py-1.5 text-xs text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
                >
                  Retry Turn
                </button>
                {queuedInputCount > 0 && (
                  <span className="rounded border border-amber-700/70 px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-amber-200">
                    Queued: {queuedInputCount}
                  </span>
                )}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input — mb-14 on mobile lifts it above the fixed bottom tab bar */}
        <div className="shrink-0 border-t border-stone-700 px-4 py-3 mb-14 md:mb-0 md:px-5 md:py-4">
          {inputLocked ? (
            <p className="py-1 text-center font-serif text-sm italic text-amber-200/90 md:text-base">
              {awaitingInitiative
                ? "Roll initiative above before acting..."
                : "Roll the dice above to continue..."}
            </p>
          ) : (
            <div className="mx-auto flex max-w-3xl items-end gap-2 md:gap-3">
              <textarea
                className="flex-1 resize-none rounded-lg border border-stone-600 bg-stone-900 px-3 py-2.5 text-base text-stone-100 placeholder-stone-400 focus:border-amber-400 focus:outline-none md:px-4 md:py-3"
                rows={2}
                placeholder="What do you do?"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button
                  onClick={cancelStream}
                  className="rounded-lg bg-stone-700 px-3 py-2.5 text-sm text-stone-100 transition-colors hover:bg-stone-600 md:px-4 md:py-3 md:text-base"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  className="rounded-lg bg-amber-700 px-3 py-2.5 text-sm text-white transition-colors hover:bg-amber-600 disabled:opacity-40 md:px-4 md:py-3 md:text-base"
                >
                  Send
                </button>
              )}
            </div>
          )}
          {isRecovering && queuedInputCount > 0 && (
            <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-amber-200/80">
              New actions are queued while the DM recovers.
            </p>
          )}
        </div>
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <Sidebar
        character={character}
        combatState={combatState}
        messages={messages}
        activeTab={sidebarTab}
        isStreaming={isStreaming}
        onTabChange={setSidebarTab}
        onSendMessage={sendMessage}
        onPhraseSelect={(phrase) => setInput(phrase)}
      />
    </div>
  );
}
