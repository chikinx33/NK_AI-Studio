// POST /api/agent/production-assets
// 프로젝트 저장소의 기존 이미지를 컷 스틸 또는 장소 부감 마스터에 연결한다.
// 생성 작업이 아니라 사용자가 직접 고른 자산 등록이므로 승인/과금 잡을 만들지 않는다.
import { authorizeRequest } from "../_shared/auth.js";
import { buildAiVideoProjectPrefix } from "../_shared/storage";
import { AGENT_TOOLS, corsHeaders, send } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const norm = (value: unknown) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

export function applyProductionAsset(project: any, target: any, objectName: string) {
  const payload = project?.payload && typeof project.payload === "object" ? { ...project.payload } : {};
  const scenes = Array.isArray(project?.scenes) ? project.scenes.map((scene: any) => ({ ...scene })) : [];
  const now = new Date().toISOString();

  if (target?.type === "cut") {
    const index = scenes.findIndex((scene: any, i: number) => String(scene?.id ?? i + 1) === String(target.sceneId));
    if (index < 0) throw new Error("등록할 컷을 찾지 못했어요.");
    const scene = scenes[index];
    const previous = String(scene.imagePath || scene.imageDataUrl || "").trim();
    const history = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
    if (previous && previous !== objectName && !history.includes(previous)) history.push(previous);
    scenes[index] = {
      ...scene,
      imageDataUrl: objectName,
      imagePath: objectName,
      imageHistory: history.slice(-10),
      imgLoading: false,
      imgError: "",
      lineage: {
        ...(scene.lineage && typeof scene.lineage === "object" ? scene.lineage : {}),
        imageContinuity: "manual-library",
        updatedAt: now,
      },
    };
    return { scenes, payload: null, label: `컷 ${String(target.sceneId)}` };
  }

  if (target?.type === "location") {
    const locations = Array.isArray(payload.episodeLocations)
      ? payload.episodeLocations.map((location: any) => ({ ...location, variants: Array.isArray(location?.variants) ? location.variants.map((variant: any) => ({ ...variant })) : [] }))
      : [];
    const key = norm(target.locationName);
    const index = locations.findIndex((location: any) => norm(location?.name) === key || norm(location?.id) === key);
    if (index < 0) throw new Error("등록할 배경을 찾지 못했어요.");
    const location = locations[index];
    // 새 부감 마스터는 공간 배치의 새 기준이다. 옛 마스터에서 만든 방위/앵글 캐시는 함께 무효화한다.
    const customVariants = location.variants.filter((variant: any) => !/^(dir-|angle-)/.test(String(variant?.id || "")));
    customVariants.push({
      id: "angle-top",
      label: "부감(마스터)",
      description: "",
      refObjectName: objectName,
      source: "manual-library",
      createdAt: now,
    });
    locations[index] = {
      ...location,
      refObjectName: "",
      variants: customVariants,
      masterAngle: "top",
      directionSheet: null,
    };
    payload.episodeLocations = locations;
    if (!(payload.styleAnchor?.objectName && payload.styleAnchor?.pickedBy === "user")) {
      payload.styleAnchor = { objectName, sheetId: "", setName: String(location.name || target.locationName), createdAt: now, pickedBy: "auto-master" };
    }
    return { scenes: null, payload, label: String(location.name || target.locationName) };
  }

  throw new Error("지원하지 않는 이미지 등록 대상이에요.");
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body = await request.json().catch(() => ({} as any));
    const projectId = String(body.projectId || "").trim();
    const objectName = String(body.objectName || "").trim().replace(/^\/+/, "");
    if (!projectId || !objectName) return send({ error: "projectId와 objectName이 필요해요." }, 400, origin);
    if (!/^[a-zA-Z0-9._-]+$/.test(projectId)) return send({ error: "Invalid projectId format" }, 400, origin);

    const baseOutput = String(env.VIDEO_OUTPUT_GCS_URI || "");
    const rest = baseOutput.startsWith("gs://") ? baseOutput.slice(5) : "";
    const slash = rest.indexOf("/");
    const basePrefix = slash >= 0 ? rest.slice(slash + 1).replace(/\/$/, "") : "";
    if (!basePrefix) return send({ error: "Invalid VIDEO_OUTPUT_GCS_URI" }, 500, origin);
    const allowedPrefix = `${buildAiVideoProjectPrefix(basePrefix, auth.userId, projectId)}/image/`;
    if (!objectName.startsWith(allowedPrefix)) return send({ error: "이 프로젝트 저장소의 이미지만 등록할 수 있어요." }, 400, origin);

    const ctx = { request, env, authHeader: String(request.headers.get("Authorization") || ""), userId: auth.userId };
    const project = await AGENT_TOOLS.project_get.run({ projectId }, ctx as any);
    const applied = applyProductionAsset(project, body.target, objectName);
    await AGENT_TOOLS.project_save.run({
      projectId,
      ...(applied.scenes ? { scenes: applied.scenes } : {}),
      ...(applied.payload ? { payload: applied.payload } : {}),
    }, ctx as any);
    return send({ ok: true, target: body.target?.type || "", label: applied.label, objectName }, 200, origin);
  } catch (error: any) {
    const message = String(error?.message || error || "이미지를 등록하지 못했어요.");
    const status = /찾지 못했어요|지원하지 않는/.test(message) ? 404 : 500;
    return send({ error: message }, status, origin);
  }
};
