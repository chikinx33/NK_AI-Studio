/**
 * previz/autoStage.ts — 자동 연출 풀이기(순수 함수, 노드 테스트가 직접 불러온다).
 *
 * 서버(/api/previz/plan)가 LLM 으로 받은 "연출 계획"(누가 어디에 서고 누구를 보는지, 언제 어디로 움직이는지,
 * 카메라가 누구를 어느 쪽에서 어떤 크기로 언제 어떻게 움직이는지)을 프리비즈 문서의 키프레임으로 바꾼다.
 *
 * 계획은 의도만 담는다. 여기서 계산하는 것:
 *   - 정규화 좌표(-1~1) → 세트 크기에 맞춘 미터 좌표, 인물끼리 겹치지 않게 밀어내기
 *   - 이동: 출발 전 방향 전환 → 이동 → 도착 후 최종 방향·자세 (계획의 시각을 따라 차등 타이밍)
 *   - 카메라: 샷 크기·렌즈·화면비로 거리, 높이(아이레벨·하이·로우·부감·웜) 조건을 만족하는 위치,
 *     화면 3분할 위치, 오버숄더·POV·인서트, 무브(푸시인·풀아웃·팬·틸트·트래킹·크레인·줌·핸드헬드) 경로
 *   - 180도 규칙: 한 씬에서 두 인물 사이 선의 같은 쪽을 유지(어기면 카메라를 선 안쪽으로 돌려 세운다)
 *   - 연속성: 같은 세트에서 앞 컷이 끝난 자리·방향·자세를 다음 컷의 출발점으로
 * 특정 캐릭터·장르를 전제하지 않는다. 계획에 빠진 값은 컷 필드(샷 크기·방위·높이·무브)로 채운다.
 */
import {
  DEFAULT_ACTOR_HEIGHT, EYE_RATIO, KEY_EPS, POSE_HEIGHT, SHOT_RATIO, easeT, normalizePose, sampleActor, verticalFovDeg, wrapDeg,
  type ActorKey, type CameraDirection, type CameraElevation, type CameraKey, type CameraMove, type Pose, type Vec3,
} from "./geometry.ts";
import { ensureSet, normalizeToken, resolveMentionToken, setKeyOf, type CutSource, type PrevizActor, type PrevizCut, type PrevizDoc } from "./model.ts";

export type WallDir = "front" | "back" | "left" | "right";
export type FaceRef = { token: string } | { dir: WallDir } | null;
export type Framing = "single" | "two" | "group" | "ots" | "pov" | "insert";
export type Screen = "left" | "center" | "right";

export interface PlanActor { token: string; pos: [number, number] | null; face: FaceRef; pose: Pose | null }
export interface PlanMove { token: string; t0: number; t1: number; pos: [number, number] | null; face: FaceRef; pose: Pose | null }
export interface PlanCamera {
  subjects: string[];
  size: string;
  view: CameraDirection;
  angle: CameraElevation;
  framing: Framing;
  screen: Screen;
  move: CameraMove;
  t0: number;
  t1: number;
  over: string;
  look: string;
  point: [number, number] | null;
  lens: number | null;
}
export interface CutPlan { sceneId: string; actors: PlanActor[]; moves: PlanMove[]; camera: PlanCamera; fromModel: boolean }
export interface StagePlan { set: { width: number; depth: number } | null; heights: Record<string, number>; cuts: CutPlan[] }

export interface ActorState { x: number; z: number; yaw: number; pose: Pose }
export interface Axis { a: string; b: string; sign: number }
export interface StageCarry { setKey: string; actors: Record<string, ActorState>; axis: Axis | null; views: string[] }

/** 요청 한 번에 계획할 컷 수 — 서버 _shared/previz-plan.js PREVIZ_PLAN_CHUNK 와 같다(테스트가 대조한다). */
export const AUTO_STAGE_CHUNK = 4;

const DEG = Math.PI / 180;
const WALL_DIRS: WallDir[] = ["front", "back", "left", "right"];
const SIZES = ["ECU", "CU", "MCU", "MS", "MLS", "WS", "EWS"];
const FRAMINGS: Framing[] = ["single", "two", "group", "ots", "pov", "insert"];
const MOVES: CameraMove[] = ["static", "pan", "tilt", "track", "crane", "zoom", "push_in", "pull_out", "handheld"];
const ELEVATIONS: CameraElevation[] = ["eye", "high", "low", "top", "worm"];
const LENSES = [18, 24, 35, 50, 85, 135];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v: number, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ── 계획 정규화 ──────────────────────────────────────────────────────────────
function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x = finite(v[0]);
  const z = finite(v[1]);
  return x == null || z == null ? null : [clamp(x, -1, 1), clamp(z, -1, 1)];
}

function frac(v: unknown, fallback: number): number {
  const n = finite(v);
  return n == null ? fallback : clamp(n, 0, 1);
}

/** 컷 필드의 샷 어휘(OTS·POV·INSERT·TWO_SHOT·GROUP 포함) → 크기 + 프레이밍. */
export function sizeAndFramingOf(shotType: string): { size: string; framing: Framing } {
  const k = String(shotType || "MS").toUpperCase().replace(/[\s-]/g, "_");
  if (SIZES.includes(k)) return { size: k, framing: "single" };
  if (k === "OTS") return { size: "MS", framing: "ots" };
  if (k === "POV") return { size: "MCU", framing: "pov" };
  if (k === "INSERT") return { size: "CU", framing: "insert" };
  if (k === "TWO_SHOT") return { size: "MLS", framing: "two" };
  if (k === "GROUP") return { size: "WS", framing: "group" };
  return { size: "MS", framing: "single" };
}

export function normalizeMove(v: unknown, fallback: CameraMove = "static"): CameraMove {
  const k = String(v || "").trim().toLowerCase().replace(/[\s-]/g, "_");
  if ((MOVES as string[]).includes(k)) return k as CameraMove;
  if (k === "dolly" || k === "dolly_in" || k === "pushin") return "push_in";
  if (k === "dolly_out" || k === "pullout") return "pull_out";
  if (k === "tracking" || k === "truck") return "track";
  if (k === "boom" || k === "jib") return "crane";
  return fallback;
}

