import { resolve } from "node:path";
import { minimatch } from "minimatch";
import type { RagConfig } from "./rag.config";

export function validateAllowedPath(filePath: string, config: RagConfig): boolean {
  const normalizedPath = resolve(filePath);
  
  // Check if path is within allowed roots
  const isAllowed = config.allowedRoots.some((root) => {
    const normalizedRoot = resolve(root);
    return normalizedPath.startsWith(normalizedRoot + require("node:path").sep) || normalizedPath === normalizedRoot;
  });

  return isAllowed;
}

export function isExcludedPath(filePath: string, config: RagConfig): boolean {
  const patterns = config.excludedGlobs;
  
  for (const pattern of patterns) {
    if (minimatch(filePath, `**/${pattern}`) || minimatch(filePath, pattern)) {
      return true;
    }
  }

  return false;
}

export function isExcludedExtension(fileName: string, config: RagConfig): boolean {
  // Check if file extension is explicitly excluded
  const excluded = ["exe", "dll", "so", "dylib", "bin", "sqlite", "db"];
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext ? excluded.includes(ext) : false;
}

const SUPPORTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".html",
  ".css",
  ".yml",
  ".yaml",
]);

export function isSupportedFileType(fileName: string): boolean {
  const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function filterExcludedFiles(
  filePaths: string[],
  config: RagConfig,
): { allowed: string[]; excluded: Array<{ path: string; reason: string }> } {
  const allowed: string[] = [];
  const excluded: Array<{ path: string; reason: string }> = [];

  for (const filePath of filePaths) {
    if (!validateAllowedPath(filePath, config)) {
      excluded.push({ path: filePath, reason: "outside_allowed_roots" });
      continue;
    }

    if (isExcludedPath(filePath, config)) {
      excluded.push({ path: filePath, reason: "matches_excluded_pattern" });
      continue;
    }

    if (!isSupportedFileType(filePath)) {
      excluded.push({ path: filePath, reason: "unsupported_file_type" });
      continue;
    }

    if (isExcludedExtension(filePath, config)) {
      excluded.push({ path: filePath, reason: "excluded_extension" });
      continue;
    }

    allowed.push(filePath);
  }

  return { allowed, excluded };
}
