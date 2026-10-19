// prototype/functions/api/_shared/publishing-http.ts
// 퍼블리싱 API 공용: 응답 모양, 오류 변환, PC 앱(기기 토큰) 인증.
// 사람 화면은 /api/publishing/* (로그인 세션), PC 앱은 /api/publisher/v1/* (기기 토큰)만 쓴다 — 두 토큰은 서로의 경로를 열지 못한다.
import { PublishingError, publishingDb, authenticateDevice, type PublishingDb } from "./publishing-store";
import { MIN_APP_VERSION, compareVersions } from "./publishing-core.js";

export function send(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** 오류 → 응답. 예상한 오류(PublishingError)는 코드·한국어 설명을, 나머지는 500 으로 숨긴다. */
export function sendError(e: any) {
  if (e instanceof PublishingError) return send({ error: e.code, message: e.message !== e.code ? e.message : undefined }, e.status);
  const neon = e?.neon;
  try { console.error("[publishing]", e?.message || e); } catch { /* noop */ }
  return send({ error: neon ? "publishing_db_error" : "publishing_error", message: String(e?.message || e).slice(0, 300) }, neon ? 503 : 500);
}

export async function readJson(request: Request) {
  return await request.json().catch(() => ({}));
}

export type DeviceAuth = { db: PublishingDb; device: { deviceId: string; userId: string; name: string } };

/**
 * CONTRACT §4.3~4.4: Authorization: Bearer <deviceToken>, X-Publisher-Version.
 * 401 → PC 앱이 "다시 연결" 화면, 426 → 앱 업데이트 필요(minAppVersion 미만).
 * 사람 로그인 토큰은 여기서 통하지 않는다(기기 토큰 표 npt_… 해시로만 찾는다).
 */
export async function authorizeDevice(request: Request, env: any): Promise<DeviceAuth | Response> {
  const version = String(request.headers.get("X-Publisher-Version") || "").trim();
  if (version && compareVersions(version, MIN_APP_VERSION) < 0) {
    return send({ error: "app_update_required", minAppVersion: MIN_APP_VERSION, message: "NK Publisher 를 새 버전으로 업데이트해 주세요." }, 426);
  }
  const m = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(\S+)$/i);
  if (!m) return send({ error: "device_auth_required", message: "PC 연결이 필요해요." }, 401);
  const db = await publishingDb(env);
  const device = await authenticateDevice(db, m[1]);
  if (!device) return send({ error: "device_revoked", message: "연결이 해제됐거나 맞지 않는 기기예요. 다시 연결해 주세요." }, 401);
  return { db, device };
}
