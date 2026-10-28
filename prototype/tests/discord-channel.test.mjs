import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 2026-10-18: 브랜드 스튜디오 배포 채널에 디스코드(웹훅) 추가.
// 웹훅 주소는 비밀번호와 같다 — 서버에만 두고 화면·브라우저 저장소·응답·로그에 원문을 남기지 않는다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const stripped = source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, '');
  const code = esbuild.transformSync(stripped, { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, URL, JSON, Number, String, Math, Promise, FormData, Blob, setTimeout, ...deps });
  return module.exports;
}
const hook = evaluate(read('prototype/functions/api/_shared/discord-webhook.ts'));
// vm 안에서 만든 객체는 프로토타입이 달라 deepStrictEqual 이 실패한다 — 평범한 값으로 옮겨 비교한다.
const plain = v => JSON.parse(JSON.stringify(v));

const ID = '123456789012345678';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefghij';
const GOOD = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

test('웹훅 주소는 discord.com /api/webhooks/{id}/{token} 형식만 받고 정규화한다', () => {
  assert.equal(hook.parseDiscordWebhookUrl(GOOD).url, GOOD);
  assert.equal(hook.parseDiscordWebhookUrl(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}`).url, GOOD);
  assert.equal(hook.parseDiscordWebhookUrl(`https://ptb.discord.com/api/v10/webhooks/${ID}/${TOKEN}/`).url, GOOD);
  for (const bad of [
    `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}`,
    `https://discord.com/api/channels/${ID}/${TOKEN}`,
    `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`,
    'not a url', '', null,
  ]) {
    assert.equal(hook.parseDiscordWebhookUrl(bad), null, `받으면 안 된다: ${bad}`);
  }
});

test('화면 표기(webhookHint)에는 토큰이 없다', () => {
  const hint = hook.webhookHintOf(ID);
  assert.ok(!hint.includes(TOKEN));
  assert.ok(hint.endsWith('/••••••'));
  assert.ok(hint.includes(ID.slice(-4)));
});

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '', json: async () => r.body };
  };
  return { fn, calls };
}

test('429 는 retry_after 만큼 기다렸다가 다시 보내고, 메시지 id 를 돌려준다', async () => {
  const f = fakeFetch([{ status: 429, body: { retry_after: 1.5 } }, { status: 200, body: { id: '999', channel_id: '42' } }]);
  const waits = [];
  const res = await hook.postDiscordMessage({ webhookUrl: GOOD, content: '안녕', fetchFn: f.fn, sleep: async ms => { waits.push(ms); } });
  assert.deepEqual(plain(res), { ok: true, messageId: '999', channelId: '42' });
  assert.deepEqual(waits, [1500]);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.endsWith('?wait=true'));
  // 본문 멘션이 사람들을 호출하지 않게 막는다
  assert.deepEqual(plain(JSON.parse(f.calls[0].init.body).allowed_mentions), { parse: [] });
});

test('retry_after 가 너무 길거나 재시도를 다 쓰면 실패로 돌려준다(주소는 오류 문구에 없다)', async () => {
  const long = fakeFetch([{ status: 429, body: { retry_after: 120 } }]);
  const r1 = await hook.postDiscordMessage({ webhookUrl: GOOD, content: 'x', fetchFn: long.fn, sleep: async () => { throw new Error('기다리면 안 된다'); } });
  assert.equal(r1.ok, false);
  assert.equal(r1.status, 429);
  assert.equal(r1.retryAfterSec, 120);
  assert.ok(!r1.error.includes(TOKEN));

  const fail = fakeFetch([{ status: 400, body: { message: 'Invalid Form Body', code: 50035 } }]);
  const r2 = await hook.postDiscordMessage({ webhookUrl: GOOD, content: 'x', fetchFn: fail.fn });
  assert.equal(r2.ok, false);
  assert.match(r2.error, /50035/);
  assert.ok(!r2.error.includes(TOKEN) && !r2.error.includes('webhooks'));
});

test('첨부는 multipart(payload_json + files[n])로 보낸다', async () => {
  const f = fakeFetch([{ status: 200, body: { id: '1', channel_id: '2' } }]);
  await hook.postDiscordMessage({
    webhookUrl: GOOD, content: '본문', fetchFn: f.fn,
    files: [{ name: 'a.png', bytes: new Uint8Array([1, 2]).buffer, contentType: 'image/png' }],
  });
  const form = f.calls[0].init.body;
  assert.ok(form instanceof FormData);
  const payload = JSON.parse(form.get('payload_json'));
  assert.equal(payload.content, '본문');
  assert.deepEqual(plain(payload.attachments), [{ id: 0, filename: 'a.png' }]);
  assert.ok(form.get('files[0]'));
});

