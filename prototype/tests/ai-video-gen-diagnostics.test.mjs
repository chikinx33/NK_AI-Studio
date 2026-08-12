import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// 배경: Seedance 2.0 I2V 가 사유 없이 "실패" 카드만 남기던 문제.
// 실패 사유가 화면·콘솔에 도달하는 경로와, 사유 없는 실패를 만들던 원인들을 고정한다.

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

const vgen = () => read('prototype/js/ui/ai-video-gen.js');
const videoApi = () => read('prototype/functions/api/video.ts');
const statusApi = () => read('prototype/functions/api/video/status.ts');

// ── P0: 실패 사유 노출 ────────────────────────────────────────

test('생성 시작 실패는 서버 detail·status 까지 결과에 보존한다', () => {
  const source = vgen();
  assert.match(source, /errorDetail: String\(detail \|\| ''\)\.slice\(0, 2000\)/);
  assert.match(source, /errorStatus: \(err && err\.status\) \|\| 0/);
  assert.match(source, /console\.error\('\[vgen\] start failed'/);
});

test('폴링 실패는 error 객체(code/message)를 펴서 보존한다', () => {
  const source = vgen();
  assert.match(source, /function readErrorMessage\(data\)/);
  assert.match(source, /function readErrorDetail\(data\)/);
  assert.match(source, /errorDetail: readErrorDetail\(data\)/);
});

test('상태 폴링 오류를 조용히 삼키지 않는다 (연속 3회면 실패 확정)', () => {
  const source = vgen();
  assert.doesNotMatch(source, /\.catch\(function \(\) \{ \/\* network hiccup, keep polling \*\/ \}\)/);
  assert.match(source, /consecutiveErrors\+\+/);
  assert.match(source, /if \(consecutiveErrors >= 3\)/);
  assert.match(source, /errorMessage: 'status_polling_failed'/);
});

test('타임아웃 문구는 사람이 읽을 수 있고 재시도를 허용한다', () => {
  const source = vgen();
  assert.match(source, /errorMessage: 'timeout\(' \+ mins \+ '분\)'/);
  assert.match(source, /canRetry: true/);
});

test('실패 카드는 사유를 본문에, 전문을 툴팁으로 보여준다', () => {
  const source = vgen();
  assert.match(source, /el\('p', 'vgen-result-error', errAttrs\)/);
  assert.match(source, /errAttrs\.title = tip/);
  assert.match(read('prototype/ai-video-gen-stage.html'), /\.vgen-result-error \{/);
});

test('새로고침 후 processing 카드는 폴링을 재개하거나 실패로 확정된다', () => {
  const source = vgen();
  assert.match(source, /if \(r\.jobId\) return; \/\/ 아래에서 폴링 재개/);
  assert.match(source, /errorMessage: t\('tracking_lost'\)/);
  assert.match(source, /if \(!r \|\| r\.status !== 'processing' \|\| !r\.jobId \|\| state\.polls\[r\.id\]\) return;/);
});

// ── P1: 이미지 크기 ──────────────────────────────────────────

test('업로드 이미지는 형식 검사 + 다운스케일을 거친다', () => {
  const source = vgen();
  assert.match(source, /function downscaleImageFile\(file, cb\)/);
  assert.match(source, /function acceptImageFile\(file, onReady\)/);
  assert.match(source, /mimes:\s*\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
  assert.match(source, /toDataURL\('image\/jpeg', 0\.9\)/);
  // 시작/끝 프레임과 레퍼런스 슬롯 모두 적용
  const uses = source.match(/acceptImageFile\(file, function \(dataUrl\)/g) || [];
  assert.ok(uses.length >= 2, `acceptImageFile 적용 위치가 부족합니다 (${uses.length})`);
  // 원본을 그대로 읽어 state 에 넣던 경로가 남아 있지 않다
  assert.doesNotMatch(source, /state\.startImageUrl = ev\.target\.result/);
  assert.doesNotMatch(source, /state\.referenceUrls\[idx\] = ev\.target\.result/);
});

// ── P6: 공급자 이미지 제약 게이트 ─────────────────────────────
// Atlas 는 변 길이 300~6000px, 종횡비 0.4~2.5 를 요구한다. 긴 변만 맞추면
// 가로로 긴 이미지의 짧은 변이 300 아래로 떨어져 조용히 거부당한다.

test('축소 배율은 짧은 변 하한을 긴 변 상한보다 먼저 보장한다', () => {
  const source = vgen();
  assert.match(source, /function targetScale\(w, h\)/);
  assert.match(source, /if \(shortEdge \* scale < IMAGE_SPEC\.minEdge\) scale = IMAGE_SPEC\.minEdge \/ shortEdge;/);
  assert.match(source, /if \(longEdge \* scale > IMAGE_SPEC\.maxEdge\) scale = IMAGE_SPEC\.maxEdge \/ longEdge;/);
  // 짧은 변 보정이 긴 변 상한보다 먼저 와야 상한이 최종적으로 이긴다
  assert.ok(
    source.indexOf('IMAGE_SPEC.minEdge / shortEdge') < source.indexOf('IMAGE_SPEC.maxEdge / longEdge'),
    '짧은 변 보정이 긴 변 상한보다 뒤에 있습니다'
  );
});

test('통과 경로도 용량이 아니라 치수로 판정한다', () => {
  const source = vgen();
  assert.match(source, /function fitsSpecAsIs\(w, h, chars\)/);
  assert.match(source, /shortEdge >= IMAGE_SPEC\.minEdge/);
  assert.match(source, /longEdge <= Math\.min\(IMAGE_SPEC\.maxEdge, IMAGE_MAX_EDGE\)/);
  // 용량만 보고 통과시키던 예전 경로가 남아 있지 않다
  assert.doesNotMatch(source, /IMAGE_PASSTHRU_CHARS/);
});

test('지원 범위를 벗어난 종횡비는 업로드 시점에 거부한다', () => {
  const source = vgen();
  assert.match(source, /if \(ratio < IMAGE_SPEC\.minRatio \|\| ratio > IMAGE_SPEC\.maxRatio\)/);
  assert.match(source, /t\('image_ratio_alert'\)/);
  assert.match(source, /가로세로 비율이 모델 지원 범위\(0\.4~2\.5\)/);
  assert.match(source, /aspect ratio is outside the supported range \(0\.4–2\.5\)/);
});

test('과도한 업스케일은 진행 여부를 묻는다', () => {
  const source = vgen();
  assert.match(source, /UPSCALE_WARN_FACTOR = 2/);
  assert.match(source, /if \(scale > UPSCALE_WARN_FACTOR\)/);
  assert.match(source, /window\.confirm\(t\('image_upscale_confirm'\)/);
});

test('이미지 검사는 함수 하나로 두고 슬롯이 그것만 호출한다', () => {
  const source = vgen();
  // 게이트 로직(종횡비/치수)은 downscaleImageFile 안에만 있어야 한다
  const gateHits = source.match(/IMAGE_SPEC\.minRatio/g) || [];
  assert.equal(gateHits.length, 1, '종횡비 검사가 여러 곳에 복제됐습니다');
  const scaleHits = source.match(/function targetScale/g) || [];
  assert.equal(scaleHits.length, 1);
});

test('서버는 모델 상한(30MB)을 넘는 이미지를 400 으로 반려한다', () => {
  const source = videoApi();
  assert.match(source, /if \(bytes\.byteLength > IMAGE_SPEC\.maxBytes\)/);
  assert.match(source, /image_too_large_for_model/);
  assert.match(source, /return json\(\{ error: "image_too_large_for_model"/);
});

// ── P7: 재시도 UX ────────────────────────────────────────────

test('스냅샷이 없으면 재시도 버튼이 무엇이 복원되는지 알린다', () => {
  const source = vgen();
  assert.match(source, /var hasSnap = !!_retryInputs\[r\.id\];/);
  assert.match(source, /hasSnap \? t\('retry'\) : t\('retry_settings_only'\)/);
});

test('이미지가 필요한데 스냅샷이 없으면 생성 대신 안내·포커스', () => {
  const source = vgen();
  assert.match(source, /if \(!snap && requiredInputMissing\(\)\) \{/);
  assert.match(source, /focusImageSlot\(\);/);
  assert.match(source, /window\.alert\(t\('retry_no_image'\)\)/);
  // 생성 필수 입력 판정은 한 곳에서만 (생성 버튼과 재시도가 같은 규칙)
  assert.match(source, /function requiredInputMissing\(\)/);
  assert.match(source, /var missingKey = requiredInputMissing\(\);/);
});

// ── P8: 미러링 스킵 표시 ─────────────────────────────────────

test('미러링을 건너뛴 결과는 완료로 위장하지 않는다', () => {
  const source = vgen();
  assert.match(source, /mirrored: !!objectName/);
  assert.match(source, /r\.status === 'done' && r\.mirrored === false/);
  assert.match(source, /t\('badge_temp_link'\)/);
  assert.match(read('prototype/ai-video-gen-stage.html'), /\.vgen-badge--temp \{/);
});

test('임시 링크 결과는 mount 때 재-미러링을 1회 시도한다', () => {
  const source = vgen();
  assert.match(source, /function tryRemirror\(r\)/);
  assert.match(source, /if \(_remirrorTried\[r\.id\]\) return;/);
  assert.match(source, /_remirrorTried\[r\.id\] = true;/);
  // 성공하면 objectName 을 채우고 뱃지를 없앤다
  assert.match(source, /updateResult\(r\.id, \{ videoObjectName: objectName, rawVideoUrl: rawUrl, mirrored: true \}\)/);
  assert.match(source, /state\.results\.forEach\(tryRemirror\);/);
});

// ── 지원 길이 안내 ───────────────────────────────────────────

test('모델 설명에 지원 길이를 표에서 만들어 붙인다', () => {
  const source = vgen();
  assert.match(source, /function durationNote\(\)/);
  assert.match(source, /desc \+ ' ' \+ durationNote\(\)/);
  assert.match(source, /'\(지원 길이: ' \+ list \+ '초\)'/);
  assert.match(source, /'\(Supported lengths: ' \+ list \+ 's\)'/);
});

test('base64 디코드는 청크 단위다 (Worker 1102 방지)', () => {
  const source = videoApi();
  assert.match(source, /const CHUNK = 8192;/);
  assert.match(source, /for \(let i = 0; i < len; i \+= CHUNK\)/);
});

test('과대 이미지는 워커를 죽이는 대신 400 image_too_large 로 반려한다', () => {
  const source = videoApi();
  assert.match(source, /error: "image_too_large"/);
  assert.match(source, /MAX_IMAGE_DATA_URL_CHARS/);
  // 시작/끝/레퍼런스 모두 검사
  assert.match(source, /field: "endImageDataUrl"/);
  assert.match(source, /referenceImages\.map\(\(v, i\) => \(\{ field: `referenceImages\[\$\{i\}\]`/);
});

// ── P2: MIME ────────────────────────────────────────────────

test('업로드 이미지의 실제 mime 으로 확장자·Content-Type 을 정한다', () => {
  const source = videoApi();
  assert.match(source, /const mimeMatch = \/\^data:\(\[\^;,\]\+\)\[;,\]\/\.exec\(src\)/);
  assert.match(source, /mime === "image\/jpeg" \? "jpg" : mime === "image\/webp" \? "webp" : "png"/);
  assert.match(source, /"Content-Type": mime/);
  // png 로 고정하던 예전 코드가 남아 있지 않다
  assert.doesNotMatch(source, /"Content-Type": "image\/png"/);
  assert.doesNotMatch(source, /\$\{stamp\}-\$\{suffix\}\.png/);
});

test('지원하지 않는 이미지 형식은 500 이 아니라 400 으로 알려준다', () => {
  const source = videoApi();
  assert.match(source, /unsupported_image_mime/);
  assert.match(source, /return json\(\{ error: "unsupported_image_mime", detail: mimeErr\[1\] \}, 400\)/);
});

// ── P3: Seedance 파라미터/거부 사유 ───────────────────────────

test('seedance 요청 파라미터를 로그로 남기고 거부 사유를 그대로 전달한다', () => {
  const source = videoApi();
  assert.match(source, /log\('seedance_request', \{/);
  assert.match(source, /hasImage: !!imageUrl/);
  assert.match(source, /log\('seedance_rejected'/);
  assert.match(source, /allowedDurations: allowedDurationsFor\("seedance"\)/);
  assert.match(source, /sent: \{ duration: seedanceDuration/);
});

// ── P4: 미러링 실패 처리 ─────────────────────────────────────

test('seedance 미러링 실패는 영구 실패가 아니라 processing 으로 재시도한다', () => {
  const source = statusApi();
  const branch = source.slice(source.indexOf('if (isSeedance) {'), source.indexOf('if (isKling) {'));
  assert.ok(branch.length > 0, 'seedance 분기를 찾지 못했습니다');
  assert.match(branch, /if \(flattenFailed\) \{[\s\S]*?status: 'processing'/);
  // flattenFailed 를 곧바로 error 로 확정하던 예전 규칙이 사라졌다
  assert.doesNotMatch(branch, /flattenFailed\) \? 'done' : 'error'/);
  assert.doesNotMatch(branch, /mirror_failed/);
});

test('대용량 원본은 미러링을 건너뛰고 원본 URL 을 재생에 쓴다', () => {
  const source = statusApi();
  assert.match(source, /MAX_MIRROR_BYTES/);
  assert.match(source, /log\('flatten_skipped_too_large'/);
  assert.match(source, /return sourceUrl;/);
  // 미러 실패 진단: 호스트·상태·크기를 남긴다
  assert.match(source, /log\('flatten_source_failed', \{[\s\S]*?contentLength/);
  assert.match(source, /function safeHost\(url: string\)/);
});

test('프론트는 objectName 이 없는 결과도 원본 URL 로 재생한다', () => {
  const source = vgen();
  assert.match(source, /return \/\^https\?:\\\/\\\/\/i\.test\(r\.rawVideoUrl \|\| ''\) \? r\.rawVideoUrl : '';/);
  assert.match(source, /var rDirectUrl =/);
});

// ── P5: 타임아웃 정책 ────────────────────────────────────────

test('느린 모델은 폴링 한도를 20분으로 늘린다', () => {
  const source = vgen();
  assert.match(source, /MAX_POLL_ATTEMPTS_SLOW = 300/);
  assert.match(source, /SLOW_MODELS = \['seedance', 'seedance-r2v', 'wan', 'vidu-q3'\]/);
  assert.match(source, /var maxAttempts = maxPollAttemptsFor\(\(meta && meta\.model\) \|\| ''\)/);
});

test('실패 카드의 다시 시도는 같은 입력으로 재요청한다', () => {
  const source = vgen();
  assert.match(source, /function retryResult\(id\)/);
  assert.match(source, /_retryInputs\[resultId\] = \{/);
  assert.match(source, /action === 'retry-result'/);
  assert.match(source, /startGeneration\(\);/);
});
