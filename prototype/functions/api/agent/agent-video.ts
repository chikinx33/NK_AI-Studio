// POST /api/agent/agent-video
// AI Cinema와 분리된 Agent Video 전용 제작 회의.
// 플롯의 구성안을 기준으로 잉크·픽셀·비트가 병렬 작업하고 코어가 Remotion 명세를 통합한다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";
import { callClaude, speak } from "./_orchestrator";
import { normalizeMotionAssetSelection } from "./_motion-assets";
import { MOTION_PLANNING_MODEL, MOTION_SUBSCRIPTION_REQUIRED, motionSubscriptionAuth } from "./_motion-auth";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

type AspectRatio = "16:9" | "9:16" | "1:1";

const ALLOWED_KIND = new Set(["hero", "statement", "metrics", "process", "quote", "cta"]);
const ALLOWED_VISUAL = new Set(["network", "orbit", "bars", "timeline", "spotlight", "grid", "donut", "gauge", "comparison", "flow", "ecosystem", "counters", "area"]);
const ALLOWED_SFX = new Set(["none", "whoosh", "ding", "switch", "click", "whip"]);
const ALLOWED_LAYOUT = new Set(["poster", "editorial", "stacked", "split", "reverse", "visual-first", "dashboard"]);
const ALLOWED_TRANSITION = new Set(["slide", "rise", "zoom", "wipe", "reveal"]);
const ALLOWED_BACKGROUND = new Set(["grid", "organic", "gradient", "paper", "dark"]);
const ALLOWED_DATA_MODE = new Set(["qualitative", "sequence", "quantitative"]);
const ALLOWED_SYMBOL = new Set(["spark", "shield", "traffic", "fire", "phone", "people", "leaf", "planet", "recycle", "chip", "chart", "heart", "book", "check", "arrow"]);
const HEX = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLORS = ["#4d8dff", "#33dbd0", "#ff8a20", "#f35c9d"];
const THEME_PALETTES: Record<string, string[]> = {
  technology: ["#5B8CFF", "#37D6C9", "#A879FF", "#FFB45B"],
  environment: ["#55D187", "#A7D957", "#42BFC7", "#F4C95D"],
  business: ["#5B8CFF", "#33DBD0", "#FFB85C", "#B889FF"],
  education: ["#FFB45B", "#5B8CFF", "#55D187", "#F27FA9"],
  health: ["#42C8B7", "#69A7FF", "#FF7C91", "#A5D95A"],
  social: ["#FF7C91", "#FFB45B", "#8D7CFF", "#42C8B7"],
  abstract: FALLBACK_COLORS,
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function cleanText(value: any, fallback = "", max = 300) {
  const normalized = String(value ?? "").replace(/\r/g, "").trim();
  return (normalized || fallback).slice(0, max);
}

function inferTheme(prompt: string, requested: any) {
  if (/환경|지구|기후|탄소|재활용|친환경|생태|숲|바다|에너지/i.test(prompt)) return "environment";
  if (/교육|학습|학교|강의|튜토리얼|학생|어린이|아동|안전|수칙/i.test(prompt)) return "education";
  if (/건강|의료|병원|웰니스|운동|영양/i.test(prompt)) return "health";
  if (/AI|인공지능|에이전트|데이터|기술|테크|디지털|소프트웨어/i.test(prompt)) return "technology";
  if (/매출|사업|기업|회사|브랜드|시장|성과|투자/i.test(prompt)) return "business";
  if (/캠페인|사회|공익|커뮤니티|참여|문화/i.test(prompt)) return "social";
  const explicit = String(requested || "").trim();
  if (["technology", "environment", "business", "education", "health", "social", "abstract"].includes(explicit)) return explicit;
  return "abstract";
}

const THEME_VISUALS: Record<string, string[]> = {
  technology: ["network", "counters", "flow", "area", "orbit", "gauge", "grid"],
  environment: ["ecosystem", "donut", "flow", "gauge", "area", "comparison", "spotlight"],
  business: ["bars", "counters", "comparison", "area", "timeline", "gauge", "donut"],
  education: ["flow", "timeline", "counters", "comparison", "donut", "grid", "area"],
  health: ["gauge", "area", "counters", "flow", "donut", "comparison", "spotlight"],
  social: ["spotlight", "flow", "comparison", "donut", "ecosystem", "counters", "timeline"],
  abstract: ["orbit", "grid", "bars", "timeline", "spotlight", "network", "donut"],
};

const FORMAT_LAYOUTS: Record<AspectRatio, string[]> = {
  "16:9": ["editorial", "split", "dashboard", "reverse"],
  "1:1": ["poster", "stacked", "dashboard", "editorial"],
  "9:16": ["poster", "stacked", "dashboard", "editorial"],
};

// 자리 표시 글([채널 로고 / 브랜드명], 항목 2, OOO, TBD)은 콘티에 남기지 않는다 — 감독이 그대로 영상에 쓸 수 있다(2026-10-21 운영 콘티에서 확인)
const PLACEHOLDER = /\[[^\]]*(?:로고|브랜드|채널|이름|placeholder|tbd|todo)[^\]]*\]|(?:^|\s)항목\s*\d+(?=\s|$)|\bTBD\b|O{3,}|○{3,}/gi;
export function stripPlaceholders(text: string) {
  return String(text || "").replace(PLACEHOLDER, " ").replace(/[ \t]{2,}/g, " ").replace(/^[\s/·|,-]+|[\s/·|,-]+$/g, "").trim();
}

