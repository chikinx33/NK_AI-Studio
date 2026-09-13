/**
 * 스토리보드 시트(P0 실험) — 프롬프트 빌더·시트 계획·격자 크롭 좌표의 단일 원천.
 *
 * 일관성의 근거를 "컷마다 따로 생성 + 텍스트 설득"에서 "한 번의 생성(시트) + 그 결과물을 참조로 재현"으로
 * 옮긴다. 이 모듈은 순수 함수만 두고(브라우저 의존 없음) /api/storyboard/sheet-plan 이 호출한다.
 * 설계서: docs/storyboard-sheet-consistency-design.md (2·5·6·8장)
 *
 * 라벨 규칙: 시트에서 잘라낸 패널은 "콘티", 컷을 정식으로 생성한 이미지는 "스틸컷". 콘티는 컷의
 * imageDataUrl(스틸컷 자리)에 넣지 않는다.
 */

export const SHEET_GRID = { cols: 3, rows: 3 };
export const DEFAULT_CUTS_PER_SHEET = 6;
export const MAX_CUTS_PER_SHEET = 8;
export const SHEET_RESOLUTIONS = ["2K", "4K"];
/** 세트 시트의 기준 앵글(2×2). front = 마스터 플레이트와 같은 정면 아이레벨. */
export const SET_ANGLES = [
  { id: "front", label: "정면(아이레벨)", instruction: "front view at eye level, the master establishing angle" },
  { id: "back", label: "후면(리버스)", instruction: "reverse angle: the camera has turned around 180 degrees and shows the side that was behind the camera" },
  { id: "high", label: "하이앵글(부감)", instruction: "high angle looking down at the set from above, about 45 degrees" },
  { id: "low", label: "로우앵글", instruction: "low angle looking up from near the floor" },
];
export const CHARACTER_ANGLES = [
  { id: "front", instruction: "front view, neutral standing pose, full body" },
  { id: "three-quarter", instruction: "three-quarter view, same pose" },
  { id: "side", instruction: "side profile view, same pose" },
];

function t(v) { return String(v == null ? "" : v).trim(); }
function locOf(scene) { return t(scene && (scene.sceneLocation || scene.location)); }
function idOf(scene, idx) { const raw = scene && scene.id; return t(raw === undefined || raw === null || raw === "" ? idx + 1 : raw); }

/** 어휘 → 영어 카메라 힌트(컷 분해 어휘와 같은 키). */
const SHOT_TEXT = { ECU: "extreme close-up", CU: "close-up", MCU: "medium close-up", MS: "medium shot", MLS: "medium long shot", LS: "long shot", ELS: "extreme long shot", WS: "wide shot", OTS: "over-the-shoulder shot", POV: "point-of-view shot", INSERT: "insert shot" };
const DIRECTION_TEXT = { front: "camera facing the front of the set", back: "reverse angle (camera facing the back wall)", left: "camera turned to the left side of the set", right: "camera turned to the right side of the set" };
const ELEVATION_TEXT = { eye: "eye level", high: "high angle looking down", low: "low angle looking up", top: "top-down view" };

export function cameraHintOf(scene) {
  const parts = [];
  const shot = t(scene && scene.shotType).toUpperCase();
  if (SHOT_TEXT[shot]) parts.push(SHOT_TEXT[shot]);
  const dir = t(scene && scene.cameraDirection).toLowerCase();
  if (DIRECTION_TEXT[dir]) parts.push(DIRECTION_TEXT[dir]);
  const elev = t(scene && scene.cameraElevation).toLowerCase() || "eye";
  if (ELEVATION_TEXT[elev]) parts.push(ELEVATION_TEXT[elev]);
  return parts.join(", ");
}

/** 컷의 화면(t=0) 문장. composition(120자 이내) → shot/visual 폴백. 배경은 서술하지 않는다(세트 플레이트가 담당). */
export function screenTextOf(scene) {
  return t(scene && (scene.composition || scene.shot || scene.visual || scene.action || scene.title)).slice(0, 160);
}

