/**
 * previz/geometry.ts — 프리비즈 3D 무대의 순수 기하(외부 import 없음, 노드 테스트가 직접 불러온다).
 *
 * 좌표계(미터, Y 위): 세트 바닥 중심이 원점. 정면(front) 카메라는 +Z 쪽에서 -Z 를 본다.
 *   - 정면 카메라 기준 왼쪽 = -X, 오른쪽 = +X, 근경(near) = +Z, 원경(far) = -Z
 *   - 인물 yaw(도): 0 = +Z(정면 카메라 쪽), 90 = +X(오른쪽), 180 = -Z(뒤), -90 = -X(왼쪽)
 * 이 규약은 prototype/js/service/stage-geometry.js 의 블로킹 좌표(정면 기준)와 같다.
 * 그래서 프리비즈에서 놓은 배치가 blocking·cameraDirection·cameraElevation·shotType·cameraMove 로
 * 그대로 내려가, 기존 이미지·영상 프롬프트와 세트 플레이트 선택이 소비한다.
 */

export type Vec3 = [number, number, number];
export type Ease = "linear" | "smooth";
export type BlockX = "left" | "center" | "right";
export type BlockDepth = "near" | "mid" | "far";
export type BlockFacing = "camera" | "away" | "left" | "right";
export type CameraDirection = "front" | "back" | "left" | "right";
export type CameraElevation = "eye" | "high" | "low" | "top" | "worm";
export type ShotSize = "ECU" | "CU" | "MCU" | "MS" | "MLS" | "WS" | "EWS";
export type CameraMove = "static" | "pan" | "tilt" | "track" | "crane" | "zoom" | "push_in" | "pull_out";

export interface CameraKey { t: number; pos: Vec3; target: Vec3; focal: number; ease?: Ease }
export interface ActorKey { t: number; x: number; z: number; yaw: number; ease?: Ease }
export interface BlockingEntry { token: string; x: BlockX; depth: BlockDepth; facing: BlockFacing }

