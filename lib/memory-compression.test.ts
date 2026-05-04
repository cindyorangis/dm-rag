import { beforeEach, describe, expect, it, vi } from "vitest";
import { compressConversationHistory } from "./memory-compression";
import type { LlmMessage } from "./llmClient";
import { createLlmChatCompletion, readLlmChatContent } from "./llmClient";

vi.mock("./llmClient", () => ({
  createLlmChatCompletion: vi.fn(),
  readLlmChatContent: vi.fn(),
}));

function makeHistory(count: number): LlmMessage[] {
  const messages: LlmMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message-${i}`,
    });
  }
  return messages;
}

describe("compressConversationHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MEMORY_COMPRESSION_MIN_MESSAGES;
    delete process.env.MEMORY_COMPRESSION_RECENT_MESSAGES;
    delete process.env.MEMORY_SUMMARY_BATCH_SIZE;
  });

  it("keeps unsummarized history untouched when below compression threshold", async () => {
    const history = makeHistory(6);

    const result = await compressConversationHistory({
      history,
      provider: "ollama",
      rollingSummary: null,
      summarizedMessageCount: 0,
    });

    expect(result.summaryWasUpdated).toBe(false);
    expect(result.messagesForModel).toEqual(history);
    expect(result.summarizedMessageCount).toBe(0);
    expect(createLlmChatCompletion).not.toHaveBeenCalled();
  });

  it("summarizes newly archivable messages and keeps a recent tail", async () => {
    process.env.MEMORY_COMPRESSION_MIN_MESSAGES = "4";
    process.env.MEMORY_COMPRESSION_RECENT_MESSAGES = "2";
    process.env.MEMORY_SUMMARY_BATCH_SIZE = "1";
    const history = makeHistory(8);

    vi.mocked(readLlmChatContent).mockResolvedValue("Updated memory summary");

    const result = await compressConversationHistory({
      history,
      provider: "groq",
      rollingSummary: "Old summary",
      summarizedMessageCount: 0,
    });

    expect(result.summaryWasUpdated).toBe(true);
    expect(result.rollingSummary).toBe("Updated memory summary");
    expect(result.summarizedMessageCount).toBe(6);
    expect(result.messagesForModel).toEqual(history.slice(6));
    expect(createLlmChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "groq",
        messages: [
          expect.objectContaining({
            role: "user",
          }),
        ],
      }),
    );
  });

  it("only summarizes the delta after a previous compression", async () => {
    process.env.MEMORY_COMPRESSION_MIN_MESSAGES = "4";
    process.env.MEMORY_COMPRESSION_RECENT_MESSAGES = "2";
    process.env.MEMORY_SUMMARY_BATCH_SIZE = "1";
    const history = makeHistory(10);

    vi.mocked(readLlmChatContent).mockResolvedValue("Delta summary");

    const result = await compressConversationHistory({
      history,
      provider: "ollama",
      rollingSummary: "Existing memory",
      summarizedMessageCount: 6,
    });

    expect(result.summaryWasUpdated).toBe(true);
    expect(result.summarizedMessageCount).toBe(8);
    expect(result.messagesForModel).toEqual(history.slice(8));

    const firstPromptArg = vi.mocked(createLlmChatCompletion).mock
      .calls[0]?.[0];
    const prompt = firstPromptArg?.messages?.[0]?.content ?? "";
    expect(prompt).toContain("message-6");
    expect(prompt).toContain("message-7");
    expect(prompt).not.toContain("message-2");
  });

  it("defers summary updates until batch size is reached", async () => {
    process.env.MEMORY_COMPRESSION_MIN_MESSAGES = "4";
    process.env.MEMORY_COMPRESSION_RECENT_MESSAGES = "2";
    process.env.MEMORY_SUMMARY_BATCH_SIZE = "4";
    const history = makeHistory(10);

    const result = await compressConversationHistory({
      history,
      provider: "ollama",
      rollingSummary: "Existing memory",
      summarizedMessageCount: 6,
    });

    expect(result.summaryWasUpdated).toBe(false);
    expect(result.summarizedMessageCount).toBe(6);
    expect(result.messagesForModel).toEqual(history.slice(6));
    expect(createLlmChatCompletion).not.toHaveBeenCalled();
  });
});
