// prototype/functions/api/_shared/previz-plan.js
// 프리비즈 자동 연출 — LLM 에 넘길 "연출 계획" 요청을 만든다(순수 함수, 노드 테스트가 직접 불러온다).
//
// 역할 분담
//   - LLM: 시나리오를 읽고 "의도"를 정한다. 누가 어디에 서고 누구를 보는지, 언제 어디로 움직이는지,
//     이 컷의 주인공은 누구이고 카메라가 어느 쪽에서 어떤 크기로, 언제부터 언제까지 어떻게 움직이는지.
//   - 클라이언트 풀이기(ai-company-app/src/previz/autoStage.ts): 그 의도를 미터 좌표·렌즈·키프레임으로 계산한다.
//     충돌 회피, 180도 규칙, 샷 크기에 맞는 카메라 거리, 무브 경로는 여기서가 아니라 거기서 결정된다.
// 특정 캐릭터·장르를 전제하지 않는다. 키·자세·위치는 전부 프로젝트 데이터와 이 요청에서 온다.

import { mentionTokens, resolveMentionToken } from "./token-match.js";

export const PREVIZ_PLAN_MODEL = "claude-sonnet-4-6";
export const PREVIZ_PLAN_MAX_TOKENS = 2400;
/** 한 요청에 계획할 최대 컷 수(Cloudflare 30초 안에 응답이 끝나게). 클라이언트도 같은 값으로 나눈다. */
export const PREVIZ_PLAN_CHUNK = 4;

const clip = (v, n) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

