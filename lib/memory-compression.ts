import {
  createLlmChatCompletion,
  readLlmChatContent,
  type LlmMessage,
  type LlmProvider,
} from "@/lib/llmClient";

const DEFAULT_MIN_MESSAGES = 10;
const DEFAULT_RECENT_MESSAGES = 8;
const DEFAULT_SUMMARY_BATCH_SIZE = 4;
const DEFAULT_SUMMARY_MAX_CHARS = 2600;
const DEFAULT_TRANSCRIPT_MAX_CHARS = 12000;
const DEFAULT_PER_MESSAGE_MAX_CHARS = 900;

const SUMMARY_SYSTEM_PROMPT = `You maintain a rolling memory for a long-running Dungeons & Dragons session.
Update both the narrative memory summary and the structured session memory using the new transcript chunk.
Rules:
- Keep only stable facts and durable context.
- Preserve unresolved quests, NPC relationships, inventory/condition changes, and long-term consequences.
- Remove stale or contradicted details.
- Do not include dice arithmetic, output-format instructions, or meta commentary.
- Keep it concise and skimmable with short section headers.
- Never invent facts that are not present in the prior summary/state or transcript chunk.
- Return strict JSON using this shape:
{
  "summary": "string",
  "structured": {
    "active_quests": [{"name":"", "status":"active|completed|failed|paused", "progress":"", "priority":"high|medium|low"}],
    "npc_trust": [{"npc":"", "trust":"ally|friendly|neutral|wary|hostile", "basis":""}],
    "inventory_changes": [{"item":"", "change":"gained|lost|used|damaged", "quantity":"", "note":""}],
    "unresolved_hooks": [{"hook":"", "urgency":"high|medium|low", "note":""}]
  }
}
- Keep each list small (max 6 items).`;

export interface SessionStructuredMemory {
  active_quests: Array<{
    name: string;
    status: "active" | "completed" | "failed" | "paused";
    progress: string;
    priority: "high" | "medium" | "low";
  }>;
  npc_trust: Array<{
    npc: string;
    trust: "ally" | "friendly" | "neutral" | "wary" | "hostile";
    basis: string;
  }>;
  inventory_changes: Array<{
    item: string;
    change: "gained" | "lost" | "used" | "damaged";
    quantity: string;
    note: string;
  }>;
  unresolved_hooks: Array<{
    hook: string;
    urgency: "high" | "medium" | "low";
    note: string;
  }>;
}

export interface CompressConversationParams {
  history: LlmMessage[];
  provider: LlmProvider;
  rollingSummary?: string | null;
  structuredMemory?: SessionStructuredMemory | null;
  summarizedMessageCount?: number | null;
}

export interface CompressConversationResult {
  messagesForModel: LlmMessage[];
  rollingSummary: string | null;
  structuredMemory: SessionStructuredMemory | null;
  summarizedMessageCount: number;
  summaryWasUpdated: boolean;
}

export async function compressConversationHistory({
  history,
  provider,
  rollingSummary,
  structuredMemory,
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
  const summaryBatchSize = readPositiveIntEnv(
    "MEMORY_SUMMARY_BATCH_SIZE",
    DEFAULT_SUMMARY_BATCH_SIZE,
  );

  const normalizedHistory = normalizeHistory(history);
  const safeSummary = normalizeSummary(rollingSummary);
  const safeStructuredMemory = normalizeStructuredMemory(structuredMemory);
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
      structuredMemory: safeStructuredMemory,
      summarizedMessageCount: safeCount,
      summaryWasUpdated: false,
    };
  }

  const maxSummarizedCount = normalizedHistory.length - recentMessages;
  const archivableCount = maxSummarizedCount - safeCount;
  const batchedArchiveCount =
    Math.floor(archivableCount / summaryBatchSize) * summaryBatchSize;
  const nextSummarizedCount = safeCount + batchedArchiveCount;

  if (batchedArchiveCount <= 0) {
    return {
      messagesForModel: unsummarizedMessages,
      rollingSummary: safeSummary,
      structuredMemory: safeStructuredMemory,
      summarizedMessageCount: safeCount,
      summaryWasUpdated: false,
    };
  }

  if (nextSummarizedCount <= safeCount) {
    return {
      messagesForModel: unsummarizedMessages,
      rollingSummary: safeSummary,
      structuredMemory: safeStructuredMemory,
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
      structuredMemory: safeStructuredMemory,
      summarizedMessageCount: nextSummarizedCount,
      summaryWasUpdated: false,
    };
  }

  const updatedMemory = await updateRollingMemory({
    provider,
    existingSummary: safeSummary,
    existingStructuredMemory: safeStructuredMemory,
    newMessages: newlyArchivedMessages,
  });

  return {
    messagesForModel: normalizedHistory.slice(nextSummarizedCount),
    rollingSummary: updatedMemory.rollingSummary,
    structuredMemory: updatedMemory.structuredMemory,
    summarizedMessageCount: nextSummarizedCount,
    summaryWasUpdated: true,
  };
}

