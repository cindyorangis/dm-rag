"use client";

import { useRef, useEffect, useState } from "react";
import { DMMessage, UserMessage } from "@/components/ChatMessage";
import DiceRoller from "./DiceRoller";
import InitiativeRoller from "./InitiativeRoller";
import type { Message, RollRequest } from "@/hooks/useChat";
import type { ParsedDMResponse } from "@/lib/parse-dm-response";

interface ChatAreaProps {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  parsedDM: ParsedDMResponse;
  error: string | null;
  input: string;
  inputLocked: boolean;
  awaitingInitiative: boolean;
  pendingRolls: RollRequest[];
  dexMod: number;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onCancelStream: () => void;
  onHintSelect: (prompt: string) => void;
  onInitiativeRoll: (total: number) => Promise<void>;
  onRollResult: (resultText: string) => void;
}

export function ChatArea({
  messages,
  isLoading,
  isStreaming,
  parsedDM,
  error,
  input,
  inputLocked,
  awaitingInitiative,
  pendingRolls,
  dexMod,
  onInputChange,
  onSubmit,
  onCancelStream,
  onHintSelect,
  onInitiativeRoll,
  onRollResult,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamingMsgId = messages.find((m) => m.streaming)?.id ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, awaitingInitiative, pendingRolls]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <>
      {/* Messages */}
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
        {isLoading && (
          <p className="mt-20 animate-pulse text-center font-serif text-base italic text-stone-300/80">
            The torches flicker as your adventure loads...
          </p>
        )}
        {!isLoading && messages.length === 0 && (
          <p className="mt-20 text-center font-serif text-base italic text-stone-300/80">
            Your adventure begins. What do you do?
          </p>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <DMMessage
              key={msg.id}
              message={msg}
              streamingParsed={msg.id === streamingMsgId ? parsedDM : undefined}
              onHintSelect={onHintSelect}
            />
          ),
        )}

        {awaitingInitiative && !isStreaming && (
          <InitiativeRoller dexMod={dexMod} onRoll={onInitiativeRoll} />
        )}

        {pendingRolls.length > 0 && !isStreaming && (
          <div className="mx-auto max-w-3xl space-y-2">
            {pendingRolls.map((roll, i) => (
              <DiceRoller key={i} request={roll} onResult={onRollResult} />
            ))}
          </div>
        )}

        {error && <p className="text-center text-base text-red-300">{error}</p>}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-stone-700 px-5 py-4">
        {inputLocked ? (
          <p className="py-1 text-center font-serif text-base italic text-amber-200/90">
            {awaitingInitiative
              ? "Roll your initiative above before acting..."
              : "Roll the dice above to continue..."}
          </p>
        ) : (
          <div className="mx-auto flex max-w-3xl items-end gap-3">
            <textarea
              className="flex-1 resize-none rounded-lg border border-stone-600 bg-stone-900 px-4 py-3 text-base text-stone-100 placeholder-stone-400 focus:border-amber-400 focus:outline-none"
              rows={2}
              placeholder="What do you do?"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />
            {isStreaming ? (
              <button
                onClick={onCancelStream}
                className="rounded-lg bg-stone-700 px-4 py-3 text-base text-stone-100 transition-colors hover:bg-stone-600"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onSubmit}
                disabled={!input.trim()}
                className="rounded-lg bg-amber-700 px-4 py-3 text-base text-white transition-colors hover:bg-amber-600 disabled:opacity-40"
              >
                Send
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
