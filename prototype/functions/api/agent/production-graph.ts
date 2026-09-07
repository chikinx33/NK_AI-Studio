// prototype/functions/api/agent/production-graph.ts
// GET /api/agent/production-graph?projectId=<id>
//
// 노드 캔버스의 데이터 원천. 프로젝트의 씬(컷)·공통 프롬프트·장소·캐릭터를 노드로,
// 컷 순서·컷 참조(cutRefId)·장소·캐릭터 등장·공통 프롬프트 오버라이드를 엣지로 돌려준다.
// 프롬프트 문자열은 브라우저와 같은 단일 조립기(_shared/prompt-assembly.js)로 계산하므로
// 캔버스가 보여주는 프롬프트 = 에이전트가 실제로 보내는 프롬프트다.
//
// 노드 종류는 자유 배선이 아니라 연출 문법으로 고정한다(common/location/character/cut).
// 사용자가 임의 모델 노드를 잇는 캔버스(ComfyUI 식)를 만들면 stage-geometry·body-grammar 가
// 보장하는 연속성이 배선 하나에 무너지기 때문이다.
import { authorizeRequest } from "../_shared/auth.js";
import { buildSceneImagePrompt, buildSceneVideoPrompt, cleanHeader } from "../_shared/prompt-assembly.js";
import { AGENT_TOOLS, corsHeaders, send } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

export type GraphNodeType = "common" | "location" | "character" | "cut";
export type GraphEdgeType = "sequence" | "cutRef" | "location" | "character" | "commonOverride";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  data: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  type: GraphEdgeType;
  from: string;
  to: string;
  label?: string;
}

const TOKEN_RE = /@[0-9A-Za-z가-힣_]{1,24}/g;