function normalizeView(v: unknown, fallback: string): CameraDirection {
  const k = String(v || "").trim().toLowerCase();
  if ((WALL_DIRS as string[]).includes(k)) return k as CameraDirection;
  if (k === "reverse") return "back";
  return (WALL_DIRS as string[]).includes(fallback) ? (fallback as CameraDirection) : "front";
}

function normalizeAngle(v: unknown, fallback: string): CameraElevation {
  const k = String(v || "").trim().toLowerCase().replace(/['’\s-]/g, "_");
  if ((ELEVATIONS as string[]).includes(k)) return k as CameraElevation;
  if (k === "eye_level") return "eye";
  if (k === "high_angle" || k === "overhead") return "high";
  if (k === "low_angle") return "low";
  if (k === "top_down" || k === "birds_eye" || k === "bird_s_eye") return "top";
  if (k === "worms_eye" || k === "worm_s_eye") return "worm";
  return (ELEVATIONS as string[]).includes(fallback) ? (fallback as CameraElevation) : "eye";
}

function faceOf(v: unknown, allowed: Set<string>, self: string): FaceRef {
  const s = String(v || "").trim();
  if (!s) return null;
  if (s.startsWith("@")) {
    const t = resolveMentionToken(normalizeToken(s), [...allowed]);
    return t !== self && allowed.has(t) ? { token: t } : null;
  }
  const k = s.toLowerCase();
  if (k === "camera") return { dir: "front" };
  if (k === "away") return { dir: "back" };
  return (WALL_DIRS as string[]).includes(k) ? { dir: k as WallDir } : null;
}

function poseOf(v: unknown): Pose | null {
  return v == null || v === "" ? null : normalizePose(v);
}

/** 컷 필드만으로 만든 계획(모델이 컷을 빠뜨렸을 때). 위치는 비워 두어 연속성·기본 간격이 채운다. */
export function fallbackCutPlan(cut: CutSource): CutPlan {
  const { size, framing } = sizeAndFramingOf(cut.shotType);
  const tokens = [...new Set(cut.tokens.map(normalizeToken).filter(Boolean))];
  return {
    sceneId: cut.sceneId,
    actors: tokens.map((token) => ({ token, pos: null, face: null, pose: null })),
    moves: [],
    camera: {
      subjects: tokens.slice(0, framing === "single" || framing === "insert" || framing === "pov" ? 1 : tokens.length),
      size, view: normalizeView(cut.cameraDirection, "front"), angle: normalizeAngle(cut.cameraElevation, "eye"),
      framing: framing === "single" && tokens.length === 2 && size !== "CU" && size !== "ECU" ? "two" : framing,
      screen: "center", move: normalizeMove(cut.cameraMove), t0: 0.1, t1: 0.9, over: "", look: "", point: null, lens: null,
    },
    fromModel: false,
  };
}

/**
 * 모델 응답(JSON) → 안전한 계획. 요청한 모든 컷이 순서대로 들어가고, 모르는 인물은 버린다.
 * allowed = 프로젝트 등록 캐릭터 + 컷에 적힌 토큰.
 */
export function normalizePlan(raw: unknown, targets: CutSource[], registered: string[]): StagePlan {
  const r: any = raw && typeof raw === "object" ? raw : {};
  const w = finite(r?.set?.w ?? r?.set?.width);
  const d = finite(r?.set?.d ?? r?.set?.depth);
  const set = w != null && d != null && w > 0 && d > 0 ? { width: clamp(round(w, 2), 2, 80), depth: clamp(round(d, 2), 2, 80) } : null;
  const heights: Record<string, number> = {};
  for (const [k, v] of Object.entries(r?.heights && typeof r.heights === "object" ? r.heights : {})) {
    const t = normalizeToken(k);
    const h = finite(v);
    if (t && h != null && h > 0) heights[t] = clamp(round(h, 2), 0.1, 10);
  }
  const rawCuts: any[] = Array.isArray(r?.cuts) ? r.cuts : [];
  const reg = registered.map(normalizeToken).filter(Boolean);

  const cuts = targets.map((cut): CutPlan => {
    const fb = fallbackCutPlan(cut);
    const rc = rawCuts.find((c) => String(c?.id ?? c?.sceneId ?? "") === cut.sceneId);
    if (!rc) return fb;
    const allowed = new Set<string>([...reg, ...cut.tokens.map(normalizeToken)].filter(Boolean));
    // 모델이 조사를 붙여 돌려줘도("@하나가") 이 컷의 인물로 읽는다.
    const tok = (v: unknown) => resolveMentionToken(normalizeToken(v), [...allowed]);

    const actors: PlanActor[] = [];
    for (const a of Array.isArray(rc.actors) ? rc.actors : []) {
      const token = tok(a?.who ?? a?.token);
      if (!token || !allowed.has(token) || actors.some((x) => x.token === token)) continue;
      actors.push({ token, pos: pair(a?.pos), face: null, pose: poseOf(a?.pose) });
    }
    // 컷에 적힌 인물은 모델이 빠뜨려도 무대에 세운다.
    for (const t of fb.actors) if (!actors.some((x) => x.token === t.token)) actors.push({ ...t });
    const inCut = new Set(actors.map((a) => a.token));
    // 방향은 인물 목록이 정해진 뒤에 푼다(이 컷에 없는 인물을 바라볼 수는 없다).
    for (const a of Array.isArray(rc.actors) ? rc.actors : []) {
      const token = tok(a?.who ?? a?.token);
      const hit = actors.find((x) => x.token === token);
      if (hit && !hit.face) hit.face = faceOf(a?.face, inCut, token);
    }

    const rawMoves: any[] = Array.isArray(rc.moves) ? rc.moves : [];
    const moves: PlanMove[] = rawMoves
      .map((m: any): PlanMove | null => {
        const token = tok(m?.who ?? m?.token);
        if (!inCut.has(token)) return null;
        const t = Array.isArray(m?.t) ? m.t : [m?.from, m?.to];
        const t0 = frac(t[0], 0);
        const t1 = Math.max(frac(t[1], Math.min(1, t0 + 0.4)), Math.min(1, t0 + 0.05));
        const mv = { token, t0, t1, pos: pair(m?.pos), face: faceOf(m?.face, inCut, token), pose: poseOf(m?.pose) };
        return mv.pos || mv.face || mv.pose ? mv : null;
      })
      .filter((m: PlanMove | null): m is PlanMove => !!m)
      .sort((a: PlanMove, b: PlanMove) => a.t0 - b.t0);

    const c = rc.camera && typeof rc.camera === "object" ? rc.camera : {};
    const sf = SIZES.includes(String(c.size || "").toUpperCase()) ? { size: String(c.size).toUpperCase(), framing: fb.camera.framing } : sizeAndFramingOf(String(c.size || cut.shotType));
    const framing: Framing = (FRAMINGS as string[]).includes(String(c.framing)) ? (c.framing as Framing) : sf.framing;
    const subjects = [...new Set((Array.isArray(c.subjects) ? c.subjects : []).map(tok).filter((t: string) => inCut.has(t)))] as string[];
    const t = Array.isArray(c.t) ? c.t : [c.from, c.to];
    const t0 = frac(t[0], 0.1);
    const lensN = finite(c.lens);
    const over = tok(c.over);
    const look = tok(c.look);
    return {
      sceneId: cut.sceneId,
      actors,
      moves,
      camera: {
        subjects: subjects.length || c.point ? subjects : fb.camera.subjects.filter((s) => inCut.has(s)),
        size: sf.size,
        view: normalizeView(c.view ?? c.side, cut.cameraDirection),
        angle: normalizeAngle(c.angle ?? c.elevation, cut.cameraElevation),
        framing,
        screen: c.screen === "left" || c.screen === "right" ? c.screen : "center",
        move: normalizeMove(c.move, normalizeMove(cut.cameraMove)),
        t0,
        t1: Math.max(frac(t[1], 0.9), Math.min(1, t0 + 0.1)),
        over: inCut.has(over) ? over : "",
        look: inCut.has(look) ? look : "",
        point: pair(c.point),
        lens: lensN != null ? LENSES.reduce((best, l) => (Math.abs(l - lensN) < Math.abs(best - lensN) ? l : best), 35) : null,
      },
      fromModel: true,
    };
  });
  return { set, heights, cuts };
}

// ── 씬 묶기 ──────────────────────────────────────────────────────────────────
/** 같은 세트가 이어지고 씬 나누기가 없는 컷들을 한 씬으로. 180도 선·카메라 셋업 기록의 단위. */
export function groupScenes(cuts: CutSource[]): CutSource[][] {
  const out: CutSource[][] = [];
  for (const c of [...cuts].sort((a, b) => a.order - b.order)) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && setKeyOf(prev.sceneLocation) === setKeyOf(c.sceneLocation) && !c.sceneBreak && c.order === prev.order + 1) last.push(c);
    else out.push([c]);
  }
  return out;
}

