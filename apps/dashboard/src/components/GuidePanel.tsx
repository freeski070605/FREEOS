export function GuidePanel() {
  return (
    <div className="space-y-5">
      <section className="border border-signal/20 bg-gradient-to-br from-signal/[.08] via-panel/80 to-electric/[.04] p-6 md:p-8">
        <p className="eyebrow">Plain-English operator guide</p>
        <h2 className="m-0 max-w-4xl text-3xl font-black tracking-[-.04em] text-white md:text-5xl">How to use FREEOS without thinking like a developer</h2>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-400 md:text-base">FREEOS is not one giant button. It has separate lanes because different kinds of work need different rules. Most of the time you only need Chat, Projects, Research, Skills, and Knowledge & Approvals. The rest is advanced operation.</p>
      </section>

      <section className="panel">
        <p className="eyebrow">The shortest possible version</p>
        <h2 className="section-title">Use this decision rule</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <GuideCard title="I want an answer, plan, draft, or analysis" place="Chat" copy="Ask FREEOS normally. Add a project when the request belongs to a specific DFB project." />
          <GuideCard title="I need a fact that may have changed" place="Research" copy="Search current sources first. Current Intelligence is separate from durable memory because fresh facts can expire." />
          <GuideCard title="I want FREEOS to know how to do something" place="Skills" copy="Teach it through approved Skill Academy packs, then use real work and evaluations to establish mastery." />
          <GuideCard title="I want FREEOS to remember something durable" place="Knowledge & Approvals" copy="Create or review a memory proposal. Durable memory requires approval; reading something does not automatically make it memory." />
          <GuideCard title="I am working inside a DFB project" place="Projects" copy="Select the project and store project notes/context there instead of mixing everything into global memory." />
          <GuideCard title="I want FREEOS to touch the computer or run a write" place="Advanced tools" copy="Computer, Browser, Coding, Tools, Scheduler, and Automations use safety gates. Read-only work can be direct; controlled writes require approval." />
        </div>
      </section>

      <section className="panel">
        <p className="eyebrow">Daily operating flow</p>
        <h2 className="section-title">A normal FREEOS session</h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-5">
          <Step n="1" title="Open Start Here" copy="Check that the local brain is online and see pending approvals." />
          <Step n="2" title="Choose the lane" copy="Chat for thinking; Project for project work; Research for changing facts; Skills for training." />
          <Step n="3" title="Give the goal" copy="Say what outcome you want, not which internal service you think FREEOS should use." />
          <Step n="4" title="Approve only when needed" copy="FREEOS may propose a memory, write, tool action, or automation. Review it before it crosses the boundary." />
          <Step n="5" title="Capture the result" copy="If the work taught something useful, record practice or propose durable knowledge." />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <p className="eyebrow">Chat</p>
          <h2 className="section-title">Your normal front door</h2>
          <p className="section-copy">Use Chat for planning, writing, reasoning, brainstorming, technical help, business decisions, creative work, and project support.</p>
          <div className="mt-5 space-y-2">
            <Example label="Good" text="Price a six-hour event package using our business training and explain the margin assumptions." />
            <Example label="Good" text="Give me a Premiere Pro workflow for matching these camera angles." />
            <Example label="Good" text="For DFB Social OS, plan the next feature and use the project context." />
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">Chat can reason with approved memory, project context, Skill Academy training, and current intelligence. It does not automatically execute destructive or high-risk actions.</p>
        </section>

        <section className="panel">
          <p className="eyebrow">Projects</p>
          <h2 className="section-title">Use project context when the answer depends on the project</h2>
          <p className="section-copy">Project notes are scoped to the selected project. Canonical project baselines represent approved stable identity and direction. Current operational state should stay separate when it can change.</p>
          <div className="mt-5 border border-white/[.07] bg-black/10 p-4 text-sm leading-6 text-slate-400">
            <strong className="text-white">Use a project note for:</strong> implementation details, decisions, working context, references, and project-specific facts.<br />
            <strong className="text-white">Use global memory for:</strong> durable information that should matter across projects.<br />
            <strong className="text-white">Do not use either for:</strong> passwords, raw credentials, or facts that must be freshly verified every time.
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Research</p>
          <h2 className="section-title">Fresh facts go here</h2>
          <p className="section-copy">Use Research for prices, news, current product information, changing documentation, market conditions, current availability, and other time-sensitive questions.</p>
          <div className="mt-5 space-y-2">
            <Rule title="Research result" copy="Evidence from a source; it is not automatically durable knowledge." />
            <Rule title="Current Intelligence" copy="Freshness-bounded evidence that FREEOS may use for current claims." />
            <Rule title="Durable knowledge" copy="Only created later when the information is stable, useful, and passes governance." />
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Skill Academy</p>
          <h2 className="section-title">Teaching and mastery are different</h2>
          <p className="section-copy">A teaching pack activates instruction. It does not magically make FREEOS proficient.</p>
          <div className="mt-5 border border-white/[.07] bg-black/10 p-4 font-mono text-xs leading-6 text-slate-400">Teaching Pack → Active Skill Units → Real Work / Drill → Evaluation → Mastery Evidence</div>
          <p className="mt-4 text-xs leading-5 text-slate-500">For elevated or safety-critical skills, evaluated work only counts toward mastery when a human review is attached.</p>
        </section>

        <section className="panel">
          <p className="eyebrow">Knowledge & approvals</p>
          <h2 className="section-title">Nothing important should become durable by accident</h2>
          <p className="section-copy">Memory proposals, controlled tool requests, and some automation actions wait for review. Approval means you are authorizing that exact proposed item, not giving FREEOS permanent blanket permission.</p>
          <div className="mt-5 space-y-2">
            <Rule title="Memory proposal" copy="Candidate durable context. Approve, revise, or reject it." />
            <Rule title="Tool request" copy="A controlled action request. Approving the request and running it are separate steps where required." />
            <Rule title="Canonical project baseline" copy="High-authority stable project knowledge. It requires explicit owner approval and should not be confused with ordinary notes." />
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Advanced operation</p>
          <h2 className="section-title">What the advanced tabs are for</h2>
          <div className="mt-5 space-y-2">
            <Rule title="Agents" copy="Specialized multi-step workers. Use when one task benefits from a bounded role." />
            <Rule title="Browser" copy="Browser-based work and web interaction under the current safety policy." />
            <Rule title="Coding" copy="Read, plan, preview, and controlled code changes in the coding workspace." />
            <Rule title="Computer" copy="Local desktop interaction with explicit restrictions and approvals." />
            <Rule title="Tools" copy="Registered capabilities; read-only tools can run directly while writes may require approval." />
            <Rule title="Scheduler / Automations" copy="Prepare or trigger repeated work. Scheduled writes still respect approval boundaries." />
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">When something seems confusing</p>
        <h2 className="section-title">Translate the system into one question</h2>
        <p className="section-copy">Ask: <strong className="text-white">“Am I trying to think, verify, remember, learn a skill, or act?”</strong></p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Intent word="Think" destination="Chat" />
          <Intent word="Verify" destination="Research" />
          <Intent word="Remember" destination="Knowledge" />
          <Intent word="Learn" destination="Skills" />
          <Intent word="Act" destination="Tools / Operators" />
        </div>
      </section>
    </div>
  );
}

