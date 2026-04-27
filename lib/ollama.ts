import { getLlmBaseUrl, getLlmChatModel, readLlmError } from "@/lib/llmClient";

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
  return getLlmBaseUrl("ollama");
}

export function getOllamaChatModel() {
  return getLlmChatModel("ollama");
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
  return readLlmError(res, "ollama");
}
