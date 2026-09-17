import { getSql } from '../knowledge/_shared';
import { getSettingsRow } from './claude-auth.js';
import { connectorSql, connectorStatus } from './codex-images';

// Billing choice belongs to the authenticated account, never to a page/provider field.
export async function imageAuth(env: any, userId: string) {
  const sql = getSql(env);
  if (!sql) throw new Error('generation_settings_unavailable');
  const row = await getSettingsRow(sql, userId);
  let connector: any = null;
  if (row?.user_image_enabled !== false && row?.image_auth_mode !== 'api_key') {
    const imageSql = await connectorSql(env);
    [connector] = await imageSql('SELECT * FROM nk_image_connectors WHERE user_id=$1', [userId]);
  }
  const apiKey = String(row?.image_openai_api_key || '').trim();
  const enabled = typeof row?.user_image_enabled === 'boolean' ? row.user_image_enabled : !!(apiKey || connector);
  return { enabled, mode: row?.image_auth_mode === 'api_key' ? 'api_key' : 'subscription', apiKey,
    source: enabled ? 'user' : 'master', connector: connectorStatus(connector) };
}

export async function generationStatus(env: any, userId: string, row: any) {
  const image = await imageAuth(env, userId);
  return { chatEnabled: typeof row?.user_chat_enabled === 'boolean' ? row.user_chat_enabled
      : !!(row?.claude_oauth_token || row?.claude_api_key),
    chatMode: row?.claude_auth_mode === 'api_key' ? 'api_key' : 'subscription',
    imageEnabled: image.enabled, imageMode: image.mode, imageApiKeySet: !!image.apiKey,
    imageSource: image.source, connector: image.connector };
}

export async function selectImageSubscription(env: any, userId: string) {
  const sql = getSql(env);
  if (!sql) throw new Error('generation_settings_unavailable');
  await getSettingsRow(sql, userId);
  await sql(`INSERT INTO app_settings (user_id,user_image_enabled,image_auth_mode) VALUES ($1,true,'subscription')
    ON CONFLICT (user_id) DO UPDATE SET user_image_enabled=true,image_auth_mode='subscription',updated_at=now()`, [userId]);
}

export async function saveGenerationSettings(env: any, userId: string, body: any) {
  if (typeof body.chatEnabled !== 'boolean' || typeof body.imageEnabled !== 'boolean') throw new Error('invalid_generation_choice');
  if (!['subscription', 'api_key'].includes(body.authMode) || !['subscription', 'api_key'].includes(body.imageMode)) throw new Error('invalid_auth_mode');
  const token = String(body.oauthToken || '').trim();
  const key = String(body.apiKey || '').trim();
  const imageKey = String(body.imageApiKey || '').trim();
  if ((token && !/^sk-ant-oat[^\s]{10,4096}$/.test(token)) || (key && !/^sk-ant-api[^\s]{10,4096}$/.test(key))
      || (imageKey && !/^sk-[^\s]{10,4096}$/.test(imageKey))) throw new Error('invalid_credential_format');
  const sql = getSql(env);
  if (!sql) throw new Error('generation_settings_unavailable');
  await getSettingsRow(sql, userId);
  await connectorSql(env);
  // Cancel only requests that have not started. Save in-flight results to their owner.
  await sql(`WITH saved AS (INSERT INTO app_settings (user_id,user_chat_enabled,user_image_enabled,image_auth_mode,
      image_openai_api_key,claude_auth_mode,claude_oauth_token,claude_api_key)
    VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,NULLIF($7,''),NULLIF($8,''))
    ON CONFLICT (user_id) DO UPDATE SET user_chat_enabled=$2,user_image_enabled=$3,image_auth_mode=$4,
      image_openai_api_key=COALESCE(NULLIF($5,''),app_settings.image_openai_api_key),claude_auth_mode=$6,
      claude_oauth_token=COALESCE(NULLIF($7,''),app_settings.claude_oauth_token),
      claude_api_key=COALESCE(NULLIF($8,''),app_settings.claude_api_key),updated_at=now() RETURNING user_id)
    UPDATE nk_subscription_image_jobs SET status='cancelled',error='subscription_choice_changed',
      payload=jsonb_set(payload,'{referenceImages}','[]'::jsonb),updated_at=now()
      WHERE user_id IN (SELECT user_id FROM saved) AND status='queued' AND (NOT $3 OR $4<>'subscription')`,
    [userId, body.chatEnabled, body.imageEnabled, body.imageMode, imageKey, body.authMode, token, key]);
}
