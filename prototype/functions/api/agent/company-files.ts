// AI 회사의 사용자 파일 공간.
// 실제 객체 경로와 화면 폴더를 같은 상대 경로로 관리해 사용자와 에이전트가 함께 읽고 쓴다.
import { authorizeRequest } from "../_shared/auth.js";
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { buildAiVideoProjectPrefix } from "../_shared/storage";
import { ensureAgentSchema, getSql } from "./_shared";

type PagesFunction = (ctx: { request: Request; env: any }) => Promise<Response>;

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_OPERATION_OBJECTS = 2000;
const FOLDER_MARKER = ".raviok-folder";
const WORK_PATH_PREFIX = "@work/";

const corsHeaders = (origin: string | null) => ({
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Allow-Origin": origin || "*",
  Vary: "Origin",
});

const send = (data: any, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });

export const onRequestOptions: PagesFunction = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

function workspacePrefix(basePrefix: string, userId: string) {
  return `${buildAiVideoProjectPrefix(basePrefix, userId, "ai-company")}/company-files/`;
}

function normalizePath(value: unknown, allowRoot = true) {
  const raw = String(value || "").normalize("NFC").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!raw) {
    if (allowRoot) return "";
    throw new Error("파일 또는 폴더 경로가 필요합니다.");
  }
  if (raw.length > 500) throw new Error("경로는 500자 이하여야 합니다.");
  const parts = raw.split("/");
  if (parts.length > 40) throw new Error("폴더 깊이는 40단계 이하여야 합니다.");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || part === FOLDER_MARKER) throw new Error("사용할 수 없는 경로입니다.");
    if (part.length > 120 || /[\u0000-\u001f]/.test(part)) throw new Error("파일 또는 폴더 이름을 확인해 주세요.");
  }
  return parts.join("/");
}

function baseName(path: string) {
  return path.split("/").pop() || path;
}

function parentPath(path: string) {
  return path.split("/").slice(0, -1).join("/");
}

function assertMutablePath(path: string) {
  if (path === WORK_PATH_PREFIX.slice(0, -1) || path.startsWith(WORK_PATH_PREFIX)) {
    throw new Error("통합 업무 경로는 일반 파일 작업의 대상으로 사용할 수 없습니다.");
  }
}

async function listVirtualWorkFolders(sql: any, userId: string) {
  if (!sql) return [];
  await ensureAgentSchema(sql);
  const rows = await sql(`
    WITH normalized_items AS (
      SELECT to_char((created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS date_key,
             updated_at
        FROM company_work_items
       WHERE user_id = $1
    )
    SELECT item.date_key,
           COALESCE(MAX(folder.title), item.date_key) AS title,
           COUNT(*)::int AS item_count,
           MAX(item.updated_at) AS updated_at
      FROM normalized_items item
      LEFT JOIN company_work_folders folder
        ON folder.user_id = $1
       AND folder.date_key = item.date_key
     GROUP BY item.date_key
     ORDER BY item.date_key DESC`, [userId]);
  return rows.map((row: any) => ({
    kind: "work-folder", source: "work", name: String(row.title || row.date_key),
    path: `${WORK_PATH_PREFIX}${row.date_key}`, parentPath: "", dateKey: String(row.date_key),
    itemCount: Number(row.item_count || 0), updatedAt: String(row.updated_at || ""),
  }));
}

async function listVirtualWorkItems(sql: any, userId: string, dateKey: string) {
  if (!sql || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];
  await ensureAgentSchema(sql);
  const rows = await sql(`
    SELECT id, title, work_type, status, request_text, result_summary, created_at, updated_at
      FROM company_work_items
     WHERE user_id = $1
       AND (created_at AT TIME ZONE 'Asia/Seoul')::date = $2::date
     ORDER BY created_at DESC`, [userId, dateKey]);
  return rows.map((row: any) => ({
    kind: "work", source: "work", name: String(row.title || "업무"),
    path: `${WORK_PATH_PREFIX}${dateKey}/${row.id}`, parentPath: `${WORK_PATH_PREFIX}${dateKey}`,
    dateKey, workId: String(row.id), workType: String(row.work_type || ""), status: String(row.status || "working"),
    summary: String(row.result_summary || row.request_text || ""), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  }));
}

async function accessContext(env: any) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: GCS_SCOPE });
  return { ...ctx, token };
}

async function gcsFetch(ctx: any, makeRequest: (useBilling: boolean) => Promise<Response>) {
  let response = await makeRequest(true);
  if (!response.ok && ctx.userProject && (response.status === 400 || response.status === 403)) response = await makeRequest(false);
  return response;
}

function billingHeaders(ctx: any, useBilling: boolean) {
  return {
    Authorization: `Bearer ${ctx.token}`,
    ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
  };
}

