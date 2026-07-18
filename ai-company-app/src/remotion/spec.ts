export type AgentVideoAspectRatio = "16:9" | "9:16" | "1:1";
export type AgentVideoSceneKind = "hero" | "statement" | "metrics" | "process" | "quote" | "cta";
export type AgentVideoVisualKind =
  | "network" | "orbit" | "bars" | "timeline" | "spotlight" | "grid"
  | "donut" | "gauge" | "comparison" | "flow" | "ecosystem" | "counters" | "area";
export type AgentVideoSfx = "none" | "whoosh" | "ding" | "switch" | "click" | "whip";
export type AgentVideoTheme = "technology" | "environment" | "business" | "education" | "health" | "social" | "abstract";
export type AgentVideoLayout = "poster" | "editorial" | "stacked" | "split" | "reverse" | "visual-first" | "dashboard";
export type AgentVideoTransition = "slide" | "rise" | "zoom" | "wipe" | "reveal";
export type AgentVideoDataMode = "qualitative" | "sequence" | "quantitative";
export type AgentVideoSymbol =
  | "spark" | "shield" | "traffic" | "fire" | "phone" | "people" | "leaf"
  | "planet" | "recycle" | "chip" | "chart" | "heart" | "book" | "check" | "arrow";

export interface AgentVideoVisualData {
  values: number[];
  labels: string[];
  unit: string;
  primaryValue: number;
  secondaryValue: number;
  icon: string;
  caption: string;
  dataMode: AgentVideoDataMode;
  symbol: AgentVideoSymbol;
}

export interface AgentVideoScene {
  id: string;
  kind: AgentVideoSceneKind;
  durationSec: number;
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
  visual: AgentVideoVisualKind;
  sfx: AgentVideoSfx;
  layout: AgentVideoLayout;
  transition: AgentVideoTransition;
  visualData: AgentVideoVisualData;
}

export interface AgentVideoSpec {
  version: "1.0";
  title: string;
  objective: string;
  audience: string;
  tone: string;
  style: string;
  aspectRatio: AgentVideoAspectRatio;
  fps: 30;
  background: string;
  palette: string[];
  scenes: AgentVideoScene[];
  narration: string;
  theme: AgentVideoTheme;
  motif: string;
  backgroundStyle: "grid" | "organic" | "gradient" | "paper" | "dark";
  createdAt?: string;
}

