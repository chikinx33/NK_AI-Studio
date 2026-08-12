import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// functions/api/_shared/video-specs.ts 가 허용 duration 의 단일 출처다.
// 프론트(ai-video-gen.js)는 classic script 라 그 모듈을 import 할 수 없어 리터럴을 미러링한다.
// 두 값이 어긋나면 "UI 에서는 고를 수 있는데 서버가 무시/거부하는" 조합이 다시 생기므로
// 여기서 강제로 일치를 검사한다.

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const specSrc = read('prototype/functions/api/_shared/video-specs.ts');
const frontSrc = read('prototype/js/ui/ai-video-gen.js');

function parseNumberArray(source, name, assignment) {
  const re = new RegExp(`${name}\\s*${assignment}\\s*\\[([^\\]]*)\\]`);
  const m = re.exec(source);
  assert.ok(m, `${name} 선언을 찾지 못했습니다`);
  return m[1].split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

function parseModelTable(source, open, close) {
  const start = source.indexOf(open);
  assert.ok(start >= 0, `${open} 를 찾지 못했습니다`);
  const end = source.indexOf(close, start);
  assert.ok(end > start, `${open} 블록의 끝을 찾지 못했습니다`);
  const body = source.slice(start + open.length, end);
  const table = {};
  for (const line of body.split('\n')) {
    const m = /^\s*["']?([\w-]+)["']?\s*:\s*(DURATIONS_[A-Z]+)\s*,?\s*$/.exec(line);
    if (m) table[m[1]] = m[2];
  }
  return table;
}

const SET_NAMES = ['DURATIONS_VEO', 'DURATIONS_KLING', 'DURATIONS_SEEDANCE', 'DURATIONS_VIDU'];

test('duration 집합 값이 서버 SSOT 와 프론트 미러에서 동일하다', () => {
  for (const name of SET_NAMES) {
    const server = parseNumberArray(specSrc, `export const ${name}`, '=');
    const front = parseNumberArray(frontSrc, `var ${name}`, '=');
    assert.ok(server.length > 0, `${name} 서버 값이 비었습니다`);
    assert.deepEqual(front, server, `${name} 이 프론트/서버에서 다릅니다`);
  }
});

test('모델 → duration 집합 매핑이 프론트/서버에서 동일하다', () => {
  const server = parseModelTable(specSrc, 'export const MODEL_DURATIONS: Record<string, readonly number[]> = {', '};');
  const front = parseModelTable(frontSrc, 'var MODEL_DURATIONS = {', '};');
  assert.deepEqual(front, server, '모델별 허용 duration 매핑이 어긋났습니다');
  // 실제로 UI 가 제공하는 모델이 표에 모두 있어야 한다
  for (const id of ['veo', 'veo-full', 'grok', 'kling-final', 'seedance', 'seedance-r2v', 'wan', 'vidu-q3']) {
    assert.ok(server[id], `${id} 의 허용 duration 이 정의되지 않았습니다`);
  }
});

test('서버 분기들이 개별 클램프 대신 공유 스냅 함수를 쓴다', () => {
  const videoSrc = read('prototype/functions/api/video.ts');
  assert.match(videoSrc, /snapDurationFor\("seedance", durationSeconds\)/);
  assert.match(videoSrc, /snapDurationFor\("wan", durationSeconds\)/);
  assert.match(videoSrc, /snapDurationFor\("seedance-r2v", durationSeconds\)/);
  assert.match(videoSrc, /snapDurationFor\("vidu-q3", durationSeconds\)/);
  // 예전의 하드코딩 클램프가 남아 있지 않다
  assert.doesNotMatch(videoSrc, /Math\.min\(15, Math\.max\(4,/);
  assert.doesNotMatch(videoSrc, /Math\.min\(12, Math\.max\(4,/);
  assert.doesNotMatch(videoSrc, /const allowed = \[4, 6, 8\]/);
});

test('프론트 duration 선택지는 모델 표에서만 나온다', () => {
  assert.match(frontSrc, /return MODEL_DURATIONS\[state\.model\] \|\| DURATIONS_VEO;/);
  // 선택지에 없는 값이 state 에 남지 않도록 렌더 시 스냅한다
  assert.match(frontSrc, /if \(durations\(\)\.indexOf\(state\.duration\) === -1\) state\.duration = durations\(\)\[0\];/);
});
