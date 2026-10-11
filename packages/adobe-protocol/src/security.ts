import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

export function resolveAllowedPath(path: unknown, roots: string): string {
  if (typeof path !== "string" || !path.trim()) throw new Error("A file path is required.");
  const lexical = resolve(path);
  const target = existsSync(lexical) ? realpathSync.native(lexical) : resolve(realpathSync.native(dirname(lexical)), basename(lexical));
  const configured = roots.split(";").map(item => item.trim()).filter(Boolean).map(item => realpathSync.native(resolve(item)));
  if (!configured.some(item => target.toLowerCase() === item.toLowerCase() || target.toLowerCase().startsWith((item + sep).toLowerCase()))) throw new Error("Path is outside configured Adobe roots.");
  return target;
}
