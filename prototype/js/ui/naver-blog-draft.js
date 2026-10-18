/* 네이버 블로그 원고 → 붙여넣기용 HTML.
 *
 * 원고 본문은 편집칸에서 바로 고칠 수 있게 가벼운 표시로 둔다:
 *   ## 소제목   **굵게**   - 목록   1. 번호 목록   [이미지 N]   (빈 줄 = 단락 구분)
 * [본문 복사]를 누르는 순간 이 파일이 서식 있는 HTML 로 바꿔 클립보드에 text/html 로 싣는다.
 * 그래서 사용자가 고친 내용이 그대로 복사된다 — HTML 을 따로 저장해 두면 고친 뒤 옛 본문이 복사된다.
 *
 * 모든 글자는 이스케이프한다. 원고에 들어 있는 태그는 글자로만 남는다.
 * 클래식 스크립트다(모듈 아님). brand-studio.js 보다 먼저 로드한다.
 */
(function (root) {
  'use strict';

  var HEAD = /^#{1,4}\s+(.+)$/;
  var BULLET = /^[-•*]\s+(.+)$/;
  var NUMBERED = /^\d{1,2}[.)]\s+(.+)$/;
  var IMAGE = /^\[\s*(?:이미지|사진|image|photo)\s*(\d{1,2})\s*\]$/i;

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** 한 줄 안의 **굵게** 만 태그로 바꾼다. 짝이 안 맞는 ** 는 글자로 둔다. */
  function inline(s) {
    return esc(s).replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  }

  function lines(text) {
    return String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  }

  /**
   * 소제목은 <h3><strong> 로 감싼다. 스마트에디터가 제목 태그를 버려도 굵게는 남는다.
   * [이미지 N] 은 혼자 한 단락이다 — 사용자가 그 자리에 사진을 붙여 넣고 표시를 지운다.
   */
  function toHtml(text) {
    var out = [];
    var para = [];
    var list = null;   // { tag: 'ul'|'ol', items: [] }

    function flushPara() {
      if (!para.length) return;
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }
    function flushList() {
      if (!list) return;
      out.push('<' + list.tag + '>' + list.items.map(function (it) { return '<li>' + inline(it) + '</li>'; }).join('') + '</' + list.tag + '>');
      list = null;
    }
    function pushItem(tag, item) {
      flushPara();
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag: tag, items: [] };
      list.items.push(item);
    }

    lines(text).forEach(function (raw) {
      var t = raw.trim();
      var m;
      if (!t) { flushPara(); flushList(); return; }
      if ((m = t.match(HEAD))) {
        flushPara(); flushList();
        out.push('<h3><strong>' + inline(m[1].replace(/\*\*/g, '')) + '</strong></h3>');
        return;
      }
      if (IMAGE.test(t)) {
        flushPara(); flushList();
        out.push('<p>' + esc(t) + '</p>');
        return;
      }
      if ((m = t.match(BULLET))) { pushItem('ul', m[1]); return; }
      if ((m = t.match(NUMBERED))) { pushItem('ol', m[1]); return; }
      flushList();
      para.push(t);
    });
    flushPara();
    flushList();
    return out.join('\n');
  }

  /** text/plain 짝. 표시 기호만 걷어 내고 줄 구조는 그대로 둔다. */
  function toPlain(text) {
    return lines(text).map(function (raw) {
      var t = raw.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
      var m = t.trim().match(HEAD);
      if (m) return m[1].replace(/\*\*/g, '');
      m = t.trim().match(BULLET);
      if (m) return '• ' + m[1];
      return t;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  root.NKNaverBlogDraft = { toHtml: toHtml, toPlain: toPlain };
})(typeof globalThis !== 'undefined' ? globalThis : this);