function compactCopy(value: any, fallback: string, max: number) {
  const source = stripPlaceholders(cleanText(value, fallback, max * 2)).replace(/[ \t]+/g, " ");
  if (source.length <= max) return source;
  const clipped = source.slice(0, max + 1);
  const boundary = Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("\n"));
  return `${clipped.slice(0, boundary > max * 0.65 ? boundary : max).trim()}…`;
}

function promptHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash);
}

function inferSymbol(value: string, theme: string) {
  if (/교통|횡단|신호|도로|차량|보행|traffic|road/i.test(value)) return "traffic";
  if (/화재|불길|연기|대피|소방|fire|smoke/i.test(value)) return "fire";
  if (/신고|전화|연락|112|119|phone|call/i.test(value)) return "phone";
  if (/안전|보호|위험|보안|수칙|shield|safe/i.test(value)) return "shield";
  if (/환경|나무|숲|친환경|생태|leaf|eco/i.test(value)) return "leaf";
  if (/지구|기후|planet|earth/i.test(value)) return "planet";
  if (/재활용|순환|recycle/i.test(value)) return "recycle";
  if (/건강|심장|의료|병원|heart|health/i.test(value)) return "heart";
  if (/교육|학습|학교|책|수업|learn|book/i.test(value)) return "book";
  if (/사람|고객|팀|협업|친구|함께|people|team/i.test(value)) return "people";
  if (/매출|성과|성장|차트|지표|chart|growth/i.test(value)) return "chart";
  if (/AI|인공지능|데이터|기술|칩|디지털|chip|tech/i.test(value)) return "chip";
  if (/완료|확인|약속|실천|check|done/i.test(value)) return "check";
  if (/시작|이동|다음|전환|arrow|next/i.test(value)) return "arrow";
  return ({ environment: "leaf", education: "book", health: "heart", business: "chart", technology: "chip", social: "people" } as Record<string, string>)[theme] || "spark";
}

