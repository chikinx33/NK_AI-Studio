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
import { mentionTokens } from "../_shared/token-match.js";
import { isSheetStale } from "../_shared/storyboard-sheet.js";

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

/** 순수 함수 — 테스트가 직접 호출한다. */
export function buildProductionGraph(project: { projectId: string; title?: string; header?: string; payload?: any; scenes?: any[] }) {
  const projectId = String(project.projectId || "");
  const payload = project.payload && typeof project.payload === "object" ? project.payload : {};
  const header = String(project.header || payload.header || "");
  // 장소(세트) 자산: 마스터 플레이트·방위/앵글 변형·세트 시트(바이블). 캔버스 배경 카드가 보여 준다.
  const normLoc = (v: unknown) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  const episodeLocations: any[] = Array.isArray(payload.episodeLocations) ? payload.episodeLocations : [];
  const sheetsById = new Map<string, any>((Array.isArray(payload.storyboardSheets) ? payload.storyboardSheets : []).map((sh: any) => [String(sh?.id || ""), sh]));
  const locationAssets = (name: string) => {
    const key = normLoc(name);
    const hit = episodeLocations.find((l) => normLoc(l?.name) === key || normLoc(l?.id) === key) || null;
    if (!hit) return { description: "", layout: null, masterAngle: "", topPlateUrl: "", topPlateRef: "", plateDiag: null, plateUrl: "", plateRef: "", variants: [], setSheet: null };
    const sheetMeta = hit.setSheet && typeof hit.setSheet === "object" ? hit.setSheet : null;
    const sheet = sheetMeta ? sheetsById.get(String(sheetMeta.sheetId || "")) || null : null;
    const topVariant = (Array.isArray(hit.variants) ? hit.variants : []).find((v: any) => v && v.id === "angle-top" && v.refObjectName);
    return {
      description: String(hit.description || ""),
      layout: (hit.layout && typeof hit.layout === "object") ? hit.layout : (typeof hit.layout === "string" ? hit.layout : null),
      masterAngle: String(hit.masterAngle || ""),
      topPlateUrl: topVariant ? toDisplayUrl(topVariant.refObjectName) : "",
      topPlateRef: topVariant ? String(topVariant.refObjectName) : "",
      plateDiag: (hit.plateDiag && typeof hit.plateDiag === "object") ? hit.plateDiag : null,
      plateUrl: toDisplayUrl(hit.refObjectName || ""),
      plateRef: String(hit.refObjectName || ""),
      variants: (Array.isArray(hit.variants) ? hit.variants : []).filter((v: any) => v && v.refObjectName).map((v: any) => ({ id: String(v.id || ""), label: String(v.label || ""), url: toDisplayUrl(v.refObjectName), objectName: String(v.refObjectName || "") })),
      setSheet: sheetMeta ? {
        sheetId: String(sheetMeta.sheetId || ""), objectName: String(sheetMeta.objectName || ""), url: toDisplayUrl(sheetMeta.objectName || ""),
        resolution: String(sheetMeta.resolution || sheet?.resolution || ""), createdAt: String(sheetMeta.createdAt || ""),
        diag: (sheet?.diag && typeof sheet.diag === "object") ? sheet.diag : (sheetMeta.diag && typeof sheetMeta.diag === "object" ? sheetMeta.diag : null),
        panels: Array.isArray(sheet?.panels) ? sheet.panels.map((pn: any) => ({ index: Number(pn?.index) || 0, ref: String(pn?.ref || ""), angleLabel: String(pn?.angleLabel || ""), status: String(pn?.status || "pending"), url: toDisplayUrl(pn?.objectName || "") })) : [],
      } : null,
    };
  };
  const headerClean = cleanHeader(header);
  const scenes: any[] = Array.isArray(project.scenes) ? project.scenes : [];
  const boardSheets: any[] = (Array.isArray(payload.storyboardSheets) ? payload.storyboardSheets : [])
    .filter((sheet: any) => sheet?.kind === "board" && !isSheetStale(sheet, scenes))
    .sort((a: any, b: any) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
  const storyboardFor = (sceneId: unknown) => {
    for (const sheet of boardSheets) {
      const panel = (Array.isArray(sheet?.panels) ? sheet.panels : []).find((p: any) => p?.role === "cut" && String(p?.ref) === String(sceneId));
      if (panel) return {
        sheetId: String(sheet.id || ""), sceneNo: Number(sheet.sceneNo) || 0, panelIndex: Number(panel.index) || 0,
        status: String(panel.status || "pending"), url: toDisplayUrl(panel.objectName || ""), objectName: String(panel.objectName || ""),
      };
    }
    return null;
  };
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: "common",
    type: "common",
    label: "공통 프롬프트",
    data: {
      text: headerClean, raw: header, aspectRatio: String(payload.aspectRatio || project.payload?.aspectRatio || ""),
      // 개요(프리프로덕션)를 함께 실어 캔버스가 따로 조회하지 않고 바로 보여준다.
      overview: {
        topic: String(project.title || payload.topic || ""),
        story: String(payload.story || ""),
        purposeCategory: String(payload.purposeCategory || ""),
        purposeTag: String((Array.isArray(payload.purposeTags) ? payload.purposeTags[0] : payload.purposeTags) || ""),
        target: String(payload.target || ""),
        need: String((Array.isArray(payload.needs) ? payload.needs[0] : payload.needs) || ""),
        tone: String((Array.isArray(payload.tones) ? payload.tones[0] : payload.tones) || ""),
        style: String((Array.isArray(payload.styles) ? payload.styles[0] : payload.styles) || ""),
        duration: String(payload.duration || ""),
        voiceMode: payload.dubbingEnabled ? "dubbing" : payload.narrationEnabled ? "narration" : "none",
        characterCount: Array.isArray(payload.characters) ? payload.characters.length : 0,
      },
    },
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
    const storyboard = storyboardFor(s?.id ?? idx + 1);
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
        cameraElevation: String(s?.cameraElevation || "eye"),
        // 정면 기준 블로킹([{token,x,depth,facing}]). 프리비즈가 초기 배치로 읽고, 반영하면 scene_upsert 로 다시 쓴다.
        blocking: Array.isArray(s?.blocking) ? s.blocking : null,
        composition: String(s?.composition || ""),
        action: String(s?.action || ""),
        visual: String(s?.shot || s?.visual || ""),
        sceneLocation: String(s?.sceneLocation || s?.location || "").trim() || (episodeLocations.length === 1 ? String(episodeLocations[0]?.name || "").trim() : ""),
        narration: String(s?.narration || "").slice(0, 300),
        lyrics: String(s?.lyrics || "").slice(0, 300),
        // 노래 구간(순서 변경 검사용): 구간 순서·가사 시작 컷이 어긋나면 캔버스가 경고한다.
        songSectionId: String(s?.songSectionId || ""),
        songSectionLabel: String(s?.songSectionLabel || ""),
        songCues: Array.isArray(s?.songCues) ? s.songCues : [],
        isRefrain: !!s?.isRefrain,
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
        // 이 컷부터 새 씬(같은 세트 안에서 나눈 씬). 캔버스 씬 바가 장소 변화와 함께 이 값으로 갈린다.
        sceneBreak: !!s?.sceneBreak,
        storyboard,
      },
    });

    if (idx > 0) {
      edges.push({ id: `seq:${sceneIds[idx - 1]}>${nodeId}`, type: "sequence", from: sceneIds[idx - 1], to: nodeId });
    }
    if (common.trim()) {
      edges.push({ id: `common>${nodeId}`, type: "commonOverride", from: "common", to: nodeId, label: "오버라이드" });
    }
    // 세트가 하나뿐인 프로젝트에서 장소가 빈 컷은 그 세트의 컷이다(빈 장소 = 데이터 유실이지 "다른 곳"이 아니다).
    const soleSet = episodeLocations.length === 1 ? String(episodeLocations[0]?.name || "").trim() : "";
    const loc = String(s?.sceneLocation || s?.location || "").trim() || soleSet;
    if (loc) {
      const key = slug(loc);
      let locId = locationNodeByKey.get(key);
      if (!locId) {
        locId = `location:${key}`;
        locationNodeByKey.set(key, locId);
        nodes.push({ id: locId, type: "location", label: loc, data: { name: loc, ...locationAssets(loc) } });
      }
      edges.push({ id: `${locId}>${nodeId}`, type: "location", from: locId, to: nodeId });
    }
    // 조사가 붙은 언급("@하나가")도 등록 캐릭터로 잇는다.
    const mentioned = mentionTokens([s?.composition, s?.shot, s?.visual, s?.action].map((v) => String(v || "")).join("\n"), [...characterNodeByToken.keys()]);
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
  const storyboards = scenes.filter((s, idx) => !!storyboardFor(s?.id ?? idx + 1)).length;
  const approvedStoryboards = scenes.filter((s, idx) => storyboardFor(s?.id ?? idx + 1)?.status === "approved").length;
  return {
    projectId,
    title: String(project.title || payload.episodeTitle || payload.topic || projectId),
    header: headerClean,
    nodes,
    edges,
    summary: { scenes: scenes.length, storyboards, approvedStoryboards, stills: done, clips },
    // 캔버스 배치(바·카드 위치). 프로젝트에 저장된 것이 있으면 그대로 돌려준다.
    canvasLayout: payload.canvasLayout && typeof payload.canvasLayout === "object" ? payload.canvasLayout : null,
    // 노래 구간 목록(id·label 순서). 컷 순서 변경 시 구간 순서 검사에 쓴다.
    // 스타일 앵커(프로젝트 그림체 기준 이미지 — 첫 세트 시트). 배경 카드·상세에 "스타일 기준" 배지로 보인다.
    styleAnchor: (payload.styleAnchor && typeof payload.styleAnchor === "object" && payload.styleAnchor.objectName)
      ? { objectName: String(payload.styleAnchor.objectName), sheetId: String(payload.styleAnchor.sheetId || ""), setName: String(payload.styleAnchor.setName || ""), url: toDisplayUrl(payload.styleAnchor.objectName), pickedBy: String(payload.styleAnchor.pickedBy || ""), createdAt: String(payload.styleAnchor.createdAt || "") }
      : null,
    // 프리비즈 문서(세트 무대·컷별 인물/카메라 키프레임). 프리비즈 화면이 읽고 저장 버튼이 payload.previz 로 쓴다.
    previz: payload.previz && typeof payload.previz === "object" ? payload.previz : null,
    songSections: Array.isArray(payload.songSections) ? payload.songSections.map((x: any) => ({ id: String(x?.id || ""), label: String(x?.label || ""), role: String(x?.role || "") })) : [],
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
