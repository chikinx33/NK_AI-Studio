// pipeline-mention.js
// 편집 가능한 프롬프트/더빙 필드에서 '@' 를 입력하면 브랜드 허브 자산
// (캐릭터·배경·소품) 이름이 드롭다운으로 떠 직접 타이핑 없이 선택할 수 있게 한다.
; (function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var NK = window.NK = window.NK || {};

  var POP_ID = 'nk-mention-pop';
  var state = {
    open: false, items: [], filtered: [], active: 0,
    fieldEl: null, atNode: null, atIndex: -1, query: '', suppressEnterKeyup: false
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isEditableMentionField(el) {
    if (!el || !el.getAttribute) return false;
    if (el.getAttribute('contenteditable') !== 'true') return false;
    return !!(el.closest && el.closest('.scene-row'));
  }

  function getCtxState() {
    try {
      var ctx = NK.uiPipeline && NK.uiPipeline.__ctx;
      return ctx && ctx.getState ? ctx.getState() : null;
    } catch (_) { return null; }
  }

  function resolveBrandId(st) {
    try {
      var payload = st && st.payload ? st.payload : {};
      var proj = NK.service && NK.service.project;
      var id = '';
      if (proj && proj.getBrandId) {
        id = proj.getBrandId(payload) || '';
        if (!id && st && st.draftId) id = proj.getBrandId(st.draftId) || '';
      }
      return id || payload.brandId || '';
    } catch (_) { return ''; }
  }

  // 브랜드 허브 자산 → 자동완성 후보 [{token, label, kind}]
  function buildSuggestions() {
    var st = getCtxState();
    var brandId = resolveBrandId(st);
    var out = [];
    var seen = {};
    var push = function (token, label, kind) {
      var t = String(token || '').trim();
      if (!t) return;
      if (t.charAt(0) !== '@') t = '@' + t;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ token: t, label: String(label || t.replace(/^@/, '')), kind: kind });
    };
    try {
      var reg = NK.service && NK.service.characterRegistry;
      if (reg && reg.listCharactersByBrand) {
        var chars = reg.listCharactersByBrand(brandId, { payload: st && st.payload }) || [];
        chars.forEach(function (c) {
          if (c && c.isActive !== false) push(c.trigger || c.name, c.name || c.trigger, '캐릭터');
        });
      }
    } catch (_) { }
    try {
      var brand = null;
      if (NK.service && NK.service.brand) {
        brand = (brandId && NK.service.brand.getById) ? NK.service.brand.getById(brandId) : null;
        if (!brand && NK.service.brand.getCurrent) brand = NK.service.brand.getCurrent();
      }
      var envs = brand && Array.isArray(brand.environmentAssets) ? brand.environmentAssets : [];
      envs.forEach(function (e) {
        if (e) push(e.token || e.displayName, e.displayName || e.token, '배경·소품');
      });
    } catch (_) { }
    return out;
  }

  // 캐럿 직전 텍스트가 '@질의' 패턴이면 위치/질의를 반환
  function caretMentionQuery() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed) return null;
    var node = range.endContainer;
    if (!node || node.nodeType !== 3) return null; // 텍스트 노드만
    var offset = range.endOffset;
    var before = String(node.textContent || '').slice(0, offset);
    var m = before.match(/@([^\s@]{0,30})$/);
    if (!m) return null;
    return { node: node, offset: offset, atIndex: offset - m[0].length, query: m[1] };
  }

  function ensurePop() {
    var pop = document.getElementById(POP_ID);
    if (!pop) {
      pop = document.createElement('div');
      pop.id = POP_ID;
      pop.className = 'mention-pop';
      document.body.appendChild(pop);
      // mousedown 으로 처리 → 필드 blur 전에 선택 적용
      pop.addEventListener('mousedown', function (e) {
        var item = e.target.closest ? e.target.closest('[data-mi]') : null;
        if (!item) return;
        e.preventDefault();
        applySelection(Number(item.getAttribute('data-mi')));
      });
      pop.addEventListener('mousemove', function (e) {
        var item = e.target.closest ? e.target.closest('[data-mi]') : null;
        if (!item) return;
        var i = Number(item.getAttribute('data-mi'));
        if (i !== state.active) { state.active = i; renderPop(); }
      });
    }
    return pop;
  }

  function renderPop() {
    var pop = ensurePop();
    pop.innerHTML = state.filtered.map(function (s, i) {
      return '<div class="mention-item' + (i === state.active ? ' is-active' : '') + '" data-mi="' + i + '">' +
        '<span class="mention-token">' + escapeHtml(s.token) + '</span>' +
        '<span class="mention-kind">' + escapeHtml(s.kind || '') + '</span>' +
        '</div>';
    }).join('');
    pop.style.display = 'block';
  }

  function positionPop() {
    var pop = document.getElementById(POP_ID);
    if (!pop) return;
    var rect = null;
    try {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var r = sel.getRangeAt(0).cloneRange();
        r.collapse(true);
        rect = r.getBoundingClientRect();
      }
    } catch (_) { }
    if (!rect || (!rect.left && !rect.top && !rect.bottom)) {
      rect = state.fieldEl ? state.fieldEl.getBoundingClientRect() : { left: 20, bottom: 60 };
    }
    var top = rect.bottom + window.scrollY + 4;
    var left = rect.left + window.scrollX;
    var maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function openPop(el, info) {
    var all = buildSuggestions();
    var q = String(info.query || '').toLowerCase();
    var filtered = all.filter(function (s) {
      return !q || s.label.toLowerCase().indexOf(q) >= 0 || s.token.toLowerCase().indexOf(q) >= 0;
    }).slice(0, 8);
    if (!filtered.length) { closePop(); return; }
    state.open = true;
    state.fieldEl = el;
    state.filtered = filtered;
    state.active = 0;
    state.atNode = info.node;
    state.atIndex = info.atIndex;
    state.query = info.query;
    renderPop();
    positionPop();
  }

  function closePop() {
    state.open = false; state.fieldEl = null; state.filtered = []; state.atNode = null; state.atIndex = -1;
    var pop = document.getElementById(POP_ID);
    if (pop) pop.style.display = 'none';
  }

  function applySelection(i) {
    var item = state.filtered[i];
    var node = state.atNode;
    if (!item || !node || node.nodeType !== 3) { closePop(); return; }
    var sel = window.getSelection();
    var offset = (sel && sel.rangeCount && sel.getRangeAt(0).endContainer === node)
      ? sel.getRangeAt(0).endOffset
      : String(node.textContent || '').length;
    var text = String(node.textContent || '');
    var atIndex = state.atIndex;
    if (text.charAt(atIndex) !== '@') {
      atIndex = text.slice(0, offset).lastIndexOf('@');
      if (atIndex < 0) { closePop(); return; }
    }
    var after = text.slice(offset);
    var newBefore = text.slice(0, atIndex) + item.token + ' ';
    node.textContent = newBefore + after;
    try {
      var range = document.createRange();
      range.setStart(node, newBefore.length);
      range.collapse(true);
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    } catch (_) { }
    closePop();
    // 필드가 변경을 인지하도록(상태 커밋 트리거 등) input 이벤트 발생
    try { state.fieldEl && state.fieldEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { }
  }

  // ── 입력 감지 ──
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!isEditableMentionField(el)) { closePop(); return; }
    var info = caretMentionQuery();
    if (!info) { closePop(); return; }
    openPop(el, info);
  }, true);

  // ── 키보드 내비게이션 (capture: 필드 핸들러보다 먼저) ──
  document.addEventListener('keydown', function (e) {
    if (!state.open || !state.filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      state.active = (state.active + 1) % state.filtered.length; renderPop();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      state.active = (state.active - 1 + state.filtered.length) % state.filtered.length; renderPop();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (e.isComposing) return; // IME 조합 확정은 방해하지 않음
      e.preventDefault(); e.stopPropagation();
      state.suppressEnterKeyup = true; // 뒤따르는 keyup 의 필드 동작(더빙 적용/blur) 차단
      applySelection(state.active);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); closePop();
    }
  }, true);

  // 선택에 쓰인 Enter/Tab 의 keyup 이 필드 핸들러로 전파되지 않도록 차단
  document.addEventListener('keyup', function (e) {
    if (state.suppressEnterKeyup && (e.key === 'Enter' || e.key === 'Tab')) {
      state.suppressEnterKeyup = false;
      e.preventDefault(); e.stopPropagation();
    }
  }, true);

  // 바깥 클릭/스크롤/포커스 이탈 시 닫기
  document.addEventListener('mousedown', function (e) {
    if (!state.open) return;
    var pop = document.getElementById(POP_ID);
    if (pop && pop.contains(e.target)) return;
    closePop();
  }, true);
  document.addEventListener('scroll', function () { if (state.open) closePop(); }, true);
  document.addEventListener('focusout', function (e) {
    if (!state.open) return;
    if (e.target === state.fieldEl) setTimeout(function () { closePop(); }, 120);
  }, true);
})();