/**
 * 세트별 시트 계획. 연속 같은 장소를 한 세트 묶음으로 보고(시나리오 화면 Scene N 규칙과 같음),
 * 묶음마다 컷을 perSheet(기본 6)씩 나눈다. 나머지가 2 이하면 앞 시트에 붙여 최대 8까지 채운다.
 * 첫 시트의 1번 칸은 세트 플레이트, 이어지는 시트의 1번 칸은 앞 시트의 마지막 컷(겹침 패널).
 * 시트는 세트를 넘지 않는다.
 * @returns {Array<{ index:number, setName:string, cutIds:string[], anchor:{role:'set'|'overlap', ref:string} }>}
 */
export function planSheets(scenes, opts = {}) {
  const per = Math.max(1, Math.min(MAX_CUTS_PER_SHEET, Number(opts.perSheet) || DEFAULT_CUTS_PER_SHEET));
  const list = Array.isArray(scenes) ? scenes : [];
  const groups = [];
  let last = null;
  list.forEach((s, i) => {
    const loc = locOf(s);
    if (!last || !loc || loc !== last.setName) { last = { setName: loc, ids: [] }; groups.push(last); }
    last.ids.push(idOf(s, i));
  });
  const sheets = [];
  groups.forEach((g) => {
    const chunks = [];
    for (let i = 0; i < g.ids.length; i += per) chunks.push(g.ids.slice(i, i + per));
    if (chunks.length > 1) {
      const tail = chunks[chunks.length - 1];
      const prev = chunks[chunks.length - 2];
      if (tail.length <= 2 && prev.length + tail.length <= MAX_CUTS_PER_SHEET) { prev.push(...tail); chunks.pop(); }
    }
    chunks.forEach((ids, ci) => {
      sheets.push({
        index: sheets.length + 1,
        setName: g.setName,
        cutIds: ids,
        anchor: ci === 0 ? { role: "set", ref: g.setName } : { role: "overlap", ref: chunks[ci - 1][chunks[ci - 1].length - 1] },
      });
    });
  });
  return sheets;
}

/** 시트가 현재 순서와 어긋났는지(순서 변경 뒤 stale 판정, 2.0.1절): cutIds 가 scenes 에 연속·같은 순서로 나타나야 fresh. */
export function isSheetStale(sheet, scenes) {
  const ids = (Array.isArray(scenes) ? scenes : []).map((s, i) => idOf(s, i));
  const want = (sheet && Array.isArray(sheet.cutIds) ? sheet.cutIds : []).map((v) => t(v));
  if (!want.length) return false;
  const start = ids.indexOf(want[0]);
  if (start < 0) return true;
  for (let k = 0; k < want.length; k++) if (ids[start + k] !== want[k]) return true;
  return false;
}

function gridLine(cols, rows, aspect) {
  return `STORYBOARD SHEET: a ${cols}x${rows} grid of ${cols * rows} panels on a plain white background, every panel exactly ${aspect || "16:9"}, thin white gutters between panels, a small panel number in the top-left corner of each panel, no other text, captions or labels anywhere.`;
}

const NO_MERGE = "Do not merge panels. Do not let anything cross a gutter. Do not change character design, costume, or set between panels. Each panel is one complete frame.";
const STYLE_LOCK = "IMPORTANT: Render every panel in the EXACT SAME art style, medium, and visual look defined by the style/mood lines above and the reference images. Do not invent or change the art style.";

/**
 * 바이블 캐릭터 시트(3×3): 캐릭터 최대 3명 × 앵글 3(정면·3/4·측면). 캐릭터 1명이면 3앵글 + 표정/포즈 변주로 채우지 않고 3칸만 쓴다.
 * @param {{ header:string, characters:Array<{name:string, description?:string}>, aspect?:string }} input
 */