function normalizeVisualData(raw: any, scene: any, index: number, theme: string) {
  const fallbackValues = [68 + (index * 7) % 22, 52 + (index * 11) % 35, 82 - (index * 5) % 24, 61 + (index * 13) % 28];
  const values = (Array.isArray(raw?.values) ? raw.values : fallbackValues)
    .map((value: any) => Math.min(100, Math.max(0, Number(value) || 0))).slice(0, 6);
  while (values.length < 2) values.push(fallbackValues[values.length] || 50);
  const titleWords = String(scene?.title || "핵심 가치 성과 변화").replace(/\n/g, " ").split(/[·,|/\s]+/).filter(Boolean);
  const labels = (Array.isArray(raw?.labels) ? raw.labels : titleWords)
    .map((value: any) => cleanText(value, "항목", 18)).slice(0, 6);
  while (labels.length < values.length) labels.push(`항목 ${labels.length + 1}`);
  return {
    values,
    labels,
    unit: cleanText(raw?.unit, "%", 12),
    primaryValue: Math.max(0, Number(raw?.primaryValue) || Math.max(...values)),
    secondaryValue: Math.max(0, Number(raw?.secondaryValue) || values.length),
    icon: cleanText(raw?.icon, "✦", 8),
    caption: cleanText(raw?.caption, scene?.body || "핵심 인사이트", 80),
    dataMode: ALLOWED_DATA_MODE.has(String(raw?.dataMode || ""))
      ? String(raw.dataMode)
      : scene?.kind === "metrics" ? "quantitative" : scene?.kind === "process" ? "sequence" : "qualitative",
    symbol: ALLOWED_SYMBOL.has(String(raw?.symbol || ""))
      ? String(raw.symbol)
      : inferSymbol(`${scene?.eyebrow || ""} ${scene?.title || ""} ${scene?.body || ""} ${raw?.caption || ""}`, theme),
  };
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
  const theme = inferTheme(request.prompt, raw?.theme);
  const themeVisuals = THEME_VISUALS[theme] || THEME_VISUALS.abstract;
  const themePalette = THEME_PALETTES[theme] || FALLBACK_COLORS;
  const visualOffset = promptHash(request.prompt) % themeVisuals.length;
  const palette = (Array.isArray(raw?.palette) ? raw.palette : [])
    .map((entry: any, index: number) => HEX.test(String(entry || "")) ? String(entry) : themePalette[index % themePalette.length])
    .slice(0, 6);
  while (palette.length < 4) palette.push(themePalette[palette.length]);

  const sourceScenes = Array.isArray(raw?.scenes) ? raw.scenes.slice(0, 8) : [];
  if (sourceScenes.length < 2) throw new Error("Agent Video 씬이 충분히 생성되지 않았어요.");
  const requestedDuration = Math.min(60, Math.max(10, Number(request.durationSec) || 30));
  const sourceTotal = sourceScenes.reduce((sum: number, scene: any) => sum + Math.max(1, Number(scene?.durationSec) || 1), 0);
  let remaining = requestedDuration;
  const usedVisuals = new Set<string>();
  const scenes = sourceScenes.map((scene: any, index: number) => {
    const isLast = index === sourceScenes.length - 1;
    const proportional = Math.max(2, Math.round((Math.max(1, Number(scene?.durationSec) || 1) / sourceTotal) * requestedDuration * 10) / 10);
    const durationSec = isLast ? Math.max(2, Math.round(remaining * 10) / 10) : Math.min(30, proportional);
    remaining -= durationSec;
    const kind = String(scene?.kind || "statement");
    const visual = String(scene?.visual || "");
    const recommendedVisual = themeVisuals[(visualOffset + index) % themeVisuals.length];
    let chosenVisual = ALLOWED_VISUAL.has(visual) && themeVisuals.includes(visual) ? visual : recommendedVisual;
    if (usedVisuals.has(chosenVisual)) {
      chosenVisual = themeVisuals.find((candidate) => !usedVisuals.has(candidate)) || recommendedVisual;
    }
    usedVisuals.add(chosenVisual);
    const sfx = String(scene?.sfx || "none");
    const requestedLayout = String(scene?.layout || "");
    const formatLayouts = FORMAT_LAYOUTS[request.aspectRatio];
    const previousLayout = index > 0 ? String(sourceScenes[index - 1]?.layout || "") : "";
    const kindValue = ALLOWED_KIND.has(kind) ? kind : "statement";
    const semanticLayout = kindValue === "hero" || kindValue === "cta"
      ? (request.aspectRatio === "16:9" ? "editorial" : "poster")
      : kindValue === "process"
        ? (request.aspectRatio === "16:9" ? "split" : "stacked")
        : kindValue === "metrics" ? "dashboard" : formatLayouts[index % formatLayouts.length];
    const layout = ALLOWED_LAYOUT.has(requestedLayout) && requestedLayout !== previousLayout
      ? requestedLayout
      : semanticLayout;
    return {
      id: cleanText(scene?.id, `scene-${index + 1}`, 40),
      kind: kindValue,
      durationSec,
      // 빈칸을 요청 글·"SCENE n" 으로 채우지 않는다(요청 글이 본문에 반복되던 원인)
      eyebrow: compactCopy(scene?.eyebrow, "", 36),
      title: compactCopy(scene?.title, "", request.aspectRatio === "16:9" ? 54 : 46),
      body: (() => {
        const body = compactCopy(scene?.body, "", request.aspectRatio === "16:9" ? 150 : 120);
        return body && request.prompt.includes(body.replace(/…$/, "")) ? "" : body;
      })(),
      idea: compactCopy(scene?.idea, "", 200),
      facts: (Array.isArray(scene?.facts) ? scene.facts : []).slice(0, 6).flatMap((fact: any) => {
        const value = Number(fact?.value);
        const label = stripPlaceholders(cleanText(fact?.label, "", 40));
        return Number.isFinite(value) && label ? [{ label, value, unit: cleanText(fact?.unit, "", 12) }] : [];
      }),
      accent: HEX.test(String(scene?.accent || "")) ? String(scene.accent) : palette[index % palette.length],
      visual: chosenVisual,
      sfx: ALLOWED_SFX.has(sfx) ? sfx : "none",
      layout,
      transition: ALLOWED_TRANSITION.has(String(scene?.transition || "")) ? String(scene.transition) : (["zoom", "slide", "rise", "wipe", "reveal"][index % 5]),
      visualData: normalizeVisualData(scene?.visualData, { ...scene, kind: kindValue }, index, theme),
    };
  });

  // 반올림 및 씬당 상한으로 생긴 차이를 마지막 씬에 보정한다.
  const actual = scenes.reduce((sum: number, scene: any) => sum + scene.durationSec, 0);
  scenes[scenes.length - 1].durationSec = Math.max(2, Math.round((scenes[scenes.length - 1].durationSec + requestedDuration - actual) * 10) / 10);

  return {
    version: "1.0",
    title: cleanText(raw?.title, "Agent Video", 100),
    objective: cleanText(raw?.objective, request.prompt, 300),
    audience: cleanText(raw?.audience, request.audience, 80),
    tone: cleanText(raw?.tone, request.tone, 80),
    style: cleanText(raw?.style, request.style, 80),
    aspectRatio: request.aspectRatio,
    fps: 30,
    background: HEX.test(String(raw?.background || "")) ? String(raw.background) : theme === "environment" ? "#071813" : theme === "education" ? "#121823" : "#061021",
    palette,
    scenes,
    narration: stripPlaceholders(cleanText(raw?.narration, "", 2000)),
    theme,
    motif: cleanText(raw?.motif, request.prompt, 120),
    backgroundStyle: ALLOWED_BACKGROUND.has(String(raw?.backgroundStyle || ""))
      ? String(raw.backgroundStyle)
      : theme === "environment" ? "organic" : theme === "education" ? "paper" : theme === "technology" ? "grid" : "gradient",
    createdAt: new Date().toISOString(),
  };
}

