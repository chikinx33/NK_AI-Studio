// 에이전트가 완성 콘텐츠를 등록할 때 쓰는 저장소 부품(2026-10-18).
//  - copyGcsObject: 대화 첨부·업무 폴더 파일을 프로젝트 저장소로 '복사'(바이트가 Worker 를 거치지 않는 rewrite).
//    원본을 지워도 프로젝트가 깨지지 않고, 완성 콘텐츠 등록(final-upload)이 받는 본인 저장소 경로가 된다.
//  - readMp4Meta: 영상 길이·비율을 파일 머리(moov)만 범위 요청으로 읽어 알아낸다. 화면('+' 창)은 브라우저가 읽지만
//    에이전트는 브라우저가 없다. 길이를 모르면 등록이 1초짜리 컷이 된다.
import { getGoogleAccessToken, resolveGcsEnv } from "./gcs.js";

async function gcsAuth(env: any) {
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({
    clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, scope: "https://www.googleapis.com/auth/cloud-platform",
  });
  return { ctx, token };
}

/** 같은 버킷 안 복사(rewrite). 큰 파일은 여러 번 이어서 진행한다. */
export async function copyGcsObject(env: any, source: string, destination: string): Promise<void> {
  const { ctx, token } = await gcsAuth(env);
  let rewriteToken = "";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const params = new URLSearchParams();
    if (rewriteToken) params.set("rewriteToken", rewriteToken);
    const query = params.size ? `?${params}` : "";
    const res = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(source)}/rewriteTo/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(destination)}${query}`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, ...(ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) } },
    );
    const payload: any = await res.json().catch(() => ({}));
    if (res.status === 404) throw new Error("media_source_not_found");
    if (!res.ok) throw new Error(`media_copy_failed: ${String(payload?.error?.message || res.status).slice(0, 200)}`);
    if (payload.done === true) return;
    rewriteToken = String(payload.rewriteToken || "");
    if (!rewriteToken) throw new Error("media_copy_failed: no_rewrite_token");
  }
  throw new Error("media_copy_failed: too_many_steps");
}

/** 객체 크기·형식(메타데이터만). 없으면 null. */
export async function statGcsObject(env: any, objectName: string): Promise<{ size: number; contentType: string } | null> {
  const { ctx, token } = await gcsAuth(env);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}`,
    { headers: { Authorization: `Bearer ${token}`, ...(ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}) } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`media_stat_failed ${res.status}`);
  const data: any = await res.json().catch(() => ({}));
  return { size: Number(data?.size) || 0, contentType: String(data?.contentType || "") };
}

// ─── MP4 머리 읽기(순수 파서 + 범위 요청) ───────────────────────────
type Reader = (start: number, length: number) => Promise<Uint8Array>;

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const i32 = (b: Uint8Array, o: number) => { const v = u32(b, o); return v > 0x7fffffff ? v - 0x100000000 : v; };
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);
const type4 = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

/** 상자 목록(이 범위 안). [type, 본문 시작, 본문 끝] */
function boxes(b: Uint8Array, start: number, end: number): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const type = type4(b, o + 4);
    let header = 8;
    if (size === 1 && o + 16 <= end) { size = u64(b, o + 8); header = 16; }
    if (size === 0) size = end - o;
    if (size < header || o + size > end) break;
    out.push([type, o + header, o + size]);
    o += size;
  }
  return out;
}

const KNOWN_RATIOS: Array<[string, number]> = [["9:16", 9 / 16], ["16:9", 16 / 9], ["1:1", 1], ["4:5", 4 / 5], ["3:4", 3 / 4], ["4:3", 4 / 3]];
export function aspectFromSize(width: number, height: number): string {
  if (!width || !height) return "";
  const r = width / height;
  const best = KNOWN_RATIOS.reduce((a, c) => (Math.abs(c[1] - r) < Math.abs(a[1] - r) ? c : a));
  return Math.abs(best[1] - r) < 0.03 ? best[0] : "";
}

/** moov 본문 → 길이·화면 크기(세로 촬영 회전 반영). */
export function parseMoov(b: Uint8Array, start: number, end: number): { durationSec: number; width: number; height: number } {
  let durationSec = 0;
  let width = 0;
  let height = 0;
  for (const [type, s, e] of boxes(b, start, end)) {
    if (type === "mvhd") {
      const v = b[s];
      const timescale = v === 1 ? u32(b, s + 20) : u32(b, s + 12);
      const duration = v === 1 ? u64(b, s + 24) : u32(b, s + 16);
      if (timescale) durationSec = duration / timescale;
    } else if (type === "trak" && !width) {
      const tkhd = boxes(b, s, e).find(([t]) => t === "tkhd");
      if (!tkhd) continue;
      const ts = tkhd[1];
      const v = b[ts];
      const after = ts + 4 + (v === 1 ? 32 : 20) + 8 + 8; // 버전·플래그 + 시각·트랙ID·예약·길이 + 예약(8) + 층·그룹·음량·예약(8)
      const matrix = after;
      const w = u32(b, matrix + 36) / 65536;
      const h = u32(b, matrix + 40) / 65536;
      if (w > 0 && h > 0) {
        // 회전 행렬(a,b,c,d) — 휴대폰 세로 영상은 가로로 저장하고 90° 회전 표시를 단다.
        const a = i32(b, matrix);
        const d = i32(b, matrix + 16);
        const rotated = a === 0 && d === 0;
        width = Math.round(rotated ? h : w);
        height = Math.round(rotated ? w : h);
      }
    }
  }
  return { durationSec: Math.round(durationSec * 10) / 10, width, height };
}

/** 범위 읽기로 moov 를 찾아 읽는다. 보통 2~3번 요청(앞 64KB · 끝의 moov). */
export async function readMp4MetaWith(read: Reader, totalSize: number): Promise<{ durationSec: number; width: number; height: number; aspectRatio: string } | null> {
  const HEAD = 64 * 1024;
  const MAX_MOOV = 8 * 1024 * 1024;
  let offset = 0;
  for (let hop = 0; hop < 8 && offset < totalSize; hop += 1) {
    const head = await read(offset, Math.min(HEAD, totalSize - offset));
    if (head.length < 8) return null;
    let size = u32(head, 0);
    const type = type4(head, 4);
    let header = 8;
    if (size === 1) { size = u64(head, 8); header = 16; }
    if (size === 0) size = totalSize - offset;
    if (size < header) return null;
    if (type === "moov") {
      if (size > MAX_MOOV) return null;
      const body = size <= head.length ? head : await read(offset, size);
      const meta = parseMoov(body, header, size);
      return { ...meta, aspectRatio: aspectFromSize(meta.width, meta.height) };
    }
    offset += size;
  }
  return null;
}

export async function readMp4Meta(env: any, objectName: string) {
  const stat = await statGcsObject(env, objectName);
  if (!stat || !stat.size) return null;
  const { ctx, token } = await gcsAuth(env);
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const read: Reader = async (start, length) => {
    const res = await fetch(url, { headers: {
      Authorization: `Bearer ${token}`, Range: `bytes=${start}-${start + length - 1}`,
      ...(ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
    } });
    if (!res.ok && res.status !== 206) throw new Error(`media_range_failed ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  return readMp4MetaWith(read, stat.size);
}
