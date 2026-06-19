export interface EmbeddingResponse {
  embedding: number[];
  model: string;
}

export async function embedChunkWithOllama(
  content: string,
  model: string = "nomic-embed-text",
  baseUrl: string = "http://127.0.0.1:11434",
): Promise<number[] | null> {
  try {
    const response = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: content,
      }),
    });

    if (!response.ok) {
      console.error(`Ollama embedding failed: ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as { embeddings?: number[][] };
    
    // Return the first embedding if available
    if (data.embeddings && data.embeddings.length > 0) {
      return data.embeddings[0];
    }

    return null;
  } catch (error) {
    console.error("Error calling Ollama embedding API:", error);
    return null;
  }
}

export async function checkOllamaModel(
  model: string,
  baseUrl: string = "http://127.0.0.1:11434",
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    
    if (!data.models) return false;

    return data.models.some((m) => m.name.includes(model));
  } catch (error) {
    console.error("Error checking Ollama models:", error);
    return false;
  }
}

export async function isOllamaAvailable(baseUrl: string = "http://127.0.0.1:11434"): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/version`);
    return response.ok;
  } catch {
    return false;
  }
}
