const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3";

type OllamaChatResponse = {
  error?: string;
  message?: {
    role?: string;
    content?: string;
  };
  response?: string;
  content?: string;
};

export function getOllamaBaseUrl() {
  return OLLAMA_BASE_URL;
}

export function getOllamaChatModel() {
  return OLLAMA_CHAT_MODEL;
}

export async function readOllamaChatContent(res: Response): Promise<string> {
  const data = (await res.json()) as OllamaChatResponse;

  if (!res.ok) {
    throw new Error(
      data.error || `Ollama request failed with status ${res.status}`,
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

export async function readOllamaError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as OllamaChatResponse;
    return data.error || `Ollama request failed with status ${res.status}`;
  } catch {
    return `Ollama request failed with status ${res.status}`;
  }
}
