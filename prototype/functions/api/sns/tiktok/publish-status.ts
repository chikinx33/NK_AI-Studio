/**
 * GET /api/sns/tiktok/publish-status?publishId=...
 *
 * 게시 요청과 상태 확인을 분리하기 위한 엔드포인트다.
 *
 * publish_id 가 나온 시점에 TikTok 은 이미 발행을 수락했지만, 실제 처리는 비동기라
 * 완료까지 수 분이 걸릴 수 있다. 그걸 게시 요청 안에서 기다리면 Cloudflare Functions
 * 실행 제한(약 30초)을 넘겨 응답 자체를 잃고, 실제로는 게시됐는데 사용자에게는
 * 실패로 보이는 상태가 된다(실제로 그렇게 동작했다).
 *
 * 그래서 게시 요청은 수락 즉시 반환하고, 완료 여부는 브라우저가 이 엔드포인트를
 * 짧게 폴링해서 확인한다. 브라우저 폴링에는 실행 제한이 없다.
 */
import { authorizeRequest, sanitizeUserId } from "../../_shared/auth.js";
import { loadShares, getGrantRole } from "../../_shared/shares";
import { getTikTokAccessToken } from "../../_shared/tiktok-token";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  const url = new URL(request.url);
  const publishId = String(url.searchParams.get("publishId") || "").trim();
  if (!publishId) return send({ ok: false, error: "publishId required" }, 400);

  // 공유 프로젝트는 소유자 자격증명으로 게시되므로 상태도 소유자 토큰으로 조회한다.
  let targetUserId = auth.userId;
  const reqOwnerId = sanitizeUserId(url.searchParams.get("ownerId") || "");
  const reqProjectId = String(url.searchParams.get("projectId") || "").trim();
  if (reqOwnerId && reqOwnerId !== auth.userId) {
    if (!reqProjectId) return send({ ok: false, error: "projectId required for shared publish" }, 400);
    const sharesReg = await loadShares(env);
    const role = getGrantRole(sharesReg, reqOwnerId, reqProjectId, auth.userId);
    if (role !== "editor") return send({ ok: false, error: "forbidden" }, 403);
    targetUserId = reqOwnerId;
  }

  try {
    const { accessToken } = await getTikTokAccessToken(env, targetUserId);
    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const body = (await res.json()) as {
      // TikTok 응답 필드명의 오타(publicaly)는 그쪽 스펙 그대로다.
      data?: { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> };
      error?: { code?: string; message?: string };
    };
    console.log(`[tiktok] publish-status (${res.status}):`, JSON.stringify(body.data || body.error || {}));

    const raw = String(body.data?.status || "");
    const ids = body.data?.publicaly_available_post_id;
    const postId = Array.isArray(ids) && ids.length ? String(ids[0]) : "";

    // 초안함 업로드는 "사용자 inbox 로 전달"이 완료 상태다.
    const complete = raw === "PUBLISH_COMPLETE" || raw === "SEND_TO_USER_INBOX";
    // FAILED 라도 실제로는 게시된 사례가 반복 확인됐다. 실패로 단정하지 않고
    // 사유만 전달한다 — 사용자가 TikTok 에서 직접 확인하도록.
    const failed = raw === "FAILED";

    return send({
      ok: true,
      publishId,
      status: complete ? "complete" : (failed ? "failed" : "processing"),
      rawStatus: raw,
      failReason: body.data?.fail_reason || undefined,
      postId: postId || undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("[tiktok/publish-status] 실패:", message);
    if (message.startsWith("tiktok_not_connected") || message.startsWith("tiktok_reconnect_required")) {
      return send({ ok: false, error: "tiktok_reconnect_required" }, 412);
    }
    return send({ ok: false, error: message }, 502);
  }
};
