import { describe, it, expect, vi, beforeEach } from "vitest";
import { PostgrestResponse } from "@supabase/supabase-js";
import {
  getCombatState,
  upsertCombatState,
  deleteCombatState,
} from "./repository";
import { supabaseAdmin } from "@/lib/supabase";

// 1. Define a clean helper that avoids 'any' entirely
// Using 'unknown' tells TS we don't care about the specific data shape here
function mockSupabaseReturn<T>(data: T | null, error: string | null = null) {
  return {
    data,
    error: error ? { message: error } : null,
    count: null,
    status: error ? 400 : 200,
    statusText: error ? "Error" : "OK",
  } as unknown as PostgrestResponse<T>;
}

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
      // Use the helper - no 'any' needed!
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce(
        mockSupabaseReturn(mockCombatState),
      );

      const result = await getCombatState(mockSessionId);

      expect(supabaseAdmin.from).toHaveBeenCalledWith("combat_state");
      expect(result).toEqual(mockCombatState);
    });

    it("should return null when an error occurs", async () => {
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce(
        mockSupabaseReturn(null, "Not found"),
      );

      const result = await getCombatState(mockSessionId);
      expect(result).toBeNull();
    });
  });

  describe("upsertCombatState", () => {
    it("should call upsert and return data", async () => {
      const newState = { ...mockCombatState };
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce(
        mockSupabaseReturn({ ...newState, id: "db-id" }),
      );

      const result = await upsertCombatState(newState);
      expect(result.id).toBe("db-id");
    });

    it("should throw on failure", async () => {
      vi.mocked(supabaseAdmin.single).mockResolvedValueOnce(
        mockSupabaseReturn(null, "DB Error"),
      );

      await expect(upsertCombatState(mockCombatState)).rejects.toThrow(
        "Failed to upsert combat state: DB Error",
      );
    });
  });

  describe("deleteCombatState", () => {
    it("should call delete", async () => {
      // For chainable methods like .eq(), we mock the final promise resolution
      vi.mocked(supabaseAdmin.eq).mockResolvedValueOnce(
        mockSupabaseReturn(null),
      );

      await deleteCombatState(mockSessionId);
      expect(supabaseAdmin.delete).toHaveBeenCalled();
    });
  });
});
