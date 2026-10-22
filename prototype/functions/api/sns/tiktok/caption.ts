/**
 * GET /api/sns/tiktok/caption?u=&p=&e=&s= — 휴대폰 글 복사 화면(tiktok-caption.html)이 읽는다.
 * 로그인 없이 서명으로만 연다(_shared/tiktok-caption.ts). 돌려주는 건 게시할 글뿐이다.
 */
import { readSecret } from "../../_shared/auth.js";
import { readTikTokCaptionLink } from "../../_shared/tiktok-caption";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const onRequestGet = async ({ request, env }: { request: Request; env: any }) => {
  const url = new URL(request.url);
  const q = {
    u: String(url.searchParams.get("u") || ""),
    p: String(url.searchParams.get("p") || ""),
    e: String(url.searchParams.get("e") || ""),
    s: String(url.searchParams.get("s") || ""),
  };
  try {
    const r = await readTikTokCaptionLink(env, readSecret(env), q);
    if (!r.ok) return send(r, r.error === "not_found" ? 404 : 403);
    return send(r);
  } catch (err) {
    console.log("[tiktok/caption] 실패:", err instanceof Error ? err.message : String(err));
    return send({ ok: false, error: "read_failed" }, 500);
  }
};
