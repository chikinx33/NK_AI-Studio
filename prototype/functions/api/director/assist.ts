// POST /api/director/assist — 디렉터 단계 화면(B)의 Claude 단발 호출.
// body: { op: conti|prompt|patch|review, sequence, context?, take?, cutIds?, problem?, qa?, frames?[], frameTimes?[] }
// 응답: text/event-stream — data: {"t":"delta","text"} … data: {"t":"done","text","result"?,"stopReason"} | {"t":"error","error"}
//
// 대화형 디렉터(A, Managed Agents)와 달리 에이전트 세션 없이 한 번 부르고 끝난다.
// 인증은 스튜디오 규칙(studioAuth): 소유자는 구독 토큰, 회원은 본인 자격증명(미등록이면 마스터 키).
// 응답을 흘려 보내므로 긴 생성도 연결이 살아 있는 동안 끝까지 받는다.
import { authorizeRequest } from "../_shared/auth.js";
import { buildClaudeSystem, claudeFetch, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "../_shared/claude-auth.js";
import { isCreditExhausted } from "../_shared/credit-exhausted.js";
import {
  ASSIST_MAX_TOKENS, ASSIST_MODEL, ASSIST_OPS, buildAssistPrompt, finishAssist, frameBlocks,
} from "../_shared/director-assist.js";
import { corsHeaders, send } from "../agent/_shared";

const MAX_BODY_CHARS = 12 * 1024 * 1024;
const TIMEOUT_MS = 240_000;

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const who = await authorizeRequest(request, env);
  if (!who.ok) return send({ error: who.error }, who.status, origin);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) return send({ error: "body_too_large" }, 413, origin);
  let body: any;
  try { body = JSON.parse(rawBody || "{}"); } catch { return send({ error: "invalid_json" }, 400, origin); }
  const op = String(body?.op || "");
  if (!ASSIST_OPS.includes(op)) return send({ error: "unknown_assist_op" }, 400, origin);
  if (!body?.sequence || typeof body.sequence !== "object") return send({ error: "sequence_required" }, 400, origin);

  let auth: any;
  try {
    auth = await studioAuth(env, who.userId);
  } catch (e) {
    if (isClaudeAuthRequired(e)) return send({ error: CLAUDE_AUTH_REQUIRED }, 412, origin);
    return send({ error: String((e as any)?.message || e) }, 500, origin);
  }

  let prompt: { system: string; user: string; effort: string };
  try { prompt = buildAssistPrompt(op, body); } catch (e) { return send({ error: String((e as any)?.message || e) }, 400, origin); }
  const content: any[] = op === "review" ? [...frameBlocks(body?.frames), { type: "text", text: prompt.user }] : [{ type: "text", text: prompt.user }];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("assist_timeout"), TIMEOUT_MS);
  let res: Response;
  try {
    res = await claudeFetch(env, auth, (sub: boolean) => ({
      model: ASSIST_MODEL,
      max_tokens: ASSIST_MAX_TOKENS,
      output_config: { effort: prompt.effort },
      system: buildClaudeSystem(sub, prompt.system),
      messages: [{ role: "user", content }],
      stream: true,
    }), { signal: controller.signal });
  } catch (e) {
    clearTimeout(timer);
    return send({ error: controller.signal.aborted ? "assist_timeout" : String((e as any)?.message || e) }, 500, origin);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const raw = await res.text().catch(() => "");
    if (isCreditExhausted(raw, res.status)) return send({ error: "CREDIT_EXHAUSTED" }, 402, origin);
    return send({ error: `Claude ${res.status}: ${raw.slice(0, 300)}` }, 500, origin);
  }

  const encoder = new TextEncoder();
  const upstream = res.body.getReader();
  const stream = new ReadableStream({
    async start(out) {
      const emit = (obj: any) => out.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const decoder = new TextDecoder();
      let buf = "";
      let text = "";
      let stopReason = "";
      try {
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
              emit({ t: "delta", text: evt.delta.text || "" });
            } else if (evt?.type === "message_delta" && evt.delta?.stop_reason) {
              stopReason = String(evt.delta.stop_reason);
            } else if (evt?.type === "error") {
              throw new Error(String(evt.error?.message || "claude_stream_error"));
            }
          }
        }
        if (stopReason === "refusal") throw new Error("assist_refused");
        if (stopReason === "max_tokens") throw new Error("assist_max_tokens");
        emit({ t: "done", text, stopReason, result: finishAssist(op, text, body) });
      } catch (e) {
        emit({ t: "error", error: controller.signal.aborted ? "assist_timeout" : String((e as any)?.message || e), text });
      } finally {
        clearTimeout(timer);
        out.close();
      }
    },
    cancel() { controller.abort("client_closed"); clearTimeout(timer); },
  });
  const headers = new Headers(corsHeaders(origin));
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(stream, { status: 200, headers });
};
