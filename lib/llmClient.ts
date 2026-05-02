export type LlmProvider = "ollama" | "groq";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type GroqErrorResponse = {
  error?: {
    message?: string;
  };
};

type OllamaErrorResponse = {
  error?: string;
};

type GroqChatCompletionResponse = {
  error?: {
    message?: string;
  };
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type OllamaChatResponse = {
  error?: string;
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
  content?: string;
};

const DEFAULT_OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.1:8b";
const DEFAULT_GROQ_BASE_URL =
  process.env.GROQ_BASE_URL || "https://api.groq.com/v1";
const DEFAULT_GROQ_MODEL = "llama-3.1-8k-instant";

export function getLlmProvider(): LlmProvider {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "ollama" || explicit === "groq") {
    return explicit;
  }

  return process.env.NODE_ENV === "production" ? "groq" : "ollama";
}

export function getLlmChatModel(provider = getLlmProvider()): string {
  if (provider === "groq") {
    return (
      process.env.GROQ_CHAT_MODEL ||
      process.env.GROQ_MODEL ||
      DEFAULT_GROQ_MODEL
    );
  }

  return process.env.OLLAMA_CHAT_MODEL || DEFAULT_OLLAMA_MODEL;
}

export function getLlmBaseUrl(provider = getLlmProvider()): string {
  if (provider === "groq") {
    return process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL;
  }

  return process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
}

export async function createLlmChatStream(params: {
  systemPrompt: string;
  messages: LlmMessage[];
  provider?: LlmProvider;
  model?: string;
}) {
  const provider = params.provider ?? getLlmProvider();
  const model = params.model ?? getLlmChatModel(provider);
  const baseUrl = getLlmBaseUrl(provider);
  const allMessages: LlmMessage[] = [
    { role: "system", content: params.systemPrompt },
    ...params.messages,
  ];

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GROQ_API_KEY");
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        stream: true,
      }),
    });
  }

  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: allMessages,
      stream: true,
    }),
  });
}

export async function createLlmChatCompletion(params: {
  systemPrompt?: string;
  messages: LlmMessage[];
  provider?: LlmProvider;
  model?: string;
}) {
  const provider = params.provider ?? getLlmProvider();
  const model = params.model ?? getLlmChatModel(provider);
  const baseUrl = getLlmBaseUrl(provider);
  const allMessages: LlmMessage[] = params.systemPrompt
    ? [{ role: "system", content: params.systemPrompt }, ...params.messages]
    : params.messages;

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GROQ_API_KEY");
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: allMessages,
        stream: false,
      }),
    });
  }

  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: allMessages,
      stream: false,
    }),
  });
}

export async function readLlmError(
  response: Response,
  provider = getLlmProvider(),
): Promise<string> {
  try {
    if (provider === "groq") {
      const data = (await response.json()) as GroqErrorResponse;
      return (
        data.error?.message ||
        `Groq request failed with status ${response.status}`
      );
    }

    const data = (await response.json()) as OllamaErrorResponse;
    return data.error || `Ollama request failed with status ${response.status}`;
  } catch {
    return `${provider} request failed with status ${response.status}`;
  }
}

export async function readLlmChatContent(
  response: Response,
  provider = getLlmProvider(),
): Promise<string> {
  if (provider === "groq") {
    const data = (await response.json()) as GroqChatCompletionResponse;

    if (!response.ok) {
      throw new Error(
        data.error?.message ||
          `Groq request failed with status ${response.status}`,
      );
    }

    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) {
      throw new Error("Groq returned an empty chat response.");
    }

    return content;
  }

  const data = (await response.json()) as OllamaChatResponse;

  if (!response.ok) {
    throw new Error(
      data.error || `Ollama request failed with status ${response.status}`,
    );
  }

  if (data.error) {
    throw new Error(data.error);
  }

  const content = data.message?.content ?? data.response ?? data.content ?? "";
  if (!content.trim()) {
    throw new Error(
      `Ollama returned an empty chat response. Keys: ${Object.keys(data).join(", ") || "none"}`,
    );
  }

  return content;
}

export function parseLlmStreamChunk(
  rawChunk: string,
  provider = getLlmProvider(),
): { tokens: string[]; done: boolean; error?: string } {
  return provider === "groq"
    ? parseGroqStreamChunk(rawChunk)
    : parseOllamaStreamChunk(rawChunk);
}

function parseGroqStreamChunk(rawChunk: string): {
  tokens: string[];
  done: boolean;
  error?: string;
} {
  const tokens: string[] = [];
  let done = false;
  let error: string | undefined;

  const lines = rawChunk.split("\n").map((line) => line.trim());
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }

    const payload = line.slice(5).trim();
    if (!payload) {
      continue;
    }

    if (payload === "[DONE]") {
      done = true;
      continue;
    }

    try {
      const json = JSON.parse(payload) as {
        error?: { message?: string };
        choices?: Array<{
          delta?: { content?: string };
          finish_reason?: string | null;
        }>;
      };

      if (json.error?.message) {
        error = json.error.message;
        break;
      }

      const token = json.choices?.[0]?.delta?.content ?? "";
      if (token) {
        tokens.push(token);
      }

      if (json.choices?.[0]?.finish_reason) {
        done = true;
      }
    } catch {
      // Ignore incomplete JSON fragments.
    }
  }

  return { tokens, done, error };
}

function parseOllamaStreamChunk(rawChunk: string): {
  tokens: string[];
  done: boolean;
  error?: string;
} {
  const tokens: string[] = [];
  let done = false;
  let error: string | undefined;

  const lines = rawChunk.split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const json = JSON.parse(line) as {
        error?: string;
        done?: boolean;
        message?: { content?: string };
        response?: string;
      };

      if (json.error) {
        error = json.error;
        break;
      }

      const token = json.message?.content ?? json.response ?? "";
      if (token) {
        tokens.push(token);
      }

      if (json.done) {
        done = true;
      }
    } catch {
      // Ignore incomplete JSON fragments.
    }
  }

  return { tokens, done, error };
}