async function updateRollingMemory({
  provider,
  existingSummary,
  existingStructuredMemory,
  newMessages,
}: {
  provider: LlmProvider;
  existingSummary: string | null;
  existingStructuredMemory: SessionStructuredMemory | null;
  newMessages: LlmMessage[];
}): Promise<{
  rollingSummary: string | null;
  structuredMemory: SessionStructuredMemory | null;
}> {
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
    return {
      rollingSummary: existingSummary,
      structuredMemory: existingStructuredMemory,
    };
  }

  const existingStructured = JSON.stringify(
    existingStructuredMemory ?? emptyStructuredMemory(),
    null,
    2,
  );
  const prompt = [
    "Existing memory summary:",
    existingSummary || "(none)",
    "",
    "Existing structured memory:",
    existingStructured,
    "",
    "New transcript chunk:",
    transcript,
    "",
    `Keep summary <= ${summaryMaxChars} characters.`,
  ].join("\n");

  const completion = await createLlmChatCompletion({
    provider,
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = await readLlmChatContent(completion, provider);
  const parsed = tryParseMemoryEnvelope(raw);

  if (!parsed) {
    return {
      rollingSummary: trimToMaxChars(raw, summaryMaxChars),
      structuredMemory: existingStructuredMemory,
    };
  }

  return {
    rollingSummary: trimToMaxChars(parsed.summary, summaryMaxChars),
    structuredMemory: normalizeStructuredMemory(parsed.structured),
  };
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

function normalizeStructuredMemory(
  memory: SessionStructuredMemory | null | undefined,
): SessionStructuredMemory | null {
  if (!memory || typeof memory !== "object") return null;

  const normalized: SessionStructuredMemory = {
    active_quests: normalizeActiveQuests(memory.active_quests),
    npc_trust: normalizeNpcTrust(memory.npc_trust),
    inventory_changes: normalizeInventoryChanges(memory.inventory_changes),
    unresolved_hooks: normalizeUnresolvedHooks(memory.unresolved_hooks),
  };

  const hasAny =
    normalized.active_quests.length > 0 ||
    normalized.npc_trust.length > 0 ||
    normalized.inventory_changes.length > 0 ||
    normalized.unresolved_hooks.length > 0;

  return hasAny ? normalized : null;
}

function normalizeActiveQuests(
  quests: SessionStructuredMemory["active_quests"] | unknown,
): SessionStructuredMemory["active_quests"] {
  if (!Array.isArray(quests)) return [];
  const allowedStatus = new Set(["active", "completed", "failed", "paused"]);
  const allowedPriority = new Set(["high", "medium", "low"]);

  return quests
    .map((quest) => {
      if (!quest || typeof quest !== "object") return null;
      const name = cleanText((quest as { name?: unknown }).name, 80);
      const progress = cleanText(
        (quest as { progress?: unknown }).progress,
        160,
      );
      const statusRaw = cleanText(
        (quest as { status?: unknown }).status,
        20,
      ).toLowerCase();
      const priorityRaw = cleanText(
        (quest as { priority?: unknown }).priority,
        20,
      ).toLowerCase();
      const status = allowedStatus.has(statusRaw) ? statusRaw : "active";
      const priority = allowedPriority.has(priorityRaw)
        ? priorityRaw
        : "medium";
      if (!name || !progress) return null;
      return {
        name,
        status,
        progress,
        priority,
      } as SessionStructuredMemory["active_quests"][number];
    })
    .filter(
      (quest): quest is SessionStructuredMemory["active_quests"][number] =>
        Boolean(quest),
    )
    .slice(0, 6);
}

function normalizeNpcTrust(
  npcs: SessionStructuredMemory["npc_trust"] | unknown,
): SessionStructuredMemory["npc_trust"] {
  if (!Array.isArray(npcs)) return [];
  const allowedTrust = new Set([
    "ally",
    "friendly",
    "neutral",
    "wary",
    "hostile",
  ]);

  return npcs
    .map((npcRow) => {
      if (!npcRow || typeof npcRow !== "object") return null;
      const npc = cleanText((npcRow as { npc?: unknown }).npc, 80);
      const basis = cleanText((npcRow as { basis?: unknown }).basis, 160);
      const trustRaw = cleanText(
        (npcRow as { trust?: unknown }).trust,
        20,
      ).toLowerCase();
      const trust = allowedTrust.has(trustRaw) ? trustRaw : "neutral";
      if (!npc || !basis) return null;
      return {
        npc,
        trust,
        basis,
      } as SessionStructuredMemory["npc_trust"][number];
    })
    .filter((npc): npc is SessionStructuredMemory["npc_trust"][number] =>
      Boolean(npc),
    )
    .slice(0, 6);
}

function normalizeInventoryChanges(
  changes: SessionStructuredMemory["inventory_changes"] | unknown,
): SessionStructuredMemory["inventory_changes"] {
  if (!Array.isArray(changes)) return [];
  const allowedChange = new Set(["gained", "lost", "used", "damaged"]);

  return changes
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = cleanText((row as { item?: unknown }).item, 80);
      const quantity = cleanText((row as { quantity?: unknown }).quantity, 40);
      const note = cleanText((row as { note?: unknown }).note, 140);
      const changeRaw = cleanText(
        (row as { change?: unknown }).change,
        20,
      ).toLowerCase();
      const change = allowedChange.has(changeRaw) ? changeRaw : "gained";
      if (!item) return null;
      return {
        item,
        change,
        quantity,
        note,
      } as SessionStructuredMemory["inventory_changes"][number];
    })
    .filter(
      (
        change,
      ): change is SessionStructuredMemory["inventory_changes"][number] =>
        Boolean(change),
    )
    .slice(0, 6);
}

