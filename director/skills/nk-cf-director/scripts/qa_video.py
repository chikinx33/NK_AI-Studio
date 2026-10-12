#!/usr/bin/env python3
"""생성 영상 자동 검수.

장면 전환 시각, 음악 의심 구간(지속 배음), 대사 전사(선택), 확대 검수용 프레임을 뽑아
report.json / spectrogram.png / frames/*.png 로 저장한다.

사용:
  python3 qa_video.py VIDEO --out qa_out [--cuts "0,1.5,2.3"] [--frames "2.4,5.1"]
                        [--scene-threshold 0.3] [--whisper] [--lang ko]
필요: ffmpeg/ffprobe, numpy, scipy. --whisper 는 faster-whisper 가 설치돼 있을 때만.
"""
import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def probe_with_ffmpeg(path):
    """ffprobe 가 없는 환경(일부 Windows 배포본)용: ffmpeg -i 출력을 읽는다."""
    err = run(["ffmpeg", "-hide_banner", "-i", path]).stderr
    dur = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err)
    vid = re.search(r"Video: (\w+)[^,]*, (\w+)[^,]*(?:\([^)]*\))?, (\d+)x(\d+).*?([\d.]+) fps", err)
    aud = re.search(r"Audio: (\w+)[^,]*, (\d+) Hz", err)
    if not dur:
        raise SystemExit(f"영상 정보를 읽지 못함: {err.strip()[-300:]}")
    h, m, s = dur.groups()
    return {
        "duration": int(h) * 3600 + int(m) * 60 + float(s),
        "width": int(vid.group(3)) if vid else None,
        "height": int(vid.group(4)) if vid else None,
        "fps": float(vid.group(5)) if vid else None,
        "videoCodec": vid.group(1) if vid else None,
        "pixFmt": vid.group(2) if vid else None,
        "audioCodec": aud.group(1) if aud else None,
        "audioRate": int(aud.group(2)) if aud else None,
    }


def probe(path):
    try:
        r = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    except FileNotFoundError:
        return probe_with_ffmpeg(path)
    if r.returncode != 0:
        raise SystemExit(f"ffprobe 실패: {r.stderr.strip()}")
    info = json.loads(r.stdout)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    num, den = (v.get("r_frame_rate", "0/1").split("/") + ["1"])[:2]
    return {
        "duration": float(info["format"].get("duration", 0)),
        "width": v.get("width"),
        "height": v.get("height"),
        "fps": round(float(num) / float(den or 1), 3) if float(den or 1) else None,
        "videoCodec": v.get("codec_name"),
        "pixFmt": v.get("pix_fmt"),
        "audioCodec": a.get("codec_name") if a else None,
        "audioRate": int(a["sample_rate"]) if a and a.get("sample_rate") else None,
    }


def decode_errors(path):
    r = run(["ffmpeg", "-v", "error", "-i", path, "-f", "null", "-"])
    return [line for line in r.stderr.splitlines() if line.strip()][:20]


def scene_cuts(path, threshold):
    r = run(["ffmpeg", "-hide_banner", "-i", path, "-an", "-filter:v",
             f"select='gt(scene,{threshold})',showinfo", "-f", "null", "-"])
    times = [float(m.group(1)) for m in re.finditer(r"pts_time:([0-9.]+)", r.stderr)]
    return [round(t, 2) for t in times]


def load_audio(path, sr=16000):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr),
                        "-f", "f32le", "-"], capture_output=True)
    if r.returncode != 0 or not r.stdout:
        return None, sr
    return np.frombuffer(r.stdout, dtype=np.float32), sr


