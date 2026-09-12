/**
 * _shared/location-names.js — 씬 장소 문자열을 에피소드 안에서 "세트 이름 하나"로 통일한다.
 *
 * 왜: 세트 판정(플레이트 선택·연속성 앵커·카메라 재구성·Scene/cut 라벨)은 sceneLocation 문자열
 * 일치로 동작한다. Pass 1 이 같은 방을 "소녀의 방 — 장난감이 흩어진 실내", "장난감이 흩어진 소녀의 방 안"
 * 처럼 씬마다 다르게 쓰면(2026-09-13 실제 결과) 같은 세트가 서로 다른 세트로 갈려 모든 연속성이 끊긴다.
 * 프롬프트 규칙("짧은 세트 이름 하나, 같은 공간이면 같은 이름")만으로는 재발하므로 코드로 통일한다.
 *
 * 규칙(결정적, LLM 없음)
 *  1) 구분자 뒤 설명은 버린다: " — ", " - ", ":", ",", "(" 이후.  "소녀의 방 — 장난감이…" → "소녀의 방"
 *  2) 한 씬의 장소가 다른 씬의 더 짧은 장소를 품고 있으면 그 짧은 쪽으로 합친다.
 *     "장난감이 흩어진 소녀의 방 안" ⊃ "소녀의 방" → "소녀의 방"
 *  3) 위 규칙으로 못 잡는 표현 차이는 /api/scenario/locations(LLM 병합) 결과의 이름으로 클라이언트가 한 번 더 통일한다.
 */

const SPLIT_RE = /\s+[—–-]\s+|\s*[:：,，(（]\s*/;

export function coreLocationName(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  const head = s.split(SPLIT_RE)[0] || s;
  return head.trim();
}

/**
 * @param {Array} scenes  sceneLocation(또는 location)을 가진 씬 배열
 * @returns {{ scenes: Array, renamed: number, names: string[] }}
 */
export function canonicalizeSceneLocations(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const cores = list.map((s) => coreLocationName(s && (s.sceneLocation || s.location)));
  const unique = Array.from(new Set(cores.filter(Boolean))).sort((a, b) => a.length - b.length);
  const resolve = (core) => {
    if (!core) return core;
    for (const cand of unique) {
      if (cand === core) break; // 자기보다 짧은 후보만 본다(정렬돼 있음)
      if (cand.length >= 2 && core.includes(cand)) return cand;
    }
    return core;
  };
  let renamed = 0;
  const out = list.map((s, i) => {
    if (!s || typeof s !== "object") return s;
    const original = String(s.sceneLocation || s.location || "").trim();
    const next = resolve(cores[i]);
    if (!next || next === original) return s;
    renamed += 1;
    return { ...s, sceneLocation: next };
  });
  const names = Array.from(new Set(out.map((s) => String((s && s.sceneLocation) || "").trim()).filter(Boolean)));
  return { scenes: out, renamed, names };
}
