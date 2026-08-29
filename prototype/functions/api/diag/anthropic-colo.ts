// prototype/functions/api/diag/anthropic-colo.ts
// 진단 전용: Anthropic 으로 나가는 요청이 어느 Cloudflare COLO(데이터센터)로 송출되는지,
// 그리고 그 경로에서 차단되는지(403 "Request not allowed")/도달하는지(401 + request-id)를 잰다.
//
// 왜 필요한가:
//   구독(OAuth) 모드와 API 키 모드가 '똑같이' 403 "Request not allowed" 로 실패했다.
//   자격증명이 달라도 결과가 같다는 건 요청이 Anthropic 에 닿기 전에 잘린다는 뜻이다.
//   이 엔드포인트는 그 가설을 자격증명 없이 확인한다.
//
// 키를 쓰지 않는다(=과금·권한 영향 없음). 키 없이 GET 하면:
//   - 정상 도달: 401 + JSON 본문 + x-request-id 있음  → 차단 아님(자격증명 문제)
//   - 경로 차단: 403 + x-request-id 없음(보통 수 ms)   → Anthropic 도달 전 엣지에서 잘림
//
// 호출 1번 = Worker 1 호출 = COLO 1곳. 여러 번 눌러 분포를 보면 "매번 같은 곳인지"가 드러난다.
// openai-colo.ts 와 같은 판정 규칙을 쓴다(본문 문자열이 아니라 x-request-id 유무로 판정).
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

  const gateway = String(env.CF_AI_GATEWAY_URL || env.ANTHROPIC_GATEWAY_BASE || "").trim().replace(/\/+$/, "");

  const probe = async (label: string, base: string) => {
    const t0 = Date.now();
    try {
      // 자격증명을 붙이지 않는다. 도달만 하면 Anthropic 은 401 을 준다.
      const res = await fetch(`${base}/v1/models`, {
        method: "GET",
        headers: { "anthropic-version": "2023-06-01" },
      });
      const body = await res.text().catch(() => "");
      const cfRay = String(res.headers.get("cf-ray") || "");
      const colo = cfRay.indexOf("-") >= 0 ? cfRay.slice(cfRay.lastIndexOf("-") + 1).toUpperCase() : "";
      const requestId = String(res.headers.get("x-request-id") || "");
      // 판정 기준은 x-request-id 하나뿐이다. 본문 문자열로 추정하면 Cloudflare 차단 페이지의
      // 문구에 오판한다(실제로 그렇게 잘못 짚어 원인 추적이 한참 헛돌았다).
      const reached = !!requestId;
      return {
        label,
        base,
        ok: res.ok,
        status: res.status,
        ms: Date.now() - t0,
        colo,
        cfRay,
        requestId,
        reached,
        verdict: reached
          ? "Anthropic 도달 — 경로 차단 아님(자격증명·요청 내용 문제)"
          : "Anthropic 도달 전 차단 — 이 경로로는 자격증명을 바꿔도 동일하게 막힌다",
        bodyHead: body.slice(0, 200),
      };
    } catch (e: any) {
      return { label, base, error: String(e?.message || e), ms: Date.now() - t0 };
    }
  };

  const results = [await probe("direct", "https://api.anthropic.com")];
  if (gateway) results.push(await probe("gateway", gateway));

  return json({
    ok: true,
    note: "reached=false 가 나오면 요청이 Anthropic 에 닿기 전에 잘린 것입니다. 여러 번 호출해 COLO 분포를 보세요.",
    gatewayConfigured: !!gateway,
    results,
  }, 200, origin);
};