export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += Math.max(1, size)) out.push(list.slice(i, i + Math.max(1, size)));
  return out;
}

// ── 좌표 도우미 ──────────────────────────────────────────────────────────────
function margins(width: number, depth: number) {
  return { hx: Math.max(0.2, width / 2 - Math.min(0.35, width / 6)), hz: Math.max(0.2, depth / 2 - Math.min(0.35, depth / 6)) };
}

export function toMeters(p: [number, number], width: number, depth: number): [number, number] {
  const { hx, hz } = margins(width, depth);
  return [round(p[0] * hx, 3), round(p[1] * hz, 3)];
}

export function toNormalized(x: number, z: number, width: number, depth: number): [number, number] {
  const { hx, hz } = margins(width, depth);
  return [round(clamp(x / hx, -1, 1), 2), round(clamp(z / hz, -1, 1), 2)];
}

export function yawOfDir(dir: WallDir): number {
  return dir === "back" ? 180 : dir === "right" ? 90 : dir === "left" ? -90 : 0;
}

export function dirOfYaw(yaw: number): WallDir {
  const a = wrapDeg(yaw);
  if (Math.abs(a) <= 45) return "front";
  if (Math.abs(a) >= 135) return "back";
  return a > 0 ? "right" : "left";
}

/** (x,z) 에서 (tx,tz) 를 보는 yaw(0 = +Z, 90 = +X). */
export function yawToward(x: number, z: number, tx: number, tz: number, fallback = 0): number {
  const dx = tx - x;
  const dz = tz - z;
  return Math.hypot(dx, dz) < 1e-4 ? fallback : round(Math.atan2(dx, dz) / DEG, 2);
}

const radiusOf = (h: number) => clamp(0.17 * h, 0.12, 0.6);

// ── 인물 ─────────────────────────────────────────────────────────────────────
type DraftKey = ActorKey & { faceTok?: string };

function effectiveHeight(height: number, pose: Pose | undefined) {
  return height * POSE_HEIGHT[normalizePose(pose)];
}

