"use client";

import { useParams, useRouter } from "next/navigation";
import { useChat } from "@/hooks/useChat";
import type { RollRequest } from "@/hooks/useChat";
import { useEffect, useRef, useState, useCallback } from "react";
import { DMMessage, UserMessage } from "@/components/ChatMessage";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CharacterData {
  name?: string;
  identity?: string;
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
  type: "player" | "monster";
  hp: number;
  max_hp: number;
  ac: number;
  initiative: number;
  initiative_mod: number;
  conditions?: string[];
  is_alive: boolean;
}

interface CombatState {
  is_active: boolean;
  round: number;
  current_turn_index: number;
  combatants: Combatant[];
  log: { round: number; description: string }[];
  awaiting_player_initiative?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
      continue;
    }
    if (line.startsWith("Background:")) {
      data.background = line.replace("Background:", "").trim();
      continue;
    }
    if (line.startsWith("Ability scores")) {
      for (const pair of line
        .replace("Ability scores —", "")
        .trim()
        .split("|")) {
        const [stat, val] = pair.trim().split(" ");
        const key = stat?.toLowerCase() as keyof CharacterData;
        if (key && val) (data as Record<string, string>)[key] = val;
      }
      continue;
    }
    const hpMatch = line.match(/HP:\s*(\d+)/);
    if (hpMatch) data.hp = hpMatch[1];
    const acMatch = line.match(/AC:\s*(\d+)/);
    if (acMatch) data.ac = acMatch[1];
    if (line.match(/Level \d+/)) {
      data.identity = line;
      continue;
    }
    if (
      !line.startsWith("HP:") &&
      !line.startsWith("AC:") &&
      !line.startsWith("Name:") &&
      !line.startsWith("Background:") &&
      !line.startsWith("Ability")
    ) {
      if (!data.notes) data.notes = line;
      else data.notes += " " + line;
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

function parseDiceExpression(expr: string): { sides: number; mod: number } {
  const m = expr.match(/d(\d+)([+-]\d+)?/i);
  if (!m) return { sides: 20, mod: 0 };
  return { sides: parseInt(m[1]), mod: parseInt(m[2] ?? "0") };
}

function hpPercent(hp: number, max: number) {
  return Math.max(0, Math.min(100, (hp / max) * 100));
}

function hpColor(pct: number) {
  if (pct > 60) return "bg-emerald-600";
  if (pct > 30) return "bg-amber-500";
  return "bg-red-600";
}

// ── Dice Roller ───────────────────────────────────────────────────────────────

function DiceRoller({
  request,
  onResult,
}: {
  request: RollRequest;
  onResult: (resultText: string) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [result, setResult] = useState<{
    natural: number;
    total: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { sides, mod } = parseDiceExpression(request.dice);

  const handleRoll = () => {
    if (rolling || result) return;
    setRolling(true);
    let ticks = 0;
    const interval = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * sides) + 1);
      ticks++;
      if (ticks > 14) {
        clearInterval(interval);
        const natural = Math.floor(Math.random() * sides) + 1;
        setDisplayNum(natural);
        setResult({ natural, total: natural + mod });
        setRolling(false);
      }
    }, 55);
  };

  const handleConfirm = () => {
    if (!result || confirmed) return;
    setConfirmed(true);
    let resultText = "";
    if (request.type === "attack" && request.targetAC !== undefined) {
      const hit = result.total >= request.targetAC;
      resultText = `Attack roll: ${result.natural} + ${mod} = ${result.total} vs AC ${request.targetAC} — ${hit ? "HIT!" : "MISS."}`;
    } else if (request.type === "check" || request.type === "save") {
      const success = request.dc !== undefined && result.total >= request.dc;
      resultText = `${request.label}: ${result.natural} + ${mod} = ${result.total} vs DC ${request.dc} — ${success ? "Success!" : "Failure."}`;
    } else {
      resultText = `${request.label}: rolled ${result.total} (${result.natural}${mod >= 0 ? "+" : ""}${mod})`;
    }
    setTimeout(() => onResult(resultText), 350);
  };

  const isCrit = result?.natural === sides;
  const isFumble = result?.natural === 1 && sides === 20;

  return (
    <div
      className={`border rounded-lg p-4 space-y-3 transition-all duration-500 ${confirmed ? "border-amber-700/20 bg-stone-900/20 opacity-40" : "border-amber-700/50 bg-gradient-to-b from-amber-950/25 to-stone-900/40"}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.55rem] tracking-widest uppercase text-amber-800/70 font-sans bg-amber-950/30 border border-amber-900/40 px-2 py-0.5 rounded">
          {request.type}
        </span>
        <span className="text-stone-400 font-serif text-sm">
          {request.label}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center font-serif text-xl font-bold transition-all select-none shrink-0 ${result ? (isCrit ? "border-yellow-400 bg-yellow-950/40 text-yellow-300" : isFumble ? "border-red-700 bg-red-950/40 text-red-400" : "border-amber-600/50 bg-amber-950/20 text-amber-200") : rolling ? "border-amber-700/60 bg-amber-950/20 text-amber-400 animate-pulse cursor-wait" : "border-stone-600 bg-stone-800/50 text-stone-400 hover:border-amber-600/60 hover:text-amber-300 hover:bg-amber-950/15 cursor-pointer active:scale-95"}`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-50" : ""}>{displayNum}</span>
          ) : (
            <span className="text-stone-500 text-sm">d{sides}</span>
          )}
        </button>
        <div className="flex-1 min-w-0">
          {result ? (
            <div className="space-y-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={`font-serif text-2xl font-bold ${isCrit ? "text-yellow-300" : isFumble ? "text-red-400" : "text-amber-200"}`}
                >
                  {result.total}
                </span>
                <span className="text-stone-500 text-xs font-sans">
                  ({result.natural} {mod >= 0 ? "+" : ""}
                  {mod})
                </span>
                {request.targetAC !== undefined && (
                  <span
                    className={`text-xs font-serif ${result.total >= request.targetAC ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {result.total >= request.targetAC ? "✓ HIT" : "✗ MISS"}
                  </span>
                )}
                {(request.type === "check" || request.type === "save") &&
                  request.dc !== undefined && (
                    <span
                      className={`text-xs font-serif ${result.total >= request.dc ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {result.total >= request.dc ? "✓ SUCCESS" : "✗ FAIL"}
                    </span>
                  )}
              </div>
              {isCrit && (
                <p className="text-yellow-400/80 text-xs font-serif italic">
                  ✦ Critical hit!
                </p>
              )}
              {isFumble && (
                <p className="text-red-400/70 text-xs font-serif italic">
                  A fumble…
                </p>
              )}
            </div>
          ) : (
            <p className="text-stone-600 font-serif italic text-sm">
              {rolling ? "Rolling…" : "Click the die to roll"}
            </p>
          )}
        </div>
        {result && !confirmed && (
          <button
            onClick={handleConfirm}
            className="px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-serif rounded transition-colors shrink-0"
          >
            Confirm →
          </button>
        )}
        {confirmed && (
          <span className="text-amber-700/50 text-xs font-serif italic shrink-0">
            Sent
          </span>
        )}
      </div>
    </div>
  );
}

