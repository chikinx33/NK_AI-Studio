// prototype/functions/api/agent/generate-doc.ts
// PPT / PDF 콘텐츠를 Claude로 생성 → 구조화된 JSON 반환.
// 클라이언트(브라우저)에서 pptxgenjs / print-to-PDF로 실제 파일 생성.
import { authorizeRequest } from "../_shared/auth.js";
import { send, corsHeaders, getSql, ensureAgentSchema } from "./_shared";
import { callClaude } from "./_orchestrator";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

const PPT_SYSTEM = `당신은 프레젠테이션 전문가입니다. 요청을 받아 PowerPoint 슬라이드 구조를 순수 JSON으로 생성하세요.

출력 형식 (마크다운 코드블록 없이 JSON만):
{
  "title": "프레젠테이션 제목",
  "slides": [
    {"title": "슬라이드 제목", "bullets": ["항목1", "항목2", "항목3"], "notes": "발표자 노트"}
  ]
}

규칙:
- 슬라이드 수: 8~12장 (표지 + 내용 + 마무리)
- 첫 슬라이드: 표지 (title만, bullets=[])
- 마지막 슬라이드: Q&A 또는 마무리
- bullets: 슬라이드당 3~5개, 간결하게 (1줄 이내)
- notes: 발표자가 구두로 할 말 (생략 가능)
- 한국어 작성
- JSON만 출력`;

const PDF_SYSTEM = `당신은 문서 작성 전문가입니다. 요청을 받아 PDF 문서 구조를 순수 JSON으로 생성하세요.

출력 형식 (마크다운 코드블록 없이 JSON만):
{
  "title": "문서 제목",
  "subtitle": "부제목 또는 날짜 (선택)",
  "sections": [
    {"heading": "섹션 제목", "content": "본문 내용. 여러 문장 가능."}
  ]
}

규칙:
- 섹션 수: 4~8개
- 각 섹션: heading + content (2~5문장 분량)
- 한국어 작성
- JSON만 출력`;

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body: any = await request.json().catch(() => ({}));
    const type = String(body?.type || "ppt").toLowerCase();
    const prompt = String(body?.prompt || "").trim();
    const context = String(body?.context || "").trim();

    if (!prompt) return send({ error: "prompt is required" }, 400, origin);
    if (type !== "ppt" && type !== "pdf") return send({ error: "type must be ppt or pdf" }, 400, origin);

    const sql = getSql(env);
    if (sql) await ensureAgentSchema(sql).catch(() => {});

    const system = type === "ppt" ? PPT_SYSTEM : PDF_SYSTEM;
    const userMsg = context ? `요청: ${prompt}\n\n참고 컨텍스트:\n${context}` : `요청: ${prompt}`;

    const raw = await callClaude(env, system, [{ role: "user", content: userMsg }], {
      sql: sql || undefined,
      userId: auth.userId,
      maxTokens: 4000,
      model: "claude-sonnet-4-6",
    });

    // ```json ... ``` 감싸기 제거 후 JSON 파싱
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // JSON 파싱 실패 시 raw에서 { ... } 부분만 추출 시도
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { throw new Error(`JSON 파싱 실패: ${cleaned.slice(0, 200)}`); }
      } else {
        throw new Error(`JSON 파싱 실패: ${cleaned.slice(0, 200)}`);
      }
    }

    return send({ kind: type, ...parsed }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "generate-doc 실패") }, 500, origin);
  }
};
