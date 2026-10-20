// prototype/functions/api/_shared/publishing-packages.ts
//
// 퍼블리싱 패키지 가져오기(업무 파일 폴더 → 글·일정)와 결과 되돌려 쓰기(result.json).
// 규격·판단은 publishing-packages-core.js, 글 저장은 publishing-store.ts applyItemSaves(승인된 글이 바뀌면 다시 초안) 그대로.
//
// Worker 서브요청 한도(요청 하나에 50번): 저장소 목록 1번 + DB 몇 번은 고정이고, 패키지마다 post.md 등 글 파일 읽기와
// 이미지 한 장당 읽기+복사 2번이 든다. 지문(파일 md5)이 같은 패키지는 아무것도 읽지 않고, 같은 이미지는 다시 복사하지 않는다.
// 한 번에 다 못 하면 남은 폴더를 pending 으로 돌려주고(more:true) 호출한 쪽이 같은 요청을 이어서 보낸다.
import { accessContext, copyObject, getObject, listObjects, uploadObject, workspacePrefix } from "./company-files-gcs";
import {
  applyItemSaves, bytesSha256, publicChannel, publishingImageObjectName, sanitizeExtras, PublishingError, type ItemInput, type PublishingDb,
} from "./publishing-store";
import { imageInfo, normalizeTagList, normalizeTitle, pickImportChannel, sha256Hex, TITLE_MAX } from "./publishing-core.js";
import {
  PACKAGE_IMAGE_MAX_BYTES, PACKAGE_IMAGES_MAX, PACKAGE_POST_FILE, PACKAGE_RESULT_FILE, PACKAGE_TEXT_MAX_BYTES, PACKAGE_VIDEOS_MAX, PACKAGE_VIDEO_MAX_BYTES,
  classifyPackageFiles, displayPackagePath, findPackages, missingImageMarkers, normalizePackagePath, packageExternalId,
  packageFingerprintSource, parsePackagePost, videoContentType,
} from "./publishing-packages-core.js";

/** 패키지 파일 읽기·이미지 복사에 쓸 저장소 요청 수(인증·DB·목록 몫을 뺀 나머지). */
export const PACKAGE_REQUEST_BUDGET = 30;

