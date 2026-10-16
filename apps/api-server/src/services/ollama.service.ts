import { Agent, fetch as undiciFetch } from "undici";
import { config } from "../config";
import type { OllamaStatusResponse } from "../types/api";

interface OllamaTagsPayload {
  models?: Array<{ name?: string; model?: string }>;
}

interface OllamaGeneratePayload {
  response?: string;
}

type OllamaStructuredFormat = "json" | Record<string, unknown>;

const ollamaLongRequestDispatcher = new Agent({
  headersTimeout: 900_000,
  bodyTimeout: 900_000,
});
function normalizeOllamaOutput(text: string, heavyModel: boolean): string {
  const trimmed = text.trim();

  if (!heavyModel) return trimmed;

  const finalMatch = trimmed.match(
    /<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|return\|>|<\|end\|>|$)/
  );

  if (finalMatch?.[1]) {
    return finalMatch[1].trim();
  }

  return trimmed;
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
  format?: OllamaStructuredFormat;
  think?: boolean;
  options?: {
    temperature: number;
    top_p: number;
    repeat_penalty: number;
    num_predict?: number;
  };
}): Promise<string> {
  try {
    const isHeavyModel = input.model === config.heavyModel;
    const effectiveThink = input.think ?? isHeavyModel;
    const requestedTimeoutMs = input.timeoutMs ?? config.ollamaGenerateTimeoutMs;
    const effectiveTimeoutMs = isHeavyModel
      ? Math.max(requestedTimeoutMs, config.heavyTimeoutMs)
      : requestedTimeoutMs;

    const detectedJson = /\breturn\s+json\s+only\b|\bvalid\s+json\s+only\b|\bjson\s+only\b/i.test(input.system);
    const format: OllamaStructuredFormat | undefined = input.format ?? (detectedJson ? "json" : undefined);

    /*
     * GPT-OSS is trained for the Harmony chat/message interface.
     * Keep Qwen on /api/generate, but send the heavy model through
     * Ollama's /api/chat endpoint so system/user roles and thinking
     * are represented correctly.
     */
    if (isHeavyModel) {
      const chatStartedAt = Date.now();

      /*
       * GPT-OSS HEAVY MODEL POLICY
       *
       * Real FREEOS editing-planner requests have reached ~13.3K prompt
       * tokens before the model generates anything.
       *
       * A 16K context leaves too little room for GPT-OSS reasoning plus
       * schema-valid JSON output, so the heavy model gets a dedicated
       * 32K context.
       */
      const heavyContextSize = 32_768;

      const isStructured = Boolean(format);

      /*
       * Structured stages need enough room for BOTH GPT-OSS reasoning
       * tokens and the final machine-readable response.
       *
       * Never allow a structured planner call to run with the old
       * 1800/2400-style generation ceiling.
       */
      const requestedNumPredict =
        typeof input.options?.num_predict === "number" &&
        Number.isFinite(input.options.num_predict)
          ? Math.max(1, Math.floor(input.options.num_predict))
          : 500;

      const effectiveNumPredict = isStructured
        ? Math.max(requestedNumPredict, 8_000)
        : requestedNumPredict;

      /*
       * GPT-OSS supports configurable reasoning effort.
       *
       * Structured editing-planner stages need concise reasoning because
       * the final JSON is the deliverable. Put the instruction in the
       * Harmony system message itself in addition to Ollama's think field.
       */
      const effectiveSystem = isStructured
        ? `Reasoning: low

${input.system}

IMPORTANT GPT-OSS EXECUTION RULE:
Use low reasoning effort. Preserve the majority of the generation budget
for the complete final structured answer. Do not spend the entire response
budget reasoning before producing message.content.`
        : input.system;

      const chatResponse = await undiciFetch(
        `${config.ollamaBaseUrl}/api/chat`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },

          body: JSON.stringify({
            model: input.model,

            messages: [
              {
                role: "system",
                content: effectiveSystem,
              },
              {
                role: "user",
                content: input.prompt,
              },
            ],

            stream: false,

            /*
             * GPT-OSS structured calls use low reasoning.
             * Ordinary FREEOS heavy chat keeps the caller's normal setting.
             */
            think: isStructured
              ? "low"
              : effectiveThink,

            ...(format ? { format } : {}),

            /*
             * Avoid repeatedly reloading the ~12GB model.
             */
            keep_alive: "30m",

            options: {
              /*
               * Defaults.
               */
              temperature: 0.2,
              top_p: 0.8,
              repeat_penalty: 1.1,

              /*
               * Preserve caller-specific sampling values.
               */
              ...input.options,

              /*
               * Heavy-model safety limits are deliberately written AFTER
               * caller options so old planner values cannot shrink them.
               */
              num_ctx: heavyContextSize,
              num_predict: effectiveNumPredict,
            },
          }),

          dispatcher: ollamaLongRequestDispatcher,
          signal: AbortSignal.timeout(effectiveTimeoutMs),
        }
      );

      /*
       * Surface the REAL Ollama failure instead of hiding it behind
       * "HTTP 400/500".
       */
      if (!chatResponse.ok) {
        let errorBody = "";

        try {
          errorBody = await chatResponse.text();
        } catch (readError) {
          errorBody =
            readError instanceof Error
              ? `Unable to read Ollama error body: ${readError.message}`
              : "Unable to read Ollama error body.";
        }

        throw new LocalModelError(
          `Local Ollama chat returned HTTP ${chatResponse.status}${
            errorBody
              ? `: ${errorBody.slice(0, 4000)}`
              : ""
          }`,
          "local_model_error"
        );
      }

      const payload = (await chatResponse.json()) as {
        model?: string;
        created_at?: string;

        message?: {
          role?: string;
          content?: string;
          thinking?: string;
        };

        done?: boolean;
        done_reason?: string;

        total_duration?: number;
        load_duration?: number;

        prompt_eval_count?: number;
        prompt_eval_cached_count?: number;
        prompt_eval_duration?: number;

        eval_count?: number;
        eval_duration?: number;
      };

      const content =
        typeof payload.message?.content === "string"
          ? payload.message.content.trim()
          : "";

      const thinking =
        typeof payload.message?.thinking === "string"
          ? payload.message.thinking
          : "";

      const elapsedMs =
        Date.now() - chatStartedAt;

      /*
       * Do NOT print the private reasoning itself.
       * Only log its size so FREEOS can diagnose budget exhaustion.
       */
      console.log(
        "[FREEOS Ollama] heavy chat complete",
        {
          model: input.model,

          structured: isStructured,
          reasoningEffort: isStructured
            ? "low"
            : "default",

          contextSize: heavyContextSize,

          requestedNumPredict,
          effectiveNumPredict,

          elapsedMs,

          contentChars: content.length,
          thinkingChars: thinking.length,

          done: payload.done ?? null,
          doneReason: payload.done_reason ?? null,

          totalDurationNs:
            payload.total_duration ?? null,

          loadDurationNs:
            payload.load_duration ?? null,

          promptEvalCount:
            payload.prompt_eval_count ?? null,

          promptEvalCachedCount:
            payload.prompt_eval_cached_count ?? null,

          evalCount:
            payload.eval_count ?? null,
        }
      );

      if (!content) {
        throw new LocalModelError(
          `Local Ollama chat returned an empty response. ` +
            `done=${String(payload.done)}, ` +
            `done_reason=${payload.done_reason ?? "unknown"}, ` +
            `structured=${String(isStructured)}, ` +
            `reasoning_effort=${isStructured ? "low" : "default"}, ` +
            `thinking_chars=${thinking.length}, ` +
            `elapsed_ms=${elapsedMs}, ` +
            `context_size=${heavyContextSize}, ` +
            `requested_num_predict=${requestedNumPredict}, ` +
            `effective_num_predict=${effectiveNumPredict}, ` +
            `prompt_eval_count=${payload.prompt_eval_count ?? "unknown"}, ` +
            `load_duration_ns=${payload.load_duration ?? "unknown"}, ` +
            `eval_count=${payload.eval_count ?? "unknown"}.`,
          "local_model_error"
        );
      }

      return content;
    }
    const response = await undiciFetch(`${config.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        system: input.system,
        stream: true,
        think: effectiveThink,
        ...(format ? { format } : {}),
        options: {
          temperature: 0.2,
          top_p: 0.8,
          repeat_penalty: 1.1,
          num_predict: 500,
          ...input.options,
        },
      }),
      dispatcher: ollamaLongRequestDispatcher,
      signal: AbortSignal.timeout(effectiveTimeoutMs),
    });

    if (!response.ok) {
      throw new LocalModelError(
        `Local Ollama returned HTTP ${response.status}.`,
        "local_model_error"
      );
    }

    if (!response.body) {
      throw new LocalModelError(
        "Local Ollama returned no response body.",
        "local_model_error"
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        const chunk = JSON.parse(line) as OllamaGeneratePayload & {
          done?: boolean;
        };

        if (typeof chunk.response === "string") {
          text += chunk.response;
        }
      }
    }

    buffer += decoder.decode();

    const finalLine = buffer.trim();
    if (finalLine) {
      const chunk = JSON.parse(finalLine) as OllamaGeneratePayload & {
        done?: boolean;
      };

      if (typeof chunk.response === "string") {
        text += chunk.response;
      }
    }

    text = normalizeOllamaOutput(text, isHeavyModel);

    if (!text) {
      throw new LocalModelError(
        "Local Ollama returned an empty response.",
        "local_model_error"
      );
    }

    return text;
  } catch (error) {
    if (error instanceof LocalModelError) throw error;

    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new LocalModelError(
        "Local Ollama generation exceeded the configured timeout.",
        "local_model_timeout"
      );
    }

    throw new LocalModelError(
      error instanceof Error
        ? error.message
        : "Local Ollama generation failed.",
      "local_model_error"
    );
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
