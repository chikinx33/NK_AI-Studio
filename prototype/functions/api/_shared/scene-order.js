/**
 * 컷 순서 변경(scene_reorder)의 순수 로직.
 *
 * 순서의 단일 원천은 프로젝트 scenes 배열 순서다. id 는 바꾸지 않고 배열만 재배열한다
 * (cutRefId·잡의 sceneId·이미지 경로가 id 를 가리키므로 id 를 다시 매기면 참조가 끊긴다).
 *
 * 저장 전에 두 가지를 검사해 경고를 돌려준다. 막지는 않는다 — 판단은 창작자의 몫이다.
 *  - set-crossing : 옮긴 컷의 sceneLocation 이 새 자리 앞뒤 컷과 다르다(세트 묶음을 넘어갔다).
 *                   시나리오 화면의 "Scene N" 묶음(연속 같은 장소)이 갈라지거나 늘어난다.
 *  - song-section : 노래 프로젝트에서 컷의 songSectionId 순서가 구간 순서와 어긋나거나,
 *                   가사를 싣는 컷(lyrics 있음)이 더 이상 그 구간의 첫 컷이 아니다.
 *                   자막·음원 청크가 구간 시작 컷에 묶이므로 어긋나면 자막이 엉뚱한 컷에 뜬다.
 *
 * 브라우저(제작 캔버스)는 놓기 전에 같은 검사를 하고, 서버 도구는 저장 직전에 다시 한다.
 * 설계서: docs/storyboard-sheet-consistency-design.md 3.4 / 4.0
 */

function idOf(scene, idx) {
  const raw = scene && scene.id;
  return String(raw === undefined || raw === null || raw === "" ? idx + 1 : raw).trim();
}

function locOf(scene) {
  return String((scene && (scene.sceneLocation || scene.location)) || "").trim();
}

/**
 * 연속 같은 장소를 한 묶음으로 센다(시나리오 화면 computeSceneLabels 와 같은 규칙:
 * 빈 장소는 항상 새 묶음).
 * @returns {Array<{location:string, ids:string[]}>}
 */
export function groupBySet(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  const groups = [];
  let last = null;
  list.forEach((s, i) => {
    const loc = locOf(s);
    if (!last || !loc || loc !== last.location) {
      last = { location: loc, ids: [] };
      groups.push(last);
    }
    last.ids.push(idOf(s, i));
  });
  return groups;
}

/**
 * order(컷 id 순열)대로 scenes 를 재배열한다. id 는 그대로 둔다.
 * @returns {{ ok:true, scenes:any[], moved:string[] } | { ok:false, error:string }}
 */
export function applySceneOrder(scenes, order) {
  const list = Array.isArray(scenes) ? scenes : [];
  const want = (Array.isArray(order) ? order : []).map((v) => String(v).trim()).filter(Boolean);
  const byId = new Map();
  list.forEach((s, i) => byId.set(idOf(s, i), s));
  if (want.length !== list.length) {
    return { ok: false, error: `order 길이(${want.length})가 컷 수(${list.length})와 다릅니다` };
  }
  const seen = new Set();
  for (const id of want) {
    if (!byId.has(id)) return { ok: false, error: `컷 ${id} 이(가) 프로젝트에 없습니다` };
    if (seen.has(id)) return { ok: false, error: `컷 ${id} 이(가) 두 번 나옵니다` };
    seen.add(id);
  }
  const next = want.map((id) => byId.get(id));
  const before = list.map((s, i) => idOf(s, i));
  const moved = want.filter((id, i) => before[i] !== id);
  return { ok: true, scenes: next, moved };
}

/**
 * 순서 변경 전후를 비교해 경고 목록을 만든다.
 * @param {any[]} before  변경 전 scenes
 * @param {any[]} after   변경 후 scenes
 * @param {any} payload   project payload (songSections 를 본다)
 * @returns {Array<{code:'set-crossing'|'song-section', sceneId:string, message:string, detail?:any}>}
 */