const json = (v: any, fallback: any) => {
  if (v == null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};

type PackageReport = {
  // 미리보기(dryRun): new | update | unchanged, 가져오기: created | updated | unchanged | partial(이미지를 다 못 옮겨 이어서 할 것)
  path: string; status: "created" | "updated" | "unchanged" | "partial" | "new" | "update"; id?: string; externalId: string;
  title?: string; channel?: string; channelName?: string; scheduledAt?: string; images?: number; videos?: number;
  hasTranslation?: boolean; hasNotes?: boolean; hasFirstComment?: boolean; warnings: string[];
};

async function readText(ctx: any, objectName: string) {
  const res = await getObject(ctx, objectName, true);
  if (!res.ok) throw new PublishingError("package_read_failed", 500, `HTTP ${res.status}`);
  return (await res.text()).replace(/^﻿/, "");
}

/**
 * 업무 파일 폴더 하나를 가져온다. 그 폴더와 하위 폴더(3단계까지)에서 post.md 가 있는 폴더 = 글 하나.
 * input: { path, dryRun?, only?: 폴더 경로[] (미리보기에서 고른 것·이어서 할 것) }
 * 반환: { imported, unchanged, items: PackageReport[], errors: [{path, error}], pending: 폴더[], more, truncated }
 */
export async function importPackages(db: PublishingDb, env: any, userId: string, input: any) {
  const normalized = normalizePackagePath(input?.path);
  if (!normalized.ok) throw new PublishingError(normalized.error);
  const base = normalized.path;
  const dryRun = input?.dryRun === true;
  const ctx = await accessContext(env);
  const root = workspacePrefix(ctx.basePrefix, userId);
  let listed;
  try {
    listed = await listObjects(ctx, `${root}${base ? `${base}/` : ""}`);
  } catch (e: any) {
    throw new PublishingError("package_list_failed", 422, String(e?.message || e).slice(0, 200));
  }
  const entries = listed.items.map((it: any) => ({
    path: String(it.name || "").slice(root.length), size: Number(it.size || 0), md5: String(it.md5Hash || ""), contentType: String(it.contentType || ""),
  }));
  const found = findPackages(entries, base);
  const only = Array.isArray(input?.only) ? new Set(input.only.map((p: any) => normalizePackagePath(p)).filter((p: any) => p.ok).map((p: any) => p.path)) : null;
  const packages = found.packages.filter((p) => !only || only.has(p.folder));
  if (!packages.length) {
    return { imported: 0, unchanged: 0, items: [], errors: [], pending: [], more: false, truncated: found.truncated, scanned: base ? displayPackagePath(base) : "" };
  }

  const fingerprints = new Map<string, string>();
  for (const p of packages) fingerprints.set(p.folder, await sha256Hex(packageFingerprintSource(p.files)));
  const displayPaths = packages.map((p) => displayPackagePath(p.folder));
  const defaultIds = packages.map((p) => packageExternalId("", p.folder, fingerprints.get(p.folder)));
  const [channelRows, existingRows] = await db.batch([
    { query: `SELECT * FROM publishing_channels WHERE user_id=$1 AND deleted_at IS NULL AND enabled ORDER BY created_at`, params: [userId] },
    {
      query: `SELECT id, external_id, images, extras, approved_at, deleted_at FROM publishing_items
        WHERE user_id=$1 AND (extras->>'packagePath' = ANY($2::text[]) OR (external_id <> '' AND external_id = ANY($3::text[])))`,
      params: [userId, displayPaths, defaultIds],
    },
  ]);
  const channels = channelRows.map(publicChannel);
  const byPath = new Map<string, any>();
  for (const r of existingRows) {
    const path = String(json(r.extras, {})?.packagePath || "");
    if (path && (!byPath.has(path) || !r.deleted_at)) byPath.set(path, r);
  }
  const byExternal = new Map(existingRows.map((r: any) => [String(r.external_id), r]));

  let budget = PACKAGE_REQUEST_BUDGET;
  const reports: PackageReport[] = [];
  const errors: Array<{ path: string; error: string; message?: string }> = [];
  const pending: string[] = [];
  const saves: Array<{ input: ItemInput; report: PackageReport; created: boolean }> = [];
  const seenIds = new Map<string, string>();

  for (const pkg of packages) {
    const display = displayPackagePath(pkg.folder);
    const files = classifyPackageFiles(pkg.files);
    const fingerprint = fingerprints.get(pkg.folder) || "";
    const prev = byPath.get(display) || byExternal.get(packageExternalId("", pkg.folder, fingerprint)) || null;
    const prevExtras = sanitizeExtras(json(prev?.extras, {}));
    if (!dryRun && prev && !prev.deleted_at && prevExtras.packageHash === fingerprint) {
      reports.push({ path: display, status: "unchanged", id: String(prev.id), externalId: String(prev.external_id || ""), warnings: [] });
      continue;
    }
    const textCount = Object.keys(files.texts).length;
    if (budget < 1 + (dryRun ? 0 : textCount)) { pending.push(display); continue; }
    if (!files.post || files.post.size > PACKAGE_TEXT_MAX_BYTES) { errors.push({ path: display, error: "post_too_large" }); continue; }
    budget -= 1;
    let parsed;
    try {
      parsed = parsePackagePost(await readText(ctx, `${root}${files.post.path}`));
    } catch (e: any) {
      errors.push({ path: display, error: e?.code || "package_read_failed" });
      continue;
    }
    if (!parsed.ok) { errors.push({ path: display, error: parsed.error }); continue; }
    const post = parsed.post;
    const warnings = [...parsed.warnings];
    const externalId = packageExternalId(post.id, pkg.folder, fingerprint);
    if (seenIds.has(externalId)) { errors.push({ path: display, error: "duplicate_package_id", message: seenIds.get(externalId) }); continue; }
    seenIds.set(externalId, display);
    if (post.title.length > TITLE_MAX) warnings.push("title_truncated");

    // 채널: 머리말 channel 이 채널 id(ch_…)면 그 채널, 아니면 종류. target 을 주면 그 값이 맞는 채널만.
    const isId = /^ch_/.test(post.channel);
    const channel = post.channel ? pickImportChannel(channels, { channelId: isId ? post.channel : "", channelType: isId ? "" : post.channel, brandId: post.brand, target: post.target }) : null;
    if (post.channel && !channel) warnings.push(post.target ? "channel_target_not_found" : "channel_not_found");

    const images = files.images.slice(0, PACKAGE_IMAGES_MAX);
    if (files.images.length > PACKAGE_IMAGES_MAX) warnings.push("too_many_images");
    const videos = files.videos.slice(0, PACKAGE_VIDEOS_MAX).filter((v) => {
      if (v.size > PACKAGE_VIDEO_MAX_BYTES) { warnings.push(`video_too_large:${v.name}`); return false; }
      return true;
    });
    if (files.videos.length > PACKAGE_VIDEOS_MAX) warnings.push("too_many_videos");
    for (const n of missingImageMarkers(post.body, images.length)) warnings.push(`image_marker_missing:${n}`);

    const live = !!prev && !prev.deleted_at;
    const report: PackageReport = {
      path: display, status: dryRun ? (live ? (prevExtras.packageHash === fingerprint ? "unchanged" : "update") : "new") : live ? "updated" : "created", externalId,
      title: normalizeTitle(post.title), channel: post.channel + (post.target ? ` · ${post.target}` : ""), channelName: channel?.name || "",
      scheduledAt: post.scheduledAt, images: images.length, videos: videos.length,
      hasTranslation: !!files.texts.translation, hasNotes: !!files.texts.notes, hasFirstComment: !!files.texts.firstComment, warnings,
    };
    if (dryRun) { reports.push(report); continue; }

    // 번역·메모·첫 댓글
    const texts: Record<string, string> = {};
    for (const [key, f] of Object.entries(files.texts) as Array<[string, any]>) {
      if (f.size > PACKAGE_TEXT_MAX_BYTES) { warnings.push(`text_too_large:${f.name}`); continue; }
      budget -= 1;
      try { texts[key] = (await readText(ctx, `${root}${f.path}`)).trim(); } catch { warnings.push(`text_read_failed:${f.name}`); }
    }

    // 이미지: 같은 파일(경로·md5)을 이미 복사해 뒀으면 그대로, 아니면 서버 안에서 퍼블리싱 이미지 공간으로 복사한다.
    const prevImages = json(prev?.images, []) as any[];
    let complete = true;
    const itemImages: any[] = [];
    for (const f of images) {
      const sourcePath = displayPackagePath(f.path);
      const reuse = prevImages.find((img) => img?.objectName && img.sourcePath === sourcePath && img.sourceMd5 && img.sourceMd5 === f.md5);
      if (reuse) { itemImages.push(reuse); continue; }
      const placeholder = { fileName: f.name, sourcePath };
      if (f.size > PACKAGE_IMAGE_MAX_BYTES) { warnings.push(`image_too_large:${f.name}`); itemImages.push(placeholder); continue; }
      if (budget < 2) { complete = false; itemImages.push(placeholder); continue; }
      budget -= 2;
      try {
        const res = await getObject(ctx, `${root}${f.path}`, true);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const info = imageInfo(bytes);
        if (!info) { warnings.push(`image_type_invalid:${f.name}`); itemImages.push(placeholder); budget += 1; continue; }
        const objectName = publishingImageObjectName(env, userId, f.name, info.contentType);
        await copyObject(ctx, `${root}${f.path}`, objectName);
        itemImages.push({ objectName, sha256: await bytesSha256(bytes), width: info.width, height: info.height, contentType: info.contentType, fileName: f.name, sourcePath, sourceMd5: f.md5 });
      } catch {
        warnings.push(`image_copy_failed:${f.name}`);
        itemImages.push(placeholder);
        complete = false;
      }
    }
    if (!complete) { report.status = "partial"; pending.push(display); }

    // 머리말 id 를 바꿨어도 같은 폴더면 같은 글을 고친다(새 글을 하나 더 만들지 않게).
    const sameItemId = live && String(prev.external_id) !== externalId && !byExternal.has(externalId) ? String(prev.id) : undefined;
    // 채널을 못 찾은 패키지도 지문을 남기지 않는다 — 채널을 만든 뒤 다시 가져오면 일정이 붙게.
    const settled = complete && (!post.channel || !!channel);
    saves.push({
      created: !live,
      report,
      input: {
        id: sameItemId, externalId, brandId: post.brand, title: post.title, body: post.body, tags: normalizeTagList(post.tags), images: itemImages,
        deliveries: channel ? [{ channelId: channel.id, scheduledAt: post.scheduledAt }] : [],
        extras: {
          videos: videos.map((v) => ({ path: displayPackagePath(v.path), name: v.name, size: v.size, contentType: v.contentType && v.contentType !== "application/octet-stream" ? v.contentType : videoContentType(v.name) })),
          translation: texts.translation || "", notes: texts.notes || "", firstComment: texts.firstComment || "",
          packagePath: display, lang: post.lang,
          // 끝까지 못 가져온 패키지는 지문을 남기지 않는다 — 다음 요청이 '같음'으로 건너뛰지 않고 이어서 채운다.
          packageHash: settled ? fingerprint : "",
        },
      },
    });
  }

  if (saves.length) {
    const ids = await applyItemSaves(db, env, userId, saves.map((s) => s.input));
    saves.forEach((s, i) => { s.report.id = ids[i]; reports.push(s.report); });
  }
  return {
    imported: saves.length,
    unchanged: reports.filter((r) => r.status === "unchanged").length,
    items: reports.sort((a, b) => a.path.localeCompare(b.path)),
    errors, pending, more: pending.length > 0, truncated: found.truncated,
    scanned: base ? displayPackagePath(base) : "",
  };
}

/**
 * 게시 결과가 확정되면(posted·done_manual·failed) 그 글이 온 패키지 폴더에 result.json 을 쓴다(다른 도구가 결과를 읽는 용도).
 * 패키지에서 온 글이 아니거나 폴더(post.md)가 없어졌으면 건너뛴다. 실패해도 게시 처리에는 영향을 주지 않는다(부른 쪽이 잡는다).
 */
export async function writePackageResult(env: any, db: PublishingDb, userId: string, deliveryId: string) {
  const rows = await db.sql(`SELECT d.id, d.status, d.posted_url, d.posted_at, d.updated_at, d.error_code, d.error_message, d.channel_id,
      i.id AS item_id, i.external_id, i.extras, c.type AS channel_type, c.name AS channel_name
    FROM publishing_deliveries d JOIN publishing_items i ON i.id = d.item_id LEFT JOIN publishing_channels c ON c.id = d.channel_id
    WHERE d.id=$1 AND d.user_id=$2`, [deliveryId, userId]);
  const r = rows[0];
  if (!r || !["posted", "done_manual", "failed"].includes(String(r.status))) return { written: false, reason: "not_final" };
  const packagePath = String(json(r.extras, {})?.packagePath || "");
  if (!packagePath) return { written: false, reason: "not_package" };
  const folder = normalizePackagePath(packagePath);
  if (!folder.ok || !folder.path) return { written: false, reason: "path_invalid" };
  const ctx = await accessContext(env);
  const root = workspacePrefix(ctx.basePrefix, userId);
  const head = await getObject(ctx, `${root}${folder.path}/${PACKAGE_POST_FILE}`);
  if (!head.ok) return { written: false, reason: "folder_missing" };
  const isoOf = (v: any) => (v ? new Date(v instanceof Date ? v : String(v).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toISOString() : "");
  const result = {
    status: String(r.status), postedUrl: String(r.posted_url || ""), postedAt: isoOf(r.posted_at), deliveryId: String(r.id),
    itemId: String(r.item_id), externalId: String(r.external_id || ""), channelType: String(r.channel_type || ""), channelName: String(r.channel_name || ""),
    ...(String(r.status) === "failed" ? { errorCode: String(r.error_code || ""), errorMessage: String(r.error_message || "") } : {}),
    writtenAt: new Date().toISOString(),
  };
  await uploadObject(ctx, `${root}${folder.path}/${PACKAGE_RESULT_FILE}`, new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`), "application/json; charset=utf-8");
  return { written: true, path: `${packagePath}/${PACKAGE_RESULT_FILE}` };
}
