/**
 * 장소(세트) 이름 규칙 — 서버 prototype/functions/api/_shared/location-names.js 와 같은 규칙.
 * 세트의 정체성이 문자열이라 같은 방이 두 이름으로 갈리면 각각 따로 생성된다(2026-09-13 실제 사례).
 * 캔버스는 이 규칙으로 "같은 세트로 보이는 장소"를 미리 경고하고 합치기를 제안한다.
 */
const SPLIT_RE = /\s+[—–-]\s+|\s*[:：,，(（]\s*/;

export function coreLocationName(raw: unknown): string {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return (s.split(SPLIT_RE)[0] || s).trim();
}

export function locationKey(v: unknown): string {
  return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export interface MergeSuggestion { into: string; from: string[]; reason: "same-core" | "contains" }

/** 남길 이름 = 핵심 이름(구분자 앞, 가장 짧은 것). 그 핵심 이름을 품은 긴 이름들이 from. 서버 suggestLocationMerges 와 같은 규칙. */
export function suggestLocationMerges(names: string[]): MergeSuggestion[] {
  const list = Array.from(new Set((Array.isArray(names) ? names : []).map((n) => String(n || "").trim()).filter(Boolean)));
  const groups = new Map<string, { into: string; from: Set<string>; reason: MergeSuggestion["reason"] }>();
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i]; const b = list[j];
      const ca = coreLocationName(a); const cb = coreLocationName(b);
      let reason: MergeSuggestion["reason"] | "" = "";
      let core = "";
      if (ca && cb && locationKey(ca) === locationKey(cb)) { reason = "same-core"; core = ca.length <= cb.length ? ca : cb; }
      else if (cb && cb.length >= 2 && locationKey(a).includes(locationKey(cb))) { reason = "contains"; core = cb; }
      if (!reason) continue;
      const key = locationKey(core);
      const g = groups.get(key) || { into: core, from: new Set<string>(), reason };
      if (core.length < g.into.length) g.into = core;
      if (locationKey(a) !== key) g.from.add(a);
      if (locationKey(b) !== key) g.from.add(b);
      if (reason === "same-core") g.reason = "same-core";
      groups.set(key, g);
    }
  }
  return Array.from(groups.values()).map((g) => ({ into: g.into, from: Array.from(g.from), reason: g.reason }));
}
