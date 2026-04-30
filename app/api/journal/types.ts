import { z } from "zod";

export type Message = {
  role: string;
  content: string;
};

export type JournalStatus = "paused" | "completed";

export type JournalResponse = {
  journalEntry: string;
  status: JournalStatus;
  timestamp: string;
};

export const messageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export const messagesSchema = z.array(messageSchema);

export const journalRequestSchema = z.object({
  sessionId: z.string(),
  messages: messagesSchema,
  pause: z.boolean().optional(),
});

export const journalResponseSchema = z.object({
  journalEntry: z.string(),
  status: z.enum(["paused", "completed"]),
  timestamp: z.string().datetime(),
});

export type JournalResponseData = z.infer<typeof journalResponseSchema>;
