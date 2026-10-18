import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * 네이버 블로그 반자동 동선(2026-10-18).
 *
 * 네이버는 블로그 글쓰기 API 를 2020 년에 닫았다. 그래서 우리는 서버에서 올리지 않는다 —
 * 원고를 만들고, 사용자가 [본문 복사]·[이미지 N 복사]·[이미지 모두 받기]·[블로그 글쓰기 열기]로
 * 직접 붙여 넣고, 배포 카드의 [배포 완료]에 올린 글 주소를 남긴다.
 * 네이버 아이디·비밀번호를 받아 대신 올리는 자동화는 하지 않는다.
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/^﻿/, "");

const server = await import("../functions/api/_shared/naver-blog-draft.js");

function loadClassic(file) {
  const ctx = vm.createContext({ URL });
  vm.runInContext(read(file), ctx);
  return ctx;
}
const { NKNaverBlogDraft: conv } = loadClassic("prototype/js/ui/naver-blog-draft.js");
const { NKFormatMedia: M } = loadClassic("prototype/js/ui/format-media-spec.js");

function loadPrompt(id) {
  const src = read("prototype/functions/api/draft-generate.js");
  const at = src.indexOf("const PLATFORM_PROMPTS = {");
  let depth = 0;
  let i = src.indexOf("{", at);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) break;
  }
  const ctx = vm.createContext({});
  vm.runInContext(`globalThis.__p = ${src.slice(from, i + 1)}`, ctx);
  return ctx.__p[id];
}

// ── 원고 프롬프트 규칙 ──────────────────────────────────────────────────────