export function buildBibleCharacterSheetPrompt(input) {
  const chars = (Array.isArray(input && input.characters) ? input.characters : []).filter((c) => t(c && c.name)).slice(0, 3);
  const cols = SHEET_GRID.cols; const rows = SHEET_GRID.rows;
  const lines = [t(input && input.header), gridLine(cols, rows, input && input.aspect)];
  let n = 1;
  chars.forEach((c) => {
    CHARACTER_ANGLES.forEach((a) => {
      lines.push(`Panel ${n} (${t(c.name).toUpperCase()} · ${a.id}): ${t(c.name)}${t(c.description) ? ` — ${t(c.description).slice(0, 160)}` : ""}. ${a.instruction}. Plain neutral background, no props.`);
      n += 1;
    });
  });
  for (; n <= cols * rows; n++) lines.push(`Panel ${n}: leave empty (plain white).`);
  lines.push("References: the provided registered images are the characters' identity (face, silhouette, colors, costume). Reproduce them exactly.");
  lines.push(NO_MERGE, STYLE_LOCK);
  return lines.filter(Boolean).join("\n");
}

/**
 * 바이블 세트 시트(2×2): 인물 없는 플레이트를 기준 앵글 4종으로.
 * @param {{ header:string, set:{name:string, description?:string}, aspect?:string }} input
 */
export function buildBibleSetSheetPrompt(input) {
  const set = (input && input.set) || {};
  const name = t(set.name) || "the set";
  const lines = [
    t(input && input.header),
    `SET SHEET: a 2x2 grid of 4 panels on a plain white background, every panel exactly ${(input && input.aspect) || "16:9"}, thin white gutters, a small panel number in the top-left corner of each panel, no other text.`,
    `All four panels show the SAME place: ${name}${t(set.description) ? ` — ${t(set.description).slice(0, 240)}` : ""}. Same architecture, props, materials, palette and lighting in every panel.`,
  ];
  SET_ANGLES.forEach((a, i) => lines.push(`Panel ${i + 1} (${a.id.toUpperCase()}): ${a.instruction}. Empty environment ONLY — no characters, no people, no creatures.`));
  if (input && input.hasStyleRef) {
    lines.push("A STYLE ANCHOR image is provided: it is a DIFFERENT set from this project. Copy its rendering style, medium, line/shading treatment, palette saturation and lighting mood EXACTLY so both sets look like one production. Do NOT copy its layout, furniture, props or camera — this sheet shows a different place.");
  }
  if (input && input.hasPlateRef) {
    lines.push("A reference image of THIS place is also provided: panel 1 must match it and the other panels must be the same place seen from the other angles.");
  }
  lines.push(NO_MERGE, STYLE_LOCK);
  return lines.filter(Boolean).join("\n");
}

/**
 * 스토리보드 시트(3×3): 1번 칸 = 세트 플레이트 또는 겹침 패널, 2~9번 = 컷(기본 6·최대 8).
 * @param {{ header:string, set:{name:string, description?:string}, cuts:any[], anchor?:{role:'set'|'overlap', ref?:string}, aspect?:string, characterNames?:string[] }} input
 * @returns {{ prompt:string, panels:Array<{index:number, role:'set'|'overlap'|'cut'|'empty', ref:string, label:'conti'}> }}
 */
