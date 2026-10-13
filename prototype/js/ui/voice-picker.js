// 보이스 선택 창 — IP 라이브러리 캐릭터 카드의 보이스 버튼이 연다.
// 사운드 스튜디오의 보이스 라이브러리와 같은 카탈로그(js/constants/voice-catalog.js)·같은 모양(.snd-modal*)을 쓰고,
// 카드를 누르면 onSelect(voice) 로 고른 보이스를 돌려준다.
;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var picker = ui.voicePicker || (ui.voicePicker = {});

  var TEXT = {
    ko: {
      title: '보이스 라이브러리', search: '이름·스타일 검색...', genderAll: '성별: 전체', male: '남', female: '여',
      cat_all: '전체 분류', cat_adult: '성인', cat_girl: '여아', cat_boy: '남아', cat_character: '캐릭터',
      preview: '미리듣기', loading: '생성 중', empty: '보이스가 없습니다.', previewFail: '미리듣기 실패: ', close: '닫기'
    },
    en: {
      title: 'Voice Library', search: 'Search name or style...', genderAll: 'Gender: All', male: 'Male', female: 'Female',
      cat_all: 'All types', cat_adult: 'Adult', cat_girl: 'Girl', cat_boy: 'Boy', cat_character: 'Character',
      preview: 'Preview', loading: 'Loading', empty: 'No voices found.', previewFail: 'Preview failed: ', close: 'Close'
    }
  };

  function lang() { return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko'; }
  function t(key) { var d = TEXT[lang()] || TEXT.ko; return d[key] != null ? d[key] : key; }
  function el(tag, cls, props) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'textContent' || k === 'innerHTML' || k === 'type' || k === 'value' || k === 'placeholder' || k === 'title') n[k] = props[k];
      else n.setAttribute(k, props[k]);
    });
    return n;
  }
  function catalog() {
    var c = NK.constants && NK.constants.voiceCatalog;
    return c ? (c.GEMINI_VOICES || []).concat(c.CHARACTER_VOICES || []) : [];
  }
  function categories() {
    var c = NK.constants && NK.constants.voiceCatalog;
    return (c && c.VOICE_CATEGORIES) || [''];
  }
  picker.voiceLabel = function (v) { return lang() === 'en' && v && v.nameEn ? v.nameEn : String((v && v.name) || ''); };
  function voiceDesc(v) { return lang() === 'en' && v.descriptionEn ? v.descriptionEn : String(v.description || ''); }

  // 미리듣기 URL 은 서버가 보이스마다 한 번만 합성해 둔 샘플의 서명 URL 이다. 탭 안에서는 다시 묻지 않는다.
  var previewCache = {};
  var previewAudio = null;
  function stopPreview() { if (previewAudio) { try { previewAudio.pause(); } catch (_) {} previewAudio = null; } }

  /**
   * @param {{ selectedVoiceId?: string, onSelect: function(object) }} opts
   * @returns {function} close
   */
  picker.open = function (opts) {
    opts = opts || {};
    var all = catalog();
    var state = { search: '', gender: '', category: '', busyId: '' };

    var overlay = el('div', 'snd-modal-overlay voice-picker-overlay');
    var modal = el('div', 'snd-modal');
    function close() {
      stopPreview();
      document.removeEventListener('keydown', onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);

    var head = el('div', 'snd-modal-head');
    head.appendChild(el('span', 'snd-modal-title', { textContent: t('title') }));
    var count = el('span', 'snd-modal-count');
    head.appendChild(count);
    // Lucide x
    var closeBtn = el('button', 'snd-modal-close', { type: 'button', title: t('close'), 'aria-label': t('close'),
      innerHTML: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' });
    closeBtn.addEventListener('click', close);
    head.appendChild(closeBtn);
    modal.appendChild(head);

    var filters = el('div', 'snd-modal-filters');
    var search = el('input', 'snd-modal-search', { type: 'text', placeholder: t('search') });
    search.addEventListener('input', function () { state.search = search.value; refresh(); });
    filters.appendChild(search);
    var genderTabs = el('div', 'snd-seg-tabs');
    [['', t('genderAll')], ['male', t('male')], ['female', t('female')]].forEach(function (g) {
      var b = el('button', 'snd-seg-tab' + (state.gender === g[0] ? ' is-active' : ''), { type: 'button', textContent: g[1], 'data-gender': g[0] });
      b.addEventListener('click', function () { state.gender = g[0]; markActive(genderTabs, 'data-gender', g[0]); refresh(); });
      genderTabs.appendChild(b);
    });
    filters.appendChild(genderTabs);
    var catTabs = el('div', 'snd-seg-tabs');
    categories().forEach(function (c) {
      var b = el('button', 'snd-seg-tab' + (state.category === c ? ' is-active' : ''), { type: 'button', textContent: t(c ? 'cat_' + c : 'cat_all'), 'data-category': c });
      b.addEventListener('click', function () { state.category = c; markActive(catTabs, 'data-category', c); refresh(); });
      catTabs.appendChild(b);
    });
    filters.appendChild(catTabs);
    modal.appendChild(filters);

    var body = el('div', 'snd-modal-body');
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function markActive(box, attr, value) {
      Array.prototype.forEach.call(box.querySelectorAll('[' + attr + ']'), function (x) { x.classList.toggle('is-active', x.getAttribute(attr) === value); });
    }
    function filtered() {
      var q = state.search.trim().toLowerCase();
      return all.filter(function (v) {
        if (state.gender && v.gender !== state.gender) return false;
        if (state.category && (v.category || 'adult') !== state.category) return false;
        if (q) {
          var hay = (v.name + ' ' + (v.nameEn || '') + ' ' + (v.description || '') + ' ' + (v.descriptionEn || '') + ' ' + t('cat_' + (v.category || 'adult'))).toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    }
    function refresh() {
      var list = filtered();
      count.textContent = '(' + list.length + '/' + all.length + ')';
      body.innerHTML = '';
      if (!list.length) { body.appendChild(el('div', 'snd-modal-empty', { textContent: t('empty') })); return; }
      list.forEach(function (v) { body.appendChild(card(v)); });
    }
    function card(v) {
      var selected = String(opts.selectedVoiceId || '') === String(v.id);
      var c = el('div', 'snd-voice-card' + (selected ? ' is-selected' : ''));
      var h = el('div', 'snd-vc-head');
      h.appendChild(el('span', 'snd-vc-avatar', { textContent: picker.voiceLabel(v).charAt(0).toUpperCase() }));
      var nb = el('div');
      nb.appendChild(el('div', 'snd-vc-name', { textContent: picker.voiceLabel(v) }));
      nb.appendChild(el('div', 'snd-vc-sub', { textContent: (v.gender || 'neutral').toUpperCase() + ' · ' + (v.language || 'ko').toUpperCase() + (v.category && v.category !== 'adult' ? ' · ' + t('cat_' + v.category) : '') }));
      h.appendChild(nb);
      c.appendChild(h);
      if (voiceDesc(v)) c.appendChild(el('div', 'snd-vc-desc', { textContent: voiceDesc(v) }));
      var foot = el('div', 'snd-vc-foot');
      var pv = el('button', 'snd-vc-preview', { type: 'button' });
      if (state.busyId === v.id) {
        pv.textContent = t('loading');
        pv.disabled = true;
      } else {
        // Lucide play
        pv.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>';
        pv.appendChild(document.createTextNode(t('preview')));
        pv.addEventListener('click', function (e) { e.stopPropagation(); preview(v); });
      }
      foot.appendChild(pv);
      c.appendChild(foot);
      c.addEventListener('click', function () {
        close();
        if (typeof opts.onSelect === 'function') opts.onSelect(v);
      });
      return c;
    }
    function play(url) {
      stopPreview();
      try { previewAudio = new Audio(url); previewAudio.play(); } catch (_) {}
    }
    function preview(v) {
      if (state.busyId) return;
      if (previewCache[v.id]) { play(previewCache[v.id]); return; }
      if (!NK.api || !NK.api.soundVoicePreview) return;
      state.busyId = v.id;
      refresh();
      NK.api.soundVoicePreview({ provider: v.provider === 'gemini' ? 'gemini' : 'elevenlabs', voice: v.providerVoiceId || v.name || '' })
        .then(function (res) {
          if (res && res.url) { previewCache[v.id] = res.url; play(res.url); }
        })
        .catch(function (err) { alert(t('previewFail') + (err && err.message ? err.message : err)); })
        .finally(function () { state.busyId = ''; if (overlay.parentNode) refresh(); });
    }

    refresh();
    setTimeout(function () { try { search.focus(); } catch (_) {} }, 30);
    return close;
  };
})();
