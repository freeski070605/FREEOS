import { config } from "../config";
import type { OllamaStatusResponse } from "../types/api";

interface OllamaTagsPayload {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaGeneratePayload {
  response?: string;
}

export class LocalModelError extends Error {
  constructor(message: string, readonly code: "local_model_timeout" | "local_model_error") {
    super(message);
    this.name = "LocalModelError";
  }
}

export async function isOllamaModelInstalled(model: string): Promise<boolean> {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as OllamaTagsPayload;
    return (payload.models ?? []).some((item) => (item.name ?? item.model) === model);
  } catch {
    return false;
  }
}

export async function generateWithOllama(input: {
  model: string;
  prompt: string;
  system: string;
  timeoutMs?: number;
  format?: "json";
  options?: {
    temperature: number;
    top_p: number;
    repeat_penalty: number;
    num_predict?: number;
  };
}): Promise<string> {
  try {
    // Ollama's JSON mode materially reduces malformed structured output from local
    // models. Existing structured FREEOS planners already say "Return JSON only",
    // so detect that intent centrally instead of making every caller duplicate it.
    const detectedJson = /\breturn\s+json\s+only\b|\bvalid\s+json\s+only\b|\bjson\s+only\b/i.test(input.system);
    const format = input.format ?? (detectedJson ? "json" : undefined);
    const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        system: input.system,
        stream: false,
        think: false,
        ...(format ? { format } : {}),
        options: { temperature: 0.2, top_p: 0.8, repeat_penalty: 1.1, num_predict: 500, ...input.options },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? config.ollamaGenerateTimeoutMs),
    });
    if (!response.ok) throw new LocalModelError(`Local Ollama returned HTTP ${response.status}.`, "local_model_error");
    const payload = (await response.json()) as OllamaGeneratePayload;
    const text = payload.response?.trim() ?? "";
    if (!text) throw new LocalModelError("Local Ollama returned an empty response.", "local_model_error");
    return text;
  } catch (error) {
    if (error instanceof LocalModelError) throw error;
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LocalModelError("Local Ollama generation exceeded the configured timeout.", "local_model_timeout");
    }
    throw new LocalModelError(error instanceof Error ? error.message : "Local Ollama generation failed.", "local_model_error");
  }
}

export async function getOllamaStatus(): Promise<OllamaStatusResponse> {
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000),
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return {
        connected: false,
        models: [],
        message: `Ollama responded with HTTP ${response.status}. Check the local Ollama service.`,
      };
    }

    const payload = (await response.json()) as OllamaTagsPayload;
    const models = (payload.models ?? [])
      .map((model) => model.name ?? model.model)
      .filter((name): name is string => Boolean(name));

    return {
      connected: true,
      models,
      message: models.length > 0 ? "Ollama is connected." : "Ollama is connected; no local models are installed yet.",
    };
  } catch {
    return {
      connected: false,
      models: [],
      message: "Ollama is not reachable. Start Ollama locally, then try again.",
    };
  }
}
