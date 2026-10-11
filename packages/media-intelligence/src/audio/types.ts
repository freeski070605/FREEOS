export interface AudioAnalysis {
  path: string; durationSeconds: number; sampleRate: number; channels: number;
  tempo: { bpm: number | null; confidence: number };
  beats: Array<{ time: number; strength: number }>;
  downbeats: Array<{ time: number; bar: number }>;
  sections: Array<{ start: number; end: number; label: string; confidence: number; energyMean: number; energyPeak: number }>;
  energyCurve: Array<{ time: number; rms: number; peak: number }>;
  transients: Array<{ time: number; strength: number }>;
  loudness: { integratedLUFS: number | null; truePeak: number | null; rangeLU: number | null };
  silenceRegions: Array<{ start: number; end: number }>;
  intro: { start: number; end: number } | null;
  outro: { start: number; end: number } | null;
  analysisVersion: string;
}

export function parseAudioAnalysis(value: unknown): AudioAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Audio analyzer returned invalid JSON.");
  const a = value as Record<string, any>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const confidence = (n: unknown) => finite(n) && n >= 0 && n <= 1;
  const points = (items: unknown, valid: (item: any) => boolean) => Array.isArray(items) && items.length <= 100000 && items.every(valid);
  if (typeof a.path !== "string" || !finite(a.durationSeconds) || a.durationSeconds <= 0 || !Number.isInteger(a.sampleRate) || a.sampleRate <= 0 || !Number.isInteger(a.channels) || a.channels <= 0 || !a.tempo || !(a.tempo.bpm === null || finite(a.tempo.bpm) && a.tempo.bpm > 0 && a.tempo.bpm < 400) || !confidence(a.tempo.confidence)) throw new Error("Audio analyzer returned invalid metadata or tempo.");
  const time = (n: unknown) => finite(n) && n >= 0 && n <= a.durationSeconds + .1;
  const region = (x: any) => x && time(x.start) && time(x.end) && x.end >= x.start;
  if (!points(a.beats, x => x && time(x.time) && confidence(x.strength)) || !points(a.downbeats, x => x && time(x.time) && Number.isInteger(x.bar) && x.bar >= 1) || !points(a.sections, x => region(x) && typeof x.label === "string" && confidence(x.confidence) && confidence(x.energyMean) && confidence(x.energyPeak)) || !points(a.energyCurve, x => x && time(x.time) && confidence(x.rms) && confidence(x.peak)) || !points(a.transients, x => x && time(x.time) && confidence(x.strength)) || !points(a.silenceRegions, region)) throw new Error("Audio analyzer returned invalid timeline data.");
  if (!a.loudness || ![a.loudness.integratedLUFS, a.loudness.truePeak, a.loudness.rangeLU].every(x => x === null || finite(x)) || !(a.intro === null || region(a.intro)) || !(a.outro === null || region(a.outro)) || typeof a.analysisVersion !== "string") throw new Error("Audio analyzer returned invalid loudness or regions.");
  if (a.tempo.bpm === null && a.beats.length) throw new Error("Beats require a measured tempo.");
  for (const key of ["beats", "downbeats", "energyCurve", "transients"] as const) if (a[key].some((x: any, i: number) => i > 0 && x.time < a[key][i - 1].time)) throw new Error(`Audio analyzer returned unsorted ${key}.`);
  return a as AudioAnalysis;
}

