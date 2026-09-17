import { getSql, type SqlFn } from '../knowledge/_shared';
import { checkAccountSession } from './account-deletions';
import { hasPagePermission } from './admin-users';
import { buildAiImageSessionPrefix, buildAiVideoProjectPrefix } from './storage';
import { resolveProjectStorageOwner } from './shares';
import { resolveGcsEnv, getGoogleAccessToken } from './gcs.js';
import { signGcsUrl } from '../image/upload';

export const CONNECTOR_HEADER = 'X-NK-Image-Connector';
export const ONLINE_MS = 60000;
export const JOB_TIMEOUT_MS = 20 * 60 * 1000;
const schemaReady = new Map<string, Promise<void>>();

export async function connectorSql(env: any): Promise<SqlFn> {
  const sql = getSql(env);
  if (!sql) throw new Error('connector_database_unavailable');
  const key = String(env.DATABASE_URL);
  if (!schemaReady.has(key)) schemaReady.set(key, (async () => {
    await sql(`CREATE TABLE IF NOT EXISTS nk_image_connectors (
      user_id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '',
      ready BOOLEAN NOT NULL DEFAULT false, connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days')`);
    await sql(`CREATE TABLE IF NOT EXISTS nk_subscription_image_jobs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL,
      payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued', result JSONB,
      error TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await sql(`CREATE UNIQUE INDEX IF NOT EXISTS nk_subscription_image_active
      ON nk_subscription_image_jobs (user_id) WHERE status IN ('queued','working','uploading')`);
    await sql(`CREATE INDEX IF NOT EXISTS nk_subscription_image_owner
      ON nk_subscription_image_jobs (user_id, created_at DESC)`);
  })().catch(error => { schemaReady.delete(key); throw error; }));
  await schemaReady.get(key);
  return sql;
}

export async function hashConnectorToken(raw: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new Error('invalid_connector_token');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authorizeConnector(request: Request, env: any, sql: SqlFn): Promise<any> {
  const tokenHash = await hashConnectorToken(String(request.headers.get(CONNECTOR_HEADER) || ''));
  const [row] = await sql(`SELECT * FROM nk_image_connectors WHERE token_hash=$1 AND expires_at>now()`, [tokenHash]);
  if (!row) throw new Error('connector_not_paired');
  const account = await checkAccountSession(env, row.user_id, Date.parse(row.connected_at));
  if (!account.ok) throw new Error('connector_account_revoked');
  if (!await hasPagePermission(env, row.user_id, 'image')) throw new Error('permission_denied');
  return row;
}

export function connectorStatus(row: any) {
  return { configured: !!row, online: !!row?.ready && Date.parse(row.last_seen || '') > Date.now() - ONLINE_MS,
    email: row?.email || '', plan: row?.plan || '', expiresAt: row?.expires_at || '', source: row ? 'user-subscription' : 'unregistered' };
}

export function validateImagePayload(raw: any) {
  const prompt = String(raw?.prompt || '').trim();
  if (!prompt || prompt.length > 12000) throw new Error('invalid_image_prompt');
  const references = Array.isArray(raw.referenceImages) ? raw.referenceImages : [];
  if (references.length > 16) throw new Error('too_many_reference_images');
  const referenceImages = references.map((item: any) => {
    const url = String(item?.imageDataUrl || '');
    if (url.length > 8 * 1024 * 1024) throw new Error('reference_image_too_large');
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(url)) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['storage.googleapis.com', 'nkstudio.org'].includes(parsed.hostname)
        || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) throw new Error('invalid_reference_image_url');
    }
    return { imageDataUrl: url };
  });
  if (JSON.stringify(referenceImages).length > 12 * 1024 * 1024) throw new Error('reference_images_too_large');
  const storageService = raw.storageService === 'ai-image' ? 'ai-image' : 'ai-video';
  const projectId = String(raw.projectId || raw.projTag || '').trim();
  if (projectId.length > 180 || /[\/\\]/.test(projectId)) throw new Error('invalid_project_id');
  if (storageService !== 'ai-image' && !projectId) throw new Error('project_required');
  return { prompt, referenceImages, storageService, projectId,
    sessionId: String(raw.sessionId || 'default').slice(0, 180),
    ownerId: String(raw.ownerId || ''),
    aspectRatio: ['1:1','16:9','9:16','free'].includes(raw.aspectRatio) ? raw.aspectRatio : '1:1',
    imageSize: ['512','1K','2K'].includes(raw.imageSize) ? raw.imageSize : '1K',
    generationMode: references.length ? 'image-to-image' : 'text-to-image',
    conversationHistory: (Array.isArray(raw.conversationHistory) ? raw.conversationHistory : []).slice(-3)
      .map((item: any) => ({ prompt: String(item?.prompt || '').slice(0, 4000) })) };
}

export async function storeSubscriptionImage(env: any, job: any, file: File) {
  if (!file || file.size > 16 * 1024 * 1024 || file.size < 12) throw new Error('invalid_generated_image');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png = [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('invalid_generated_image');
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp';
  const extension = png ? 'png' : jpeg ? 'jpg' : 'webp';
  const payload = job.payload;
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({ clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw,
    scope: 'https://www.googleapis.com/auth/cloud-platform' });
  const projectOwner = payload.projectId
    ? await resolveProjectStorageOwner(env, job.user_id, payload.ownerId, payload.projectId) : job.user_id;
  const stamp = Date.parse(job.created_at);
  const filename = `${stamp}-codex-${job.id}.${extension}`;
  const sessionObject = `${buildAiImageSessionPrefix(ctx.basePrefix, job.user_id, payload.sessionId)}/outputs/${filename}`;
  const projectObject = payload.projectId
    ? `${buildAiVideoProjectPrefix(ctx.basePrefix, projectOwner, payload.projectId)}/image/${filename}` : '';
  const objectName = payload.storageService === 'ai-image' ? sessionObject : projectObject;
  for (const name of new Set([objectName, projectObject].filter(Boolean))) {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(ctx.bucket)}/o?uploadType=media&name=${encodeURIComponent(name)}${ctx.userProject ? `&userProject=${encodeURIComponent(ctx.userProject)}` : ''}`;
    const response = await fetch(url, { method: 'POST', body: bytes, headers: { Authorization: `Bearer ${token}`,
      'Content-Type': mime, ...(ctx.userProject ? { 'X-Goog-User-Project': ctx.userProject } : {}) } });
    if (!response.ok) throw new Error('subscription_image_save_failed');
  }
  const signedUrl = await signGcsUrl({ bucket: ctx.bucket, object: objectName,
    clientEmail: ctx.clientEmail, privateKeyPem: ctx.privateKeyRaw, expiresInSec: 3600 });
  return { signedUrl, objectName, projectObjectName: projectObject, savedToProject: !!projectObject,
    provider: 'chatgpt-subscription', authSource: 'user', model: 'codex-built-in-image',
    aspectApplied: payload.aspectRatio, imageSizeRequested: payload.imageSize,
    sessionId: payload.sessionId, promptEcho: payload.prompt, storageService: payload.storageService };
}

export async function expireImageJobs(sql: SqlFn, userId: string) {
  await sql(`UPDATE nk_subscription_image_jobs SET status='error', error='connector_job_timeout',
    payload=jsonb_set(payload,'{referenceImages}','[]'::jsonb), updated_at=now()
    WHERE user_id=$1 AND status IN ('queued','working','uploading') AND created_at<now()-interval '20 minutes'`, [userId]);
}
