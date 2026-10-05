import cors from "cors";
import express from "express";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { learningCandidateMiddleware } from "./middleware/learningCandidate";
import { healthRouter } from "./routes/health.routes";
import { ollamaRouter } from "./routes/ollama.routes";
import { memoryRouter } from "./routes/memory.routes";
import { learningRouter } from "./routes/learning.routes";
import { experienceRouter } from "./routes/experience.routes";
import { knowledgeRouter } from "./routes/knowledge.routes";
import { currentIntelligenceRouter } from "./routes/currentIntelligence.routes";
import { continuousLearningRouter } from "./routes/continuousLearning.routes";
import { learningWorkRouter } from "./routes/learningWork.routes";
import { projectInspectionRouter } from "./routes/projectInspection.routes";
import { canonicalBaselineReviewRouter } from "./routes/canonicalBaselineReview.routes";
import { projectSourceRouter } from "./routes/projectSource.routes";
import { projectsRouter } from "./routes/projects.routes";
import { systemRouter } from "./routes/system.routes";
import { researchRouter } from "./routes/research.routes";
import { voiceRouter } from "./routes/voice.routes";
import { toolsRouter } from "./routes/tools.routes";
import { automationsRouter } from "./routes/automations.routes";
import { commandRouter } from "./routes/command.routes";
import { ragRouter } from "./routes/rag.routes";
import { registerDefaultTools, getToolRegistry, ToolExecutor, ToolRequests } from "@freeos/tool-runner";
import { Scheduler, configureScheduler } from "@freeos/scheduler-core";
import { schedulerRouter } from "./routes/scheduler.routes";
import { computerRouter } from "./routes/computer.routes";
import { codingRouter } from "./routes/coding.routes";
import { browserRouter } from "./routes/browser.routes";
import { agentsRouter } from "./routes/agents.routes";

const app = express();
registerDefaultTools();
const registry = getToolRegistry();
const scheduler = configureScheduler(new Scheduler(registry.database, {
  getTool: key => registry.getToolByKey(key),
  runReadOnly: async (key, args) => {
    const run = await new ToolExecutor(registry).runReadOnlyTool(key, args);
    return { toolRunId: run.id, status: run.status };
  },
  request: (key, args, title) => new ToolRequests(registry).createToolRequest({ toolKey: key, args, title, description: "Scheduled occurrence requires separate human approval.", requestedBy: "scheduler" }),
}));
scheduler.start();

app.disable("x-powered-by");
app.use(cors({ origin: config.dashboardOrigins }));
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);

app.use("/health", healthRouter);
app.use("/system", systemRouter);
app.use("/ollama", ollamaRouter);
app.use("/memory", memoryRouter);
app.use("/learning", learningRouter);
app.use("/experience", experienceRouter);
app.use("/knowledge", knowledgeRouter);
app.use("/current-intelligence", currentIntelligenceRouter);
app.use("/continuous-learning", continuousLearningRouter);
app.use("/learning-work", learningWorkRouter);
app.use("/project-inspection", projectInspectionRouter);
app.use("/project-baseline-review", canonicalBaselineReviewRouter);
app.use("/project-sources", projectSourceRouter);
app.use("/projects", projectsRouter);
app.use("/research", researchRouter);
app.use("/voice", voiceRouter);
app.use("/tools", toolsRouter);
app.use("/computer", computerRouter);
app.use("/coding", codingRouter);
app.use("/browser", browserRouter);
app.use("/agents", agentsRouter);
app.use("/scheduler", schedulerRouter);
app.use("/automations", automationsRouter);
app.use("/command", learningCandidateMiddleware, commandRouter);
app.use("/rag", ragRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found." });
});
app.use(errorHandler);

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`[FREEOS] API online at http://localhost:${config.port}`);
  console.log("[FREEOS] Dangerous actions are disabled.");
});
server.on("close", () => scheduler.stop());