/** 풀프레임 긴 변(36mm)을 화면의 긴 변에 맞춘다 — 가로·세로 영상 모두 같은 렌즈 감각. */
export const SENSOR_LONG_MM = 36;
export const LENSES_MM = [18, 24, 35, 50, 85, 135];
export const DEFAULT_ACTOR_HEIGHT = 1.7;
export const EYE_RATIO = 0.93;
/** 같은 시각으로 보는 허용 오차(24fps 한 프레임). */
export const KEY_EPS = 1 / 24;

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** "16:9" · "9:16" · "2.39:1" → 가로/세로 비. 모르면 16:9. */
export function parseAspect(raw: unknown): number {
  const m = String(raw || "").match(/(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)/);
  if (!m) return 16 / 9;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** 렌즈(mm)와 화면비로 세로 화각(도). three.js PerspectiveCamera.fov 에 그대로 넣는다. */
export function verticalFovDeg(focalMm: number, aspect: number): number {
  const f = clamp(num(focalMm, 35), 8, 400);
  const sensorV = aspect >= 1 ? SENSOR_LONG_MM / aspect : SENSOR_LONG_MM;
  return (2 * Math.atan(sensorV / 2 / f)) / DEG;
}

/** 각도를 (-180, 180] 로. */
export function wrapDeg(a: number): number {
  let x = ((num(a, 0) + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

/** 짧은 쪽으로 도는 각도 보간(350°→10° 가 한 바퀴 돌지 않게). */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  const d = wrapDeg(b - a);
  return wrapDeg(a + d * t);
}

export function easeT(t: number, ease: Ease | undefined): number {
  const x = clamp(t, 0, 1);
  return ease === "linear" ? x : x * x * (3 - 2 * x);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 시각 t 를 감싸는 두 키와 구간 진행률. 같은 시각 키가 둘이어도 0 으로 나누지 않는다. */
function segment<K extends { t: number; ease?: Ease }>(keys: K[], t: number): { a: K; b: K; u: number } | null {
  if (!keys.length) return null;
  const sorted = [...keys].sort((p, q) => p.t - q.t);
  if (sorted.length === 1 || t <= sorted[0].t) return { a: sorted[0], b: sorted[0], u: 0 };
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return { a: last, b: last, u: 0 };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      return { a, b, u: span > 1e-6 ? easeT((t - a.t) / span, a.ease) : 1 };
    }
  }
  return { a: last, b: last, u: 0 };
}

export function sampleCamera(keys: CameraKey[], t: number): { pos: Vec3; target: Vec3; focal: number } {
  const s = segment(keys, t);
  if (!s) return { pos: [0, 1.6, 6], target: [0, 1.2, 0], focal: 35 };
  return { pos: lerpV(s.a.pos, s.b.pos, s.u), target: lerpV(s.a.target, s.b.target, s.u), focal: lerp(s.a.focal, s.b.focal, s.u) };
}

export function sampleActor(keys: ActorKey[], t: number): { x: number; z: number; yaw: number } {
  const s = segment(keys, t);
  if (!s) return { x: 0, z: 0, yaw: 0 };
  return { x: lerp(s.a.x, s.b.x, s.u), z: lerp(s.a.z, s.b.z, s.u), yaw: lerpAngleDeg(s.a.yaw, s.b.yaw, s.u) };
}

// ── 블로킹 격자(정면 기준 3×3) ───────────────────────────────────────────────
export function quantizeX(x: number, width: number): BlockX {
  const third = Math.max(0.1, width) / 6;
  return x < -third ? "left" : x > third ? "right" : "center";
}
export function quantizeDepth(z: number, depth: number): BlockDepth {
  const third = Math.max(0.1, depth) / 6;
  return z > third ? "near" : z < -third ? "far" : "mid";
}
export function facingOfYaw(yaw: number): BlockFacing {
  const a = wrapDeg(yaw);
  if (Math.abs(a) <= 45) return "camera";
  if (Math.abs(a) >= 135) return "away";
  return a > 0 ? "right" : "left";
}
export function yawOfFacing(f: string): number {
  return f === "away" ? 180 : f === "right" ? 90 : f === "left" ? -90 : 0;
}
/** 격자 칸의 중심 좌표(x, z). */
export function cellPosition(x: string, depth: string, width: number, depthM: number): [number, number] {
  const px = x === "left" ? -width / 3 : x === "right" ? width / 3 : 0;
  const pz = depth === "near" ? depthM / 3 : depth === "far" ? -depthM / 3 : 0;
  return [px, pz];
}

// ── 카메라 → 컷 필드 ───────────────────────────────────────────────────────
function forward(pos: Vec3, target: Vec3): Vec3 {
  const d: Vec3 = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / len, d[1] / len, d[2] / len];
}

/** 카메라가 바라보는 수평 방향 → 세트 방위. -Z=front, +Z=back, +X=right, -X=left. */
export function cameraDirectionOf(pos: Vec3, target: Vec3): CameraDirection {
  const f = forward(pos, target);
  const yaw = Math.atan2(f[0], -f[2]) / DEG; // 0 = -Z
  const a = wrapDeg(yaw);
  if (Math.abs(a) <= 45) return "front";
  if (Math.abs(a) >= 135) return "back";
  return a > 0 ? "right" : "left";
}

export function cameraPitchDeg(pos: Vec3, target: Vec3): number {
  const f = forward(pos, target);
  return Math.asin(clamp(f[1], -1, 1)) / DEG;
}

/** 카메라 높이(m)와 기울기 → 세트 플레이트 높이 축(eye/high/low/top/worm). */
export function cameraElevationOf(pos: Vec3, target: Vec3): CameraElevation {
  const pitch = cameraPitchDeg(pos, target);
  const h = pos[1];
  if (pitch <= -60) return "top";
  if (pitch <= -12) return "high";
  if (h <= 0.35 && pitch >= 5) return "worm";
  if (pitch >= 8 || (h <= 1.1 && pitch >= 2)) return "low";
  return "eye";
}

/** 세로 화면에 담기는 높이 ÷ 인물 키 → 샷 사이즈. 경계값은 SHOT_RATIO 의 중간. */
const SHOT_BOUNDS: Array<[ShotSize, number]> = [["ECU", 0.2], ["CU", 0.4], ["MCU", 0.6], ["MS", 0.9], ["MLS", 1.3], ["WS", 3.2]];
export const SHOT_RATIO: Record<string, number> = { ECU: 0.15, CU: 0.3, MCU: 0.5, MS: 0.75, MLS: 1.1, WS: 2.0, EWS: 5.0, OTS: 0.75, POV: 0.5, INSERT: 0.3, TWO_SHOT: 1.1, GROUP: 2.0 };

export function shotSizeOf(distance: number, focalMm: number, aspect: number, subjectHeight: number): ShotSize {
  const vfov = verticalFovDeg(focalMm, aspect) * DEG;
  const coverage = 2 * Math.max(0.05, distance) * Math.tan(vfov / 2);
  const r = coverage / Math.max(0.2, subjectHeight);
  for (const [size, bound] of SHOT_BOUNDS) if (r < bound) return size;
  return "EWS";
}

export interface FrameSubject { token: string; x: number; z: number; height: number }

/** 카메라에 보이는 인물 중 가장 가까운 인물(샷 사이즈의 기준). 아무도 없으면 null. */
export function primarySubject(cam: { pos: Vec3; target: Vec3; focal: number }, aspect: number, subjects: FrameSubject[]): { subject: FrameSubject; distance: number } | null {
  const f = forward(cam.pos, cam.target);
  const vHalf = (verticalFovDeg(cam.focal, aspect) * DEG) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  // 카메라 기준 오른쪽·위 벡터
  const right: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(right[0], right[2]) || 1;
  right[0] /= rl; right[2] /= rl;
  const up: Vec3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  let best: { subject: FrameSubject; distance: number } | null = null;
  // 카메라 공간 좌표(깊이·화면 x·화면 y)
  const project = (x: number, y: number, z: number) => {
    const p: Vec3 = [x - cam.pos[0], y - cam.pos[1], z - cam.pos[2]];
    return {
      depth: p[0] * f[0] + p[1] * f[1] + p[2] * f[2],
      sx: p[0] * right[0] + p[1] * right[1] + p[2] * right[2],
      sy: p[0] * up[0] + p[1] * up[1] + p[2] * up[2],
    };
  };
  for (const s of subjects) {
    const mid = project(s.x, s.height * 0.5, s.z);
    if (mid.depth <= 0.1) continue;
    if (Math.abs(Math.atan2(mid.sx, mid.depth)) > hHalf * 1.05) continue;
    // 발끝~머리끝 세로 구간이 화면과 겹치면 보이는 것(클로즈업은 얼굴만 걸린다)
    const foot = project(s.x, 0, s.z);
    const head = project(s.x, s.height, s.z);
    const a1 = foot.depth > 0.05 ? Math.atan2(foot.sy, foot.depth) : -Math.PI / 2;
    const a2 = head.depth > 0.05 ? Math.atan2(head.sy, head.depth) : Math.PI / 2;
    const lo = Math.min(a1, a2);
    const hi = Math.max(a1, a2);
    if (hi < -vHalf * 1.05 || lo > vHalf * 1.05) continue;
    if (!best || mid.depth < best.distance) best = { subject: s, distance: mid.depth };
  }
  return best;
}

/** 카메라 키프레임 → 무브 어휘(shot-vocab.js CAMERA_MOVES 의 키). */
export function cameraMoveOf(keys: CameraKey[]): CameraMove {
  if (keys.length < 2) return "static";
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  const d: Vec3 = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const moved = Math.hypot(d[0], d[1], d[2]);
  const fa = forward(a.pos, a.target);
  const fb = forward(b.pos, b.target);
  const yawChange = Math.abs(wrapDeg(Math.atan2(fb[0], -fb[2]) / DEG - Math.atan2(fa[0], -fa[2]) / DEG));
  const pitchChange = Math.abs(Math.asin(clamp(fb[1], -1, 1)) / DEG - Math.asin(clamp(fa[1], -1, 1)) / DEG);
  const focalChange = Math.abs(b.focal - a.focal);
  if (moved < 0.15) {
    if (focalChange >= 5) return "zoom";
    if (yawChange >= 5 && yawChange >= pitchChange) return "pan";
    if (pitchChange >= 5) return "tilt";
    return "static";
  }
  const right: Vec3 = [-fa[2], 0, fa[0]];
  const rl = Math.hypot(right[0], right[2]) || 1;
  const along = d[0] * fa[0] + d[1] * fa[1] + d[2] * fa[2];
  const side = (d[0] * right[0] + d[2] * right[2]) / rl;
  const vertical = d[1];
  const m = Math.max(Math.abs(along), Math.abs(side), Math.abs(vertical));
  if (m === Math.abs(vertical)) return "crane";
  if (m === Math.abs(side)) return "track";
  return along > 0 ? "push_in" : "pull_out";
}

// ── 컷 필드 → 카메라(처음 열 때의 초기 배치) ─────────────────────────────────
const DIR_FORWARD: Record<string, [number, number]> = { front: [0, -1], back: [0, 1], right: [1, 0], left: [-1, 0] };

/** 기존 컷 필드(방위·높이·샷)로 카메라 한 대를 세운다. cameraElevationOf/cameraDirectionOf 로 되읽으면 같은 값이 나온다. */
export function cameraFromCutFields(direction: string, elevation: string, shotType: string, subject: FrameSubject, aspect: number): CameraKey {
  const dir = DIR_FORWARD[direction] ? direction : "front";
  const [fx, fz] = DIR_FORWARD[dir];
  const key = String(shotType || "MS").toUpperCase();
  const ratio = SHOT_RATIO[key] ?? SHOT_RATIO.MS;
  const focal = ratio >= 2 ? 24 : ratio <= 0.3 ? 50 : 35;
  const vfov = verticalFovDeg(focal, aspect) * DEG;
  const H = Math.max(0.2, subject.height);
  const d = (ratio * H) / (2 * Math.tan(vfov / 2));
  const place = (camY: number, aimY: number, pitchDeg: number | null): CameraKey => {
    const target: Vec3 = [subject.x, aimY, subject.z];
    if (pitchDeg == null) {
      // 카메라 높이를 고정하고 수평 거리 d 에서 조준점을 본다(로우·웜).
      return { t: 0, pos: [subject.x - fx * d, camY, subject.z - fz * d], target, focal };
    }
    const p = pitchDeg * DEG;
    const pos: Vec3 = [target[0] - fx * Math.cos(p) * d, target[1] - Math.sin(p) * d, target[2] - fz * Math.cos(p) * d];
    pos[1] = Math.max(0.15, pos[1]);
    return { t: 0, pos, target, focal };
  };
  switch (elevation) {
    case "high": return place(0, H * 0.75, -35);
    case "top": return place(0, 0, -85);
    case "low": return place(0.6, H * 0.8, null);
    case "worm": return place(0.15, H, null);
    default: return place(0, H * EYE_RATIO, 0);
  }
}
