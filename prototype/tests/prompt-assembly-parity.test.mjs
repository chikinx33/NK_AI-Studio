// 브라우저 ↔ 서버 프롬프트 조립 표류 방지(drift guard).
// 런타임 값이 아니라 소스 텍스트를 비교한다 — 한쪽만 고치면 여기서 막힌다.
//  (a) stage-geometry 의 TRANSFORMS / FACING_TEXT 본문이 글자 단위로 같다
//  (b) buildImagePrompt 와 buildSceneImagePrompt 가 같은 리터럴을 같은 순서로 갖는다
//  (c) pipeline-video promptBase 와 buildSceneVideoPrompt 가 같은 블록 라벨을 같은 순서로 갖는다
//  (d) 에이전트 씬 도구가 조립기를 호출하고, 옛 visual||shot||title 폴백을 1차 프롬프트로 쓰지 않는다
//  (e) scene_upsert FIELDS 에 common / cutRefId 가 있다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').split('\r\n').join('\n');

const browserGeo = () => read('prototype/js/service/stage-geometry.js');
const serverGeo = () => read('prototype/functions/api/_shared/stage-geometry.js');
const browserImage = () => read('prototype/ui/pipeline-image.js');
const browserVideo = () => read('prototype/ui/pipeline-video.js');
const serverAssembly = () => read('prototype/functions/api/_shared/prompt-assembly.js');
const agentShared = () => read('prototype/functions/api/agent/_shared.ts');

