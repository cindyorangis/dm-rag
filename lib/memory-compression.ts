import {
  createLlmChatCompletion,
  readLlmChatContent,
  type LlmMessage,
  type LlmProvider,
} from "@/lib/llmClient";

const DEFAULT_MIN_MESSAGES = 20;
const DEFAULT_RECENT_MESSAGES = 12;
const DEFAULT_SUMMARY_MAX_CHARS = 2600;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 12000;
const DEFAULT_PER_MESSAGE_MAX_CHARS = 900;

const SUMMARY_SYSTEM_PROMPT = `You maintain a rolling memory for a long-running Dungeons & Dragons session.
Update the memory summary using the new transcript chunk.
Rules:
- Keep only stable facts and durable context.
- Preserve unresolved quests, NPC relationships, inventory/condition changes, and long-term consequences.
- Remove stale or contradicted details.
- Do not include dice arithmetic, output-format instructions, or meta commentary.
- Keep it concise and skimmable with short section headers.
- Never invent facts that are not present in the prior summary or transcript chunk.`;

export interface CompressConversationParams {
  history: LlmMessage[];
  provider: LlmProvider;
  rollingSummary?: string | null;
  summarizedMessageCount?: number | null;
}

export interface CompressConversationResult {
  messagesForModel: LlmMessage[];
  rollingSummary: string | null;
  summarizedMessageCount: number;
  summaryWasUpdated: boolean;
}

export async function compressConversationHistory({
  history,
  provider,
  rollingSummary,
  summarizedMessageCount,
}: CompressConversationParams): Promise<CompressConversationResult> {
  const minMessages = readPositiveIntEnv(
    "MEMORY_COMPRESSION_MIN_MESSAGES",
    DEFAULT_MIN_MESSAGES,
  );
  const recentMessages = readPositiveIntEnv(
    "MEMORY_COMPRESSION_RECENT_MESSAGES",
    DEFAULT_RECENT_MESSAGES,
  );

  const normalizedHistory = normalizeHistory(history);
  const safeSummary = normalizeSummary(rollingSummary);
  const safeCount = clamp(
    Number.isFinite(summarizedMessageCount)
      ? Math.floor(summarizedMessageCount as number)
      : 0,
    0,
    normalizedHistory.length,
  );

  const unsummarizedMessages = normalizedHistory.slice(safeCount);

  if (
    normalizedHistory.length < minMessages ||
    unsummarizedMessages.length <= recentMessages
  ) {
    return {
      messagesForModel: unsummarizedMessages,
      rollingSummary: safeSummary,
      summarizedMessageCount: safeCount,
      summaryWasUpdated: false,
    };
  }

  const nextSummarizedCount = normalizedHistory.length - recentMessages;
  if (nextSummarizedCount <= safeCount) {
    return {
      messagesForModel: unsummarizedMessages,
      rollingSummary: safeSummary,
      summarizedMessageCount: safeCount,
      summaryWasUpdated: false,
    };
  }

  const newlyArchivedMessages = normalizedHistory.slice(
    safeCount,
    nextSummarizedCount,
  );
  if (newlyArchivedMessages.length === 0) {
    return {
      messagesForModel: normalizedHistory.slice(nextSummarizedCount),
      rollingSummary: safeSummary,
      summarizedMessageCount: nextSummarizedCount,
      summaryWasUpdated: false,
    };
  }

  const updatedSummary = await updateRollingSummary({
    provider,
    existingSummary: safeSummary,
    newMessages: newlyArchivedMessages,
  });

  return {
    messagesForModel: normalizedHistory.slice(nextSummarizedCount),
    rollingSummary: updatedSummary,
    summarizedMessageCount: nextSummarizedCount,
    summaryWasUpdated: true,
  };
}

async function updateRollingSummary({
  provider,
  existingSummary,
  newMessages,
}: {
  provider: LlmProvider;
  existingSummary: string | null;
  newMessages: LlmMessage[];
}): Promise<string | null> {
  const transcriptMaxChars = readPositiveIntEnv(
    "MEMORY_SUMMARY_TRANSCRIPT_MAX_CHARS",
    DEFAULT_TRANSCRIPT_MAX_CHARS,
  );
  const summaryMaxChars = readPositiveIntEnv(
    "MEMORY_SUMMARY_MAX_CHARS",
    DEFAULT_SUMMARY_MAX_CHARS,
  );
  const transcript = buildTranscript(newMessages, transcriptMaxChars);

  if (!transcript.trim()) {
    return existingSummary;
  }

  const prompt = [
    "Existing memory summary:",
    existingSummary || "(none)",
    "",
    "New transcript chunk:",
    transcript,
    "",
    `Return the updated memory summary in <= ${summaryMaxChars} characters.`,
  ].join("\n");

  const completion = await createLlmChatCompletion({
    provider,
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = await readLlmChatContent(completion, provider);
  return trimToMaxChars(raw, summaryMaxChars);
}

function normalizeHistory(history: LlmMessage[]): LlmMessage[] {
  return history
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));
}

function normalizeSummary(summary: string | null | undefined): string | null {
  const trimmed = summary?.trim();
  return trimmed ? trimmed : null;
}

function buildTranscript(messages: LlmMessage[], maxChars: number): string {
  const perMessageCap = readPositiveIntEnv(
    "MEMORY_SUMMARY_PER_MESSAGE_MAX_CHARS",
    DEFAULT_PER_MESSAGE_MAX_CHARS,
  );
  const lines: string[] = [];
  let used = 0;

  for (const message of messages) {
    const speaker = message.role === "user" ? "PLAYER" : "DM";
    const sanitized = collapseWhitespace(message.content);
    const clipped =
      sanitized.length > perMessageCap
        ? `${sanitized.slice(0, perMessageCap)}...`
        : sanitized;
    const line = `${speaker}: ${clipped}`;

    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function trimToMaxChars(input: string, maxChars: number): string | null {
  const cleaned = collapseWhitespace(input).trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars - 3).trim()}...`;
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ");
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
