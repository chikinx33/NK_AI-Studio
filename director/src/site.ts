// nkstudio.org 사이트 API 호출. 사용자 권한은 사용자 토큰(브라우저 토큰 또는 7일 위임 토큰)으로,
// 디렉터 전용 엔드포인트는 공유 비밀 헤더를 함께 보낸다.
import { config } from "./config.js";

export class SiteError extends Error {
  constructor(public status: number, public body: any, message?: string) {
    super(message || `site ${status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 300)}`);
  }
}

export interface SiteCall {
  token: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** 디렉터 전용 엔드포인트(/api/director/delegate·charge·state 쓰기)면 true */
  service?: boolean;
  timeoutMs?: number;
  idempotencyKey?: string;
}

export async function site<T = any>(path: string, call: SiteCall): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${call.token}` };
  if (call.body !== undefined) headers["Content-Type"] = "application/json";
  if (call.service) headers["x-nk-director-secret"] = config.serviceSecret;
  if (call.idempotencyKey) headers["X-NK-Idempotency-Key"] = call.idempotencyKey;
  const res = await fetch(`${config.siteBase}${path}`, {
    method: call.method || (call.body === undefined ? "GET" : "POST"),
    headers,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
    signal: AbortSignal.timeout(call.timeoutMs ?? 60_000),
  });
  const text = await res.text();
  let data: any = text;
  try { data = text ? JSON.parse(text) : {}; } catch { /* 본문이 JSON 이 아님 */ }
  if (!res.ok) throw new SiteError(res.status, data);
  return data as T;
}

/** 사이트 토큰 → 사용자 ID·크레딧 잔액. 토큰 검증도 겸한다. */
export async function whoAmI(token: string): Promise<{ userId: string; available: number }> {
  const data = await site<any>("/api/credits/me", { token, timeoutMs: 15_000 });
  const userId = String(data?.summary?.userId || "");
  if (!userId) throw new SiteError(401, data, "unauthorized");
  return { userId, available: Number(data?.summary?.available) || 0 };
}
