"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  parseDMResponsePartial,
  parseDMResponse,
  ParsedDMResponse,
} from "@/lib/parse-dm-response";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export type RollRequest = {
  type: "attack" | "check" | "save" | "damage";
  dice: string; // e.g. "d20+5", "d8+3"
  targetAC?: number;
  targetName?: string;
  dc?: number;
  label: string; // e.g. "Attack vs Goblin (AC 15)"
};

// Parses [ROLL: attack d20+5 vs AC 15 target:Goblin] tags from DM response
export function parseRollRequests(text: string): RollRequest[] {
  const requests: RollRequest[] = [];
  const pattern = /\[ROLL:\s*([^\]]+)\]/gi;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[1].trim();

    const attackMatch = raw.match(
      /attack\s+(d20[+-]\d+)\s+vs\s+AC\s+(\d+)(?:\s+target:(.+))?/i,
    );
    if (attackMatch) {
      requests.push({
        type: "attack",
        dice: attackMatch[1],
        targetAC: parseInt(attackMatch[2]),
        targetName: attackMatch[3]?.trim(),
        label: `Attack roll vs ${attackMatch[3]?.trim() ?? "target"} (AC ${attackMatch[2]})`,
      });
      continue;
    }

    const checkMatch = raw.match(/check\s+(d20[+-]\d+)\s+DC(\d+)\s+(.+)/i);
    if (checkMatch) {
      requests.push({
        type: "check",
        dice: checkMatch[1],
        dc: parseInt(checkMatch[2]),
        label: `${checkMatch[3].trim()} check (DC ${checkMatch[2]})`,
      });
      continue;
    }

    const saveMatch = raw.match(/save\s+(d20[+-]\d+)\s+DC(\d+)\s+(.+)/i);
    if (saveMatch) {
      requests.push({
        type: "save",
        dice: saveMatch[1],
        dc: parseInt(saveMatch[2]),
        label: `${saveMatch[3].trim()} saving throw (DC ${saveMatch[2]})`,
      });
      continue;
    }

    const dmgMatch = raw.match(/damage\s+(d\d+[+-]?\d*)/i);
    if (dmgMatch) {
      requests.push({
        type: "damage",
        dice: dmgMatch[1],
        label: `Damage roll (${dmgMatch[1]})`,
      });
    }
  }

  return requests;
}

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [parsedDM, setParsedDM] = useState<ParsedDMResponse>({
    narrative: "",
    statusItems: [],
    hints: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [awaitingInitiative, setAwaitingInitiative] = useState(false);
  const [pendingRolls, setPendingRolls] = useState<RollRequest[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadMessages = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/messages`);
        if (!res.ok) throw new Error("Failed to load messages");
        const { messages: existing } = await res.json();
        setMessages(
          existing.map(
            (m: {
              id: string;
              role: "user" | "assistant";
              content: string;
            }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              streaming: false,
            }),
          ),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
      }
    };
    loadMessages();
  }, [sessionId]);

  const sendMessage = useCallback(
    async (userInput: string) => {
      if (!userInput.trim() || isStreaming) return;

      setError(null);
      setAwaitingInitiative(false);
      setPendingRolls([]);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: userInput,
      };
      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const history = messages.map(({ role, content }) => ({ role, content }));
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
          body: JSON.stringify({ sessionId, message: userInput, history }),
        });

        if (!res.ok) throw new Error(`Request failed: ${res.statusText}`);
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            try {
              const parsed = JSON.parse(raw);
              if (parsed.error) throw new Error(parsed.error);

              if (parsed.token) {
                fullResponse += parsed.token;
                setParsedDM(parseDMResponsePartial(fullResponse));

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + parsed.token }
                      : m,
                  ),
                );
              }

              if (parsed.done) {
                setParsedDM(parseDMResponse(fullResponse));

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, streaming: false } : m,
                  ),
                );
                if (parsed.awaitingInitiative) {
                  setAwaitingInitiative(true);
                } else {
                  const rolls = parseRollRequests(fullResponse);
                  if (rolls.length > 0) setPendingRolls(rolls);
                }
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId));
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, messages, isStreaming],
  );

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const dismissInitiative = useCallback(() => {
    setAwaitingInitiative(false);
  }, []);

  const dismissRolls = useCallback(() => {
    setPendingRolls([]);
  }, []);

  return {
    messages,
    isLoading,
    isStreaming,
    parsedDM,
    error,
    sendMessage,
    cancelStream,
    clearMessages,
    awaitingInitiative,
    dismissInitiative,
    pendingRolls,
    dismissRolls,
  };
}
