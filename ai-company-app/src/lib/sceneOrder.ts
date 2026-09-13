/**
 * 제작 캔버스의 컷 순서 변경 검사(브라우저 쪽).
 *
 * 서버 도구 scene_reorder(prototype/functions/api/_shared/scene-order.js)가 저장 직전에 같은 검사를
 * 다시 하지만, 캔버스는 카드를 놓기 전에 경고를 띄워 취소할 기회를 준다.
 *  - set-crossing : 옮긴 컷의 장소가 새 자리 앞뒤 컷과 다르다(세트 묶음을 넘어갔다).
 *  - song-section : 노래 구간 순서가 어긋나거나, 가사를 싣는 컷이 구간의 첫 컷이 아니게 된다.
 */

export interface OrderCut {
  id: string;             // 노드 id("cut:3")
  sceneId: string;        // 씬 id("3")
  location: string;       // sceneLocation
  songSectionId?: string;
  songSectionLabel?: string;
  lyrics?: string;
}

export interface ReorderWarning { code: "set-crossing" | "song-section"; sceneId: string; message: string }

export function analyzeReorderClient(
  before: OrderCut[],
  after: OrderCut[],
  movedId: string,
  songSections: Array<{ id: string; label?: string }> | undefined,
): ReorderWarning[] {
  const warnings: ReorderWarning[] = [];
  const i = after.findIndex((c) => c.id === movedId);
  if (i < 0) return warnings;
  const cut = after[i];
  const loc = String(cut.location || "").trim();
  const prevLoc = i > 0 ? String(after[i - 1].location || "").trim() : null;
  const nextLoc = i < after.length - 1 ? String(after[i + 1].location || "").trim() : null;
  const sameAsPrev = prevLoc !== null && !!loc && prevLoc === loc;
  const sameAsNext = nextLoc !== null && !!loc && nextLoc === loc;
  if (loc && !sameAsPrev && !sameAsNext) {
    const pi = before.findIndex((c) => c.id === movedId);
    const hadSetNeighbor = pi >= 0 && (
      (pi > 0 && String(before[pi - 1].location || "").trim() === loc)
      || (pi < before.length - 1 && String(before[pi + 1].location || "").trim() === loc)
    );
    if (hadSetNeighbor || countSets(after) > countSets(before)) {
      warnings.push({
        code: "set-crossing",
        sceneId: cut.sceneId,
        message: `컷 ${cut.sceneId}(${loc})이(가) 세트 묶음을 넘어가요. 새 자리의 앞뒤 컷은 ${[prevLoc, nextLoc].filter((v) => v !== null).map((v) => v || "(장소 없음)").join(" / ")}이에요.`,
      });
    }
  }

  const sections = Array.isArray(songSections) ? songSections : [];
  if (sections.length) {
    const rank = new Map(sections.map((s, idx) => [String(s.id || ""), idx]));
    let maxRank = -1;
    let maxRankId = "";
    const firstOfSection = new Map<string, string>();
    after.forEach((c) => {
      const sec = String(c.songSectionId || "").trim();
      if (!sec || !rank.has(sec)) return;
      const r = rank.get(sec)!;
      if (!firstOfSection.has(sec)) firstOfSection.set(sec, c.sceneId);
      if (r < maxRank) {
        warnings.push({ code: "song-section", sceneId: c.sceneId, message: `컷 ${c.sceneId}의 노래 구간(${c.songSectionLabel || sec})이 앞 컷 ${maxRankId}의 구간보다 앞이에요. 구간 순서가 어긋나요.` });
      } else if (r > maxRank) { maxRank = r; maxRankId = c.sceneId; }
    });
    after.forEach((c) => {
      const sec = String(c.songSectionId || "").trim();
      if (!sec || !String(c.lyrics || "").trim() || !firstOfSection.has(sec)) return;
      if (firstOfSection.get(sec) !== c.sceneId) {
        warnings.push({ code: "song-section", sceneId: c.sceneId, message: `컷 ${c.sceneId}이(가) 가사를 싣고 있는데 더 이상 구간(${c.songSectionLabel || sec})의 첫 컷이 아니에요. 자막·음원이 컷 ${firstOfSection.get(sec)}보다 늦게 시작해요.` });
      }
    });
  }
  const seen = new Set<string>();
  return warnings.filter((w) => { const k = `${w.code}:${w.sceneId}:${w.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 연속 같은 장소 = 한 세트 묶음(빈 장소는 항상 새 묶음). 시나리오 화면 Scene N 규칙과 같다. */
export function countSets(cuts: OrderCut[]): number {
  let n = 0;
  let last: string | null = null;
  cuts.forEach((c) => {
    const loc = String(c.location || "").trim();
    if (last === null || !loc || loc !== last) { n += 1; last = loc; }
  });
  return n;
}

export function sameOrder(a: OrderCut[], b: OrderCut[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id);
}
