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

test('media proxy surfaces real 404/403/416 instead of masking every failure as 502', () => {
  const source = readProxySource();
  assert.match(source, /lastStatus === 404 \|\| lastStatus === 403 \|\| lastStatus === 416/);
  assert.match(source, /: 502;/);
});

test('media proxy forwards Range so <video> can seek (206 partial content)', () => {
  const source = readProxySource();
  // 클라이언트 Range 를 GCS 로 전달
  assert.match(source, /request\.headers\.get\("Range"\)/);
  assert.match(source, /headers: range \? \{ Range: range \} : \{\}/);
  // 206 상태를 그대로 유지하고 본문은 스트리밍 (arrayBuffer 로 버퍼링하지 않는다)
  assert.match(source, /new Response\(gcsResp\.body/);
  assert.match(source, /status: gcsResp\.status/);
  assert.doesNotMatch(source, /await gcsResp\.arrayBuffer\(\)/);
  // Range 관련 응답 헤더 전달 + CORS 노출
  assert.match(source, /"Accept-Ranges": "bytes"/);
  assert.match(source, /Content-Range/);
  assert.match(source, /"Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length"/);
});
