import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const prototype = path.resolve(here, '..');
const read = (relative) => fs.readFile(path.join(prototype, relative), 'utf8');

test('여아·남아·캐릭터 보이스: 클라이언트 id 가 서버 지시문 목록과 정확히 일치한다', async () => {
  const [server, client] = await Promise.all([
    read('functions/api/sound/_character-voices.ts'),
    read('js/ui/ai-sound.js'),
  ]);
  const serverIds = [...server.matchAll(/^\s{2}"([a-z0-9-]+)": \{\s*$/gm)].map((m) => m[1]).sort();
  const block = client.slice(client.indexOf('var CHARACTER_VOICES = ['), client.indexOf('var VOICE_CATEGORIES'));
  const clientIds = [...block.matchAll(/\{ id: '([a-z0-9-]+)',/g)].map((m) => m[1]).sort();
  assert.ok(serverIds.length >= 12, 'server character voices');
  assert.deepEqual(clientIds, serverIds);
  // 지시문(persona)은 서버에만 둔다 — 클라이언트는 char:<id> 만 보낸다.
  assert.doesNotMatch(block, /persona/);
  assert.match(client, /providerVoiceId: 'char:' \+ v\.id/);
});

test('대사별 연출: 클라이언트가 세그먼트 direction 을 보내고 서버가 호출마다 캐릭터·대사 연출을 붙인다', async () => {
  const [client, generate, shared] = await Promise.all([
    read('js/ui/ai-sound.js'),
    read('functions/api/sound/voice-generate.ts'),
    read('functions/api/sound/_shared.ts'),
  ]);
  assert.match(client, /direction: isGeminiModel\(\) \? \(s\.direction \|\| ''\) : ''/);
  assert.match(generate, /direction: isGemini \? s\.direction : ""/);
  // 보이스가 같아도 대사별 연출이 다르면 따로 합성한다.
  assert.match(shared, /last\.providerVoiceId === seg\.providerVoiceId && last\.direction === direction/);
  assert.match(shared, /Voice character for these lines: \$\{persona\}/);
  assert.match(shared, /Delivery for these lines: \$\{line\}/);
  assert.match(shared, /buildDirectedPrompt\(opts\.direction, g\.text, extra\)/);
});

test('캐릭터·대사 연출 UI 문구는 한/영 짝이 있다', async () => {
  const client = await read('js/ui/ai-sound.js');
  for (const key of ['seg_direction_placeholder', 'cat_all', 'cat_adult', 'cat_girl', 'cat_boy', 'cat_character']) {
    assert.equal((client.match(new RegExp(`\\b${key}:`, 'g')) || []).length, 2, key);
  }
});

test('감정 태그 칩: 라벨은 UI 언어로 보이고, 대사에 넣는 태그는 항상 영어다', async () => {
  const client = await read('js/ui/ai-sound.js');
  assert.match(client, /\{ tag: 'calm',\s+ko: '차분하게' \}/);
  assert.match(client, /var label = state\.lang === 'en' \? et\.tag : et\.ko;/);
  assert.match(client, /insertTag\(ta, seg, '\[' \+ et\.tag \+ '\] '\)/);
});
