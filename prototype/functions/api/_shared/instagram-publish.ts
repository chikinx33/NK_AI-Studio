// 인스타그램 게시(컨테이너 생성 → 처리 대기 → media_publish)를 "한 요청은 짧게, 이어서 끝내기" 구조로 한다.
//
// 왜 이렇게 바꿨나(2026-11-09 원인 확정):
// 1) 예전엔 한 요청 안에서 영상 처리를 최대 180초 기다린 뒤 게시했다. nkstudio.org 는 응답이 100초를 넘기면
//    클라우드플레어가 524 로 끊는다(10/31 01:12, 11/6 02:35 UTC 실측). 서버는 계속 돌아 게시가 되기도 했다.
// 2) 더 잦았던 502: media_publish 응답에 id 가 없어서 실패로 던졌는데, 인스타는 그 순간 실제로 게시를 끝냈다
//    (11/9 07:34:42·07:41:15 UTC 게시 시각 = 502 응답 시각). 응답만 보고 판정하면 안 된다.
//
// 그래서: 한 요청은 처리 대기를 IG_STEP_BUDGET_MS 까지만 하고, 아직이면 { done:false, resume } 을 돌려준다.
// 호출한 쪽이 resume(컨테이너 id)을 실어 다시 부르면 이어서 끝낸다. 게시 직전·실패 직후엔 컨테이너 상태를 다시 읽어
// PUBLISHED 면 성공으로 본다. 컨테이너 하나는 인스타가 한 번만 게시하므로 같은 id 로 다시 불러도 글이 둘이 되지 않는다.
// 이 파일은 import 가 없다(테스트가 fetch·sleep 을 바꿔 끼워 실제로 돌린다).

export const IG_GRAPH = "https://graph.instagram.com/v21.0";
/** 한 요청 안에서 컨테이너 처리를 기다리는 최대 시간. 앞뒤 준비·게시를 더해도 100초 한참 아래로. */
export const IG_STEP_BUDGET_MS = 25_000;
export const IG_THUMB_OFFSET_MS = 1000;

export type IgFetch = (url: string, init?: any) => Promise<any>;
export type IgSleep = (ms: number) => Promise<void>;
export type IgItem = { mediaType: "image" | "video"; mediaUrl: string };
/** 이어서 끝낼 때 넘기는 값. 캐러셀은 자식이 다 끝나야 묶음 컨테이너를 만들 수 있어 자식 id 를 따로 넘긴다. */
export type IgResume = { instagramContainerId?: string; instagramChildIds?: string[] };
export type IgStep =
  // alreadyPublished: 앞선 요청이 이미 게시를 끝낸 컨테이너였다(응답을 못 받은 경우). 첫 댓글을 또 달지 않는다.
  | { done: true; postId: string; alreadyPublished: boolean }
  | { done: false; resume: IgResume };

export interface IgDeps {
  fetch: IgFetch;
  sleep?: IgSleep;
  now?: () => number;
  log?: (msg: string) => void;
}

const defaultSleep: IgSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 인스타 미디어 id 는 숫자다. 사용자가 보낸 값이 URL 경로에 그대로 들어가므로 숫자만 받는다. */
export function isIgMediaId(v: unknown): boolean {
  return typeof v === "string" && /^\d{1,40}$/.test(v);
}

/** 요청 본문에서 이어서 끝낼 값을 읽는다. 형식이 틀리면 null(새 게시로 보지 않고 400 으로 돌려보낸다). */
export function readIgResume(body: any): IgResume | null | undefined {
  const cid = body?.instagramContainerId;
  const kids = body?.instagramChildIds;
  if (cid === undefined && kids === undefined) return undefined;
  if (cid !== undefined && !isIgMediaId(cid)) return null;
  if (kids !== undefined && (!Array.isArray(kids) || !kids.length || kids.length > 10 || !kids.every(isIgMediaId))) return null;
  return { ...(cid !== undefined ? { instagramContainerId: cid } : {}), ...(kids !== undefined ? { instagramChildIds: kids.slice() } : {}) };
}

async function readJson(res: any): Promise<any> {
  const text = await res.text().catch(() => "");
  try { return text ? JSON.parse(text) : { __empty: true, __status: res.status }; }
  catch { return { __raw: String(text).slice(0, 200), __status: res.status }; }
}

function metaErrorText(data: any, status?: number): string {
  if (data?.error) {
    const e = data.error;
    // (#코드) 꼴로 남긴다 — publish.ts 의 토큰 만료 판정(\(#190\))이 같은 꼴을 읽는다.
    return [e.message, e.code != null ? `(#${e.code})` : "", e.error_subcode != null ? `sub ${e.error_subcode}` : ""].filter(Boolean).join(" ");
  }
  if (data?.__empty) return `빈 응답(HTTP ${data.__status ?? status ?? "?"})`;
  if (data?.__raw !== undefined) return `JSON 이 아닌 응답(HTTP ${data.__status ?? status ?? "?"}): ${data.__raw}`;
  return `HTTP ${status ?? "?"}`;
}

