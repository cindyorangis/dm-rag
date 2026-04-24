"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  parseCharacterContext,
  modifier,
  CharacterData,
  CombatState,
} from "@/lib/character";
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
    if (combatState?.is_active && !combatState.awaiting_player_initiative)
      setSidebarTab("combat");
  }, [combatState?.is_active, combatState?.awaiting_player_initiative]);
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
      // Only dismiss (unlock input) once ALL pending rolls in this batch are confirmed
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

  // The last assistant message that is actively streaming
  const streamingMsgId = messages.find((m) => m.streaming)?.id ?? null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-stone-950 text-stone-100 overflow-hidden">
      {/* ── Chat column ────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="border-b border-stone-800 px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-amber-400 text-sm tracking-widest uppercase">
              Lost Mine of Phandelver
            </h1>
            {combatState?.is_active &&
              !combatState.awaiting_player_initiative && (
                <span className="text-[0.55rem] bg-red-950/70 border border-red-800/60 text-red-400 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                  ⚔ Combat — Round {combatState.round}
                </span>
              )}
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() =>
                sendMessage(
                  "Who am I? Please describe my character — name, race, class, level, and key stats.",
                )
              }
              disabled={isStreaming}
              className="text-stone-600 hover:text-amber-700/80 text-xs disabled:opacity-30 transition-colors font-serif italic"
            >
              Who am I?
            </button>
            <button
              onClick={endSession}
              disabled={isStreaming || messages.length === 0 || isEndingSession}
              className="text-stone-500 hover:text-stone-300 text-xs disabled:opacity-30 transition-colors"
            >
              {isEndingSession ? "Writing journal…" : "End Session →"}
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {isLoading ? (
            <p className="text-center text-stone-500 italic mt-20 animate-pulse">
              The torches flicker as your adventure loads…
            </p>
          ) : messages.length === 0 ? (
            <p className="text-center text-stone-500 italic mt-20">
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
                // Only pass parsedDM for the actively streaming message
                streamingParsed={
                  msg.id === streamingMsgId ? parsedDM : undefined
                }
                onHintSelect={(prompt: string) => sendMessage(prompt)}
              />
            ),
          )}

          {/* Initiative roller */}
          {awaitingInitiative && !isStreaming && (
            <InitiativeRoller dexMod={dexMod} onRoll={handleInitiativeRoll} />
          )}

          {/* Attack / check / save / damage rollers */}
          {pendingRolls.length > 0 && !isStreaming && (
            <div className="max-w-2xl mx-auto space-y-2">
              {pendingRolls.map((roll, i) => (
                <DiceRoller
                  key={i}
                  request={roll}
                  onResult={handleRollResult}
                />
              ))}
            </div>
          )}

          {error && <p className="text-center text-red-400 text-sm">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-stone-800 px-4 py-4 shrink-0">
          {inputLocked ? (
            <p className="text-center text-amber-700/60 font-serif italic text-sm py-1">
              {awaitingInitiative
                ? "Roll your initiative above before acting…"
                : "Roll the dice above to continue…"}
            </p>
          ) : (
            <div className="max-w-2xl mx-auto flex gap-3 items-end">
              <textarea
                className="flex-1 bg-stone-900 border border-stone-700 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 resize-none focus:outline-none focus:border-amber-600 text-sm"
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
                  className="px-4 py-3 bg-stone-700 hover:bg-stone-600 text-stone-300 rounded-lg text-sm transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  className="px-4 py-3 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-sm transition-colors"
                >
                  Send
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-stone-800 flex flex-col bg-stone-950/80 overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-stone-800 shrink-0">
          {(
            [
              { key: "character", label: "Character" },
              { key: "combat", label: "Combat" },
              { key: "log", label: "Log" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`flex-1 py-2.5 text-[0.6rem] tracking-widest uppercase font-sans transition-colors relative ${sidebarTab === tab.key ? "text-amber-400 bg-stone-900/50" : "text-stone-600 hover:text-stone-400"}`}
            >
              {tab.label}
              {tab.key === "combat" && combatState?.is_active && (
                <span className="absolute top-1.5 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
              )}
              {sidebarTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-700/60" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* CHARACTER TAB */}
          {sidebarTab === "character" && (
            <>
              {!hasCharacter ? (
                <div className="text-center mt-8 space-y-3">
                  <p className="text-stone-600 italic font-serif text-sm">
                    Character data not loaded.
                  </p>
                  <button
                    onClick={() =>
                      sendMessage(
                        "Who am I? Please describe my character — name, race, class, level, HP, AC, and ability scores.",
                      )
                    }
                    disabled={isStreaming}
                    className="text-amber-800/70 hover:text-amber-700 text-xs font-serif italic disabled:opacity-30 transition-colors"
                  >
                    Ask the DM →
                  </button>
                </div>
              ) : (
                <>
                  <SidebarSection title="Adventurer">
                    <div className="space-y-0.5">
                      {character.name && (
                        <p className="font-serif text-amber-300 text-base leading-tight">
                          {character.name}
                        </p>
                      )}
                      {character.identity && (
                        <p className="text-stone-400 text-xs font-serif">
                          {character.identity}
                        </p>
                      )}
                      {character.background && (
                        <p className="text-stone-500 text-xs font-serif italic">
                          {character.background}
                        </p>
                      )}
                    </div>
                  </SidebarSection>
                  {(character.hp || character.ac) && (
                    <SidebarSection title="Combat Stats">
                      <div className="flex gap-3">
                        {character.hp && (
                          <div className="flex-1 flex flex-col items-center bg-black/40 border border-red-950/50 rounded p-2 gap-0.5">
                            <span className="text-[0.5rem] tracking-widest uppercase text-red-900/80 font-sans">
                              Max HP
                            </span>
                            <span className="text-red-300/90 font-serif text-xl leading-none">
                              {character.hp}
                            </span>
                          </div>
                        )}
                        {character.ac && (
                          <div className="flex-1 flex flex-col items-center bg-black/40 border border-blue-950/50 rounded p-2 gap-0.5">
                            <span className="text-[0.5rem] tracking-widest uppercase text-blue-900/80 font-sans">
                              AC
                            </span>
                            <span className="text-blue-300/90 font-serif text-xl leading-none">
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
                      <p className="text-stone-400 font-serif italic text-xs leading-relaxed">
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
                  <p className="text-stone-600 font-serif italic text-sm">
                    No active combat.
                  </p>
                  <p className="text-stone-700 text-xs">
                    Initiative order appears here when combat begins.
                  </p>
                </div>
              ) : combatState.awaiting_player_initiative ? (
                <div className="text-center mt-8 space-y-2 px-2">
                  <div className="text-2xl">🎲</div>
                  <p className="text-amber-700/80 font-serif italic text-sm">
                    Waiting for your initiative roll…
                  </p>
                  <p className="text-stone-600 text-xs">
                    Roll in the chat to set the order.
                  </p>
                </div>
              ) : (
                <>
                  <SidebarSection
                    title={`Round ${combatState.round} — Initiative Order`}
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
                              className="text-stone-500 text-[0.65rem] font-serif leading-snug border-b border-stone-800/50 pb-1 last:border-0"
                            >
                              <span className="text-amber-900/60 mr-1">
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
                    <span className="text-stone-500 text-xs font-sans">
                      Messages
                    </span>
                    <span className="text-amber-400/80 font-serif text-sm">
                      {messages.length}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-stone-500 text-xs font-sans">
                      DM Responses
                    </span>
                    <span className="text-amber-400/80 font-serif text-sm">
                      {messages.filter((m) => m.role === "assistant").length}
                    </span>
                  </div>
                  {combatState && (
                    <div className="flex justify-between">
                      <span className="text-stone-500 text-xs font-sans">
                        Combat Rounds
                      </span>
                      <span className="text-amber-400/80 font-serif text-sm">
                        {combatState.round}
                      </span>
                    </div>
                  )}
                </div>
              </SidebarSection>
              <SidebarSection title="Quick Reference">
                <div className="space-y-2 text-xs font-serif text-stone-500">
                  <p>
                    <span className="text-amber-800/70">Attack roll:</span> d20
                    + ability mod + proficiency
                  </p>
                  <p>
                    <span className="text-amber-800/70">Saving throw:</span> d20
                    + ability mod
                  </p>
                  <p>
                    <span className="text-amber-800/70">Advantage:</span> roll
                    2d20, take higher
                  </p>
                  <p>
                    <span className="text-amber-800/70">Disadvantage:</span>{" "}
                    roll 2d20, take lower
                  </p>
                  <p>
                    <span className="text-amber-800/70">Death saves:</span> 3
                    successes stable, 3 fails dead
                  </p>
                  <p>
                    <span className="text-amber-800/70">Short rest:</span> spend
                    Hit Dice to heal
                  </p>
                  <p>
                    <span className="text-amber-800/70">Long rest:</span> regain
                    all HP + half Hit Dice
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
                      onClick={() => setInput(phrase)}
                      className="w-full text-left text-[0.65rem] text-stone-600 hover:text-amber-600/80 font-serif italic transition-colors py-0.5"
                    >
                      "{phrase}"
                    </button>
                  ))}
                </div>
              </SidebarSection>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