// ── Initiative Roller ─────────────────────────────────────────────────────────

function InitiativeRoller({
  dexMod,
  onRoll,
}: {
  dexMod: number;
  onRoll: (total: number) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [result, setResult] = useState<{
    natural: number;
    total: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleRoll = () => {
    if (rolling || result) return;
    setRolling(true);
    let ticks = 0;
    const interval = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 20) + 1);
      ticks++;
      if (ticks > 16) {
        clearInterval(interval);
        const natural = Math.floor(Math.random() * 20) + 1;
        setDisplayNum(natural);
        setResult({ natural, total: natural + dexMod });
        setRolling(false);
      }
    }, 50);
  };

  const handleConfirm = () => {
    if (!result || confirmed) return;
    setConfirmed(true);
    setTimeout(() => onRoll(result.total), 350);
  };

  return (
    <div
      className={`my-4 max-w-2xl mx-auto border rounded-lg p-5 space-y-4 transition-all duration-500 ${confirmed ? "border-amber-700/20 bg-stone-900/20 opacity-40" : "border-amber-700/60 bg-gradient-to-b from-amber-950/30 to-stone-900/50"}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-px h-8 bg-amber-800/40" />
        <div>
          <p className="font-serif text-amber-300 text-sm">
            Roll for Initiative!
          </p>
          <p className="text-stone-500 text-xs mt-0.5">
            d20 {dexMod >= 0 ? `+ ${dexMod}` : `− ${Math.abs(dexMod)}`} (DEX
            modifier)
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`w-16 h-16 rounded-lg border-2 flex items-center justify-center font-serif text-2xl font-bold transition-all select-none ${result ? (result.natural === 20 ? "border-yellow-400 bg-yellow-950/40 text-yellow-300" : result.natural === 1 ? "border-red-700 bg-red-950/40 text-red-400" : "border-amber-600/60 bg-amber-950/20 text-amber-200") : rolling ? "border-amber-700/80 bg-amber-950/30 text-amber-300 animate-pulse cursor-wait" : "border-stone-600 bg-stone-800/60 text-stone-400 hover:border-amber-600/70 hover:text-amber-300 cursor-pointer active:scale-95"}`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-60" : ""}>{displayNum}</span>
          ) : (
            <span className="text-stone-500 text-lg">d20</span>
          )}
        </button>
        <div className="flex-1">
          {result ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-serif text-3xl font-bold ${result.natural === 20 ? "text-yellow-300" : result.natural === 1 ? "text-red-400" : "text-amber-200"}`}
                >
                  {result.total}
                </span>
                <span className="text-stone-500 text-sm">
                  ({result.natural} {dexMod >= 0 ? "+" : ""}
                  {dexMod})
                </span>
              </div>
              {result.natural === 20 && (
                <p className="text-yellow-400/80 text-xs font-serif italic">
                  ✦ Natural 20 — you go first!
                </p>
              )}
              {result.natural === 1 && (
                <p className="text-red-400/70 text-xs font-serif italic">
                  A poor start…
                </p>
              )}
            </div>
          ) : (
            <p className="text-stone-600 font-serif italic text-sm">
              {rolling ? "Rolling…" : "Click the die to roll"}
            </p>
          )}
        </div>
        {result && !confirmed && (
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-serif rounded transition-colors"
          >
            Set Initiative →
          </button>
        )}
        {confirmed && (
          <span className="text-amber-600/60 text-xs font-serif italic">
            Locked in
          </span>
        )}
      </div>
    </div>
  );
}