function slug(text: string): string {
  return String(text || "").trim().toLowerCase().replace(/[^0-9a-z가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "x";
}

/** gs://bucket/obj → 미디어 프록시 URL. https 는 그대로, data:/blob: 은 캔버스에 싣지 않는다(무게). */
export function toDisplayUrl(ref: unknown): string {
  const raw = String(ref || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const m = raw.match(/^gs:\/\/[^/]+\/(.+)$/);
  if (m) return `/api/media/proxy?objectName=${encodeURIComponent(m[1])}`;
  if (!raw.includes("://")) return `/api/media/proxy?objectName=${encodeURIComponent(raw.replace(/^\/+/, ""))}`;
  return "";
}

function firstText(...values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function tokensIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || "").match(TOKEN_RE) || []) out.add(m);
  return [...out];
}

/** 순수 함수 — 테스트가 직접 호출한다. */
export function buildProductionGraph(project: { projectId: string; title?: string; header?: string; payload?: any; scenes?: any[] }) {
  const projectId = String(project.projectId || "");
  const payload = project.payload && typeof project.payload === "object" ? project.payload : {};
  const header = String(project.header || payload.header || "");
  const headerClean = cleanHeader(header);
  const scenes: any[] = Array.isArray(project.scenes) ? project.scenes : [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: "common",
    type: "common",
    label: "공통 프롬프트",
    data: { text: headerClean, raw: header, aspectRatio: String(payload.aspectRatio || project.payload?.aspectRatio || "") },
  });

  // 캐릭터 노드: payload.characters[] 의 트리거 토큰(@이름)을 노드로 만든다.
  const characters: any[] = Array.isArray(payload.characters) ? payload.characters : [];
  const characterNodeByToken = new Map<string, string>();
  for (const ch of characters) {
    const name = firstText(ch?.trigger, ch?.token, ch?.name);
    if (!name) continue;
    const token = name.startsWith("@") ? name : `@${name}`;
    const id = `character:${slug(token)}`;
    if (characterNodeByToken.has(token)) continue;
    characterNodeByToken.set(token, id);
    nodes.push({
      id,
      type: "character",
      label: token,
      data: {
        token,
        name: firstText(ch?.name, name),
        description: String(ch?.description || ch?.appearance || "").slice(0, 400),
        imageUrl: toDisplayUrl(ch?.imageUrl || ch?.sheetUrl || ch?.ref || ""),
      },
    });
  }

  // 장소 노드: sceneLocation 이 같은 컷은 같은 세트를 쓴다(플레이트·방위의 단위).
  const locationNodeByKey = new Map<string, string>();
  const sceneIds: string[] = [];

  scenes.forEach((s, idx) => {
    const sceneId = s?.id != null ? String(s.id) : String(idx + 1);
    const nodeId = `cut:${sceneId}`;
    sceneIds.push(nodeId);
    const common = typeof s?.common === "string" ? s.common : "";
    const imagePrompt = buildSceneImagePrompt(s, header, {});
    const videoPrompt = buildSceneVideoPrompt(s, header, payload, {});
    const lineage = s?.lineage && typeof s.lineage === "object" ? s.lineage : null;
    const stillUrl = toDisplayUrl(s?.imageDataUrl || s?.imagePath || "");
    const clipUrl = toDisplayUrl(s?.videoUrl || s?.videoPath || "");
    nodes.push({
      id: nodeId,
      type: "cut",
      label: firstText(s?.title, `Scene ${sceneId}`),
      data: {
        sceneId: s?.id ?? idx + 1,
        order: idx,
        shotType: String(s?.shotType || "MS"),
        cameraMove: String(s?.cameraMove || "static"),
        cameraDirection: String(s?.cameraDirection || "front"),
        composition: String(s?.composition || ""),
        action: String(s?.action || ""),
        visual: String(s?.shot || s?.visual || ""),
        sceneLocation: String(s?.sceneLocation || s?.location || ""),
        narration: String(s?.narration || "").slice(0, 300),
        lyrics: String(s?.lyrics || "").slice(0, 300),
        estSec: Number(s?.estSec) || 0,
        beats: Array.isArray(s?.beats) ? s.beats : null,
        common,
        promptText: typeof s?.promptText === "string" ? s.promptText : "",
        promptEdited: !!s?.promptEdited,
        imagePrompt,
        videoPrompt,
        still: {
          url: stillUrl,
          ref: String(s?.imageDataUrl || s?.imagePath || ""),
          history: (Array.isArray(s?.imageHistory) ? s.imageHistory : []).map(toDisplayUrl).filter(Boolean),
        },
        clip: {
          url: clipUrl,
          ref: String(s?.videoUrl || s?.videoPath || ""),
          status: String(s?.videoStatus || ""),
          jobId: String(s?.videoJobId || ""),
          error: String(s?.videoError || ""),
        },
        lineage,
        cutRefId: String(s?.cutRefId || ""),
        cutRefEnabled: !!s?.cutRefEnabled,
      },
    });

    if (idx > 0) {
      edges.push({ id: `seq:${sceneIds[idx - 1]}>${nodeId}`, type: "sequence", from: sceneIds[idx - 1], to: nodeId });
    }
    if (common.trim()) {
      edges.push({ id: `common>${nodeId}`, type: "commonOverride", from: "common", to: nodeId, label: "오버라이드" });
    }
    const loc = String(s?.sceneLocation || s?.location || "").trim();
    if (loc) {
      const key = slug(loc);
      let locId = locationNodeByKey.get(key);
      if (!locId) {
        locId = `location:${key}`;
        locationNodeByKey.set(key, locId);
        nodes.push({ id: locId, type: "location", label: loc, data: { name: loc } });
      }
      edges.push({ id: `${locId}>${nodeId}`, type: "location", from: locId, to: nodeId });
    }
    const mentioned = tokensIn([s?.composition, s?.shot, s?.visual, s?.action].map((v) => String(v || "")).join("\n"));
    for (const token of mentioned) {
      const chId = characterNodeByToken.get(token);
      if (chId) edges.push({ id: `${chId}>${nodeId}`, type: "character", from: chId, to: nodeId });
    }
  });

  // 컷 참조 엣지는 컷 노드가 전부 만들어진 뒤에 잇는다(앞 컷이 뒤 컷을 참조할 수도 있다).
  scenes.forEach((s, idx) => {
    const sceneId = s?.id != null ? String(s.id) : String(idx + 1);
    const refRaw = String(s?.cutRefId || "").trim();
    if (!s?.cutRefEnabled || !refRaw) return;
    if (refRaw.startsWith("loc:")) {
      const locId = locationNodeByKey.get(slug(refRaw.slice(4)));
      if (locId) edges.push({ id: `ref:${locId}>cut:${sceneId}`, type: "cutRef", from: locId, to: `cut:${sceneId}`, label: "플레이트 참조" });
      return;
    }
    const target = `cut:${refRaw}`;
    if (target !== `cut:${sceneId}` && sceneIds.includes(target)) {
      edges.push({ id: `ref:${target}>cut:${sceneId}`, type: "cutRef", from: target, to: `cut:${sceneId}`, label: "컷 참조" });
    }
  });

  const done = scenes.filter((s) => s?.imageDataUrl || s?.imagePath).length;
  const clips = scenes.filter((s) => s?.videoUrl || s?.videoPath).length;
  return {
    projectId,
    title: String(project.title || payload.episodeTitle || payload.topic || projectId),
    header: headerClean,
    nodes,
    edges,
    summary: { scenes: scenes.length, stills: done, clips },
  };
}

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const projectId = String(new URL(request.url).searchParams.get("projectId") || "").trim();
    if (!projectId) return send({ error: "projectId is required" }, 400, origin);
    const ctx = { request, env, authHeader: String(request.headers.get("Authorization") || ""), userId: auth.userId };
    const project = await AGENT_TOOLS.project_get.run({ projectId }, ctx as any);
    const graph = buildProductionGraph({
      projectId,
      title: project?.title,
      header: project?.header,
      payload: project?.payload,
      scenes: project?.scenes,
    });
    return send({ ok: true, ...graph }, 200, origin);
  } catch (e: any) {
    return send({ error: String(e?.message || e || "production graph failed") }, 500, origin);
  }
};
