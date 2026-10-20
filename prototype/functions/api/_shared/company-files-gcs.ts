// prototype/functions/api/_shared/company-files-gcs.ts
//
// 업무 파일(회사 파일 공간) 저장소(GCS) 요청. api/agent/company-files.ts 와 같은 경로 규칙·같은 요청 모양이다
// (그 파일은 기존 테스트가 안쪽 함수 모양을 직접 검사해 그대로 둔다). 퍼블리싱 패키지 가져오기·결과 쓰기(publishing-packages.ts)가 쓴다.
// 사용자 파일 공간 = <사용자 루트>/projects/ai-company/company-files/<상대 경로>.
import { getGoogleAccessToken, resolveGcsEnv } from "./gcs.js";
import { buildAiVideoProjectPrefix } from "./storage";

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
export const MAX_OPERATION_OBJECTS = 2000;

export function workspacePrefix(basePrefix: string, userId: string) {
  return `${buildAiVideoProjectPrefix(basePrefix, userId, "ai-company")}/company-files/`;
}

export async function accessContext(env: any) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  return { ...ctx, token };
}

export async function gcsFetch(ctx: any, makeRequest: (useBilling: boolean) => Promise<Response>) {
  let response = await makeRequest(true);
  if (!response.ok && ctx.userProject && (response.status === 400 || response.status === 403)) response = await makeRequest(false);
  return response;
}

export function billingHeaders(ctx: any, useBilling: boolean) {
  return {
    Authorization: `Bearer ${ctx.token}`,
    ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
  };
}

export async function listObjects(ctx: any, prefix: string, delimiter = "") {
  const items: any[] = [];
  const prefixes = new Set<string>();
  let pageToken = "";
  let pages = 0;
  do {
    const response = await gcsFetch(ctx, (useBilling) => {
      const params = new URLSearchParams({ prefix, maxResults: "500" });
      if (delimiter) params.set("delimiter", delimiter);
      if (pageToken) params.set("pageToken", pageToken);
      if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
      return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?${params}`, {
        headers: billingHeaders(ctx, useBilling),
      });
    });
    pages += 1;
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `GCS 목록 조회 실패 (HTTP ${response.status})`);
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    for (const value of Array.isArray(payload.prefixes) ? payload.prefixes : []) prefixes.add(String(value));
    pageToken = String(payload.nextPageToken || "");
    if (items.length > MAX_OPERATION_OBJECTS) throw new Error(`한 번에 처리할 수 있는 파일은 ${MAX_OPERATION_OBJECTS}개까지입니다.`);
  } while (pageToken);
  return { items, prefixes: [...prefixes], pages };
}

export async function getObject(ctx: any, objectName: string, media = false, range = "", generation = "") {
  return gcsFetch(ctx, (useBilling) => {
    const params = new URLSearchParams();
    if (media) params.set("alt", "media");
    if (generation) params.set("generation", generation);
    if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
    const query = params.size ? `?${params}` : "";
    return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${query}`, {
      headers: { ...billingHeaders(ctx, useBilling), ...(media && range ? { Range: range } : {}) },
    });
  });
}

export async function uploadObject(ctx: any, objectName: string, bytes: ArrayBuffer | Uint8Array, contentType: string) {
  const response = await gcsFetch(ctx, (useBilling) => {
    const params = new URLSearchParams({ uploadType: "media", name: objectName });
    if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
    return fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?${params}`, {
      method: "POST",
      headers: { ...billingHeaders(ctx, useBilling), "Content-Type": contentType || "application/octet-stream" },
      body: bytes as unknown as BodyInit,
    });
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `GCS 업로드 실패 (HTTP ${response.status})`);
  return payload;
}

export async function deleteObject(ctx: any, objectName: string) {
  const response = await gcsFetch(ctx, (useBilling) => {
    const query = useBilling && ctx.userProject ? `?userProject=${encodeURIComponent(ctx.userProject)}` : "";
    return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${query}`, {
      method: "DELETE",
      headers: billingHeaders(ctx, useBilling),
    });
  });
  if (response.status !== 204 && response.status !== 404) throw new Error(`파일 삭제 실패 (HTTP ${response.status})`);
}

export async function copyObject(ctx: any, source: string, destination: string) {
  let rewriteToken = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await gcsFetch(ctx, (useBilling) => {
      const params = new URLSearchParams();
      if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
      if (rewriteToken) params.set("rewriteToken", rewriteToken);
      const query = params.size ? `?${params}` : "";
      return fetch(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(source)}/rewriteTo/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(destination)}${query}`,
        { method: "POST", headers: billingHeaders(ctx, useBilling) },
      );
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || "파일 복사에 실패했습니다.");
    if (payload.done === true) return;
    rewriteToken = String(payload.rewriteToken || "");
    if (!rewriteToken) throw new Error("파일 복사 진행 정보를 받지 못했습니다.");
  }
  throw new Error("파일 복사 단계가 허용 횟수를 초과했습니다.");
}
