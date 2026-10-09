import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { AgentsPanel } from "../components/AgentsPanel";
import { ApprovalHub } from "../components/ApprovalHub";
import { AutomationPanel } from "../components/AutomationPanel";
import { BackupPanel } from "../components/BackupPanel";
import { BrowserPanel } from "../components/BrowserPanel";
import { ChatPanel } from "../components/ChatPanel";
import { CodingPanel } from "../components/CodingPanel";
import { ComputerPanel } from "../components/ComputerPanel";
import { GuidePanel } from "../components/GuidePanel";
import { ResearchPanel } from "../components/ResearchPanel";
import { SchedulerPanel } from "../components/SchedulerPanel";
import { SkillAcademyPanel } from "../components/SkillAcademyPanel";
import { StartHerePanel } from "../components/StartHerePanel";
import { StatusCard } from "../components/StatusCard";
import { ToolRunnerPanel } from "../components/ToolRunnerPanel";
import { VoicePanel } from "../components/VoicePanel";
import { api, type ApprovedMemory, type CommandStatus, type MemoryProposal, type Project, type ProjectNote } from "../lib/api";

type Tab =
  | "home"
  | "chat"
  | "projects"
  | "skills"
  | "research"
  | "memory"
  | "guide"
  | "command"
  | "agents"
  | "scheduler"
  | "browser"
  | "coding"
  | "computer"
  | "voice"
  | "tools"
  | "automations"
  | "activity"
  | "settings";

type TabSpec = [Tab, string, string];

const everydayTabs: TabSpec[] = [
  ["home", "Start Here", "⌂"],
  ["chat", "Ask FREEOS", "◌"],
  ["projects", "Projects", "▦"],
  ["skills", "Skill Academy", "◆"],
  ["research", "Research", "⌕"],
  ["memory", "Knowledge & Approvals", "◇"],
  ["guide", "How to Use FREEOS", "?"],
];

const advancedTabs: TabSpec[] = [
  ["command", "System Overview", "⌁"],
  ["agents", "Agents", "A"],
  ["scheduler", "Scheduler", "S"],
  ["browser", "Browser", "◎"],
  ["coding", "Coding", "</>"],
  ["computer", "Computer", "▣"],
  ["voice", "Voice", "◉"],
  ["tools", "Tools", "⌘"],
  ["automations", "Automations", "↻"],
  ["activity", "Activity", "≋"],
  ["settings", "Backups & Settings", "⚙"],
];

const allTabs = [...everydayTabs, ...advancedTabs];

