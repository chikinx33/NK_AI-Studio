import { useEffect, useRef, useState } from "react";
import type { LocalAgentVideoRenderStatus } from "../lib/api";
import { useMotionAssetText, type MotionAssetDict } from "./MotionAssetPicker";

/**
 * 인포그래픽 영상 진행 막대: 기획 → 자산 → 감독 → 렌더 → 저장.
 * 단계마다 경과 시간·보통 걸리는 시간을 보여 주고, 너무 오래 걸리면 멈춘 것 같다고 알린다(2026-10-21 엔케 요청).
 * 문구는 MotionAssetPicker 의 MOTION_ASSET_TEXT(ko/en) 를 쓴다.
 */
export type MotionStage = "plan" | "assets" | "director" | "render" | "save";
export const MOTION_STAGES: MotionStage[] = ["plan", "assets", "director", "render", "save"];

// 보통 걸리는 시간(초). 시험(2026-10-21): 25초 영상 감독 약 3~5분, 렌더 약 3분.
export const MOTION_STAGE_SECONDS: Record<MotionStage, [number, number]> = {
  plan: [60, 120],
  assets: [5, 60],
  director: [180, 300],
  render: [150, 420],
  save: [5, 40],
};

export function currentMotionStage(
  meetingStatus: string,
  render: LocalAgentVideoRenderStatus,
  archive: { status: string },
): { stage: MotionStage | null; state: "idle" | "active" | "done" | "error" } {
  if (meetingStatus === "running") return { stage: "plan", state: "active" };
  if (render.status === "queued" || render.status === "rendering") {
    return { stage: render.phase === "assets" ? "assets" : render.phase === "director" ? "director" : "render", state: "active" };
  }
  if (archive.status === "uploading") return { stage: "save", state: "active" };
  if (archive.status === "done") return { stage: null, state: "done" };
  if (meetingStatus === "error" || render.status === "error" || archive.status === "error") return { stage: null, state: "error" };
  return { stage: null, state: "idle" };
}

function formatTime(t: MotionAssetDict, sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? t.timeMinSec.replace("{m}", String(m)).replace("{s}", String(s)) : t.timeSec.replace("{s}", String(s));
}

function formatRange(t: MotionAssetDict, [a, b]: [number, number]) {
  return b >= 120
    ? t.minutes.replace("{a}", String(Math.round(a / 60))).replace("{b}", String(Math.round(b / 60)))
    : t.seconds.replace("{a}", String(a)).replace("{b}", String(b));
}

const LABEL: Record<MotionStage, keyof MotionAssetDict> = {
  plan: "stagePlan", assets: "stageAssets", director: "stageDirector", render: "stageRender", save: "stageSave",
};
const DETAIL: Record<MotionStage, keyof MotionAssetDict> = {
  plan: "stagePlanDetail", assets: "stageAssetsDetail", director: "stageDirectorDetail", render: "stageRenderDetail", save: "stageSaveDetail",
};

export default function MotionProgress({ meetingStatus, render, archive }: {
  meetingStatus: string;
  render: LocalAgentVideoRenderStatus;
  archive: { status: string };
}) {
  const t = useMotionAssetText();
  const { stage, state } = currentMotionStage(meetingStatus, render, archive);
  const startedAt = useRef<Partial<Record<MotionStage, number>>>({});
  const lastStage = useRef<MotionStage | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // 새 단계에 들어선 시각을 기록한다(기획부터 다시 시작하면 지난 기록을 지운다)
  if (stage && stage !== lastStage.current) {
    if (stage === "plan") startedAt.current = {};
    startedAt.current[stage] = Date.now();
    lastStage.current = stage;
  }
  useEffect(() => {
    if (state !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  if (state === "idle") return null;
  const failedAt = state === "error" ? lastStage.current : null;
  const currentIndex = stage ? MOTION_STAGES.indexOf(stage) : failedAt ? MOTION_STAGES.indexOf(failedAt) : MOTION_STAGES.length;
  const elapsed = stage && startedAt.current[stage] ? Math.max(0, (now - startedAt.current[stage]!) / 1000) : 0;
  const range = stage ? MOTION_STAGE_SECONDS[stage] : null;
  const stuck = !!range && elapsed > range[1] * 2;
  const percent = stage === "assets" || stage === "render" ? Math.max(0, Math.min(100, Math.round(render.progress || 0))) : null;
  const extra = stage === "director"
    ? (render.chars ? t.chars.replace("{n}", render.chars.toLocaleString()) : t.thinking)
    : percent != null ? `${percent}%` : "";

  return (
    <div className="mb-2 rounded-lg border border-edge bg-panel px-2.5 py-2" role="status" aria-live="polite">
      <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        {t.progressTitle}
        {state === "done" && <span className="text-tone-emerald normal-case tracking-normal">{t.allDone}</span>}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {MOTION_STAGES.map((item, index) => {
          const done = state === "done" || index < currentIndex;
          const active = index === currentIndex && state === "active";
          const failed = index === currentIndex && state === "error";
          const fill = done ? 100 : active ? (percent ?? 100) : 0;
          return (
            <div key={item} className="min-w-0">
              <div className={`mb-1 truncate text-[10px] font-bold ${failed ? "text-tone-red" : active ? "text-tone-emerald" : done ? "text-content" : "text-faint"}`}>
                {done ? "✓ " : ""}{t[LABEL[item]]}
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                <div
                  className={`h-full rounded-full ${failed ? "bg-red-500" : done ? "bg-emerald-600" : "bg-emerald-500"} ${active && percent == null ? "animate-pulse" : ""}`}
                  style={{ width: `${failed ? 100 : fill}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {stage && range && (
        <p className="mt-1.5 text-[10px] leading-4 text-muted">
          {t[DETAIL[stage]]}{extra ? ` · ${extra}` : ""} · {t.elapsed.replace("{t}", formatTime(t, elapsed))} · {t.usually.replace("{r}", formatRange(t, range))}
        </p>
      )}
      {stuck && <p className="mt-1 text-[10px] leading-4 text-tone-amber">{t.stuck}</p>}
      {failedAt && <p className="mt-1 text-[10px] leading-4 text-tone-red">{t.failed}: {t[LABEL[failedAt]]}</p>}
    </div>
  );
}
