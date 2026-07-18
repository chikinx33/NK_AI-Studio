export type AgentVideoAspectRatio = "16:9" | "9:16" | "1:1";
export type AgentVideoSceneKind = "hero" | "statement" | "metrics" | "process" | "quote" | "cta";
export type AgentVideoVisualKind = "network" | "orbit" | "bars" | "timeline" | "spotlight" | "grid";
export type AgentVideoSfx = "none" | "whoosh" | "ding" | "switch" | "click" | "whip";

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
const visualKinds = new Set<AgentVideoVisualKind>(["network", "orbit", "bars", "timeline", "spotlight", "grid"]);
const sfxKinds = new Set<AgentVideoSfx>(["none", "whoosh", "ding", "switch", "click", "whip"]);

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

  const rawScenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, 8) : [];
  const scenes = rawScenes.map((entry, index): AgentVideoScene => {
    const scene = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const kindCandidate = String(scene.kind ?? "statement") as AgentVideoSceneKind;
    const visualCandidate = String(scene.visual ?? "grid") as AgentVideoVisualKind;
    const sfxCandidate = String(scene.sfx ?? "none") as AgentVideoSfx;
    const fallback = defaultAgentVideoSpec.scenes[index % defaultAgentVideoSpec.scenes.length];
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
    createdAt: text(raw.createdAt, new Date().toISOString(), 40),
  };
}
