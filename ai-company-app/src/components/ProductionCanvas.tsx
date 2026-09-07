import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAgentJob,
  getAgentJob,
  getProductionGraph,
  listProductionProjects,
  withMediaToken,
  type ProductionEdge,
  type ProductionGraph,
  type ProductionNode,
  type ProductionProjectSummary,
} from "../lib/api";
import ProjectPicker from "./ProjectPicker";
import { readStorage, writeStorage } from "../lib/safeStorage";
import { actionString, useUiAction } from "../lib/uiActions";
import VideoPipelinePanel from "./VideoPipelinePanel";
import CanvasChatDock from "./CanvasChatDock";
import { loadCanvasSettings, saveCanvasSettings, type CanvasSettings } from "../lib/canvasSettings";
import { approveItem } from "../lib/api";

/**
 * 제작 캔버스 — 스토리보드·영상·프롬프트를 노드로 관리하는 화면.
 *
 * 노드 종류는 자유 배선이 아니라 연출 문법으로 고정한다(공통 프롬프트 / 장소 / 캐릭터 / 컷).
 * 엣지도 정해진 관계만 그린다(컷 순서 · 컷 참조 · 장소 사용 · 캐릭터 등장 · 공통 프롬프트 오버라이드).
 * 사용자가 임의 모델 노드를 잇는 캔버스는 학습 곡선이 가파르고(시장의 Weavy/ComfyUI 불만),
 * 우리 연속성 보장(stage-geometry·body-grammar·방위 플레이트)이 배선 하나에 무너지기 때문이다.
 *
 * 데이터는 서버(/api/agent/production-graph)가 단일 조립기로 만든 그래프이고,
 * 변경은 전부 에이전트 도구(scene_upsert / scene_still / scene_video / video_pipeline)를 거친다.
 * 캔버스는 그 결과를 보여주는 창이지 두 번째 저장 경로가 아니다.
 */

interface Pos { x: number; y: number }
type PosMap = Record<string, Pos>;

const NODE_W: Record<ProductionNode["type"], number> = { common: 280, location: 220, character: 220, cut: 300 };
const NODE_H: Record<ProductionNode["type"], number> = { common: 120, location: 84, character: 96, cut: 292 };
const EDGE_STYLE: Record<ProductionEdge["type"], { stroke: string; dash?: string; label: string }> = {
  sequence: { stroke: "#4b5563", label: "컷 순서" },
  cutRef: { stroke: "#f59e0b", dash: "6 4", label: "컷 참조" },
  location: { stroke: "#06b6d4", label: "장소" },
  character: { stroke: "#a78bfa", label: "캐릭터" },
  commonOverride: { stroke: "#10b981", dash: "3 4", label: "공통 오버라이드" },
};
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

function layoutGraph(graph: ProductionGraph): PosMap {
  const pos: PosMap = {};
  const characters = graph.nodes.filter((n) => n.type === "character");
  const locations = graph.nodes.filter((n) => n.type === "location");
  const cuts = graph.nodes.filter((n) => n.type === "cut").sort((a, b) => Number(a.data.order) - Number(b.data.order));
  pos.common = { x: 40, y: 40 };
  characters.forEach((n, i) => { pos[n.id] = { x: 40, y: 200 + i * 120 }; });
  locations.forEach((n, i) => { pos[n.id] = { x: 40, y: 200 + characters.length * 120 + 40 + i * 110 }; });
  const perRow = 5;
  cuts.forEach((n, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    pos[n.id] = { x: 380 + col * 340, y: 40 + row * 340 };
  });
  return pos;
}

