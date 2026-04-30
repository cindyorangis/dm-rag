"use client";

import { useState } from "react";
import {
  parseDMResponse,
  ParsedDMResponse,
  getCleanNarrativeForSpeech,
} from "@/lib/parse-dm-response";
import { StatusCard } from "./StatusCard";
import { HintPanel } from "./HintPanel";
import { NarrativeNotification } from "./NarrativeNotification";
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
  const [isPlaying, setIsPlaying] = useState(false);
  const isDM = message.role === "assistant";
  // For the live streaming message, use the hook's incremental parse.
  // For every historical message, parse the raw stored content.
  const parsed: ParsedDMResponse =
    message.streaming && streamingParsed
      ? streamingParsed
      : parseDMResponse(message.content);

  const narrative = stripRollTags(parsed.narrative);

  const handlePlayVoice = async () => {
    if (isPlaying) return;

    setIsPlaying(true);
    try {
      const cleanText = getCleanNarrativeForSpeech(message.content);

      // Call the Next.js API route you created in app/api/tts/route.ts
      const response = await fetch(
        `/api/tts?text=${encodeURIComponent(cleanText)}`,
      );

      if (!response.ok) throw new Error("TTS failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url); // Clean up memory
      };

      await audio.play();
    } catch (error) {
      console.error("Playback error:", error);
      setIsPlaying(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl text-left">
      <div className="prose prose-invert prose-stone max-w-none font-serif text-base leading-relaxed text-stone-100 group">
        {narrative}
        {message.streaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse" />
        )}
        {/* Manual Play Button - Only show for DM */}
        {isDM && (
          <div className="flex justify-end mt-2">
            <button
              onClick={handlePlayVoice}
              disabled={isPlaying}
              className="px-4 py-2 rounded-full bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-colors flex items-center gap-2 shadow-lg"
            >
              {isPlaying ? (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Play</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Narrative notifications for flag operations */}
      <NarrativeNotification parsed={parsed} />

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
