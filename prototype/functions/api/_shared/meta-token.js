import { patchSnsPlatform } from './sns-store.js';

export function isMetaCredentialError(data, status = 0) {
  return status === 401 || Number(data?.error?.code || 0) === 190 || /expired|revoked|invalid.*token|validating access token/i.test(String(data?.error?.message || ''));
}

export async function ensureMetaToken(ctx, platform, entry) {
  const token = String(entry?.accessToken || '');
  if (!entry?.connected || !token) throw new Error(`${platform}_not_connected`);
  if (entry.needsReconnect) throw new Error(`${platform}_reconnect_required`);
  const expires = Date.parse(entry.tokenExpiresAt || '');
  if (!Number.isFinite(expires) || expires - Date.now() > 7 * 86400000) return token;
  if (expires <= Date.now()) {
    await patchSnsPlatform(ctx, platform, { needsReconnect: true }, token);
    throw new Error(`${platform}_reconnect_required`);
  }
  const graph = platform === 'instagram' ? 'https://graph.instagram.com' : 'https://graph.threads.com';
  let res, data;
  try {
    res = await fetch(`${graph}/refresh_access_token?` + new URLSearchParams({ grant_type: platform === 'instagram' ? 'ig_refresh_token' : 'th_refresh_token', access_token: token }));
    data = await res.json().catch(() => ({}));
  } catch { return token; } // Still valid: a transient provider outage is not revocation.
  if (!res.ok || !data.access_token || !(Number(data.expires_in) > 0)) {
    if (isMetaCredentialError(data, res.status)) {
      await patchSnsPlatform(ctx, platform, { needsReconnect: true }, token);
      throw new Error(`${platform}_reconnect_required`);
    }
    return token;
  }
  await patchSnsPlatform(ctx, platform, { accessToken: data.access_token, tokenExpiresAt: new Date(Date.now() + Number(data.expires_in) * 1000).toISOString(), needsReconnect: false }, token);
  return String(data.access_token);
}
