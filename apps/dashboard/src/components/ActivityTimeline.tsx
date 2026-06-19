import { useCallback, useEffect, useState } from "react";
import { api, type CommandActivity } from "../lib/api";

export function ActivityTimeline({ compact = false }: { compact?: boolean }) {
  const [events, setEvents] = useState<CommandActivity[]>([]); const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => { try { setEvents(await api.commandActivity(compact ? 8 : 50)); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "Activity unavailable."); } }, [compact]);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="panel"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Local audit trail</p><h2 className="section-title">Recent activity</h2></div><button className="button" onClick={() => void refresh()}>Refresh</button></div>{error && <p className="notice">{error}</p>}<div className="mt-5 divide-y divide-white/[.06]">{events.length === 0 && <div className="empty">No activity recorded yet.</div>}{events.map((event, index) => <article className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr_auto] sm:items-start" key={`${event.type}-${event.id}-${index}`}><span className="badge">{event.type.replace("_", " ")}</span><div><p className="m-0 text-sm font-medium text-slate-200">{event.title}</p><p className="mb-0 mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{event.message}</p></div><div className="text-right"><p className="meta mt-0">{event.status}</p><time className="font-mono text-[9px] text-slate-700">{new Date(event.timestamp).toLocaleString()}</time></div></article>)}</div></section>;
}
