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
import { studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "./_shared/claude-auth.js";
import { authorizeRequest } from "./_shared/auth.js";

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

// v3.884: Pass 2 decomposer LLM 이 컷별로 visual 을 재서술하면서 @토큰을
// 일반 명사로 다시 풀어 쓰는 경향이 있어, 컷 단위로 enforce 를 한 번 더 적용.
// Pass 1 visual 의 @토큰을 displayName 으로 역추출해 매핑 구성 (@네모 → 네모).
const KOREAN_PARTICLES_GROUP_SHOTS = "(이가|이|가|을|를|은|는|와|과|의|에서|에게|에|께|도|만|부터|까지|으로|로)";
// LLM 이 캐릭터를 "파란 네모", "노란 동그라미" 처럼 색+이름 으로 재서술할 때
// 색상 접두사까지 함께 소비해 "@네모" 만 남기기 위한 패턴.
const KOREAN_COLOR_PREFIX_SHOTS = "(?:파란|노란|빨간|초록|하얀|흰|검은|보라|주황|분홍|하늘|갈색|금색|은색)\\s+";

/**
 * v3.1586: 등록 캐릭터에서 곧바로 토큰 맵을 만든다.
 *
 * 이전에는 부모 visual 안의 @토큰만 역추적했다. 그래서 Pass 1 결과에 @토큰이
 * 하나도 없는 씬은 맵이 비어 보정이 통째로 건너뛰어졌고, 그 씬만 "파란 네모" 로
 * 남아 이미지 생성에서 캐릭터 자산 매칭에 실패했다.
 * 등록 캐릭터는 확실히 아는 정보이므로 그걸 1차 출처로 쓴다.
 */
function buildTokenMapFromCharacters(characters) {
  const map = new Map();
  for (const c of Array.isArray(characters) ? characters : []) {
    const token = String(c?.token || "").trim();
    const name = String(c?.displayName || "").trim() || token.replace(/^@+/, "");
    if (!name) continue;
    map.set(name, token.startsWith("@") ? token : `@${name}`);
  }
  return map;
}

function buildDisplayNameToTokenMap(text) {
  const map = new Map();
  const re = /@([0-9A-Za-z가-힣_]{1,24})/g;
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const token = "@" + m[1];
    const name = m[1]; // displayName 추정 = 토큰의 @ 이후 부분
    if (name && !map.has(name)) map.set(name, token);
  }
  return map;
}

function enforceTokensInText(text, tokenMap) {
  if (!text || !tokenMap || tokenMap.size === 0) return { text, replacements: 0 };
  let result = String(text);
  let replacements = 0;
  for (const [name, token] of tokenMap) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let re;
    try {
      re = new RegExp(`(?<![@0-9A-Za-z가-힣_])(?:${KOREAN_COLOR_PREFIX_SHOTS})?${escaped}${KOREAN_PARTICLES_GROUP_SHOTS}?(?![가-힣_])`, "g");
    } catch (_) {
      re = new RegExp(`(?:${KOREAN_COLOR_PREFIX_SHOTS})?${escaped}${KOREAN_PARTICLES_GROUP_SHOTS}?`, "g");
    }
    const before = result;
    result = result.replace(re, (_match, particle) => `${token}${particle || ""}`);
    if (result !== before) replacements += 1;
  }
  return { text: result, replacements };
}

