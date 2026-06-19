import { ResearchError } from "./sourceUtils";

export async function summarizeWithOllama(text: string, model: string, options: { baseUrl?: string; sourceUrl?: string } = {}): Promise<string> {
  if (!text.trim()) throw new ResearchError("Readable page text is required for summarization.", "validation");
  const baseUrl = (options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const prompt = `Summarize the following public web page for FREEOS research. Include key points, caveats, and the source URL. Do not invent facts.\n\nSource URL: ${options.sourceUrl ?? "not provided"}\n\nPage text:\n${text.slice(0, 30000)}`;
  try {
    const response = await fetch(`${baseUrl}/api/generate`, { method: "POST", signal: AbortSignal.timeout(90000), headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ model, prompt, stream: false, think: false, options: { num_predict: 600, temperature: 0.2 } }) });
    if (!response.ok) throw new ResearchError(`Ollama returned HTTP ${response.status}.`, "offline");
    const payload = await response.json() as { response?: unknown };
    if (typeof payload.response !== "string" || !payload.response.trim()) throw new ResearchError("Ollama returned an empty summary.", "offline");
    return payload.response.trim();
  } catch (error) {
    if (error instanceof ResearchError) throw error;
    throw new ResearchError("Ollama is offline. The page preview is still available, but local summarization could not run.", "offline");
  }
}
