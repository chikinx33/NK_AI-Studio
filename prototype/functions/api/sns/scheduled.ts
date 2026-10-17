// GET  /api/sns/scheduled?ids=a,b  — 본인 SNS 예약 건 상태(배포 화면이 '예약됨' 기록을 갱신할 때 쓴다)
// POST /api/sns/scheduled {action:'cancel', id} — 아직 시작 전인 예약 취소
import { authorizeRequest } from "../_shared/auth.js";
import { listScheduledPosts, cancelScheduledPost } from "../_shared/sns-schedule";

function send(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const onRequestGet = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    const ids = String(new URL(request.url).searchParams.get("ids") || "").split(",").filter(Boolean);
    return send({ ok: true, posts: await listScheduledPosts(env, auth.userId, ids) });
  } catch (e: any) {
    return send({ error: "schedule_unavailable", detail: String(e?.message || e) }, 503);
  }
};

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  const body: any = await request.json().catch(() => ({}));
  if (body.action !== "cancel") return send({ error: "invalid_action" }, 400);
  try {
    const post = await cancelScheduledPost(env, auth.userId, String(body.id || ""));
    return post ? send({ ok: true, post }) : send({ error: "schedule_not_cancellable" }, 409);
  } catch (e: any) {
    return send({ error: "schedule_unavailable", detail: String(e?.message || e) }, 503);
  }
};