// ── Sidebar components ────────────────────────────────────────────────────────

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
  const pct = hpPercent(combatant.hp, combatant.max_hp);
  return (
    <div
      className={`rounded p-2 space-y-1.5 transition-colors ${isCurrentTurn ? "bg-amber-900/25 border border-amber-700/40" : "bg-black/20 border border-transparent"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isCurrentTurn && (
            <span className="text-amber-400 text-[0.6rem] shrink-0">▶</span>
          )}
          <span
            className={`font-serif text-sm truncate ${combatant.type === "player" ? "text-amber-300" : "text-stone-300"}`}
          >
            {combatant.name}
          </span>
          {combatant.type === "player" && (
            <span className="text-[0.45rem] bg-amber-900/50 border border-amber-800/50 text-amber-600/80 px-1 rounded uppercase tracking-wider shrink-0">
              You
            </span>
          )}
        </div>
        <div className="flex gap-2 shrink-0 text-[0.6rem] text-stone-500 font-sans">
          <span>Init {combatant.initiative}</span>
          <span>AC {combatant.ac}</span>
        </div>
      </div>
      <div className="space-y-0.5">
        <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${hpColor(pct)}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[0.55rem] text-stone-500 font-sans">
          {combatant.hp} / {combatant.max_hp} HP
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

  const handleRollResult = useCallback(
    (resultText: string) => {
      dismissRolls();
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
