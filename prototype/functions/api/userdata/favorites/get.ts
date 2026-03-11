import { buildUserDataObject, resolveUserId } from "../../_shared/storage";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const reqUrl = new URL(request.url);
    const userId = resolveUserId(reqUrl.searchParams.get("userId") || "", env);
    const clientEmail = env.GOOGLE_CLIENT_EMAIL as string | undefined;
    const privateKeyRaw = env.GOOGLE_PRIVATE_KEY as string | undefined;
    const baseOutput = env.VIDEO_OUTPUT_GCS_URI as string | undefined;
    if (!clientEmail || !privateKeyRaw || !baseOutput) {
      return send({ error: "Missing GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY/VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    }

    const outParsed = parseGcsUri(baseOutput);
    if (!outParsed) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const basePrefix = outParsed.object.replace(/\/$/, "");
    const objectName = buildUserDataObject(basePrefix, userId, "favorites.json");
    const token = await getGoogleAccessToken({
      clientEmail,
      privateKeyPem: privateKeyRaw,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });
    const userProject =
      (env.GCS_BILLING_PROJECT_ID as string | undefined) ||
      (env.GOOGLE_PROJECT_ID as string | undefined) ||
      "";
    const fetchOnce = async (useUserProject: boolean) => {
      const dlUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(outParsed.bucket)}/o/${encodeURIComponent(objectName)}?alt=media${useUserProject && userProject ? `&userProject=${encodeURIComponent(userProject)}` : ""}`;
      const res = await fetch(dlUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(useUserProject && userProject ? { "X-Goog-User-Project": userProject } : {}),
        },
      });
      const text = await res.text();
      return { res, text };
    };

    let { res, text } = await fetchOnce(true);
    if (!res.ok && userProject && (res.status === 400 || res.status === 403)) {
      ({ res, text } = await fetchOnce(false));
    }
    if (res.status === 404) {
      return send({
        ok: true,
        data: {
          userId,
          items: [],
          categoryNames: sanitizeCategoryNames([]),
          themePresets: sanitizeThemePresets({}),
          updatedAt: "",
        }
      }, 200, origin);
    }
    if (!res.ok) return send({ error: text || "favorites_get_failed" }, res.status, origin);

    const parsed = safeJson(text) || {};
    const items = sanitizeFavoriteItems(parsed.items);
    const categoryNames = sanitizeCategoryNames(parsed.categoryNames);
    const themePresets = sanitizeThemePresets(parsed.themePresets);
    const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
    return send({ ok: true, data: { userId, items, categoryNames, themePresets, updatedAt } }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};

type FavoriteItem = {
  id: string;
  title: string;
  category: string;
  description: string;
  url: string;
  iconDataUrl: string;
  slot: number;
};
const FAVORITE_CATEGORY_COUNT = 4;
const FAVORITE_SLOT_COUNT = FAVORITE_CATEGORY_COUNT * 12;
const THEME_PRESET_IDS = {
  dark: ["dark-classic", "dark-midnight", "dark-forest", "dark-slate", "dark-royal"],
  light: ["light-classic", "light-sky", "light-sand", "light-mint", "light-rose"],
} as const;
const THEME_PRESET_DEFAULTS = {
  dark: THEME_PRESET_IDS.dark[0],
  light: THEME_PRESET_IDS.light[0],
} as const;
const FAVORITE_DEFAULT_CATEGORY_NAMES = Array.from({ length: FAVORITE_CATEGORY_COUNT }, (_, idx) => `카테고리 ${idx + 1}`);

function sanitizeFavoriteItems(input: any): FavoriteItem[] {
  if (!Array.isArray(input)) return [];
  const normalized = input
    .map((item: any) => ({
      id: String(item?.id || "").slice(0, 80),
      title: String(item?.title || "").trim().slice(0, 80),
      category: String(item?.category || "").trim().slice(0, 60),
      description: String(item?.description || "").trim().slice(0, 200),
      url: String(item?.url || "").trim().slice(0, 1000),
      iconDataUrl: String(item?.iconDataUrl || "").trim(),
      slot: parseSlot(item?.slot),
    }))
    .filter((item) => !!item.title && /^https?:\/\//i.test(item.url) && /^data:image\//i.test(item.iconDataUrl))
    .slice(0, FAVORITE_SLOT_COUNT);

  return normalizeSlots(normalized);
}

function parseSlot(raw: any): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return -1;
  const slot = Math.trunc(num);
  if (slot < 0 || slot >= FAVORITE_SLOT_COUNT) return -1;
  return slot;
}

function normalizeSlots(items: FavoriteItem[]): FavoriteItem[] {
  const used = new Set<number>();
  const fixed: Array<FavoriteItem & { _order: number }> = [];
  const floating: Array<FavoriteItem & { _order: number }> = [];

  items.forEach((item, idx) => {
    const entry = { ...item, _order: idx };
    if (entry.slot >= 0 && !used.has(entry.slot)) {
      used.add(entry.slot);
      fixed.push(entry);
      return;
    }
    floating.push(entry);
  });

  const nextSlot = () => {
    for (let slot = 0; slot < FAVORITE_SLOT_COUNT; slot += 1) {
      if (!used.has(slot)) {
        used.add(slot);
        return slot;
      }
    }
    return -1;
  };

  floating.forEach((item) => {
    const slot = nextSlot();
    if (slot < 0) return;
    item.slot = slot;
    fixed.push(item);
  });

  fixed.sort((a, b) => (a.slot - b.slot) || (a._order - b._order));
  return fixed.map(({ _order, ...item }) => item);
}

function sanitizeCategoryNames(input: any): string[] {
  const source = Array.isArray(input) ? input : [];
  const next: string[] = [];
  for (let idx = 0; idx < FAVORITE_CATEGORY_COUNT; idx += 1) {
    const fallback = FAVORITE_DEFAULT_CATEGORY_NAMES[idx];
    const raw = String(source[idx] || "").trim();
    next.push((raw || fallback).slice(0, 24));
  }
  return next;
}

function sanitizeThemePresets(input: any): { dark: string; light: string } {
  const source = input && typeof input === "object" ? input : {};
  const darkRaw = String(source.dark || "").trim();
  const lightRaw = String(source.light || "").trim();
  return {
    dark: THEME_PRESET_IDS.dark.includes(darkRaw as any) ? darkRaw : THEME_PRESET_DEFAULTS.dark,
    light: THEME_PRESET_IDS.light.includes(lightRaw as any) ? lightRaw : THEME_PRESET_DEFAULTS.light,
  };
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

function parseGcsUri(uri: string): { bucket: string; object: string } | null {
  if (!uri.startsWith("gs://")) return null;
  const rest = uri.slice(5);
  const slash = rest.indexOf("/");
  if (slash === -1) return null;
  const bucket = rest.slice(0, slash);
  const object = rest.slice(slash + 1);
  return { bucket, object };
}

async function getGoogleAccessToken(opts: { clientEmail: string; privateKeyPem: string; scope: string; }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const aud = "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = { iss: opts.clientEmail, scope: opts.scope, aud, iat: now, exp };
  const jwtUnsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signature = await signRS256(jwtUnsigned, opts.privateKeyPem);
  const assertion = `${jwtUnsigned}.${signature}`;
  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", assertion);
  const res = await fetch(aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth token error (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("No access_token in OAuth response");
  return json.access_token as string;
}

function base64url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  const b64 = btoa(str);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function signRS256(message: string, privateKeyPem: string) {
  const pem = privateKeyPem.replace(/\\n/g, "\n").trim();
  const pkcs8Der = pemToArrayBuffer(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, new TextEncoder().encode(message));
  return bufferToBase64Url(sigBuf);
}

function pemToArrayBuffer(pem: string) {
  const lines = pem.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").split(/\s+/).join("");
  const raw = atob(lines);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function bufferToBase64Url(buf: ArrayBuffer) {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