export interface AgentVideoContribution {
  agentId: "plot" | "ink" | "pixel" | "beat" | "core";
  agentName: string;
  emoji: string;
  summary: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const sceneKinds = new Set<AgentVideoSceneKind>(["hero", "statement", "metrics", "process", "quote", "cta"]);
const visualKinds = new Set<AgentVideoVisualKind>(["network", "orbit", "bars", "timeline", "spotlight", "grid", "donut", "gauge", "comparison", "flow", "ecosystem", "counters", "area"]);
const sfxKinds = new Set<AgentVideoSfx>(["none", "whoosh", "ding", "switch", "click", "whip"]);
const themes = new Set<AgentVideoTheme>(["technology", "environment", "business", "education", "health", "social", "abstract"]);
const layouts = new Set<AgentVideoLayout>(["poster", "editorial", "stacked", "split", "reverse", "visual-first", "dashboard"]);
const transitions = new Set<AgentVideoTransition>(["slide", "rise", "zoom", "wipe", "reveal"]);
const dataModes = new Set<AgentVideoDataMode>(["qualitative", "sequence", "quantitative"]);
const symbols = new Set<AgentVideoSymbol>(["spark", "shield", "traffic", "fire", "phone", "people", "leaf", "planet", "recycle", "chip", "chart", "heart", "book", "check", "arrow"]);

export function inferAgentVideoSymbol(value: string, theme: AgentVideoTheme): AgentVideoSymbol {
  const textValue = String(value || "");
  if (/교통|횡단|신호|도로|차량|보행|traffic|road/i.test(textValue)) return "traffic";
  if (/화재|불길|연기|대피|소방|fire|smoke/i.test(textValue)) return "fire";
  if (/신고|전화|연락|112|119|phone|call/i.test(textValue)) return "phone";
  if (/안전|보호|위험|보안|수칙|shield|safe/i.test(textValue)) return "shield";
  if (/환경|나무|숲|친환경|생태|leaf|eco/i.test(textValue)) return "leaf";
  if (/지구|기후|planet|earth/i.test(textValue)) return "planet";
  if (/재활용|순환|recycle/i.test(textValue)) return "recycle";
  if (/건강|심장|의료|병원|heart|health/i.test(textValue)) return "heart";
  if (/교육|학습|학교|책|수업|learn|book/i.test(textValue)) return "book";
  if (/사람|고객|팀|협업|친구|함께|people|team/i.test(textValue)) return "people";
  if (/매출|성과|성장|차트|지표|chart|growth/i.test(textValue)) return "chart";
  if (/AI|인공지능|데이터|기술|칩|디지털|chip|tech/i.test(textValue)) return "chip";
  if (/완료|확인|약속|실천|check|done/i.test(textValue)) return "check";
  if (/시작|이동|다음|전환|arrow|next/i.test(textValue)) return "arrow";
  if (theme === "environment") return "leaf";
  if (theme === "education") return "book";
  if (theme === "health") return "heart";
  if (theme === "business") return "chart";
  if (theme === "technology") return "chip";
  if (theme === "social") return "people";
  return "spark";
}

export const defaultAgentVideoSpec: AgentVideoSpec = {
  version: "1.0",
  title: "라비오크 Agent Video",
  objective: "AI 에이전트 협업을 한 편의 영상으로 소개합니다.",
  audience: "콘텐츠 제작자",
  tone: "명료하고 미래지향적",
  style: "시네마틱 테크",
  aspectRatio: "16:9",
  fps: 30,
  background: "#061021",
  palette: ["#4d8dff", "#33dbd0", "#ff8a20", "#f35c9d"],
  narration: "라비오크의 에이전트들은 기획부터 디자인과 사운드까지 협업해 새로운 영상을 완성합니다.",
  theme: "technology",
  motif: "연결되는 지능형 에이전트 네트워크",
  backgroundStyle: "grid",
  scenes: [
    {
      id: "scene-1",
      kind: "hero",
      durationSec: 4,
      eyebrow: "RAVIOK AGENT VIDEO",
      title: "아이디어가\n영상이 되는 순간",
      body: "전문 에이전트들의 협업으로 시작합니다.",
      accent: "#4d8dff",
      visual: "orbit",
      sfx: "whoosh",
      layout: "visual-first",
      transition: "zoom",
      visualData: { values: [82, 64, 91, 73], labels: ["기획", "카피", "디자인", "사운드"], unit: "%", primaryValue: 4, secondaryValue: 30, icon: "✦", caption: "전문 에이전트 협업", dataMode: "qualitative", symbol: "spark" },
    },
    {
      id: "scene-2",
      kind: "process",
      durationSec: 5,
      eyebrow: "COLLABORATION",
      title: "기획 · 디자인 · 사운드",
      body: "플롯, 잉크, 픽셀, 비트가 각자의 전문성을 하나의 명세로 결합합니다.",
      accent: "#33dbd0",
      visual: "network",
      sfx: "switch",
      layout: "split",
      transition: "slide",
      visualData: { values: [78, 86, 92, 88], labels: ["PLOT", "INK", "PIXEL", "BEAT"], unit: "%", primaryValue: 4, secondaryValue: 1, icon: "◎", caption: "하나의 제작 명세로 통합", dataMode: "sequence", symbol: "people" },
    },
    {
      id: "scene-3",
      kind: "cta",
      durationSec: 4,
      eyebrow: "REMOTION RENDER",
      title: "한 번의 요청으로\n완성된 MP4까지",
      body: "라비오크와 함께 새로운 영상을 시작하세요.",
      accent: "#ff8a20",
      visual: "spotlight",
      sfx: "ding",
      layout: "dashboard",
      transition: "rise",
      visualData: { values: [25, 50, 75, 100], labels: ["요청", "협업", "검수", "렌더"], unit: "%", primaryValue: 100, secondaryValue: 30, icon: "↗", caption: "로컬 Remotion 렌더", dataMode: "sequence", symbol: "arrow" },
    },
  ],
};

const text = (value: unknown, fallback = "", max = 240) => {
  const normalized = String(value ?? "").replace(/\r/g, "").trim();
  return (normalized || fallback).slice(0, max);
};

const color = (value: unknown, fallback: string) => {
  const candidate = String(value ?? "").trim();
  return HEX.test(candidate) ? candidate : fallback;
};

export function getAgentVideoDimensions(aspectRatio: AgentVideoAspectRatio) {
  if (aspectRatio === "9:16") return { width: 1080, height: 1920 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function getAgentVideoDurationSec(spec: AgentVideoSpec) {
  return spec.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
}

export function normalizeAgentVideoSpec(input: unknown): AgentVideoSpec {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const aspectRatio: AgentVideoAspectRatio = raw.aspectRatio === "9:16" || raw.aspectRatio === "1:1" ? raw.aspectRatio : "16:9";
  const rawPalette = Array.isArray(raw.palette) ? raw.palette : [];
  const palette = rawPalette
    .map((entry, index) => color(entry, defaultAgentVideoSpec.palette[index % defaultAgentVideoSpec.palette.length]))
    .slice(0, 6);
  while (palette.length < 4) palette.push(defaultAgentVideoSpec.palette[palette.length]);
  const themeCandidate = String(raw.theme ?? "technology") as AgentVideoTheme;
  const theme = themes.has(themeCandidate) ? themeCandidate : "abstract";
  const backgroundCandidate = String(raw.backgroundStyle ?? "grid") as AgentVideoSpec["backgroundStyle"];

  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, 8) : [];
  const scenes = rawScenes.map((entry, index): AgentVideoScene => {
    const scene = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const kindCandidate = String(scene.kind ?? "statement") as AgentVideoSceneKind;
    const visualCandidate = String(scene.visual ?? "grid") as AgentVideoVisualKind;
    const sfxCandidate = String(scene.sfx ?? "none") as AgentVideoSfx;
    const layoutCandidate = String(scene.layout ?? "split") as AgentVideoLayout;
    const transitionCandidate = String(scene.transition ?? "slide") as AgentVideoTransition;
    const fallback = defaultAgentVideoSpec.scenes[index % defaultAgentVideoSpec.scenes.length];
    const rawData = scene.visualData && typeof scene.visualData === "object" ? scene.visualData as Record<string, unknown> : {};
    const values = (Array.isArray(rawData.values) ? rawData.values : fallback.visualData.values)
      .map((value) => Math.min(100, Math.max(0, Number(value) || 0))).slice(0, 6);
    while (values.length < 2) values.push(fallback.visualData.values[values.length] || 50);
    const labels = (Array.isArray(rawData.labels) ? rawData.labels : fallback.visualData.labels)
      .map((value) => text(value, "항목", 18)).slice(0, 6);
    while (labels.length < values.length) labels.push(`항목 ${labels.length + 1}`);
    return {
      id: text(scene.id, `scene-${index + 1}`, 40),
      kind: sceneKinds.has(kindCandidate) ? kindCandidate : "statement",
      durationSec: Math.min(30, Math.max(2, Number(scene.durationSec) || fallback.durationSec)),
      eyebrow: text(scene.eyebrow, fallback.eyebrow, 80),
      title: text(scene.title, fallback.title, 120),
      body: text(scene.body, fallback.body, 280),
      accent: color(scene.accent, palette[index % palette.length]),
      visual: visualKinds.has(visualCandidate) ? visualCandidate : "grid",
      sfx: sfxKinds.has(sfxCandidate) ? sfxCandidate : "none",
      layout: layouts.has(layoutCandidate) ? layoutCandidate : (["visual-first", "split", "dashboard", "reverse"][index % 4] as AgentVideoLayout),
      transition: transitions.has(transitionCandidate) ? transitionCandidate : (["zoom", "slide", "rise", "wipe", "reveal"][index % 5] as AgentVideoTransition),
      visualData: {
        values,
        labels,
        unit: text(rawData.unit, fallback.visualData.unit, 12),
        primaryValue: Math.max(0, Number(rawData.primaryValue) || fallback.visualData.primaryValue),
        secondaryValue: Math.max(0, Number(rawData.secondaryValue) || fallback.visualData.secondaryValue),
        icon: text(rawData.icon, fallback.visualData.icon, 8),
        caption: text(rawData.caption, fallback.visualData.caption, 80),
        dataMode: dataModes.has(String(rawData.dataMode) as AgentVideoDataMode)
          ? String(rawData.dataMode) as AgentVideoDataMode
          : kindCandidate === "metrics" ? "quantitative" : kindCandidate === "process" ? "sequence" : "qualitative",
        symbol: symbols.has(String(rawData.symbol) as AgentVideoSymbol)
          ? String(rawData.symbol) as AgentVideoSymbol
          : inferAgentVideoSymbol(`${scene.eyebrow || ""} ${scene.title || ""} ${scene.body || ""} ${rawData.caption || ""}`, theme),
      },
    };
  });

  return {
    version: "1.0",
    title: text(raw.title, defaultAgentVideoSpec.title, 100),
    objective: text(raw.objective, defaultAgentVideoSpec.objective, 300),
    audience: text(raw.audience, defaultAgentVideoSpec.audience, 80),
    tone: text(raw.tone, defaultAgentVideoSpec.tone, 80),
    style: text(raw.style, defaultAgentVideoSpec.style, 80),
    aspectRatio,
    fps: 30,
    background: color(raw.background, defaultAgentVideoSpec.background),
    palette,
    scenes: scenes.length >= 2 ? scenes : defaultAgentVideoSpec.scenes,
    narration: text(raw.narration, "", 2000),
    theme,
    motif: text(raw.motif, defaultAgentVideoSpec.motif, 120),
    backgroundStyle: (["grid", "organic", "gradient", "paper", "dark"] as const).includes(backgroundCandidate) ? backgroundCandidate : "gradient",
    createdAt: text(raw.createdAt, new Date().toISOString(), 40),
  };
}
