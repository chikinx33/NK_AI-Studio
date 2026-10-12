// 세션 이벤트를 화면(SSE)으로 중계한다. 끊겼다 다시 붙어도 놓친 이벤트가 없도록
// "스트림 먼저 열기 → 기록 조회 → ID 로 중복 제거" 순서(공식 재연결 패턴)를 따른다.
import type { ServerResponse } from "node:http";
import { anthropic } from "../anthropic.js";
import { site } from "../site.js";
import { mapEvent, isPendingApproval, type ClientEvent } from "./events.js";
import { quoteInputFor, PAID_TOOLS } from "../mcp/tools.js";
import { listCostCents, settleUsage, type Caller } from "./sessions.js";

const HEARTBEAT_MS = 15_000;
const SETTLE_MIN_INTERVAL_MS = 20_000;

function write(res: ServerResponse, ev: ClientEvent | { type: string; [k: string]: any }) {
  res.write(`data: ${JSON.stringify(ev)}\n\n`);
}

async function approvalEvent(caller: Caller, ev: any): Promise<ClientEvent> {
  const tool = String(ev.name || "");
  let quote: any;
  const q = PAID_TOOLS.has(tool) ? quoteInputFor(tool, ev.input) : null;
  if (q) {
    quote = await site("/api/credits/quote", { token: caller.token, body: q, timeoutMs: 20_000 }).catch((e) => ({ error: String(e?.message || e) }));
  }
  return { type: "approval_request", eventId: ev.id, tool, input: ev.input, quote };
}

export async function relaySession(caller: Caller, session: any, res: ServerResponse, signal: AbortSignal) {
  const sessionId = session.id;
  const isOwner = session.metadata?.isOwner === "1";
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);
  const seen = new Set<string>();
  let lastSettle = 0;

  const settle = async (force: boolean) => {
    if (!force && Date.now() - lastSettle < SETTLE_MIN_INTERVAL_MS) return;
    lastSettle = Date.now();
    const fresh: any = await anthropic.beta.sessions.retrieve(sessionId).catch(() => null);
    const cents = listCostCents(fresh?.usage);
    const r = await settleUsage(caller, sessionId, cents).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    write(res, { type: "usage", listCostCents: cents, charged: r?.charged, available: r?.summary?.available ?? r?.available, owner: isOwner });
    if (r && r.insufficient) {
      write(res, { type: "notice", level: "error", text: "크레딧이 부족해 디렉터를 멈췄습니다. 충전 후 다시 이어서 진행해 주세요." });
      await anthropic.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" } as any] }).catch(() => null);
    }
  };

  const handle = async (ev: any) => {
    if (ev?.id && ev.type !== "event_start" && ev.type !== "event_delta") {
      if (seen.has(ev.id)) return;
      seen.add(ev.id);
    }
    for (const out of mapEvent(ev)) write(res, out);
    if (isPendingApproval(ev)) write(res, await approvalEvent(caller, ev));
    if (ev?.type === "session.usage") await settle(false);
    if (ev?.type === "session.status_idle" || ev?.type === "session.status_terminated") await settle(true);
  };

  try {
    // 1) 스트림을 먼저 연다(이후 이벤트를 놓치지 않게).
    const stream = await anthropic.beta.sessions.events.stream(sessionId, { event_deltas: ["agent.message", "agent.thinking"] }, { signal });
    // 2) 기록을 보내 화면을 복원하고, 아직 승인 대기 중인 호출이 있으면 다시 승인 카드를 띄운다.
    const history: any[] = [];
    for await (const ev of anthropic.beta.sessions.events.list(sessionId, { limit: 1000 } as any)) history.push(ev);
    write(res, { type: "history_start", count: history.length });
    const resolved = new Set(history.filter((e) => e.type === "user.tool_confirmation").map((e) => String(e.tool_use_id)));
    for (const ev of history) {
      if (ev?.id) seen.add(ev.id);
      for (const out of mapEvent(ev)) write(res, out);
    }
    const fresh: any = await anthropic.beta.sessions.retrieve(sessionId);
    write(res, { type: "history_end", status: fresh.status, title: fresh.title });
    for (const ev of history) if (isPendingApproval(ev) && !resolved.has(ev.id)) write(res, await approvalEvent(caller, ev));
    await settle(true);
    // 3) 실시간 이벤트.
    for await (const ev of stream) {
      if (signal.aborted) break;
      await handle(ev);
    }
  } catch (e: any) {
    if (!signal.aborted) write(res, { type: "notice", level: "error", text: `스트림이 끊겼습니다: ${String(e?.message || e).slice(0, 200)} — 자동으로 다시 연결합니다.` });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
}
