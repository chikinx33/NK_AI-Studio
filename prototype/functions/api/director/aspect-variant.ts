/**
 * POST /api/director/aspect-variant  { projectId, aspectRatio: "9:16" | "16:9" | "1:1" }
 * 디렉터 결과물의 다른 비율판을 새 에피소드 프로젝트로 만든다(예: 16:9 확정본 → 9:16 세로판).
 * 원본은 건드리지 않는다. 새 프로젝트에는 개요·디렉터 시퀀스(컷·참조·프롬프트)·프로젝트 기억을 옮기고,
 * 원본 스틸·완성 영상은 참조로 넘겨 그 비율로 다시 만들게 한다(_shared/director-aspect-variant.js).
 * Response: { ok, projectId, title }
 */
import { authorizeRequest } from "../_shared/auth.js";
import { AGENT_TOOLS, corsHeaders, send } from "../agent/_shared";
import { buildAspectVariant } from "../_shared/director-aspect-variant.js";

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
    const aspectRatio = String(body?.aspectRatio || "").trim();

    const authHeader = String(request.headers.get("Authorization") || "");
    // 같은 사이트 API 를 사용자 권한 그대로 부른다(저장 규칙·세대 확인을 한 곳에서 지키게).
    const call = async (path: string, init?: { body?: any }) => {
      const res = await fetch(new URL(path, request.url).toString(), {
        method: init?.body !== undefined ? "POST" : "GET",
        headers: { Authorization: authHeader, ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || `${path} ${res.status}`));
      return data;
    };

    // 원본: 본인 프로젝트만(공유받은 프로젝트의 비율판은 소유자가 만든다).
    const got = await call(`/api/project/get?projectId=${encodeURIComponent(projectId)}`);
    const source = got?.data || got || {};
    const director = await call(`/api/project/sequences?projectId=${encodeURIComponent(projectId)}`);
    let plan;
    try {
      plan = buildAspectVariant(source, director, { aspectRatio, sourceProjectId: projectId });
    } catch (e: any) {
      return send({ error: String(e?.message || e) }, 400, origin);
    }

    // 새 에피소드: 시리즈·브랜드 맥락 상속과 폴더 이름(슬러그) 규칙은 에피소드 만들기 도구가 맡는다.
    const ctx = { request, env, authHeader, userId: auth.userId };
    const made: any = await AGENT_TOOLS.project_add_episode.run({ parentProjectId: projectId, episodeTitle: plan.title }, ctx as any);
    const newId = String(made?.projectId || "");
    if (!newId) return send({ error: "variant_create_failed" }, 500, origin);

    await call("/api/project/save", { body: { projectId: newId, title: plan.title, aspectRatio, payload: plan.payloadPatch } });
    for (const seq of plan.sequences) {
      await call("/api/project/sequences", { body: { projectId: newId, op: "upsert", sequence: seq } });
    }
    await call("/api/project/sequences", { body: { projectId: newId, op: "notes", notes: plan.notes } });

    return send({ ok: true, projectId: newId, title: plan.title, sequences: plan.sequences.length }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "aspect_variant_failed") }, 500, origin);
  }
};
