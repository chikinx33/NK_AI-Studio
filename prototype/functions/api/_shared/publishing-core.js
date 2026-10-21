// prototype/functions/api/_shared/publishing-core.js
//
// 퍼블리싱(채널·글·게시 일정) 규칙 — DB 없이 판단하는 부분만 모은다.
// NK Publisher(PC 앱)와의 약속은 NK_Studio_Doc/docs/publishing-contract.md(원본: NK_Publisher/docs/CONTRACT.md)다.
// 여기 숫자·코드가 바뀌면 약속도 같이 바뀌는 것이므로 두 사본을 함께 고치고 "바뀐 기록"을 남긴다.
//
// 왜 한곳에: 재시도·스팸 방지·본문 블록 변환은 서버 저장(publishing-store.ts), PC 앱 API(api/publisher/v1),
// 화면이 모두 같은 답을 내야 한다. 판단을 SQL·화면에 흩어 두면 "화면은 된다는데 서버가 막는" 어긋남이 생긴다.
import { normalizeNaverBlogTags } from "./naver-blog-draft.js";

/** 게시 일정의 '하루'를 자르는 기준 시간대. 지금은 한국 시간 하나(범용화 때 사용자 설정으로 옮긴다). */
export const PUBLISHING_TIME_ZONE = "Asia/Seoul";
export const PUBLISHING_TZ_OFFSET_MIN = 9 * 60;

/** CONTRACT §5.3: 집어 간 작업의 임대 시간. */
export const LEASE_MS = 15 * 60 * 1000;
/** CONTRACT §6.3: 재시도 간격과 횟수(처음 1번 + 2번 더). */
export const RETRY_DELAY_MS = 30 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
/** CONTRACT §4: 연결 코드 유효 시간과 글자. 헷갈리는 O·0·I·1 은 뺐다(32자 → 바이트 % 32 가 치우치지 않는다). */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_LENGTH = 8;
export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** CONTRACT §5.2 */
export const POLL_INTERVAL_SEC = 60;
export const MIN_APP_VERSION = "0.1.0";
/** CONTRACT §6.4 */
export const DEFAULT_DAILY_LIMIT = 1;
export const DEFAULT_MIN_INTERVAL_HOURS = 20;
export const DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** CONTRACT §5.3 Job.limits */
export const TITLE_MAX = 100;
export const TAGS_MAX = 10;
/** 이 시간 안에 heartbeat 가 있었으면 PC 가 켜져 있다고 본다(heartbeat 5분 주기 + 여유). */
export const DEVICE_ONLINE_MS = 12 * 60 * 1000;

export const ERROR_CODES = ["LOGIN_REQUIRED", "CAPTCHA", "RATE_LIMITED", "SELECTOR_CHANGED", "CONTENT_REJECTED", "NETWORK", "LEASE_EXPIRED", "UNCERTAIN", "UNKNOWN"];
/** CONTRACT §6.3: 서버가 30분 뒤 다시 내주는 실패. */
export const RETRYABLE_CODES = new Set(["NETWORK", "LEASE_EXPIRED", "SELECTOR_CHANGED", "UNKNOWN"]);
/** CONTRACT §6.3: 다시 올리지 않고 사람에게 넘기는 실패. */
export const HUMAN_CODES = new Set(["LOGIN_REQUIRED", "CAPTCHA", "CONTENT_REJECTED", "UNCERTAIN", "RATE_LIMITED"]);
export const PROGRESS_STAGES = ["opening", "filling", "uploading_images", "submitting"];

/** CONTRACT §2 delivery 상태. */
export const DELIVERY_STATUSES = ["draft", "scheduled", "claimed", "publishing", "posted", "failed", "needs_human", "ready_manual", "done_manual", "tested", "cancelled"];
/** CONTRACT §2: PC 앱 시험 모드 결과. 등록은 누르지 않았다(실제 게시 없음) — 재시도·한도 계산 대상이 아니다. */
export const TESTED_STATUS = "tested";
/** 사람이 처리해야 하는 상태(개요 '확인 필요'와 수동 복사 화면). */
export const ATTENTION_STATUSES = new Set(["needs_human", "failed", "ready_manual"]);
/** 이미 끝난 상태 — 글을 고쳐도 건드리지 않는다. */
export const FINAL_STATUSES = new Set(["posted", "done_manual", "cancelled"]);

/**
 * CONTRACT §3 채널 종류. mode 는 그 종류가 가질 수 있는 방식.
 * pcReady: NK Publisher 에 어댑터가 있는 종류(1단계는 네이버 블로그만). 나머지 PC 종류는 지금은 '직접 올리기(manual)'로 쓴다.
 * apiReady: 서버가 기존 SNS 예약 실행기(sns_scheduled_posts → /api/sns/publish)로 올리는 종류. 계정은 SNS 세팅에 연결된 것을 쓴다.
 *   유튜브는 영상 전용이고 플랫폼 자체 예약(publishAt)을 써서 이 대기열에 맞지 않아 아직 준비 중이다.
 */
export const CHANNEL_TYPES = {
  naver_blog: { modes: ["pc", "manual"], pcReady: true },
  naver_cafe: { modes: ["pc", "manual"], pcReady: false },
  dcinside: { modes: ["pc", "manual"], pcReady: false },
  ruliweb: { modes: ["pc", "manual"], pcReady: false },
  x: { modes: ["api"], apiReady: true },
  threads: { modes: ["api"], apiReady: true },
  facebook: { modes: ["api"], apiReady: true },
  instagram: { modes: ["api"], apiReady: true },
  youtube: { modes: ["api"], apiReady: false },
  discord: { modes: ["api"], apiReady: true },
  // 직접 올리기 전용(사람이 복사 화면으로 올린다). PC 앱에 가지 않으므로 NK Publisher 약속(§3)과 무관하다.
  reddit: { modes: ["manual"] },
  hackernews: { modes: ["manual"] },
  custom: { modes: ["manual"] },
};

