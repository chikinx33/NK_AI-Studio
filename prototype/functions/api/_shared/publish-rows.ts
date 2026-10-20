// 배포 이력(brandStudioPublishResults/publishResults) 목록은 서버에 있는 것이 기준이다(2026-10-20).
// 에이전트(publish-records.ts)가 서버에서 줄을 덧붙이거나 상태를 바꾸는 사이, 열려 있던 화면이 들고 있던 옛 목록을
// payload 째 저장하면 그 줄이 지워지고 상태가 되돌아갔다(NEKOBAN EP01: 인스타 줄 소실·TikTok processing 복귀).
// 그래서 저장(project/save·brand/save)은 화면이 보낸 목록을 쓰지 않고, 화면이 '바꾼 줄'(publishRowOps)만 서버 목록에 적용한다.
// 화면 쪽 짝: prototype/api.js api.publishRowOps(이전 목록, 바꾼 목록).

export type PublishRowOps = { upsert?: any[]; remove?: string[] };

const rowId = (row: any) => String((row && row.id) || "").trim();

/** 받은 ops 를 쓸 수 있는 모양으로 거른다. 비었으면 null. */
export function readPublishRowOps(raw: any): PublishRowOps | null {
  if (!raw || typeof raw !== "object") return null;
  const upsert = (Array.isArray(raw.upsert) ? raw.upsert : []).filter((r: any) => r && typeof r === "object" && rowId(r));
  const remove = (Array.isArray(raw.remove) ? raw.remove : []).map((id: any) => String(id || "").trim()).filter(Boolean);
  return upsert.length || remove.length ? { upsert, remove } : null;
}

/**
 * 서버 목록에 화면이 바꾼 줄만 적용한다. 같은 id 는 바꾼 칸만 덮고(나머지 칸은 서버 값 유지), 없으면 맨 앞에 붙인다.
 * id 가 달라도 채널+게시 id 가 같으면 같은 게시물로 본다(브랜드 스튜디오 appendPublishResult 와 같은 규칙).
 */
export function applyPublishRowOps(existing: any, ops: PublishRowOps | null): any[] {
  let list = Array.isArray(existing) ? existing.slice() : [];
  if (!ops) return list;
  const removeIds = new Set(ops.remove || []);
  if (removeIds.size) list = list.filter((r: any) => !removeIds.has(rowId(r)));
  for (const patch of ops.upsert || []) {
    const id = rowId(patch);
    const remote = String(patch.remotePostId || "").trim();
    let i = list.findIndex((r: any) => rowId(r) === id);
    if (i < 0 && remote) {
      i = list.findIndex((r: any) => r && String(r.channelType || "") === String(patch.channelType || "")
        && String(r.remotePostId || r.postId || "") === remote);
    }
    if (i >= 0) list[i] = { ...list[i], ...patch, id: rowId(list[i]) || id };
    else list.unshift(patch);
  }
  return list;
}

/**
 * 저장할 결과 목록을 정한다. 서버에 목록이 있으면 그것에 ops 만 적용하고(화면이 보낸 목록은 버린다),
 * 서버에 아직 목록이 없을 때만 화면이 보낸 목록을 처음 값으로 받는다.
 */
export function resolvePublishRows(existingList: any, incomingList: any, ops: PublishRowOps | null): any[] | undefined {
  if (Array.isArray(existingList)) return applyPublishRowOps(existingList, ops);
  if (Array.isArray(incomingList)) return applyPublishRowOps(incomingList, ops);
  return ops ? applyPublishRowOps([], ops) : undefined;
}

/** 에피소드 payload 용: brandStudioPublishResults·publishResults 둘을 같은 목록으로 맞춘다. */
export function protectPayloadPublishRows(existingPayload: any, mergedPayload: any, incomingPayload: any, ops: PublishRowOps | null) {
  const pick = (p: any) => (p && Array.isArray(p.brandStudioPublishResults) ? p.brandStudioPublishResults
    : (p && Array.isArray(p.publishResults) ? p.publishResults : undefined));
  const rows = resolvePublishRows(pick(existingPayload), pick(incomingPayload), ops);
  if (rows === undefined) {
    delete mergedPayload.brandStudioPublishResults;
    delete mergedPayload.publishResults;
    return undefined;
  }
  mergedPayload.brandStudioPublishResults = rows;
  mergedPayload.publishResults = rows;
  return rows;
}

/**
 * 에이전트만 쓰는 '올리는 중' 표시(brandStudioDeployingSteps)는 화면이 들고 있던 옛 사본으로 덮지 않는다.
 * 서버 값을 그대로 둔다(없으면 뺀다).
 */
export function keepServerOwnedPayloadKeys(existingPayload: any, mergedPayload: any) {
  for (const key of ["brandStudioDeployingSteps"]) {
    if (existingPayload && Object.prototype.hasOwnProperty.call(existingPayload, key)) mergedPayload[key] = existingPayload[key];
    else delete mergedPayload[key];
  }
}
