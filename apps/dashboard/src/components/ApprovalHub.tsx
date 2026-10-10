import { useCallback, useEffect, useState } from "react";
import { api, type CommandApprovals } from "../lib/api";
import {
  learningApi,
  type LearningConfidence,
  type LearningProposal,
  type LearningScope,
  type LearningSensitivity,
} from "../lib/learning";

const button = "border border-signal/30 bg-signal/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-signal hover:bg-signal/10 disabled:opacity-40";
const danger = "border border-red-300/20 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-red-200 hover:bg-red-300/5 disabled:opacity-40";
const subtle = "border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-slate-300 hover:bg-white/[.04] disabled:opacity-40";

const confidenceValues: LearningConfidence[] = ["confirmed", "high", "moderate", "low", "unverified", "disputed"];
const sensitivityValues: LearningSensitivity[] = ["public", "internal", "project-restricted", "private"];
const scopeValues: LearningScope[] = ["global", "project", "client", "business", "personal"];

type EditDraft = {
  title: string;
  proposedKnowledge: string;
  whyItMatters: string;
  confidence: LearningConfidence;
  sensitivity: LearningSensitivity;
  scope: LearningScope;
};

function draftFrom(item: LearningProposal): EditDraft {
  return {
    title: item.title,
    proposedKnowledge: item.proposedKnowledge,
    whyItMatters: item.whyItMatters,
    confidence: item.confidence,
    sensitivity: item.sensitivity,
    scope: item.scope,
  };
}

