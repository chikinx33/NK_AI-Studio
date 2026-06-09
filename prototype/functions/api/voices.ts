/**
 * /api/voices
 *   GET  — 보이스 목록. query: scope, brand_id, gender, q(검색)
 *   POST — 브랜드 캐릭터 보이스 / 내 보이스 등록
 *
 * 전역 공용 보이스는 voices 테이블이 비어 있으면 시드 데이터를 1회 삽입한다.
 */
import { authorizeRequest } from "./_shared/auth.js";
import { sanitizeUserId } from "./_shared/storage";
import { corsHeaders, send, getSql, ensureSoundSchema, seedGlobalVoicesIfEmpty, SEED_VOICES, parsePgTextArray } from "./sound/_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

function mapVoiceRow(r: any, favSet: Set<string>) {
  return {
    id: String(r.id),
    scope: r.scope,
    brandId: r.brand_id || null,
    ownerId: r.owner_id || null,
    name: r.name,
    gender: r.gender || "neutral",
    language: r.language || "ko",
    description: r.description || "",
    styleTags: parsePgTextArray(r.style_tags),
    provider: r.provider || "elevenlabs",
    providerVoiceId: r.provider_voice_id || "",
    previewUrl: r.preview_url || "",
    r2vReferenceStatus: r.r2v_reference_status || "none",
    favorite: favSet.has(String(r.id)),
  };
}

// DB 미구성(폴백) 시 시드 보이스를 그대로 반환 — UI가 항상 동작하도록.
function fallbackVoices() {
  return SEED_VOICES.map((v, i) => ({
    id: "seed-" + i,
    scope: "global",
    brandId: null,
    ownerId: null,
    name: v.name,
    gender: v.gender,
    language: "ko",
    description: v.description,
    styleTags: v.tags,
    provider: "elevenlabs",
    providerVoiceId: v.providerVoiceId,
    previewUrl: "",
    r2vReferenceStatus: "none",
    favorite: false,
  }));
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const url = new URL(request.url);
    const scope = String(url.searchParams.get("scope") || "").trim();
    const brandId = String(url.searchParams.get("brand_id") || url.searchParams.get("brandId") || "").trim();
    const gender = String(url.searchParams.get("gender") || "").trim();
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const ownerId = sanitizeUserId(auth.userId);

    const sql = getSql(env);
    if (!sql) {
      // DB 미구성 — 시드 폴백 (전역만)
      let list = fallbackVoices();
      if (gender) list = list.filter((v) => v.gender === gender);
      if (q) list = list.filter((v) => v.name.toLowerCase().includes(q) || v.styleTags.join(" ").toLowerCase().includes(q) || (v.description || "").toLowerCase().includes(q));
      return send({ voices: list, fallback: true }, 200, origin);
    }

    await ensureSoundSchema(sql);
    await seedGlobalVoicesIfEmpty(sql);

    const where: string[] = [];
    const params: any[] = [];
    if (scope) { params.push(scope); where.push(`scope = $${params.length}`); }
    else {
      // scope 미지정: 전역 + 내 보이스(+ brand_id 매칭 브랜드 보이스)
      if (brandId) { params.push(brandId); params.push(ownerId); where.push(`(scope = 'global' OR (scope = 'brand' AND brand_id = $${params.length - 1}) OR (scope = 'user' AND owner_id = $${params.length}))`); }
      else { params.push(ownerId); where.push(`(scope = 'global' OR (scope = 'user' AND owner_id = $${params.length}))`); }
    }
    if (scope === "brand" && brandId) { params.push(brandId); where.push(`brand_id = $${params.length}`); }
    if (scope === "user") { params.push(ownerId); where.push(`owner_id = $${params.length}`); }
    if (gender) { params.push(gender); where.push(`gender = $${params.length}`); }

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const rows = await sql(`SELECT * FROM voices ${whereSql} ORDER BY scope, name`, params);

    const favRows = await sql(`SELECT voice_id FROM voice_favorites WHERE owner_id = $1`, [ownerId]);
    const favSet = new Set<string>((favRows || []).map((f: any) => String(f.voice_id)));

    let list = rows.map((r) => mapVoiceRow(r, favSet));
    if (q) {
      list = list.filter((v) =>
        v.name.toLowerCase().includes(q) ||
        (v.styleTags || []).join(" ").toLowerCase().includes(q) ||
        (v.description || "").toLowerCase().includes(q)
      );
    }
    return send({ voices: list }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "voices_error") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL not configured" }, 500, origin);
    await ensureSoundSchema(sql);

    let body: any = {};
    try { body = JSON.parse(await request.text()); } catch { body = {}; }

    const ownerId = sanitizeUserId(auth.userId);
    const scope = String(body.scope || "user").trim();
    if (!["brand", "user"].includes(scope)) return send({ error: "scope must be 'brand' or 'user'" }, 400, origin);
    const name = String(body.name || "").trim();
    if (!name) return send({ error: "name required" }, 400, origin);
    const brandId = String(body.brandId || body.brand_id || "").trim() || null;
    if (scope === "brand" && !brandId) return send({ error: "brandId required for brand scope" }, 400, origin);

    const gender = ["male", "female", "neutral"].includes(String(body.gender)) ? body.gender : "neutral";
    const language = String(body.language || "ko").trim();
    const description = String(body.description || "").trim();
    const styleTags = Array.isArray(body.styleTags) ? body.styleTags.map((t: any) => String(t)).slice(0, 12) : [];
    const provider = String(body.provider || "elevenlabs").trim();
    const providerVoiceId = String(body.providerVoiceId || "").trim();
    const previewUrl = String(body.previewUrl || "").trim() || null;

    const rows = await sql(
      `INSERT INTO voices (scope, brand_id, owner_id, name, gender, language, description, style_tags, provider, provider_voice_id, preview_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, string_to_array($8, ','), $9, $10, $11)
       RETURNING *`,
      [scope, brandId, scope === "user" ? ownerId : null, name, gender, language, description, styleTags.join(","), provider, providerVoiceId, previewUrl]
    );
    return send({ voice: mapVoiceRow(rows[0], new Set()) }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "voices_post_error") }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
