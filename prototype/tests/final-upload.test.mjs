import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyFinalUpload } from '../functions/api/_shared/final-upload.js';

// 2026-10-17 엔케 결정: SNS 세팅 '+'로 완성 스토리·이미지·영상을 등록하면 디렉터 확정과 같은 잠금으로
// 에피소드의 정식 데이터가 된다(시나리오·메인 프로덕션 수정 불가, 내용은 어디서나, 영상 수정은 포스트 프로덕션).
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const BUCKET = 'nk-bucket';
const gs = name => `gs://${BUCKET}/users/alice/ai-video/projectsep1/director/${name}`;
const empty = () => ({ projectId: 'ep1', title: 'EP01 게임 소개', payload: { story: '', topic: '' }, scenes: [] });

test('영상+이미지: 영상은 대표 영상·통영상 컷, 이미지는 뒤이은 컷, 잠금은 upload 출처', () => {
  const now = '2026-10-17T03:00:00.000Z';
  const { data, result } = applyFinalUpload(empty(), {
    bucket: BUCKET, now, title: '런칭 영상', story: '퍼즐 기사 소개',
    video: { gsUri: gs('final.mp4'), durationSec: 28.4, stillGs: gs('still.jpg'), aspectRatio: '9:16' },
    images: [gs('a.png'), gs('b.png')],
  });
  assert.equal(data.scenes.length, 3);
  assert.equal(data.scenes[0].imagePath, gs('still.jpg'), '영상 컷의 스틸은 첫 장면');
  assert.equal(data.scenes[0].estSec, 28.4);
  assert.equal(data.scenes[1].imagePath, gs('a.png'));
  assert.equal(data.scenes[1].sceneBreak, true);
  assert.equal(data.scenes[2].imagePath, gs('b.png'));
  assert.deepEqual(data.scenes.map(s => s.id), [1, 2, 3]);
  assert.equal(data.payload.renderMeta.outputVideoObjectName, 'users/alice/ai-video/projectsep1/director/final.mp4');
  assert.equal(data.payload.renderMeta.source, 'upload');
  assert.equal(data.payload.directorConfirmed.source, 'upload');
  // 포스트 프로덕션 타임라인·캔버스 통영상은 이 가상 시퀀스의 선택 테이크를 읽는다
  const seq = data.payload.sequences.find(s => s.source === 'upload');
  assert.equal(seq.status, 'confirmed');
  assert.equal(seq.takes[0].videoPath, gs('final.mp4'));
  assert.deepEqual(seq.selectedTakeIds, [seq.takes[0].id]);
  assert.equal(data.payload.story, '퍼즐 기사 소개', '스토리는 명시적으로 덮어쓴다');
  assert.equal(data.payload.topic, '런칭 영상');
  assert.equal(result.video, true);
});

test('영상 없이 이미지·스토리만: 이미지 컷 + upload 잠금, 대표 영상은 없다', () => {
  const { data } = applyFinalUpload(empty(), { bucket: BUCKET, title: '포스터', story: '소개', images: [gs('poster.png')] });
  assert.equal(data.scenes.length, 1);
  assert.equal(data.scenes[0].imagePath, gs('poster.png'));
  assert.equal(data.scenes[0].sceneBreak, undefined);
  assert.equal(data.payload.directorConfirmed.source, 'upload');
  assert.equal(data.payload.renderMeta, undefined);
});

test('컷이 있거나 이미 확정된 에피소드엔 넣지 않고, 빈 등록은 거절한다', () => {
  const withScenes = { ...empty(), scenes: [{ id: 1, title: '기존 컷' }] };
  assert.throws(() => applyFinalUpload(withScenes, { bucket: BUCKET, story: 'x' }), /scenes_exist/);
  const confirmed = { ...empty(), payload: { directorConfirmed: { confirmedAt: 'x', sequences: [] } } };
  assert.throws(() => applyFinalUpload(confirmed, { bucket: BUCKET, story: 'x' }), /scenes_exist/);
  assert.throws(() => applyFinalUpload(empty(), { bucket: BUCKET }), /final_upload_empty/);
});

test('서버·화면 연결: 경로 검증, 새 에피소드 분기, 잠금 안내, 오른쪽 아래 + 버튼', () => {
  const seqApi = read('prototype/functions/api/project/sequences.ts');
  assert.match(seqApi, /body\?\.op === "finalUpload"/);
  assert.match(seqApi, /final_upload_path_forbidden/);
  assert.match(seqApi, /roots\.some\(\(r\) => gs\.startsWith\(r\)\)/);
  const endpoint = read('prototype/functions/api/project/final-upload.ts');
  assert.match(endpoint, /const occupied = scenes\.length > 0 \|\| !!source\?\.payload\?\.directorConfirmed;/);
  assert.match(endpoint, /AGENT_TOOLS\.project_add_episode\.run\(\{ parentProjectId: projectId, episodeTitle: targetTitle \}/);
  assert.match(endpoint, /final_upload_shared_episode_occupied/);
  const lock = read('prototype/js/ui/director-lock.js');
  assert.match(lock, /c\.source === 'upload'/);
  assert.match(lock, /lock\.text = function \(payload\)/);
  const ui = read('prototype/js/ui/final-upload.js');
  assert.match(ui, /btn\.id = 'nk-final-upload-fab'/);
  assert.match(ui, /<path d="M5 12h14"\/><path d="M12 5v14"\/>/, 'Lucide plus, 글자 없음');
  assert.match(ui, /fetch\('\/api\/director\/media-url'/);
  assert.match(ui, /fetch\('\/api\/project\/final-upload'/);
  assert.match(ui, /nk:lang-changed/);
  // 한/영 문구 짝
  const ko = ui.slice(ui.indexOf('ko: {'), ui.indexOf('en: {'));
  const en = ui.slice(ui.indexOf('en: {'), ui.indexOf('function lang()'));
  const keys = s => (s.match(/^\s{6}(\w+):/gm) || []).map(k => k.trim().replace(':', '')).sort();
  assert.deepEqual(keys(ko), keys(en));
  const css = read('prototype/styles.css');
  assert.match(css, /\.nk-fu-fab \{[^}]*position: fixed;[^}]*right: 24px;[^}]*bottom: 24px;/s);
  assert.match(read('prototype/brand.html'), /js\/ui\/final-upload\.js\?v=/);
  assert.match(read('prototype/js/ui/brand-studio.js'), /brandStudio\.currentContext = \{/);
});

test('영상 생성 화면의 세션 칸은 내부 번호 대신 프로젝트 이름을 보여 준다', () => {
  const src = read('prototype/js/ui/ai-video-gen.js');
  assert.doesNotMatch(src, /makePill\(t\('sessionLabel'\), detached \? t\('noneLabel'\) : state\.sessionId\)/);
  assert.match(src, /project\.payload && project\.payload\.seriesTitle\) \|\| project\.title/);
});