/** 지금 만들 수 있는 (종류, 방식)인지. */
export function isChannelModeAvailable(type, mode) {
  const spec = CHANNEL_TYPES[type];
  if (!spec || !spec.modes.includes(mode)) return false;
  if (mode === "pc") return spec.pcReady === true;
  if (mode === "api") return spec.apiReady === true;
  return true;
}

function cleanText(v, max = 300) {
  return String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max);
}

function httpsUrl(v) {
  const s = cleanText(v, 1000);
  if (!s) return "";
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "";
  } catch (_) { return ""; }
}

/**
 * 채널 입력 검사(CONTRACT §3 target 필드). 반환: { ok, channel } | { ok:false, error }.
 * 사이트 비밀번호 같은 로그인 정보는 받지 않는다(CONTRACT §6.5·6.6) — 아는 필드만 골라 담는다.
 */
export function validateChannelInput(input) {
  const src = input && typeof input === "object" ? input : {};
  const type = cleanText(src.type, 40);
  const mode = cleanText(src.mode, 20);
  if (!CHANNEL_TYPES[type]) return { ok: false, error: "channel_type_invalid" };
  if (!isChannelModeAvailable(type, mode)) return { ok: false, error: "channel_mode_unavailable" };
  const name = cleanText(src.name, 80);
  if (!name) return { ok: false, error: "channel_name_required" };
  const t = src.target && typeof src.target === "object" ? src.target : {};
  let target = {};
  if (type === "naver_blog") {
    const blogId = cleanText(t.blogId, 60).replace(/^https?:\/\/(m\.)?blog\.naver\.com\//i, "").replace(/[/?#].*$/, "");
    // CONTRACT §3: blogId 는 선택. 비우면 PC 앱이 로그인된 계정의 블로그에 쓴다.
    if (blogId && !/^[A-Za-z0-9_-]{2,60}$/.test(blogId)) return { ok: false, error: "target_blog_id_invalid" };
    const categoryNo = cleanText(t.categoryNo, 20);
    if (categoryNo && !/^\d{1,10}$/.test(categoryNo)) return { ok: false, error: "target_category_invalid" };
    target = { ...(blogId ? { blogId } : {}), visibility: t.visibility === "private" ? "private" : "public", ...(categoryNo ? { categoryNo } : {}) };
  } else if (type === "naver_cafe") {
    const cafeUrl = httpsUrl(t.cafeUrl);
    const menuId = cleanText(t.menuId, 20);
    if (!cafeUrl || !/cafe\.naver\.com/i.test(cafeUrl)) return { ok: false, error: "target_cafe_url_required" };
    if (!/^\d{1,10}$/.test(menuId)) return { ok: false, error: "target_menu_id_required" };
    target = { cafeUrl, menuId };
  } else if (type === "dcinside") {
    const galleryId = cleanText(t.galleryId, 60);
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(galleryId)) return { ok: false, error: "target_gallery_id_required" };
    const galleryType = ["major", "minor", "mini"].includes(t.galleryType) ? t.galleryType : "minor";
    const headText = cleanText(t.headText, 40);
    target = { galleryId, galleryType, ...(headText ? { headText } : {}) };
  } else if (type === "ruliweb") {
    const boardUrl = httpsUrl(t.boardUrl);
    if (!boardUrl || !/ruliweb\.com/i.test(boardUrl)) return { ok: false, error: "target_board_url_required" };
    target = { boardUrl };
  } else if (type === "reddit") {
    const subreddit = normalizeSubreddit(t.subreddit);
    if (subreddit && !/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) return { ok: false, error: "target_subreddit_invalid" };
    target = subreddit ? { subreddit } : {};
  } else if (type === "custom") {
    const writeUrl = httpsUrl(t.writeUrl);
    const note = cleanText(t.note, 300);
    target = { ...(writeUrl ? { writeUrl } : {}), ...(note ? { note } : {}) };
  }
  const dailyLimit = Math.trunc(Number(src.dailyLimit ?? DEFAULT_DAILY_LIMIT));
  const minIntervalHours = Number(src.minIntervalHours ?? DEFAULT_MIN_INTERVAL_HOURS);
  if (!Number.isFinite(dailyLimit) || dailyLimit < 1 || dailyLimit > 20) return { ok: false, error: "daily_limit_invalid" };
  if (!Number.isFinite(minIntervalHours) || minIntervalHours < 0 || minIntervalHours > 24 * 14) return { ok: false, error: "min_interval_invalid" };
  return {
    ok: true,
    channel: {
      type, mode, name, target,
      brandId: cleanText(src.brandId, 120),
      accountLabel: cleanText(src.accountLabel, 80),
      dailyLimit, minIntervalHours: Math.round(minIntervalHours * 100) / 100,
      enabled: src.enabled !== false,
    },
  };
}

