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
import { readUserStorage, writeUserStorage } from "../lib/safeStorage";
import { analyzeReorderClient, sameOrder, type OrderCut } from "../lib/sceneOrder";
import { suggestLocationMerges } from "../lib/locationNames";
import { actionString, useUiAction } from "../lib/uiActions";
import VideoPipelinePanel from "./VideoPipelinePanel";
import CanvasChatDock from "./CanvasChatDock";
import { loadCanvasSettings, saveCanvasSettings, providerArg, resolveImageProvider, STUDIO_PROVIDER_LABELS, type CanvasSettings } from "../lib/canvasSettings";
import { approveItem, saveCanvasLayout } from "../lib/api";
import { PREVIZ_TEXT, initialPrevizLang } from "../previz/i18n.ts";
import { isLiveActive, onLiveRevisit } from "../lib/liveSync";

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
// 노드는 격자 단위로 움직인다(드래그 중 스냅). 배경 점 간격과 같다.
const GRID = 20;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

// ── 바(레인) + 슬롯 격자 배치 ──────────────────────────────────────────
// 카드는 자유 이동하지 않는다. 바 아래 칸(슬롯)에 놓인다. 바는 세 종류다.
//  · 씬 바(파랑): 연속된 같은 장소의 컷 묶음. 컷 카드가 딸린다.
//  · 캐릭터 바(초록): 등록 캐릭터 카드가 딸린다.
//  · 장소·배경 바(연두): 장소(세트) 카드가 딸린다.
// 카드를 끌어 같은 종류의 다른 칸에 놓으면 그 자리에 스냅해 간격을 두고 붙고, 바를 끌면 딸린 카드가 함께 움직인다.
// 배치(바·칸 좌표)는 표시용이지만, 컷 카드를 다른 칸에 놓으면 실제 컷 순서도 바뀐다(scene_reorder 잡).
// 놓기 전에 세트 넘어감·노래 구간 어긋남을 검사해 경고하고, 취소하면 원래 칸으로 돌아간다.
const CARD_GAP = 12;                                              // 바-카드 세로 간격 = 카드-카드 가로 간격(사용자 요청: 같은 값)
const SCENE_BAR_GAP = CARD_GAP;
const BAR_H = 44;                                                 // 바 높이(세 종류 공통)
const SCENE_BAR_H = BAR_H;
const CELL_W = NODE_W.cut + CARD_GAP;                             // 컷 슬롯 가로(카드 300 + 간격 12)
const GROUP_GAP_Y = CARD_GAP;                                     // 바 그룹 사이 세로 간격 = 카드 간격(씬과 씬 사이를 한 칸 더 좁게)
// 카드의 실제 높이. NODE_H 는 추정치라 점선 칸·줄 간격이 카드보다 길어졌다 — 렌더된 카드를 재서 덮어쓴다.
type Heights = Partial<Record<ProductionNode["type"], number>>;
function heightOf(h: Heights, type: ProductionNode["type"]): number { return h[type] || NODE_H[type]; }
const BAR_SNAP = GRID * 2;                                        // 바는 40px 격자로 움직인다

type LaneKind = "prompt" | "scene" | "characters" | "locations";
interface Lane { key: string; kind: LaneKind; orient: "row" | "column"; index: number; label: string; location: string; memberIds: string[]; cellW: number; cardW: number; cardH: number }
interface CanvasLayout { nodes: PosMap; bars: Record<string, Pos>; groups: Record<string, string[]> }

// 바 색과, 그 바의 카드가 선택됐을 때의 테두리 색을 같은 계열로 맞춘다(씬 파랑 · 캐릭터 초록 · 장소 보라).
const LANE_STYLE: Record<LaneKind, { bar: string; barSelected: string; card: string; text: string; label: string }> = {
  prompt: { bar: "border-amber-500/80 bg-amber-900/50 hover:border-amber-300", barSelected: "border-amber-300 bg-amber-700/70 ring-2 ring-amber-400/40", card: "border-amber-400 ring-2 ring-amber-500/30", text: "text-amber-100/80", label: "프롬프트" },
  scene: { bar: "border-sky-500/80 bg-sky-900/60 hover:border-sky-300", barSelected: "border-sky-300 bg-sky-700/70 ring-2 ring-sky-400/40", card: "border-sky-400 ring-2 ring-sky-500/30", text: "text-sky-100/80", label: "Scene" },
  characters: { bar: "border-emerald-500/80 bg-emerald-900/60 hover:border-emerald-300", barSelected: "border-emerald-300 bg-emerald-700/70 ring-2 ring-emerald-400/40", card: "border-emerald-400 ring-2 ring-emerald-500/30", text: "text-emerald-100/80", label: "캐릭터" },
  locations: { bar: "border-violet-500/80 bg-violet-900/60 hover:border-violet-300", barSelected: "border-violet-300 bg-violet-700/70 ring-2 ring-violet-400/40", card: "border-violet-400 ring-2 ring-violet-500/30", text: "text-violet-100/80", label: "배경" },
};

function laneKindForNode(type: ProductionNode["type"]): LaneKind | null {
  if (type === "common") return "prompt";
  if (type === "cut") return "scene";
  if (type === "character") return "characters";
  if (type === "location") return "locations";
  return null;
}

/** 그래프를 바(레인)로 묶는다. 컷은 서버 순서대로, 장소가 같은 컷이 연속되면 한 씬(시나리오 화면의 Scene N cutM 과 같은 규칙). */
function deriveLanes(graph: ProductionGraph | null, heights: Heights = {}): Lane[] {
  if (!graph) return [];
  const lanes: Lane[] = [];
  // 프롬프트 바: 공통 프롬프트 카드 하나가 딸린다(제목 바 + 내용 카드 형식으로 통일).
  if (graph.nodes.some((n) => n.type === "common")) lanes.push({ key: "prompt", kind: "prompt", orient: "column", index: 0, label: "프롬프트", location: "", memberIds: graph.nodes.filter((n) => n.type === "common").map((n) => n.id), cellW: NODE_W.common + CARD_GAP, cardW: NODE_W.common, cardH: heightOf(heights, "common") });
  const characters = graph.nodes.filter((n) => n.type === "character");
  const locations = graph.nodes.filter((n) => n.type === "location");
  if (characters.length) lanes.push({ key: "characters", kind: "characters", orient: "column", index: 0, label: "캐릭터", location: "", memberIds: characters.map((n) => n.id), cellW: NODE_W.character + CARD_GAP, cardW: NODE_W.character, cardH: heightOf(heights, "character") });
  if (locations.length) lanes.push({ key: "locations", kind: "locations", orient: "column", index: 0, label: "배경", location: "", memberIds: locations.map((n) => n.id), cellW: NODE_W.location + CARD_GAP, cardW: NODE_W.location, cardH: heightOf(heights, "location") });
  const cuts = graph.nodes.filter((n) => n.type === "cut").sort((a, b) => Number(a.data.order) - Number(b.data.order));
  let last: Lane | null = null;
  let sceneNo = 0;
  cuts.forEach((n) => {
    const loc = String(n.data.sceneLocation || "").trim();
    // 새 씬 = 장소가 바뀌거나, "이 컷부터 새 씬"(sceneBreak)으로 나눈 컷.
    if (!last || !loc || loc !== last.location || !!n.data.sceneBreak) {
      sceneNo += 1;
      last = { key: `s${sceneNo}`, kind: "scene", orient: "row", index: sceneNo, label: `Scene ${sceneNo}`, location: loc, memberIds: [], cellW: CELL_W, cardW: NODE_W.cut, cardH: heightOf(heights, "cut") };
      lanes.push(last);
    }
    last.memberIds.push(n.id);
  });
  return lanes;
}

function defaultLayout(graph: ProductionGraph | null, heights: Heights = {}): CanvasLayout {
  const nodes: PosMap = {};
  const bars: Record<string, Pos> = {};
  const groups: Record<string, string[]> = {};
  if (!graph) return { nodes, bars, groups };
  // 기본 정렬: 왼쪽 위 프롬프트 바, 그 아래 캐릭터 바와 장소 바가 같은 높이로 나란히, 오른쪽에 씬 바들이 위에서 아래로.
  const promptBottom = 40 + BAR_H + CARD_GAP + heightOf(heights, "common") + GROUP_GAP_Y;
  const leftColW = Math.max(NODE_W.common, NODE_W.character + 40 + NODE_W.location);
  const sceneX = 40 + leftColW + 40;
  let sceneY = 40;
  let assetX = 40;
  deriveLanes(graph, heights).forEach((l) => {
    if (l.kind === "prompt") {
      bars[l.key] = { x: 40, y: 40 };
    } else if (l.kind === "scene") {
      bars[l.key] = { x: sceneX, y: sceneY };
      sceneY += BAR_H + CARD_GAP + l.cardH + GROUP_GAP_Y;
    } else {
      bars[l.key] = { x: assetX, y: promptBottom };
      assetX += l.cardW + 40;
    }
    groups[l.key] = l.memberIds.slice();
  });
  return { nodes, bars, groups };
}

/** 저장된 배치를 현재 그래프에 맞춘다: 사라진 카드는 버리고, 새 카드는 원래 바 뒤에 붙인다. */
function reconcileLayout(saved: Partial<CanvasLayout> | null, graph: ProductionGraph | null, base: CanvasLayout): CanvasLayout {
  const nodes: PosMap = { ...base.nodes, ...((saved && saved.nodes) || {}) };
  const bars: Record<string, Pos> = { ...base.bars };
  Object.keys(bars).forEach((k) => { const sb = saved && saved.bars && saved.bars[k]; if (sb && Number.isFinite(sb.x) && Number.isFinite(sb.y)) bars[k] = { x: sb.x, y: sb.y }; });
  const validKind = new Map<string, LaneKind | null>((graph ? graph.nodes : []).map((n) => [n.id, laneKindForNode(n.type)]));
  const lanes = deriveLanes(graph);
  const kindOfLane = new Map(lanes.map((l) => [l.key, l.kind]));
  const placed = new Set<string>();
  const groups: Record<string, string[]> = {};
  Object.keys(base.groups).forEach((k) => {
    const savedList = saved && saved.groups && Array.isArray(saved.groups[k]) ? saved.groups[k] : null;
    const list = (savedList || base.groups[k]).filter((id) => validKind.get(id) === kindOfLane.get(k) && !placed.has(id));
    list.forEach((id) => placed.add(id));
    groups[k] = list;
  });
  Object.keys(base.groups).forEach((k) => {
    base.groups[k].forEach((id) => { if (validKind.has(id) && !placed.has(id)) { groups[k].push(id); placed.add(id); } });
  });
  return { nodes, bars, groups };
}

function lanesFromLayout(layout: CanvasLayout, graph: ProductionGraph | null, heights: Heights = {}): Lane[] {
  return deriveLanes(graph, heights).map((l) => ({ ...l, memberIds: Array.isArray(layout.groups[l.key]) ? layout.groups[l.key] : l.memberIds }));
}

/** 바·카드의 실제 좌표. 카드는 바 위치 + 슬롯 번호로 정해진다. */
function computePositions(layout: CanvasLayout, lanes: Lane[]): PosMap {
  const pos: PosMap = { ...layout.nodes };
  lanes.forEach((l) => {
    const b = layout.bars[l.key];
    if (!b) return;
    pos[`lane:${l.key}`] = b;
    l.memberIds.forEach((id, i) => {
      pos[id] = l.orient === "column"
        ? { x: b.x, y: b.y + BAR_H + CARD_GAP + i * (l.cardH + CARD_GAP) }
        : { x: b.x + i * l.cellW, y: b.y + BAR_H + CARD_GAP };
    });
  });
  return pos;
}

function slotPosition(layout: CanvasLayout, lanes: Lane[], key: string, index: number): (Pos & { w: number; h: number }) | null {
  const b = layout.bars[key];
  const l = lanes.find((x) => x.key === key);
  if (!b || !l) return null;
  if (l.orient === "column") return { x: b.x, y: b.y + BAR_H + CARD_GAP + index * (l.cardH + CARD_GAP), w: l.cardW, h: l.cardH };
  return { x: b.x + index * l.cellW, y: b.y + BAR_H + CARD_GAP, w: l.cardW, h: l.cardH };
}

/** 끌고 있는 카드(왼쪽 위 x,y)에 가장 가까운 같은 종류의 슬롯. 세로로 가장 가까운 줄을 고르고, 가로로 칸 번호를 반올림한다. */
function slotFromPoint(layout: CanvasLayout, lanes: Lane[], x: number, y: number, draggedId: string, kind: LaneKind | null): { key: string; index: number } | null {
  let best: { key: string; index: number; dist: number } | null = null;
  for (const l of lanes) {
    if (kind && l.kind !== kind) continue;
    const b = layout.bars[l.key];
    if (!b) continue;
    const others = l.memberIds.filter((id) => id !== draggedId);
    let index = 0;
    let dist = 0;
    if (l.orient === "column") {
      // 세로 레인: 가로로 얼마나 벗어났나 + 세로 칸 번호
      const left = b.x;
      const right = b.x + l.cardW;
      const dx = x < left ? left - x : (x > right ? x - right : 0);
      const firstY = b.y + BAR_H + CARD_GAP;
      index = Math.max(0, Math.min(others.length, Math.round((y - firstY) / (l.cardH + CARD_GAP))));
      dist = dx * 4 + Math.abs((y - firstY) - index * (l.cardH + CARD_GAP));
    } else {
      const top = b.y;
      const bottom = b.y + BAR_H + CARD_GAP + l.cardH;
      const dy = y < top ? top - y : (y > bottom ? y - bottom : 0);
      index = Math.max(0, Math.min(others.length, Math.round((x - b.x) / l.cellW)));
      dist = dy * 4 + Math.abs((x - b.x) - index * l.cellW);
    }
    if (!best || dist < best.dist) best = { key: l.key, index, dist };
  }
  if (!best) return null;
  const chosen: { key: string; index: number; dist: number } = best;
  return { key: chosen.key, index: chosen.index };
}

