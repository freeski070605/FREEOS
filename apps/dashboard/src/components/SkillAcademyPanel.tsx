import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  skillApi,
  type SkillAcademyStatus,
  type SkillCompetency,
  type SkillDomain,
  type SkillMasteryLevel,
  type SkillRiskLevel,
} from "../lib/skillApi";

const masteryOrder: SkillMasteryLevel[] = ["theory", "guided", "practicing", "working", "proficient", "advanced"];
const masteryCopy: Record<SkillMasteryLevel, string> = {
  theory: "FREEOS has approved instruction but has not demonstrated this skill yet.",
  guided: "At least one evaluated practice result passed.",
  practicing: "Repeated passing practice is starting to establish ability.",
  working: "Enough evaluated practice exists to treat this as a working skill.",
  proficient: "Strong repeated results support dependable use.",
  advanced: "High-scoring repeated results demonstrate advanced performance.",
};

const riskCopy: Record<SkillRiskLevel, string> = {
  standard: "Normal practice can count toward mastery after evaluation.",
  elevated: "Practice must be human-reviewed before it can count toward mastery.",
  "safety-critical": "Human review is mandatory and FREEOS safety controls still override training material.",
};

export function SkillAcademyPanel() {
  const [status, setStatus] = useState<SkillAcademyStatus | null>(null);
  const [domains, setDomains] = useState<SkillDomain[]>([]);
  const [selectedDomain, setSelectedDomain] = useState("all");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [practice, setPractice] = useState({ competencyKey: "", resultSummary: "", evidence: "", score: "", humanReviewed: false, notes: "" });

  const refresh = useCallback(async () => {
    setLoading(true);
    const settled = await Promise.allSettled([skillApi.status(), skillApi.catalog()]);
    if (settled[0].status === "fulfilled") setStatus(settled[0].value);
    if (settled[1].status === "fulfilled") setDomains(settled[1].value);
    const failure = settled.find((item) => item.status === "rejected");
    setNotice(failure?.status === "rejected" ? (failure.reason instanceof Error ? failure.reason.message : "Skill Academy data is unavailable.") : null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const allCompetencies = useMemo(() => domains.flatMap((domain) => domain.competencies), [domains]);
  const visibleDomains = useMemo(() => {
    const query = search.trim().toLowerCase();
    return domains
      .filter((domain) => selectedDomain === "all" || domain.domainKey === selectedDomain)
      .map((domain) => ({
        ...domain,
        competencies: domain.competencies.filter((competency) => !query || `${competency.name} ${competency.competencyKey} ${competency.description} ${competency.purpose}`.toLowerCase().includes(query)),
      }))
      .filter((domain) => domain.competencies.length > 0 || (!query && selectedDomain === domain.domainKey));
  }, [domains, search, selectedDomain]);

  const selectedCompetency = allCompetencies.find((item) => item.competencyKey === practice.competencyKey);

  async function recordPractice(event: FormEvent) {
    event.preventDefault();
    if (!practice.competencyKey || !practice.resultSummary.trim()) return;
    setNotice(null);
    try {
      const created = await skillApi.createPractice({
        competencyKey: practice.competencyKey,
        resultSummary: practice.resultSummary.trim(),
        evidence: practice.evidence.trim() || undefined,
      });
      if (practice.score.trim()) {
        const score = Number(practice.score);
        if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("Score must be between 0 and 100.");
        await skillApi.evaluatePractice(created.session.id, {
          score,
          humanReviewed: practice.humanReviewed,
          evaluator: practice.humanReviewed ? "Drew" : "FREEOS self-evaluation",
          notes: practice.notes.trim() || undefined,
        });
        setNotice(selectedCompetency?.riskLevel !== "standard" && !practice.humanReviewed
          ? "Practice was recorded and scored, but it does not count toward mastery until a human review is attached."
          : "Practice was recorded and evaluated. Mastery was recalculated from demonstrated results.");
      } else {
        setNotice("Practice was recorded. Mastery will not change until the work is evaluated.");
      }
      setPractice({ competencyKey: practice.competencyKey, resultSummary: "", evidence: "", score: "", humanReviewed: false, notes: "" });
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Practice could not be recorded.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="border border-electric/20 bg-gradient-to-br from-electric/[.08] via-panel/80 to-signal/[.04] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <p className="eyebrow">Practical intelligence</p>
            <h2 className="m-0 text-3xl font-black tracking-[-.04em] text-white md:text-4xl">Skill Academy</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">This is where FREEOS learns how to do real work. Training material teaches procedures and judgment. Practice proves ability. A skill does not become mastered just because a lesson was imported.</p>
          </div>
          <button className="button" onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh skills"}</button>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Stat label="Domains" value={status?.domains ?? 0} />
          <Stat label="Competencies" value={status?.competencies ?? 0} />
          <Stat label="Training units" value={status?.activeTrainingUnits ?? 0} />
          <Stat label="Drills" value={status?.activeDrills ?? 0} />
          <Stat label="Practice" value={status?.practiceSessions ?? 0} />
          <Stat label="Advanced" value={status?.advancedCompetencies ?? 0} />
        </div>
      </section>

      {notice && <p className="notice">{notice}</p>}

      <section className="panel">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="eyebrow">Browse skills</p><h2 className="section-title">What FREEOS has been taught</h2><p className="section-copy">Use the domain buttons or search by a skill name like color, pricing, networking, RAG, or troubleshooting.</p></div>
          <input className="field max-w-sm" placeholder="Search competencies" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={`button ${selectedDomain === "all" ? "bg-signal/10" : ""}`} onClick={() => setSelectedDomain("all")}>All domains</button>
          {domains.map((domain) => <button key={domain.domainKey} className={`button ${selectedDomain === domain.domainKey ? "bg-signal/10" : ""}`} onClick={() => setSelectedDomain(domain.domainKey)}>{domain.name}</button>)}
        </div>
      </section>

      <div className="space-y-4">
        {visibleDomains.map((domain) => (
          <section key={domain.domainKey} className="panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="eyebrow">{domain.domainKey}</p><h2 className="section-title">{domain.name}</h2><p className="section-copy max-w-3xl">{domain.description}</p></div>
              <span className={`badge ${domain.riskProfile === "standard" ? "badge-ok" : "badge-warn"}`}>{domain.riskProfile}</span>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {domain.competencies.map((competency) => <CompetencyCard key={competency.competencyKey} competency={competency} onPractice={() => setPractice((current) => ({ ...current, competencyKey: competency.competencyKey }))} />)}
            </div>
          </section>
        ))}
        {!visibleDomains.length && <div className="empty">No competencies match that search.</div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <section className="panel">
          <p className="eyebrow">Real work becomes training</p>
          <h2 className="section-title">Record practice</h2>
          <p className="section-copy">Use this after FREEOS applies a skill to a real job. A score is optional. No score means the work is stored as practice but does not change mastery yet.</p>
          <form className="mt-5 space-y-3" onSubmit={recordPractice}>
            <div><label className="label">Competency</label><select className="field mt-1" required value={practice.competencyKey} onChange={(event) => setPractice({ ...practice, competencyKey: event.target.value })}><option value="">Choose a skill</option>{domains.map((domain) => <optgroup key={domain.domainKey} label={domain.name}>{domain.competencies.map((competency) => <option key={competency.competencyKey} value={competency.competencyKey}>{competency.name}</option>)}</optgroup>)}</select></div>
            <div><label className="label">What happened?</label><textarea className="field mt-1 min-h-24" required placeholder="Example: Matched three event camera angles and corrected exposure and white balance." value={practice.resultSummary} onChange={(event) => setPractice({ ...practice, resultSummary: event.target.value })} /></div>
            <div><label className="label">Evidence</label><input className="field mt-1" placeholder="Project/export/client result/file reference" value={practice.evidence} onChange={(event) => setPractice({ ...practice, evidence: event.target.value })} /></div>
            <div className="grid gap-3 md:grid-cols-2"><div><label className="label">Score (optional)</label><input className="field mt-1" type="number" min="0" max="100" placeholder="0-100" value={practice.score} onChange={(event) => setPractice({ ...practice, score: event.target.value })} /></div><div><label className="label">Evaluation note</label><input className="field mt-1" placeholder="What was good / what needs work" value={practice.notes} onChange={(event) => setPractice({ ...practice, notes: event.target.value })} /></div></div>
            <label className="flex items-start gap-3 border border-white/[.07] bg-black/10 p-3 text-sm text-slate-400"><input className="mt-1" type="checkbox" checked={practice.humanReviewed} onChange={(event) => setPractice({ ...practice, humanReviewed: event.target.checked })} /><span><strong className="text-white">Human reviewed</strong><br /><span className="text-xs text-slate-500">Required for elevated and safety-critical skills to count toward mastery.</span></span></label>
            {selectedCompetency && <p className="text-xs text-slate-500">Risk: <strong className="text-slate-300">{selectedCompetency.riskLevel}</strong>. {riskCopy[selectedCompetency.riskLevel]}</p>}
            <button className="button">Record practice</button>
          </form>
        </section>

        <section className="panel">
          <p className="eyebrow">Read mastery correctly</p>
          <h2 className="section-title">Knowledge is not ability</h2>
          <div className="mt-5 space-y-2">
            {masteryOrder.map((level, index) => <div key={level} className="queue-item"><div className="flex items-center justify-between gap-3"><p className="m-0 text-sm font-semibold capitalize text-white">{level}</p><span className="badge">Level {index}</span></div><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">{masteryCopy[level]}</p></div>)}
          </div>
          <div className="mt-5 border border-amber-300/15 bg-amber-300/[.04] p-4"><p className="m-0 text-sm font-semibold text-amber-100">Risk rule</p><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">Training never overrides safety. Elevated and safety-critical competencies need human-reviewed evidence before mastery can increase.</p></div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="border border-white/[.07] bg-black/15 p-4"><p className="meta mt-0">{label}</p><p className="mb-0 mt-2 text-2xl font-black text-white">{value}</p></div>;
}

function CompetencyCard({ competency, onPractice }: { competency: SkillCompetency; onPractice: () => void }) {
  const masteryIndex = Math.max(0, masteryOrder.indexOf(competency.masteryLevel));
  const progress = masteryOrder.length > 1 ? (masteryIndex / (masteryOrder.length - 1)) * 100 : 0;
  const riskTone = competency.riskLevel === "standard" ? "badge-ok" : "badge-warn";
  return (
    <article className="border border-white/[.07] bg-black/10 p-4">
      <div className="flex items-start justify-between gap-3"><div><p className="meta mt-0">{competency.competencyKey}</p><h3 className="mb-0 mt-1 text-base font-semibold text-white">{competency.name}</h3></div><span className={`badge ${riskTone}`}>{competency.riskLevel}</span></div>
      {competency.description && <p className="mb-0 mt-3 text-xs leading-5 text-slate-500">{competency.description}</p>}
      <div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs font-semibold capitalize text-signal">{competency.masteryLevel}</span><span className="text-xs text-slate-600">{competency.masteryScore.toFixed(0)} / 100</span></div>
      <div className="mt-2 h-1.5 overflow-hidden bg-white/[.06]"><div className="h-full bg-signal" style={{ width: `${Math.max(2, progress)}%` }} /></div>
      <div className="mt-4 grid grid-cols-4 gap-2 text-center"><SmallMetric label="Units" value={competency.activeUnits} /><SmallMetric label="Drills" value={competency.activeDrills} /><SmallMetric label="Practice" value={competency.practiceCount} /><SmallMetric label="Passes" value={competency.passedCount} /></div>
      <div className="mt-4 flex items-center justify-between gap-3"><p className="m-0 text-[11px] leading-4 text-slate-600">{masteryCopy[competency.masteryLevel]}</p><button className="button shrink-0" onClick={onPractice}>Log work</button></div>
    </article>
  );
}

function SmallMetric({ label, value }: { label: string; value: number }) {
  return <div className="border border-white/[.06] bg-black/10 px-2 py-2"><p className="m-0 text-sm font-bold text-white">{value}</p><p className="meta mt-1">{label}</p></div>;
}
