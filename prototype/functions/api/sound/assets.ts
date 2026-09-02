/**
 * GET /api/sound/assets — 생성된 오디오 자산 목록.
 *   query: scope, brand_id, episode_id, session_id, type
 *   프로젝트 모드면 brand/episode, 인스턴스 모드면 session_id 로 필터.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { corsHeaders, send, getSql, ensureSoundSchema } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

function mapAsset(r: any) {
  return {
    id: String(r.id),
    type: r.type,
    scope: r.scope,
    brandId: r.brand_id || null,
    episodeId: r.episode_id || null,
    sessionId: r.session_id || null,
    title: r.title || "",
    prompt: r.prompt || "",
    textContent: r.text_content || "",
    segments: r.segments || null,
    voiceId: r.voice_id || null,
    provider: r.provider || "",
    model: r.model || "",
    params: r.params || null,
    outputUrl: r.output_url || "",
    outputFormat: r.output_format || "mp3_44100_128",
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
    creditsUsed: r.credits_used != null ? Number(r.credits_used) : null,
    status: r.status || "ready",
    createdAt: r.created_at,
  };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const url = new URL(request.url);
    const scope = String(url.searchParams.get("scope") || "").trim();
    const brandId = String(url.searchParams.get("brand_id") || url.searchParams.get("brandId") || "").trim();
    const episodeId = String(url.searchParams.get("episode_id") || url.searchParams.get("episodeId") || "").trim();
    const sessionId = String(url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim();

    const sql = getSql(env);
    if (!sql) return send({ assets: [], fallback: true }, 200, origin);
    await ensureSoundSchema(sql);

    const where: string[] = [];
    const params: any[] = [];
    params.push(auth.userId);
    const ownerParam = params.length;
    params.push(`%/users/${auth.userId}/%`);
    const legacyPathParam = params.length;
    params.push(`%2Fusers%2F${auth.userId}%2F`);
    const legacyEncodedPathParam = params.length;
    where.push(`(
      owner_id = $${ownerParam}
      OR (
        owner_id IS NULL
        AND (
          COALESCE(params->>'objectName', '') LIKE $${legacyPathParam}
          OR COALESCE(output_url, '') LIKE $${legacyPathParam}
          OR COALESCE(output_url, '') LIKE $${legacyEncodedPathParam}
        )
      )
    )`);
    if (scope) { params.push(scope); where.push(`scope = $${params.length}`); }
    if (type) { params.push(type); where.push(`type = $${params.length}`); }
    if (scope === "project") {
      if (episodeId) { params.push(episodeId); where.push(`episode_id = $${params.length}`); }
      else if (brandId) { params.push(brandId); where.push(`brand_id = $${params.length}`); }
    } else if (scope === "instance" && sessionId) {
      params.push(sessionId); where.push(`session_id = $${params.length}`);
    }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = await sql(`SELECT * FROM sound_assets ${whereSql} ORDER BY created_at DESC LIMIT 100`, params);
    return send({ assets: rows.map(mapAsset) }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "assets_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
