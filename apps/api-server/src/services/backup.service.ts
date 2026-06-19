import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getMemoryStore } from "@freeos/memory-core";
import { getToolRegistry } from "@freeos/tool-runner";

export interface BackupOptions { includeDatabase?: boolean; includeProjects?: boolean; includeDocs?: boolean; includeLogs?: boolean }
const safeFilter = (source: string) => !/(^|[\\/])(\.env(?:\..*)?|node_modules|models?)([\\/]|$)/i.test(source)
  && !/[\\/]services[\\/]whispercpp[\\/](source|models?)([\\/]|$)/i.test(source);

function stamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
}

export async function createBackup(options: BackupOptions = {}) {
  const root = getMemoryStore().rootDir;
  const base = join(root, "exports", "backups");
  mkdirSync(base, { recursive: true });
  let folder = join(base, stamp());
  let suffix = 1;
  while (existsSync(folder)) folder = join(base, `${stamp()}-${suffix++}`);
  mkdirSync(folder, { recursive: false });
  const requested = { includeDatabase: options.includeDatabase !== false, includeProjects: options.includeProjects !== false, includeDocs: options.includeDocs !== false, includeLogs: options.includeLogs === true };
  const files: string[] = [];
  if (requested.includeDatabase) {
    const destination = join(folder, "freeos.sqlite");
    await getToolRegistry().database.backup(destination);
    files.push("freeos.sqlite");
  }
  for (const [enabled, sourceName, destinationName] of [
    [requested.includeProjects, "data/projects", "projects"],
    [requested.includeDocs, "docs", "docs"],
    [requested.includeLogs, "logs", "logs"],
  ] as const) {
    const source = join(root, sourceName);
    if (enabled && existsSync(source)) {
      cpSync(source, join(folder, destinationName), { recursive: true, errorOnExist: true, filter: safeFilter });
      files.push(destinationName);
    }
  }
  const manifest = { version: 1, app: "FREEOS", createdAt: new Date().toISOString(), backupPath: relative(root, folder).replace(/\\/g, "/"), requested, files, exclusions: [".env*", "node_modules", "model files", "services/whispercpp/source", "generated voice audio"] };
  writeFileSync(join(folder, "backup-manifest.json"), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
  getToolRegistry().database.prepare("INSERT INTO backup_events (backup_path, manifest, status) VALUES (?, ?, 'completed')").run(manifest.backupPath, JSON.stringify(manifest));
  return manifest;
}

export function getBackupStatus() {
  const root = getMemoryStore().rootDir;
  const base = join(root, "exports", "backups");
  mkdirSync(base, { recursive: true });
  const backups = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
    const path = join(base, entry.name);
    return { name: entry.name, path: relative(root, path).replace(/\\/g, "/"), createdAt: statSync(path).birthtime.toISOString(), manifestExists: existsSync(join(path, "backup-manifest.json")) };
  }).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 20);
  return { backupRoot: relative(root, base).replace(/\\/g, "/"), exists: true, count: backups.length, recentBackups: backups, neverDeletes: true, secretsExcluded: true };
}