function moveCutToSlot(layout: CanvasLayout, cardId: string, slot: { key: string; index: number }): CanvasLayout {
  const groups: Record<string, string[]> = {};
  Object.keys(layout.groups).forEach((k) => { groups[k] = layout.groups[k].filter((id) => id !== cardId); });
  if (!groups[slot.key]) groups[slot.key] = [];
  const list = groups[slot.key];
  list.splice(Math.max(0, Math.min(list.length, slot.index)), 0, cardId);
  return { ...layout, groups };
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
function MaximizeIcon({ className }: { className?: string }) {
  // lucide: maximize-2
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 3h6v6" /><path d="m21 3-7 7" /><path d="m3 21 7-7" /><path d="M9 21H3v-6" />
    </svg>
  );
}
function MinimizeIcon({ className }: { className?: string }) {
  // lucide: minimize-2
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m14 10 7-7" /><path d="M20 10h-6V4" /><path d="m3 21 7-7" /><path d="M4 14h6v6" />
    </svg>
  );
}
function SparkleIcon({ className }: { className?: string }) {
  // lucide: sparkle (다이아몬드 별)
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
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

interface PendingJob { jobId: string; type: string; sceneId?: string | number; status: string; label: string; target?: string; error?: string; updatedAt?: number }

/** 작업 독에 보여 줄 도구 이름 — 채팅이 만든 잡도 무엇을 하는 중인지 읽히게. */
const TOOL_LABEL: Record<string, string> = {
  scene_upsert: "컷 내용 수정", scene_still: "스틸 생성", scene_video: "영상 생성", scene_reorder: "컷 순서 변경",
  scene_split: "씬 나누기", set_sheet: "세트 시트", set_master: "세트 마스터", set_angle: "세트 앵글",
  location_merge: "장소 합치기", style_anchor_set: "스타일 기준 지정",
};

// 잡 상태 → 사용자 문구. 모든 생성 행위는 상태가 보여야 한다(대기·승인 대기·실행 중·완료·오류).
const JOB_DONE = ["approved", "error", "cancelled", "revise"];
function jobStatusText(j: PendingJob): string {
  switch (j.status) {
    case "queued": return "대기";
    case "review_pending": return "승인 대기";
    case "running": return "실행 중";
    case "working": return "실행 중";
    case "approved": return "완료";
    case "error": return `오류${j.error ? `: ${j.error}` : ""}`;
    case "cancelled": return "취소";
    case "revise": return "수정 요청";
    default: return j.status;
  }
}

export default function ProductionCanvas({
  projectId: projectIdProp = "",
  focusSceneId = null,
  focusNonce = 0,
  embedded = false,
  onProjectChange,
  edgeStyle = "curve",
  edgesVisible = true,
  hideTopBar = false,
  expanded = false,
  onToggleExpand,
}: {
  projectId?: string;
  focusSceneId?: string | number | null;
  focusNonce?: number;
  embedded?: boolean;
  onProjectChange?: (projectId: string) => void;
  edgeStyle?: "curve" | "straight";
  edgesVisible?: boolean;
  // 집중 모드: 상단 바(프로젝트 선택·줌·일괄 생성)도 숨긴다.
  hideTopBar?: boolean;
  // 확장: AI 시네마 셸에서는 왼쪽 사이드바를 감추고, AI 기업에서는 집중 모드(좌우 패널 접기)다.
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const [projects, setProjects] = useState<ProductionProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectId, setProjectId] = useState(projectIdProp || readUserStorage("canvasProjectId"));
  const [graph, setGraph] = useState<ProductionGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<CanvasLayout>({ nodes: {}, bars: {}, groups: {} });
  // 프로젝트(서버)에 저장된 배치. 로컬 작업 사본과 다르면 "저장 안 됨"으로 표시한다.
  const [serverLayout, setServerLayout] = useState<CanvasLayout | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);
  // 끌고 있는 컷의 임시 좌표와, 놓일 슬롯(점선 칸).
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dropSlot, setDropSlot] = useState<{ key: string; index: number } | null>(null);
  // 렌더된 카드 높이(종류별 최대). 점선 칸·씬 줄 간격이 실제 카드와 같아지도록.
  const [measuredH, setMeasuredH] = useState<Heights>({});
  // 지금 배치가 기본 배치인지(저장본이 아닌지). 기본 배치면 카드 높이를 잰 뒤 다시 깔아 줄 간격을 맞춘다.
  const layoutSourceRef = useRef<"default" | "saved">("default");
  // 순서 변경 잡이 실행된 뒤의 재로드에서 칸 배치(groups)를 서버 순서로 다시 묶는다(바 위치는 유지).
  const reorderResetRef = useRef(false);
  const lanes = useMemo(() => lanesFromLayout(layout, graph, measuredH), [layout, graph, measuredH]);
  const positions = useMemo(() => computePositions(layout, lanes), [layout, lanes]);
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
  // 떠 있는 작업 독(캔버스 왼쪽 아래, 레이아웃을 밀지 않는다) 펼침 여부
  const [jobDockOpen, setJobDockOpen] = useState(false);
  // 세트 시트 생성 모달: pick(대상·해상도 고르기) → progress(장소별 진행)
  const [sheetModal, setSheetModal] = useState<{ step: "pick" | "progress"; selected: Set<string>; resolution: "2K" | "4K" } | null>(null);
  const SET_JOB_TYPES = ["set_sheet", "set_master", "set_angle"];
  // 큰 이미지 보기(라이트박스): 배경 상세의 세트 시트·플레이트를 화면 가득 본다.
  const [lightbox, setLightbox] = useState<{ url: string; title: string; objectName?: string } | null>(null);
  // 스타일 기준 이미지 지정(창작자 선택): 어떤 저장 이미지든 프로젝트 그림체 기준으로.
  const setStyleAnchor = async (objectName: string, label: string) => {
    if (!projectId || !objectName) return;
    if (!window.confirm(`"${label}" 이미지를 이 프로젝트의 그림체 기준(스타일 기준)으로 지정할까요?\n이후 세트 시트·콘티·스틸컷이 이 이미지의 룩을 참조해요.`)) return;
    await enqueue("style_anchor_set", { projectId, objectName, setName: label }, `스타일 기준 지정 · ${label}`);
    setLightbox(null);
  };
  const [draft, setDraft] = useState<{ common: string; composition: string; action: string; promptText: string; cutRefId: string; cutRefEnabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "pan" | "node" | "bar" | "cut"; id?: string; zone?: string; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  // 배경 합치기 모달: 선택한 배경 카드들을 이름 하나로.
  const [mergeModal, setMergeModal] = useState<{ names: string[]; into: string } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  const dragGhostRef = useRef(dragGhost);
  dragGhostRef.current = dragGhost;

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
      const base = defaultLayout(g);
      const fromServer = g.canvasLayout && typeof g.canvasLayout === "object" ? (g.canvasLayout as Partial<CanvasLayout>) : null;
      setServerLayout(fromServer ? reconcileLayout(fromServer, g, base) : null);
      // 로컬 작업 사본이 있으면 그것을, 없으면 프로젝트에 저장된 배치를, 둘 다 없으면 기본 배치를 쓴다.
      const saved = readUserStorage(`canvasLayout:${projectId}`);
      let parsed: Partial<CanvasLayout> | null = null;
      try { parsed = saved ? JSON.parse(saved) : null; } catch { parsed = null; }
      const savedLayout = parsed || fromServer;
      const seed = reorderResetRef.current && savedLayout ? { ...savedLayout, groups: undefined } : savedLayout;
      reorderResetRef.current = false;
      layoutSourceRef.current = savedLayout ? "saved" : "default";
      setLayout(reconcileLayout(seed, g, base));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    writeUserStorage("canvasProjectId", projectId);
    onProjectChange?.(projectId);
    setSelectedId("");
    setMulti(new Set());
    setDraft(null);
    void load();
  }, [projectId, load, onProjectChange]);

  useEffect(() => {
    if (!projectId || (!Object.keys(layout.bars).length && !Object.keys(layout.nodes).length)) return;
    writeUserStorage(`canvasLayout:${projectId}`, JSON.stringify(layout));
  }, [layout, projectId]);

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

  // Esc 로 상세 모달 닫기.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

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
        let status = String(job?.status || job?.review_status || p.status);
        // 캔버스가 만든 잡은 만들자마자 승인을 보냈다. 승인 요청이 (동기 실행 중이라) 아직 돌아오지 않은 동안 서버 상태는
        // review_pending 으로 남는데, 이걸 그대로 그리면 이미 생성 중인 잡에 "승인 대기"가 뜬다. 실행 중으로 본다.
        if (status === "review_pending" && p.status === "running") status = "running";
        const error = String((job as any)?.error || (job as any)?.output?.error || "").trim();
        if (status !== p.status) {
          changed = true;
          if (p.type === "scene_split" && status === "approved") reorderResetRef.current = true; // 씬 바가 다시 갈리므로 칸 배치를 서버 순서로
          if (p.type === "scene_reorder" && status === "approved") {
            reorderResetRef.current = true;
            const r = (job as any)?.result || (job as any)?.output || null;
            const w = Array.isArray(r?.warnings) ? r.warnings : [];
            setNotice(w.length ? `컷 순서를 바꿨어요 — 경고: ${String(r?.summary || "")}` : "컷 순서를 바꿨어요.");
          }
        }
        return { ...p, status, error: error || p.error, updatedAt: status !== p.status ? Date.now() : p.updatedAt };
      }));
      setPending(next);
      if (changed) {
        void load(true);
        // AI 시네마 셸 안에서 열렸으면 "이 프로젝트가 바뀌었다"를 알려, 시나리오·제작·포스트 스테이지가
        // 다음 방문 때 캐시 대신 서버를 다시 읽게 한다(캔버스 편집이 세 단계에 그대로 반영되는 경로).
        try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: "nk-project-changed", projectId }, "*"); } catch { /* 셸 없음 */ }
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [pending, load, projectId]);

  // 이 프로젝트를 바꾸는 잡(캔버스 버튼이든 채팅이든)을 캔버스가 지켜본다.
  //
  // 예전에는 캔버스가 자기 버튼으로 만든 잡만 봤다. 그래서 채팅으로 "컷 카드 채워줘"를 시키면
  // 승인 대기가 캔버스에 보이지도 않고, 승인 패널에서 승인해도 화면이 그대로였다("아무것도 안 만들어졌다").
  // 이제 채팅이 만든 잡도 작업 독에 올라오고, 승인 버튼이 붙고, 끝나면 그래프를 다시 읽는다.
  const AUTO_APPROVE_TYPES = ["scene_still", "scene_video", "scene_upsert", "scene_reorder", "set_sheet", "location_merge", "scene_split", "style_anchor_set", "set_master", "set_angle"];
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    const tick = async () => {
      try {
        const d = await (await fetch("/api/agent/jobs?limit=20")).json();
        const items: any[] = Array.isArray(d?.items) ? d.items : [];
        const mine = items.filter((j) => AUTO_APPROVE_TYPES.includes(String(j?.type)) && String(j?.input?.projectId || "") === projectId);
        if (!alive) return;
        // '생성 전 확인: 안 함' 이면 승인 대기를 브라우저가 대신 눌러 준다(서버 기록·감사는 그대로).
        if (!settings.confirmBeforeGenerate) {
          for (const j of mine) {
            if (!alive) return;
            if (j?.status === "review_pending" && j?.review_status === "pending") await approveItem(String(j.id)).catch(() => null);
          }
        }
        if (!alive) return;
        setPending((prev) => {
          const known = new Set(prev.map((p) => p.jobId));
          // 캔버스가 만든 잡은 자기 상태를 쓰고(승인 응답을 이미 받았다), 처음 보는 잡만 새로 올린다.
          const added = mine
            .filter((j) => !known.has(String(j.id)))
            .map((j) => ({
              jobId: String(j.id),
              type: String(j.type),
              sceneId: j?.input?.sceneId ?? j?.input?.scene?.id,
              status: String(j?.status || "queued"),
              label: `${TOOL_LABEL[String(j.type)] || String(j.type)} · 채팅`,
              updatedAt: Date.now(),
            }));
          return added.length ? [...added, ...prev].slice(0, 20) : prev;
        });
      } catch { /* 다음 틱에 다시 */ }
    };
    void tick();
    // 대화·작업 중에만 5초 주기, 평소엔 화면 복귀 때 한 번(상시 폴링은 DB 전송량을 태운다).
    const timer = window.setInterval(() => { if (isLiveActive()) void tick(); }, 5_000);
    const offRevisit = onLiveRevisit(() => { void tick(); });
    return () => { alive = false; window.clearInterval(timer); offRevisit(); };
  }, [settings.confirmBeforeGenerate, projectId]);

  const enqueue = async (type: string, input: Record<string, unknown>, label: string, sceneId?: string | number, target?: string) => {
    setSaving(true);
    setNotice("");
    try {
      const res = await createAgentJob(type, input);
      // 잡을 만든 순간부터 진행 표시(스피너)를 그린다 — 승인 응답을 기다린 뒤 그리면 생성이 끝날 때까지 아무 표시가 없다.
      setPending((prev) => [{ jobId: res.jobId, type, sceneId, status: "running", label, target, updatedAt: Date.now() }, ...prev].slice(0, 20));
      // 캔버스 버튼을 누른 것이 곧 확인이다 — 승인 게이트를 여기서 바로 통과시킨다(서버 기록은 그대로).
      // '생성 전 확인' 설정은 에이전트(채팅)가 스스로 만드는 잡에만 해당한다. 이미지 도구는 서버가 백그라운드로 돌리고 폴링이 완료를 잡는다.
      const approved: any = await approveItem(res.jobId).catch((e) => { setPending((prev) => prev.map((p) => (p.jobId === res.jobId ? { ...p, status: "error", error: (e as Error).message, updatedAt: Date.now() } : p))); return null; });
      const st = String(approved?.job?.status || "");
      if (JOB_DONE.includes(st) || st === "working") setPending((prev) => prev.map((p) => (p.jobId === res.jobId ? { ...p, status: st, error: String(approved?.job?.error || p.error || ""), updatedAt: Date.now() } : p)));
      if (st === "approved") void load(true);
    } catch (e) {
      setPending((prev) => [{ jobId: `local-${Date.now()}`, type, sceneId, status: "error", label, target, error: (e as Error).message, updatedAt: Date.now() }, ...prev].slice(0, 20));
    } finally {
      setSaving(false);
    }
  };
  // 잡 하나를 지금 승인한다(상태 띠의 승인 버튼). 서버 게이트는 그대로, 브라우저가 대신 누르는 것.
  const approveNow = async (jobId: string) => {
    try {
      await approveItem(jobId);
      setPending((prev) => prev.map((p) => (p.jobId === jobId ? { ...p, status: "running", updatedAt: Date.now() } : p)));
    } catch (e) {
      setPending((prev) => prev.map((p) => (p.jobId === jobId ? { ...p, status: "error", error: (e as Error).message, updatedAt: Date.now() } : p)));
    }
  };
  const dismissJob = (jobId: string) => setPending((prev) => prev.filter((p) => p.jobId !== jobId));
  // 컷의 스틸/영상 잡 상태 — 카드·상세의 미디어 칸과 버튼이 이걸로 스피너/오류를 그린다(생성 중인데 아무 표시가 없던 문제).
  // 세트 플레이트 게이트(캔버스 쪽): 컷의 세트에 부감 마스터도 정면 플레이트도 없으면 생성 버튼을 막고 이유를 보여 준다. 서버도 같은 게이트를 건다.
  const cutPlateMissing = (cutId: string): string => {
    const e = (graph?.edges || []).find((x) => x.type === "location" && x.to === cutId);
    const ln = e ? nodeById.get(e.from) : null;
    if (!ln) return "";
    return (ln.data?.topPlateUrl || ln.data?.plateUrl) ? "" : `세트 "${String(ln.data?.name || ln.label)}"에 배경 플레이트가 없어요. 배경 바의 별 버튼으로 부감 마스터를 먼저 만드세요.`;
  };
  const cutJobState = (sceneId: unknown, type: "scene_still" | "scene_video"): { running: PendingJob | null; failed: PendingJob | null } => {
    const mine = pending.filter((j) => j.type === type && String(j.sceneId) === String(sceneId));
    const running = mine.find((j) => !JOB_DONE.includes(j.status)) || null;
    const failed = running ? null : (mine.find((j) => j.status === "error") || null);
    return { running, failed };
  };
  const setSheetActive = pending.some((p) => SET_JOB_TYPES.includes(p.type) && !JOB_DONE.includes(p.status));

  // 배경 바 "세트 시트 생성": 장소(세트)마다 바이블 세트 시트(2×2 앵글) 잡을 하나씩 만든다.
  // 시트가 이미 있는 장소는 건너뛰고, 없는 장소가 하나도 없으면 전부 다시 만든다(재생성).
  const locationNodes = useMemo(() => (graph?.nodes || []).filter((n) => n.type === "location"), [graph]);
  // 같은 세트로 보이는 장소 쌍(핵심 이름이 같거나 포함). 서버 location_suggest 와 같은 규칙(lib/locationNames).
  const mergeSuggestions = useMemo(() => suggestLocationMerges(locationNodes.map((n) => String(n.data?.name || n.label))), [locationNodes]);
  // 여러 이름을 핵심 이름 하나로 합친다(순서대로 잡 하나씩, 각 잡은 자동 승인). 컷 번호는 바뀌지 않는다.
  const mergeLocations = async (from: string[], into: string) => {
    if (!projectId || !from.length) return;
    for (const f of from) await enqueue("location_merge", { projectId, from: f, into }, `장소 합치기 · ${f} → ${into}`, undefined, into);
    setSelectedId("");
  };
  const openSetSheetModal = () => {
    if (!projectId) return;
    if (!locationNodes.length) { setNotice("장소(세트)가 없어요. 컷에 장소 이름이 있어야 배경 카드가 생겨요."); return; }
    // 진행 중(또는 방금 끝난) 세트 시트 잡이 있으면 진행 화면으로 다시 연다 — 닫아도 상태를 잃지 않는다.
    const running = pending.filter((j) => SET_JOB_TYPES.includes(j.type) && !JOB_DONE.includes(j.status));
    if (running.length) {
      const names = new Set(running.map((j) => String(j.target || "")));
      setSheetModal({ step: "progress", selected: new Set(locationNodes.filter((n) => names.has(String(n.data?.name || n.label))).map((n) => n.id)), resolution: String(settings.image.size) === "4K" ? "4K" : "2K" });
      return;
    }
    // 기본 모드는 정밀(부감 마스터). 기본 선택: 마스터가 없는 세트. 모두 있으면 전부(재생성).
    const missing = locationNodes.filter((n) => !n.data?.topPlateUrl);
    setSheetModal({ step: "pick", selected: new Set((missing.length ? missing : locationNodes).map((n) => n.id)), resolution: String(settings.image.size) === "4K" ? "4K" : "2K" });
  };
  // 잡이 끝날 때까지 기다린다(마스터 → 앵글 파생은 순서가 있어야 한다).
  const waitForJob = async (jobId: string, timeoutMs = 180_000): Promise<string> => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const job = await getAgentJob(jobId).catch(() => null);
      if (job?.output?.subscriptionPending) timeoutMs = 20 * 60 * 1000;
      const status = String(job?.status || job?.review_status || "");
      if (JOB_DONE.includes(status)) {
        const error = String((job as any)?.error || (job as any)?.output?.error || "").trim();
        setPending((prev) => prev.map((p) => (p.jobId === jobId ? { ...p, status, error: error || p.error, updatedAt: Date.now() } : p)));
        return status;
      }
      await new Promise((r) => window.setTimeout(r, 2500));
    }
    return "timeout";
  };
  // 이 세트에 캐시된 앵글 플레이트(마스터 제외) 라벨. 앵글 플레이트는 사전 산출물이 아니라 컷 스틸 생성 때 채워지는 캐시다.
  const cachedPlatesOf = (n: ProductionNode): string[] =>
    ((n.data?.variants || []) as Array<{ id?: string; label?: string }>).filter((v) => v && v.id !== "angle-top" && v.label).map((v) => String(v.label));
  // 정밀 모드: 세트마다 부감 마스터 1장만. 정면·후면 같은 앵글 플레이트는 컷 스틸을 만들 때 서버(scene_still)가
  // 그 컷의 방위×높이에 맞춰 마스터에서 자동 파생·저장하고, 같은 방위×높이의 다음 컷은 재사용한다.
  const generateMasterPlates = async (ids: Set<string>, resolution: "2K" | "4K" = "2K") => {
    if (!projectId) return;
    const targets = locationNodes.filter((n) => ids.has(n.id));
    for (const n of targets) {
      const name = String(n.data?.name || n.label);
      try {
        const m = await createAgentJob("set_master", { projectId, locationName: name, resolution, ...providerArg(settings) });
        setPending((prev) => [{ jobId: m.jobId, type: "set_master", status: "running", label: `부감 마스터 · ${n.label}`, target: name, updatedAt: Date.now() }, ...prev].slice(0, 20));
        await approveItem(m.jobId).catch((e) => { setPending((prev) => prev.map((p) => (p.jobId === m.jobId ? { ...p, status: "error", error: (e as Error).message } : p))); });
        await waitForJob(m.jobId);
      } catch (e) {
        setPending((prev) => [{ jobId: `local-${Date.now()}`, type: "set_master", status: "error", label: `부감 마스터 · ${n.label}`, target: name, error: (e as Error).message, updatedAt: Date.now() }, ...prev].slice(0, 20));
      }
    }
    void load(true);
  };

  // 생성 개수(x1~x4)만큼 같은 컷에 후보를 만든다. 스틸 이력(imageHistory)이 이전 후보를 보존한다.
  const enqueueMany = async (type: string, input: Record<string, unknown>, label: string, sceneId: string | number, count: number) => {
    for (let i = 0; i < Math.max(1, count); i++) await enqueue(type, input, count > 1 ? `${label} (${i + 1}/${count})` : label, sceneId);
  };

  // 일반 모드(대화 없음): 작성기 프롬프트로 선택 컷에 바로 생성한다. 프롬프트는 도구의 명시 prompt 로 넘어가
  // 자동 조립을 대신한다. 컷을 고르지 않았으면 만들지 않는다 — 캔버스의 생성 단위는 컷이다.
  const directGenerate = useCallback(async (kind: "image" | "video", prompt: string): Promise<string> => {
    if (!projectId) return "프로젝트를 먼저 선택하세요.";
    const targets = selectedSceneIds.length ? selectedSceneIds : [];
    if (!targets.length) return "컷을 먼저 선택하세요. (에이전트 모드에선 말로 지정할 수 있어요)";
    for (const sceneId of targets) {
      if (kind === "image") {
        await enqueueMany("scene_still", { projectId, sceneId, prompt, aspectRatio: settings.image.aspect, ...providerArg(settings), imageSize: settings.image.size }, `컷 ${sceneId} 스틸 생성`, sceneId, settings.image.count);
      } else {
        const node = nodeById.get(`cut:${sceneId}`);
        if (!node?.data?.still?.url) return `컷 ${sceneId}에 스틸이 없어요. 스틸을 먼저 만드세요.`;
        await enqueueMany("scene_video", { projectId, sceneId, prompt, aspectRatio: settings.video.aspect, videoModel: settings.video.model, durationSeconds: settings.video.durationSec, resolution: settings.video.resolution }, `컷 ${sceneId} 영상 생성`, sceneId, settings.video.count);
      }
    }
    const count = kind === "image" ? settings.image.count : settings.video.count;
    return `컷 ${targets.join(",")}에 ${kind === "image" ? "스틸" : "영상"} ${count > 1 ? `x${count} ` : ""}생성 시작`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedSceneIds, settings, nodeById]);

  // 프리비즈(3D 블로킹·카메라)로 이 컷을 연다. AI 시네마 셸 안이면 스테이지를 previz 로 다시 묶게 알린다.
  const openPreviz = (sceneId: string | number) => {
    if (!projectId) return;
    const inShell = window.parent && window.parent !== window;
    const url = `${location.pathname}?view=previz${inShell ? "&embed=1" : ""}&projectId=${encodeURIComponent(projectId)}&sceneId=${encodeURIComponent(String(sceneId))}`;
    if (inShell) { try { window.parent.postMessage({ type: "stage-changed", stage: "previz", url }, "*"); } catch { /* 셸 없음 */ } }
    location.assign(url);
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

  // 씬 나누기: 그 컷부터 새 씬(sceneBreak). 같은 세트 안에서 씬을 둘로 가르는 유일한 방법. 순서·장소는 그대로.
  const splitSceneAt = async (cutNodeId: string) => {
    const n = nodeById.get(cutNodeId);
    if (!projectId || !n || n.type !== "cut") return;
    const order = orderOfLayout(layoutRef.current);
    const pos = order.findIndex((c) => c.id === cutNodeId);
    if (pos <= 0) { setNotice("첫 컷은 이미 첫 씬의 시작이에요."); return; }
    if (n.data.sceneBreak) { setNotice(`컷 ${n.data.sceneId}은(는) 이미 새 씬의 시작이에요.`); return; }
    await enqueue("scene_split", { projectId, sceneId: n.data.sceneId, split: true }, `씬 나누기 · 컷 ${n.data.sceneId}부터`, n.data.sceneId);
    setMulti(new Set());
  };
  // 선택한 컷들(또는 끌던 컷) 중 가장 앞의 컷부터 새 씬으로. 5·6·7을 골라 떼어내면 5부터가 새 씬이 된다.
  const splitFromSelection = async (draggedId: string, laneKey?: string) => {
    const order = orderOfLayout(layoutRef.current);
    const picked = order.filter((c) => multi.has(c.id) || c.id === draggedId).filter((c) => !laneKey || (layoutRef.current.groups[laneKey] || []).includes(c.id));
    const first = picked[0];
    if (!first) return;
    const label = picked.length > 1 ? `컷 ${picked.map((c) => c.sceneId).join("·")}을(를) 새 씬으로 나눌까요? (컷 ${first.sceneId}부터 새 씬이 돼요)` : `컷 ${first.sceneId}부터 새 씬으로 나눌까요?`;
    if (!window.confirm(label)) return;
    await splitSceneAt(first.id);
  };
  // 이전 씬과 합치기: 이 바의 첫 컷의 sceneBreak 를 끈다(장소가 같을 때만 의미가 있다).
  const mergeSceneIntoPrev = async (laneKey: string) => {
    const lane = lanesRef.current.find((l) => l.key === laneKey);
    const firstId = lane?.memberIds[0];
    const n = firstId ? nodeById.get(firstId) : null;
    if (!projectId || !n || !n.data.sceneBreak) return;
    if (!window.confirm(`Scene ${lane?.index}을(를) 앞 씬과 합칠까요? (컷 ${n.data.sceneId}의 씬 경계를 없애요)`)) return;
    await enqueue("scene_split", { projectId, sceneId: n.data.sceneId, split: false }, `씬 합치기 · 컷 ${n.data.sceneId}`, n.data.sceneId);
  };

  // 배치(칸 순서)에서 실제 컷 순서를 읽는다: 씬 바 순서 → 각 바의 칸 순서. 서버 scenes 배열과 같은 의미다.
  const orderOfLayout = useCallback((l: CanvasLayout): OrderCut[] => {
    const out: OrderCut[] = [];
    deriveLanes(graph).filter((ln) => ln.kind === "scene").forEach((ln) => {
      (Array.isArray(l.groups[ln.key]) ? l.groups[ln.key] : ln.memberIds).forEach((id) => {
        const n = nodeById.get(id);
        if (!n || n.type !== "cut") return;
        out.push({ id, sceneId: String(n.data.sceneId), location: String(n.data.sceneLocation || ""), songSectionId: String(n.data.songSectionId || ""), songSectionLabel: String(n.data.songSectionLabel || ""), lyrics: String(n.data.lyrics || "") });
      });
    });
    return out;
  }, [graph, nodeById]);

  // ── 팬·줌·드래그 ──
  // node: 공통·캐릭터·장소(20px 격자). bar: 씬 바(40px 격자, 딸린 컷이 함께 이동). cut: 컷(놓으면 슬롯에 스냅 + 실제 순서 변경).
  const onPointerDown = (e: React.PointerEvent, nodeId?: string) => {
    if (e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    if (nodeId) {
      const p = positionsRef.current[nodeId] || { x: 0, y: 0 };
      // bar: 바(씬·캐릭터·장소). cut: 바에 딸린 카드(컷·캐릭터·장소 — 같은 종류의 칸에만 스냅). node: 공통 프롬프트(자유 격자).
      const laneKind = laneKindForNode((nodeById.get(nodeId)?.type || "common") as ProductionNode["type"]);
      const kind: "node" | "bar" | "cut" = nodeId.startsWith("lane:") ? "bar" : (laneKind ? "cut" : "node");
      // 카드 안 영역: image(누르면 크게 보기) / text(누르면 선택). 배경 카드의 클릭 흐름에 쓴다.
      const zone = ((e.target as HTMLElement | null)?.closest?.("[data-zone]") as HTMLElement | null)?.dataset?.zone || "";
      drag.current = { kind, id: nodeId, zone, startX: e.clientX, startY: e.clientY, originX: p.x, originY: p.y, moved: false };
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
    if (d.kind === "pan") { setView((v) => ({ ...v, x: d.originX + dx, y: d.originY + dy })); return; }
    if (!d.id) return;
    const s = viewRef.current.scale;
    const nx = d.originX + dx / s;
    const ny = d.originY + dy / s;
    if (d.kind === "node") {
      const snap = (v: number) => Math.round(v / GRID) * GRID;
      setLayout((l) => ({ ...l, nodes: { ...l.nodes, [d.id!]: { x: snap(nx), y: snap(ny) } } }));
    } else if (d.kind === "bar") {
      const snap = (v: number) => Math.round(v / BAR_SNAP) * BAR_SNAP;
      const key = d.id.slice("lane:".length);
      setLayout((l) => ({ ...l, bars: { ...l.bars, [key]: { x: snap(nx), y: snap(ny) } } }));
    } else if (d.kind === "cut") {
      if (!d.moved) return;
      setDragGhost({ id: d.id, x: nx, y: ny });
      setDropSlot(slotFromPoint(layoutRef.current, lanesRef.current, nx, ny, d.id, laneKindForNode((nodeById.get(d.id)?.type || "common") as ProductionNode["type"])));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === "cut" && d.id && d.moved) {
      const slot = slotFromPoint(layoutRef.current, lanesRef.current, dragGhostRef.current?.x ?? d.originX, dragGhostRef.current?.y ?? d.originY, d.id, laneKindForNode((nodeById.get(d.id)?.type || "common") as ProductionNode["type"]));
      setDragGhost(null);
      setDropSlot(null);
      const dropped = nodeById.get(d.id);
      // 컷 카드를 모든 씬 바 아래 빈 공간으로 떼어내면 "여기서부터 새 씬"이다(칸 이동이 아니라 씬 나누기).
      if (dropped?.type === "cut" && projectId) {
        const gy = dragGhostRef.current?.y ?? d.originY;
        const sceneLanes = lanesRef.current.filter((l) => l.kind === "scene");
        const bottom = sceneLanes.reduce((acc, l) => { const b = layoutRef.current.bars[l.key]; return b ? Math.max(acc, b.y + BAR_H + CARD_GAP + l.cardH) : acc; }, -Infinity);
        const fromLane = sceneLanes.find((l) => (layoutRef.current.groups[l.key] || l.memberIds).includes(d.id!));
        if (Number.isFinite(bottom) && gy > bottom + CARD_GAP * 2) { void splitFromSelection(d.id, fromLane?.key); return; }
      }
      if (!slot) return;
      const next = moveCutToSlot(layoutRef.current, d.id, slot);
      if (dropped?.type === "cut" && projectId) {
        // 컷 카드는 놓는 순간 실제 순서가 바뀐다(배치만이 아니라). 세트를 넘어가거나 노래 구간이
        // 어긋나면 먼저 묻고, 취소하면 카드는 원래 칸으로 돌아간다. 저장은 scene_reorder 잡(승인 게이트)으로.
        const before = orderOfLayout(layoutRef.current);
        const after = orderOfLayout(next);
        if (!sameOrder(before, after)) {
          const warnings = analyzeReorderClient(before, after, d.id, graph?.songSections);
          if (warnings.length && !window.confirm([...warnings.map((w) => `· ${w.message}`), "", "그래도 컷 순서를 바꿀까요?"].join("\n"))) return;
          setLayout(next);
          void enqueue("scene_reorder", { projectId, order: after.map((c) => c.sceneId) }, `컷 ${dropped.data.sceneId} 순서 변경`, dropped.data.sceneId);
          return;
        }
      }
      setLayout(next);
      return;
    }
    setDragGhost(null);
    setDropSlot(null);
    if (d.kind === "bar" && d.id && !d.moved) {
      // 씬 바 클릭 = 그 씬의 컷 전부 선택(일괄 생성 대상). 상세 모달은 열지 않는다.
      const key = d.id.slice("lane:".length);
      const g = lanesRef.current.find((x) => x.key === key);
      setMulti(new Set(g ? g.memberIds : []));
      setSelectedId("");
      return;
    }
    if ((d.kind === "node" || d.kind === "cut") && d.id && !d.moved && nodeById.get(d.id)?.type === "location") {
      // 배경 카드: 이미지 영역 → 크게 보기, 텍스트 영역 → 선택 토글(여러 장 가능). 상세는 카드의 ⓘ 버튼.
      const ln = nodeById.get(d.id)!;
      if (d.zone === "image") {
        const url = String(ln.data.topPlateUrl || ln.data.setSheet?.url || ln.data.plateUrl || "");
        if (url) setLightbox({ url: withMediaToken(url), title: ln.label, objectName: String(ln.data.topPlateRef || (ln.data.setSheet as any)?.objectName || ln.data.plateRef || "") });
        return;
      }
      setSelectedId("");
      setMulti((prev) => { const next = new Set(prev); next.has(d.id!) ? next.delete(d.id!) : next.add(d.id!); return next; });
      return;
    }
    if (d.kind === "cut" && d.id && !d.moved && d.zone === "image" && nodeById.get(d.id)?.type === "cut") {
      // 컷 카드 스틸 클릭 = 크게 보기(배경 카드와 같은 규칙). 스틸이 없으면 상세로.
      const cn = nodeById.get(d.id)!;
      const url = String(cn.data.still?.url || "");
      if (url) { setLightbox({ url: withMediaToken(url), title: `${cutLabelById.get(cn.id) || cn.label} 스틸`, objectName: String(cn.data.still?.ref || "").replace(/^gs:\/\/[^/]+\//, "") }); return; }
    }
    if (d.kind === "cut" && d.id && !d.moved && d.zone === "header" && nodeById.get(d.id)?.type === "cut") {
      // 컷 카드 상단 바 클릭 = 선택 토글만(상세는 열지 않는다). 여러 컷을 고르는 기본 방법.
      setSelectedId("");
      setMulti((prev) => { const next = new Set(prev); next.has(d.id!) ? next.delete(d.id!) : next.add(d.id!); return next; });
      return;
    }
    if ((d.kind === "node" || d.kind === "cut") && d.id && !d.moved) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) { // Shift·Ctrl(Cmd)+클릭 = 다중 선택 토글
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
  // 카드 실제 높이 측정(종류별 최대). 값이 바뀔 때만 상태를 갱신하고, 기본 배치 상태면 줄 간격을 다시 맞춘다.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const next: Heights = { ...measuredH };
    let changed = false;
    el.querySelectorAll<HTMLElement>("[data-node-type]").forEach((node) => {
      const t = node.dataset.nodeType as ProductionNode["type"];
      const h = Math.round(node.offsetHeight);
      if (h > 0 && (next[t] || 0) < h) { next[t] = h; changed = true; }
    });
    if (changed) setMeasuredH(next);
  });
  useEffect(() => {
    if (!graph || layoutSourceRef.current !== "default" || !Object.keys(measuredH).length) return;
    setLayout(defaultLayout(graph, measuredH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuredH]);

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
  const layoutDirty = useMemo(() => JSON.stringify(layout) !== JSON.stringify(serverLayout), [layout, serverLayout]);
  const saveLayout = async () => {
    if (!projectId || layoutSaving) return;
    setLayoutSaving(true);
    try {
      await saveCanvasLayout(projectId, layout);
      setServerLayout(layout);
    } catch (e) {
      setError(`배치 저장 실패: ${(e as Error).message}`);
    } finally {
      setLayoutSaving(false);
    }
  };
  const resetLayout = () => {
    if (!graph) return;
    layoutSourceRef.current = "default";
    setLayout(defaultLayout(graph, measuredH));
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
  // 시나리오 화면과 같은 라벨: 한 씬에 컷이 둘 이상이면 "Scene N cutM", 하나면 "Scene N".
  const cutLabelById = useMemo(() => {
    const m = new Map<string, string>();
    // 씬 번호는 바가 보여 주므로 카드에는 컷 번호만 쓴다(사용자 요청).
    lanes.filter((l) => l.kind === "scene").forEach((l) => l.memberIds.forEach((id, i) => m.set(id, `cut${i + 1}`)));
    return m;
  }, [lanes]);

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-[#090d13] ${embedded ? "" : ""}`}>
      {/* 상단 바 */}
      {!hideTopBar && (
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
          {onToggleExpand && (
            <button type="button" onClick={onToggleExpand} aria-pressed={expanded} className={`grid h-7 w-7 place-items-center rounded border transition ${expanded ? "border-emerald-500 bg-emerald-900/40 text-emerald-200" : "border-edge text-gray-400 hover:bg-edge hover:text-white"}`} title={expanded ? "사이드바 다시 열기" : "확장 (사이드바 감추기)"} aria-label={expanded ? "사이드바 다시 열기" : "확장"}>
              {expanded ? <MinimizeIcon className="h-3.5 w-3.5" /> : <MaximizeIcon className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(MIN_SCALE, v.scale * 0.9) }))} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="축소">−</button>
          <span className="w-10 text-center text-[11px] text-gray-500">{Math.round(view.scale * 100)}%</span>
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(MAX_SCALE, v.scale * 1.1) }))} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="확대">+</button>
          <button type="button" onClick={resetLayout} className="min-w-[72px] rounded border border-edge px-2 py-1 text-[11px] text-gray-400 hover:bg-edge hover:text-white">정렬 초기화</button>
          <button
            type="button"
            onClick={() => void saveLayout()}
            disabled={!projectId || layoutSaving || !layoutDirty}
            className={`min-w-[72px] rounded-lg px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40 ${layoutDirty ? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-edge text-gray-500"}`}
            title="캔버스 배치를 프로젝트에 저장해요. 컷 내용은 각 컷의 '저장 요청'으로 저장돼요."
          >
            {layoutSaving ? "저장 중…" : (layoutDirty ? "저장" : "저장됨")}
          </button>
          <button type="button" onClick={() => { void load(); reloadProjects(); }} className="grid h-7 w-7 place-items-center rounded border border-edge text-gray-400 hover:bg-edge hover:text-white" title="다시 읽기"><RefreshIcon className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          <button
            type="button"
            onClick={() => setAgentOpen((v) => !v)}
            disabled={!projectId}
            className={`ml-1 flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40 ${agentOpen ? "bg-emerald-600 text-white" : "border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30"}`}
          >
            <BotIcon className="h-4 w-4" /> 일괄 생성
          </button>
        </div>
      </section>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex min-h-0 flex-1">
        {/* 캔버스 */}
        <div
          ref={containerRef}
          className="relative min-w-0 flex-1 cursor-grab select-none overflow-hidden active:cursor-grabbing"
          style={{ backgroundImage: "radial-gradient(#1f2633 1px, transparent 1px)", backgroundSize: `${GRID * view.scale}px ${GRID * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
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
          {loading && !graph && <div className="absolute inset-0 z-20 grid place-items-center bg-[#06080c]/55 backdrop-blur-[4px]" data-testid="canvas-loading"><RefreshIcon className="h-9 w-9 animate-spin text-orange-400" /></div>}

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

            {/* 바(레인) — 씬(파랑)·캐릭터(초록)·장소(연두). 바를 끌면 딸린 카드가 함께 움직이고, 클릭하면 그 바의 카드를 모두 선택한다. */}
            {lanes.map((l) => {
              const b = layout.bars[l.key];
              if (!b) return null;
              const width = l.orient === "column" ? l.cardW : Math.max(1, l.memberIds.length) * l.cellW - CARD_GAP;
              const allSelected = l.memberIds.length > 0 && l.memberIds.every((id) => multi.has(id));
              const totalSec = l.kind === "scene" ? l.memberIds.reduce((acc, id) => acc + (Number(nodeById.get(id)?.data?.estSec) || 0), 0) : 0;
              const st = LANE_STYLE[l.kind];
              return (
                <div
                  key={`lane:${l.key}`}
                  className={`absolute flex cursor-grab items-center gap-2 rounded-lg border px-3 shadow ${allSelected ? st.barSelected : st.bar}`}
                  style={{ left: b.x, top: b.y, width, height: BAR_H }}
                  onPointerDown={(e) => onPointerDown(e, `lane:${l.key}`)}
                  title={l.location || l.label}
                >
                  <span className="text-[12px] font-bold text-white">{l.label}</span>
                  {l.kind === "scene" && <span className={`min-w-0 flex-1 truncate text-[11px] ${st.text}`}>{l.location || "장소 미지정"}</span>}
                  {l.kind !== "scene" && <span className="min-w-0 flex-1" />}
                  {l.kind !== "prompt" && <Chip>{l.kind === "scene" ? `컷 ${l.memberIds.length}` : `${l.memberIds.length}`}</Chip>}
                  {totalSec ? <Chip>{Math.round(totalSec * 10) / 10}s</Chip> : null}
                  {l.kind === "scene" && l.memberIds.length === 0 && (
                    <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => {
                      e.stopPropagation();
                      // 빈 씬 바 = 카드를 옮긴 뒤 화면 배치에만 남은 잔상. 걷어내고 씬 바를 서버 순서로 다시 묶는다(바 위치는 유지).
                      setLayout((cur) => reconcileLayout({ ...cur, groups: undefined }, graph, defaultLayout(graph, measuredH)));
                    }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-red-400/60 text-red-200 transition hover:bg-red-500/30 hover:text-white" title="빈 씬 바 지우기 (씬 바를 서버 순서로 다시 묶어요)" aria-label="빈 씬 바 지우기">−</button>
                  )}
                  {l.kind === "scene" && (() => {
                    const firstNode = l.memberIds[0] ? nodeById.get(l.memberIds[0]) : null;
                    const canMerge = !!firstNode?.data?.sceneBreak;
                    const pickedHere = l.memberIds.filter((id) => multi.has(id));
                    const splitTitle = pickedHere.length ? `선택한 컷(${pickedHere.length})부터 새 씬으로 나눠요` : "컷 번호를 물어 그 컷부터 새 씬으로 나눠요 (컷을 골라 두면 그 컷부터)";
                    return (
                      <>
                        {canMerge && (
                          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); void mergeSceneIntoPrev(l.key); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-sky-300/50 text-sky-100 transition hover:bg-sky-500/30 hover:text-white" title="이전 씬과 합치기 (이 씬의 첫 컷 경계를 없애요)" aria-label="이전 씬과 합치기">⇤</button>
                        )}
                        <button type="button" disabled={!projectId || saving || l.memberIds.length < 2} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => {
                          e.stopPropagation();
                          if (pickedHere.length) { void splitFromSelection(pickedHere[0], l.key); return; }
                          const ids = l.memberIds.map((id) => String(nodeById.get(id)?.data.sceneId ?? ""));
                          const def = ids[ids.length - 1] || "";
                          const ans = window.prompt(`Scene ${l.index}을(를) 나눠요. 몇 번 컷부터 새 씬으로 할까요? (컷 ${ids.slice(1).join(", ")})`, def);
                          if (ans == null) return;
                          const hit = l.memberIds.find((id) => String(nodeById.get(id)?.data.sceneId ?? "") === String(ans).trim());
                          if (!hit) { setNotice("그 컷은 이 씬에 없어요."); return; }
                          void splitSceneAt(hit);
                        }} className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-sky-300/50 text-sky-100 transition hover:bg-sky-500/30 hover:text-white disabled:opacity-40" title={splitTitle} aria-label="씬 나누기">+</button>
                      </>
                    );
                  })()}
                  {l.kind === "locations" && (() => {
                    const picked = locationNodes.filter((n) => multi.has(n.id));
                    if (picked.length < 2) return null;
                    const names = picked.map((n) => String(n.data?.name || n.label));
                    // 기본으로 남길 이름: 제안된 핵심 이름이 있으면 그것, 없으면 가장 짧은 이름
                    const hit = mergeSuggestions.find((m) => names.some((x) => m.from.includes(x) || x === m.into));
                    const into = hit ? hit.into : names.slice().sort((a, b) => a.length - b.length)[0];
                    return (
                      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setMergeModal({ names, into }); }} className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-red-400/60 bg-red-900/30 px-2 text-[11px] font-bold text-red-100 hover:bg-red-800/50" title="선택한 배경을 한 세트로 합쳐요">
                        합치기 {picked.length}
                      </button>
                    );
                  })()}
                  {l.kind === "locations" && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); openSetSheetModal(); }}
                      disabled={!projectId || saving || setSheetActive}
                      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition disabled:opacity-60 ${setSheetActive ? "border-amber-300/70 text-amber-200" : "border-violet-300/50 text-violet-100 hover:bg-violet-500/30 hover:text-white"}`}
                      title={setSheetActive ? "세트 시트 생성 중…" : "세트 시트 생성 — 장소마다 정면·후면·부감·로우 2×2 바이블 시트를 한 장씩 만들어요"}
                      aria-label="세트 시트 생성"
                      aria-busy={setSheetActive}
                    >
                      {setSheetActive ? <RefreshIcon className="h-4 w-4 animate-spin" /> : <SparkleIcon className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              );
            })}
            {/* 카드를 끌고 있을 때 놓일 칸 */}
            {dropSlot && (() => {
              const sp = slotPosition(layout, lanes, dropSlot.key, dropSlot.index);
              if (!sp) return null;
              return <div className="pointer-events-none absolute rounded-xl border-2 border-dashed border-emerald-500/70 bg-emerald-500/5" style={{ left: sp.x, top: sp.y, width: sp.w, height: sp.h }} />;
            })()}

            {(graph?.nodes || []).map((n) => {
              const p = (dragGhost && dragGhost.id === n.id) ? { x: dragGhost.x, y: dragGhost.y } : positions[n.id];
              if (!p) return null;
              const isGhost = !!(dragGhost && dragGhost.id === n.id);
              const isSelected = selectedId === n.id || multi.has(n.id);
              const nodeLaneKind = laneKindForNode(n.type);
              const selectedClass = nodeLaneKind ? LANE_STYLE[nodeLaneKind].card : "border-emerald-400 ring-2 ring-emerald-500/30";
              const jobsForNode = n.type === "cut" ? pending.filter((j) => String(j.sceneId) === String(n.data.sceneId) && !["approved", "error", "cancelled"].includes(j.status)) : [];
              // 배경 카드: 이 장소를 대상으로 한 세트 시트 잡(가장 최근 하나) — 생성 중·승인 대기·오류를 카드에서 바로 본다.
              const locJob = n.type === "location" ? pending.find((j) => SET_JOB_TYPES.includes(j.type) && String(j.target || "") === String(n.data.name || n.label)) || null : null;
              return (
                <div
                  key={n.id}
                  className={`absolute rounded-xl border bg-[#10151d] shadow-lg transition-colors ${isSelected ? selectedClass : "border-edge hover:border-gray-500"}`}
                  data-node-type={n.type}
                  style={{ left: p.x, top: p.y, width: NODE_W[n.type], zIndex: isGhost ? 30 : undefined, opacity: isGhost ? 0.85 : 1 }}
                  onPointerDown={(e) => onPointerDown(e, n.id)}
                >
                  {n.type === "common" && (
                    <div className="p-3">
                      <div className="mb-1 flex items-center gap-1.5"><Chip tone="emerald">공통 프롬프트</Chip>{n.data.aspectRatio ? <Chip>{String(n.data.aspectRatio)}</Chip> : null}</div>
                      <p className="line-clamp-3 text-[11px] leading-snug text-gray-300">{String(n.data.text || "") || <span className="text-gray-600">비어 있음 — 프리프로덕션에서 설정</span>}</p>
                    </div>
                  )}
                  {n.type === "location" && (
                    <div>
                      {(n.data.topPlateUrl || n.data.setSheet?.url || n.data.plateUrl) ? (
                        <div className="relative cursor-zoom-in border-b border-edge" data-zone="image" title="누르면 크게 볼 수 있어요">
                          <img src={withMediaToken(String(n.data.topPlateUrl || n.data.setSheet?.url || n.data.plateUrl))} alt="" className="block aspect-video w-full object-cover" draggable={false} />
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-violet-400 px-1.5 py-0.5 text-[9px] font-black text-black">{n.data.topPlateUrl ? "부감 마스터" : n.data.setSheet?.url ? "바이블" : "플레이트"}</span>
                          {n.data.topPlateUrl && Array.isArray(n.data.variants) && n.data.variants.filter((v: any) => v.id !== "angle-top").length > 0 ? <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-gray-200">앵글 {n.data.variants.filter((v: any) => v.id !== "angle-top").length}</span> : null}
                          {n.data.setSheet?.resolution ? <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-gray-200">{String(n.data.setSheet.resolution)}</span> : null}
                        </div>
                      ) : null}
                      <div className="p-3" data-zone="text" title="누르면 선택돼요(여러 장 선택 후 배경 바의 합치기)">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {multi.has(n.id) && <span className="grid h-4 w-4 place-items-center rounded-full bg-violet-400 text-[10px] font-black text-black">✓</span>}
                          <Chip tone="violet">장소</Chip>
                          <button type="button" data-zone="detail" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSelectedId(n.id); }} className="ml-auto grid h-5 w-5 place-items-center rounded-full border border-edge text-[10px] text-gray-400 hover:bg-edge hover:text-white" title="상세(플레이트·다시 만들기)" aria-label="상세">i</button>
                          {n.data.setSheet ? <Chip tone="emerald">시트</Chip> : <Chip>시트 없음</Chip>}
                          {graph?.styleAnchor && n.data.setSheet?.objectName === graph.styleAnchor.objectName && <Chip tone="amber">스타일 기준</Chip>}
                          {mergeSuggestions.some((m) => m.from.includes(String(n.data.name || n.label)) || m.into === String(n.data.name || n.label)) && <Chip tone="red">중복 의심</Chip>}
                          {locJob && !JOB_DONE.includes(locJob.status) && <Chip tone="amber">{locJob.status === "review_pending" ? "승인 대기" : "시트 생성 중"}</Chip>}
                          {locJob && locJob.status === "error" && <Chip tone="red">오류</Chip>}
                        </div>
                        {locJob && locJob.status === "error" && locJob.error ? <p className="mt-1 line-clamp-2 text-[10px] text-red-300" title={locJob.error}>{locJob.error}</p> : null}
                        <p className="mt-1 line-clamp-2 text-[12px] font-bold text-gray-200">{n.label}</p>
                      </div>
                    </div>
                  )}
                  {n.type === "character" && (
                    <div className="flex items-center gap-2 p-3">
                      {n.data.imageUrl ? <img src={withMediaToken(String(n.data.imageUrl))} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" draggable={false} /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-violet-900/30 text-violet-300">@</div>}
                      <div className="min-w-0">
                        <Chip tone="emerald">캐릭터</Chip>
                        <p className="truncate text-[12px] font-bold text-gray-200">{n.label}</p>
                      </div>
                    </div>
                  )}
                  {n.type === "cut" && (
                    <div>
                      <div className="flex cursor-pointer items-center gap-1.5 border-b border-edge px-3 py-2" data-zone="header" title="상단 바 클릭 = 선택/해제 (여러 컷 고르기). 아래 내용 클릭 = 상세 열기">
                        <span className="text-[12px] font-bold text-white">{cutLabelById.get(n.id) || n.label}</span>
                        <span className="min-w-0 flex-1 truncate text-[10px] text-gray-500">#{String(n.data.sceneId)}</span>
                        <Chip>{String(n.data.shotType)}</Chip>
                        <Chip>{String(n.data.cameraMove)}</Chip>
                        {n.data.cameraDirection !== "front" && <Chip tone="amber">{String(n.data.cameraDirection)}</Chip>}
                        {n.data.cameraElevation && n.data.cameraElevation !== "eye" && <Chip tone="amber">{String(n.data.cameraElevation)}</Chip>}
                      </div>
                      <div className="grid grid-cols-2 gap-1 p-2">
                        {(() => { const st = cutJobState(n.data.sceneId, "scene_still"); const vd = cutJobState(n.data.sceneId, "scene_video"); return (<>
                        <div className={`relative aspect-video overflow-hidden rounded-md bg-black/40 ${n.data.still?.url ? "cursor-zoom-in" : ""}`} data-zone="image" title={n.data.still?.url ? "누르면 크게 볼 수 있어요" : undefined}>
                          {n.data.still?.url
                            ? <img src={withMediaToken(String(n.data.still.url))} alt="" className={`h-full w-full object-cover ${st.running ? "opacity-40" : ""}`} draggable={false} loading="lazy" />
                            : !st.running && <div className="grid h-full place-items-center text-[10px] text-gray-600">{st.failed ? <span className="px-1 text-center text-red-300">스틸 실패</span> : "스틸 없음"}</div>}
                          {st.running && <div className="absolute inset-0 grid place-items-center"><RefreshIcon className="h-5 w-5 animate-spin text-sky-200" /></div>}
                          <span className="absolute left-1 top-1 inline-flex rounded bg-black/80"><Chip tone={st.running ? "amber" : st.failed ? "red" : n.data.still?.url ? "emerald" : "gray"}>스틸</Chip></span>
                        </div>
                        <div className="relative aspect-video overflow-hidden rounded-md bg-black/40">
                          {n.data.clip?.url
                            ? <video src={withMediaToken(String(n.data.clip.url))} className={`h-full w-full object-cover ${vd.running ? "opacity-40" : ""}`} muted playsInline preload="metadata" />
                            : !vd.running && <div className="grid h-full place-items-center text-[10px] text-gray-600">{vd.failed ? <span className="px-1 text-center text-red-300">영상 실패</span> : n.data.clip?.status === "processing" || n.data.clip?.jobId && !n.data.clip?.url ? "생성 중…" : "영상 없음"}</div>}
                          {vd.running && <div className="absolute inset-0 grid place-items-center"><RefreshIcon className="h-5 w-5 animate-spin text-sky-200" /></div>}
                          <span className="absolute left-1 top-1 inline-flex rounded bg-black/80"><Chip tone={vd.running ? "amber" : (vd.failed || n.data.clip?.error) ? "red" : n.data.clip?.url ? "emerald" : "gray"}>영상</Chip></span>
                        </div>
                        </>); })()}
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
          {/* 작업 독 — 캔버스 왼쪽 아래에 떠 있다(absolute). 레이아웃을 밀지 않는다. 접힌 알약 → 펼치면 목록. */}
          {pending.length > 0 && (() => {
            const active = pending.filter((j) => !JOB_DONE.includes(j.status));
            const errors = pending.filter((j) => j.status === "error");
            return (
              <div className="absolute bottom-[4.5rem] left-3 z-30 flex max-w-[420px] select-text flex-col items-start gap-1.5" data-testid="job-dock" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
                {jobDockOpen && (
                  <div className="max-h-64 w-[400px] overflow-y-auto rounded-2xl border border-edge bg-[#0c1119]/95 p-2 shadow-2xl backdrop-blur">
                    <div className="mb-1 flex items-center justify-between px-1 text-[11px] text-gray-400">
                      <span className="font-bold text-gray-200">작업</span>
                      {pending.some((j) => JOB_DONE.includes(j.status)) && <button type="button" onClick={() => setPending((prev) => prev.filter((p) => !JOB_DONE.includes(p.status)))} className="hover:text-white">끝난 항목 지우기</button>}
                    </div>
                    <ul className="space-y-1">
                      {pending.map((j) => {
                        const done = JOB_DONE.includes(j.status);
                        const tone = j.status === "error" ? "text-red-300" : j.status === "approved" ? "text-emerald-300" : j.status === "review_pending" ? "text-amber-300" : "text-sky-300";
                        return (
                          <li key={j.jobId} className="flex items-center gap-2 rounded-lg bg-[#151b25] px-2 py-1.5 text-[11px]" title={j.error || j.label}>
                            {!done ? <RefreshIcon className="h-3 w-3 shrink-0 animate-spin text-sky-300" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${j.status === "error" ? "bg-red-400" : "bg-emerald-400"}`} />}
                            <span className="min-w-0 flex-1 truncate text-gray-200">{j.label}</span>
                            <span className={`shrink-0 truncate ${tone}`} style={{ maxWidth: 160 }}>{jobStatusText(j)}</span>
                            {j.status === "error" && j.error && <button type="button" onClick={() => { try { void navigator.clipboard.writeText(`${j.label}: ${j.error}`); } catch { /* 클립보드 불가 */ } }} className="shrink-0 rounded border border-edge px-1 text-[10px] text-gray-400 hover:text-white" title="오류 문구 복사">복사</button>}
                            {j.status === "review_pending" && <button type="button" onClick={() => void approveNow(j.jobId)} className="shrink-0 rounded bg-amber-600 px-1.5 py-px text-[10px] font-bold text-black hover:bg-amber-500">승인</button>}
                            {done && <button type="button" onClick={() => dismissJob(j.jobId)} className="shrink-0 text-gray-500 hover:text-white" aria-label="닫기">×</button>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <button type="button" onClick={() => setJobDockOpen((v) => !v)} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold shadow-lg backdrop-blur transition ${errors.length && !active.length ? "border-red-700/60 bg-[#1a0f12]/95 text-red-200" : active.length ? "border-sky-700/60 bg-[#0c1119]/95 text-sky-200" : "border-edge bg-[#0c1119]/95 text-gray-300"}`} aria-expanded={jobDockOpen}>
                  {active.length ? <RefreshIcon className="h-3.5 w-3.5 animate-spin" /> : <span className={`h-2 w-2 rounded-full ${errors.length ? "bg-red-400" : "bg-emerald-400"}`} />}
                  {active.length ? `작업 ${active.length}개 진행 중` : errors.length ? `오류 ${errors.length}` : "작업 완료"}
                  {pending.some((j) => j.status === "review_pending") && <span className="rounded-full bg-amber-600 px-1.5 text-[10px] text-black">승인 대기</span>}
                </button>
              </div>
            );
          })()}

          {/* 라이트박스 — 배경 상세의 이미지를 화면 가득. 클릭/ESC 로 닫는다. */}
          {lightbox && (
            <div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/85 p-6" onClick={() => setLightbox(null)} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} role="dialog" aria-label={lightbox.title}>
              <img src={lightbox.url} alt="" className="block h-auto w-auto max-h-full max-w-full rounded-lg object-contain shadow-2xl" style={{ maxHeight: "100%", maxWidth: "100%" }} draggable={false} title="화면보다 크면 화면에 맞춰 줄여 보여 줘요. 작으면 원본 크기예요." />
              <div className="absolute left-4 top-4 flex items-center gap-2">
                <span className="rounded-full bg-black/60 px-3 py-1 text-[12px] font-bold text-white">{lightbox.title}</span>
                {graph?.styleAnchor && lightbox.objectName && graph.styleAnchor.objectName === lightbox.objectName && <span className="rounded-full bg-amber-400 px-2 py-1 text-[11px] font-black text-black">스타일 기준</span>}
                {lightbox.objectName && !(graph?.styleAnchor && graph.styleAnchor.objectName === lightbox.objectName) && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); void setStyleAnchor(lightbox.objectName!, lightbox.title); }} className="rounded-full border border-amber-400/70 bg-black/60 px-3 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/30" title="이후 세트 시트·콘티·스틸컷이 이 이미지의 그림체를 참조해요">이 이미지를 스타일 기준으로</button>
                )}
              </div>
              <button type="button" onClick={() => setLightbox(null)} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="닫기">✕</button>
            </div>
          )}

          {/* 배경 합치기 모달 — 선택한 배경 카드들을 이름 하나로. 남길 이름은 고르거나 새로 적는다. */}
          {mergeModal && (
            <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-[2px]" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onClick={() => setMergeModal(null)}>
              <div className="w-[520px] max-w-[94%] select-text overflow-hidden rounded-3xl border border-edge bg-[#0c1119] shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-white">배경 합치기</div>
                    <div className="text-[11px] text-gray-500">같은 공간이 여러 이름으로 갈리면 각각 따로 생성돼 배경이 달라져요. 이름 하나로 합치면 컷은 그 이름으로 옮겨지고, 플레이트·시트는 남는 쪽에 없는 것만 물려받아요. 컷 번호는 바뀌지 않아요.</div>
                  </div>
                  <button type="button" onClick={() => setMergeModal(null)} className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-edge hover:text-white" aria-label="닫기">×</button>
                </div>
                <div className="px-4 py-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">남길 이름</div>
                  <ul className="space-y-1">
                    {Array.from(new Set([mergeModal.into, ...mergeModal.names])).map((nm) => (
                      <li key={nm}>
                        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${mergeModal.into === nm ? "border-violet-500/60 bg-violet-900/15 text-white" : "border-edge text-gray-300"}`}>
                          <input type="radio" name="merge-into" checked={mergeModal.into === nm} onChange={() => setMergeModal((m) => (m ? { ...m, into: nm } : m))} className="accent-violet-500" />
                          <span className="min-w-0 flex-1 truncate">{nm}</span>
                          {!mergeModal.names.includes(nm) && <Chip tone="amber">새 이름(핵심)</Chip>}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <label className="mt-2 block text-[11px] text-gray-400">직접 적기
                    <input type="text" value={mergeModal.into} onChange={(e) => setMergeModal((m) => (m ? { ...m, into: e.target.value } : m))} className="mt-1 w-full rounded-lg border border-edge bg-[#151b25] px-2 py-1.5 text-[12px] text-gray-100" placeholder="예: 소녀의 방" />
                  </label>
                  <p className="mt-2 text-[11px] text-gray-500">합쳐질 배경: {mergeModal.names.filter((x) => x !== mergeModal.into.trim()).map((x) => `"${x}"`).join(", ") || "없음"}</p>
                </div>
                <div className="flex items-center gap-2 border-t border-edge px-4 py-3">
                  <div className="flex-1" />
                  <button type="button" onClick={() => setMergeModal(null)} className="min-w-[72px] rounded-lg border border-edge px-3 py-1.5 text-[12px] text-gray-300 hover:bg-edge hover:text-white">취소</button>
                  <button type="button" disabled={!mergeModal.into.trim() || !mergeModal.names.some((x) => x !== mergeModal.into.trim())} onClick={() => { const m = mergeModal; const into = m.into.trim(); const from = m.names.filter((x) => x !== into); setMergeModal(null); setMulti(new Set()); void mergeLocations(from, into); }} className="min-w-[96px] rounded-lg bg-red-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-red-600 disabled:opacity-40">합치기</button>
                </div>
              </div>
            </div>
          )}

          {/* 세트 시트 생성 모달 — 대상 장소·해상도를 고르고 "생성"이 곧 확인. 진행은 같은 모달에서 장소별로 본다. */}
          {sheetModal && (
            <div className="absolute inset-0 z-40 grid place-items-center bg-black/60 backdrop-blur-[2px]" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()} onClick={() => setSheetModal(null)}>
              <div className="w-[820px] max-w-[92%] select-text overflow-hidden rounded-3xl border border-edge bg-[#0c1119] shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start gap-3 border-b border-edge px-5 py-4">
                  <SparkleIcon className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-white">세트 시트 생성</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-gray-400">세트마다 부감 마스터 1장을 만들어요. 배치는 세트 계획의 평면도를 따르고, 앵글 플레이트는 컷 스틸을 만들 때 자동으로 파생·재사용돼요.</div>
                    {mergeSuggestions.length > 0 && <div className="mt-1 text-[11px] text-amber-300">같은 세트로 보이는 장소가 있어요: {mergeSuggestions.map((m) => `${m.from.map((f) => `"${f}"`).join(", ")} → "${m.into}"`).join(" · ")} — 먼저 합치는 편이 좋아요(배경 카드 상세에서).</div>}
                  </div>
                  <button type="button" onClick={() => setSheetModal(null)} className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-edge hover:text-white" aria-label="닫기">×</button>
                </div>
                <div className="max-h-[56vh] overflow-y-auto px-5 py-4">
                  <ul className="space-y-2">
                    {locationNodes.map((n) => {
                      const name = String(n.data?.name || n.label);
                      const jobsHere = pending.filter((j) => SET_JOB_TYPES.includes(j.type) && String(j.target || "") === name);
                      const job = jobsHere.find((j) => !JOB_DONE.includes(j.status)) || jobsHere[0] || null;
                      const doneHere = jobsHere.filter((j) => j.status === "approved").length;
                      const checked = sheetModal.selected.has(n.id);
                      const thumb = n.data?.topPlateUrl || n.data?.setSheet?.url || n.data?.plateUrl || "";
                      const derived = cachedPlatesOf(n);
                      const stateText = n.data?.topPlateUrl ? `부감 마스터 있음 · 캐시된 앵글 플레이트 ${derived.length}장${derived.length ? ` (${derived.join("·")})` : ""} — 다시 만들면 새 마스터로 바뀌고 캐시는 새 마스터에서 다시 채워져요`
                        : n.data?.plateUrl ? "정면 플레이트만 있음(옛 방식) — 부감 마스터를 만들면 이후 컷 생성이 마스터 기준으로 파생해요"
                        : n.data?.setSheet ? "2×2 시트만 있음 — 부감 마스터를 새로 만들어요"
                        : "아직 없음";
                      const planText = "만들 것: 부감 마스터 1장 — 앵글 플레이트는 컷 스틸 생성 때 필요한 방위×높이만 자동 파생·재사용";
                      return (
                        <li key={n.id} className={`flex items-center gap-4 rounded-xl border px-4 py-3 ${checked ? "border-violet-500/60 bg-violet-900/15" : "border-edge bg-[#10151d]"}`}>
                          {sheetModal.step === "pick" ? (
                            <input type="checkbox" checked={checked} onChange={(e) => setSheetModal((m) => { if (!m) return m; const next = new Set(m.selected); e.target.checked ? next.add(n.id) : next.delete(n.id); return { ...m, selected: next }; })} className="h-4 w-4 accent-violet-500" />
                          ) : (
                            checked ? (job && !JOB_DONE.includes(job.status) ? <RefreshIcon className="h-4 w-4 animate-spin text-sky-300" /> : <span className={`h-2.5 w-2.5 rounded-full ${job?.status === "error" ? "bg-red-400" : "bg-emerald-400"}`} />) : <span className="h-4 w-4" />
                          )}
                          {thumb ? <img src={withMediaToken(String(thumb))} alt="" className="h-16 w-[114px] shrink-0 rounded-lg object-cover" /> : <div className="grid h-16 w-[114px] shrink-0 place-items-center rounded-lg bg-[#151b25] text-[11px] text-gray-600">없음</div>}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-bold text-gray-100">{name}</div>
                            <div className="truncate text-[11px] text-gray-500">{stateText}</div>
                            {sheetModal.step === "pick" && <div className="truncate text-[11px] text-violet-300/80">{planText}</div>}
                          </div>
                          {sheetModal.step === "progress" && checked && job && (
                            <span className={`shrink-0 text-[11px] ${job.status === "error" ? "text-red-300" : JOB_DONE.includes(job.status) ? "text-emerald-300" : "text-sky-300"}`} title={job.error || job.label}>{JOB_DONE.includes(job.status) ? (job.status === "error" ? "오류" : `완료 ${doneHere}장`) : `${job.label.replace(` · ${n.label}`, "")} 생성 중${doneHere ? ` (${doneHere}장 완료)` : ""}`}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {sheetModal.step === "progress" && pending.some((j) => SET_JOB_TYPES.includes(j.type) && j.status === "error") && (() => {
                    const text = pending.filter((j) => SET_JOB_TYPES.includes(j.type) && j.status === "error").map((j) => `${j.label}: ${j.error || "오류"}`).join("\n");
                    return (
                      <div className="mt-2 rounded-lg bg-red-900/20 px-3 py-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[10px] font-bold text-red-300">오류</span>
                          <button type="button" onClick={() => { try { void navigator.clipboard.writeText(text); setNotice("오류 문구를 복사했어요."); } catch { /* 클립보드 불가 */ } }} className="rounded border border-red-700/60 px-1.5 py-px text-[10px] text-red-200 hover:bg-red-900/40">복사</button>
                        </div>
                        <pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-red-200">{text}</pre>
                      </div>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-edge px-5 py-3.5">
                  {sheetModal.step === "pick" ? (
                    <>
                      <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[12px] text-gray-400">해상도
                        <select value={sheetModal.resolution} onChange={(e) => setSheetModal((m) => (m ? { ...m, resolution: e.target.value === "4K" ? "4K" : "2K" } : m))} className="rounded border border-edge bg-[#151b25] px-2 py-1 text-[11px] text-gray-100">
                          <option value="2K">2K</option>
                          <option value="4K">4K</option>
                        </select>
                      </label>
                      <span className="shrink-0 whitespace-nowrap text-[12px] text-gray-500">이미지 {sheetModal.selected.size}장 · 사용자 설정 적용</span>
                      <span className="shrink-0 whitespace-nowrap text-[12px] text-gray-500">모델: <span className="text-gray-200">{(() => { const p = resolveImageProvider(settings); return p ? (STUDIO_PROVIDER_LABELS[p] || p) : "서버 기본"; })()}</span>{settings.image.provider === "studio" ? " (제작 화면 설정)" : " (캔버스 설정)"}</span>
                      <div className="flex-1" />
                      <button type="button" onClick={() => setSheetModal(null)} className="min-w-[84px] rounded-lg border border-edge px-4 py-2 text-[13px] text-gray-300 hover:bg-edge hover:text-white">취소</button>
                      <button type="button" disabled={!sheetModal.selected.size} onClick={() => { const m = sheetModal; setSheetModal({ ...m, step: "progress" }); void generateMasterPlates(m.selected, m.resolution); }} className="min-w-[112px] rounded-lg bg-violet-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-violet-500 disabled:opacity-40">생성</button>
                    </>
                  ) : (
                    <>
                      <span className="text-[11px] text-gray-500">{pending.some((j) => SET_JOB_TYPES.includes(j.type) && !JOB_DONE.includes(j.status)) ? "생성 중이에요. 닫아도 작업은 계속되고 왼쪽 아래 작업 독에서 볼 수 있어요. 별 버튼을 다시 누르면 이 진행 화면이 열려요." : "끝났어요. 배경 카드에서 플레이트를 확인하세요."}</span>
                      <div className="flex-1" />
                      {!pending.some((j) => SET_JOB_TYPES.includes(j.type) && !JOB_DONE.includes(j.status)) && (
                        <button type="button" onClick={() => setSheetModal((m) => (m ? { ...m, step: "pick" } : m))} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 text-[12px] text-gray-300 hover:bg-edge hover:text-white">다시 만들기</button>
                      )}
                      <button type="button" onClick={() => setSheetModal(null)} className="min-w-[72px] rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500">닫기</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          <CanvasChatDock
            projectId={projectId}
            projectTitle={graph?.title || ""}
            selectedSceneIds={selectedSceneIds}
            settings={settings}
            onSettingsChange={updateSettings}
            onDirectGenerate={directGenerate}
            onJobReady={() => {
              void load(true);
              setPipelineNonce((n) => n + 1);
              setAgentOpen(true);
            }}
          />

          {/* 일괄 생성(파이프라인) 패널 — 비어 있는 컷을 계획→승인→배치로 자동 생성 */}
          {agentOpen && projectId && (
            <div className="absolute right-3 top-3 w-[360px] max-w-[calc(100%-24px)] rounded-xl border border-emerald-800/60 bg-[#0c1119]/95 p-3 shadow-xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
              <div className="mb-2 flex items-center gap-2"><BotIcon className="h-4 w-4 text-emerald-400" /><span className="text-[12px] font-bold text-white">빈 컷 일괄 생성</span><span className="text-[10px] text-gray-500">계획 → 승인 → 배치 생성</span></div>
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

        {/* 노드 상세 모달 — 우측에 붙이지 않고 가운데 4:3 카드로, 뒤 캔버스는 흐리게 */}
        {selected && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onPointerDown={() => setSelectedId("")}>
          <aside className="flex aspect-[4/3] max-h-full w-[min(1100px,100%)] flex-col overflow-hidden rounded-2xl border border-edge bg-[#0c1119] text-[12px] text-gray-300 shadow-2xl" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
            {selected.type === "cut" && draft && (
              <>
                <div className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-2.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">Cut</span>
                  <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-white">{cutLabelById.get(selected.id) || selected.label} <span className="text-[11px] font-normal text-gray-500">#{String(selected.data.sceneId)}</span></h3>
                  <Chip>{String(selected.data.shotType)}</Chip>
                  <Chip>{String(selected.data.cameraMove)}</Chip>
                  {selected.data.cameraDirection !== "front" && <Chip tone="amber">{String(selected.data.cameraDirection)}</Chip>}
                  {selected.data.cameraElevation && selected.data.cameraElevation !== "eye" && <Chip tone="amber">{String(selected.data.cameraElevation)}</Chip>}
                  {selected.data.estSec ? <span className="text-[11px] text-gray-500">{String(selected.data.estSec)}s</span> : null}
                  <button type="button" onClick={() => setSelectedId("")} className="grid h-8 w-8 place-items-center rounded-full text-gray-500 hover:bg-edge hover:text-white" aria-label="닫기">✕</button>
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-12 gap-0 overflow-hidden">
                  {/* 왼쪽: 미디어 + 실제 전송 프롬프트 + 계보 */}
                  <div className="col-span-7 min-h-0 overflow-y-auto border-r border-edge p-4">
                    {(() => { const st = cutJobState(selected.data.sceneId, "scene_still"); const vd = cutJobState(selected.data.sceneId, "scene_video"); return (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative aspect-video overflow-hidden rounded-xl bg-black/40" data-testid="detail-still-box">
                        {selected.data.still?.url
                          ? <img src={withMediaToken(String(selected.data.still.url))} alt="" className={`h-full w-full cursor-zoom-in object-cover ${st.running ? "opacity-40" : ""}`} title="클릭하면 크게 볼 수 있어요" onClick={() => setLightbox({ url: withMediaToken(String(selected.data.still.url)), title: `${cutLabelById.get(selected.id) || selected.label} 스틸`, objectName: String(selected.data.still.ref || "").replace(/^gs:\/\/[^/]+\//, "") })} />
                          : !st.running && <div className="grid h-full place-items-center px-3 text-center text-[11px] text-gray-600">{st.failed ? <span className="select-text text-red-300">스틸 실패: {String(st.failed.error || "오류").slice(0, 160)}</span> : "스틸 없음"}</div>}
                        {st.running && <div className="absolute inset-0 grid place-items-center"><RefreshIcon className="h-7 w-7 animate-spin text-sky-200" /></div>}
                        <span className="absolute left-2 top-2 inline-flex rounded bg-black/80"><Chip tone={st.running ? "amber" : st.failed ? "red" : selected.data.still?.url ? "emerald" : "gray"}>스틸</Chip></span>
                      </div>
                      <div className="relative aspect-video overflow-hidden rounded-xl bg-black/40" data-testid="detail-video-box">
                        {selected.data.clip?.url
                          ? <video src={withMediaToken(String(selected.data.clip.url))} className={`h-full w-full object-cover ${vd.running ? "opacity-40" : ""}`} controls muted playsInline preload="metadata" />
                          : !vd.running && <div className="grid h-full place-items-center px-3 text-center text-[11px] text-gray-600">{vd.failed ? <span className="select-text text-red-300">영상 실패: {String(vd.failed.error || "오류").slice(0, 160)}</span> : selected.data.clip?.error ? `영상 실패: ${String(selected.data.clip.error).slice(0, 60)}` : "영상 없음"}</div>}
                        {vd.running && <div className="absolute inset-0 grid place-items-center"><RefreshIcon className="h-7 w-7 animate-spin text-sky-200" /></div>}
                        <span className="absolute left-2 top-2 inline-flex rounded bg-black/80"><Chip tone={vd.running ? "amber" : (vd.failed || selected.data.clip?.error) ? "red" : selected.data.clip?.url ? "emerald" : "gray"}>영상</Chip></span>
                      </div>
                    </div>
                    ); })()}
                    {cutPlateMissing(selected.id) ? <p className="mt-2 rounded-md border border-amber-700/50 bg-amber-900/15 px-2 py-1 text-[11px] text-amber-200">{cutPlateMissing(selected.id)}</p> : null}
                    {Array.isArray(selected.data.still?.history) && selected.data.still.history.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1 text-[10px] font-bold text-gray-500">스틸 이력 ({selected.data.still.history.length})</p>
                        <div className="flex flex-wrap gap-1.5">
                          {selected.data.still.history.map((u: string, i: number) => <img key={i} src={withMediaToken(u)} alt="" className="h-14 w-24 rounded-md object-cover" loading="lazy" />)}
                        </div>
                      </div>
                    )}
                    {selected.data.narration ? <p className="mt-3 rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-400">{String(selected.data.narration)}</p> : null}
                    {selected.data.lyrics ? <p className="mt-2 rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-400">♪ {String(selected.data.lyrics)}</p> : null}
                    <details className="mt-3 rounded-lg border border-edge bg-[#0b1018] p-2" open>
                      <summary className="cursor-pointer text-[11px] font-bold text-gray-400">스틸 프롬프트 (서버 조립 · 실제 전송값)</summary>
                      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200">{String(selected.data.imagePrompt || "")}</pre>
                    </details>
                    <details className="mt-2 rounded-lg border border-edge bg-[#0b1018] p-2">
                      <summary className="cursor-pointer text-[11px] font-bold text-gray-400">영상 프롬프트 (서버 조립 · 실제 전송값)</summary>
                      <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200">{String(selected.data.videoPrompt || "")}</pre>
                    </details>
                    {selected.data.lineage && (
                      <details className="mt-2 rounded-lg border border-edge bg-[#0b1018] p-2">
                        <summary className="cursor-pointer text-[11px] font-bold text-gray-400">계보 (스틸 {String(selected.data.lineage.imageAttempts || 0)}회 · 영상 {String(selected.data.lineage.videoAttempts || 0)}회)</summary>
                        <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                          {selected.data.lineage.videoFromImage ? <p>영상 원본 스틸: <span className="break-all text-gray-500">{String(selected.data.lineage.videoFromImage)}</span></p> : null}
                          {selected.data.lineage.imageRefs ? <p>참조: <span className="text-gray-300">{String(selected.data.lineage.imageRefs)}</span>{selected.data.lineage.imagePlate ? <span className="text-gray-500"> · 플레이트 키 {String(selected.data.lineage.imagePlate)}</span> : null}</p> : null}
                          {selected.data.lineage.videoRefs ? <p>영상 참조: <span className="text-gray-300">{String(selected.data.lineage.videoRefs)}</span></p> : null}
                          {selected.data.lineage.imagePrompt ? <p>마지막 스틸 프롬프트: <span className="text-gray-500">{String(selected.data.lineage.imagePrompt).slice(0, 200)}…</span></p> : null}
                          {selected.data.lineage.agentJobId ? <p>에이전트 잡: {String(selected.data.lineage.agentJobId)}</p> : null}
                          {selected.data.lineage.updatedAt ? <p>갱신: {String(selected.data.lineage.updatedAt)}</p> : null}
                        </div>
                      </details>
                    )}
                    {pending.filter((j) => String(j.sceneId) === String(selected.data.sceneId)).length > 0 && (
                      <div className="mt-2 rounded-lg border border-edge bg-[#0b1018] p-2">
                        <p className="mb-1 text-[10px] font-bold text-gray-500">이 컷의 에이전트 작업</p>
                        <ul className="space-y-0.5 text-[10px] text-gray-400">
                          {pending.filter((j) => String(j.sceneId) === String(selected.data.sceneId)).map((j) => <li key={j.jobId}>{j.label} — {j.status}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                  {/* 오른쪽: 편집 폼 */}
                  <div className="col-span-5 flex min-h-0 flex-col overflow-y-auto p-4">
                    <label className="mb-1 block text-[10px] font-bold text-gray-500">공통 프롬프트 오버라이드 <span className="font-normal">(비우면 프로젝트 공통 사용)</span></label>
                    <textarea value={draft.common} onChange={(e) => setDraft({ ...draft, common: e.target.value })} rows={2} className="mb-2 w-full rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                    <label className="mb-1 block text-[10px] font-bold text-gray-500">화면 (스틸용 · 정지 상태)</label>
                    <textarea value={draft.composition} onChange={(e) => setDraft({ ...draft, composition: e.target.value })} rows={4} className="mb-2 w-full rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                    <label className="mb-1 block text-[10px] font-bold text-gray-500">행동 (영상용 · 움직임)</label>
                    <textarea value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} rows={3} className="mb-2 w-full rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                    <label className="mb-1 block text-[10px] font-bold text-gray-500">영상 프롬프트 직접 지정 <span className="font-normal">(비우면 자동 조립)</span></label>
                    <textarea value={draft.promptText} onChange={(e) => setDraft({ ...draft, promptText: e.target.value })} rows={3} className="mb-2 w-full rounded-lg border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-200" />
                    <div className="mb-3 flex items-center gap-2">
                      <label className="flex items-center gap-1 text-[10px] font-bold text-gray-500"><input type="checkbox" checked={draft.cutRefEnabled} onChange={(e) => setDraft({ ...draft, cutRefEnabled: e.target.checked })} /> 컷 참조</label>
                      <select value={draft.cutRefId} onChange={(e) => setDraft({ ...draft, cutRefId: e.target.value })} className="flex-1 rounded-lg border border-edge bg-[#0b1018] px-2 py-1 text-[11px]">
                        <option value="">참조 컷 없음</option>
                        {cutNodes.filter((c) => c.id !== selected.id).map((c) => <option key={c.id} value={String(c.data.sceneId)}>#{String(c.data.sceneId)} {c.label}</option>)}
                      </select>
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2 border-t border-edge pt-3">
                      <button type="button" disabled={saving} onClick={() => void saveDraft()} className="min-w-[96px] rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">저장 요청</button>
                      <button type="button" disabled={saving || !!cutJobState(selected.data.sceneId, "scene_still").running || !!cutPlateMissing(selected.id)} onClick={() => void enqueueMany("scene_still", { projectId, sceneId: selected.data.sceneId, aspectRatio: settings.image.aspect, ...providerArg(settings), imageSize: settings.image.size }, `컷 ${selected.data.sceneId} 스틸 생성`, selected.data.sceneId, settings.image.count)} className="inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50" title={cutPlateMissing(selected.id) || `${settings.image.aspect} · ${settings.image.size} · x${settings.image.count}`}>{cutJobState(selected.data.sceneId, "scene_still").running ? <><RefreshIcon className="h-3.5 w-3.5 animate-spin" />생성 중</> : <>스틸 생성{settings.image.count > 1 ? ` x${settings.image.count}` : ""}</>}</button>
                      <button type="button" disabled={saving || !selected.data.still?.url || !!cutJobState(selected.data.sceneId, "scene_video").running || !!cutPlateMissing(selected.id)} title={cutPlateMissing(selected.id) || (selected.data.still?.url ? `${settings.video.model} · ${settings.video.aspect} · ${settings.video.durationSec}초 · x${settings.video.count}` : "스틸을 먼저 만드세요")} onClick={() => void enqueueMany("scene_video", { projectId, sceneId: selected.data.sceneId, aspectRatio: settings.video.aspect, videoModel: settings.video.model, durationSeconds: settings.video.durationSec, resolution: settings.video.resolution }, `컷 ${selected.data.sceneId} 영상 생성`, selected.data.sceneId, settings.video.count)} className="inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-1.5 hover:bg-edge disabled:opacity-50">{cutJobState(selected.data.sceneId, "scene_video").running ? <><RefreshIcon className="h-3.5 w-3.5 animate-spin" />생성 중</> : <>영상 생성{settings.video.count > 1 ? ` x${settings.video.count}` : ""}</>}</button>
                      <button type="button" onClick={() => openPreviz(selected.data.sceneId)} className="min-w-[96px] rounded-lg border border-edge px-3 py-1.5 hover:bg-edge">{PREVIZ_TEXT[initialPrevizLang()].title}</button>
                    </div>
                    {notice && <p className="mt-2 text-[11px] text-amber-300">{notice}</p>}
                  </div>
                </div>
              </>
            )}
            {selected.type === "common" && (
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-white">공통 프롬프트</h3><button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button></div>
                <pre className="whitespace-pre-wrap rounded border border-edge bg-[#0b1018] p-2 text-[11px] text-gray-300">{String(selected.data.text || "") || "비어 있음"}</pre>
                <p className="mt-2 text-[10px] text-gray-500">프로젝트 공통 프롬프트는 스튜디오 프리프로덕션에서 편집해요. 컷별 예외는 컷 노드의 '공통 프롬프트 오버라이드'로 두세요.</p>
              </div>
            )}
            {selected.type === "location" && (() => {
              const sheet = selected.data.setSheet as { url?: string; resolution?: string; createdAt?: string; diag?: { provider?: string; model?: string; geminiEndpoint?: string; geminiLocationFallback?: string; referenceCount?: number; styleSource?: string; hubContextUsed?: boolean; requestedResolution?: string; fallback?: string; promptHead?: string } | null; panels?: Array<{ index: number; ref: string; angleLabel: string; status: string; url?: string }> } | null;
              const diag = sheet?.diag || null;
              const styleSourceText: Record<string, string> = { styleAnchor: "스타일 기준 이미지", "other-set-sheet": "다른 세트 시트", "hub-environment-assets": "허브 배경·소품 자산", "brand-character-sheets": "브랜드 캐릭터 시트(그림체만)", "project-still": "이 프로젝트 기존 스틸", "existing-plate": "기존 정면 플레이트" };
              const plateUrl = String(selected.data.plateUrl || "");
              const variants = (Array.isArray(selected.data.variants) ? selected.data.variants : []) as Array<{ id: string; label: string; url: string }>;
              const topUrl = String(selected.data.topPlateUrl || "");
              const mainUrl = String(topUrl || sheet?.url || plateUrl || "");
              const layoutObj = selected.data.layout && typeof selected.data.layout === "object" ? (selected.data.layout as Record<string, string>) : null;
              const angleNames = ["정면", "후면", "부감", "로우"];
              const cutsHere = (graph?.edges || []).filter((e) => e.from === selected.id && e.type === "location").map((e) => e.to.replace("cut:", "#"));
              return (
                <div className="flex h-full flex-col p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-white">{selected.label}</h3>
                      <p className="text-[11px] text-gray-400">이 장소를 쓰는 컷: {cutsHere.join(", ") || "없음"}</p>
                    </div>
                    <button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button>
                  </div>
                  {mainUrl ? (
                    <div className="relative overflow-hidden rounded-xl border border-edge bg-black">
                      <img src={withMediaToken(mainUrl)} alt="" className="block max-h-[60vh] w-full cursor-zoom-in object-contain" draggable={false} onClick={() => setLightbox({ url: withMediaToken(mainUrl), title: selected.label, objectName: String(sheet?.url ? (sheet as any)?.objectName || "" : selected.data.plateRef || "") })} title="클릭하면 크게 볼 수 있어요" />
                      {sheet?.url && !topUrl && (
                        <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
                          {angleNames.map((name, i) => (
                            <div key={name} className="relative border border-white/10">
                              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{i + 1} · {name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-violet-400 px-1.5 py-0.5 text-[10px] font-black text-black">{topUrl ? "부감 마스터 (배치 기준)" : sheet?.url ? "바이블 · 세트 시트" : "정면 플레이트"}</span>
                    </div>
                  ) : (
                    <div className="grid h-40 place-items-center rounded-xl border border-dashed border-edge text-[11px] text-gray-500">아직 세트 시트가 없어요. 배경 바의 별 버튼으로 만들어요.</div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400">
                    {sheet ? <Chip tone="emerald">시트 {String(sheet.resolution || "")}</Chip> : <Chip>시트 없음</Chip>}
                    {sheet?.createdAt ? <span>{new Date(sheet.createdAt).toLocaleString()}</span> : null}
                    <div className="flex-1" />
                    <button type="button" onClick={() => setSheetModal({ step: "pick", selected: new Set([selected.id]), resolution: String(settings.image.size) === "4K" ? "4K" : "2K" })} className="min-w-[96px] rounded-lg border border-violet-500/60 px-3 py-1 text-[11px] text-violet-200 hover:bg-violet-500/20">{sheet ? "세트 시트 다시 만들기" : "세트 시트 만들기"}</button>
                  </div>
                  {layoutObj && (
                    <div className="mt-3 rounded-xl border border-edge bg-[#0b1018] p-2.5 text-[11px] text-gray-300">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">평면도 (모든 앵글이 지키는 배치)</div>
                      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        {[["back", "뒷벽"], ["left", "왼쪽 벽"], ["right", "오른쪽 벽"], ["front", "입구 쪽 벽"], ["floor", "바닥"]].map(([k, lb]) => layoutObj[k] ? <li key={k}><span className="text-gray-500">{lb}:</span> {layoutObj[k]}</li> : null)}
                      </ul>
                    </div>
                  )}
                  {diag && (
                    <div className="mt-3 select-text rounded-xl border border-edge bg-[#0b1018] p-2.5 text-[11px] text-gray-300">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">이 시트는 어떻게 만들어졌나</span>
                        {diag.promptHead ? <button type="button" onClick={() => { try { void navigator.clipboard.writeText(String(diag.promptHead || "")); setNotice("프롬프트를 복사했어요."); } catch { /* 클립보드 불가 */ } }} className="rounded border border-edge px-1.5 py-px text-[10px] text-gray-400 hover:text-white">프롬프트 복사</button> : null}
                      </div>
                      <ul className="space-y-0.5">
                        <li>모델: <span className="text-gray-100">{diag.model || "?"}</span>{diag.provider ? ` (${diag.provider})` : ""}{diag.geminiEndpoint ? ` · ${diag.geminiEndpoint}` : ""}{diag.geminiLocationFallback ? ` · 지역 우회` : ""}</li>
                        <li>참조 이미지: <span className="text-gray-100">{Number(diag.referenceCount) || 0}장</span>{diag.styleSource ? ` · 그림체 참조: ${styleSourceText[diag.styleSource] || diag.styleSource}` : " · 그림체 참조 없음"}</li>
                        <li>허브 블록(톤&매너·세계관·규칙): <span className={diag.hubContextUsed ? "text-emerald-300" : "text-red-300"}>{diag.hubContextUsed ? "포함" : "없음 — 허브 값이 프로젝트에 없어요"}</span>{diag.fallback ? <span className="text-amber-300"> · 1차 실패 후 참조 없이 재시도</span> : null}</li>
                      </ul>
                      {diag.promptHead ? <details className="mt-1"><summary className="cursor-pointer text-[10px] text-gray-500">프롬프트 앞부분</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-snug text-gray-400">{diag.promptHead}</pre></details> : null}
                    </div>
                  )}
                  {(plateUrl || variants.length > 0) && (
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">플레이트</div>
                      <div className="flex flex-wrap gap-1.5">
                        {plateUrl && <button type="button" onClick={() => setLightbox({ url: withMediaToken(plateUrl), title: `${selected.label} · 정면 플레이트`, objectName: String(selected.data.plateRef || "") })} className="relative overflow-hidden rounded-lg border border-edge"><img src={withMediaToken(plateUrl)} alt="" className="h-14 w-[100px] object-cover" draggable={false} /><span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-[9px] text-gray-200">정면</span></button>}
                        {variants.map((v) => (
                          <button key={v.id} type="button" onClick={() => setLightbox({ url: withMediaToken(v.url), title: `${selected.label} · ${v.label || v.id}`, objectName: String((v as any).objectName || "") })} className="relative overflow-hidden rounded-lg border border-edge"><img src={withMediaToken(v.url)} alt="" className="h-14 w-[100px] object-cover" draggable={false} /><span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-[9px] text-gray-200">{v.label || v.id}</span></button>
                        ))}
                      </div>
                    </div>
                  )}
                  {(() => {
                    const me = String(selected.data.name || selected.label);
                    const mine = mergeSuggestions.filter((m) => m.from.includes(me) || m.into === me);
                    if (!mine.length) return null;
                    return (
                      <div className="mt-3 rounded-xl border border-red-700/50 bg-red-900/10 p-2.5">
                        <div className="mb-1 text-[11px] font-bold text-red-300">같은 세트로 보이는 장소가 있어요</div>
                        <p className="mb-1.5 text-[10px] text-gray-400">세트가 두 이름으로 갈리면 각각 따로 생성돼 배경이 달라져요. 하나로 합치면 컷이 옮겨지고 플레이트·시트는 남는 쪽에 없는 것만 물려받아요.</p>
                        <ul className="space-y-1">
                          {mine.map((m) => (
                            <li key={`${m.from.join("|")}→${m.into}`} className="flex items-center gap-2 text-[11px] text-gray-200">
                              <span className="min-w-0 flex-1 truncate" title={`${m.from.join(", ")} → ${m.into}`}>{m.from.map((f) => `"${f}"`).join(", ")} → "{m.into}"</span>
                              <button type="button" disabled={saving} onClick={() => setMergeModal({ names: [...m.from, m.into].filter((x) => locationNodes.some((n) => String(n.data?.name || n.label) === x)), into: m.into })} className="min-w-[72px] rounded-lg bg-red-700 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-600 disabled:opacity-50">합치기</button>
                              {m.from.length === 1 && m.from[0] !== me && m.into !== me ? null : (m.from.length === 1 && m.into !== me ? <button type="button" disabled={saving} onClick={() => void mergeLocations([m.into], me)} className="min-w-[72px] rounded-lg border border-edge px-2 py-1 text-[11px] text-gray-300 hover:bg-edge disabled:opacity-50" title={`"${me}" 이름을 남기고 반대로 합쳐요`}>이 이름으로</button> : null)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                  <p className="mt-3 text-[10px] text-gray-500">같은 장소의 컷은 이 세트 시트를 배경 기준으로 공유해요. 다음 단계에서 네 칸을 승인하면 각 앵글 플레이트로 잘려 저장돼요.</p>
                </div>
              );
            })()}
            {selected.type === "character" && (
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-white">{selected.label}</h3><button type="button" onClick={() => setSelectedId("")} className="text-gray-500 hover:text-white" aria-label="닫기">✕</button></div>
                {selected.data.imageUrl ? <img src={withMediaToken(String(selected.data.imageUrl))} alt="" className="mb-2 w-full rounded-lg object-cover" /> : null}
                {selected.data.description ? <p className="text-[11px] text-gray-400">{String(selected.data.description)}</p> : null}
                <p className="mt-2 text-[11px] text-gray-400">등장 컷: {(graph?.edges || []).filter((e) => e.from === selected.id && e.type === "character").map((e) => e.to.replace("cut:", "#")).join(", ") || "없음"}</p>
              </div>
            )}
          </aside>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
