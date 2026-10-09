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

type IntentKey = "ask" | "plan" | "create" | "diagnose" | "files" | "remember";

const creativeRequest = /\b(hook|verse|bridge|song|caption|scene|story|script|monologue|rewrite|creative|lyrics?)\b/i;
const intentPresets: Array<{ key: IntentKey; label: string; description: string; starter: string }> = [
  { key: "ask", label: "Ask", description: "Explain, compare, or answer", starter: "Help me understand " },
  { key: "plan", label: "Plan", description: "Turn a goal into steps", starter: "Build me a practical plan for " },
  { key: "create", label: "Create", description: "Write or design something", starter: "Create " },
  { key: "diagnose", label: "Diagnose", description: "Figure out what is wrong", starter: "Help me diagnose this problem: " },
  { key: "files", label: "Use my files", description: "Pull from indexed local documents", starter: "Using my indexed documents, help me with " },
  { key: "remember", label: "Remember", description: "Propose something for memory", starter: "Remember that " },
];

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function sources(value: unknown): RagSource[] {
  return Array.isArray(value)
    ? value.filter((item): item is RagSource => Boolean(item) && typeof item === "object" && typeof item.documentPath === "string")
    : [];
}

export function ChatPanel({ projects, onApprovalCreated }: { projects: Project[]; onApprovalCreated?: () => void }) {
  const [message, setMessage] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [responseText, setResponseText] = useState("");
  const [responseDetails, setResponseDetails] = useState<ResponseDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState("");
  const [options, setOptions] = useState({
    useMemory: true,
    useProjectNotes: true,
    useResearchContext: false,
    allowToolSuggestions: true,
    speak: false,
    useRag: false,
  });
  const [ragMode, setRagMode] = useState<RagMode>("hybrid");
  const [ragTopK, setRagTopK] = useState(8);
  const [modelMode, setModelMode] = useState<ModelMode>("standard");
  const [responseModeOverride, setResponseModeOverride] = useState<ResponseMode | null>(null);
  const [recentAssistantResponses, setRecentAssistantResponses] = useState<string[]>([]);
  const requestController = useRef<AbortController | null>(null);
  const responseMode: ResponseMode = responseModeOverride ?? (creativeRequest.test(message) ? "creative" : "precise");
  const selectedProject = projects.find((project) => project.projectKey === projectKey);

  useEffect(() => {
    if (!busy) {
      setWaitingMessage("");
      return;
    }
    setWaitingMessage("FREEOS is thinking locally…");
    const timers = [
      window.setTimeout(() => setWaitingMessage("Still working locally. Larger answers can take a little longer."), 20_000),
      window.setTimeout(() => setWaitingMessage("Still working. You can cancel or switch to Quick next time."), 60_000),
      window.setTimeout(() => setWaitingMessage("The local model is taking longer than usual. You can cancel safely."), 120_000),
    ];
    return () => timers.forEach(window.clearTimeout);
  }, [busy]);

  function applyIntent(key: IntentKey, starter: string) {
    if (key === "files") setOptions((current) => ({ ...current, useRag: true }));
    if (key === "create") setResponseModeOverride("creative");
    setMessage((current) => current.trim() ? current : starter);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        message,
        projectKey: projectKey || undefined,
        ragMode,
        ragTopK,
        modelMode,
        responseMode,
        recentAssistantResponses,
        ...options,
      };
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
        setError("Request cancelled. Nothing was executed.");
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
        setError(reason instanceof Error ? reason.message : "FREEOS could not complete the request.");
      }
    } finally {
      if (requestController.current === controller) requestController.current = null;
      setBusy(false);
    }
  }

  function cancelRequest() {
    requestController.current?.abort();
  }

  return (
    <section className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="eyebrow">FREEOS Operator</p>
            <h2 className="section-title">Tell FREEOS what you want done.</h2>
            <p className="section-copy max-w-3xl">
              You do not need to understand RAG, topK, model names, or internal routing. Start in plain English. FREEOS automatically checks approved knowledge and Skill Academy guidance when it is relevant.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="badge badge-ok">Local AI</span>
            <span className="badge badge-safe">Skill Academy automatic</span>
            <span className="badge">Writes still need approval</span>
          </div>
        </div>

        <div className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          {intentPresets.map((intent) => (
            <button
              type="button"
              key={intent.key}
              onClick={() => applyIntent(intent.key, intent.starter)}
              className="border border-white/10 bg-black/15 p-3 text-left transition hover:border-signal/30 hover:bg-signal/[.04]"
            >
              <p className="m-0 text-sm font-semibold text-white">{intent.label}</p>
              <p className="mb-0 mt-1 text-xs leading-5 text-slate-500">{intent.description}</p>
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <textarea
            className="field min-h-44 resize-y text-base leading-7"
            required
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Example: Price this six-hour event job so I protect my time and still stay competitive."
          />

          <div className="grid gap-3 md:grid-cols-[1fr_13rem_13rem]">
            <label className="label">
              What are we working on?
              <select className="field mt-2" value={projectKey} onChange={(event) => setProjectKey(event.target.value)}>
                <option value="">General — no project needed</option>
                {projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}
              </select>
            </label>
            <label className="label">
              Answer speed
              <select className="field mt-2" value={modelMode} onChange={(event) => setModelMode(event.target.value as ModelMode)}>
                <option value="standard">Best answer</option>
                <option value="fast">Quick answer</option>
              </select>
            </label>
            <label className="label">
              Answer style
              <select
                className="field mt-2"
                value={responseModeOverride ?? "auto"}
                onChange={(event) => setResponseModeOverride(event.target.value === "auto" ? null : event.target.value as ResponseMode)}
              >
                <option value="auto">Automatic</option>
                <option value="precise">Direct / precise</option>
                <option value="balanced">Balanced</option>
                <option value="creative">Creative</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="button px-5" disabled={busy}>{busy ? "FREEOS is working…" : "Run request"}</button>
            {busy && <button type="button" className="button border-red-400/40 text-red-200" onClick={cancelRequest}>Cancel</button>}
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={options.useRag} onChange={(event) => setOptions((current) => ({ ...current, useRag: event.target.checked }))} />
              Use indexed local files
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={options.speak} onChange={(event) => setOptions((current) => ({ ...current, speak: event.target.checked }))} />
              Speak answer
            </label>
          </div>
          {busy && <p className="mb-0 text-sm text-slate-400">{waitingMessage}</p>}
        </form>
      </section>

      <div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]">
        <section className="panel">
          <p className="eyebrow">What FREEOS will use</p>
          <h3 className="section-title text-lg">Request context</h3>
          <div className="mt-4 space-y-3 text-sm text-slate-400">
            <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-3"><span>Skill Academy</span><span className="text-signal">Automatic when relevant</span></div>
            <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-3"><span>Approved memory</span><span>{options.useMemory ? "On" : "Off"}</span></div>
            <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-3"><span>Project knowledge</span><span>{projectKey && options.useProjectNotes ? selectedProject?.name ?? "On" : "Not selected"}</span></div>
            <div className="flex items-start justify-between gap-4 border-b border-white/[.06] pb-3"><span>Indexed documents</span><span>{options.useRag ? "On" : "Off"}</span></div>
            <div className="flex items-start justify-between gap-4"><span>Actions</span><span>Suggest / queue only</span></div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-600">If FREEOS wants to write or run something approval-gated, it should create a request instead of silently doing it.</p>

          <details className="mt-5 border-t border-white/[.07] pt-4">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[.14em] text-slate-400">Advanced controls</summary>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-3 text-xs text-slate-400"><input type="checkbox" checked={options.useMemory} onChange={(event) => setOptions((current) => ({ ...current, useMemory: event.target.checked }))} />Use approved memory</label>
              <label className="flex items-center gap-3 text-xs text-slate-400"><input type="checkbox" checked={options.useProjectNotes} onChange={(event) => setOptions((current) => ({ ...current, useProjectNotes: event.target.checked }))} />Use project notes when a project is selected</label>
              <label className="flex items-center gap-3 text-xs text-slate-400"><input type="checkbox" checked={options.useResearchContext} onChange={(event) => setOptions((current) => ({ ...current, useResearchContext: event.target.checked }))} />Include recent research-session history</label>
              <label className="flex items-center gap-3 text-xs text-slate-400"><input type="checkbox" checked={options.allowToolSuggestions} onChange={(event) => setOptions((current) => ({ ...current, allowToolSuggestions: event.target.checked }))} />Allow tool suggestions / approval requests</label>
              {options.useRag && <div className="grid gap-3 sm:grid-cols-2"><label className="label">File search method<select className="field mt-2" value={ragMode} onChange={(event) => setRagMode(event.target.value as RagMode)}><option value="hybrid">Hybrid — recommended</option><option value="keyword">Keyword only</option><option value="embeddings">Semantic only</option></select></label><label className="label">How many file matches?<input className="field mt-2" type="number" min={1} max={20} value={ragTopK} onChange={(event) => setRagTopK(Math.min(20, Math.max(1, Number(event.target.value) || 8)))} /></label></div>}
            </div>
          </details>
        </section>

        <section className="panel">
          <p className="eyebrow">How to operate FREEOS</p>
          <h3 className="section-title text-lg">Use it like an operator, not a settings panel.</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="queue-item"><p className="m-0 text-sm font-semibold text-white">1. Say the outcome</p><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">“Build the quote.” “Diagnose this.” “Edit this plan.” “Tell me the next move.”</p></div>
            <div className="queue-item"><p className="m-0 text-sm font-semibold text-white">2. Pick a project only when it matters</p><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">Project selection adds its governed context. Leave it on General for normal questions.</p></div>
            <div className="queue-item"><p className="m-0 text-sm font-semibold text-white">3. Add files only when you need them</p><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">Turn on indexed files when the answer should come from local documents. Skill Academy does not need this switch.</p></div>
            <div className="queue-item"><p className="m-0 text-sm font-semibold text-white">4. Approve actions separately</p><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">Thinking is immediate. Governed writes and actions remain separate so you can see what FREEOS is about to do.</p></div>
          </div>
        </section>
      </div>

      {error && <p className="notice">{error}</p>}

      {responseText && <section className="panel border-electric/20 bg-electric/[.03]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow text-electric">FREEOS answer</p><h3 className="section-title text-lg">Result</h3></div><div className="flex flex-wrap gap-2"><span className="badge badge-safe">Skills auto</span>{responseDetails?.memoryUsed && <span className="badge">Memory on</span>}{responseDetails?.projectNotesUsed && <span className="badge">Project context on</span>}{responseDetails?.ragUsed && <span className="badge badge-ok">Indexed files used</span>}</div></div>
        <p className="mb-0 mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-300">{responseText}</p>

        {responseDetails?.warnings?.length ? <div className="mt-5 border border-amber-300/20 bg-amber-300/[.04] p-3 text-sm text-amber-200">{responseDetails.warnings.map((warning) => <p className="m-0 + mt-1" key={warning}>{warning}</p>)}</div> : null}

        {responseDetails && <details className="mt-5 border-t border-white/[.07] pt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[.14em] text-slate-500">Technical details</summary>
          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
            <p className="m-0">Response mode: {responseDetails.responseMode ?? responseMode}</p>
            <p className="m-0">Indexed files requested: {responseDetails.ragRequested ? "yes" : "no"}</p>
            <p className="m-0">Indexed files used: {responseDetails.ragUsed ? "yes" : "no"}</p>
            <p className="m-0">Search method: {responseDetails.ragModeUsed ?? "n/a"}</p>
            <p className="m-0">Matches requested: {responseDetails.ragTopKUsed ?? "n/a"}</p>
            <p className="m-0">Model guess blocked: {responseDetails.blockedModelGuess ? "yes" : "no"}</p>
          </div>
          {responseDetails.ragSources && responseDetails.ragSources.length > 0 && <div className="mt-4"><p className="meta mt-0">Indexed sources</p><ul className="mt-2 list-disc pl-5 text-xs text-slate-500">{responseDetails.ragSources.map((source) => <li key={`${source.documentPath}-${source.chunks.length}`}>{source.documentName || source.documentPath} ({source.chunks.length} chunks)</li>)}</ul></div>}
        </details>}
      </section>}
    </section>
  );
}
