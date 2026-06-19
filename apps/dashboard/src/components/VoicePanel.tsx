import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, type Project, type VoiceSession, type VoiceStatus } from "../lib/api";

const fieldClass = "w-full border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-signal/40";
const buttonClass = "border border-signal/30 bg-signal/10 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-signal transition hover:bg-signal/15 disabled:cursor-wait disabled:opacity-40";
const stopClass = "border border-red-300/25 bg-red-300/5 px-4 py-2.5 text-xs font-bold uppercase tracking-[0.14em] text-red-200 disabled:opacity-40";

export function VoicePanel({ projects }: { projects: Project[] }) {
  const [status, setStatus] = useState<VoiceStatus | null>(null); const [sessions, setSessions] = useState<VoiceSession[]>([]);
  const [recording, setRecording] = useState(false); const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null); const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [chatText, setChatText] = useState(""); const [projectKey, setProjectKey] = useState(""); const [speakResponse, setSpeakResponse] = useState(false); const [chatResponse, setChatResponse] = useState("");
  const [speakText, setSpeakText] = useState(""); const [message, setMessage] = useState<string | null>(null); const [busy, setBusy] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null); const stream = useRef<MediaStream | null>(null); const chunks = useRef<Blob[]>([]);

  async function refresh() { const [voice, recent] = await Promise.all([api.voiceStatus(), api.voiceSessions()]); setStatus(voice); setSessions(recent); }
  useEffect(() => { void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Voice status unavailable.")); }, []);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); stream.current?.getTracks().forEach((track) => track.stop()); }, [previewUrl]);

  async function startRecording() {
    setMessage(null); setRecordedBlob(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media; chunks.current = [];
      const nextRecorder = new MediaRecorder(media); recorder.current = nextRecorder;
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => { const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" }); setRecordedBlob(blob); if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(URL.createObjectURL(blob)); media.getTracks().forEach((track) => track.stop()); };
      nextRecorder.start(); setRecording(true);
    } catch (error) { setMessage(error instanceof Error ? `Microphone unavailable: ${error.message}` : "Microphone permission was denied."); }
  }
  function stopRecording() { recorder.current?.stop(); setRecording(false); }
  async function transcribe() { if (!recordedBlob) return; setBusy("transcribe"); setMessage(null); try { const result = await api.transcribe(recordedBlob); setMessage(result.transcript ? `Transcript: ${result.transcript}` : result.message); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Transcription failed."); } finally { setBusy(null); } }
  async function submitChat(event: FormEvent) { event.preventDefault(); setBusy("chat"); setMessage(null); try { const result = await api.voiceChat({ text: chatText, projectKey: projectKey || undefined, speak: speakResponse }); setChatResponse(result.responseText); if (result.speech?.audioUrl) void new Audio(api.audioUrl(result.speech.audioUrl)!).play(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Local voice chat failed."); } finally { setBusy(null); } }
  async function submitSpeak(event: FormEvent) { event.preventDefault(); setBusy("speak"); setMessage(null); try { const result = await api.speak(speakText); setMessage(result.message); if (result.audioUrl) void new Audio(api.audioUrl(result.audioUrl)!).play(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Local speech failed."); } finally { setBusy(null); } }

  return <section className="mt-4 border border-white/10 bg-panel/80 p-6 lg:p-8">
    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.24em] text-electric">Local voice layer</p><h2 className="mb-0 mt-2 text-xl font-semibold text-white">Voice Input / Output</h2><p className="mb-0 mt-2 text-sm text-slate-500">Push-to-talk only. Voice is treated as text and never executes actions.</p>
    {message && <div className="mt-4 border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">{message}</div>}
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Voice", status?.voiceEnabled ? "Enabled" : "Disabled"], ["STT", `${status?.sttEngine ?? "—"} · ${status?.sttConfigured ? "ready" : "setup needed"}`], ["TTS", `${status?.ttsEngine ?? "—"} · ${status?.ttsConfigured ? "ready" : "setup needed"}`], ["Safety", "Listening off · actions off"]].map(([label, value]) => <div key={label} className="border border-white/[0.07] bg-white/[0.02] p-3"><p className="m-0 text-[9px] uppercase tracking-[0.18em] text-slate-600">{label}</p><p className="mb-0 mt-2 text-sm text-slate-200">{value}</p></div>)}</div>
    <p className="mt-3 text-xs text-slate-600">No paid API keys required. Audio stays under {status?.recordingsDir ?? "data/voice"}.</p>
    <div className="mt-6 grid gap-4 xl:grid-cols-3">
      <div className="border border-white/[0.08] bg-black/10 p-4"><h3 className="m-0 text-sm font-semibold text-white">Push to talk</h3><div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} disabled={recording || busy !== null} onClick={() => void startRecording()}>Start recording</button><button className={stopClass} disabled={!recording} onClick={stopRecording}>Stop</button></div>{previewUrl && <audio className="mt-4 w-full" controls src={previewUrl} />}<button className={`${buttonClass} mt-3`} disabled={!recordedBlob || busy !== null} onClick={() => void transcribe()}>Send for transcription</button></div>
      <form onSubmit={submitChat} className="border border-white/[0.08] bg-black/10 p-4"><h3 className="m-0 text-sm font-semibold text-white">Text to free-os</h3><textarea className={`${fieldClass} mt-4 min-h-24`} required value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder="Ask free-os…" /><select className={`${fieldClass} mt-2`} value={projectKey} onChange={(event) => setProjectKey(event.target.value)}><option value="">Global context</option>{projects.map((project) => <option key={project.projectKey} value={project.projectKey}>{project.name}</option>)}</select><label className="mt-3 flex gap-2 text-xs text-slate-400"><input type="checkbox" checked={speakResponse} onChange={(event) => setSpeakResponse(event.target.checked)} /> Speak response locally</label><button className={`${buttonClass} mt-3`} disabled={busy !== null}>Ask locally</button>{chatResponse && <p className="mb-0 mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{chatResponse}</p>}</form>
      <form onSubmit={submitSpeak} className="border border-white/[0.08] bg-black/10 p-4"><h3 className="m-0 text-sm font-semibold text-white">Speak text locally</h3><textarea className={`${fieldClass} mt-4 min-h-24`} required value={speakText} onChange={(event) => setSpeakText(event.target.value)} placeholder="Text for the local voice…" /><button className={`${buttonClass} mt-3`} disabled={busy !== null}>Speak locally</button></form>
    </div>
    <div className="mt-6"><h3 className="m-0 text-sm font-semibold text-white">Recent voice sessions</h3><div className="mt-3 space-y-2">{sessions.length === 0 && <p className="text-sm text-slate-600">No voice sessions yet.</p>}{sessions.map((session) => <article key={session.id} className="border border-white/[0.07] px-4 py-3"><div className="flex justify-between gap-3"><span className="text-xs font-semibold uppercase tracking-wider text-electric">{session.mode} · {session.status}</span><time className="text-[10px] text-slate-600">{new Date(`${session.createdAt}Z`).toLocaleString()}</time></div><p className="mb-0 mt-2 line-clamp-2 text-sm text-slate-400">{session.responseText ?? session.transcript ?? session.inputText ?? session.audioInputPath ?? "Session created"}</p></article>)}</div></div>
  </section>;
}
