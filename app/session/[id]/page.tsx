"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  parseCharacterContext,
  modifier,
  CharacterData,
} from "@/lib/character";
import { CombatState } from "@/lib/combat/types";
import { useChat } from "@/hooks/useChat";
import DiceRoller from "../components/DiceRoller";
import InitiativeRoller from "../components/InitiativeRoller";
import StatBlock from "../components/StatBlock";
import SidebarSection from "../components/SidebarSection";
import CombatantRow from "../components/CombatantRow";
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
  const [sidebarTab, setSidebarTab] = useState<"character" | "combat" | "log">(
    "character",
  );
  const [isEndingSession, setIsEndingSession] = useState(false);
  // Mobile drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────

  const fetchSessionData = useCallback(async () => {
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
        if (combat?.is_active && !combat?.awaiting_player_initiative)
          setSidebarTab("combat");
      }
    } catch {}
  }, [id]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);
  useEffect(() => {
    if (!isStreaming) fetchSessionData();
  }, [isStreaming, fetchSessionData]);
  useEffect(() => {
    if (combatState?.is_active && !combatState.awaiting_player_initiative) {
      setSidebarTab("combat");
    }
  }, [combatState?.is_active, combatState?.awaiting_player_initiative]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, awaitingInitiative, pendingRolls]);

  // Close drawer on outside tap
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [drawerOpen]);

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
          setSidebarTab("combat");
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

  const openDrawerTab = (tab: "character" | "combat" | "log") => {
    setSidebarTab(tab);
    setDrawerOpen(true);
  };

  const inputLocked =
    (awaitingInitiative || pendingRolls.length > 0) && !isStreaming;
  const STATS = ["str", "dex", "con", "int", "wis", "cha"] as const;
  const hasCharacter = Object.keys(character).length > 0;
  const activeCombatants = combatState?.combatants ?? [];
  const currentTurnId = combatState?.is_active
    ? activeCombatants[combatState.current_turn_index]?.id
    : null;
  const dexMod = character.dex
    ? Math.floor((parseInt(character.dex) - 10) / 2)
    : 0;

  const streamingMsgId = messages.find((m) => m.streaming)?.id ?? null;

  // ── Sidebar content (shared between desktop panel and mobile drawer) ────────

  const SidebarContent = () => (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {/* CHARACTER TAB */}
      {sidebarTab === "character" && (
        <>
          {!hasCharacter ? (
            <div className="text-center mt-8 space-y-3">
              <p className="font-serif text-base italic text-stone-300/80">
                Character data not loaded.
              </p>
              <button
                onClick={() => {
                  sendMessage(
                    "Who am I? Please describe my character — name, race, class, level, HP, AC, and ability scores.",
                  );
                  setDrawerOpen(false);
                }}
                disabled={isStreaming}
                className="font-serif text-sm italic text-amber-200 transition-colors hover:text-amber-100 disabled:opacity-40"
              >
                Ask the DM
              </button>
            </div>
          ) : (
            <>
              <SidebarSection title="Adventurer">
                <div className="space-y-0.5">
                  {character.name && (
                    <p className="font-serif text-lg leading-tight text-amber-200">
                      {character.name}
                    </p>
                  )}
                  {character.identity && (
                    <p className="font-serif text-sm text-stone-200">
                      {character.identity}
                    </p>
                  )}
                  {character.background && (
                    <p className="font-serif text-sm italic text-stone-300">
                      {character.background}
                    </p>
                  )}
                </div>
              </SidebarSection>
              {(character.hp || character.ac) && (
                <SidebarSection title="Combat Stats">
                  <div className="flex gap-3">
                    {character.hp && (
                      <div className="flex flex-1 flex-col items-center gap-0.5 rounded border border-red-800/60 bg-black/40 p-2">
                        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-red-200">
                          Max HP
                        </span>
                        <span className="font-serif text-2xl leading-none text-red-200">
                          {character.hp}
                        </span>
                      </div>
                    )}
                    {character.ac && (
                      <div className="flex flex-1 flex-col items-center gap-0.5 rounded border border-sky-800/60 bg-black/40 p-2">
                        <span className="text-[0.65rem] uppercase tracking-[0.12em] text-sky-200">
                          AC
                        </span>
                        <span className="font-serif text-2xl leading-none text-sky-200">
                          {character.ac}
                        </span>
                      </div>
                    )}
                  </div>
                </SidebarSection>
              )}
              {STATS.some((s) => character[s]) && (
                <SidebarSection title="Ability Scores">
                  <div className="grid grid-cols-3 gap-1.5">
                    {STATS.map((s) => (
                      <StatBlock
                        key={s}
                        label={s.toUpperCase()}
                        value={character[s]}
                        mod={modifier(character[s])}
                      />
                    ))}
                  </div>
                </SidebarSection>
              )}
              {character.notes && (
                <SidebarSection title="Notes">
                  <p className="font-serif text-sm italic leading-relaxed text-stone-200/90">
                    {character.notes}
                  </p>
                </SidebarSection>
              )}
            </>
          )}
        </>
      )}

      {/* COMBAT TAB */}
      {sidebarTab === "combat" && (
        <>
          {!combatState?.is_active ? (
            <div className="text-center mt-8 space-y-2">
              <p className="font-serif text-base italic text-stone-300/80">
                No active combat.
              </p>
              <p className="text-sm text-stone-300/75">
                Initiative order appears here when combat begins.
              </p>
            </div>
          ) : combatState.awaiting_player_initiative ? (
            <div className="text-center mt-8 space-y-2 px-2">
              <p className="font-serif text-base italic text-amber-200/90">
                Waiting for your initiative roll...
              </p>
              <p className="text-sm text-stone-300/75">
                Roll in the chat to set the order.
              </p>
            </div>
          ) : (
            <>
              <SidebarSection
                title={`Round ${combatState.round} - Initiative Order`}
              >
                <div className="space-y-2">
                  {[...activeCombatants]
                    .sort((a, b) => b.initiative - a.initiative)
                    .map((c) => (
                      <CombatantRow
                        key={c.id}
                        combatant={c}
                        isCurrentTurn={c.id === currentTurnId}
                      />
                    ))}
                </div>
              </SidebarSection>
              {combatState.log?.length > 0 && (
                <SidebarSection title="Combat Log">
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {[...combatState.log]
                      .reverse()
                      .slice(0, 10)
                      .map((entry, i) => (
                        <p
                          key={i}
                          className="border-b border-stone-700/60 pb-1 text-xs leading-snug text-stone-200/85 last:border-0"
                        >
                          <span className="mr-1 text-amber-300/90">
                            R{entry.round}
                          </span>
                          {entry.description}
                        </p>
                      ))}
                  </div>
                </SidebarSection>
              )}
            </>
          )}
        </>
      )}

      {/* LOG TAB */}
      {sidebarTab === "log" && (
        <>
          <SidebarSection title="Session Stats">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-stone-300">Messages</span>
                <span className="font-serif text-base text-amber-200">
                  {messages.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-stone-300">DM Responses</span>
                <span className="font-serif text-base text-amber-200">
                  {messages.filter((m) => m.role === "assistant").length}
                </span>
              </div>
              {combatState && (
                <div className="flex justify-between">
                  <span className="text-sm text-stone-300">Combat Rounds</span>
                  <span className="font-serif text-base text-amber-200">
                    {combatState.round}
                  </span>
                </div>
              )}
            </div>
          </SidebarSection>
          <SidebarSection title="Quick Reference">
            <div className="space-y-2 text-sm font-serif text-stone-200/90">
              <p>
                <span className="text-amber-200">Attack roll:</span> d20 +
                ability mod + proficiency
              </p>
              <p>
                <span className="text-amber-200">Saving throw:</span> d20 +
                ability mod
              </p>
              <p>
                <span className="text-amber-200">Advantage:</span> roll 2d20,
                take higher
              </p>
              <p>
                <span className="text-amber-200">Disadvantage:</span> roll 2d20,
                take lower
              </p>
              <p>
                <span className="text-amber-200">Death saves:</span> 3 successes
                stable, 3 fails dead
              </p>
              <p>
                <span className="text-amber-200">Short rest:</span> spend Hit
                Dice to heal
              </p>
              <p>
                <span className="text-amber-200">Long rest:</span> regain all HP
                + half Hit Dice
              </p>
            </div>
          </SidebarSection>
          <SidebarSection title="Useful Phrases">
            <div className="space-y-1.5">
              {[
                "I investigate the area",
                "I attempt to pick the lock",
                "I cast [spell name]",
                "I try to persuade them",
                "I hide in the shadows",
                "I search for traps",
                "I take a short rest",
              ].map((phrase) => (
                <button
                  key={phrase}
                  onClick={() => {
                    setInput(phrase);
                    setDrawerOpen(false);
                  }}
                  className="w-full py-0.5 text-left font-serif text-sm italic text-stone-200/90 transition-colors hover:text-amber-200"
                >
                  {phrase}
                </button>
              ))}
            </div>
          </SidebarSection>
        </>
      )}
    </div>
  );

  // ── Tab bar (shared label/icon config) ─────────────────────────────────────

  const tabs = [
    {
      key: "character" as const,
      label: "Character",
      // shield icon
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="w-5 h-5"
        >
          <path
            d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      key: "combat" as const,
      label: "Combat",
      // sword icon
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="w-5 h-5"
        >
          <path
            d="M14.5 17.5L3 6V3h3l11.5 11.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M13 19l6-6" strokeLinecap="round" />
          <path d="M16 16l3.5 3.5" strokeLinecap="round" />
          <path d="M7 4l3 3" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: "log" as const,
      label: "Log",
      // scroll icon
      icon: (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="w-5 h-5"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
            strokeLinejoin="round"
          />
          <polyline points="14,2 14,8 20,8" strokeLinejoin="round" />
          <line x1="16" y1="13" x2="8" y2="13" strokeLinecap="round" />
          <line x1="16" y1="17" x2="8" y2="17" strokeLinecap="round" />
          <line x1="10" y1="9" x2="8" y2="9" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-stone-950 text-stone-100">
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
            {/* "Who am I?" hidden on very small screens to save space */}
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

        {/* Messages */}
        {/* On mobile: pb accounts for the floating bottom tab bar (≈56px) */}
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
            <p className="text-center text-base text-red-300">{error}</p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input — on mobile, mb-14 lifts it above the fixed tab bar (≈56px) */}
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
                className="flex-1 resize-none rounded-lg border border-stone-600 bg-stone-900 px-3 py-2.5 text-sm text-stone-100 placeholder-stone-400 focus:border-amber-400 focus:outline-none md:px-4 md:py-3 md:text-base"
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
        </div>
      </div>

      {/* ── Desktop sidebar (hidden on mobile) ───────────────────────────────── */}
      <div className="hidden md:flex w-80 shrink-0 flex-col overflow-hidden border-l border-stone-700 bg-stone-950/90">
        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-stone-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`relative flex-1 py-3 text-xs uppercase tracking-[0.12em] transition-colors ${
                sidebarTab === tab.key
                  ? "bg-stone-900/70 text-amber-200"
                  : "text-stone-300 hover:text-stone-100"
              }`}
            >
              {tab.label}
              {tab.key === "combat" && combatState?.is_active && (
                <span className="absolute top-1.5 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
              )}
              {sidebarTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-400/70" />
              )}
            </button>
          ))}
        </div>
        <SidebarContent />
      </div>

      {/* ── Mobile bottom tab bar (visible only on mobile) ───────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t border-stone-700 bg-stone-950/95 backdrop-blur-sm">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => openDrawerTab(tab.key)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
              drawerOpen && sidebarTab === tab.key
                ? "text-amber-300"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {tab.icon}
            <span className="text-[0.6rem] uppercase tracking-[0.1em]">
              {tab.label}
            </span>
            {tab.key === "combat" && combatState?.is_active && (
              <span className="absolute top-1.5 right-4 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* ── Mobile drawer (slides up from bottom) ────────────────────────────── */}
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-stone-900 border-t border-stone-700 transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "75dvh" }}
      >
        {/* Drawer handle + tab header */}
        <div className="flex shrink-0 flex-col items-center pt-3 pb-0">
          {/* Drag handle pill */}
          <div className="w-10 h-1 rounded-full bg-stone-600 mb-3" />
          {/* Tab switcher inside drawer */}
          <div className="flex w-full border-b border-stone-700">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setSidebarTab(tab.key)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs uppercase tracking-[0.1em] transition-colors ${
                  sidebarTab === tab.key
                    ? "text-amber-200"
                    : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {tab.key === "combat" && combatState?.is_active && (
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                )}
                {tab.label}
                {sidebarTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-400/70" />
                )}
              </button>
            ))}
          </div>
        </div>
        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain">
          <SidebarContent />
        </div>
      </div>
    </div>
  );
}