function flattenScenesWithShots(parentScenes, characters) {
  if (!Array.isArray(parentScenes)) return [];
  const flat = [];
  let nextId = 1;
  let totalTokensEnforced = 0;
  for (const parent of parentScenes) {
    if (!parent || typeof parent !== "object") continue;
    const shots = Array.isArray(parent.shots) ? parent.shots : [];
    const parentTokens = extractTokensFromText(parent.visual || parent.shot || "");
    // v3.883: parent visual 의 @토큰에서 displayName → token 매핑 도출
    // 등록 캐릭터가 1차 출처, 부모 visual 의 @토큰은 보조(등록 안 된 표기 대응).
    const tokenMap = new Map([
      ...buildTokenMapFromCharacters(characters),
      ...buildDisplayNameToTokenMap(parent.visual || parent.shot || ""),
    ]);
    if (!shots.length) {
      // shots 가 없으면 부모 씬을 그대로 single 로 (visual 만 있는 legacy fallback)
      flat.push({
        id: nextId++,
        title: parent.title || "",
        sceneLocation: parent.sceneLocation || parent.location || "",
        backgroundStyle: parent.backgroundStyle || "",
        narration: parent.narration || "",
        dialogue: parent.dialogue || parent.dialogues || [],
        // v3.1581: 노래 모드 가사. 빠뜨리면 컷 분해 후 가사가 통째로 사라진다.
        lyrics: parent.lyrics || "",
        isRefrain: !!parent.isRefrain,
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
      // v3.883: composition/action 에 displayName 단독 등장하면 @토큰으로 자동 치환
      const compRes = enforceTokensInText(String(sh.composition || "").trim(), tokenMap);
      const actRes = enforceTokensInText(String(sh.action || "").trim(), tokenMap);
      const composition = compRes.text;
      const action = actRes.text;
      totalTokensEnforced += (compRes.replacements + actRes.replacements);
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
        // v3.1581: 가사도 첫 컷에만. 컷마다 반복되면 같은 소절을 여러 번 부르게 된다.
        lyrics: isFirst ? (parent.lyrics || "") : "",
        isRefrain: isFirst ? !!parent.isRefrain : false,
        // v3.1584: 구간 식별자는 모든 컷이 들고 있어야 한다 — 가사가 실리지 않은 중간 컷도
        // 자기가 어느 소절 구간에 속하는지 알아야 자막 길이를 소절 단위로 계산할 수 있다.
        songSectionId: parent.songSectionId || "",
        songSectionLabel: parent.songSectionLabel || "",
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
        // 한 샷 안의 시간표. 스틸컷은 beats[0](첫 프레임)으로, 영상은 시간 분배로 쓴다.
        beats: Array.isArray(sh.beats) && sh.beats.length ? sh.beats : null,
        // 부모 추적용 (마이그레이션/디버깅)
        parentSceneId: parent.id != null ? parent.id : null,
        shotIndexInParent: j,
      });
    });
  }
  return { flat, tokensEnforcedShots: totalTokensEnforced };
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
  // v3.1586: 등록 캐릭터를 받아 @토큰 보정의 1차 출처로 쓴다.
  const characters = Array.isArray(body?.characters) ? body.characters : [];
  if (!scenes || !scenes.length) {
    return jsonError("scenes[] is required", 400, origin);
  }
  const lang = body?.language === "en" ? "en" : "ko";

  const who = await authorizeRequest(request, env);
  if (!who.ok) return jsonError(who.error, who.status, origin);

  let auth;
  try {
    auth = await studioAuth(env, who.userId);
  } catch (e) {
    if (isClaudeAuthRequired(e)) return jsonError(CLAUDE_AUTH_REQUIRED, 412, origin);
    throw e;
  }

  try {
    // 신체 스펙(appearance/negative)까지 분해 프롬프트로 넘긴다 —
    // 몸에 없는 부위로 하는 행동은 여기(글 쓰는 순간)서만 막을 수 있다.
    const result = await decomposeScenes(auth, scenes, { lang, env, characters });
    // decomposeScenes 의 정상 결과: { scenes, meta } 또는 array fallback
    const decomposed = Array.isArray(result) ? result : (Array.isArray(result?.scenes) ? result.scenes : []);
    const meta = (result && result.meta) ? result.meta : { total: decomposed.length, ok: 0, failed: 0, fallback: decomposed.length };
    // 평탄화: 각 shot 을 top-level scene 으로
    const { flat: flatScenes, tokensEnforcedShots } = flattenScenesWithShots(decomposed, characters);
    return new Response(JSON.stringify({
      scenes: flatScenes,
      meta: {
        ...meta,
        flattened: true,
        flatCount: flatScenes.length,
        // v3.883: Pass 2 컷 단위 @토큰 자동 보정 횟수
        tokensEnforcedShots,
      },
    }), {
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