async function listObjects(ctx: any, prefix: string, delimiter = "") {
  const items: any[] = [];
  const prefixes = new Set<string>();
  let pageToken = "";
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
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `GCS 목록 조회 실패 (HTTP ${response.status})`);
    items.push(...(Array.isArray(payload.items) ? payload.items : []));
    for (const value of Array.isArray(payload.prefixes) ? payload.prefixes : []) prefixes.add(String(value));
    pageToken = String(payload.nextPageToken || "");
    if (items.length > MAX_OPERATION_OBJECTS) throw new Error(`한 번에 처리할 수 있는 파일은 ${MAX_OPERATION_OBJECTS}개까지입니다.`);
  } while (pageToken);
  return { items, prefixes: [...prefixes] };
}

async function getObject(ctx: any, objectName: string, media = false, range = "") {
  return gcsFetch(ctx, (useBilling) => {
    const params = new URLSearchParams();
    if (media) params.set("alt", "media");
    if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
    const query = params.size ? `?${params}` : "";
    return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${query}`, {
      headers: { ...billingHeaders(ctx, useBilling), ...(media && range ? { Range: range } : {}) },
    });
  });
}

async function uploadObject(ctx: any, objectName: string, bytes: ArrayBuffer, contentType: string) {
  const response = await gcsFetch(ctx, (useBilling) => {
    const params = new URLSearchParams({ uploadType: "media", name: objectName });
    if (useBilling && ctx.userProject) params.set("userProject", ctx.userProject);
    return fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?${params}`, {
      method: "POST",
      headers: { ...billingHeaders(ctx, useBilling), "Content-Type": contentType || "application/octet-stream" },
      body: bytes,
    });
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `GCS 업로드 실패 (HTTP ${response.status})`);
  return payload;
}

