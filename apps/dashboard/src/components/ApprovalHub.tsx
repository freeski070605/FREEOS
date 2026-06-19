import { useCallback, useEffect, useState } from "react";
import { api, type CommandApprovals } from "../lib/api";

const button = "border border-signal/30 bg-signal/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-signal hover:bg-signal/10 disabled:opacity-40";
const danger = "border border-red-300/20 px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] text-red-200 hover:bg-red-300/5 disabled:opacity-40";

export function ApprovalHub({ compact = false, onChanged }: { compact?: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<CommandApprovals | null>(null); const [busy, setBusy] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => { setData(await api.commandApprovals()); }, []);
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Approval queue unavailable.")); }, [refresh]);
  async function act(key: string, action: () => Promise<unknown>, notice: string) { setBusy(key); setMessage(null); try { await action(); await refresh(); onChanged?.(); setMessage(notice); } catch (error) { setMessage(error instanceof Error ? error.message : "Approval action failed."); } finally { setBusy(null); } }
  const memories = compact ? data?.memoryProposals.slice(0, 3) : data?.memoryProposals; const tools = compact ? data?.toolRequests.slice(0, 3) : data?.toolRequests;
  return <section className="panel">
    <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Human checkpoint</p><h2 className="section-title">Approval hub</h2><p className="section-copy">Approval never runs a tool. Running remains a separate click.</p></div><button className={button} onClick={() => void refresh()}>Refresh</button></div>
    {message && <p className="notice">{message}</p>}
    <div className="mt-5 space-y-3">
      {!data?.total && <div className="empty">Approval queue clear.</div>}
      {memories?.map((item) => <article className="queue-item" key={`m-${item.id}`}><div className="flex justify-between gap-3"><div><p className="m-0 text-sm font-semibold text-white">{item.title}</p><p className="meta">Memory · {item.category} · {item.projectKey ?? "global"}</p></div><span className="badge badge-warn">Pending</span></div><p className="mb-0 mt-2 text-sm text-slate-400">{item.content}</p><div className="mt-3 flex gap-2"><button className={button} disabled={!!busy} onClick={() => void act(`ma-${item.id}`, () => api.approveProposal(item.id), "Memory approved.")}>Approve</button><button className={danger} disabled={!!busy} onClick={() => void act(`mr-${item.id}`, () => api.rejectProposal(item.id), "Memory rejected.")}>Reject</button></div></article>)}
      {tools?.map((item) => <article className="queue-item" key={`t-${item.id}`}><div className="flex justify-between gap-3"><div><p className="m-0 text-sm font-semibold text-white">{item.title}</p><p className="meta">Tool · {item.toolKey} · {item.riskLevel}</p></div><span className={`badge ${item.status === "approved" ? "badge-ok" : "badge-warn"}`}>{item.status}</span></div><p className="mb-0 mt-2 text-sm text-slate-400">{item.description || "No description."}</p><div className="mt-3 flex flex-wrap gap-2">{item.status === "pending" && <><button className={button} disabled={!!busy} onClick={() => void act(`ta-${item.id}`, () => api.approveToolRequest(item.id), "Tool request approved; it has not run.")}>Approve</button><button className={danger} disabled={!!busy} onClick={() => void act(`tr-${item.id}`, () => api.rejectToolRequest(item.id), "Tool request rejected.")}>Reject</button></>}{item.status === "approved" && <button className={button} disabled={!!busy} onClick={() => void act(`run-${item.id}`, () => api.runToolRequest(item.id), "Approved request ran.")}>Run approved</button>}</div></article>)}
    </div>
  </section>;
}
