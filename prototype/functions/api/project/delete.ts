// prototype/functions/api/project/delete.ts
// Delete objects under:
// {basePrefix}/users/{userId}/ai-video/projects{projectId}/
import { buildAiVideoProjectPrefix, buildAiVideoUserRoot } from "../_shared/storage";
import { authorizeRequest } from "../_shared/auth.js";
import { loadSharesStrict, saveShares, removeProjectShares, removeAllOwnerShares } from "../_shared/shares";
import { deleteGcsObjects, listGcsObjects, readGcsJson, resolveGcsEnv } from "../_shared/gcs.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

// Open CORS for local/server dashboards.
const corsHeaders = (origin: string | null) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  "Vary": "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), { status, headers: corsHeaders(origin) });

function objectNameFromRef(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("gs://")) {
    const rest = raw.slice(5);
    const slash = rest.indexOf("/");
    return slash >= 0 ? rest.slice(slash + 1) : "";
  }
  try {
    const url = new URL(raw, "https://nkstudio.org");
    const direct = String(url.searchParams.get("objectName") || "").trim();
    if (direct) return direct.replace(/^\/+/, "");
    if (url.hostname === "storage.googleapis.com") {
      const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const slash = path.indexOf("/");
      return slash >= 0 ? path.slice(slash + 1) : "";
    }
  } catch { /* 일반 objectName */ }
  return raw.includes("/") && !raw.includes("://") ? raw.replace(/^\/+/, "") : "";
}

/** 현재 컷·배경·시트·허브 슬롯에 실제 등록된 이미지. 이 자산은 저장소에서 직접 삭제하지 못하게 한다. */
export function collectProtectedImageObjects(project: any) {
  const refs = new Set<string>();
  const add = (value: unknown) => { const name = objectNameFromRef(value); if (name) refs.add(name); };
  const addTree = (value: any, seen = new WeakSet<object>()) => {
    if (typeof value === "string") { add(value); return; }
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach((item) => addTree(item, seen));
    else Object.values(value).forEach((item) => addTree(item, seen));
  };
  const payload = project?.payload && typeof project.payload === "object" ? project.payload : {};
  const scenes = Array.isArray(project?.scenes) ? project.scenes : (Array.isArray(payload.scenes) ? payload.scenes : []);
  scenes.forEach((scene: any) => {
    ["imageDataUrl", "imagePath", "generatedImageUrl", "imageUrl"].forEach((key) => add(scene?.[key]));
    (Array.isArray(scene?.shots) ? scene.shots : []).forEach((shot: any) => ["imageDataUrl", "imagePath", "generatedImageUrl", "imageUrl"].forEach((key) => add(shot?.[key])));
  });
  const sheets = Array.isArray(payload.storyboardSheets) ? payload.storyboardSheets : [];
  (Array.isArray(payload.episodeLocations) ? payload.episodeLocations : []).forEach((location: any) => {
    add(location?.refObjectName);
    (Array.isArray(location?.variants) ? location.variants : []).forEach((variant: any) => add(variant?.refObjectName));
    add(location?.setSheet?.objectName);
    const linked = sheets.find((sheet: any) => String(sheet?.id || "") === String(location?.setSheet?.sheetId || ""));
    if (linked) {
      add(linked.objectName);
      (Array.isArray(linked.panels) ? linked.panels : []).forEach((panel: any) => add(panel?.objectName));
    }
  });
  (Array.isArray(payload.episodeProps) ? payload.episodeProps : []).forEach((prop: any) => add(prop?.refObjectName));
  add(payload?.styleAnchor?.objectName);
  // 캐릭터·환경 허브 자산은 구조 변형이 많으므로 등록 목록만 제한적으로 재귀 탐색한다.
  [payload.characterSheets, payload.knowledgeCharacterSheets, payload.environmentAssets, payload.knowledgeEnvironmentAssets, payload.knowledgeHub?.characterSheets, payload.knowledgeHub?.environmentAssets].forEach((list) => addTree(list));
  return refs;
}

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  try {
    const origin = request.headers.get("Origin");
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body.projectId || "").trim();
    const userId = auth.userId;
    const confirm = String(body.confirm || "").trim() === "yes";
    const deleteAll = String(body.all || "").trim() === "true";
    if (!projectId || !confirm) {
      return send({ error: "projectId and confirm=yes are required" }, 400, origin);
    }

    const { basePrefix } = resolveGcsEnv(env);
    const userRoot = buildAiVideoUserRoot(basePrefix, userId);
    const projectPrefix = buildAiVideoProjectPrefix(basePrefix, userId, projectId);
    const prefix = deleteAll ? `${userRoot}/projects` : `${projectPrefix}/`;

    // Validate prefix boundaries (simple sanity check)
    if (!deleteAll && !/^[a-zA-Z0-9._-]+$/.test(projectId)) {
      return send({ error: "Invalid projectId format" }, 400, origin);
    }

    const objectName = String((body.objectName || body.object || "")).trim();
    const objectNames = Array.isArray(body.objectNames)
      ? body.objectNames.map((value: any) => String(value || "").trim()).filter(Boolean)
      : [];
    if (objectName || objectNames.length) {
      const allowedPrefix = `${projectPrefix}/`;
      const deleteTargets = objectNames.length ? objectNames : [objectName];
      if (deleteTargets.some((name) => !name.startsWith(allowedPrefix))) {
        return send({ error: "Invalid objectName for project" }, 400, origin);
      }
      // 현재 등록된 자산을 직접 지우면 data.json 참조만 남아 깨진 썸네일이 된다.
      // 삭제 전에 서버 원본을 다시 읽어 보호한다(클라이언트의 '미사용' 판정만 믿지 않는다).
      const projectRecord = await readGcsJson(env, `${projectPrefix}/reference/data.json`);
      const protectedObjects = projectRecord.found ? collectProtectedImageObjects(projectRecord.data) : new Set<string>();
      const protectedTargets = deleteTargets.filter((name) => protectedObjects.has(name));
      const safeTargets = deleteTargets.filter((name) => !protectedObjects.has(name));
      if (!safeTargets.length) {
        return send({ error: "현재 컷·배경·시트에 등록된 이미지는 먼저 교체하거나 연결을 해제해야 삭제할 수 있어요.", protected: protectedTargets }, 409, origin);
      }
      const result = await deleteGcsObjects(env, safeTargets);
      return send({
        ...result,
        single: deleteTargets.length === 1,
        protected: protectedTargets,
      }, 200, origin);
    }

    // 프로젝트 전체 삭제도 같은 배치 경로를 사용해 객체 수와 무관하게 서브요청을 제한한다.
    const names = (await listGcsObjects(env, prefix)).filter((name: string) => name.startsWith(prefix));
    const result = await deleteGcsObjects(env, names);

    // 프로젝트(또는 전체) 삭제 시, 해당 프로젝트의 공유 grant도 정리한다.
    // (남아있으면 공유받은 계정 화면에 유령 카드가 보임)
    try {
      const sreg = await loadSharesStrict(env);
      if (deleteAll) removeAllOwnerShares(sreg, userId);
      else removeProjectShares(sreg, userId, projectId);
      await saveShares(env, sreg);
    } catch (_) { /* 공유 정리 실패는 삭제 자체를 막지 않음 */ }

    return send({ ...result, listedCount: names.length, prefix, deleteAll }, 200, origin);
  } catch (e: any) {
    return send({ error: e?.message || "Unknown error" }, 500, request.headers.get("Origin"));
  }
};

export const onRequestOptions: PagesFunction = async ({ request }) => {
  const origin = request.headers.get("Origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
};
