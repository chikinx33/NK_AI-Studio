// prototype/functions/api/_shared/publish-media-path.ts
// SNS 게시(/api/sns/publish, /api/sns/tiktok/inbox)가 서비스 계정으로 서명해 SNS 에 넘길 GCS 경로인지 판정한다.
// 예전엔 요청 본문의 경로를 그대로 서명해서, 로그인한 누구나 남의 파일(users/<다른 사용자>/...)을
// 자기 SNS 계정으로 게시할 수 있었다(2026-10-18).
// 허용: 요청자 본인 사용자 루트, 공유 프로젝트를 소유자 자격증명으로 게시할 때의 소유자 루트,
// 요청자 본인의 에이전트 채팅 첨부(사용자 루트 밖에 저장된다). 그 밖·'..' 포함·다른 버킷은 거절한다.
import { buildUserRoot } from "./storage";
import { chatAttachmentUserPrefix, isUnsafeObjectName, parseGcsReference } from "./media-access";

export const MEDIA_PATH_FORBIDDEN = "media_path_forbidden";

export type PublishMediaScope = {
  bucket: string;
  basePrefix: string;
  requesterId: string;
  // 게시 자격증명 소유자(공유 프로젝트면 소유자, 아니면 요청자 본인).
  publishUserId: string;
};

/** VIDEO_OUTPUT_GCS_URI(gs://bucket/prefix) → 버킷·베이스 prefix. publish.ts 의 sns-settings 경로와 같은 규칙. */
export function publishMediaLocation(env: any): { bucket: string; basePrefix: string } {
  const without = String(env?.VIDEO_OUTPUT_GCS_URI || "").trim().replace(/^gs:\/\//, "");
  const slash = without.indexOf("/");
  if (slash === -1) return { bucket: without, basePrefix: "" };
  return { bucket: without.slice(0, slash), basePrefix: without.slice(slash + 1).replace(/\/+$/, "") };
}

/**
 * 받던 표기(gs://bucket/obj, https://storage.googleapis.com/bucket/obj, 버킷 없는 객체 이름 users/... 또는
 * <base>/users/..., 앞 슬래시)를 버킷 안 객체 이름으로 바꾼다. 다른 버킷·해석 불가면 null.
 */
export function normalizePublishObjectName(raw: any, bucket: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;
  const ref = parseGcsReference(value);
  if (ref === "invalid") return null;
  if (ref) return ref.bucket === bucket ? ref.objectName : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // http(s) 외 다른 스킴 · GCS 가 아닌 URL
  return value.replace(/^\/+/, "") || null;
}

/** 허용 prefix 목록(끝 슬래시 포함). */
export function publishMediaRoots(scope: PublishMediaScope): string[] {
  const roots = [scope.requesterId, scope.publishUserId]
    .filter(Boolean)
    .map((uid) => `${buildUserRoot(scope.basePrefix, uid)}/`);
  roots.push(chatAttachmentUserPrefix(scope.basePrefix, scope.requesterId));
  return Array.from(new Set(roots));
}

/** 경로 하나를 판정한다. 통과하면 서명에 쓸 정규화된 객체 이름을 돌려준다. */
export function checkPublishMediaPath(raw: any, scope: PublishMediaScope): { ok: true; objectName: string } | { ok: false } {
  if (String(raw || "").includes("..")) return { ok: false };
  const objectName = normalizePublishObjectName(raw, scope.bucket);
  if (!objectName || objectName.includes("..") || isUnsafeObjectName(objectName)) return { ok: false };
  if (!publishMediaRoots(scope).some((root) => objectName.startsWith(root) && objectName.length > root.length)) return { ok: false };
  return { ok: true, objectName };
}

/**
 * 게시 본문의 모든 GCS 경로(mediaGcsPath, mediaItems[].gcsPath, photoGcsPaths[])를 검사하고
 * 통과한 것은 정규화된 객체 이름으로 바꿔 둔다(서명·프록시가 판정한 그 객체만 쓰도록).
 * 하나라도 벗어나면 { ok:false, field } — 호출자는 400 media_path_forbidden 을 돌려준다.
 * mediaDirectUrl·mediaUrl(공개 https 주소)은 서명하지 않으므로 손대지 않는다.
 */
export function authorizePublishMediaPaths(body: any, scope: PublishMediaScope): { ok: true } | { ok: false; field: string } {
  if (!body || typeof body !== "object") return { ok: true };
  const fix = (value: any, field: string): string | { field: string } => {
    const r = checkPublishMediaPath(value, scope);
    return r.ok ? r.objectName : { field };
  };
  if (body.mediaGcsPath) {
    const r = fix(body.mediaGcsPath, "mediaGcsPath");
    if (typeof r !== "string") return { ok: false, field: r.field };
    body.mediaGcsPath = r;
  }
  if (Array.isArray(body.mediaItems)) {
    for (let i = 0; i < body.mediaItems.length; i++) {
      const item = body.mediaItems[i];
      if (!item || typeof item !== "object" || !item.gcsPath) continue;
      const r = fix(item.gcsPath, `mediaItems[${i}].gcsPath`);
      if (typeof r !== "string") return { ok: false, field: r.field };
      item.gcsPath = r;
    }
  }
  if (Array.isArray(body.photoGcsPaths)) {
    for (let i = 0; i < body.photoGcsPaths.length; i++) {
      if (!String(body.photoGcsPaths[i] || "").trim()) continue;
      const r = fix(body.photoGcsPaths[i], `photoGcsPaths[${i}]`);
      if (typeof r !== "string") return { ok: false, field: r.field };
      body.photoGcsPaths[i] = r;
    }
  }
  return { ok: true };
}
