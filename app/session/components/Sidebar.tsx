"use client";

import { useEffect, useRef, useState } from "react";
import { CharacterData, modifier } from "@/lib/character";
import { CombatState } from "@/lib/combat/types";
import SidebarSection from "./SidebarSection";
import CombatantRow from "./CombatantRow";
import StatBlock from "./StatBlock";
import type { Message } from "@/hooks/useChat";

// ── Constants ─────────────────────────────────────────────────────────────────

const STATS = ["str", "dex", "con", "int", "wis", "cha"] as const;

const QUICK_PHRASES = [
  "I investigate the area",
  "I attempt to pick the lock",
  "I cast [spell name]",
  "I try to persuade them",
  "I hide in the shadows",
  "I search for traps",
  "I take a short rest",
] as const;

const QUICK_REFERENCE = [
  ["Attack roll", "d20 + ability mod + proficiency"],
  ["Saving throw", "d20 + ability mod"],
  ["Advantage", "roll 2d20, take higher"],
  ["Disadvantage", "roll 2d20, take lower"],
  ["Death saves", "3 successes stable, 3 fails dead"],
  ["Short rest", "spend Hit Dice to heal"],
  ["Long rest", "regain all HP + half Hit Dice"],
] as const;

const TABS = [
  {
    key: "character" as const,
    label: "Character",
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
] as const;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface SidebarProps {
  character: CharacterData;
  combatState: CombatState | null;
  messages: Message[];
  activeTab: "character" | "combat" | "log";
  isStreaming: boolean;
  onTabChange: (tab: "character" | "combat" | "log") => void;
  /** Fire a message directly to the DM (e.g. "Who am I?") */
  onSendMessage: (text: string) => void;
  /** Set the chat input to a quick phrase (and close the mobile drawer) */
  onPhraseSelect: (phrase: string) => void;
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function Sidebar({
  character,
  combatState,
  messages,
  activeTab,
  isStreaming,
  onTabChange,
  onSendMessage,
  onPhraseSelect,
}: SidebarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close drawer on outside tap/click
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

  const openDrawerTab = (tab: "character" | "combat" | "log") => {
    onTabChange(tab);
    setDrawerOpen(true);
  };

  // Wrap onPhraseSelect so the drawer also closes on mobile
  const handlePhraseSelect = (phrase: string) => {
    onPhraseSelect(phrase);
    setDrawerOpen(false);
  };

  const combatIsActive = combatState?.is_active ?? false;

  const contentProps: ContentProps = {
    character,
    combatState,
    messages,
    activeTab,
    isStreaming,
    onSendMessage,
    onPhraseSelect: handlePhraseSelect,
  };

  return (
    <>
      {/* ── Desktop sidebar (md+) ─────────────────────────────────────────── */}
      <div className="hidden md:flex w-80 shrink-0 flex-col overflow-hidden border-l border-stone-700 bg-stone-950/90">
        <TabBar
          activeTab={activeTab}
          combatIsActive={combatIsActive}
          onTabChange={onTabChange}
        />
        <SidebarContent {...contentProps} />
      </div>

      {/* ── Mobile bottom tab bar ─────────────────────────────────────────── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex border-t border-stone-700 bg-stone-950/95 backdrop-blur-sm">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => openDrawerTab(tab.key)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
              drawerOpen && activeTab === tab.key
                ? "text-amber-300"
                : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {tab.icon}
            <span className="text-[0.6rem] uppercase tracking-[0.1em]">
              {tab.label}
            </span>
            {tab.key === "combat" && combatIsActive && (
              <span className="absolute top-1.5 right-4 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* ── Mobile drawer backdrop ────────────────────────────────────────── */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          drawerOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        aria-hidden="true"
      />

      {/* ── Mobile drawer panel ───────────────────────────────────────────── */}
      <div
        ref={drawerRef}
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-stone-900 border-t border-stone-700 transition-transform duration-300 ease-out ${
          drawerOpen ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ maxHeight: "75dvh" }}
      >
        {/* Drag handle + in-drawer tab switcher */}
        <div className="flex shrink-0 flex-col items-center pt-3 pb-0">
          <div className="w-10 h-1 rounded-full bg-stone-600 mb-3" />
          <div className="flex w-full border-b border-stone-700">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs uppercase tracking-[0.1em] transition-colors ${
                  activeTab === tab.key
                    ? "text-amber-200"
                    : "text-stone-400 hover:text-stone-200"
                }`}
              >
                {tab.key === "combat" && combatIsActive && (
                  <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                )}
                {tab.label}
                {activeTab === tab.key && (
                  <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-400/70" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto overscroll-contain">
          <SidebarContent {...contentProps} />
        </div>
      </div>
    </>
  );
}

// ── TabBar (desktop) ──────────────────────────────────────────────────────────

function TabBar({
  activeTab,
  combatIsActive,
  onTabChange,
}: {
  activeTab: "character" | "combat" | "log";
  combatIsActive: boolean;
  onTabChange: (tab: "character" | "combat" | "log") => void;
}) {
  return (
    <div className="flex shrink-0 border-b border-stone-700">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`relative flex-1 py-3 text-xs uppercase tracking-[0.12em] transition-colors ${
            activeTab === tab.key
              ? "bg-stone-900/70 text-amber-200"
              : "text-stone-300 hover:text-stone-100"
          }`}
        >
          {tab.label}
          {tab.key === "combat" && combatIsActive && (
            <span className="absolute top-1.5 right-2 w-1.5 h-1.5 bg-red-500 rounded-full" />
          )}
          {activeTab === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-400/70" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── SidebarContent (rendered inside both desktop panel and mobile drawer) ─────

interface ContentProps {
  character: CharacterData;
  combatState: CombatState | null;
  messages: Message[];
  activeTab: "character" | "combat" | "log";
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
  onPhraseSelect: (phrase: string) => void;
}

function SidebarContent({
  character,
  combatState,
  messages,
  activeTab,
  isStreaming,
  onSendMessage,
  onPhraseSelect,
}: ContentProps) {
  const activeCombatants = combatState?.combatants ?? [];
  const currentTurnId = combatState?.is_active
    ? activeCombatants[combatState.current_turn_index]?.id
    : null;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      {activeTab === "character" && (
        <CharacterTab
          character={character}
          isStreaming={isStreaming}
          onSendMessage={onSendMessage}
        />
      )}
      {activeTab === "combat" && (
        <CombatTab
          combatState={combatState}
          activeCombatants={activeCombatants}
          currentTurnId={currentTurnId}
        />
      )}
      {activeTab === "log" && (
        <LogTab
          messages={messages}
          combatState={combatState}
          onPhraseSelect={onPhraseSelect}
        />
      )}
    </div>
  );
}

// ── Character tab ─────────────────────────────────────────────────────────────

function CharacterTab({
  character,
  isStreaming,
  onSendMessage,
}: {
  character: CharacterData;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
}) {
  const hasCharacter = Object.keys(character).length > 0;

  if (!hasCharacter) {
    return (
      <div className="mt-8 space-y-3 text-center">
        <p className="font-serif text-base italic text-stone-300/80">
          Character data not loaded.
        </p>
        <button
          onClick={() =>
            onSendMessage(
              "Who am I? Please describe my character — name, race, class, level, HP, AC, and ability scores.",
            )
          }
          disabled={isStreaming}
          className="font-serif text-sm italic text-amber-200 transition-colors hover:text-amber-100 disabled:opacity-40"
        >
          Ask the DM
        </button>
      </div>
    );
  }

  return (
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
  );
}

// ── Combat tab ────────────────────────────────────────────────────────────────

function CombatTab({
  combatState,
  activeCombatants,
  currentTurnId,
}: {
  combatState: CombatState | null;
  activeCombatants: CombatState["combatants"];
  currentTurnId: string | null;
}) {
  if (!combatState?.is_active) {
    return (
      <div className="mt-8 space-y-2 text-center">
        <p className="font-serif text-base italic text-stone-300/80">
          No active combat.
        </p>
        <p className="text-sm text-stone-300/75">
          Initiative order appears here when combat begins.
        </p>
      </div>
    );
  }

  if (combatState.awaiting_player_initiative) {
    return (
      <div className="mt-8 space-y-2 px-2 text-center">
        <p className="font-serif text-base italic text-amber-200/90">
          Waiting for your initiative roll...
        </p>
        <p className="text-sm text-stone-300/75">
          Roll in the chat to set the order.
        </p>
      </div>
    );
  }

  return (
    <>
      <SidebarSection title={`Round ${combatState.round} — Initiative Order`}>
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
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {[...combatState.log]
              .reverse()
              .slice(0, 10)
              .map((entry, i) => (
                <p
                  key={i}
                  className="border-b border-stone-700/60 pb-1 text-xs leading-snug text-stone-200/85 last:border-0"
                >
                  <span className="mr-1 text-amber-300/90">R{entry.round}</span>
                  {entry.description}
                </p>
              ))}
          </div>
        </SidebarSection>
      )}
    </>
  );
}

// ── Log tab ───────────────────────────────────────────────────────────────────

function LogTab({
  messages,
  combatState,
  onPhraseSelect,
}: {
  messages: Message[];
  combatState: CombatState | null;
  onPhraseSelect: (phrase: string) => void;
}) {
  return (
    <>
      <SidebarSection title="Session Stats">
        <div className="space-y-2">
          <StatRow label="Messages" value={messages.length} />
          <StatRow
            label="DM Responses"
            value={messages.filter((m) => m.role === "assistant").length}
          />
          {combatState && (
            <StatRow label="Combat Rounds" value={combatState.round} />
          )}
        </div>
      </SidebarSection>

      <SidebarSection title="Quick Reference">
        <div className="space-y-2 font-serif text-sm text-stone-200/90">
          {QUICK_REFERENCE.map(([term, desc]) => (
            <p key={term}>
              <span className="text-amber-200">{term}:</span> {desc}
            </p>
          ))}
        </div>
      </SidebarSection>

      <SidebarSection title="Useful Phrases">
        <div className="space-y-1.5">
          {QUICK_PHRASES.map((phrase) => (
            <button
              key={phrase}
              onClick={() => onPhraseSelect(phrase)}
              className="w-full py-0.5 text-left font-serif text-sm italic text-stone-200/90 transition-colors hover:text-amber-200"
            >
              {phrase}
            </button>
          ))}
        </div>
      </SidebarSection>
    </>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-stone-300">{label}</span>
      <span className="font-serif text-base text-amber-200">{value}</span>
    </div>
  );
}
