import { useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { AgentVideo } from "../remotion/AgentVideo";
import AgentVideoStorageModal from "./AgentVideoStorageModal";
import {
  getAgentVideoDimensions,
  getAgentVideoDurationSec,
  type AgentVideoContribution,
} from "../remotion/spec";
import { useAgentVideoWorkspace } from "../contexts/AgentVideoWorkspaceContext";

function FieldLabel({ children }: { children: string }) {
  return <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500">{children}</label>;
}

function SelectField({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-xl border border-edge bg-[#0b1018] px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-emerald-700"
    >
      {children}
    </select>
  );
}

function ContributionCard({ item }: { item: AgentVideoContribution }) {
  return (
    <article className="rounded-xl border border-edge bg-[#0b1018] p-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{item.emoji}</span>
        <strong className="text-sm text-gray-200">{item.agentName}</strong>
        <span className="ml-auto rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] text-emerald-300">완료</span>
      </div>
      <p className="mt-2 line-clamp-4 text-xs leading-5 text-gray-400">{item.summary}</p>
    </article>
  );
}

function koreaDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export default function AgentVideoWorkspace() {
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
    startMeeting,
    renderVideo,
  } = useAgentVideoWorkspace();
  const [storageOpen, setStorageOpen] = useState(false);
  const meetingInProgress = meetingStatus === "running";
  const renderInProgress = render.status === "queued" || render.status === "rendering";
  const archiveInProgress = archive.status === "uploading";

  const dimensions = useMemo(() => getAgentVideoDimensions(spec.aspectRatio), [spec.aspectRatio]);
  const videoDurationSec = useMemo(() => getAgentVideoDurationSec(spec), [spec]);
  const durationInFrames = Math.max(1, Math.round(videoDurationSec * spec.fps));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13]">
      <header className="shrink-0 border-b border-edge bg-panel/70 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">Raviok × Remotion</div>
            <h1 className="mt-1 max-w-xl truncate text-xl font-bold text-white" title={activeWork?.title || "Agent Video"}>{activeWork?.title || "Agent Video"}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <button type="button" onClick={() => setStorageOpen(true)} className="rounded-full border border-sky-900/70 bg-sky-950/40 px-3 py-1.5 font-bold text-sky-300 transition hover:bg-sky-900/50">
              ☁ 저장소
            </button>
            <span className="rounded-full border border-edge bg-[#0b1018] px-3 py-1.5">AI Cinema와 분리된 독립 제작</span>
            <span className="rounded-full border border-emerald-900/70 bg-emerald-950/40 px-3 py-1.5 text-emerald-300">로컬 Remotion 렌더</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[360px_minmax(0,1fr)_320px] xl:overflow-hidden">
        <aside className="border-b border-edge p-4 xl:overflow-y-auto xl:border-b-0 xl:border-r">
          <div className="rounded-2xl border border-edge bg-panel p-4">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-950 text-lg">🧭</span>
              <div>
                <h2 className="text-sm font-bold text-gray-100">코어에게 제작 의뢰</h2>
                <p className="text-[11px] text-gray-500">전문 에이전트들이 각자의 파트를 설계합니다.</p>
              </div>
            </div>
            <FieldLabel>영상 요청</FieldLabel>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={6}
              maxLength={1600}
              className="w-full resize-y rounded-xl border border-edge bg-[#0b1018] px-3 py-3 text-sm leading-6 text-gray-100 outline-none placeholder:text-gray-600 focus:border-emerald-700"
              placeholder="예: 신제품의 핵심 장점을 소개하는 20초 세로형 영상"
            />

            <div className="mt-4 grid grid-cols-2 gap-3">
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

            <div className="mt-3">
              <FieldLabel>시청 대상</FieldLabel>
              <input value={audience} onChange={(event) => setAudience(event.target.value)} className="w-full rounded-xl border border-edge bg-[#0b1018] px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-emerald-700" />
            </div>
            <div className="mt-3">
              <FieldLabel>톤</FieldLabel>
              <input value={tone} onChange={(event) => setTone(event.target.value)} className="w-full rounded-xl border border-edge bg-[#0b1018] px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-emerald-700" />
            </div>
            <div className="mt-3">
              <FieldLabel>스타일</FieldLabel>
              <input value={style} onChange={(event) => setStyle(event.target.value)} className="w-full rounded-xl border border-edge bg-[#0b1018] px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-emerald-700" />
            </div>

            <button
              type="button"
              onClick={startMeeting}
              disabled={meetingInProgress}
              aria-busy={meetingInProgress}
              className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {meetingInProgress ? "회의 중..." : "에이전트 제작 회의 시작"}
            </button>
            {meetingInProgress && (
              <div className="mt-3 rounded-xl border border-emerald-950 bg-emerald-950/25 p-3 text-xs leading-5 text-emerald-200">
                플롯이 구성을 설계한 뒤 잉크·픽셀·비트가 대본, 비주얼, 사운드를 병렬로 제작하고 코어가 최종 명세를 통합합니다.
              </div>
            )}
            {error && <div className="mt-3 rounded-xl border border-red-900/70 bg-red-950/35 p-3 text-xs leading-5 text-red-300">{error}</div>}
          </div>
        </aside>

        <main className="min-w-0 p-4 xl:overflow-y-auto">
          <div className="mx-auto max-w-5xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-gray-200">Remotion 프리뷰</h2>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{spec.scenes.length}개 씬</span>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{videoDurationSec.toFixed(0)}초</span>
              <span className="rounded-full bg-[#121a27] px-2.5 py-1 text-[10px] text-gray-400">{spec.aspectRatio}</span>
              <span className="ml-auto text-[11px] text-gray-500">{spec.title}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-edge bg-black shadow-2xl shadow-black/40">
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
                style={{ width: "100%", aspectRatio: `${dimensions.width} / ${dimensions.height}` }}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {spec.scenes.map((scene, index) => (
                <article key={scene.id} className="rounded-xl border border-edge bg-panel p-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">
                    <span style={{ background: scene.accent }} className="h-2 w-2 rounded-full" />
                    Scene {String(index + 1).padStart(2, "0")} · {scene.durationSec}초
                  </div>
                  <h3 className="mt-2 whitespace-pre-line text-sm font-bold leading-5 text-gray-100">{scene.title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">{scene.body}</p>
                  <div className="mt-2 flex gap-1.5 text-[9px] text-gray-500">
                    <span className="rounded bg-[#0b1018] px-1.5 py-1">{scene.visual}</span>
                    <span className="rounded bg-[#0b1018] px-1.5 py-1">SFX · {scene.sfx}</span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </main>

        <aside className="border-t border-edge p-4 xl:overflow-y-auto xl:border-l xl:border-t-0">
          <h2 className="text-sm font-bold text-gray-200">협업 보고서</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">각 에이전트의 판단을 코어가 하나의 Render Manifest로 통합합니다.</p>
          <div className="mt-3 space-y-2">
            {contributions.length ? contributions.map((item) => <ContributionCard key={item.agentId} item={item} />) : (
              <div className="rounded-xl border border-dashed border-edge p-4 text-center text-xs leading-5 text-gray-600">
                제작 회의를 시작하면 플롯, 잉크, 픽셀, 비트, 코어의 작업 결과가 표시됩니다.
              </div>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-edge bg-panel p-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎬</span>
              <div>
                <h3 className="text-sm font-bold text-gray-100">자동 렌더·클라우드 저장</h3>
                <p className="text-[10px] text-gray-500">Remotion MP4 · GCS 소스 보관</p>
              </div>
            </div>
            <button
              type="button"
              onClick={renderVideo}
              disabled={renderInProgress || archiveInProgress}
              className="mt-4 w-full rounded-xl border border-orange-700/70 bg-orange-950/40 px-4 py-2.5 text-sm font-bold text-orange-200 transition hover:bg-orange-900/50 disabled:cursor-wait disabled:opacity-60"
            >
              {renderInProgress
                ? `자동 렌더링 ${Math.round(render.progress || 0)}%`
                : archiveInProgress
                  ? "클라우드 저장 중..."
                  : archive.status === "done"
                    ? "다시 렌더 및 저장"
                    : "MP4 렌더 및 저장"}
            </button>
            {renderInProgress && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#0b1018]">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, render.progress || 0)}%` }} />
              </div>
            )}
            {archive.status === "uploading" && (
              <div className="mt-3 rounded-xl border border-sky-900/70 bg-sky-950/30 p-3 text-xs leading-5 text-sky-200">
                완성된 MP4와 제작 명세를 이 회사 업무의 날짜별 폴더에 저장하고 있습니다.
              </div>
            )}
            {archive.status === "done" && (
              <button type="button" onClick={() => setStorageOpen(true)} className="mt-3 w-full rounded-xl border border-emerald-800 bg-emerald-950/35 px-3 py-2.5 text-xs font-bold text-emerald-300 hover:bg-emerald-950/60">
                저장 완료 · 저장소에서 확인
              </button>
            )}
            {render.status === "done" && render.downloadUrl && (
              <a href={render.downloadUrl} className="mt-3 block w-full rounded-xl bg-orange-600 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-orange-500">
                로컬 MP4 다운로드
              </a>
            )}
            {render.status === "error" && (
              <div className="mt-3 rounded-xl border border-red-900/70 bg-red-950/35 p-3 text-xs leading-5 text-red-300">
                {render.error || "렌더링에 실패했습니다."}<br />로컬에서 <code className="text-red-200">npm start</code>가 실행 중인지 확인해 주세요.
              </div>
            )}
            {archive.status === "error" && render.status !== "error" && (
              <div className="mt-3 rounded-xl border border-red-900/70 bg-red-950/35 p-3 text-xs leading-5 text-red-300">
                {archive.error || "클라우드 저장에 실패했습니다."}
              </div>
            )}
            <p className="mt-3 text-[10px] leading-4 text-gray-600">프리뷰 명세가 생성되면 이 PC에서 MP4를 자동 렌더하고, 사용자별 GCS 저장소에 MP4와 JSON 명세를 보관합니다.</p>
          </div>
        </aside>
      </div>
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
