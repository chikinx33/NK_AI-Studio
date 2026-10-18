// POST /api/video/describe { objectName } — 저장소 영상 한 편의 내용을 Gemini 로 분석한다(_shared/gemini-video.ts).
// 에이전트 video_describe·content_register 가 부른다. 같은 파일(같은 세대)은 한 번만 분석하고 결과를 저장해 둔다.
// 분석은 이 요청 안에서 끝나므로(서브요청 따로) 부르는 도구는 1번만 쓴다.
// 회원 계정은 Atlas 외 공급자를 부르지 않는 원칙(imagen-describe 와 같음) — 마스터 자원 계정만 연다.
import { authorizeRequest } from "../_shared/auth.js";
import { usesMasterResources } from "../_shared/admin-users";
import { readGcsJson, writeGcsJson, resolveGcsEnv } from "../_shared/gcs.js";
import { buildUserRoot } from "../_shared/storage";
import { statGcsObject } from "../_shared/media-ingest";
import { analyzeGcsVideo, MAX_ANALYZE_BYTES } from "../_shared/gemini-video";

const send = (data: any, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  if (!(await usesMasterResources(env, auth.userId))) {
    return send({ error: "video_analysis_master_only", message: "영상 분석은 마스터(또는 마스터 자원 사용) 계정에서만 쓸 수 있어요." }, 403);
  }
  const body: any = await request.json().catch(() => ({}));
  const { bucket, basePrefix } = resolveGcsEnv(env);
  const objectName = String(body?.objectName || "").trim().replace(new RegExp(`^gs://${bucket}/`), "").replace(/^\/+/, "");
  const userRoot = `${buildUserRoot(basePrefix, auth.userId)}/`;
  if (!objectName || objectName.includes("..") || !objectName.startsWith(userRoot)) return send({ error: "video_analysis_path_forbidden" }, 400);
  try {
    const stat = await statGcsObject(env, objectName);
    if (!stat) return send({ error: "video_not_found" }, 404);
    if (stat.size > MAX_ANALYZE_BYTES) return send({ error: "video_analysis_too_large", message: "100MB 를 넘는 영상은 분석할 수 없어요." }, 413);
    const cacheObject = `${userRoot}ai-video/.video-analysis/${await sha256(`${objectName}:${stat.generation}`)}.json`;
    if (body?.refresh !== true) {
      const cached = await readGcsJson(env, cacheObject).catch(() => null);
      if (cached?.found && cached.data?.analysis) return send({ ok: true, cached: true, analysis: cached.data.analysis });
    }
    const analysis = await analyzeGcsVideo(env, objectName, stat.size, stat.contentType);
    await writeGcsJson(env, cacheObject, { objectName, generation: stat.generation, analyzedAt: new Date().toISOString(), analysis }).catch(() => {});
    return send({ ok: true, cached: false, analysis });
  } catch (e: any) {
    const msg = String(e?.message || e);
    // 코드만 보내면(예: video_analysis_upload_start_failed) 상태·구글 메시지가 사라져 원인을 알 수 없었다 — 전문을 보낸다.
    return send({ error: msg.slice(0, 400) || "video_analysis_failed", code: msg.split(" ")[0] || "video_analysis_failed" }, 500);
  }
};
