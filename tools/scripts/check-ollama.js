const endpoint = "http://localhost:11434/api/tags";

try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  const models = (payload.models ?? []).map((model) => model.name ?? model.model).filter(Boolean);
  console.log("[FREEOS] Ollama connected.");
  if (models.length === 0) {
    console.log("[FREEOS] No models installed. Try: ollama pull llama3.2");
  } else {
    console.log(`[FREEOS] Models: ${models.join(", ")}`);
  }
} catch (error) {
  console.log("[FREEOS] Ollama is not reachable at http://localhost:11434.");
  console.log("[FREEOS] Start Ollama locally, then run this check again.");
  process.exitCode = 1;
}

