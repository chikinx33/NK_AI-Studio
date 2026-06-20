// prototype/functions/api/diag/openai-colo.ts
// 진단 전용: OpenAI 로 나가는 요청이 어느 Cloudflare COLO(데이터센터)로 송출되는지,
// 그리고 그 지역에서 차단되는지(빈 본문 403)/도달하는지(401+request-id)를 측정한다.
//
// 키를 쓰지 않는다(=과금/권한 영향 없음). 키 없이 GET 하면:
//  - 지역 차단(예: 홍콩): 403 + 빈 본문 + x-request-id 없음  → 엣지에서 잘림
//  - 정상 도달: 401(Unauthorized) + JSON 본문 + x-request-id 있음 → API 까지 도달(차단 아님)
// 호출 1번 = Worker 1 호출 = 1개 COLO. 여러 번 호출해 분포를 보면 "매번 홍콩인지"가 드러난다.
import { authorizeRequest } from "../_shared/auth.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const cors = (o?: string | null) => ({
  "Access-Control-Allow-Origin": o || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});

function json(data: any, status = 200, origin?: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
  });
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env, { allowQueryToken: true });
  if (!auth.ok) return json({ error: auth.error }, auth.status, origin);

  // OPENAI_BASE_URL 이 설정돼 있으면 그 경로(프록시)도 같이 찍어 비교 가능하게 한다.
  const base = String(env.OPENAI_BASE_URL || "https://api.openai.com").trim().replace(/\/+$/, "");

  const probe = async (target: string) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${target}/v1/models`, { method: "GET" });
      const body = await res.text().catch(() => "");
      const cfRay = String(res.headers.get("cf-ray") || "");
      const colo = cfRay.indexOf("-") >= 0 ? cfRay.slice(cfRay.lastIndexOf("-") + 1).toUpperCase() : "";
      const requestId = String(res.headers.get("x-request-id") || "");
      const emptyBody = !body || !body.trim();
      return {
        target,
        colo,
        cfRay,
        status: res.status,
        hasRequestId: !!requestId,
        emptyBody,
        reachedOpenAI: !!requestId || (!emptyBody && /"?(error|object)"?/i.test(body)),
        regionBlocked: res.status === 403 && emptyBody && !requestId,
        ms: Date.now() - t0,
      };
    } catch (e: any) {
      return { target, error: String(e?.message || e), ms: Date.now() - t0 };
    }
  };

  const direct = await probe("https://api.openai.com");
  const out: any = { direct };
  if (base !== "https://api.openai.com") {
    out.viaBaseUrl = await probe(base);
  }
  return json(out, 200, origin);
};
