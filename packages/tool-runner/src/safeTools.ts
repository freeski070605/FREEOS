import { createProjectNote, createProposal, getMemoryStore, type MemoryCategory } from "@freeos/memory-core";
import { getVoiceStatus } from "@freeos/voice-core";
import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveAllowedWritePath, WHITELISTED_SCRIPTS } from "./permissions";
import type { JsonObject } from "./tool.types";
import { ToolRunnerError } from "./tool.types";
import type { ToolRegistry } from "./toolRegistry";

const executeFile = promisify(execFile);
function requiredString(value: unknown, label: string): string { if (typeof value !== "string" || !value.trim()) throw new ToolRunnerError(`${label} is required.`, "validation"); return value.trim(); }
async function endpointOnline(url: string): Promise<boolean> { try { const response = await fetch(url, { signal: AbortSignal.timeout(1800) }); return response.ok; } catch { return false; } }
function count(registry: ToolRegistry, table: string): number { return Number((registry.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }

export async function executeSafeTool(registry: ToolRegistry, toolKey: string, args: JsonObject): Promise<unknown> {
  switch (toolKey) {
    case "system.status.snapshot": {
      const [ollamaOnline, searxngOnline] = await Promise.all([endpointOnline(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/api/tags"), endpointOnline(process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080/search?q=freeos&format=json")]);
      return { api: { online: true, phase: "Phase 5 — Safe Tool Runner + Local Automations" }, ollama: { online: ollamaOnline }, memory: getMemoryStore().getMemoryStatus(), research: { online: searxngOnline, sessions: count(registry, "research_sessions"), results: count(registry, "research_results") }, voice: getVoiceStatus(), searxng: { online: searxngOnline }, dangerousActionsEnabled: false, approvalRequiredForWrites: true };
    }
    case "projects.list": return { projects: getMemoryStore().listProjects() };
    case "memory.status": return getMemoryStore().getMemoryStatus();
    case "research.status": {
      const baseUrl = process.env.SEARXNG_BASE_URL ?? "http://127.0.0.1:8080";
      return { searxngBaseUrl: baseUrl, searxngOnline: await endpointOnline(`${baseUrl.replace(/\/$/, "")}/search?q=freeos&format=json`), counts: { sessions: count(registry, "research_sessions"), results: count(registry, "research_results"), sources: count(registry, "research_sources") }, paidApiKeysRequired: false };
    }
    case "voice.status": return getVoiceStatus();
    case "notes.create_project_note": return { note: createProjectNote({ projectKey: requiredString(args.projectKey, "projectKey"), title: requiredString(args.title, "title"), content: requiredString(args.content, "content"), tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : [], source: "tool-runner-approved" }) };
    case "memory.create_proposal": return { proposal: createProposal({ title: requiredString(args.title, "title"), content: requiredString(args.content, "content"), category: requiredString(args.category, "category") as MemoryCategory, projectKey: typeof args.projectKey === "string" && args.projectKey.trim() ? args.projectKey.trim() : undefined, tags: Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === "string") : [], reason: typeof args.reason === "string" ? args.reason : "Created through an approved Phase 5 tool request.", source: "tool-runner-approved" }), approvedMemoryCreated: false };
    case "files.create_freeos_text_file": {
      const path = resolveAllowedWritePath(registry.rootDir, args.path);
      if (![".txt", ".md"].includes(extname(path).toLowerCase())) throw new ToolRunnerError("Only .txt and .md files may be created.", "blocked");
      const overwrite = args.overwrite === true;
      if (!overwrite) { try { await access(path, constants.F_OK); throw new ToolRunnerError("File already exists. Set overwrite=true in the request args to explicitly approve replacement.", "conflict"); } catch (error) { if (error instanceof ToolRunnerError) throw error; } }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, typeof args.content === "string" ? args.content : "", { encoding: "utf8", flag: overwrite ? "w" : "wx" });
      return { path: path.slice(registry.rootDir.length + 1).replace(/\\/g, "/"), created: true, overwritten: overwrite };
    }
    case "scripts.run_freeos_script": {
      const script = requiredString(args.script, "script");
      if (!(WHITELISTED_SCRIPTS as readonly string[]).includes(script) || script.includes("/") || script.includes("\\")) throw new ToolRunnerError(`Script is not whitelisted. Allowed: ${WHITELISTED_SCRIPTS.join(", ")}.`, "blocked");
      const scriptArgs = Array.isArray(args.scriptArgs) ? args.scriptArgs.filter((value): value is string => typeof value === "string") : [];
      const result = await executeFile(process.execPath, [join(registry.rootDir, "tools", "scripts", script), ...scriptArgs], { cwd: registry.rootDir, timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 });
      return { script, stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
    }
    default: throw new ToolRunnerError(`Execution is not implemented for ${toolKey}.`, "blocked");
  }
}
