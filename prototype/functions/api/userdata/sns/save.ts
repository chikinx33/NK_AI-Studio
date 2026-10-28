import { authorizeRequest } from "../../_shared/auth.js";
import { snsContext, mutateSnsDocument, publicDeployDefaults } from "../../_shared/sns-store.js";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Preference writes use an enabled-only allowlist; credentials and account IDs are server-owned.
// get.ts SAFE_SNS_FIELDS 와 같은 목록(테스트가 둘을 맞춰 본다).
const SAVE_RESPONSE_SNS_FIELDS = ["connected", "enabled", "needsReconnect", "username", "displayName", "avatarUrl", "handle", "pageName", "pageId", "channelTitle", "channelId", "channelHandle", "igUserId", "connectionId", "connectedAt", "grantedScopes", "webhookHint", "guildId"];
function maskSavedSettings(settings: any) {
  const sns = settings?.sns && typeof settings.sns === "object" ? settings.sns : {};
  const out: Record<string, any> = {};
  for (const key of Object.keys(sns)) {
    const entry = sns[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const safe: Record<string, any> = {};
    for (const f of SAVE_RESPONSE_SNS_FIELDS) if (Object.prototype.hasOwnProperty.call(entry, f)) safe[f] = entry[f];
    out[key] = safe;
  }
  return { sns: out, deployDefaults: publicDeployDefaults(settings?.deployDefaults), updatedAt: settings?.updatedAt || "" };
}

export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);
  const userId = auth.userId;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return send({ error: "Invalid JSON" }, 400);
  }

  try {
    const incomingSns = body?.sns || {};
    if (!incomingSns || typeof incomingSns !== "object" || Array.isArray(incomingSns)) return send({ error: "Invalid SNS settings" }, 400);
    const settings = await mutateSnsDocument(await snsContext(env, userId), data => {
      const existing = data || { sns: {}, deployDefaults: {} };
      existing.sns = existing.sns || {};
      for (const platform of Object.keys(incomingSns)) {
        if (!["instagram", "threads", "facebook", "youtube", "youtube-shorts", "tiktok", "x", "discord"].includes(platform)) continue;
        const raw = incomingSns[platform];
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const prev = existing.sns[platform] || {};
        // 연결 해제는 /api/sns/disconnect 로만 한다. 오래된 화면·에이전트 선호 저장이
        // connected:false 를 실어 보내도 새로 연결된 계정을 끊지 않는다.
        // Account IDs, credentials and connected state are server-owned.
        const incoming = typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {};
        existing.sns[platform] = Object.assign({}, prev, incoming);
      }
      if (body?.deployDefaults && typeof body.deployDefaults === "object" && !Array.isArray(body.deployDefaults)) {
        existing.deployDefaults = Object.assign({}, publicDeployDefaults(existing.deployDefaults), publicDeployDefaults(body.deployDefaults));
      }
      existing.updatedAt = new Date().toISOString();
      return existing;
    });
    return send({ ok: true, settings: maskSavedSettings(settings) });
  } catch {
    return send({ ok: false, error: "sns_settings_save_failed" }, 503);
  }
};
