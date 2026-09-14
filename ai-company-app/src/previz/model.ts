/**
 * previz/model.ts — 프로젝트 payload.previz 문서와 컷 필드 사이의 순수 변환(노드 테스트가 직접 불러온다).
 *
 * 저장 단위
 *   - 세트(sets[setKey]): 바닥 크기와 소품. 같은 세트의 모든 컷이 한 무대를 공유한다(일관성의 원천).
 *   - 컷(cuts[sceneId]): 이 컷에 선 인물의 키프레임, 카메라 키프레임(렌즈 포함), 길이.
 * 컷 필드 반영: 컷의 첫 프레임(t=0)에서 blocking·cameraDirection·cameraElevation·shotType 을,
 * 카메라 키프레임 전체에서 cameraMove 를 뽑아 scene_upsert 로 쓴다.
 */
import {
  DEFAULT_ACTOR_HEIGHT, KEY_EPS,
  cameraDirectionOf, cameraElevationOf, cameraFromCutFields, cameraMoveOf, cellPosition, facingOfYaw,
  primarySubject, quantizeDepth, quantizeX, sampleActor, sampleCamera, shotSizeOf, yawOfFacing,
  type ActorKey, type BlockingEntry, type CameraKey, type Ease, type Vec3,
} from "./geometry.ts";

export type PropKind = "box" | "cylinder" | "sphere" | "tree" | "car";
export const PROP_KINDS: PropKind[] = ["box", "cylinder", "sphere", "tree", "car"];

export interface PrevizProp { id: string; kind: PropKind; label: string; color: string; x: number; z: number; yaw: number; w: number; h: number; d: number }
export interface PrevizSet { key: string; name: string; width: number; depth: number; props: PrevizProp[] }
export interface PrevizActor { token: string; height: number; keys: ActorKey[] }
export interface PrevizCut { sceneId: string; setKey: string; duration: number; actors: PrevizActor[]; camera: CameraKey[] }
export interface PrevizDoc { version: 1; sets: Record<string, PrevizSet>; cuts: Record<string, PrevizCut>; updatedAt: string }

/** 캔버스 그래프의 컷 노드에서 필요한 값만. */
export interface CutSource {
  sceneId: string;
  order: number;
  sceneLocation: string;
  estSec: number;
  shotType: string;
  cameraMove: string;
  cameraDirection: string;
  cameraElevation: string;
  blocking: unknown;
  tokens: string[];
}

export interface DerivedFields {
  blocking: BlockingEntry[];
  cameraDirection: string;
  cameraElevation: string;
  shotType: string;
  cameraMove: string;
}

export const DEFAULT_SET_WIDTH = 6;
export const DEFAULT_SET_DEPTH = 5;
export const MIN_DURATION = 1;
export const MAX_DURATION = 30;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const vec3 = (v: unknown, fallback: Vec3): Vec3 => (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? [v[0], v[1], v[2]] : fallback);
const ease = (v: unknown): Ease => (v === "linear" ? "linear" : "smooth");

/** 장소 이름 → 세트 키(locationNames 의 느슨한 비교와 같은 정규화: 앞뒤 공백·연속 공백·대소문자). */
export function setKeyOf(name: unknown): string {
  const k = String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return k || "_default";
}

export function normalizeToken(token: unknown): string {
  const t = String(token || "").trim().replace(/^@+/, "");
  return t ? `@${t}` : "";
}

export function emptyDoc(): PrevizDoc {
  return { version: 1, sets: {}, cuts: {}, updatedAt: "" };
}

