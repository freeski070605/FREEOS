import { config } from "../../../config";
import { generateWithOllama } from "../../ollama.service";
import type { JsonObject } from "./plannerTypes";
export async function generateJson(input: {
  model?: string;
  system: string;
  prompt: unknown;
  schema?: JsonObject;
  timeoutMs: number;
  numPredict: number;
  temperature?: number;
  onCall?: () => void;
}): Promise<string> {
  const model = input.model ?? config.heavyModel;

  const prompt =
    typeof input.prompt === "string"
      ? input.prompt
      : JSON.stringify(input.prompt);

  /*
   * Every call through generateJson() expects machine-readable JSON.
   *
   * When a concrete JSON Schema exists, pass that schema to Ollama.
   * When a stage does not define a custom schema (camera profiles, etc.),
   * still force Ollama JSON mode with "json".
   *
   * This is important for GPT-OSS because ollama.service routes structured
   * heavy-model calls through /api/chat and disables hidden thinking so the
   * generation budget is spent on complete message.content JSON.
   */
  const structuredFormat: JsonObject | "json" =
    input.schema ?? "json";

  const run = async (
    system: string,
    numPredict: number,
    temperature: number
  ): Promise<string> => {
    input.onCall?.();
    return generateWithOllama({
      model,
      think: true,
      system,
      prompt,
      format: structuredFormat,
      timeoutMs: input.timeoutMs,
      options: {
        temperature,
        top_p: 0.82,
        repeat_penalty: 1.08,
        num_predict: numPredict,
      },
    });
  };

  /*
   * Give structured output enough room on the first attempt.
   * The caller's requested budget is respected when it is larger.
   */
  const firstNumPredict = Math.max(
    input.numPredict,
    2400
  );

  let text = await run(
    input.system,
    firstNumPredict,
    input.temperature ?? 0.2
  );

  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    console.warn(
      `[FREEOS Editing Planner] structured JSON invalid; retrying stage. ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  /*
   * Retry only this structured stage.
   * Do not restart media analysis or the entire edit-planning pipeline.
   */
  const retrySystem = `${input.system}

CRITICAL STRUCTURED OUTPUT RETRY:

Your previous response was incomplete or invalid JSON.

Return exactly ONE complete JSON value.

Requirements:
- Match the supplied JSON schema when one is present.
- When no custom schema is present, still return valid JSON only.
- Do not include markdown.
- Do not include commentary outside the JSON.
- Do not truncate strings.
- Do not omit closing quotes.
- Do not omit closing brackets.
- Do not omit closing braces.
- Finish the entire JSON value before stopping.`;

  const retryNumPredict = Math.max(
    input.numPredict * 2,
    5000
  );

  const retryTemperature = Math.min(
    input.temperature ?? 0.2,
    0.08
  );

  text = await run(
    retrySystem,
    retryNumPredict,
    retryTemperature
  );

  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    throw new Error(
      `Structured planner JSON remained invalid after retry: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }
}
