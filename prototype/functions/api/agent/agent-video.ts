// POST /api/agent/agent-video
// AI Cinema와 분리된 Agent Video 전용 제작 회의.
// 플롯의 구성안을 기준으로 잉크·픽셀·비트가 병렬 작업하고 코어가 Remotion 명세를 통합한다.
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, ensureAgentSchema, getSql, send } from "./_shared";
import { callClaude, speak } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

type AspectRatio = "16:9" | "9:16" | "1:1";

const ALLOWED_KIND = new Set(["hero", "statement", "metrics", "process", "quote", "cta"]);
const ALLOWED_VISUAL = new Set(["network", "orbit", "bars", "timeline", "spotlight", "grid", "donut", "gauge", "comparison", "flow", "ecosystem", "counters", "area"]);
const ALLOWED_SFX = new Set(["none", "whoosh", "ding", "switch", "click", "whip"]);
const ALLOWED_LAYOUT = new Set(["split", "reverse", "visual-first", "dashboard"]);
const ALLOWED_TRANSITION = new Set(["slide", "rise", "zoom", "wipe", "reveal"]);
const ALLOWED_BACKGROUND = new Set(["grid", "organic", "gradient", "paper", "dark"]);
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
  if (/교육|학습|학교|강의|튜토리얼|학생/i.test(prompt)) return "education";
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
  "16:9": ["split", "dashboard", "reverse", "visual-first"],
  "1:1": ["visual-first", "dashboard", "split", "visual-first"],
  "9:16": ["visual-first", "split", "dashboard", "visual-first"],
};

function compactCopy(value: any, fallback: string, max: number) {
  const source = cleanText(value, fallback, max * 2).replace(/[ \t]+/g, " ");
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

function normalizeVisualData(raw: any, scene: any, index: number) {
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
    const layout = ALLOWED_LAYOUT.has(requestedLayout) && requestedLayout !== previousLayout
      ? requestedLayout
      : formatLayouts[index % formatLayouts.length];
    return {
      id: cleanText(scene?.id, `scene-${index + 1}`, 40),
      kind: ALLOWED_KIND.has(kind) ? kind : "statement",
      durationSec,
      eyebrow: compactCopy(scene?.eyebrow, `SCENE ${index + 1}`, 36),
      title: compactCopy(scene?.title, `핵심 장면 ${index + 1}`, request.aspectRatio === "16:9" ? 54 : 46),
      body: compactCopy(scene?.body, request.prompt, request.aspectRatio === "16:9" ? 150 : 120),
      accent: HEX.test(String(scene?.accent || "")) ? String(scene.accent) : palette[index % palette.length],
      visual: chosenVisual,
      sfx: ALLOWED_SFX.has(sfx) ? sfx : "none",
      layout,
      transition: ALLOWED_TRANSITION.has(String(scene?.transition || "")) ? String(scene.transition) : (["zoom", "slide", "rise", "wipe", "reveal"][index % 5]),
      visualData: normalizeVisualData(scene?.visualData, scene, index),
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
    background: HEX.test(String(raw?.background || "")) ? String(raw.background) : theme === "environment" ? "#071813" : theme === "education" ? "#121823" : "#061021",
    palette,
    scenes,
    narration: cleanText(raw?.narration, "", 2000),
    theme,
    motif: cleanText(raw?.motif, request.prompt, 120),
    backgroundStyle: ALLOWED_BACKGROUND.has(String(raw?.backgroundStyle || ""))
      ? String(raw.backgroundStyle)
      : theme === "environment" ? "organic" : theme === "education" ? "paper" : theme === "technology" ? "grid" : "gradient",
    createdAt: new Date().toISOString(),
  };
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
        `${brief}\n\n플롯의 구성안:\n${plotPlan}\n\n최상급 정보디자인 스튜디오의 아트 디렉터로서 주제 고유의 시각 언어를 설계하세요. 씬마다 network, orbit, bars, timeline, spotlight, grid, donut, gauge, comparison, flow, ecosystem, counters, area 중 의미에 맞는 서로 다른 시각 구조를 고르세요. 실제 화면을 구성할 2~6개 값(0~100), 짧은 라벨, 핵심 수치·단위, 아이콘, 캡션을 제안하세요. 사실로 확인되지 않은 통계를 꾸며내지 말고 그런 경우 값은 정성적 비중·진행 단계로 표현하세요. 전체 팔레트, 배경 패턴, 화면 레이아웃과 전환 방식도 주제에 맞게 차별화하세요.`,
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
  "workTitle": "20자 이내 업무 이름",
  "title": "영상 제목",
  "objective": "영상 목적",
  "audience": "시청 대상",
  "tone": "톤",
  "style": "스타일",
  "theme": "technology|environment|business|education|health|social|abstract",
  "motif": "이 영상만의 시각 모티프",
  "backgroundStyle": "grid|organic|gradient|paper|dark",
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
    "visual": "network|orbit|bars|timeline|spotlight|grid|donut|gauge|comparison|flow|ecosystem|counters|area",
    "layout": "split|reverse|visual-first|dashboard",
    "transition": "slide|rise|zoom|wipe|reveal",
    "visualData": {
      "values": [0부터 100 사이 숫자 2~6개],
      "labels": ["각 값의 짧은 라벨"],
      "unit": "%|개|단계 등",
      "primaryValue": 72,
      "secondaryValue": 4,
      "icon": "주제 상징 한 글자 또는 기호",
      "caption": "도표가 전달할 인사이트"
    },
    "sfx": "none|whoosh|ding|switch|click|whip"
  }]
}

