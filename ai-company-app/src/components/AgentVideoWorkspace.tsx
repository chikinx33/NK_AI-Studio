import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { AgentVideo } from "../remotion/AgentVideo";
import {
  defaultAgentVideoSpec,
  getAgentVideoDimensions,
  getAgentVideoDurationSec,
  normalizeAgentVideoSpec,
  type AgentVideoContribution,
  type AgentVideoSpec,
} from "../remotion/spec";
import {
  createAgentVideo,
  getLocalAgentVideoRenderStatus,
  startLocalAgentVideoRender,
  type LocalAgentVideoRenderStatus,
} from "../lib/api";

const STORAGE_KEY = "raviok_agent_video_project_v1";

const loadSavedSpec = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeAgentVideoSpec(JSON.parse(saved)) : defaultAgentVideoSpec;
  } catch {
    return defaultAgentVideoSpec;
  }
};

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

export default function AgentVideoWorkspace() {
  const [prompt, setPrompt] = useState("라비오크의 AI 에이전트들이 협업해 아이디어를 영상으로 완성하는 과정을 소개하는 30초 브랜드 영상");
  const [durationSec, setDurationSec] = useState(30);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [audience, setAudience] = useState("콘텐츠 제작자와 1인 기업");
  const [tone, setTone] = useState("신뢰감 있고 미래지향적");
  const [style, setStyle] = useState("시네마틱 테크 인포그래픽");
  const [spec, setSpec] = useState<AgentVideoSpec>(loadSavedSpec);
  const [contributions, setContributions] = useState<AgentVideoContribution[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [render, setRender] = useState<LocalAgentVideoRenderStatus>({ status: "idle" });

  const dimensions = useMemo(() => getAgentVideoDimensions(spec.aspectRatio), [spec.aspectRatio]);
  const videoDurationSec = useMemo(() => getAgentVideoDurationSec(spec), [spec]);
  const durationInFrames = Math.max(1, Math.round(videoDurationSec * spec.fps));

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(spec)); } catch { /* 저장 실패는 프리뷰를 막지 않는다. */ }
  }, [spec]);

  useEffect(() => {
    if (!render.jobId || (render.status !== "queued" && render.status !== "rendering")) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getLocalAgentVideoRenderStatus(render.jobId!);
        setRender(next);
        if (next.status === "done" || next.status === "error") window.clearInterval(timer);
      } catch (caught) {
        setRender({ ...render, status: "error", error: caught instanceof Error ? caught.message : "렌더 상태 확인 실패" });
        window.clearInterval(timer);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [render.jobId, render.status]);

  async function createVideo() {
    if (!prompt.trim()) {
      setError("만들고 싶은 영상 내용을 입력해 주세요.");
      return;
    }
    setCreating(true);
    setError("");
    setRender({ status: "idle" });
    try {
      const result = await createAgentVideo({ prompt: prompt.trim(), durationSec, aspectRatio, audience, tone, style });
      setSpec(normalizeAgentVideoSpec(result.spec));
      setContributions(result.contributions || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "에이전트 협업 중 오류가 발생했어요.");
    } finally {
      setCreating(false);
    }
  }

  async function renderVideo() {
    setError("");
    setRender({ status: "queued", progress: 0 });
    try {
      const next = await startLocalAgentVideoRender(spec);
      setRender(next);
    } catch (caught) {
      setRender({ status: "error", error: caught instanceof Error ? caught.message : "로컬 렌더 실패" });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13]">
      <header className="shrink-0 border-b border-edge bg-panel/70 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-400">Raviok × Remotion</div>
            <h1 className="mt-1 text-xl font-bold text-white">Agent Video</h1>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
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
              onClick={createVideo}
              disabled={creating}
              className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
            >
              {creating ? "에이전트 협업 제작 중…" : "에이전트 제작 회의 시작"}
            </button>
            {creating && (
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
                <h3 className="text-sm font-bold text-gray-100">데스크톱 최종 렌더</h3>
                <p className="text-[10px] text-gray-500">Remotion CLI · H.264 MP4</p>
              </div>
            </div>
            <button
              type="button"
              onClick={renderVideo}
              disabled={render.status === "queued" || render.status === "rendering"}
              className="mt-4 w-full rounded-xl border border-orange-700/70 bg-orange-950/40 px-4 py-2.5 text-sm font-bold text-orange-200 transition hover:bg-orange-900/50 disabled:cursor-wait disabled:opacity-60"
            >
              {render.status === "queued" || render.status === "rendering" ? `렌더링 ${Math.round(render.progress || 0)}%` : "로컬 MP4 렌더"}
            </button>
            {(render.status === "queued" || render.status === "rendering") && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#0b1018]">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max(2, render.progress || 0)}%` }} />
              </div>
            )}
            {render.status === "done" && render.downloadUrl && (
              <a href={render.downloadUrl} className="mt-3 block w-full rounded-xl bg-orange-600 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-orange-500">
                MP4 다운로드
              </a>
            )}
            {render.status === "error" && (
              <div className="mt-3 rounded-xl border border-red-900/70 bg-red-950/35 p-3 text-xs leading-5 text-red-300">
                {render.error || "렌더링에 실패했습니다."}<br />로컬에서 <code className="text-red-200">npm start</code>가 실행 중인지 확인해 주세요.
              </div>
            )}
            <p className="mt-3 text-[10px] leading-4 text-gray-600">영상은 클라우드 렌더 서비스가 아니라 이 프로젝트가 실행 중인 PC에서 생성됩니다.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
