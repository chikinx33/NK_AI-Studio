// prototype/functions/api/agent/_turn-handoff.ts
// 대화 한 턴을 '새 요청'으로 넘겨 이어서 실행하기 위한 도구들.
//
// Cloudflare 무료 플랜은 요청(Worker 호출) 1번에 서브요청을 50번까지만 허용한다. Neon 쿼리 1번,
// 모델 호출 1번, 웹 검색 1번이 모두 1번씩이다. 레이더처럼 조회 → 결과 정리 → 후속 조회를 연쇄로
// 하면 한 요청 안에서 이 한도를 넘는데, 넘는 순간부터는 DB 저장도 막혀 실패 안내조차 못 남긴다.
// 화면에는 "🔎 web_fetch 조회 중이에요…" 가 마지막 말로 남고 그대로 멈춘다(2026-10-13).
//
// 그래서 ① 이 요청이 서브요청을 몇 번 썼는지 세고 ② 다음 단계를 감당할 여유가 없으면 그 단계를
// 미뤄 두었다가 ③ 같은 스트림 안에서 새 요청(새 50번)으로 넘겨 이어서 실행한다.
import { readSecret } from "../_shared/auth.js";

export const SUBREQUEST_LIMIT = 50;

// 전역 fetch 를 한 번 감싸 이 격리 공간(isolate)의 호출 수를 센다. 요청마다 시작 시점 값을 빼서 쓴다.
// 같은 격리 공간에서 다른 요청이 동시에 돌면 그 호출까지 더해져 '많게' 세어질 수는 있어도 적게
// 세어지지는 않는다 — 넘겨주기가 조금 일찍 일어날 뿐 한도를 넘지는 않는다.
let isolateFetchCount = 0;
let counterInstalled = false;
function installFetchCounter(): void {
  if (counterInstalled) return;
  counterInstalled = true;
  const base = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    isolateFetchCount += 1;
    return base(...args);
  }) as typeof fetch;
}

export interface SubrequestBudget {
  used: () => number;
  left: () => number;
}

/** 요청 처리 맨 앞에서 부른다. 그 뒤의 모든 fetch(=DB 쿼리 포함)를 이 요청 몫으로 센다. */
export function startSubrequestBudget(limit = SUBREQUEST_LIMIT): SubrequestBudget {
  installFetchCounter();
  const startAt = isolateFetchCount;
  return {
    used: () => isolateFetchCount - startAt,
    left: () => limit - (isolateFetchCount - startAt),
  };
}

// ── 이어서 할 일(미룬 단계) ─────────────────────────────────────────────
// tool+reason: 미룬 조회 도구 / instruction: 미룬 직원 위임.
export type DeferredRun = { agentId: string; tool?: string; reason?: string; instruction?: string };

// 넘겨주기 연쇄 상한. 단계마다 최소 하나는 진행하므로 정상이라면 여기까지 오지 않는다.
export const MAX_HANDOFF_HOPS = 4;
const RESUME_TTL_MS = 10 * 60 * 1000;

interface ResumeClaims {
  userId: string;
  conversationId: string;
  runs: DeferredRun[];
  hop: number;
  exp: number;
}

const enc = new TextEncoder();
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
async function hmac(env: any, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(`agent-resume:${readSecret(env)}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/**
 * 미룬 단계를 서버 서명 토큰으로 만든다. 브라우저가 임의 도구 실행을 끼워 넣을 수 없게,
 * 이 서버가 만든 이어하기만 받아들인다(사용자·대화·만료 시각까지 서명에 묶는다).
 */
export async function signResume(env: any, claims: Omit<ResumeClaims, "exp">): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ ...claims, exp: Date.now() + RESUME_TTL_MS })));
  return `${body}.${await hmac(env, body)}`;
}

export async function verifyResume(env: any, token: string, userId: string, conversationId: string): Promise<ResumeClaims | null> {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  if ((await hmac(env, body)) !== sig) return null;
  let claims: ResumeClaims;
  try { claims = JSON.parse(fromB64url(body)); } catch { return null; }
  if (claims.userId !== userId || claims.conversationId !== conversationId) return null;
  if (!(Number(claims.exp) > Date.now())) return null;
  if (!Array.isArray(claims.runs) || !claims.runs.length) return null;
  return claims;
}

/**
 * 새 요청으로 이어서 실행하고, 그 요청의 SSE 이벤트를 지금 스트림으로 그대로 흘려보낸다
 * (새 요청의 done 은 빼고 — 마무리 done 은 호출한 쪽이 한 번만 보낸다).
 * 반환: 이어받은 요청이 정상 종료(done)까지 갔는지.
 */
export async function continueInFreshRequest(
  request: Request,
  payload: Record<string, unknown>,
  forward: (event: any) => Promise<void>,
): Promise<boolean> {
  const res = await fetch(new URL("/api/agent/chat", request.url).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: String(request.headers.get("Authorization") || "") },
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) throw new Error(`이어서 실행 요청 실패 (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let event: any;
      try { event = JSON.parse(line.slice(6)); } catch { continue; }
      if (event?.type === "done") return true;
      if (event?.type === "ping") continue;
      await forward(event);
    }
  }
  return false;
}
