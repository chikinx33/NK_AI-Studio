import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 2026-10-18 엔케 결정: 에이전트가 대화 첨부·업무 폴더의 완성 이미지·영상을 '완성 콘텐츠'로 등록하고(SNS 세팅 '+' 와 같은 결과)
// SNS 세팅 포맷·초안까지 저장(승인 1번), 발행은 따로(승인 2번). 결과는 SNS 세팅 배포 이력에도 남는다.
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const esbuild = createRequire(import.meta.url)('../../ai-company-app/node_modules/esbuild');
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const code = esbuild.transformSync(source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];[ \t]*$/gm, ''), { loader: 'ts', format: 'cjs' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, Uint8Array, ...deps });
  return module.exports;
}
const ingest = evaluate(read('prototype/functions/api/_shared/media-ingest.ts'));
const records = evaluate(read('prototype/functions/api/_shared/publish-records.ts'));

// ─── 가짜 MP4 만들기 ───
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type, body) => [...be32(8 + body.length), ...[...type].map(c => c.charCodeAt(0)), ...body];
function mvhd(timescale, duration) { return box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(timescale), ...be32(duration), ...new Array(80).fill(0)]); }
function tkhd(w, h, rotated) {
  const matrix = rotated
    ? [...be32(0), ...be32(0x10000), ...be32(0), ...be32(0xffff0000 >>> 0), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)]
    : [...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x10000), ...be32(0), ...be32(0), ...be32(0), ...be32(0x40000000)];
  return box('tkhd', [0, 0, 0, 3, ...new Array(20).fill(0), ...new Array(8).fill(0), ...new Array(8).fill(0), ...matrix, ...be32(w * 65536), ...be32(h * 65536)]);
}
function mp4({ seconds, w, h, rotated = false, moovLast = true }) {
  const ftyp = box('ftyp', [...'isom'].map(c => c.charCodeAt(0)).concat(be32(0)));
  const mdat = box('mdat', new Array(200000).fill(1));
  const moov = box('moov', [...mvhd(1000, seconds * 1000), ...box('trak', [...tkhd(0, 0, false)]), ...box('trak', [...tkhd(w, h, rotated)])]);
  return Uint8Array.from(moovLast ? [...ftyp, ...mdat, ...moov] : [...ftyp, ...moov, ...mdat]);
}
const reader = (bytes) => { const calls = []; return { calls, read: async (s, n) => { calls.push([s, n]); return bytes.slice(s, s + n); } }; };

test('MP4 머리에서 길이·비율을 읽는다(moov 가 끝에 있어도, 세로 촬영 회전도)', async () => {
  const a = mp4({ seconds: 28.4, w: 1080, h: 1920 });
  const r = reader(a);
  const meta = await ingest.readMp4MetaWith(r.read, a.length);
  assert.equal(meta.durationSec, 28.4);
  assert.equal(meta.aspectRatio, '9:16');
  assert.ok(r.calls.length <= 4, `범위 요청은 몇 번이면 된다(실제 ${r.calls.length})`);
  // 휴대폰 세로 영상: 1920x1080 으로 저장하고 90° 회전 표시
  const b = mp4({ seconds: 75, w: 1920, h: 1080, rotated: true, moovLast: false });
  const meta2 = await ingest.readMp4MetaWith(reader(b).read, b.length);
  assert.equal(meta2.durationSec, 75);
  assert.equal(meta2.aspectRatio, '9:16');
  const c = mp4({ seconds: 90, w: 1920, h: 1080 });
  assert.equal((await ingest.readMp4MetaWith(reader(c).read, c.length)).aspectRatio, '16:9');
  assert.equal(await ingest.readMp4MetaWith(reader(Uint8Array.from([1, 2, 3])).read, 3), null);
});