async function deleteObject(ctx: any, objectName: string) {
  const response = await gcsFetch(ctx, (useBilling) => {
    const query = useBilling && ctx.userProject ? `?userProject=${encodeURIComponent(ctx.userProject)}` : "";
    return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}${query}`, {
      method: "DELETE",
      headers: billingHeaders(ctx, useBilling),
    });
  });
  if (response.status !== 204 && response.status !== 404) throw new Error(`파일 삭제 실패 (HTTP ${response.status})`);
}

async function copyObject(ctx: any, source: string, destination: string) {
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

async function resolveObjects(ctx: any, rootPrefix: string, relativePath: string) {
  const objectName = `${rootPrefix}${relativePath}`;
  const exact = await getObject(ctx, objectName);
  if (exact.ok) return { kind: "file" as const, objects: [objectName] };
  const folderPrefix = `${objectName}/`;
  const listed = await listObjects(ctx, folderPrefix);
  if (listed.items.length) return { kind: "folder" as const, objects: listed.items.map((item) => String(item.name || "")).filter(Boolean) };
  return null;
}

async function ensureDestinationAvailable(ctx: any, rootPrefix: string, relativePath: string) {
  if (await resolveObjects(ctx, rootPrefix, relativePath)) throw new Error(`'${relativePath}' 경로에 이미 파일 또는 폴더가 있습니다.`);
}

export const onRequestGet: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const ctx = await accessContext(env);
    const rootPrefix = workspacePrefix(ctx.basePrefix, auth.userId);
    const url = new URL(request.url);
    const requestedPath = String(url.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
    const path = normalizePath(requestedPath);
    const wantsDownload = url.searchParams.get("download") === "1";
    const wantsPreview = url.searchParams.get("preview") === "1";
    const wantsRead = url.searchParams.get("read") === "1";

    if (!wantsDownload && !wantsPreview && !wantsRead && requestedPath.startsWith(WORK_PATH_PREFIX)) {
      const dateKey = requestedPath.slice(WORK_PATH_PREFIX.length).split("/")[0];
      const entries = await listVirtualWorkItems(getSql(env), auth.userId, dateKey);
      return send({ path: `${WORK_PATH_PREFIX}${dateKey}`, parentPath: "", entries, unified: true }, 200, origin);
    }

    if (wantsDownload || wantsPreview || wantsRead) {
      const filePath = normalizePath(path, false);
      const objectName = `${rootPrefix}${filePath}`;
      const metadataResponse = await getObject(ctx, objectName);
      if (metadataResponse.status === 404) return send({ error: "파일을 찾지 못했습니다." }, 404, origin);
      const metadata: any = await metadataResponse.json().catch(() => ({}));
      if (!metadataResponse.ok) return send({ error: metadata?.error?.message || "파일 정보를 읽지 못했습니다." }, metadataResponse.status, origin);
      const size = Number(metadata.size || 0);
      if (wantsRead && size > MAX_TEXT_BYTES) return send({ error: "에이전트가 읽을 수 있는 텍스트 파일은 1MB 이하입니다." }, 413, origin);
      const range = wantsPreview ? String(request.headers.get("Range") || "") : "";
      const media = await getObject(ctx, objectName, true, range);
      if (!media.ok) return send({ error: `파일 다운로드 실패 (HTTP ${media.status})` }, media.status, origin);
      if (wantsRead) {
        const contentType = String(metadata.contentType || "application/octet-stream");
        if (!contentType.startsWith("text/") && !/(json|xml|yaml|javascript|csv|markdown|raviok-project|x-project)/i.test(contentType) && !/\.(txt|md|mdx|json|csv|tsv|xml|ya?ml|js|ts|tsx|jsx|css|html|nkproject|nkproj|raviok-project|project)$/i.test(filePath)) {
          return send({ error: "텍스트로 읽을 수 없는 파일 형식입니다." }, 415, origin);
        }
        const text = await media.text();
        const offset = Math.max(0, Number(url.searchParams.get("offset") || 0) || 0);
        const limit = Math.min(16000, Math.max(1000, Number(url.searchParams.get("limit") || 12000) || 12000));
        const content = text.slice(offset, offset + limit);
        const nextOffset = offset + content.length;
        return send({ path: filePath, contentType, size, content, offset, nextOffset, hasMore: nextOffset < text.length, totalCharacters: text.length }, 200, origin);
      }
      const headers = new Headers(corsHeaders(origin));
      headers.set("Content-Type", String(metadata.contentType || media.headers.get("Content-Type") || "application/octet-stream"));
      headers.set("Content-Disposition", `${wantsPreview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(baseName(filePath))}`);
      headers.set("Accept-Ranges", media.headers.get("Accept-Ranges") || "bytes");
      headers.set("Cache-Control", "private, max-age=60");
      for (const header of ["Content-Range", "ETag", "Last-Modified"]) {
        const value = media.headers.get(header);
        if (value) headers.set(header, value);
      }
      const responseLength = media.headers.get("Content-Length");
      if (responseLength) headers.set("Content-Length", responseLength);
      else if (size && media.status !== 206) headers.set("Content-Length", String(size));
      return new Response(media.body, { status: media.status === 206 ? 206 : 200, headers });
    }

    const listPrefix = `${rootPrefix}${path ? `${path}/` : ""}`;
    const listed = await listObjects(ctx, listPrefix, "/");
    const folders = listed.prefixes.map((prefix) => {
      const relative = prefix.slice(rootPrefix.length).replace(/\/$/, "");
      return { kind: "folder", name: baseName(relative), path: relative, parentPath: path };
    });
    const files = listed.items
      .filter((item) => baseName(String(item.name || "")) !== FOLDER_MARKER)
      .map((item) => {
        const relative = String(item.name || "").slice(rootPrefix.length);
        return {
          kind: "file", name: baseName(relative), path: relative, parentPath: path,
          contentType: String(item.contentType || "application/octet-stream"), size: Number(item.size || 0),
          createdAt: String(item.timeCreated || item.updated || ""), updatedAt: String(item.updated || ""),
        };
      });
    const workFolders = path ? [] : await listVirtualWorkFolders(getSql(env), auth.userId);
    const entries = [...workFolders, ...folders, ...files].sort((a: any, b: any) => {
      const aFolder = a.kind === "folder" || a.kind === "work-folder";
      const bFolder = b.kind === "folder" || b.kind === "work-folder";
      return aFolder === bFolder ? a.name.localeCompare(b.name, "ko") : aFolder ? -1 : 1;
    });
    return send({ path, parentPath: parentPath(path), entries, unified: true }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "회사 파일 조회에 실패했습니다.") }, 500, origin);
  }
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const ctx = await accessContext(env);
    const rootPrefix = workspacePrefix(ctx.basePrefix, auth.userId);
    const contentType = String(request.headers.get("Content-Type") || "");
    const uploadPath = new URL(request.url).searchParams.get("path");

    // JSON 파일 업로드도 application/json이므로 Content-Type이 아니라 path 쿼리 유무로
    // 사용자 파일 업로드와 JSON 작업 명령을 구분한다.
    if (uploadPath !== null) {
      const path = normalizePath(uploadPath, false);
      assertMutablePath(path);
      const declaredSize = Number(request.headers.get("Content-Length") || 0);
      if (declaredSize > MAX_UPLOAD_BYTES) return send({ error: "파일은 100MB 이하만 업로드할 수 있습니다." }, 413, origin);
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength) return send({ error: "업로드할 파일이 비어 있습니다." }, 400, origin);
      if (bytes.byteLength > MAX_UPLOAD_BYTES) return send({ error: "파일은 100MB 이하만 업로드할 수 있습니다." }, 413, origin);
      const stored = await uploadObject(ctx, `${rootPrefix}${path}`, bytes, contentType || "application/octet-stream");
      return send({ ok: true, entry: { kind: "file", name: baseName(path), path, size: bytes.byteLength, contentType, updatedAt: stored.updated || new Date().toISOString() } }, 201, origin);
    }

    const body: any = await request.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    if (action === "mkdir") {
      const path = normalizePath(body.path, false);
      assertMutablePath(path);
      const existing = await resolveObjects(ctx, rootPrefix, path);
      if (existing) {
        if (existing.kind === "folder" && body.existOk === true) {
          return send({ ok: true, created: false, entry: { kind: "folder", name: baseName(path), path } }, 200, origin);
        }
        return send({ error: `'${path}' 경로에 이미 파일 또는 폴더가 있습니다.` }, 409, origin);
      }
      await uploadObject(ctx, `${rootPrefix}${path}/${FOLDER_MARKER}`, new ArrayBuffer(0), "application/x-directory");
      return send({ ok: true, created: true, entry: { kind: "folder", name: baseName(path), path } }, 201, origin);
    }
    if (action === "write") {
      const path = normalizePath(body.path, false);
      assertMutablePath(path);
      const content = String(body.content ?? "");
      const bytes = new TextEncoder().encode(content);
      if (bytes.byteLength > MAX_TEXT_BYTES) return send({ error: "에이전트가 작성할 수 있는 텍스트 파일은 1MB 이하입니다." }, 413, origin);
      const type = String(body.contentType || "text/plain; charset=utf-8").slice(0, 120);
      const stored = await uploadObject(ctx, `${rootPrefix}${path}`, bytes.buffer, type);
      return send({ ok: true, entry: { kind: "file", name: baseName(path), path, size: bytes.byteLength, contentType: type, updatedAt: stored.updated || new Date().toISOString() } }, 201, origin);
    }
    if (action === "copy" || action === "move") {
      const source = normalizePath(body.source, false);
      const destination = normalizePath(body.destination, false);
      assertMutablePath(source);
      assertMutablePath(destination);
      if (source === destination) return send({ error: "원본과 대상 경로가 같습니다." }, 400, origin);
      const resolved = await resolveObjects(ctx, rootPrefix, source);
      if (!resolved) return send({ error: "복사하거나 이동할 파일 또는 폴더를 찾지 못했습니다." }, 404, origin);
      if (resolved.kind === "folder" && destination.startsWith(`${source}/`)) return send({ error: "폴더를 자기 하위 경로로 복사하거나 이동할 수 없습니다." }, 400, origin);
      await ensureDestinationAvailable(ctx, rootPrefix, destination);
      const sourceObject = `${rootPrefix}${source}`;
      const destinationObject = `${rootPrefix}${destination}`;
      for (const objectName of resolved.objects) {
        const suffix = resolved.kind === "file" ? "" : objectName.slice(`${sourceObject}/`.length);
        const target = resolved.kind === "file" ? destinationObject : `${destinationObject}/${suffix}`;
        await copyObject(ctx, objectName, target);
      }
      if (action === "move") for (const objectName of resolved.objects) await deleteObject(ctx, objectName);
      return send({ ok: true, action, kind: resolved.kind, source, destination, affectedCount: resolved.objects.length }, 200, origin);
    }
    return send({ error: "지원하지 않는 파일 작업입니다." }, 400, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "회사 파일 작업에 실패했습니다.") }, 500, origin);
  }
};

export const onRequestDelete: PagesFunction = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);
    const body: any = await request.json().catch(() => ({}));
    const paths = (Array.isArray(body.paths) ? body.paths : [body.path]).map((value: any) => normalizePath(value, false));
    paths.forEach(assertMutablePath);
    if (!paths.length || paths.length > 100) return send({ error: "한 번에 삭제할 항목은 1~100개여야 합니다." }, 400, origin);
    const ctx = await accessContext(env);
    const rootPrefix = workspacePrefix(ctx.basePrefix, auth.userId);
    const names = new Set<string>();
    for (const path of paths) {
      const resolved = await resolveObjects(ctx, rootPrefix, path);
      if (resolved) for (const objectName of resolved.objects) names.add(objectName);
    }
    if (!names.size) return send({ error: "삭제할 파일 또는 폴더를 찾지 못했습니다." }, 404, origin);
    if (names.size > MAX_OPERATION_OBJECTS) return send({ error: `한 번에 삭제할 수 있는 파일은 ${MAX_OPERATION_OBJECTS}개까지입니다.` }, 400, origin);
    for (const objectName of names) await deleteObject(ctx, objectName);
    return send({ ok: true, deletedCount: names.size, paths }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "회사 파일 삭제에 실패했습니다.") }, 500, origin);
  }
};