export function buildStoryboardSheetPrompt(input) {
  const cols = SHEET_GRID.cols; const rows = SHEET_GRID.rows;
  const set = (input && input.set) || {};
  const setName = t(set.name) || "the set";
  const cuts = (Array.isArray(input && input.cuts) ? input.cuts : []).slice(0, MAX_CUTS_PER_SHEET);
  const anchor = (input && input.anchor) || { role: "set" };
  const panels = [];
  const lines = [t(input && input.header), gridLine(cols, rows, input && input.aspect)];
  if (anchor.role === "overlap") {
    lines.push(`Panel 1 (OVERLAP): repeat the previous sheet's last frame exactly (provided as the first reference image) — same set, same characters, same lighting. It anchors tone and lighting for this sheet.`);
    panels.push({ index: 1, role: "overlap", ref: t(anchor.ref), label: "conti" });
  } else {
    lines.push(`Panel 1 (SET): ${setName}${t(set.description) ? ` — ${t(set.description).slice(0, 200)}` : ""}. Empty set plate, front view at eye level, no characters. Every other panel takes place inside this exact set.`);
    panels.push({ index: 1, role: "set", ref: setName, label: "conti" });
  }
  cuts.forEach((c, i) => {
    const n = i + 2;
    const id = idOf(c, i);
    const hint = cameraHintOf(c);
    const screen = screenTextOf(c);
    lines.push(`Panel ${n} (CUT ${id}): [${hint || "medium shot, eye level"}] ${screen || "the characters in the set"}. Set: ${setName}.`);
    panels.push({ index: n, role: "cut", ref: id, label: "conti" });
  });
  for (let n = cuts.length + 2; n <= cols * rows; n++) { lines.push(`Panel ${n}: leave empty (plain white).`); panels.push({ index: n, role: "empty", ref: "", label: "conti" }); }
  const names = (Array.isArray(input && input.characterNames) ? input.characterNames : []).map(t).filter(Boolean);
  lines.push(`References: registered character images = identity only (face, silhouette, colors, costume)${names.length ? ` for ${names.join(", ")}` : ""}. The set plate image = layout, materials and lighting of ${setName}. Do not copy the reference framing into the cut panels — each cut panel follows its own camera line.`);
  lines.push(NO_MERGE, STYLE_LOCK);
  return { prompt: lines.filter(Boolean).join("\n"), panels };
}

/**
 * 플레이트 앵글 생성(편집 모드, 5.3절): 마스터 플레이트를 "편집"해 다른 앵글을 얻는다. 참조로 정면을 섞지 않는다.
 * @param {{ set:{name:string, description?:string}, angle:'high'|'low'|'top'|'back', header?:string }} input
 */
export function buildAnglePlateEditPrompt(input) {
  const set = (input && input.set) || {};
  const name = t(set.name) || "this set";
  const angle = t(input && input.angle).toLowerCase() || "high";
  const view = angle === "top" ? "directly from above (top-down view)"
    : angle === "low" ? "from a low angle near the floor, looking up"
      : angle === "back" ? "from the reverse angle (camera turned around 180 degrees)"
        : "from a high angle, looking down at about 45 degrees";
  return [
    `Show this exact set (${name}) ${view}.`,
    "Same layout, same props, same materials, same lighting and palette as the source image. Keep every object where it is; only the camera moves.",
    "No characters, no people, no creatures. Empty set plate.",
    t(input && input.header) ? `Style: ${t(input.header).slice(0, 300)}` : "",
    "Do not add text, borders or labels.",
  ].filter(Boolean).join("\n");
}

/**
 * 격자 셀 좌표(고정 격자). 여백선 검출은 클라이언트가 보정한다(6장).
 * @returns {Array<{index:number, x:number, y:number, w:number, h:number}>}
 */
export function gridCells(width, height, cols = SHEET_GRID.cols, rows = SHEET_GRID.rows, gutterPx = 0) {
  const W = Math.max(1, Number(width) || 0); const H = Math.max(1, Number(height) || 0);
  const g = Math.max(0, Number(gutterPx) || 0);
  const cw = (W - g * (cols + 1)) / cols; const ch = (H - g * (rows + 1)) / rows;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push({ index: r * cols + c + 1, x: Math.round(g + c * (cw + g)), y: Math.round(g + r * (ch + g)), w: Math.round(cw), h: Math.round(ch) });
  }
  return out;
}

/** 시트 출력(16:9)에서 셀 하나의 대략 해상도. 2K(2048×1152)→약 670×370, 4K(4096×2304)→약 1340×750. */
export function approxCellSize(resolution, cols = SHEET_GRID.cols, rows = SHEET_GRID.rows) {
  const px = String(resolution).toUpperCase() === "4K" ? 4096 : String(resolution).toUpperCase() === "1K" ? 1024 : 2048;
  const cell = gridCells(px, Math.round(px * 9 / 16), cols, rows, 8)[0];
  return { w: cell.w, h: cell.h, sheetPx: px };
}
