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

  // 배경·소품이 브랜드 캐시에 비어 있고 서버에만 있을 때를 대비한 1회성 하이드레이션 캐시.
  var hydratedBrandCache = {};
  var hydratingBrand = {};
  function ensureBrandHydrated(brandId) {
    if (!brandId || hydratedBrandCache[brandId] || hydratingBrand[brandId]) return;
    if (!(NK.service && NK.service.brand && NK.service.brand.hydrateFromServer)) return;
    hydratingBrand[brandId] = true;
    try {
      Promise.resolve(NK.service.brand.hydrateFromServer(brandId, { ttlMs: 0 }))
        .then(function (b) {
          hydratedBrandCache[brandId] = b || (NK.service.brand.getById ? NK.service.brand.getById(brandId) : null) || null;
        })
        .catch(function () { })
        .then(function () { hydratingBrand[brandId] = false; });
    } catch (_) { hydratingBrand[brandId] = false; }
  }

  // 파이프라인(scenes) 컨텍스트엔 environmentAssets 가 안 실릴 수 있어, 서버에서 프로젝트를
  // 직접 받아 payload(브랜드 허브가 저장하는 곳)를 캐시한다. 이게 가장 권위 있는 소스.
  var projectEnvCache = {};
  var projectEnvLoading = {};
  function ensureProjectEnvHydrated(projectId, onDone) {
    if (!projectId) return;
    if (projectEnvCache[projectId] !== undefined) return;
    if (projectEnvLoading[projectId]) return;
    if (!(NK.api && NK.api.projectGet)) return;
    projectEnvLoading[projectId] = true;
    try {
      Promise.resolve(NK.api.projectGet(projectId))
        .then(function (res) {
          var data = res && (res.data || res);
          projectEnvCache[projectId] = (data && (data.payload || data)) || null;
        })
        .catch(function () { projectEnvCache[projectId] = null; })
        .then(function () {
          projectEnvLoading[projectId] = false;
          if (typeof onDone === 'function') { try { onDone(); } catch (_) { } }
        });
    } catch (_) { projectEnvLoading[projectId] = false; }
  }

  function resolveProjectId(st) {
    try {
      if (st && st.draftId) return String(st.draftId);
      var proj = NK.service && NK.service.project;
      if (proj && proj.getCurrentProjectId) return String(proj.getCurrentProjectId() || '');
    } catch (_) { }
    return '';
  }

  // 브랜드 허브 자산 → 자동완성 후보 [{token, label, kind}]
  function buildSuggestions() {
    var st = getCtxState();
    var brandId = resolveBrandId(st);
    var projectId = resolveProjectId(st);
    ensureBrandHydrated(brandId); // 다음 호출 때 환경 자산이 채워지도록 미리 받아둠
    ensureProjectEnvHydrated(projectId, refreshOpenPop); // 서버 로딩 완료 시 드롭다운 자동 갱신
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
    // 배경·소품(environmentAssets)은 payload·brand 양쪽에 여러 키로 저장될 수 있고
    // 브랜드 캐시엔 비어 있을 수 있으므로 가능한 모든 소스를 모은다.
    try {
      var collectEnvs = function (obj) {
        if (!obj || typeof obj !== 'object') return [];
        var acc = [];
        var keys = ['environmentAssets', 'knowledgeEnvironmentAssets'];
        keys.forEach(function (k) { if (Array.isArray(obj[k])) acc = acc.concat(obj[k]); });
        if (obj.knowledgeHub && typeof obj.knowledgeHub === 'object') {
          keys.forEach(function (k) { if (Array.isArray(obj.knowledgeHub[k])) acc = acc.concat(obj.knowledgeHub[k]); });
        }
        return acc;
      };
      var brand = null;
      if (NK.service && NK.service.brand) {
        if (brandId && NK.service.brand.getById) brand = NK.service.brand.getById(brandId);
        // brandId 가 비었거나 캐시에 환경 자산이 없으면 현재 프로젝트 기준으로 강하게 해석.
        if ((!brand || !collectEnvs(brand).length) && NK.service.brand.resolveCurrent) {
          var rc = null;
          try { rc = NK.service.brand.resolveCurrent({ payload: st && st.payload }); } catch (_) { }
          if (rc && (!brand || collectEnvs(rc).length > collectEnvs(brand).length)) brand = rc;
        }
        if (!brand && NK.service.brand.getCurrent) brand = NK.service.brand.getCurrent();
      }
      // 프로젝트 draft(브랜드 허브가 updatePayload 로 environmentAssets 를 저장하는 곳)도 소스로.
      var draftPayload = null;
      try {
        var pid = (st && st.draftId) ||
          (NK.service && NK.service.project && NK.service.project.getCurrentProjectId && NK.service.project.getCurrentProjectId());
        if (pid && NK.service && NK.service.project && NK.service.project.getDraftById) {
          var d = NK.service.project.getDraftById(pid);
          draftPayload = d ? (d.payload || d) : null;
        }
      } catch (_) { }
      var serverPayload = projectId ? projectEnvCache[projectId] : null;
      var envs = [].concat(
        collectEnvs(st && st.payload),
        collectEnvs(draftPayload),
        collectEnvs(brand),
        collectEnvs(brandId && hydratedBrandCache[brandId]),
        collectEnvs(serverPayload)
      );
      try {
        if (window.console && console.debug) {
          console.debug('[mention] env sources', {
            brandId: brandId,
            projectId: projectId,
            payload: collectEnvs(st && st.payload).length,
            draft: collectEnvs(draftPayload).length,
            brand: collectEnvs(brand).length,
            hydrated: collectEnvs(brandId && hydratedBrandCache[brandId]).length,
            server: collectEnvs(serverPayload).length
          });
        }
      } catch (_) { }
      envs.forEach(function (e) {
        if (!e) return;
        var raw = (typeof e === 'object') ? e : { displayName: e };
        var name = String(raw.displayName || raw.name || raw.title || '').trim();
        var token = String(raw.token || raw.trigger || '').trim();
        if (!token && name) token = '@' + name.replace(/\s+/g, '');
        if (!token) return;
        push(token, name || token.replace(/^@/, ''), '배경·소품');
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

  // 서버 자산 로딩이 끝났을 때, 같은 필드에 포커스가 있고 캐럿이 @질의 위치면 드롭다운을 다시 연다.
  function refreshOpenPop() {
    try {
      if (!state.fieldEl || document.activeElement !== state.fieldEl) return;
      var info = caretMentionQuery();
      if (info) openPop(state.fieldEl, info);
    } catch (_) { }
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

  // ── 편집 필드 포커스 시 브랜드 자산 미리 하이드레이트(첫 @ 에서도 배경·소품이 뜨도록) ──
  document.addEventListener('focusin', function (e) {
    if (!isEditableMentionField(e.target)) return;
    try {
      var st = getCtxState();
      ensureBrandHydrated(resolveBrandId(st));
      ensureProjectEnvHydrated(resolveProjectId(st));
    } catch (_) { }
  }, true);

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
