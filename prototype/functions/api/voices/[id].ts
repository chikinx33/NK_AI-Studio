/**
 * PATCH /api/voices/:id — 태그·설명·즐겨찾기 등 수정
 *   body: { description?, styleTags?, name?, gender?, providerVoiceId?, favorite? }
 *   favorite 토글은 voice_favorites 테이블(사용자별)에 반영한다.
 */
import { authorizeRequest } from "../_shared/auth.js";
import { sanitizeUserId } from "../_shared/storage";
import { corsHeaders, send, getSql, ensureSoundSchema } from "../sound/_shared";

type PagesFunction = (ctx: { request: Request; env: any; params: any }) => Promise<Response>;

export const onRequestPatch: PagesFunction = async ({ request, env, params }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL not configured" }, 500, origin);
    await ensureSoundSchema(sql);

    const id = String(params && params.id || "").trim();
    if (!id) return send({ error: "voice id required" }, 400, origin);
    const ownerId = sanitizeUserId(auth.userId);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    // 즐겨찾기 토글
    if (typeof body.favorite === "boolean") {
      if (body.favorite) {
        await sql(
          `INSERT INTO voice_favorites (voice_id, owner_id) VALUES ($1::uuid, $2)
           ON CONFLICT (voice_id, owner_id) DO NOTHING`,
          [id, ownerId]
        );
      } else {
        await sql(`DELETE FROM voice_favorites WHERE voice_id = $1::uuid AND owner_id = $2`, [id, ownerId]);
      }
    }

    // 메타 수정
    const sets: string[] = [];
    const vals: any[] = [];
    const addSet = (col: string, val: any) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (typeof body.description === "string") addSet("description", body.description.trim());
    if (Array.isArray(body.styleTags)) {
      vals.push(body.styleTags.map((t: any) => String(t)).slice(0, 12).join(","));
      sets.push(`style_tags = string_to_array($${vals.length}, ',')`);
    }
    if (typeof body.name === "string" && body.name.trim()) addSet("name", body.name.trim());
    if (["male", "female", "neutral"].includes(String(body.gender))) addSet("gender", body.gender);
    if (typeof body.providerVoiceId === "string") addSet("provider_voice_id", body.providerVoiceId.trim());

    if (sets.length) {
      sets.push("updated_at = now()");
      vals.push(id);
      await sql(`UPDATE voices SET ${sets.join(", ")} WHERE id = $${vals.length}::uuid`, vals);
    }

    return send({ ok: true, id }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "voice_patch_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
