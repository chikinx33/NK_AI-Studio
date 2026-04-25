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
    // decomposeScenes 의 정상 결과는 { scenes, meta } 형태 (input 길이≥1 일 때)
    if (Array.isArray(result)) {
      return new Response(JSON.stringify({ scenes: result, meta: { total: result.length, ok: 0, failed: 0, fallback: result.length } }), {
        status: 200,
        headers: corsHeaders(origin),
      });
    }
    return new Response(JSON.stringify(result), {
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
