export const AI_VIDEO_SERVICE = "ai-video";
export const AI_VIDEO_GEN_SERVICE = "ai-video-gen";
export const AI_IMAGE_SERVICE = "ai-image";
export const DEFAULT_OWNER_USER_ID = "owner";
export const USERDATA_FOLDER = "userdata";

export function sanitizeUserId(raw: any): string {
  const value = String(raw || "").trim();
  if (!value) return DEFAULT_OWNER_USER_ID;
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || DEFAULT_OWNER_USER_ID;
}

export function resolveUserId(raw: any, env?: any): string {
  const fromReq = sanitizeUserId(raw);
  if (fromReq && fromReq !== DEFAULT_OWNER_USER_ID) return fromReq;
  const fromEnv = sanitizeUserId(env?.DEFAULT_USER_ID || env?.NK_DEFAULT_USER_ID || "");
  if (fromEnv && fromEnv !== DEFAULT_OWNER_USER_ID) return fromEnv;
  return DEFAULT_OWNER_USER_ID;
}

export function buildUserRoot(basePrefix: string, userId: string): string {
  const root = normalizeBasePrefix(basePrefix);
  const uid = sanitizeUserId(userId);
  if (!root) return `users/${uid}`;
  return `${root}/users/${uid}`;
}

export function buildAiVideoUserRoot(basePrefix: string, userId: string): string {
  return `${buildUserRoot(basePrefix, userId)}/${AI_VIDEO_SERVICE}`;
}

export function buildAiImageUserRoot(basePrefix: string, userId: string): string {
  return `${buildUserRoot(basePrefix, userId)}/${AI_IMAGE_SERVICE}`;
}

export function buildAiVideoProjectPrefix(basePrefix: string, userId: string, projectId: string): string {
  const root = buildAiVideoUserRoot(basePrefix, userId);
  return `${root}/projects${String(projectId || "").trim()}`;
}

export function buildAiVideoGenPrefix(basePrefix: string, userId: string): string {
  const root = buildUserRoot(basePrefix, userId);
  return `${root}/${AI_VIDEO_GEN_SERVICE}`;
}

export function buildAiVideoBrandPrefix(basePrefix: string, userId: string, brandId: string): string {
  const root = buildAiVideoUserRoot(basePrefix, userId);
  const safeBrandId = String(brandId || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "brand";
  return `${root}/brands/${safeBrandId}`;
}

export function buildAiImageSessionPrefix(basePrefix: string, userId: string, sessionId: string): string {
  const root = buildAiImageUserRoot(basePrefix, userId);
  const safeSessionId = String(sessionId || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "session";
  return `${root}/sessions/${safeSessionId}`;
}

export function buildUserDataRoot(basePrefix: string, userId: string): string {
  return `${buildUserRoot(basePrefix, userId)}/${USERDATA_FOLDER}`;
}

export function buildUserDataObject(basePrefix: string, userId: string, fileName: string): string {
  const safeName = String(fileName || "").trim().replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]/g, "_") || "data.json";
  return `${buildUserDataRoot(basePrefix, userId)}/${safeName}`;
}

function normalizeBasePrefix(basePrefix: string): string {
  const raw = String(basePrefix || "").replace(/\/+$/, "");
  if (!raw) return "";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length && parts[parts.length - 1].toLowerCase() === "videos") {
    parts.pop();
  }
  return parts.join("/");
}
