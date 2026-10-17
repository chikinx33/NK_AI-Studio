/**
 * POST /api/project/final-upload
 *   { projectId, ownerId?, title?, story?, images?: string[], video?: { object, durationSec, still, aspectRatio } }
 * SNS 세팅의 '+'로 이미 완성한 스토리·이미지·영상을 등록한다. 파일은 먼저 /api/director/media-url 로 올려 둔다.
 * 지금 에피소드가 비어 있으면 거기에, 컷이 있거나 이미 확정된 에피소드면 새 에피소드를 만들어 넣는다(덮어쓰지 않는다).
 * 실제 기록은 /api/project/sequences op=finalUpload(_shared/final-upload.js)가 한다 — 디렉터 확정과 같은 잠금.
 * Response: { ok, projectId, created, title, finalUpload }
 */
import { authorizeRequest, sanitizeUserId } from "../_shared/auth.js";
import { AGENT_TOOLS, corsHeaders, send } from "../agent/_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const projectId = String(body?.projectId || "").trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
    const ownerId = sanitizeUserId(body?.ownerId || "");
    const shared = !!ownerId && ownerId !== auth.userId;

    const authHeader = String(request.headers.get("Authorization") || "");
    // 같은 사이트 API 를 사용자 권한 그대로 부른다(저장 규칙·세대 확인·공유 권한을 한 곳에서 지키게).
    const call = async (path: string, init?: { body?: any }) => {
      const res = await fetch(new URL(path, request.url).toString(), {
        method: init?.body !== undefined ? "POST" : "GET",
        headers: { Authorization: authHeader, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(String(data?.error || `${path} ${res.status}`));
        err.status = res.status;
        throw err;
      }
      return data;
    };

    const ownerQuery = shared ? `&ownerId=${encodeURIComponent(ownerId)}` : "";
    const got = await call(`/api/project/get?projectId=${encodeURIComponent(projectId)}${ownerQuery}`);
    const source = got?.data || got || {};
    const scenes = Array.isArray(source.scenes) ? source.scenes : [];
    const occupied = scenes.length > 0 || !!source?.payload?.directorConfirmed;
    const sourceTitle = String(source.title || source?.payload?.episodeTitle || "").trim();
    const title = String(body?.title || "").trim().slice(0, 120);

    let targetId = projectId;
    let created = false;
    let targetTitle = sourceTitle;
    if (occupied) {
      // 공유받은 프로젝트에는 새 에피소드를 만들지 않는다(에피소드 폴더는 소유자 것이다).
      if (shared) return send({ error: "final_upload_shared_episode_occupied" }, 409, origin);
      targetTitle = title || `${sourceTitle || "에피소드"} 완성본`;
      const ctx = { request, env, authHeader, userId: auth.userId };
      const made: any = await AGENT_TOOLS.project_add_episode.run({ parentProjectId: projectId, episodeTitle: targetTitle }, ctx as any);
      targetId = String(made?.projectId || "");
      if (!targetId) return send({ error: "final_upload_episode_create_failed" }, 500, origin);
      created = true;
    }

    const upload = {
      title: title || targetTitle,
      story: String(body?.story || ""),
      images: Array.isArray(body?.images) ? body.images : [],
      video: body?.video && typeof body.video === "object" ? body.video : null,
    };
    const saved = await call("/api/project/sequences", {
      body: { projectId: targetId, ...(shared && !created ? { ownerId } : {}), op: "finalUpload", upload },
    });
    return send({ ok: true, projectId: targetId, created, title: targetTitle, finalUpload: saved?.finalUpload || null }, 200, origin);
  } catch (e: any) {
    const msg = String(e?.message || e || "final_upload_failed");
    const status = Number(e?.status) >= 400 && Number(e?.status) < 500 ? Number(e.status) : 500;
    return send({ error: msg }, status, origin);
  }
};