test('웹훅 확인(GET)은 이름·채널·서버 id 를 돌려주고, 삭제된 웹훅은 상태 코드로 알린다', async () => {
  const ok = fakeFetch([{ status: 200, body: { id: ID, name: 'RAVIOK 소식', channel_id: '55', guild_id: '66' } }]);
  assert.deepEqual(plain(await hook.fetchWebhookInfo(GOOD, ok.fn)), { ok: true, info: { id: ID, name: 'RAVIOK 소식', channelId: '55', guildId: '66' } });
  assert.equal(ok.calls[0].init.method, 'GET');
  const gone = fakeFetch([{ status: 404, body: { message: 'Unknown Webhook' } }]);
  assert.deepEqual(plain(await hook.fetchWebhookInfo(GOOD, gone.fn)), { ok: false, status: 404 });
  assert.equal(hook.discordMessageUrl('66', '55', '999'), 'https://discord.com/channels/66/55/999');
  assert.equal(hook.discordMessageUrl('', '55', '999'), '');
});

test('브라우저로 나가는 응답에는 웹훅 주소가 없다(get·save·연결)', () => {
  const get = read('prototype/functions/api/userdata/sns/get.ts');
  const safe = get.slice(get.indexOf('const SAFE_SNS_FIELDS'), get.indexOf('function maskSnsSettings'));
  assert.ok(safe.includes('"webhookHint"'));
  for (const secret of ['webhookUrl', 'webhookId']) assert.ok(!safe.includes(`"${secret}"`), `${secret} 가 화면으로 나간다`);

  const save = read('prototype/functions/api/userdata/sns/save.ts');
  // 클라이언트 저장으로는 비밀을 쓸 수 없고, 해제(전용 API)하면 서버의 비밀도 지운다
  assert.match(save, /const incoming = typeof raw.enabled === "boolean" \? \{ enabled: raw.enabled \} : \{\}/);
  assert.doesNotMatch(save, /raw\.connected === false/);
  const disconnect = read('prototype/functions/api/sns/disconnect.ts');
  assert.match(disconnect, /\[\.\.\.SNS_OAUTH_PLATFORMS, 'discord'\]/);
  assert.match(disconnect, /next\.sns\[platform\] = \{ connected: false, enabled: false, disconnectedAt/);
  // 저장 응답도 마스킹한다(예전엔 병합 결과 전체를 돌려줬다)
  assert.match(save, /settings: maskSavedSettings\(settings\)/);
  assert.doesNotMatch(save, /send\(\{ ok: true, settings: existing \}\)/);
  // 두 허용 목록이 같아야 화면이 똑같이 그려진다
  const list = src => [...src.matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]);
  const saveList = save.slice(save.indexOf('const SAVE_RESPONSE_SNS_FIELDS'), save.indexOf('function maskSavedSettings'));
  assert.deepEqual(list(saveList).sort(), list(safe).sort());

  const connect = read('prototype/functions/api/sns/connect/discord.ts');
  const okResp = connect.slice(connect.lastIndexOf('return send({ ok: true'));
  assert.ok(!/webhookUrl|parsed\.url/.test(okResp), '연결 응답에 주소가 실린다');
});

test('디스코드 코드는 웹훅 주소를 로그에 남기지 않는다', () => {
  const files = [
    'prototype/functions/api/_shared/discord-webhook.ts',
    'prototype/functions/api/sns/connect/discord.ts',
  ];
  const pub = read('prototype/functions/api/sns/publish.ts');
  const branch = pub.slice(pub.indexOf('if (platform === "discord") {'), pub.indexOf("플랫폼은 아직 지원되지 않습니다"));
  for (const src of [...files.map(read), branch]) {
    for (const line of src.split('\n')) {
      if (/console\.(log|warn|error)/.test(line)) assert.ok(!/webhook|hook\.|parsed/i.test(line), `로그에 주소가 들어갈 수 있다: ${line.trim()}`);
    }
  }
});

test('게시: 2000자 초과는 예약 전에 거절하고, 미연결은 412, 10MB 넘는 파일은 링크로 올린다', () => {
  const pub = read('prototype/functions/api/sns/publish.ts');
  const tooLong = pub.indexOf('platform === "discord" && String(caption || "").length > DISCORD_CONTENT_LIMIT');
  assert.ok(tooLong > 0 && tooLong < pub.indexOf('const queuedAt = readQueuedSchedule'), '예약 대기열에 넣기 전에 막아야 한다');
  const branch = pub.slice(pub.indexOf('if (platform === "discord") {'), pub.indexOf("플랫폼은 아직 지원되지 않습니다"));
  assert.match(branch, /discord_not_connected[\s\S]*?412/);
  assert.match(branch, /size <= DISCORD_FILE_LIMIT/);
  // 링크는 1시간짜리 GCS 서명 주소가 아니라 우리 도메인 프록시의 장기 주소
  assert.match(branch, /buildTikTokProxyUrl\(origin, src\.gcsPath, readMediaSecret\(env\), 0\)/);
  // 본문은 자르지 않는다 — 링크가 넘치면 링크만 다음 메시지로
  assert.match(branch, /followLinks/);
  assert.match(branch, /postId: posted\.messageId/);
  assert.match(branch, /url: discordMessageUrl\(/);
  // 텍스트만으로도 게시할 수 있다
  assert.match(pub, /platform !== "x" && platform !== "discord"\)/);
});

