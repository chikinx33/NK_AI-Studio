// POST /api/director/media-url — 디렉터가 다루는 미디어의 서명 URL.
//   { read: ["gs://…" | "users/…"] }                       → 읽기(GET) URL. 본인 저장 영역만.
//   { upload: { projectId, filename, contentType } }        → 업로드(PUT) URL. 본인 프로젝트 director/ 폴더.
// 디렉터 샌드박스(검수용 ffmpeg)·Atlas 참조 입력이 키 없이 파일 하나만 다루게 한다.
import { parseGcsUri, resolveGcsEnv, signGcsObjectUrl } from "../_shared/gcs.js";
import { buildUserRoot, buildAiVideoProjectPrefix } from "../_shared/storage";
import { directorAuth, onOptions, send, type PagesFunction } from "./_shared";

const MAX_READ = 40;
const UPLOAD_TYPES: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov",
  "audio/mpeg": "mp3", "audio/wav": "wav",
  "application/json": "json", "text/plain": "txt", "text/markdown": "md",
};

/** gs://bucket/obj 또는 obj → 버킷 안 경로. 다른 버킷이면 null. */
function toObjectName(src: string, bucket: string): string | null {
  const s = String(src || "").trim();
  if (s.startsWith("gs://")) {
    const p = parseGcsUri(s);
    return p && p.bucket === bucket ? p.object : null;
  }
  return s.replace(/^\/+/, "") || null;
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  const auth = await directorAuth(request, env, false);
  if (!auth.ok) return auth.response;
  const body: any = await request.json().catch(() => ({}));
  let ctx;
  try { ctx = resolveGcsEnv(env); } catch (e: any) { return send({ error: "storage_unconfigured", detail: String(e?.message || e) }, 500, origin); }
  const userRoot = `${buildUserRoot(ctx.basePrefix, auth.userId)}/`;
  try {
    if (Array.isArray(body?.read)) {
      const out: any[] = [];
      for (const src of body.read.slice(0, MAX_READ)) {
        const obj = toObjectName(src, ctx.bucket);
        // 경로 조작(../)과 남의 저장 영역은 거절한다.
        if (!obj || obj.includes("..") || !obj.startsWith(userRoot)) { out.push({ src, error: "forbidden_path" }); continue; }
        const signed = await signGcsObjectUrl(env, obj, { method: "GET", expiresInSec: Number(body?.expiresInSec) || 6 * 3600 });
        out.push({ src, gsUri: `gs://${ctx.bucket}/${obj}`, url: signed.url, expiresInSec: signed.expiresInSec });
      }
      return send({ items: out }, 200, origin);
    }
    if (body?.upload && typeof body.upload === "object") {
      const projectId = String(body.upload.projectId || "").trim();
      if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "invalid_project_id" }, 400, origin);
      const contentType = String(body.upload.contentType || "").toLowerCase();
      const ext = UPLOAD_TYPES[contentType];
      if (!ext) return send({ error: "unsupported_content_type", allowed: Object.keys(UPLOAD_TYPES) }, 400, origin);
      const base = String(body.upload.filename || "file").replace(/\.[A-Za-z0-9]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "file";
      const obj = `${buildAiVideoProjectPrefix(ctx.basePrefix, auth.userId, projectId)}/director/${Date.now()}-${base}.${ext}`;
      const put = await signGcsObjectUrl(env, obj, { method: "PUT", contentType, expiresInSec: 3600 });
      const get = await signGcsObjectUrl(env, obj, { method: "GET", expiresInSec: 6 * 3600 });
      return send({ uploadUrl: put.url, method: "PUT", contentType, gsUri: `gs://${ctx.bucket}/${obj}`, readUrl: get.url }, 200, origin);
    }
    return send({ error: "read_or_upload_required" }, 400, origin);
  } catch (e: any) {
    return send({ error: "sign_failed", detail: String(e?.message || e) }, 500, origin);
  }
};

export const onRequestOptions = onOptions;
