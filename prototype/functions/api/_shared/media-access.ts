// prototype/functions/api/_shared/media-access.ts
// 미디어 프록시(/api/media/proxy)가 서비스 계정으로 서명해 내려 줄 수 있는 객체인지 판정한다.
// 허용: 요청자 본인 루트(users/{요청자}/...) 아래, 또는 요청자가 공유받은(viewer/editor)
// 프로젝트의 소유자 프로젝트 폴더(users/{소유자}/ai-video|ai-video-gen/projects{프로젝트}/...) 아래.
// 그 밖(다른 사용자 경로, admin/ 레지스트리, 사용자 루트 밖)은 모두 거절한다.
import { AI_VIDEO_GEN_SERVICE, AI_VIDEO_SERVICE, buildUserRoot, sanitizeUserId } from "./storage";
import { getGrantRole, loadShares } from "./shares";

export type MediaAccess =
  | { ok: true; ownerId: string; via: "self" | "share" }
  | { ok: false; error: "invalid_object_name" | "forbidden_object" };

const PROJECT_SEGMENT = "projects";
const PROJECT_SERVICES = new Set([AI_VIDEO_SERVICE, AI_VIDEO_GEN_SERVICE]);

/** '.'/'..' 세그먼트·앞 슬래시는 서명 URL 경로가 정규화되며 접두 검사를 벗어날 수 있으므로 거절한다. */
export function isUnsafeObjectName(objectName: string): boolean {
  const name = String(objectName || "");
  if (!name || name.startsWith("/")) return true;
  return name.split("/").some((seg) => seg === "." || seg === "..");
}

/** gs://bucket/prefix 출력 URI → (버킷, 베이스 prefix). */
function parseOutputUri(uri: any): { bucket: string; basePrefix: string } | null {
  const raw = String(uri || "").trim();
  if (!raw.startsWith("gs://")) return null;
  const rest = raw.slice(5);
  const slash = rest.indexOf("/");
  const bucket = slash === -1 ? rest : rest.slice(0, slash);
  if (!bucket) return null;
  return { bucket, basePrefix: slash === -1 ? "" : rest.slice(slash + 1).replace(/\/+$/, "") };
}

/** 오디오·비디오 출력 URI 의 (버킷, 베이스 prefix) 목록. 두 버킷 모두 같은 users/{id} 규칙으로 저장된다. */
function mediaOutputLocations(env: any): Array<{ bucket: string; basePrefix: string }> {
  return [env?.VIDEO_OUTPUT_GCS_URI, env?.AUDIO_OUTPUT_GCS_URI]
    .map(parseOutputUri)
    .filter((l): l is { bucket: string; basePrefix: string } => !!l);
}

/** 베이스 prefix 목록. bucket 을 주면 그 버킷에 해당하는 출력 URI 의 prefix 만 돌려준다. */
export function mediaBasePrefixes(env: any, bucket?: string): string[] {
  return [...new Set(mediaOutputLocations(env)
    .filter((l) => bucket === undefined || l.bucket === bucket)
    .map((l) => l.basePrefix))];
}

/** objectName 이 어느 사용자 루트 아래인지와 그 아래 경로. 사용자 루트 밖이면 null. */
export function splitUserObject(objectName: string, basePrefix: string): { ownerId: string; rest: string } | null {
  // buildUserRoot(base, "x") = "<base>/users/x" → 끝의 사용자 id 만 떼어 "<base>/users/" 를 얻는다.
  const usersPrefix = buildUserRoot(basePrefix, "x").slice(0, -1);
  if (!objectName.startsWith(usersPrefix)) return null;
  const tail = objectName.slice(usersPrefix.length);
  const slash = tail.indexOf("/");
  if (slash <= 0) return null;
  const ownerId = tail.slice(0, slash);
  const rest = tail.slice(slash + 1);
  // 저장 경로의 사용자 id 는 항상 sanitizeUserId 를 거친 값이다. 그 형태가 아니면 사용자 루트로 보지 않는다.
  if (!rest || sanitizeUserId(ownerId) !== ownerId) return null;
  return { ownerId, rest };
}

/** 사용자 루트 아래 경로에서 프로젝트 id. ai-video|ai-video-gen/projects{id}/<파일> 형태만 인정한다. */
export function projectIdFromUserPath(rest: string): string {
  const parts = String(rest || "").split("/");
  if (parts.length < 3 || !PROJECT_SERVICES.has(parts[0])) return "";
  const seg = parts[1];
  if (!seg.startsWith(PROJECT_SEGMENT)) return "";
  const projectId = seg.slice(PROJECT_SEGMENT.length);
  // project/share.ts 가 공유 등록 시 쓰는 프로젝트 id 형식과 같다.
  return /^[a-zA-Z0-9._-]+$/.test(projectId) ? projectId : "";
}

/** bucket 을 주면 그 버킷의 출력 URI prefix 기준으로만 판정한다(다른 버킷의 prefix 를 빌려 통과하지 못하게). */
export async function checkMediaObjectAccess(env: any, requesterId: string, objectName: string, bucket?: string): Promise<MediaAccess> {
  if (isUnsafeObjectName(objectName)) return { ok: false, error: "invalid_object_name" };
  const requester = sanitizeUserId(requesterId);
  const located = mediaBasePrefixes(env, bucket)
    .map((base) => splitUserObject(objectName, base))
    .filter((v): v is { ownerId: string; rest: string } => !!v);
  if (!located.length) return { ok: false, error: "forbidden_object" };
  if (located.some((l) => l.ownerId === requester)) return { ok: true, ownerId: requester, via: "self" };

  const shared = located
    .map((l) => ({ ownerId: l.ownerId, projectId: projectIdFromUserPath(l.rest) }))
    .filter((l) => !!l.projectId);
  if (!shared.length) return { ok: false, error: "forbidden_object" };
  const registry = await loadShares(env);
  for (const s of shared) {
    if (getGrantRole(registry, s.ownerId, s.projectId, requester)) return { ok: true, ownerId: s.ownerId, via: "share" };
  }
  return { ok: false, error: "forbidden_object" };
}

