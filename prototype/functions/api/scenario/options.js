// prototype/functions/api/scenario/options.js
// GET /api/scenario/options — 개요에서 고를 수 있는 값 전부(장르·세부장르·타겟·목적·톤·스타일·길이·비율·음성모드).
// 제작 캔버스의 개요 모달과 직원(에이전트)이 같은 목록을 본다 — 지어낸 값이 저장되지 않게.
import { overviewOptions } from "../_shared/overview-options.js";

const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // 값은 코드에 박혀 있어 자주 바뀌지 않는다. 짧게 캐시해 화면이 매번 기다리지 않게 한다.
  "Cache-Control": "public, max-age=600",
  "Vary": "Origin",
});

export const onRequestOptions = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet = async ({ request }) =>
  new Response(JSON.stringify({ ok: true, options: overviewOptions() }), {
    status: 200,
    headers: corsHeaders(request.headers.get("Origin")),
  });
