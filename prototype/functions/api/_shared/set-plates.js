/**
 * _shared/set-plates.js — 세트 플레이트 캐시 규칙(단일 원천).
 *
 * 세트의 진실은 부감 마스터(variants 'angle-top') 한 장이다. 앵글 플레이트(정면·후면·좌·우 × 아이레벨·하이·로우)는
 * 사전 산출물이 아니라 캐시다: 컷 스틸을 만들 때 그 컷의 방위×높이 플레이트가 없으면 마스터에서 한 장 파생해
 * 저장하고, 이후 같은 방위×높이의 컷은 그것을 재사용한다. 같은 방향의 컷들이 같은 벽면을 보게 하는 장치이지
 * "정면·측면·후면을 갖추는 것"이 목적이 아니다.
 *
 * 플레이트 키 = 방위 × 높이. 사이즈(shotType)·무브(cameraMove)는 키를 바꾸지 않는다.
 *   eye  → dir-<dir>          (기존 dir-front/dir-back 과 호환)
 *   high → dir-<dir>-high
 *   low  → dir-<dir>-low       (worm 도 low 플레이트를 쓴다 — 프롬프트 힌트만 극단)
 *   top  → angle-top            (마스터 자체)
 */
import { normalizeCameraDirection, normalizeCameraElevation, CAMERA_DIRECTIONS, CAMERA_ELEVATIONS } from "../scenario/shots/vocab.js";

export const MASTER_VARIANT_ID = "angle-top";

/** 높이를 플레이트 높이로 접는다: worm → low, 나머지는 그대로. */
export function plateElevation(elevation) {
  const e = normalizeCameraElevation(elevation) || "eye";
  return e === "worm" ? "low" : e;
}

export function plateVariantId(direction, elevation) {
  const d = normalizeCameraDirection(direction) || "front";
  const e = plateElevation(elevation);
  if (e === "top") return MASTER_VARIANT_ID;
  return e === "eye" ? `dir-${d}` : `dir-${d}-${e}`;
}

export function plateLabel(direction, elevation, lang = "ko") {
  const d = normalizeCameraDirection(direction) || "front";
  const e = plateElevation(elevation);
  if (e === "top") return lang === "ko" ? "부감 마스터" : "top-down master";
  const dv = CAMERA_DIRECTIONS[d]; const ev = CAMERA_ELEVATIONS[e];
  const dText = lang === "ko" ? dv.ko : dv.en;
  if (e === "eye") return dText;
  return lang === "ko" ? `${dText}·${ev.ko}` : `${dText} · ${ev.en}`;
}

export function masterOf(loc) {
  const variants = Array.isArray(loc && loc.variants) ? loc.variants : [];
  const hit = variants.find((v) => v && String(v.id || "") === MASTER_VARIANT_ID && String(v.refObjectName || "").trim());
  return hit ? String(hit.refObjectName).trim() : "";
}

/**
 * 이 컷(방위×높이)에 쓸 플레이트를 고른다.
 * @returns {{ objectName:string, variantId:string, exact:boolean, source:'exact'|'front-legacy'|'master'|'front-fallback' } | null}
 *  exact=false 면 호출자가 마스터에서 파생(캐시 채우기)할 수 있다.
 */
export function findPlate(loc, direction, elevation) {
  if (!loc) return null;
  const id = plateVariantId(direction, elevation);
  const variants = Array.isArray(loc.variants) ? loc.variants : [];
  const master = masterOf(loc);
  if (id === MASTER_VARIANT_ID) return master ? { objectName: master, variantId: id, exact: true, source: "exact" } : null;
  const hit = variants.find((v) => v && String(v.id || "") === id && String(v.refObjectName || "").trim());
  if (hit) return { objectName: String(hit.refObjectName).trim(), variantId: id, exact: true, source: "exact" };
  const front = String(loc.refObjectName || "").trim();
  // 정면·아이레벨은 기존 정면 플레이트(refObjectName)와 같은 뜻 — 마스터가 없던 옛 프로젝트 호환.
  if (id === "dir-front" && front && !master) return { objectName: front, variantId: id, exact: true, source: "front-legacy" };
  if (master) return { objectName: master, variantId: MASTER_VARIANT_ID, exact: false, source: "master" };
  if (front) return { objectName: front, variantId: "dir-front", exact: false, source: "front-fallback" };
  return null;
}

/** 컷 목록이 그 세트에서 실제로 쓰는 플레이트 키(마스터 제외, 중복 제거). UI 의 "만들어질 것" 미리보기용. */
export function neededPlateKeys(cuts, setName) {
  const key = String(setName || "").trim().toLowerCase();
  const out = [];
  (Array.isArray(cuts) ? cuts : []).forEach((c) => {
    if (!c) return;
    if (key && String(c.sceneLocation || c.location || "").trim().toLowerCase() !== key) return;
    const id = plateVariantId(c.cameraDirection, c.cameraElevation);
    if (id !== MASTER_VARIANT_ID && !out.includes(id)) out.push(id);
  });
  return out;
}
