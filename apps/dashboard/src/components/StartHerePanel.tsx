import { useEffect, useState } from "react";
import type { CommandStatus, Project } from "../lib/api";
import { skillApi, type SkillAcademyStatus } from "../lib/skillApi";

type NavTarget = "chat" | "projects" | "skills" | "research" | "memory" | "guide" | "command" | "tools";

export function StartHerePanel({
  status,
  projects,
  onNavigate,
}: {
  status: CommandStatus | null;
  projects: Project[];
  onNavigate: (target: NavTarget) => void;
}) {
  const [skills, setSkills] = useState<SkillAcademyStatus | null>(null);

  useEffect(() => {
    void skillApi.status().then(setSkills).catch(() => setSkills(null));
  }, []);

  const actions: Array<{ target: NavTarget; title: string; copy: string; icon: string; badge: string }> = [
    { target: "chat", title: "Ask FREEOS", copy: "Planning, writing, problem-solving, project help, and skill-guided advice.", icon: "01", badge: "Most common" },
    { target: "projects", title: "Work on a project", copy: "Open DFB project context, notes, and project-specific knowledge.", icon: "02", badge: `${projects.length} projects` },
    { target: "research", title: "Research something current", copy: "Use this when facts may have changed and need fresh verification.", icon: "03", badge: status?.research.searxngOnline ? "Research online" : "Research offline" },
    { target: "skills", title: "See what FREEOS knows how to do", copy: "Browse trained skills, mastery, risk level, practice, and real-work learning.", icon: "04", badge: `${skills?.competencies ?? 0} skills` },
    { target: "memory", title: "Review knowledge & approvals", copy: "Approve durable memories and review pending write/tool requests.", icon: "05", badge: `${status?.approvals.total ?? 0} pending` },
    { target: "guide", title: "How do I use this?", copy: "Plain-English workflows for every major part of FREEOS.", icon: "06", badge: "Guide" },
  ];

  return (
    <div className="space-y-5">
      <section className="overflow-hidden border border-signal/20 bg-gradient-to-br from-signal/[.08] via-panel/80 to-electric/[.05] p-6 md:p-8">
        <p className="eyebrow">Start here</p>
        <div className="grid gap-6 xl:grid-cols-[1.35fr_.65fr] xl:items-end">
          <div>
            <h2 className="m-0 max-w-3xl text-3xl font-black tracking-[-.04em] text-white md:text-5xl">Tell FREEOS what you want done. Pick the lane that matches the job.</h2>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-400 md:text-base">You should not need to understand the architecture to use the system. Chat is for thinking and planning. Projects add DFB context. Research verifies changing facts. Skills are practical training. Knowledge & Approvals controls what becomes durable or gets permission to act.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div className="border border-white/10 bg-black/20 p-4"><p className="meta mt-0">Local brain</p><p className="mb-0 mt-2 text-lg font-bold text-white">{status?.ollama.connected ? "Ready" : "Offline"}</p><p className="mb-0 mt-1 text-xs text-slate-500">{status?.ollama.defaultModel ?? "Ollama"}</p></div>
            <div className="border border-white/10 bg-black/20 p-4"><p className="meta mt-0">Safety</p><p className="mb-0 mt-2 text-lg font-bold text-signal">Locked</p><p className="mb-0 mt-1 text-xs text-slate-500">High-risk actions blocked; writes require approval.</p></div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="eyebrow">What do you want to do?</p><h2 className="section-title">Use these six doors first</h2></div>
          <button className="button" onClick={() => onNavigate("guide")}>Open full guide</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <button key={action.target} onClick={() => onNavigate(action.target)} className="group border border-white/10 bg-panel/80 p-5 text-left transition hover:border-signal/30 hover:bg-signal/[.04]">
              <div className="flex items-center justify-between gap-3"><span className="font-mono text-xs font-bold text-signal">{action.icon}</span><span className="badge">{action.badge}</span></div>
              <h3 className="mb-0 mt-5 text-lg font-bold text-white group-hover:text-signal">{action.title}</h3>
              <p className="mb-0 mt-2 text-sm leading-6 text-slate-500">{action.copy}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <section className="panel">
          <p className="eyebrow">The FREEOS workflow</p>
          <h2 className="section-title">What happens after you ask for something</h2>
          <div className="mt-5 grid gap-2 md:grid-cols-5">
            {[
              ["1", "Ask", "You describe the goal."],
              ["2", "Ground", "FREEOS uses approved context, skills, project knowledge, or fresh research."],
              ["3", "Plan", "It reasons and proposes the safest useful next move."],
              ["4", "Approve", "Writes or controlled actions wait for your approval."],
              ["5", "Learn", "Useful outcomes can become governed knowledge or skill practice."],
            ].map(([n, title, copy]) => (
              <div key={n} className="border border-white/[.07] bg-black/10 p-3.5"><span className="font-mono text-xs text-signal">{n}</span><p className="mb-0 mt-3 text-sm font-semibold text-white">{title}</p><p className="mb-0 mt-1 text-xs leading-5 text-slate-500">{copy}</p></div>
            ))}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Know the difference</p>
          <h2 className="section-title">Four kinds of intelligence</h2>
          <div className="mt-5 space-y-2 text-sm">
            <div className="queue-item"><strong className="text-white">Knowledge</strong><span className="text-slate-500"> — stable approved facts, decisions, and project baselines.</span></div>
            <div className="queue-item"><strong className="text-white">Current Intelligence</strong><span className="text-slate-500"> — fresh facts that can expire or change.</span></div>
            <div className="queue-item"><strong className="text-white">Skills</strong><span className="text-slate-500"> — procedures, heuristics, failure modes, drills, and demonstrated mastery.</span></div>
            <div className="queue-item"><strong className="text-white">Memory</strong><span className="text-slate-500"> — durable approved user/project context, not a dumping ground for everything FREEOS sees.</span></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">System at a glance</p><h2 className="section-title">What is ready right now</h2></div><button className="button" onClick={() => onNavigate("command")}>Detailed system view</button></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MiniStat label="Projects" value={String(projects.length)} detail="registered" />
          <MiniStat label="Skills" value={String(skills?.competencies ?? 0)} detail={`${skills?.activeTrainingUnits ?? 0} training units`} />
          <MiniStat label="Practice" value={String(skills?.practiceSessions ?? 0)} detail={`${skills?.evaluatedSessions ?? 0} evaluated`} />
          <MiniStat label="Approved memory" value={String(status?.memory.approvedMemories ?? 0)} detail={`${status?.memory.pendingProposals ?? 0} pending`} />
          <MiniStat label="Approvals" value={String(status?.approvals.total ?? 0)} detail="need your decision" />
        </div>
      </section>
    </div>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="border border-white/[.07] bg-black/10 p-4"><p className="meta mt-0">{label}</p><p className="mb-0 mt-2 text-2xl font-black text-white">{value}</p><p className="mb-0 mt-1 text-xs text-slate-600">{detail}</p></div>;
}
