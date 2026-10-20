"""Deterministic, bounded measurements of a rendered video file."""
import json, math, sys
import cv2
import numpy as np

def measure(path, sample_fps=1.0, max_frames=240):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened(): raise RuntimeError("Cannot open rendered video")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    count = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = count / fps if fps > 0 else 0
    if not 0 < duration <= 7200: raise RuntimeError("Render duration is invalid")
    step = max(1 / sample_fps, duration / max_frames)
    frames = []
    t = 0.0
    while t < duration and len(frames) < max_frames:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if ok:
            frame = cv2.resize(frame, (min(320, frame.shape[1]), min(180, frame.shape[0])))
            lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
            y = lab[:, :, 0].astype(np.float32) / 255
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            lap = cv2.Laplacian(y, cv2.CV_32F)
            local = np.abs(y - cv2.GaussianBlur(y, (0, 0), 3))
            edge = np.abs(lap)
            frames.append({
                "time": round(t, 3), "lumaMean": round(float(y.mean()), 5),
                "p05": round(float(np.percentile(y, 5)), 5), "p50": round(float(np.percentile(y, 50)), 5),
                "p95": round(float(np.percentile(y, 95)), 5),
                "blackFloor": round(float(np.percentile(y, 1)), 5),
                "shadowClipping": round(float((y < .025).mean()), 5),
                "highlightClipping": round(float((y > .975).mean()), 5),
                "globalContrast": round(float(y.std()), 5),
                "localContrast": round(float(local.mean()), 5),
                "saturation": round(float(hsv[:, :, 1].mean() / 255), 5),
                "sharpness": round(float(lap.var()), 6),
                "edgeEnergy": round(float(edge.mean()), 6),
                "noise": round(float(np.median(np.abs(lap - np.median(lap)))), 6),
            })
        t += step
    cap.release()
    if not frames: raise RuntimeError("No render frames could be decoded")
    previous = None
    for frame in frames:
        frame["brightnessChange"] = round(abs(frame["lumaMean"] - previous), 5) if previous is not None else 0
        previous = frame["lumaMean"]
    keys = [key for key in frames[0] if key not in ("time", "brightnessChange")]
    summary = {key: round(float(np.median([f[key] for f in frames])), 6) for key in keys}
    summary["maxBrightnessChange"] = max(f["brightnessChange"] for f in frames)
    return {"duration": round(duration, 3), "sampleFps": sample_fps, "frames": frames, "summary": summary, "analysisVersion": "render-quality-v1"}

if __name__ == "__main__":
    try: print(json.dumps(measure(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 1)))
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