/** 직각 경로. 도착이 오른쪽이면 가운데서 한 번 꺾고, 왼쪽(역방향)이면 밖으로 나갔다가 위아래 통로로 돌아 들어온다. */
function orthogonalPath(a: Pos, b: Pos): string {
  const stub = 32;
  if (b.x - a.x >= stub * 2) {
    const mx = Math.round((a.x + b.x) / 2);
    return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`;
  }
  const my = Math.round((a.y + b.y) / 2);
  return `M ${a.x} ${a.y} L ${a.x + stub} ${a.y} L ${a.x + stub} ${my} L ${b.x - stub} ${my} L ${b.x - stub} ${b.y} L ${b.x} ${b.y}`;
}

function anchorOut(node: ProductionNode, p: Pos): Pos { return { x: p.x + NODE_W[node.type], y: p.y + Math.min(NODE_H[node.type], 140) / 2 }; }
function anchorIn(node: ProductionNode, p: Pos): Pos { return { x: p.x, y: p.y + Math.min(NODE_H[node.type], 140) / 2 }; }

function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "emerald" | "amber" | "cyan" | "violet" | "red" }) {
  const map = {
    gray: "border-gray-700 text-gray-400",
    emerald: "border-emerald-700/60 text-emerald-300",
    amber: "border-amber-700/60 text-amber-300",
    cyan: "border-cyan-700/60 text-cyan-300",
    violet: "border-violet-700/60 text-violet-300",
    red: "border-red-800/60 text-red-300",
  };
  return <span className={`rounded border px-1 py-px text-[9px] font-bold uppercase tracking-wide ${map[tone]}`}>{children}</span>;
}

function WorkflowIcon({ className }: { className?: string }) {
  // lucide: workflow
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="8" height="8" x="3" y="3" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect width="8" height="8" x="13" y="13" rx="2" />
    </svg>
  );
}
function RefreshIcon({ className }: { className?: string }) {
  // lucide: refresh-cw
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />
    </svg>
  );
}
function BotIcon({ className }: { className?: string }) {
  // lucide: bot
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  );
}

interface PendingJob { jobId: string; type: string; sceneId?: string | number; status: string; label: string }

export default function ProductionCanvas({
  projectId: projectIdProp = "",
  focusSceneId = null,
  focusNonce = 0,
  embedded = false,
  onProjectChange,
  edgeStyle = "curve",
  edgesVisible = true,
}: {
  projectId?: string;
  focusSceneId?: string | number | null;
  focusNonce?: number;
  embedded?: boolean;
  onProjectChange?: (projectId: string) => void;
  edgeStyle?: "curve" | "straight";
  edgesVisible?: boolean;
}) {
  const [projects, setProjects] = useState<ProductionProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectId, setProjectId] = useState(projectIdProp || readStorage("canvasProjectId"));
  const [graph, setGraph] = useState<ProductionGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [positions, setPositions] = useState<PosMap>({});
  const [view, setView] = useState({ x: 0, y: 0, scale: 0.8 });
  const [selectedId, setSelectedId] = useState<string>("");
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingJob[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  // 채팅 도구가 파이프라인·스틸·영상을 만들었을 때 패널과 그래프를 다시 읽게 하는 카운터.
  const [pipelineNonce, setPipelineNonce] = useState(0);
  // 작성기 설정(생성 전 확인 · 이미지/영상 기본값). 인스펙터 버튼과 채팅 맥락이 같은 값을 쓴다.
  const [settings, setSettings] = useState<CanvasSettings>(() => loadCanvasSettings());
  const updateSettings = useCallback((next: CanvasSettings) => { setSettings(next); saveCanvasSettings(next); }, []);
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<{ common: string; composition: string; action: string; promptText: string; cutRefId: string; cutRefEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  useEffect(() => { if (projectIdProp) setProjectId(projectIdProp); }, [projectIdProp]);

  const reloadProjects = useCallback(() => {
    setProjectsLoading(true);
    listProductionProjects().then(setProjects).catch(() => setProjects([])).finally(() => setProjectsLoading(false));
  }, []);
  useEffect(() => { reloadProjects(); }, [reloadProjects]);

  const load = useCallback(async (silent = false) => {
    if (!projectId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const g = await getProductionGraph(projectId);
      setGraph(g);
      // 배치는 프로젝트별로 기억한다(사용자가 옮긴 노드는 그대로).
      const saved = readStorage(`canvasPos:${projectId}`);
      let parsed: PosMap = {};
      try { parsed = saved ? JSON.parse(saved) : {}; } catch { parsed = {}; }
      const base = layoutGraph(g);
      setPositions({ ...base, ...parsed });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    writeStorage("canvasProjectId", projectId);
    onProjectChange?.(projectId);
    setSelectedId("");
    setMulti(new Set());
    setDraft(null);
    void load();
  }, [projectId, load, onProjectChange]);

  useEffect(() => {
    if (!projectId || !Object.keys(positions).length) return;
    writeStorage(`canvasPos:${projectId}`, JSON.stringify(positions));
  }, [positions, projectId]);

  const nodeById = useMemo(() => new Map((graph?.nodes || []).map((n) => [n.id, n])), [graph]);
  const selected = selectedId ? nodeById.get(selectedId) || null : null;
  const selectedSceneIds = useMemo(() => {
    const ids: Array<string | number> = [];
    for (const id of multi) { const n = nodeById.get(id); if (n?.type === "cut") ids.push(n.data.sceneId); }
    if (!ids.length && selected?.type === "cut") ids.push(selected.data.sceneId);
    return ids;
  }, [multi, nodeById, selected]);

  useEffect(() => {
    if (!selected || selected.type !== "cut") { setDraft(null); return; }
    setDraft({
      common: String(selected.data.common || ""),
      composition: String(selected.data.composition || ""),
      action: String(selected.data.action || ""),
      promptText: String(selected.data.promptText || ""),
      cutRefId: String(selected.data.cutRefId || ""),
      cutRefEnabled: !!selected.data.cutRefEnabled,
    });
  }, [selected]);

  const centerOn = useCallback((nodeId: string) => {
    const n = nodeById.get(nodeId);
    const p = positionsRef.current[nodeId];
    const el = containerRef.current;
    if (!n || !p || !el) return;
    const scale = viewRef.current.scale;
    const cx = p.x + NODE_W[n.type] / 2;
    const cy = p.y + NODE_H[n.type] / 2;
    setView({ scale, x: el.clientWidth / 2 - cx * scale, y: el.clientHeight / 2 - cy * scale });
  }, [nodeById]);

  const focusScene = useCallback((sceneId: string | number | null | undefined) => {
    if (sceneId == null || sceneId === "") return;
    const id = `cut:${sceneId}`;
    if (!nodeById.has(id)) return;
    setSelectedId(id);
    setMulti(new Set([id]));
    centerOn(id);
  }, [centerOn, nodeById]);

  useEffect(() => { if (focusNonce) focusScene(focusSceneId); }, [focusNonce, focusSceneId, focusScene]);

  // 채팅(코어)이 캔버스를 조종하는 UI 액션. 데이터 변경은 여기서 하지 않는다 — 도구 결과를 다시 읽을 뿐.
  useUiAction((action) => {
    const name = String(action.action || "");
    if (!name.startsWith("canvas.")) return;
    const pid = actionString(action, "projectId");
    if (pid && pid !== projectId) setProjectId(pid);
    if (name === "canvas.focus") window.setTimeout(() => focusScene(action.sceneId as string | number), pid && pid !== projectId ? 800 : 0);
    else if (name === "canvas.select") {
      const ids = Array.isArray(action.sceneIds) ? action.sceneIds : [];
      const set = new Set(ids.map((v) => `cut:${v}`).filter((id) => nodeById.has(id)));
      setMulti(set);
      const first = [...set][0];
      if (first) { setSelectedId(first); centerOn(first); }
    } else if (name === "canvas.refresh") void load(true);
  }, "canvas");

  // 승인 대기·실행 중인 도구 잡을 지켜보다가 끝나면 그래프를 다시 읽는다.
  useEffect(() => {
    const active = pending.filter((p) => !["approved", "error", "cancelled", "revise"].includes(p.status));
    if (!active.length) return;
    const timer = window.setInterval(async () => {
      let changed = false;
      const next = await Promise.all(pending.map(async (p) => {
        if (["approved", "error", "cancelled", "revise"].includes(p.status)) return p;
        const job = await getAgentJob(p.jobId).catch(() => null);
        const status = String(job?.status || job?.review_status || p.status);
        if (status !== p.status) changed = true;
        return { ...p, status };
      }));
      setPending(next);
      if (changed) void load(true);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  // 에이전트 설정 '생성 전 확인: 안 함' — 이 프로젝트를 대상으로 한 스틸·영상·씬 수정 잡을 자동 승인한다.
  // 서버 승인 게이트(기록·감사)는 그대로 두고 브라우저가 대신 누르는 것뿐이다.
  const AUTO_APPROVE_TYPES = ["scene_still", "scene_video", "scene_upsert"];
  useEffect(() => {
    if (settings.confirmBeforeGenerate || !projectId) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await (await fetch("/api/agent/jobs?limit=20")).json();
        const items: any[] = Array.isArray(d?.items) ? d.items : [];
        for (const j of items) {
          if (!alive) return;
          if (j?.status !== "review_pending" || j?.review_status !== "pending") continue;
          if (!AUTO_APPROVE_TYPES.includes(String(j?.type))) continue;
          if (String(j?.input?.projectId || "") !== projectId) continue;
          await approveItem(String(j.id)).catch(() => null);
        }
      } catch { /* 다음 틱에 다시 */ }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 5_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [settings.confirmBeforeGenerate, projectId]);

  const enqueue = async (type: string, input: Record<string, unknown>, label: string, sceneId?: string | number) => {
    setSaving(true);
    setNotice("");
    try {
      const res = await createAgentJob(type, input);
      setPending((prev) => [{ jobId: res.jobId, type, sceneId, status: res.status || "queued", label }, ...prev].slice(0, 20));
      setNotice(settings.confirmBeforeGenerate ? `${label} — 승인 패널에서 승인하면 실행돼요.` : `${label} — 자동 승인으로 바로 실행돼요.`);
    } catch (e) {
      setNotice(`실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 생성 개수(x1~x4)만큼 같은 컷에 후보를 만든다. 스틸 이력(imageHistory)이 이전 후보를 보존한다.
  const enqueueMany = async (type: string, input: Record<string, unknown>, label: string, sceneId: string | number, count: number) => {
    for (let i = 0; i < Math.max(1, count); i++) await enqueue(type, input, count > 1 ? `${label} (${i + 1}/${count})` : label, sceneId);
  };

  const saveDraft = async () => {
    if (!selected || selected.type !== "cut" || !draft) return;
    await enqueue("scene_upsert", {
      projectId,
      sceneId: selected.data.sceneId,
      scene: {
        common: draft.common,
        composition: draft.composition,
        action: draft.action,
        promptText: draft.promptText,
        promptEdited: !!draft.promptText.trim(),
        cutRefId: draft.cutRefId,
        cutRefEnabled: draft.cutRefEnabled && !!draft.cutRefId,
      },
    }, `컷 ${selected.data.sceneId} 프롬프트 저장`, selected.data.sceneId);
  };

  // ── 팬·줌·드래그 ──
  const onPointerDown = (e: React.PointerEvent, nodeId?: string) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    if (nodeId) {
      const p = positionsRef.current[nodeId] || { x: 0, y: 0 };
      drag.current = { kind: "node", id: nodeId, startX: e.clientX, startY: e.clientY, originX: p.x, originY: p.y, moved: false };
      e.stopPropagation();
    } else {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, originX: viewRef.current.x, originY: viewRef.current.y, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.originX + dx, y: d.originY + dy }));
    else if (d.id) {
      const s = viewRef.current.scale;
      setPositions((p) => ({ ...p, [d.id!]: { x: d.originX + dx / s, y: d.originY + dy / s } }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "node" && d.id && !d.moved) {
      if (e.shiftKey) {
        setMulti((prev) => { const next = new Set(prev); next.has(d.id!) ? next.delete(d.id!) : next.add(d.id!); return next; });
      } else {
        setMulti(new Set([d.id]));
      }
      setSelectedId(d.id);
    } else if (d.kind === "pan" && !d.moved) {
      setSelectedId("");
      setMulti(new Set());
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
      const k = scale / v.scale;
      return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };
  const resetLayout = () => {
    if (!graph) return;
    setPositions(layoutGraph(graph));
    setView({ x: 0, y: 0, scale: 0.8 });
  };

  const edgesToDraw = useMemo(() => (graph?.edges || []).map((e) => {
    const from = nodeById.get(e.from);
    const to = nodeById.get(e.to);
    const pf = positions[e.from];
    const pt = positions[e.to];
    if (!from || !to || !pf || !pt) return null;
    const a = anchorOut(from, pf);
    const b = anchorIn(to, pt);
    const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
    // 곡선(베지어)은 흐름을 읽기 좋고, 직각선(수직·수평만)은 노드가 많을 때 어디서 어디로 가는지 또렷하다 — 사용자가 고른다.
    // 대각선은 쓰지 않는다(사용자 요청): 출발 노드 오른쪽 → 수평 → 수직 → 수평 → 도착 노드 왼쪽.
    const d = edgeStyle === "straight"
      ? orthogonalPath(a, b)
      : `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
    return { edge: e, d, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }).filter(Boolean) as Array<{ edge: ProductionEdge; d: string; mid: Pos }>, [graph, nodeById, positions, edgeStyle]);

  const cutNodes = useMemo(() => (graph?.nodes || []).filter((n) => n.type === "cut"), [graph]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13] ${embedded ? "" : ""}`}>
      {/* 상단 바 */}
      <section className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-[#0c1119] px-3 py-2">
        <WorkflowIcon className="h-4 w-4 text-emerald-400" />
        <span className="text-[9px] font-bold uppercase tracking-[0.22em] text-emerald-400">Production Canvas</span>
        <div className="ml-2"><ProjectPicker projects={projects} value={projectId} onChange={setProjectId} loading={projectsLoading} /></div>
        {graph && (
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="truncate text-gray-300" title={graph.title}>{graph.title}</span>
            <Chip>컷 {graph.summary.scenes}</Chip>
            <Chip tone={graph.summary.stills === graph.summary.scenes ? "emerald" : "gray"}>스틸 {graph.summary.stills}</Chip>
            <Chip tone={graph.summary.clips === graph.summary.scenes ? "emerald" : "gray"}>영상 {graph.summary.clips}</Chip>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(MIN_SCALE, v.scale * 0.9) }))} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="축소">−</button>
          <span className="w-10 text-center text-[11px] text-gray-500">{Math.round(view.scale * 100)}%</span>
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, v.scale * 1.1) }))} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="확대">+</button>
          <button type="button" onClick={resetLayout} className="min-w-[72px] rounded border border-edge px-2 py-1 text-[11px] text-gray-400 hover:bg-edge hover:text-white">정렬 초기화</button>
          <button type="button" onClick={() => { void load(); reloadProjects(); }} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="다시 읽기"><RefreshIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          <button
            type="button"
            onClick={() => setAgentOpen((v) => !v)}
            disabled={!projectId}
            className={`ml-1 flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40 ${agentOpen ? "bg-emerald-600 text-white" : "border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30"}`}
          >
            <BotIcon className="h-4 w-4" /> 에이전트 모드
          </button>
        </div>
      </section>

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* 캔버스 */}
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing"
          style={{ backgroundImage: "radial-gradient(#1f2633 1px, transparent 1px)", backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
          onPointerDown={(e) => onPointerDown(e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {!projectId && (
            <div className="absolute inset-0 grid place-items-center text-center text-sm text-gray-500">
              <div><p className="font-bold text-gray-300">프로젝트를 선택하면 컷·프롬프트·자산이 노드로 펼쳐져요.</p><p className="mt-1 text-xs">채팅에서 "ep1 캔버스 열어줘"라고 해도 돼요.</p></div>
            </div>
          )}
          {error && <div className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded border border-red-800/60 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{error}</div>}
          {loading && !graph && <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">캔버스를 불러오는 중…</div>}

          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
              {edgesVisible && edgesToDraw.map(({ edge, d, mid }) => {
                const st = EDGE_STYLE[edge.type];
                const highlighted = selectedId && (edge.from === selectedId || edge.to === selectedId);
                return (
                  <g key={edge.id} opacity={selectedId && !highlighted ? 0.35 : 1}>
                    <path d={d} fill="none" stroke={st.stroke} strokeWidth={highlighted ? 2.5 : 1.5} strokeDasharray={st.dash} />
                    {edge.label && (
                      <text x={mid.x} y={mid.y - 4} fontSize="9" fill={st.stroke} textAnchor="middle">{edge.label}</text>
                    )}
                  </g>
                );
              })}
            </svg>

            {(graph?.nodes || []).map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              const isSelected = selectedId === n.id || multi.has(n.id);
              const jobsForNode = n.type === "cut" ? pending.filter((j) => String(j.sceneId) === String(n.data.sceneId) && !["approved", "error", "cancelled"].includes(j.status)) : [];
              return (
                <div
                  key={n.id}
                  className={`absolute rounded-xl border bg-[#10151d] shadow-lg transition-colors ${isSelected ? "border-emerald-400 ring-2 ring-emerald-500/30" : "border-edge hover:border-gray-500"}`}
                  style={{ left: p.x, top: p.y, width: NODE_W[n.type] }}
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                >
                  {n.type === "common" && (
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-1.5"><Chip tone="emerald">공통 프롬프트</Chip>{n.data.aspectRatio ? <Chip>{String(n.data.aspectRatio)}</Chip> : null}</div>
                      <p className="line-clamp-3 text-[11px] leading-snug text-gray-300">{String(n.data.text || "") || <span className="text-gray-600">비어 있음 — 프리프로덕션에서 설정</span>}</p>
                    </div>
                  )}
                  {n.type === "location" && (
                    <div className="p-3">
                      <Chip tone="cyan">장소</Chip>
                      <p className="mt-1 line-clamp-2 text-[12px] font-bold text-gray-200">{n.label}</p>
                    </div>
                  )}
                  {n.type === "character" && (
                    <div className="flex items-center gap-2 p-3">
                      {n.data.imageUrl ? <img src={withMediaToken(String(n.data.imageUrl))} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" draggable={false} /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-violet-900/30 text-violet-300">@</div>}
                      <div className="min-w-0">
                        <Chip tone="violet">캐릭터</Chip>
                        <p className="truncate text-[12px] font-bold text-gray-200">{n.label}</p>
                      </div>
                    </div>
                  )}
                  {n.type === "cut" && (
                    <div>
                      <div className="flex items-center gap-1.5 border-b border-edge px-3 py-2">
                        <span className="text-[12px] font-bold text-white">#{String(n.data.sceneId)}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">{n.label}</span>
                        <Chip>{String(n.data.shotType)}</Chip>
                        <Chip>{String(n.data.cameraMove)}</Chip>
                        {n.data.cameraDirection !== "front" && <Chip tone="amber">{String(n.data.cameraDirection)}</Chip>}
                      </div>
                      <div className="grid grid-cols-2 gap-1 p-2">
                        <div className="relative aspect-video overflow-hidden rounded-md bg-black/40">
                          {n.data.still?.url
                            ? <img src={withMediaToken(String(n.data.still.url))} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
                            : <div className="grid h-full place-items-center text-[10px] text-gray-600">스틸 없음</div>}
                          <span className="absolute left-1 top-1"><Chip tone={n.data.still?.url ? "emerald" : "gray"}>스틸</Chip></span>
                        </div>
                        <div className="relative aspect-video overflow-hidden rounded-md bg-black/40">
                          {n.data.clip?.url
                            ? <video src={withMediaToken(String(n.data.clip.url))} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                            : <div className="grid h-full place-items-center text-[10px] text-gray-600">{n.data.clip?.status === "processing" || n.data.clip?.jobId && !n.data.clip?.url ? "생성 중…" : "영상 없음"}</div>}
                          <span className="absolute left-1 top-1"><Chip tone={n.data.clip?.url ? "emerald" : (n.data.clip?.error ? "red" : "gray")}>영상</Chip></span>
                        </div>
                      </div>
                      <div className="px-3 pb-2">
                        <p className="line-clamp-2 text-[11px] leading-snug text-gray-300"><span className="text-gray-500">화면 </span>{String(n.data.composition || n.data.visual || "") || <span className="text-gray-600">—</span>}</p>
                        <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-gray-400"><span className="text-gray-500">행동 </span>{String(n.data.action || "") || <span className="text-gray-600">—</span>}</p>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-gray-500">
                          {n.data.estSec ? <span>{String(n.data.estSec)}s</span> : null}
                          {n.data.common ? <Chip tone="emerald">공통 오버라이드</Chip> : null}
                          {n.data.cutRefEnabled && n.data.cutRefId ? <Chip tone="amber">참조 {String(n.data.cutRefId)}</Chip> : null}
                          {n.data.lineage?.videoAttempts ? <span title="영상 시도 횟수">v×{String(n.data.lineage.videoAttempts)}</span> : null}
                          {jobsForNode.length > 0 && <Chip tone="amber">{jobsForNode[0].status === "review_pending" ? "승인 대기" : "진행 중"}</Chip>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 대화 — 작성기(하단 중앙 필) + 세션 패널(오른쪽 오버레이). 작업 공간을 띠로 자르지 않는다. */}
          <CanvasChatDock
            projectId={projectId}
            projectTitle={graph?.title || ""}
            selectedSceneIds={selectedSceneIds}
            settings={settings}
            onSettingsChange={updateSettings}
            onJobReady={() => {
              void load(true);
              setPipelineNonce((n) => n + 1);
              setAgentOpen(true);
            }}
          />

          {/* 범례 — 작성기와 겹치지 않게 왼쪽 위 */}
          <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-2 rounded-lg border border-edge bg-[#0c1119]/90 px-2 py-1 text-[10px] text-gray-400">
            {(Object.keys(EDGE_STYLE) as ProductionEdge["type"][]).map((k) => (
              <span key={k} className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: EDGE_STYLE[k].stroke, borderTop: EDGE_STYLE[k].dash ? `2px dashed ${EDGE_STYLE[k].stroke}` : undefined, height: EDGE_STYLE[k].dash ? 0 : undefined }} />{EDGE_STYLE[k].label}</span>
            ))}
            <span className="text-gray-600">· Shift+클릭 다중 선택 · 휠 확대 · 배경 드래그 이동</span>
          </div>

          {/* 에이전트 모드 패널 */}
          {agentOpen && projectId && (
            <div className="absolute right-3 top-3 w-[360px] max-w-[calc(100%-24px)] rounded-xl border border-emerald-800/60 bg-[#0c1119]/95 p-3 shadow-xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center gap-2"><BotIcon className="h-4 w-4 text-emerald-400" /><span className="text-[12px] font-bold text-white">에이전트 모드</span><span className="text-[10px] text-gray-500">계획 → 승인 → 배치 생성</span></div>
              <VideoPipelinePanel
                projectId={projectId}
                selectedSceneIds={selectedSceneIds}
                onGraphChanged={() => void load(true)}
                onFocusScene={(id) => focusScene(id)}
                attachNonce={pipelineNonce}
                autoApprove={!settings.confirmBeforeGenerate}
                onAttached={(job) => { if (job.approvalState?.status === "pending") setAgentOpen(true); }}
              />
            </div>
          )}
        </div>

        {/* 인스펙터 */}
        {selected && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-edge bg-[#0c1119] p-3 text-[12px] text-gray-300" onWheel={(e) => e.stopPropagation()}>
            {selected.type === "cut" && draft && (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <div><span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">Cut</span><h3 className="text-sm font-bold text-white">#{String(selected.data.sceneId)} {selected.label}</h3></div>
                  <button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button>
                </div>
                {selected.data.narration ? <p className="mb-2 rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-400">{String(selected.data.narration)}</p> : null}
                {selected.data.lyrics ? <p className="mb-2 rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-400">♪ {String(selected.data.lyrics)}</p> : null}

                <label className="mb-1 block text-[10px] font-bold text-gray-500">공통 프롬프트 오버라이드 <span className="font-normal">(비우면 프로젝트 공통 사용)</span></label>
                <textarea value={draft.common} onChange={(e) => setDraft({ ...draft, common: e.target.value })} rows={2} className="mb-2 w-full rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                <label className="mb-1 block text-[10px] font-bold text-gray-500">화면 (스틸용 · 정지 상태)</label>
                <textarea value={draft.composition} onChange={(e) => setDraft({ ...draft, composition: e.target.value })} rows={3} className="mb-2 w-full rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                <label className="mb-1 block text-[10px] font-bold text-gray-500">행동 (영상용 · 움직임)</label>
                <textarea value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} rows={2} className="mb-2 w-full rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                <label className="mb-1 block text-[10px] font-bold text-gray-500">영상 프롬프트 직접 지정 <span className="font-normal">(비우면 자동 조립)</span></label>
                <textarea value={draft.promptText} onChange={(e) => setDraft({ ...draft, promptText: e.target.value })} rows={3} className="mb-2 w-full rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                <div className="mb-2 flex items-center gap-2">
                  <label className="flex items-center gap-1 text-[10px] font-bold text-gray-500"><input type="checkbox" checked={draft.cutRefEnabled} onChange={(e) => setDraft({ ...draft, cutRefEnabled: e.target.checked })} /> 컷 참조</label>
                  <select value={draft.cutRefId} onChange={(e) => setDraft({ ...draft, cutRefId: e.target.value })} className="flex-1 rounded border border-edge bg-[#0b1018] px-2 py-1 text-[11px]">
                    <option value="">참조 컷 없음</option>
                    {cutNodes.filter((c) => c.id !== selected.id).map((c) => <option key={c.id} value={String(c.data.sceneId)}>#{String(c.data.sceneId)} {c.label}</option>)}
                  </select>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <button type="button" disabled={saving} onClick={() => void saveDraft()} className="min-w-[96px] rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">저장 요청</button>
                  <button type="button" disabled={saving} onClick={() => void enqueueMany("scene_still", { projectId, sceneId: selected.data.sceneId, aspectRatio: settings.image.aspect, provider: settings.image.provider, imageSize: settings.image.size }, `컷 ${selected.data.sceneId} 스틸 생성`, selected.data.sceneId, settings.image.count)} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50" title={`${settings.image.aspect} · ${settings.image.size} · x${settings.image.count}`}>스틸 생성{settings.image.count > 1 ? ` x${settings.image.count}` : ""}</button>
                  <button type="button" disabled={saving || !selected.data.still?.url} title={selected.data.still?.url ? `${settings.video.model} · ${settings.video.aspect} · ${settings.video.durationSec}초 · x${settings.video.count}` : "스틸을 먼저 만드세요"} onClick={() => void enqueueMany("scene_video", { projectId, sceneId: selected.data.sceneId, aspectRatio: settings.video.aspect, videoModel: settings.video.model, durationSeconds: settings.video.durationSec, resolution: settings.video.resolution }, `컷 ${selected.data.sceneId} 영상 생성`, selected.data.sceneId, settings.video.count)} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50">영상 생성{settings.video.count > 1 ? ` x${settings.video.count}` : ""}</button>
                </div>
                {notice && <p className="mb-3 text-[11px] text-amber-300">{notice}</p>}

                <details className="mb-2 rounded border border-edge bg-[#0b1018] p-2" open>
                  <summary className="cursor-pointer text-[10px] font-bold text-gray-500">스틸 프롬프트 (서버 조립 · 실제 전송값)</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-gray-300">{String(selected.data.imagePrompt || "")}</pre>
                </details>
                <details className="mb-2 rounded border border-edge bg-[#0b1018] p-2">
                  <summary className="cursor-pointer text-[10px] font-bold text-gray-500">영상 프롬프트 (서버 조립 · 실제 전송값)</summary>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-gray-300">{String(selected.data.videoPrompt || "")}</pre>
                </details>
                {selected.data.lineage && (
                  <details className="mb-2 rounded border border-edge bg-[#0b1018] p-2">
                    <summary className="cursor-pointer text-[10px] font-bold text-gray-500">계보 (스틸 {String(selected.data.lineage.imageAttempts || 0)}회 · 영상 {String(selected.data.lineage.videoAttempts || 0)}회)</summary>
                    <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                      {selected.data.lineage.videoFromImage ? <p>영상 원본 스틸: <span className="break-all text-gray-500">{String(selected.data.lineage.videoFromImage)}</span></p> : null}
                      {selected.data.lineage.imagePrompt ? <p>마지막 스틸 프롬프트: <span className="text-gray-500">{String(selected.data.lineage.imagePrompt).slice(0, 200)}…</span></p> : null}
                      {selected.data.lineage.agentJobId ? <p>에이전트 잡: {String(selected.data.lineage.agentJobId)}</p> : null}
                      {selected.data.lineage.updatedAt ? <p>갱신: {String(selected.data.lineage.updatedAt)}</p> : null}
                    </div>
                  </details>
                )}
                {Array.isArray(selected.data.still?.history) && selected.data.still.history.length > 0 && (
                  <div className="mb-2">
                    <p className="mb-1 text-[10px] font-bold text-gray-500">스틸 이력 ({selected.data.still.history.length})</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.data.still.history.map((u: string, i: number) => <img key={i} src={withMediaToken(u)} alt="" className="h-12 w-20 rounded object-cover" loading="lazy" />)}
                    </div>
                  </div>
                )}
                {pending.filter((j) => String(j.sceneId) === String(selected.data.sceneId)).length > 0 && (
                  <div className="rounded border border-edge bg-[#0b1018] p-2">
                    <p className="mb-1 text-[10px] font-bold text-gray-500">이 컷의 에이전트 작업</p>
                    <ul className="space-y-0.5 text-[10px] text-gray-400">
                      {pending.filter((j) => String(j.sceneId) === String(selected.data.sceneId)).map((j) => <li key={j.jobId}>{j.label} — {j.status}</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
            {selected.type === "common" && (
              <>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-white">공통 프롬프트</h3><button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button></div>
                <pre className="whitespace-pre-wrap rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-300">{String(selected.data.text || "") || "비어 있음"}</pre>
                <p className="mt-2 text-[10px] text-gray-500">프로젝트 공통 프롬프트는 스튜디오 프리프로덕션에서 편집해요. 컷별 예외는 컷 노드의 '공통 프롬프트 오버라이드'로 두세요.</p>
              </>
            )}
            {selected.type === "location" && (
              <>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-white">{selected.label}</h3><button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button></div>
                <p className="text-[11px] text-gray-400">이 장소를 쓰는 컷: {(graph?.edges || []).filter((e) => e.from === selected.id && e.type === "location").map((e) => e.to.replace("cut:", "#")).join(", ") || "없음"}</p>
                <p className="mt-2 text-[10px] text-gray-500">같은 장소의 컷은 같은 세트 플레이트(정면·후면·좌·우)를 공유해요. 방위가 다른 컷은 노란 칩으로 표시돼요.</p>
              </>
            )}
            {selected.type === "character" && (
              <>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-white">{selected.label}</h3><button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button></div>
                {selected.data.imageUrl ? <img src={withMediaToken(String(selected.data.imageUrl))} alt="" className="mb-2 w-full rounded-lg object-cover" /> : null}
                {selected.data.description ? <p className="text-[11px] text-gray-400">{String(selected.data.description)}</p> : null}
                <p className="mt-2 text-[11px] text-gray-400">등장 컷: {(graph?.edges || []).filter((e) => e.from === selected.id && e.type === "character").map((e) => e.to.replace("cut:", "#")).join(", ") || "없음"}</p>
              </>
            )}
          </aside>
        )}
      </div>
      </div>
    </div>
  );
}
