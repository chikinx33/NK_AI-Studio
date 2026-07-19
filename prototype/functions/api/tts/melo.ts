// 자체 호스팅 MeloTTS(Cloud Run)로 음성을 생성하는 프록시.
// 브라우저 → 이 함수 → (공유 시크릿) → Cloud Run. 시크릿은 서버측에만 두어 노출 안 됨.
// 응답은 기존 /api/tts 와 동일하게 { voiceUrl } (짧은 대사라 data: URI 로 반환).
import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const corsHeaders = (origin?: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});
const send = (data: any, status = 200, origin?: string | null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const baseUrl = String(env.MELO_TTS_URL || "").trim().replace(/\/$/, "");
    const secret = String(env.MELO_TTS_SECRET || "").trim();
    if (!baseUrl) {
      return send({ error: "melo_tts_not_configured", hint: "Cloudflare 환경변수 MELO_TTS_URL 을 설정하세요(Cloud Run 서비스 URL)." }, 500, origin);
    }

    let body: any = {};
    try { body = JSON.parse((await request.text()) || "{}"); } catch { body = {}; }
    const script = String(body.script || body.text || "").trim();
    if (!script) return send({ error: "script is required" }, 400, origin);
    const speed = clampNum(body.speed ?? body.speakingRate, 0.5, 2.0, 1.0);
    const semitones = clampNum(body.semitones, -12, 12, 0);

    const res = await fetch(`${baseUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-nk-proxy-secret": secret } : {}),
      },
      body: JSON.stringify({ text: script.slice(0, 1600), speed, semitones, language: "KR" }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return send({ error: "melo_tts_failed", status: res.status, hint: sanitize(detail) }, 200, origin);
    }

    const buf = await res.arrayBuffer();
    const b64 = bytesToBase64(new Uint8Array(buf));
    const voiceUrl = `data:audio/wav;base64,${b64}`;
    return send({ voiceUrl, format: "wav" }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function clampNum(v: any, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function sanitize(msg: string): string {
  return String(msg || "").replace(/\s+/g, " ").trim().slice(0, 600);
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(bin);
}
