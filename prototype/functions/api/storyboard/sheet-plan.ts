// prototype/functions/api/storyboard/sheet-plan.ts
// 스토리보드 제작 계획·프롬프트 조립 엔드포인트.
// 이미지 생성은 하지 않는다 — 브라우저가 여기서 받은 prompt·panels 로 /api/imagen 을 부르고(30초 제한 동일),
// 결과 시트를 격자로 잘라(콘티) 보여 준다. 프롬프트의 단일 원천은 _shared/storyboard-sheet.js.
import { authorizeRequest } from "../_shared/auth.js";
import {
  planSheets,
  buildBibleCharacterSheetPrompt,
  buildBibleSetSheetPrompt,
  buildStoryboardSheetPrompt,
  buildAnglePlateEditPrompt,
  gridCells,
  approxCellSize,
  SHEET_GRID,
  SHEET_RESOLUTIONS,
  SET_ANGLES,
} from "../_shared/storyboard-sheet.js";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

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

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env, { allowQueryToken: true });
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const kind = String(body?.kind || "").trim();
    const header = String(body?.header || "").trim();
    const aspect = String(body?.aspect || "16:9").trim() || "16:9";
    const resolutionRaw = String(body?.resolution || "2K").trim().toUpperCase();
    const resolution = SHEET_RESOLUTIONS.includes(resolutionRaw) ? resolutionRaw : "2K";
    const scenes: any[] = Array.isArray(body?.scenes) ? body.scenes : [];

    if (kind === "plan") {
      const sheets = planSheets(scenes, { perSheet: body?.perSheet });
      return send({ ok: true, kind, sheets, grid: SHEET_GRID, resolutions: SHEET_RESOLUTIONS }, 200, origin);
    }
    if (kind === "bible-characters") {
      const characters = Array.isArray(body?.characters) ? body.characters : [];
      if (!characters.length) return send({ error: "characters is required" }, 400, origin);
      const prompt = buildBibleCharacterSheetPrompt({ header, characters, aspect });
      return send({ ok: true, kind, prompt, resolution, grid: SHEET_GRID, cell: approxCellSize(resolution), label: "bible" }, 200, origin);
    }
    if (kind === "bible-set") {
      const set = body?.set || {};
      if (!String(set?.name || "").trim()) return send({ error: "set.name is required" }, 400, origin);
      const prompt = buildBibleSetSheetPrompt({ header, set, aspect });
      const grid = { cols: 2, rows: 2 };
      return send({ ok: true, kind, prompt, resolution, grid, angles: SET_ANGLES, cell: approxCellSize(resolution, 2, 2), label: "bible" }, 200, origin);
    }
    if (kind === "board") {
      const set = body?.set || {};
      const wantIds = (Array.isArray(body?.cutIds) ? body.cutIds : []).map((v: any) => String(v).trim());
      const byId = new Map<string, any>();
      scenes.forEach((s, i) => byId.set(String(s?.id ?? i + 1), s));
      const cuts = wantIds.length ? wantIds.map((id: string) => byId.get(id)).filter(Boolean) : scenes;
      if (!cuts.length) return send({ error: "cuts are required (cutIds or scenes)" }, 400, origin);
      const built = buildStoryboardSheetPrompt({
        header,
        set,
        cuts,
        aspect,
        characterNames: body?.characterNames,
        hasTopMaster: body?.hasTopMaster === true,
        createTopMaster: body?.createTopMaster === true,
        previousCutRef: String(body?.previousCutRef || ""),
      });
      return send({ ok: true, kind, prompt: built.prompt, panels: built.panels, resolution, grid: SHEET_GRID, cell: approxCellSize(resolution), label: "conti" }, 200, origin);
    }
    if (kind === "angle-plate") {
      const set = body?.set || {};
      const prompt = buildAnglePlateEditPrompt({ set, angle: body?.angle, header });
      return send({ ok: true, kind, prompt, angle: String(body?.angle || "high"), generationMode: "image-to-image", cameraTargetMode: "scene" }, 200, origin);
    }
    if (kind === "cells") {
      const cols = Number(body?.cols) || SHEET_GRID.cols; const rows = Number(body?.rows) || SHEET_GRID.rows;
      return send({ ok: true, kind, cells: gridCells(body?.width, body?.height, cols, rows, body?.gutterPx) }, 200, origin);
    }
    return send({ error: "unknown kind" }, 400, origin);
  } catch (e: any) {
    return send({ error: e?.message || "sheet-plan failed" }, 500, origin);
  }
};