/** 서버에서 읽은 값(없거나 깨졌을 수 있음)을 안전한 문서로. */
export function normalizeDoc(raw: unknown): PrevizDoc {
  const doc = emptyDoc();
  if (!raw || typeof raw !== "object") return doc;
  const r = raw as any;
  doc.updatedAt = String(r.updatedAt || "");
  for (const [key, s] of Object.entries(r.sets && typeof r.sets === "object" ? r.sets : {})) {
    const set = s as any;
    doc.sets[key] = {
      key,
      name: String(set?.name || key),
      width: clamp(finite(set?.width, DEFAULT_SET_WIDTH), 1, 200),
      depth: clamp(finite(set?.depth, DEFAULT_SET_DEPTH), 1, 200),
      props: (Array.isArray(set?.props) ? set.props : []).filter((p: any) => p && p.id).map((p: any): PrevizProp => ({
        id: String(p.id),
        kind: (PROP_KINDS as string[]).includes(p.kind) ? p.kind : "box",
        label: String(p.label || ""),
        color: /^#[0-9a-f]{6}$/i.test(String(p.color)) ? String(p.color) : "#8a94a6",
        x: finite(p.x, 0), z: finite(p.z, 0), yaw: finite(p.yaw, 0),
        w: clamp(finite(p.w, 1), 0.05, 50), h: clamp(finite(p.h, 1), 0.05, 50), d: clamp(finite(p.d, 1), 0.05, 50),
      })),
    };
  }
  for (const [id, c] of Object.entries(r.cuts && typeof r.cuts === "object" ? r.cuts : {})) {
    const cut = c as any;
    const camera = (Array.isArray(cut?.camera) ? cut.camera : []).map((k: any): CameraKey => ({
      t: Math.max(0, finite(k?.t, 0)), pos: vec3(k?.pos, [0, 1.6, 6]), target: vec3(k?.target, [0, 1.2, 0]), focal: clamp(finite(k?.focal, 35), 8, 400), ease: ease(k?.ease),
    }));
    const actors = (Array.isArray(cut?.actors) ? cut.actors : []).map((a: any): PrevizActor => ({
      token: normalizeToken(a?.token),
      height: clamp(finite(a?.height, DEFAULT_ACTOR_HEIGHT), 0.2, 10),
      keys: (Array.isArray(a?.keys) ? a.keys : []).map((k: any): ActorKey => ({ t: Math.max(0, finite(k?.t, 0)), x: finite(k?.x, 0), z: finite(k?.z, 0), yaw: finite(k?.yaw, 0), ease: ease(k?.ease) })),
    })).filter((a: PrevizActor) => a.token && a.keys.length);
    if (!camera.length) continue;
    doc.cuts[id] = {
      sceneId: String(cut?.sceneId ?? id),
      setKey: String(cut?.setKey || "_default"),
      duration: clamp(finite(cut?.duration, 3), MIN_DURATION, MAX_DURATION),
      actors,
      camera,
    };
  }
  return doc;
}

export function ensureSet(doc: PrevizDoc, name: string): PrevizSet {
  const key = setKeyOf(name);
  return doc.sets[key] || { key, name: String(name || "").trim(), width: DEFAULT_SET_WIDTH, depth: DEFAULT_SET_DEPTH, props: [] };
}

function blockingRows(raw: unknown): Array<{ token: string; x: string; depth: string; facing: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({ token: normalizeToken(r?.token || r?.name), x: String(r?.x || "center"), depth: String(r?.depth || "mid"), facing: String(r?.facing || "camera") })).filter((r) => r.token);
}

/**
 * 컷을 처음 열 때의 배치. 우선순위: 이미 저장된 프리비즈 → 컷의 blocking 필드 → 같은 세트 직전 컷의 마지막 위치(연속성) → 기본 간격.
 * cuts 는 캔버스 순서(order) 그대로 넘긴다.
 */
export function initialCut(doc: PrevizDoc, source: CutSource, cuts: CutSource[], aspect: number): PrevizCut {
  const existing = doc.cuts[source.sceneId];
  if (existing) return existing;
  const set = ensureSet(doc, source.sceneLocation);
  const rows = blockingRows(source.blocking);
  const tokens: string[] = [];
  for (const t of [...rows.map((r) => r.token), ...source.tokens.map(normalizeToken)]) if (t && !tokens.includes(t)) tokens.push(t);

  const prevInSet = cuts
    .filter((c) => c.order < source.order && setKeyOf(c.sceneLocation) === set.key && doc.cuts[c.sceneId])
    .sort((a, b) => b.order - a.order)
    .map((c) => doc.cuts[c.sceneId])[0];

  const used: Array<[number, number]> = [];
  // 같은 칸의 인물은 칸 중심에서 좌우로 번갈아 비켜 세운다(칸 경계를 넘지 않게 작은 간격).
  const free = (x: number, z: number): [number, number] => {
    let px = x;
    for (let n = 1; used.some(([ux, uz]) => Math.abs(ux - px) < 0.4 && Math.abs(uz - z) < 0.4); n++) px = x + (n % 2 ? 1 : -1) * 0.45 * Math.ceil(n / 2);
    used.push([px, z]);
    return [px, z];
  };
  const actors: PrevizActor[] = tokens.map((token, i) => {
    const row = rows.find((r) => r.token === token);
    const prev = prevInSet?.actors.find((a) => a.token === token);
    if (row) {
      const [x, z] = free(...cellPosition(row.x, row.depth, set.width, set.depth));
      return { token, height: prev?.height ?? DEFAULT_ACTOR_HEIGHT, keys: [{ t: 0, x, z, yaw: yawOfFacing(row.facing), ease: "smooth" }] };
    }
    if (prev) {
      const last = sampleActor(prev.keys, prevInSet!.duration);
      const [x, z] = free(last.x, last.z);
      return { token, height: prev.height, keys: [{ t: 0, x, z, yaw: last.yaw, ease: "smooth" }] };
    }
    const spread = (i - (tokens.length - 1) / 2) * 1.2;
    const [x, z] = free(spread, 0);
    return { token, height: DEFAULT_ACTOR_HEIGHT, keys: [{ t: 0, x, z, yaw: 0, ease: "smooth" }] };
  });

  const lead = actors[0];
  const leadPos = lead ? sampleActor(lead.keys, 0) : { x: 0, z: 0 };
  const camera = cameraFromCutFields(source.cameraDirection, source.cameraElevation, source.shotType, { token: lead?.token || "", x: leadPos.x, z: leadPos.z, height: lead?.height ?? DEFAULT_ACTOR_HEIGHT }, aspect);
  return {
    sceneId: source.sceneId,
    setKey: set.key,
    duration: clamp(source.estSec > 0 ? source.estSec : 3, MIN_DURATION, MAX_DURATION),
    actors,
    camera: [{ ...camera, ease: "smooth" }],
  };
}