규칙:
- 씬은 3~8개, 순서만 읽어도 완결된 이야기여야 합니다.
- 씬 길이 합은 요청 길이와 같아야 합니다.
- 첫 장면은 후크, 마지막 장면은 결론 또는 CTA입니다.
- 화면에 들어가는 문장은 짧고 즉시 이해되어야 합니다.
- 외부 영상·이미지를 요구하지 않습니다.
- 주제와 무관한 범용 테크 그래픽을 반복하지 않습니다. 환경은 유기적 생태 구조, AI는 연결·데이터 구조처럼 시각 문법 자체가 달라야 합니다.
- 한 영상 안에서 같은 visual과 layout 조합을 반복하지 않습니다.
- visualData가 실제 그래프·도표의 형태를 결정하므로 모든 씬에 의미 있는 값과 라벨을 제공합니다.
- 16:9, 1:1, 9:16은 같은 레이아웃을 크기만 바꾼 결과가 아니어야 합니다. 1:1은 상·하 정보 계층과 중앙 집중 구성을, 9:16은 세로 흐름과 짧은 카피를, 16:9는 가로 정보 흐름을 사용하세요.
- 제목은 두 줄 안에서 읽혀야 하며 도표·라벨과 겹치지 않아야 합니다. 긴 문장을 억지로 넣지 말고 핵심어 중심으로 축약하세요.
- 밝은 배경에는 어두운 전경색, 어두운 배경에는 밝은 전경색이 필요한 팔레트를 설계하고 장식보다 가독성을 우선하세요.
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
    let spec = normalizeSpec(parseJsonObject(rawSpec), input);
    if (sql) {
      const recent = await sql("SELECT metadata FROM company_work_items WHERE user_id = $1 AND work_type = 'infographic' ORDER BY created_at DESC LIMIT 8", [auth.userId]).catch(() => []);
      const signatures = new Set(recent.map((row: any) => visualSignature(row?.metadata?.spec)).filter(Boolean));
      spec = rotateDuplicateVisuals(spec, signatures);
    }

    const contributions = [
      { agentId: "plot", agentName: "플롯", emoji: "🎬", summary: summary(plotPlan) },
      { agentId: "ink", agentName: "잉크", emoji: "✍️", summary: summary(inkResult.text) },
      { agentId: "pixel", agentName: "픽셀", emoji: "🎨", summary: summary(pixelResult.text) },
      { agentId: "beat", agentName: "비트", emoji: "🎵", summary: summary(beatResult.text) },
      { agentId: "core", agentName: "코어", emoji: "🧭", summary: `${spec.scenes.length}개 씬, ${input.durationSec}초 ${input.aspectRatio} Remotion 명세로 통합하고 렌더 계약을 검증했습니다.` },
    ];

    // 결과물을 영상 파일이 아닌 '회사 업무' 단위로 등록한다. 이후 파일은 이 업무 ID 아래에 귀속된다.
    let work: any = null;
    if (sql) {
      const workTitle = cleanText(parseJsonObject(rawSpec)?.workTitle, spec.title || "인포그래픽 제작", 20);
      const rows = await sql(`
        INSERT INTO company_work_items
          (user_id, conversation_id, title, work_type, status, request_text, result_summary, metadata, completed_at)
        VALUES ($1, $2, $3, 'infographic', 'completed', $4, $5, $6::jsonb, now())
        RETURNING *
      `, [
        auth.userId,
        cleanText(body?.conversationId, "main", 120),
        workTitle,
        input.prompt,
        `${spec.scenes.length}개 씬 · ${input.durationSec}초 ${input.aspectRatio} Remotion 제작 명세`,
        JSON.stringify({ input, spec, contributions }),
      ]);
      work = rows[0] || null;
    }

    return send({ spec, contributions, work }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "Agent Video 제작에 실패했어요.") }, 500, origin);
  }
};