test('연결 화면·배포 카드의 링크 버튼은 연결한 디스코드 채널로 간다', () => {
  globalThis.window = globalThis;
  const src = read('prototype/js/ui/format-media-spec.js');
  vm.runInThisContext(src);
  const M = globalThis.NKFormatMedia;
  assert.equal(M.profileUrlOf('discord', { connected: true, guildId: '66', channelId: '55', username: 'NK_Studio' }), 'https://discord.com/channels/66/55');
  assert.equal(M.profileUrlOf('discord', { connected: true, channelId: '55' }), '');
  assert.equal(M.profileUrlOf('discord', { connected: false, guildId: '66', channelId: '55' }), '');
  assert.match(read('prototype/js/ui/sns-settings.js'), /guildId: res\.guildId \|\| ''/);
});

test('예약은 대기열로 들어간다(웹훅에는 예약 기능이 없다)', () => {
  const src = read('prototype/functions/api/_shared/sns-schedule.ts');
  assert.match(src, /QUEUED_SCHEDULE_PLATFORMS = new Set\(\[[^\]]*"discord"/);
});

test('연결 화면: 디스코드는 OAuth 대신 웹훅 입력창으로 연결하고, 주소를 캐시에 두지 않는다', () => {
  const src = read('prototype/js/ui/sns-settings.js');
  assert.match(src, /if \(cpid === 'discord'\) \{ connectDiscord\(\); return; \}/);
  assert.match(src, /apiPost\('\/api\/sns\/connect\/discord', \{ webhookUrl: raw \}\)/);
  const fn = src.slice(src.indexOf('function connectDiscord'), src.indexOf('function startOAuth'));
  const stored = fn.slice(fn.indexOf('_settings.sns[pid] = {'), fn.indexOf('_writeCache(_settings.sns);'));
  assert.ok(stored.length > 20 && !/webhookUrl|raw/.test(stored), '연결 상태(캐시)에 주소가 들어간다');
  assert.ok(!/console\.[a-z]+\([^)]*raw/.test(fn), '주소를 콘솔에 찍는다');
  // 한/영 문구가 짝으로 있다
  for (const key of ['discordPromptTitle', 'discordPrompt', 'discordConnecting', 'discordConnectOk', 'discordConnectFail']) {
    assert.equal((src.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 2, `${key} 가 ko/en 둘 다 있어야 한다`);
  }
});

test('배포 화면: 본문+해시태그 2000자 초과는 보내기 전에 멈추고, 같은 방식으로 센다', () => {
  const src = read('prototype/js/ui/brand-studio.js');
  assert.match(src, /var DISCORD_CONTENT_LIMIT = 2000;/);
  // 게시 본문 조립과 글자 수 계산이 같은 규칙(빈 줄로 잇기)이어야 한다
  assert.match(src, /var finalCaption = \[draftCaption, draftHashtags\]\.filter\(Boolean\)\.join\('\\n\\n'\);/);
  assert.match(src, /function discordContentLength\(caption, hashtags\) \{\s*return \[String\(caption \|\| ''\)\.trim\(\), String\(hashtags \|\| ''\)\.trim\(\)\]\.filter\(Boolean\)\.join\('\\n\\n'\)\.length;/);
  assert.match(src, /formatId === 'discord' && finalCaption\.length > DISCORD_CONTENT_LIMIT[\s\S]*?return Promise\.reject\(dcErr\)/);
  assert.match(src, /case 'discord':\s+bodyHtml = buildDiscordPreview/);
  assert.match(src, /\{ id: 'discord', desc: '[^']+', hasTitle: false \}/);
});

test('에이전트 publish 도 디스코드에 올린다(연결 채널 자동 선택·계획·2000자 확인)', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /const AUTO_PUBLISH_CHANNELS: Record<string, string> = \{[^}]*discord: "discord" \};/);
  assert.match(shared, /"디스코드": "discord"/);
  const plan = shared.slice(shared.indexOf('function planPublishByChannel('), shared.indexOf('function planSummaryText('));
  assert.match(plan, /platform === "discord"[\s\S]*?action: "carousel", items: media\.slice\(0, 10\)[\s\S]*?action: "single"[\s\S]*?action: "text"/);
  const run = shared.slice(shared.indexOf('function publishContext('), shared.indexOf('// ── 완성 콘텐츠 등록'));
  assert.match(run, /platform === "discord" && captionWithTags\.length > 2000/);
  assert.match(shared, /discord: "Discord" \};/);
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  const doc = orch.slice(orch.indexOf('    publish: `[[RUN: publish |'), orch.indexOf('`,', orch.indexOf('    publish: `[[RUN: publish |')));
  assert.match(doc, /"discord": \{"caption"/);
  assert.match(doc, /instagram·youtube-shorts·tiktok·threads·x·facebook·discord/);
});
