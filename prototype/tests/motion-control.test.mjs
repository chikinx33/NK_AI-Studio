// 모션 컨트롤(Kling 3.0 Motion Control via Atlas Cloud, 2026-09-28 스키마) — AI 영상 Motion Control 탭.
// 핵심 계약:
//  1) 캐릭터 이미지(JPG·PNG) + 동작 영상(MP4·MOV, 3~30초, 10MB 이하) → image·video·character_orientation·keep_original_sound.
//  2) 결과 길이 = 동작 영상 길이. 과금은 클라이언트 값이 아니라 올라온 영상 파일(moov/mvhd)에서 읽은 길이로 한다.
//  3) 이미지 방향 유지(character_orientation=image)는 영상 10초까지, 영상 방향 따라가기는 30초까지.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KLING_MOTION_MODELS, MOTION_SPEC, checkMotionInputs, dataUrlVideoSeconds, isKlingMotionModel, mp4DurationSeconds,
  withMeasuredMotionSeconds,
} from '../functions/api/_shared/motion-control.js';
import { quoteCredits } from '../functions/api/_shared/credit-rates.js';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const front = read('prototype/js/ui/ai-video-gen.js');
const videoTs = read('prototype/functions/api/video.ts');
const statusTs = read('prototype/functions/api/video/status.ts');

// ── 최소 mp4 만들기 ─────────────────────────────────────────
function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}
function mvhdV0(timescale, duration) {
  const b = Buffer.alloc(100);
  b.writeUInt32BE(0, 0); // version 0 + flags
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
}
function mvhdV1(timescale, duration) {
  const b = Buffer.alloc(112);
  b.writeUInt8(1, 0);
  b.writeUInt32BE(timescale, 20);
  b.writeUInt32BE(Math.floor(duration / 4294967296), 24);
  b.writeUInt32BE(duration >>> 0, 28);
  return box('mvhd', b);
}
const ftyp = box('ftyp', Buffer.from('isom\0\0\x02\0isomiso2mp41', 'latin1'));
const mdat = box('mdat', Buffer.alloc(64));
const toDataUrl = (buf, mime = 'video/mp4') => `data:${mime};base64,${buf.toString('base64')}`;

test('mp4·mov 길이를 moov/mvhd 에서 읽는다(v0·v1·moov 가 끝에 있어도·fMP4 mehd)', () => {
  assert.equal(mp4DurationSeconds(new Uint8Array(Buffer.concat([ftyp, box('moov', mvhdV0(1000, 12345)), mdat]))), 12.345);
  // 휴대폰 녹화처럼 moov 가 mdat 뒤에 있는 파일
  assert.equal(mp4DurationSeconds(new Uint8Array(Buffer.concat([ftyp, mdat, box('moov', mvhdV1(600, 600 * 7))]))), 7);
  // 조각난 mp4: mvhd duration 0 → mvex/mehd
  const mehd = Buffer.alloc(8); mehd.writeUInt32BE(0, 0); mehd.writeUInt32BE(9000, 4);
  const frag = Buffer.concat([ftyp, box('moov', mvhdV0(1000, 0), box('mvex', box('mehd', mehd)))]);
  assert.equal(mp4DurationSeconds(new Uint8Array(frag)), 9);
  assert.equal(mp4DurationSeconds(new Uint8Array(Buffer.from('not a video at all'))), 0);
  assert.equal(dataUrlVideoSeconds(toDataUrl(Buffer.concat([ftyp, box('moov', mvhdV0(1000, 4200))]), 'video/quicktime')), 4.2);
  assert.equal(dataUrlVideoSeconds(''), 0);
});

