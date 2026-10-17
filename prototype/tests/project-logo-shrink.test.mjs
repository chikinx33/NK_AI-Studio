import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 2026-10-17: 프로젝트(브랜드) 이미지를 원본 그대로 올려 수 MB 사진이 카드(약 100px)마다 내려받혔다.
// 올리기 전에 긴 변 512px·WebP 로 줄인다. SVG·GIF 는 그대로, 줄인 결과가 더 크면 원본.
const root = path.resolve(import.meta.dirname, '../..');
const src = fs.readFileSync(path.join(root, 'prototype/js/ui/dashboard.js'), 'utf8');

test('프로젝트 이미지는 줄여서 올린다', () => {
  assert.match(src, /const LOGO_MAX_SIDE = 512;/);
  assert.match(src, /type === 'image\/svg\+xml' \|\| type === 'image\/gif'\) return file;/);
  assert.match(src, /Math\.min\(1, LOGO_MAX_SIDE \/ Math\.max\(width, height\)\)/);
  assert.match(src, /toBlob\('image\/webp', LOGO_QUALITY\)/);
  assert.match(src, /if \(!blob \|\| blob\.size >= file\.size\) return file;/);
  assert.match(src, /NK\.api\.imageUpload\(id, await shrinkLogoImage\(file\), \{ kind: 'logo' \}\)/);
  assert.doesNotMatch(src, /NK\.api\.imageUpload\(id, file, \{ kind: 'logo' \}\)/);
});
