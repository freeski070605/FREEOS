export function PhaseCard() {
  return (
    <section className="border border-white/10 bg-panel/80 p-6 shadow-2xl lg:p-8">
      <p className="m-0 text-[10px] font-bold uppercase tracking-[0.24em] text-electric">Active protocol</p>
      <div className="mt-4 flex items-end justify-between gap-6">
        <div><p className="m-0 text-sm text-slate-500">Current phase</p><h2 className="mb-0 mt-1 text-2xl font-semibold text-white">Phase 5 — Safe Tool Runner + Local Automations</h2></div>
        <span className="hidden font-mono text-5xl font-black text-white/[0.04] sm:block">05/06</span>
      </div>
      <div className="mt-7 h-1 overflow-hidden bg-white/5"><div className="h-full w-5/6 bg-gradient-to-r from-signal to-electric shadow-[0_0_14px_#59f6d2]" /></div>
    </section>
  );
}