test('입력 규격: 형식·용량·길이(방향별 상한)를 업로드 전에 이유와 함께 거부한다', () => {
  const ok = { imageMime: 'image/png', videoMime: 'video/mp4', videoBytes: 5_000_000, videoSeconds: 12, orientation: 'video' };
  assert.deepEqual(checkMotionInputs(ok), { ok: true, orientation: 'video', seconds: 12 });
  assert.equal(checkMotionInputs({ ...ok, orientation: 'image' }).error, 'motion_video_duration');
  assert.equal(checkMotionInputs({ ...ok, orientation: 'image', videoSeconds: 10 }).ok, true);
  assert.equal(checkMotionInputs({ ...ok, videoSeconds: 30 }).ok, true);
  assert.equal(checkMotionInputs({ ...ok, videoSeconds: 31 }).error, 'motion_video_duration');
  assert.equal(checkMotionInputs({ ...ok, videoSeconds: 2.5 }).error, 'motion_video_duration');
  assert.equal(checkMotionInputs({ ...ok, videoSeconds: 0 }).error, 'motion_video_unreadable');
  assert.equal(checkMotionInputs({ ...ok, imageMime: 'image/webp' }).error, 'motion_image_type');
  assert.equal(checkMotionInputs({ ...ok, imageMime: '' }).error, 'motion_image_required');
  assert.equal(checkMotionInputs({ ...ok, videoMime: 'video/webm' }).error, 'motion_video_type');
  assert.equal(checkMotionInputs({ ...ok, videoBytes: 11 * 1024 * 1024 }).error, 'motion_video_too_large');
  // 알 수 없는 방향 값은 영상 방향(기본)으로
  assert.equal(checkMotionInputs({ ...ok, orientation: 'sideways' }).orientation, 'video');
});

test('과금은 올라온 영상에서 읽은 길이로 한다(클라이언트가 적은 길이보다 우선)', () => {
  const video = toDataUrl(Buffer.concat([ftyp, box('moov', mvhdV0(1000, 12300)), mdat]));
  // credits.ts withCreditCharge 가 예약 전에 이 변환을 거친다
  const charge = (body) => quoteCredits('video', withMeasuredMotionSeconds('video', body), {});
  const pro = charge({ videoModel: 'kling-motion-pro', durationSeconds: 3, videoDataUrl: video });
  assert.equal(pro.basis.durationSeconds, 13);
  assert.equal(pro.credits, 13 * 15);
  assert.equal(charge({ videoModel: 'kling-motion-std', durationSeconds: 3, videoDataUrl: video }).credits, 13 * 11);
  assert.match(read('prototype/functions/api/_shared/credits.ts'), /quoteCredits\(options\.feature, withMeasuredMotionSeconds\(options\.feature, body\), env\)/);
  // 견적(영상 없음)은 브라우저가 잰 길이, 최소 3초
  assert.equal(quoteCredits('video', { videoModel: 'kling-motion-pro', durationSeconds: 8 }, {}).credits, 8 * 15);
  assert.equal(quoteCredits('video', { videoModel: 'kling-motion-pro', durationSeconds: 1 }, {}).credits, 3 * 15);
  // 다른 모델은 영상이 있어도 기존대로 durationSeconds
  assert.equal(charge({ videoModel: 'minimax-h3', durationSeconds: 6, videoDataUrl: video }).credits, 24);
});

test('프론트 미러(단가·규격)가 서버 SSOT 와 같다', () => {
  for (const [id, spec] of Object.entries(KLING_MOTION_MODELS)) {
    assert.match(front, new RegExp(`'${id}': ${spec.usdPerSecond}`), `${id} 단가 미러`);
    assert.match(front, new RegExp(`id: '${id}', label: '${spec.label}', t2v: false, i2v: false, motion: true, caps: \\['start', 'video'\\]`));
    assert.ok(isKlingMotionModel(id));
  }
  assert.match(front, new RegExp(`maxBytes:\\s+10 \\* 1024 \\* 1024`));
  assert.match(front, new RegExp(`minSeconds: ${MOTION_SPEC.minSeconds},`));
  assert.match(front, new RegExp(`maxSeconds: \\{ video: ${MOTION_SPEC.maxSeconds.video}, image: ${MOTION_SPEC.maxSeconds.image} \\}`));
  assert.match(front, /videoMimes: \['video\/mp4', 'video\/quicktime'\]/);
});

