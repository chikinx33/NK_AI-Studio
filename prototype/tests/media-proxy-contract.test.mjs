import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readProxySource() {
  const fullPath = path.join(process.cwd(), 'prototype/functions/api/media/proxy.ts');
  return fs.readFileSync(fullPath, 'utf8');
}

test('media proxy builds separate (bucket+signer) pairs for audio and video assets', () => {
  const source = readProxySource();
  // 오디오: AUDIO uri + TTS 서명자, 비디오/이미지: VIDEO uri + 기본 서명자
  assert.match(source, /env\.AUDIO_OUTPUT_GCS_URI/);
  assert.match(source, /env\.VIDEO_OUTPUT_GCS_URI/);
  assert.match(source, /TTS_GOOGLE_CLIENT_EMAIL \|\| env\.GOOGLE_CLIENT_EMAIL/);
  assert.match(source, /const videoPair =/);
});

test('media proxy orders the matching pair first and tries the other as fallback', () => {
  const source = readProxySource();
  assert.match(source, /const looksAudio =/);
  assert.match(source, /looksAudio \? \[audioPair, videoPair\] : \[videoPair, audioPair\]/);
  // 두 쌍을 순회하며 첫 성공을 반환
  assert.match(source, /for \(const t of tries\)/);
  assert.match(source, /if \(gcsResp\.ok\)/);
});

test('media proxy dedups by bucket+signer so identical pairs are not retried', () => {
  const source = readProxySource();
  assert.match(source, /const dedupKey = `\$\{parsed\.bucket\}\|\$\{pair\.email\}`/);
  assert.match(source, /seen\.has\(dedupKey\)/);
});

test('media proxy surfaces real 404/403 instead of masking every failure as 502', () => {
  const source = readProxySource();
  assert.match(source, /const outStatus = \(lastStatus === 404 \|\| lastStatus === 403\) \? lastStatus : 502;/);
});
