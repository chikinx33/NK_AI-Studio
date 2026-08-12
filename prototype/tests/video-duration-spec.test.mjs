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
    const m = /^\s*["']?([\w-]+)["']?\s*:\s*((?:DURATIONS|CHOICES)_[A-Z]+)\s*,?\s*$/.exec(line);
    if (m) table[m[1]] = m[2];
  }
  return table;
}

// 프론트가 미러링하는 것은 "UI 선택지(CHOICES)" 쪽이다.
const MIRRORED_SETS = ['DURATIONS_VEO', 'DURATIONS_KLING', 'CHOICES_SEEDANCE', 'DURATIONS_VIDU'];

test('UI 선택지 집합이 서버 SSOT 와 프론트 미러에서 동일하다', () => {
  for (const name of MIRRORED_SETS) {
    const server = parseNumberArray(specSrc, `export const ${name}`, '=');
    const front = parseNumberArray(frontSrc, `var ${name}`, '=');
    assert.ok(server.length > 0, `${name} 서버 값이 비었습니다`);
    assert.deepEqual(front, server, `${name} 이 프론트/서버에서 다릅니다`);
  }
});

test('모델 → UI 선택지 매핑이 프론트/서버에서 동일하다', () => {
  const server = parseModelTable(specSrc, 'export const MODEL_DURATION_CHOICES: Record<string, readonly number[]> = {', '};');
  const front = parseModelTable(frontSrc, 'var MODEL_DURATION_CHOICES = {', '};');
  assert.deepEqual(front, server, '모델별 UI 선택지 매핑이 어긋났습니다');
  for (const id of ['veo', 'veo-full', 'grok', 'kling-final', 'seedance', 'seedance-r2v', 'wan', 'vidu-q3']) {
    assert.ok(server[id], `${id} 의 UI 선택지가 정의되지 않았습니다`);
  }
});

test('UI 선택지는 공급자 허용 집합의 부분집합이다', () => {
  const allowedTable = parseModelTable(specSrc, 'export const MODEL_DURATIONS: Record<string, readonly number[]> = {', '};');
  const choiceTable = parseModelTable(specSrc, 'export const MODEL_DURATION_CHOICES: Record<string, readonly number[]> = {', '};');
  const setValue = (name) => parseNumberArray(specSrc, `export const ${name}`, '=');

  for (const [model, choiceSetName] of Object.entries(choiceTable)) {
    const allowedSetName = allowedTable[model];
    assert.ok(allowedSetName, `${model} 의 허용 집합이 없습니다`);
    const allowed = setValue(allowedSetName);
    const choices = setValue(choiceSetName);
    for (const v of choices) {
      assert.ok(allowed.includes(v), `${model}: UI 선택지 ${v}초가 허용 집합에 없습니다`);
    }
  }
});

test('Seedance 허용 duration 은 4~15 정수 전체다 (Atlas 확인값)', () => {
  const allowed = parseNumberArray(specSrc, 'export const DURATIONS_SEEDANCE', '=');
  assert.deepEqual(allowed, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('이미지 제약이 서버 SSOT 와 프론트 미러에서 동일하다', () => {
  const grab = (source, key, re) => {
    const m = new RegExp(`${key}\\s*:\\s*(${re})`).exec(source);
    assert.ok(m, `${key} 를 찾지 못했습니다`);
    return m[1].replace(/\s/g, '');
  };
  for (const [key, re] of [
    ['minEdge', '[\\d_]+'], ['maxEdge', '[\\d_]+'],
    ['minRatio', '[\\d.]+'], ['maxRatio', '[\\d.]+'],
  ]) {
    const server = grab(specSrc, key, re);
    const front = grab(frontSrc, key, re);
    assert.equal(front, server, `IMAGE_SPEC.${key} 가 프론트/서버에서 다릅니다`);
  }
  // mime 화이트리스트도 동일해야 한다
  const mimeRe = /mimes:\s*\[([^\]]*)\]/;
  const norm = (s) => s.replace(/['"\s]/g, '').split(',').filter(Boolean).sort();
  assert.deepEqual(norm(mimeRe.exec(frontSrc)[1]), norm(mimeRe.exec(specSrc)[1]));
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
  assert.match(frontSrc, /return MODEL_DURATION_CHOICES\[state\.model\] \|\| DURATIONS_VEO;/);
  // 선택지에 없는 값이 state 에 남지 않도록 렌더 시 스냅한다
  assert.match(frontSrc, /if \(durations\(\)\.indexOf\(state\.duration\) === -1\) state\.duration = durations\(\)\[0\];/);
});
