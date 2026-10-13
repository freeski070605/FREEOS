import json, math, os, sys
import cv2
import numpy as np

VERSION = "2.0.0-opencv-semantic"

def finite(v, digits=4):
    if v is None or not math.isfinite(float(v)):
        return None
    return round(float(v), digits)

def pct(values, q):
    if not values:
        return None
    return finite(np.percentile(np.asarray(values, dtype=np.float64), q))

def stats(values):
    if not values:
        return {"mean": None, "p10": None, "p50": None, "p90": None}
    a = np.asarray(values, dtype=np.float64)
    return {"mean": finite(a.mean()), "p10": pct(values,10), "p50": pct(values,50), "p90": pct(values,90)}

def intervals(frames, predicate, kind, min_seconds=0.75):
    out=[]; start=None; sev=[]; last=None
    for f in frames:
        hit, severity = predicate(f)
        t=float(f["time"])
        if hit:
            if start is None: start=t
            sev.append(float(severity)); last=t
        elif start is not None:
            end=(last if last is not None else t)
            if end-start >= min_seconds: out.append({"start":finite(start),"end":finite(end),"kind":kind,"severity":finite(np.mean(sev))})
            start=None; sev=[]; last=None
    if start is not None and last is not None and last-start >= min_seconds:
        out.append({"start":finite(start),"end":finite(last),"kind":kind,"severity":finite(np.mean(sev))})
    return out

def box_from_rect(rect, sx, sy, width, height):
    x,y,w,h=[float(v) for v in rect]
    x*=sx; y*=sy; w*=sx; h*=sy
    area=(w*h)/(width*height) if width and height else 0
    cx=(x+w/2)/width if width else 0.5
    cy=(y+h/2)/height if height else 0.5
    edge=min(x/width if width else 1,y/height if height else 1,(width-(x+w))/width if width else 1,(height-(y+h))/height if height else 1)
    return {"x":int(x),"y":int(y),"w":int(w),"h":int(h),"areaRatio":finite(area),"centerX":finite(cx),"centerY":finite(cy),"edgeMargin":finite(max(0,edge))}

def infer_semantics(face, person, face_count, person_count, global_motion, local_motion):
    face_area=float(face["areaRatio"]) if face and face.get("areaRatio") is not None else 0.0
    person_area=float(person["areaRatio"]) if person and person.get("areaRatio") is not None else 0.0
    person_h=float(person["h"]) if person and person.get("h") is not None else 0.0
    frame_h_ratio=0.0
    if person and person.get("h") and person.get("_frameHeight"):
        frame_h_ratio=float(person["h"])/float(person["_frameHeight"])

    if face_area >= 0.10:
        shot_scale="close-up"; scale_conf=0.86
    elif face_area >= 0.04:
        shot_scale="medium-close"; scale_conf=0.78
    elif face_area >= 0.012:
        shot_scale="medium"; scale_conf=0.68
    elif person_area >= 0.28 or frame_h_ratio >= 0.70:
        shot_scale="full"; scale_conf=0.62
    elif person_area > 0 or person_count > 0:
        shot_scale="wide"; scale_conf=0.58
    elif face_count > 0:
        shot_scale="medium"; scale_conf=0.45
    else:
        shot_scale="unknown"; scale_conf=0.25

    if face_area >= 0.04:
        framing_role="intimate"; role_conf=0.78
    elif person_count > 0 or face_count > 0:
        framing_role="performance"; role_conf=0.66
    else:
        framing_role="environmental-or-undetected"; role_conf=0.38

    gm=float(global_motion or 0); lm=float(local_motion or 0)
    if gm < 0.0015 and lm < 0.0015:
        motion_role="static"; motion_conf=0.72
    elif gm >= 0.0025 and gm > lm*1.35:
        motion_role="camera-motion"; motion_conf=0.68
    elif lm >= 0.0025 and lm > gm*1.35:
        motion_role="subject-motion"; motion_conf=0.64
    else:
        motion_role="mixed-motion"; motion_conf=0.52

    return {
        "shotScale":shot_scale,
        "shotScaleConfidence":finite(scale_conf),
        "framingRole":framing_role,
        "framingRoleConfidence":finite(role_conf),
        "motionRole":motion_role,
        "motionRoleConfidence":finite(motion_conf),
        "subjectCountEstimate":int(max(face_count, person_count)),
    }

