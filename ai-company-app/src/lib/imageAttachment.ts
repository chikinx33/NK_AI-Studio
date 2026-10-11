/**
 * 채팅 첨부 이미지를 모델이 받는 크기로 줄인다.
 *
 * 붙여 넣은 사진·스크린샷을 원본 그대로 base64 로 보내면 Claude 한도(이미지당 base64 10MB,
 * API 키는 5MB)를 넘어 400 으로 응답 전체가 실패했다(2026-10-11, 영수증 사진 19MB).
 * Claude 는 긴 변 1568px 를 넘으면 어차피 줄여서 보므로, 2048px·4MB 안으로 맞춰도 읽는 내용은 같다.
 * 같은 첨부가 image_edit·video 도구 입력(attachment:N)으로도 쓰여서 너무 작게 줄이지는 않는다.
 */

const MAX_EDGE = 2048;
const MAX_BASE64 = 4 * 1024 * 1024;
const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

export interface FittedImage { base64: string; mimeType: string; dataUrl: string }

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_decode_failed"));
    img.src = src;
  });
}

const split = (dataUrl: string, fallbackType: string): FittedImage => ({
  dataUrl,
  base64: dataUrl.split(",")[1] || "",
  mimeType: (/^data:([^;,]+)/.exec(dataUrl) || [])[1] || fallbackType,
});

/** 한도 안이면 원본 그대로, 넘으면 줄여서 JPEG 로. 줄일 수 없는 형식(GIF 등)은 원본을 돌려준다. */
export async function fitImageForModel(file: File): Promise<FittedImage> {
  const original = await readDataUrl(file);
  if (!RESIZABLE.includes(file.type)) return split(original, file.type);
  const img = await loadImage(original);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const originalBase64 = original.length - original.indexOf(",") - 1;
  if (longEdge <= MAX_EDGE && originalBase64 <= MAX_BASE64) return split(original, file.type);

  let edge = Math.min(MAX_EDGE, longEdge);
  let quality = 0.9;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = edge / longEdge;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    // JPEG 는 투명을 못 담는다. 투명 PNG 가 검게 뭉개지지 않게 흰 바탕을 먼저 깐다.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = canvas.toDataURL("image/jpeg", quality);
    if (out.length - out.indexOf(",") - 1 <= MAX_BASE64) return split(out, "image/jpeg");
    if (quality > 0.7) quality -= 0.1;
    else edge = Math.round(edge * 0.8);
  }
  throw new Error("image_too_large");
}
