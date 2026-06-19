import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const path = resolve(root, "data/freeos.sqlite");
const tables = ["memories", "memory_proposals", "projects", "project_notes", "research_sessions", "research_results", "voice_sessions", "tool_registry", "tool_requests", "tool_runs", "automation_rules", "automation_events", "command_chat_sessions"];
console.log("FREEOS v1 Database Integrity Check\n");
if (!existsSync(path)) { console.error(`FAIL Database missing: ${path}`); process.exit(1); }
let database;
try {
  database = new Database(path, { readonly: true, fileMustExist: true });
  const results = database.pragma("integrity_check"); const integrity = results.every((row) => row.integrity_check === "ok");
  console.log(`${integrity ? "PASS" : "FAIL"} PRAGMA integrity_check - ${results.map((row) => row.integrity_check).join("; ")}`);
  const existing = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  let failed = integrity ? 0 : 1;
  for (const table of tables) {
    if (!existing.has(table)) { console.log(`FAIL ${table} - table is missing`); failed += 1; continue; }
    const count = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
    console.log(`PASS ${table} - ${count} row(s)`);
  }
  console.log(`\nSummary: ${tables.length + 1 - failed}/${tables.length + 1} checks passed.`);
  if (failed) process.exitCode = 1;
} catch (error) { console.error(`FAIL Could not inspect database - ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
finally { database?.close(); }
