// POST /api/agent/motion-director — 인포그래픽 영상 감독: 이 영상만의 장면 코드(HTML 한 장)와 소리 큐를 쓴다.
// body: { workId, prepared(이 PC 렌더러가 정리한 assets.json), thumbs?: [{ id, label, dataUrl }], reference?: [{ label, dataUrl }](레퍼런스 영상 접촉 시트) }
//   부분 수정: { …, mode: "revise", html, episode, request, frames?: [{ t, dataUrl }] }
//   검수(확인 루프): { …, mode: "review", html, episode, frames: [{ t, dataUrl }], findings: [문장] } → 고칠 게 없으면 result.approved
// 응답: text/event-stream — data: {"t":"progress","chars"} … data: {"t":"done","result":{html,episode,problems}} | {"t":"error","error"}
//
// 비용 0원 정책(2026-10-21 엔케): Claude 구독(OAuth)일 때만 실행한다. API 키 경로는 쓰지 않고,
// 구독이 거부돼도 API 키로 다시 시도하지 않는다(claudeFetch 예비 자격증명 제거).
// 긴 코드를 쓰는 동안 연결이 끊기지 않게 응답을 흘려 보낸다(director/assist.ts 와 같은 방식).
import { authorizeRequest } from "../_shared/auth.js";
import { buildClaudeSystem, claudeFetch } from "../_shared/claude-auth.js";
import {
  MOTION_DIRECTOR_MAX_IMAGES, MOTION_DIRECTOR_MAX_TOKENS, MOTION_DIRECTOR_MODEL, MOTION_REFERENCE_MAX_SHEETS,
  MOTION_REVIEW_MAX_IMAGES, buildMotionDirectorRequest, buildMotionDirectorSystem, buildMotionReviewRequest, buildMotionRevisionRequest,
  isReviewApproved, parseMotionDirectorOutput,
} from "../_shared/motion-director.js";
import { motionExamplesForPrompt } from "./_motion-examples";
import { corsHeaders, getSql, send } from "./_shared";
import { MOTION_SUBSCRIPTION_REQUIRED, motionSubscriptionAuth } from "./_motion-auth";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// 레퍼런스 접촉 시트 12장(장당 수백 KB)까지 담는다. Claude 요청 한도(32MB)보다 작게.
const MAX_BODY_CHARS = 16 * 1024 * 1024;
// 시험(2026-10-21)에서 장면 코드가 약 2만 9천 자였고, 그 앞에 깊게 생각한다. 흘려 보내는 동안 연결은 유지되므로
// 넉넉히 두되 지역 우회 프록시(Cloud Run, 900초)보다 짧게 둬서 우리 쪽에서 먼저 정리한다.
// 감독은 클라우드 렌더러(준비 작업)가 기다린다. 출력 128K 를 다 쓰면 20분 남짓 — 프록시 제한(3600초) 안에서 30분.
const TIMEOUT_MS = 1_800_000;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function imageBlocks(thumbs: any, { max = MOTION_DIRECTOR_MAX_IMAGES, prefix = "자산 미리보기: " } = {}): any[] {
  const blocks: any[] = [];
  for (const thumb of (Array.isArray(thumbs) ? thumbs : []).slice(0, max)) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(thumb?.dataUrl || ""));
    if (!match) continue;
    blocks.push({ type: "text", text: `${prefix}${String(thumb?.label || thumb?.id || "").slice(0, 160)}` });
    blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
  }
  return blocks;
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return send({ error: who.error }, who.status, origin);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return send({ error: "body_too_large" }, 413, origin);
  let body: any;
  try { body = JSON.parse(rawBody || "{}"); } catch { return send({ error: "invalid_json" }, 400, origin); }
  const workId = String(body?.workId || "");
  if (!/^[0-9a-f-]{36}$/i.test(workId)) return send({ error: "workId가 필요합니다." }, 400, origin);
  const prepared = body?.prepared && typeof body.prepared === "object" ? body.prepared : null;
  if (!prepared?.kit?.motion) return send({ error: "이 PC 렌더러가 정리한 자산 목록(prepared)이 필요합니다." }, 400, origin);

  const sql = getSql(env);
  if (!sql) return send({ error: "DB를 사용할 수 없습니다." }, 503, origin);
  const rows = await sql("SELECT metadata FROM company_work_items WHERE id = $1 AND user_id = $2 LIMIT 1", [workId, who.userId]);
  if (!rows[0]) return send({ error: "회사 업무를 찾지 못했습니다." }, 404, origin);
  const metadata: any = rows[0].metadata || {};
  const input = metadata.input || {};

  // 구독 전용
  let auth: any;
  try {
    auth = await motionSubscriptionAuth(sql, who.userId, env);
    if (!auth) return send({ error: MOTION_SUBSCRIPTION_REQUIRED }, 412, origin);
  } catch (e) {
    return send({ error: String((e as any)?.message || e) }, 500, origin);
  }

  const system = buildMotionDirectorSystem();
  let content: any[];
  if (body?.mode === "revise") {
    // 부분 수정: 지금 장면 코드 + 수정 요청 + 사용자가 가리킨 장면 정지 화면
    const html = String(body?.html || "");
    const revisionRequest = String(body?.request || "").trim();
    if (!html || html.length > 200_000) return send({ error: "고칠 장면 코드가 필요합니다." }, 400, origin);
    if (!revisionRequest) return send({ error: "무엇을 바꿀지 적어 주세요." }, 400, origin);
    const frames = (Array.isArray(body?.frames) ? body.frames : []).slice(0, 6);
    const frameBlocks = imageBlocks(frames.map((frame: any) => ({ dataUrl: frame?.dataUrl, label: `사용자가 가리킨 장면 ${Number(frame?.t) || 0}초` })));
    const userText = buildMotionRevisionRequest({
      input, prepared, html, episode: body?.episode || null, request: revisionRequest,
      frameTimes: frames.map((frame: any) => Number(frame?.t) || 0),
    });
    content = [...frameBlocks, { type: "text", text: userText }];
  } else if (body?.mode === "review") {
    // 검수: 방금 쓴 장면 코드의 정지 화면 + 자동 검사 결과 → 점검표대로 스스로 고치거나 OK
    const html = String(body?.html || "");
    if (!html || html.length > 200_000) return send({ error: "검수할 장면 코드가 필요합니다." }, 400, origin);
    const frames = (Array.isArray(body?.frames) ? body.frames : []).slice(0, MOTION_REVIEW_MAX_IMAGES);
    const findings = (Array.isArray(body?.findings) ? body.findings : []).map((line: unknown) => String(line).slice(0, 300)).slice(0, 12);
    const frameBlocks = imageBlocks(frames.map((frame: any) => ({ dataUrl: frame?.dataUrl, label: `${Number(frame?.t) || 0}초` })),
      { max: MOTION_REVIEW_MAX_IMAGES, prefix: "렌더 정지 화면 " });
    const userText = buildMotionReviewRequest({
      input, prepared, html, episode: body?.episode || null, findings,
      frameTimes: frames.map((frame: any) => Number(frame?.t) || 0),
    });
    content = [...frameBlocks, { type: "text", text: userText }];
  } else {
    // 새로 쓰기: 저장해 둔 실례(엔케가 마음에 들어 한 영상)를 취향 참고로 함께 준다
    const examples = await motionExamplesForPrompt(sql, who.userId, String(input.aspectRatio || "")).catch(() => []);
    const examplesText = examples.length
      ? ["# 이 사용자가 마음에 들어 저장한 실례 (취향 참고 — 그대로 베끼지 말고 수준·리듬·마감을 맞춘다)",
        ...examples.map((ex: any, i: number) => `## 저장 실례 ${i + 1}: ${ex.title} (${ex.aspectRatio})\n\`\`\`html\n${ex.html}\n\`\`\``), ""].join("\n")
      : "";
    const userText = buildMotionDirectorRequest({ input, spec: metadata.spec || null, prepared });
    // 레퍼런스 영상 접촉 시트(4×4) — 자산 미리보기와 따로 센다
    const referenceBlocks = imageBlocks(body?.reference, { max: MOTION_REFERENCE_MAX_SHEETS, prefix: "레퍼런스 영상 접촉 시트 " });
    content = [...imageBlocks(body?.thumbs), ...referenceBlocks, { type: "text", text: examplesText + userText }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("motion_director_timeout"), TIMEOUT_MS);
  const encoder = new TextEncoder();
  // 응답은 Claude 를 부르기 전에 바로 시작한다. Cloudflare 는 100초 안에 첫 바이트가 없으면 524 로 끊는데,
  // 감독은 먼저 깊게 생각하고(또는 중간 프록시가 늦게 넘겨) 첫 글자까지 오래 걸릴 수 있다(2026-10-21 운영 524).
  const stream = new ReadableStream({
    async start(out) {
      let closed = false;
      const write = (chunk: string) => { if (!closed) { try { out.enqueue(encoder.encode(chunk)); } catch { closed = true; } } };
      const emit = (obj: any) => write(`data: ${JSON.stringify(obj)}\n\n`);
      const keepalive = setInterval(() => write(": keepalive\n\n"), 15_000);
      emit({ t: "progress", chars: 0 });
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let stopReason = "";
      // 출력 토큰이 생각과 장면 코드에 어떻게 나뉘었는지(잘렸을 때 원인을 바로 보려고)
      let outputTokens = 0;
      let thinkingChars = 0;
      let lastReport = 0;
      let lastEmitAt = 0;
      try {
        const res = await claudeFetch(env, auth, (sub: boolean) => ({
          model: MOTION_DIRECTOR_MODEL,
          max_tokens: MOTION_DIRECTOR_MAX_TOKENS,
          output_config: { effort: "high" },
          system: buildClaudeSystem(sub, system),
          messages: [{ role: "user", content }],
          stream: true,
        }), { signal: controller.signal });
        if (!res.ok || !res.body) {
          const raw = await res.text().catch(() => "");
          throw new Error(`Claude ${res.status}: ${raw.slice(0, 300)}`);
        }
        const upstream = res.body.getReader();
        for (;;) {
          const { value, done } = await upstream.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            let evt: any;
            try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
            if (evt?.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              text += evt.delta.text || "";
              if (text.length - lastReport >= 400) { lastReport = text.length; lastEmitAt = Date.now(); emit({ t: "progress", chars: text.length }); }
            } else if ((evt?.type === "content_block_delta" || evt?.type === "ping") && Date.now() - lastEmitAt > 2_000) {
              if (evt.delta?.type === "thinking_delta") thinkingChars += String(evt.delta.thinking || "").length;
              // 생각하는 동안에도 진행을 알린다(2초에 한 번)
              lastEmitAt = Date.now();
              emit({ t: "progress", chars: text.length, thinking: true });
            } else if (evt?.type === "content_block_delta" && evt.delta?.type === "thinking_delta") {
              thinkingChars += String(evt.delta.thinking || "").length;
            } else if (evt?.type === "message_delta") {
              if (evt.delta?.stop_reason) stopReason = String(evt.delta.stop_reason);
              if (evt.usage?.output_tokens) outputTokens = Number(evt.usage.output_tokens) || outputTokens;
            } else if (evt?.type === "error") {
              throw new Error(String(evt.error?.message || "claude_stream_error"));
            }
          }
        }
        if (stopReason === "refusal") throw new Error("motion_director_refused");
        const usage = { outputTokens, textChars: text.length, thinkingChars };
        if (stopReason === "max_tokens") throw new Error(`motion_director_max_tokens ${JSON.stringify(usage)}`);
        if (body?.mode === "review" && isReviewApproved(text)) {
          emit({ t: "done", stopReason, usage, result: { approved: true, html: null, episode: null, problems: [], fixes: [] } });
        } else {
          emit({ t: "done", stopReason, usage, result: parseMotionDirectorOutput(text, { aspectRatio: input.aspectRatio, prepared }) });
        }
      } catch (e) {
        emit({ t: "error", error: controller.signal.aborted ? "motion_director_timeout" : String((e as any)?.message || e) });
      } finally {
        clearInterval(keepalive);
        clearTimeout(timer);
        if (!closed) { closed = true; try { out.close(); } catch { /* 이미 닫힘 */ } }
      }
    },
    cancel() { controller.abort("client_closed"); clearTimeout(timer); },
  });
  const headers = new Headers(corsHeaders(origin));
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(stream, { status: 200, headers });
};
