import { authorizeRequest } from "../../_shared/auth.js";
import { fetchWebhookInfo, parseDiscordWebhookUrl, webhookHintOf, writeDiscordEntry } from "../../_shared/discord-webhook";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 디스코드 연결 — 다른 채널처럼 OAuth 로 넘어가지 않고, 웹훅 주소를 받아 바로 연결한다.
 * POST { webhookUrl } → 형식 검사 → 웹훅 정보(GET)로 살아 있는지 확인 → 서버에만 저장.
 * 응답에는 웹훅 이름과 가린 표기(webhookHint)만 싣는다. 주소 원문은 돌려주지도, 로그에 남기지도 않는다.
 */
export const onRequestPost = async ({ request, env }: { request: Request; env: any }) => {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return send({ error: auth.error }, auth.status);

  let body: any;
  try { body = await request.json(); } catch { return send({ error: "Invalid JSON" }, 400); }

  const parsed = parseDiscordWebhookUrl(body?.webhookUrl);
  if (!parsed) {
    return send({ ok: false, code: "discord_webhook_invalid", error: "디스코드 웹훅 주소 형식이 아닙니다. https://discord.com/api/webhooks/... 주소를 넣어 주세요." }, 400);
  }

  let check;
  try {
    check = await fetchWebhookInfo(parsed.url);
  } catch {
    return send({ ok: false, code: "discord_unreachable", error: "디스코드에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 500);
  }
  if (!check.ok) {
    const gone = check.status === 401 || check.status === 403 || check.status === 404;
    return send({
      ok: false,
      code: gone ? "discord_webhook_dead" : "discord_unreachable",
      error: gone
        ? "이 웹훅은 삭제됐거나 무효합니다. 디스코드 채널 설정에서 웹훅 주소를 다시 복사해 주세요."
        : `디스코드 웹훅 확인 실패(${check.status}). 잠시 뒤 다시 시도해 주세요.`,
    }, gone ? 400 : 500);
  }

  const info = check.info;
  const webhookHint = webhookHintOf(info.id);
  const username = info.name || "Discord";
  try {
    await writeDiscordEntry(env, auth.userId, {
      connected: true,
      enabled: true,
      needsReconnect: false,
      webhookUrl: parsed.url,
      webhookId: info.id,
      guildId: info.guildId,
      channelId: info.channelId,
      username,
      webhookHint,
      connectedAt: new Date().toISOString(),
    }, true);
  } catch {
    return send({ ok: false, code: "discord_save_failed", error: "연결 정보를 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." }, 500);
  }

  return send({ ok: true, platform: "discord", username, webhookHint, channelId: info.channelId, guildId: info.guildId });
};
