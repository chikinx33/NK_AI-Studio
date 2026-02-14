export const AI_VIDEO_SERVICE = "ai-video";
export const DEFAULT_OWNER_USER_ID = "owner";

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

export function buildAiVideoUserRoot(basePrefix: string, userId: string): string {
  const root = normalizeBasePrefix(basePrefix);
  const uid = sanitizeUserId(userId);
  if (!root) return `users/${uid}/${AI_VIDEO_SERVICE}`;
  return `${root}/users/${uid}/${AI_VIDEO_SERVICE}`;
}

export function buildAiVideoProjectPrefix(basePrefix: string, userId: string, projectId: string): string {
  const root = buildAiVideoUserRoot(basePrefix, userId);
  return `${root}/projects${String(projectId || "").trim()}`;
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