/** 수동 복사 화면의 "글쓰기 열기" 주소. 모르면 "". */
export function channelWriteUrl(type, target) {
  const t = target && typeof target === "object" ? target : {};
  if (type === "naver_blog") return t.blogId ? `https://blog.naver.com/${encodeURIComponent(t.blogId)}?Redirect=Write` : "https://blog.naver.com/GoBlogWrite.naver";
  if (type === "naver_cafe" && t.cafeUrl) return String(t.cafeUrl);
  if (type === "dcinside" && t.galleryId) {
    const base = t.galleryType === "major" ? "board" : t.galleryType === "mini" ? "mini/board" : "mgallery/board";
    return `https://gall.dcinside.com/${base}/write/?id=${encodeURIComponent(t.galleryId)}`;
  }
  if (type === "ruliweb" && t.boardUrl) return String(t.boardUrl);
  if (type === "reddit") return t.subreddit ? `https://www.reddit.com/r/${encodeURIComponent(t.subreddit)}/submit` : "https://www.reddit.com/submit";
  if (type === "hackernews") return "https://news.ycombinator.com/submit";
  if (type === "custom" && t.writeUrl) return String(t.writeUrl);
  return "";
}

/** 'r/name', '/r/name/', 'https://www.reddit.com/r/name' → 'name'. */
export function normalizeSubreddit(raw) {
  return cleanText(raw, 200).replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, "").replace(/^\/+/, "").replace(/^r\//i, "").replace(/[/?#].*$/, "");
}

