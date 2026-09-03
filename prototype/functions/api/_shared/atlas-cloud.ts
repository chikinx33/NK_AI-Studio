const ATLAS_BASE_URL = "https://api.atlascloud.ai/api/v1/model";

export type AtlasMediaOutput = {
  data: string;
  mimeType: string;
};

export async function uploadAtlasDataUrl(apiKey: string, dataUrl: string, fileName = "input.png"): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("atlas_upload_invalid_data_url");
  const form = new FormData();
  form.append("file", new Blob([base64ToUint8(parsed.base64)], { type: parsed.mimeType }), fileName);
  const res = await fetch(`${ATLAS_BASE_URL}/uploadMedia`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await res.text();
  const json = safeJson(text);
  if (!res.ok) throw new Error(`atlas_upload_error:${res.status}:${atlasErrorMessage(json, text)}`);
  const url = String(
    json?.data?.download_url || json?.data?.url || json?.download_url || json?.url || ""
  ).trim();
  if (!url) throw new Error("atlas_upload_no_url");
  return url;
}

export async function submitAtlasGeneration(
  apiKey: string,
  kind: "image" | "video",
  body: Record<string, unknown>
): Promise<any> {
  const endpoint = kind === "image" ? "generateImage" : "generateVideo";
  const res = await fetch(`${ATLAS_BASE_URL}/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = safeJson(text);
  if (!res.ok) throw new Error(`atlas_${kind}_error:${res.status}:${atlasErrorMessage(json, text)}`);
  return json;
}

export function atlasPredictionId(payload: any): string {
  return String(payload?.data?.id || payload?.prediction_id || payload?.id || "").trim();
}

export function atlasOutputs(payload: any): string[] {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const candidates = data?.outputs || data?.output || payload?.outputs || payload?.output;
  if (Array.isArray(candidates)) {
    return candidates.map(atlasOutputValue).filter(Boolean);
  }
  const single = atlasOutputValue(candidates || data?.url || payload?.url);
  return single ? [single] : [];
}

export async function waitForAtlasPrediction(
  apiKey: string,
  predictionId: string,
  options?: { maxAttempts?: number; delayMs?: number }
): Promise<any> {
  const maxAttempts = Math.max(1, Number(options?.maxAttempts || 45));
  const delayMs = Math.max(250, Number(options?.delayMs || 2000));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await sleep(delayMs);
    const res = await fetch(`${ATLAS_BASE_URL}/prediction/${encodeURIComponent(predictionId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text();
    const json = safeJson(text);
    if (!res.ok) throw new Error(`atlas_prediction_error:${res.status}:${atlasErrorMessage(json, text)}`);
    const data = json?.data && typeof json.data === "object" ? json.data : json;
    const status = String(data?.status || "").toLowerCase();
    if (["completed", "succeeded", "success", "done", "ready"].includes(status)) return json;
    if (["failed", "error", "cancelled", "canceled", "expired", "rejected", "timeout"].includes(status)) {
      throw new Error(`atlas_generation_failed:${atlasErrorMessage(data, text)}`);
    }
    if (!status && atlasOutputs(json).length > 0) return json;
  }
  throw new Error("atlas_prediction_timeout");
}

export async function atlasImageOutput(payload: any): Promise<AtlasMediaOutput> {
  const first = atlasOutputs(payload)[0] || "";
  if (!first) throw new Error("atlas_image_no_output");
  const parsed = parseDataUrl(first);
  if (parsed) return { data: parsed.base64, mimeType: parsed.mimeType };
  if (/^https?:\/\//i.test(first)) {
    const res = await fetch(first);
    if (!res.ok) throw new Error(`atlas_output_fetch_error:${res.status}`);
    const mimeType = String(res.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
    return { data: uint8ToBase64(new Uint8Array(await res.arrayBuffer())), mimeType };
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(first)) {
    return { data: first.replace(/\s+/g, ""), mimeType: "image/png" };
  }
  throw new Error("atlas_image_output_invalid");
}

function atlasOutputValue(value: any): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.url || value.download_url || value.data || value.base64 || "").trim();
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  return { mimeType: match[1] || "application/octet-stream", base64: match[2].replace(/\s+/g, "") };
}

function atlasErrorMessage(json: any, fallback: string): string {
  const value = json?.data?.error?.message || json?.data?.error || json?.error?.message || json?.error || json?.message || fallback;
  return String(typeof value === "string" ? value : JSON.stringify(value)).slice(0, 600);
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return {}; }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}