/** 겹친 인물을 밀어낸다(세트 안으로). 첫 인물부터 자리를 잡고 뒤 인물이 비킨다. */
export function separate(points: Array<{ x: number; z: number; r: number }>, width: number, depth: number): Array<{ x: number; z: number }> {
  const { hx, hz } = margins(width, depth);
  const pts = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (let i = 0; i < pts.length; i++) {
      for (let j = 0; j < i; j++) {
        const min = pts[i].r + pts[j].r + 0.05;
        let dx = pts[i].x - pts[j].x;
        let dz = pts[i].z - pts[j].z;
        let dist = Math.hypot(dx, dz);
        if (dist >= min) continue;
        if (dist < 1e-4) { dx = (i % 2 ? -1 : 1); dz = 0.3; dist = Math.hypot(dx, dz); }
        const push = min - dist;
        pts[i].x += (dx / dist) * push;
        pts[i].z += (dz / dist) * push;
        moved = true;
      }
      pts[i].x = clamp(pts[i].x, -hx, hx);
      pts[i].z = clamp(pts[i].z, -hz, hz);
    }
    if (!moved) break;
  }
  return pts.map((p) => ({ x: round(p.x, 3), z: round(p.z, 3) }));
}

/** 한 점을 고정된 다른 점들에서 떼어 놓는다(다른 인물은 움직이지 않는다). */
export function pushAway(p: { x: number; z: number; r: number }, fixed: Array<{ x: number; z: number; r: number }>, width: number, depth: number): { x: number; z: number } {
  const { hx, hz } = margins(width, depth);
  let { x, z } = p;
  for (let iter = 0; iter < 12; iter++) {
    let moved = false;
    for (const f of fixed) {
      const min = p.r + f.r + 0.05;
      let dx = x - f.x;
      let dz = z - f.z;
      let dist = Math.hypot(dx, dz);
      if (dist >= min) continue;
      if (dist < 1e-4) { dx = 1; dz = 0.3; dist = Math.hypot(dx, dz); }
      x += (dx / dist) * (min - dist);
      z += (dz / dist) * (min - dist);
      moved = true;
    }
    x = clamp(x, -hx, hx);
    z = clamp(z, -hz, hz);
    if (!moved) break;
  }
  return { x: round(x), z: round(z) };
}

function solveActors(plan: CutPlan, width: number, depth: number, duration: number, carry: StageCarry, heights: Record<string, number>): PrevizActor[] {
  const n = plan.actors.length;
  // 출발점: 계획 좌표 → 앞 컷이 끝난 자리 → 가로로 벌려 세우기
  const starts = plan.actors.map((a, i) => {
    const prev = carry.actors[a.token];
    const [x, z] = a.pos ? toMeters(a.pos, width, depth) : prev ? [prev.x, prev.z] : [round((i - (n - 1) / 2) * 1.1, 3), 0];
    return { x, z, r: radiusOf(heights[a.token] ?? DEFAULT_ACTOR_HEIGHT) };
  });
  const placed = separate(starts, width, depth);

  const drafts: Array<{ token: string; height: number; keys: DraftKey[] }> = plan.actors.map((a, i) => {
    const prev = carry.actors[a.token];
    const height = heights[a.token] ?? DEFAULT_ACTOR_HEIGHT;
    const startPose: Pose = a.pose ?? prev?.pose ?? "stand";
    const k0: DraftKey = { t: 0, x: placed[i].x, z: placed[i].z, yaw: a.face && "dir" in a.face ? yawOfDir(a.face.dir) : prev?.yaw ?? 0, pose: startPose, ease: "smooth" };
    if (a.face && "token" in a.face) k0.faceTok = a.face.token;
    const keys: DraftKey[] = [k0];
    let cur = { ...k0 };
    for (const m of plan.moves.filter((mv) => mv.token === a.token)) {
      const last = keys[keys.length - 1];
      const T0 = Math.max(last.t + KEY_EPS, round(m.t0 * duration, 3));
      if (T0 >= duration - KEY_EPS) break;
      const T1 = Math.min(duration, Math.max(T0 + 0.3, round(m.t1 * duration, 3)));
      const finalYaw = m.face && "dir" in m.face ? yawOfDir(m.face.dir) : null;
      const finalTok = m.face && "token" in m.face ? m.face.token : undefined;
      const dest = m.pos ? toMeters(m.pos, width, depth) : null;
      const hold: DraftKey = { ...cur, t: T0, ease: "smooth" };
      delete hold.faceTok;
      if (dest && Math.hypot(dest[0] - cur.x, dest[1] - cur.z) > 0.15) {
        const travel = yawToward(cur.x, cur.z, dest[0], dest[1], cur.yaw);
        const turnAt = round(T0 + Math.min(0.25, 0.2 * (T1 - T0)), 3);
        keys.push(hold);
        keys.push({ t: turnAt, x: cur.x, z: cur.z, yaw: travel, pose: "stand", ease: "linear" });
        const arrive: DraftKey = { t: T1, x: dest[0], z: dest[1], yaw: travel, pose: "stand", ease: "smooth" };
        keys.push(arrive);
        cur = { ...arrive };
        if (finalYaw != null || finalTok || m.pose) {
          const settle: DraftKey = { t: round(Math.min(duration, T1 + Math.min(0.35, Math.max(KEY_EPS, duration - T1))), 3), x: dest[0], z: dest[1], yaw: finalYaw ?? travel, pose: m.pose ?? "stand", ease: "smooth" };
          if (finalTok) settle.faceTok = finalTok;
          if (settle.t - T1 < KEY_EPS) { Object.assign(arrive, { yaw: settle.yaw, pose: settle.pose, faceTok: settle.faceTok }); cur = { ...arrive }; }
          else { keys.push(settle); cur = { ...settle }; }
        }
      } else {
        keys.push(hold);
        const turned: DraftKey = { t: T1, x: cur.x, z: cur.z, yaw: finalYaw ?? cur.yaw, pose: m.pose ?? cur.pose, ease: "smooth" };
        if (finalTok) turned.faceTok = finalTok;
        keys.push(turned);
        cur = { ...turned };
      }
      delete cur.faceTok;
    }
    return { token: a.token, height, keys };
  });

  // 도착 지점이 다른 인물과 겹치면 비킨다(그 뒤 같은 자리 키도 함께).
  for (const dft of drafts) {
    for (let i = 1; i < dft.keys.length; i++) {
      const k = dft.keys[i];
      const p = dft.keys[i - 1];
      if (Math.abs(k.x - p.x) < 1e-6 && Math.abs(k.z - p.z) < 1e-6) continue;
      const others = drafts.filter((o) => o !== dft).map((o) => ({ ...sampleActor(o.keys, k.t), r: radiusOf(o.height) }));
      const mine = pushAway({ x: k.x, z: k.z, r: radiusOf(dft.height) }, others, width, depth);
      const ox = k.x;
      const oz = k.z;
      for (let j = i; j < dft.keys.length; j++) {
        if (Math.abs(dft.keys[j].x - ox) < 1e-6 && Math.abs(dft.keys[j].z - oz) < 1e-6) { dft.keys[j].x = mine.x; dft.keys[j].z = mine.z; }
      }
    }
  }

  // 인물을 향한 방향은 모든 위치가 정해진 뒤에 푼다.
  for (const dft of drafts) {
    for (const k of dft.keys) {
      if (!k.faceTok) continue;
      const other = drafts.find((o) => o.token === k.faceTok);
      if (other) {
        const o = sampleActor(other.keys, k.t);
        k.yaw = yawToward(k.x, k.z, o.x, o.z, k.yaw);
      }
      delete k.faceTok;
    }
  }
  return drafts.map((d) => ({ token: d.token, height: d.height, keys: d.keys.map((k) => ({ ...k, x: round(k.x), z: round(k.z), yaw: round(wrapDeg(k.yaw), 2) })) }));
}

