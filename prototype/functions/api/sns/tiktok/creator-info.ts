/**
 * GET /api/sns/tiktok/creator-info
 *
 * Direct Post 확인 모달이 열릴 때 호출된다. TikTok 은 Direct Post 승인 조건으로
 * (a) 크리에이터 닉네임 표시 (b) creator_info 가 돌려준 공개범위만 선택지로 노출
 * (c) 댓글/듀엣/스티치 가용 여부 반영 (d) 상업적 콘텐츠 고지 를 요구하므로,
 * 그 화면을 그릴 재료를 한 번에 내려준다.
 *
 * 공유받은 프로젝트로 게시하는 경우 게시에 쓰이는 자격증명은 소유자 것이므로,
 * 모달에 표시되는 계정도 소유자 계정이어야 한다 → ownerId/projectId 를 받아
 * publish.ts 와 동일한 editor 권한 검증을 거친 뒤 소유자 연결을 조회한다.
 */
import { authorizeRequest, sanitizeUserId } from "../../_shared/auth.js";
import { loadShares, getGrantRole } from "../../_shared/shares";
import {
  getTikTokAccessToken,
  queryTikTokCreatorInfo,
  normalizeCreatorInfo,
  isTikTokAppAudited,
} from "../../_shared/tiktok-token";

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
  let targetUserId = auth.userId;
  const reqOwnerId = sanitizeUserId(url.searchParams.get("ownerId") || "");
  const reqProjectId = String(url.searchParams.get("projectId") || "").trim();
  if (reqOwnerId && reqOwnerId !== auth.userId) {
    if (!reqProjectId) return send({ error: "projectId required for shared publish" }, 400);
    const sharesReg = await loadShares(env);
    const role = getGrantRole(sharesReg, reqOwnerId, reqProjectId, auth.userId);
    if (role !== "editor") return send({ error: "forbidden: editor role required to publish" }, 403);
    targetUserId = reqOwnerId;
  }

  try {
    const { accessToken, record } = await getTikTokAccessToken(env, targetUserId);
    const { data } = await queryTikTokCreatorInfo(accessToken);
    const info = normalizeCreatorInfo(data, isTikTokAppAudited(env));
    return send({
      ok: true,
      ...info,
      // creator_info 가 닉네임을 비워 보내는 계정이 있어 연결 시 저장한 값으로 보완한다.
      creatorNickname: info.creatorNickname || String(record?.displayName || record?.username || ""),
      creatorUsername: info.creatorUsername || String(record?.username || ""),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log("[tiktok/creator-info] 실패:", message);
    // 명세 §3: 미연결·토큰 만료는 412, TikTok API 실패는 502.
    if (
      message.startsWith("tiktok_not_connected") ||
      message.startsWith("tiktok_reconnect_required") ||
      message.startsWith("tiktok_refresh_failed")
    ) {
      return send({ ok: false, error: "tiktok_reconnect_required" }, 412);
    }
    return send({ ok: false, error: "creator_info_unavailable", detail: message }, 502);
  }
};