/** 채널 target 값과 비교할 모양(대소문자 무시, 서브레딧은 r/ 접두어·주소 무시, 다른 주소는 끝 / 무시). */
function targetKey(v) {
  const s = cleanText(v, 300);
  if (/^https?:\/\//i.test(s) && !/reddit\.com/i.test(s)) return s.replace(/\/+$/, "").toLowerCase();
  return normalizeSubreddit(s).toLowerCase();
}

/**
 * 가져온 글의 채널 고르기(JSON 가져오기·패키지 가져오기 공용).
 * channelId 가 있으면 그 채널. 없으면 같은 종류(channelType) 안에서:
 *   target(갤러리 id·서브레딧·블로그 id·게시판 주소 또는 채널 이름)을 주면 그 값이 맞는 채널만 — 맞는 채널이 없으면 null
 *   (엉뚱한 게시판에 올라가지 않게 '그 종류 첫 채널'로 넘기지 않는다),
 *   target 이 없으면 같은 브랜드 채널 → 브랜드 없는 채널 → 그 종류 첫 채널.
 * @param {Array<{id:string,type:string,name:string,brandId:string,target:object}>} channels 쓸 수 있는(켜진) 채널
 */
export function pickImportChannel(channels, { channelType = "", channelId = "", brandId = "", target = "" } = {}) {
  const list = Array.isArray(channels) ? channels : [];
  if (channelId) return list.find((c) => c.id === channelId) || null;
  const pool = list.filter((c) => c.type === channelType);
  const sameBrand = (c) => !!c.brandId && c.brandId === brandId;
  const want = targetKey(target);
  if (want) {
    const hits = pool.filter((c) => targetKey(c.name) === want
      || Object.values(c.target && typeof c.target === "object" ? c.target : {}).some((v) => targetKey(v) === want));
    return hits.find(sameBrand) || hits[0] || null;
  }
  return pool.find(sameBrand) || pool.find((c) => !c.brandId) || pool[0] || null;
}

// ── 본문 → 블록 (CONTRACT §5.3 content.blocks) ──────────────────────────────
// 글 본문은 사람이 편집칸에서 바로 고치는 가벼운 표시로 저장한다(원천 하나). 네이버 블로그 원고(js/ui/naver-blog-draft.js)와 같은 표시:
//   ## 소제목 (또는 ■ 소제목)   **굵게**   - 목록   > 인용   [이미지 N]   [글자](https://주소)   빈 줄 = 단락 구분

const HEAD = /^(?:#{1,4}\s+|■\s*)(.+)$/;
const BULLET = /^[-•*]\s+(.+)$/;
const QUOTE = /^>\s?(.*)$/;
const IMAGE = /^\[\s*(?:이미지|사진|image|photo)\s*(\d{1,2})\s*\]$/i;
const LINK_LINE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const BARE_URL = /^https?:\/\/\S+$/;

function stripInline(s) {
  return String(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1");
}

const INLINE = /\*\*([^*\n]+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * CONTRACT §5.3 글자 안 서식: 한 줄을 조각으로 나눈다. **굵게** → { bold:true }, [글자](https://주소) → { url }.
 * 이웃한 같은 모양 조각은 합친다. 서식이 하나도 없으면 null(그 블록은 runs 를 생략한다).
 * @param {string[]} lines 원문 줄들(블록 안의 줄바꿈은 "\n" 조각으로 잇는다)
 */
export function inlineRuns(lines) {
  const runs = [];
  const push = (run) => {
    if (!run.text) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === !!run.bold && (last.url || "") === (run.url || "")) last.text += run.text;
    else runs.push(run);
  };
  let formatted = false;
  (Array.isArray(lines) ? lines : [lines]).forEach((line, i) => {
    if (i > 0) push({ text: "\n" });
    const src = String(line == null ? "" : line);
    let at = 0;
    for (const m of src.matchAll(INLINE)) {
      push({ text: src.slice(at, m.index) });
      formatted = true;
      if (m[1] !== undefined) push({ text: m[1], bold: true });
      else push({ text: m[2], url: m[3] });
      at = m.index + m[0].length;
    }
    push({ text: src.slice(at) });
  });
  return formatted ? runs : null;
}

/**
 * @param {string} body 본문 표시
 * @param {Array<{ref?:string, caption?:string}>} images 글의 이미지(순서 = [이미지 N] 번호)
 * @returns {Array<object>} CONTRACT 블록. 본문에 자리가 없는 이미지는 끝에 붙인다(잃지 않게).
 */
export function markupToBlocks(body, images = []) {
  const imgs = Array.isArray(images) ? images : [];
  const blocks = [];
  const used = new Set();
  let para = [];
  let list = null;
  let quote = [];
  // text/items 는 서식을 걷어 낸 글자(옛 앱·plainText 용), runs/itemRuns 는 같은 줄의 서식 조각(§5.3, 서식이 있을 때만).
  const flushPara = () => {
    if (!para.length) return;
    const whole = para.every((l) => /^\*\*[^*\n]+\*\*$/.test(l));
    const block = { type: "paragraph", text: para.map((l) => stripInline(l)).join("\n"), bold: whole };
    // 문단 전체 굵게는 bold:true 가 맡는다 — 링크가 섞였을 때만 조각을 보낸다.
    const runs = inlineRuns(para);
    if (runs && (!whole || runs.some((r) => r.url))) block.runs = runs;
    blocks.push(block);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const block = { type: "list", items: list.map((it) => stripInline(it).trim()) };
    const itemRuns = list.map((it) => inlineRuns([it.trim()]));
    if (itemRuns.some(Boolean)) block.itemRuns = itemRuns.map((r, i) => r || [{ text: block.items[i] }]);
    blocks.push(block);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const block = { type: "quote", text: quote.map((l) => stripInline(l)).join("\n") };
    const runs = inlineRuns(quote);
    if (runs) block.runs = runs;
    blocks.push(block);
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of String(body == null ? "" : body).replace(/\r\n?/g, "\n").split("\n")) {
    const t = raw.trim();
    let m;
    if (!t) { flushAll(); continue; }
    if ((m = t.match(IMAGE))) {
      flushAll();
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= imgs.length && !used.has(n)) {
        used.add(n);
        blocks.push({ type: "image", imageRef: `img${n}`, caption: cleanText(imgs[n - 1]?.caption, 200) });
      }
      continue;
    }
    if ((m = t.match(HEAD))) { flushAll(); blocks.push({ type: "heading", text: stripInline(m[1]).trim() }); continue; }
    if ((m = t.match(LINK_LINE))) { flushAll(); blocks.push({ type: "link", text: m[1].trim(), url: m[2] }); continue; }
    if (BARE_URL.test(t)) { flushAll(); blocks.push({ type: "link", text: t, url: t }); continue; }
    if ((m = t.match(QUOTE))) { flushPara(); flushList(); quote.push(m[1]); continue; }
    if ((m = t.match(BULLET)) && !/^\*\*/.test(t)) { flushPara(); flushQuote(); (list ||= []).push(m[1]); continue; }
    flushList(); flushQuote();
    para.push(t);
  }
  flushAll();
  imgs.forEach((img, i) => {
    if (!used.has(i + 1)) blocks.push({ type: "image", imageRef: `img${i + 1}`, caption: cleanText(img?.caption, 200) });
  });
  return blocks;
}

/** CONTRACT plainText: 블록을 줄바꿈으로 이은 전체 본문(대체용). 이미지는 뺀다. */
export function blocksToPlainText(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b.type === "heading" || b.type === "paragraph" || b.type === "quote") out.push(b.text);
    else if (b.type === "list") out.push(b.items.map((it) => `• ${it}`).join("\n"));
    else if (b.type === "link") out.push(b.text === b.url ? b.url : `${b.text} ${b.url}`);
  }
  return out.join("\n");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 수동 복사 화면의 서식 복사용 HTML(text/html). 스마트에디터 ONE 이 소제목·굵게·목록·링크를 살린다.
 * 소제목은 <h3><strong> — 편집기가 제목 태그를 버려도 굵게는 남는다(js/ui/naver-blog-draft.js 와 같은 선택).
 * 이미지는 "[이미지 N]" 자리 글자로 둔다 — 사람이 그 자리에 사진을 붙인다.
 */
/** 조각 → HTML. PC 앱이 같은 조각을 편집기에 넣으므로, 손으로 붙여 넣어도 같은 굵게·링크가 된다. */
function runsToHtml(runs) {
  return runs.map((r) => {
    let html = String(r.text).split("\n").map(esc).join("<br>");
    if (r.bold) html = `<strong>${html}</strong>`;
    if (r.url && /^https?:\/\//i.test(r.url)) html = `<a href="${esc(r.url)}">${html}</a>`;
    return html;
  }).join("");
}

export function blocksToHtml(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b.type === "heading") out.push(`<h3><strong>${esc(b.text)}</strong></h3>`);
    else if (b.type === "paragraph") {
      const inner = Array.isArray(b.runs) ? runsToHtml(b.runs) : String(b.text).split("\n").map(esc).join("<br>");
      out.push(`<p>${b.bold ? `<strong>${inner}</strong>` : inner}</p>`);
    } else if (b.type === "list") out.push(`<ul>${b.items.map((it, i) => `<li>${Array.isArray(b.itemRuns?.[i]) ? runsToHtml(b.itemRuns[i]) : esc(it)}</li>`).join("")}</ul>`);
    else if (b.type === "quote") out.push(`<blockquote>${Array.isArray(b.runs) ? runsToHtml(b.runs) : String(b.text).split("\n").map(esc).join("<br>")}</blockquote>`);
    else if (b.type === "link") out.push(`<p><a href="${esc(b.url)}">${esc(b.text)}</a></p>`);
    else if (b.type === "image") out.push(`<p>[이미지 ${esc(String(b.imageRef).replace(/^img/, ""))}]</p>`);
  }
  return out.join("\n");
}

/** 태그 배열(# 없이). 네이버 블로그 원고와 같은 규칙(겹침 제거·글자/숫자/_ 만·10개)을 그대로 쓴다. */
export function normalizeTagList(raw) {
  return normalizeNaverBlogTags(raw).split(" ").map((t) => t.replace(/^#/, "")).filter(Boolean).slice(0, TAGS_MAX);
}

export function normalizeTitle(raw) {
  return cleanText(raw, 400).replace(/\s+/g, " ").slice(0, TITLE_MAX);
}

/** 30일 중복 검사용 지문. 띄어쓰기·줄바꿈 차이는 같은 글로 본다. */
export async function contentHashOf(title, body) {
  const norm = `${String(title || "").replace(/\s+/g, " ").trim()}\n${String(body || "").replace(/\s+/g, " ").trim()}`.toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── 가져오기 (CONTRACT §7) ─────────────────────────────────────────────────

/**
 * 가져온 본문에 이미지 자리([이미지 N])를 넣는다. position "after:<줄>" 은 그 줄(앞뒤 공백 무시) 바로 뒤.
 * 줄을 못 찾거나 position 이 없으면 끝에 둔다. 본문의 ■ 소제목은 그대로 둔다(본문 표시가 ■ 를 소제목으로 읽는다).
 */
export function placeImportImageMarkers(body, images) {
  const lines = String(body == null ? "" : body).replace(/\r\n?/g, "\n").split("\n");
  const tail = [];
  const inserts = new Map(); // 줄 번호 → 넣을 표시들
  (Array.isArray(images) ? images : []).forEach((img, i) => {
    const marker = `[이미지 ${i + 1}]`;
    const pos = String(img?.position || "");
    const m = pos.match(/^after:(.+)$/s);
    const target = m ? m[1].trim() : "";
    const at = target ? lines.findIndex((l) => l.trim() === target) : -1;
    if (at < 0) { tail.push(marker); return; }
    if (!inserts.has(at)) inserts.set(at, []);
    inserts.get(at).push(marker);
  });
  const out = [];
  lines.forEach((l, i) => {
    out.push(l);
    if (inserts.has(i)) out.push("", ...inserts.get(i), "");
  });
  if (tail.length) out.push("", ...tail);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 가져오기 항목 하나 검사·정리. 반환: { ok, item } | { ok:false, error }. */
export function normalizeImportItem(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const externalId = cleanText(src.externalId, 160);
  if (!externalId) return { ok: false, error: "external_id_required" };
  const title = normalizeTitle(src.title);
  if (!title) return { ok: false, error: "title_required" };
  const images = (Array.isArray(src.images) ? src.images : []).slice(0, 20).map((img) => {
    const p = cleanText(img?.path ?? img?.url, 1000);
    const url = httpsUrl(p);
    return {
      // URL 이면 서버가 받아 저장하고, 로컬 경로면 가져오기 화면에서 같은 이름의 파일을 골라 올린다.
      sourceUrl: url,
      sourcePath: url ? "" : p,
      fileName: (p.split(/[\\/]/).pop() || "").split("?")[0],
      alt: cleanText(img?.alt, 200),
      caption: cleanText(img?.caption, 200),
      position: cleanText(img?.position, 300),
    };
  });
  const body = placeImportImageMarkers(String(src.body || ""), images);
  const deliveries = (Array.isArray(src.deliveries) ? src.deliveries : []).slice(0, 20).map((d) => ({
    channelType: cleanText(d?.channelType, 40),
    channelId: cleanText(d?.channelId, 80),
    scheduledAt: Number.isFinite(Date.parse(String(d?.scheduledAt || ""))) ? new Date(Date.parse(String(d.scheduledAt))).toISOString() : "",
  }));
  return {
    ok: true,
    item: {
      externalId, title, body,
      brandId: cleanText(src.brandId, 120),
      tags: normalizeTagList(src.tags),
      images: images.map(({ position, ...rest }) => rest),
      deliveries,
    },
  };
}

// ── 재시도 규칙 (CONTRACT §6.3) ─────────────────────────────────────────────

/**
 * PC 앱 결과 보고 → 다음 상태. attemptsUsed = 이번 일정에서 쓴 시도 수(사람이 '다시 예약'하면 0부터 다시 센다).
 * @returns {{ status: string, errorCode: string, retryAt?: string }}
 */
export function decideResultOutcome({ status, errorCode, attemptsUsed, now = Date.now() }) {
  if (status === "posted") return { status: "posted", errorCode: "" };
  if (status === TESTED_STATUS) return { status: TESTED_STATUS, errorCode: "" };
  const code = ERROR_CODES.includes(errorCode) ? errorCode : (status === "needs_human" ? "UNCERTAIN" : "UNKNOWN");
  if (status === "needs_human" || HUMAN_CODES.has(code)) return { status: "needs_human", errorCode: code };
  if (RETRYABLE_CODES.has(code) && attemptsUsed < MAX_ATTEMPTS) {
    return { status: "scheduled", errorCode: code, retryAt: new Date(now + RETRY_DELAY_MS).toISOString() };
  }
  return { status: "failed", errorCode: code };
}

/**
 * 결과 보고 없이 임대가 끝난 작업. '등록' 단계까지 갔으면 올라갔는지 모르므로 사람에게(CONTRACT §6.1),
 * 그 전 단계면 LEASE_EXPIRED 로 재시도 규칙을 탄다. store 의 임대 만료 SQL 이 이 규칙을 그대로 옮긴 것이다.
 */
export function decideLeaseExpiry({ stage, attemptsUsed, now = Date.now() }) {
  if (stage === "submitting") return { status: "needs_human", errorCode: "UNCERTAIN" };
  return decideResultOutcome({ status: "failed", errorCode: "LEASE_EXPIRED", attemptsUsed, now });
}

// ── 스팸 방지 (CONTRACT §6.4) ───────────────────────────────────────────────

/** 이 상태의 게시는 '그 채널에 올렸거나 올릴 글'로 센다. needs_human 은 올라갔는지 모르는 UNCERTAIN 만. */
export function countsTowardChannelLoad(status, errorCode) {
  if (["scheduled", "claimed", "publishing", "posted", "ready_manual", "done_manual"].includes(status)) return true;
  return status === "needs_human" && errorCode === "UNCERTAIN";
}

/** 한국 시간 날짜 키 'YYYY-MM-DD'. */
export function dayKey(ms) {
  const d = new Date(ms + PUBLISHING_TZ_OFFSET_MIN * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * 한 게시를 이 채널·시각에 잡아도 되는지.
 * @param {{ deliveryId?:string, channel:{id:string,dailyLimit:number,minIntervalHours:number}, atMs:number, contentHash:string }} c
 * @param {Array<{ id:string, channelId:string, atMs:number, contentHash:string, status:string, errorCode?:string }>} existing
 * @returns {{ ok:true } | { ok:false, reason:"daily_limit"|"min_interval"|"duplicate", conflictId:string }}
 */
export function checkSpamGuard(c, existing) {
  const ch = c.channel;
  const others = (existing || []).filter((e) => e.channelId === ch.id && e.id !== c.deliveryId && countsTowardChannelLoad(e.status, e.errorCode));
  if (c.contentHash) {
    const dup = others.find((e) => e.contentHash === c.contentHash && Math.abs(e.atMs - c.atMs) < DUPLICATE_WINDOW_MS);
    if (dup) return { ok: false, reason: "duplicate", conflictId: dup.id };
  }
  const gapMs = Number(ch.minIntervalHours) * 3600 * 1000;
  const near = gapMs > 0 ? others.find((e) => Math.abs(e.atMs - c.atMs) < gapMs) : null;
  if (near) return { ok: false, reason: "min_interval", conflictId: near.id };
  const day = dayKey(c.atMs);
  const sameDay = others.filter((e) => dayKey(e.atMs) === day);
  if (sameDay.length >= Math.max(1, Number(ch.dailyLimit) || 1)) return { ok: false, reason: "daily_limit", conflictId: sameDay[0].id };
  return { ok: true };
}

/**
 * 여러 게시를 한꺼번에 승인할 때(주간 일괄 승인). 시각 순서대로 하나씩 검사하고, 통과한 건은 다음 검사에서 '잡힌 일정'으로 센다.
 * 같은 배치 안의 두 글이 같은 날 같은 채널에 겹치면 앞 시각 것만 통과한다.
 * @returns {Array<{ deliveryId:string, ok:boolean, reason?:string, conflictId?:string }>}
 */
export function planApproval(candidates, existing, channelsById) {
  const pool = (existing || []).slice();
  const sorted = (candidates || []).slice().sort((a, b) => a.atMs - b.atMs);
  const out = [];
  for (const c of sorted) {
    const channel = channelsById[c.channelId];
    if (!channel || channel.enabled === false || channel.deleted) { out.push({ deliveryId: c.deliveryId, ok: false, reason: "channel_disabled" }); continue; }
    if (!Number.isFinite(c.atMs)) { out.push({ deliveryId: c.deliveryId, ok: false, reason: "time_required" }); continue; }
    if (c.missingImages) { out.push({ deliveryId: c.deliveryId, ok: false, reason: "missing_images" }); continue; }
    // SNS 채널 내용 검사(snsContentBlock): 사진·영상이 꼭 있어야 하는 채널, 글자 수 한도.
    if (c.contentBlock) { out.push({ deliveryId: c.deliveryId, ok: false, reason: c.contentBlock }); continue; }
    const g = checkSpamGuard({ deliveryId: c.deliveryId, channel, atMs: c.atMs, contentHash: c.contentHash }, pool);
    if (!g.ok) { out.push({ deliveryId: c.deliveryId, ok: false, reason: g.reason, conflictId: g.conflictId }); continue; }
    pool.push({ id: c.deliveryId, channelId: c.channelId, atMs: c.atMs, contentHash: c.contentHash, status: "scheduled" });
    out.push({ deliveryId: c.deliveryId, ok: true });
  }
  return out;
}

/** 'YYYY-MM-DD'(그 주의 아무 날) → 그 주 월요일 0시~다음 월요일 0시(한국 시간)의 UTC ISO 구간. */
export function weekRange(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const localMidnightUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]) - PUBLISHING_TZ_OFFSET_MIN * 60 * 1000;
  const weekday = (new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() + 6) % 7; // 월=0
  const start = localMidnightUtc - weekday * 86400000;
  return { startIso: new Date(start).toISOString(), endIso: new Date(start + 7 * 86400000).toISOString() };
}

// ── 연결 코드·기기 토큰 (CONTRACT §4) ───────────────────────────────────────

export function generatePairingCode(randomBytes = crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH))) {
  return Array.from(randomBytes.slice(0, PAIRING_CODE_LENGTH), (b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join("");
}

/** 사람이 'ab12 cd34', 'AB12-CD34' 처럼 넣어도 같은 코드로 읽는다. 형식이 아니면 "". */
export function normalizePairingCode(raw) {
  const s = String(raw || "").toUpperCase().replace(/[\s-]+/g, "");
  return new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`).test(s) ? s : "";
}

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 기기 토큰 'npt_…'. 서버는 이 값을 저장하지 않고 sha256 만 저장한다. */
export function generateDeviceToken() {
  return `npt_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function randomId(prefix) {
  return `${prefix}_${generatePairingCode(crypto.getRandomValues(new Uint8Array(8))).toLowerCase()}${Date.now().toString(36)}`;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** '0.1.10' 과 '0.1.9' 를 숫자로 비교. a<b → -1. */
export function compareVersions(a, b) {
  const pa = String(a || "0").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// ── 이미지 크기 (PNG·JPEG·WebP·GIF 머리글만 읽는다) ─────────────────────────

/** @param {Uint8Array} b @returns {{ width:number, height:number, contentType:string } | null} */
export function imageInfo(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0, contentType: "image/png" };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: b[6] | b[7] << 8, height: b[8] | b[9] << 8, contentType: "image/gif" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === "VP8X") return { width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16), contentType: "image/webp" };
    if (kind === "VP8 ") return { width: (b[26] | b[27] << 8) & 0x3fff, height: (b[28] | b[29] << 8) & 0x3fff, contentType: "image/webp" };
    if (kind === "VP8L") {
      const v = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24;
      return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff), contentType: "image/webp" };
    }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b[i + 2] << 8 | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b[i + 7] << 8 | b[i + 8], height: b[i + 5] << 8 | b[i + 6], contentType: "image/jpeg" };
      }
      i += 2 + len;
    }
  }
  return null;
}

