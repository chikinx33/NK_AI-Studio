/* 네이버 블로그 원고 후처리 — 서버(draft-generate.js)가 모델 출력을 저장 가능한 원고로 다듬는다.
 *
 * 네이버 블로그는 글쓰기 API 가 없다(2020 종료). 그래서 우리가 만드는 건 "원고"이고,
 * 사용자가 복사해 스마트에디터 ONE 에 붙여 넣는다. 원고 본문은 편집칸에서 바로 고칠 수 있게
 * 가벼운 표시(## 소제목 · **굵게** · - 목록 · [이미지 N])로 둔다. HTML 로 바꾸는 건
 * 복사하는 순간 화면 쪽(js/ui/naver-blog-draft.js)이 한다 — 원천이 하나여야 고친 내용이 남는다.
 *
 * 프롬프트로 막아도 모델은 가끔 어긴다. 어기면 안 되는 것만 여기서 결정론으로 거른다:
 *  - 링크는 구글 플레이·elidus.org 만(pages.dev 등 나머지는 지운다)
 *  - [이미지 N] 은 실제 첨부한 장수 안에서만
 *  - 태그는 10개까지
 */

export const NAVER_BLOG_TAG_MAX = 10;

/** 원고에 남길 수 있는 링크 호스트. 하위 도메인은 elidus.org 만 허용한다. */
export function isAllowedNaverBlogLink(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch (_) { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return host === "play.google.com" || host === "elidus.org" || host.endsWith(".elidus.org");
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** 모델이 지시를 어기고 HTML 로 답했을 때 원고 표시로 되돌린다. 태그가 없으면 그대로. */
export function htmlToMarkup(text) {
  const s = String(text || "");
  if (!/<\/?[a-z][^>]*>/i.test(s)) return s;
  return decodeEntities(
    s
      .replace(/\r\n?/g, "\n")
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, t) => "\n\n## " + t.replace(/<[^>]+>/g, "").trim() + "\n\n")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => "**" + t.trim() + "**")
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => "\n- " + t.replace(/<[^>]+>/g, "").trim())
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|ul|ol|blockquote)>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  );
}

/** 허용하지 않은 링크를 지운다. 링크만 있던 줄은 줄째 없앤다. */
export function stripDisallowedLinks(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const hadLink = /https?:\/\/|\.pages\.dev\b/i.test(line);
      let next = line.replace(/https?:\/\/[^\s<>"'()\]]+/gi, (url) => {
        const clean = url.replace(/[.,!?。]+$/, "");
        return isAllowedNaverBlogLink(clean) ? url : "";
      });
      // 스킴 없이 적힌 pages.dev 주소도 지운다(예: "nk-studio.pages.dev/app").
      next = next.replace(/\b[\w.-]+\.pages\.dev\b[^\s]*/gi, "");
      if (hadLink && !next.replace(/[\s:：·\-—>→👉]/g, "")) return null;
      return next.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/, "");
    })
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * [이미지 N] 자리표시를 정리한다. 표기를 하나로 맞추고, 첨부한 장수를 넘거나 겹치는 번호는 지운다.
 * 자리표시는 늘 단독 줄이다 — 사용자가 그 줄에 사진을 붙여 넣는다.
 */
export function normalizeImageMarkers(text, imageCount) {
  const n = Math.max(0, parseInt(imageCount, 10) || 0);
  const seen = new Set();
  const MARK = /\[\s*(?:이미지|사진|image|photo)\s*(\d{1,2})\s*\]/gi;
  return String(text || "")
    .split("\n")
    .flatMap((line) => {
      if (!MARK.test(line)) return [line];
      MARK.lastIndex = 0;
      const out = [];
      const rest = line.replace(MARK, (_, num) => {
        const k = parseInt(num, 10);
        if (k >= 1 && k <= n && !seen.has(k)) {
          seen.add(k);
          out.push("[이미지 " + k + "]");
        }
        return "";
      }).trim();
      return rest ? [rest, ...out] : out;
    })
    .join("\n");
}

/** 태그를 "#a #b" 꼴로 맞춘다. 공백·쉼표로 나누고, 겹치면 하나만, 최대 10개. */
export function normalizeNaverBlogTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,，]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = String(item || "").replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push("#" + tag);
    if (out.length >= NAVER_BLOG_TAG_MAX) break;
  }
  return out.join(" ");
}

function tidyBlankLines(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 모델 출력 → 원고. 본문은 caption 키로 약속했지만 모델이 body 로 답해도 caption 에 담는다.
 * 화면·배포 이력·보완 수정이 모두 caption 을 본문으로 읽기 때문이다.
 */
export function finalizeNaverBlogDraft(parsed, opts = {}) {
  const src = parsed && typeof parsed === "object" ? parsed : {};
  const out = Object.assign({}, src);
  delete out.body;
  const rawBody = String(src.body || src.caption || "");
  let body = htmlToMarkup(rawBody);
  body = stripDisallowedLinks(body);
  body = normalizeImageMarkers(body, opts.imageCount);
  out.caption = tidyBlankLines(body);
  const title = stripDisallowedLinks(htmlToMarkup(String(src.title || "")))
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  out.title = title;
  out.hashtags = normalizeNaverBlogTags(src.hashtags);
  return out;
}
