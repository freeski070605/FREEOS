import { config } from "../config";
import type { OllamaStatusResponse } from "../types/api";

interface OllamaTagsPayload {
  models?: Array<{ name?: string; model?: string }>;
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