export function analyzeReorder(before, after, payload) {
  const prev = Array.isArray(before) ? before : [];
  const next = Array.isArray(after) ? after : [];
  const warnings = [];

  // 실제로 자리가 바뀐 컷만 본다(전체 순열 비교).
  const prevIds = prev.map((s, i) => idOf(s, i));
  const nextIds = next.map((s, i) => idOf(s, i));
  const prevPos = new Map(prevIds.map((id, i) => [id, i]));
  // "옮긴 컷" = 이전 이웃 관계가 바뀐 컷 중, 앞뒤가 모두 새로 만난 컷(끌어다 놓은 카드).
  // 단순화: 이전 위치 대비 상대 순서가 가장 많이 바뀐 컷 하나 이상을 옮긴 컷으로 본다.
  const movedIds = movedCutIds(prevIds, nextIds);

  // ── 세트 넘어가기 ──
  movedIds.forEach((id) => {
    const i = nextIds.indexOf(id);
    const loc = locOf(next[i]);
    const prevLoc = i > 0 ? locOf(next[i - 1]) : null;
    const nextLoc = i < next.length - 1 ? locOf(next[i + 1]) : null;
    const sameAsPrev = prevLoc !== null && prevLoc === loc && !!loc;
    const sameAsNext = nextLoc !== null && nextLoc === loc && !!loc;
    if (loc && !sameAsPrev && !sameAsNext) {
      // 원래 자리에서는 같은 세트 이웃이 있었는지(있었다면 "세트를 넘어간" 이동)
      const pi = prevPos.get(id);
      const hadSetNeighbor = pi !== undefined && (
        (pi > 0 && locOf(prev[pi - 1]) === loc) || (pi < prev.length - 1 && locOf(prev[pi + 1]) === loc)
      );
      if (hadSetNeighbor || groupBySet(next).length > groupBySet(prev).length) {
        warnings.push({
          code: "set-crossing",
          sceneId: id,
          message: `컷 ${id}(${loc})이(가) 세트 묶음을 넘어갔어요. 앞뒤 컷은 ${[prevLoc, nextLoc].filter((v) => v !== null).map((v) => v || "(장소 없음)").join(" / ")}이에요.`,
          detail: { location: loc, prevLocation: prevLoc, nextLocation: nextLoc },
        });
      }
    }
  });

  // ── 노래 구간 ──
  const sections = Array.isArray(payload && payload.songSections) ? payload.songSections : [];
  if (sections.length) {
    const rank = new Map(sections.map((s, i) => [String(s && s.id || ""), i]));
    let maxRank = -1;
    let maxRankId = "";
    const firstOfSection = new Map();
    next.forEach((s, i) => {
      const id = nextIds[i];
      const sec = String((s && s.songSectionId) || "").trim();
      if (!sec || !rank.has(sec)) return;
      const r = rank.get(sec);
      if (!firstOfSection.has(sec)) firstOfSection.set(sec, id);
      if (r < maxRank) {
        warnings.push({
          code: "song-section",
          sceneId: id,
          message: `컷 ${id}의 노래 구간(${String((s && s.songSectionLabel) || sec)})이 앞 컷 ${maxRankId}의 구간보다 앞이에요. 구간 순서가 어긋나요.`,
          detail: { sectionId: sec, afterSceneId: maxRankId },
        });
      } else if (r > maxRank) {
        maxRank = r;
        maxRankId = id;
      }
    });
    next.forEach((s, i) => {
      const id = nextIds[i];
      const sec = String((s && s.songSectionId) || "").trim();
      const hasLyrics = !!String((s && s.lyrics) || "").trim();
      if (!sec || !hasLyrics || !firstOfSection.has(sec)) return;
      if (firstOfSection.get(sec) !== id) {
        warnings.push({
          code: "song-section",
          sceneId: id,
          message: `컷 ${id}이(가) 가사를 싣고 있는데 더 이상 구간(${String((s && s.songSectionLabel) || sec)})의 첫 컷이 아니에요. 자막·음원이 컷 ${firstOfSection.get(sec)}보다 늦게 시작해요.`,
          detail: { sectionId: sec, firstSceneId: firstOfSection.get(sec) },
        });
      }
    });
  }

  return dedupeWarnings(warnings);
}

/** 이전·이후 id 열에서 "끌어다 놓은" 컷을 찾는다: 나머지를 고정했을 때 빠지면 순서가 같아지는 최소 집합. */
export function movedCutIds(prevIds, nextIds) {
  const a = Array.isArray(prevIds) ? prevIds.map(String) : [];
  const b = Array.isArray(nextIds) ? nextIds.map(String) : [];
  if (a.length !== b.length) return b.filter((id) => !a.includes(id));
  // 최장 공통 부분열(LCS)에 들지 않는 컷이 옮긴 컷이다. 컷 수가 작아 O(n²)로 충분하다.
  const n = a.length;
  const posInB = new Map(b.map((id, i) => [id, i]));
  const seq = a.map((id) => (posInB.has(id) ? posInB.get(id) : -1));
  const lis = longestIncreasingIds(seq);
  const kept = new Set(lis.map((i) => a[i]));
  return b.filter((id) => !kept.has(id));
}

function longestIncreasingIds(seq) {
  const n = seq.length;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let bestEnd = -1;
  for (let i = 0; i < n; i++) {
    if (seq[i] < 0) { len[i] = 0; continue; }
    for (let j = 0; j < i; j++) {
      if (seq[j] >= 0 && seq[j] < seq[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
    }
    if (bestEnd < 0 || len[i] > len[bestEnd]) bestEnd = i;
  }
  const out = [];
  for (let k = bestEnd; k >= 0; k = prev[k]) out.push(k);
  return out.reverse();
}

function dedupeWarnings(list) {
  const seen = new Set();
  return list.filter((w) => {
    const key = `${w.code}:${w.sceneId}:${w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 사용자에게 보여 줄 한 줄 요약(경고 코드별 묶음). */
export function summarizeWarnings(warnings, lang) {
  const list = Array.isArray(warnings) ? warnings : [];
  if (!list.length) return "";
  const en = lang === "en";
  const sets = list.filter((w) => w.code === "set-crossing").length;
  const songs = list.filter((w) => w.code === "song-section").length;
  const parts = [];
  if (sets) parts.push(en ? `crosses a set (${sets})` : `세트를 넘어감 ${sets}건`);
  if (songs) parts.push(en ? `song section mismatch (${songs})` : `노래 구간 어긋남 ${songs}건`);
  return parts.join(en ? ", " : " · ");
}
