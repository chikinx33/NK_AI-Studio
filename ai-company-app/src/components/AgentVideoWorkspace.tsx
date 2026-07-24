import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { AgentVideo } from "../remotion/AgentVideo";
import AgentVideoStorageModal from "./AgentVideoStorageModal";
import CompanySkillThreeColumnLayout from "./CompanySkillThreeColumnLayout";
import {
  getAgentVideoDimensions,
  getAgentVideoDurationSec,
  type AgentVideoContribution,
} from "../remotion/spec";
import { useAgentVideoWorkspace } from "../contexts/AgentVideoWorkspaceContext";
import { actionString, useUiAction } from "../lib/uiActions";

function FieldLabel({ children }: { children: string }) {
  return <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">{children}</label>;
}

function SelectField({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-edge bg-[#0b1018] px-3 py-2 text-xs text-gray-200 outline-none focus:border-emerald-700"
    >
      {children}
    </select>
  );
}

function ContributionCard({ item }: { item: AgentVideoContribution }) {
  return (
    <article className="min-h-0 rounded-lg border border-edge bg-[#0b1018] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <strong className="text-xs text-gray-200">{item.agentName}</strong>
        <span className="ml-auto rounded-full bg-emerald-950 px-1.5 py-0.5 text-[8px] text-emerald-300">완료</span>
      </div>
      <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-gray-500">{item.summary}</p>
    </article>
  );
}

function koreaDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export default function AgentVideoWorkspace({ onClose, embedded = false }: { onClose: () => void; embedded?: boolean }) {
  const {
    prompt,
    setPrompt,
    durationSec,
    setDurationSec,
    aspectRatio,
    setAspectRatio,
    audience,
    setAudience,
    tone,
    setTone,
    style,
    setStyle,
    spec,
    contributions,
    meetingStatus,
    error,
    render,
    archive,
    storageRevision,
    activeWork,
    pendingApproval,
    startMeeting,
    decideCostApproval,
    renderVideo,
  } = useAgentVideoWorkspace();
  const [storageOpen, setStorageOpen] = useState(false);
  const meetingInProgress = meetingStatus === "running";
  const meetingStartDisabled = meetingInProgress || meetingStatus === "awaiting-approval";
  const renderInProgress = render.status === "queued" || render.status === "rendering";
  const archiveInProgress = archive.status === "uploading";

  const dimensions = useMemo(() => getAgentVideoDimensions(spec.aspectRatio), [spec.aspectRatio]);
  const videoDurationSec = useMemo(() => getAgentVideoDurationSec(spec), [spec]);
  const durationInFrames = Math.max(1, Math.round(videoDurationSec * spec.fps));
  const isTallPreview = dimensions.height >= dimensions.width;
  const previewRatio = dimensions.width / dimensions.height;
  const previewWidth = isTallPreview
    ? `min(100%, max(210px, calc((100dvh - 300px) * ${previewRatio.toFixed(4)})))`
    : "100%";

  async function downloadVideo() {
    if (render.status === "done" && render.downloadUrl) {
      const link = document.createElement("a");
      link.href = render.downloadUrl;
      link.download = "raviok-agent-video.mp4";
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    await renderVideo();
  }

  useUiAction((action) => {
    if (action.action === "video.configure") {
      if (typeof action.prompt === "string") setPrompt(action.prompt.slice(0, 2000));
      if (typeof action.durationSec === "number" && action.durationSec >= 5 && action.durationSec <= 300) setDurationSec(action.durationSec);
      if (action.aspectRatio === "16:9" || action.aspectRatio === "9:16" || action.aspectRatio === "1:1") setAspectRatio(action.aspectRatio);
      if (typeof action.audience === "string") setAudience(action.audience.slice(0, 200));
      if (typeof action.tone === "string") setTone(action.tone.slice(0, 200));
      if (typeof action.style === "string") setStyle(action.style.slice(0, 200));
    } else if (action.action === "video.run") {
      if (!meetingStartDisabled) void startMeeting();
    } else if (action.action === "video.approval" && pendingApproval) {
      const decision = actionString(action, "decision");
      if (decision !== "approve" && decision !== "reject") return;
      const label = decision === "approve" ? "비용을 승인하고 실행" : "비용 요청을 거절";
      if (window.confirm(`이 영상 작업의 ${label}할까요?`)) void decideCostApproval(decision === "approve" ? "approved" : "rejected");
    } else if (action.action === "video.render") {
      if (!renderInProgress && !archiveInProgress) void renderVideo();
    } else if (action.action === "video.storage") {
      const operation = actionString(action, "operation");
      if (operation === "open") setStorageOpen(true);
      else if (operation === "close") setStorageOpen(false);
    }
  }, "video");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13]">
      {!embedded ? <header className="shrink-0 border-b border-edge bg-panel/70 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">Raviok × Remotion</div>
            <h1 className="mt-1 max-w-xl truncate text-xl font-bold text-white" title={activeWork?.title || "Agent Video"}>{activeWork?.title || "Agent Video"}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <button type="button" onClick={() => setStorageOpen(true)} className="rounded-full border border-sky-900/70 bg-sky-950/40 px-3 py-1.5 font-bold text-sky-300 transition hover:bg-sky-900/50">
              ☁ 저장소
            </button>
            <span className="rounded-full border border-emerald-900/70 bg-emerald-950/40 px-3 py-1.5 text-emerald-300">로컬 Remotion 렌더</span>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full border border-edge bg-[#0b1018] text-gray-400 transition hover:border-gray-600 hover:bg-edge hover:text-white" title="업무 폴더로 돌아가기" aria-label="업무 폴더로 돌아가기">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </div>
        </div>
      </header> : (
        <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-panel/45 px-4 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">인포그래픽 제작 워크스페이스</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setStorageOpen(true)} className="rounded-full border border-sky-900/70 bg-sky-950/40 px-3 py-1.5 text-[10px] font-bold text-sky-300 transition hover:bg-sky-900/50">☁ 저장소</button>
            <span className="rounded-full border border-emerald-900/70 bg-emerald-950/40 px-3 py-1.5 text-[10px] text-emerald-300">로컬 Remotion 렌더</span>
          </div>
        </div>
      )}

      <CompanySkillThreeColumnLayout slots={{
        OverviewFields: <>
            <div className="mb-2.5 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-950 text-sm">🧭</span>
              <div>
                <h2 className="text-sm font-bold text-gray-100">개요</h2>
                <p className="text-[10px] text-gray-500">제작할 결과물의 기준을 입력합니다.</p>
              </div>
            </div>
            <FieldLabel>영상 요청</FieldLabel>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={1600}
              className="w-full resize-none rounded-lg border border-edge bg-[#0b1018] px-3 py-2 text-xs leading-5 text-gray-100 outline-none placeholder:text-gray-600 focus:border-emerald-700"
              placeholder="예: 신제품의 핵심 장점을 소개하는 20초 세로형 영상"
            />

            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <div>
                <FieldLabel>길이</FieldLabel>
                <SelectField value={String(durationSec)} onChange={(value) => setDurationSec(Number(value))}>
                  <option value="15">15초</option>
                  <option value="30">30초</option>
                  <option value="45">45초</option>
                  <option value="60">60초</option>
                </SelectField>
              </div>
              <div>
                <FieldLabel>화면비</FieldLabel>
                <SelectField value={aspectRatio} onChange={(value) => setAspectRatio(value as typeof aspectRatio)}>
                  <option value="16:9">16:9 가로</option>
                  <option value="9:16">9:16 세로</option>
                  <option value="1:1">1:1 정사각</option>
                </SelectField>
              </div>
            </div>

            <div className="mt-2">
              <FieldLabel>시청 대상</FieldLabel>
              <input value={audience} onChange={(event) => setAudience(event.target.value)} className="w-full rounded-lg border border-edge bg-[#0b1018] px-3 py-2 text-xs text-gray-200 outline-none focus:border-emerald-700" />
            </div>
            <div className="mt-2">
              <FieldLabel>톤</FieldLabel>
              <input value={tone} onChange={(event) => setTone(event.target.value)} className="w-full rounded-lg border border-edge bg-[#0b1018] px-3 py-2 text-xs text-gray-200 outline-none focus:border-emerald-700" />
            </div>
            <div className="mt-2">
              <FieldLabel>스타일</FieldLabel>
              <input value={style} onChange={(event) => setStyle(event.target.value)} className="w-full rounded-lg border border-edge bg-[#0b1018] px-3 py-2 text-xs text-gray-200 outline-none focus:border-emerald-700" />
            </div>

            <button
              type="button"
              onClick={startMeeting}
              disabled={meetingStartDisabled}
              aria-busy={meetingInProgress}
              className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {meetingInProgress ? "작업 중..." : "작업 시작"}
            </button>
            {meetingInProgress && (
              <div className="mt-2 line-clamp-2 rounded-lg border border-emerald-950 bg-emerald-950/25 p-2 text-[10px] leading-4 text-emerald-200">
                플롯이 구성을 설계한 뒤 잉크·픽셀·비트가 대본, 비주얼, 사운드를 병렬로 제작하고 코어가 최종 명세를 통합합니다.
              </div>
            )}
            {error && <div className="mt-2 line-clamp-2 rounded-lg border border-red-900/70 bg-red-950/35 p-2 text-[10px] leading-4 text-red-300">{error}</div>}
        </>,
        ApprovalPanel: pendingApproval ? (
          <div className="mt-2 rounded-lg border border-amber-800/70 bg-amber-950/30 p-2.5 text-[10px] leading-4 text-amber-100">
            <strong className="block text-xs">비용 승인 대기</strong>
            <p className="mt-1 text-amber-200/80">{pendingApproval.approvalState?.action}</p>
            <p className="mt-1 font-mono">
              {pendingApproval.costEstimate?.amount == null
                ? "예상 금액 산정 불가"
                : `예상 최대 비용 $${pendingApproval.costEstimate.amount.toFixed(6)} USD`}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void decideCostApproval("rejected")} className="rounded-md border border-gray-700 px-2 py-1.5 font-bold text-gray-300 hover:bg-gray-800">거절</button>
              <button type="button" onClick={() => void decideCostApproval("approved")} className="rounded-md bg-amber-600 px-2 py-1.5 font-bold text-white hover:bg-amber-500">승인 후 실행</button>
            </div>
          </div>
        ) : null,
        PreviewToolbar: (
            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-gray-200">미리보기</h2>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{spec.scenes.length}개 씬</span>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{videoDurationSec.toFixed(0)}초</span>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{spec.aspectRatio}</span>
              <span className="ml-auto text-[11px] text-gray-500">{spec.title}</span>
            </div>
        ),
        PreviewRenderer: (
            <div className={`min-h-0 flex-1 ${isTallPreview ? "grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]" : "flex flex-col"}`}>
              <div className={`flex min-h-0 min-w-0 justify-center overflow-hidden ${isTallPreview ? "h-full items-center" : "shrink-0"}`}>
                <div
                  className="max-h-full overflow-hidden rounded-xl border border-edge bg-black shadow-2xl shadow-black/40"
                  style={{ width: previewWidth, aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
                >
                  <Player
                    key={`${spec.createdAt}-${spec.aspectRatio}-${spec.scenes.length}`}
                    component={AgentVideo}
                    inputProps={{ spec }}
                    durationInFrames={durationInFrames}
                    compositionWidth={dimensions.width}
                    compositionHeight={dimensions.height}
                    fps={spec.fps}
                    controls
                    loop
                    style={{ width: "100%", height: "100%" }}
                  />
                </div>
              </div>

              <div
                className={isTallPreview ? "grid h-full min-h-0 gap-2" : "mt-2 grid min-h-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"}
                style={isTallPreview ? { gridTemplateRows: `repeat(${Math.max(1, spec.scenes.length)}, minmax(0, 1fr))` } : undefined}
              >
              {spec.scenes.map((scene, index) => (
                <article key={scene.id} className="min-h-0 overflow-hidden rounded-lg border border-edge bg-panel p-2">
                  <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-gray-500">
                    <span style={{ background: scene.accent }} className="h-2 w-2 rounded-full" />
                    Scene {String(index + 1).padStart(2, "0")} · {scene.durationSec}초
                  </div>
                  <h3 className="mt-1 line-clamp-2 whitespace-pre-line text-xs font-bold leading-4 text-gray-100">{scene.title}</h3>
                  {!isTallPreview && <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-gray-500">{scene.body}</p>}
                  {!isTallPreview && <div className="mt-1 flex gap-1 text-[8px] text-gray-500">
                    <span className="rounded bg-[#0b1018] px-1.5 py-1">{scene.visual}</span>
                    <span className="rounded bg-[#0b1018] px-1.5 py-1">SFX · {scene.sfx}</span>
                  </div>}
                </article>
              ))}
              </div>
            </div>
        ),
        ReportRenderer: <>
          <h2 className="text-sm font-bold text-gray-200">업무 보고</h2>
          <div className="mt-2 grid gap-1.5">
            {contributions.length ? contributions.map((item) => <ContributionCard key={item.agentId} item={item} />) : (
              <div className="rounded-lg border border-dashed border-edge p-3 text-center text-[10px] leading-4 text-gray-600">
                대기중
              </div>
            )}
          </div>
        </>,
        CompletionActions: (
            <button
              type="button"
              onClick={downloadVideo}
              disabled={renderInProgress || archiveInProgress}
              aria-busy={renderInProgress || archiveInProgress}
              title={renderInProgress ? `영상 준비 중 ${Math.round(render.progress || 0)}%` : archiveInProgress ? "저장 중" : "MP4 다운로드"}
              className="w-full rounded-lg border border-orange-700/70 bg-orange-950/40 px-3 py-2.5 text-xs font-bold text-orange-200 transition hover:bg-orange-900/50 disabled:cursor-wait disabled:opacity-60"
            >
              다운로드
            </button>
        ),
      }} />
      <AgentVideoStorageModal
        open={storageOpen}
        onClose={() => setStorageOpen(false)}
        revision={storageRevision}
        workId={activeWork?.id}
        date={koreaDate(activeWork?.created_at)}
      />
    </div>
  );
}
