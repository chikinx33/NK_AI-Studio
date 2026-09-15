// prototype/functions/api/userdata/brand.ts
// 계정별 스튜디오 브랜드(런처 로그인 카드의 제목·로고). 로그인 카드 로고를 눌러 등록한 이미지를
// 이 계정의 다른 기기와 AI 기업 사이드바에서도 같이 쓰도록 서버에 둔다.
// GET = { ok, data: { title, iconDataUrl } } / POST { title?, iconDataUrl? } = 보낸 필드만 갱신
import { buildUserDataObject, sanitizeUserId } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { readGcsJson, resolveGcsEnv, writeGcsJson } from "../_shared/gcs.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const BRAND_FILE = "studio-brand.json";
const MAX_TITLE = 40;
// 로그인 카드는 500×500 PNG 로 줄여 보낸다. 넉넉히 잡되 JSON 한 벌이 과하게 커지지 않게 막는다.
const MAX_ICON_CHARS = 2_000_000;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export function normalizeBrandTitle(value: any): string {
  return String(value ?? "").trim().slice(0, MAX_TITLE);
}

export function normalizeBrandIcon(value: any): string {
  const url = String(value ?? "").trim();
  if (!url) return "";
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(url)) return "";
  if (url.length > MAX_ICON_CHARS) return "";
  return url;
}

function brandObject(env: any, userId: string): string {
  const { basePrefix } = resolveGcsEnv(env);
  return buildUserDataObject(basePrefix, sanitizeUserId(userId), BRAND_FILE);
}

async function readBrand(env: any, userId: string) {
  const { found, data } = await readGcsJson(env, brandObject(env, userId));
  const src = found && data && typeof data === "object" ? data : {};
  return { title: normalizeBrandTitle(src.title), iconDataUrl: normalizeBrandIcon(src.iconDataUrl) };
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    return send({ ok: true, data: await readBrand(env, auth.userId) }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "brand_get_failed" }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const current = await readBrand(env, auth.userId);
    const next = { ...current };
    if (Object.prototype.hasOwnProperty.call(body || {}, "title")) next.title = normalizeBrandTitle(body.title);
    if (Object.prototype.hasOwnProperty.call(body || {}, "iconDataUrl")) {
      const raw = String(body.iconDataUrl ?? "").trim();
      const icon = normalizeBrandIcon(raw);
      if (raw && !icon) return send({ error: "invalid_icon", message: "PNG·JPEG·WebP 이미지(2MB 이하)만 등록할 수 있어요." }, 400, origin);
      next.iconDataUrl = icon;
    }
    await writeGcsJson(env, brandObject(env, auth.userId), { ...next, updatedAt: new Date().toISOString() });
    return send({ ok: true, data: next }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "brand_save_failed" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