function enforceSpecQuality(spec: any, aspectRatio: AspectRatio) {
  const seenTitles = new Set<string>();
  spec.scenes = spec.scenes.map((scene: any, index: number) => {
    // 같은 제목이 겹쳐도 "핵심 n" 같은 채움 글을 붙이지 않는다(감독이 장면을 새로 짜며 정리한다)
    const titleKey = String(scene.title || "").replace(/\s+/g, " ").trim().toLowerCase();
    seenTitles.add(titleKey);
    const semanticMode = scene.kind === "metrics" && scene.visualData.dataMode === "quantitative"
      ? "quantitative"
      : scene.kind === "process" ? "sequence" : "qualitative";
    const semanticLayout = scene.kind === "hero" || scene.kind === "cta"
      ? (aspectRatio === "16:9" ? "editorial" : "poster")
      : scene.kind === "process"
        ? (aspectRatio === "16:9" ? "split" : "stacked")
        : scene.kind === "metrics" ? "dashboard" : scene.layout;
    const labels = scene.visualData.labels.slice(0, aspectRatio === "16:9" ? 5 : 4);
    while (labels.length < 2) labels.push(`핵심 ${labels.length + 1}`);
    return {
      ...scene,
      layout: semanticLayout,
      visualData: {
        ...scene.visualData,
        labels,
        dataMode: semanticMode,
        symbol: inferSymbol(`${scene.eyebrow} ${scene.title} ${scene.body} ${scene.visualData.caption}`, spec.theme),
      },
    };
  });
  return spec;
}

function visualSignature(spec: any) {
  return (spec?.scenes || []).map((scene: any) => `${scene.visual}:${scene.layout}`).join("|");
}

