import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('회원 관리 권한명은 실제 앱 메뉴와 일치한다', () => {
  const core = read('prototype/core.js');
  assert.match(core, /admin_perm_videogen: 'AI 영상'/);
  assert.match(core, /admin_perm_video: 'AI 시네마'/);
  assert.match(core, /admin_perm_doc: 'AI 문서'/);
  assert.match(core, /admin_perm_sound: 'AI 오디오'/);
});

test('메인과 사이드바는 문서·오디오를 포함한 하나의 권한 매핑을 공유한다', () => {
  const script = read('prototype/script.js');
  assert.match(script, /const appPermissionForHref/);
  assert.match(script, /ai-video-gen[\s\S]{0,160}return 'videogen'/);
  assert.match(script, /ai-video[\s\S]{0,160}return 'video'/);
  assert.match(script, /ai-doc[\s\S]{0,160}return 'doc'/);
  assert.match(script, /ai-sound[\s\S]{0,160}return 'sound'/);
  assert.match(script, /applyAppLauncherPermissions/);
  assert.match(script, /icons\.querySelectorAll\('a\.login-icon-link\[href\]'\)/);
  assert.match(script, /const permission = appPermissionForHref\(href\)/);
});

test('각 앱 URL이 의도한 권한 키로 실제 판정된다', () => {
  const script = read('prototype/script.js');
  const start = script.indexOf('const appPermissionForHref');
  const end = script.indexOf('const applyAppLauncherPermissions', start);
  assert.ok(start > 0 && end > start, '앱 권한 매핑 함수를 찾지 못함');
  const mapPermission = new Function(script.slice(start, end) + '\nreturn appPermissionForHref;')();
  assert.equal(mapPermission('ai-video-gen.html'), 'videogen');
  assert.equal(mapPermission('ai-video-gen-stage.html?detached=1'), 'videogen');
  assert.equal(mapPermission('ai-image.html?stage=dashboard'), 'image');
  assert.equal(mapPermission('ai-video.html?stage=dashboard'), 'video');
  assert.equal(mapPermission('brand-studio.html'), 'brand');
  assert.equal(mapPermission('ai-doc.html'), 'doc');
  assert.equal(mapPermission('ai-sound.html'), 'sound');
});

test('권한 없는 문서·오디오 및 직접 stage URL은 페이지 진입도 차단한다', () => {
  const script = read('prototype/script.js');
  assert.match(script, /const isAiDocPath/);
  assert.match(script, /const isAiSoundPath/);
  assert.match(script, /isAiVideoGenShellPath \|\| isAiVideoGenStagePath/);
  assert.match(script, /isAiImageShellPath \|\| isAiImageStagePath/);
  assert.match(script, /perm: 'doc', href: 'ai-doc\.html'/);
  assert.match(script, /perm: 'sound', href: 'ai-sound\.html'/);
  assert.match(script, /_guardPerms\.indexOf\(currentPermissionEntry\.perm\) === -1/);
});
