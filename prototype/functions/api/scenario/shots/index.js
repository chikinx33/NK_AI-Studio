/**
 * scenario/shots/index.js
 *
 * Pass 2 의 공개 API.
 *
 *   decomposeScene(apiKey, scene, opts)   — 단일 씬 분해
 *   decomposeScenes(apiKey, scenes, opts) — 모든 씬을 병렬 분해 (장애 시 fallback)
 */

import {
  buildShotPromptKo,
  buildShotPromptEn,
  buildShotUserPromptKo,
  buildShotUserPromptEn,
  parseShotResponse,
  reconcileDurations,
  fallbackSingleShot,
} from "./decomposer.js";
import { diversifyShotCameraMoves } from "../rebalancer.js";
import { isCreditExhausted } from "../../_shared/credit-exhausted.js";

const SHOT_TIMEOUT_MS = 22000;
const SHOT_MAX_TOKENS = 900;
const MODEL = "claude-sonnet-4-6";

async function callAnthropicForShots({ apiKey, system, user, signal, url }) {
  const controller = new AbortController();
  if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason));
  const timer = setTimeout(() => controller.abort("shot_decompose_timeout"), SHOT_TIMEOUT_MS);
  try {
    const res = await fetch(url || "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: SHOT_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: user }],
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
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
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 단일 scene 의 shot 분해. 실패하면 throw.
 */
export async function decomposeScene(apiKey, scene, opts = {}) {
  const lang = opts.lang === "en" ? "en" : "ko";
  const system = lang === "en" ? buildShotPromptEn() : buildShotPromptKo();
  const user = lang === "en" ? buildShotUserPromptEn(scene) : buildShotUserPromptKo(scene);
  const text = await callAnthropicForShots({
    apiKey,
    system,
    user,
    signal: opts.signal,
    url: opts.messagesUrl,
  });
  const shots = parseShotResponse(text, scene);
  if (!shots || !shots.length) throw new Error("shot_parse_failed");
  return reconcileDurations(shots, scene);
}

/**
 * scenes 배열을 병렬로 분해. 장애 단위는 scene 단위.
 * 실패 scene 은 fallbackSingleShot 으로 대체.
 *
 * 반환: 같은 scenes 배열에 shots 필드가 채워진 새 배열.
 */
export async function decomposeScenes(apiKey, scenes, opts = {}) {
  if (!Array.isArray(scenes) || !scenes.length) return scenes;
  if (!apiKey) {
    return scenes.map((s) => ({ ...s, shots: fallbackSingleShot(s), shotsFallback: "no_api_key" }));
  }

  const meta = { failed: 0, fallback: 0, ok: 0, total: scenes.length };

  const tasks = scenes.map(async (scene, idx) => {
    try {
      const shots = await decomposeScene(apiKey, scene, opts);
      meta.ok++;
      return { ...scene, shots };
    } catch (err) {
      if (err && err.code === "CREDIT_EXHAUSTED") throw err; // 위로 재던짐
      meta.failed++;
      meta.fallback++;
      return {
        ...scene,
        shots: fallbackSingleShot(scene),
        shotsFallback: String(err?.message || "decompose_failed"),
      };
    }
  });

  const raw = await Promise.all(tasks);
  // P2-3-5: 인접 동일 cameraMove 자동 치환 — LLM이 동일 무브를 반복해도 코드로 다양화 보장
  const diversified = diversifyShotCameraMoves(raw);
  meta.cameraSwaps = diversified.swaps;
  return { scenes: diversified.scenes, meta };
}

export {
  buildShotPromptKo,
  buildShotPromptEn,
  buildShotUserPromptKo,
  buildShotUserPromptEn,
  parseShotResponse,
  reconcileDurations,
  fallbackSingleShot,
};
