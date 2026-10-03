import { Router } from "express";
import { ToolExecutor, getToolRegistry } from "@freeos/tool-runner";

export const schedulerRouter = Router();
const executor = () => new ToolExecutor(getToolRegistry());
const args = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
schedulerRouter.get("/status", async (_request, response, next) => { try { response.json(await executor().runReadOnlyTool("scheduler.status")); } catch (error) { next(error); } });
schedulerRouter.get("/schedules", async (_request, response, next) => { try { response.json(await executor().runReadOnlyTool("scheduler.schedules.list")); } catch (error) { next(error); } });
schedulerRouter.get("/schedules/:id", async (request, response, next) => { try { response.json(await executor().runReadOnlyTool("scheduler.schedule.get", { id: request.params.id })); } catch (error) { next(error); } });
schedulerRouter.get("/runs", async (request, response, next) => { try { response.json(await executor().runReadOnlyTool("scheduler.runs.list", { limit: Number(request.query.limit) || 100 })); } catch (error) { next(error); } });
schedulerRouter.post("/preview", async (request, response, next) => { try { response.json(await executor().runReadOnlyTool("scheduler.schedule.preview", args(request.body))); } catch (error) { next(error); } });