function MemoryPanel({ projects, onChanged }: { projects: Project[]; onChanged: () => void }) {
  const [statusFilter, setStatusFilter] = useState<"pending" | "rejected">("pending");
  const [proposals, setProposals] = useState<MemoryProposal[]>([]);
  const [memories, setMemories] = useState<ApprovedMemory[]>([]);
  const [q, setQ] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: "", content: "", category: "general", projectKey: "", tags: "" });

  const refresh = useCallback(async () => {
    const settled = await Promise.allSettled([api.proposals(statusFilter), api.memories(q, projectKey)]);
    if (settled[0].status === "fulfilled") setProposals(settled[0].value);
    if (settled[1].status === "fulfilled") setMemories(settled[1].value);
    const failure = settled.find((item) => item.status === "rejected");
    setNotice(failure?.status === "rejected" ? (failure.reason instanceof Error ? failure.reason.message : "Memory data unavailable.") : null);
  }, [statusFilter, q, projectKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      await api.createProposal({
        ...draft,
        projectKey: draft.projectKey || undefined,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setDraft({ title: "", content: "", category: "general", projectKey: "", tags: "" });
      await refresh();
      setNotice("Proposal added; approval is still required.");
      onChanged();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Memory proposal failed.");
    }
  }

  return (
    <div className="space-y-4">
      <section className="border border-electric/20 bg-electric/[.04] p-5">
        <p className="eyebrow">What this area is for</p>
        <h2 className="section-title">Durable knowledge and approvals</h2>
        <p className="section-copy">Use this when something should become approved long-term context, or when FREEOS has a pending action that needs your decision. Reading something does not automatically turn it into memory.</p>
      </section>
      <ApprovalHub onChanged={() => { void refresh(); onChanged(); }} />
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <p className="eyebrow">Approved context</p>
          <h2 className="section-title">Memory search</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_12rem]">
            <input className="field" placeholder="Search approved memory" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="field" value={projectKey} onChange={(e) => setProjectKey(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}
            </select>
          </div>
          <div className="mt-4 space-y-2">
            {memories.map((item) => <article className="queue-item" key={item.id}><p className="m-0 text-sm font-semibold text-white">{item.title}</p><p className="meta">{item.category} · {item.projectKey ?? "global"} · {item.tags.join(" · ")}</p><p className="mb-0 mt-2 text-sm text-slate-400">{item.content}</p></article>)}
            {!memories.length && <div className="empty">No approved memories match.</div>}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Suggest durable context</p>
          <h2 className="section-title">Add memory proposal</h2>
          {notice && <p className="notice">{notice}</p>}
          <form className="mt-5 space-y-3" onSubmit={submit}>
            <input className="field" required placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <textarea className="field min-h-28" required placeholder="What should FREEOS remember?" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="field" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>{["general", "fact", "preference", "decision", "project", "reference", "research"].map((item) => <option key={item}>{item}</option>)}</select>
              <select className="field" value={draft.projectKey} onChange={(e) => setDraft({ ...draft, projectKey: e.target.value })}><option value="">Global</option>{projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}</select>
            </div>
            <input className="field" placeholder="Tags, comma-separated" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            <button className="button">Add to approval queue</button>
          </form>
          <div className="mt-6 flex items-center justify-between"><p className="meta">Proposal history</p><select className="field max-w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "pending" | "rejected")}><option value="pending">Pending</option><option value="rejected">Rejected</option></select></div>
          <p className="mt-3 text-xs text-slate-500">{proposals.length} {statusFilter} proposal(s)</p>
        </section>
      </div>
    </div>
  );
}

function ProjectsPanel({ projects, onChanged }: { projects: Project[]; onChanged: () => void }) {
  const [projectKey, setProjectKey] = useState(projects[0]?.projectKey ?? "");
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [draft, setDraft] = useState({ title: "", content: "", tags: "" });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { if (!projectKey && projects[0]) setProjectKey(projects[0].projectKey); }, [projectKey, projects]);
  useEffect(() => {
    if (projectKey) void api.notes(projectKey).then((value) => { setNotes(value); setNotice(null); }).catch((reason) => setNotice(reason instanceof Error ? reason.message : "Project notes unavailable."));
  }, [projectKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    try {
      await api.createNote(projectKey, { title: draft.title, content: draft.content, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
      setDraft({ title: "", content: "", tags: "" });
      setNotes(await api.notes(projectKey));
      onChanged();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "Project note could not be saved.");
    }
  }

  if (notice) return <section className="panel"><p className="eyebrow">Project knowledge</p><h2 className="section-title">Project panel unavailable</h2><p className="notice">{notice}</p><button className="button mt-4" onClick={() => { setNotice(null); if (projectKey) void api.notes(projectKey).then(setNotes).catch((reason) => setNotice(reason instanceof Error ? reason.message : "Project notes unavailable.")); }}>Retry</button></section>;

  return (
    <div className="space-y-4">
      <section className="border border-electric/20 bg-electric/[.04] p-5">
        <p className="eyebrow">Project-scoped work</p>
        <h2 className="section-title">Pick the project before you add project-specific context</h2>
        <p className="section-copy">Use Projects for facts, notes, decisions, and working context that belong to one project. Use global memory only when the information should matter across projects.</p>
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => <button onClick={() => setProjectKey(project.projectKey)} key={project.projectKey} className={`panel text-left ${projectKey === project.projectKey ? "border-signal/30 bg-signal/[.03]" : ""}`}><p className="meta mt-0">{project.projectKey}</p><h3 className="m-0 text-base font-semibold text-white">{project.name}</h3><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">{project.description}</p></button>)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <section className="panel"><p className="eyebrow">Project context</p><h2 className="section-title">Recent notes</h2><div className="mt-5 space-y-2">{notes.map((note) => <article className="queue-item" key={note.id}><p className="m-0 text-sm font-semibold text-white">{note.title}</p><p className="mb-0 mt-2 whitespace-pre-wrap text-sm text-slate-400">{note.content}</p><p className="meta">{note.tags.join(" · ")}</p></article>)}{!notes.length && <div className="empty">No notes for this project.</div>}</div></section>
        <section className="panel"><p className="eyebrow">Quick project knowledge</p><h2 className="section-title">Add note</h2><form className="mt-5 space-y-3" onSubmit={submit}><input className="field" required placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /><textarea className="field min-h-36" required placeholder="Project note" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} /><input className="field" placeholder="Tags" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /><button className="button">Save local note</button></form></section>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [tab, setTab] = useState<Tab>("home");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [status, setStatus] = useState<CommandStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState({ projectKey: "", title: "", content: "", tags: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled([api.commandStatus(), api.projects()]);
    if (settled[0].status === "fulfilled") setStatus(settled[0].value);
    if (settled[1].status === "fulfilled") setProjects(settled[1].value);
    const failure = settled.find((item) => item.status === "rejected");
    setError(failure?.status === "rejected" ? (failure.reason instanceof Error ? failure.reason.message : "Some FREEOS data is unavailable.") : null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (advancedTabs.some(([key]) => key === tab)) setAdvancedOpen(true); }, [tab]);

  async function quickNote(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.quickNote({ projectKey: quick.projectKey || undefined, title: quick.title, content: quick.content, tags: quick.tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
      setQuick({ projectKey: "", title: "", content: "", tags: "" });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Quick note could not be saved.");
    }
  }

  const title = allTabs.find(([key]) => key === tab)?.[1] ?? "FREEOS";
  const navigate = (target: string) => setTab(target as Tab);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_1fr]">
      <aside className="border-b border-white/10 bg-[#070d15]/95 px-5 py-5 lg:fixed lg:inset-y-0 lg:w-[17rem] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center border border-signal/40 bg-signal/10 font-black text-signal">F/</div><div><p className="m-0 font-black tracking-[.22em] text-white">FREEOS</p><p className="meta mt-0">Local Operating System</p></div></div>

        <nav className="mt-7 space-y-5">
          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[.2em] text-slate-700">Everyday</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
              {everydayTabs.map(([key, label, icon]) => <button key={key} onClick={() => setTab(key)} className={`nav-item ${tab === key ? "nav-item-active" : ""}`}><span className="w-5 text-center text-signal/80">{icon}</span>{label}</button>)}
            </div>
          </div>

          <div className="border-t border-white/[.06] pt-4">
            <button className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-slate-500 hover:text-white" onClick={() => setAdvancedOpen((value) => !value)}>
              <span>Advanced systems</span><span className="font-mono text-signal">{advancedOpen ? "−" : "+"}</span>
            </button>
            {advancedOpen && <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">{advancedTabs.map(([key, label, icon]) => <button key={key} onClick={() => setTab(key)} className={`nav-item ${tab === key ? "nav-item-active" : ""}`}><span className="w-5 text-center text-electric/80">{icon}</span>{label}</button>)}</div>}
          </div>
        </nav>

        <div className="mt-7 hidden border-t border-white/[.06] pt-5 lg:block"><p className="meta mt-0">Safety lock</p><p className="text-xs leading-5 text-slate-500">Writes require approval.<br />High-risk tools blocked.<br />No cloud AI.</p></div>
      </aside>

      <main className="lg:col-start-2">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-void/85 px-5 py-4 backdrop-blur-xl md:px-8">
          <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
            <div><p className="meta mt-0">FREEOS {status?.system.version ?? ""} · Local-first</p><h1 className="m-0 text-xl font-bold text-white">{title}</h1></div>
            <div className="flex flex-wrap items-center justify-end gap-2"><span className={`badge ${status?.api.online ? "badge-ok" : "badge-warn"}`}>API {status?.api.online ? "online" : "offline"}</span><span className={`badge ${status?.ollama.connected ? "badge-ok" : "badge-warn"}`}>Brain {status?.ollama.connected ? "ready" : "offline"}</span><span className="badge badge-safe">High-risk blocked</span><button className="button hidden sm:block" onClick={() => void refresh()}>{loading ? "Scanning…" : "Refresh"}</button></div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 md:p-8">
          {error && <p className="notice">{error}</p>}

          {tab === "home" && <StartHerePanel status={status} projects={projects} onNavigate={navigate} />}
          {tab === "skills" && <SkillAcademyPanel />}
          {tab === "guide" && <GuidePanel />}

          {tab === "command" && <div className="space-y-4">
            <section><p className="eyebrow">Detailed system view</p><h2 className="m-0 text-3xl font-black tracking-[-.03em] text-white md:text-5xl">System Overview</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">Use this page when you want system status, approvals, activity, quick capture, and infrastructure details. For normal work, Start Here or Ask FREEOS is simpler.</p></section>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatusCard label="Local Brain" value={status?.ollama.connected ? "Connected" : "Offline"} detail={status?.ollama.defaultModel ?? "Local Ollama"} tone={status?.ollama.connected ? "online" : "waiting"} /><StatusCard label="Memory Layer" value={`${status?.memory.approvedMemories ?? 0} approved`} detail={`${status?.memory.pendingProposals ?? 0} pending review`} tone="safe" /><StatusCard label="Research Layer" value={status?.research.searxngOnline ? "Online" : "Offline"} detail={`${status?.research.counts.sessions ?? 0} local sessions`} tone={status?.research.searxngOnline ? "online" : "waiting"} /><StatusCard label="Voice Layer" value={status?.voice.voiceEnabled ? "Ready" : "Configured locally"} detail="Push-to-talk only" tone="safe" /><StatusCard label="Tool Runner" value={`${status?.tools.registered ?? 0} registered`} detail={`${status?.tools.pendingRequests ?? 0} pending`} tone="safe" /><StatusCard label="Automations" value="Manual / preview" detail={`${status?.automations.rules ?? 0} rules; scheduler opt-in`} tone="safe" /><StatusCard label="Safety State" value="Locked" detail="High-risk tools blocked" tone="safe" /><StatusCard label="Backup State" value={`${status?.backup.count ?? 0} backups`} detail={status?.backup.backupRoot ?? "exports/backups"} tone="safe" /></div>
            <section className="panel"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Quick actions</p><h2 className="section-title">Move without losing the guardrails</h2></div><span className="badge badge-warn">{status?.approvals.total ?? 0} pending approvals</span></div><div className="mt-5 flex flex-wrap gap-2"><button className="button" onClick={() => void refresh()}>Run status snapshot</button><button className="button" onClick={() => setTab("memory")}>Open approvals</button><button className="button" onClick={() => setTab("research")}>Research search</button><button className="button" onClick={() => setTab("skills")}>Skill Academy</button><button className="button" onClick={() => setTab("settings")}>Create backup</button></div></section>
            <div className="grid gap-4 xl:grid-cols-2"><ApprovalHub compact onChanged={() => void refresh()} /><ActivityTimeline compact /></div>
            <section className="panel"><p className="eyebrow">Capture</p><h2 className="section-title">Quick note</h2><p className="section-copy">With a project it becomes a project note. Without one it enters memory approval.</p><form className="mt-5 grid gap-3 lg:grid-cols-[12rem_1fr_1.4fr_auto]" onSubmit={quickNote}><select className="field" value={quick.projectKey} onChange={(e) => setQuick({ ...quick, projectKey: e.target.value })}><option value="">Memory proposal</option>{projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}</select><input className="field" required placeholder="Title" value={quick.title} onChange={(e) => setQuick({ ...quick, title: e.target.value })} /><input className="field" required placeholder="Note" value={quick.content} onChange={(e) => setQuick({ ...quick, content: e.target.value })} /><button className="button">Save safely</button></form></section>
          </div>}

          {tab === "agents" && <AgentsPanel projects={projects} />}
          {tab === "scheduler" && <SchedulerPanel />}
          {tab === "browser" && <BrowserPanel />}
          {tab === "chat" && <ChatPanel projects={projects} onApprovalCreated={() => void refresh()} />}
          {tab === "memory" && <MemoryPanel projects={projects} onChanged={() => void refresh()} />}
          {tab === "projects" && <ProjectsPanel projects={projects} onChanged={() => void refresh()} />}
          {tab === "research" && <ResearchPanel projects={projects} onMemoryChanged={refresh} onNoteChanged={async () => { await refresh(); }} />}
          {tab === "voice" && <VoicePanel projects={projects} />}
          {tab === "coding" && <CodingPanel />}
          {tab === "computer" && <ComputerPanel />}
          {tab === "tools" && <ToolRunnerPanel />}
          {tab === "automations" && <AutomationPanel />}
          {tab === "activity" && <ActivityTimeline />}
          {tab === "settings" && <BackupPanel status={status} />}
        </div>
      </main>
    </div>
  );
}
