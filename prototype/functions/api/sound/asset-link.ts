/**
 * POST /api/sound/asset-link { assetId, brandId, episodeId }
 * 단독 모드로 만든 사운드 자산을 브랜드·에피소드에 보관한다.
 *
 * 오디오 스튜디오의 사이드바(VOICE·MUSIC·SFX)는 단독 모드로 열려, 거기서 만든 음악은 어느 브랜드에도 속하지 않았다(2026-09-29).
 * 파일은 그대로 두고 그 에피소드 범위(scope='project')의 자산 행을 하나 더 만든다 — 원본(단독) 행은 그대로 남는다.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { sanitizeUserId } from "../_shared/storage";
import { corsHeaders, send, getSql, ensureSoundSchema } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const assetId = String(body?.assetId || "").trim();
    const brandId = String(body?.brandId || "").trim();
    const episodeId = String(body?.episodeId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(assetId)) return send({ error: "invalid_asset_id" }, 400, origin);
    if (!episodeId) return send({ error: "episodeId required" }, 400, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL not configured" }, 500, origin);
    await ensureSoundSchema(sql);
    const userId = sanitizeUserId(auth.userId);
    // 본인 자산만. 같은 에피소드에 이미 보관했으면 그 행을 그대로 돌려준다(두 번 눌러도 한 번만).
    const rows = await sql(
      `WITH src AS (
         SELECT * FROM sound_assets WHERE id = $1 AND owner_id = $2
       ), existing AS (
         SELECT a.id FROM sound_assets a, src
          WHERE a.owner_id = $2 AND a.scope = 'project' AND a.episode_id = $4
            AND COALESCE(a.params->>'objectName', a.output_url) = COALESCE(src.params->>'objectName', src.output_url)
          LIMIT 1
       ), ins AS (
         INSERT INTO sound_assets
           (owner_id, type, scope, brand_id, episode_id, session_id, title, prompt, text_content, segments, voice_id,
            provider, model, params, output_url, output_format, duration_seconds, credits_used, status)
         SELECT owner_id, type, 'project', NULLIF($3, ''), $4, NULL, title, prompt, text_content, segments, voice_id,
                provider, model, params, output_url, output_format, duration_seconds, 0, status
           FROM src WHERE NOT EXISTS (SELECT 1 FROM existing)
         RETURNING id
       )
       SELECT (SELECT id FROM ins) AS inserted_id, (SELECT id FROM existing) AS existing_id, (SELECT id FROM src) AS src_id`,
      [assetId, userId, brandId, episodeId]
    );
    const r = rows && rows[0];
    if (!r || !r.src_id) return send({ error: "asset_not_found" }, 404, origin);
    return send({ ok: true, assetId: String(r.inserted_id || r.existing_id), alreadyLinked: !r.inserted_id }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "asset_link_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
