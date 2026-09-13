// 스테이지(iframe)가 뜨기 전 빈 화면: 흐림 위에 기존 스피너를 보여 준다(셸 오버레이 + React 캔버스 그래프 로딩).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★셸 스테이지 오버레이: 흐림(backdrop blur) + 기존 .spinner, 활성일 때만 클릭 차단', () => {
  const css = read('prototype/styles.css');
  const i = css.indexOf('.stage-overlay {'); const block = css.slice(i, css.indexOf('.stage-overlay.is-active', i));
  assert.match(block, /backdrop-filter: blur\(4px\);/);
  assert.match(block, /display: flex;\s*\n\s*align-items: center;\s*\n\s*justify-content: center;/);
  assert.match(css, /\.stage-overlay\.is-active \{\s*\n\s*opacity: 1;\s*\n\s*pointer-events: auto;\s*\n\}/);
  const nav = read('prototype/js/navigation.js');
  assert.match(nav, /var ovSpin = document\.createElement\('div'\);\s*\n\s*ovSpin\.className = 'spinner';\s*\n\s*ov1\.appendChild\(ovSpin\);/, '기존 .spinner 를 오버레이 안에');
  assert.match(nav, /if \(ov\) ov\.classList\.add\('is-active'\);\s*\n\s*\} catch \(_\) \{\}\s*\n\s*iframe\.src = url;/, '새 URL 로드 전에 활성');
});

test('★React 캔버스: 그래프를 읽는 동안 흐림 + 스피너(문구 아님)', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /\{loading && !graph && <div className="absolute inset-0 z-20 grid place-items-center bg-\[#06080c\]\/55 backdrop-blur-\[4px\]" data-testid="canvas-loading"><RefreshIcon className="h-9 w-9 animate-spin text-orange-400" \/><\/div>\}/);
  assert.doesNotMatch(src, /캔버스를 불러오는 중…/);
});
