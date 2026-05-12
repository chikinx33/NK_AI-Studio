import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) } });

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const url = new URL(request.url);
    const input = String(url.searchParams.get("url") || "").trim();
    if (!input) return send({ error: "missing_url" }, 400, origin);
    const normalized = normalizeHttpUrl(input);
    if (!normalized) return send({ error: "invalid_url" }, 400, origin);
    const pageUrl = new URL(normalized);
    if (isBlockedHost(pageUrl.hostname)) return send({ error: "blocked_host" }, 400, origin);

    const html = await fetchHtml(normalized);
    const candidates: IconCandidate[] = [];
    if (html) {
      candidates.push(...extractCandidatesFromHtml(html, pageUrl));
    }
    candidates.push({ url: toAbsolute(pageUrl, "/favicon.ico"), score: 40, sourceType: "favicon" });
    const host = pageUrl.hostname;
    candidates.push({ url: `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`, score: 35, sourceType: "external" });
    candidates.push({ url: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`, score: 34, sourceType: "external" });

    const tried = new Set<string>();
    for (const c of candidates.sort((a, b) => b.score - a.score)) {
      const abs = toAbsolute(pageUrl, c.url);
      if (!abs || tried.has(abs)) continue;
      tried.add(abs);
      try {
        const fetched = await fetchImage(abs);
        if (!fetched) continue;
        const dataUrl = toDataUrl(fetched.bytes, fetched.type);
        if (!dataUrl) continue;
        return send({
          ok: true,
          iconDataUrl: dataUrl,
          sourceType: c.sourceType || "icon",
          contentType: fetched.type,
          from: abs
        }, 200, origin);
      } catch (_) {
        continue;
      }
    }

    return send({ ok: false, error: "icon_not_found" }, 404, origin);
  } catch (e: any) {
    return send({ error: e?.message || "icon_error" }, 500, origin);
  }
};

type IconCandidate = { url: string; score: number; sourceType?: "manifest" | "apple" | "icon" | "favicon" | "og" | "external" };

function normalizeHttpUrl(input: string): string | "" {
  const raw = String(input || "").trim();
  const candidate = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let u: URL | null = null;
  try { u = new URL(candidate); } catch { return ""; }
  if (!/^https?:$/i.test(u.protocol)) return "";
  return u.toString();
}

function isBlockedHost(host: string): boolean {
  const h = String(host || "").trim().toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    if (h.startsWith("10.") || h.startsWith("127.") || h.startsWith("192.168.")) return true;
    const m = h.match(/^172\.(\d+)\./);
    const n = m ? Number(m[1]) : -1;
    if (n >= 16 && n <= 31) return true;
  }
  return false;
}

async function fetchHtml(url: string): Promise<string | "" > {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "nk-studio-icon-fetch/1.0"
      },
      redirect: "follow"
    } as RequestInit);
    if (!res.ok) return "";
    const type = String(res.headers.get("Content-Type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return "";
    const text = await res.text();
    return text || "";
  } catch {
    return "";
  }
}

function toAbsolute(base: URL, href: string): string {
  try {
    const h = String(href || "").trim();
    if (!h) return "";
    if (h.startsWith("manifest://")) return h;
    if (/^https?:\/\//i.test(h)) return h;
    if (h.startsWith("//")) return `${base.protocol}${h}`;
    if (h.startsWith("/")) return `${base.origin}${h}`;
    return `${base.origin}${base.pathname.replace(/\/[^\/]*$/, "/")}${h}`;
  } catch {
    return "";
  }
}

function extractCandidatesFromHtml(html: string, base: URL): IconCandidate[] {
  const out: IconCandidate[] = [];
  const linkRe = /<link\b[^>]*>/gi;
  const metaRe = /<meta\b[^>]*>/gi;
  const tags = html.match(linkRe) || [];
  for (const tag of tags) {
    const rel = attrValue(tag, "rel").toLowerCase();
    const href = attrValue(tag, "href");
    if (!href) continue;
    if (/\bmanifest\b/i.test(rel)) {
      out.push(...extractManifestIcons(toAbsolute(base, href)));
      continue;
    }
    if (/\bapple-touch-icon\b/i.test(rel)) {
      const score = 90 + sizeScore(attrValue(tag, "sizes"));
      out.push({ url: toAbsolute(base, href), score, sourceType: "apple" });
      continue;
    }
    if (/\bicon\b/i.test(rel) || /\bshortcut icon\b/i.test(rel) || /\bmask-icon\b/i.test(rel)) {
      const score = 80 + sizeScore(attrValue(tag, "sizes"));
      out.push({ url: toAbsolute(base, href), score, sourceType: "icon" });
      continue;
    }
  }
  const metas = html.match(metaRe) || [];
  for (const tag of metas) {
    const prop = attrValue(tag, "property").toLowerCase();
    const content = attrValue(tag, "content");
    if (!content) continue;
    if (prop === "og:image" || prop === "twitter:image") {
      out.push({ url: toAbsolute(base, content), score: 50, sourceType: "og" });
    }
  }
  return out.filter(c => !!c.url);
}

function attrValue(tag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]+)"|'([^']+)'|([^\\s>]+))`, "i");
  const m = tag.match(re);
  if (!m) return "";
  return (m[2] || m[3] || m[4] || "").trim();
}