function GuideCard({ title, place, copy }: { title: string; place: string; copy: string }) {
  return <article className="border border-white/[.07] bg-black/10 p-4"><span className="badge badge-ok">{place}</span><h3 className="mb-0 mt-4 text-sm font-semibold text-white">{title}</h3><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">{copy}</p></article>;
}

function Step({ n, title, copy }: { n: string; title: string; copy: string }) {
  return <article className="border border-white/[.07] bg-black/10 p-4"><span className="font-mono text-sm font-bold text-signal">{n}</span><h3 className="mb-0 mt-4 text-sm font-semibold text-white">{title}</h3><p className="mb-0 mt-2 text-xs leading-5 text-slate-500">{copy}</p></article>;
}

function Example({ label, text }: { label: string; text: string }) {
  return <div className="queue-item"><span className="badge badge-ok">{label}</span><p className="mb-0 mt-2 text-sm text-slate-400">“{text}”</p></div>;
}

function Rule({ title, copy }: { title: string; copy: string }) {
  return <div className="queue-item"><p className="m-0 text-sm font-semibold text-white">{title}</p><p className="mb-0 mt-1 text-xs leading-5 text-slate-500">{copy}</p></div>;
}

function Intent({ word, destination }: { word: string; destination: string }) {
  return <div className="border border-white/[.07] bg-black/10 p-4 text-center"><p className="m-0 text-lg font-black text-white">{word}</p><p className="meta mt-2">→ {destination}</p></div>;
}