// ── SNS 채널(api 방식) ─────────────────────────────────────────────────────
// 승인되면 서버가 기존 SNS 예약 대기열(sns_scheduled_posts)에 넣고, 정기 실행이 SNS 세팅에 연결된 계정으로 /api/sns/publish 에 보낸다.
// 게시 로직은 SNS 세팅 '배포'와 한 벌이다 — 여기서는 글 → 게시 요청 모양과 채널별 내용 검사만 한다.

/** 사진·영상 없이 올릴 수 없는 채널(/api/sns/publish 가 미디어 없는 단일 게시를 거절한다). */
export const SNS_MEDIA_REQUIRED = new Set(["instagram", "facebook"]);
/** 채널별 본문 글자 한도(해시태그 포함). X 는 한글·한자 등을 2자로 센다(snsTextLength). */
export const SNS_TEXT_LIMITS = { x: 280, threads: 500, discord: 2000, instagram: 2200, facebook: 60000 };
/** 한 게시에 붙일 수 있는 사진·영상 수. */
export const SNS_MEDIA_MAX = { x: 4, threads: 10, discord: 10, instagram: 10, facebook: 10 };
/** 첫 댓글(첫 답글)을 다는 채널. */
const SNS_FIRST_COMMENT = new Set(["instagram", "threads", "x"]);

