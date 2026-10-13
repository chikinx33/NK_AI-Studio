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

/** 오디오·비디오 출력 URI 의 베이스 prefix 목록. 두 버킷 모두 같은 users/{id} 규칙으로 저장된다. */
export function mediaBasePrefixes(env: any): string[] {
  const out = new Set<string>();
  for (const uri of [env?.VIDEO_OUTPUT_GCS_URI, env?.AUDIO_OUTPUT_GCS_URI]) {
    const raw = String(uri || "").trim();
    if (!raw.startsWith("gs://")) continue;
    const rest = raw.slice(5);
    const slash = rest.indexOf("/");
    out.add(slash === -1 ? "" : rest.slice(slash + 1).replace(/\/+$/, ""));
  }
  return [...out];
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

export async function checkMediaObjectAccess(env: any, requesterId: string, objectName: string): Promise<MediaAccess> {
  if (isUnsafeObjectName(objectName)) return { ok: false, error: "invalid_object_name" };
  const requester = sanitizeUserId(requesterId);
  const located = mediaBasePrefixes(env)
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
