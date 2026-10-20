// 에이전트가 발행한 결과를 SNS 세팅(브랜드 스튜디오)이 읽는 곳에 남긴다(2026-10-18).
// 예전엔 에이전트 발행이 에이전트 기록(agent_jobs)에만 남아, SNS 세팅의 배포 이력·배포 완료 표시엔 보이지 않았다.
// 브랜드 스튜디오는 브랜드 기록의 brandStudioPublishResults 를 먼저 읽고(없으면 에피소드 것), 둘 다 쓴다.
// '목록 전체 저장'이라 동시에 쓰면 한쪽이 지워진다(v3.2006 기록 유실) — GCS 세대 확인으로 읽고-덧붙이고-쓴다.
import { getGoogleAccessToken, resolveGcsEnv } from "./gcs.js";
import { buildAiVideoProjectPrefix, buildAiVideoBrandPrefix } from "./storage";

async function auth(env: any) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({
    clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  return { ctx, token };
}

/** 세대가 그대로일 때만 쓴다. 바뀌었으면 다시 읽어 적용(최대 4번). 문서가 없으면 아무것도 하지 않는다. */
async function updateJson(env: any, objectName: string, mutate: (doc: any) => any): Promise<boolean> {
  const { ctx, token } = await auth(env);
  const base = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`${base}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`record_read_failed ${res.status}`);
    const generation = String(res.headers.get("x-goog-generation") || "");
    const doc = await res.json().catch(() => null);
    if (!doc || typeof doc !== "object") return false;
    const next = mutate(doc);
    const put = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}&ifGenerationMatch=${encodeURIComponent(generation)}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(next) },
    );
    if (put.status === 412) continue;
    if (!put.ok) throw new Error(`record_write_failed ${put.status}`);
    return true;
  }
  throw new Error("record_write_conflict");
}

/** id 기준으로 덧붙인다(같은 id 는 새 값으로 바꾼다). 브랜드 스튜디오 appendPublishResult 와 같은 규칙. */
export function mergePublishRows(existing: any, rows: any[]): any[] {
  const list = Array.isArray(existing) ? existing.slice() : [];
  for (const row of rows) {
    const i = list.findIndex((r: any) => r && r.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row }; else list.push(row);
  }
  return list;
}

/** 브랜드 스튜디오 persistPublishedResult 와 같은 모양의 기록 한 줄. */
export function buildPublishRow(input: {
  platform: string; status: string; postId?: string; url?: string; publishedAt?: string; scheduledJobId?: string;
  caption?: string; hashtags?: string[]; title?: string; projectId: string; projectTitle?: string; brandId?: string; payload?: any;
}, now = new Date().toISOString()) {
  const p = input.payload && typeof input.payload === "object" ? input.payload : {};
  const postId = String(input.postId || "").trim();
  const channel = String(input.platform || "channel").trim();
  return {
    id: postId ? `${channel}_${postId}` : (input.scheduledJobId ? `${channel}_sched_${input.scheduledJobId}` : `publish_${Date.parse(now) || Date.now()}_${channel}`),
    delivery: "auto",
    channelType: channel,
    contentType: String(p.brandStudioContentType || "sns-post"),
    status: String(input.status || "published"),
    publishedAt: String(input.publishedAt || now),
    metricsUpdatedAt: "",
    remotePostId: postId,
    remoteUrl: String(input.url || ""),
    scheduledJobId: String(input.scheduledJobId || ""),
    sourceScope: "agent",
    brandId: String(input.brandId || p.brandId || ""),
    title: String(input.title || input.projectTitle || "게시 결과"),
    projectId: input.projectId,
    projectTitle: String(input.projectTitle || p.episodeTitle || input.projectId),
    attributionStatus: "assigned",
    attributionSource: "agent-publish",
    attributedAt: now,
    seasonId: String(p.seasonId || ""),
    seasonLabel: String(p.seasonLabel || p.seasonTitle || ""),
    campaignId: String(p.campaignId || ""),
    campaignTitle: String(p.campaignTitle || p.campaignLabel || ""),
    purposeCategory: String(p.purposeCategory || ""),
    purposeTags: Array.isArray(p.purposeTags) ? p.purposeTags.slice() : [],
    caption: String(input.caption || ""),
    hashtags: (input.hashtags || []).map((h) => String(h || "").trim()).filter(Boolean),
    metrics: { views: 0, likes: 0, comments: 0, shares: 0, clicks: 0 },
  };
}

/** 이 시간이 지난 '올리는 중' 표시는 끊긴 것으로 본다(채널 하나가 이보다 오래 걸리지 않는다). 배포 화면도 같은 값을 쓴다. */
export const DEPLOYING_STALE_MS = 15 * 60 * 1000;

/**
 * 에이전트가 채널 하나를 올리는 동안 배포 화면이 그 채널 버튼에 스피너를 보이게 표시한다(2026-10-18 엔케 지적:
 * 에이전트가 '동시에 올리는 중'이라는데 배포 화면에는 아무 표시가 없었다). key 는 '잡:채널번호', value 가 null 이면 지운다.
 */
export async function setDeployingStep(env: any, userId: string, projectId: string, key: string, value: { format: string; startedAt: string } | null) {
  const { basePrefix } = resolveGcsEnv(env);
  const projectObject = `${buildAiVideoProjectPrefix(basePrefix, userId, projectId)}/reference/data.json`;
  return updateJson(env, projectObject, (doc) => {
    const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
    const steps: Record<string, any> = { ...(payload.brandStudioDeployingSteps && typeof payload.brandStudioDeployingSteps === "object" ? payload.brandStudioDeployingSteps : {}) };
    if (value) steps[key] = value; else delete steps[key];
    for (const [k, v] of Object.entries(steps)) if (!(Date.now() - Date.parse(String((v as any)?.startedAt || "")) < DEPLOYING_STALE_MS)) delete steps[k];
    return { ...doc, payload: { ...payload, brandStudioDeployingSteps: steps } };
  });
}

/**
 * 배포 완료 표시를 켤 상태. TikTok 초안함 전송(sent_to_inbox)도 SNS 세팅 직접 배포(ttInboxOutcome)처럼 완료로 본다.
 * 'processing'(아직 TikTok 확인 전)·실패는 켜지 않는다 — 안 갔는데 완료 배지가 남는 버그를 막는다.
 */
export function isDeployedStatus(status: string): boolean {
  return status === "published" || status === "scheduled" || status === "sent_to_inbox";
}

/**
 * 이미 남긴 기록 한 줄의 상태만 바꾼다(캡션·시각 등은 그대로). 예: TikTok 이 나중에 알림함 전송을 확인했을 때
 * 'processing' → 'sent_to_inbox'. 그 줄이 없으면 아무것도 덧붙이지 않는다.
 */
export async function updatePublishRowStatus(env: any, userId: string, projectId: string, brandId: string, rowId: string, channel: string, status: string) {
  const { basePrefix } = resolveGcsEnv(env);
  const setStatus = (list: any) => (Array.isArray(list) ? list.map((r: any) => (r && r.id === rowId ? { ...r, status } : r)) : list);
  const projectObject = `${buildAiVideoProjectPrefix(basePrefix, userId, projectId)}/reference/data.json`;
  const project = await updateJson(env, projectObject, (doc) => {
    const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
    const merged = setStatus(payload.brandStudioPublishResults || payload.publishResults);
    const has = Array.isArray(merged) && merged.some((r: any) => r && r.id === rowId);
    return { ...doc, payload: { ...payload, brandStudioPublishResults: merged, publishResults: merged,
      brandStudioDeployedFormats: { ...(payload.brandStudioDeployedFormats || {}), ...(has && isDeployedStatus(status) ? { [channel]: true } : {}) } } };
  });
  let brand = false;
  if (brandId) {
    const brandObject = `${buildAiVideoBrandPrefix(basePrefix, userId, brandId)}/reference/data.json`;
    brand = await updateJson(env, brandObject, (doc) => {
      const b = doc.brand && typeof doc.brand === "object" ? doc.brand : {};
      return { ...doc, brand: { ...b, brandStudioPublishResults: setStatus(b.brandStudioPublishResults) } };
    });
  }
  return { project, brand };
}

/** 에피소드(payload)와 브랜드 기록 양쪽에 덧붙이고, 배포 완료 표시(brandStudioDeployedFormats)도 켠다. */
export async function appendPublishRecords(env: any, userId: string, projectId: string, brandId: string, rows: any[]) {
  if (!rows.length) return { project: false, brand: false };
  const { basePrefix } = resolveGcsEnv(env);
  const deployed: Record<string, boolean> = {};
  for (const r of rows) if (isDeployedStatus(String(r.status))) deployed[r.channelType] = true;
  const projectObject = `${buildAiVideoProjectPrefix(basePrefix, userId, projectId)}/reference/data.json`;
  const project = await updateJson(env, projectObject, (doc) => {
    const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
    const merged = mergePublishRows(payload.brandStudioPublishResults || payload.publishResults, rows);
    return { ...doc, payload: { ...payload, brandStudioPublishResults: merged, publishResults: merged,
      brandStudioDeployedFormats: { ...(payload.brandStudioDeployedFormats || {}), ...deployed } } };
  });
  let brand = false;
  if (brandId) {
    const brandObject = `${buildAiVideoBrandPrefix(basePrefix, userId, brandId)}/reference/data.json`;
    brand = await updateJson(env, brandObject, (doc) => {
      const b = doc.brand && typeof doc.brand === "object" ? doc.brand : {};
      return { ...doc, brand: { ...b, brandStudioPublishResults: mergePublishRows(b.brandStudioPublishResults, rows) }, savedAt: new Date().toISOString() };
    });
  }
  return { project, brand };
}
