import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const now = new Date();
const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
const base = join(root, "exports", "backups"); mkdirSync(base, { recursive: true });
let folder = join(base, stamp); let n = 1; while (existsSync(folder)) folder = join(base, `${stamp}-${n++}`); mkdirSync(folder);
const files = [];
const database = join(root, "data", "freeos.sqlite"); if (existsSync(database)) { const sqlite = new Database(database, { readonly: true }); try { await sqlite.backup(join(folder, "freeos.sqlite")); files.push("freeos.sqlite"); } finally { sqlite.close(); } }
const filter = (source) => !/(^|[\\/])(\.env(?:\..*)?|node_modules|models?)([\\/]|$)/i.test(source) && !/[\\/]services[\\/]whispercpp[\\/](source|models?)([\\/]|$)/i.test(source);
for (const [sourceName, targetName] of [["data/projects", "projects"], ["docs", "docs"]]) { const source = join(root, sourceName); if (existsSync(source)) { cpSync(source, join(folder, targetName), { recursive: true, errorOnExist: true, filter }); files.push(targetName); } }
const manifest = { version: 1, app: "FREEOS", createdAt: now.toISOString(), backupPath: folder, files, exclusions: [".env*", "node_modules", "model files", "services/whispercpp", "logs", "generated voice audio"] };
writeFileSync(join(folder, "backup-manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
console.log(`FREEOS backup created: ${folder}`); console.log(`Included: ${files.join(", ") || "manifest only"}`);
