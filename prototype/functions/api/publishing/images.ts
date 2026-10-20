// POST /api/publishing/images — 글 이미지 저장. PC 앱이 받아서 확인할 sha256·가로세로를 같이 남긴다.
//   multipart: file, [itemId, index]          컴퓨터의 파일
//   JSON { sourceUrl, [itemId, index] }       인터넷 주소(서버가 받아 저장)
// itemId·index 를 주면 그 글의 index 번째 이미지 자리에 바로 넣는다(가져오기 뒤 빠진 이미지 채우기).
import { authorizeRequest } from "../_shared/auth.js";
import { publishingDb, storePublishingImage, attachItemImage, PublishingError, IMAGE_MAX_BYTES } from "../_shared/publishing-store";
import { send, sendError } from "../_shared/publishing-http";

async function readSourceUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new PublishingError("image_url_invalid"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PublishingError("image_url_invalid");
  const res = await fetch(url.toString(), { redirect: "follow" });
  if (!res.ok) throw new PublishingError("image_fetch_failed", 422, `HTTP ${res.status}`);
  if (Number(res.headers.get("Content-Length") || 0) > IMAGE_MAX_BYTES) throw new PublishingError("image_too_large", 413);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let fileName = "image";
  try { fileName = decodeURIComponent(url.pathname.split("/").pop() || "image"); } catch { /* 깨진 퍼센트 인코딩 */ }
  return { bytes, fileName };
}

export const onRequestPost = async ({ request, env }: any) => {
  const auth = await authorizeRequest(request, env, { apiKey: "publishing:write" });
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  try {
    let bytes: Uint8Array;
    let fileName = "";
    let itemId = "";
    let index = -1;
    let alt = "";
    let sourceUrl = "";
    const type = String(request.headers.get("Content-Type") || "");
    if (type.includes("multipart/form-data")) {
      const fd = await request.formData();
      const file = fd.get("file") as File | null;
      if (!file || typeof file === "string") throw new PublishingError("image_file_required");
      if (file.size > IMAGE_MAX_BYTES) throw new PublishingError("image_too_large", 413);
      bytes = new Uint8Array(await file.arrayBuffer());
      fileName = file.name || "image";
      itemId = String(fd.get("itemId") || "");
      index = Number(fd.get("index") ?? -1);
    } else {
      const body: any = await request.json().catch(() => ({}));
      sourceUrl = String(body.sourceUrl || "");
      ({ bytes, fileName } = await readSourceUrl(sourceUrl));
      itemId = String(body.itemId || "");
      index = Number(body.index ?? -1);
      alt = String(body.alt || "");
    }
    const meta: any = await storePublishingImage(env, auth.userId, bytes, fileName);
    if (sourceUrl) meta.sourceUrl = sourceUrl;
    if (alt) meta.alt = alt;
    if (!itemId) return send({ ok: true, image: meta });
    const db = await publishingDb(env);
    return send({ ok: true, image: await attachItemImage(db, env, auth.userId, itemId, index, meta) });
  } catch (e) {
    return sendError(e);
  }
};
