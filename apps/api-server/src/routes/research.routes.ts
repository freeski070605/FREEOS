import { Router } from "express";
import { checkSearxngStatus, getResearchService, readPublicPage, searchSearxng, summarizeWithOllama } from "@freeos/research-core";
import { config } from "../config";
import { getOllamaStatus } from "../services/ollama.service";

export const researchRouter = Router();
const service = () => getResearchService();
const body = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tags = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "string" ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];

researchRouter.get("/status", async (_request, response, next) => {
  try {
    const [searxngOnline, ollama] = await Promise.all([checkSearxngStatus(config.searxngBaseUrl), getOllamaStatus()]);
    response.json({ phase: "Phase 3 — Web Research Layer with SearXNG", searxngConfigured: Boolean(config.searxngBaseUrl), searxngOnline, searxngBaseUrl: config.searxngBaseUrl, ollamaOnline: ollama.connected, defaultModel: config.defaultModel, paidApiKeysRequired: false, dangerousActionsEnabled: false, counts: service().getStatusCounts() });
  } catch (error) { next(error); }
});

researchRouter.post("/search", async (request, response, next) => {
  try {
    const input = body(request.body);
    const query = typeof input.query === "string" ? input.query : "";
    const projectKey = typeof input.projectKey === "string" ? input.projectKey : undefined;
    const maxResults = typeof input.maxResults === "number" ? input.maxResults : 5;
    const results = await searchSearxng(config.searxngBaseUrl, query, { maxResults });
    if (input.saveSession === false) { response.json({ session: null, results }); return; }
    response.status(201).json(service().saveSessionWithResults({ query, projectKey }, results));
  } catch (error) { next(error); }
});

researchRouter.get("/sessions", (request, response, next) => {
  try { response.json({ sessions: service().getResearchHistory(Number(request.query.limit) || 25) }); } catch (error) { next(error); }
});

researchRouter.get("/sessions/:id", (request, response, next) => {
  try { response.json(service().getResearchSession(Number(request.params.id))); } catch (error) { next(error); }
});

researchRouter.post("/read", async (request, response, next) => {
  try {
    const input = body(request.body);
    const page = await readPublicPage(typeof input.url === "string" ? input.url : "");
    let summary: string | null = null;
    let summaryMessage: string | null = null;
    if (input.summarize === true) {
      try { summary = await summarizeWithOllama(page.text, typeof input.model === "string" ? input.model : config.defaultModel, { baseUrl: config.ollamaBaseUrl, sourceUrl: page.url }); }
      catch (error) { summaryMessage = error instanceof Error ? error.message : "Local summarization is unavailable."; }
    }
    response.json({ page: { title: page.title, url: page.url, domain: page.domain, contentPreview: page.contentPreview, bytesRead: page.bytesRead, summary, summaryMessage }, storedAsMemory: false });
  } catch (error) { next(error); }
});

researchRouter.post("/results/:id/summarize", async (request, response, next) => {
  try {
    const id = Number(request.params.id);
    const existing = service().getResearchResult(id);
    let preview = existing.contentPreview ?? "";
    let sourceUrl = existing.url;
    if (!preview) {
      const page = await readPublicPage(existing.url);
      preview = page.contentPreview;
      sourceUrl = page.url;
      service().updateResultRead(id, { title: page.title, url: page.url, contentPreview: page.contentPreview });
    }
    const input = body(request.body);
    const summary = await summarizeWithOllama(preview, typeof input.model === "string" ? input.model : config.defaultModel, { baseUrl: config.ollamaBaseUrl, sourceUrl });
    response.json({ result: service().updateResultSummary(id, summary, preview) });
  } catch (error) { next(error); }
});

researchRouter.post("/results/:id/create-memory-proposal", (request, response, next) => {
  try {
    const input = body(request.body);
    const proposal = service().createMemoryProposalFromResearch(Number(request.params.id), { title: typeof input.title === "string" ? input.title : undefined, category: typeof input.category === "string" ? input.category : "research", projectKey: typeof input.projectKey === "string" ? input.projectKey : undefined, tags: tags(input.tags), reason: typeof input.reason === "string" ? input.reason : undefined });
    response.status(201).json({ proposal, approvedMemoryCreated: false });
  } catch (error) { next(error); }
});

researchRouter.post("/results/:id/create-project-note", (request, response, next) => {
  try {
    const input = body(request.body);
    const note = service().createProjectNoteFromResearch(Number(request.params.id), { title: typeof input.title === "string" ? input.title : undefined, projectKey: typeof input.projectKey === "string" ? input.projectKey : "", tags: tags(input.tags) });
    response.status(201).json({ note });
  } catch (error) { next(error); }
});
