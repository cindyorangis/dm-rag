import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCombatState,
  upsertCombatState,
  deleteCombatState,
} from "./repository";
import { supabaseAdmin } from "@/lib/supabase";

// Mock the entire Supabase client
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => supabaseAdmin),
    select: vi.fn(() => supabaseAdmin),
    eq: vi.fn(() => supabaseAdmin),
    single: vi.fn(() => supabaseAdmin),
    upsert: vi.fn(() => supabaseAdmin),
    delete: vi.fn(() => supabaseAdmin),
  },
}));

describe("Combat Repository", () => {
  const mockSessionId = "test-session-123";
  const mockCombatState = {
    session_id: mockSessionId,
    is_active: true,
    round: 1,
    current_turn_index: 0,
    combatants: [],
    log: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getCombatState", () => {
    it("should return the combat state when a record exists", async () => {
      // Setup the mock chain to return data
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce({
        data: mockCombatState,
        error: null,
      } as any);

      const result = await getCombatState(mockSessionId);

      expect(supabaseAdmin.from).toHaveBeenCalledWith("combat_state");
      expect(supabaseAdmin.eq).toHaveBeenCalledWith(
        "session_id",
        mockSessionId,
      );
      expect(result).toEqual(mockCombatState);
    });

    it("should return null when an error occurs or no data is found", async () => {
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce({
        data: null,
        error: { message: "Not found" },
      } as any);

      const result = await getCombatState(mockSessionId);

      expect(result).toBeNull();
    });
  });

  describe("upsertCombatState", () => {
    it("should call upsert with a new timestamp and return the data", async () => {
      const newState = { ...mockCombatState };
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce({
        data: { ...newState, id: "db-id" },
        error: null,
      } as any);

      const result = await upsertCombatState(newState);

      expect(supabaseAdmin.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: mockSessionId,
          updated_at: expect.any(String),
        }),
        { onConflict: "session_id" },
      );
      expect(result.id).toBe("db-id");
    });

    it("should throw an error if the upsert fails", async () => {
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce({
        data: null,
        error: { message: "DB Error" },
      } as any);

      await expect(upsertCombatState(mockCombatState)).rejects.toThrow(
        "Failed to upsert combat state: DB Error",
      );
    });
  });

  describe("deleteCombatState", () => {
    it("should call delete for the specific session_id", async () => {
      // Mock delete chain (delete returns a builder, so we mock the final resolution)
      vi.mocked(supabaseAdmin.eq).mockResolvedValueOnce({ error: null } as any);

      await deleteCombatState(mockSessionId);

      expect(supabaseAdmin.from).toHaveBeenCalledWith("combat_state");
      expect(supabaseAdmin.delete).toHaveBeenCalled();
      expect(supabaseAdmin.eq).toHaveBeenCalledWith(
        "session_id",
        mockSessionId,
      );
    });
  });
});