def dominant(values):
    vals=[v for v in values if v]
    if not vals: return None
    counts={v:vals.count(v) for v in set(vals)}
    return max(counts,key=counts.get)

def analyze(path, sample_fps=2.0, max_frames=1500):
    cap=cv2.VideoCapture(path)
    if not cap.isOpened(): raise RuntimeError("OpenCV could not open video.")
    fps=float(cap.get(cv2.CAP_PROP_FPS) or 0)
    frame_count=float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0); height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration=(frame_count/fps) if fps>0 and frame_count>0 else 0
    if duration<=0 or duration>7200: raise RuntimeError("Video duration must be known and at most two hours.")
    effective=min(float(sample_fps), max(0.25, max_frames/duration))
    step=1.0/effective
    cascade=cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if cascade.empty(): raise RuntimeError("OpenCV face cascade is unavailable.")
    hog=cv2.HOGDescriptor(); hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    timeline=[]; scenes=[]; prev_small=None; prev_hist=None; prev_flow=None; t=0.0
    while t < duration and len(timeline) < max_frames:
        cap.set(cv2.CAP_PROP_POS_MSEC, t*1000.0)
        ok, frame=cap.read()
        if not ok: t += step; continue
        gray=cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        small=cv2.resize(gray,(320,max(1,int(gray.shape[0]*320/gray.shape[1]))),interpolation=cv2.INTER_AREA)
        color_small=cv2.resize(frame,(320,max(1,int(frame.shape[0]*320/frame.shape[1]))),interpolation=cv2.INTER_AREA)
        sharp=float(cv2.Laplacian(small,cv2.CV_64F).var())
        mean=float(small.mean()); contrast=float(small.std())
        under=float(np.mean(small<=16)); over=float(np.mean(small>=240))
        motion=0.0 if prev_small is None else float(cv2.absdiff(small,prev_small).mean()/255.0)
        hist=cv2.calcHist([small],[0],None,[64],[0,256]); cv2.normalize(hist,hist)
        scene=0.0 if prev_hist is None else float(cv2.compareHist(prev_hist,hist,cv2.HISTCMP_BHATTACHARYYA))
        if scene>=0.45: scenes.append({"time":finite(t),"strength":finite(scene)})

        flow_gray=cv2.resize(gray,(160,max(1,int(gray.shape[0]*160/gray.shape[1]))),interpolation=cv2.INTER_AREA)
        global_motion=0.0; local_motion=0.0
        if prev_flow is not None and prev_flow.shape==flow_gray.shape:
            flow=cv2.calcOpticalFlowFarneback(prev_flow,flow_gray,None,0.5,3,15,3,5,1.2,0)
            dx=flow[...,0]; dy=flow[...,1]
            gdx=float(np.median(dx)); gdy=float(np.median(dy))
            diag=max(1.0,math.hypot(flow_gray.shape[1],flow_gray.shape[0]))
            global_motion=math.hypot(gdx,gdy)/diag
            residual=np.sqrt((dx-gdx)**2+(dy-gdy)**2)
            local_motion=float(np.median(residual))/diag

        detect=cv2.resize(gray,None,fx=0.5,fy=0.5,interpolation=cv2.INTER_AREA)
        faces=cascade.detectMultiScale(detect,scaleFactor=1.1,minNeighbors=5,minSize=(24,24))
        largest=None
        if len(faces):
            largest=box_from_rect(max(faces,key=lambda r:r[2]*r[3]),2.0,2.0,width,height)

        persons,_weights=hog.detectMultiScale(color_small,winStride=(8,8),padding=(8,8),scale=1.05)
        largest_person=None
        if len(persons):
            largest_person=box_from_rect(max(persons,key=lambda r:r[2]*r[3]),width/color_small.shape[1],height/color_small.shape[0],width,height)
            largest_person["_frameHeight"]=height

        semantics=infer_semantics(largest,largest_person,int(len(faces)),int(len(persons)),global_motion,local_motion)
        if largest_person and "_frameHeight" in largest_person: del largest_person["_frameHeight"]

        timeline.append({
            "time":finite(t),"sharpness":finite(sharp),"brightness":finite(mean/255.0),"contrast":finite(contrast/255.0),
            "underexposedFraction":finite(under),"overexposedFraction":finite(over),"motion":finite(motion),"sceneChange":finite(scene),
            "faceCount":int(len(faces)),"largestFace":largest,"personCount":int(len(persons)),"largestPerson":largest_person,
            "globalMotion":finite(global_motion),"localMotion":finite(local_motion),**semantics
        })
        prev_small=small; prev_hist=hist; prev_flow=flow_gray; t += step
    cap.release()
    sharp=[f["sharpness"] for f in timeline]; bright=[f["brightness"] for f in timeline]; motion=[f["motion"] for f in timeline]
    face_frames=[f for f in timeline if f["faceCount"]>0 and f["largestFace"]]
    face_areas=[f["largestFace"]["areaRatio"] for f in face_frames]
    person_frames=[f for f in timeline if f["personCount"]>0 and f["largestPerson"]]
    person_areas=[f["largestPerson"]["areaRatio"] for f in person_frames]
    centered=[f for f in face_frames if abs(f["largestFace"]["centerX"]-.5)<=.2 and abs(f["largestFace"]["centerY"]-.45)<=.25]
    edge_risk=[f for f in face_frames if f["largestFace"]["edgeMargin"]<.03]
    med_sharp=float(np.median(sharp)) if sharp else 0
    flags=[]
    if med_sharp>0:
        flags += intervals(timeline, lambda f:(f["sharpness"] < med_sharp*.35, min(1,max(0,(med_sharp*.35-f["sharpness"])/(med_sharp*.35)))), "blur")
    flags += intervals(timeline, lambda f:(f["brightness"]<.12 or f["underexposedFraction"]>.35, min(1,max((.12-f["brightness"])/.12,f["underexposedFraction"]))), "underexposed")
    flags += intervals(timeline, lambda f:(f["brightness"]>.88 or f["overexposedFraction"]>.35, min(1,max((f["brightness"]-.88)/.12,f["overexposedFraction"]))), "overexposed")
    return {
        "path":os.path.abspath(path),"durationSeconds":finite(duration),"width":width,"height":height,"fps":finite(fps),
        "sampleFps":finite(effective),"framesAnalyzed":len(timeline),"timeline":timeline,"sceneChanges":scenes,
        "summary":{
            "sharpness":stats(sharp),"brightness":stats(bright),"motion":stats(motion),
            "facePresenceRatio":finite(len(face_frames)/len(timeline) if timeline else 0),
            "multiFaceRatio":finite(sum(1 for f in timeline if f["faceCount"]>1)/len(timeline) if timeline else 0),
            "primaryFaceArea":stats(face_areas),"centeredFaceRatio":finite(len(centered)/len(face_frames) if face_frames else 0),
            "faceEdgeRiskRatio":finite(len(edge_risk)/len(face_frames) if face_frames else 0),
            "personPresenceRatio":finite(len(person_frames)/len(timeline) if timeline else 0),
            "primaryPersonArea":stats(person_areas),
            "globalMotion":stats([f["globalMotion"] for f in timeline]),
            "localMotion":stats([f["localMotion"] for f in timeline]),
            "dominantShotScale":dominant([f["shotScale"] for f in timeline if f["shotScale"]!="unknown"]),
            "dominantFramingRole":dominant([f["framingRole"] for f in timeline]),
            "dominantMotionRole":dominant([f["motionRole"] for f in timeline]),
        },
        "qualityFlags":sorted(flags,key=lambda x:x["start"]),"analysisVersion":VERSION,
        "semanticNotes":[
            "Shot scale and framing role are local visual inferences, not identity recognition.",
            "Person detection may miss occluded, seated, profile, or unusually framed subjects.",
            "Motion role estimates compare global optical flow with residual/local flow; they are evidence, not creative decisions."
        ]
    }

def doctor():
    print(json.dumps({"available":True,"opencv":cv2.__version__,"numpy":np.__version__,"analysisVersion":VERSION,"semanticEvidence":True}))

if __name__ == "__main__":
    if len(sys.argv)>1 and sys.argv[1]=="--doctor": doctor(); raise SystemExit(0)
    if len(sys.argv)<2: raise SystemExit("usage: video_analyze.py <path> [sample_fps]")
    print(json.dumps(analyze(sys.argv[1], float(sys.argv[2]) if len(sys.argv)>2 else 2.0), separators=(",",":")))