const GCS_HOST = "storage.googleapis.com";

/** 에이전트 채팅 첨부 경로 세그먼트(사용자·대화 id). agent/_chat-attachments.ts 가 저장할 때 쓰는 규칙이다. */
export const chatAttachmentSegment = (v: string) => String(v || "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "_";

/**
 * 에이전트 채팅 첨부의 사용자 prefix: <VIDEO_OUTPUT_GCS_URI 베이스>/agent-attachments/<user>/.
 * 사용자 루트(users/) 밖이지만 요청자 본인 것이므로 참조 읽기에서는 본인만 허용한다.
 */
export function chatAttachmentUserPrefix(basePrefix: string, userId: string): string {
  const base = basePrefix ? `${basePrefix}/` : "";
  return `${base}agent-attachments/${chatAttachmentSegment(userId)}/`;
}

/**
 * gs:// · storage.googleapis.com 참조 → 버킷·객체 이름.
 * GCS 참조가 아니면 null, GCS 참조인데 버킷·객체를 해석할 수 없으면 "invalid".
 * 지원 형태: gs://b/o, https://storage.googleapis.com/b/o(서명 URL 포함),
 * https://storage.googleapis.com/[download/]storage/v1/b/{b}/o/{o}, https://{b}.storage.googleapis.com/o
 */
export function parseGcsReference(ref: string): { bucket: string; objectName: string } | "invalid" | null {
  const raw = String(ref || "").trim();
  if (raw.startsWith("gs://")) {
    const rest = raw.slice(5);
    const slash = rest.indexOf("/");
    if (slash <= 0 || slash === rest.length - 1) return "invalid";
    return { bucket: rest.slice(0, slash), objectName: rest.slice(slash + 1) };
  }
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const virtualHost = host.endsWith(`.${GCS_HOST}`);
  if (host !== GCS_HOST && !virtualHost) return null;
  if (url.protocol !== "https:" || url.username || url.password) return "invalid";
  try {
    if (virtualHost) {
      const bucket = host.slice(0, -(GCS_HOST.length + 1));
      const objectName = decodeURIComponent(url.pathname.slice(1));
      return bucket && objectName ? { bucket, objectName } : "invalid";
    }
    const api = url.pathname.match(/^\/(?:download\/)?storage\/v1\/b\/([^/]+)\/o\/([^/]+)$/);
    if (api) {
      const bucket = decodeURIComponent(api[1]);
      const objectName = decodeURIComponent(api[2]);
      return bucket && objectName ? { bucket, objectName } : "invalid";
    }
    if (/^\/(?:upload\/|download\/|storage\/v1\/|batch\/)/.test(url.pathname)) return "invalid";
    const path = url.pathname.slice(1);
    const slash = path.indexOf("/");
    if (slash <= 0 || slash === path.length - 1) return "invalid";
    return { bucket: decodeURIComponent(path.slice(0, slash)), objectName: decodeURIComponent(path.slice(slash + 1)) };
  } catch {
    return "invalid";
  }
}

export type GcsReadAccess =
  | { ok: true; bucket: string; objectName: string; ownerId: string; fetchUrl: string }
  | { ok: false; error: "invalid_object_name" | "forbidden_bucket" | "forbidden_object" };

/**
 * 서비스 계정 토큰으로 GCS 참조를 읽어도 되는지 판정한다(참조 이미지·영상 분석 등).
 * GCS 참조가 아니면 null — 호출자는 토큰 없이 평소대로 받는다.
 * 허용 조건은 미디어 프록시와 같다: 출력 버킷(VIDEO/AUDIO_OUTPUT_GCS_URI)이고, 그 버킷의 사용자 루트 중
 * 요청자 본인 것이거나 공유받은 프로젝트의 소유자 프로젝트 폴더일 것.
 * fetchUrl 은 판정한 객체 이름을 그대로 인코딩한 JSON API 주소다 — 원래 URL 을 쓰면 '%2e%2e' 같은
 * 경로 정규화로 판정과 다른 객체를 읽을 수 있다.
 */
export async function authorizeGcsRead(env: any, requesterId: string, ref: string): Promise<GcsReadAccess | null> {
  const parsed = parseGcsReference(ref);
  if (parsed === null) return null;
  if (parsed === "invalid") return { ok: false, error: "invalid_object_name" };
  const { bucket, objectName } = parsed;
  if (!mediaOutputLocations(env).some((l) => l.bucket === bucket)) return { ok: false, error: "forbidden_bucket" };
  const fetchUrl = `https://${GCS_HOST}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  // 에이전트 채팅 첨부(본인 것만). 첨부는 VIDEO_OUTPUT_GCS_URI 베이스 아래에 저장된다.
  const requester = sanitizeUserId(requesterId);
  const video = parseOutputUri(env?.VIDEO_OUTPUT_GCS_URI);
  if (video && video.bucket === bucket && !isUnsafeObjectName(objectName)
      && objectName.startsWith(chatAttachmentUserPrefix(video.basePrefix, requester))) {
    return { ok: true, bucket, objectName, ownerId: requester, fetchUrl };
  }
  const access = await checkMediaObjectAccess(env, requesterId, objectName, bucket);
  if (!access.ok) return { ok: false, error: access.error };
  return {
    ok: true, bucket, objectName, ownerId: access.ownerId, fetchUrl,
  };
}
