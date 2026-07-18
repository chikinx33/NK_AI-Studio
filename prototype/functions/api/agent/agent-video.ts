// POST /api/agent/agent-video
// AI Cinema와 분리된 Agent Video 전용 제작 회의.
// 플롯의 구성안을 기준으로 잉크·픽셀·비트가 병렬 작업하고 코어가 Remotion 명세를 통합한다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";
import { callClaude, speak } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

type AspectRatio = "16:9" | "9:16" | "1:1";

const ALLOWED_KIND = new Set(["hero", "statement", "metrics", "process", "quote", "cta"]);
const ALLOWED_VISUAL = new Set(["network", "orbit", "bars", "timeline", "spotlight", "grid"]);
const ALLOWED_SFX = new Set(["none", "whoosh", "ding", "switch", "click", "whip"]);
const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLORS = ["#4d8dff", "#33dbd0", "#ff8a20", "#f35c9d"];

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function cleanText(value: any, fallback = "", max = 300) {
  const normalized = String(value ?? "").replace(/\r/g, "").trim();
  return (normalized || fallback).slice(0, max);
}

function parseJsonObject(raw: string) {
  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(cleaned); } catch { /* 아래에서 객체 범위를 재시도한다. */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error("코어가 유효한 Agent Video 명세를 반환하지 않았어요.");
}

function normalizeSpec(raw: any, request: {
  prompt: string;
  durationSec: number;
  aspectRatio: AspectRatio;
  audience: string;
  tone: string;
  style: string;
}) {
  const palette = (Array.isArray(raw?.palette) ? raw.palette : [])
    .map((entry: any, index: number) => HEX.test(String(entry || "")) ? String(entry) : FALLBACK_COLORS[index % FALLBACK_COLORS.length])
    .slice(0, 6);
  while (palette.length < 4) palette.push(FALLBACK_COLORS[palette.length]);

  const sourceScenes = Array.isArray(raw?.scenes) ? raw.scenes.slice(0, 8) : [];
  if (sourceScenes.length < 2) throw new Error("Agent Video 씬이 충분히 생성되지 않았어요.");
  const requestedDuration = Math.min(60, Math.max(10, Number(request.durationSec) || 30));
  const sourceTotal = sourceScenes.reduce((sum: number, scene: any) => sum + Math.max(1, Number(scene?.durationSec) || 1), 0);
  let remaining = requestedDuration;
  const scenes = sourceScenes.map((scene: any, index: number) => {
    const isLast = index === sourceScenes.length - 1;
    const proportional = Math.max(2, Math.round((Math.max(1, Number(scene?.durationSec) || 1) / sourceTotal) * requestedDuration * 10) / 10);
    const durationSec = isLast ? Math.max(2, Math.round(remaining * 10) / 10) : Math.min(30, proportional);
    remaining -= durationSec;
    const kind = String(scene?.kind || "statement");
    const visual = String(scene?.visual || "grid");
    const sfx = String(scene?.sfx || "none");
    return {
      id: cleanText(scene?.id, `scene-${index + 1}`, 40),
      kind: ALLOWED_KIND.has(kind) ? kind : "statement",
      durationSec,
      eyebrow: cleanText(scene?.eyebrow, `SCENE ${index + 1}`, 80),
      title: cleanText(scene?.title, `핵심 장면 ${index + 1}`, 120),
      body: cleanText(scene?.body, request.prompt, 280),
      accent: HEX.test(String(scene?.accent || "")) ? String(scene.accent) : palette[index % palette.length],
      visual: ALLOWED_VISUAL.has(visual) ? visual : "grid",
      sfx: ALLOWED_SFX.has(sfx) ? sfx : "none",
    };
  });

  // 반올림 및 씬당 상한으로 생긴 차이를 마지막 씬에 보정한다.
  const actual = scenes.reduce((sum: number, scene: any) => sum + scene.durationSec, 0);
  scenes[scenes.length - 1].durationSec = Math.max(2, Math.round((scenes[scenes.length - 1].durationSec + requestedDuration - actual) * 10) / 10);

  return {
    version: "1.0",
    title: cleanText(raw?.title, "Raviok Agent Video", 100),
    objective: cleanText(raw?.objective, request.prompt, 300),
    audience: cleanText(raw?.audience, request.audience, 80),
    tone: cleanText(raw?.tone, request.tone, 80),
    style: cleanText(raw?.style, request.style, 80),
    aspectRatio: request.aspectRatio,
    fps: 30,
    background: HEX.test(String(raw?.background || "")) ? String(raw.background) : "#061021",
    palette,
    scenes,
    narration: cleanText(raw?.narration, "", 2000),
    createdAt: new Date().toISOString(),
  };
}