function normalizeUnresolvedHooks(
  hooks: SessionStructuredMemory["unresolved_hooks"] | unknown,
): SessionStructuredMemory["unresolved_hooks"] {
  if (!Array.isArray(hooks)) return [];
  const allowedUrgency = new Set(["high", "medium", "low"]);

  return hooks
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const hook = cleanText((row as { hook?: unknown }).hook, 120);
      const note = cleanText((row as { note?: unknown }).note, 160);
      const urgencyRaw = cleanText(
        (row as { urgency?: unknown }).urgency,
        20,
      ).toLowerCase();
      const urgency = allowedUrgency.has(urgencyRaw) ? urgencyRaw : "medium";
      if (!hook) return null;
      return {
        hook,
        urgency,
        note,
      } as SessionStructuredMemory["unresolved_hooks"][number];
    })
    .filter(
      (hook): hook is SessionStructuredMemory["unresolved_hooks"][number] =>
        Boolean(hook),
    )
    .slice(0, 6);
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const normalized = collapseWhitespace(value).trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function emptyStructuredMemory(): SessionStructuredMemory {
  return {
    active_quests: [],
    npc_trust: [],
    inventory_changes: [],
    unresolved_hooks: [],
  };
}

function tryParseMemoryEnvelope(
  raw: string,
): { summary: string; structured: SessionStructuredMemory | null } | null {
  const normalized = raw.trim();
  if (!normalized.startsWith("{") && !normalized.includes("{")) return null;
  const jsonText = extractJsonObject(normalized);
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText) as {
      summary?: unknown;
      structured?: unknown;
    };
    const summary = cleanText(parsed.summary, 4000);
    if (!summary) return null;
    const structured = normalizeStructuredMemory(
      parsed.structured as SessionStructuredMemory | null,
    );
    return { summary, structured };
  } catch {
    return null;
  }
}

function extractJsonObject(text: string): string | null {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  return text.slice(first, last + 1);
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
