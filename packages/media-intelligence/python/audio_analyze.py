"""CPU-only evidence extraction. stdout is one JSON object; errors go to stderr."""
import json
import math
import os
import re
import subprocess
import sys
import tempfile

VERSION = "1.0.0-librosa"

def number(value):
    try:
        n = float(value)
        return round(n, 4) if math.isfinite(n) else None
    except (TypeError, ValueError):
        return None

def loudness(log):
    matches = re.findall(r"\{\s*\"input_i\"[\s\S]*?\}", log)
    if not matches:
        return {"integratedLUFS": None, "truePeak": None, "rangeLU": None}
    data = json.loads(matches[-1])
    return {"integratedLUFS": number(data.get("input_i")), "truePeak": number(data.get("input_tp")), "rangeLU": number(data.get("input_lra"))}

def analyze(path, ffmpeg, duration, source_rate, channels):
    import numpy as np
    import librosa
    if not 0 < duration <= 7200:
        raise ValueError("Invalid media duration")
    # Decode a bounded mono copy on disk. FFmpeg handles audio streams in video containers.
    with tempfile.TemporaryDirectory(prefix="freeos-audio-") as temp:
        wav = os.path.join(temp, "decoded.wav")
        command = [ffmpeg, "-v", "error", "-nostdin", "-i", path, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "22050", "-t", str(duration + 1), "-y", wav]
        subprocess.run(command, check=True, capture_output=True, timeout=180)
        y, sr = librosa.load(wav, sr=None, mono=True)
    if len(y) == 0:
        raise ValueError("Audio stream contains no samples")
    actual_duration = len(y) / sr
    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    # A beat track is accepted only when its pulse is regular and onset evidence is clear.
    tempo_raw, frames = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop, trim=False)
    bpm = number(np.asarray(tempo_raw).item())
    beat_times = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    intervals = np.diff(beat_times)
    regularity = float(np.clip(1 - np.median(np.abs(intervals - np.median(intervals))) / max(np.median(intervals), .001) * 4, 0, 1)) if len(intervals) >= 4 else 0
    pulse = float(np.clip(np.mean(onset[np.clip(frames, 0, len(onset)-1)]) / max(np.percentile(onset, 90), 1e-6), 0, 1)) if len(frames) else 0
    beat_confidence = round(regularity * pulse, 3) if bpm and 40 <= bpm <= 240 and len(frames) >= 8 else 0
    reliable = beat_confidence >= .45
    if not reliable:
        bpm, beat_times, beat_confidence = None, [], 0
    beats = [{"time": number(t), "strength": number(np.clip(onset[min(int(f), len(onset)-1)] / max(np.percentile(onset, 95), 1e-6), 0, 1))} for t, f in zip(beat_times, frames)]
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset, sr=sr, hop_length=hop, backtrack=False)
    transients = [{"time": number(f * hop / sr), "strength": number(np.clip(onset[f] / max(np.percentile(onset, 95), 1e-6), 0, 1))} for f in onset_frames]
    # Quarter-second bins keep output small and retain dynamics useful for planning.
    bin_size = max(1, int(sr * .25))
    energy = []
    silence = []
    open_start = None
    for start in range(0, len(y), bin_size):
        part = y[start:start + bin_size]
        r = float(np.sqrt(np.mean(part.astype(np.float64)**2)))
        peak = float(np.max(np.abs(part)))
        t = start / sr
        energy.append({"time": number(t), "rms": number(np.clip(r, 0, 1)), "peak": number(np.clip(peak, 0, 1))})
        quiet = r < 10 ** (-50 / 20)
        if quiet and open_start is None:
            open_start = t
        if not quiet and open_start is not None:
            if t - open_start >= .3:
                silence.append({"start": number(open_start), "end": number(t)})
            open_start = None
    if open_start is not None and actual_duration - open_start >= .3:
        silence.append({"start": number(open_start), "end": number(actual_duration)})
    # No meter or semantic section classifier is installed: leave those fields empty.
    # A leading/trailing silence is not evidence for a musical intro/outro.
    loud = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", path, "-map", "0:a:0", "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True, timeout=180)
    return {"path": path, "durationSeconds": number(actual_duration), "sampleRate": source_rate or sr, "channels": channels or 1,
            "tempo": {"bpm": bpm, "confidence": beat_confidence}, "beats": beats, "downbeats": [], "sections": [],
            "energyCurve": energy, "transients": transients, "loudness": loudness(loud.stderr) if loud.returncode == 0 else loudness(""),
            "silenceRegions": silence, "intro": None, "outro": None, "analysisVersion": VERSION}

if __name__ == "__main__":
    try:
        import numpy
        import scipy
        import librosa
        if sys.argv[1:] == ["--doctor"]:
            print(json.dumps({"available": True, "librosa": librosa.__version__, "numpy": numpy.__version__}))
        else:
            if len(sys.argv) != 6:
                raise ValueError("Expected path, ffmpeg, duration, sample rate, channels")
            print(json.dumps(analyze(sys.argv[1], sys.argv[2], float(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])), allow_nan=False))
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