// `NAME = {` 부터 짝이 맞는 `}` 까지의 객체 리터럴 본문을 뽑는다(중괄호 깊이 추적).
function objectBody(src, name) {
  const m = new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*\\{').exec(src);
  assert.ok(m, `${name} 선언을 찾지 못했다`);
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail(`${name} 의 닫는 중괄호를 찾지 못했다`);
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

// 함수 본문: `function NAME(` 부터 다음 최상위 `function` 선언 직전까지.
function functionBody(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, `function ${name} 을 찾지 못했다`);
  const rest = src.slice(at + 1);
  const next = rest.search(/\n\s*(?:export\s+)?(?:async\s+)?function\s+\w+\s*\(/);
  return src.slice(at, next >= 0 ? at + 1 + next : src.length);
}

function assertInOrder(src, literals, label) {
  let cursor = 0;
  for (const lit of literals) {
    const at = src.indexOf(lit, cursor);
    assert.ok(at >= 0, `${label}: '${lit}' 이(가) 없거나 순서가 어긋났다`);
    cursor = at + lit.length;
  }
}

test('(a) stage-geometry TRANSFORMS / FACING_TEXT 본문이 브라우저·서버에서 동일하다', () => {
  const b = browserGeo();
  const s = serverGeo();
  assert.equal(squash(objectBody(s, 'TRANSFORMS')), squash(objectBody(b, 'TRANSFORMS')), 'TRANSFORMS 표가 다르다');
  assert.equal(squash(objectBody(s, 'FACING_TEXT')), squash(objectBody(b, 'FACING_TEXT')), 'FACING_TEXT 표가 다르다');
  assert.equal(squash(objectBody(s, 'FRAME_X_TEXT')), squash(objectBody(b, 'FRAME_X_TEXT')));
  assert.equal(squash(objectBody(s, 'FRAME_DEPTH_TEXT')), squash(objectBody(b, 'FRAME_DEPTH_TEXT')));
  assert.equal(squash(objectBody(s, 'DIRECTION_VARIANT_IDS')), squash(objectBody(b, 'DIRECTION_VARIANT_IDS')));
  assert.match(s, /브라우저 stage-geometry\.js 와 표가 같아야 한다/);
  // 주석은 빼고 코드만 본다(헤더 설명에 '전역 참조 금지' 같은 말이 적혀 있다).
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(stripComments(s), /\bwindow\b|\bNK\./, '서버판은 브라우저 전역을 참조하면 안 된다');
  assert.doesNotMatch(stripComments(serverAssembly()), /\bwindow\b|\bNK\./, '조립기는 브라우저 전역을 참조하면 안 된다');
});

const IMAGE_LITERALS = [
  "'Location: '",
  "'Composition: '",
  "'This still is the FIRST FRAME of the shot (t=0)",
  "'텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.'",
];

test('(b) buildImagePrompt ↔ buildSceneImagePrompt 리터럴·순서 일치', () => {
  const b = functionBody(browserImage(), 'buildImagePrompt');
  const s = functionBody(serverAssembly(), 'buildSceneImagePrompt');
  assertInOrder(b, IMAGE_LITERALS, '브라우저 buildImagePrompt');
  assertInOrder(s, IMAGE_LITERALS, '서버 buildSceneImagePrompt');
  // FIRST FRAME 문장 전체가 같아야 한다(브라우저에서 문구를 손보면 서버도 따라야 한다).
  const sentence = (src) => (src.match(/'This still is the FIRST FRAME[^']*'/) || [''])[0];
  assert.equal(sentence(s), sentence(b));
  // 화면 선택 분기 순서: firstFrame → composition → primaryVisual → action
  const branchOrder = ['if (firstFrame)', 'else if (composition)', 'else if (primaryVisual)', 'else if (action)'];
  assertInOrder(b, branchOrder, '브라우저 분기');
  assertInOrder(s, branchOrder, '서버 분기');
  // 후처리(';' → ',')도 같다
  const post = "replace(/[;]+/g, ',').replace(/\\s+,/g, ',').trim()";
  assert.ok(b.includes(post) && s.includes(post), '후처리 체인이 다르다');
});

const VIDEO_LITERALS = [
  "'Global'",
  "'Scene Visual'",
  "'Shot timeline (what is visible over time)'",
  "'Scene Duration'",
];

test('(c) pipeline-video promptBase ↔ buildSceneVideoPrompt 블록 라벨·순서 일치', () => {
  const b = browserVideo();
  const s = functionBody(serverAssembly(), 'buildSceneVideoPrompt');
  // 브라우저는 씬 단위 promptBase 가 첫 번째 등장(컷 단위는 뒤에 온다)
  const bBase = b.slice(b.indexOf('var promptBase = ['));
  assertInOrder(bBase, VIDEO_LITERALS, '브라우저 promptBase');
  assertInOrder(s, VIDEO_LITERALS, '서버 buildSceneVideoPrompt');
  // 음성 문장도 같다
  const noVoice = "'No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.'";
  const dub = "'\\n\\n[대사/립싱크] The character(s) speak the following lines on camera with accurate lip-sync. '";
  for (const lit of [noVoice, dub]) {
    assert.ok(b.includes(lit), `브라우저에 ${lit} 이 없다`);
    assert.ok(s.includes(lit), `서버에 ${lit} 이 없다`);
  }
  // 시간표 형식도 같다
  const tl = "return from + 's-' + to + 's: ' + row.what;";
  assert.ok(b.includes(tl) && serverAssembly().includes(tl), 'buildBeatTimeline 형식이 다르다');
});

test('(d) 에이전트 씬 도구가 조립기를 부르고 옛 폴백 체인을 1차 프롬프트로 쓰지 않는다', () => {
  const src = agentShared();
  assert.match(src, /import \{ buildSceneImagePrompt, buildSceneVideoPrompt \} from "\.\.\/_shared\/prompt-assembly\.js";/);
  const still = functionBody(src, 'runSceneStillTool');
  const video = functionBody(src, 'runSceneVideoTool');
  assert.ok(still.includes('buildSceneImagePrompt('), 'runSceneStillTool 이 buildSceneImagePrompt 를 부르지 않는다');
  assert.ok(video.includes('buildSceneVideoPrompt('), 'runSceneVideoTool 이 buildSceneVideoPrompt 를 부르지 않는다');
  const oldChain = /scene\?\.visual \|\| scene\?\.shot \|\| scene\?\.title/;
  assert.doesNotMatch(still, oldChain, 'runSceneStillTool 에 옛 폴백 체인이 남아 있다');
  assert.doesNotMatch(video, oldChain, 'runSceneVideoTool 에 옛 폴백 체인이 남아 있다');
  // 계보 기록
  assert.match(still, /imagePrompt: prompt/);
  assert.match(still, /imageAttempts: \(Number\(prevLineage\.imageAttempts\) \|\| 0\) \+ 1/);
  assert.match(still, /imageHistory/);
  assert.match(video, /videoPrompt: prompt/);
  assert.match(video, /videoFromImage/);
  assert.match(video, /videoAttempts: \(Number\(prevLineage\.videoAttempts\) \|\| 0\) \+ 1/);
  // header 가 project_get 결과에 실린다
  const get = functionBody(src, 'runProjectGetTool');
  assert.match(get, /header:/);
});

test('(e) scene_upsert FIELDS 에 프롬프트·컷 참조 필드가 있다', () => {
  const up = functionBody(agentShared(), 'runSceneUpsertTool');
  const fields = (up.match(/const FIELDS = \[([\s\S]*?)\];/) || [])[1] || '';
  for (const f of ['"common"', '"cutRefId"', '"promptText"', '"cameraDirection"', '"beats"', '"blocking"', '"cutRefEnabled"', '"promptEdited"']) {
    assert.ok(fields.includes(f), `FIELDS 에 ${f} 가 없다`);
  }
});
