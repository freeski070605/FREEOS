import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, api, type Project } from "../lib/api";

type RagMode = "keyword" | "hybrid" | "embeddings";
type ModelMode = "standard" | "fast";
type ResponseMode = "precise" | "balanced" | "creative";
type RagSource = { documentPath: string; documentName: string; chunks: number[] };
type ResponseDetails = {
  ragRequested?: boolean;
  ragUsed?: boolean;
  ragSources?: RagSource[];
  warnings?: string[];
  memoryUsed?: boolean;
  projectNotesUsed?: boolean;
  blockedModelGuess?: boolean;
  ragQueryUsed?: string;
  ragModeUsed?: RagMode;
  ragTopKUsed?: number;
  creativeMode?: boolean;
  exampleCopyBlocked?: boolean;
  responseMode?: ResponseMode;
  ragUsedAs?: "craft_reference";
};

const creativeRequest = /\b(hook|verse|bridge|song|caption|scene|story|script|monologue|rewrite|creative|lyrics?)\b/i;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sources(value: unknown): RagSource[] {
  return Array.isArray(value) ? value.filter((item): item is RagSource => Boolean(item) && typeof item === "object" && typeof item.documentPath === "string") : [];
}

export function ChatPanel({ projects, onApprovalCreated }: { projects: Project[]; onApprovalCreated?: () => void }) {
  const [message, setMessage] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [responseText, setResponseText] = useState("");
  const [responseDetails, setResponseDetails] = useState<ResponseDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState("");
  const [options, setOptions] = useState({ useMemory: true, useProjectNotes: true, useResearchContext: false, allowToolSuggestions: true, speak: false, useRag: false });
  const [ragMode, setRagMode] = useState<RagMode>("keyword");
  const [ragTopK, setRagTopK] = useState(3);
  const [modelMode, setModelMode] = useState<ModelMode>("standard");
  const [responseModeOverride, setResponseModeOverride] = useState<ResponseMode | null>(null);
  const [recentAssistantResponses, setRecentAssistantResponses] = useState<string[]>([]);
  const requestController = useRef<AbortController | null>(null);
  const responseMode: ResponseMode = responseModeOverride ?? (creativeRequest.test(message) ? "creative" : "precise");

  useEffect(() => {
    if (!busy) { setWaitingMessage(""); return; }
    setWaitingMessage("FREEOS is thinking locally. Larger RAG answers can take a few minutes on this machine.");
    const timers = [
      window.setTimeout(() => setWaitingMessage("Still working locally…"), 20_000),
      window.setTimeout(() => setWaitingMessage("qwen3:8b can take a while with RAG on this machine."), 60_000),
      window.setTimeout(() => setWaitingMessage("Still waiting on Ollama. You can lower RAG topK or use a faster model."), 120_000),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError(null);
    try {
      const payload = { message, projectKey: projectKey || undefined, ragMode, ragTopK, modelMode, responseMode, recentAssistantResponses, ...options };
      if (import.meta.env.DEV) console.debug("ChatPanel outgoing /command/chat payload", payload);
      const result = await api.commandChat(payload, controller.signal);
      setResponseText(result.response);
      setResponseDetails({
        ragRequested: result.ragRequested,
        ragUsed: result.ragUsed,
        ragSources: result.ragSources ?? [],
        warnings: result.warnings ?? [],
        memoryUsed: result.memoryUsed,
        projectNotesUsed: result.projectNotesUsed,
        blockedModelGuess: result.blockedModelGuess,
        ragQueryUsed: result.ragQueryUsed,
        ragModeUsed: result.ragModeUsed,
        ragTopKUsed: result.ragTopKUsed,
        creativeMode: result.creativeMode,
        exampleCopyBlocked: result.exampleCopyBlocked,
        responseMode: result.responseMode,
        ragUsedAs: result.ragUsedAs,
      });
      setRecentAssistantResponses((current) => [...current, result.response].slice(-5));
      if (result.audioUrl) void new Audio(api.audioUrl(result.audioUrl)!).play();
      if (result.createdMemoryProposalId || result.createdToolRequestId) onApprovalCreated?.();
    } catch (reason) {
      if (controller.signal.aborted) {
        setError("Request cancelled by user.");
      } else if (reason instanceof ApiError && typeof reason.payload.response === "string") {
        setResponseText(reason.payload.response);
        setResponseDetails({
          ragRequested: reason.payload.ragRequested === true,
          ragUsed: reason.payload.ragUsed === true,
          ragSources: sources(reason.payload.ragSources),
          warnings: strings(reason.payload.warnings),
          blockedModelGuess: reason.payload.blockedModelGuess === true,
          creativeMode: reason.payload.creativeMode === true,
          exampleCopyBlocked: reason.payload.exampleCopyBlocked === true,
          responseMode: typeof reason.payload.responseMode === "string" ? reason.payload.responseMode as ResponseMode : undefined,
          ragUsedAs: reason.payload.ragUsedAs === "craft_reference" ? "craft_reference" : undefined,
        });
      } else {
        setError(reason instanceof Error ? reason.message : "Local chat failed.");
      }
    } finally {
      if (requestController.current === controller) requestController.current = null;
      setBusy(false);
    }
  }

  function cancelRequest() {
    requestController.current?.abort();
  }

  return <section className="panel"><p className="eyebrow">Local Ollama bridge</p><h2 className="section-title">Chat with free-os</h2><p className="section-copy">Approved memory only. No cloud providers. Chat can suggest or queue actions, but never executes them.</p>
    <div className="mt-6 grid gap-5 xl:grid-cols-[1fr_.34fr]"><form onSubmit={submit} className="space-y-3"><textarea className="field min-h-40 resize-y" required value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask free-os to plan, explain, research, or organize…" /><div className="flex flex-wrap gap-3"><button className="button" disabled={busy}>{busy ? "Thinking locally…" : "Send to local model"}</button>{busy && <button type="button" className="button border-red-400/40 text-red-200" onClick={cancelRequest}>Cancel request</button>}</div>{busy && <p className="text-sm text-slate-400">{waitingMessage}</p>}</form><div className="space-y-3"><label className="label">Project context<select className="field mt-2" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}><option value="">No project selected</option>{projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}</select></label><label className="label">Model mode<select className="field mt-2" value={modelMode} onChange={(event) => setModelMode(event.target.value as ModelMode)}><option value="standard">Standard (default model)</option><option value="fast">Fast (FREEOS_FAST_MODEL)</option></select></label><label className="label">Response mode<select className="field mt-2" value={responseMode} onChange={(event) => setResponseModeOverride(event.target.value as ResponseMode)}><option value="precise">Precise</option><option value="balanced">Balanced</option><option value="creative">Creative</option></select></label>{Object.entries(options).map(([key, value]) => <label className="flex items-center gap-3 text-xs text-slate-400" key={key}><input type="checkbox" checked={value} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.checked }))} /><span>{({ useMemory: "Use approved memory", useProjectNotes: "Use project notes", useResearchContext: "Use recent research", allowToolSuggestions: "Allow tool suggestions", speak: "Speak response locally", useRag: "Use indexed documents / RAG" } as Record<string, string>)[key]}</span></label>)}{options.useRag && <><label className="label">RAG mode<select className="field mt-2" value={ragMode} onChange={(event) => setRagMode(event.target.value as RagMode)}><option value="keyword">keyword</option><option value="hybrid">hybrid</option><option value="embeddings">embeddings</option></select></label><label className="label">RAG topK<input className="field mt-2" type="number" min={1} max={8} value={ragTopK} onChange={(event) => setRagTopK(Math.max(1, Number(event.target.value) || 3))} /></label></>}</div></div>
    {error && <p className="notice">{error}</p>}{responseText && <div className="mt-6 border border-electric/20 bg-electric/[.03] p-5"><p className="meta mt-0 text-electric">free-os response</p><p className="mb-0 whitespace-pre-wrap text-sm leading-7 text-slate-300">{responseText}</p>{responseDetails && <div className="mt-4 rounded border border-slate-700 bg-slate-950/80 p-3 text-sm text-slate-300"><p className="text-xs uppercase tracking-[.2em] text-slate-500">Response metadata</p><p className="mt-2">Memory used: {responseDetails.memoryUsed ? "yes" : "no"}</p><p>Project notes used: {responseDetails.projectNotesUsed ? "yes" : "no"}</p><p>RAG requested: {responseDetails.ragRequested ? "yes" : "no"}</p><p>RAG used: {responseDetails.ragUsed ? "yes" : "no"}</p><p>Creative mode: {responseDetails.creativeMode ? "yes" : "no"}</p><p>Example copy blocked: {responseDetails.exampleCopyBlocked ? "yes" : "no"}</p><p>Response mode: {responseDetails.responseMode ?? "n/a"}</p><p>RAG used as: {responseDetails.ragUsedAs ?? "n/a"}</p><p>Blocked model guess: {responseDetails.blockedModelGuess ? "yes" : "no"}</p><p>RAG query used: {responseDetails.ragQueryUsed ?? "n/a"}</p><p>RAG mode used: {responseDetails.ragModeUsed ?? "n/a"}</p><p>RAG topK used: {responseDetails.ragTopKUsed ?? "n/a"}</p>{responseDetails.ragSources && responseDetails.ragSources.length > 0 && <div className="mt-2"><p className="font-semibold text-slate-200">RAG sources</p><ul className="list-disc pl-5 text-slate-300">{responseDetails.ragSources.map((source) => <li key={`${source.documentPath}-${source.chunks.length}`}>{source.documentName || source.documentPath} ({source.chunks.length} chunks)</li>)}</ul></div>}{responseDetails.warnings?.length ? <div className="mt-2 space-y-1 text-yellow-300">{responseDetails.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}</div>}</div>}
  </section>;
}
