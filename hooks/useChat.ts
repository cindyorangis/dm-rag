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

type HistoryItem = {
  role: "user" | "assistant";
  content: string;
};

type QueuedInput = {
  id: string;
  content: string;
};

type FailedTurn = {
  input: string;
  baseHistory: HistoryItem[];
  recoveryMessageId: string;
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
  const [queuedInputs, setQueuedInputs] = useState<QueuedInput[]>([]);
  const [failedTurn, setFailedTurn] = useState<FailedTurn | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HistoryItem[]>([]);
  const queuedInputsRef = useRef<QueuedInput[]>([]);

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

  useEffect(() => {
    messagesRef.current = messages.map(({ role, content }) => ({
      role,
      content,
    }));
  }, [messages]);

  const buildRecoveryMessage = useCallback(
    (queuedCount: number) =>
      `The DM is recovering from a rules-engine interruption. Your action is safely queued, and the scene state is preserved.

[STATUS]
* The DM connection paused before resolving the turn.
* Your action is queued for retry without losing continuity.
* Use "Retry Turn" to continue exactly from this moment.
[/STATUS]

[HINTS]
[action] Retry turn | I retry my last action and continue from the exact same turn state.
[explore] Rephrase action | I restate my action more clearly in case that helps the DM recover.
[social] Ask for quick recap | I ask for a quick recap of the immediate situation before proceeding.
[lore] Proceed cautiously | I continue with a conservative action while the DM stabilizes.
[/HINTS]

${queuedCount > 0 ? `Queued actions waiting: ${queuedCount}` : ""}`.trim(),
    [],
  );

  const runTurn = useCallback(
    async ({
      userInput,
      baseHistory,
      addUserMessage,
      removeRecoveryMessageId,
    }: {
      userInput: string;
      baseHistory: HistoryItem[];
      addUserMessage: boolean;
      removeRecoveryMessageId?: string;
    }): Promise<{ ok: boolean; aborted?: boolean }> => {
      setError(null);
      setAwaitingInitiative(false);
      setPendingRolls([]);

      const userMsg: Message | null = addUserMessage
        ? {
            id: crypto.randomUUID(),
            role: "user",
            content: userInput,
          }
        : null;

      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        streaming: true,
      };

      setMessages((prev) => {
        let next = prev;
        if (removeRecoveryMessageId) {
          next = next.filter((m) => m.id !== removeRecoveryMessageId);
        }
        if (userMsg) next = [...next, userMsg];
        return [...next, assistantMsg];
      });
      setIsStreaming(true);
      abortRef.current = new AbortController();

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            sessionId,
            message: userInput,
            history: baseHistory,
          }),
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

        setFailedTurn(null);
        return { ok: true };
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return { ok: false, aborted: true };
        }

        const msg = err instanceof Error ? err.message : "Something went wrong";
        const recoveryMessageId = crypto.randomUUID();
        setError(msg);
        setFailedTurn({
          input: userInput,
          baseHistory,
          recoveryMessageId,
        });
        setMessages((prev) => {
          const withoutStreaming = prev.filter((m) => m.id !== assistantMsgId);
          const recoveryMessage: Message = {
            id: recoveryMessageId,
            role: "assistant",
            content: buildRecoveryMessage(queuedInputs.length + 1),
          };
          return [...withoutStreaming, recoveryMessage];
        });

        return { ok: false };
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, buildRecoveryMessage, queuedInputs.length],
  );

  const processNextQueuedInput = useCallback(async () => {
    if (isStreaming || failedTurn) return;

    // 1. Read synchronously from the ref instead of state
    const queue = queuedInputsRef.current;
    if (queue.length === 0) return;

    // 2. Extract the item
    const next = queue[0];

    // 3. Update both the ref and the state synchronously
    queuedInputsRef.current = queue.slice(1);
    setQueuedInputs(queuedInputsRef.current);

    // 4. Run the turn (TypeScript now knows 'next' is a QueuedInput)
    const result = await runTurn({
      userInput: next.content,
      baseHistory: messagesRef.current,
      addUserMessage: true,
    });

    if (result.ok) {
      void processNextQueuedInput();
    }
  }, [isStreaming, failedTurn, runTurn]);

  const sendMessage = useCallback(
    async (userInput: string) => {
      const trimmed = userInput.trim();
      if (!trimmed) return;

      if (isStreaming || failedTurn) {
        setQueuedInputs((prev) => {
          const nextQueue = [
            ...prev,
            { id: crypto.randomUUID(), content: trimmed },
          ];
          queuedInputsRef.current = nextQueue; // Sync ref
          return nextQueue; // Update state for UI
        });
        return;
      }

      const baseHistory = messages.map(({ role, content }) => ({
        role,
        content,
      })) as HistoryItem[];

      const result = await runTurn({
        userInput: trimmed,
        baseHistory,
        addUserMessage: true,
      });
      if (result.ok) {
        void processNextQueuedInput();
      }
    },
    [isStreaming, failedTurn, messages, runTurn, processNextQueuedInput],
  );

  const retryLastTurn = useCallback(async () => {
    if (!failedTurn || isStreaming) return;

    const result = await runTurn({
      userInput: failedTurn.input,
      baseHistory: failedTurn.baseHistory,
      addUserMessage: false,
      removeRecoveryMessageId: failedTurn.recoveryMessageId,
    });
    if (result.ok) {
      void processNextQueuedInput();
    }
  }, [failedTurn, isStreaming, runTurn, processNextQueuedInput]);

  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setQueuedInputs([]);
    setFailedTurn(null);
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
    retryLastTurn,
    canRetryLastTurn: Boolean(failedTurn) && !isStreaming,
    queuedInputCount: queuedInputs.length + (failedTurn ? 1 : 0),
    isRecovering: Boolean(failedTurn),
    cancelStream,
    clearMessages,
    awaitingInitiative,
    dismissInitiative,
    pendingRolls,
    dismissRolls,
  };
}
