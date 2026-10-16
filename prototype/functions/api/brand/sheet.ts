import { authorizeRequest } from "../_shared/auth.js";
import { buildAiVideoBrandPrefix } from "../_shared/storage";
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { buildSheetObjectName } from "./save";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;
const headers = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});
const send = (data: any, status: number, origin: string | null) =>
  new Response(JSON.stringify(data), { status, headers: headers(origin) });

// 시트 바이너리는 한 장씩 저장한다. 브랜드 JSON에 모든 원본의 base64를 모으면
// 업로드·JSON 파싱·복제·디코딩 비용이 한 요청에 누적되어 저장 응답이 시간 초과된다.
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const form = await request.formData();
    const brandId = String(form.get("brandId") || "").trim();
    const token = String(form.get("token") || "").trim();
    const sheetId = String(form.get("sheetId") || "").trim();
    const kind = String(form.get("kind") || "ip");
    const file = form.get("file");
    if (!/^[a-zA-Z0-9._-]+$/.test(brandId) || !token || !sheetId || !["ip", "env"].includes(kind)) {
      return send({ error: "invalid_sheet_metadata" }, 400, origin);
    }
    if (!file || typeof file === "string" || !file.size) return send({ error: "sheet_file_required" }, 400, origin);
    const mime = file.type.toLowerCase();
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[mime];
    if (!ext) return send({ error: "unsupported_sheet_image_type" }, 400, origin);
    if (file.size > 32 * 1024 * 1024) return send({ error: "sheet_image_too_large" }, 413, origin);
    const ctx = resolveGcsEnv(env);
    const objectName = buildSheetObjectName({
      brandPrefix: buildAiVideoBrandPrefix(ctx.basePrefix, auth.userId, brandId),
      token, sheetId, ext, kind,
    });
    const accessToken = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw });
    const billing = ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {};
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime, ...billing },
      body: file.stream(),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      await response.text();
      return send({ error: "sheet_upload_failed", status: response.status }, 500, origin);
    }
    await response.text();
    return send({ ok: true, imageDataUrl: `gs://${ctx.bucket}/${objectName}` }, 200, origin);
  } catch (error: any) {
    const timeout = /timeout|abort/i.test(String(error?.name || ""));
    return send({ error: timeout ? "sheet_upload_timeout" : "sheet_upload_failed" }, 500, origin);
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: headers(request.headers.get("Origin")) });
