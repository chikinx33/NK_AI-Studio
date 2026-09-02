// prototype/functions/api/video/lipsync.ts
// Kling 립싱크 작업 생성 엔드포인트.
// 입력:
//   - videoId  : 선행 Kling image2video task_id (kling: 접두 제거 후 전달)
//   - OR videoUrl : 외부에서 접근 가능한 mp4 URL
//   - mode = "text2video" 인 경우 text + voiceId + voiceLanguage
//   - mode = "audio2video" 인 경우 audioUrl 또는 audioDataUrl
// 반환: { job_id: "kling-lipsync:<task_id>" }
// 폴링은 기존 /api/video/status 엔드포인트 재사용 (kling-lipsync: 접두).

import { authorizeRequest } from "../_shared/auth.js";
import { callKlingApi, klingEndpoints, stripDataUrlPrefix } from "../_shared/kling";
import { withCreditCharge } from "../_shared/credits";

(globalThis as any).g = globalThis;
type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const log = (...args: any[]) => console.log("[video-lipsync]", ...args);

const handlePost: PagesFunction = async ({ request, env }) => {
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status);

    const body = await request.json().catch(() => ({} as any));
    const {
      mode = "text2video",
      videoId = "",
      videoUrl = "",
      text = "",
      voiceId = "",
      voiceLanguage = "en",
      voiceSpeed = 1.0,
      audioUrl = "",
      audioDataUrl = "",
    } = body || {};

    if (!videoId && !videoUrl) {
      return json({ error: "videoId or videoUrl required" }, 400);
    }
    if (mode !== "text2video" && mode !== "audio2video") {
      return json({ error: "unsupported_mode", detail: mode }, 400);
    }

    const input: any = {
      mode,
      video_id: videoId ? videoId.replace(/^kling:/, "").replace(/^kling-multi:/, "") : undefined,
      video_url: videoUrl || undefined,
    };
    if (mode === "text2video") {
      if (!text) return json({ error: "text required for text2video" }, 400);
      input.text = String(text).slice(0, 120);
      input.voice_id = String(voiceId || "");
      input.voice_language = String(voiceLanguage || "en");
      input.voice_speed = Number(voiceSpeed || 1.0);
    } else {
      if (audioDataUrl) {
        input.audio_type = "file";
        input.audio_file = stripDataUrlPrefix(String(audioDataUrl));
      } else if (audioUrl) {
        input.audio_type = "url";
        input.audio_url = String(audioUrl);
      } else {
        return json({ error: "audio required for audio2video" }, 400);
      }
    }

    const eps = klingEndpoints(env);
    log("request", { mode, hasVideoId: !!videoId, hasVideoUrl: !!videoUrl });

    const res = await callKlingApi(env, eps.lipSync, {
      method: "POST",
      body: JSON.stringify({ input }),
    });
    const txt = await res.text();
    const jsonBody = safeJson(txt);
    if (!res.ok) {
      return json({ error: "kling_http_error", status: res.status, detail: jsonBody }, res.status);
    }
    const code = Number(jsonBody?.code);
    if (code !== 0) {
      return json({ error: "kling_api_error", code, detail: jsonBody }, 502);
    }
    const taskId = String(jsonBody?.data?.task_id || jsonBody?.task_id || "");
    if (!taskId) return json({ error: "kling_no_task_id", raw: jsonBody }, 500);

    return json({ job_id: `kling-lipsync:${taskId}` });
  } catch (e: any) {
    log("catch", e?.message, e?.stack);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
};

export const onRequestPost: PagesFunction = async (context) =>
  withCreditCharge(context, { feature: "video_lipsync", deferAccepted: true }, handlePost);

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
