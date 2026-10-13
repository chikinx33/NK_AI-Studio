// nk-director HTTP 서버 (Cloud Run).
//   GET  /                               헬스체크(Cloud Run 은 /healthz 를 Google Frontend 가 가로챈다)
//   GET  /v1/me                          사용자·소유자 여부·잔액
//   GET  /v1/projects/:pid/sessions      프로젝트의 디렉터 세션 목록
//   POST /v1/sessions                    { projectId, title?, ownerId? } 새 세션
//   GET  /v1/sessions/:id/stream         SSE(기록 복원 + 실시간)
//   POST /v1/sessions/:id/messages       { text, images?: [{mediaType, data}] }
//   POST /v1/sessions/:id/confirm        { eventId, allow, message? }
//   POST /v1/sessions/:id/answer         { eventId, answers: [{question, choices[], other?, skipped?}], cancelled? }  버튼 질문(ask_user) 답
//   POST /v1/sessions/:id/interrupt
//   POST /v1/qa                          { videoPath, cuts?: number[] } 자동 검수(qa_video.py) — 단계 화면·대화 공용
//   POST /mcp                            에이전트 도구(MCP Streamable HTTP, 위임 토큰)
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { config } from "./config.js";
import { SiteError, whoAmI } from "./site.js";
import { buildMcpServer } from "./mcp/tools.js";
import { loadState } from "./gateway/state.js";
import { answerQuestion, confirmTool, createSession, interrupt, ownedSession, sendMessage, type Caller } from "./gateway/sessions.js";
import { relaySession } from "./gateway/stream.js";
import { runQa } from "./qa.js";

const MAX_BODY = 48 * 1024 * 1024; // 이미지 첨부(최대 10장 × 4MB base64)

function cors(req: IncomingMessage): Record<string, string> {
  const origin = String(req.headers.origin || "");
  const allowed = config.allowedOrigins.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return allowed ? {
    "Access-Control-Allow-Origin": origin, Vary: "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400",
  } : {};
}

function send(req: IncomingMessage, res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req) });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new SiteError(413, { error: "body_too_large" });
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new SiteError(400, { error: "invalid_json" }); }
}

function bearer(req: IncomingMessage): string {
  const h = String(req.headers.authorization || "");
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

// 토큰 확인 결과를 잠깐 기억한다(같은 화면이 연달아 부를 때 사이트 왕복을 줄인다). 잔액은 매번 새로 받지 않아도 된다.
const callerCache = new Map<string, { at: number; caller: Caller }>();
async function authCaller(req: IncomingMessage): Promise<Caller> {
  const token = bearer(req);
  if (!token) throw new SiteError(401, { error: "unauthorized" });
  const key = createHash("sha256").update(token).digest("hex");
  const hit = callerCache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.caller;
  const who = await whoAmI(token);
  const caller = { token, userId: who.userId, available: who.available };
  callerCache.set(key, { at: Date.now(), caller });
  if (callerCache.size > 2000) callerCache.clear();
  return caller;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse) {
  const token = bearer(req);
  if (!token) { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "unauthorized" })); return; }
  // 무상태 모드: 요청마다 서버·전송을 새로 만든다(인스턴스가 여러 개여도 세션 고정이 필요 없다).
  const server = buildMcpServer(token);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  const body = req.method === "POST" ? await readJson(req) : undefined;
  await transport.handleRequest(req, res, body);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://local");
  const path = url.pathname;
  if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); res.end(); return; }
  if (path === "/" && req.method === "GET") return send(req, res, 200, { ok: true, service: "nk-director" });
  if (path === "/mcp") return handleMcp(req, res);

  const caller = await authCaller(req);
  if (path === "/v1/me" && req.method === "GET") {
    return send(req, res, 200, { userId: caller.userId, available: caller.available });
  }
  if (path === "/v1/qa" && req.method === "POST") {
    return send(req, res, 200, await runQa(caller.token, await readJson(req)));
  }
  let m = /^\/v1\/projects\/([A-Za-z0-9._-]{1,64})\/sessions$/.exec(path);
  if (m && req.method === "GET") {
    const state = await loadState(caller.token);
    return send(req, res, 200, { sessions: state.projects?.[m[1]]?.sessions || [] });
  }
  if (path === "/v1/sessions" && req.method === "POST") {
    const body = await readJson(req);
    return send(req, res, 200, await createSession(caller, String(body.projectId || ""), String(body.title || ""), body.ownerId ? String(body.ownerId) : undefined));
  }
  m = /^\/v1\/sessions\/(sesn_[A-Za-z0-9]+)\/(stream|messages|confirm|answer|interrupt)$/.exec(path);
  if (m) {
    const session = await ownedSession(m[1], caller.userId);
    if (!session) return send(req, res, 404, { error: "session_not_found" });
    if (m[2] === "stream" && req.method === "GET") {
      const ac = new AbortController();
      req.on("close", () => ac.abort());
      Object.entries(cors(req)).forEach(([k, v]) => res.setHeader(k, v));
      return relaySession(caller, session, res, ac.signal);
    }
    if (req.method !== "POST") return send(req, res, 405, { error: "method_not_allowed" });
    const body = await readJson(req);
    if (m[2] === "messages") {
      await sendMessage(caller, session, String(body.text || ""), Array.isArray(body.images) ? body.images : [],
        Array.isArray(body.resolveQuestions) ? body.resolveQuestions.map(String) : []);
      return send(req, res, 202, { ok: true });
    }
    if (m[2] === "answer") {
      await answerQuestion(session, String(body.eventId || ""), Array.isArray(body.answers) ? body.answers : [], body.cancelled === true);
      return send(req, res, 202, { ok: true });
    }
    if (m[2] === "confirm") { await confirmTool(session, String(body.eventId || ""), body.allow === true, body.message); return send(req, res, 202, { ok: true }); }
    if (m[2] === "interrupt") { await interrupt(session); return send(req, res, 202, { ok: true }); }
  }
  return send(req, res, 404, { error: "not_found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e: any) => {
    const status = e instanceof SiteError ? e.status : Number(e?.status) || 500;
    const body = e instanceof SiteError ? e.body : { error: "internal_error", message: String(e?.message || e).slice(0, 500) };
    if (status >= 500) console.error("[director]", req.method, req.url, e);
    if (res.headersSent) { try { res.end(); } catch { /* 이미 닫힘 */ } return; }
    send(req, res, status, typeof body === "object" ? body : { error: String(body) });
  });
});
server.requestTimeout = 0; // SSE 는 오래 열려 있다(Cloud Run 요청 타임아웃이 상한)
server.headersTimeout = 65_000;
server.listen(config.port, () => console.log(`[director] listening on ${config.port}`));
