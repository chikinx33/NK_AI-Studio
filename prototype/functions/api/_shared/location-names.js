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

/** 느슨한 비교 키(공백 정리·소문자). set-plates.findLocationForScene 과 같은 기준. */
export function locationKey(v) {
  return String(v || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 같은 세트로 보이는 장소 쌍을 제안한다(canonicalizeSceneLocations 와 같은 규칙: 구분자 앞 핵심 이름이 같거나,
 * 한쪽 핵심 이름이 다른 쪽에 포함). 이미 만들어진 프로젝트(통일 규칙 이전에 분해된 것)용.
 * @param {string[]} names 현재 장소 이름들
 * @returns {Array<{into:string, from:string[], reason:'same-core'|'contains'}>}  into = 핵심 이름, from = 그쪽으로 합칠 이름들
 */
export function suggestLocationMerges(names) {
  const list = Array.from(new Set((Array.isArray(names) ? names : []).map((n) => String(n || "").trim()).filter(Boolean)));
  // 남길 이름 = 핵심 이름(구분자 앞, 가장 짧은 것). "소녀의 방 — …" 과 "장난감이 흩어진 소녀의 방 안" 은 둘 다 "소녀의 방" 으로.
  const groups = new Map(); // coreKey → { into, from:Set, reason }
  for (let i = 0; i < list.length; i++) {
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const a = list[i]; const b = list[j];
      const ca = coreLocationName(a); const cb = coreLocationName(b);
      let reason = "";
      let core = "";
      if (ca && cb && locationKey(ca) === locationKey(cb)) { reason = "same-core"; core = ca.length <= cb.length ? ca : cb; }
      else if (cb && cb.length >= 2 && locationKey(a).includes(locationKey(cb))) { reason = "contains"; core = cb; }
      if (!reason) continue;
      const key = locationKey(core);
      const g = groups.get(key) || { into: core, from: new Set(), reason };
      if (core.length < g.into.length) g.into = core;
      if (locationKey(a) !== key) g.from.add(a);
      if (locationKey(b) !== key) g.from.add(b);
      if (reason === "same-core") g.reason = "same-core";
      groups.set(key, g);
    }
  }
  return Array.from(groups.values()).map((g) => ({ into: g.into, from: Array.from(g.from), reason: g.reason }));
}

/**
 * 장소 합치기: from 장소의 컷을 into 장소로 옮긴다(sceneLocation 재작성). id 는 바꾸지 않는다.
 * @returns {{ scenes:any[], changed:number }}
 */
export function applyLocationMerge(scenes, from, into) {
  const list = Array.isArray(scenes) ? scenes : [];
  const kf = locationKey(from); const target = String(into || "").trim();
  if (!kf || !target) return { scenes: list, changed: 0 };
  let changed = 0;
  const out = list.map((sc) => {
    if (!sc || typeof sc !== "object") return sc;
    if (locationKey(sc.sceneLocation || sc.location) !== kf) return sc;
    changed += 1;
    return { ...sc, sceneLocation: target };
  });
  return { scenes: out, changed };
}

/**
 * 장소 칸에 "문장"이 들어왔는지(화면·행동 묘사가 흘러든 경우). 세트 이름은 짧은 장소 명사여야 한다.
 * 실제 사례(2026-09-13): "바닥에 블록·봉제인형·공이 흩어져 있음 세 캐릭터가 입구에 나란히 멈춰 선 채 …" 가 장소로 저장돼
 * 세트 시트가 야외 돌문 입구로 생성됐다.
 */
export function looksLikeSentenceLocation(raw) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (s.length > 30) return true;
  if (/[.!?]$/.test(s)) return true;
  if (/(있음|있다|한다|된다|린다|간다|본다|선다|준다|이다|였다|있는|하는|하며|면서|채로|채 )/.test(s) && s.length > 14) return true;
  if (/@[0-9A-Za-z가-힣_]/.test(s)) return true; // 캐릭터 토큰이 들어간 장소는 화면 묘사다
  return false;
}

/** 세트 이름 정리: 구분자 앞 핵심 이름, 24자 상한. 문장이면 빈 문자열(호출부가 폴백 이름을 쓴다). */
export function sanitizeSetName(raw, maxLen = 24) {
  const core = coreLocationName(raw);
  if (!core) return "";
  if (looksLikeSentenceLocation(core)) return "";
  return core.length > maxLen ? core.slice(0, maxLen).trim() : core;
}
