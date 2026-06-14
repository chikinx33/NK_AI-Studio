// prototype/functions/api/agent/knowledge-graph.ts
// GET /api/agent/knowledge-graph — 회사 지식을 그래프(옵시디언식)로. ★ user_id 격리.
// 엣지 = 공유 키워드 기반(관련 항목 연결). 임베딩 없이 무료·즉시(매 요청 폴링 대응).
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema, listCompanyKnowledge } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// 너무 흔해서 연결 노이즈만 만드는 일반어는 제외.
const STOP = new Set([
  "프로젝트", "사용자", "에이전트", "에이전트는", "우리", "경우", "대화", "사용", "관리", "확인",
  "위임", "판단", "실행", "담당", "최종", "유무", "즉시", "가능", "활용", "운영", "글로벌", "확장",
  "모든", "그리고", "하는", "한다", "하면", "또는", "최상", "비교", "선정", "추천",
]);
function tokenize(s: string): string[] {
  const raw = String(s || "").toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) || [];
  return [...new Set(raw.filter((t) => !STOP.has(t)))];
}

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
  const sql = getSql(env);
  if (!sql) return send({ nodes: [], edges: [] }, 200, origin);
  await ensureAgentSchema(sql);
  const items = await listCompanyKnowledge(sql, auth.userId);

  // 각 항목의 키워드 집합 → 공유 키워드 2개 이상이면 관련(엣지). 옵시디언식 연결망.
  const toks = items.map((k) => new Set(tokenize(k.text)));
  const degree = new Array(items.length).fill(0);
  const edges: { source: number; target: number; weight: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      let common = 0;
      for (const t of toks[j]) if (toks[i].has(t)) common++;
      if (common >= 2) {
        edges.push({ source: i, target: j, weight: Math.min(common / 4, 1) });
        degree[i]++;
        degree[j]++;
      }
    }
  }
  const nodes = items.map((k, i) => ({ id: i, text: k.text, origin: k.source, type: k.type, degree: degree[i] }));
  return send({ nodes, edges }, 200, origin);
};
