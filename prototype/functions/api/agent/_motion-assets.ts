// 인포그래픽 영상(모션 키트) 자산 입력.
// 작업을 만들 때 고른 브랜드·업무 파일·배경음악을 정규화해 작업 입력에 싣고,
// 렌더 직전에 "무엇을 어디서 받을지" 목록(manifest)을 만든다.
// 파일 자체는 브라우저가 이 목록의 사이트 경로(미디어 프록시·업무 파일 다운로드)로 받아 이 PC 렌더러로 넘긴다.
// 그래서 렌더러에는 로그인 정보나 클라우드 키가 필요 없다.
import { buildAiVideoBrandPrefix } from "../_shared/storage";
import { getGoogleAccessToken, parseGcsUri } from "../_shared/gcs.js";
import type { SqlFn } from "../knowledge/_shared";

export interface MotionAssetSelection {
  brandId: string | null;
  files: string[];
  bgm: { source: "sound" | "file"; value: string } | null;
  // 배경음악 없이 진행하겠다고 사용자가 확인했다(음악을 새로 생성하면 비용이 들어 기본 제공하지 않는다)
  noMusic: boolean;
}

export type MotionAssetRole = "logo" | "character" | "environment" | "image" | "video" | "audio" | "bgm";

export interface MotionAssetItem {
  id: string;
  role: MotionAssetRole;
  name: string;
  fileName: string;
  url: string;
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;

const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

function cleanFilePath(value: unknown): string {
  const path = clean(value, 500).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => part === ".." || part === ".")) return "";
  return path;
}

export function normalizeMotionAssetSelection(raw: unknown): MotionAssetSelection {
  const input = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const brandId = clean(input.brandId, 120);
  const files = Array.isArray(input.files)
    ? [...new Set(input.files.map(cleanFilePath).filter(Boolean))].slice(0, 20)
    : [];
  const bgmSource = input.bgm?.source === "sound" || input.bgm?.source === "file" ? input.bgm.source : null;
  const bgmValue = bgmSource === "file" ? cleanFilePath(input.bgm?.value) : clean(input.bgm?.value, 120);
  const bgm = bgmSource && bgmValue ? { source: bgmSource, value: bgmValue } as MotionAssetSelection["bgm"] : null;
  return {
    brandId: /^[a-zA-Z0-9._-]+$/.test(brandId) ? brandId : null,
    files,
    bgm,
    noMusic: !bgm && input.noMusic === true,
  };
}

export function companyFileDownloadUrl(path: string): string {
  return `/api/agent/company-files?path=${encodeURIComponent(path)}&download=1`;
}

export function mediaProxyUrl(objectName: string): string {
  return `/api/media/proxy?objectName=${encodeURIComponent(objectName)}`;
}

// gs://버킷/객체 → 객체 이름
export function objectNameFromGs(value: unknown): string {
  const match = String(value || "").match(/^gs:\/\/[^/]+\/(.+)$/);
  return match ? match[1] : "";
}

