// Neon(HTTP SQL) 오류를 사람이 읽는 문구로. 코드는 괄호에 남긴다.
// 전엔 "Neon SQL 오류 520: error code: 520" 처럼 그대로 화면에 떠서 사용자가 "용량이 찼나?" 를 추측해야 했다(2026-09-24).

export interface NeonErrorInfo { status: number; code: string; raw: string; kind: "transient" | "quota" | "auth" | "rate" | "bad_request" | "unknown"; message: string }

function bodyMessage(body: string): string {
  try {
    const d = JSON.parse(body);
    if (d && typeof d === "object") {
      if (typeof d.message === "string" && d.message) return d.message;
      if (typeof d.error === "string" && d.error) return d.error;
      if (d.error && typeof d.error.message === "string") return d.error.message;
    }
  } catch { /* 본문이 JSON 이 아님 */ }
  return String(body || "").trim();
}

export function describeNeonError(status: number, body: string): NeonErrorInfo {
  const raw = bodyMessage(body).slice(0, 300);
  const lower = raw.toLowerCase();
  const code = String(status);
  const tail = raw && !/^error code:\s*\d+$/i.test(raw) ? ` — ${raw}` : "";
  if (/quota|limit exceeded|exceeded (the )?(compute|data transfer|storage)|over the .*limit|suspended/.test(lower)) {
    return { status, code, raw, kind: "quota",
      message: `데이터베이스 사용량 한도를 넘겼어요 (Neon 코드 ${code})${tail}. 네온 대시보드에서 Compute·Network transfer 를 확인하고 요금제를 올리거나 다음 결제 주기까지 기다려야 해요.` };
  }
  if (status === 401 || status === 403) {
    return { status, code, raw, kind: "auth",
      message: `데이터베이스 인증에 실패했어요 (Neon 코드 ${code})${tail}. 서버의 DATABASE_URL 설정을 확인해야 해요.` };
  }
  if (status === 429) {
    return { status, code, raw, kind: "rate",
      message: `데이터베이스 요청이 너무 잦아 잠시 거절됐어요 (Neon 코드 429)${tail}. 몇 초 뒤 다시 시도돼요.` };
  }
  if (status >= 500) {
    return { status, code, raw, kind: "transient",
      message: `데이터베이스가 잠시 응답하지 않았어요 (Neon 일시 오류 · 코드 ${code})${tail}. 컴퓨트가 깨어나는 중이거나 연결이 순간 끊긴 거라 잠시 뒤 자동으로 다시 시도돼요. 계속되면 네온 대시보드의 사용량을 확인해 주세요.` };
  }
  if (status === 400) {
    return { status, code, raw, kind: "bad_request",
      message: `데이터베이스 요청이 잘못됐어요 (Neon 코드 400)${tail}. 이건 서버 코드 문제라 개발 쪽에서 고쳐야 해요.` };
  }
  return { status, code, raw, kind: "unknown", message: `데이터베이스 오류 (Neon 코드 ${code})${tail}` };
}

/** 문구만 필요할 때. */
export function neonErrorMessage(status: number, body: string): string {
  return describeNeonError(status, body).message;
}
