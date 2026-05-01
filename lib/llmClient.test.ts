import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getLlmProvider,
  getLlmChatModel,
  createLlmChatCompletion,
  readLlmChatContent,
  parseLlmStreamChunk,
} from "./llmClient";

describe("LLM Client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    // Set some defaults to prevent undefined errors
    process.env.GROQ_API_KEY = "test-key";
    global.fetch = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Configuration Helpers", () => {
    it("returns explicit provider from env", () => {
      process.env.LLM_PROVIDER = "groq";
      expect(getLlmProvider()).toBe("groq");
    });

    it("defaults to ollama in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("LLM_PROVIDER", "");

      expect(getLlmProvider()).toBe("ollama");
    });

    it("defaults to groq in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("LLM_PROVIDER", "");

      expect(getLlmProvider()).toBe("groq");
    });

    it("gets the correct model for each provider", () => {
      process.env.OLLAMA_CHAT_MODEL = "llama3-test";
      process.env.GROQ_CHAT_MODEL = "groq-test";

      expect(getLlmChatModel("ollama")).toBe("llama3-test");
      expect(getLlmChatModel("groq")).toBe("groq-test");
    });
  });

  describe("createLlmChatCompletion", () => {
    it("calls Groq with correct headers and body", async () => {
      await createLlmChatCompletion({
        provider: "groq",
        systemPrompt: "You are a DM",
        messages: [{ role: "user", content: "Hello" }],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("api.groq.com"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
          }),
          body: expect.stringContaining('"stream":false'),
        }),
      );
    });

    it("throws if Groq API key is missing", async () => {
      delete process.env.GROQ_API_KEY;
      await expect(
        createLlmChatCompletion({ provider: "groq", messages: [] }),
      ).rejects.toThrow("Missing GROQ_API_KEY");
    });
  });

  describe("readLlmChatContent", () => {
    it("extracts content from a successful Groq response", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Groq Response" } }],
        }),
      } as Response;

      const content = await readLlmChatContent(mockResponse, "groq");
      expect(content).toBe("Groq Response");
    });

    it("extracts content from a successful Ollama response", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          message: { content: "Ollama Response" },
        }),
      } as Response;

      const content = await readLlmChatContent(mockResponse, "ollama");
      expect(content).toBe("Ollama Response");
    });

    it("throws an error if response is empty", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ choices: [] }),
      } as Response;

      await expect(readLlmChatContent(mockResponse, "groq")).rejects.toThrow();
    });
  });

  describe("Stream Chunk Parsing", () => {
    it("parses multiple tokens from a single Groq SSE chunk", () => {
      const rawChunk = `
        data: {"choices": [{"delta": {"content": "Hello"}}]}
        data: {"choices": [{"delta": {"content": " World"}}]}
      `;
      const result = parseLlmStreamChunk(rawChunk, "groq");
      expect(result.tokens).toEqual(["Hello", " World"]);
      expect(result.done).toBe(false);
    });

    it("detects done state in Groq stream", () => {
      const rawChunk = `data: [DONE]`;
      const result = parseLlmStreamChunk(rawChunk, "groq");
      expect(result.done).toBe(true);
    });

    it("parses Ollama NDJSON chunks", () => {
      const rawChunk = `{"message": {"content": "Ollama"}}\n{"done": true}`;
      const result = parseLlmStreamChunk(rawChunk, "ollama");
      expect(result.tokens).toEqual(["Ollama"]);
      expect(result.done).toBe(true);
    });

    it("returns error if found in chunk", () => {
      const rawChunk = `{"error": "Too busy"}`;
      const result = parseLlmStreamChunk(rawChunk, "ollama");
      expect(result.error).toBe("Too busy");
    });
  });
});
