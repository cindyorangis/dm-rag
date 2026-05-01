import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateOpeningMessage,
  createSession,
  getSessionById,
  listSessions,
  getMessagesBySessionId,
} from "./service";
import { supabaseAdmin } from "@/lib/supabase";
import {
  createLlmChatCompletion,
  getLlmProvider,
  readLlmChatContent,
} from "@/lib/llmClient";

// ── Mock Dependencies ─────────────────────────────────────────────────────────

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/llmClient", () => ({
  createLlmChatCompletion: vi.fn(),
  getLlmProvider: vi.fn(() => "ollama"),
  readLlmChatContent: vi.fn(),
}));

vi.mock("@/lib/adventures/config", () => ({
  OPENING_PROMPTS: {
    "lost-mine-of-phandelver": "You are in a tavern in Phandalin.",
  },
}));

// ── Mock Supabase Chain Builder ───────────────────────────────────────────────

const createSupabaseMock = () => {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(),
    // Allow the chain itself to be awaited (for naked inserts without select/single)
    then: vi.fn((resolve: (value: unknown) => void) => resolve({ data: null, error: null })),
  };
  return chain;
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Session Service", () => {
  let mockDb: ReturnType<typeof createSupabaseMock>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createSupabaseMock();
    // Use `unknown` then `ReturnType` to bypass the `any` requirement safely
    vi.mocked(supabaseAdmin.from).mockReturnValue(mockDb as unknown as ReturnType<typeof supabaseAdmin.from>);
  });

  describe("generateOpeningMessage", () => {
    it("generates an opening message without character context", async () => {
      vi.mocked(readLlmChatContent).mockResolvedValue("Welcome to Phandalin!");

      const result = await generateOpeningMessage("lost-mine-of-phandelver");

      expect(getLlmProvider).toHaveBeenCalled();
      expect(createLlmChatCompletion).toHaveBeenCalledWith({
        provider: "ollama",
        systemPrompt: "You are in a tavern in Phandalin.",
        messages: [{ role: "user", content: "Begin the adventure." }],
      });
      expect(result).toBe("Welcome to Phandalin!");
    });

    it("generates an opening message with character context", async () => {
      vi.mocked(readLlmChatContent).mockResolvedValue(
        "Welcome, brave fighter!",
      );

      const result = await generateOpeningMessage(
        "lost-mine-of-phandelver",
        "Level 1 Human Fighter",
      );

      expect(createLlmChatCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: "user",
              content:
                "My character: Level 1 Human Fighter\n\nBegin the adventure.",
            },
          ],
        }),
      );
      expect(result).toBe("Welcome, brave fighter!");
    });
  });

  describe("createSession", () => {
    it("creates a session, generates narration, and persists the message", async () => {
      // Mock session insertion
      mockDb.single.mockResolvedValueOnce({
        data: { id: "session-123" },
        error: null,
      });

      // Mock message insertion (naked await)
      mockDb.then.mockImplementationOnce((resolve: (value: unknown) => void) =>
        resolve({ data: null, error: null }),
      );

      // Mock LLM
      vi.mocked(readLlmChatContent).mockResolvedValue("A goblin attacks!");

      const result = await createSession("lost-mine-of-phandelver", "Fighter");

      // Verify Session Insert
      expect(supabaseAdmin.from).toHaveBeenCalledWith("sessions");
      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          adventure_slug: "lost-mine-of-phandelver",
          character_context: "Fighter",
        }),
      );

      // Verify Message Insert
      expect(supabaseAdmin.from).toHaveBeenCalledWith("messages");
      expect(mockDb.insert).toHaveBeenCalledWith({
        session_id: "session-123",
        role: "assistant",
        content: "A goblin attacks!",
      });

      expect(result.sessionId).toBe("session-123");
    });

    it("throws an error if session creation fails", async () => {
      mockDb.single.mockResolvedValueOnce({
        data: null,
        error: { message: "Database failure" },
      });

      await expect(createSession("lost-mine-of-phandelver")).rejects.toThrow(
        "Database failure",
      );
    });

    it("throws an error if message insertion fails", async () => {
      mockDb.single.mockResolvedValueOnce({
        data: { id: "session-123" },
        error: null,
      });

      mockDb.then.mockImplementationOnce((resolve: (value: unknown) => void) =>
        resolve({ error: { message: "Failed to save message" } }),
      );

      vi.mocked(readLlmChatContent).mockResolvedValue("Narration");

      await expect(createSession("lost-mine-of-phandelver")).rejects.toThrow(
        "Failed to save message",
      );
    });
  });

  describe("getSessionById", () => {
    it("returns session details when found", async () => {
      const mockSession = { id: "123", title: "Test Session" };
      mockDb.single.mockResolvedValueOnce({ data: mockSession, error: null });

      const result = await getSessionById("123");

      expect(supabaseAdmin.from).toHaveBeenCalledWith("sessions");
      expect(mockDb.eq).toHaveBeenCalledWith("id", "123");
      expect(result).toEqual(mockSession);
    });

    it("returns null if session is not found (PGRST116)", async () => {
      mockDb.single.mockResolvedValueOnce({
        data: null,
        error: { code: "PGRST116", message: "Not found" },
      });

      const result = await getSessionById("123");
      expect(result).toBeNull();
    });

    it("throws an error for other database errors", async () => {
      mockDb.single.mockResolvedValueOnce({
        data: null,
        error: { code: "500", message: "Server timeout" },
      });

      await expect(getSessionById("123")).rejects.toThrow("Server timeout");
    });
  });

  describe("listSessions", () => {
    it("returns a list of sessions", async () => {
      const mockSessions = [{ id: "1" }, { id: "2" }];
      mockDb.order.mockResolvedValueOnce({ data: mockSessions, error: null });

      const result = await listSessions();

      expect(supabaseAdmin.from).toHaveBeenCalledWith("sessions");
      expect(mockDb.order).toHaveBeenCalledWith("created_at", {
        ascending: false,
      });
      expect(result).toEqual(mockSessions);
    });

    it("throws an error if the query fails", async () => {
      mockDb.order.mockResolvedValueOnce({
        data: null,
        error: { message: "Query failed" },
      });

      await expect(listSessions()).rejects.toThrow("Query failed");
    });
  });

  describe("getMessagesBySessionId", () => {
    it("returns messages for a session ordered by creation date", async () => {
      const mockMessages = [
        { role: "assistant", content: "Hi" },
        { role: "user", content: "Hello" },
      ];
      mockDb.order.mockResolvedValueOnce({ data: mockMessages, error: null });

      const result = await getMessagesBySessionId("session-123");

      expect(supabaseAdmin.from).toHaveBeenCalledWith("messages");
      expect(mockDb.eq).toHaveBeenCalledWith("session_id", "session-123");
      expect(mockDb.order).toHaveBeenCalledWith("created_at", {
        ascending: true,
      });
      expect(result).toEqual(mockMessages);
    });

    it("throws an error if the query fails", async () => {
      mockDb.order.mockResolvedValueOnce({
        data: null,
        error: { message: "Message fetch failed" },
      });

      await expect(getMessagesBySessionId("session-123")).rejects.toThrow(
        "Message fetch failed",
      );
    });
  });
});