def music_analysis(audio, sr, out_png):
    """지속 배음(수평선) 비율로 음악 의심 구간을 찾는다.

    효과음·대사는 짧고 주파수가 흔들리지만, BGM·패드는 같은 주파수의 피크가
    0.5초 이상 이어진다. 초 단위로 '지속 피크 에너지 비율'을 계산한다.
    """
    from scipy import signal

    nper = 2048
    f, t, Z = signal.stft(audio, fs=sr, nperseg=nper, noverlap=nper * 3 // 4)
    mag = np.abs(Z)
    band = (f >= 80) & (f <= 4000)
    mag_b = mag[band]
    db = 20 * np.log10(mag_b + 1e-9)
    hop_sec = (nper - nper * 3 // 4) / sr
    hold = max(1, int(round(0.5 / hop_sec)))

    # 프레임마다 주변보다 6dB 이상 솟은 좁은 피크를 표시
    smooth = signal.medfilt2d(db, kernel_size=(9, 1))
    peaks = (db - smooth) > 6.0
    peaks &= db > (db.max() - 60)
    # 같은 주파수 bin 에서 hold 프레임 이상 이어진 피크만 '지속'으로 본다
    sustained = np.zeros_like(peaks)
    for i in range(peaks.shape[0]):
        row = peaks[i]
        run_len = 0
        for j in range(row.size):
            run_len = run_len + 1 if row[j] else 0
            if run_len >= hold:
                sustained[i, j - hold + 1:j + 1] = True

    energy = mag_b ** 2
    total = energy.sum(axis=0) + 1e-12
    ratio = (energy * sustained).sum(axis=0) / total
    level_db = 10 * np.log10(total)
    # 프레임마다 '지속 배음선' 개수(인접 bin 은 한 줄로 묶음). 큰 효과음이 섞여도
    # 줄 개수는 줄지 않으므로 에너지 비율보다 음악 판정에 안정적이다.
    edges = np.diff(sustained.astype(np.int8), axis=0, prepend=0)
    lines = (edges == 1).sum(axis=0)

    per_sec = []
    secs = int(np.ceil(t[-1])) if t.size else 0
    for s in range(secs):
        m = (t >= s) & (t < s + 1)
        if not m.any():
            continue
        per_sec.append({
            "t": s,
            "lines": round(float(lines[m].mean()), 1),
            "sustainedRatio": round(float(ratio[m].mean()), 3),
            "levelDb": round(float(level_db[m].mean()), 1),
        })

    # 효과음·대사만 있는 영상은 지속 배음선이 0에 가깝다(실측). 평균 1줄 이상인 초가
    # 2초 이상 이어지면 음악 의심, 1초 이하 공백은 한 구간으로 잇는다.
    suspect, start = [], None
    for row in per_sec + [{"t": None, "lines": 0}]:
        hit = row["lines"] >= 1.0
        if hit and start is None:
            start = row["t"]
        if not hit and start is not None:
            end = row["t"] if row["t"] is not None else per_sec[-1]["t"] + 1
            if end - start >= 2:
                if suspect and start - suspect[-1][1] <= 1:
                    suspect[-1][1] = end
                else:
                    suspect.append([start, end])
            start = None

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(14, 4), dpi=110)
        ax.pcolormesh(t, f[band], db, shading="auto", cmap="magma", vmin=db.max() - 80, vmax=db.max())
        for s, e in suspect:
            ax.axvspan(s, e, color="cyan", alpha=0.15)
        ax.set_xlabel("sec")
        ax.set_ylabel("Hz")
        ax.set_title("spectrogram (cyan = music suspect: sustained harmonic lines)")
        fig.tight_layout()
        fig.savefig(out_png)
        plt.close(fig)
    except Exception:  # matplotlib 이 없으면 PNG 없이 진행
        out_png = None

    return {"musicSuspect": suspect, "perSecond": per_sec, "spectrogram": out_png}


def extract_frames(path, times, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    saved = []
    for tm in times:
        name = os.path.join(out_dir, f"f_{tm:06.2f}.png")
        r = run(["ffmpeg", "-v", "error", "-y", "-ss", f"{tm:.3f}", "-i", path, "-frames:v", "1", name])
        if r.returncode == 0 and os.path.exists(name):
            saved.append(name)
    return saved


def transcribe(path, lang):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {"skipped": "faster-whisper 미설치"}
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(path, language=lang, vad_filter=True)
    return [{"t": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segments]


def parse_list(s):
    return [float(x) for x in s.split(",") if x.strip()] if s else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--out", default="qa_out")
    ap.add_argument("--cuts", default="", help="콘티 컷 시작 시각(초), 쉼표 구분")
    ap.add_argument("--frames", default="", help="추가로 뽑을 프레임 시각(초)")
    ap.add_argument("--scene-threshold", type=float, default=0.3)
    ap.add_argument("--whisper", action="store_true")
    ap.add_argument("--lang", default="ko")
    a = ap.parse_args()

    os.makedirs(a.out, exist_ok=True)
    meta = probe(a.video)
    cuts_plan = parse_list(a.cuts)
    detected = scene_cuts(a.video, a.scene_threshold)

    # 콘티 컷마다 가장 가까운 실제 전환과의 차이
    alignment = []
    for c in cuts_plan[1:]:
        if detected:
            nearest = min(detected, key=lambda d: abs(d - c))
            alignment.append({"planned": c, "detected": nearest, "diff": round(nearest - c, 2)})
        else:
            alignment.append({"planned": c, "detected": None, "diff": None})

    # 확대 검수용 프레임: 각 콘티 컷 중앙 + 지정 시각
    bounds = cuts_plan + [meta["duration"]] if cuts_plan else []
    mids = [round((bounds[i] + bounds[i + 1]) / 2, 2) for i in range(len(bounds) - 1)]
    frames = extract_frames(a.video, sorted(set(mids + parse_list(a.frames))), os.path.join(a.out, "frames"))

    report = {
        "video": os.path.abspath(a.video),
        "meta": meta,
        "decodeErrors": decode_errors(a.video),
        "sceneCuts": detected,
        "cutAlignment": alignment,
        "frames": frames,
    }
    audio, sr = load_audio(a.video)
    if audio is not None and audio.size > sr:
        report["audio"] = music_analysis(audio, sr, os.path.join(a.out, "spectrogram.png"))
    else:
        report["audio"] = {"skipped": "오디오 없음"}
    if a.whisper:
        report["transcript"] = transcribe(a.video, a.lang)

    with open(os.path.join(a.out, "report.json"), "w", encoding="utf-8") as fp:
        json.dump(report, fp, ensure_ascii=False, indent=2)

    print(json.dumps({
        "duration": meta["duration"], "size": f'{meta["width"]}x{meta["height"]}', "fps": meta["fps"],
        "sceneCuts": detected, "musicSuspect": report["audio"].get("musicSuspect"),
        "decodeErrors": len(report["decodeErrors"]), "report": os.path.join(a.out, "report.json"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
