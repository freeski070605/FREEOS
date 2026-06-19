type Tone = "online" | "waiting" | "safe" | "neutral";

const tones: Record<Tone, string> = {
  online: "border-signal/25 bg-signal/[0.055] text-signal",
  waiting: "border-amber-300/25 bg-amber-300/[0.055] text-amber-200",
  safe: "border-electric/25 bg-electric/[0.055] text-electric",
  neutral: "border-white/10 bg-white/[0.025] text-slate-300",
};

export function StatusCard({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail?: string; tone?: Tone }) {
  return (
    <article className={`min-h-36 border p-5 backdrop-blur-sm transition-colors ${tones[tone]}`}>
      <div className="mb-7 flex items-center justify-between">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{label}</p>
        <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
      </div>
      <p className="m-0 text-lg font-semibold text-current">{value}</p>
      {detail && <p className="mb-0 mt-2 text-xs leading-5 text-slate-500">{detail}</p>}
    </article>
  );
}

