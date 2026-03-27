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
    imageSize: '2K',
    sourceImage: null,
    projectLibraryItems: [],
    brandLibraryItems: [],
    contentLibraryItems: [],
    currentProject: null,
    currentBrand: null,
    currentResultId: '',
    results: [],
    libraryLoading: false,
    brandLibraryLoading: false,
    contentLibraryLoading: false,
    historyLoading: false,
    historyLoadError: '',
    selectedFileName: '',
    sourceSectionCollapsed: { brand: true, content: true, project: true },
    imageModalUrl: '',
    deletedObjectNames: []
  };

  var TEXT = {
    ko: {
      pageTitle: 'NK_Studio · AI 이미지',
      brandSubtitle: 'AI 이미지 생성 플랫폼',
      navDashboard: '대시보드',
      navAiVideo: 'AI Video',
      navAiImage: 'AI 이미지 생성',
      navLibrary: '콘텐츠 저장소',
      heroTitle: 'AI 이미지 생성',
      heroDesc: '',
      sessionLabel: '세션',
      projectLabel: '현재 에피소드',
      brandLabel: '현재 브랜드',
      noneLabel: '없음',
      noProject: '에피소드 없음',
      noBrand: '선택된 브랜드 없음',
      noProjectHelp: '프로젝트를 선택하면 저장소에서 소스를 불러오고 결과를 등록할 수 있습니다.',
      modeText: '텍스트를 이미지로',
      modeImage: '이미지를 이미지로',
      sourceTitle: '소스 이미지',
      sourceEmpty: '',
      sourceUpload: '이미지 업로드',
      sourceProject: '프로젝트 저장소',
      sourceBrand: '브랜드 IP',
      sourceClear: '소스 비우기',
      sourceProjectEmpty: '현재 프로젝트 저장소에 이미지가 없습니다.',
      sourceProjectLoading: '프로젝트 저장소 불러오는 중...',
      sourceBrandEmpty: '현재 브랜드 IP 라이브러리에 이미지가 없습니다.',
      sourceBrandLoading: '브랜드 IP 라이브러리 불러오는 중...',
      sourceSelected: '선택된 소스',
      sourceLibraryTitle: '프로젝트 저장소',
      sourceBrandTitle: '브랜드 IP',
      sourceContentTitle: '콘텐츠 저장소',
      promptLabel: '프롬프트',
      promptPlaceholderText: '원하는 이미지의 장면, 스타일, 색감, 구도, 재질감을 설명해 주세요.',
      promptPlaceholderImage: '소스 이미지를 어떻게 바꾸거나 유지할지 설명해 주세요. 예: 같은 구도는 유지하고 수채화 질감으로 바꾸기',
      aspectLabel: '비율',
      sizeLabel: '해상도',
      sizeFast: '빠름(512)',
      sizeStd: '표준(1K)',
      sizeHigh: '고품질(2K)',
      generate: '생성',
      generating: '생성 중...',
      resultsTitle: '결과',
      resultsEmpty: '아직 생성된 이미지가 없습니다.',
      deleteConfirm: '이 이미지를 영구 삭제하시겠습니까?',
      deleteLabel: '삭제',
      download: '다운로드',
      saveProject: '에피소드 저장',
      saveBrand: '브랜드 IP 등록',
      savedBrand: '브랜드 IP 등록 완료',
      savedProject: '프로젝트 저장소 등록 완료',
      saveDisabled: '프로젝트가 선택되지 않아 등록할 수 없습니다.',
      saveBrandDisabled: '브랜드와 캐릭터가 선택되어야 등록할 수 있습니다.',
      saveBrandNoCharacters: '현재 브랜드에 등록된 캐릭터가 없어 IP로 등록할 수 없습니다.',
      saveBrandChooseCharacter: '등록할 캐릭터를 먼저 선택해 주세요.',
      saveBrandSelectLabel: '브랜드 캐릭터',
      saveBrandSelectPlaceholder: '캐릭터 선택',
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
      brandSaveFailed: '브랜드 IP 등록 실패: ',
      downloadFailed: '다운로드 실패: ',
      fileChoose: '파일 선택',
      latestResult: '미리보기',
      historyTitle: '생성 히스토리',
      resultSavedTag: '에피소드 저장 완료',
      resultSavedBrandTag: '브랜드 IP 등록 완료',
      historyLoading: '세션 결과 불러오는 중...',
      historyLoadError: '세션 결과 동기화 실패',
      promptCounterSuffix: '/4000',
      backToLogin: '로그인 페이지로 이동',
      sourceKindUpload: '업로드',
      sourceKindProject: '프로젝트 저장소',
      sourceKindBrand: '브랜드 IP',
      sourceKindContent: '콘텐츠 저장소',
      sourceContent: '콘텐츠 저장소 불러오기',
      sourceContentTitle: '콘텐츠 저장소',
      sourceContentLoading: '콘텐츠 저장소 불러오는 중...',
      sourceContentEmpty: '콘텐츠 저장소에 이미지가 없습니다.',
      fileNone: '선택된 파일 없음',
      promptPanelTitle: '프롬프트',
      reusePrompt: '프롬프트 복사',
      useAsSource: '소스 사용',
      regenerateVariation: '재생성'
    },
    en: {
      pageTitle: 'NK_Studio · AI Image',
      brandSubtitle: 'AI image generation',
      navDashboard: 'Dashboard',
      navAiVideo: 'AI Video',
      navAiImage: 'AI Image',
      navLibrary: 'Content Library',
      heroTitle: 'AI Image Generator',
      heroDesc: 'Handle text generation and reference-based variation in one workspace.',
      sessionLabel: 'Session',
      projectLabel: 'Current episode',
      brandLabel: 'Current brand',
      noneLabel: 'None',
      noProject: 'No episode selected',
      noBrand: 'No brand selected',
      noProjectHelp: 'Select a project to load source images from its library and save results back.',
      modeText: 'Text to image',
      modeImage: 'Image to image',
      sourceTitle: 'Source image',
      sourceEmpty: '',
      sourceUpload: 'Upload image',
      sourceProject: 'Load from project library',
      sourceBrand: 'Load from brand IP',
      sourceClear: 'Clear source',
      sourceProjectEmpty: 'No images found in the current project library.',
      sourceProjectLoading: 'Loading project library...',
      sourceBrandEmpty: 'No images found in the current brand IP library.',
      sourceBrandLoading: 'Loading brand IP library...',
      sourceSelected: 'Selected source',
      sourceLibraryTitle: 'Project library',
      sourceBrandTitle: 'Brand IP',
      sourceContentTitle: 'Content Library',
      promptLabel: 'Prompt',
      promptPlaceholderText: 'Describe the scene, style, lighting, composition, and textures you want.',
      promptPlaceholderImage: 'Describe what to preserve or transform from the source image. Example: keep the same composition and convert it into watercolor.',
      aspectLabel: 'Aspect ratio',
      sizeLabel: 'Image size',
      sizeFast: 'Fast (512)',
      sizeStd: 'Standard (1K)',
      sizeHigh: 'High (2K)',
      generate: 'Generate',
      generating: 'Generating...',
      resultsTitle: 'Results',
      resultsEmpty: 'No generated images yet.',
      deleteConfirm: 'Permanently delete this image?',
      deleteLabel: 'Delete',
      download: 'Download',
      saveProject: 'Save to episode',
      saveBrand: 'Save to brand IP',
      savedBrand: 'Saved to brand IP',
      savedProject: 'Saved to project library',
      saveDisabled: 'A selected project is required to save this result.',
      saveBrandDisabled: 'A selected brand and character are required to save this result.',
      saveBrandNoCharacters: 'No registered characters are available in the current brand.',
      saveBrandChooseCharacter: 'Choose a character before saving to brand IP.',
      saveBrandSelectLabel: 'Brand character',
      saveBrandSelectPlaceholder: 'Select a character',
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
      brandSaveFailed: 'Failed to save to brand IP: ',
      downloadFailed: 'Download failed: ',
      fileChoose: 'Choose file',
      latestResult: 'Primary preview',
      historyTitle: 'Generation history',
      resultSavedTag: 'Saved to episode',
      resultSavedBrandTag: 'Saved to brand IP',
      promptPanelTitle: 'Prompt',
      historyLoading: 'Loading session results...',
      historyLoadError: 'Failed to sync session results',
      promptCounterSuffix: '/4000',
      backToLogin: 'Go to sign-in page',
      sourceKindUpload: 'Upload',
      sourceKindProject: 'Project library',
      sourceKindBrand: 'Brand IP',
      sourceKindContent: 'Content Library',
      sourceContent: 'Load from Content Library',
      sourceContentTitle: 'Content Library Images',
      sourceContentLoading: 'Loading Content Library...',
      sourceContentEmpty: 'No images found in Content Library.',
      fileNone: 'No file selected',
      reusePrompt: 'Copy to prompt',
      useAsSource: 'Use as source',
      regenerateVariation: 'Generate variation'
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
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) {
      return null;
    }
  }

  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
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

  function extractObjectTimestamp(objectName) {
    var raw = String(objectName || '').trim();
    var match = raw.match(/\/(\d{13})-[^/]+\.(?:png|jpg|jpeg|webp)$/i);
    if (!match) return 0;
    var stamp = Number(match[1] || 0);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function resolveResultUrl(result) {
    var row = result && typeof result === 'object' ? result : {};
    var objectName = String(row.objectName || '').trim();
    if (objectName && NK.api && NK.api.mediaProxyObjectUrl) {
      return NK.api.mediaProxyObjectUrl(objectName);
    }
    return String(row.url || '').trim();
  }

  function getDeletedStorageKey() {
    return STORAGE_HISTORY_PREFIX + String(state.sessionId || 'default') + '_deleted';
  }
  function loadDeletedSet() {
    try {
      var raw = localStorage.getItem(getDeletedStorageKey()) || '[]';
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.deletedObjectNames = arr.filter(function (s) { return typeof s === 'string' && s.trim(); });
    } catch (_) { state.deletedObjectNames = []; }
  }
  function persistDeletedSet() {
    try { localStorage.setItem(getDeletedStorageKey(), JSON.stringify(state.deletedObjectNames || [])); } catch (_) {}
  }
  function addDeletedTombstone(objectName) {
    var name = String(objectName || '').trim();
    if (!name) return;
    if (!Array.isArray(state.deletedObjectNames)) state.deletedObjectNames = [];
    if (state.deletedObjectNames.indexOf(name) < 0) {
      state.deletedObjectNames.push(name);
      persistDeletedSet();
    }
  }

  function mergeServerResults(items) {
    var incoming = Array.isArray(items) ? items : [];
    var map = new Map();
    var deleted = new Set(Array.isArray(state.deletedObjectNames) ? state.deletedObjectNames : []);
    state.results.forEach(function (item, index) {
      var row = item && typeof item === 'object' ? cloneJson(item, {}) : {};
      var key = String(row.objectName || row.id || ('local_' + index)).trim();
      if (!key) return;
      map.set(key, row);
    });
    incoming.forEach(function (item, index) {
      var row = item && typeof item === 'object' ? item : {};
      var objectName = String(row.name || row.objectName || '').trim();
      if (!objectName) return;
      if (deleted.has(objectName)) return;
      var existing = map.get(objectName) || {};
      var createdAt = String(
        existing.createdAt
        || row.updated
        || row.timeCreated
        || (extractObjectTimestamp(objectName) ? new Date(extractObjectTimestamp(objectName)).toISOString() : '')
      ).trim();
      map.set(objectName, Object.assign({}, existing, {
        id: String(existing.id || ('res_' + objectName.replace(/[^a-z0-9]+/gi, '_') || index)),
        objectName: objectName,
        url: String(existing.url || row.signedUrl || '').trim(),
        prompt: String(existing.prompt || '').trim(),
        mode: String(existing.mode || 'text-to-image').trim(),
        aspectRatio: String(existing.aspectRatio || '').trim(),
        createdAt: createdAt || new Date().toISOString(),
        sessionId: String(existing.sessionId || state.sessionId || '').trim(),
        savedToProject: existing.savedToProject === true,
        savedBrandTargets: Array.isArray(existing.savedBrandTargets) ? existing.savedBrandTargets.slice() : [],
        selectedBrandCharacterToken: String(existing.selectedBrandCharacterToken || '').trim()
      }));
    });
    state.results = Array.from(map.values()).sort(function (a, b) {
      return new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime();
    }).slice(0, 30);
    if (!state.currentResultId || !state.results.some(function (item) {
      return String(item.id || '') === String(state.currentResultId || '');
    })) {
      state.currentResultId = state.results[0] ? String(state.results[0].id || '') : '';
    }
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
  function resolveContentItemUrl(item) {
    var row = item && typeof item === 'object' ? item : {};
    return String(row.url || '').trim();
  }

  function cloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value == null ? fallback : value));
    } catch (_) {
      return fallback;
    }
  }

  function normalizeCharacterName(value) {
    return String(value || '').replace(/^@+/, '').trim();
  }

  function normalizeCharacterToken(value) {
    var name = normalizeCharacterName(value).replace(/\s+/g, '');
    return name ? ('@' + name) : '';
  }

  function brandCharacterOptions() {
    var brand = state.currentBrand && typeof state.currentBrand === 'object' ? state.currentBrand : {};
    var options = [];
    var seen = {};
    var sheets = Array.isArray(brand.characterSheets) ? brand.characterSheets : [];
    var knowledgeCharacters = Array.isArray(brand.knowledgeCharacters) ? brand.knowledgeCharacters : [];
    sheets.forEach(function (entry, index) {
      var token = normalizeCharacterToken(entry && (entry.token || entry.displayName || entry.name));
      if (!token || seen[token]) return;
      seen[token] = true;
      options.push({
        token: token,
        label: normalizeCharacterName(entry && (entry.displayName || entry.name || token)) || ('Character ' + (index + 1))
      });
    });
    knowledgeCharacters.forEach(function (entry, index) {
      var token = normalizeCharacterToken(entry && (entry.token || entry.displayName || entry.name));
      if (!token || seen[token]) return;
      seen[token] = true;
      options.push({
        token: token,
        label: normalizeCharacterName(entry && (entry.displayName || entry.name || token)) || ('Character ' + (index + 1))
      });
    });
    return options;
  }

  function selectedBrandCharacterToken(result) {
    var row = result && typeof result === 'object' ? result : {};
    var saved = String(row.selectedBrandCharacterToken || '').trim();
    if (saved) return saved;
    var options = brandCharacterOptions();
    return options[0] ? String(options[0].token || '').trim() : '';
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
    var dashboardLink = document.querySelector('[data-ai-image-nav="dashboard"]');
    if (dashboardLink) dashboardLink.textContent = t('navDashboard');
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
      var current = state.lang === 'en' ? 'EN' : 'KO';
      langBtn.textContent = current;
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
    var detached = !(project && project.id);
    var selectedResult = currentResult();
    var sourceUrl = sourcePreviewUrl();
    var sourceDisabled = state.mode !== 'image-to-image';
    var sourceKind = '';
    var brandCharacterList = brandCharacterOptions();
    var selectedBrandToken = selectedBrandCharacterToken(selectedResult);
    if (state.sourceImage) {
      if (state.sourceImage.kind === 'project') sourceKind = t('sourceKindProject');
      else if (state.sourceImage.kind === 'brand') sourceKind = t('sourceKindBrand');
        else if (state.sourceImage.kind === 'content') sourceKind = t('sourceKindContent');
      else sourceKind = t('sourceKindUpload');
    }
    var resultCards = state.results.map(function (item) {
      var active = String(item.id || '') === String(state.currentResultId || '');
      return '' +
        '<div class="ai-image-history-card' + (active ? ' active' : '') + '" role="button" tabindex="0" data-action="select-result" data-id="' + escapeHtml(item.id) + '">' +
        '<button type="button" class="ai-image-history-delete" data-action="delete-result" data-id="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button>' +
        '<img src="' + escapeHtml(resolveResultUrl(item)) + '" alt="" class="ai-image-history-thumb" />' +
        '<div class="ai-image-history-meta">' +
        '<strong>' + escapeHtml(item.mode === 'image-to-image' ? t('modeImageShort') : t('modeTextShort')) + '</strong>' +
        '<p>' + escapeHtml(item.prompt || '') + '</p>' +
        (item.savedToProject ? '<span class="ai-image-saved-chip">' + escapeHtml(t('resultSavedTag')) + '</span>' : '') +
        '</div>' +
        '</div>';
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
    var contentSourceLibrary = state.contentLibraryItems.map(function (item, index) {
      var thumb = resolveContentItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card" data-action="select-content-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');

    root.innerHTML = '' +
      '<section class="ai-image-shell">' +
      '<div class="ai-image-header">' +
      '<div>' +
      '<h1>' + escapeHtml(t('heroTitle')) + '</h1>' +
      '</div>' +
      '<div class="ai-image-status-pills">' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('sessionLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : state.sessionId) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('projectLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : (project && project.title ? project.title : t('noProject'))) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('brandLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : (brand && brand.brandTitle ? brand.brandTitle : t('noBrand'))) + '</strong></span>' +
      '</div>' +
      '</div>' +
      '<div class="ai-image-workspace">' +
      '<section class="card ai-image-panel ai-image-panel-left">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('promptPanelTitle')) + '</h2></div>' +
      '</div>' +
      '<div class="scenario-form">' +
      '<div class="ai-image-mode-tabs">' +
      '<button type="button" class="btn-secondary' + (state.mode === 'text-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="text-to-image">' + escapeHtml(t('modeText')) + '</button>' +
      '<button type="button" class="btn-secondary' + (state.mode === 'image-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="image-to-image">' + escapeHtml(t('modeImage')) + '</button>' +
      '</div>' +
      '<div class="ai-image-field source-field' + (sourceDisabled ? ' is-disabled' : '') + '">' +
        '<label>' + escapeHtml(t('sourceTitle')) + '</label>' +
        '<div class="ai-image-source-box' + (sourceDisabled ? ' is-disabled' : '') + (sourceUrl ? ' has-image' : '') + '">' +
        (sourceUrl
          ? '<div class="ai-image-source-preview"><button type="button" class="img-modal-trigger" data-action="toggle-source-modal"><img src="' + escapeHtml(sourceUrl) + '" alt="" /></button><button type="button" class="source-remove-fab" data-action="clear-source" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button></div>'
          : '') +
        '<div class="ai-image-inline-actions">' +
        '<button type="button" class="btn-secondary compact source-upload-fab" data-action="open-upload"' + (sourceDisabled ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '<input type="file" id="ai-image-source-file" class="hidden" accept="image/*"' + (sourceDisabled ? ' disabled' : '') + ' />' +
        '</div>' +
        ((!detached && state.brandLibraryItems.length)
          ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceBrandTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="brand" aria-label="브랜드 이미지 ' + (state.sourceSectionCollapsed.brand ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.brand ? '+' : '−') + '</button></div>' + (state.sourceSectionCollapsed.brand ? '' : '<div class="ai-image-source-grid compact collapsible-body">' + brandSourceLibrary + '</div>') + '</div>'
          : '') +
        (!detached
          ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceContentTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="content" aria-label="콘텐츠 저장소 ' + (state.sourceSectionCollapsed.content ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.content ? '+' : '−') + '</button></div>' + (state.sourceSectionCollapsed.content ? '' : (state.contentLibraryItems.length ? ('<div class="ai-image-source-grid compact collapsible-body">' + contentSourceLibrary + '</div>') : '<p class="muted small">' + escapeHtml(t('sourceContentEmpty')) + '</p>')) + '</div>'
          : '') +
        (function () {
          var projectBody = '';
          if (!detached && !state.sourceSectionCollapsed.project) {
            if (project && project.id) {
              projectBody = state.projectLibraryItems.length
                ? '<div class="ai-image-source-grid compact collapsible-body">' + sourceLibrary + '</div>'
                : '<p class="muted small">' + escapeHtml(t('sourceProjectEmpty')) + '</p>';
            } else {
              projectBody = '';
            }
          }
          return (!detached && (project && project.id))
            ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceLibraryTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="project" aria-label="프로젝트 저장소 ' + (state.sourceSectionCollapsed.project ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.project ? '+' : '−') + '</button></div>' + projectBody + '</div>'
            : '';
        })() +
        ((!detached && state.libraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceProjectLoading')) + '</p>' : '') +
        ((!detached && state.brandLibraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceBrandLoading')) + '</p>' : '') +
        ((!detached && state.contentLibraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceContentLoading')) + '</p>' : '') +
        '</div>' +
      '<div class="ai-image-field">' +
      '<label for="ai-image-prompt">' + escapeHtml(t('promptLabel')) + '</label>' +
      '<textarea id="ai-image-prompt" rows="8" maxlength="4000" placeholder="' + escapeHtml(state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText')) + '"></textarea>' +
      '<div class="ai-image-counter"><span id="ai-image-prompt-count">' + escapeHtml(String((state.prompt || '').length) + t('promptCounterSuffix')) + '</span></div>' +
      '</div>' +
      '<div class="ai-image-field ai-image-size-field">' +
      '<label class="ai-image-size-label">' + escapeHtml(t('sizeLabel')) + '</label>' +
      '<div class="ai-image-size-row" style="text-align:center;">' +
      '<select id="ai-image-size" class="btn-secondary" style="min-width:140px;">' +
      '<option value="512"' + (state.imageSize === '512' ? ' selected' : '') + '>' + escapeHtml(t('sizeFast')) + '</option>' +
      '<option value="1K"' + (state.imageSize === '1K' ? ' selected' : '') + '>' + escapeHtml(t('sizeStd')) + '</option>' +
      '<option value="2K"' + (state.imageSize === '2K' ? ' selected' : '') + '>' + escapeHtml(t('sizeHigh')) + '</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="ai-image-ratio-row">' +
      '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '1:1' ? ' active' : '') + '" data-action="set-aspect" data-ratio="1:1">1:1</button>' +
      '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '16:9' ? ' active' : '') + '" data-action="set-aspect" data-ratio="16:9">16:9</button>' +
      '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '9:16' ? ' active' : '') + '" data-action="set-aspect" data-ratio="9:16">9:16</button>' +
      '<button type="button" class="btn-primary wide-generate" data-action="generate-image">' + escapeHtml(t('generate')) + '</button>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section class="card ai-image-panel ai-image-panel-preview">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('latestResult')) + '</h2></div>' +
      '</div>' +
      '<div class="ai-image-preview-layout">' +
      (selectedResult
        ? '<div class="ai-image-preview-stage">' +
          '<div class="ai-image-preview-media">' +
          '<button type="button" class="ai-image-preview-trigger" data-action="toggle-preview-modal" data-url="' + escapeHtml(resolveResultUrl(selectedResult)) + '">' +
          '<img src="' + escapeHtml(resolveResultUrl(selectedResult)) + '" alt="" class="ai-image-preview-image" />' +
          '</button>' +
          '</div>' +
          '<div class="ai-image-preview-foot">' +
            '<div class="ai-image-inline-actions">' +
              '<div class="ai-image-inline-actions-left">' +
                '<button type="button" class="btn-primary compact ai-image-action-icon" data-action="regenerate-variation" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('regenerateVariation')) + '" title="' + escapeHtml(t('regenerateVariation')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v6h6"></path><path d="M20 20v-6h-6"></path><path d="M4 10a8 8 0 0 1 14-5"></path><path d="M20 14a8 8 0 0 1-14 5"></path></svg></button>' +
                (detached ? '' : ('<button type="button" class="btn-primary compact" data-action="save-result-project" data-id="' + escapeHtml(selectedResult.id) + '"' + ((project && project.id) ? '' : ' disabled') + '>' + escapeHtml(t('saveProject')) + '</button>')) +
                '<button type="button" class="btn-secondary compact ai-image-action-icon" data-action="use-result-as-source" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('useAsSource')) + '" title="' + escapeHtml(t('useAsSource')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="11" height="8.5" rx="1.8"></rect><circle cx="8" cy="8.5" r="1"></circle><path d="M5.5 12l2.2-2.2 1.8 1.8 1.8-2 1.2 1.2"></path><path d="M13 18h7"></path><path d="M17 14l3.5 4L17 22"></path></svg></button>' +
                '<button type="button" class="btn-secondary compact ai-image-action-icon" data-action="reuse-prompt" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('reusePrompt')) + '" title="' + escapeHtml(t('reusePrompt')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="10" height="12" rx="2"></rect><rect x="4" y="4" width="10" height="12" rx="2"></rect></svg></button>' +
                '<button type="button" class="btn-secondary compact ai-image-action-icon" data-action="download-result" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('download')) + '" title="' + escapeHtml(t('download')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="M8 11l4 4 4-4"></path><path d="M5 19h14"></path></svg></button>' +
              '</div>' +
              (detached ? '' : '<div class="ai-image-brand-actions">' +
              '<label class="ai-image-brand-select-wrap" aria-label="' + escapeHtml(t('saveBrandSelectLabel')) + '">' +
              '<select id="ai-image-brand-target" title="' + escapeHtml(t('saveBrandSelectLabel')) + '">' +
              '<option value="">' + escapeHtml(t('saveBrandSelectPlaceholder')) + '</option>' +
              brandCharacterList.map(function (item) {
                return '<option value="' + escapeHtml(item.token) + '"' + (String(item.token) === String(selectedBrandToken) ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>';
              }).join('') +
              '</select>' +
              '</label>' +
              '<button type="button" class="btn-secondary compact" data-action="save-result-brand" data-id="' + escapeHtml(selectedResult.id) + '"' + ((brand && brand.brandId && brandCharacterList.length) ? '' : ' disabled') + '>' + escapeHtml(t('saveBrand')) + '</button>' +
              '</div>') +
            '</div>' +
            '<div class="ai-image-preview-meta">' +
              '<p><strong>' + escapeHtml(t('createdAt')) + ':</strong> ' + escapeHtml(formatDate(selectedResult.createdAt)) + '</p>' +
              '<p>' + escapeHtml(selectedResult.prompt || '') + '</p>' +
            '</div>' +
          '</div>' +
        '</div>'
        : '<div class="ai-image-empty-state"><p>' + escapeHtml(t('resultsEmpty')) + '</p></div>') +
      '</div>' +
      '</section>' +
      '<section class="card ai-image-panel ai-image-panel-history">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('historyTitle')) + '</h2></div>' +
      '</div>' +
      '<div class="ai-image-history">' +
      (state.historyLoading ? '<p class="muted small">' + escapeHtml(t('historyLoading')) + '</p>' : '') +
      ((!state.historyLoading && state.historyLoadError) ? '<p class="muted small">' + escapeHtml(t('historyLoadError')) + '</p>' : '') +
      (resultCards ? '<div class="ai-image-history-list">' + resultCards + '</div>' : '<p class="muted small">' + escapeHtml(t('resultsEmpty')) + '</p>') +
      '</div>' +
      '</section>' +
      '</div>' +
      (state.imageModalUrl ? '<div class="img-modal" data-action="toggle-source-modal"><img src="' + escapeHtml(state.imageModalUrl) + '" alt="" /></div>' : '') +
      '</section>';

    // 보정: 이미지가 있을 때는 has-image 클래스 강제 부여(레이아웃 일관성)
    try {
      var boxEl = root.querySelector('.ai-image-source-box');
      if (boxEl && sourceUrl && !boxEl.classList.contains('has-image')) {
        boxEl.classList.add('has-image');
      }
    } catch (_) {}

    var promptEl = document.getElementById('ai-image-prompt');
    if (promptEl) {
      promptEl.value = state.prompt || '';
      promptEl.oninput = function () {
        state.prompt = String(promptEl.value || '');
        var counter = document.getElementById('ai-image-prompt-count');
        if (counter) counter.textContent = String(state.prompt.length) + t('promptCounterSuffix');
      };
    }
    var sizeEl = document.getElementById('ai-image-size');
    if (sizeEl) {
      sizeEl.value = state.imageSize || '2K';
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
          state.selectedFileName = file.name || '';
          updateSourceUI();
        };
        reader.readAsDataURL(file);
      };
    }
  }

  // Partial DOM update for source area to avoid reloading all images
  function updateSourceUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var sourceField = root.querySelector('.ai-image-field.source-field');
      var boxEl = root.querySelector('.ai-image-source-box');
      var tabs = root.querySelectorAll('.ai-image-mode-tabs .btn-secondary');
      var sourceUrl = sourcePreviewUrl();
      var sourceDisabled = state.mode !== 'image-to-image';
      // tabs active state
      Array.prototype.forEach.call(tabs || [], function(btn){
        var m = String(btn.getAttribute('data-mode') || '');
        if (m && m === state.mode) btn.classList.add('active'); else btn.classList.remove('active');
      });
      // field disabled state
      if (sourceField) {
        sourceField.classList.toggle('is-disabled', sourceDisabled);
      }
      if (boxEl) {
        boxEl.classList.toggle('is-disabled', sourceDisabled);
        boxEl.classList.toggle('has-image', !!sourceUrl);
        // preview area
        var preview = boxEl.querySelector('.ai-image-source-preview');
        if (sourceUrl) {
          if (!preview) {
            preview = document.createElement('div');
            preview.className = 'ai-image-source-preview';
            boxEl.insertBefore(preview, boxEl.firstChild);
          }
          // build inner controls
          preview.innerHTML = '';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'img-modal-trigger';
          btn.setAttribute('data-action', 'toggle-source-modal');
          var img = document.createElement('img');
          img.src = String(sourceUrl);
          img.alt = '';
          btn.appendChild(img);
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'source-remove-fab';
          del.setAttribute('data-action', 'clear-source');
          del.setAttribute('aria-label', '삭제');
          del.setAttribute('title', '삭제');
          del.textContent = '×';
          preview.appendChild(btn);
          preview.appendChild(del);
        } else {
          if (preview) preview.parentNode && preview.parentNode.removeChild(preview);
        }
        // upload button disabled state (표시는 CSS로 항상 노출)
        var plus = boxEl.querySelector('.source-upload-fab');
        if (plus) {
          if (sourceDisabled) plus.setAttribute('disabled', ''); else plus.removeAttribute('disabled');
        }
      }
    } catch (_) {}
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

  async function resultToDataUrl(result) {
    var url = resolveResultUrl(result);
    if (!url) throw new Error('result_url_missing');
    if (url.indexOf('data:') === 0) return url;
    var response = await fetch(url);
    if (!response.ok) throw new Error('result_fetch_failed');
    var blob = await response.blob();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('result_read_failed')); };
      reader.readAsDataURL(blob);
    });
  }

  async function saveResultToBrand(resultId) {
    if (!state.currentBrand || !state.currentBrand.brandId) {
      alert(t('saveBrandDisabled'));
      return;
    }
    var result = state.results.find(function (item) {
      return String(item && item.id || '') === String(resultId || '');
    });
    if (!result) return;
    var selectEl = document.getElementById('ai-image-brand-target');
    var selectedToken = normalizeCharacterToken(selectEl && selectEl.value);
    if (!selectedToken) {
      var available = brandCharacterOptions();
      if (!available.length) {
        alert(t('saveBrandNoCharacters'));
        return;
      }
      alert(t('saveBrandChooseCharacter'));
      return;
    }
    setGlobalLoading(true, t('saveBrand'));
    try {
      var savedBrand = await registerImageToBrand(state.currentBrand.brandId, selectedToken, result);
      state.currentBrand = savedBrand || state.currentBrand;
      result.savedBrandTargets = Array.isArray(result.savedBrandTargets) ? result.savedBrandTargets : [];
      if (result.savedBrandTargets.indexOf(selectedToken) < 0) result.savedBrandTargets.push(selectedToken);
      result.selectedBrandCharacterToken = selectedToken;
      persistHistory();
      render();
      alert(t('savedBrand'));
    } catch (err) {
      alert(t('brandSaveFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function loadProjectLibrary() {
    if (!state.currentProject || !state.currentProject.id) return;
    state.libraryLoading = true;
    render();
    try {
      var res = await NK.api.library('image', state.currentProject.id);
      state.projectLibraryItems = (Array.isArray(res && res.items) ? res.items : []).filter(isImageLibraryItem);
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
  async function loadContentLibrary() {
    state.contentLibraryLoading = true;
    render();
    try {
      var target = (state.currentBrand && state.currentBrand.brandId) ? state.currentBrand : state.currentProject;
      if (!NK.service || !NK.service.contentLibrary || !target) {
        state.contentLibraryItems = [];
      } else {
        var items = NK.service.contentLibrary.listProjectContents(target);
        state.contentLibraryItems = (Array.isArray(items) ? items : []).filter(function (it) {
          return String(it && it.type || '') === 'image' && String(it && it.url || '').trim();
        }).map(function (it) {
          return { url: String(it.url || '').trim(), title: String(it.title || '').trim() || 'Image' };
        });
      }
    } catch (err) {
      alert(t('brandLoadFailed'));
    } finally {
      state.contentLibraryLoading = false;
      render();
    }
  }

  async function hydrateSessionHistory() {
    if (!state.sessionId || !NK.api || !NK.api.aiImageSessionLibrary) return;
    loadDeletedSet();
    state.historyLoading = true;
    state.historyLoadError = '';
    render();
    try {
      var res = await NK.api.aiImageSessionLibrary(state.sessionId);
      mergeServerResults(Array.isArray(res && res.items) ? res.items : []);
      persistHistory();
    } catch (err) {
      console.warn('AI image session history sync failed', err);
      state.historyLoadError = '1';
    } finally {
      state.historyLoading = false;
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
      await registerImageToProject(state.currentProject.id, result);
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
      imageSize: state.imageSize,
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
        imageSize: String(response && response.imageSizeApplied || state.imageSize || '').trim(),
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
      var msg = (err && err.message) ? String(err.message) : String(err);
      var hint = '';
      try {
        var raw = String(err && err.detail || '').trim();
        var parsed = raw ? JSON.parse(raw) : null;
        var d = parsed && parsed.detail ? parsed.detail : parsed;
        var code = (parsed && (parsed.code || parsed.status)) || '';
        var status = (err && err.status) || (parsed && parsed.status) || '';
        var serverHint = parsed && parsed.hint ? parsed.hint : '';
        var serverMsg = (d && d.error && d.error.message) || (parsed && parsed.message) || '';
        if (serverMsg && !/Gemini API error/i.test(msg)) msg = serverMsg;
        if (status) hint = String(serverHint || '') + (serverHint ? ' ' : '') + '(status: ' + status + ')';
        else if (serverHint) hint = serverHint;
      } catch (_) {}
      alert(t('generationFailed') + msg + (hint ? ('\n힌트: ' + hint) : ''));
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
        if (
          state.mode !== 'image-to-image' &&
          (
            action === 'open-upload' ||
            action === 'clear-source' ||
            action === 'load-project-library' ||
            action === 'load-brand-library' ||
            action === 'load-content-library' ||
            action === 'select-project-source' ||
            action === 'select-brand-source' ||
            action === 'select-content-source' ||
            action === 'toggle-source-section' ||
            action === 'toggle-source-modal'
          )
        ) {
          return;
        }
        if (action === 'set-mode') {
          state.mode = String(btn.getAttribute('data-mode') || 'text-to-image');
          updateSourceUI();
          try {
            var tabsNow = root.querySelectorAll('.ai-image-mode-tabs .btn-secondary');
            Array.prototype.forEach.call(tabsNow || [], function(tb){
              var m = String(tb.getAttribute('data-mode') || '');
              if (m && m === state.mode) tb.classList.add('active'); else tb.classList.remove('active');
            });
            var promptEl = document.getElementById('ai-image-prompt');
            if (promptEl) {
              var ph = state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText');
              promptEl.setAttribute('placeholder', ph);
            }
          } catch (_) {}
          if (state.mode === 'image-to-image') {
            if (!state.brandLibraryItems.length && state.currentBrand && state.currentBrand.brandId) loadBrandLibrary();
            if (!state.contentLibraryItems.length) loadContentLibrary();
            if (!state.projectLibraryItems.length && state.currentProject && state.currentProject.id) loadProjectLibrary();
          }
          return;
        }
        if (action === 'open-upload') {
          var input = document.getElementById('ai-image-source-file');
          if (input) input.click();
          return;
        }
        if (action === 'clear-source') {
          state.sourceImage = null;
          updateSourceUI();
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
        if (action === 'load-content-library') {
          loadContentLibrary();
          return;
        }
        if (action === 'select-project-source') {
          var idx = Number(btn.getAttribute('data-index') || -1);
          var item = idx >= 0 ? state.projectLibraryItems[idx] : null;
          if (!item) return;
          var nextUrl = resolveLibraryItemUrl(item);
          if (state.sourceImage && String(state.sourceImage.url || '') === String(nextUrl || '')) {
            state.sourceImage = null;
            updateSourceUI();
            return;
          }
          state.sourceImage = {
            url: nextUrl,
            name: String(item.name || '').trim(),
            kind: 'project'
          };
          updateSourceUI();
          return;
        }
        if (action === 'select-brand-source') {
          var brandIdx = Number(btn.getAttribute('data-index') || -1);
          var brandItem = brandIdx >= 0 ? state.brandLibraryItems[brandIdx] : null;
          if (!brandItem) return;
          var nextBrandUrl = resolveLibraryItemUrl(brandItem);
          if (state.sourceImage && String(state.sourceImage.url || '') === String(nextBrandUrl || '')) {
            state.sourceImage = null;
            updateSourceUI();
            return;
          }
          state.sourceImage = {
            url: nextBrandUrl,
            name: String(brandItem.name || '').trim(),
            kind: 'brand'
          };
          updateSourceUI();
          return;
        }
        if (action === 'select-content-source') {
          var cIdx = Number(btn.getAttribute('data-index') || -1);
          var cItem = cIdx >= 0 ? state.contentLibraryItems[cIdx] : null;
          if (!cItem) return;
          var nextContentUrl = resolveContentItemUrl(cItem);
          if (state.sourceImage && String(state.sourceImage.url || '') === String(nextContentUrl || '')) {
            state.sourceImage = null;
            updateSourceUI();
            return;
          }
          state.sourceImage = {
            url: nextContentUrl,
            name: String(cItem.title || '').trim(),
            kind: 'content'
          };
          updateSourceUI();
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
        if (action === 'toggle-source-section') {
          var sec = String(btn.getAttribute('data-section') || '').trim();
          if (sec && state.sourceSectionCollapsed && Object.prototype.hasOwnProperty.call(state.sourceSectionCollapsed, sec)) {
            var nextOpen = !!state.sourceSectionCollapsed[sec];
            state.sourceSectionCollapsed = { brand: true, content: true, project: true };
            state.sourceSectionCollapsed[sec] = !nextOpen;
            render();
          }
          return;
        }
        if (action === 'toggle-preview-modal') {
          var imgUrl = String(btn.getAttribute('data-url') || '').trim();
          var existing = document.querySelector('.img-modal');
          if (existing) {
            existing.parentNode && existing.parentNode.removeChild(existing);
            state.imageModalUrl = '';
            return;
          }
          var urlToShow = imgUrl || (selectedResult ? resolveResultUrl(selectedResult) : '');
          if (urlToShow) {
            var modal = document.createElement('div');
            modal.className = 'img-modal';
            modal.setAttribute('data-action', 'toggle-preview-modal');
            var img = document.createElement('img');
            img.src = urlToShow;
            img.alt = '';
            modal.appendChild(img);
            root.appendChild(modal);
            state.imageModalUrl = urlToShow;
          }
          return;
        }
        if (action === 'set-aspect') {
          state.aspectRatio = String(btn.getAttribute('data-ratio') || '16:9');
          render();
          return;
        }
        if (action === 'toggle-source-modal') {
          var overlay = document.querySelector('.img-modal');
          if (overlay) {
            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            state.imageModalUrl = '';
            return;
          }
          if (state.sourceImage && state.sourceImage.url) {
            var el = document.createElement('div');
            el.className = 'img-modal';
            el.setAttribute('data-action', 'toggle-source-modal');
            var img = document.createElement('img');
            img.src = String(state.sourceImage.url || '');
            img.alt = '';
            el.appendChild(img);
            root.appendChild(el);
            state.imageModalUrl = String(state.sourceImage.url || '');
          }
          return;
        }
        if (action === 'download-result') {
          var result = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          downloadResult(result);
          return;
        }
        if (action === 'delete-result') {
          var deleteId = String(btn.getAttribute('data-id') || '');
          if (!deleteId) return;
          try {
            var ok = window.confirm(t('deleteConfirm'));
            if (!ok) return;
          } catch (_) {
            // fall through if confirm not available
          }
          var idx = state.results.findIndex(function (r) { return String(r.id || '') === deleteId; });
          if (idx >= 0) {
            var toDelete = state.results[idx];
            var objectName = String(toDelete && toDelete.objectName || '').trim();
            if (toDelete && toDelete.savedToProject && objectName && project && project.id && NK.api && NK.api.projectDelete) {
              NK.api.projectDelete(project.id, objectName).catch(function () { });
            }
            if (objectName) addDeletedTombstone(objectName);
            state.results.splice(idx, 1);
            if (String(state.currentResultId || '') === deleteId) {
              state.currentResultId = state.results[0] ? String(state.results[0].id || '') : '';
            }
            persistHistory();
            render();
          }
          return;
        }
        if (action === 'save-result-project') {
          saveResultToProject(btn.getAttribute('data-id') || '');
          return;
        }
        if (action === 'save-result-brand') {
          saveResultToBrand(btn.getAttribute('data-id') || '');
          return;
        }
        if (action === 'reuse-prompt') {
          var r1 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r1 && r1.prompt) {
            state.prompt = String(r1.prompt || '');
            render();
          }
          return;
        }
        if (action === 'use-result-as-source') {
          var r2 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r2) {
            state.mode = 'image-to-image';
            state.sourceImage = {
              url: resolveResultUrl(r2),
              name: String(r2.objectName || r2.id || 'result'),
              kind: 'upload'
            };
            updateSourceUI();
          }
          return;
        }
        if (action === 'regenerate-variation') {
          var r3 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r3) {
            state.mode = 'image-to-image';
            state.sourceImage = {
              url: resolveResultUrl(r3),
              name: String(r3.objectName || r3.id || 'result'),
              kind: 'upload'
            };
            generateImage();
          }
          return;
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

    document.addEventListener('change', function (evt) {
      var target = evt.target;
      if (!target) return;
      if (target.id === 'ai-image-brand-target') {
        var result = currentResult();
        if (!result) return;
        result.selectedBrandCharacterToken = normalizeCharacterToken(target.value);
        persistHistory();
        return;
      }
      if (target.id === 'ai-image-size') {
        var val = String(target.value || '').toUpperCase();
        if (val === '512' || val === '1K' || val === '2K') state.imageSize = val;
        return;
      }
    });
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
    hydrateSessionHistory();
    if (state.currentBrand && state.currentBrand.brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      NK.service.brand.hydrateFromServer(state.currentBrand.brandId).then(function (brand) {
        if (!brand || !brand.brandId) return;
        state.currentBrand = brand;
        render();
      }).catch(function () { });
    }
    if (!window.__aiImageLangBound) {
      window.__aiImageLangBound = true;
      window.addEventListener('nk:lang-changed', function (e) {
        var next = (e && e.detail && e.detail.lang) === 'en' ? 'en' : 'ko';
        if (state.lang !== next) {
          state.lang = next;
          updateDocumentCopy();
          updateThemeAndLangButtons();
          render();
        }
      });
    }
  }

  async function registerImageToProject(projectId, result) {
    var file = await resultToFile(result);
    await NK.api.imageUpload(projectId, file);
  }
  async function registerImageToBrand(brandId, selectedToken, result) {
    var brandRecord = state.currentBrand;
    if (NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      brandRecord = await NK.service.brand.hydrateFromServer(state.currentBrand.brandId, { force: true, ttlMs: 0 }) || brandRecord;
    }
    var currentSheets = cloneJson((brandRecord && brandRecord.characterSheets) || [], []);
    var currentCharacters = Array.isArray(brandRecord && brandRecord.knowledgeCharacters) ? brandRecord.knowledgeCharacters : [];
    var matchedCharacter = currentCharacters.find(function (item) {
      return String(normalizeCharacterToken(item && (item.token || item.displayName || item.name))) === String(selectedToken);
    }) || null;
    var displayName = normalizeCharacterName(matchedCharacter && (matchedCharacter.displayName || matchedCharacter.name || selectedToken)) || normalizeCharacterName(selectedToken);
    var entry = currentSheets.find(function (item) {
      return String(normalizeCharacterToken(item && (item.token || item.displayName || item.name))) === String(selectedToken);
    });
    if (!entry) {
      entry = {
        characterId: String(matchedCharacter && (matchedCharacter.characterId || matchedCharacter.id) || ('char_' + Date.now())).trim(),
        displayName: displayName,
        token: selectedToken,
        items: []
      };
      currentSheets.push(entry);
    }
    entry.displayName = entry.displayName || displayName;
    entry.token = entry.token || selectedToken;
    entry.items = Array.isArray(entry.items) ? entry.items.slice() : [];
    entry.items.unshift({
      sheetId: 'sheet_' + Date.now(),
      imageDataUrl: await resultToDataUrl(result),
      isPrimary: entry.items.length ? false : true
    });
    entry.items = entry.items.slice(0, 4);
    if (!entry.items.some(function (item) { return item && item.isPrimary; }) && entry.items[0]) {
      entry.items[0].isPrimary = true;
    }
    var savedBrand = null;
    if (NK.service && NK.service.brand && NK.service.brand.persistShared) {
      savedBrand = await NK.service.brand.persistShared(state.currentBrand.brandId, {
        characterSheets: currentSheets
      });
    } else if (NK.api && NK.api.brandSave) {
      var nextBrandPayload = Object.assign({}, cloneJson(brandRecord || {}, {}), { characterSheets: currentSheets });
      var response = await NK.api.brandSave(state.currentBrand.brandId, nextBrandPayload);
      savedBrand = response && response.brand ? response.brand : nextBrandPayload;
    } else {
      throw new Error('brand_save_unavailable');
    }
    return savedBrand;
  }
  ui.init = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
