import { Router } from "express";
import { runReadOnlyTool } from "@freeos/tool-runner";

export const computerRouter = Router();
for (const [path, key] of [["/status", "computer.status"], ["/windows", "computer.windows.list"], ["/active-window", "computer.window.active"], ["/processes", "computer.processes.list"]]) {
  computerRouter.get(path, async (_request, response, next) => {
    try { response.json((await runReadOnlyTool(key)).output); } catch (error) { next(error); }
  });
}