/** 메타 오류를 Error 로. metaCode(10 = 권한 없음, 190 = 토큰 만료)는 publish.ts 의 분류가 읽는다. */
function metaError(prefix: string, data: any, status?: number): Error {
  const err = new Error(`${prefix}: ${metaErrorText(data, status)}`);
  (err as any).metaCode = Number(data?.error?.code) || 0;
  return err;
}

/** 컨테이너 상태: IN_PROGRESS | FINISHED | PUBLISHED | ERROR | EXPIRED | ""(못 읽음) */
export async function igStatus(deps: IgDeps, token: string, id: string): Promise<string> {
  try {
    const r = await deps.fetch(`${IG_GRAPH}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    const d = await readJson(r);
    if (d?.error && (d.error.code === 190 || /access token|session has expired|OAuthException/i.test(String(d.error.message || "")))) {
      throw metaError("Instagram 토큰 오류", d, r.status);
    }
    return String(d?.status_code || "");
  } catch (e: any) {
    if (/토큰 오류/.test(String(e?.message || ""))) throw e;
    return "";
  }
}

function assertUsable(status: string, id: string) {
  if (status === "ERROR") throw new Error(`Instagram 미디어 처리 실패(컨테이너 ${id})`);
  if (status === "EXPIRED") throw new Error(`Instagram 미디어 컨테이너가 만료됐어요(컨테이너 ${id}) — 다시 배포해 주세요`);
}

/**
 * ids 가 모두 FINISHED(또는 PUBLISHED)가 될 때까지 deadline 까지만 기다린다.
 * true = 다 끝남, false = 아직(다음 요청에서 이어서). ERROR/EXPIRED 는 던진다.
 */
export async function igWaitFinished(deps: IgDeps, token: string, ids: string[], deadline: number): Promise<boolean> {
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const pending = new Set(ids);
  let delay = 1000; // 이미지는 보통 바로 끝난다 → 첫 확인은 빠르게, 이후 4초 간격
  for (;;) {
    for (const id of [...pending]) {
      const s = await igStatus(deps, token, id);
      assertUsable(s, id);
      if (s === "FINISHED" || s === "PUBLISHED") pending.delete(id);
    }
    if (!pending.size) return true;
    if (now() + delay > deadline) return false;
    await sleep(delay);
    delay = 4000;
  }
}

export async function igCreateContainer(deps: IgDeps, igUserId: string, token: string, params: Record<string, unknown>, what: string): Promise<string> {
  const res = await deps.fetch(`${IG_GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...params, access_token: token }),
  });
  const d = await readJson(res);
  if (d?.id) return String(d.id);
  throw metaError(`Instagram ${what} 컨테이너 생성 실패`, d, res.status);
}