function firstText(...values) {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

export function normToken(v) {
  const t = String(v || "").trim().replace(/^@+/, "");
  return t ? `@${t}` : "";
}

/** 프로젝트에 등록된 캐릭터(production-graph 와 같은 규칙으로 토큰을 만든다). */
export function registeredCharacters(payload) {
  const list = Array.isArray(payload?.characters) ? payload.characters : [];
  const seen = new Set();
  const out = [];
  for (const ch of list) {
    const name = firstText(ch?.trigger, ch?.token, ch?.name, ch?.displayName);
    const token = normToken(name);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push({
      token,
      name: firstText(ch?.displayName, ch?.name, name).replace(/^@+/, ""),
      appearance: clip(firstText(ch?.appearance), 240),
      description: clip(firstText(ch?.description, ch?.personality, ch?.profile), 240),
    });
  }
  return out;
}

function sceneKey(s, idx) {
  return s?.id != null ? String(s.id) : String(idx + 1);
}

function dialogueLines(s) {
  const d = Array.isArray(s?.dialogue) ? s.dialogue : [];
  return d
    .map((x) => {
      const speaker = String(x?.speaker || "").trim();
      const line = String(x?.line || "").trim();
      return line ? `${speaker ? `${normToken(speaker)}: ` : ""}${clip(line, 120)}` : "";
    })
    .filter(Boolean);
}

/** 컷에 등장하는 토큰: 화면·행동·샷 문장, 대사 화자, 기존 블로킹. */
export function tokensOfScene(s, registered) {
  const reg = registered.map((c) => c.token);
  const out = new Set();
  const text = [s?.composition, s?.action, s?.shot, s?.visual, s?.narration].map((v) => String(v || "")).join("\n");
  // 조사가 붙은 언급("@하나가")도 등록 캐릭터로 읽는다.
  for (const t of mentionTokens(text, reg)) out.add(t);
  for (const d of Array.isArray(s?.dialogue) ? s.dialogue : []) {
    const sp = resolveMentionToken(normToken(d?.speaker), reg);
    if (sp && reg.includes(sp)) out.add(sp);
  }
  for (const b of Array.isArray(s?.blocking) ? s.blocking : []) {
    const t = resolveMentionToken(normToken(b?.token || b?.name), reg);
    if (t) out.add(t);
  }
  return [...out];
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const SYSTEM = [
  "You are a film director and cinematographer doing PREVIZ (3D blocking) for an animated or live-action episode.",
  "For each requested cut you decide where every character stands, whom they face, when and where they move, and how the camera covers the cut.",
  "Your output is turned into 3D keyframes by a solver, so be spatially precise and consistent. Never invent characters that are not listed for the cut.",
  "",
  "## Stage coordinates (normalized, one set = one physical room/place)",
  "- Seen from the FRONT camera (standing at the entrance, looking in toward the back wall).",
  "- x: -1 = left wall, 0 = center, +1 = right wall.",
  "- z: -1 = back wall, 0 = middle of the floor, +1 = front (entrance / camera side).",
  "- The set layout (what is on the back/left/right/front walls and the floor) is given when known. Place people relative to it: someone at the desk on the left wall stands near x=-0.8.",
  "- Keep at least ~0.15 apart in normalized units between characters unless they touch or hug.",
  "",
  "## Characters",
  "- heights: realistic standing height in meters from each character's appearance/description (species, age, body). Keep relative scale believable (a small pet 0.3–0.6, a child 1.0–1.4, an adult 1.6–1.9, a giant much more). Only output heights for characters whose height is not already known.",
  "- pose: stand | sit | crouch | lie.",
  "- face: a character token (look at that character), or a wall direction the body faces: front (toward the entrance/front camera), back (toward the back wall), left, right.",
  "",
  "## Continuity",
  "- 'Previous state' is where each character was at the end of the previous cut in this set. Start each character there unless the story clearly jumps in time or the composition text places them elsewhere.",
  "- A character only changes position during a cut when the action says so. Movement happens in 'moves'.",
  "- Timing is in fractions of the cut (0 = start, 1 = end). Align moves and camera moves to the listed beats (seconds). Do NOT spread moments uniformly; real performance has holds and quick moves.",
  "",
  "## Camera",
  "- The cut's shot notes (size, view, angle, move) are the director's intent from the script breakdown. Follow them unless the staging makes them impossible (the subject would be hidden, or it breaks the 180-degree line in a conversation). If you change one, change only that one.",
  "- subjects: who the shot is about (1 for a single, 2 for a two-shot, 3+ for a group). Empty only for an establishing/empty-set shot; then give point [x,z] to look at.",
  "- size: ECU | CU | MCU | MS | MLS | WS | EWS.",
  "- view: which side of the set the camera LOOKS TOWARD, i.e. which wall is in the background: front = looks toward the back wall (same as the master angle), back = reverse angle (looks toward the entrance), left = looks toward the left wall, right = looks toward the right wall.",
  "- angle: eye | high | low | top | worm.",
  "- framing: single | two | group | ots (over the shoulder of 'over', looking at the subject) | pov (through the eyes of subjects[0], looking at 'look') | insert (detail on subjects[0]).",
  "- screen: where the main subject sits in the frame: left | center | right (rule of thirds; in a conversation put each speaker on the side that faces the other).",
  "- move: static | pan | tilt | track | crane | zoom | push_in | pull_out | handheld. t: [start, end] of the move. look: for pan/tilt, the token the camera turns to (optional).",
  "- lens: 18 | 24 | 35 | 50 | 85 | 135 (mm), or omit to let the solver choose from the size.",
  "- 180-degree rule: once two characters talk, keep the camera on the same side of the line between them for the whole scene; reverse angles are over-the-shoulder from that same side.",
  "- Vary coverage across cuts in a scene (size and view) the way an editor needs it; do not repeat the identical setup back to back unless the script asks for it.",
  "",
  "## Output",
  "JSON only, no prose:",
  "{\"set\":{\"w\":6,\"d\":5},\"heights\":{\"@token\":1.7},\"cuts\":[{\"id\":\"<cut id>\",",
  "\"actors\":[{\"who\":\"@token\",\"pos\":[x,z],\"face\":\"@other|front|back|left|right\",\"pose\":\"stand\"}],",
  "\"moves\":[{\"who\":\"@token\",\"t\":[0.3,0.7],\"pos\":[x,z],\"face\":\"back\",\"pose\":\"stand\"}],",
  "\"camera\":{\"subjects\":[\"@token\"],\"size\":\"MS\",\"view\":\"front\",\"angle\":\"eye\",\"framing\":\"single\",\"screen\":\"center\",\"move\":\"static\",\"t\":[0,1],\"over\":\"\",\"look\":\"\",\"point\":[0,0],\"lens\":35}}]}",
  "- set: the playable floor size in meters (width along x, depth along z) that fits this place (a bedroom ~4x4, a classroom ~9x7, a street ~20x12). Omit when 'Set size' is given as fixed.",
  "- moves: 'pos' omitted = turn or change pose in place. Every requested cut must appear once, with every listed character in 'actors'.",
].join("\n");

/**
 * @param project {payload, scenes}
 * @param req {targetIds:string[], contextIds?:string[], prior?:{actors?:[{token,pos:[x,z],face?,pose?}], views?:string[], heights?:Record<string,number>}, setSize?:[w,d]|null}
 * @returns {system, user, targets:[{id, tokens}]}
 */
export function buildPrevizPlanPrompt(project, req) {
  const payload = project?.payload && typeof project.payload === "object" ? project.payload : {};
  const scenes = Array.isArray(project?.scenes) ? project.scenes : [];
  const registered = registeredCharacters(payload);
  const byId = new Map(scenes.map((s, i) => [sceneKey(s, i), s]));
  const targetIds = (Array.isArray(req?.targetIds) ? req.targetIds : []).map(String).filter((id) => byId.has(id));
  if (!targetIds.length) throw new Error("previz_plan_no_cuts");
  const contextIds = (Array.isArray(req?.contextIds) ? req.contextIds : []).map(String).filter((id) => byId.has(id));

  const first = byId.get(targetIds[0]);
  const setName = String(first?.sceneLocation || first?.location || "").trim();
  const locations = Array.isArray(payload.episodeLocations) ? payload.episodeLocations : [];
  const setKey = setName.toLowerCase().replace(/\s+/g, " ");
  const loc = locations.find((l) => String(l?.name || "").trim().toLowerCase().replace(/\s+/g, " ") === setKey) || (locations.length === 1 && !setName ? locations[0] : null);
  const layout = loc?.layout && typeof loc.layout === "object" ? loc.layout : null;

  const targets = targetIds.map((id) => ({ id, tokens: tokensOfScene(byId.get(id), registered) }));
  const involved = new Set(targets.flatMap((t) => t.tokens));
  const known = req?.prior?.heights && typeof req.prior.heights === "object" ? req.prior.heights : {};

  const lines = [];
  lines.push(`[Set] ${setName || "(unnamed)"}${loc?.description ? ` — ${clip(loc.description, 300)}` : ""}`);
  if (layout) {
    lines.push(`[Set layout] ${["back", "left", "right", "front", "floor"].filter((k) => layout[k]).map((k) => `${k}: ${clip(layout[k], 80)}`).join(" | ")}`);
  }
  const size = Array.isArray(req?.setSize) && req.setSize.length === 2 ? [num(req.setSize[0], 0), num(req.setSize[1], 0)] : null;
  if (size && size[0] > 0 && size[1] > 0) lines.push(`[Set size — fixed] ${size[0]}m x ${size[1]}m`);
  const header = clip(project?.header || payload.header || "", 300);
  if (header) lines.push(`[Look / style] ${header}`);

  lines.push("", "[Characters]");
  const chars = registered.filter((c) => involved.has(c.token));
  for (const t of involved) if (!chars.some((c) => c.token === t)) chars.push({ token: t, name: t.slice(1), appearance: "", description: "" });
  if (!chars.length) lines.push("(no characters in these cuts)");
  for (const c of chars) {
    const h = num(known[c.token], 0);
    const body = [c.appearance && `appearance: ${c.appearance}`, c.description && `about: ${c.description}`].filter(Boolean).join(" / ");
    lines.push(`- ${c.token}${body ? ` — ${body}` : ""}${h > 0 ? ` [height known: ${h}m]` : ""}`);
  }

  const priorActors = Array.isArray(req?.prior?.actors) ? req.prior.actors : [];
  if (priorActors.length) {
    lines.push("", "[Previous state — end of the previous cut in this set]");
    for (const a of priorActors) {
      const t = normToken(a?.token);
      const p = Array.isArray(a?.pos) ? a.pos : [0, 0];
      if (!t) continue;
      lines.push(`- ${t}: pos [${num(p[0], 0).toFixed(2)}, ${num(p[1], 0).toFixed(2)}], face ${String(a?.face || "front")}, pose ${String(a?.pose || "stand")}`);
    }
  }
  const views = Array.isArray(req?.prior?.views) ? req.prior.views.filter(Boolean) : [];
  if (views.length) lines.push(`[Camera setups already used in this scene, in order] ${views.join(" → ")}`);

  const contextOnly = contextIds.filter((id) => !targetIds.includes(id));
  if (contextOnly.length) {
    lines.push("", "[Whole scene for context — do NOT plan these]");
    for (const id of contextIds) {
      const s = byId.get(id);
      lines.push(`- cut ${id}${targetIds.includes(id) ? " (requested)" : ""}: ${clip(firstText(s?.action, s?.composition, s?.visual), 140)}`);
    }
  }

  lines.push("", "[Cuts to plan]");
  for (const t of targets) {
    const s = byId.get(t.id);
    const dur = num(s?.estSec, 0);
    lines.push(`## cut ${t.id}${dur > 0 ? ` — ${dur}s` : ""}`);
    lines.push(`characters: ${t.tokens.length ? t.tokens.join(", ") : "(none)"}`);
    if (s?.composition) lines.push(`frame at start (composition): ${clip(s.composition, 400)}`);
    if (s?.action) lines.push(`action during the cut: ${clip(s.action, 400)}`);
    if (!s?.composition && !s?.action && (s?.shot || s?.visual)) lines.push(`shot: ${clip(s.shot || s.visual, 400)}`);
    const beats = Array.isArray(s?.beats) ? s.beats : [];
    if (beats.length) lines.push(`beats: ${beats.map((b) => `${num(b?.at, 0)}s ${clip(b?.what, 80)}`).join(" | ")}`);
    const dl = dialogueLines(s);
    if (dl.length) lines.push(`dialogue: ${dl.join(" | ")}`);
    if (s?.narration) lines.push(`narration: ${clip(s.narration, 200)}`);
    if (s?.lyrics) lines.push(`lyrics: ${clip(s.lyrics, 160)}`);
    lines.push(`shot notes: size ${String(s?.shotType || "MS")}, view ${String(s?.cameraDirection || "front")}, angle ${String(s?.cameraElevation || "eye")}, move ${String(s?.cameraMove || "static")}`);
    const blk = Array.isArray(s?.blocking) ? s.blocking : [];
    if (blk.length) lines.push(`existing blocking (front-camera grid): ${blk.map((b) => `${normToken(b?.token)} ${b?.x || "center"}/${b?.depth || "mid"} facing ${b?.facing || "camera"}`).join("; ")}`);
  }

  return { system: SYSTEM, user: lines.join("\n"), targets };
}

/** 모델 응답에서 JSON 객체를 꺼낸다(코드 펜스·앞뒤 설명 허용). 실패하면 throw. */
export function extractPlanJson(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("previz_plan_not_json");
  const body = raw.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch (_) {
    // 흔한 손상: 끝 쉼표
    return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
  }
}