function summary(text: string, max = 360) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body: any = await request.json().catch(() => ({}));
    const prompt = cleanText(body?.prompt, "", 1600);
    if (!prompt) return send({ error: "영상 요청을 입력해 주세요." }, 400, origin);

    const aspectRatio: AspectRatio = body?.aspectRatio === "9:16" || body?.aspectRatio === "1:1" ? body.aspectRatio : "16:9";
    const input = {
      prompt,
      durationSec: Math.min(60, Math.max(10, Number(body?.durationSec) || 30)),
      aspectRatio,
      audience: cleanText(body?.audience, "일반 시청자", 100),
      tone: cleanText(body?.tone, "명료하고 신뢰감 있게", 100),
      style: cleanText(body?.style, "시네마틱 모션 그래픽", 100),
    };

    const sql = getSql(env);
    if (sql) await ensureAgentSchema(sql).catch(() => {});
    const shared = { sql: sql || undefined, userId: auth.userId, maxTokens: 1500 };
    const brief = [
      `영상 요청: ${input.prompt}`,
      `길이: ${input.durationSec}초`,
      `화면비: ${input.aspectRatio}`,
      `시청 대상: ${input.audience}`,
      `톤: ${input.tone}`,
      `스타일: ${input.style}`,
      "제약: AI Cinema의 기존 프로젝트·클립은 사용하지 않는다. 외부 영상 생성 없이 Remotion 네이티브 텍스트·도형·SVG·애니메이션으로 새 영상을 만든다.",
    ].join("\n");

    const plotResult = await speak(
      env,
      "plot",
      `${brief}\n\n독립 Agent Video의 콘텐츠 디렉터로서 3~8개 씬의 서사 구조를 설계하세요. 각 씬의 역할, 제목, 핵심 메시지, 권장 길이를 명확하게 작성하고 총 길이를 맞추세요. 다른 직원이 바로 작업할 수 있는 제작 브리프로 답하세요.`,
      "",
      shared,
    );
    const plotPlan = plotResult.text;

    const [inkResult, pixelResult, beatResult] = await Promise.all([
      speak(
        env,
        "ink",
        `${brief}\n\n플롯의 구성안:\n${plotPlan}\n\n각 씬에 실제 화면에 표시할 짧고 강한 eyebrow, title, body 카피를 작성하세요. 제목은 최대 두 줄, 본문은 한두 문장으로 제한하고 전체 내레이션 초안도 작성하세요.`,
        "",
        shared,
      ),
      speak(
        env,
        "pixel",
        `${brief}\n\n플롯의 구성안:\n${plotPlan}\n\nRemotion 모션 디자이너로서 외부 이미지 없이 구현 가능한 시각 시스템을 설계하세요. 씬별로 network, orbit, bars, timeline, spotlight, grid 중 하나를 선택하고 색상 팔레트와 모션 리듬을 지정하세요.`,
        "",
        shared,
      ),
      speak(
        env,
        "beat",
        `${brief}\n\n플롯의 구성안:\n${plotPlan}\n\n추가 유료 음원 생성 없이 @remotion/sfx만 활용하는 사운드 계획을 설계하세요. 씬별로 none, whoosh, ding, switch, click, whip 중 하나를 선택하고 과도한 효과음은 피하세요.`,
        "",
        shared,
      ),
    ]);

    const synthesisSystem = `당신은 라비오크 총괄 오케스트레이터 코어입니다. 플롯·잉크·픽셀·비트의 결과를 충돌 없이 통합해 Remotion이 즉시 렌더할 수 있는 JSON 하나를 만드세요.

반드시 아래 스키마의 JSON만 출력하고 마크다운·설명은 금지합니다.
{
  "title": "영상 제목",
  "objective": "영상 목적",
  "audience": "시청 대상",
  "tone": "톤",
  "style": "스타일",
  "aspectRatio": "16:9|9:16|1:1",
  "background": "#RRGGBB",
  "palette": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "narration": "전체 내레이션 초안",
  "scenes": [{
    "id": "scene-1",
    "kind": "hero|statement|metrics|process|quote|cta",
    "durationSec": 4,
    "eyebrow": "짧은 영문 또는 한글 라벨",
    "title": "최대 두 줄 제목. 줄바꿈은 \\n",
    "body": "한두 문장 본문",
    "accent": "#RRGGBB",
    "visual": "network|orbit|bars|timeline|spotlight|grid",
    "sfx": "none|whoosh|ding|switch|click|whip"
  }]
}

규칙:
- 씬은 3~8개, 순서만 읽어도 완결된 이야기여야 합니다.
- 씬 길이 합은 요청 길이와 같아야 합니다.
- 첫 장면은 후크, 마지막 장면은 결론 또는 CTA입니다.
- 화면에 들어가는 문장은 짧고 즉시 이해되어야 합니다.
- 외부 영상·이미지를 요구하지 않습니다.
- JSON 문자열 안의 실제 줄바꿈은 반드시 \\n으로 이스케이프합니다.`;

    const synthesisInput = [
      "# 사용자 제작 계약",
      brief,
      "# 플롯(PD)",
      plotPlan,
      "# 잉크(카피)",
      inkResult.text,
      "# 픽셀(비주얼)",
      pixelResult.text,
      "# 비트(사운드)",
      beatResult.text,
    ].join("\n\n");

    const rawSpec = await callClaude(env, synthesisSystem, [{ role: "user", content: synthesisInput }], {
      sql: sql || undefined,
      userId: auth.userId,
      model: "claude-sonnet-4-6",
      maxTokens: 4200,
    });
    const spec = normalizeSpec(parseJsonObject(rawSpec), input);

    const contributions = [
      { agentId: "plot", agentName: "플롯", emoji: "🎬", summary: summary(plotPlan) },
      { agentId: "ink", agentName: "잉크", emoji: "✍️", summary: summary(inkResult.text) },
      { agentId: "pixel", agentName: "픽셀", emoji: "🎨", summary: summary(pixelResult.text) },
      { agentId: "beat", agentName: "비트", emoji: "🎵", summary: summary(beatResult.text) },
      { agentId: "core", agentName: "코어", emoji: "🧭", summary: `${spec.scenes.length}개 씬, ${input.durationSec}초 ${input.aspectRatio} Remotion 명세로 통합하고 렌더 계약을 검증했습니다.` },
    ];

    return send({ spec, contributions }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "Agent Video 제작에 실패했어요.") }, 500, origin);
  }
};
