"use client";

import { useParams, useRouter } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface CharacterData {
  name?: string;
  identity?: string; // e.g. "Half-Elf Rogue (Level 3)"
  background?: string;
  hp?: string;
  ac?: string;
  str?: string;
  dex?: string;
  con?: string;
  int?: string;
  wis?: string;
  cha?: string;
  notes?: string;
}

interface Combatant {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
  isPlayer: boolean;
  conditions?: string[];
}

interface CombatState {
  is_active: boolean;
  round: number;
  current_turn_index: number;
  combatants: Combatant[];
  log: { message: string; round: number }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCharacterContext(ctx: string): CharacterData {
  if (!ctx) return {};
  const lines = ctx
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const data: CharacterData = {};

  for (const line of lines) {
    if (line.startsWith("Name:")) {
      data.name = line.replace("Name:", "").trim();
    } else if (line.startsWith("Background:")) {
      data.background = line.replace("Background:", "").trim();
    } else if (line.startsWith("Ability scores")) {
      const scores = line.replace("Ability scores —", "").trim();
      for (const pair of scores.split("|")) {
        const [stat, val] = pair.trim().split(" ");
        const key = stat?.toLowerCase() as keyof CharacterData;
        if (key && val) (data as Record<string, string>)[key] = val;
      }
    } else if (line.startsWith("HP:") || line.includes("HP:")) {
      const hpMatch = line.match(/HP:\s*(\d+)/);
      if (hpMatch) data.hp = hpMatch[1];
      const acMatch = line.match(/AC:\s*(\d+)/);
      if (acMatch) data.ac = acMatch[1];
    } else if (
      !line.startsWith("HP:") &&
      !line.startsWith("AC:") &&
      !line.startsWith("Name:") &&
      !line.startsWith("Background:") &&
      !line.startsWith("Ability")
    ) {
      // Lines like "Half-Elf Rogue (Level 3)"
      if (line.match(/Level \d+/)) {
        data.identity = line;
      } else if (!data.notes) {
        data.notes = line;
      } else {
        data.notes += " " + line;
      }
    }
  }

  return data;
}

function modifier(score: string | undefined): string {
  if (!score) return "—";
  const n = parseInt(score);
  if (isNaN(n)) return "—";
  const mod = Math.floor((n - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function hpPercent(hp: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (hp / max) * 100));
}

function hpColor(pct: number): string {
  if (pct > 60) return "bg-emerald-600";
  if (pct > 30) return "bg-amber-500";
  return "bg-red-600";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatBlock({
  label,
  value,
  mod,
}: {
  label: string;
  value?: string;
  mod: string;
}) {
  return (
    <div className="flex flex-col items-center bg-black/40 border border-amber-950/50 rounded p-1.5 gap-0.5">
      <span className="text-[0.5rem] tracking-widest uppercase text-amber-900/70 font-sans">
        {label}
      </span>
      <span className="text-amber-200/90 font-serif text-sm leading-none">
        {value || "—"}
      </span>
      <span className="text-[0.6rem] text-amber-700/80 font-sans">{mod}</span>
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-amber-950/50 rounded-md overflow-hidden">
      <div className="bg-amber-950/30 px-3 py-1.5 border-b border-amber-950/50">
        <span className="text-[0.55rem] tracking-[0.2em] uppercase text-amber-800/80 font-sans">
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function CombatantRow({
  combatant,
  isCurrentTurn,
}: {
  combatant: Combatant;
  isCurrentTurn: boolean;
}) {
  const pct = hpPercent(combatant.hp, combatant.maxHp);
  return (
    <div
      className={`rounded p-2 space-y-1.5 transition-colors ${
        isCurrentTurn
          ? "bg-amber-900/25 border border-amber-700/40"
          : "bg-black/20 border border-transparent"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {isCurrentTurn && (
            <span className="text-amber-400 text-[0.6rem]">▶</span>
          )}
          <span
            className={`font-serif text-sm ${
              combatant.isPlayer ? "text-amber-300" : "text-stone-300"
            }`}
          >
            {combatant.name}
          </span>
          {combatant.isPlayer && (
            <span className="text-[0.45rem] bg-amber-900/50 border border-amber-800/50 text-amber-600/80 px-1 rounded uppercase tracking-wider">
              You
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.6rem] text-stone-500 font-sans">
            Init {combatant.initiative}
          </span>
          <span className="text-[0.6rem] text-stone-500 font-sans">
            AC {combatant.ac}
          </span>
        </div>
      </div>
      {/* HP bar */}
      <div className="space-y-0.5">
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${hpColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[0.55rem] text-stone-500 font-sans">
          {combatant.hp} / {combatant.maxHp} HP
        </span>
      </div>
      {combatant.conditions && combatant.conditions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {combatant.conditions.map((c) => (
            <span
              key={c}
              className="text-[0.5rem] bg-red-950/50 border border-red-900/50 text-red-400/80 px-1 rounded uppercase tracking-wider"
            >
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { messages, isLoading, isStreaming, error, sendMessage, cancelStream } =
    useChat(id);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const [character, setCharacter] = useState<CharacterData>({});
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"character" | "combat" | "log">(
    "character",
  );
  const [isEndingSession, setIsEndingSession] = useState(false);

  // Fetch session data (character context + combat state)
  const fetchSessionData = useCallback(async () => {
    try {
      const [sessionRes, combatRes] = await Promise.all([
        fetch(`/api/sessions/${id}`),
        fetch(`/api/combat/${id}`).catch(() => null),
      ]);

      if (sessionRes.ok) {
        const session = await sessionRes.json();
        if (session.character_context) {
          setCharacter(parseCharacterContext(session.character_context));
        }
      }

      if (combatRes?.ok) {
        const combat = await combatRes.json();
        setCombatState(combat);
        if (combat?.is_active) setSidebarTab("combat");
      }
    } catch (err) {
      // Non-fatal — sidebar just won't have data
    }
  }, [id]);

  useEffect(() => {
    fetchSessionData();
  }, [fetchSessionData]);

  // Re-poll combat state while streaming (DM may have triggered combat)
  useEffect(() => {
    if (!isStreaming) {
      fetchSessionData();
    }
  }, [isStreaming, fetchSessionData]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Switch to combat tab automatically when combat starts
  useEffect(() => {
    if (combatState?.is_active) setSidebarTab("combat");
  }, [combatState?.is_active]);

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
    } catch (err) {
      console.error("Failed to end session:", err);
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

  const STATS = ["str", "dex", "con", "int", "wis", "cha"] as const;
  const hasCharacter = Object.keys(character).length > 0;
  const activeCombatants = combatState?.combatants ?? [];
  const currentTurnId = combatState?.is_active
    ? activeCombatants[combatState.current_turn_index]?.id
    : null;

  return (
    <div className="flex h-screen bg-stone-950 text-stone-100 overflow-hidden">
      {/* ── Main chat column ─────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="border-b border-stone-800 px-4 py-3 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-amber-400 text-sm tracking-widest uppercase">
              Lost Mine of Phandelver
            </h1>
            {combatState?.is_active && (
              <span className="text-[0.55rem] bg-red-950/70 border border-red-800/60 text-red-400 px-2 py-0.5 rounded uppercase tracking-widest animate-pulse">
                ⚔ Combat — Round {combatState.round}
              </span>
            )}
          </div>
          <button
            onClick={endSession}
            disabled={isStreaming || messages.length === 0 || isEndingSession}
            className="text-stone-500 hover:text-stone-300 text-xs disabled:opacity-30 transition-colors"
          >
            {isEndingSession ? "Writing journal…" : "End Session →"}
          </button>
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

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-2xl mx-auto ${
                msg.role === "user" ? "text-right" : "text-left"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-invert prose-stone max-w-none font-serif text-stone-200 leading-relaxed">
                  {msg.content}
                  {msg.streaming && (
                    <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse" />
                  )}
                </div>
              ) : (
                <span className="inline-block bg-stone-800 text-stone-300 px-4 py-2 rounded-lg text-sm">
                  {msg.content}
                </span>
              )}
            </div>
          ))}

          {error && <p className="text-center text-red-400 text-sm">{error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-stone-800 px-4 py-4 shrink-0">
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
        </div>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-l border-stone-800 flex flex-col bg-stone-950/80 overflow-hidden">
        {/* Sidebar tab bar */}
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
              className={`flex-1 py-2.5 text-[0.6rem] tracking-widest uppercase font-sans transition-colors relative ${
                sidebarTab === tab.key
                  ? "text-amber-400 bg-stone-900/50"
                  : "text-stone-600 hover:text-stone-400"
              }`}
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

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* ── CHARACTER TAB ── */}
          {sidebarTab === "character" && (
            <>
              {!hasCharacter ? (
                <p className="text-stone-600 italic font-serif text-sm text-center mt-8">
                  No character sheet found.
                </p>
              ) : (
                <>
                  {/* Identity */}
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

                  {/* Combat stats */}
                  {(character.hp || character.ac) && (
                    <SidebarSection title="Combat">
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

                  {/* Ability scores */}
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

                  {/* Notes */}
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

          {/* ── COMBAT TAB ── */}
          {sidebarTab === "combat" && (
            <>
              {!combatState?.is_active ? (
                <div className="text-center mt-8 space-y-2">
                  <p className="text-stone-600 font-serif italic text-sm">
                    No active combat.
                  </p>
                  <p className="text-stone-700 text-xs">
                    Initiative order will appear here when combat begins.
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

                  {/* Combat log */}
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
                              {entry.message}
                            </p>
                          ))}
                      </div>
                    </SidebarSection>
                  )}
                </>
              )}
            </>
          )}

          {/* ── LOG TAB ── */}
          {sidebarTab === "log" && (
            <>
              <SidebarSection title="Session Stats">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-stone-500 text-xs font-sans">
                      Messages
                    </span>
                    <span className="text-amber-400/80 font-serif text-sm">
                      {messages.length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-stone-500 text-xs font-sans">
                      DM Responses
                    </span>
                    <span className="text-amber-400/80 font-serif text-sm">
                      {messages.filter((m) => m.role === "assistant").length}
                    </span>
                  </div>
                  {combatState && (
                    <div className="flex justify-between items-center">
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
                    successes = stable, 3 fails = dead
                  </p>
                  <p>
                    <span className="text-amber-800/70">Short rest:</span> spend
                    Hit Dice to heal
                  </p>
                  <p>
                    <span className="text-amber-800/70">Long rest:</span> regain
                    all HP + half max Hit Dice
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