/** 컷 → 반영할 컷 필드. 화면에 인물이 없으면 샷 사이즈는 기존 값을 유지한다(사이즈의 기준이 없다). */
export function deriveCutFields(cut: PrevizCut, set: PrevizSet, aspect: number, currentShotType: string): DerivedFields {
  const cam = sampleCamera(cut.camera, 0);
  const blocking: BlockingEntry[] = cut.actors.map((a) => {
    const p = sampleActor(a.keys, 0);
    return { token: a.token, x: quantizeX(p.x, set.width), depth: quantizeDepth(p.z, set.depth), facing: facingOfYaw(p.yaw) };
  });
  const subjects = cut.actors.map((a) => ({ token: a.token, height: a.height, ...sampleActor(a.keys, 0) }));
  const primary = primarySubject(cam, aspect, subjects);
  return {
    blocking,
    cameraDirection: cameraDirectionOf(cam.pos, cam.target),
    cameraElevation: cameraElevationOf(cam.pos, cam.target),
    shotType: primary ? shotSizeOf(primary.distance, cam.focal, aspect, primary.subject.height) : (String(currentShotType || "MS").toUpperCase()),
    cameraMove: cameraMoveOf(cut.camera),
  };
}

/** 키프레임 편집 규칙: 키가 하나뿐이면 그 키를 고친다(정지 블로킹). 둘 이상이면 현재 시각의 키를 고치거나 새로 끼운다. */
export function upsertKey<K extends { t: number }>(keys: K[], t: number, make: (base: K | null) => K): K[] {
  if (keys.length <= 1) {
    const base = keys[0] || null;
    return [{ ...make(base), t: base ? base.t : t }];
  }
  const idx = keys.findIndex((k) => Math.abs(k.t - t) < KEY_EPS);
  if (idx >= 0) return keys.map((k, i) => (i === idx ? { ...make(k), t: k.t } : k));
  return [...keys, { ...make(null), t }].sort((a, b) => a.t - b.t);
}

/** 선택한 트랙에 현재 시각 키를 명시적으로 추가(움직임 시작). 이미 있으면 그대로. */
export function addKeyAt<K extends { t: number }>(keys: K[], t: number, sample: K): K[] {
  if (keys.some((k) => Math.abs(k.t - t) < KEY_EPS)) return keys;
  return [...keys, { ...sample, t }].sort((a, b) => a.t - b.t);
}

export function removeKeyAt<K extends { t: number }>(keys: K[], index: number): K[] {
  if (keys.length <= 1) return keys;
  return keys.filter((_, i) => i !== index);
}

/** 키를 옮긴다. 이웃 키를 넘지 않게 그 사이로 자른다 — 끄는 동안 순서(인덱스)가 바뀌지 않는다. */
export function moveKeyTo<K extends { t: number }>(keys: K[], index: number, t: number, duration: number): K[] {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (!sorted[index]) return keys;
  const lo = index > 0 ? sorted[index - 1].t + KEY_EPS : 0;
  const hi = index < sorted.length - 1 ? sorted[index + 1].t - KEY_EPS : duration;
  if (lo > hi) return keys;
  const nt = clamp(t, lo, Math.max(lo, hi));
  if (Math.abs(nt - sorted[index].t) < 1e-9) return keys;
  return sorted.map((k, i) => (i === index ? { ...k, t: nt } : k));
}

/** 반영할 값과 현재 컷 값이 다른 필드 이름. */
export function changedFields(derived: DerivedFields, source: CutSource): string[] {
  const out: string[] = [];
  if (derived.cameraDirection !== String(source.cameraDirection || "front")) out.push("cameraDirection");
  if (derived.cameraElevation !== String(source.cameraElevation || "eye")) out.push("cameraElevation");
  if (derived.shotType !== String(source.shotType || "MS").toUpperCase()) out.push("shotType");
  if (derived.cameraMove !== String(source.cameraMove || "static")) out.push("cameraMove");
  const norm = (rows: Array<{ token: string; x: string; depth: string; facing: string }>) => rows.map((r) => `${r.token}|${r.x}|${r.depth}|${r.facing}`).sort().join(";");
  if (norm(derived.blocking) !== norm(blockingRows(source.blocking))) out.push("blocking");
  return out;
}