function rotateDuplicateVisuals(spec: any, recentSignatures: Set<string>) {
  const sequence = THEME_VISUALS[spec.theme] || THEME_VISUALS.abstract;
  let attempt = 0;
  while (recentSignatures.has(visualSignature(spec)) && attempt < sequence.length) {
    spec.scenes = spec.scenes.map((scene: any, index: number) => ({
      ...scene,
      visual: sequence[(sequence.indexOf(scene.visual) + 1 + index + attempt) % sequence.length],
      layout: (["split", "dashboard", "reverse", "visual-first"] as const)[(index + attempt + 1) % 4],
    }));
    attempt += 1;
  }
  return spec;
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
      // 시청 대상·톤·스타일은 따로 받지 않고 영상 요청에서 읽는다(기본값을 넣지 않는다)
      audience: cleanText(body?.audience, "", 100),
      tone: cleanText(body?.tone, "", 100),
      style: cleanText(body?.style, "", 100),
      assets: normalizeMotionAssetSelection(body?.assets),
    };
    const skill = {
      categoryId: cleanText(body?.skillCategoryId, "design-content", 80),
      skillId: cleanText(body?.skillId, "infographic", 80),
      invocationMode: body?.invocationMode === "manual" ? "manual" : "agent",
      skillJobId: /^[0-9a-f-]{36}$/i.test(String(body?.skillJobId || "")) ? String(body.skillJobId) : null,
    };

    const sql = getSql(env);
    if (sql) await ensureAgentSchema(sql).catch(() => {});
    // 비용 0원: Claude 구독일 때만, 예비 API 키 없이, 모델은 Claude로 고정(사용자 모델 설정이 유료 경로로 보내지 않게)
    const motionAuth = sql ? await motionSubscriptionAuth(sql, auth.userId, env) : null;
    if (!motionAuth) return send({ error: MOTION_SUBSCRIPTION_REQUIRED }, 412, origin);
    const shared = { sql: sql || undefined, userId: auth.userId, maxTokens: 1500, resolvedAuth: motionAuth, model: MOTION_PLANNING_MODEL };
    const brief = [
      `영상 요청: ${input.prompt}`,
      `길이: ${input.durationSec}초`,
      `화면비: ${input.aspectRatio}`,
      "시청 대상·톤·스타일: 영상 요청 글에서 읽어 정한다(따로 주어지지 않는다).",
      "이 결과는 감독(모션그래픽)이 영상마다 장면을 새로 짜는 콘티 초안이다. 템플릿 칸(도표 종류·레이아웃·효과음)은 정하지 않는다.",
      "금지: 자리 표시 글([채널 로고 / 브랜드명], 항목 2, OOO 같은 빈칸), 요청 글을 본문에 그대로 반복, 확인되지 않은 수치. 숫자는 원래 단위 그대로(66권, 40명, 4.7시간).",
    ].join("\n");

    const plotResult = await speak(
      env,
      "plot",
      `${brief}\n\n콘텐츠 디렉터로서 3~8개 장면의 이야기 흐름을 설계하세요. 첫 장면은 1~2초 안에 눈을 잡는 갈고리, 마지막은 결론·행동 유도입니다. 장면마다 역할, 핵심 메시지, 권장 길이, 그리고 화면에서 무엇이 어떻게 움직이면 좋을지(사물·숫자·인물의 움직임) 한 줄 아이디어를 쓰세요.`,
      "",
      shared,
    );
    const plotPlan = plotResult.text;

    const inkResult = await speak(
      env,
      "ink",
      `${brief}\n\n플롯의 구성안:\n${plotPlan}\n\n장면마다 화면에 크게 뜰 짧고 강한 제목(한 줄 2~4덩어리, 핵심 낱말 하나)과 한 문장 보조 문구를 쓰세요. 쇼츠 예고편처럼 리듬 있게, 요청 글을 그대로 옮기지 말고 시청자에게 말하듯 쓰세요. 전체 내레이션 초안도 쓰세요.`,
      "",
      shared,
    );

    const synthesisSystem = `당신은 이 회사의 총괄 오케스트레이터 코어입니다. 플롯·잉크의 결과를 하나로 정리해 감독이 장면을 짤 콘티 초안 JSON 하나를 만드세요.

반드시 아래 스키마의 JSON만 출력하고 마크다운·설명은 금지합니다.
{
  "workTitle": "20자 이내 업무 이름",
  "title": "영상 제목",
  "objective": "영상 목적 한 문장",
  "audience": "요청에서 읽은 시청 대상",
  "tone": "요청에서 읽은 톤",
  "theme": "technology|environment|business|education|health|social|abstract",
  "narration": "전체 내레이션 초안",
  "scenes": [{
    "id": "scene-1",
    "kind": "hero|statement|metrics|process|quote|cta",
    "durationSec": 4,
    "title": "화면에 크게 뜰 제목. 줄바꿈은 \\n",
    "body": "한 문장 보조 문구(필요 없으면 빈 문자열)",
    "idea": "화면에서 무엇이 어떻게 움직이는지 한 줄",
    "facts": [{ "label": "무엇의 수치인지", "value": 4.7, "unit": "시간" }]
  }]
}

규칙:
- 장면은 3~8개, 길이 합은 요청 길이와 같다. 첫 장면은 갈고리, 마지막은 결론 또는 행동 유도.
- facts 에는 요청·자료에 실제로 있는 수치만 넣고 단위는 원래 그대로(권·명·시간·분·% 등). 없으면 빈 배열.
- 자리 표시 글([채널 로고 / 브랜드명], 항목 2, OOO, TBD 등)을 절대 쓰지 않는다. 모르는 이름은 쓰지 않는다.
- body 에 요청 글을 그대로 반복하지 않는다.
- JSON 문자열 안의 실제 줄바꿈은 반드시 \\n 으로 이스케이프한다.`;

    const synthesisInput = [
      "# 사용자 제작 계약",
      brief,
      "# 플롯(이야기 흐름)",
      plotPlan,
      "# 잉크(문장)",
      inkResult.text,
    ].join("\n\n");

    const rawSpec = await callClaude(env, synthesisSystem, [{ role: "user", content: synthesisInput }], {
      sql: sql || undefined,
      userId: auth.userId,
      model: MOTION_PLANNING_MODEL,
      maxTokens: 4200,
      resolvedAuth: motionAuth,
    });
    let spec = enforceSpecQuality(normalizeSpec(parseJsonObject(rawSpec), input), input.aspectRatio);
    if (sql) {
      const recent = await sql("SELECT metadata FROM company_work_items WHERE user_id = $1 AND work_type = 'infographic' ORDER BY created_at DESC LIMIT 8", [auth.userId]).catch(() => []);
      const signatures = new Set(recent.map((row: any) => visualSignature(row?.metadata?.spec)).filter(Boolean));
      spec = enforceSpecQuality(rotateDuplicateVisuals(spec, signatures), input.aspectRatio);
    }

    const contributions = [
      { agentId: "plot", agentName: "플롯", emoji: "🎬", summary: summary(plotPlan) },
      { agentId: "ink", agentName: "잉크", emoji: "✍️", summary: summary(inkResult.text) },
      { agentId: "core", agentName: "코어", emoji: "🧭", summary: `${spec.scenes.length}개 장면, ${input.durationSec}초 ${input.aspectRatio} 콘티 초안으로 정리했습니다.` },
    ];

    // 결과물을 영상 파일이 아닌 '회사 업무' 단위로 등록한다. 이후 파일은 이 업무 ID 아래에 귀속된다.
    let work: any = null;
    if (sql) {
      const workTitle = cleanText(parseJsonObject(rawSpec)?.workTitle, spec.title || "인포그래픽 제작", 20);
      const rows = await sql(`
        INSERT INTO company_work_items
          (user_id, conversation_id, title, work_type, status, request_text, result_summary, metadata, completed_at)
        VALUES ($1, $2, $3, 'infographic', 'working', $4, $5, $6::jsonb, NULL)
        RETURNING *
      `, [
        auth.userId,
        cleanText(body?.conversationId, "main", 120),
        workTitle,
        input.prompt,
        `${spec.scenes.length}개 씬 · ${input.durationSec}초 ${input.aspectRatio} Remotion 제작 명세`,
        JSON.stringify({ input, spec, contributions, skill }),
      ]);
      work = rows[0] || null;
    }

    return send({ spec, contributions, work }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "Agent Video 제작에 실패했어요.") }, 500, origin);
  }
};