test('AI 영상: Motion Control 탭·캐릭터/동작 영상 칸·방향·원본 소리·프롬프트 선택', () => {
  assert.match(front, /\.concat\(\['motion'\]\)/);
  assert.match(front, /if \(state\.mode === 'motion'\) return !!m\.motion;/);
  assert.match(front, /renderMotionVideoSlot\(\)/);
  assert.match(front, /payload\.characterOrientation = state\.motionOrientation;/);
  assert.match(front, /payload\.keepOriginalSound = !!state\.motionKeepSound;/);
  assert.match(front, /payload\.imageDataUrl = await toJpegIfWebp\(state\.startImageUrl\);/);
  assert.match(front, /if \(!prompt && !isMotion\)/);
  // 한/영 문구가 짝으로 있다
  const keys = [...front.matchAll(/^\s{6}(motion_[a-z_]+|tab_motion):/gm)].map((m) => m[1]);
  for (const key of new Set(keys)) {
    assert.equal(keys.filter((k) => k === key).length, 2, `${key} 는 ko·en 둘 다 있어야 합니다`);
  }
  assert.ok(keys.length >= 30);
  // 모델 가이드에 두 모델이 한/영으로 있다
  assert.equal((front.match(/'kling-motion-pro': \{ best:/g) || []).length, 2);
  assert.equal((front.match(/'kling-motion-std': \{ best:/g) || []).length, 2);
});

test('서버: 규격 검사 → 업로드 → 공급자 호출, 상태 조회는 Atlas 공용 경로', () => {
  const branch = videoTs.slice(videoTs.indexOf('if (isKlingMotionModel(videoModel)) {'));
  assert.ok(branch.indexOf('checkMotionInputs(') < branch.indexOf('toAtlasImageUrl('), '업로드 전에 규격을 검사해야 합니다');
  assert.match(branch, /character_orientation: check\.orientation/);
  assert.match(branch, /keep_original_sound: keepOriginalSound/);
  assert.match(branch, /job_id: `kling-motion:\$\{predictionId\}`/);
  // 다른 모델용 '입 다물기' 지시를 붙이지 않는다
  assert.match(branch, /const motionPrompt = String\(promptText \|\| ""\)\.trim\(\);/);
  assert.match(statusTs, /'kling-motion:': 'kling-motion:'/);
  assert.match(statusTs, /isMinimax \|\| isKlingMotion \|\| isAtlasGrok/);
});

test('Atlas 가 실패 작업 조회에 HTTP 500 을 줘도 본문 상태(failed)로 처리해 이유를 보이고 크레딧 예약을 푼다', () => {
  assert.match(statusTs, /function atlasPredictionStatus\(body: any\): string \{/);
  // Seedance·Kling·Veo·공용(Atlas 계열) 네 조회 모두. 직접 xAI 조회는 대상이 아니다.
  assert.equal((statusTs.match(/if \(!res\.ok && !atlasPredictionStatus\((?:json|jsonBody)\)\) \{/g) || []).length, 4);
  const atlasLookups = statusTs.split('api.atlascloud.ai/api/v1/model/prediction/').slice(1);
  assert.equal(atlasLookups.length, 4);
  for (const chunk of atlasLookups) {
    assert.match(chunk.slice(0, 400), /if \(!res\.ok && !atlasPredictionStatus\(/, 'Atlas 조회는 본문 상태를 먼저 본다');
  }
  // 앱: '조회 실패' 카드는 다시 열면 조회를 재개한다(결말이 아니므로)
  assert.match(front, /r\.errorMessage !== 'status_polling_failed' \|\| !r\.jobId\) return;\s*updateResult\(r\.id, \{ status: 'processing'/);
});
