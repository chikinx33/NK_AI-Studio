/**
 * TikTok 영상 초안의 글(캡션)을 휴대폰으로 넘기는 링크.
 *
 * 영상 초안(inbox/video/init)은 API 에 글을 실을 칸이 없다(source_info 만 받는다 — 사진 초안만 description 이 실린다).
 * 게시는 엔케가 휴대폰 TikTok 앱에서 하므로, 보낸 글을 저장해 두고 휴대폰에서 열 수 있는 서명 링크를 준다
 * (tiktok-caption.html → /api/sns/tiktok/caption). 휴대폰은 로그인돼 있지 않을 수 있어 세션이 아니라 서명으로 연다.
 */
import { readGcsJson, resolveGcsEnv, writeGcsJson } from "./gcs.js";
import { buildUserDataObject } from "./storage";

/** 링크 유효 기간. 초안은 알림함에서 며칠 뒤에 게시하기도 한다. */
export const TIKTOK_CAPTION_TTL_SEC = 7 * 24 * 3600;

// 서명 문자열 앞머리. tiktok-media 프록시 서명(`객체|만료`)과 섞이지 않게 용도를 박는다.
const PURPOSE = "tiktok-caption";

export function isSafeCaptionKey(value: string): boolean {
  return /^[A-Za-z0-9._~-]{1,200}$/.test(String(value || ""));
}

function captionObject(env: any, userId: string, publishId: string): string {
  const { basePrefix } = resolveGcsEnv(env);
  return buildUserDataObject(basePrefix, userId, `tiktok-caption-${publishId}.json`);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  let bin = "";
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 글을 저장하고 휴대폰용 링크를 돌려준다. 글이 비었거나 키가 이상하면 "" — 전송 자체는 막지 않는다. */
export async function saveTikTokCaptionLink(
  env: any, origin: string, secret: string,
  input: { userId: string; publishId: string; caption: string; account?: string },
): Promise<string> {
  const caption = String(input.caption || "").trim().slice(0, 4000);
  if (!caption || !isSafeCaptionKey(input.userId) || !isSafeCaptionKey(input.publishId)) return "";
  await writeGcsJson(env, captionObject(env, input.userId, input.publishId), {
    caption, account: String(input.account || ""), publishId: input.publishId, savedAt: new Date().toISOString(),
  });
  const exp = Math.floor(Date.now() / 1000) + TIKTOK_CAPTION_TTL_SEC;
  const sig = await hmac(secret, `${PURPOSE}|${input.userId}|${input.publishId}|${exp}`);
  const q = new URLSearchParams({ u: input.userId, p: input.publishId, e: String(exp), s: sig });
  return `${origin}/tiktok-caption.html?${q.toString()}`;
}

/** 링크의 서명·만료를 확인하고 저장된 글을 읽는다. */
export async function readTikTokCaptionLink(
  env: any, secret: string, q: { u: string; p: string; e: string; s: string },
): Promise<{ ok: true; caption: string; account: string } | { ok: false; error: string }> {
  const exp = Number(q.e);
  if (!isSafeCaptionKey(q.u) || !isSafeCaptionKey(q.p) || !Number.isFinite(exp) || !q.s) return { ok: false, error: "bad_link" };
  if (exp < Math.floor(Date.now() / 1000)) return { ok: false, error: "expired" };
  const expect = await hmac(secret, `${PURPOSE}|${q.u}|${q.p}|${exp}`);
  if (expect !== q.s) return { ok: false, error: "bad_link" };
  const { found, data } = await readGcsJson(env, captionObject(env, q.u, q.p));
  if (!found || !data || typeof data !== "object") return { ok: false, error: "not_found" };
  return { ok: true, caption: String((data as any).caption || ""), account: String((data as any).account || "") };
}