// ── 카메라 ───────────────────────────────────────────────────────────────────
const AIM_RATIO: Record<string, number> = { ECU: EYE_RATIO, CU: 0.9, MCU: 0.85, MS: 0.75, MLS: 0.62, WS: 0.52, EWS: 0.5 };
const PITCH: Record<CameraElevation, number> = { eye: 0, high: -35, top: -85, low: 12, worm: 22 };

export function lensFor(size: string, framing: Framing): number {
  if (framing === "insert") return 85;
  if (framing === "ots") return 50;
  if (framing === "pov") return 35;
  return ({ ECU: 85, CU: 50, MCU: 50, MS: 35, MLS: 35, WS: 24, EWS: 18 } as Record<string, number>)[size] ?? 35;
}

const viewYaw = (v: CameraDirection) => (v === "back" ? 180 : v === "right" ? 90 : v === "left" ? -90 : 0);
const fwdOf = (a: number): [number, number] => [Math.sin(a * DEG), -Math.cos(a * DEG)];

/** 두 인물 선(a→b) 기준으로 점 p 가 어느 쪽인가. +1 / -1 / 0. */
export function sideOfLine(a: { x: number; z: number }, b: { x: number; z: number }, p: { x: number; z: number }): number {
  const c = (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
  return Math.abs(c) < 1e-3 ? 0 : Math.sign(c);
}

interface Subject { x: number; z: number; h: number }

function subjectsAt(tokens: string[], actors: PrevizActor[], t: number): Subject[] {
  return tokens
    .map((tok) => actors.find((a) => a.token === tok))
    .filter((a): a is PrevizActor => !!a)
    .map((a) => {
      const s = sampleActor(a.keys, t);
      return { x: s.x, z: s.z, h: effectiveHeight(a.height, s.pose) };
    });
}

interface Placement { pos: Vec3; target: Vec3; focal: number; right: [number, number]; hd: number }

/**
 * 한 시각의 카메라 배치.
 * yawOffset: 방위(view)에서 좌우로 튼 각도(180도 규칙 보정용, ±30° 이내라 방위 판정은 그대로).
 * distScale: 푸시인·풀아웃이 거리를 바꿀 때.
 */
function place(cam: PlanCamera, subs: Subject[], fallbackPoint: [number, number], aspect: number, yawOffset: number, distScale: number, baseFocal: number, setWidth: number): Placement {
  const focal = baseFocal;
  const vf = verticalFovDeg(focal, aspect) * DEG;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const size = cam.framing === "insert" && !["ECU", "CU", "MCU"].includes(cam.size) ? "CU" : cam.size;
  const ratio = SHOT_RATIO[size] ?? SHOT_RATIO.MS;
  const list = subs.length ? subs : [{ x: fallbackPoint[0], z: fallbackPoint[1], h: 1.6 }];
  const cx = list.reduce((s, p) => s + p.x, 0) / list.length;
  const cz = list.reduce((s, p) => s + p.z, 0) / list.length;
  const H = Math.max(...list.map((p) => p.h));
  const yaw = viewYaw(cam.view) + yawOffset;
  const [fx, fz] = fwdOf(yaw);
  const right: [number, number] = [-fz, fx];
  const p = PITCH[cam.angle] * DEG;
  // 인물들이 벌어진 폭: 화면 가로축(카메라 오른쪽)과 앞뒤축으로 나눠 잰다. 앞뒤 폭은 내려다볼수록(부감) 화면 세로를 차지한다.
  let spanRight = 0;
  let spanFwd = 0;
  for (const a of list) for (const b of list) {
    spanRight = Math.max(spanRight, Math.abs((a.x - b.x) * right[0] + (a.z - b.z) * right[1]));
    spanFwd = Math.max(spanFwd, Math.abs((a.x - b.x) * fx + (a.z - b.z) * fz));
  }
  const dV = (ratio * H) / (2 * Math.tan(vf / 2));
  const dH = list.length > 1 ? (spanRight + 0.9) / (2 * Math.tan(hf / 2)) : subs.length ? 0 : (setWidth * 0.7) / (2 * Math.tan(hf / 2));
  const dF = list.length > 1 ? (Math.abs(Math.sin(p)) * (spanFwd + 0.9)) / (2 * Math.tan(vf / 2)) : 0;
  // 최소 거리 0.15m — 광각 익스트림 클로즈업은 실제로 그만큼 붙는다.
  const d = Math.max(0.15, dV, dH, dF) * distScale;
  const aimRatio = cam.framing === "insert" ? 0.55 : AIM_RATIO[size] ?? 0.75;
  let aimY = H * aimRatio;
  let hd = Math.cos(p) * d;
  let camY = aimY - Math.sin(p) * d;
  // 로우: 카메라가 바닥에 붙지 않게(0.45m 이상). 1.1m 이하면 조금만 올려다봐도 로우로 읽히므로 주인공이 화면에 남을 만큼만 든다.
  if (cam.angle === "low") {
    // 작은 인물(누운 사람·작은 동물)은 카메라도 그 몸 아래쪽까지 내린다 — 0.45m 에 두면 인물을 내려다보게 된다.
    const floor = H >= 1 ? 0.45 : clamp(0.3 * H, 0.12, 0.45);
    camY = Math.max(floor, camY);
    // 0.35m 이하에서 5° 이상 올려다보면 웜즈아이로 읽히므로 3.5° 로 둔다(인물은 카메라보다 커서 화면 안).
    if (camY <= 0.35) aimY = camY + Math.tan(3.5 * DEG) * hd;
    else if (camY <= 1.1) aimY = Math.max(aimY, camY + Math.tan(3 * DEG) * hd);
    else aimY = Math.max(aimY, camY + Math.tan(9 * DEG) * hd);
  }
  // 웜즈아이: 바닥 높이에서 올려다본다. 먼 거리에서 조준을 너무 들면 주인공이 아래로 빠지므로 6° 까지만 강제.
  if (cam.angle === "worm") { camY = clamp(0.35 * H, 0.03, 0.18); hd = d; aimY = Math.max(aimY, camY + Math.tan(6 * DEG) * hd); }
  // 아이레벨: 조준 높이 = 카메라 높이(수평). 아주 낮은 인물도 수평을 지키려고 조준을 카메라 최저 높이에 맞춘다.
  if (cam.angle === "eye") { camY = Math.max(0.04, aimY); aimY = camY; }
  camY = Math.max(cam.angle === "worm" || cam.angle === "eye" ? 0.03 : 0.12, camY);
  if (cam.angle === "top") hd = Math.max(0.05, hd);
  // 화면 3분할: 주인공을 왼쪽 3분의 1에 두려면 조준점을 카메라 오른쪽으로. 각도는 가로 화각에 비례(세로 화면·망원에서도 화면 안).
  const shift = cam.screen === "left" ? 1 : cam.screen === "right" ? -1 : 0;
  const s = shift * hd * (Math.tan(hf / 2) / 3);
  const target: Vec3 = [cx + right[0] * s, aimY, cz + right[1] * s];
  const pos: Vec3 = [cx - fx * hd, camY, cz - fz * hd];
  return { pos, target, focal, right, hd };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function jitter(seed: number, i: number): number {
  const x = Math.sin(seed * 0.0001 + i * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

const r3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];

function solveCamera(plan: CutPlan, actors: PrevizActor[], duration: number, aspect: number, set: { width: number; depth: number }, carry: StageCarry): { keys: CameraKey[]; axis: Axis | null } {
  const cam = plan.camera;
  const baseFocal = cam.lens ?? lensFor(cam.size, cam.framing);
  const subjectTokens = cam.subjects.length ? cam.subjects : cam.point ? [] : actors.map((a) => a.token);
  const point: [number, number] = cam.point ? toMeters(cam.point, set.width, set.depth) : [0, 0];
  const actorAt = (tok: string, t: number) => {
    const a = actors.find((x) => x.token === tok);
    if (!a) return null;
    const s = sampleActor(a.keys, t);
    return { x: s.x, z: s.z, h: effectiveHeight(a.height, s.pose), yaw: s.yaw };
  };

  // 180도 선: 이 씬에서 이미 정해졌고 두 인물이 모두 이 컷에 있으면 지킨다.
  let axis = carry.axis && actorAt(carry.axis.a, 0) && actorAt(carry.axis.b, 0) ? carry.axis : null;
  const axisSign = (pos: Vec3) => {
    if (!axis) return 0;
    const a = actorAt(axis.a, 0)!;
    const b = actorAt(axis.b, 0)!;
    return sideOfLine(a, b, { x: pos[0], z: pos[2] });
  };

  // 오버숄더·POV 는 인물 기준으로 따로 세운다.
  const special = (t: number): Placement | null => {
    const subj = actorAt(cam.subjects[0] || "", t);
    if (cam.framing === "pov" && subj) {
      const eyeY = subj.h * EYE_RATIO;
      const [fx, fz] = [Math.sin(subj.yaw * DEG), Math.cos(subj.yaw * DEG)];
      const pos: Vec3 = [subj.x + fx * 0.12, eyeY, subj.z + fz * 0.12];
      const look = cam.look ? actorAt(cam.look, t) : null;
      const target: Vec3 = look ? [look.x, look.h * 0.85, look.z] : cam.point ? [point[0], eyeY, point[1]] : [subj.x + fx * 3, eyeY, subj.z + fz * 3];
      const hz: [number, number] = [target[0] - pos[0], target[2] - pos[2]];
      const len = Math.hypot(hz[0], hz[1]) || 1;
      return { pos, target, focal: baseFocal, right: [-hz[1] / len, hz[0] / len], hd: len };
    }
    const overTok = cam.over || (cam.framing === "ots" ? actors.find((a) => a.token !== cam.subjects[0])?.token || "" : "");
    const over = cam.framing === "ots" ? actorAt(overTok, t) : null;
    if (cam.framing === "ots" && subj && over) {
      let vx = subj.x - over.x;
      let vz = subj.z - over.z;
      const len = Math.hypot(vx, vz) || 1;
      vx /= len; vz /= len;
      const scale = over.h / DEFAULT_ACTOR_HEIGHT;
      const back = 0.75 * Math.max(0.5, scale);
      const shoulder = 0.38 * Math.max(0.5, scale);
      const rightV: [number, number] = [-vz, vx];
      const build = (sign: number): Placement => {
        const pos: Vec3 = [over.x - vx * back + rightV[0] * shoulder * sign, Math.max(0.3, over.h * 0.95), over.z - vz * back + rightV[1] * shoulder * sign];
        const target: Vec3 = [subj.x, subj.h * 0.85, subj.z];
        return { pos, target, focal: baseFocal, right: rightV, hd: Math.hypot(target[0] - pos[0], target[2] - pos[2]) };
      };
      // 어깨 쪽: 180도 선을 지키는 쪽 → 없으면 화면 배치(주인공이 오른쪽이면 카메라는 왼쪽 어깨)
      let sign = cam.screen === "right" ? -1 : 1;
      if (axis) {
        const wanted = axis.sign;
        const pick = [sign, -sign].find((sg) => axisSign(build(sg).pos) === wanted);
        if (pick != null) sign = pick;
      }
      return build(sign);
    }
    return null;
  };

  // 기본 배치의 좌우 틀기 각도(180도 규칙)
  let yawOffset = 0;
  if (!special(0) && axis) {
    const base = place(cam, subjectsAt(subjectTokens, actors, 0), point, aspect, 0, 1, baseFocal, set.width);
    if (axisSign(base.pos) !== 0 && axisSign(base.pos) !== axis.sign) {
      for (const off of [30, -30]) {
        const alt = place(cam, subjectsAt(subjectTokens, actors, 0), point, aspect, off, 1, baseFocal, set.width);
        if (axisSign(alt.pos) === axis.sign) { yawOffset = off; break; }
      }
    }
  }

  const at = (t: number, distScale = 1): Placement => special(t) ?? place(cam, subjectsAt(subjectTokens, actors, t), point, aspect, yawOffset, distScale, baseFocal, set.width);
  const base = at(0);
  const key = (t: number, p: { pos: Vec3; target: Vec3; focal: number }, ease: "smooth" | "linear" = "smooth"): CameraKey => ({ t: round(t), pos: r3(p.pos), target: r3(p.target), focal: round(p.focal, 1), ease });

  const T0 = round(clamp(cam.t0, 0, 1) * duration);
  const T1 = round(Math.min(duration, Math.max(T0 + 0.3, clamp(cam.t1, 0, 1) * duration)));
  const keys: CameraKey[] = [];
  const H = Math.max(0.3, ...subjectsAt(subjectTokens, actors, 0).map((s) => s.h), 0.3);

  if (cam.move === "static") {
    keys.push(key(0, base));
  } else if (cam.move === "handheld") {
    const seed = hashSeed(plan.sceneId);
    const n = Math.max(4, Math.round(duration / 0.4));
    for (let i = 0; i <= n; i++) {
      const t = (duration * i) / n;
      const p = at(t);
      const j = i === 0 ? 0 : 1;
      // 흔들림은 조준 거리에 비례한 각도(약 1°)로 — 클로즈업에서 팬처럼 휘두르지 않게
      const ta = Math.max(0.004, p.hd * 0.017);
      keys.push(key(t, {
        pos: [p.pos[0] + jitter(seed, i * 3) * 0.025 * j, p.pos[1] + jitter(seed, i * 3 + 1) * 0.02 * j, p.pos[2] + jitter(seed, i * 3 + 2) * 0.025 * j],
        target: [p.target[0] + jitter(seed, i * 5) * ta * j, p.target[1] + jitter(seed, i * 5 + 1) * ta * 0.7 * j, p.target[2] + jitter(seed, i * 5 + 2) * ta * j],
        focal: p.focal,
      }, "linear"));
    }
  } else {
    // 이동 구간 안의 인물 키 시각에도 키를 둬서 움직이는 주인공을 따라간다.
    const times = new Set<number>([0, T0, T1]);
    for (const a of actors) for (const k of a.keys) if (k.t > T0 + KEY_EPS && k.t < T1 - KEY_EPS && (subjectTokens.includes(a.token) || a.token === cam.look)) times.add(round(k.t));
    const list = [...times].filter((t) => t <= duration + 1e-9).sort((p, q) => p - q).filter((t, i, arr) => i === 0 || t - arr[i - 1] >= KEY_EPS);
    const subjectMoves = actors.some((a) => subjectTokens.includes(a.token) && a.keys.some((k, i) => i > 0 && Math.hypot(k.x - a.keys[0].x, k.z - a.keys[0].z) > 0.15));
    const multi = list.filter((t) => t > T0 && t < T1).length > 0;
    for (const t of list) {
      const u = easeT(T1 > T0 ? (t - T0) / (T1 - T0) : 1, "smooth");
      let p: Placement;
      switch (cam.move) {
        case "push_in": p = at(t, lerp(1, Math.max(0.3, Math.min(0.62, 1 - 0.3 / Math.max(0.35, base.hd))), u)); break;
        case "pull_out": p = at(t, lerp(1, 1.55, u)); break;
        case "zoom": { const q = at(t); p = { ...q, focal: baseFocal * lerp(1, 1.7, u) }; break; }
        case "crane": { const q = at(t); p = { ...q, pos: [q.pos[0], q.pos[1] + lerp(0, Math.max(1.2, 0.9 * H), u), q.pos[2]] }; break; }
        case "tilt": {
          // 위로 18° 기울인다(어떤 높이·거리에서도 같은 각도 변화). 조준 거리는 그대로.
          const q = at(t);
          const dx = q.target[0] - base.pos[0];
          const dy = q.target[1] - base.pos[1];
          const dz = q.target[2] - base.pos[2];
          const dist = Math.hypot(dx, dy, dz) || 1;
          const horiz = Math.hypot(dx, dz) || 1e-6;
          const pitch = Math.min(80 * DEG, Math.atan2(dy, horiz) + 18 * DEG * u);
          const k = Math.cos(pitch) * dist / horiz;
          p = { ...q, pos: base.pos, target: [base.pos[0] + dx * k, base.pos[1] + Math.sin(pitch) * dist, base.pos[2] + dz * k] };
          break;
        }
        case "pan": {
          const q = at(t);
          const look = cam.look ? actorAt(cam.look, t) : null;
          let target: Vec3 = q.target;
          if (look) target = [lerp(q.target[0], look.x, u), lerp(q.target[1], look.h * 0.8, u), lerp(q.target[2], look.z, u)];
          else if (!subjectMoves) { const s = base.hd * Math.tan(25 * DEG) * u; target = [base.target[0] + base.right[0] * s, base.target[1], base.target[2] + base.right[1] * s]; }
          p = { ...q, pos: base.pos, target };
          break;
        }
        case "track": {
          const q = at(t);
          if (subjectMoves) { p = q; break; }
          const s = 1.2 * u;
          p = { ...q, pos: [base.pos[0] + base.right[0] * s, base.pos[1], base.pos[2] + base.right[1] * s], target: [base.target[0] + base.right[0] * s, base.target[1], base.target[2] + base.right[1] * s] };
          break;
        }
        default: p = at(t);
      }
      keys.push(key(t, p, multi ? "linear" : "smooth"));
    }
  }

  // 이 씬의 180도 선이 아직 없고 두 인물이 함께 잡히면 여기서 정한다.
  if (!axis && cam.framing !== "pov") {
    const pairTokens = [...cam.subjects, ...(cam.over ? [cam.over] : []), ...actors.map((a) => a.token)].filter((t, i, arr) => arr.indexOf(t) === i);
    if (pairTokens.length >= 2 && (cam.framing === "two" || cam.framing === "ots" || cam.framing === "group" || cam.subjects.length >= 2)) {
      const [a, b] = [pairTokens[0], pairTokens[1]].sort();
      const pa = actorAt(a, 0)!;
      const pb = actorAt(b, 0)!;
      const sign = sideOfLine(pa, pb, { x: keys[0].pos[0], z: keys[0].pos[2] });
      if (sign !== 0) axis = { a, b, sign };
    }
  }
  return { keys, axis };
}

// ── 한 묶음의 컷을 무대에 올린다 ─────────────────────────────────────────────
/** 문서의 인물 키 중 사용자가(또는 앞선 자동 연출이) 정한 키. 기본값 1.7 은 "모름"으로 본다. */
export function knownHeights(doc: PrevizDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cut of Object.values(doc.cuts)) for (const a of cut.actors) if (Math.abs(a.height - DEFAULT_ACTOR_HEIGHT) > 1e-6 && !out[a.token]) out[a.token] = a.height;
  return out;
}

/** 같은 세트에서 order 앞의 가장 가까운 편집된 컷이 끝난 상태. */
export function carryFromDoc(doc: PrevizDoc, cuts: CutSource[], before: CutSource): StageCarry {
  const key = setKeyOf(before.sceneLocation);
  const prev = cuts
    .filter((c) => c.order < before.order && setKeyOf(c.sceneLocation) === key && doc.cuts[c.sceneId])
    .sort((a, b) => b.order - a.order)[0];
  const actors: Record<string, ActorState> = {};
  if (prev) {
    const pc = doc.cuts[prev.sceneId];
    for (const a of pc.actors) actors[a.token] = sampleActor(a.keys, pc.duration);
  }
  return { setKey: key, actors, axis: null, views: [] };
}

/** 서버에 넘길 직전 상태(정규화 좌표·벽 방향). */
export function priorForRequest(carry: StageCarry, width: number, depth: number, heights: Record<string, number>) {
  return {
    actors: Object.entries(carry.actors).map(([token, s]) => ({ token, pos: toNormalized(s.x, s.z, width, depth), face: dirOfYaw(s.yaw), pose: s.pose })),
    views: carry.views,
    heights,
  };
}

export function stageCuts(input: {
  plan: StagePlan;
  cuts: CutSource[];
  doc: PrevizDoc;
  aspect: number;
  carry: StageCarry;
  heights: Record<string, number>;
}): { doc: PrevizDoc; carry: StageCarry; heights: Record<string, number> } {
  let doc = input.doc;
  let carry: StageCarry = { ...input.carry, actors: { ...input.carry.actors }, views: [...input.carry.views] };
  const heights = { ...input.plan.heights, ...input.heights };

  for (const cut of [...input.cuts].sort((a, b) => a.order - b.order)) {
    const plan = input.plan.cuts.find((c) => c.sceneId === cut.sceneId) ?? fallbackCutPlan(cut);
    const key = setKeyOf(cut.sceneLocation);
    if (carry.setKey !== key) carry = { setKey: key, actors: {}, axis: null, views: [] };
    let set = doc.sets[key] || ensureSet(doc, cut.sceneLocation);
    if (!doc.sets[key] && input.plan.set) set = { ...set, width: input.plan.set.width, depth: input.plan.set.depth };
    // 키 시각을 소수 셋째 자리로 반올림하므로 길이도 같은 자리로 맞춘다(마지막 키가 길이를 넘지 않게).
    const duration = round(clamp(cut.estSec > 0 ? cut.estSec : doc.cuts[cut.sceneId]?.duration ?? 3, 1, 30));

    const actors = solveActors(plan, set.width, set.depth, duration, carry, heights);
    const { keys, axis } = solveCamera(plan, actors, duration, input.aspect, set, carry);
    const staged: PrevizCut = { sceneId: cut.sceneId, setKey: key, duration, actors, camera: keys, moveIntent: plan.camera.move };
    doc = { ...doc, sets: { ...doc.sets, [key]: set }, cuts: { ...doc.cuts, [cut.sceneId]: staged } };

    for (const a of actors) carry.actors[a.token] = sampleActor(a.keys, duration);
    carry.axis = axis;
    carry.views.push(`${plan.camera.size} ${plan.camera.framing} · view ${plan.camera.view} · ${plan.camera.angle} · ${plan.camera.move}`);
  }
  return { doc, carry, heights };
}
