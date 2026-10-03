import { Router } from "express";
import { ToolExecutor } from "@freeos/tool-runner";

export const codingRouter = Router();
const executor = new ToolExecutor();
const run = (toolKey: string, args: Record<string, unknown>) => executor.runReadOnlyTool(toolKey, args);
codingRouter.get("/status", async (_req, res, next) => { try { res.json((await run("coding.status", {})).output); } catch (e) { next(e); } });
codingRouter.get("/workspaces", async (_req, res, next) => { try { res.json({ workspaces: (await run("coding.workspaces.list", {})).output }); } catch (e) { next(e); } });
for (const [path, toolKey] of [["/inspect", "coding.workspace.inspect"], ["/read", "coding.file.read"], ["/search", "coding.search"], ["/git/status", "coding.git.status"], ["/git/diff", "coding.git.diff"], ["/git/diff-file", "coding.git.diff_file"], ["/change/preview", "coding.change.preview"], ["/command/preview", "coding.command.preview"]]) {
  codingRouter.post(path, async (req, res, next) => { try { res.json((await run(toolKey, req.body && typeof req.body === "object" ? req.body : {})).output); } catch (e) { next(e); } });
}
codingRouter.get("/sessions", async (_req, res, next) => { try { res.json({ sessions: (await run("coding.sessions.list", {})).output }); } catch (e) { next(e); } });