/** 방금 게시된 글의 id(가능할 때만). 컨테이너는 게시 후 글 id 를 알려주지 않아, 최근 글 중 sinceMs 이후 것을 쓴다. */
async function igLatestMediaId(deps: IgDeps, igUserId: string, token: string, sinceMs: number): Promise<string> {
  try {
    const r = await deps.fetch(`${IG_GRAPH}/${igUserId}/media?fields=id,timestamp&limit=1&access_token=${encodeURIComponent(token)}`);
    const d = await readJson(r);
    const m = Array.isArray(d?.data) ? d.data[0] : null;
    const t = m?.timestamp ? Date.parse(String(m.timestamp).replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : NaN;
    if (m?.id && Number.isFinite(t) && t >= sinceMs) return String(m.id);
  } catch {}
  return "";
}

/**
 * FINISHED 컨테이너를 게시한다. 컨테이너 하나는 한 번만 게시된다.
 * - 부르기 전 상태가 PUBLISHED 면 다시 보내지 않고 성공(앞선 요청이 이미 게시함).
 * - media_publish 가 id 없이 돌아와도 바로 실패로 보지 않는다. 상태를 다시 읽어 PUBLISHED 면 성공,
 *   FINISHED 면(일시 오류) 같은 컨테이너로 다시 보낸다. 같은 컨테이너라 글이 둘이 되지 않는다.
 */
export async function igPublishOnce(deps: IgDeps, igUserId: string, token: string, creationId: string): Promise<{ postId: string; alreadyPublished: boolean }> {
  const sleep = deps.sleep || defaultSleep;
  const now = deps.now || Date.now;
  const startedAt = now() - 60_000;
  let lastErr = "";
  let lastData: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await igStatus(deps, token, creationId);
    assertUsable(before, creationId);
    if (before === "PUBLISHED") {
      return { postId: await igLatestMediaId(deps, igUserId, token, startedAt), alreadyPublished: true };
    }
    let res: any = null;
    let d: any = null;
    try {
      res = await deps.fetch(`${IG_GRAPH}/${igUserId}/media_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: token }),
      });
      d = await readJson(res);
    } catch (e: any) {
      d = { __raw: String(e?.message || e).slice(0, 200) };
    }
    if (d?.id) return { postId: String(d.id), alreadyPublished: false };
    lastErr = metaErrorText(d, res?.status);
    lastData = d;
    deps.log?.(`[instagram] media_publish 응답에 id 없음(시도 ${attempt + 1}): ${lastErr}`);
    // 인스타가 응답과 별개로 게시를 끝내는 경우가 있다 — 잠깐 뒤 상태로 판정한다.
    for (let check = 0; check < 3; check++) {
      await sleep(3000);
      const after = await igStatus(deps, token, creationId);
      assertUsable(after, creationId);
      if (after === "PUBLISHED") {
        // 이번 요청의 media_publish 가 게시한 것이다(응답만 엉망이었다) — 첫 댓글 등 후속은 이어서 한다.
        return { postId: await igLatestMediaId(deps, igUserId, token, startedAt), alreadyPublished: false };
      }
      if (after === "FINISHED") break; // 아직 게시 안 됨 → 같은 컨테이너로 다시
    }
  }
  throw metaError("Instagram 게시 실패", lastData, undefined);
}

/** 새 게시 시작. 단일(image|video) 또는 캐러셀(items 2개 이상). */
export async function startInstagramPublish(deps: IgDeps, opts: {
  igUserId: string; token: string; caption: string; items: IgItem[]; budgetMs?: number;
}): Promise<IgStep> {
  const { igUserId, token, caption, items } = opts;
  const deadline = (deps.now || Date.now)() + (opts.budgetMs ?? IG_STEP_BUDGET_MS);
  if (!items.length) throw new Error("Instagram 게시에 미디어가 없습니다.");
  if (items.length === 1) {
    const it = items[0];
    const params = it.mediaType === "video"
      ? { media_type: "REELS", video_url: it.mediaUrl, caption, share_to_feed: true, thumb_offset: IG_THUMB_OFFSET_MS }
      : { image_url: it.mediaUrl, caption };
    const id = await igCreateContainer(deps, igUserId, token, params, it.mediaType === "video" ? "릴스" : "이미지");
    return finishContainer(deps, igUserId, token, id, deadline);
  }
  const childIds: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const params = it.mediaType === "video"
      ? { media_type: "VIDEO", video_url: it.mediaUrl, is_carousel_item: true, thumb_offset: IG_THUMB_OFFSET_MS }
      : { image_url: it.mediaUrl, is_carousel_item: true };
    childIds.push(await igCreateContainer(deps, igUserId, token, params, `캐러셀 ${i + 1}/${items.length}(${it.mediaType})`));
  }
  return finishCarouselChildren(deps, igUserId, token, caption, childIds, deadline);
}

/** 이어서 끝내기. resume 은 앞 요청이 돌려준 값 그대로. */
export async function resumeInstagramPublish(deps: IgDeps, opts: {
  igUserId: string; token: string; caption: string; resume: IgResume; budgetMs?: number;
}): Promise<IgStep> {
  const deadline = (deps.now || Date.now)() + (opts.budgetMs ?? IG_STEP_BUDGET_MS);
  const { igUserId, token, caption, resume } = opts;
  if (resume.instagramContainerId) return finishContainer(deps, igUserId, token, resume.instagramContainerId, deadline);
  if (resume.instagramChildIds?.length) return finishCarouselChildren(deps, igUserId, token, caption, resume.instagramChildIds, deadline);
  throw new Error("Instagram 이어서 게시할 컨테이너가 없습니다.");
}

async function finishContainer(deps: IgDeps, igUserId: string, token: string, id: string, deadline: number): Promise<IgStep> {
  const ready = await igWaitFinished(deps, token, [id], deadline);
  if (!ready) return { done: false, resume: { instagramContainerId: id } };
  const r = await igPublishOnce(deps, igUserId, token, id);
  return { done: true, ...r };
}

async function finishCarouselChildren(deps: IgDeps, igUserId: string, token: string, caption: string, childIds: string[], deadline: number): Promise<IgStep> {
  // 자식이 모두 FINISHED 여야 묶음 컨테이너를 만들 수 있다("Media ID is not available" 방지).
  const ready = await igWaitFinished(deps, token, childIds, deadline);
  if (!ready) return { done: false, resume: { instagramChildIds: childIds.slice() } };
  const carouselId = await igCreateContainer(deps, igUserId, token, { media_type: "CAROUSEL", children: childIds.join(","), caption }, "캐러셀 묶음");
  return finishContainer(deps, igUserId, token, carouselId, Math.max(deadline, (deps.now || Date.now)() + 5000));
}
