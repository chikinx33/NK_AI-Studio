// prototype/functions/api/agent/_chat-attachments.ts
// 채팅 첨부 이미지를 대화별로 GCS 에 보관한다.
//
// 전엔 첨부가 그 요청 메모리(ctx.attachments)에만 있어서, 다음 턴에 "모양새 친구들은 빼고 지민이만…"처럼
// 앞서 올린 그림을 가리키면 image_edit 가 attachment:1 을 찾지 못해 실패했다(2026-09-29).
// 이제 첨부를 받는 즉시 보관하고, 그 턴에 첨부가 없으면 이 대화에서 가장 최근에 올린 첨부로 푼다.
//
// 경로: <기준 prefix>/agent-attachments/<user>/<conversation>/<역순 시각>-<N>.<확장자>
//  - 역순 시각(큰 수 - now)이라 목록 1번 호출(maxResults)만으로 최신 묶음이 맨 앞에 온다. DB·DDL 없음.
import { resolveGcsEnv, getGoogleAccessToken } from "../_shared/gcs.js";

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const STAMP_MAX = 9_999_999_999_999;

const safeSegment = (v: string) => String(v || "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "_";

function attachmentPrefix(env: any, userId: string, conversationId: string) {
  const g = resolveGcsEnv(env);
  const base = g.basePrefix ? `${g.basePrefix}/` : "";
  return { g, prefix: `${base}agent-attachments/${safeSegment(userId)}/${safeSegment(conversationId || "main")}/` };
}

const extOf = (mime: string) => (/png/i.test(mime) ? "png" : /webp/i.test(mime) ? "webp" : "jpg");

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 이번 턴 첨부를 보관한다. 실패해도 대화는 그대로 진행한다(그 턴 안에선 메모리 첨부를 쓴다). */
export async function saveChatAttachments(
  env: any, userId: string, conversationId: string,
  images: { base64: string; mimeType: string }[],
): Promise<string[]> {
  if (!images.length) return [];
  const { g, prefix } = attachmentPrefix(env, userId, conversationId);
  const token = await getGoogleAccessToken({ clientEmail: g.clientEmail, privateKeyPem: g.privateKeyRaw, scope: GCS_SCOPE });
  const stamp = String(STAMP_MAX - Date.now()).padStart(13, "0");
  return Promise.all(images.map(async (im, i) => {
    const objectName = `${prefix}${stamp}-${String(i + 1).padStart(2, "0")}.${extOf(im.mimeType)}`;
    const res = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(g.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": im.mimeType || "image/jpeg" }, body: base64ToBytes(im.base64) },
    );
    if (!res.ok) throw new Error(`첨부 보관 실패(${res.status}): ${(await res.text()).slice(0, 200)}`);
    return objectName;
  }));
}

/** 이 대화에서 가장 최근에 올린 첨부 묶음의 N번째(1부터) 이미지 → gs:// 주소. 없으면 "". */
export async function latestChatAttachment(env: any, userId: string, conversationId: string, n: number): Promise<string> {
  const { g, prefix } = attachmentPrefix(env, userId, conversationId);
  const token = await getGoogleAccessToken({ clientEmail: g.clientEmail, privateKeyPem: g.privateKeyRaw, scope: GCS_SCOPE });
  const params = new URLSearchParams({ prefix, maxResults: "20", fields: "items(name)" });
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(g.bucket)}/o?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return "";
  const data: any = await res.json().catch(() => ({}));
  const names: string[] = (Array.isArray(data?.items) ? data.items : []).map((it: any) => String(it?.name || "")).filter(Boolean).sort();
  if (!names.length) return "";
  const stampOf = (name: string) => name.slice(prefix.length).split("-")[0];
  const latest = stampOf(names[0]);
  const batch = names.filter((name) => stampOf(name) === latest);
  const hit = batch[n - 1];
  return hit ? `gs://${g.bucket}/${hit}` : "";
}
