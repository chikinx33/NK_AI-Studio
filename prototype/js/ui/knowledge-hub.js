; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var knowledgeHub = ui.knowledgeHub || (ui.knowledgeHub = {});

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildStageUrl(page, projectId, brandId) {
    var safePage = String(page || '').trim() || 'dashboard.html';
    var safeProjectId = String(projectId || '').trim();
    var safeBrandId = String(brandId || '').trim();
    var parts = [];
    if (safeProjectId) parts.push('projectId=' + encodeURIComponent(safeProjectId));
    if (safeBrandId) parts.push('brandId=' + encodeURIComponent(safeBrandId));
    if (!parts.length) return safePage;
    return safePage + '?' + parts.join('&');
  }

  function applyCurrentLocale() {
    if (!NK.ui || !NK.ui.common || !NK.ui.common.applyRuntimeLocale) return;
    var lang = NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
    NK.ui.common.applyRuntimeLocale(lang);
  }

  function splitLines(value) {
    return String(value || '')
      .split(/\n+/)
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean);
  }

  function joinLines(value) {
    return (Array.isArray(value) ? value : [])
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean)
      .join('\n');
  }

  function compactSentence(value, maxLength) {
    var text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    var limit = Number(maxLength) || 120;
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(limit - 1, 1)).trim() + '…';
  }

  function normalizeText(value) {
    return String(value || '').replace(/[<>]/g, '').trim();
  }

  function normalizeCharacterName(value) {
    return normalizeText(value).replace(/^@+/, '').trim();
  }

  function normalizeCharacterPersonality(value) {
    return normalizeText(value).replace(/\s+/g, ' ').trim();
  }

  function getRuntimeLang() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }

  /**
   * 분석에 보낼 시트 이미지를 줄인다.
   *
   * 시트는 업로드한 원본 그대로 data: URL 로 보관된다. 4장이면 수십 MB 가 되고,
   * 그걸 JSON 본문에 실어 보내면 Pages Function 이 본문을 파싱하다 죽어
   * Cloudflare 가 502 를 돌려준다(우리 JSON 오류가 아니라 CF 오류 페이지가 뜬다).
   *
   * 원본은 그대로 두고 '보내는 사본'만 줄인다. 캐릭터 생김새를 서술하는 데
   * 원해상도는 필요 없고, 1024px 이면 충분하다.
   */
  /*
   * 분석용 사본의 최대 변.
   *
   * 왜 키웠나: 시트는 3×3 격자다. 1024 로 줄이면 개체 하나가 340px 안팎이라 다리처럼
   * 작은 부위가 뭉개져 개수를 잘못 센다(실제로 다리 2개를 "발 4개" 로 셌다).
   *
   * 왜 여기까지만인가 — 천장이 셋이다.
   *  1) 원본보다 크게는 못 보낸다(아래 Math.min(1, ...) 로 확대는 하지 않는다).
   *     흔한 시트가 1920~2048 이라 2048 이면 사실상 원본 그대로다. 더 올려도 그대로다.
   *  2) Gemini 는 큰 이미지를 768px 타일로 잘라 읽고, 최대 변 3072 를 넘으면 자기가 줄인다.
   *     그 위로는 토큰과 시간만 늘고 보이는 것은 같다.
   *  3) 본문 상한 12MB(서버). 2048 JPEG 4장이면 base64 로 3MB 안팎이라 여유가 있지만,
   *     클수록 업로드·분석이 느려지고 그게 곧 504 였다.
   */
  var ANALYZE_MAX_EDGE = 2048;
  /*
   * 손대지 않고 그냥 보내도 되는 한 장의 크기(data URL 문자열 길이 기준).
   *
   * 서버 본문 상한이 12MB 이고 시트는 최대 4장이라 장당 2.5MB 면 넉넉히 들어간다.
   * 이 안에 들고 크기도 이미 작으면 다시 굽지 않는다 — 다시 구우면 JPEG 이 한 번 더
   * 손실되고, 그 손실이 하필 눈·경계선 같은 작은 부위에 먼저 낀다.
   */
  var ANALYZE_PASSTHROUGH_BYTES = 2.5 * 1024 * 1024;
  // 다시 구울 때의 화질. 0.85 는 경계선에 잡티가 껴서 부위 개수를 세는 데 불리했다.
  var ANALYZE_JPEG_QUALITY = 0.92;
  function shrinkForAnalyze(dataUrl) {
    return new Promise(function (resolve) {
      var raw = String(dataUrl || '');
      // 원격 URL(gs://·https)은 서버가 직접 받아오므로 줄일 대상이 아니다.
      if (!/^data:image\//i.test(raw)) { resolve(raw); return; }
      try {
        var img = new Image();
        img.onload = function () {
          try {
            var W = img.naturalWidth || img.width;
            var H = img.naturalHeight || img.height;
            if (!W || !H) { resolve(raw); return; }
            /*
             * 줄일 필요도 없고 크기도 작으면 원본을 그대로 보낸다.
             *
             * 캔버스를 한 번 거치면 그만큼 화질이 깎인다(JPEG 재압축). 줄이지도 않으면서
             * 굳이 다시 구울 이유가 없다. 처음부터 2000px 이하로 올려 두면 이 길로 간다.
             * 큰 파일이 들어올 때를 대비한 아래 축소 경로는 그대로 남긴다 — 사람이 규칙을
             * 지킨다는 전제로 안전장치를 빼면, 어긴 날 12MB 를 넘겨 413 이 난다.
             */
            var scale = Math.min(1, ANALYZE_MAX_EDGE / Math.max(W, H));
            if (scale === 1 && raw.length <= ANALYZE_PASSTHROUGH_BYTES) { resolve(raw); return; }
            var w = Math.max(1, Math.round(W * scale));
            var h = Math.max(1, Math.round(H * scale));
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) { resolve(raw); return; }
            // 투명 배경이 검게 깔리지 않도록 흰 바탕을 먼저 칠한다.
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            var out = canvas.toDataURL('image/jpeg', ANALYZE_JPEG_QUALITY);
            // 어떤 이유로든 더 커졌다면 원본을 쓴다.
            resolve(out && out.length < raw.length ? out : raw);
          } catch (_) { resolve(raw); }
        };
        img.onerror = function () { resolve(raw); };
        img.src = raw;
      } catch (_) { resolve(raw); }
    });
  }

  /**
   * 언어 전환 시 IP 라이브러리 모달 다시 그리기.
   *
   * 페이지 본문은 공통 런타임 로컬라이저(common.applyRuntimeLocale)가 DOM 을 훑어 바꿔주지만,
   * 이 모달은 렌더 시점에 사전(getIpLibraryUiText)을 읽어 문자열을 박아 넣는 방식이라
   * 다시 그리지 않으면 이전 언어가 그대로 남는다. 모달을 열어둔 채 언어를 바꾸면
   * 제목·버튼만 바뀌고 입력 칸 라벨은 옛 언어로 남는 식으로 섞여 보였다.
   *
   * renderProject 가 다시 돌 때마다 모달 렌더 함수가 새로 만들어지므로,
   * 최신 참조를 모듈 스코프에 담아 두고 리스너는 한 번만 등록한다.
   */
  var rerenderCharacterModal = null;
  var lastAppliedLang = null;
  function bindLangChangeOnce() {
    if (window.__knowledgeHubLangBound) return;
    window.__knowledgeHubLangBound = true;
    lastAppliedLang = getRuntimeLang();
    window.addEventListener('nk:lang-changed', function (evt) {
      var next = (evt && evt.detail && evt.detail.lang) === 'en' ? 'en' : 'ko';
      // applyCurrentLocale() 이 렌더 도중 다시 dispatch 하므로 같은 언어면 건너뛴다(재귀 차단).
      if (lastAppliedLang === next) return;
      lastAppliedLang = next;
      var modal = document.getElementById('character-manager-modal');
      if (!modal || modal.classList.contains('hidden')) return;
      if (typeof rerenderCharacterModal === 'function') rerenderCharacterModal();
    });
  }

  function getCharacterUiText() {
    return getRuntimeLang() === 'en'
      ? {
        traitPlaceholder: 'Enter traits (optional)',
        empty: 'No registered characters.',
        detailHelp: 'Add a character first to show trait inputs here. You can leave them empty.'
      }
      : {
        traitPlaceholder: '성격 입력(선택)',
        empty: '등록된 캐릭터가 없습니다.',
        detailHelp: '캐릭터를 먼저 추가하면 각 성격 입력칸이 여기에 표시됩니다. 비워둬도 저장할 수 있습니다.'
      };
  }

  function getIpLibraryUiText() {
    return getRuntimeLang() === 'en'
      ? {
        title: 'IP Library',
        description: 'Register character base sheet images so they can be used as consistent IP resources anywhere.',
        openLibrary: 'IP Library',
        count: 'Sheets',
        countSuffix: '',
        upload: 'Upload Sheets',
        save: 'Save',
        saveLoading: 'Saving...',
        close: 'Close',
        empty: 'Add characters to Character Assets first, then manage IP sheets for each character here.',
        preview: 'View original image',
        previewAlt: 'Original image',
        sheetAltSuffix: ' sheet',
        setPrimary: 'Set as primary sheet',
        deleteSheet: 'Delete sheet',
        saveFail: 'Failed to save IP Library: ',
        uploadFail: 'Failed to upload sheets: ',
        uploadLimitReached: 'You can register up to 4 sheets per character.',
        uploadLimitPartial: 'You can register up to 4 sheets per character, so only the first ',
        uploadLimitPartialSuffix: ' image(s) will be added.',
        propsTitle: 'Edit text attributes',
        aiFill: 'Auto-fill with AI',
        aiFillTitle: 'Analyze the registered sheets and draft the text attributes (review before saving)',
        aiFilling: 'Analyzing…',
        aiFillNoSheet: 'Register at least one sheet image first.',
        aiFillDone: 'Draft filled from the sheets. Review it and press Save.',
        aiFillFail: 'Auto-fill failed: ',
        appearanceLabel: 'Character appearance',
        appearancePlaceholder: 'e.g. blue cube body, rounded corners, one-piece front face, short cuboid arms, 3D animation style',
        negativeLabel: 'Keep out of the image',
        negativePlaceholder: 'e.g. fingers, human hands, extra limbs, nose'
      }
      : {
        title: 'IP 라이브러리',
        description: '캐릭터별 기준 시트 이미지를 등록해 어디서든 일관된 IP 리소스로 사용할 수 있도록 관리합니다.',
        openLibrary: 'IP 라이브러리',
        count: '등록 시트',
        countSuffix: '개',
        upload: '시트 업로드',
        save: '저장',
        saveLoading: '저장중...',
        close: '닫기',
        empty: '먼저 캐릭터 자산에 캐릭터를 등록하면 여기서 캐릭터별 IP 시트를 관리할 수 있습니다.',
        preview: '원본 이미지 보기',
        previewAlt: '원본 이미지',
        sheetAltSuffix: ' 시트',
        setPrimary: '대표 시트 지정',
        deleteSheet: '시트 삭제',
        saveFail: 'IP 라이브러리 저장 실패: ',
        uploadFail: '시트 업로드 실패: ',
        uploadLimitReached: '시트는 캐릭터당 최대 4장까지 등록할 수 있습니다.',
        uploadLimitPartial: '시트는 캐릭터당 최대 4장까지 등록할 수 있어 앞의 ',
        uploadLimitPartialSuffix: '장만 추가합니다.',
        propsTitle: '텍스트 속성 편집',
        aiFill: 'AI 자동 채우기',
        aiFillTitle: '등록된 시트를 분석해 텍스트 속성 초안을 채웁니다(저장 전에 확인·수정하세요)',
        aiFilling: '분석 중…',
        aiFillNoSheet: '먼저 시트 이미지를 1장 이상 등록해 주세요.',
        aiFillDone: '시트 분석으로 초안을 채웠어요. 확인·수정 후 저장을 눌러주세요.',
        aiFillFail: 'AI 자동 채우기 실패: ',
        appearanceLabel: '캐릭터 생김새',
        appearancePlaceholder: '예: 파란 큐브형 몸, 둥근 모서리, 전면 일체형 얼굴, 짧은 육면체 팔, 3D 애니메이션 그림체',
        negativeLabel: '안 나오게 할 것',
        negativePlaceholder: '예: 손가락, 사람 손, 팔다리 추가, 코'
      };
  }

  function getPageScrollContainer(node) {
    var current = node;
    while (current) {
      if (current.classList && current.classList.contains('main-body')) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function scrollDisclosureIntoView(disclosure) {
    if (!disclosure || !disclosure.open) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var scroller = getPageScrollContainer(disclosure);
        var topMargin = 20;
        var bottomMargin = 20;
        var rect = disclosure.getBoundingClientRect();
        var scrollerRect = scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight || 0 }
          : scroller.getBoundingClientRect();
        var deltaTop = rect.top - (scrollerRect.top + topMargin);
        var deltaBottom = rect.bottom - (scrollerRect.bottom - bottomMargin);
        var targetDelta = 0;
        if (deltaBottom > 0) {
          targetDelta = deltaBottom;
        }
        if (!targetDelta) return;
        // Keep the auto-correction immediate so the next click still toggles the disclosure.
        if (scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement) {
          window.scrollBy(0, targetDelta);
          return;
        }
        scroller.scrollTop += targetDelta;
      });
    });
  }

  function bindDisclosureScroll(root) {
    if (NK.ui && NK.ui.common && typeof NK.ui.common.bindDisclosureMotion === 'function') {
      NK.ui.common.bindDisclosureMotion(root);
    }
    var disclosures = root && root.querySelectorAll ? root.querySelectorAll('.knowledge-hub-disclosure') : [];
    Array.prototype.forEach.call(disclosures, function (disclosure) {
      disclosure.ontoggle = function () {};
      if (!disclosure.__nkDisclosureOpenedBound) {
        disclosure.__nkDisclosureOpenedBound = true;
        disclosure.addEventListener('nk-disclosure-opened', function () {
          scrollDisclosureIntoView(disclosure);
        });
      }
    });
  }

  function getFieldPersistKey(field) {
    if (!field || !field.getAttribute) return '';
    return String(
      field.getAttribute('id') ||
      field.getAttribute('data-character-personality') ||
      ''
    ).trim();
  }

  function captureFieldScrollState(root) {
    var state = {};
    var fields = root && root.querySelectorAll
      ? root.querySelectorAll('textarea, input, select')
      : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      if (!key) return;
      var scrollTop = Number(field.scrollTop || 0);
      var scrollLeft = Number(field.scrollLeft || 0);
      if (scrollTop <= 0 && scrollLeft <= 0) return;
      state[key] = {
        scrollTop: scrollTop,
        scrollLeft: scrollLeft
      };
    });
    return state;
  }

  function restoreFieldScrollState(root, state) {
    if (!root || !state) return;
    var fields = root.querySelectorAll ? root.querySelectorAll('textarea, input, select') : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      var saved = key ? state[key] : null;
      if (!saved) return;
      field.scrollTop = Number(saved.scrollTop || 0);
      field.scrollLeft = Number(saved.scrollLeft || 0);
    });
  }

  function parseCharacterNoteEntries(value) {
    return String(value || '')
      .split(/\n+/)
      .map(function (line) {
        var raw = normalizeText(line).replace(/^[\-*•\s]+/, '');
        if (!raw) return null;
        if (/^(브랜드\s*화자|화자|speaker)$/i.test(raw)) return null;
        var m = raw.match(/^(@?[^\-–—:：()]{1,24}?)(?:\s*[\-–—:：]\s*(.*))?$/);
        if (!m) return null;
        var candidate = normalizeCharacterName(m[1]);
        if (!candidate || /[\.\!\?]/.test(candidate)) return null;
        return {
          displayName: candidate,
          personality: normalizeCharacterPersonality(m[2] || '')
        };
      })
      .filter(Boolean);
  }

  function extractCharacterNoteRemainder(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map(function (line) { return String(line || '').trim(); })
      .filter(Boolean)
      .filter(function (line) { return !parseCharacterNoteEntries(line)[0]; })
      .join('\n');
  }

  function normalizeCharacters(value, fallbackText) {
    var src = Array.isArray(value) ? value : [];
    var out = [];
    var seen = {};
    src.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : { displayName: item };
      var displayName = normalizeCharacterName(raw.displayName || raw.name || raw.token);
      if (!displayName) return;
      var token = '@' + displayName;
      var key = token.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        characterId: normalizeText(raw.characterId || raw.id) || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: displayName,
        token: token,
        personality: normalizeCharacterPersonality(raw.personality || raw.description || raw.profile || raw.note || '')
      });
    });
    if (out.length) return out;
    return parseCharacterNoteEntries(fallbackText).map(function (item, index) {
      return {
        characterId: 'char_' + String(index + 1).padStart(3, '0'),
        displayName: item.displayName,
        token: '@' + item.displayName,
        personality: item.personality
      };
    });
  }

  function serializeCharacterNotes(list) {
    return normalizeCharacters(list).map(function (item) {
      return '• ' + item.displayName + (item.personality ? (' - ' + item.personality) : ' - ');
    }).join('\n');
  }

  function renderCharacterRows(list) {
    var uiText = getCharacterUiText();
    var normalized = normalizeCharacters(list);
    if (!normalized.length) {
      return '<p class="scenario-character-empty">' + escapeHtml(uiText.empty) + '</p>';
    }
    return normalized.map(function (item) {
      return (
        '<label class="knowledge-character-row" data-character-id="' + escapeHtml(item.characterId) + '">' +
        '<span class="knowledge-character-chip" data-character-token="' + escapeHtml(item.token) + '">' +
        '<span>' + escapeHtml(item.token) + '</span>' +
        '<button type="button" class="knowledge-character-remove" data-action="knowledge-remove-character" data-character-token="' + escapeHtml(item.token) + '" aria-label="캐릭터 삭제">×</button>' +
        '</span>' +
        '<input type="text" class="knowledge-character-personality" data-character-personality="' + escapeHtml(item.characterId) + '" value="' + escapeHtml(item.personality || '') + '" placeholder="' + escapeHtml(uiText.traitPlaceholder) + '" />' +
        '</label>'
      );
    }).join('');
  }

  var MAX_CHARACTER_SHEETS_PER_CHARACTER = 4;

  function normalizeCharacterSheetItems(value) {
    var src = Array.isArray(value) ? value : [];
    var items = src.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var imageDataUrl = normalizeText(raw.imageDataUrl || raw.imageUrl || raw.url || raw.src);
      if (!imageDataUrl) return null;
      return {
        sheetId: normalizeText(raw.sheetId || raw.id) || ('sheet_' + String(index + 1).padStart(3, '0')),
        imageDataUrl: imageDataUrl,
        isPrimary: raw.isPrimary === true
      };
    }).filter(Boolean);
    var primaryFound = false;
    items.forEach(function (item, index) {
      if (item.isPrimary && !primaryFound) {
        primaryFound = true;
        return;
      }
      item.isPrimary = false;
      if (!primaryFound && index === 0) {
        item.isPrimary = true;
        primaryFound = true;
      }
    });
    return items.slice(0, MAX_CHARACTER_SHEETS_PER_CHARACTER);
  }

  function resolveSheetPreviewUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (/^gs:\/\//i.test(raw) && NK.api && NK.api.mediaProxyUrl) {
      return NK.api.mediaProxyUrl(raw);
    }
    return raw;
  }

  function normalizeCharacterSheets(value, characters) {
    var sourceCharacters = normalizeCharacters(characters);
    var source = Array.isArray(value) ? value : [];
    var map = new Map();
    source.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var displayName = normalizeCharacterName(raw.token || raw.trigger || raw.displayName || raw.name);
      if (!displayName) return;
      var token = '@' + displayName;
      var matched = sourceCharacters.find(function (row) {
        return String(row.token || '').toLowerCase() === String(token).toLowerCase();
      }) || null;
      map.set(String(token).toLowerCase(), {
        characterId: normalizeText(raw.characterId || raw.id) || normalizeText(matched && matched.characterId) || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: normalizeCharacterName(raw.displayName || raw.name || token) || normalizeCharacterName(matched && matched.displayName) || displayName,
        token: token,
        items: normalizeCharacterSheetItems(raw.items)
      });
    });
    sourceCharacters.forEach(function (item, index) {
      var key = String(item.token || '').toLowerCase();
      if (!key) return;
      if (map.has(key)) {
        var existing = map.get(key);
        existing.characterId = existing.characterId || item.characterId || ('char_' + String(index + 1).padStart(3, '0'));
        existing.displayName = existing.displayName || item.displayName;
        existing.token = existing.token || item.token;
        map.set(key, existing);
        return;
      }
      map.set(key, {
        characterId: item.characterId || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: item.displayName,
        token: item.token,
        items: []
      });
    });
    return Array.from(map.values()).filter(function (item) {
      return item.token;
    });
  }

  var MAX_ENVIRONMENT_ASSETS = 16;

  function getEnvironmentUiText() {
    return getRuntimeLang() === 'en'
      ? {
        empty: 'No registered background/prop assets.',
        addPlaceholder: 'Enter a background/prop name and press Enter (e.g. Cafe interior)',
        descriptionPlaceholder: 'Describe the place/prop (materials, mood, colors, etc.)',
        removeAsset: 'Delete asset',
        help: 'Saved as @token and reflected in the asset list and overview. Add a name first to reveal a description field. When a scene\'s location/prop name matches, AI Cinema reuses the registered image for consistency.'
      }
      : {
        empty: '등록된 배경·소품 자산이 없습니다.',
        addPlaceholder: '배경·소품 이름 입력 후 Enter (예: 카페 내부, 빨간 우산)',
        descriptionPlaceholder: '장소·소품 설명 (재질, 분위기, 색감 등). 비워둬도 저장할 수 있습니다.',
        removeAsset: '자산 삭제',
        help: '@토큰 형식으로 저장되며 배경·소품 자산 목록과 개요에 반영됩니다. 시나리오의 장소·소품 이름과 일치하면 AI 시네마가 해당 이미지를 참고해 일관성을 유지합니다.'
      };
  }

  // 배경·소품 라이브러리 모달 텍스트: 캐릭터 IP 라이브러리와 동일 구조를 쓰되 제목/설명만 교체.
  function getEnvironmentLibraryUiText() {
    var base = getIpLibraryUiText();
    return getRuntimeLang() === 'en'
      ? Object.assign({}, base, {
        title: 'Background/Prop Library',
        description: 'Register reference images per background/prop so AI Cinema keeps places and props consistent.',
        openLibrary: 'IP Library',
        empty: 'Add background/prop assets first, then manage reference images for each here.'
      })
      : Object.assign({}, base, {
        title: '배경·소품 라이브러리',
        description: '배경·소품별 기준 이미지를 등록해 어디서든 일관된 장소·소품 리소스로 사용할 수 있도록 관리합니다.',
        openLibrary: 'IP 라이브러리',
        empty: '먼저 배경·소품 자산을 등록하면 여기서 자산별 레퍼런스 이미지를 관리할 수 있습니다.'
      });
  }

  function normalizeEnvironmentName(value) {
    return normalizeText(value).replace(/^@+/, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeEnvironmentAssets(value) {
    var src = Array.isArray(value) ? value : [];
    var out = [];
    var seen = {};
    src.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : { displayName: item };
      var displayName = normalizeEnvironmentName(raw.displayName || raw.name || raw.token || raw.trigger);
      if (!displayName) return;
      var token = '@' + displayName.replace(/\s+/g, '');
      var key = token.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        assetId: normalizeText(raw.assetId || raw.id) || ('env_' + String(index + 1).padStart(3, '0')),
        displayName: displayName,
        token: token,
        description: normalizeText(raw.description || raw.personality || raw.note || ''),
        items: normalizeCharacterSheetItems(raw.items)
      });
    });
    return out.slice(0, MAX_ENVIRONMENT_ASSETS);
  }

  // 캐릭터 자산(renderCharacterRows)과 동일한 구조: 칩(@토큰 + 삭제) + 설명 입력.
  // 이미지는 인라인이 아니라 배경·소품 라이브러리 모달에서 관리한다.
  function renderEnvironmentRows(list) {
    var uiText = getEnvironmentUiText();
    var normalized = normalizeEnvironmentAssets(list);
    if (!normalized.length) {
      return '<p class="scenario-character-empty">' + escapeHtml(uiText.empty) + '</p>';
    }
    return normalized.map(function (asset) {
      return (
        '<label class="knowledge-character-row" data-asset-id="' + escapeHtml(asset.assetId) + '">' +
        '<span class="knowledge-character-chip" data-environment-token="' + escapeHtml(asset.token) + '">' +
        '<span>' + escapeHtml(asset.token) + '</span>' +
        '<button type="button" class="knowledge-character-remove" data-action="knowledge-environment-remove" data-asset-id="' + escapeHtml(asset.assetId) + '" aria-label="' + escapeHtml(uiText.removeAsset) + '">×</button>' +
        '</span>' +
        '<input type="text" class="knowledge-character-personality" data-environment-description="' + escapeHtml(asset.assetId) + '" value="' + escapeHtml(asset.description || '') + '" placeholder="' + escapeHtml(uiText.descriptionPlaceholder) + '" />' +
        '</label>'
      );
    }).join('');
  }

  function episodeLabel(project) {
    return String(project && (project.title || project.payload && project.payload.episodeTitle || project.seriesTitle || project.id) || '').trim() || '미지정 에피소드';
  }

  function readKnowledge(project) {
    if (project && project.brandId && !project.id) {
      return {
        brandVoice: String(project.brandVoice || '').trim(),
        brandStory: String(project.brandStory || '').trim(),
        brandCharacter: String(project.brandCharacter || '').trim(),
        characters: normalizeCharacters(project.knowledgeCharacters, project.brandCharacter),
        characterSheets: normalizeCharacterSheets(project.characterSheets || project.knowledgeCharacterSheets, project.knowledgeCharacters || project.brandCharacter),
        environmentAssets: normalizeEnvironmentAssets(project.environmentAssets || project.knowledgeEnvironmentAssets),
        worldSetting: String(project.worldSetting || project.knowledgeWorld || '').trim(),
        brandRules: Array.isArray(project.brandRules) ? project.brandRules.slice() : [],
        bannedExpressions: Array.isArray(project.bannedExpressions) ? project.bannedExpressions.slice() : [],
        referenceContents: Array.isArray(project.referenceContents) ? project.referenceContents.slice() : [],
        referenceItems: Array.isArray(project.referenceContentEntries) ? project.referenceContentEntries.slice() : [],
        successCases: Array.isArray(project.successCases) ? project.successCases.slice() : []
      };
    }
    if (NK.service && NK.service.project && NK.service.project.getKnowledgeHub) {
      return NK.service.project.getKnowledgeHub(project);
    }
    return {
      brandVoice: '',
      brandStory: '',
      brandCharacter: '',
      characters: [],
      characterSheets: [],
      environmentAssets: [],
      worldSetting: '',
      brandRules: [],
      bannedExpressions: [],
      referenceContents: [],
      referenceItems: [],
      successCases: []
    };
  }

  // 프로젝트와 브랜드의 배경·소품 자산을 토큰 기준으로 합치고, 자산별 이미지(items)는 sheetId 합집합으로 병합.
  // (캐릭터 시트가 project+brand 를 concat 해 합치는 것과 동일하게, 이미지 생성 페이지에서 브랜드에
  //  등록한 배경·소품 이미지가 라이브러리에 표시되지 않던 문제 수정.)
  function mergeEnvironmentAssetLists(baseValue, extraValue) {
    var listBase = normalizeEnvironmentAssets(baseValue);
    var listExtra = normalizeEnvironmentAssets(extraValue);
    var map = new Map();
    var put = function (asset) {
      var key = String(asset.token || '').toLowerCase();
      if (!key) return;
      if (!map.has(key)) { map.set(key, asset); return; }
      var existing = map.get(key);
      var itemMap = new Map();
      normalizeCharacterSheetItems(existing.items).forEach(function (s) { itemMap.set(String(s.sheetId || '').toLowerCase(), s); });
      normalizeCharacterSheetItems(asset.items).forEach(function (s) {
        var k = String(s.sheetId || '').toLowerCase();
        if (!itemMap.has(k)) itemMap.set(k, s);
      });
      map.set(key, Object.assign({}, existing, {
        displayName: existing.displayName || asset.displayName,
        description: existing.description || asset.description || '',
        items: normalizeCharacterSheetItems(Array.from(itemMap.values()))
      }));
    };
    listBase.forEach(put);
    listExtra.forEach(put);
    return normalizeEnvironmentAssets(Array.from(map.values()));
  }

  function mergeKnowledge(primary, fallback) {
    var base = primary || {};
    var extra = fallback || {};
    var brandCharacter = String(base.brandCharacter || extra.brandCharacter || '').trim();
    var characters = normalizeCharacters(
      (Array.isArray(base.characters) ? base.characters : []).concat(Array.isArray(extra.characters) ? extra.characters : []),
      brandCharacter
    );
    var characterSheets = normalizeCharacterSheets(
      (Array.isArray(base.characterSheets) ? base.characterSheets : []).concat(Array.isArray(extra.characterSheets) ? extra.characterSheets : []),
      characters
    );
    var environmentAssets = mergeEnvironmentAssetLists(base.environmentAssets, extra.environmentAssets);
    return {
      brandVoice: String(base.brandVoice || extra.brandVoice || '').trim(),
      brandStory: String(base.brandStory || extra.brandStory || '').trim(),
      brandCharacter: brandCharacter,
      characters: characters,
      characterSheets: characterSheets,
      environmentAssets: environmentAssets,
      worldSetting: String(base.worldSetting || extra.worldSetting || '').trim(),
      brandRules: (Array.isArray(base.brandRules) && base.brandRules.length ? base.brandRules : (Array.isArray(extra.brandRules) ? extra.brandRules : [])).slice(),
      bannedExpressions: (Array.isArray(base.bannedExpressions) && base.bannedExpressions.length ? base.bannedExpressions : (Array.isArray(extra.bannedExpressions) ? extra.bannedExpressions : [])).slice(),
      referenceContents: (Array.isArray(base.referenceContents) && base.referenceContents.length ? base.referenceContents : (Array.isArray(extra.referenceContents) ? extra.referenceContents : [])).slice(),
      referenceItems: (Array.isArray(base.referenceItems) && base.referenceItems.length ? base.referenceItems : (Array.isArray(extra.referenceItems) ? extra.referenceItems : [])).slice(),
      successCases: (Array.isArray(base.successCases) && base.successCases.length ? base.successCases : (Array.isArray(extra.successCases) ? extra.successCases : [])).slice()
    };
  }

  function referenceTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'video': return '영상';
      case 'image': return '이미지';
      case 'post': return '게시물';
      case 'channel': return '채널';
      case 'article': return '문서';
      default: return '참조';
    }
  }

  function buildReferenceDraft(root, knowledge) {
    var typeEl = root.querySelector('#knowledge-reference-type');
    var titleEl = root.querySelector('#knowledge-reference-title');
    var sourceEl = root.querySelector('#knowledge-reference-source');
    var noteEl = root.querySelector('#knowledge-reference-note');
    var nextItem = {
      id: 'ref_' + Date.now(),
      type: String((typeEl && typeEl.value) || 'reference').trim() || 'reference',
      title: String((titleEl && titleEl.value) || '').trim(),
      source: String((sourceEl && sourceEl.value) || '').trim(),
      note: String((noteEl && noteEl.value) || '').trim()
    };
    if (!nextItem.title && !nextItem.source && !nextItem.note) return null;
    return (knowledge.referenceItems || []).concat([nextItem]);
  }

  function readKnowledgeDraft(root, referenceItems, characters, characterExtras, characterSheets, environmentAssets) {
    var items = Array.isArray(referenceItems) ? referenceItems.slice() : [];
    var normalizedCharacters = normalizeCharacters(characters);
    var normalizedSheets = normalizeCharacterSheets(characterSheets, normalizedCharacters);
    var normalizedEnvironment = normalizeEnvironmentAssets(environmentAssets);
    var characterDescription = [serializeCharacterNotes(normalizedCharacters), String(characterExtras || '').trim()].filter(Boolean).join('\n');
    return {
      brandVoice: String((root.querySelector('#knowledge-brand-voice') || {}).value || '').trim(),
      brandStory: String((root.querySelector('#knowledge-brand-story') || {}).value || '').trim(),
      brandCharacter: characterDescription,
      characters: normalizedCharacters,
      knowledgeCharacters: normalizedCharacters,
      characterSheets: normalizedSheets,
      knowledgeCharacterSheets: normalizedSheets,
      environmentAssets: normalizedEnvironment,
      knowledgeEnvironmentAssets: normalizedEnvironment,
      worldSetting: String((root.querySelector('#knowledge-world-setting') || {}).value || '').trim(),
      brandRules: splitLines((root.querySelector('#knowledge-brand-rules') || {}).value || ''),
      bannedExpressions: splitLines((root.querySelector('#knowledge-banned') || {}).value || ''),
      referenceItems: items,
      referenceContents: items.map(function (item) {
        return [item.type, item.title, item.note].filter(Boolean).join(' ');
      }).filter(Boolean),
      successCases: splitLines((root.querySelector('#knowledge-success-cases') || {}).value || '')
    };
  }

  /**
   * '기본값 채우기' 가 넣는 초안 문구. 화면 문구가 아니라 사용자 필드에 들어가는 '내용'이라,
   * 공통 런타임 로컬라이저(DOM 번역)의 대상이 아니다. 저장되고 나면 사용자 데이터이기도 해서
   * 나중에 자동 번역하면 안 된다. 그래서 만들 때부터 현재 언어로 쓴다.
   */
  function getStarterText() {
    return getRuntimeLang() === 'en'
      ? {
        voiceTo: function (t) { return 'For ' + t + '.'; },
        voiceTone: 'Explain briefly and clearly, without overstating.',
        storyFallback: function (title) { return 'Runs around the core message of ' + title + '.'; },
        coreMessageLabel: 'Key message: ',
        targetLabel: 'Primary target: ',
        rules: [
          'Avoid exaggeration that strays from the core message.',
          'Keep the brand voice and vocabulary consistent.',
          'Write sentences a reader can understand right away.'
        ]
      }
      : {
        voiceTo: function (t) { return t + '에게'; },
        voiceTone: '짧고 명확하게 설명하되 과장하지 않는다.',
        storyFallback: function (title) { return title + '의 핵심 메시지를 중심으로 운영합니다.'; },
        coreMessageLabel: '핵심 메시지: ',
        targetLabel: '주요 타깃: ',
        rules: [
          '핵심 메시지에서 벗어나는 과장 표현을 줄인다.',
          '브랜드 말투와 어휘를 일관되게 유지한다.',
          '사용자가 바로 이해할 수 있는 문장으로 정리한다.'
        ]
      };
  }

  function buildStarterKnowledge(knowledge, project, brandTitle, brandSummary) {
    var payload = (project && project.payload) || {};
    var next = Object.assign({}, knowledge || {});
    var target = String(payload.targetAudience || payload.target || '').trim();
    var coreMessage = String(payload.coreMessage || '').trim();
    var starter = getStarterText();
    next.brandVoice = next.brandVoice || [
      target ? starter.voiceTo(target) : '',
      starter.voiceTone
    ].filter(Boolean).join(' ');
    next.brandStory = next.brandStory || compactSentence(brandSummary || coreMessage || starter.storyFallback(brandTitle), 120);
    next.worldSetting = next.worldSetting || compactSentence([
      brandTitle,
      coreMessage ? (starter.coreMessageLabel + coreMessage) : '',
      target ? (starter.targetLabel + target) : ''
    ].filter(Boolean).join(' · '), 140);
    next.brandRules = next.brandRules && next.brandRules.length ? next.brandRules : starter.rules.slice();
    next.characterSheets = normalizeCharacterSheets(next.characterSheets, next.characters);
    next.environmentAssets = normalizeEnvironmentAssets(next.environmentAssets);
    next.bannedExpressions = next.bannedExpressions && next.bannedExpressions.length ? next.bannedExpressions : [];
    next.successCases = next.successCases && next.successCases.length ? next.successCases : [];
    return next;
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero empty">' +
      '<h2>브랜드 허브</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<a class="btn-primary" href="dashboard.html">대시보드로 이동</a>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
  }

  function captureDisclosureOpenState(root) {
    if (!root || !root.querySelectorAll) return [];
    var disclosures = root.querySelectorAll('.knowledge-hub-disclosure');
    return Array.prototype.map.call(disclosures, function (el) { return !!el.open; });
  }

  function restoreDisclosureOpenState(root, state) {
    if (!root || !state || !state.length || !root.querySelectorAll) return;
    var disclosures = root.querySelectorAll('.knowledge-hub-disclosure');
    Array.prototype.forEach.call(disclosures, function (el, idx) {
      if (state[idx]) el.setAttribute('open', '');
      else el.removeAttribute('open');
    });
  }

  function captureActiveFieldState(root) {
    if (!root) return null;
    var active = (typeof document !== 'undefined') ? document.activeElement : null;
    if (!active || !root.contains || !root.contains(active)) return null;
    var id = active.id || '';
    if (!id) return null;
    var state = { id: id };
    try {
      if (typeof active.selectionStart === 'number') state.selectionStart = active.selectionStart;
      if (typeof active.selectionEnd === 'number') state.selectionEnd = active.selectionEnd;
    } catch (_) {}
    return state;
  }

  function restoreActiveFieldState(root, state) {
    if (!root || !state || !state.id) return;
    var el = root.querySelector('#' + (window.CSS && CSS.escape ? CSS.escape(state.id) : state.id));
    if (!el || typeof el.focus !== 'function') return;
    try { el.focus(); } catch (_) {}
    try {
      if (typeof state.selectionStart === 'number' && typeof el.setSelectionRange === 'function') {
        el.setSelectionRange(state.selectionStart, state.selectionEnd != null ? state.selectionEnd : state.selectionStart);
      }
    } catch (_) {}
  }

  function renderProject(root, project, brand) {
    var preservedFieldScroll = captureFieldScrollState(root);
    var preservedDisclosureOpen = captureDisclosureOpenState(root);
    var preservedActiveField = captureActiveFieldState(root);
    var projectId = String(project && project.id || '').trim();
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    var payload = (project && project.payload) || {};
    var knowledge = mergeKnowledge(readKnowledge(project), brand ? readKnowledge(brand) : null);
    knowledge.characters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);
    var characterUiText = getCharacterUiText();
    var characterExtras = extractCharacterNoteRemainder(knowledge.brandCharacter);
    var brandTitle = String(brand && brand.brandTitle || payload.brandTitle || project.seriesTitle || project.title || '브랜드').trim();
    var brandSummary = String(brand && brand.brandSummary || payload.brandSummary || '').trim();
    var currentEpisodeTitle = episodeLabel(project);
    var rulesCount = knowledge.brandRules.length;
    var bannedCount = knowledge.bannedExpressions.length;
    var referencesCount = (knowledge.referenceItems || []).length || knowledge.referenceContents.length;
    var successesCount = knowledge.successCases.length;
    function renderNext(nextProject) {
      var fallbackProject = nextProject && nextProject.id ? nextProject : project;
      var nextBrandId = String(fallbackProject && fallbackProject.payload && fallbackProject.payload.brandId || brandId).trim();
      var nextBrand = (NK.service && NK.service.brand && NK.service.brand.getById && nextBrandId)
        ? NK.service.brand.getById(nextBrandId)
        : null;
      renderProject(root, fallbackProject, nextBrand || brand);
    }
    function syncBrandAndProject(nextKnowledge) {
      return Promise.resolve().then(async function () {
        var persistedBrand = brand;
        var sharedPatch = {
          brandVoice: nextKnowledge.brandVoice,
          brandStory: nextKnowledge.brandStory,
          brandCharacter: nextKnowledge.brandCharacter,
          knowledgeCharacters: nextKnowledge.characters,
          characterSheets: nextKnowledge.characterSheets,
          environmentAssets: nextKnowledge.environmentAssets,
          knowledgeEnvironmentAssets: nextKnowledge.environmentAssets,
          worldSetting: nextKnowledge.worldSetting,
          brandRules: nextKnowledge.brandRules,
          bannedExpressions: nextKnowledge.bannedExpressions,
          referenceContents: nextKnowledge.referenceContents,
          referenceContentEntries: nextKnowledge.referenceItems,
          successCases: nextKnowledge.successCases
        };
        if (brandId && NK.service && NK.service.brand) {
          if (NK.service.brand.persistShared) {
            persistedBrand = await NK.service.brand.persistShared(brandId, sharedPatch);
          } else if (NK.service.brand.update) {
            persistedBrand = NK.service.brand.update(brandId, sharedPatch);
          }
        }
        if (persistedBrand) brand = persistedBrand;

        var persistedKnowledge = mergeKnowledge(nextKnowledge, null);
        persistedKnowledge.characters = normalizeCharacters(persistedKnowledge.characters, persistedKnowledge.brandCharacter);
        persistedKnowledge.characterSheets = normalizeCharacterSheets(persistedKnowledge.characterSheets, persistedKnowledge.characters);
        persistedKnowledge.environmentAssets = normalizeEnvironmentAssets(persistedKnowledge.environmentAssets);

        var nextDraft = null;
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          var projectResult = await NK.service.project.updatePayload(projectId, {
            knowledgeHub: persistedKnowledge,
            knowledgeCharacters: persistedKnowledge.characters,
            knowledgeCharacterSheets: persistedKnowledge.characterSheets,
            characterSheets: persistedKnowledge.characterSheets,
            environmentAssets: persistedKnowledge.environmentAssets,
            knowledgeEnvironmentAssets: persistedKnowledge.environmentAssets,
            brandVoice: persistedKnowledge.brandVoice,
            brandStory: persistedKnowledge.brandStory,
            brandCharacter: persistedKnowledge.brandCharacter,
            brandRules: persistedKnowledge.brandRules,
            bannedExpressions: persistedKnowledge.bannedExpressions,
            referenceContents: persistedKnowledge.referenceContents,
            referenceContentEntries: persistedKnowledge.referenceItems,
            successCases: persistedKnowledge.successCases,
            worldSetting: persistedKnowledge.worldSetting,
            knowledgeWorld: persistedKnowledge.worldSetting
          });
          if (projectResult && projectResult.draft) nextDraft = projectResult.draft;
        }
        return { draft: nextDraft || project };
      });
    }
    var contentItems = (NK.service && NK.service.contentLibrary && NK.service.contentLibrary.listProjectContents)
      ? NK.service.contentLibrary.listProjectContents(brand || project)
      : [];
    var characters = Array.isArray(brand && brand.brandCharacters) ? brand.brandCharacters : [];
    
    var referenceCards = (knowledge.referenceItems || []).length
      ? knowledge.referenceItems.map(function (item) {
        return (
          '<article class="knowledge-reference-card">' +
          '<div class="knowledge-reference-top">' +
          '<span class="knowledge-reference-badge">' + escapeHtml(referenceTypeLabel(item.type)) + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="knowledge-remove-reference" data-reference-id="' + escapeHtml(item.id) + '">삭제</button>' +
          '</div>' +
          '<strong>' + escapeHtml(item.title || '참조 콘텐츠') + '</strong>' +
          '<p>' + escapeHtml(item.note || item.source || '메모 없음') + '</p>' +
          (item.source ? '<a class="btn-secondary compact" href="' + escapeHtml(item.source) + '" target="_blank" rel="noopener noreferrer">열기</a>' : '') +
          '</article>'
        );
      }).join('')
      : '<div class="knowledge-reference-empty">아직 저장된 참조 콘텐츠가 없습니다.</div>';
    var mediaCount = contentItems.filter(function (item) {
      var type = String(item && item.type || '').trim();
      return type === 'image' || type === 'video';
    }).length;
    var knowledgeHeroPills = [
      { label: '운영 브랜드', value: brandTitle || '-' },
      { label: '현재 에피소드', value: currentEpisodeTitle },
      { label: '저장된 규칙', value: (rulesCount + bannedCount) + '개' },
      { label: '캐릭터', value: knowledge.characters.length ? (knowledge.characters.length + '명') : '아직 없음' }
    ].map(function (item) {
      return '<span class="studio-hero-pill"><em>' + escapeHtml(item.label) + '</em><strong>' + escapeHtml(item.value) + '</strong></span>';
    }).join('');
    var knowledgeHeroStats = [
      {
        label: '브랜드 규칙',
        value: rulesCount + '개'
      },
      {
        label: '금지 표현',
        value: bannedCount + '개'
      },
      {
        label: '참조 / 성공 패턴',
        value: String(referencesCount + successesCount) + '개'
      },
      {
        label: '연결 자산',
        value: mediaCount + '개'
      }
    ].map(function (item) {
      return (
        '<article class="studio-kpi-card">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '</article>'
      );
    }).join('');
    var knowledgeContextSummary = [
      {
        label: 'AI 기본 문맥',
        value: knowledge.brandVoice ? '톤&매너 설정됨' : '톤 정리 필요',
        detail: knowledge.brandVoice || 'AI가 계속 참고할 말투와 표현 원칙이 아직 없습니다.'
      },
      {
        label: '브랜드 스토리',
        value: knowledge.brandStory ? '브랜드 서사 입력됨' : '스토리 보강 필요',
        detail: knowledge.brandStory || '왜 존재하는지, 어떤 세계를 다루는지 요약해 주세요.'
      },
      {
        label: '세계관 / 배경',
        value: knowledge.worldSetting ? '배경 정의됨' : '배경 정의 필요',
        detail: knowledge.worldSetting || '배경 문맥이 비어 있으면 결과물이 쉽게 흔들립니다.'
      },
      {
        label: '캐릭터 운영',
        value: knowledge.characters.length ? (knowledge.characters.length + '명 관리 중') : '캐릭터 등록 필요',
        detail: knowledge.characters.length ? '캐릭터 토큰과 성격이 자산 목록과 개요에 반영됩니다.' : characterUiText.detailHelp
      }
    ].map(function (item) {
      return (
        '<article class="knowledge-hub-context-item">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');

    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero">' +
      '<div class="studio-page-hero-main">' +
      '<p class="knowledge-hub-eyebrow">브랜드 허브</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="knowledge-hub-description">' + escapeHtml(brandSummary || '브랜드 요약이 아직 없습니다. 브랜드 허브를 먼저 채우면 이후 생성 품질이 안정됩니다.') + '</p>' +
      '<div class="studio-hero-pill-row">' + knowledgeHeroPills + '</div>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<button class="btn-secondary" data-action="knowledge-apply-starter">기본값 채우기</button>' +
      '<button class="btn-primary" data-action="knowledge-save">브랜드 허브 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="studio-page-hero-side"><div class="studio-kpi-grid">' + knowledgeHeroStats + '</div></div>' +
      '</div>' +
      '<div class="knowledge-hub-context-bar">' + knowledgeContextSummary + '</div>' +
      '<div class="knowledge-hub-workspace">' +
      '<div class="knowledge-hub-main">' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>브랜드 정체성</strong><span>AI가 계속 참고할 기본 문맥</span></div><span class="knowledge-hub-disclosure-meta">핵심 4개 필드</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>톤&매너</span><textarea id="knowledge-brand-voice" placeholder="예: 따뜻하지만 과장하지 않고, 짧고 명확하게 말한다.">' + escapeHtml(knowledge.brandVoice) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>브랜드 스토리</span><textarea id="knowledge-brand-story" placeholder="브랜드/시리즈가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.">' + escapeHtml(knowledge.brandStory) + '</textarea></label>' +
      '<label class="knowledge-hub-field knowledge-hub-field-fill"><span>세계관/배경</span><textarea id="knowledge-world-setting" placeholder="작품 배경, 서비스 맥락, 브랜드 세계관을 적어 주세요.">' + escapeHtml(knowledge.worldSetting) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>캐릭터 자산</strong><span>브랜드 공용 캐릭터 레코드</span></div><span class="knowledge-hub-disclosure-meta" data-character-count>' + escapeHtml(String(knowledge.characters.length) + '명') + '</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-field knowledge-character-field"><span>캐릭터</span>' +
      '<div class="knowledge-character-input-row">' +
      '<input id="knowledge-character-input" class="knowledge-character-input" placeholder="캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)" />' +
      '<button class="btn-primary knowledge-ip-library-btn" type="button" data-action="knowledge-open-ip-library">' + escapeHtml(getIpLibraryUiText().openLibrary) + '</button>' +
      '</div>' +
      '<div id="knowledge-character-chips" class="knowledge-character-chips">' + renderCharacterRows(knowledge.characters) + '</div>' +
      '<p class="knowledge-character-help">@토큰 형식으로 저장되며 캐릭터 자산 목록과 개요에 반영됩니다. ' + escapeHtml(characterUiText.detailHelp) + '</p></div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</div>' +
      '<div class="knowledge-hub-side">' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>브랜드 규칙</strong><span>반드시 지켜야 할 운영 기준</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(rulesCount + bannedCount) + '개 항목</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>브랜드 규칙</span><textarea id="knowledge-brand-rules" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 캐릭터 말투는 존댓말을 유지한다.">' + escapeHtml(joinLines(knowledge.brandRules)) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>금지 표현</span><textarea id="knowledge-banned" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 선정적 표현 금지">' + escapeHtml(joinLines(knowledge.bannedExpressions)) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>배경·소품 자산</strong><span>장소·소품 일관성용 레퍼런스</span></div><span class="knowledge-hub-disclosure-meta" data-environment-count>' + escapeHtml(String(knowledge.environmentAssets.length) + '개') + '</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-field knowledge-character-field"><span>배경·소품</span>' +
      '<div class="knowledge-character-input-row">' +
      '<input id="knowledge-environment-input" class="knowledge-character-input" placeholder="' + escapeHtml(getEnvironmentUiText().addPlaceholder) + '" />' +
      '<button class="btn-primary knowledge-ip-library-btn" type="button" data-action="knowledge-open-environment-library">' + escapeHtml(getEnvironmentLibraryUiText().openLibrary) + '</button>' +
      '</div>' +
      '<div id="knowledge-environment-cards" class="knowledge-character-chips">' + renderEnvironmentRows(knowledge.environmentAssets) + '</div>' +
      '<p class="knowledge-character-help">' + escapeHtml(getEnvironmentUiText().help) + '</p></div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>참조와 학습</strong><span>좋았던 레퍼런스와 성공 패턴</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(referencesCount + successesCount) + '개 데이터</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>과거 성공 사례</span><textarea id="knowledge-success-cases" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 오전 9시 업로드한 짧은 문장형 게시물 반응이 좋았음">' + escapeHtml(joinLines(knowledge.successCases)) + '</textarea></label>' +
      '<div class="knowledge-hub-field knowledge-reference-builder">' +
      '<span>참조 콘텐츠 구조</span>' +
      '<div class="knowledge-reference-form">' +
      '<select id="knowledge-reference-type" class="knowledge-reference-input">' +
      '<option value="reference">참조</option>' +
      '<option value="video">영상</option>' +
      '<option value="image">이미지</option>' +
      '<option value="post">게시물</option>' +
      '<option value="channel">채널</option>' +
      '<option value="article">문서</option>' +
      '</select>' +
      '<input id="knowledge-reference-title" class="knowledge-reference-input" placeholder="참조 제목" />' +
      '<input id="knowledge-reference-source" class="knowledge-reference-input" placeholder="링크 또는 출처" />' +
      '<textarea id="knowledge-reference-note" class="knowledge-reference-textarea" placeholder="왜 참고하는지 메모를 남겨 주세요."></textarea>' +
      '<button type="button" class="btn-secondary" data-action="knowledge-add-reference">참조 추가</button>' +
      '</div>' +
      '<div class="knowledge-reference-grid knowledge-reference-grid-scrollable">' + referenceCards + '</div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
    restoreDisclosureOpenState(root, preservedDisclosureOpen);
    restoreFieldScrollState(root, preservedFieldScroll);
    restoreActiveFieldState(root, preservedActiveField);

    var currentCharacters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);
    var characterSheetDraft = normalizeCharacterSheets(knowledge.characterSheets, currentCharacters);
    var environmentAssetDraft = normalizeEnvironmentAssets(knowledge.environmentAssets);
    var modalCharacterSheetDraft = null;
    var modalBrandCharsDraft = null;
    var modalSaveInFlight = false;
    var modalPreviewImageUrl = '';
    var modalPreviewImageAlt = '';
    // AI 자동 채우기 상태: 분석 중(버튼 잠금) / 펼쳐둘 캐릭터 / 완료 안내를 띄울 캐릭터
    var aiFillBusyToken = '';
    var aiFillOpenToken = '';
    var aiFillNoticeToken = '';
    // 배경·소품 라이브러리 모달 상태 (캐릭터 IP 라이브러리와 동일한 구조).
    var modalEnvDraft = null;
    var modalEnvSaveInFlight = false;
    var modalEnvPreviewImageUrl = '';
    var modalEnvPreviewImageAlt = '';

    function normSplit(val) {
      return String(val || '').split(/[,\n]/).map(function (t) { return t.trim(); }).filter(Boolean);
    }
    function getBrandCharForToken(token) {
      var t = String(token || '').trim().toLowerCase();
      if (!Array.isArray(modalBrandCharsDraft)) return null;
      return modalBrandCharsDraft.find(function (c) { return String(c.trigger || '').toLowerCase() === t; }) || null;
    }
    function syncBrandCharField(token, field, value) {
      var t = String(token || '').trim().toLowerCase();
      if (!Array.isArray(modalBrandCharsDraft)) modalBrandCharsDraft = [];
      var idx = modalBrandCharsDraft.findIndex(function (c) { return String(c.trigger || '').toLowerCase() === t; });
      if (idx < 0) {
        modalBrandCharsDraft.push({ id: 'char_' + Date.now(), trigger: token, name: token.replace(/^@/, '') });
        idx = modalBrandCharsDraft.length - 1;
      }
      modalBrandCharsDraft[idx] = Object.assign({}, modalBrandCharsDraft[idx]);
      modalBrandCharsDraft[idx][field] = value;
    }

    function cloneCharacterSheetDraft(value) {
      try {
        return normalizeCharacterSheets(JSON.parse(JSON.stringify(Array.isArray(value) ? value : [])), currentCharacters);
      } catch (_) {
        return normalizeCharacterSheets(value, currentCharacters);
      }
    }

    function syncCharacterCountUi() {
      var count = currentCharacters.length;
      var countEl = root.querySelector('[data-character-count]');
      if (countEl) countEl.textContent = String(count) + '명';
    }

    function syncCharacterUi() {
      var chipBox = root.querySelector('#knowledge-character-chips');
      if (chipBox) chipBox.innerHTML = renderCharacterRows(currentCharacters);
      characterSheetDraft = normalizeCharacterSheets(characterSheetDraft, currentCharacters);
      syncCharacterCountUi();
    }

    function addCharacter(name) {
      var displayName = normalizeCharacterName(name);
      if (!displayName) return false;
      var token = '@' + displayName;
      var exists = currentCharacters.some(function (item) {
        return String(item.token || '').toLowerCase() === token.toLowerCase();
      });
      if (exists) return false;
      currentCharacters.push({
        characterId: 'char_' + String(Date.now()),
        displayName: displayName,
        token: token,
        personality: ''
      });
      syncCharacterUi();
      return true;
    }

    function syncEnvironmentUi() {
      environmentAssetDraft = normalizeEnvironmentAssets(environmentAssetDraft);
      var box = root.querySelector('#knowledge-environment-cards');
      if (box) box.innerHTML = renderEnvironmentRows(environmentAssetDraft);
      var countEl = root.querySelector('[data-environment-count]');
      if (countEl) countEl.textContent = String(environmentAssetDraft.length) + '개';
    }

    function persistEnvironmentDraft() {
      if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
      syncBrandAndProject(
        readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft)
      ).then(function () {
        knowledge.environmentAssets = normalizeEnvironmentAssets(environmentAssetDraft);
      }).catch(function () {});
    }

    function findEnvironmentAsset(assetId) {
      var target = String(assetId || '').trim();
      if (!target) return null;
      return environmentAssetDraft.find(function (asset) {
        return String(asset.assetId || '') === target;
      }) || null;
    }

    function updateEnvironmentAsset(assetId, updater) {
      var target = String(assetId || '').trim();
      environmentAssetDraft = normalizeEnvironmentAssets(environmentAssetDraft.map(function (asset) {
        if (String(asset.assetId || '') !== target) return asset;
        var next = typeof updater === 'function' ? updater(Object.assign({}, asset, {
          items: normalizeCharacterSheetItems(asset.items)
        })) : asset;
        return Object.assign({}, next, {
          items: normalizeCharacterSheetItems(next && next.items)
        });
      }));
    }

    function addEnvironmentAsset(name) {
      var displayName = normalizeEnvironmentName(name);
      if (!displayName) return false;
      var token = '@' + displayName.replace(/\s+/g, '');
      var exists = environmentAssetDraft.some(function (asset) {
        return String(asset.token || '').toLowerCase() === token.toLowerCase();
      });
      if (exists) return false;
      environmentAssetDraft = normalizeEnvironmentAssets(environmentAssetDraft.concat([{
        assetId: 'env_' + String(Date.now()),
        displayName: displayName,
        token: token,
        description: '',
        items: []
      }]));
      syncEnvironmentUi();
      return true;
    }

    // 배경·소품 라이브러리 모달 (캐릭터 IP 라이브러리와 동일한 구조: 자산별 이미지 시트 4칸).
    function cloneEnvironmentDraft(value) {
      try {
        return normalizeEnvironmentAssets(JSON.parse(JSON.stringify(Array.isArray(value) ? value : [])));
      } catch (_) {
        return normalizeEnvironmentAssets(value);
      }
    }

    function closeEnvironmentManagerModal() {
      var modal = document.getElementById('environment-manager-modal');
      if (modal) modal.classList.add('hidden');
      if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
      modalEnvDraft = null;
      modalEnvSaveInFlight = false;
      modalEnvPreviewImageUrl = '';
      modalEnvPreviewImageAlt = '';
    }

    function updateModalEnvEntry(assetId, updater) {
      var target = String(assetId || '').trim();
      modalEnvDraft = normalizeEnvironmentAssets((Array.isArray(modalEnvDraft) ? modalEnvDraft : []).map(function (asset) {
        if (String(asset.assetId || '') !== target) return asset;
        var next = typeof updater === 'function' ? updater(Object.assign({}, asset, {
          items: normalizeCharacterSheetItems(asset.items)
        })) : asset;
        return Object.assign({}, next, {
          items: normalizeCharacterSheetItems(next && next.items)
        });
      }));
    }

    function findModalEnvSheet(assetId, sheetId) {
      var ta = String(assetId || '').trim();
      var ts = String(sheetId || '').trim();
      if (!ta || !ts) return null;
      var list = Array.isArray(modalEnvDraft) ? modalEnvDraft : [];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].assetId || '') !== ta) continue;
        var items = normalizeCharacterSheetItems(list[i].items);
        for (var j = 0; j < items.length; j++) {
          if (String(items[j].sheetId || '') === ts) return { asset: list[i], sheet: items[j] };
        }
      }
      return null;
    }

    function renderEnvironmentManagerModal() {
      var modal = document.getElementById('environment-manager-modal');
      var box = document.getElementById('environment-manager-modal-content');
      if (!modal || !box) return;
      var uiText = getEnvironmentLibraryUiText();
      if (!modalEnvDraft) modalEnvDraft = cloneEnvironmentDraft(environmentAssetDraft);
      var entries = normalizeEnvironmentAssets(modalEnvDraft);
      modalEnvDraft = entries;

      var cardsHtml = entries.length
        ? entries.map(function (asset) {
          var displayName = asset.displayName || String(asset.token || '').replace(/^@/, '');
          var sheetItems = normalizeCharacterSheetItems(asset.items);
          var slotCards = [];
          for (var slotIndex = 0; slotIndex < MAX_CHARACTER_SHEETS_PER_CHARACTER; slotIndex++) {
            var sheet = sheetItems[slotIndex];
            if (!sheet) {
              slotCards.push('<div class="character-sheet-slot is-empty" aria-hidden="true"></div>');
              continue;
            }
            slotCards.push(
              '<article class="character-sheet-slot is-filled' + (sheet.isPrimary ? ' is-primary' : '') + '" data-asset-id="' + escapeHtml(asset.assetId) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '">' +
              '<button type="button" class="character-sheet-thumb-button" data-action="environment-sheet-preview" data-asset-id="' + escapeHtml(asset.assetId) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + uiText.preview) + '">' +
              '<img class="character-sheet-thumb" src="' + escapeHtml(resolveSheetPreviewUrl(sheet.imageDataUrl)) + '" alt="' + escapeHtml(displayName + uiText.sheetAltSuffix) + '" />' +
              '</button>' +
              '<button type="button" class="character-sheet-overlay-btn is-primary' + (sheet.isPrimary ? ' is-active' : '') + '" data-action="environment-sheet-set-primary" data-asset-id="' + escapeHtml(asset.assetId) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + uiText.setPrimary) + '">V</button>' +
              '<button type="button" class="character-sheet-overlay-btn is-delete" data-action="environment-sheet-delete" data-asset-id="' + escapeHtml(asset.assetId) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + uiText.deleteSheet) + '">X</button>' +
              '</article>'
            );
          }
          return (
            '<section class="character-manager-card" data-asset-id="' + escapeHtml(asset.assetId) + '">' +
            '<div class="character-manager-card-row">' +
            '<div class="character-manager-card-info">' +
            '<div class="character-manager-card-name"><strong>' + escapeHtml(asset.token) + '</strong>' + (asset.description ? '<span class="character-sheet-count">' + escapeHtml(asset.description) + '</span>' : '') + '</div>' +
            '<span class="character-sheet-count">' + escapeHtml(uiText.count) + ' ' + escapeHtml(String(sheetItems.length)) + '/4' + escapeHtml(uiText.countSuffix) + '</span>' +
            '<label class="character-sheet-upload btn-secondary compact">' +
            '<input type="file" accept="image/*" multiple data-action="environment-sheet-upload" data-asset-id="' + escapeHtml(asset.assetId) + '" />' +
            escapeHtml(uiText.upload) +
            '</label>' +
            '</div>' +
            '<div class="character-sheet-slot-grid">' + slotCards.join('') + '</div>' +
            '</div>' +
            '</section>'
          );
        }).join('')
        : '<div class="character-manager-empty">' + escapeHtml(uiText.empty) + '</div>';

      var previewHtml = modalEnvPreviewImageUrl
        ? (
          '<div class="character-sheet-preview-overlay" data-action="environment-sheet-preview-close">' +
          '<div class="character-sheet-preview-surface">' +
          '<img class="character-sheet-preview-image" src="' + escapeHtml(modalEnvPreviewImageUrl) + '" alt="' + escapeHtml(modalEnvPreviewImageAlt || uiText.previewAlt) + '" />' +
          '</div>' +
          '</div>'
        )
        : '';
      box.innerHTML =
        '<div class="character-manager-shell">' +
        '<div class="character-manager-body">' +
        '<div class="character-manager-head">' +
        '<div><h3>' + escapeHtml(uiText.title) + '</h3><p>' + escapeHtml(uiText.description) + '</p></div>' +
        '<div class="character-manager-head-actions">' +
        '<button type="button" class="btn-primary" data-action="environment-manager-save"' + (modalEnvSaveInFlight ? ' disabled' : '') + '>' + escapeHtml(uiText.save) + '</button>' +
        '<button type="button" class="btn-secondary" data-action="environment-manager-close"' + (modalEnvSaveInFlight ? ' disabled' : '') + '>' + escapeHtml(uiText.close) + '</button>' +
        '</div>' +
        '</div>' +
        '<div class="character-manager-grid">' + cardsHtml + '</div>' +
        '</div>' +
        previewHtml;

      box.onclick = function (evt) {
        var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
        if (!btn) return;
        var action = String(btn.dataset.action || '').trim();
        if (action === 'environment-manager-close') {
          if (modalEnvSaveInFlight) return;
          closeEnvironmentManagerModal();
          return;
        }
        if (action === 'environment-sheet-preview-close') {
          modalEnvPreviewImageUrl = '';
          modalEnvPreviewImageAlt = '';
          renderEnvironmentManagerModal();
          return;
        }
        if (action === 'environment-sheet-preview') {
          var pv = findModalEnvSheet(btn.dataset.assetId, btn.dataset.sheetId);
          if (!pv || !pv.sheet) return;
          modalEnvPreviewImageUrl = resolveSheetPreviewUrl(pv.sheet.imageDataUrl);
          modalEnvPreviewImageAlt = (pv.asset && (pv.asset.displayName || pv.asset.token) || '') + ' ' + uiText.previewAlt;
          renderEnvironmentManagerModal();
          return;
        }
        if (action === 'environment-sheet-set-primary') {
          var primarySheetId = btn.dataset.sheetId;
          updateModalEnvEntry(btn.dataset.assetId, function (asset) {
            asset.items = normalizeCharacterSheetItems(asset.items).map(function (sheet) {
              return Object.assign({}, sheet, { isPrimary: String(sheet.sheetId) === String(primarySheetId) });
            });
            return asset;
          });
          renderEnvironmentManagerModal();
          return;
        }
        if (action === 'environment-sheet-delete') {
          var deleteSheetId = btn.dataset.sheetId;
          updateModalEnvEntry(btn.dataset.assetId, function (asset) {
            asset.items = normalizeCharacterSheetItems(asset.items).filter(function (sheet) {
              return String(sheet.sheetId) !== String(deleteSheetId);
            });
            return asset;
          });
          renderEnvironmentManagerModal();
          return;
        }
        if (action === 'environment-manager-save') {
          if (modalEnvSaveInFlight) return;
          modalEnvSaveInFlight = true;
          if (NK.core && NK.core.setLoading) NK.core.setLoading(true, uiText.saveLoading);
          renderEnvironmentManagerModal();
          // 모달에서 편집한 이미지(items)만 현재 environmentAssetDraft 에 병합 — 인라인 설명은 보존.
          var imagesByAsset = {};
          normalizeEnvironmentAssets(modalEnvDraft).forEach(function (a) { imagesByAsset[a.assetId] = a.items; });
          environmentAssetDraft = normalizeEnvironmentAssets(environmentAssetDraft.map(function (a) {
            return Object.assign({}, a, { items: imagesByAsset[a.assetId] || a.items });
          }));
          Promise.resolve()
            .then(function () {
              return syncBrandAndProject(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft));
            })
            .then(function (result) {
              knowledge.environmentAssets = normalizeEnvironmentAssets(environmentAssetDraft);
              if (result && result.draft) {
                project = result.draft;
                knowledge = mergeKnowledge(readKnowledge(result.draft), brand ? readKnowledge(brand) : null);
              }
              syncEnvironmentUi();
            })
            .catch(function (err) {
              alert(uiText.saveFail + (err && err.message ? err.message : err));
            })
            .finally(function () {
              if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
              modalEnvSaveInFlight = false;
              renderEnvironmentManagerModal();
            });
          return;
        }
      };

      box.onchange = function (evt) {
        var input = evt.target;
        if (!input || !input.matches || !input.matches('input[type="file"][data-action="environment-sheet-upload"]')) return;
        var assetId = String(input.dataset.assetId || '').trim();
        var files = Array.prototype.slice.call(input.files || []);
        if (!assetId || !files.length) return;
        var targetEntry = (entries || []).find(function (a) { return String(a.assetId || '') === assetId; }) || null;
        var existingCount = Array.isArray(targetEntry && targetEntry.items) ? targetEntry.items.length : 0;
        var remainingSlots = Math.max(0, MAX_CHARACTER_SHEETS_PER_CHARACTER - existingCount);
        if (!remainingSlots) {
          alert(uiText.uploadLimitReached);
          input.value = '';
          return;
        }
        var uploadFiles = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
          alert(uiText.uploadLimitPartial + String(remainingSlots) + uiText.uploadLimitPartialSuffix);
        }
        Promise.all(uploadFiles.map(function (file, index) {
          return readFileAsDataUrl(file).then(function (dataUrl) {
            return { sheetId: 'sheet_' + Date.now() + '_' + index, imageDataUrl: dataUrl, isPrimary: false };
          });
        }))
          .then(function (items) {
            updateModalEnvEntry(assetId, function (asset) {
              var existingItems = normalizeCharacterSheetItems(asset.items);
              asset.items = existingItems.concat(items.map(function (sheet, index) {
                return Object.assign({}, sheet, { isPrimary: !existingItems.length && index === 0 });
              }));
              return asset;
            });
            renderEnvironmentManagerModal();
          })
          .catch(function (err) {
            alert(uiText.uploadFail + (err && err.message ? err.message : err));
          })
          .finally(function () {
            input.value = '';
          });
      };

      modal.onclick = function (evt) {
        if (modalEnvSaveInFlight) return;
        if (evt.target === modal) closeEnvironmentManagerModal();
        var closeBtn = evt.target && evt.target.closest ? evt.target.closest('[data-close="environment-manager-modal"]') : null;
        if (closeBtn) closeEnvironmentManagerModal();
      };

      modal.classList.remove('hidden');
    }

    function ensureCharacterSheetDraft() {
      characterSheetDraft = normalizeCharacterSheets(characterSheetDraft, currentCharacters);
      return characterSheetDraft;
    }

    function updateCharacterSheetEntry(token, updater) {
      var targetToken = String(token || '').trim().toLowerCase();
      characterSheetDraft = ensureCharacterSheetDraft().map(function (entry) {
        if (String(entry.token || '').toLowerCase() !== targetToken) return entry;
        var nextEntry = typeof updater === 'function' ? updater(Object.assign({}, entry, {
          items: normalizeCharacterSheetItems(entry.items)
        })) : entry;
        return Object.assign({}, nextEntry, {
          items: normalizeCharacterSheetItems(nextEntry && nextEntry.items)
        });
      });
      characterSheetDraft = normalizeCharacterSheets(characterSheetDraft, currentCharacters);
    }

    function readFileAsDataUrl(file) {
      return new Promise(function (resolve, reject) {
        try {
          var reader = new FileReader();
          reader.onload = function () { resolve(String(reader.result || '')); };
          reader.onerror = function () { reject(reader.error || new Error('file_read_failed')); };
          reader.readAsDataURL(file);
        } catch (err) {
          reject(err);
        }
      });
    }

    /**
     * v3.1589: 저장된 브랜드 캐릭터를 화면이 들고 있는 스냅샷에 반영한다.
     *
     * 이 화면은 `brand` 와 그것에서 뽑은 `characters` 를 렌더 시점에 한 번 잡아 두고 쓴다.
     * 저장 경로가 저장소만 갱신하고 이 둘을 두면, 모달을 다시 열 때 저장 전 값이 되살아난다.
     * persistShared 는 저장된 브랜드를 돌려주므로 그것을 우선 쓰고,
     * 없으면(구 update 폴백) 방금 보낸 패치로 대신 맞춘다.
     */
    function applySavedBrandCharacters(savedBrand, sentPatch) {
      var nextChars = null;
      if (savedBrand && Array.isArray(savedBrand.brandCharacters)) nextChars = savedBrand.brandCharacters;
      else if (Array.isArray(sentPatch)) nextChars = sentPatch;
      if (!nextChars) return;
      // characters 는 brand.brandCharacters 를 그대로 가리킨다(복사본이 아니다).
      // 아래에서 제자리 비우기를 하므로, 같은 배열일 경우 원본까지 날아간다. 먼저 떠 둔다.
      var snapshot = nextChars.slice();
      if (savedBrand && typeof savedBrand === 'object') brand = savedBrand;
      else if (brand && typeof brand === 'object') brand = Object.assign({}, brand, { brandCharacters: snapshot });
      // characters 는 다음 '열기' 가 초안을 뜨는 원본이다. 내용을 제자리에서 갈아끼운다.
      if (Array.isArray(characters)) {
        characters.length = 0;
        snapshot.forEach(function (c) { characters.push(c); });
      }
    }

    function closeCharacterManagerModal() {
      var modal = document.getElementById('character-manager-modal');
      if (modal) modal.classList.add('hidden');
      if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
      modalCharacterSheetDraft = null;
      modalBrandCharsDraft = null;
      modalSaveInFlight = false;
      modalPreviewImageUrl = '';
      modalPreviewImageAlt = '';
    }

    function captureCharacterPropsDisclosureState(box) {
      var state = {};
      if (!box || !box.querySelectorAll) return state;
      var cards = box.querySelectorAll('.character-manager-card[data-character-token]');
      Array.prototype.forEach.call(cards, function (card) {
        var token = String(card.getAttribute('data-character-token') || '').trim().toLowerCase();
        if (!token) return;
        var details = card.querySelector('.character-props-disclosure');
        if (!details) return;
        state[token] = !!details.open;
      });
      return state;
    }

    function restoreCharacterPropsDisclosureState(box, state) {
      if (!box || !state || !box.querySelectorAll) return;
      var cards = box.querySelectorAll('.character-manager-card[data-character-token]');
      Array.prototype.forEach.call(cards, function (card) {
        var token = String(card.getAttribute('data-character-token') || '').trim().toLowerCase();
        if (!token || !(token in state)) return;
        var details = card.querySelector('.character-props-disclosure');
        if (!details) return;
        if (state[token]) details.setAttribute('open', '');
        else details.removeAttribute('open');
      });
    }

    function captureModalActiveFieldState(box) {
      if (!box) return null;
      var active = (typeof document !== 'undefined') ? document.activeElement : null;
      if (!active || !box.contains || !box.contains(active)) return null;
      var token = String(active.getAttribute && active.getAttribute('data-character-token') || '').trim().toLowerCase();
      var prop = String(active.getAttribute && active.getAttribute('data-char-prop') || '').trim();
      if (!token || !prop) return null;
      var snapshot = { token: token, prop: prop };
      try {
        if (typeof active.selectionStart === 'number') snapshot.selectionStart = active.selectionStart;
        if (typeof active.selectionEnd === 'number') snapshot.selectionEnd = active.selectionEnd;
      } catch (_) {}
      return snapshot;
    }

    function restoreModalActiveFieldState(box, state) {
      if (!box || !state || !state.token || !state.prop) return;
      var selector = '[data-character-token][data-char-prop="' + state.prop.replace(/"/g, '\\"') + '"]';
      var candidates = box.querySelectorAll ? box.querySelectorAll(selector) : [];
      var match = null;
      Array.prototype.some.call(candidates, function (el) {
        var token = String(el.getAttribute('data-character-token') || '').trim().toLowerCase();
        if (token === state.token) { match = el; return true; }
        return false;
      });
      if (!match || typeof match.focus !== 'function') return;
      try { match.focus(); } catch (_) {}
      try {
        if (typeof state.selectionStart === 'number' && typeof match.setSelectionRange === 'function') {
          var end = state.selectionEnd != null ? state.selectionEnd : state.selectionStart;
          match.setSelectionRange(state.selectionStart, end);
        }
      } catch (_) {}
    }

    function renderCharacterManagerModal() {
      // 언어 전환 리스너가 부를 수 있도록 최신 렌더 함수를 등록해 둔다.
      rerenderCharacterModal = renderCharacterManagerModal;
      bindLangChangeOnce();
      var modal = document.getElementById('character-manager-modal');
      var box = document.getElementById('character-manager-modal-content');
      if (!modal || !box) return;
      var preservedDisclosureState = captureCharacterPropsDisclosureState(box);
      var preservedActiveField = captureModalActiveFieldState(box);
      var ipLibraryUiText = getIpLibraryUiText();
      if (!modalCharacterSheetDraft) {
        modalCharacterSheetDraft = cloneCharacterSheetDraft(ensureCharacterSheetDraft());
      }
      var sheetEntries = normalizeCharacterSheets(modalCharacterSheetDraft, currentCharacters);
      modalCharacterSheetDraft = sheetEntries;

      function updateModalCharacterSheetEntry(token, updater) {
        var targetToken = String(token || '').trim().toLowerCase();
        modalCharacterSheetDraft = normalizeCharacterSheets((Array.isArray(modalCharacterSheetDraft) ? modalCharacterSheetDraft : []).map(function (entry) {
          if (String(entry.token || '').toLowerCase() !== targetToken) return entry;
          var nextEntry = typeof updater === 'function' ? updater(Object.assign({}, entry, {
            items: normalizeCharacterSheetItems(entry.items)
          })) : entry;
          return Object.assign({}, nextEntry, {
            items: normalizeCharacterSheetItems(nextEntry && nextEntry.items)
          });
        }), currentCharacters);
      }

      function findModalCharacterSheetItem(token, sheetId) {
        var targetToken = String(token || '').trim().toLowerCase();
        var targetSheetId = String(sheetId || '').trim();
        if (!targetToken || !targetSheetId) return null;
        for (var i = 0; i < sheetEntries.length; i++) {
          var entry = sheetEntries[i];
          if (String(entry && entry.token || '').trim().toLowerCase() !== targetToken) continue;
          var items = normalizeCharacterSheetItems(entry && entry.items);
          for (var j = 0; j < items.length; j++) {
            var sheet = items[j];
            if (String(sheet && sheet.sheetId || '') !== targetSheetId) continue;
            return {
              entry: entry,
              sheet: sheet
            };
          }
        }
        return null;
      }

      var cardsHtml = sheetEntries.length
        ? sheetEntries.map(function (entry) {
          var displayName = normalizeCharacterName(entry.displayName || entry.token) || String(entry.token || '').replace(/^@/, '');
          var sheetItems = normalizeCharacterSheetItems(entry.items);
          var slotCards = [];
          for (var slotIndex = 0; slotIndex < MAX_CHARACTER_SHEETS_PER_CHARACTER; slotIndex++) {
            var sheet = sheetItems[slotIndex];
            if (!sheet) {
              slotCards.push('<div class="character-sheet-slot is-empty" aria-hidden="true"></div>');
              continue;
            }
            slotCards.push(
              '<article class="character-sheet-slot is-filled' + (sheet.isPrimary ? ' is-primary' : '') + '" data-character-token="' + escapeHtml(entry.token) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '">' +
              '<button type="button" class="character-sheet-thumb-button" data-action="character-sheet-preview" data-character-token="' + escapeHtml(entry.token) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + ipLibraryUiText.preview) + '">' +
              '<img class="character-sheet-thumb" src="' + escapeHtml(resolveSheetPreviewUrl(sheet.imageDataUrl)) + '" alt="' + escapeHtml(displayName + ipLibraryUiText.sheetAltSuffix) + '" />' +
              '</button>' +
              '<button type="button" class="character-sheet-overlay-btn is-primary' + (sheet.isPrimary ? ' is-active' : '') + '" data-action="character-sheet-set-primary" data-character-token="' + escapeHtml(entry.token) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + ipLibraryUiText.setPrimary) + '">V</button>' +
              '<button type="button" class="character-sheet-overlay-btn is-delete" data-action="character-sheet-delete" data-character-token="' + escapeHtml(entry.token) + '" data-sheet-id="' + escapeHtml(sheet.sheetId) + '" aria-label="' + escapeHtml(displayName + ' ' + ipLibraryUiText.deleteSheet) + '">X</button>' +
              '</article>'
            );
          }
          var bChar = getBrandCharForToken(entry.token);
          return (
            '<section class="character-manager-card" data-character-token="' + escapeHtml(entry.token) + '">' +
            '<div class="character-manager-card-row">' +
            '<div class="character-manager-card-info">' +
            '<div class="character-manager-card-name"><strong>' + escapeHtml(displayName) + '</strong></div>' +
            '<span class="character-sheet-count">' + escapeHtml(ipLibraryUiText.count) + ' ' + escapeHtml(String(sheetItems.length)) + '/4' + escapeHtml(ipLibraryUiText.countSuffix) + '</span>' +
            '<label class="character-sheet-upload btn-secondary compact">' +
            '<input type="file" accept="image/*" multiple data-action="character-sheet-upload" data-character-token="' + escapeHtml(entry.token) + '" />' +
            escapeHtml(ipLibraryUiText.upload) +
            '</label>' +
            '</div>' +
            '<div class="character-sheet-slot-grid">' + slotCards.join('') + '</div>' +
            '</div>' +
            '<details class="character-props-disclosure"' + (aiFillOpenToken === entry.token ? ' open' : '') + '>' +
            // 요약줄 안에 AI 자동 채우기 버튼을 둔다. summary 기본 토글과 충돌하지 않도록
            // 핸들러에서 preventDefault 하고, 채운 뒤에는 열린 상태로 다시 렌더한다.
            '<summary>' + escapeHtml(ipLibraryUiText.propsTitle) +
            '<button type="button" class="character-props-ai-btn" data-action="character-props-ai" data-character-token="' + escapeHtml(entry.token) + '"' +
            (aiFillBusyToken ? ' disabled' : '') +
            ' title="' + escapeHtml(ipLibraryUiText.aiFillTitle) + '" aria-label="' + escapeHtml(ipLibraryUiText.aiFill) + '">' +
            // Lucide wand-sparkles
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/>' +
            '<path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>' +
            '</svg>' +
            '<span>' + escapeHtml(aiFillBusyToken === entry.token ? ipLibraryUiText.aiFilling : ipLibraryUiText.aiFill) + '</span>' +
            '</button>' +
            '</summary>' +
            '<div class="character-props-form">' +
            (aiFillNoticeToken === entry.token
              ? '<p class="character-props-ai-notice">' + escapeHtml(ipLibraryUiText.aiFillDone) + '</p>'
              : '') +
            '<label class="character-props-label character-props-label-appearance">' + escapeHtml(ipLibraryUiText.appearanceLabel) + '<textarea class="character-props-textarea" data-char-prop="description" data-character-token="' + escapeHtml(entry.token) + '" rows="5" placeholder="' + escapeHtml(ipLibraryUiText.appearancePlaceholder) + '">' + escapeHtml((bChar && bChar.description) || '') + '</textarea></label>' +
            '<label class="character-props-label character-props-label-negative">' + escapeHtml(ipLibraryUiText.negativeLabel) + '<textarea class="character-props-textarea" data-char-prop="negativePrompt" data-character-token="' + escapeHtml(entry.token) + '" rows="5" placeholder="' + escapeHtml(ipLibraryUiText.negativePlaceholder) + '">' + escapeHtml((bChar && bChar.negativePrompt) || '') + '</textarea></label>' +
            '</div>' +
            '</details>' +
            '</section>'
          );
        }).join('')
        : '<div class="character-manager-empty">' + escapeHtml(ipLibraryUiText.empty) + '</div>';

      var previewHtml = modalPreviewImageUrl
        ? (
          '<div class="character-sheet-preview-overlay" data-action="character-sheet-preview-close">' +
          '<div class="character-sheet-preview-surface">' +
          '<img class="character-sheet-preview-image" src="' + escapeHtml(modalPreviewImageUrl) + '" alt="' + escapeHtml(modalPreviewImageAlt || ipLibraryUiText.previewAlt) + '" />' +
          '</div>' +
          '</div>'
        )
        : '';
      box.innerHTML =
        '<div class="character-manager-shell">' +
        '<div class="character-manager-body">' +
        '<div class="character-manager-head">' +
        '<div><h3>' + escapeHtml(ipLibraryUiText.title) + '</h3><p>' + escapeHtml(ipLibraryUiText.description) + '</p></div>' +
        '<div class="character-manager-head-actions">' +
        '<button type="button" class="btn-primary" data-action="character-manager-save"' + (modalSaveInFlight ? ' disabled' : '') + '>' + escapeHtml(ipLibraryUiText.save) + '</button>' +
        '<button type="button" class="btn-secondary" data-action="character-manager-close"' + (modalSaveInFlight ? ' disabled' : '') + '>' + escapeHtml(ipLibraryUiText.close) + '</button>' +
        '</div>' +
        '</div>' +
        '<div class="character-manager-grid">' + cardsHtml + '</div>' +
        '</div>' +
        previewHtml;

      restoreCharacterPropsDisclosureState(box, preservedDisclosureState);
      restoreModalActiveFieldState(box, preservedActiveField);

      // character-props-disclosure 애니메이션 바인딩 (모달은 root 밖이므로 여기서 직접 호출)
      if (NK.ui && NK.ui.common && typeof NK.ui.common.bindDisclosureMotion === 'function') {
        NK.ui.common.bindDisclosureMotion(box);
      }

      box.oninput = function (evt) {
        var el = evt.target;
        if (!el || !el.dataset || !el.dataset.charProp) return;
        var token = String(el.dataset.characterToken || '').trim();
        var prop = String(el.dataset.charProp || '').trim();
        if (!token || !prop) return;
        var val = String(el.value || '').trim();
        if (prop === 'fixedTraits' || prop === 'bannedTraits') {
          syncBrandCharField(token, prop, normSplit(val));
        } else {
          syncBrandCharField(token, prop, val);
        }
      };

      box.onclick = function (evt) {
        var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
        if (!btn) return;
        var action = String(btn.dataset.action || '').trim();
        if (action === 'character-manager-close') {
          if (modalSaveInFlight) return;
          closeCharacterManagerModal();
          return;
        }
        if (action === 'character-sheet-preview-close') {
          modalPreviewImageUrl = '';
          modalPreviewImageAlt = '';
          renderCharacterManagerModal();
          return;
        }
        if (action === 'character-sheet-preview') {
          var previewToken = btn.dataset.characterToken;
          var previewSheetId = btn.dataset.sheetId;
          var previewTarget = findModalCharacterSheetItem(previewToken, previewSheetId);
          if (!previewTarget || !previewTarget.sheet) return;
          modalPreviewImageUrl = resolveSheetPreviewUrl(previewTarget.sheet.imageDataUrl);
          modalPreviewImageAlt = (normalizeCharacterName(previewTarget.entry && (previewTarget.entry.displayName || previewTarget.entry.token) || previewToken || '') || String(previewToken || '').replace(/^@/, '')) + ' ' + ipLibraryUiText.previewAlt;
          renderCharacterManagerModal();
          return;
        }
        if (action === 'character-props-ai') {
          // summary 안의 버튼이라 기본 토글을 막고, 우리가 열린 상태를 제어한다.
          if (evt.preventDefault) evt.preventDefault();
          if (evt.stopPropagation) evt.stopPropagation();
          if (aiFillBusyToken) return;
          var aiToken = String(btn.dataset.characterToken || '').trim();
          var aiTokenKey = aiToken.toLowerCase();
          var aiEntry = (Array.isArray(sheetEntries) ? sheetEntries : []).find(function (e) {
            return String((e && e.token) || '').trim().toLowerCase() === aiTokenKey;
          }) || null;
          var aiSheets = (aiEntry && Array.isArray(aiEntry.items) ? aiEntry.items : [])
            .map(function (sheet) { return String((sheet && sheet.imageDataUrl) || '').trim(); })
            .filter(Boolean)
            .slice(0, 4);
          if (!aiSheets.length) { alert(ipLibraryUiText.aiFillNoSheet); return; }
          var aiName = normalizeCharacterName((aiEntry && (aiEntry.displayName || aiEntry.token)) || aiToken) || String(aiToken).replace(/^@/, '');
          // 브랜드 맥락을 함께 넘겨 같은 세계관·규칙 안에서 서술되게 한다.
          var otherNames = (Array.isArray(sheetEntries) ? sheetEntries : [])
            .map(function (e) { return String((e && (e.displayName || e.token)) || '').replace(/^@/, '').trim(); })
            .filter(function (n) { return n && n !== aiName; });
          var aiBrandContext = {
            brandTitle: String((brand && brand.brandTitle) || knowledge.brandTitle || '').trim(),
            brandStory: String(knowledge.brandStory || '').trim(),
            worldSetting: String(knowledge.worldSetting || '').trim(),
            brandRules: Array.isArray(knowledge.brandRules) ? knowledge.brandRules : [],
            bannedExpressions: Array.isArray(knowledge.bannedExpressions) ? knowledge.bannedExpressions : [],
            otherCharacters: otherNames
          };
          aiFillBusyToken = aiToken;
          aiFillOpenToken = aiToken;
          renderCharacterManagerModal();
          Promise.resolve()
            // 원본 그대로 보내면 본문이 수십 MB 가 돼 함수가 502 로 죽는다. 보내는 사본만 줄인다.
            .then(function () { return Promise.all(aiSheets.map(shrinkForAnalyze)); })
            .then(function (shrunkSheets) {
              aiSheets = shrunkSheets.filter(Boolean);
              if (!NK.api || typeof NK.api.ipAnalyze !== 'function') throw new Error('API client가 로드되지 않았습니다.');
              /*
               * 첫 시도가 시간 초과면 한 번 더 부른다.
               *
               * Gemini 는 서울 프록시를 거치는데(홍콩 COLO 는 구글이 막는다) 그 컨테이너가
               * 자고 있으면 콜드스타트가 20~40초다. 그동안 Cloudflare 가 먼저 끊어서
               * 우리 사유 대신 504 페이지가 떴다. 두 번째 호출 때는 이미 깨어 있어 빠르다.
               * 엣지가 끊은 경우(502·504)는 JSON 이 아니라 HTML 이 오므로 상태코드로도 본다.
               */
              var askOnce = function () {
                return NK.api.ipAnalyze({
                  characterName: aiName,
                  imageUrls: aiSheets,
                  brandContext: aiBrandContext,
                  lang: getRuntimeLang() === 'en' ? 'en' : 'ko'
                });
              };
              return askOnce().catch(function (err) {
                var status = err && err.status;
                var retryable = status === 502 || status === 504 ||
                  /retryable/.test(String((err && err.detail) || ''));
                if (!retryable) throw err;
                return askOnce();
              });
            })
            .then(function (res) {
              // 초안만 채운다 — 영속화는 사용자가 '저장'을 눌렀을 때만.
              // 서버가 옛 5필드로 답해도(캐시된 함수 등) 여기서 2칸으로 합쳐 받는다.
              var traitsSvc = (NK.service && NK.service.characterTraits) || null;
              var merged = traitsSvc && typeof traitsSvc.normalizeTextProps === 'function'
                ? traitsSvc.normalizeTextProps(res || {})
                : { description: String((res && res.description) || ''), negativePrompt: String((res && res.negativePrompt) || '') };
              if (merged.description) syncBrandCharField(aiToken, 'description', merged.description);
              if (merged.negativePrompt) syncBrandCharField(aiToken, 'negativePrompt', merged.negativePrompt);
              aiFillBusyToken = '';
              aiFillNoticeToken = aiToken;
              renderCharacterManagerModal();
            })
            .catch(function (err) {
              aiFillBusyToken = '';
              renderCharacterManagerModal();
              alert(ipLibraryUiText.aiFillFail + (err && err.message ? err.message : err));
            });
          return;
        }
        if (action === 'character-sheet-set-primary') {
          var primaryToken = btn.dataset.characterToken;
          var primarySheetId = btn.dataset.sheetId;
          updateModalCharacterSheetEntry(primaryToken, function (entry) {
            entry.items = normalizeCharacterSheetItems(entry.items).map(function (sheet) {
              return Object.assign({}, sheet, { isPrimary: String(sheet.sheetId) === String(primarySheetId) });
            });
            return entry;
          });
          renderCharacterManagerModal();
          try {
            var nextDraft = readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, modalCharacterSheetDraft, environmentAssetDraft);
            syncBrandAndProject(nextDraft)
              .then(function (result) {
                characterSheetDraft = cloneCharacterSheetDraft(modalCharacterSheetDraft);
                knowledge.characterSheets = cloneCharacterSheetDraft(characterSheetDraft);
                if (result && result.draft) {
                  project = result.draft;
                  knowledge = mergeKnowledge(readKnowledge(result.draft), brand ? readKnowledge(brand) : null);
                  currentCharacters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);
                }
                renderCharacterManagerModal();
              })
              .catch(function () { });
          } catch (_) { }
          return;
        }
        if (action === 'character-sheet-delete') {
          var deleteToken = btn.dataset.characterToken;
          var deleteSheetId = btn.dataset.sheetId;
          updateModalCharacterSheetEntry(deleteToken, function (entry) {
            entry.items = normalizeCharacterSheetItems(entry.items).filter(function (sheet) {
              return String(sheet.sheetId) !== String(deleteSheetId);
            });
            return entry;
          });
          renderCharacterManagerModal();
          return;
        }
        if (action === 'character-manager-save') {
          if (modalSaveInFlight) return;
          modalSaveInFlight = true;
          if (NK.core && NK.core.setLoading) NK.core.setLoading(true, ipLibraryUiText.saveLoading);
          renderCharacterManagerModal();
          var brandCharsPatch = Array.isArray(modalBrandCharsDraft) ? modalBrandCharsDraft.map(function (c) {
            return Object.assign({}, c, { updatedAt: new Date().toISOString() });
          }) : null;
          Promise.resolve()
            .then(function () {
              if (brandCharsPatch && brandId && NK.service && NK.service.brand) {
                var saveFn = NK.service.brand.persistShared || function (bId, patch) { if (NK.service.brand.update) NK.service.brand.update(bId, patch); return Promise.resolve(null); };
                return Promise.resolve(saveFn(brandId, { brandCharacters: brandCharsPatch }));
              }
              return null;
            })
            .then(function (savedBrand) {
              // v3.1589: 저장은 됐는데 다시 열면 옛 값이 보이던 원인.
              // 모달은 열 때마다 `characters`(= brand.brandCharacters 스냅샷)에서 초안을 만드는데,
              // 저장 후 그 스냅샷을 갱신하지 않아 다음 열기에서 저장 전 상태를 다시 집어왔다.
              // 새로고침하면 멀쩡했던 것도 그때는 저장소에서 다시 읽었기 때문이다.
              applySavedBrandCharacters(savedBrand, brandCharsPatch);
            })
            .then(function () {
              return syncBrandAndProject(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, modalCharacterSheetDraft, environmentAssetDraft));
            })
            .then(function (result) {
              characterSheetDraft = cloneCharacterSheetDraft(modalCharacterSheetDraft);
              knowledge.characterSheets = cloneCharacterSheetDraft(characterSheetDraft);
              if (result && result.draft) {
                project = result.draft;
                knowledge = mergeKnowledge(readKnowledge(result.draft), brand ? readKnowledge(brand) : null);
                currentCharacters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);
                syncCharacterUi();
              }
            })
            .catch(function (err) {
              alert(ipLibraryUiText.saveFail + (err && err.message ? err.message : err));
            })
            .finally(function () {
              if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
              modalSaveInFlight = false;
              renderCharacterManagerModal();
            });
        }
      };

      box.onchange = function (evt) {
        var input = evt.target;
        if (!input || !input.matches || !input.matches('input[type="file"][data-action="character-sheet-upload"]')) return;
        var token = String(input.dataset.characterToken || '').trim();
        var files = Array.prototype.slice.call(input.files || []);
        if (!token || !files.length) return;
        var targetEntry = (sheetEntries || []).find(function (entry) {
          return String(entry && entry.token || '').trim().toLowerCase() === token.toLowerCase();
        }) || null;
        var existingCount = Array.isArray(targetEntry && targetEntry.items) ? targetEntry.items.length : 0;
        var remainingSlots = Math.max(0, MAX_CHARACTER_SHEETS_PER_CHARACTER - existingCount);
        if (!remainingSlots) {
          alert(ipLibraryUiText.uploadLimitReached);
          input.value = '';
          return;
        }
        var uploadFiles = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
          alert(ipLibraryUiText.uploadLimitPartial + String(remainingSlots) + ipLibraryUiText.uploadLimitPartialSuffix);
        }
        Promise.all(uploadFiles.map(function (file, index) {
          return readFileAsDataUrl(file).then(function (dataUrl) {
            return {
              sheetId: 'sheet_' + Date.now() + '_' + index,
              imageDataUrl: dataUrl,
              isPrimary: false
            };
          });
        }))
          .then(function (items) {
            updateModalCharacterSheetEntry(token, function (entry) {
              var existingItems = normalizeCharacterSheetItems(entry.items);
              entry.items = existingItems.concat(items.map(function (sheet, index) {
                return Object.assign({}, sheet, {
                  isPrimary: !existingItems.length && index === 0
                });
              }));
              return entry;
            });
            renderCharacterManagerModal();
          })
          .catch(function (err) {
            alert(ipLibraryUiText.uploadFail + (err && err.message ? err.message : err));
          })
          .finally(function () {
            input.value = '';
          });
      };

      modal.onclick = function (evt) {
        if (modalSaveInFlight) return;
        if (evt.target === modal) closeCharacterManagerModal();
        var closeBtn = evt.target && evt.target.closest ? evt.target.closest('[data-close="character-manager-modal"]') : null;
        if (closeBtn) closeCharacterManagerModal();
      };

      modal.classList.remove('hidden');
    }

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      var target = '';
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action === 'knowledge-open-library') target = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'knowledge-open-brand') target = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'knowledge-open-ip-library') {
        if (!modalBrandCharsDraft) {
          modalBrandCharsDraft = JSON.parse(JSON.stringify(Array.isArray(characters) ? characters : []));
        }
        renderCharacterManagerModal();
        return;
      }
      else if (action === 'knowledge-open-environment-library') {
        modalEnvDraft = cloneEnvironmentDraft(environmentAssetDraft);
        renderEnvironmentManagerModal();
        return;
      }
      else if (action === 'knowledge-apply-starter') {
        btn.disabled = true;
        syncBrandAndProject(buildStarterKnowledge(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft), project, brandTitle, brandSummary))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('기본값 채우기 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      else if (action === 'knowledge-save-and-open-brand') {
        btn.disabled = true;
        if (NK.core && NK.core.setLoading) NK.core.setLoading(true, '저장중...');
        syncBrandAndProject(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            var nextTarget = buildStageUrl('brand.html', projectId, brandId);
            if (window.self !== window.top && window.parent) {
              window.parent.postMessage({ type: 'load-stage', url: nextTarget }, '*');
            } else {
              window.location.href = nextTarget;
            }
          })
          .catch(function (err) {
            alert('저장 후 이동 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
            btn.disabled = false;
          });
        return;
      }
      // 캐릭터 카드 제거에 따라 비활성화 토글 버튼도 제거됨
      else if (action === 'knowledge-save') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextKnowledge = readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft);
        btn.disabled = true;
        if (NK.core && NK.core.setLoading) NK.core.setLoading(true, '저장중...');
        syncBrandAndProject(nextKnowledge)
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('브랜드 허브를 저장했습니다.');
          })
          .catch(function (err) {
            alert('브랜드 허브 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
            btn.disabled = false;
          });
        return;
      }
      if (action === 'knowledge-add-reference') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextItems = buildReferenceDraft(root, knowledge);
        if (!nextItems) {
          alert('참조 제목, 출처, 메모 중 하나는 입력해 주세요.');
          return;
        }
        btn.disabled = true;
        syncBrandAndProject(readKnowledgeDraft(root, nextItems, currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('참조 콘텐츠 추가 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'knowledge-remove-reference') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var removeId = String(btn.dataset.referenceId || '').trim();
        var remaining = (knowledge.referenceItems || []).filter(function (item) {
          return String(item.id || '') !== removeId;
        });
        btn.disabled = true;
        syncBrandAndProject(readKnowledgeDraft(root, remaining, currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('참조 콘텐츠 삭제 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'knowledge-remove-character') {
        var removeToken = String(btn.dataset.characterToken || '').trim().toLowerCase();
        if (!removeToken) return;
        currentCharacters = currentCharacters.filter(function (item) {
          return String(item.token || '').trim().toLowerCase() !== removeToken;
        });
        characterSheetDraft = normalizeCharacterSheets(characterSheetDraft.filter(function (entry) {
          return String(entry.token || '').trim().toLowerCase() !== removeToken;
        }), currentCharacters);
        syncCharacterUi();
        return;
      }
      if (action === 'knowledge-environment-remove') {
        var envRemoveId = String(btn.dataset.assetId || '').trim();
        if (!envRemoveId) return;
        environmentAssetDraft = normalizeEnvironmentAssets(environmentAssetDraft.filter(function (asset) {
          return String(asset.assetId || '') !== envRemoveId;
        }));
        syncEnvironmentUi();
        persistEnvironmentDraft();
        return;
      }

      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };

    // 입력값으로 캐릭터를 추가한다.
    // addCharacter가 currentCharacters + 칩 UI를 즉시 갱신(낙관적)하고, 저장 버튼과 동일한
    // syncBrandAndProject(knowledgeCharacters) 경로로 배경 영속화한다. 재렌더(renderNext)는
    // 하지 않는다 — 과거엔 별개 필드(brandCharacters)만 갱신 후 renderNext로 전체 재렌더해
    // knowledge.characters 기준으로 다시 그릴 때 방금 추가한 칩이 사라지는 버그가 있었다.
    function commitCharacterInput(targetEl) {
      if (!targetEl) return;
      var raw = String(targetEl.value || '');
      if (!addCharacter(raw)) return; // 빈 값/중복이면 false → 무해한 no-op
      targetEl.value = '';
      if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
      syncBrandAndProject(
        readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras, characterSheetDraft, environmentAssetDraft)
      ).catch(function () {});
    }

    // 배경·소품 이름을 추가한다(캐릭터 입력과 동일한 낙관적 갱신 + 영속화 패턴).
    function commitEnvironmentInput(targetEl) {
      if (!targetEl) return;
      var raw = String(targetEl.value || '');
      if (!addEnvironmentAsset(raw)) return;
      targetEl.value = '';
      persistEnvironmentDraft();
    }

    function isEnterKey(evt) {
      return evt.key === 'Enter' || evt.keyCode === 13;
    }

    // 한글 등 IME 조합 중 Enter는 '조합 확정'에 소비되어 keydown에서 key가 'Enter'가 아니라
    // 'Process'(keyCode 229)로 들어온다. 그래서 keydown만으로는 단일 Enter가 먹지 않는다.
    // 비조합 상태면 keydown에서, 조합 확정 직후엔 keyup에서 처리해 단일 Enter로 동작시킨다.
    // (입력값이 비워지거나 동일 캐릭터면 addCharacter가 false라 중복 호출은 무해)
    root.onkeydown = function (evt) {
      var targetEl = evt.target;
      if (!targetEl) return;
      if (evt.isComposing || evt.keyCode === 229 || !isEnterKey(evt)) return;
      if (targetEl.id === 'knowledge-character-input') {
        evt.preventDefault();
        commitCharacterInput(targetEl);
      } else if (targetEl.id === 'knowledge-environment-input') {
        evt.preventDefault();
        commitEnvironmentInput(targetEl);
      }
    };

    root.onkeyup = function (evt) {
      var targetEl = evt.target;
      if (!targetEl) return;
      if (evt.isComposing || evt.keyCode === 229 || !isEnterKey(evt)) return;
      if (targetEl.id === 'knowledge-character-input') {
        commitCharacterInput(targetEl);
      } else if (targetEl.id === 'knowledge-environment-input') {
        commitEnvironmentInput(targetEl);
      }
    };

    root.oninput = function (evt) {
      var targetEl = evt.target;
      if (!targetEl || !targetEl.matches) return;
      if (targetEl.matches('[data-character-personality]')) {
        var characterId = String(targetEl.getAttribute('data-character-personality') || '').trim();
        currentCharacters = normalizeCharacters(currentCharacters).map(function (item) {
          if (String(item.characterId) !== characterId) return item;
          return Object.assign({}, item, {
            personality: normalizeCharacterPersonality(targetEl.value || '')
          });
        });
        return;
      }
      // 배경·소품 설명(캐릭터 성격과 동일한 인라인 텍스트). 타이핑 중에는 draft 메모리만 갱신.
      if (targetEl.matches('[data-environment-description]')) {
        var assetId = String(targetEl.getAttribute('data-environment-description') || '').trim();
        var val = String(targetEl.value || '');
        environmentAssetDraft = (Array.isArray(environmentAssetDraft) ? environmentAssetDraft : []).map(function (asset) {
          if (String(asset.assetId || '') !== assetId) return asset;
          return Object.assign({}, asset, { description: val });
        });
        return;
      }
    };

    // 배경·소품 설명 입력에서 포커스가 빠질 때 영속화 (캐릭터처럼 별도 저장 버튼 없이 반영).
    root.onchange = function (evt) {
      var targetEl = evt.target;
      if (!targetEl || !targetEl.matches || !targetEl.matches('[data-environment-description]')) return;
      persistEnvironmentDraft();
    };

    bindDisclosureScroll(root);
  }

  knowledgeHub.init = function () {
    var root = document.getElementById('knowledge-hub-root');
    if (!root) return;
    if (!NK.service || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, '브랜드 허브를 불러올 수 없습니다.');
      return;
    }
    var context = NK.service.brand.getDisplayContext
      ? NK.service.brand.getDisplayContext({ search: window.location.search })
      : { brand: null, project: NK.service.project.resolveCurrent({ search: window.location.search }) };
    var project = context && context.project ? context.project : NK.service.project.resolveCurrent({ search: window.location.search });
    var brand = context && context.brand ? context.brand : null;
    if (!project || !project.id) {
      renderEmpty(root, '먼저 프로젝트를 선택해 주세요.');
      return;
    }
    renderProject(root, project, brand);
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    if (brandId && NK.service.brand.hydrateFromServer) {
      NK.service.brand.hydrateFromServer(brandId, { force: true, ttlMs: 0 })
        .then(function (nextBrand) {
          if (!nextBrand || !root.isConnected) return;
          renderProject(root, project, nextBrand);
        })
        .catch(function () {});
    }
  };
})();
