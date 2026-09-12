/**
 * scenario/shots/index.js
 *
 * Pass 2 의 공개 API.
 *
 *   decomposeScene(auth, scene, opts)   — 단일 씬 분해
 *   decomposeScenes(auth, scenes, opts) — 모든 씬을 병렬 분해 (장애 시 fallback)
 *   auth 는 claude-auth.js 의 studioAuth() 결과 {headers, subscription}
 */

import {
  buildShotPromptKo,
  buildShotPromptEn,
  buildShotUserPromptKo,
  buildShotUserPromptEn,
  parseShotResponse,
  reconcileDurations,
  fallbackSingleShot,
  shotsMissingBeats,
  buildBeatsRepairPrompt,
} from "./decomposer.js";
import { diversifyShotCameraMoves, enforceSequenceContinuity } from "../rebalancer.js";
import { isCreditExhausted } from "../../_shared/credit-exhausted.js";
import { buildClaudeSystem, claudeFetch } from "../../_shared/claude-auth.js";

// 900 토큰은 한국어로 beats+blocking 을 3~4샷 쓰기에 모자라 응답이 잘렸고, 잘리면 씬 전체가 폴백됐다.
// (2026-09-12 생성 결과에서 5씬 중 2씬이 폴백) 상한을 올리고, 잘려도 완성된 샷은 건진다(salvage).
const SHOT_TIMEOUT_MS = 25000;
const SHOT_MAX_TOKENS = 1600;
const MODEL = "claude-sonnet-4-6";
let lastStopReason = "";

async function callAnthropicForShots({ auth, env, system, user, signal }) {
  const controller = new AbortController();
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason));
  const timer = setTimeout(() => controller.abort("shot_decompose_timeout"), SHOT_TIMEOUT_MS);
  try {
    const res = await claudeFetch(env, auth, (sub) => ({
      model: MODEL,
      max_tokens: SHOT_MAX_TOKENS,
      system: buildClaudeSystem(sub, system),
      messages: [{ role: "user", content: user }],
      temperature: 0.4,
    }), { signal: controller.signal });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (isCreditExhausted(errText, res.status)) {
        const e = new Error("CREDIT_EXHAUSTED");
        e.code = "CREDIT_EXHAUSTED";
        throw e;
      }
      throw new Error(`Anthropic error: ${res.status} ${errText}`);
    }
    const data = await res.json();
    const text = (data?.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text || "")
      .join("");
    // 잘림 진단: 파싱 실패 사유에 stop_reason 을 실어 폴백 원인을 화면까지 보낸다.
    lastStopReason = String(data?.stop_reason || "");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 단일 scene 의 shot 분해. 실패하면 throw.
 */
export async function decomposeScene(auth, scene, opts = {}) {
  const lang = opts.lang === "en" ? "en" : "ko";
  const system = lang === "en" ? buildShotPromptEn() : buildShotPromptKo();
  const user = lang === "en" ? buildShotUserPromptEn(scene, opts) : buildShotUserPromptKo(scene, opts);
  const text = await callAnthropicForShots({
    auth,
    env: opts.env,
    system,
    user,
    signal: opts.signal,
  });
  let shots = parseShotResponse(text, scene);
  if (!shots || !shots.length) throw new Error("shot_parse_failed" + (lastStopReason ? "(stop=" + lastStopReason + ")" : ""));

  // 카메라가 움직이는 샷에 시간표가 빠졌으면 그 샷만 짚어 한 번 더 요청한다.
  // 프롬프트 규칙만으로는 모델이 자주 빼먹는데, 빠지면 스틸컷이 무브의 끝 상태로
  // 만들어져 "가려졌다가 드러나는" 연출이 통째로 사라진다. 재시도는 1회로 묶어
  // 비용·지연을 제한하고, 고쳐지지 않으면 원래 결과를 그대로 쓴다.
  const missing = shotsMissingBeats(shots);
  if (missing.length) {
    try {
      const repairText = await callAnthropicForShots({
        auth,
        env: opts.env,
        system,
        user: `${user}\n\n${buildBeatsRepairPrompt(missing, lang)}`,
        signal: opts.signal,
      });
      const repaired = parseShotResponse(repairText, scene);
      if (repaired && repaired.length && shotsMissingBeats(repaired).length < missing.length) {
        shots = repaired;
      }
    } catch (_) { /* 보정 실패는 조용히 넘긴다 — 원래 분해 결과는 이미 쓸 수 있다 */ }
  }

  return reconcileDurations(shots, scene);
}

/**
 * scenes 배열을 병렬로 분해. 장애 단위는 scene 단위.
 * 실패 scene 은 fallbackSingleShot 으로 대체.
 *
 * 반환: 같은 scenes 배열에 shots 필드가 채워진 새 배열.
 */
export async function decomposeScenes(auth, scenes, opts = {}) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes;
  if (!auth || !auth.headers) {
    return scenes.map((s) => ({ ...s, shots: fallbackSingleShot(s), shotsFallback: "no_api_key" }));
  }

  const meta = { failed: 0, fallback: 0, ok: 0, total: scenes.length, fallbackReasons: [] };

  const tasks = scenes.map(async (scene, idx) => {
    try {
      // 시퀀스 문맥: 앞·뒤 씬을 알려 줘야 "앞 씬과 같은 세트에서 이어지는가", "첫 샷을 어떻게
      // 열어야 앞 씬과 안 겹치는가"를 모델이 판단할 수 있다. 병렬 호출이라 앞 씬의 샷 결과는
      // 못 주지만, 씬 텍스트만으로도 세트 연속·인물 위치 유지 판단은 가능하다.
      const sceneOpts = {
        ...opts,
        prevScene: idx > 0 ? scenes[idx - 1] : null,
        nextScene: idx < scenes.length - 1 ? scenes[idx + 1] : null,
        sceneIndex: idx,
        sceneTotal: scenes.length,
      };
      const shots = await decomposeScene(auth, scene, sceneOpts);
      meta.ok++;
      return { ...scene, shots };
    } catch (err) {
      if (err && err.code === "CREDIT_EXHAUSTED") throw err; // 위로 재던짐
      meta.failed++;
      meta.fallback++;
      const reason = String(err?.message || "decompose_failed");
      meta.fallbackReasons.push({ sceneId: scene?.id ?? idx + 1, reason });
      return {
        ...scene,
        shots: fallbackSingleShot(scene),
        shotsFallback: reason,
      };
    }
  });

  const raw = await Promise.all(tasks);
  // P2-3-5: 인접 동일 cameraMove 자동 치환 — LLM이 동일 무브를 반복해도 코드로 다양화 보장
  const diversified = diversifyShotCameraMoves(raw);
  meta.cameraSwaps = diversified.swaps;
  // 시퀀스 검증기(씬 경계 포함): 인접 컷 동일 사이즈+방위 금지, 같은 세트 안 인물 위치 고정.
  // 씬별 병렬 호출은 서로를 모르므로 여기서 한 줄로 이어 보고 코드로 바로잡는다.
  const sequenced = enforceSequenceContinuity(diversified.scenes);
  meta.shotTypeSwaps = sequenced.shotSwaps;
  meta.blockingAnchors = sequenced.blockingAnchors;
  return { scenes: sequenced.scenes, meta };
}

export {
  buildShotPromptKo,
  buildShotPromptEn,
  buildShotUserPromptKo,
  buildShotUserPromptEn,
  parseShotResponse,
  reconcileDurations,
  fallbackSingleShot,
  shotsMissingBeats,
  buildBeatsRepairPrompt,
};
