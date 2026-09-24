// prototype/functions/api/agent/chat.ts
// POST /api/agent/chat { message, conversationId? }
// SSE 스트리밍: 에이전트가 발언을 완료하는 즉시 클라이언트에 전송 → 실시간 순차 대화.
import { authorizeRequest } from "../_shared/auth.js";
import { hasPagePermission } from "../_shared/admin-users.js";
import {
  send,
  corsHeaders,
  getSql,
  ensureAgentSchema,
  addMessage,
  getRuntime,
  resolveChatReference,
} from "./_shared";
import { runGroupChat } from "./_orchestrator";

type PagesFunction = (ctx: {
  request: Request;
  env: any;
  waitUntil: (p: Promise<any>) => void;
}) => Promise<Response>;

const sseHeaders = (origin: string | null) => ({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  Vary: "Origin",
});

export const onRequestOptions: PagesFunction = async ({ request }) => {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });
};

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    if (!(await hasPagePermission(env, auth.userId, "ai_company"))) {
      return send({ error: "forbidden", reason: "ai_company" }, 403, origin);
    }

    const sql = getSql(env);
    if (!sql) return send({ error: "DATABASE_URL 미설정 — 대화 저장소(Neon)를 사용할 수 없습니다." }, 503, origin);
    await ensureAgentSchema(sql);

    const body = await request.json().catch(() => ({} as any));
    const message = String(body?.message || "").trim();
    const conversationId = String(body?.conversationId || "main").trim() || "main";
    const focusAgent = String(body?.focusAgent || "").trim(); // 1:1 단독 대화 모드
    // 다중 첨부(images) 우선 파싱, 없으면 단일 레거시 필드(imageBase64)를 배열로 승격.
    const rawImages = Array.isArray(body?.images) ? body.images : [];
    let images = rawImages
      .map((im: any) => ({
        base64: typeof im?.base64 === "string" ? im.base64 : "",
        mimeType: typeof im?.mimeType === "string" && im.mimeType ? im.mimeType : "image/jpeg",
      }))
      .filter((im: { base64: string }) => !!im.base64)
      .slice(0, 10);
    if (!images.length && typeof body?.imageBase64 === "string" && body.imageBase64) {
      images = [{ base64: body.imageBase64, mimeType: typeof body?.imageMimeType === "string" && body.imageMimeType ? body.imageMimeType : "image/jpeg" }];
    }
    const clientNow = typeof body?.clientNow === "string" && body.clientNow ? body.clientNow : undefined; // 브라우저 로컬 현재시각(시간대 포함)
    if (!message && !images.length) return send({ error: "message is required" }, 400, origin);

    // 보고·업무 폴더에서 지목한 항목: 말풍선엔 "📎 참조: …" + 카드, 직원에겐 "[참조 산출물: … jobId=…]" 한 줄.
    const reference = await resolveChatReference(sql, auth.userId, body?.reference).catch(() => null);
    const displayText = message
      + (reference ? (message ? "\n" : "") + `📎 참조: ${reference.label}` : "")
      + (images.length ? (message || reference ? "\n" : "") + "[이미지 첨부됨]" : "");
    // 첨부는 모델 눈에 보일 뿐 아니라 도구가 가리킬 수 있는 이름(attachment:N)으로도 알려준다.
    const attachLine = images.length
      ? `[첨부 이미지 ${images.length}장: ${images.map((_: any, i: number) => `attachment:${i + 1}`).join(", ")} — 이 그림을 고치거나 첫 프레임으로 쓰려면 image_edit·video 의 imageUrl 에 이 이름을 그대로 넣는다]`
      : "";
    const modelText = [displayText, reference?.line || "", attachLine].filter(Boolean).join("\n");
    const userMsg = await addMessage(sql, {
      userId: auth.userId, conversationId, role: "user", text: displayText,
      files: reference?.files?.length ? reference.files : undefined,
    });

    const rt = await getRuntime(sql, auth.userId).catch(() => ({ workMode: "on", autonomous: false }));
    if (rt.workMode === "off") {
      const restMsg = await addMessage(sql, {
        userId: auth.userId, conversationId, role: "agent", agentId: "core", name: "코어",
        text: "지금은 모두 휴식 중이에요. 🌙 출근시키면 다시 일을 시작할게요.",
      }).catch(() => null);
      const sseBody = [
        restMsg ? `data: ${JSON.stringify({ type: "msg", msg: restMsg })}\n\n` : "",
        `data: ${JSON.stringify({ type: "done", conversationId, resting: true })}\n\n`,
      ].join("");
      return new Response(sseBody, { headers: sseHeaders(origin) });
    }

    const authHeader = String(request.headers.get("Authorization") || "");
    // 첨부 이미지를 도구도 쓸 수 있게 컨텍스트에 싣는다("attachment:N").
    const toolCtx = { request, env, authHeader, userId: auth.userId, conversationId, attachments: images };

    // TransformStream: SSE 이벤트를 writer에 쓰고 readable을 Response body로 반환.
    // 에이전트가 발언을 완료할 때마다 onMessage 콜백 → SSE 즉시 전송 → 실시간 순차 대화.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const sse = async (data: any) => {
      try { await writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
    };

    const streamWork = (async () => {
      try {
        await runGroupChat(env, {
          sql, userId: auth.userId, conversationId, toolCtx,
          firstMessage: modelText, focusAgent: focusAgent || undefined, images, clientNow,
          onMessage: (msg: any) => sse({ type: "msg", msg }),
          onJobReady: (payload?: any) => sse({ type: "job_ready", payload }),
          onUiAction: (action: any) => sse({ type: "ui_action", action }),
        });
        await sse({ type: "done", conversationId, userMessageId: userMsg.id });
      } catch (e: any) {
        const errMsg = await addMessage(sql, {
          userId: auth.userId, conversationId, role: "agent", agentId: "core", name: "코어",
          text: `⚠️ 응답 생성 중 문제가 생겼어요: ${String(e?.message || e)}`,
        }).catch(() => null);
        if (errMsg) await sse({ type: "msg", msg: errMsg });
        await sse({ type: "done", conversationId, userMessageId: userMsg.id });
      } finally {
        try { writer.close(); } catch {}
      }
      // 응답을 다 보낸 뒤, 밀린 회사 지식 색인(의미 벡터 등)을 '별도 요청'으로 채운다.
      // 이 대화 요청 안에서 하면 DB·임베딩 호출이 대화의 서브요청 한도(무료 플랜 50번)를 함께 깎는다. 호출 1번만 쓰고 넘긴다.
      try {
        await fetch(new URL("/api/agent/knowledge-index", request.url).toString(), {
          method: "POST",
          headers: { Authorization: String(request.headers.get("Authorization") || "") },
        });
      } catch {}
    })();

    // readable 스트림이 연결을 유지하고, waitUntil이 CF 함수 수명도 연장한다.
    waitUntil(streamWork);

    return new Response(readable, { headers: sseHeaders(origin) });
  } catch (e: any) {
    return send({ error: e?.message || "대화 처리 중 오류" }, 500, origin);
  }
};
