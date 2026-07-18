import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";
import { buildAiVideoProjectPrefix } from "../_shared/storage";

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
export const COMPANY_SKILL_ARTIFACT_MAX_BYTES = 100 * 1024 * 1024;

function safeFileName(raw: string) {
  const normalized = String(raw || "artifact.bin")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || "artifact.bin";
}

function koreaDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function koreaTimestamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
}

async function gcsFetchWithBilling(ctx: any, makeRequest: (useBilling: boolean) => Promise<Response>) {
  let response = await makeRequest(true);
  if (!response.ok && ctx.userProject && (response.status === 400 || response.status === 403)) {
    response = await makeRequest(false);
  }
  return response;
}

export interface StoredCompanySkillArtifact {
  objectName: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export async function uploadCompanySkillArtifactBytes(
  env: any,
  args: {
    userId: string;
    workItemId: string;
    fileName: string;
    contentType: string;
    bytes: ArrayBuffer;
  },
): Promise<StoredCompanySkillArtifact> {
  if (!args.bytes.byteLength) throw new Error("저장할 산출물 파일이 비어 있습니다.");
  if (args.bytes.byteLength > COMPANY_SKILL_ARTIFACT_MAX_BYTES) {
    throw new Error("Skill 산출물은 100MB 이하만 저장할 수 있습니다.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(args.workItemId)) throw new Error("올바른 회사 업무 ID가 필요합니다.");

  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({
    clientEmail: ctx.clientEmail,
    privateKeyPem: ctx.privateKeyRaw,
    scope: GCS_SCOPE,
  });
  const originalName = safeFileName(args.fileName);
  const fileName = `${koreaTimestamp()}-${crypto.randomUUID().slice(0, 8)}-${originalName}`;
  const prefix = `${buildAiVideoProjectPrefix(ctx.basePrefix, args.userId, "ai-company")}/work-library/`;
  const objectName = `${prefix}${koreaDate()}/${args.workItemId}/${fileName}`;
  const response = await gcsFetchWithBilling({ ...ctx, token }, (useBilling) => {
    const billing = useBilling && ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : "";
    return fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}${billing}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": args.contentType || "application/octet-stream",
          ...(useBilling && ctx.userProject ? { "X-Goog-User-Project": ctx.userProject } : {}),
        },
        body: args.bytes,
      },
    );
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `GCS 업로드 실패 (HTTP ${response.status})`);
  const now = new Date().toISOString();
  return {
    objectName,
    fileName,
    contentType: args.contentType || "application/octet-stream",
    size: args.bytes.byteLength,
    createdAt: String(payload?.timeCreated || now),
    updatedAt: String(payload?.updated || now),
  };
}
