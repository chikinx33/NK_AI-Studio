// prototype/functions/api/director/_shared.ts
// NK 디렉터(Cloud Run nk-director) 전용 엔드포인트 공용 도구.
// 디렉터 서비스만 아는 공유 비밀(DIRECTOR_SERVICE_SECRET)과 사용자 세션 토큰을 함께 확인한다.
import { authorizeRequest } from "../_shared/auth.js";

export type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export const DIRECTOR_SECRET_HEADER = "x-nk-director-secret";

export function cors(origin: string | null, methods = "GET, POST, OPTIONS"): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": `Authorization, Content-Type, ${DIRECTOR_SECRET_HEADER}`,
    "Access-Control-Allow-Methods": methods,
    "Cache-Control": "no-store",
  };
}

export function send(data: any, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

/** 길이와 무관하게 같은 시간이 걸리는 비교(비밀값 추측 방지). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** 디렉터 서비스가 보낸 요청인가. 서버에 비밀이 없으면 기능 전체를 닫는다(열어 두지 않는다). */
export async function isDirectorService(request: Request, env: any): Promise<boolean> {
  const expected = String(env?.DIRECTOR_SERVICE_SECRET || "").trim();
  const got = String(request.headers.get(DIRECTOR_SECRET_HEADER) || "").trim();
  if (!expected || !got) return false;
  return sameSecret(got, expected);
}

/**
 * 사용자 토큰 + (선택) 디렉터 서비스 비밀을 확인한다.
 * requireService=true 면 디렉터 서비스가 아닌 호출(브라우저 등)은 403.
 */
export async function directorAuth(request: Request, env: any, requireService: boolean):
  Promise<{ ok: true; userId: string; service: boolean } | { ok: false; response: Response }> {
  const origin = request.headers.get("Origin");
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return { ok: false, response: send({ error: auth.error }, auth.status, origin) };
  const service = await isDirectorService(request, env);
  if (requireService && !service) return { ok: false, response: send({ error: "director_service_only" }, 403, origin) };
  return { ok: true, userId: auth.userId, service };
}

export const onOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: cors(request.headers.get("Origin")) });
