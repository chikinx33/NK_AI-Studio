// prototype/functions/api/_shared/reference-image.ts
// 참조 이미지(data: URL · gs:// · storage.googleapis.com · /api/media/proxy · 공개 URL)를 바이트로 읽는다.
// imagen.ts · imagen-describe.ts · ip/analyze.ts 가 같은 함수를 복사해 쓰던 것을 한곳으로 모았다.
//
// GCS 참조는 서비스 계정 토큰으로 읽으므로, 읽기 전에 authorizeGcsRead 로 요청자 본인 루트이거나
// 공유받은 프로젝트의 소유자 프로젝트 폴더인지 확인한다. 예전에는 소유자 검사 없이 토큰을 붙여서
// 로그인한 누구나 남의 gs:// 경로를 참조로 넣어 그 이미지를 읽을 수 있었고, URL 에
// "storage.googleapis.com" 글자만 들어 있으면 다른 호스트에도 토큰을 보냈다.
import { authorizeGcsRead, type MediaAccessMemo } from "./media-access";

export type ReferenceImageBytes = { base64: string; mimeType: string };

export type ReferenceImageContext = {
  env: any;
  /** 로그인한 요청자 id — GCS 참조의 소유자 검사 기준 */
  requesterId: string;
  /** 서비스 계정 GCS 접근 토큰. 없으면 GCS 참조는 읽지 않는다. */
  accessToken: string;
  requestUrl: string;
  /** 같은 출처 /api/media/proxy 로 넘길 요청자 Authorization 헤더 */
  authHeader: string;
  /** 원격 fetch 시간 제한(ms). 없으면 제한하지 않는다. */
  timeoutMs?: number;
  /** 같은 요청의 참조 여러 장이 공유 레지스트리·프로젝트 브랜드를 한 번만 읽도록 공유한다(없으면 자동 생성). */
  accessMemo?: MediaAccessMemo;
};

export function parseImageDataUrl(dataUrl: string): ReferenceImageBytes | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mimeType = String(match[1] || "image/png").trim() || "image/png";
  const base64 = String(match[2] || "").trim();
  if (!base64) return null;
  return { base64, mimeType };
}

export function arrayBufferToBase64(buf: ArrayBuffer) {
  // Cloudflare Workers V8 isolate 에서 큰 버퍼를 1바이트씩 연결하면
  // O(n²) 문자열 연결이 되어 CPU 한도(에러 1102)를 넘기기 쉽다.
  // 32KB 청크 단위로 String.fromCharCode.apply 를 호출해 선형 시간으로 인코딩.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(bin);
}

/** 참조 이미지를 읽는다. 읽을 수 없거나 접근이 허용되지 않은 참조는 null. */
export async function resolveReferenceImageBytes(ref: string, ctx: ReferenceImageContext): Promise<ReferenceImageBytes | null> {
  const parsed = parseImageDataUrl(ref);
  if (parsed) return parsed;
  try {
    let resolvedUrl = String(ref || "").trim();
    if (!resolvedUrl) return null;
    const headers: Record<string, string> = {};
    const gcs = await authorizeGcsRead(ctx.env, ctx.requesterId, resolvedUrl, ctx.accessMemo || (ctx.accessMemo = {}));
    if (gcs) {
      if (!gcs.ok || !ctx.accessToken) return null;
      resolvedUrl = gcs.fetchUrl;
      headers.Authorization = `Bearer ${ctx.accessToken}`;
    } else {
      if (/^\/(?!\/)/.test(resolvedUrl)) {
        resolvedUrl = new URL(resolvedUrl, ctx.requestUrl).toString();
      }
      try {
        const targetUrl = new URL(resolvedUrl);
        if (ctx.authHeader && targetUrl.origin === new URL(ctx.requestUrl).origin && targetUrl.pathname === "/api/media/proxy") {
          headers.Authorization = ctx.authHeader;
        }
      } catch (_) {}
    }
    const res = await withTimeout(fetch(resolvedUrl, { headers }), ctx.timeoutMs);
    if (!res.ok) {
      throw new Error(`reference_image_fetch_failed (${res.status})`);
    }
    const buf = await res.arrayBuffer();
    return {
      base64: arrayBufferToBase64(buf),
      mimeType: res.headers.get("content-type") || "image/png",
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`reference_image_fetch timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}
