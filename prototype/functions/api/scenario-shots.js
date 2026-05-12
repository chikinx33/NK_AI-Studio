/**
 * /api/scenario-shots
 *
 * Pass 2 — 시나리오 씬 배열을 받아 각 씬을 콘티 단위 샷(shot) 으로 분해.
 *
 * 입력 (POST JSON):
 *   { scenes: Scene[], language?: "ko"|"en" }
 *
 * 출력 (200):
 *   { scenes: SceneWithShots[], meta: { ok, failed, fallback, total } }
 *
 * 실패 (4xx/5xx):
 *   { error: string }
 *
 * 안전 장치
 * - 모든 씬을 Promise.all 로 병렬 호출
 * - 단일 씬 실패는 fallbackSingleShot 으로 대체 (전체 요청 실패 X)
 * - CREDIT_EXHAUSTED 만 402 로 별도 처리
 */

import { decomposeScenes } from "./scenario/shots/index.js";

/**
 * 분해 결과를 평탄화. 부모 씬의 narration/dialogue 는 첫 sub-scene 에만 두고,
 * 나머지 sub-scenes 는 sceneLocation/backgroundStyle 만 상속한다 (영상 단위로 분리).
 *
 * sub-scene id 규칙:
 *   - 첫 번째: 부모 id 의 정수부 그대로 (예: parent id = 3 → 3)
 *   - 두 번째 이후: 새 정수 id 부여 (parent + 0.1, 0.2, ... 같은 식이 아니라
 *     호출자 측에서 시퀀스 재할당하기 좋게 그냥 ordinal)
 *
 * 호출자 (client / save) 가 다시 1..N 으로 재배열할 수 있도록 raw structure 를 유지.
 */
// 부모 visual 에서 @토큰을 추출. 컷 분해 결과(composition/action) 에
// 같은 토큰이 빠지면 캐릭터 일관성이 깨지므로, 평탄화 시 첫 컷에 prepend 해
// 다운스트림 이미지/영상 생성기가 캐릭터 시트를 주입할 수 있게 한다.
function extractTokensFromText(text) {
  const out = [];
  const re = /@[^\s"'`.,!?;:(){}\[\]<>]+/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const tok = m[0];
    if (tok && !out.includes(tok)) out.push(tok);
  }
  return out;
}

function flattenScenesWithShots(parentScenes) {
  if (!Array.isArray(parentScenes)) return [];
  const flat = [];
  let nextId = 1;
  for (const parent of parentScenes) {
    if (!parent || typeof parent !== "object") continue;
    const shots = Array.isArray(parent.shots) ? parent.shots : [];
    const parentTokens = extractTokensFromText(parent.visual || parent.shot || "");
    if (!shots.length) {
      // shots 가 없으면 부모 씬을 그대로 single 로 (visual 만 있는 legacy fallback)
      flat.push({
        id: nextId++,
        title: parent.title || "",
        sceneLocation: parent.sceneLocation || parent.location || "",
        backgroundStyle: parent.backgroundStyle || "",
        narration: parent.narration || "",
        dialogue: parent.dialogue || parent.dialogues || [],
        lines: parent.lines || "",
        subtitleText: parent.subtitleText || "",
        videoSpeechPrompt: parent.videoSpeechPrompt || "",
        script: parent.script || "",
        visual: parent.visual || parent.shot || "",
        shot: parent.visual || parent.shot || "",
        composition: "",
        action: "",
        shotType: "MS",
        cameraMove: "static",
        estSec: Number(parent.estSec) || 0,
      });
      continue;
    }
    shots.forEach((sh, j) => {
      if (!sh || typeof sh !== "object") return;
      const isFirst = j === 0;
      const composition = String(sh.composition || "").trim();
      const action = String(sh.action || "").trim();
      // 합성 visual: "[shotType] composition / action" — UI 가 visual 만 봐도 의미 전달
      const visualParts = [];
      if (composition) visualParts.push(composition);
      if (action) visualParts.push(action);
      let visual = visualParts.join(" / ").trim() || (parent.visual || parent.shot || "");
      // 캐릭터 일관성 안전망: 부모 visual 에는 @토큰이 있었는데 컷 합성 visual 에
      // 하나도 남아있지 않으면 첫 토큰을 prepend (다운스트림 캐릭터 시트 주입용).
      if (parentTokens.length) {
        const hasAny = parentTokens.some((tok) => visual.includes(tok));
        if (!hasAny) visual = parentTokens[0] + " — " + visual;
      }
      flat.push({
        id: nextId++,
        title: parent.title || "",
        sceneLocation: parent.sceneLocation || parent.location || "",
        backgroundStyle: parent.backgroundStyle || "",
        // 첫 번째 sub-scene 만 부모의 narration/dialogue 를 가져감
        narration: isFirst ? (parent.narration || "") : "",
        dialogue: isFirst ? (parent.dialogue || parent.dialogues || []) : [],
        lines: isFirst ? (parent.lines || "") : "",
        subtitleText: isFirst ? (parent.subtitleText || "") : "",
        videoSpeechPrompt: isFirst ? (parent.videoSpeechPrompt || "") : "",
        script: isFirst ? (parent.script || "") : "",
        visual,
        shot: visual,
        composition,
        action,
        shotType: String(sh.shotType || "MS"),
        cameraMove: String(sh.cameraMove || "static"),
        estSec: Math.max(1, Math.round(Number(sh.duration) || 0)),
        // 부모 추적용 (마이그레이션/디버깅)
        parentSceneId: parent.id != null ? parent.id : null,
        shotIndexInParent: j,
      });
    });
  }
  return flat;
}

const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: corsHeaders(origin),
  });
}

export async function onRequestOptions(context) {
  const origin = context.request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonError("Invalid JSON body", 400, origin);
  }

  const scenes = Array.isArray(body?.scenes) ? body.scenes : null;
  if (!scenes || !scenes.length) {
    return jsonError("scenes[] is required", 400, origin);
  }
  const lang = body?.language === "en" ? "en" : "ko";

  if (!env?.ANTHROPIC_API_KEY) {
    return jsonError("ANTHROPIC_API_KEY missing", 500, origin);
  }

  try {
    const result = await decomposeScenes(env.ANTHROPIC_API_KEY, scenes, { lang });
    // decomposeScenes 의 정상 결과: { scenes, meta } 또는 array fallback
    const decomposed = Array.isArray(result) ? result : (Array.isArray(result?.scenes) ? result.scenes : []);
    const meta = (result && result.meta) ? result.meta : { total: decomposed.length, ok: 0, failed: 0, fallback: decomposed.length };
    // 평탄화: 각 shot 을 top-level scene 으로
    const flatScenes = flattenScenesWithShots(decomposed);
    return new Response(JSON.stringify({ scenes: flatScenes, meta: { ...meta, flattened: true, flatCount: flatScenes.length } }), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    if (err && err.code === "CREDIT_EXHAUSTED") {
      return jsonError("CREDIT_EXHAUSTED", 402, origin);
    }
    return jsonError(err?.message || "shot_decomposition_failed", 500, origin);
  }
}
