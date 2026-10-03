import { Router } from "express";
import { ToolExecutor } from "@freeos/tool-runner";

export const browserRouter = Router();
const executor = new ToolExecutor();
const run = (key: string, args: Record<string, unknown> = {}) => executor.runReadOnlyTool(key, args);
for (const [path, key] of [["/status", "browser.status"], ["/sessions", "browser.sessions.list"], ["/tabs", "browser.tabs.list"]]) browserRouter.get(path, async (_req, res, next) => { try { res.json((await run(key)).output); } catch (e) { next(e); } });
for (const [path, key] of [["/session/start", "browser.session.start"], ["/session/stop", "browser.session.stop"], ["/inspect", "browser.page.inspect"], ["/text", "browser.page.text"], ["/links", "browser.page.links"], ["/forms", "browser.page.forms"], ["/elements", "browser.page.elements"], ["/screenshot", "browser.page.screenshot"], ["/navigation/preview", "browser.navigation.preview"], ["/form/preview", "browser.form.preview"]]) browserRouter.post(path, async (req, res, next) => { try { res.json((await run(key, req.body && typeof req.body === "object" ? req.body : {})).output); } catch (e) { next(e); } });
