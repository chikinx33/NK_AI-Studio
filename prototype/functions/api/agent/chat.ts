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
import { startSubrequestBudget, signResume, verifyResume, continueInFreshRequest, MAX_HANDOFF_HOPS } from "./_turn-handoff";
import { saveChatAttachments } from "./_chat-attachments";

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
  // 인증·권한 확인부터 이 요청의 서브요청으로 센다(CF 무료 플랜 요청당 50번).
  const budget = startSubrequestBudget();
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
    // 이어하기: 앞 요청이 서브요청 여유가 없어 미룬 단계를 새 요청(새 50번)으로 받아 실행한다. 사용자 메시지는 새로 쓰지 않는다.
    const resume = body?.resume ? await verifyResume(env, String(body.resume), auth.userId, conversationId) : null;
    if (body?.resume && !resume) return send({ error: "invalid_resume" }, 400, origin);
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
    if (!resume && !message && !images.length) return send({ error: "message is required" }, 400, origin);

    // 보고·업무 폴더에서 지목한 항목들(여러 개): 말풍선엔 "📎 참조: …" + 카드들, 직원에겐 항목마다 "[참조 산출물: … jobId=…]" 한 줄.
    const rawRefs: any[] = Array.isArray(body?.references) ? body.references.slice(0, 10) : (body?.reference ? [body.reference] : []);
    const references: NonNullable<Awaited<ReturnType<typeof resolveChatReference>>>[] = [];
    for (const raw of rawRefs) {
      const r = await resolveChatReference(sql, auth.userId, raw, { request, env, authHeader: String(request.headers.get("Authorization") || "") }).catch(() => null);
      if (r) references.push(r);
    }
    const reference = references[0] || null;
    const refLabel = references.map((r) => r.label).join(" · ");
    const displayText = message
      + (references.length ? (message ? "\n" : "") + `📎 참조${references.length > 1 ? ` ${references.length}개` : ""}: ${refLabel}` : "")
      + (images.length ? (message || reference ? "\n" : "") + "[이미지 첨부됨]" : "");
    // 첨부는 모델 눈에 보일 뿐 아니라 도구가 가리킬 수 있는 이름(attachment:N)으로도 알려준다.
    const attachLine = images.length
      ? `[첨부 이미지 ${images.length}장: ${images.map((_: any, i: number) => `attachment:${i + 1}`).join(", ")} — 이 그림을 고치거나 첫 프레임으로 쓰려면 image_edit·video 의 imageUrl 에 이 이름을 그대로 넣는다. 폴더에 저장하라면 company_files_save_media 의 attachments:true(또는 files 에 이 이름). 다음 턴에서도 같은 이름이 이 대화의 가장 최근 첨부를 가리킨다]`
      : "";
    const modelText = [displayText, ...references.map((r) => r.line), attachLine].filter(Boolean).join("\n");
    const refFiles = references.flatMap((r) => r.files || []);
    const userMsg = resume ? null : await addMessage(sql, {
      userId: auth.userId, conversationId, role: "user", text: displayText,
      files: refFiles.length ? refFiles : undefined,
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
    // 다음 턴에서도 "attachment:N" 으로 이 그림을 가리킬 수 있게 대화별로 보관한다(응답과 병행).
    if (images.length) {
      waitUntil(saveChatAttachments(env, auth.userId, conversationId, images)
        .catch((e: any) => console.warn(`[agent/chat] 첨부 보관 실패: ${String(e?.message || e)}`)));
    }

    // TransformStream: SSE 이벤트를 writer에 쓰고 readable을 Response body로 반환.
    // 에이전트가 발언을 완료할 때마다 onMessage 콜백 → SSE 즉시 전송 → 실시간 순차 대화.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const sse = async (data: any) => {
      try { await writer.write(enc.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
    };
    // 코어 이름으로 안내를 남긴다. 저장이 막혀도(서브요청 한도·DB 오류) 화면에는 반드시 보낸다 — 조용히 끝나지 않게.
    const sayCore = async (text: string) => {
      const saved = await addMessage(sql, { userId: auth.userId, conversationId, role: "agent", agentId: "core", name: "코어", text }).catch(() => null);
      await sse({ type: "msg", msg: saved || { id: `local-${crypto.randomUUID()}`, role: "agent", agent_id: "core", name: "코어", text, files: [], created_at: new Date().toISOString() } });
    };
    const doneEvent = { type: "done", conversationId, ...(userMsg ? { userMessageId: userMsg.id } : {}) };

    const streamWork = (async () => {
      // 긴 문서 정리(최대 3분)처럼 모델이 오래 생각하는 동안 이벤트가 없으면 중간 프록시·브라우저가 연결을 끊을 수 있다.
      // 15초마다 무해한 ping 이벤트를 흘려 스트림을 살아 있게 한다(클라이언트는 모르는 type 을 무시한다).
      const heartbeat = setInterval(() => { void sse({ type: "ping", t: Date.now() }); }, 15000);
      try {
        const deps = {
          sql, userId: auth.userId, conversationId, toolCtx,
          firstMessage: modelText, focusAgent: focusAgent || undefined, images, clientNow,
          onMessage: (msg: any) => sse({ type: "msg", msg }),
          onJobReady: (payload?: any) => sse({ type: "job_ready", payload }),
          onUiAction: (action: any) => sse({ type: "ui_action", action }),
          subrequestsLeft: budget.left,
        };
        const produced: any = resume
          ? await runGroupChat(env, deps, { resumeRuns: resume.runs })
          : await runGroupChat(env, deps);
        // 시간·서브요청 여유가 없어 미룬 단계는 같은 스트림 안에서 새 요청으로 넘겨 이어서 실행한다.
        // 같은 요청 안에서 다시 돌리면 이미 바닥난 서브요청 한도를 그대로 써서 또 끊긴다(2026-10-13).
        const deferred = Array.isArray(produced?.deferred) ? produced.deferred : [];
        if (deferred.length) {
          const hop = (resume?.hop || 0) + 1;
          if (hop > MAX_HANDOFF_HOPS) {
            await sayCore("⚠️ 이어서 처리할 단계가 많아 여기서 멈췄어요. 이어서 하려면 같은 내용으로 다시 요청해 주세요.");
          } else {
            const token = await signResume(env, { userId: auth.userId, conversationId, runs: deferred, hop });
            const finished = await continueInFreshRequest(request, { conversationId, focusAgent, clientNow, resume: token }, sse)
              .catch((e: any) => { console.warn(`[agent/chat] 이어서 실행 실패: ${String(e?.message || e)}`); return false; });
            if (!finished) await sayCore("⚠️ 이어서 진행하던 작업이 중간에 끊겼어요. 같은 내용으로 다시 요청하시면 이어서 할게요.");
          }
        }
        await sse(doneEvent);
      } catch (e: any) {
        await sayCore(`⚠️ 응답 생성 중 문제가 생겼어요: ${String(e?.message || e)}`);
        await sse(doneEvent);
      } finally {
        clearInterval(heartbeat);
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