function sizeScore(sizes: string): number {
  const raw = String(sizes || "").trim();
  if (!raw) return 0;
  const parts = raw.split(/\s+/);
  let max = 0;
  for (const p of parts) {
    const m = p.match(/(\d+)\s*x\s*(\d+)/i);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      const area = Math.max(w, h);
      if (area > max) max = area;
    }
  }
  return Math.min(20, Math.floor(max / 16));
}

function extractManifestIcons(manifestUrl: string): IconCandidate[] {
  const out: IconCandidate[] = [];
  if (!manifestUrl) return out;
  out.push({ url: `manifest://${manifestUrl}`, score: 100, sourceType: "manifest" });
  return out;
}

async function fetchImage(url: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  if (url.startsWith("manifest://")) {
    const real = url.slice("manifest://".length);
    try {
      const r = await fetch(real, { method: "GET", redirect: "follow", headers: { "Accept": "application/manifest+json, application/json;q=0.9, */*;q=0.1" } } as RequestInit);
      if (!r.ok) return null;
      const text = await r.text();
      const json = safeJson(text);
      if (!json || !Array.isArray(json.icons)) return null;
      const icons = json.icons as any[];
      const scored = icons.map((it) => {
        const sizes = String(it?.sizes || "").trim();
        const purpose = String(it?.purpose || "").toLowerCase();
        const score = 100 + sizeScore(sizes) + (/\bmaskable\b/i.test(purpose) ? 10 : 0);
        return { src: String(it?.src || "").trim(), score };
      }).filter(it => !!it.src);
      scored.sort((a, b) => b.score - a.score);
      for (const it of scored) {
        const abs = toAbsolute(new URL(real), it.src);
        if (!abs) continue;
        const fetched = await fetchImage(abs);
        if (fetched) return fetched;
      }
      return null;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" } as RequestInit);
    if (!res.ok) return null;
    const type = String(res.headers.get("Content-Type") || "").toLowerCase() || "application/octet-stream";
    if (!isAcceptableImageType(type)) return null;
    const buf = await res.arrayBuffer();
    if (!buf || (buf as any).byteLength === 0) return null;
    return { bytes: buf, type: normalizeMime(type) };
  } catch {
    return null;
  }
}

function isAcceptableImageType(type: string): boolean {
  const t = normalizeMime(type);
  if (!t.startsWith("image/")) return false;
  return true;
}

function normalizeMime(type: string): string {
  const t = String(type || "").toLowerCase().split(";")[0].trim();
  if (!t || t === "application/octet-stream") return "image/x-icon";
  return t;
}

function toDataUrl(buf: ArrayBuffer, mime: string): string {
  const b64 = arrayBufferToBase64(buf);
  const t = normalizeMime(mime);
  return `data:${t};base64,${b64}`;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // 큰 버퍼를 1바이트씩 연결하면 O(n²) 가 되어 Workers CPU 한도를 넘긴다.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
}

function safeJson(text: string): any | null {
  try { return JSON.parse(text); } catch { return null; }
}
