"use client";

import { CharacterData, modifier } from "@/lib/character";
import { CombatState } from "@/lib/combat/types";
import SidebarSection from "./SidebarSection";
import CombatantRow from "./CombatantRow";
import StatBlock from "./StatBlock";
import type { Message } from "@/hooks/useChat";

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

interface SidebarProps {
  character: CharacterData;
  combatState: CombatState | null;
  messages: Message[];
  activeTab: "character" | "combat" | "log";
  isStreaming: boolean;
  onTabChange: (tab: "character" | "combat" | "log") => void;
  onAskDM: (prompt: string) => void;
  onQuickPhrase: (phrase: string) => void;
}

export function Sidebar({
  character,
  combatState,
  messages,
  activeTab,
  isStreaming,
  onTabChange,
  onAskDM,
  onQuickPhrase,
}: SidebarProps) {
  const hasCharacter = Object.keys(character).length > 0;
  const activeCombatants = combatState?.combatants ?? [];
  const currentTurnId = combatState?.is_active
    ? activeCombatants[combatState.current_turn_index]?.id
    : null;

  return (
    <div className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-stone-700 bg-stone-950/90">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-stone-700">
        {(
          [
            { key: "character", label: "Character" },
            { key: "combat", label: "Combat" },
            { key: "log", label: "Log" },
          ] as const
        ).map((tab) => (
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
            {tab.key === "combat" && combatState?.is_active && (
              <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-amber-400/70" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {activeTab === "character" && (
          <CharacterTab
            character={character}
            hasCharacter={hasCharacter}
            isStreaming={isStreaming}
            onAskDM={onAskDM}
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
            onQuickPhrase={onQuickPhrase}
          />
        )}
      </div>
    </div>
  );
}

// ── Sub-tab components ────────────────────────────────────────────────────────

function CharacterTab({
  character,
  hasCharacter,
  isStreaming,
  onAskDM,
}: {
  character: CharacterData;
  hasCharacter: boolean;
  isStreaming: boolean;
  onAskDM: (prompt: string) => void;
}) {
  if (!hasCharacter) {
    return (
      <div className="mt-8 space-y-3 text-center">
        <p className="font-serif text-base italic text-stone-300/80">
          Character data not loaded.
        </p>
        <button
          onClick={() =>
            onAskDM(
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

function LogTab({
  messages,
  combatState,
  onQuickPhrase,
}: {
  messages: Message[];
  combatState: CombatState | null;
  onQuickPhrase: (phrase: string) => void;
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
          {[
            ["Attack roll", "d20 + ability mod + proficiency"],
            ["Saving throw", "d20 + ability mod"],
            ["Advantage", "roll 2d20, take higher"],
            ["Disadvantage", "roll 2d20, take lower"],
            ["Death saves", "3 successes stable, 3 fails dead"],
            ["Short rest", "spend Hit Dice to heal"],
            ["Long rest", "regain all HP + half Hit Dice"],
          ].map(([term, desc]) => (
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
              onClick={() => onQuickPhrase(phrase)}
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

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-stone-300">{label}</span>
      <span className="font-serif text-base text-amber-200">{value}</span>
    </div>
  );
}
