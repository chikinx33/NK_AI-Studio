import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { splitStoragePath, cleanCutStill, cleanReferenceAsset } from "../functions/api/_shared/director-media-path.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const P = "users/limfactory/ai-video/projectsx/image/1791912611227-codex-634d.png";

test("스틸 경로 뒤에 붙은 메모를 떼어 stillNote 로 옮긴다(세모 시퀀스 깨진 스틸 재현)", () => {
  assert.deepEqual(splitStoragePath(`${P} (v3, 사용자 확인 대기)`), { path: P, note: "v3, 사용자 확인 대기" });
  assert.deepEqual(splitStoragePath(`gs://b/${P}`), { path: `gs://b/${P}`, note: "" });
  assert.deepEqual(splitStoragePath("컷/C05.png"), { path: "컷/C05.png", note: "" });
  const cut = cleanCutStill({ id: "C07", stillUrl: `${P} (사용자 승인)` });
  assert.equal(cut.stillUrl, P);
  assert.equal(cut.stillNote, "사용자 승인");
  assert.deepEqual(cleanCutStill({ id: "C01" }), { id: "C01" });
  const ref = cleanReferenceAsset({ asset: `gs://b/${P} — crop`, role: "x" });
  assert.equal(ref.asset, `gs://b/${P}`);
  assert.equal(ref.note, "crop");
});

test("시퀀스 저장·읽기 모두 스틸·참조 경로를 정리한다", () => {
  const src = read("prototype/functions/api/project/sequences.ts");
  assert.match(src, /import \{ cleanCutStill, cleanReferenceAsset \} from "\.\.\/_shared\/director-media-path\.js"/);
  assert.match(src, /cuts: Array\.isArray\(seq\.cuts\) \? seq\.cuts\.map\(cleanCutStill\) : \[\]/);
  assert.match(src, /\.map\(readableSequence\)/);
});

test("디렉터 대화창: 저장소 영상 경로를 그 자리에서 재생한다", () => {
  const md = read("ai-company-app/src/components/Markdown.tsx");
  // ![설명](gs://….mp4) 이미지 문법 → <video>
  assert.match(md, /if \(VIDEO_EXT_RE\.test\(String\(src \|\| ""\)\)\) return <VideoPlayer src=\{url\}/);
  // 인라인 코드 `gs://….mp4` 로 와도 플레이어를 붙인다(이번 드래프트 보고가 이 형식이었다)
  assert.match(md, /if \(isStorageVideoPath\(raw\)\)/);
  assert.match(md, /<video src=\{src\} controls preload="metadata"/);
  const re = /^(gs:\/\/[^/\s]+\/|users\/)\S+\.(mp4|webm|mov|m4v)$/i;
  assert.ok(re.test("gs://nkstudio-video-out/users/limfactory/ai-video/p/videos/take-d1-61174a1816f08ab5.mp4"));
  assert.ok(!re.test("gs://b/users/a/x.png"));
  assert.ok(md.includes(String.raw`const STORAGE_VIDEO_RE = /^(gs:\/\/[^/\s]+\/|users\/)\S+\.(mp4|webm|mov|m4v)$/i;`));
});

test("디렉터 규칙: 모든 컷 스틸 필수 + 영상은 이미지 문법으로 보여 준다", () => {
  const system = read("director/agent/system.md");
  assert.ok(system.includes("영상은 콘티의 모든 컷에 스틸이 채워진 뒤에만 만든다"));
  assert.ok(system.includes("stillUrl 에는 절대 붙이지 않는다"));
  assert.ok(system.includes("`![설명](gs://….mp4)`"));
  const skill = read("director/skills/nk-cf-director/SKILL.md");
  assert.ok(skill.includes("모든 컷에 스틸을 만든다(필수)"));
  const tools = read("director/src/mcp/tools.ts");
  assert.ok(tools.includes("const gate = stillsGate(seq, a.referenceImages, a.kind, a.replacesCuts);"));
});
