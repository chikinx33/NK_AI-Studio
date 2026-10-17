import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 2026-10-18 엔케 결정: 에이전트가 Gemini 로 영상 내용을 실제로 보고 완성 콘텐츠 등록·SNS 초안에 쓴다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, ...deps });
  return module.exports;
}
const gv = evaluate(read('prototype/functions/api/_shared/gemini-video.ts'));

test('분석 응답은 정해진 모양으로 다듬고, JSON 이 아니면 요약 한 칸에 담는다', () => {
  const a = gv.normalizeVideoAnalysis('```json\n{"summary":"네모가 블록을 민다","scenes":[{"start":"0:00","end":"0:03","description":"블록이 떨어진다"},{"start":"0:03"}],"speech":"가자!","onScreenText":["PuzzleKnight"],"hooks":["블록이 터지는 순간"],"suggestedTitle":"블록 기사"}\n```');
  assert.equal(a.summary, '네모가 블록을 민다');
  assert.equal(a.scenes.length, 1, '설명 없는 장면은 버린다');
  assert.equal(a.onScreenText[0], 'PuzzleKnight');
  assert.equal(a.suggestedTitle, '블록 기사');
  const plain = gv.normalizeVideoAnalysis('그냥 문장');
  assert.equal(plain.summary, '그냥 문장');
  assert.equal(plain.scenes.length, 0);
  const text = gv.analysisToStoryText(a);
  assert.match(text, /영상 요약: 네모가 블록을 민다/);
  assert.match(text, /0:00~0:03 블록이 떨어진다/);
  assert.match(text, /대사·나레이션: 가자!/);
  assert.match(text, /훅이 될 장면: 블록이 터지는 순간/);
  assert.equal(gv.analysisToStoryText(null), '');
});

test('영상은 메모리에 다 올리지 않고 흘려 보내며(100MB), 같은 파일은 캐시, 회원은 막는다', () => {
  const src = read('prototype/functions/api/_shared/gemini-video.ts');
  assert.match(src, /export const MAX_ANALYZE_BYTES = 100 \* 1024 \* 1024;/);
  assert.match(src, /"X-Goog-Upload-Protocol": "resumable"/);
  assert.match(src, /new FLS\(size\)/, 'Workers FixedLengthStream 으로 길이를 정해 스트리밍');
  assert.match(src, /recordGemini\(env, "video_describe", model, json\)/);
  assert.match(src, /method: "DELETE"/, '올린 파일은 지운다');
  const api = read('prototype/functions/api/video/describe.ts');
  assert.match(api, /if \(!\(await usesMasterResources\(env, auth\.userId\)\)\)/);
  assert.match(api, /!objectName\.startsWith\(userRoot\)/);
  assert.match(api, /\.video-analysis\/\$\{await sha256\(`\$\{objectName\}:\$\{stat\.generation\}`\)\}\.json/);
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /video_describe: \{ agentId: "reach", agentIds: \[[^\]]*\], kind: "read", synthesize: true, run: runVideoDescribeTool \}/);
  // 등록: 분석해서 스토리가 비면 요약, SNS 초안 생성에도 분석을 넘긴다. 분석이 실패해도 등록은 계속.
  assert.match(shared, /callInternalJson\(ctx, "\/api\/video\/describe", \{ body: \{ objectName: videos\[0\] \} \}\)\.catch\(\(\) => null\)/);
  assert.match(shared, /if \(!story && analysis\?\.summary\) story = /);
  assert.match(shared, /analysisToStoryText\(analysis\)\]/);
});
