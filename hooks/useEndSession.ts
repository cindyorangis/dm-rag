"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Message } from "@/hooks/useChat";

interface UseEndSessionReturn {
  isEndingSession: boolean;
  endSession: () => Promise<void>;
}

export function useEndSession(
  sessionId: string,
  messages: Message[],
  isStreaming: boolean,
): UseEndSessionReturn {
  const router = useRouter();
  const [isEndingSession, setIsEndingSession] = useState(false);

  const endSession = useCallback(async () => {
    if (isStreaming || isEndingSession || messages.length === 0) return;
    setIsEndingSession(true);
    try {
      await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages }),
      });
      router.push(`/journal/${sessionId}`);
    } catch {
      setIsEndingSession(false);
    }
  }, [isStreaming, isEndingSession, messages, sessionId, router]);

  return { isEndingSession, endSession };
}
