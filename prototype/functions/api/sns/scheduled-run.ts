// POST /api/sns/scheduled-run — 시각이 된 SNS 예약 건을 게시한다(GitHub Actions 5분 주기, sns-scheduled-publish.yml).
// 회원 정리(users-cleanup)와 같은 운영 토큰(ACCOUNT_CLEANUP_TOKEN)으로만 부를 수 있다.
// 게시는 요청자 권한의 짧은 세션 토큰으로 /api/sns/publish 를 다시 불러 같은 로직 한 벌을 쓴다.
import { issueSessionToken } from "../_shared/auth.js";
import { runDueScheduledPosts } from "../_shared/sns-schedule";

function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export const onRequest = async ({ request, env }: any) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const expected = String(env.ACCOUNT_CLEANUP_TOKEN || "").trim();
  const match = String(request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  const supplied = String(match?.[1] || "").trim();
  if (!expected) return json({ error: "scheduler_not_configured" }, 503);
  if (!supplied || (await sha256(supplied)) !== (await sha256(expected))) return json({ error: "unauthorized" }, 401);

  const publishUrl = new URL("/api/sns/publish", request.url).toString();
  const publish = async (userId: string, body: any) => {
    const issued = await issueSessionToken(userId, env, 10 * 60, { persistent: false });
    const res = await fetch(publishUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${issued.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: `non_json_response_${res.status}` }; }
    return { ok: res.ok, status: res.status, data };
  };

  try {
    const result = await runDueScheduledPosts(env, publish);
    const failed = result.outcomes.filter((o) => o.status !== "done").length;
    // 게시 실패는 그 건의 기록(status=error)으로 사용자에게 보인다. 실행 자체는 성공으로 돌려 다음 주기를 막지 않는다.
    return json({ ...result, failed });
  } catch (error: any) {
    return json({ error: "scheduled_run_crashed", detail: String(error?.message || error).slice(0, 500) }, 500);
  }
};
