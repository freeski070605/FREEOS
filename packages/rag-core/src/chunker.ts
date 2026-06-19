export interface TextChunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

// Estimate tokens in text (rough approximation: 1 token ≈ 4 characters)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Split text into chunks with overlap
export function chunkText(
  text: string,
  chunkSize: number = 1200,
  overlapSize: number = 150,
): TextChunk[] {
  if (!text || text.length === 0) return [];

  const chunks: TextChunk[] = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < text.length) {
    const chunkEnd = Math.min(offset + chunkSize, text.length);
    
    // Try to break at a sentence boundary if possible
    let actualEnd = chunkEnd;
    if (chunkEnd < text.length) {
      // Look for the last period, newline, or space before chunkEnd
      const lookbackStart = Math.max(offset, chunkEnd - 100);
      for (let i = chunkEnd - 1; i >= lookbackStart; i--) {
        if (text[i] === "." || text[i] === "\n") {
          actualEnd = i + 1;
          break;
        }
      }
      // If no good breakpoint found, try to break at space
      if (actualEnd === chunkEnd) {
        for (let i = chunkEnd - 1; i >= lookbackStart; i--) {
          if (text[i] === " ") {
            actualEnd = i;
            break;
          }
        }
      }
    }

    const chunkContent = text.substring(offset, actualEnd).trim();
    
    if (chunkContent.length > 0) {
      chunks.push({
        index: chunkIndex,
        content: chunkContent,
        startOffset: offset,
        endOffset: actualEnd,
      });
      chunkIndex++;
    }

    // Move offset forward, considering overlap
    offset = actualEnd - overlapSize;
    
    // Ensure we make progress
    if (offset <= Math.max(0, actualEnd - 1)) {
      offset = actualEnd;
    }
  }

  return chunks;
}
