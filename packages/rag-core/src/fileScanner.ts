import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RagConfig } from "./rag.config";
import { isExcludedPath, isSupportedFileType, validateAllowedPath } from "./fileFilters";

export interface ScannedFile {
  path: string;
  name: string;
  size: number;
  ext: string;
}

export function scanDirectory(
  rootPath: string,
  config: RagConfig,
  maxDepth: number = 10,
): { files: ScannedFile[]; errors: Array<{ path: string; error: string }> } {
  const files: ScannedFile[] = [];
  const errors: Array<{ path: string; error: string }> = [];

  function traverse(dir: string, depth: number = 0) {
    if (depth > maxDepth) return;

    try {
      const entries = readdirSync(dir);
      
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        
        try {
          const stat = statSync(fullPath);
          
          // Check exclusions
          if (isExcludedPath(fullPath, config)) {
            continue;
          }

          if (stat.isDirectory()) {
            traverse(fullPath, depth + 1);
          } else if (stat.isFile()) {
            // Check file size
            const sizeInMb = stat.size / (1024 * 1024);
            if (sizeInMb > config.maxFileSizeMb) {
              errors.push({
                path: fullPath,
                error: `File too large: ${sizeInMb.toFixed(2)}MB > ${config.maxFileSizeMb}MB`,
              });
              continue;
            }

            // Check if supported
            if (isSupportedFileType(entry)) {
              files.push({
                path: resolve(fullPath),
                name: entry,
                size: stat.size,
                ext: entry.substring(entry.lastIndexOf(".")),
              });
            }
          }
        } catch (error) {
          errors.push({
            path: fullPath,
            error: `Error scanning: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    } catch (error) {
      errors.push({
        path: dir,
        error: `Error reading directory: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const normalizedRoot = resolve(rootPath);
  
  // Validate allowed path
  if (!validateAllowedPath(normalizedRoot, config)) {
    errors.push({
      path: normalizedRoot,
      error: "Path is outside allowed RAG roots",
    });
    return { files, errors };
  }

  traverse(normalizedRoot);

  return { files, errors };
}

export function scanAllowedRoots(config: RagConfig): {
  filesByRoot: Map<string, ScannedFile[]>;
  errors: Array<{ path: string; error: string }>;
} {
  const filesByRoot = new Map<string, ScannedFile[]>();
  const errors: Array<{ path: string; error: string }> = [];

  for (const root of config.allowedRoots) {
    const { files, errors: dirErrors } = scanDirectory(root, config);
    filesByRoot.set(root, files);
    errors.push(...dirErrors);
  }

  return { filesByRoot, errors };
}