// 사운드 라이브러리 output_url 은 만료된 서명 URL(https://storage.googleapis.com/버킷/객체?X-Goog-…)이라 객체 이름만 꺼내 프록시로 다시 받는다.
export function objectNameFromSignedUrl(value: unknown): string {
  if (/^gs:\/\//i.test(String(value || ""))) return objectNameFromGs(value);
  try {
    const url = new URL(String(value || ""));
    if (url.hostname !== "storage.googleapis.com") return "";
    const parts = url.pathname.replace(/^\/+/, "").split("/");
    return parts.length > 1 ? decodeURIComponent(parts.slice(1).join("/")) : "";
  } catch (_) {
    return objectNameFromGs(value);
  }
}

function roleForFile(name: string): MotionAssetRole | null {
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  if (AUDIO_EXT.test(name)) return "audio";
  return null;
}

function extensionOf(name: string, fallback: string): string {
  const match = name.match(/\.[a-z0-9]{2,5}$/i);
  return match ? match[0].toLowerCase() : fallback;
}

const slug = (value: string) => value.replace(/[^a-zA-Z0-9가-힣._-]+/g, "_").slice(0, 60) || "asset";

async function readBrand(env: any, userId: string, brandId: string): Promise<any | null> {
  const parsed = parseGcsUri(String(env.VIDEO_OUTPUT_GCS_URI || ""));
  if (!parsed || !env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return null;
  const objectName = `${buildAiVideoBrandPrefix(parsed.object.replace(/\/$/, ""), userId, brandId)}/reference/data.json`;
  const token = await getGoogleAccessToken({
    clientEmail: env.GOOGLE_CLIENT_EMAIL,
    privateKeyPem: env.GOOGLE_PRIVATE_KEY,
    scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(parsed.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) return null;
  const data: any = await response.json().catch(() => null);
  return data && typeof data.brand === "object" && data.brand ? data.brand : data;
}

function primaryItem(entry: any): any {
  const items = Array.isArray(entry?.items) ? entry.items : [];
  return items.find((item: any) => item?.isPrimary) || items[0] || null;
}

// 브랜드 자료에서 영상에 쓸 그림만 꺼낸다(로고, 캐릭터 대표 시트, 배경·소품)
export function brandAssetItems(brand: any): MotionAssetItem[] {
  if (!brand || typeof brand !== "object") return [];
  const items: MotionAssetItem[] = [];
  const logo = clean(brand.brandLogoObjectName, 600).replace(/^gs:\/\/[^/]+\//, "");
  if (logo) items.push({ id: "logo", role: "logo", name: clean(brand.brandTitle || brand.title, 80) || "logo", fileName: `logo${extensionOf(logo, ".png")}`, url: mediaProxyUrl(logo) });
  const sections: Array<[MotionAssetRole, any[]]> = [
    ["character", Array.isArray(brand.characterSheets) ? brand.characterSheets : []],
    ["environment", Array.isArray(brand.environmentAssets) ? brand.environmentAssets : []],
  ];
  for (const [role, entries] of sections) {
    entries.slice(0, 12).forEach((entry, index) => {
      const objectName = objectNameFromGs(primaryItem(entry)?.imageDataUrl);
      if (!objectName) return;
      const name = clean(entry?.displayName || entry?.token, 80) || `${role}-${index + 1}`;
      items.push({ id: `${role}-${index + 1}`, role, name, fileName: `${role}-${index + 1}-${slug(name)}${extensionOf(objectName, ".png")}`, url: mediaProxyUrl(objectName) });
    });
  }
  return items;
}

export function fileAssetItems(files: string[]): MotionAssetItem[] {
  return files.flatMap((path, index) => {
    const base = path.split("/").pop() || path;
    const role = roleForFile(base);
    if (!role) return [];
    return [{ id: `file-${index + 1}`, role, name: base, fileName: `file-${index + 1}-${slug(base.replace(/\.[^.]+$/, ""))}${extensionOf(base, "")}`, url: companyFileDownloadUrl(path) }];
  });
}

export async function buildMotionAssetManifest(args: {
  env: any;
  sql: SqlFn | null;
  userId: string;
  selection: MotionAssetSelection;
}): Promise<{ brand: { id: string; title: string } | null; items: MotionAssetItem[]; noMusic: boolean; warnings: string[] }> {
  const { env, sql, userId, selection } = args;
  const warnings: string[] = [];
  const items: MotionAssetItem[] = [];
  let brandInfo: { id: string; title: string } | null = null;
  if (selection.brandId) {
    const brand = await readBrand(env, userId, selection.brandId).catch(() => null);
    if (brand) {
      brandInfo = { id: selection.brandId, title: clean(brand.brandTitle || brand.title, 80) };
      items.push(...brandAssetItems(brand));
    } else {
      warnings.push(`브랜드(${selection.brandId}) 자료를 읽지 못했습니다.`);
    }
  }
  items.push(...fileAssetItems(selection.files));
  if (selection.bgm?.source === "file") {
    const base = selection.bgm.value.split("/").pop() || "bgm";
    if (AUDIO_EXT.test(base)) items.push({ id: "bgm", role: "bgm", name: base, fileName: `bgm${extensionOf(base, ".mp3")}`, url: companyFileDownloadUrl(selection.bgm.value) });
    else warnings.push("배경음악으로 고른 파일이 음악 파일이 아닙니다.");
  } else if (selection.bgm?.source === "sound") {
    const rows = sql
      ? await sql("SELECT title, output_url FROM sound_assets WHERE id::text = $1 AND owner_id = $2 AND type = 'music' LIMIT 1", [selection.bgm.value, userId]).catch(() => [])
      : [];
    const objectName = objectNameFromSignedUrl(rows[0]?.output_url);
    if (objectName) items.push({ id: "bgm", role: "bgm", name: clean(rows[0]?.title, 80) || "bgm", fileName: `bgm${extensionOf(objectName, ".mp3")}`, url: mediaProxyUrl(objectName) });
    else warnings.push("사운드 라이브러리에서 고른 배경음악을 찾지 못했습니다.");
  }
  return { brand: brandInfo, items, noMusic: selection.noMusic, warnings };
}