test('발행 기록은 SNS 세팅과 같은 모양이고, 같은 id 는 덮고 새 id 는 덧붙인다', () => {
  const row = records.buildPublishRow({ platform: 'instagram', status: 'published', postId: 'ig1', url: 'https://instagram.com/p/ig1',
    caption: '안녕', hashtags: ['#모양새'], projectId: 'ep2', projectTitle: 'EP02', brandId: 'shape', payload: { purposeCategory: '키즈 · 영유아' } }, '2026-10-18T00:00:00.000Z');
  assert.equal(row.id, 'instagram_ig1');
  assert.equal(row.delivery, 'auto');
  assert.equal(row.channelType, 'instagram');
  assert.equal(row.sourceScope, 'agent');
  assert.equal(row.purposeCategory, '키즈 · 영유아');
  const sched = records.buildPublishRow({ platform: 'x', status: 'scheduled', scheduledJobId: 'job-1', projectId: 'ep2' });
  assert.equal(sched.id, 'x_sched_job-1');
  const merged = records.mergePublishRows([{ id: 'instagram_ig1', status: 'scheduled' }, { id: 'old' }], [row, sched]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].status, 'published');
});

test('에이전트 도구·발행·대화창이 연결돼 있다', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  // 등록+초안 = 승인 1번(gate), 발행 = 승인 2번(publish gate)
  assert.match(shared, /content_register: \{ agentId: "reach", agentIds: \[[^\]]*\], kind: "external", gate: true, run: runContentRegisterTool \}/);
  assert.match(shared, /publish: \{ agentId: "reach", kind: "external", gate: true, prepare: preparePublishInput, run: runPublishTool \}/);
  // 원본은 프로젝트 저장소로 복사, 영상 길이는 파일 머리에서, 등록은 final-upload 로
  assert.match(shared, /await copyGcsObject\(ctx\.env, src, dst\)/);
  assert.match(shared, /await readMp4Meta\(ctx\.env, obj\)/);
  assert.match(shared, /callInternalJson\(ctx, "\/api\/project\/final-upload"/);
  // SNS 세팅 칸에 포맷·초안·자산 저장(배포 화면과 같은 키)
  assert.match(shared, /brandStudioSelectedFormats: formats,\s*brandStudioFormatDrafts: drafts,\s*brandStudioSelectedAssetIds: assetIds,/);
  assert.match(shared, /callInternalJson\(ctx, "\/api\/draft-generate"/);
  // 본인 저장소·대화 첨부·업무 폴더만
  assert.match(shared, /본인 저장소의 파일만 등록할 수 있어요/);
  // 발행: 에피소드 지목이면 저장된 포맷·초안·자산을 쓰고 결과를 SNS 세팅 기록에 남긴다
  assert.match(shared, /if \(input\?\.projectId && !input\?\._episode\) input = await withEpisodePublishContext\(input, ctx\);/);
  assert.match(shared, /await appendPublishRecords\(ctx\.env, ctx\.userId, episode\.projectId, episode\.brandId, rows\)/);
  // 유튜브 일반은 쇼츠가 아니다
  assert.match(shared, /isShorts: platform === "youtube-shorts" \|\| \(platform !== "youtube" && /);
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.match(orch, /content_register: `\[\[RUN: content_register \|/);
  assert.match(orch, /먼저 video_describe 로 영상을 보고/);
  assert.match(orch, /video_describe: `\[\[RUN: video_describe \|/);
  assert.match(orch, /content_register: "완성 콘텐츠 등록·SNS 초안"/);
  const chat = read('ai-company-app/src/components/Chat.tsx');
  assert.match(chat, /const VIDEO_MIME = \["video\/mp4", "video\/quicktime"\];/);
  assert.match(chat, /uploadCompanyFile\(path, file\)/);
  assert.match(chat, /onAddReference\(\{ kind: "file", path: String\(entry\?\.path \|\| path\), title: file\.name, mediaKind: "video" \}\)/);
  assert.match(read('ai-company-app/src/App.tsx'), /onAddReference=\{\(ref\) => addChatReference\(ref, false\)\}/);
});
