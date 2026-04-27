"use client";

import { parseDMResponse, ParsedDMResponse } from "@/lib/parse-dm-response";
import { StatusCard } from "./StatusCard";
import { HintPanel } from "./HintPanel";
import type { Message } from "@/hooks/useChat";

function stripRollTags(text: string): string {
  return text
    .replace(/\[ROLL:[^\]]*\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface DMMessageProps {
  message: Message;
  /** Pass parsedDM from useChat only for the currently-streaming message */
  streamingParsed?: ParsedDMResponse;
  onHintSelect: (prompt: string) => void;
}

export function DMMessage({
  message,
  streamingParsed,
  onHintSelect,
}: DMMessageProps) {
  // For the live streaming message, use the hook's incremental parse.
  // For every historical message, parse the raw stored content.
  const parsed: ParsedDMResponse =
    message.streaming && streamingParsed
      ? streamingParsed
      : parseDMResponse(message.content);

  const narrative = stripRollTags(parsed.narrative);

  return (
    <div className="mx-auto max-w-3xl text-left">
      <div className="prose prose-invert prose-stone max-w-none font-serif text-base leading-relaxed text-stone-100">
        {narrative}
        {message.streaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse" />
        )}
      </div>

      {parsed.statusItems.length > 0 && (
        <StatusCard items={parsed.statusItems} />
      )}

      {parsed.hints.length > 0 && (
        <HintPanel hints={parsed.hints} onSelect={onHintSelect} />
      )}
    </div>
  );
}

interface UserMessageProps {
  message: Message;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className="mx-auto max-w-3xl text-right">
      <span className="inline-block rounded-lg border border-stone-700 bg-stone-800 px-4 py-2 text-base text-stone-100">
        {message.content}
      </span>
    </div>
  );
}