export function ApprovalHub({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<CommandApprovals | null>(null);
  const [learning, setLearning] = useState<LearningProposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const refresh = useCallback(async () => {
    const [approvals, proposals] = await Promise.all([
      api.commandApprovals(),
      learningApi.proposals("pending"),
    ]);
    setData(approvals);
    setLearning(proposals);
  }, []);

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Approval queue unavailable."));
  }, [refresh]);

  async function act(key: string, action: () => Promise<unknown>, notice: string) {
    setBusy(key);
    setMessage(null);
    try {
      await action();
      await refresh();
      onChanged?.();
      setMessage(notice);
    } catch (error) {
      const actionMessage = error instanceof Error ? error.message : "Approval action failed.";
      // A tool request is one-shot. Failed/blocked runs update the backend request
      // status away from "approved"; refresh even when the action throws so the
      // UI never leaves a stale Run approved button for a request that cannot be
      // claimed again.
      try {
        await refresh();
        onChanged?.();
      } catch {
        // Preserve the original action failure; the manual Refresh button remains available.
      }
      setMessage(actionMessage);
    } finally {
      setBusy(null);
    }
  }

  async function saveRevision(item: LearningProposal) {
    if (!editDraft) return;
    await act(
      `me-${item.id}`,
      () => learningApi.revise(item.id, editDraft),
      "Learning Proposal revised; the edited version still requires approval.",
    );
    setEditingId(null);
    setEditDraft(null);
  }

  const memories = compact ? learning.slice(0, 3) : learning;
  const tools = compact ? data?.toolRequests.slice(0, 3) : data?.toolRequests;
  const total = learning.length + (data?.toolRequests.length ?? 0);

  return <section className="panel">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="eyebrow">Human checkpoint</p>
        <h2 className="section-title">Approval hub</h2>
        <p className="section-copy">Learning becomes durable only after approval. Remote Ops actions execute automatically only after you explicitly approve the exact requested action.</p>
      </div>
      <button className={button} onClick={() => void refresh()}>Refresh</button>
    </div>

    {message && <p className="notice">{message}</p>}

    <div className="mt-5 space-y-3">
      {!total && <div className="empty">Approval queue clear.</div>}

      {memories.map((item) => {
        const editing = editingId === item.id && editDraft;
        return <article className="queue-item" key={`m-${item.id}`}>
          <div className="flex justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold text-white">{item.title}</p>
              <p className="meta">Learning · {item.category} · {item.projectKey ?? "global"}</p>
            </div>
            <span className="badge badge-warn">Pending</span>
          </div>

          {editing ? <div className="mt-4 space-y-3">
            <input className="field" value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} />
            <textarea className="field min-h-28" value={editDraft.proposedKnowledge} onChange={(event) => setEditDraft({ ...editDraft, proposedKnowledge: event.target.value })} />
            <textarea className="field min-h-20" placeholder="Why this is worth remembering" value={editDraft.whyItMatters} onChange={(event) => setEditDraft({ ...editDraft, whyItMatters: event.target.value })} />
            <div className="grid gap-2 sm:grid-cols-3">
              <select className="field" value={editDraft.scope} onChange={(event) => setEditDraft({ ...editDraft, scope: event.target.value as LearningScope })}>{scopeValues.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <select className="field" value={editDraft.sensitivity} onChange={(event) => setEditDraft({ ...editDraft, sensitivity: event.target.value as LearningSensitivity })}>{sensitivityValues.map((value) => <option key={value} value={value}>{value}</option>)}</select>
              <select className="field" value={editDraft.confidence} onChange={(event) => setEditDraft({ ...editDraft, confidence: event.target.value as LearningConfidence })}>{confidenceValues.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={button} disabled={!!busy || !editDraft.title.trim() || !editDraft.proposedKnowledge.trim()} onClick={() => void saveRevision(item)}>Save revision</button>
              <button className={subtle} disabled={!!busy} onClick={() => { setEditingId(null); setEditDraft(null); }}>Cancel</button>
            </div>
          </div> : <>
            {item.noticed && <p className="mt-3 text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-300">Noticed:</span> {item.noticed}</p>}
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-slate-300">{item.proposedKnowledge}</p>
            <p className="mt-3 text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-300">Why it matters:</span> {item.whyItMatters || "No reason supplied."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="badge">scope: {item.scope}</span>
              <span className="badge">sensitivity: {item.sensitivity}</span>
              <span className="badge">confidence: {item.confidence}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={button} disabled={!!busy} onClick={() => void act(`ma-${item.id}`, () => learningApi.approve(item.id), "Learning approved and committed to durable memory.")}>Approve</button>
              <button className={subtle} disabled={!!busy} onClick={() => { setEditingId(item.id); setEditDraft(draftFrom(item)); }}>Edit</button>
              <button className={danger} disabled={!!busy} onClick={() => void act(`mr-${item.id}`, () => learningApi.reject(item.id), "Learning Proposal rejected; no durable memory was created.")}>Reject</button>
            </div>
          </>}
        </article>;
      })}

      {tools?.map((item) => {
        const remoteOpsAction = item.requestedBy.startsWith("remote-ops:");
        return <article className="queue-item" key={`t-${item.id}`}>
          <div className="flex justify-between gap-3"><div><p className="m-0 text-sm font-semibold text-white">{item.title}</p><p className="meta">Tool · {item.toolKey} · {item.riskLevel}{remoteOpsAction ? " · Remote Ops" : ""}</p></div><span className={`badge ${item.status === "approved" || item.status === "completed" ? "badge-ok" : "badge-warn"}`}>{item.status}</span></div>
          <p className="mb-0 mt-2 text-sm text-slate-400">{item.description || "No description."}</p>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-300">{JSON.stringify(item.args, null, 2)}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            {item.status === "pending" && <>
              <button className={button} disabled={!!busy} onClick={() => void act(`ta-${item.id}`, () => api.approveToolRequest(item.id), remoteOpsAction ? "Approved. Remote Ops will execute this exact governed action automatically." : "Tool request approved; it has not run.")}>Approve</button>
              <button className={danger} disabled={!!busy} onClick={() => void act(`tr-${item.id}`, () => api.rejectToolRequest(item.id), "Tool request rejected.")}>Reject</button>
            </>}
            {item.status === "approved" && (remoteOpsAction ? <span className="meta mt-0">Approved — Remote Ops is claiming this action automatically.</span> : <button className={button} disabled={!!busy} onClick={() => void act(`run-${item.id}`, () => api.runToolRequest(item.id), "Approved request ran.")}>Run approved</button>)}
            {(item.status === "blocked" || item.status === "failed") && <span className="meta mt-0">This one-shot request finished {item.status}; create a new request after correcting the cause.</span>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}