/** X 글자 수(twitter-text 가중치): 라틴·기본 문장부호는 1, 그 밖(한글 등)은 2, 주소는 23. 다른 채널은 글자 수 그대로. */
export function snsTextLength(type, text) {
  const s = String(text == null ? "" : text);
  if (type !== "x") return [...s].length;
  let n = 0;
  const withoutUrls = s.replace(/https?:\/\/\S+/g, () => { n += 23; return ""; });
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

/** SNS 본문: 글 본문 표시를 서식 없는 글자로 바꾸고(이미지 자리는 뺀다) 태그를 #태그 한 줄로 붙인다. 제목은 SNS 에 올리지 않는다(글 목록용 이름). */
export function snsCaption({ body, tags }) {
  const text = blocksToPlainText(markupToBlocks(body, []).filter((b) => b.type !== "image")).trim();
  const tagLine = (Array.isArray(tags) ? tags : []).map((t) => String(t || "").replace(/^#/, "").trim()).filter(Boolean).map((t) => `#${t}`).join(" ");
  return [text, tagLine].filter(Boolean).join("\n\n");
}

/** 승인 때 막을 SNS 내용 문제. 반환: 막는 이유 | "". */
export function snsContentBlock(type, { caption, mediaCount }) {
  if (SNS_MEDIA_REQUIRED.has(type) && !mediaCount) return "media_required";
  if (!String(caption || "").trim() && !mediaCount) return "content_required";
  const limit = SNS_TEXT_LIMITS[type];
  if (limit && snsTextLength(type, caption) > limit) return "text_too_long";
  if (mediaCount > (SNS_MEDIA_MAX[type] || 10)) return "too_many_media";
  return "";
}

/**
 * /api/sns/publish 요청 본문(SNS 세팅 '배포'와 같은 모양). media: [{ mediaType:'image'|'video', gcsPath:객체 이름 }].
 * 한 장이면 단일 게시, 여러 장이면 묶음(mediaItems) — 인스타 묶음은 2장부터라 한 장을 묶음으로 보내지 않는다.
 */
export function buildSnsPublishBody({ type, caption, firstComment, media }) {
  const list = (Array.isArray(media) ? media : []).filter((m) => m && m.gcsPath).slice(0, SNS_MEDIA_MAX[type] || 10)
    .map((m) => ({ mediaType: m.mediaType === "video" ? "video" : "image", gcsPath: String(m.gcsPath) }));
  const body = { platform: type, caption: String(caption || "") };
  const comment = cleanText(firstComment, 2000);
  if (comment && SNS_FIRST_COMMENT.has(type)) body.firstComment = comment;
  if (list.length === 1) { body.mediaType = list[0].mediaType; body.mediaGcsPath = list[0].gcsPath; }
  else if (list.length > 1) body.mediaItems = list;
  return body;
}

// ── 캠페인 ─────────────────────────────────────────────────────────────────
// 캠페인 = 한 브랜드(프로젝트 시리즈)의 기간 행사 홍보. 에이전트가 지침 문서(업무 파일)와 날짜별 글 초안을 만들고,
// 사람은 퍼블리싱 '개요'에서 주 단위로 승인한다. 글은 externalId `campaign:<캠페인 id>:<글 key>` 라 다시 보내도 같은 글을 고친다.

/** 에이전트 도구 한 번에 받는 글 수(대화 한 턴의 출력·DB 쓰기 크기). 더 많으면 나눠 부른다. */
export const CAMPAIGN_POSTS_PER_CALL = 20;
export const CAMPAIGN_MAX_DAYS = 120;

/** 'YYYY-MM-DD' 형식이고 실제 날짜인지. */
export function isDateKey(v) {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** 한국 날짜·시각('2026-11-03', '20:00') → UTC ISO. 형식이 틀리면 "". */
export function kstDateTimeIso(date, time) {
  if (!isDateKey(date)) return "";
  const t = String(time || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!t || +t[1] > 23 || +t[2] > 59) return "";
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, +t[1], +t[2]) - PUBLISHING_TZ_OFFSET_MIN * 60000).toISOString();
}

/** 캠페인·글 key → 비교용 모양(소문자, 띄어쓰기는 -, 글자·숫자·_·- 만). 같은 key 는 같은 캠페인(글)이다. */
export function normalizeCampaignKey(raw) {
  return cleanText(raw, 120).toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]+/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/** 캠페인 id 는 사용자·key 로 정해진다 — 에이전트가 글을 여러 번 나눠 보내도 같은 캠페인에 쌓인다. */
export async function campaignIdFor(userId, key) {
  return `cmp_${(await sha256Hex(`${userId}\n${normalizeCampaignKey(key)}`)).slice(0, 20)}`;
}

export function campaignExternalId(campaignId, postKey) {
  return `campaign:${campaignId}:${normalizeCampaignKey(postKey)}`;
}

/** 캠페인 머리(key·제목·브랜드·목적·기간). 반환: { ok, campaign } | { ok:false, error }. */
export function normalizeCampaignInput(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const key = normalizeCampaignKey(src.key || src.campaign || src.title);
  if (!key) return { ok: false, error: "campaign_key_required" };
  const title = cleanText(src.title, 120) || key;
  const startDate = String(src.startDate || "").trim();
  const endDate = String(src.endDate || "").trim();
  if (startDate && !isDateKey(startDate)) return { ok: false, error: "campaign_start_invalid" };
  if (endDate && !isDateKey(endDate)) return { ok: false, error: "campaign_end_invalid" };
  if (startDate && endDate) {
    const span = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
    if (span < 0) return { ok: false, error: "campaign_range_invalid" };
    if (span > CAMPAIGN_MAX_DAYS) return { ok: false, error: "campaign_range_too_long" };
  }
  return {
    ok: true,
    campaign: {
      key, title, startDate, endDate,
      brandId: cleanText(src.brandId, 120), brandTitle: cleanText(src.brandTitle, 120),
      goal: cleanText(src.goal, 2000),
    },
  };
}

/** 업무 파일 상대 경로(앞뒤 / 없앰, '.'·'..' 금지). 틀리면 "". */
export function cleanWorkPath(raw) {
  const p = cleanText(raw, 600).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!p || p.split("/").some((seg) => seg === ".." || seg === ".")) return "";
  return p;
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;

/**
 * 캠페인 글 하나. channel 은 채널 종류(instagram·naver_blog·reddit…) 또는 채널 id(ch_…), target 은 같은 종류 채널 고르기용
 * (서브레딧·갤러리 id·채널 이름). 시각은 scheduledAt(ISO) 또는 date + time(한국 시간, 기본 09:00).
 * images·videos 는 업무 파일 경로(사진은 승인 전에 퍼블리싱 저장소로 복사, 영상은 경로를 가리킨다).
 * 반환: { ok, post } | { ok:false, error }.
 */
export function normalizeCampaignPost(raw, index = 0) {
  const src = raw && typeof raw === "object" ? raw : {};
  const channel = cleanText(src.channel || src.channelType || src.channelId, 80);
  if (!channel) return { ok: false, error: "post_channel_required" };
  const scheduledAt = Number.isFinite(Date.parse(String(src.scheduledAt || "")))
    ? new Date(Date.parse(String(src.scheduledAt))).toISOString()
    : kstDateTimeIso(String(src.date || "").trim(), src.time || "09:00");
  if (!scheduledAt) return { ok: false, error: "post_time_invalid" };
  const body = String(src.body || src.caption || "").replace(/\r\n?/g, "\n").trim().slice(0, 60000);
  const firstLine = body.split("\n").map((l) => l.replace(/^#+\s*|^■\s*/, "").replace(/\*\*/g, "").trim()).find(Boolean) || "";
  const title = normalizeTitle(src.title || firstLine);
  if (!title) return { ok: false, error: "title_required" };
  const paths = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(cleanWorkPath).filter(Boolean);
  const media = [...paths(src.images), ...paths(src.media), ...paths(src.videos)];
  const images = [...new Set(media.filter((p) => !VIDEO_EXT.test(p)))].slice(0, 20);
  const videos = [...new Set(media.filter((p) => VIDEO_EXT.test(p)))].slice(0, 10);
  if (!body && !images.length && !videos.length) return { ok: false, error: "post_body_required" };
  const key = normalizeCampaignKey(src.key) || normalizeCampaignKey(`${scheduledAt.slice(0, 16)}-${channel}-${index + 1}`);
  return {
    ok: true,
    post: {
      key, channel, target: cleanText(src.target, 200), scheduledAt, title, body,
      tags: normalizeTagList(src.tags || src.hashtags), images, videos,
      firstComment: cleanText(src.firstComment, 2000), notes: String(src.notes || "").slice(0, 4000),
    },
  };
}
