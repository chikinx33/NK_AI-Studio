// prototype/functions/api/video/copy-to-project.ts
// POST /api/video/copy-to-project { objectName, projectId, ownerId? }
//
// 브랜드 선택 없이 만든 AI 영상은 어느 에피소드에도 속하지 않는 공용 보관함(ai-video-gen/videos/)에 저장돼
// 브랜드 스튜디오(에피소드별 "01 자산")에서 보이지 않았다(2026-09-29).
// 고른 에피소드의 AI 영상 폴더(ai-video-gen/projects<id>/videos/)로 GCS 안에서 복사한다(원본 유지·메타데이터 유지).
// 다운로드·업로드 없이 rewrite 한 번이라 큰 영상도 금방 끝난다.
import { authorizeRequest } from "../_shared/auth.js";
import { buildUserRoot, buildAiVideoGenProjectPrefix } from "../_shared/storage";
import { resolveProjectStorageOwner } from "../_shared/shares";
import { resolveGcsEnv, getGoogleAccessToken } from "../_shared/gcs.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});
const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body: any = await request.json().catch(() => ({}));
    const objectName = String(body?.objectName || "").trim();
    const projectId = String(body?.projectId || "").trim();
    if (!objectName || !projectId) return send({ error: "objectName and projectId are required" }, 400, origin);
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
    if (!/\.mp4$/i.test(objectName)) return send({ error: "mp4_only" }, 400, origin);

    const g = resolveGcsEnv(env);
    // 원본은 본인 저장소 안의 것만. 대상은 본인 에피소드, 또는 편집 권한으로 공유받은 에피소드.
    if (!objectName.startsWith(`${buildUserRoot(g.basePrefix, auth.userId)}/`)) {
      return send({ error: "objectName outside user scope" }, 403, origin);
    }
    let ownerId: string;
    try {
      ownerId = await resolveProjectStorageOwner(env, auth.userId, String(body?.ownerId || ""), projectId);
    } catch (e: any) {
      return send({ error: String(e?.message || "forbidden") }, 403, origin);
    }
    const destName = `${buildAiVideoGenProjectPrefix(g.basePrefix, ownerId, projectId)}/videos/${objectName.split("/").pop()}`;
    if (destName === objectName) return send({ ok: true, objectName: destName, unchanged: true }, 200, origin);

    const token = await getGoogleAccessToken({ clientEmail: g.clientEmail, privateKeyPem: g.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform" });
    const bucket = encodeURIComponent(g.bucket);
    const base = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(objectName)}/rewriteTo/b/${bucket}/o/${encodeURIComponent(destName)}`;
    // 같은 버킷·같은 클래스면 한 번에 끝난다. 아니면 rewriteToken 으로 몇 번 이어 간다(Worker 서브요청 한도 안에서).
    let rewriteToken = "";
    for (let i = 0; i < 8; i++) {
      const params = new URLSearchParams();
      if (rewriteToken) params.set("rewriteToken", rewriteToken);
      if (g.userProject) params.set("userProject", g.userProject);
      const qs = params.toString();
      const res = await fetch(`${base}${qs ? `?${qs}` : ""}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...(g.userProject ? { "X-Goog-User-Project": g.userProject } : {}) },
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { data = {}; }
      if (res.status === 404) return send({ error: "source_not_found" }, 404, origin);
      if (!res.ok) return send({ error: "copy_failed", status: res.status, detail: data?.error?.message || text.slice(0, 300) }, 500, origin);
      if (data?.done) return send({ ok: true, objectName: destName, ownerId, projectId }, 200, origin);
      rewriteToken = String(data?.rewriteToken || "");
      if (!rewriteToken) break;
    }
    return send({ error: "copy_incomplete" }, 500, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};
