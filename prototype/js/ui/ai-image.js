;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiAiImage || (NK.uiAiImage = {});

  var STORAGE_SESSION_KEY = 'nk_ai_image_session_id';
  var STORAGE_HISTORY_PREFIX = 'nk_ai_image_history_';
  var state = {
    lang: 'ko',
    sessionId: '',
    mode: 'text-to-image',
    prompt: '',
    aspectRatio: '1:1',
    sourceImage: null,
    projectLibraryItems: [],
    brandLibraryItems: [],
    currentProject: null,
    currentBrand: null,
    currentResultId: '',
    results: [],
    libraryLoading: false,
    brandLibraryLoading: false
  };

  var TEXT = {
    ko: {
      pageTitle: 'NK_Studio · AI 이미지',
      brandSubtitle: 'AI 이미지 생성 플랫폼',
      navAiVideo: 'AI Video',
      navAiImage: 'AI Image',
      navLibrary: '콘텐츠 저장소',
      heroTitle: 'AI 이미지 생성기',
      heroDesc: '텍스트 생성과 참조 기반 변형을 하나의 작업실에서 처리합니다.',
      sessionLabel: '세션',
      projectLabel: '현재 프로젝트',
      brandLabel: '현재 브랜드',
      noProject: '선택된 프로젝트 없음',
      noBrand: '선택된 브랜드 없음',
      noProjectHelp: '프로젝트를 선택하면 저장소에서 소스를 불러오고 결과를 등록할 수 있습니다.',
      modeText: '텍스트를 이미지로',
      modeImage: '이미지를 이미지로',
      sourceTitle: '소스 이미지',
      sourceEmpty: '이미지 to 이미지 모드에서는 소스 이미지를 선택해야 합니다.',
      sourceUpload: '이미지 업로드',
      sourceProject: '프로젝트 저장소 불러오기',
      sourceBrand: '브랜드 IP 불러오기',
      sourceClear: '소스 비우기',
      sourceProjectEmpty: '현재 프로젝트 저장소에 이미지가 없습니다.',
      sourceProjectLoading: '프로젝트 저장소 불러오는 중...',
      sourceBrandEmpty: '현재 브랜드 IP 라이브러리에 이미지가 없습니다.',
      sourceBrandLoading: '브랜드 IP 라이브러리 불러오는 중...',
      sourceSelected: '선택된 소스',
      sourceLibraryTitle: '프로젝트 저장소 이미지',
      sourceBrandTitle: '브랜드 IP 이미지',
      promptLabel: '프롬프트',
      promptPlaceholderText: '원하는 이미지의 장면, 스타일, 색감, 구도, 재질감을 설명해 주세요.',
      promptPlaceholderImage: '소스 이미지를 어떻게 바꾸거나 유지할지 설명해 주세요. 예: 같은 구도는 유지하고 수채화 질감으로 바꾸기',
      aspectLabel: '비율',
      generate: '생성',
      generating: '생성 중...',
      resultsTitle: '결과',
      resultsEmpty: '아직 생성된 이미지가 없습니다.',
      download: '다운로드',
      saveProject: '프로젝트 저장소에 등록',
      savedProject: '프로젝트 저장소 등록 완료',
      saveDisabled: '프로젝트가 선택되지 않아 등록할 수 없습니다.',
      openVideo: 'AI Video로 이동',
      loginRequired: '로그인이 필요합니다.',
      loginAction: '로그인 하기',
      useInProject: '현재 프로젝트에서 소스로 사용 가능',
      createdAt: '생성 시각',
      modeTextShort: '텍스트',
      modeImageShort: '이미지',
      promptRequired: '프롬프트를 입력해 주세요.',
      sourceRequired: '소스 이미지를 먼저 선택해 주세요.',
      generationFailed: '이미지 생성 실패: ',
      projectLoadFailed: '프로젝트 저장소 불러오기 실패: ',
      brandLoadFailed: '브랜드 IP 불러오기 실패: ',
      projectSaveFailed: '프로젝트 저장소 등록 실패: ',
      downloadFailed: '다운로드 실패: ',
      fileChoose: '파일 선택',
      latestResult: '대표 미리보기',
      historyTitle: '생성 히스토리',
      resultSavedTag: '프로젝트 저장 완료',
      promptCounterSuffix: '/4000',
      backToLogin: '로그인 페이지로 이동',
      sourceKindUpload: '업로드',
      sourceKindProject: '프로젝트 저장소',
      sourceKindBrand: '브랜드 IP'
    },
    en: {
      pageTitle: 'NK_Studio · AI Image',
      brandSubtitle: 'AI image generation platform',
      navAiVideo: 'AI Video',
      navAiImage: 'AI Image',
      navLibrary: 'Content Library',
      heroTitle: 'AI Image Generator',
      heroDesc: 'Handle text generation and reference-based variation in one workspace.',
      sessionLabel: 'Session',
      projectLabel: 'Current project',
      brandLabel: 'Current brand',
      noProject: 'No project selected',
      noBrand: 'No brand selected',
      noProjectHelp: 'Select a project to load source images from its library and save results back.',
      modeText: 'Text to image',
      modeImage: 'Image to image',
      sourceTitle: 'Source image',
      sourceEmpty: 'Image-to-image mode requires a source image.',
      sourceUpload: 'Upload image',
      sourceProject: 'Load from project library',
      sourceBrand: 'Load from brand IP',
      sourceClear: 'Clear source',
      sourceProjectEmpty: 'No images found in the current project library.',
      sourceProjectLoading: 'Loading project library...',
      sourceBrandEmpty: 'No images found in the current brand IP library.',
      sourceBrandLoading: 'Loading brand IP library...',
      sourceSelected: 'Selected source',
      sourceLibraryTitle: 'Project library images',
      sourceBrandTitle: 'Brand IP images',
      promptLabel: 'Prompt',
      promptPlaceholderText: 'Describe the scene, style, lighting, composition, and textures you want.',
      promptPlaceholderImage: 'Describe what to preserve or transform from the source image. Example: keep the same composition and convert it into watercolor.',
      aspectLabel: 'Aspect ratio',
      generate: 'Generate',
      generating: 'Generating...',
      resultsTitle: 'Results',
      resultsEmpty: 'No generated images yet.',
      download: 'Download',
      saveProject: 'Save to project library',
      savedProject: 'Saved to project library',
      saveDisabled: 'A selected project is required to save this result.',
      openVideo: 'Open AI Video',
      loginRequired: 'Sign-in is required.',
      loginAction: 'Sign in',
      useInProject: 'Available as a source for the current project',
      createdAt: 'Created',
      modeTextShort: 'Text',
      modeImageShort: 'Image',
      promptRequired: 'Enter a prompt first.',
      sourceRequired: 'Select a source image first.',
      generationFailed: 'Image generation failed: ',
      projectLoadFailed: 'Failed to load project library: ',
      brandLoadFailed: 'Failed to load brand IP library: ',
      projectSaveFailed: 'Failed to save to project library: ',
      downloadFailed: 'Download failed: ',
      fileChoose: 'Choose file',
      latestResult: 'Primary preview',
      historyTitle: 'Generation history',
      resultSavedTag: 'Saved to project',
      promptCounterSuffix: '/4000',
      backToLogin: 'Go to sign-in page',
      sourceKindUpload: 'Upload',
      sourceKindProject: 'Project library',
      sourceKindBrand: 'Brand IP'
    }
  };

  function t(key) {
    var lang = state.lang === 'en' ? 'en' : 'ko';
    return (TEXT[lang] && TEXT[lang][key]) || key;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      return state.lang === 'en'
        ? d.toLocaleString('en-US')
        : d.toLocaleString('ko-KR');
    } catch (_) {
      return raw;
    }
  }

  function readTheme() {
    try {
      return localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.THEME) || 'nk_theme') || 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function readThemeVariant(theme) {
    try {
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.THEME_VARIANT) || 'nk_theme_variant';
      var fallback = theme === 'light' ? 'light-classic' : 'dark-classic';
      var value = String(localStorage.getItem(key) || '').trim();
      return value && value.indexOf(theme + '-') === 0 ? value : fallback;
    } catch (_) {
      return theme === 'light' ? 'light-classic' : 'dark-classic';
    }
  }

  function readLang() {
    try {
      var value = localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang') || 'ko';
      return value === 'en' ? 'en' : 'ko';
    } catch (_) {
      return 'ko';
    }
  }

  function ensureSessionId() {
    try {
      var current = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (current) return current;
      var next = 'img_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) {
      return 'img_' + Date.now();
    }
  }

  function getHistoryStorageKey() {
    return STORAGE_HISTORY_PREFIX + String(state.sessionId || 'default');
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(getHistoryStorageKey()) || '[]';
      var parsed = JSON.parse(raw);
      state.results = Array.isArray(parsed) ? parsed : [];
      state.currentResultId = state.results[0] ? String(state.results[0].id || '') : '';
    } catch (_) {
      state.results = [];
      state.currentResultId = '';
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(getHistoryStorageKey(), JSON.stringify(state.results.slice(0, 30)));
    } catch (_) { }
  }

  function readCurrentProject() {
    try {
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) {
      return null;
    }
  }

  function readCurrentBrand() {
    try {
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) {
      return null;
    }
  }

  function currentResult() {
    var match = state.results.find(function (item) {
      return String(item && item.id || '') === String(state.currentResultId || '');
    });
    return match || state.results[0] || null;
  }

  function resolveResultUrl(result) {
    var row = result && typeof result === 'object' ? result : {};
    var objectName = String(row.objectName || '').trim();
    if (objectName && NK.api && NK.api.mediaProxyObjectUrl) {
      return NK.api.mediaProxyObjectUrl(objectName);
    }
    return String(row.url || '').trim();
  }

  function sourcePreviewUrl() {
    return state.sourceImage ? String(state.sourceImage.url || '').trim() : '';
  }

  function resolveLibraryItemUrl(item) {
    var row = item && typeof item === 'object' ? item : {};
    return String(
      row.signedUrl
      || ((NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(row.name) : '')
      || ''
    ).trim();
  }

  function isImageLibraryItem(item) {
    var row = item && typeof item === 'object' ? item : {};
    var name = String(row.name || '').trim().toLowerCase();
    var type = String(row.contentType || '').trim().toLowerCase();
    if (type.indexOf('image/') === 0) return true;
    return /\.(png|jpg|jpeg|webp)$/i.test(name);
  }

  function updateDocumentCopy() {
    document.title = t('pageTitle');
    var subtitle = document.querySelector('[data-ai-image-subtitle]');
    if (subtitle) subtitle.textContent = t('brandSubtitle');
    var videoLink = document.querySelector('[data-ai-image-nav="video"]');
    if (videoLink) videoLink.textContent = t('navAiVideo');
    var imageLink = document.querySelector('[data-ai-image-nav="image"]');
    if (imageLink) imageLink.textContent = t('navAiImage');
    var libraryLink = document.querySelector('[data-ai-image-nav="library"]');
    if (libraryLink) libraryLink.textContent = t('navLibrary');
    var authTitle = document.querySelector('[data-ai-image-auth-title]');
    if (authTitle) authTitle.textContent = t('loginRequired');
    var authLink = document.querySelector('[data-ai-image-auth-link]');
    if (authLink) authLink.textContent = t('loginAction');
  }

  function updateThemeAndLangButtons() {
    try {
      if (NK.state && NK.state.set) NK.state.set({ lang: state.lang });
    } catch (_) { }
    if (NK.ui && NK.ui.common && NK.ui.common.updateThemeButton) {
      NK.ui.common.updateThemeButton(readTheme(), state.lang);
    }
    if (NK.ui && NK.ui.common && NK.ui.common.updateScreenButton) {
      NK.ui.common.updateScreenButton(state.lang);
    }
    var langBtn = document.querySelector('[data-ai-image-lang-toggle]');
    if (langBtn) {
      var next = state.lang === 'en' ? 'KO' : 'EN';
      langBtn.textContent = next;
      langBtn.setAttribute('aria-label', state.lang === 'en' ? 'Switch to Korean' : 'Switch to English');
      langBtn.setAttribute('title', state.lang === 'en' ? 'Switch to Korean' : 'Switch to English');
    }
  }

  function setGlobalLoading(show, message) {
    if (NK.core && NK.core.setLoading) {
      NK.core.setLoading(!!show, message || '로딩중...');
      return;
    }
    var overlay = document.getElementById('page-loading');
    var main = document.querySelector('.main');
    if (overlay) overlay.classList.toggle('hidden', !show);
    if (main) main.classList.toggle('loading-blur', !!show);
  }

  function render() {
    var root = document.getElementById('ai-image-root');
    if (!root) return;
    var project = state.currentProject;
    var brand = state.currentBrand;
    var selectedResult = currentResult();
    var sourceUrl = sourcePreviewUrl();
    var sourceKind = '';
    if (state.sourceImage) {
      if (state.sourceImage.kind === 'project') sourceKind = t('sourceKindProject');
      else if (state.sourceImage.kind === 'brand') sourceKind = t('sourceKindBrand');
      else sourceKind = t('sourceKindUpload');
    }
    var resultCards = state.results.map(function (item) {
      var active = String(item.id || '') === String(state.currentResultId || '');
      return '' +
        '<button type="button" class="ai-image-history-card' + (active ? ' active' : '') + '" data-action="select-result" data-id="' + escapeHtml(item.id) + '">' +
        '<img src="' + escapeHtml(resolveResultUrl(item)) + '" alt="" class="ai-image-history-thumb" />' +
        '<div class="ai-image-history-meta">' +
        '<strong>' + escapeHtml(item.mode === 'image-to-image' ? t('modeImageShort') : t('modeTextShort')) + '</strong>' +
        '<p>' + escapeHtml(item.prompt || '') + '</p>' +
        (item.savedToProject ? '<span class="ai-image-saved-chip">' + escapeHtml(t('resultSavedTag')) + '</span>' : '') +
        '</div>' +
        '</button>';
    }).join('');

    var sourceLibrary = state.projectLibraryItems.map(function (item, index) {
      var thumb = resolveLibraryItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card" data-action="select-project-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');
    var brandSourceLibrary = state.brandLibraryItems.map(function (item, index) {
      var thumb = resolveLibraryItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card" data-action="select-brand-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');

    root.innerHTML = '' +
      '<section class="ai-image-shell">' +
      '<div class="ai-image-header">' +
      '<div>' +
      '<h1>' + escapeHtml(t('heroTitle')) + '</h1>' +
      '<p>' + escapeHtml(t('heroDesc')) + '</p>' +
      '</div>' +
      '<div class="ai-image-status-pills">' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('sessionLabel')) + '</em><strong>' + escapeHtml(state.sessionId) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('projectLabel')) + '</em><strong>' + escapeHtml(project && project.title ? project.title : t('noProject')) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('brandLabel')) + '</em><strong>' + escapeHtml(brand && brand.brandTitle ? brand.brandTitle : t('noBrand')) + '</strong></span>' +
      '</div>' +
      '</div>' +
      '<div class="ai-image-workspace">' +
      '<section class="card ai-image-panel ai-image-panel-left">' +
      '<div class="ai-image-mode-tabs">' +
      '<button type="button" class="btn-secondary' + (state.mode === 'text-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="text-to-image">' + escapeHtml(t('modeText')) + '</button>' +
      '<button type="button" class="btn-secondary' + (state.mode === 'image-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="image-to-image">' + escapeHtml(t('modeImage')) + '</button>' +
      '</div>' +
      '<div class="ai-image-field">' +
      '<label>' + escapeHtml(t('sourceTitle')) + '</label>' +
      '<div class="ai-image-source-box' + (state.mode !== 'image-to-image' ? ' is-disabled' : '') + '">' +
      (state.mode === 'image-to-image'
        ? (sourceUrl
          ? '<div class="ai-image-source-preview"><img src="' + escapeHtml(sourceUrl) + '" alt="" /><div><strong>' + escapeHtml(t('sourceSelected')) + '</strong><p>' + escapeHtml(sourceKind) + '</p></div></div>'
          : '<p class="muted">' + escapeHtml(t('sourceEmpty')) + '</p>')
        : '<p class="muted">' + escapeHtml(t('useInProject')) + '</p>') +
      '<div class="ai-image-inline-actions">' +
      '<button type="button" class="btn-secondary compact" data-action="open-upload"' + (state.mode === 'image-to-image' ? '' : ' disabled') + '>' + escapeHtml(t('sourceUpload')) + '</button>' +
      '<button type="button" class="btn-secondary compact" data-action="load-project-library"' + ((state.mode === 'image-to-image' && project && project.id) ? '' : ' disabled') + '>' + escapeHtml(t('sourceProject')) + '</button>' +
      '<button type="button" class="btn-secondary compact" data-action="load-brand-library"' + ((state.mode === 'image-to-image' && brand && brand.brandId) ? '' : ' disabled') + '>' + escapeHtml(t('sourceBrand')) + '</button>' +
      '<button type="button" class="btn-ghost compact" data-action="clear-source"' + (sourceUrl ? '' : ' disabled') + '>' + escapeHtml(t('sourceClear')) + '</button>' +
      '</div>' +
      '<input type="file" id="ai-image-source-file" class="hidden" accept="image/*" />' +
      '</div>' +
      ((state.mode === 'image-to-image' && state.projectLibraryItems.length)
        ? '<div class="ai-image-source-library"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceLibraryTitle')) + '</div><div class="ai-image-source-grid">' + sourceLibrary + '</div></div>'
        : '') +
      ((state.mode === 'image-to-image' && state.brandLibraryItems.length)
        ? '<div class="ai-image-source-library"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceBrandTitle')) + '</div><div class="ai-image-source-grid">' + brandSourceLibrary + '</div></div>'
        : '') +
      ((state.mode === 'image-to-image' && state.libraryLoading)
        ? '<p class="muted small">' + escapeHtml(t('sourceProjectLoading')) + '</p>'
        : '') +
      ((state.mode === 'image-to-image' && state.brandLibraryLoading)
        ? '<p class="muted small">' + escapeHtml(t('sourceBrandLoading')) + '</p>'
        : '') +
      '</div>' +
      '<div class="ai-image-field">' +
      '<label for="ai-image-prompt">' + escapeHtml(t('promptLabel')) + '</label>' +
      '<textarea id="ai-image-prompt" rows="8" maxlength="4000" placeholder="' + escapeHtml(state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText')) + '"></textarea>' +
      '<div class="ai-image-counter"><span id="ai-image-prompt-count">' + escapeHtml(String((state.prompt || '').length) + t('promptCounterSuffix')) + '</span></div>' +
      '</div>' +
      '<div class="ai-image-field">' +
      '<label for="ai-image-aspect">' + escapeHtml(t('aspectLabel')) + '</label>' +
      '<select id="ai-image-aspect">' +
      '<option value="1:1"' + (state.aspectRatio === '1:1' ? ' selected' : '') + '>1:1</option>' +
      '<option value="16:9"' + (state.aspectRatio === '16:9' ? ' selected' : '') + '>16:9</option>' +
      '<option value="9:16"' + (state.aspectRatio === '9:16' ? ' selected' : '') + '>9:16</option>' +
      '</select>' +
      '</div>' +
      '<div class="ai-image-action-row">' +
      '<button type="button" class="btn-primary" data-action="generate-image">' + escapeHtml(t('generate')) + '</button>' +
      '</div>' +
      (!project || !project.id ? '<p class="muted small">' + escapeHtml(t('noProjectHelp')) + '</p>' : '') +
      '</section>' +
      '<section class="card ai-image-panel ai-image-panel-right">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('latestResult')) + '</h2><p class="muted">' + escapeHtml(t('resultsTitle')) + '</p></div>' +
      '<div class="ai-image-inline-actions">' +
      '<a class="btn-secondary compact" href="ai-video.html">' + escapeHtml(t('openVideo')) + '</a>' +
      '</div>' +
      '</div>' +
      (selectedResult
        ? '<div class="ai-image-preview-stage">' +
          '<img src="' + escapeHtml(resolveResultUrl(selectedResult)) + '" alt="" class="ai-image-preview-image" />' +
          '<div class="ai-image-preview-meta">' +
          '<p><strong>' + escapeHtml(t('createdAt')) + ':</strong> ' + escapeHtml(formatDate(selectedResult.createdAt)) + '</p>' +
          '<p>' + escapeHtml(selectedResult.prompt || '') + '</p>' +
          '</div>' +
          '<div class="ai-image-inline-actions">' +
          '<button type="button" class="btn-secondary compact" data-action="download-result" data-id="' + escapeHtml(selectedResult.id) + '">' + escapeHtml(t('download')) + '</button>' +
          '<button type="button" class="btn-primary compact" data-action="save-result-project" data-id="' + escapeHtml(selectedResult.id) + '"' + ((project && project.id) ? '' : ' disabled') + '>' + escapeHtml(t('saveProject')) + '</button>' +
          '</div>' +
          '</div>'
        : '<div class="ai-image-empty-state"><p>' + escapeHtml(t('resultsEmpty')) + '</p></div>') +
      '<div class="ai-image-history">' +
      '<div class="ai-image-source-library-title">' + escapeHtml(t('historyTitle')) + '</div>' +
      (resultCards ? '<div class="ai-image-history-list">' + resultCards + '</div>' : '<p class="muted small">' + escapeHtml(t('resultsEmpty')) + '</p>') +
      '</div>' +
      '</section>' +
      '</div>' +
      '</section>';

    var promptEl = document.getElementById('ai-image-prompt');
    if (promptEl) {
      promptEl.value = state.prompt || '';
      promptEl.oninput = function () {
        state.prompt = String(promptEl.value || '');
        var counter = document.getElementById('ai-image-prompt-count');
        if (counter) counter.textContent = String(state.prompt.length) + t('promptCounterSuffix');
      };
    }
    var aspectEl = document.getElementById('ai-image-aspect');
    if (aspectEl) {
      aspectEl.onchange = function () {
        state.aspectRatio = String(aspectEl.value || '1:1');
      };
    }
    var fileInput = document.getElementById('ai-image-source-file');
    if (fileInput) {
      fileInput.onchange = function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          state.sourceImage = {
            url: String(reader.result || ''),
            name: file.name || 'upload',
            kind: 'upload'
          };
          render();
        };
        reader.readAsDataURL(file);
      };
    }
  }

  function toDownloadName(result) {
    return 'ai-image-' + String(result && result.id || Date.now()) + '.png';
  }

  async function downloadResult(result) {
    try {
      var targetUrl = resolveResultUrl(result);
      if (!result || !targetUrl) return;
      var response = await fetch(targetUrl);
      var blob = await response.blob();
      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = toDownloadName(result);
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 100);
    } catch (err) {
      alert(t('downloadFailed') + (err && err.message ? err.message : err));
    }
  }

  async function resultToFile(result) {
    var url = resolveResultUrl(result);
    if (!url) throw new Error('result_url_missing');
    if (url.indexOf('data:') === 0) {
      var arr = url.split(',');
      var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
      var bstr = atob(arr[1] || '');
      var n = bstr.length;
      var u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      return new File([u8], toDownloadName(result), { type: mime });
    }
    var response = await fetch(url);
    if (!response.ok) throw new Error('result_fetch_failed');
    var blob = await response.blob();
    return new File([blob], toDownloadName(result), { type: blob.type || 'image/png' });
  }

  async function loadProjectLibrary() {
    if (!state.currentProject || !state.currentProject.id) return;
    state.libraryLoading = true;
    render();
    try {
      var res = await NK.api.library('image', state.currentProject.id);
      state.projectLibraryItems = (Array.isArray(res && res.items) ? res.items : []).filter(isImageLibraryItem);
      if (!state.projectLibraryItems.length) {
        alert(t('sourceProjectEmpty'));
      }
    } catch (err) {
      alert(t('projectLoadFailed') + (err && err.message ? err.message : err));
    } finally {
      state.libraryLoading = false;
      render();
    }
  }

  async function loadBrandLibrary() {
    if (!state.currentBrand || !state.currentBrand.brandId) return;
    state.brandLibraryLoading = true;
    render();
    try {
      var res = await NK.api.libraryIP('', { brandId: state.currentBrand.brandId });
      state.brandLibraryItems = (Array.isArray(res && res.items) ? res.items : []).filter(isImageLibraryItem);
      if (!state.brandLibraryItems.length) {
        alert(t('sourceBrandEmpty'));
      }
    } catch (err) {
      alert(t('brandLoadFailed') + (err && err.message ? err.message : err));
    } finally {
      state.brandLibraryLoading = false;
      render();
    }
  }

  async function saveResultToProject(resultId) {
    if (!state.currentProject || !state.currentProject.id) {
      alert(t('saveDisabled'));
      return;
    }
    var result = state.results.find(function (item) {
      return String(item && item.id || '') === String(resultId || '');
    });
    if (!result) return;
    setGlobalLoading(true, t('saveProject'));
    try {
      var file = await resultToFile(result);
      await NK.api.imageUpload(state.currentProject.id, file);
      result.savedToProject = true;
      persistHistory();
      render();
      alert(t('savedProject'));
    } catch (err) {
      alert(t('projectSaveFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function generateImage() {
    var prompt = String(state.prompt || '').trim();
    if (!prompt) {
      alert(t('promptRequired'));
      return;
    }
    if (state.mode === 'image-to-image' && !state.sourceImage) {
      alert(t('sourceRequired'));
      return;
    }

    var payload = {
      prompt: prompt,
      aspectRatio: state.aspectRatio,
      storageService: 'ai-image',
      sessionId: state.sessionId,
      generationMode: state.mode,
      referenceImages: state.mode === 'image-to-image' && state.sourceImage
        ? [{
          referenceId: 1,
          imageDataUrl: state.sourceImage.url,
          subjectDescription: 'source image',
          subjectType: 'SUBJECT_TYPE_DEFAULT'
        }]
        : []
    };

    setGlobalLoading(true, t('generating'));
    try {
      var response = await NK.api.imagen(payload);
      var result = {
        id: 'res_' + Date.now(),
        url: String(response && (response.signedUrl || response.dataUrl) || '').trim(),
        objectName: String(response && response.objectName || '').trim(),
        prompt: prompt,
        mode: state.mode,
        aspectRatio: state.aspectRatio,
        createdAt: new Date().toISOString(),
        savedToProject: false,
        sessionId: state.sessionId
      };
      if (!result.url) throw new Error('image_result_missing');
      state.results.unshift(result);
      state.results = state.results.slice(0, 30);
      state.currentResultId = result.id;
      persistHistory();
      render();
    } catch (err) {
      alert(t('generationFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  function bindStaticEvents() {
    var root = document.getElementById('ai-image-root');
    if (root && !root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', function (evt) {
        var btn = evt.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-action') || '';
        if (action === 'set-mode') {
          state.mode = String(btn.getAttribute('data-mode') || 'text-to-image');
          if (state.mode === 'text-to-image') {
            state.projectLibraryItems = [];
            state.brandLibraryItems = [];
          }
          render();
          return;
        }
        if (action === 'open-upload') {
          var input = document.getElementById('ai-image-source-file');
          if (input) input.click();
          return;
        }
        if (action === 'clear-source') {
          state.sourceImage = null;
          render();
          return;
        }
        if (action === 'load-project-library') {
          loadProjectLibrary();
          return;
        }
        if (action === 'load-brand-library') {
          loadBrandLibrary();
          return;
        }
        if (action === 'select-project-source') {
          var idx = Number(btn.getAttribute('data-index') || -1);
          var item = idx >= 0 ? state.projectLibraryItems[idx] : null;
          if (!item) return;
          state.sourceImage = {
            url: resolveLibraryItemUrl(item),
            name: String(item.name || '').trim(),
            kind: 'project'
          };
          render();
          return;
        }
        if (action === 'select-brand-source') {
          var brandIdx = Number(btn.getAttribute('data-index') || -1);
          var brandItem = brandIdx >= 0 ? state.brandLibraryItems[brandIdx] : null;
          if (!brandItem) return;
          state.sourceImage = {
            url: resolveLibraryItemUrl(brandItem),
            name: String(brandItem.name || '').trim(),
            kind: 'brand'
          };
          render();
          return;
        }
        if (action === 'generate-image') {
          generateImage();
          return;
        }
        if (action === 'select-result') {
          state.currentResultId = String(btn.getAttribute('data-id') || '');
          render();
          return;
        }
        if (action === 'download-result') {
          var result = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          downloadResult(result);
          return;
        }
        if (action === 'save-result-project') {
          saveResultToProject(btn.getAttribute('data-id') || '');
        }
      });
    }

    var themeBtn = document.querySelector('[data-theme-toggle]');
    if (themeBtn && !themeBtn.dataset.bound) {
      themeBtn.dataset.bound = '1';
      themeBtn.addEventListener('click', function () {
        var current = readTheme();
        var next = current === 'light' ? 'dark' : 'light';
        var nextVariant = next === 'light' ? 'light-classic' : 'dark-classic';
        NK.ui.common.applyTheme(next, { variant: nextVariant });
        updateThemeAndLangButtons();
      });
    }

    var langBtn = document.querySelector('[data-ai-image-lang-toggle]');
    if (langBtn && !langBtn.dataset.bound) {
      langBtn.dataset.bound = '1';
      langBtn.addEventListener('click', function () {
        state.lang = state.lang === 'en' ? 'ko' : 'en';
        try {
          localStorage.setItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang', state.lang);
        } catch (_) { }
        updateDocumentCopy();
        updateThemeAndLangButtons();
        render();
      });
    }

    var screenBtn = document.querySelector('[data-screen-toggle]');
    if (screenBtn && !screenBtn.dataset.bound) {
      screenBtn.dataset.bound = '1';
      screenBtn.addEventListener('click', function () {
        if (NK.ui && NK.ui.common && NK.ui.common.toggleScreenMode) {
          NK.ui.common.toggleScreenMode();
        }
      });
    }
  }

  function updateAuthState() {
    var overlay = document.getElementById('auth-overlay');
    var authed = NK.auth && NK.auth.isAuthed && NK.auth.isAuthed();
    if (overlay) overlay.classList.toggle('hidden', !!authed);
  }

  function init() {
    if (!document.getElementById('ai-image-root')) return;
    state.lang = readLang();
    state.sessionId = ensureSessionId();
    state.currentProject = readCurrentProject();
    state.currentBrand = readCurrentBrand();
    loadHistory();
    try {
      NK.core.APP_VERSION = NK.config.APP_VERSION;
      if (NK.core.applyVersionAndNav) NK.core.applyVersionAndNav();
      if (NK.ui && NK.ui.common && NK.ui.common.applyTheme) {
        var theme = readTheme();
        NK.ui.common.applyTheme(theme, { variant: readThemeVariant(theme) });
      }
      if (NK.state && NK.state.set) NK.state.set({ lang: state.lang });
    } catch (_) { }

    updateDocumentCopy();
    updateThemeAndLangButtons();
    updateAuthState();
    bindStaticEvents();
    render();
    if (state.currentBrand && state.currentBrand.brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      NK.service.brand.hydrateFromServer(state.currentBrand.brandId).then(function (brand) {
        if (!brand || !brand.brandId) return;
        state.currentBrand = brand;
        render();
      }).catch(function () { });
    }
  }

  ui.init = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