test("원고 프롬프트: 제목·본문 표시·태그 8~10개·이미지 자리를 요구한다", () => {
  const p = loadPrompt("naver-blog");
  assert.ok(p, "naver-blog 프롬프트가 없다");
  assert.match(p, /"title"/);
  assert.match(p, /"caption":"도입 단락/, "본문은 화면이 읽는 caption 키로 받는다");
  assert.match(p, /"hashtags"/);
  assert.match(p, /## /, "소제목 표시");
  assert.match(p, /\*\*/, "굵게 표시");
  assert.match(p, /줄 맨 앞에 "- "/, "목록 표시");
  assert.match(p, /\[이미지 N\]/, "첨부 이미지 자리");
  assert.match(p, /8~10개/);
  assert.match(p, /금칙어/);
});

test("원고 프롬프트: 대구 슬로건·상투어·pages.dev 를 막고 링크는 구글 플레이·elidus.org 만", () => {
  const p = loadPrompt("naver-blog");
  assert.match(p, /대구/);
  assert.match(p, /상투어/);
  assert.match(p, /pages\.dev/);
  assert.match(p, /play\.google\.com/);
  assert.match(p, /elidus\.org/);
  // 예전 프롬프트는 상투어를 '친근한 블로그체'로 권장했다. 금지 목록 밖에서 권장하면 안 된다.
  const forbidLine = p.split("\n").find((l) => l.includes("상투어"));
  for (const cliche of ["오늘은요~", "그런데 말이죠", "어떠셨나요?"]) {
    assert.equal(p.split(cliche).length - 1, 1, `${cliche} 는 금지 목록에만 있어야 한다`);
    assert.ok(forbidLine.includes(cliche));
  }
});

test("원고 프롬프트: 영상 길이·장면 시각을 지어내지 않는다", () => {
  const p = loadPrompt("naver-blog");
  assert.match(p, /영상 길이/);
  assert.match(p, /장면 시각/);
  assert.match(p, /지어내지 않는다/);
});

test("서버: 네이버 블로그만 이미지 장수를 프롬프트에 싣고, 결과를 후처리한 뒤 금칙어를 거른다", () => {
  const src = read("prototype/functions/api/draft-generate.js");
  assert.match(src, /import \{ finalizeNaverBlogDraft \} from "\.\/_shared\/naver-blog-draft\.js"/);
  assert.match(src, /imageCount/);
  const fin = src.indexOf("finalizeNaverBlogDraft(parsed");
  const banned = src.indexOf("서버 사이드 금칙어 후처리");
  assert.ok(fin > 0 && banned > fin, "후처리가 금칙어 처리보다 먼저여야 본문에도 금칙어가 걸린다");
  assert.match(src, /platformId === "naver-blog" \? 3000 : 1024/, "긴 원고가 max_tokens 에 잘리지 않게");
});

// ── 서버 후처리 ─────────────────────────────────────────────────────────────

test("후처리: body 를 caption 으로 옮기고 허용 밖 링크·넘치는 이미지 자리·11번째 태그를 지운다", () => {
  const out = server.finalizeNaverBlogDraft({
    title: "## 새 앱 소개",
    body: [
      "도입 문장.",
      "",
      "## 무엇이 달라졌나",
      "지금 받기 https://play.google.com/store/apps/details?id=org.elidus.app",
      "자세히: https://elidus.org/about",
      "https://nk-studio.pages.dev/app",
      "미리보기 nk-studio.pages.dev 에서",
      "다른 곳 https://example.com/x",
      "",
      "[이미지 1]",
      "[사진 2]",
      "[이미지 3]",
      "[이미지 1]",
    ].join("\n"),
    hashtags: "#a #b #c #d #e #f #g #h #i #j #k #a",
  }, { imageCount: 2 });

  assert.equal(out.body, undefined);
  assert.equal(out.title, "새 앱 소개");
  assert.match(out.caption, /play\.google\.com\/store\/apps/);
  assert.match(out.caption, /https:\/\/elidus\.org\/about/);
  assert.doesNotMatch(out.caption, /pages\.dev/);
  assert.doesNotMatch(out.caption, /example\.com/);
  assert.match(out.caption, /\[이미지 1\]/);
  assert.match(out.caption, /\[이미지 2\]/, "표기는 [이미지 N] 으로 맞춘다");
  assert.doesNotMatch(out.caption, /\[이미지 3\]/, "첨부 장수를 넘는 번호는 지운다");
  assert.equal(out.caption.split("[이미지 1]").length - 1, 1, "같은 번호는 한 번만");
  assert.equal(out.hashtags.split(" ").length, 10);
  assert.ok(out.hashtags.startsWith("#a #b"));
});

test("후처리: 이미지가 없으면 자리표시를 모두 지운다", () => {
  const out = server.finalizeNaverBlogDraft({ body: "글\n\n[이미지 1]\n\n끝" }, { imageCount: 0 });
  assert.doesNotMatch(out.caption, /이미지/);
});

test("후처리: 모델이 HTML 로 답해도 원고 표시로 되돌린다", () => {
  const out = server.finalizeNaverBlogDraft({
    caption: "<h2>소제목</h2><p>문장 <strong>굵게</strong></p><ul><li>하나</li><li>둘</li></ul><script>x</script>",
  });
  assert.match(out.caption, /^## 소제목/m);
  assert.match(out.caption, /\*\*굵게\*\*/);
  assert.match(out.caption, /^- 하나$/m);
  assert.doesNotMatch(out.caption, /</);
});

test("링크 허용 판정: 구글 플레이·elidus.org(하위 도메인 포함)만", () => {
  assert.equal(server.isAllowedNaverBlogLink("https://play.google.com/store/apps/details?id=x"), true);
  assert.equal(server.isAllowedNaverBlogLink("https://elidus.org"), true);
  assert.equal(server.isAllowedNaverBlogLink("https://www.elidus.org/a"), true);
  assert.equal(server.isAllowedNaverBlogLink("https://elidus.org.evil.example/"), false);
  assert.equal(server.isAllowedNaverBlogLink("https://nk-studio.pages.dev"), false);
  assert.equal(server.isAllowedNaverBlogLink("https://nkstudio.org"), false);
  assert.equal(server.isAllowedNaverBlogLink("javascript:alert(1)"), false);
});

// ── 붙여넣기용 HTML 변환 ────────────────────────────────────────────────────

test("변환: 소제목·굵게·목록·이미지 자리를 스마트에디터용 HTML 로", () => {
  const html = conv.toHtml("도입 **핵심** 문장.\n둘째 줄\n\n## 소제목\n- 하나\n- 둘\n1. 첫째\n\n[이미지 1]\n\n끝");
  assert.match(html, /<p>도입 <strong>핵심<\/strong> 문장\.<br>둘째 줄<\/p>/);
  assert.match(html, /<h3><strong>소제목<\/strong><\/h3>/);
  assert.match(html, /<ul><li>하나<\/li><li>둘<\/li><\/ul>/);
  assert.match(html, /<ol><li>첫째<\/li><\/ol>/);
  assert.match(html, /<p>\[이미지 1\]<\/p>/);
  assert.match(html, /<p>끝<\/p>/);
});

test("변환: 원고 속 태그는 글자로만 남는다(이스케이프)", () => {
  const html = conv.toHtml('<img src=x onerror="alert(1)"> & **<b>**');
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&amp;/);
});

test("변환: text/plain 짝은 표시 기호를 걷어 낸다", () => {
  assert.equal(conv.toPlain("## 제목\n**굵게** 문장\n- 항목"), "제목\n굵게 문장\n• 항목");
});

// ── 복사 버튼 배선 ──────────────────────────────────────────────────────────

const ui = read("prototype/js/ui/brand-studio.js");

test("화면: 네이버 블로그 카드에 본문 복사·이미지 N 복사·모두 받기·글쓰기 열기가 있다", () => {
  assert.match(ui, /if \(formatId === 'naver-blog'\) return buildNaverBlogHandoffHtml\(formatId\);/);
  const fn = ui.slice(ui.indexOf("function buildNaverBlogHandoffHtml"), ui.indexOf("var activeDraftTabOrFirst"));
  assert.match(fn, /data-action="brand-naver-copy-body"/);
  assert.match(fn, /data-action="brand-naver-copy-image" data-img-index="/);
  assert.match(fn, /data-action="brand-manual-download" data-manual-only="image"/);
  assert.match(fn, /NKFormatMedia\.manualUrlOf\(formatId\)/);
  assert.match(fn, /target="_blank" rel="noopener noreferrer"/);
  // 버튼 폭 고정
  assert.ok((fn.match(/bsf-handoff-btn--fixed/g) || []).length >= 4);
  assert.match(read("prototype/styles.css"), /\.bsf-handoff-btn--fixed \{[^}]*min-width:/);
});

test("본문 복사: ClipboardItem 에 text/html 과 text/plain 을 함께 싣는다", () => {
  const h = ui.slice(ui.indexOf("action === 'brand-naver-copy-body'"), ui.indexOf("action === 'brand-naver-copy-image'"));
  assert.match(h, /navigator\.clipboard\.write\(\[new window\.ClipboardItem\(\{/);
  assert.match(h, /'text\/html': new Blob\(\[nbHtml\], \{ type: 'text\/html' \}\)/);
  assert.match(h, /'text\/plain': new Blob\(\[nbPlain\], \{ type: 'text\/plain' \}\)/);
  assert.match(h, /NKNaverBlogDraft/);
  assert.match(h, /readFieldValue\(nbEl\)/, "저장값이 아니라 편집칸의 지금 값을 복사한다");
});

test("이미지 복사: image/png 로 싣고 다른 형식은 PNG 로 바꾼다", () => {
  const h = ui.slice(ui.indexOf("action === 'brand-naver-copy-image'"), ui.indexOf("action === 'brand-manual-download'"));
  assert.match(h, /new window\.ClipboardItem\(\{ 'image\/png': niPng \}\)/);
  assert.match(h, /toBlob\([\s\S]*'image\/png'\)/);
});

test("생성 요청 3곳 모두 선택 이미지 장수를 보낸다", () => {
  const calls = ui.match(/NK\.api\.draftGenerate\(\{[\s\S]*?\}\)/g) || [];
  assert.equal(calls.length, 3);
  for (const c of calls) assert.match(c, /imageCount: draftSelImgs\.length/);
});

test("게시 완료: 올린 글 주소를 배포 이력(remoteUrl)에 기록한다 — 기존 manual 흐름 재사용", () => {
  assert.match(ui, /data-draft-field="posted_url"/);
  const h = ui.slice(ui.indexOf("action === 'toggle-deploy-done'"), ui.indexOf("action === 'brand-toggle-story-card'"));
  assert.match(h, /NKFormatMedia\.normalizePostedUrl\(toggleFmtId, tpRaw\)/);
  assert.match(h, /persistPublishedResult\(toggleFmtId, [^;]*url: togglePostedUrl/);
  // persistPublishedResult 가 result.url 을 remoteUrl 로, manual 채널을 delivery='manual' 로 남긴다.
  assert.match(ui, /remoteUrl: String\(result\.url \|\| ''\)\.trim\(\)/);
  assert.match(ui, /delivery: isManualRow \? 'manual' : 'auto'/);
});

test("올린 글 주소 판정: 네이버 블로그 https 글 주소만", () => {
  assert.equal(M.acceptsPostedUrl("naver-blog"), true);
  assert.equal(M.acceptsPostedUrl("kakao"), false, "카카오·BAND·포스트는 이번 범위 밖");
  assert.equal(M.acceptsPostedUrl("band"), false);
  assert.equal(M.acceptsPostedUrl("instagram"), false);
  assert.equal(M.normalizePostedUrl("naver-blog", "https://blog.naver.com/raviok/223000000000"), "https://blog.naver.com/raviok/223000000000");
  assert.equal(M.normalizePostedUrl("naver-blog", "https://m.blog.naver.com/raviok/223000000000"), "https://m.blog.naver.com/raviok/223000000000");
  for (const bad of ["http://blog.naver.com/a/1", "https://blog.naver.com/", "https://blog.naver.com.evil.example/a", "https://cafe.naver.com/a", "블로그"]) {
    assert.equal(M.normalizePostedUrl("naver-blog", bad), "", bad);
  }
});

test("글쓰기 열기 주소는 GoBlogWrite.naver 그대로(로그인 후 되돌아온다)", () => {
  assert.equal(M.manualUrlOf("naver-blog"), "https://blog.naver.com/GoBlogWrite.naver");
});

test("새 문구는 한/영 사전에 짝으로 있다", () => {
  const keys = ["naverCopyBody", "naverCopyImage", "naverDownloadAll", "naverOpenWrite", "naverAttachedImages",
    "naverBodyHint", "naverBodyCopied", "naverBodyCopiedPlain", "naverImageCopied", "naverCopyFail",
    "naverCopyUnsupported", "naverBodyEmpty", "postedUrlLabel", "postedUrlPlaceholder", "postedUrlInvalid", "postedUrlSaved"];
  for (const k of keys) {
    const n = (ui.match(new RegExp("\\b" + k + ":", "g")) || []).length;
    assert.equal(n, 2, `${k} 는 ko·en 두 사전에 하나씩 있어야 한다 (${n})`);
  }
  assert.match(ui, /nk:lang-changed/);
});

test("서버 자동 발행·네이버 자격증명 저장을 하지 않는다", () => {
  const s = read("prototype/functions/api/_shared/naver-blog-draft.js") + read("prototype/js/ui/naver-blog-draft.js");
  assert.doesNotMatch(s, /password|비밀번호|nid\.naver\.com|xmlrpc/i);
  assert.equal(M.isManualDelivery("naver-blog"), true);
});

test("brand.html 이 변환기를 brand-studio.js 보다 먼저 싣는다", () => {
  const html = read("prototype/brand.html");
  const a = html.indexOf("js/ui/naver-blog-draft.js");
  const b = html.indexOf("js/ui/brand-studio.js");
  assert.ok(a > 0 && b > a);
});
