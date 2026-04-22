"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
};

export function useChat(sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingInitiative, setAwaitingInitiative] = useState(false);
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
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + parsed.token }
                      : m,
                  ),
                );
              }

              if (parsed.done) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, streaming: false } : m,
                  ),
                );
                // Surface the initiative flag from the backend
                if (parsed.awaitingInitiative) {
                  setAwaitingInitiative(true);
                }
              }
            } catch (parseErr) {
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

  return {
    messages,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    cancelStream,
    clearMessages,
    awaitingInitiative,
    dismissInitiative,
  };
}
