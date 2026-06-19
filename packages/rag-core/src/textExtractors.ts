import { readFileSync } from "node:fs";

export function extractTextFromFile(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  
  switch (ext) {
    case ".json":
      return extractJson(filePath);
    case ".csv":
      return extractCsv(filePath);
    case ".md":
    case ".markdown":
    case ".txt":
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".py":
    case ".html":
    case ".css":
    case ".yml":
    case ".yaml":
      return readFileSync(filePath, "utf8");
    default:
      return "";
  }
}

function extractJson(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    const json = JSON.parse(content);
    return JSON.stringify(json, null, 2);
  } catch {
    return readFileSync(filePath, "utf8");
  }
}

function extractCsv(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf8");
    // For CSV, we'll include headers and content as-is but make it more readable
    const lines = content.split("\n");
    const formattedLines = lines.slice(0, 1000); // Limit to first 1000 lines
    return formattedLines.join("\n");
  } catch {
    return readFileSync(filePath, "utf8");
  }
}
