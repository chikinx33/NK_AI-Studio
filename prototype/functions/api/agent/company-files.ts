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
// 날짜 폴더에 끌어다 넣은 파일·폴더의 실제 저장 위치(.work-files/날짜/...). 루트 목록에는 숨긴다.
const WORK_FILES_ROOT = ".work-files";

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

function pathWithoutExtension(path: string) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) : path;
}

function assertMutablePath(path: string) {
  if (path === WORK_PATH_PREFIX.slice(0, -1) || path.startsWith(WORK_PATH_PREFIX)) {
    throw new Error("통합 업무 경로는 일반 파일 작업의 대상으로 사용할 수 없습니다.");
  }
}

// parent: 이 일반 폴더 안에 놓인 날짜 폴더만(''=루트), null 이면 위치와 상관없이 전부.
async function listVirtualWorkFolders(sql: any, userId: string, parent: string | null = null) {
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
           COALESCE(MAX(folder.parent_path), '') AS parent_path,
           COUNT(*)::int AS item_count,
           MAX(item.updated_at) AS updated_at
      FROM normalized_items item
      LEFT JOIN company_work_folders folder
        ON folder.user_id = $1
       AND folder.date_key = item.date_key
     GROUP BY item.date_key
    HAVING $2::text IS NULL OR COALESCE(MAX(folder.parent_path), '') = $2::text
     ORDER BY item.date_key DESC`, [userId, parent]);
  return rows.map((row: any) => ({
    kind: "work-folder", source: "work", name: String(row.title || row.date_key),
    path: `${WORK_PATH_PREFIX}${row.date_key}`, parentPath: String(row.parent_path || ""), dateKey: String(row.date_key),
    itemCount: Number(row.item_count || 0), updatedAt: String(row.updated_at || ""),
  }));
}

// 지운 폴더들 안에 있던 날짜 폴더를 루트로 되돌린다. 폴더가 많아도 쿼리 1번(서브요청 한도).
async function releaseWorkFolders(env: any, userId: string, paths: string[]) {
  const sql = getSql(env);
  if (!sql || !paths.length) return;
  await ensureAgentSchema(sql);
  await sql(`UPDATE company_work_folders SET parent_path = '', updated_at = now()
              WHERE user_id = $1 AND (parent_path = ANY($2::text[]) OR parent_path LIKE ANY($3::text[]))`,
    [userId, paths, paths.map((path) => `${path.replace(/[\\%_]/g, "\\$&")}/%`)]);
}

// 일반 폴더를 옮기거나 지우면 그 안에 넣어 둔 날짜 폴더의 위치도 따라간다(지우면 루트로 되돌린다 — 업무 기록은 지우지 않는다).
async function relocateWorkFolders(env: any, userId: string, source: string, destination: string) {
  const sql = getSql(env);
  if (!sql) return;
  await ensureAgentSchema(sql);
  await sql(`UPDATE company_work_folders
                SET parent_path = CASE WHEN $3::text = '' THEN '' ELSE $3::text || substr(parent_path, length($2::text) + 1) END,
                    updated_at = now()
              WHERE user_id = $1 AND (parent_path = $2::text OR parent_path LIKE $2::text || '/%')`,
    [userId, source, destination]);
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

const nameKey = (value: unknown) => String(value || "").normalize("NFC").trim().toLocaleLowerCase("ko-KR");

// 날짜 폴더는 이름을 바꿔도 내부 경로가 @work/생성일 그대로다(업무가 생성일로 묶이므로 경로를 옮기지 않는다).
// 대신 표시명·날짜 어느 쪽으로 불러도 같은 폴더를 찾는다.
async function findWorkFolder(sql: any, userId: string, requested: string) {
  const wanted = nameKey(requested.startsWith(WORK_PATH_PREFIX) ? requested.slice(WORK_PATH_PREFIX.length) : requested);
  if (!wanted) return null;
  const folders = await listVirtualWorkFolders(sql, userId);
  return folders.find((folder: any) => nameKey(folder.dateKey) === wanted)
    || folders.find((folder: any) => nameKey(folder.name) === wanted)
    || null;
}

async function pathCandidates(ctx: any, sql: any, userId: string, rootPrefix: string, requested: string) {
  const wanted = nameKey(requested.split("/").pop());
  const [root, workFolders] = await Promise.all([
    listObjects(ctx, rootPrefix, "/"),
    listVirtualWorkFolders(sql, userId).catch(() => []),
  ]);
  const entries = [
    ...workFolders.map((folder: any) => ({ name: folder.name, path: folder.path })),
    ...root.prefixes.map((prefix) => {
      const relative = prefix.slice(rootPrefix.length).replace(/\/$/, "");
      return { name: baseName(relative), path: relative };
    }),
  ];
  const similar = wanted ? entries.filter((entry) => nameKey(entry.name).includes(wanted) || wanted.includes(nameKey(entry.name))) : [];
  return (similar.length ? similar : entries).slice(0, 20);
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

async function resolveReadableFile(ctx: any, rootPrefix: string, requestedPath: string) {
  const exact = await getObject(ctx, `${rootPrefix}${requestedPath}`);
  if (exact.status !== 404) return { path: requestedPath, metadataResponse: exact };

  // 대화에서는 사용자가 확장자나 상위 폴더를 생략하는 경우가 많다. 에이전트 읽기에 한해
  // 사용자 작업공간 전체에서 파일명/확장자 생략을 안전하게 보정하고, 동명이면 임의 선택하지 않는다.
  const listed = await listObjects(ctx, rootPrefix);
  const wanted = requestedPath.normalize("NFC").toLocaleLowerCase("ko-KR");
  const wantedBase = baseName(wanted);
  const wantedStem = pathWithoutExtension(wanted);
  const wantedBaseStem = pathWithoutExtension(wantedBase);
  const candidates = listed.items
    .map((item) => String(item.name || ""))
    .filter((name) => name.startsWith(rootPrefix) && baseName(name) !== FOLDER_MARKER)
    .map((name) => name.slice(rootPrefix.length))
    .map((path) => {
      const normalized = path.normalize("NFC").toLocaleLowerCase("ko-KR");
      const normalizedBase = baseName(normalized);
      let score = Number.POSITIVE_INFINITY;
      if (normalized === wanted) score = 0;
      else if (normalizedBase === wantedBase) score = 1;
      else if (pathWithoutExtension(normalized) === wantedStem) score = 2;
      else if (pathWithoutExtension(normalizedBase) === wantedBaseStem) score = 3;
      return { path, score };
    })
    .filter((candidate) => Number.isFinite(candidate.score));
  if (!candidates.length) return { path: requestedPath, metadataResponse: exact };
  const bestScore = Math.min(...candidates.map((candidate) => candidate.score));
  const best = candidates.filter((candidate) => candidate.score === bestScore);
  if (best.length > 1) {
    throw new Error(`'${requestedPath}' 이름의 파일이 여러 개입니다. 전체 경로를 지정해 주세요: ${best.slice(0, 8).map((candidate) => candidate.path).join(", ")}`);
  }
  return { path: best[0].path, metadataResponse: await getObject(ctx, `${rootPrefix}${best[0].path}`) };
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
      const requestedKey = requestedPath.slice(WORK_PATH_PREFIX.length).split("/")[0];
      const sql = getSql(env);
      const folder = /^\d{4}-\d{2}-\d{2}$/.test(requestedKey) ? null : await findWorkFolder(sql, auth.userId, requestedKey);
      const dateKey = folder?.dateKey || requestedKey;
      const entries = await listVirtualWorkItems(sql, auth.userId, dateKey);
      return send({
        path: `${WORK_PATH_PREFIX}${dateKey}`, parentPath: "", entries, unified: true,
        ...(folder ? { requestedPath, displayName: folder.name } : {}),
      }, 200, origin);
    }

    if (wantsDownload || wantsPreview || wantsRead) {
      let filePath = normalizePath(path, false);
      const resolved = wantsRead
        ? await resolveReadableFile(ctx, rootPrefix, filePath)
        : { path: filePath, metadataResponse: await getObject(ctx, `${rootPrefix}${filePath}`) };
      filePath = resolved.path;
      const objectName = `${rootPrefix}${filePath}`;
      const metadataResponse = resolved.metadataResponse;
      if (metadataResponse.status === 404) {
        const sql = getSql(env);
        const folder = await findWorkFolder(sql, auth.userId, filePath.startsWith(WORK_PATH_PREFIX) ? filePath : filePath.split("/")[0]).catch(() => null);
        if (folder) {
          return send({
            error: `'${filePath}'는 업무 날짜 폴더 '${folder.name}'(내부 경로 ${folder.path})에 속한 항목이라 파일로 읽을 수 없습니다. company_files_list 로 ${folder.path} 목록을 조회하세요.`,
            workFolder: { displayName: folder.name, path: folder.path },
          }, 404, origin);
        }
        const candidates = await pathCandidates(ctx, sql, auth.userId, rootPrefix, filePath).catch(() => []);
        return send({
          error: `'${filePath}' 파일을 찾지 못했습니다.${candidates.length ? ` 후보 경로: ${candidates.map((entry: any) => `${entry.name}(${entry.path})`).join(", ")}` : ""}`,
          candidates,
        }, 404, origin);
      }
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
    if (path && !listed.items.length && !listed.prefixes.length) {
      // 저장소에 없는 경로 — 날짜 폴더의 표시명(예: 이름을 바꾼 "log")이면 그 폴더를 연다.
      const sql = getSql(env);
      // 파일은 다 비웠어도 날짜 폴더를 넣어 둔 폴더라면 그 날짜 폴더들을 보여준다.
      const nestedWorkFolders = await listVirtualWorkFolders(sql, auth.userId, path).catch(() => []);
      if (nestedWorkFolders.length) return send({ path, parentPath: parentPath(path), entries: nestedWorkFolders, unified: true }, 200, origin);
      const folder = await findWorkFolder(sql, auth.userId, path);
      if (folder) {
        const entries = await listVirtualWorkItems(sql, auth.userId, folder.dateKey);
        return send({ path: folder.path, parentPath: "", entries, unified: true, requestedPath: path, displayName: folder.name }, 200, origin);
      }
      // 빈 목록으로 조용히 끝내지 않고 원인과 후보 경로를 함께 돌려준다(탐색기 화면은 그대로 빈 폴더로 보인다).
      const candidates = await pathCandidates(ctx, sql, auth.userId, rootPrefix, path).catch(() => []);
      return send({
        path, parentPath: parentPath(path), entries: [], unified: true, notFound: true,
        hint: `'${path}' 폴더를 찾지 못했습니다.${candidates.length ? ` 후보 경로: ${candidates.map((entry: any) => `${entry.name}(${entry.path})`).join(", ")}` : ""}`,
        candidates,
      }, 200, origin);
    }
    const folders = listed.prefixes.map((prefix) => {
      const relative = prefix.slice(rootPrefix.length).replace(/\/$/, "");
      return { kind: "folder", name: baseName(relative), path: relative, parentPath: path };
    }).filter((folder) => folder.path !== WORK_FILES_ROOT);
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
    // 날짜 폴더 파일 저장소 안에는 날짜 폴더를 두지 않는다.
    const workFolders = path === WORK_FILES_ROOT || path.startsWith(`${WORK_FILES_ROOT}/`)
      ? [] : await listVirtualWorkFolders(getSql(env), auth.userId, path);
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
    if (action === "move_work_folder") {
      // 날짜 폴더를 일반 폴더(또는 루트) 안으로 옮긴다. 업무 기록의 날짜·경로(@work/날짜)는 바뀌지 않고 보이는 위치만 바뀐다.
      const dateKey = String(body.dateKey || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return send({ error: "옮길 날짜 폴더를 확인해 주세요." }, 400, origin);
      const parent = normalizePath(body.parentPath, true);
      if (parent) {
        assertMutablePath(parent);
        if (parent === WORK_FILES_ROOT || parent.startsWith(`${WORK_FILES_ROOT}/`)) return send({ error: "날짜 폴더는 다른 날짜 폴더 안에 넣을 수 없습니다." }, 400, origin);
        const target = await resolveObjects(ctx, rootPrefix, parent);
        if (target?.kind !== "folder") return send({ error: `'${parent}' 폴더를 찾지 못했습니다.` }, 404, origin);
      }
      const sql = getSql(env);
      if (!sql) return send({ error: "DATABASE_URL 미설정" }, 503, origin);
      await ensureAgentSchema(sql);
      const exists = await sql(
        "SELECT 1 FROM company_work_items WHERE user_id = $1 AND (created_at AT TIME ZONE 'Asia/Seoul')::date = $2::date LIMIT 1",
        [auth.userId, dateKey],
      );
      if (!exists.length) return send({ error: "이 날짜의 업무 폴더를 찾지 못했습니다." }, 404, origin);
      await sql(
        `INSERT INTO company_work_folders (user_id, date_key, title, parent_path) VALUES ($1, $2, $2, $3)
         ON CONFLICT (user_id, date_key) DO UPDATE SET parent_path = EXCLUDED.parent_path, updated_at = now()`,
        [auth.userId, dateKey, parent],
      );
      return send({ ok: true, action, dateKey, parentPath: parent }, 200, origin);
    }
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
      if (action === "move" && resolved.kind === "folder") await relocateWorkFolders(env, auth.userId, source, destination);
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
    const missing: string[] = [];
    for (const path of paths) {
      const resolved = await resolveObjects(ctx, rootPrefix, path);
      if (resolved) for (const objectName of resolved.objects) names.add(objectName);
      else missing.push(path);
    }
    if (!names.size) return send({ error: `삭제할 파일 또는 폴더를 찾지 못했습니다: ${missing.join(", ")}`, missing }, 404, origin);
    if (names.size > MAX_OPERATION_OBJECTS) return send({ error: `한 번에 삭제할 수 있는 파일은 ${MAX_OPERATION_OBJECTS}개까지입니다.` }, 400, origin);
    for (const objectName of names) await deleteObject(ctx, objectName);
    await releaseWorkFolders(env, auth.userId, paths.filter((path: string) => !missing.includes(path))).catch(() => {});
    return send({ ok: true, deletedCount: names.size, paths, missing }, 200, origin);
  } catch (error: any) {
    return send({ error: String(error?.message || error || "회사 파일 삭제에 실패했습니다.") }, 500, origin);
  }
};
