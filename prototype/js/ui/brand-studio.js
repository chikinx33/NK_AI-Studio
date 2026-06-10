; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var brandStudio = ui.brandStudio || (ui.brandStudio = {});

  // 렌더 저장소 캐시: projectId → [{name, size}]
  var _renderStorageCache = {};
  // AI 시네마 자산 캐시: projectId → [{name, signedUrl?, contentType?, ...}]
  // AI 영상 생성(ai-video-gen)과 AI 이미지 생성(ai-image)에서 만든 GCS 자산을
  // 브랜드 스튜디오 "01 자산" 섹션에 노출하기 위함.
  var _videoGenStorageCache = {};
  var _aiImageStorageCache = {};
  // 공유받은 프로젝트의 소유자 SNS 연결 상태(토큰 마스킹됨). projectId → { instagram:{...}, ... }
  // 전역 nk_sns_states(사용자 본인 연결) 캐시를 오염시키지 않도록 분리 보관한다.
  var _sharedSnsStatesCache = {};
  var _dtDocListener = null;
  // 배포 진행 중 상태(formatId→true). renderProject 가 재실행돼도 스피너가 유지되도록
  // 모듈 스코프에 둔다(렌더 내부 지역변수였을 때는 재렌더 시 초기화돼 스피너가 꺼졌음).
  var _deployingFormats = {};

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 복사 버튼이 달린 알림. 기존 테마 다이얼로그(NK.ui.dialog)를 그대로 사용하되 copy 옵션만 켠다.
  function bsfNotify(message) {
    try {
      if (NK.ui && NK.ui.dialog && NK.ui.dialog.alert) {
        return NK.ui.dialog.alert(message, { title: '알림', copy: true });
      }
    } catch (_) {}
    alert(String(message == null ? '' : message));
  }

  // 프록시 URL / GCS URL / gs:// URI에서 GCS 오브젝트 경로를 추출
  function extractGcsObjectName(url) {
    var u = String(url || '').trim();
    if (!u) return '';
    // /api/media/proxy?objectName=... 형식
    if (u.indexOf('/api/media/proxy') !== -1 && u.indexOf('objectName=') !== -1) {
      try {
        var qIdx = u.indexOf('?');
        var query = qIdx >= 0 ? u.slice(qIdx + 1) : u;
        var params = new URLSearchParams(query);
        return String(params.get('objectName') || '').trim();
      } catch (_) {}
    }
    // https://storage.googleapis.com/bucket/path 형식
    if (u.indexOf('storage.googleapis.com') >= 0) {
      try {
        var parsed = new URL(u);
        var path = String(parsed.pathname || '').replace(/^\/+/, '');
        var firstSlash = path.indexOf('/');
        return firstSlash >= 0 ? decodeURIComponent(path.slice(firstSlash + 1)) : '';
      } catch (_) {}
    }
    // gs://bucket/path 형식
    if (u.indexOf('gs://') === 0) {
      var rest = u.slice(5);
      var slash = rest.indexOf('/');
      return slash >= 0 ? rest.slice(slash + 1) : '';
    }
    return '';
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

  function getPageScrollContainer(node) {
    var current = node;
    while (current) {
      if (current.classList && current.classList.contains('bsf-format-draft-panel')) return current;
      if (current.classList && current.classList.contains('main-body')) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function scrollNodeIntoPageView(node, align) {
    if (!node) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var scroller = getPageScrollContainer(node);
        var topMargin = 20;
        var bottomMargin = 20;
        var rect = node.getBoundingClientRect();
        var scrollerRect = scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight || 0 }
          : scroller.getBoundingClientRect();
        var deltaTop = rect.top - (scrollerRect.top + topMargin);
        var deltaBottom = rect.bottom - (scrollerRect.bottom - bottomMargin);
        var targetDelta = 0;
        if (align === 'start') {
          targetDelta = deltaTop;
        } else if (align === 'bottom') {
          targetDelta = deltaBottom > 0 ? deltaBottom : 0;
        } else if (deltaTop < 0) {
          targetDelta = deltaTop;
        } else if (deltaBottom > 0) {
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

  function scrollDisclosureIntoView(disclosure) {
    if (!disclosure || !disclosure.open) return;
    scrollNodeIntoPageView(disclosure, 'bottom');
  }

  function readDisclosureOpen(root, key, fallback) {
    var state = root && root.__brandStudioDisclosureState && typeof root.__brandStudioDisclosureState === 'object'
      ? root.__brandStudioDisclosureState
      : null;
    if (state && Object.prototype.hasOwnProperty.call(state, key)) return !!state[key];
    return !!fallback;
  }

  function bindDisclosureState(root) {
    if (!root) return;
    if (NK.ui && NK.ui.common && typeof NK.ui.common.bindDisclosureMotion === 'function') {
      NK.ui.common.bindDisclosureMotion(root);
    }
    var state = root.__brandStudioDisclosureState && typeof root.__brandStudioDisclosureState === 'object'
      ? root.__brandStudioDisclosureState
      : (root.__brandStudioDisclosureState = {});
    var disclosures = root.querySelectorAll ? root.querySelectorAll('.brand-studio-disclosure[data-disclosure-id]') : [];
    Array.prototype.forEach.call(disclosures, function (disclosure) {
      var key = String(disclosure.getAttribute('data-disclosure-id') || '').trim();
      if (!key) return;
      state[key] = disclosure.open;
      disclosure.ontoggle = function () {
        state[key] = disclosure.open;
      };
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

  function captureFieldValueState(root) {
    var state = {};
    var fields = root && root.querySelectorAll
      ? root.querySelectorAll('textarea, input, select')
      : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      if (!key) return;
      var type = String(field.type || '').toLowerCase();
      state[key] = {
        type: type,
        value: type === 'checkbox' || type === 'radio' ? '' : String(field.value || ''),
        checked: !!field.checked
      };
    });
    return state;
  }

  function restoreFieldValueState(root, state) {
    if (!root || !state) return;
    var fields = root.querySelectorAll ? root.querySelectorAll('textarea, input, select') : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      var saved = key ? state[key] : null;
      if (!saved) return;
      if (saved.type === 'checkbox' || saved.type === 'radio') {
        field.checked = !!saved.checked;
        return;
      }
      field.value = String(saved.value || '');
    });
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

  function triggerIpAssetHydration(root, brandId, brand, fallbackProject) {
    if (!root || !brandId || !NK.service || !NK.service.contentLibrary || !NK.service.contentLibrary.loadIpAssetsForBrand) return;
    var state = root.__brandStudioIpLoadState && typeof root.__brandStudioIpLoadState === 'object'
      ? root.__brandStudioIpLoadState
      : (root.__brandStudioIpLoadState = {});
    if (state.pending && state.brandId === brandId) return;
    if (state.loaded && state.brandId === brandId) return;
    state.brandId = brandId;
    state.pending = true;
    NK.service.contentLibrary.loadIpAssetsForBrand(brand || { brandId: brandId })
      .then(function () {
        state.loaded = true;
        var currentProject = NK.service && NK.service.project && NK.service.project.resolveCurrent
          ? NK.service.project.resolveCurrent({ search: window.location.search })
          : null;
        var nextProject = currentProject && currentProject.id ? currentProject : fallbackProject;
        if (!nextProject || !nextProject.id) return;
        var nextBrandId = String(nextProject && nextProject.payload && nextProject.payload.brandId || brandId).trim();
        var nextBrand = NK.service && NK.service.brand && NK.service.brand.getById && nextBrandId
          ? NK.service.brand.getById(nextBrandId)
          : null;
        var active = document.activeElement;
        var isEditingField = !!(active && root.contains(active) && active.matches && active.matches('input, textarea, select'));
        if (isEditingField) {
          state.deferred = {
            project: nextProject,
            brand: nextBrand || brand
          };
          return;
        }
        renderProject(root, nextProject, nextBrand || brand);
      })
      .catch(function () {})
      .finally(function () {
        state.pending = false;
      });
  }

  function flushDeferredHydrationRender(root) {
    var state = root && root.__brandStudioIpLoadState && typeof root.__brandStudioIpLoadState === 'object'
      ? root.__brandStudioIpLoadState
      : null;
    if (!state || !state.deferred) return;
    var active = document.activeElement;
    var isEditingField = !!(active && root.contains(active) && active.matches && active.matches('input, textarea, select'));
    if (isEditingField) return;
    var deferred = state.deferred;
    state.deferred = null;
    renderProject(root, deferred.project, deferred.brand);
  }

  function bindDeferredHydrationFlush(root) {
    if (!root || root.__brandStudioDeferredFlushBound) return;
    root.__brandStudioDeferredFlushBound = true;
    root.addEventListener('focusout', function () {
      window.requestAnimationFrame(function () {
        flushDeferredHydrationRender(root);
      });
    });
  }

  function readBrandView(brand, project) {
    var payload = (project && project.payload) || {};
    var src = brand && typeof brand === 'object' ? brand : {};
    return {
      brandId: String(src.brandId || payload.brandId || '').trim(),
      title: String(src.brandTitle || payload.brandTitle || project && (project.seriesTitle || project.title) || '브랜드').trim(),
      // IP 대표 로고: 브랜드 엔티티 우선, 없으면 레거시 프로젝트 썸네일.
      logoObjectName: String(src.brandLogoObjectName || payload.thumbnailObjectName || '').trim(),
      summary: String(src.brandSummary || payload.brandSummary || '').trim(),
      coreMessage: String(src.coreMessage || payload.coreMessage || '').trim(),
      targetAudience: String(src.targetAudience || payload.targetAudience || payload.target || '').trim(),
      brandKeywords: Array.isArray(src.brandKeywords) ? src.brandKeywords.slice() : toTagList(payload.brandKeywords)
    };
  }

  function readBrandContentType(payload) {
    return String(payload && payload.brandStudioContentType || '').trim();
  }

  function readCaptionDraft(payload) {
    return String(payload && payload.brandStudioCaptionDraft || '').trim();
  }

  function readHashtagDraft(payload) {
    return String(payload && payload.brandStudioHashtagDraft || '').trim();
  }

  // 레거시 포맷 id 마이그레이션: 통합 'x-threads' → 'threads'(활성 발행 채널).
  // 기존 프로젝트에 저장된 선택/초안이 분리 후에도 유실되지 않도록 한다.
  function _migrateFormatId(id) {
    return id === 'x-threads' ? 'threads' : id;
  }

  function readSelectedFormats(payload) {
    var src = payload && Array.isArray(payload.brandStudioSelectedFormats)
      ? payload.brandStudioSelectedFormats
      : [];
    var out = [];
    src.forEach(function (item) {
      var id = _migrateFormatId(String(item || '').trim());
      if (id && out.indexOf(id) === -1) out.push(id);
    });
    return out;
  }

  function readFormatDrafts(payload) {
    var src = payload && payload.brandStudioFormatDrafts && typeof payload.brandStudioFormatDrafts === 'object'
      ? payload.brandStudioFormatDrafts
      : {};
    var out = {};
    Object.keys(src).forEach(function (k) {
      out[_migrateFormatId(k)] = src[k];
    });
    return out;
  }

  function readDeployedFormats(payload, projectId) {
    // Dedicated local key takes full precedence — immune to server-merge race conditions
    // and draft-size eviction of nk_scenario_drafts_v1. Falls back to payload when
    // the key is absent (e.g. first load on a new device).
    if (projectId) {
      try {
        var raw = localStorage.getItem('nk_bs_deployed_' + projectId);
        if (raw !== null) {
          var stored = JSON.parse(raw);
          if (stored && typeof stored === 'object') return Object.assign({}, stored);
        }
      } catch (_) {}
    }
    var src = payload && payload.brandStudioDeployedFormats && typeof payload.brandStudioDeployedFormats === 'object'
      ? payload.brandStudioDeployedFormats
      : {};
    return Object.assign({}, src);
  }

  function readActiveDraftTab(payload) {
    return _migrateFormatId(String(payload && payload.brandStudioActiveDraftTab || '').trim());
  }

  function readSelectedAssetIds(payload) {
    var src = payload && Array.isArray(payload.brandStudioSelectedAssetIds)
      ? payload.brandStudioSelectedAssetIds
      : [];
    return src.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
  }

  function readAssetTypeFilter(payload) {
    return String(payload && payload.brandStudioAssetTypeFilter || 'all').trim() || 'all';
  }

  function readAssetProjectFilter(payload) {
    return String(payload && payload.brandStudioAssetProjectFilter || 'all').trim() || 'all';
  }

  function readAutoSuggestion(payload) {
    var src = payload && payload.brandStudioAutoSuggestion && typeof payload.brandStudioAutoSuggestion === 'object'
      ? payload.brandStudioAutoSuggestion
      : null;
    if (!src) return null;
    return {
      id: String(src.id || '').trim(),
      title: String(src.title || '').trim(),
      targetChannel: String(src.targetChannel || '').trim(),
      recommendedTime: String(src.recommendedTime || '').trim(),
      reason: String(src.reason || '').trim()
    };
  }

  function readKnowledge(payload) {
    var hasNested = !!(payload && payload.knowledgeHub && typeof payload.knowledgeHub === 'object');
    var src = hasNested
      ? payload.knowledgeHub
      : payload || {};
    var legacyBanned = !hasNested && !String(payload && (payload.manualDirectives || payload.extraNotes) || '').trim()
      ? src.banned
      : '';
    return {
      brandVoice: String(src.brandVoice || '').trim(),
      brandStory: String(src.brandStory || '').trim(),
      brandCharacter: String(src.brandCharacter || '').trim(),
      worldSetting: String(src.worldSetting || src.knowledgeWorld || '').trim(),
      brandRules: toTagList(src.brandRules),
      bannedExpressions: toTagList(src.bannedExpressions || legacyBanned),
      referenceContents: toTagList(src.referenceContents),
      successCases: toTagList(src.successCases)
    };
  }

  function readChannelConnections(brand, payload) {
    var brandChannels = brand && Array.isArray(brand.connectedChannels) ? brand.connectedChannels : [];
    var projectChannels = payload && Array.isArray(payload.brandStudioChannels) ? payload.brandStudioChannels : [];
    var src = brandChannels.length ? brandChannels : projectChannels;
    return src.map(function (item) {
      return {
        channelType: String(item && item.channelType || '').trim(),
        accountName: String(item && item.accountName || '').trim(),
        status: String(item && (item.status || item.authStatus) || 'connected').trim() || 'connected'
      };
    }).filter(function (item) { return item.channelType; });
  }

  function readPublishPlan(brand, payload) {
    var plan = brand && brand.brandStudioPublishPlan && typeof brand.brandStudioPublishPlan === 'object'
      ? brand.brandStudioPublishPlan
      : (payload && payload.brandStudioPublishPlan && typeof payload.brandStudioPublishPlan === 'object'
      ? payload.brandStudioPublishPlan
      : null);
    if (!plan) {
      return { channels: [], scheduledAt: '', status: '' };
    }
    return {
      channels: Array.isArray(plan.channels)
        ? plan.channels.map(function (item) { return String(item || '').trim(); }).filter(Boolean)
        : [],
      scheduledAt: String(plan.scheduledAt || '').trim(),
      status: String(plan.status || '').trim(),
      contentType: String(plan.contentType || '').trim()
    };
  }

  function readPublishResults(brand, payload) {
    var src = brand && Array.isArray(brand.brandStudioPublishResults)
      ? brand.brandStudioPublishResults
      : (payload && Array.isArray(payload.brandStudioPublishResults)
      ? payload.brandStudioPublishResults
      : (payload && Array.isArray(payload.publishResults) ? payload.publishResults : []));
    return src.map(function (item, index) {
      var raw = item && typeof item === 'object' ? item : {};
      var metrics = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
      return {
        id: String(raw.id || ('publish_' + (index + 1))).trim(),
        channelType: String(raw.channelType || raw.channel || '').trim(),
        contentType: String(raw.contentType || '').trim(),
        status: String(raw.status || 'published').trim() || 'published',
        publishedAt: String(raw.publishedAt || raw.capturedAt || '').trim(),
        remotePostId: String(raw.remotePostId || raw.postId || '').trim(),
        title: String(raw.title || '').trim(),
        note: String(raw.note || '').trim(),
        metrics: {
          views: Math.max(0, Number(metrics.views || 0) || 0),
          likes: Math.max(0, Number(metrics.likes || 0) || 0),
          comments: Math.max(0, Number(metrics.comments || 0) || 0),
          shares: Math.max(0, Number(metrics.shares || 0) || 0),
          clicks: Math.max(0, Number(metrics.clicks || 0) || 0)
        }
      };
    }).filter(function (item) {
      return item.channelType || item.remotePostId || item.title;
    });
  }

  function firstFilled(values) {
    var src = Array.isArray(values) ? values : [];
    for (var i = 0; i < src.length; i++) {
      var value = String(src[i] || '').trim();
      if (value) return value;
    }
    return '';
  }

  function toTagList(value) {
    if (Array.isArray(value)) {
      return value.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
    }
    return String(value || '')
      .split(/[,\n]/)
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean);
  }

  function normalizeHashtagToken(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    raw = raw.replace(/^#+/, '').replace(/\s+/g, '').replace(/[^0-9A-Za-z가-힣_]+/g, '');
    if (!raw) return '';
    if (raw.length < 2 || raw.length > 18) return '';
    return '#' + raw;
  }

  function splitHashtagKeywordCandidates(value) {
    var text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return [];
    if (text.length <= 18 && !/[.!?]/.test(text)) return [text];
    return text
      .split(/[,\n/|]/)
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean)
      .reduce(function (acc, item) {
        item.split(/\s+/).forEach(function (token) {
          token = String(token || '').trim();
          if (token && token.length >= 2 && token.length <= 18) acc.push(token);
        });
        return acc;
      }, []);
  }

  function parseHashtagTokens(value) {
    return String(value || '')
      .split(/[\s,\n]+/)
      .map(normalizeHashtagToken)
      .filter(Boolean);
  }

  function episodeLabel(project) {
    return String(project && (project.title || project.payload && project.payload.episodeTitle || project.seriesTitle || project.id) || '').trim() || '미지정 에피소드';
  }

  function compactSentence(value, maxLength) {
    var text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    var limit = Number(maxLength) || 120;
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(limit - 1, 1)).trim() + '…';
  }

  function summarizeList(list, emptyLabel, limit) {
    var rows = Array.isArray(list) ? list : [];
    if (!rows.length) return String(emptyLabel || '아직 없음');
    if (rows.length === 1) return compactSentence(rows[0], limit || 60);
    return rows.length + '개 · ' + compactSentence(rows[0], limit || 52);
  }

  function scrubBannedText(text, bannedExpressions) {
    var output = String(text || '');
    toTagList(bannedExpressions).forEach(function (term) {
      var token = String(term || '').trim();
      if (!token) return;
      output = output.split(token).join('');
    });
    return output.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  function buildEpisodeStory(payload, scenes) {
    var parts = [];
    function mv(v) { return String(v || '').trim(); }
    function firstArr(v) { return Array.isArray(v) ? mv(v[0]) : mv(v); }

    var epTitle = mv(payload.episodeTitle || payload.topic || payload.seriesTitle);
    if (epTitle) parts.push('에피소드: ' + epTitle);

    var meta = [];
    var genre    = mv(payload.purposeCategory);
    var subgenre = firstArr(payload.purposeTag || payload.purposeTags);
    var needs    = firstArr(payload.needs || payload.need);
    var tone     = firstArr(payload.tones || payload.tone);
    var style    = mv(payload.style);
    var duration = mv(payload.duration);
    if (genre)    meta.push('장르: ' + genre);
    if (subgenre) meta.push('세부장르: ' + subgenre);
    if (needs)    meta.push('시청 목적: ' + needs);
    if (tone)     meta.push('톤: ' + tone);
    if (style)    meta.push('스타일: ' + style);
    if (duration) meta.push('영상 길이: ' + duration + '초');
    if (meta.length) parts.push(meta.join(' / '));

    var story = mv(payload.story || payload.storyPrompt);
    if (story) parts.push('스토리: ' + story);

    if (Array.isArray(scenes) && scenes.length) {
      var sceneLines = scenes.slice(0, 8).map(function (sc, i) {
        var narr = mv(sc.narration);
        var dial = Array.isArray(sc.dialogue)
          ? sc.dialogue.map(function (d) { return mv(d.line || d.text || d); }).filter(Boolean).join(' / ')
          : '';
        if (!narr && !dial) return null;
        return '씬' + (i + 1) + (narr ? ' 나레이션: ' + narr : '') + (dial ? ' 대사: ' + dial : '');
      }).filter(Boolean);
      if (sceneLines.length) parts.push(sceneLines.join('\n'));
    }

    return parts.join('\n\n');
  }

  function buildBrandContext(payload, brandView, knowledge) {
    var sections = [];

    // ── 브랜드 기본 정보 ──────────────────────────────────
    var brandName = firstFilled([
      brandView && brandView.title,
      payload && payload.brandName,
    ]);
    if (brandName) sections.push('브랜드명: ' + brandName);

    var summary = firstFilled([
      brandView && brandView.summary,
      payload && payload.brandSummary,
    ]);
    if (summary) sections.push('브랜드 요약: ' + summary);

    var coreMsg = firstFilled([
      brandView && brandView.coreMessage,
      payload && payload.coreMessage,
    ]);
    if (coreMsg) sections.push('핵심 메시지: ' + coreMsg);

    var target = firstFilled([
      brandView && brandView.targetAudience,
      payload && payload.targetAudience,
      payload && payload.target,
    ]);
    if (target) sections.push('타겟 오디언스: ' + target);

    var keywords = (brandView && brandView.brandKeywords)
      || (payload && payload.brandKeywords);
    if (Array.isArray(keywords) && keywords.length) {
      sections.push('브랜드 키워드: ' + keywords.join(', '));
    }

    // ── 브랜드 심층 정보 (knowledge) ─────────────────────
    if (knowledge) {
      if (knowledge.brandVoice)
        sections.push('톤앤매너: ' + knowledge.brandVoice);

      if (knowledge.brandCharacter)
        sections.push('브랜드 캐릭터: ' + knowledge.brandCharacter);

      var charList = Array.isArray(knowledge.characters) ? knowledge.characters : [];
      if (!charList.length && Array.isArray(brandView && brandView.knowledgeCharacters))
        charList = brandView.knowledgeCharacters;
      if (charList.length) {
        var charLines = charList.slice(0, 8).map(function (c) {
          var name = String(c.displayName || c.name || '').trim();
          var desc = String(c.personality || c.description || c.profile || '').trim();
          return name + (desc ? ': ' + desc : '');
        }).filter(Boolean);
        if (charLines.length)
          sections.push('캐릭터 자산 (콘텐츠에서 캐릭터를 표현할 경우 참고):\n' + charLines.map(function (l) { return '- ' + l; }).join('\n'));
      }

      if (knowledge.brandStory)
        sections.push('브랜드 스토리: ' + knowledge.brandStory);

      if (knowledge.worldSetting)
        sections.push('세계관: ' + knowledge.worldSetting);

      if (Array.isArray(knowledge.brandRules) && knowledge.brandRules.length)
        sections.push('브랜드 룰: ' + knowledge.brandRules.join(' / '));

      if (Array.isArray(knowledge.bannedExpressions) && knowledge.bannedExpressions.length)
        sections.push('금칙어 (절대 사용 금지): ' + knowledge.bannedExpressions.join(', '));

      if (Array.isArray(knowledge.successCases) && knowledge.successCases.length)
        sections.push('성공 사례 참고: ' + knowledge.successCases.slice(0, 2).join(' / '));
    }

    return sections.join('\n');
  }

  function buildCaptionDraft(project, brandView, selectedOption, sourceTexts, knowledge) {
    var payload = (project && project.payload) || {};
    var fmtId = String(selectedOption && selectedOption.id || '');

    var storyText  = String(payload.story || payload.storyPrompt || '').trim();
    var brandName  = firstFilled([brandView && brandView.title, payload.brandName]);
    var coreMsg    = firstFilled([brandView && brandView.coreMessage, payload.coreMessage]);
    var target     = firstFilled([brandView && brandView.targetAudience, payload.targetAudience, payload.target]);

    // 타겟 기반 톤 힌트 (규칙 기반 fallback용)
    var toneHint = '';
    if (target) {
      if (/유아|아이|어린이|키즈/.test(target))    toneHint = '따뜻하고 귀엽게';
      else if (/10대|청소년/.test(target))          toneHint = '트렌디하고 친근하게';
      else if (/20대|30대|직장/.test(target))       toneHint = '공감하기 쉽게';
      else if (/40대|50대|중장년/.test(target))     toneHint = '신뢰감 있고 따뜻하게';
      else if (/B2B|기업|비즈니스/.test(target))    toneHint = '전문적이고 인사이트 있게';
    }

    function firstSentence(text) {
      var m = String(text || '').match(/[^.!?。\n]+[.!?。]?/);
      return m ? m[0].trim() : compactSentence(text, 80);
    }

    var parts = [];

    switch (fmtId) {
      case 'naver-blog':
      case 'facebook':
      case 'band':
        if (storyText) parts.push(storyText);
        if (coreMsg)   parts.push('\n\n' + coreMsg);
        break;

      case 'linkedin':
        if (storyText) parts.push(storyText);
        if (coreMsg)   parts.push('\n\n' + coreMsg);
        if (toneHint)  parts.push('\n\n— ' + (brandName || '') + ' | ' + toneHint);
        break;

      case 'youtube':
        if (storyText) parts.push(storyText);
        if (brandName) parts.push('\n\n─\n' + brandName);
        if (coreMsg)   parts.push('\n' + coreMsg);
        break;

      case 'youtube-shorts':
      case 'tiktok':
        var hook = firstSentence(storyText);
        if (hook)         parts.push(hook);
        else if (coreMsg) parts.push(coreMsg);
        break;

      case 'threads':
        parts.push(compactSentence(storyText || coreMsg, 450));
        break;

      case 'x':
        parts.push(compactSentence(storyText || coreMsg, 250));
        break;

      case 'naver-post':
      case 'pinterest':
        parts.push(compactSentence(storyText || coreMsg, 120));
        break;

      case 'kakao':
        var kakaoText = firstSentence(storyText) || coreMsg;
        parts.push(compactSentence(kakaoText, 150));
        break;

      default:
        // Instagram 등
        parts.push(compactSentence(storyText || coreMsg, 160));
    }

    var result = parts.join('').trim();

    if (knowledge && knowledge.bannedExpressions) {
      result = scrubBannedText(result, knowledge.bannedExpressions);
    }

    return result;
  }

  function buildHashtagDraft(project, brandView, selectedOption, sourceTexts, knowledge) {
    var payload   = (project && project.payload) || {};
    var fmtId     = String(selectedOption && selectedOption.id || '');
    var brandName = firstFilled([brandView && brandView.title, payload.brandName]);

    var keywords = [].concat(
      Array.isArray(brandView && brandView.brandKeywords) ? brandView.brandKeywords : [],
      Array.isArray(payload.brandKeywords) ? payload.brandKeywords : [],
      Array.isArray(payload.purposeTags)   ? payload.purposeTags   : []
    );

    // 중복 제거
    keywords = keywords.filter(function (k, i, arr) {
      return k && arr.indexOf(k) === i;
    });

    // 플랫폼별 해시태그 수
    var maxTags = ({
      'instagram':      13,
      'naver-blog':     10,
      'youtube':         7,
      'youtube-shorts':  6,
      'tiktok':          4,
      'facebook':        4,
      'linkedin':        4,
      'pinterest':       8,
      'threads':         5,
      'x':               3,
      'naver-post':      6,
      'kakao':           4,
      'band':            4,
    })[fmtId] || 5;

    var tags = [];

    function pushTag(raw) {
      var t = normalizeHashtagToken(raw);
      if (!t) return;
      if (tags.indexOf(t) === -1) tags.push(t);
    }

    // 브랜드명 태그 (항상 첫 번째)
    if (brandName) pushTag(brandName);

    // 플랫폼 필수 태그
    if (fmtId === 'tiktok' || fmtId === 'youtube-shorts') pushTag('fyp');
    if (fmtId === 'youtube-shorts') pushTag('Shorts');

    // 키워드 태그
    keywords.forEach(function (k) {
      if (tags.length >= maxTags) return;
      pushTag(k);
    });

    var result = tags.slice(0, maxTags).join(' ');

    if (knowledge && knowledge.bannedExpressions) {
      result = scrubBannedText(result, knowledge.bannedExpressions);
    }

    return result;
  }

  function currentLanguage() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }

  function buildHashtagRequestPayload(project, brandView, selectedOption, sourceTexts, knowledge) {
    var payload = (project && project.payload) || {};
    return {
      language: currentLanguage(),
      brandTitle: brandView.title || '',
      brandSummary: brandView.summary || payload.brandSummary || '',
      coreMessage: brandView.coreMessage || payload.coreMessage || '',
      targetAudience: brandView.targetAudience || payload.targetAudience || payload.target || '',
      contentType: selectedOption && selectedOption.title ? selectedOption.title : (payload.brandStudioContentType || ''),
      brandKeywords: brandView.brandKeywords && brandView.brandKeywords.length
        ? brandView.brandKeywords.slice(0, 6)
        : toTagList(payload.brandKeywords).slice(0, 6),
      sourceTexts: (Array.isArray(sourceTexts) ? sourceTexts : []).slice(0, 6),
      knowledgeHub: {
        brandVoice: knowledge.brandVoice || '',
        brandStory: knowledge.brandStory || '',
        brandCharacter: knowledge.brandCharacter || '',
        worldSetting: knowledge.worldSetting || '',
        brandRules: toTagList(knowledge.brandRules).slice(0, 8),
        bannedExpressions: toTagList(knowledge.bannedExpressions).slice(0, 12),
        referenceContents: toTagList(knowledge.referenceContents).slice(0, 6),
        successCases: toTagList(knowledge.successCases).slice(0, 6)
      }
    };
  }

  function buildAutoSetupPayload(project, brandView, selectedFormats, sourceTexts, knowledge, selectedAssetIds, autoSelectedAssetIds) {
    var formats = channelFormats();
    var targetFormats = (selectedFormats && selectedFormats.length) ? selectedFormats : ['instagram', 'threads'];
    var formatDrafts = {};
    targetFormats.forEach(function (formatId) {
      var fmt = formats.find(function (f) { return f.id === formatId; }) || null;
      formatDrafts[formatId] = {
        caption: buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge),
        hashtags: buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge)
      };
    });
    return {
      brandStudioSelectedFormats: targetFormats,
      brandStudioFormatDrafts: formatDrafts,
      brandStudioActiveDraftTab: targetFormats[0] || '',
      brandStudioSelectedAssetIds: selectedAssetIds && selectedAssetIds.length ? selectedAssetIds.slice() : (autoSelectedAssetIds || []).slice()
    };
  }

  // ── 로케일 텍스트 맵 ──────────────────────────────────────────────────────
  function bsfT(isEn) {
    if (!isEn) return {
      eyebrow: '브랜드 운영', oneClickDraft: '원스탑<br>진행',
      stepAsset: '자산', stepFormat: '포맷', stepDraft: '초안', stepPublish: '배포',
      stepValNoFormat: '포맷 없음', stepValDrafted: '작성됨', stepValNeedsDraft: '작성 필요',
      stepValChannels: function (n) { return n + '개 채널'; },
      stepValSelected: function (n) { return n + '개 선택'; }, stepValNone: '미선택',
      stepItemsVal: function (n) { return n + '개 있음'; },
      ctrlNoSelection: '선택 없음', ctrlNSelected: function (n) { return n + '개 선택됨'; },
      ctrlClearSel: '선택 비우기', ctrlToFormat: '포맷 선택으로 →',
      ctrlNFormats: function (n) { return n + '개 포맷 선택됨'; },
      ctrlSelectFormat: '포맷을 선택하세요', ctrlToDraft: '초안 작성으로 →',
      ctrlAutoGen: '원클릭<br>초안', ctrlSave: '저장', ctrlToPublish: '배포 설정으로 →',
      draftRegen: '스토리로 재생성', draftStructLabel: '블로그 구조 미리보기',
      ctrlNChannelsReady: function (n) { return n + '개 채널에 배포 준비'; },
      ctrlPublishAll: '전체 배포',
      head01: '01 — 자산', head01sub: '배포에 사용할 자산을 선택하세요',
      head02: '02 — 포맷', head02sub: '배포할 플랫폼을 복수로 선택하세요',
      head03: '03 — 초안', head03sub: '각 플랫폼별 문구를 작성하세요',
      head04: '04 — 배포', head04sub: '선택한 모든 채널에 일괄 배포합니다',
      cardStory: '스토리', cardImage: '이미지', cardVideo: '영상',
      metaGenre: '장르', metaSubgenre: '세부장르', metaPurpose: '시청 목적',
      metaLength: '영상 길이', metaAspect: '화면 비율', metaTone: '톤', metaStyle: '스타일',
      durationSuffix: '초',
      btnSelect: '선택', btnDeselect: '선택 해제',
      hintStory: '시나리오를 작성하면\n스토리가 표시됩니다.', hintImage: '이미지 생성 후\n표시됩니다.',
      hintVideo: '영상 렌더링 후\n표시됩니다.', hintNoFormat: '포맷을 먼저 선택해 주세요.',
      hintNoDraft: '초안을 먼저 작성해 주세요.',
      labelTitle: '제목', labelCaption: '캡션', labelHashtag: '해시태그',
      placeholderTitle: '콘텐츠 제목', placeholderCaption: '캡션을 작성하세요.',
      placeholderHashtag: '#해시태그', placeholderSchedule: '예약 시각 (선택)',
      brandSummaryHint: '브랜드 요약을 먼저 입력하면 Brand Studio 품질이 올라갑니다.',
      fmtDescs: {
        'instagram': '피드·릴스·스토리 중심 이미지·영상 SNS',
        'youtube-shorts': '세로형 쇼츠·영상 업로드 및 설명 운영',
        'tiktok': '짧은 영상 중심 빠른 확산 채널',
        'threads': '짧은 글 중심 실시간 대화형 채널 (최대 500자)',
        'x': '짧은 글·링크 중심 실시간 확산 채널 (최대 280자)',
        'naver-blog': '검색 노출 기반 블로그 콘텐츠 채널',
        'kakao': '카카오채널·카카오스토리 운영',
        'facebook': '피드·릴스·그룹·페이지 브랜드 운영 채널',
        'linkedin': 'B2B 아티클·피드·뉴스레터 전문 채널',
        'pinterest': '이미지 핀 중심 비주얼 콘텐츠 채널',
        'youtube': '롱폼 영상·튜토리얼·리뷰 운영 채널',
        'naver-post': '모바일 카드뉴스·매거진형 콘텐츠 채널',
        'band': '팬 커뮤니티·소모임 중심 운영 채널'
      },
      alertSaveFormatFail: function (e) { return '포맷 선택 저장 실패: ' + e; },
      savingLabel: '저장 중…',
      oneClickLoadingLabel: '원클릭 초안 생성 중…',
      alertDraftSaved: '초안을 저장했습니다.',
      alertDraftSaveFail: function (e) { return '초안 저장 실패: ' + e; },
      alertDraftGenFail: function (e) { return '초안 생성 실패: ' + e; },
      alertOneClickFail: function (e) { return '원클릭 초안 생성 실패: ' + e; },
      alertPublishSaved: function (n) { return n + '개 포맷에 배포 계획을 저장했습니다.'; },
      alertPublishFail: function (e) { return '배포 실패: ' + e; },
      alertPublishSuccess: function (label) { return label + ' 배포 완료!'; },
      alertPublishProcessing: function (label) { return label + ' 배포 요청 완료 — 채널에서 처리 중입니다. 잠시 후 계정에서 게시물을 확인하세요.'; },
      alertPublishAllDone: function (n) { return n + '개 채널 배포 요청을 완료했습니다.'; },
      alertAssetSaveFail: function (e) { return '자산 선택 저장 실패: ' + e; },
      alertAssetResetFail: function (e) { return '선택 자산 초기화 실패: ' + e; }
    };
    return {
      eyebrow: 'Brand Operations', oneClickDraft: 'One-Stop',
      stepAsset: 'Assets', stepFormat: 'Format', stepDraft: 'Draft', stepPublish: 'Publish',
      stepValNoFormat: 'No format', stepValDrafted: 'Written', stepValNeedsDraft: 'Needs draft',
      stepValChannels: function (n) { return n + ' channels'; },
      stepValSelected: function (n) { return n + ' selected'; }, stepValNone: 'None',
      stepItemsVal: function (n) { return n + ' items'; },
      ctrlNoSelection: 'No selection', ctrlNSelected: function (n) { return n + ' selected'; },
      ctrlClearSel: 'Clear selection', ctrlToFormat: 'To Format →',
      ctrlNFormats: function (n) { return n + ' format' + (n === 1 ? '' : 's') + ' selected'; },
      ctrlSelectFormat: 'Select a format', ctrlToDraft: 'To Draft →',
      ctrlAutoGen: 'One-Click Draft', ctrlSave: 'Save', ctrlToPublish: 'To Publish →',
      draftRegen: 'Regenerate from Story', draftStructLabel: 'Blog Structure Preview',
      ctrlNChannelsReady: function (n) { return n + ' channel' + (n === 1 ? '' : 's') + ' ready'; },
      ctrlPublishAll: 'Publish All',
      head01: '01 — Assets', head01sub: 'Select assets to use for deployment',
      head02: '02 — Format', head02sub: 'Select one or more platforms to publish to',
      head03: '03 — Draft', head03sub: 'Write content for each platform',
      head04: '04 — Publish', head04sub: 'Deploy to all selected channels at once',
      cardStory: 'STORY', cardImage: 'IMAGE', cardVideo: 'VIDEO',
      metaGenre: 'Genre', metaSubgenre: 'Subgenre', metaPurpose: 'Purpose',
      metaLength: 'Length', metaAspect: 'Aspect ratio', metaTone: 'Tone', metaStyle: 'Style',
      durationSuffix: 's',
      btnSelect: 'Select', btnDeselect: 'Deselect',
      hintStory: 'Write a scenario to\nsee the story here.', hintImage: 'Shown after\nimage generation.',
      hintVideo: 'Shown after\nvideo rendering.', hintNoFormat: 'Please select a format first.',
      hintNoDraft: 'Please write a draft first.',
      labelTitle: 'Title', labelCaption: 'Caption', labelHashtag: 'Hashtags',
      placeholderTitle: 'Content title', placeholderCaption: 'Write a caption.',
      placeholderHashtag: '#hashtag', placeholderSchedule: 'Scheduled time (optional)',
      brandSummaryHint: 'Enter a brand summary to improve Brand Studio quality.',
      fmtDescs: {
        'instagram': 'Feed, Reels & Stories — image & video SNS',
        'youtube-shorts': 'Vertical shorts, video uploads & descriptions',
        'tiktok': 'Short-video channel for rapid viral growth',
        'threads': 'Short-text conversational channel (up to 500 chars)',
        'x': 'Short text & link real-time distribution (up to 280 chars)',
        'naver-blog': 'Search-optimized blog content channel',
        'kakao': 'KakaoChannel & KakaoStory management',
        'facebook': 'Feed, Reels, Groups & Pages brand channel',
        'linkedin': 'B2B articles, feed & newsletter channel',
        'pinterest': 'Visual content channel focused on image pins',
        'youtube': 'Long-form videos, tutorials & reviews channel',
        'naver-post': 'Mobile card news & magazine-style content channel',
        'band': 'Fan community & interest group channel'
      },
      alertSaveFormatFail: function (e) { return 'Failed to save format: ' + e; },
      savingLabel: 'Saving…',
      oneClickLoadingLabel: 'Generating one-click drafts…',
      alertDraftSaved: 'Draft saved.',
      alertDraftSaveFail: function (e) { return 'Failed to save draft: ' + e; },
      alertDraftGenFail: function (e) { return 'Failed to generate draft: ' + e; },
      alertOneClickFail: function (e) { return 'One-click draft failed: ' + e; },
      alertPublishSaved: function (n) { return 'Publish plan saved for ' + n + ' format' + (n === 1 ? '' : 's') + '.'; },
      alertPublishFail: function (e) { return 'Publish failed: ' + e; },
      alertPublishSuccess: function (label) { return label + ' published!'; },
      alertPublishProcessing: function (label) { return label + ' publish requested — the channel is still processing it. Check your account shortly.'; },
      alertPublishAllDone: function (n) { return 'Publish requested for ' + n + ' channel' + (n === 1 ? '' : 's') + '.'; },
      alertAssetSaveFail: function (e) { return 'Failed to save asset selection: ' + e; },
      alertAssetResetFail: function (e) { return 'Failed to reset asset selection: ' + e; }
    };
  }

  function channelOptions() {
    return [
      {
        id: 'youtube',
        title: 'YouTube',
        desc: '롱폼, 쇼츠, 커뮤니티 운영까지 확장 가능한 기본 채널입니다.',
        formats: '쇼츠 · 영상 설명 · 썸네일'
      },
      {
        id: 'instagram',
        title: 'Instagram',
        desc: '이미지, 릴스, 카드형 프로모션 운영에 적합한 채널입니다.',
        formats: '피드 · 릴스 · 캡션'
      },
      {
        id: 'tiktok',
        title: 'TikTok',
        desc: '짧은 포맷 중심 확산 채널로 빠른 반응 테스트에 적합합니다.',
        formats: '짧은 영상 · 설명 문구'
      },
      {
        id: 'x',
        title: 'X',
        desc: '짧은 문장형 공지, 반응 체크, 링크 확산에 적합합니다.',
        formats: '짧은 글 · 링크 · 태그'
      }
    ];
  }

  function assetTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'text': return '스토리';
      case 'image': return '이미지';
      case 'video': return '영상';
      case 'reference': return '참조';
      case 'publish-result': return '게시 결과';
      default: return '자산';
    }
  }

  function assetPreviewText(item) {
    if (!item) return '';
    return compactSentence(firstFilled([
      item.text,
      item.title,
      item.url
    ]), 88);
  }

  function channelFormats() {
    return [
      { id: 'instagram', title: 'Instagram', desc: '피드·릴스·스토리 중심 이미지·영상 SNS', hasTitle: false },
      { id: 'youtube-shorts', title: 'YouTube Shorts', desc: '세로형 쇼츠·영상 업로드 및 설명 운영', hasTitle: true },
      { id: 'tiktok', title: 'TikTok', desc: '짧은 영상 중심 빠른 확산 채널', hasTitle: false },
      { id: 'threads', title: 'Threads', desc: '짧은 글 중심 실시간 대화형 채널', hasTitle: false },
      { id: 'x', title: 'X', desc: '짧은 글·링크 중심 실시간 확산 채널', hasTitle: false },
      { id: 'naver-blog', title: 'Naver Blog', desc: '검색 노출 기반 블로그 콘텐츠 채널', hasTitle: true },
      { id: 'kakao', title: 'Kakao', desc: '카카오채널·카카오스토리 운영', hasTitle: false },
      { id: 'facebook', title: 'Facebook', desc: '피드·릴스·그룹·페이지 브랜드 운영 채널', hasTitle: false },
      { id: 'linkedin', title: 'LinkedIn', desc: 'B2B 아티클·피드·뉴스레터 전문 채널', hasTitle: true },
      { id: 'pinterest', title: 'Pinterest', desc: '이미지 핀 중심 비주얼 콘텐츠 채널', hasTitle: true },
      { id: 'youtube', title: 'YouTube', desc: '롱폼 영상·튜토리얼·리뷰 운영 채널', hasTitle: true },
      { id: 'naver-post', title: 'Naver Post', desc: '모바일 카드뉴스·매거진형 콘텐츠 채널', hasTitle: true },
      { id: 'band', title: 'Band', desc: '팬 커뮤니티·소모임 중심 운영 채널', hasTitle: false }
    ];
  }

  // 포맷 카드/탭 제목 앞 브랜드 아이콘 (SNS 설정 카드의 아이콘과 동일 모양).
  var _FORMAT_BRAND_ICON_PATHS = {
    'instagram':      '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
    'youtube':        '<path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>',
    'youtube-shorts': '<path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-.3C16.8 4 12 4 12 4s-4.8 0-6.8.1c-.6-.1-1.9.1-3 1.2C1.3 6.2 1 8 1 8S.7 10 .7 12v1.9c0 2 .3 4 .3 4s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.3 22 12 22 12 22s4.8 0 6.8-.1c.6.1 1.9-.1 3-1.2.9-.8 1.2-2.8 1.2-2.8s.3-2 .3-4v-1.9C23.3 10 23 8 23 7zm-13.5 7.4V9.6l5.6 2.4-5.6 2.4z"/>',
    'tiktok':         '<path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/>',
    'threads':        '<path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.358-.218-3.255-.801-1.06-.69-1.68-1.738-1.75-2.95-.137-2.395 1.787-4.057 4.785-4.23.95-.054 1.842-.013 2.66.123-.108-.671-.331-1.205-.667-1.594-.461-.535-1.176-.81-2.124-.818h-.029c-.762 0-1.795.21-2.456 1.198l-1.667-1.118c.886-1.319 2.325-2.044 4.123-2.044h.044c3.005.019 4.794 1.86 4.97 5.034.101.043.2.087.297.132 1.39.65 2.4 1.658 2.928 2.916.736 1.756.793 4.638-1.557 6.95-1.79 1.766-3.969 2.583-6.871 2.604zm-1.51-12.252c-.117 0-.236.003-.356.01-2.022.114-3.018.886-2.97 2.04.034.59.443 1.054 1.108 1.293.622.224 1.41.265 2.198.116 1.244-.236 2.07-1.087 2.346-2.41-.74-.165-1.534-.246-2.326-.139z"/>',
    'x':              '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>',
    'naver-blog':     '<path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/>',
    'naver-post':     '<path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h8v2H3z"/>',
    'kakao':          '<path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.7 5.1 4.2 6.6L5.1 21l4.4-2.9c.8.1 1.7.2 2.5.2 5.523 0 10-3.477 10-7.5S17.523 3 12 3z"/>',
    'band':           '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z"/>',
    'linkedin':       '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>',
    'pinterest':      '<path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>',
  };
  // instagram 은 stroke 기반(라인 아이콘), 나머지는 fill 기반.
  function formatBrandIcon(id, size) {
    var paths = _FORMAT_BRAND_ICON_PATHS[id];
    if (!paths) return '';
    var s = size || 18;
    var attrs = (id === 'instagram')
      ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
      : 'fill="currentColor"';
    return '<svg class="bsf-fmt-card-icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' + attrs + ' aria-hidden="true">' + paths + '</svg>';
  }

  function isFormatCompatible(id, hasStory, hasImage, hasVideo) {
    switch (id) {
      case 'instagram':    return hasImage || hasVideo;
      case 'youtube-shorts': return hasVideo;
      case 'tiktok':       return hasVideo;
      case 'threads':      return hasStory || hasImage || hasVideo;
      case 'x':            return hasStory || hasImage || hasVideo;
      case 'naver-blog':   return hasStory || hasImage;
      case 'kakao':        return hasImage || hasStory || hasVideo;
      case 'facebook':     return hasImage || hasVideo || hasStory;
      case 'linkedin':     return hasStory || hasImage || hasVideo;
      case 'pinterest':    return hasImage;
      case 'youtube':      return hasVideo;
      case 'naver-post':   return hasImage;
      case 'band':         return hasStory || hasImage || hasVideo;
      default: return true;
    }
  }

  function splitIntoParagraphs(text, n) {
    if (!text) return [];
    var raw = text.split(/\n+/);
    var result = [];
    for (var i = 0; i < raw.length; i++) {
      var p = raw[i].trim();
      if (p) { result.push(p); if (n != null && result.length >= n) break; }
    }
    return result;
  }
  function firstSentenceOf(text) {
    if (!text) return '';
    var m = text.match(/^(.+?[.!?。！？])\s/);
    return m ? m[1] : (text.length > 100 ? text.slice(0, 100) + '…' : text);
  }
  function first2SentencesOf(text) {
    if (!text) return '';
    var sents = (text.match(/[^.!?。！？]+[.!?。！？]/g) || []).filter(function (s) { return s.trim(); });
    if (sents.length >= 2) return sents.slice(0, 2).join(' ').trim();
    return firstSentenceOf(text);
  }

  function inferDefaultContentType(project) {
    var payload = (project && project.payload) || {};
    var raw = String(payload.projectType || payload.purposeCategory || '').trim().toLowerCase();
    if (!raw) return 'sns-post';
    if (raw.indexOf('blog') >= 0 || raw.indexOf('article') >= 0 || raw.indexOf('문서') >= 0) return 'blog-post';
    if (raw.indexOf('image') >= 0 || raw.indexOf('poster') >= 0 || raw.indexOf('thumb') >= 0 || raw.indexOf('카드') >= 0) return 'promo-image';
    if (raw.indexOf('video') >= 0 || raw.indexOf('short') >= 0 || raw.indexOf('쇼츠') >= 0 || raw.indexOf('릴스') >= 0) return 'shorts-promo';
    return 'sns-post';
  }

  function pickAutoAssetIds(assetItems, projectId) {
    var rows = Array.isArray(assetItems) ? assetItems.slice() : [];
    return rows.sort(function (a, b) {
      function score(item) {
        var total = 0;
        if (String(item && item.projectId || '').trim() === String(projectId || '').trim()) total += 100;
        if (String(item && item.type || '').trim() === 'image') total += 20;
        if (String(item && item.type || '').trim() === 'video') total += 10;
        if (String(item && item.url || '').trim()) total += 5;
        if (/대표|썸네일|thumbnail|cover/i.test(String(item && item.title || ''))) total += 3;
        return total;
      }
      return score(b) - score(a);
    }).slice(0, 2).map(function (item) {
      return String(item && item.id || '').trim();
    }).filter(Boolean);
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="brand-studio-hero empty">' +
      '<h2>Brand Studio</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="brand-studio-hero-actions">' +
      '<a class="btn-primary" href="dashboard.html">대시보드로 이동</a>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
  }

  function openBsfMediaPopup(url, type) {
    var existing = document.getElementById('bsf-media-popup');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'bsf-media-popup';
    overlay.className = 'bsf-media-popup-overlay';
    var inner = document.createElement('div');
    inner.className = 'bsf-media-popup-inner';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'bsf-media-popup-close';
    closeBtn.innerHTML = '&#x2715;';
    closeBtn.onclick = function () { overlay.remove(); };
    inner.appendChild(closeBtn);
    if (type === 'video') {
      var vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.className = 'bsf-media-popup-video';
      inner.appendChild(vid);
    } else {
      var img = document.createElement('img');
      img.src = url;
      img.className = 'bsf-media-popup-img';
      inner.appendChild(img);
    }
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
    });
  }

  function renderProject(root, project, brand, options) {
    var renderOptions = options || {};
    var preservedFieldScroll = captureFieldScrollState(root);
    var preservedFieldValues = renderOptions.preserveInputs === false ? null : captureFieldValueState(root);
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandView = readBrandView(brand, project);
    var brandId = String(brandView.brandId || '').trim();
    var isEn = !!(NK.state && NK.state.runtime && NK.state.runtime.lang === 'en');
    var T = bsfT(isEn);
    var selectedAssetIds = readSelectedAssetIds(payload);
    var knowledge = readKnowledge(brand && typeof brand === 'object' ? brand : payload);
    var channelConnections = readChannelConnections(brand, payload);
    var publishPlan = readPublishPlan(brand, payload);
    var selectedFormats = readSelectedFormats(payload);
    var formatDrafts = readFormatDrafts(payload);
    var persistedDeployedFormats = readDeployedFormats(payload, projectId);
    var activeDraftTab = readActiveDraftTab(payload) || (selectedFormats.length ? selectedFormats[0] : '');
    var formatItems = channelFormats();
    var channelRows = channelOptions();
    var channelTitleMap = {};
    channelRows.forEach(function (item) { channelTitleMap[item.id] = item.title; });
    // Current project only — user already selected the episode before entering Brand Studio
    var contentItems = [];
    if (NK.service.contentLibrary && NK.service.contentLibrary.listProjectContents) {
      try { contentItems = NK.service.contentLibrary.listProjectContents(project); } catch (_) {}
    }
    // 렌더 저장소 캐시 병합 (비동기 로드 후 재렌더 시 반영)
    // 토큰 만료 시 프록시 URL 생성 자체를 건너뜀 (403 방지)
    var _renderTokenValid = !!(NK.auth && NK.auth.isAuthed ? NK.auth.isAuthed() : NK.auth && NK.auth.getToken && NK.auth.getToken());
    var cachedRenders = _renderStorageCache[projectId] || [];
    if (cachedRenders.length && _renderTokenValid) {
      var existingIds = contentItems.map(function (c) { return c.id; });
      cachedRenders.forEach(function (item, idx) {
        var objName = String(item && item.name || '').trim();
        if (!objName) return;
        var rid = projectId + ':video:store:' + idx;
        if (existingIds.indexOf(rid) >= 0) return;
        var rUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(objName) : '';
        if (!rUrl) return;
        var base = objName.split('/').pop();
        var stripped = base.replace(/\.(webm|mp4)$/i, '');
        var tsM = stripped.match(/(\d{10})$/);
        var label = tsM ? tsM[1] : (stripped.replace(/^postprod[-_]final[-_]?/i, '').replace(/[-_]source$/i, '') || stripped);
        var storeDur = (item && (Number(item.durationSec) || Number(item.duration))) || null;
        contentItems.push({
          id: rid, projectId: projectId, type: 'video',
          title: '렌더 ' + label, url: rUrl, status: 'ready',
          duration: storeDur
        });
      });
    }

    // AI 시네마 영상(ai-video-gen) 캐시 병합 — `/api/video/library?source=video-gen&projectId=...` 결과
    var cachedVideoGen = _videoGenStorageCache[projectId] || [];
    if (cachedVideoGen.length && _renderTokenValid) {
      var existingIdsVg = contentItems.map(function (c) { return c.id; });
      cachedVideoGen.forEach(function (item, idx) {
        var vgObj = String(item && (item.name || item.objectName) || '').trim();
        if (!vgObj) return;
        var vgId = projectId + ':video:gen:' + (vgObj || idx);
        if (existingIdsVg.indexOf(vgId) >= 0) return;
        var vgUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(vgObj) : '';
        if (!vgUrl) return;
        var vgBase = vgObj.split('/').pop().replace(/\.(webm|mp4|mov)$/i, '');
        var vgDur = (item && (Number(item.durationSec) || Number(item.duration))) || null;
        contentItems.push({
          id: vgId, projectId: projectId, type: 'video',
          title: 'AI 영상 ' + vgBase, url: vgUrl, status: 'ready',
          duration: vgDur
        });
      });
    }

    // AI 시네마 이미지(ai-image) 캐시 병합 — `/api/ai-image/library?sessionId=...` 결과
    var cachedAiImages = _aiImageStorageCache[projectId] || [];
    if (cachedAiImages.length && _renderTokenValid) {
      var existingIdsImg = contentItems.map(function (c) { return c.id; });
      cachedAiImages.forEach(function (item, idx) {
        var imgObj = String(item && (item.name || item.objectName) || '').trim();
        if (!imgObj) return;
        var imgId = projectId + ':image:gen:' + (imgObj || idx);
        if (existingIdsImg.indexOf(imgId) >= 0) return;
        var imgUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(imgObj) : '';
        if (!imgUrl) return;
        var imgBase = imgObj.split('/').pop().replace(/\.(png|jpg|jpeg|webp)$/i, '');
        contentItems.push({
          id: imgId, projectId: projectId, type: 'image',
          title: 'AI 이미지 ' + imgBase, url: imgUrl, status: 'ready'
        });
      });
    }
    var assetItems = contentItems.filter(function (item) {
      return ['text', 'image', 'video'].indexOf(String(item.type || '').trim()) >= 0;
    });
    var autoSelectedAssetIds = selectedAssetIds.length ? selectedAssetIds.slice() : pickAutoAssetIds(assetItems, projectId);
    var selectedAssetItems = assetItems.filter(function (item) {
      return autoSelectedAssetIds.indexOf(String(item.id || '').trim()) >= 0;
    });
    var persistedSelectedAssetItems = assetItems.filter(function (item) {
      return selectedAssetIds.indexOf(String(item.id || '').trim()) >= 0;
    });
    var storyVirtualId = projectId + ':story';
    var storySelected = selectedAssetIds.indexOf(storyVirtualId) >= 0;
    var selHasImage = persistedSelectedAssetItems.some(function (i) { return String(i.type || '').trim() === 'image'; });
    var selHasVideo = persistedSelectedAssetItems.some(function (i) {
      if (String(i.type || '').trim() !== 'video') return false;
      var rid = String(i.id || '');
      return rid.indexOf(':video:render') >= 0 || rid.indexOf(':video:store:') >= 0;
    });
    var anyAssetSelected = storySelected || selHasImage || selHasVideo;
    var sourceAssetItems = selectedAssetItems.length
      ? selectedAssetItems
      : contentItems.filter(function (item) {
        var type = String(item && item.type || '').trim();
        return type === 'text' || type === 'reference';
      });
    var sourceTexts = sourceAssetItems
      .map(function (item) { return String(item.text || item.title || '').trim(); })
      .filter(Boolean);
    var hasDraftForAnyFormat = selectedFormats.some(function (formatId) {
      var draft = formatDrafts && formatDrafts[formatId];
      return draft && (String(draft.caption || '').trim() || String(draft.hashtags || '').trim());
    });

    function renderNext(nextProject, options) {
      var fallbackProject = nextProject && nextProject.id ? nextProject : project;
      var nextBrandId = String(fallbackProject && fallbackProject.payload && fallbackProject.payload.brandId || brandId).trim();
      var nextBrand = (NK.service && NK.service.brand && NK.service.brand.getById && nextBrandId)
        ? NK.service.brand.getById(nextBrandId)
        : null;
      renderProject(root, fallbackProject, nextBrand || brand, options || {});
    }

    function updateStep1Bar() {
      var storySel = root.querySelector('.bsf-story-card.is-selected') ? 1 : 0;
      var imgSel = root.querySelectorAll('.bsf-asset-thumb-grid .bsf-thumb-wrap.is-selected').length;
      var vidSel = root.querySelectorAll('.bsf-asset-video-grid .bsf-video-thumb-item.is-selected').length;
      var total = storySel + imgSel + vidSel;
      var step1Btn = root.querySelector('[data-action="brand-set-step"][data-step="1"]');
      if (!step1Btn) return;
      step1Btn.classList.toggle('is-done', total > 0);
      var step1Val = step1Btn.querySelector('.bsf-step-val');
      if (step1Val) {
        step1Val.textContent = total > 0
          ? T.stepValSelected(total)
          : (assetItems.length ? T.stepItemsVal(assetItems.length) : (isEn ? 'None' : '없음'));
      }
    }

    function switchToStep(newStep) {
      // 포맷 탭 진입 시 자산 기반 자동 선택 — 자산 선택이 바뀌었을 때만 재계산
      if (newStep === 2) {
        var curSig = selectedAssetIds.slice().sort().join('\x00');
        if (curSig !== _lastAutoFormatSig) {
          // 카드 상태(클래스/뱃지/lock) 즉시 갱신
          refreshFormatCardStates();
          // 'recommended' 상태인 카드만 자동 선택
          var curSelected = getCurrentSelectedAssetItems();
          var autoFormats = formatItems.filter(function (fmt) {
            return getFormatCardState(fmt.id, curSelected) === 'recommended';
          }).map(function (fmt) { return fmt.id; });
          if (autoFormats.length || curSelected.length) {
            selectedFormats = autoFormats;
            root.querySelectorAll('[data-action="brand-toggle-format"]').forEach(function (card) {
              var fid = String(card.dataset.formatId || '').trim();
              card.classList.toggle('is-selected', autoFormats.indexOf(fid) >= 0);
            });
            var step2Btn = root.querySelector('[data-action="brand-set-step"][data-step="2"]');
            if (step2Btn) {
              step2Btn.classList.toggle('is-done', autoFormats.length > 0);
              var step2Val = step2Btn.querySelector('.bsf-step-val');
              if (step2Val) step2Val.textContent = autoFormats.length ? T.stepValSelected(autoFormats.length) : T.stepValNone;
            }
            if (NK.service && NK.service.project && NK.service.project.updatePayload) {
              NK.service.project.updatePayload(projectId, { brandStudioSelectedFormats: autoFormats }).catch(function () {});
            }
          }
          _lastAutoFormatSig = curSig; // 스냅샷 갱신
        }
      }
      // ① step 버튼 is-active 토글
      root.querySelectorAll('[data-action="brand-set-step"]').forEach(function (sb) {
        var s = parseInt(sb.dataset.step || '0', 10);
        sb.classList.toggle('is-active', s === newStep);
      });
      // ② 디테일 패널 is-active 토글 (순서: 자산=1, 포맷=2, 초안=3, 배포=4)
      var panels = root.querySelectorAll('.bsf-detail-card > .bsf-detail');
      panels.forEach(function (panel, idx) {
        panel.classList.toggle('is-active', idx + 1 === newStep);
      });
      // 자산 탭(1)으로 돌아올 때 썸네일 초기화 (숨겨진 동안 로드 안 됐을 수 있음)
      if (newStep === 1) { initVideoThumbs(); initImageThumbs(); initIgSlider(); }
      // 초안 탭(3) 진입: selectedFormats 변경이 있으면 드래프트 섹션 재동기화
      if (newStep === 3) { refreshDraftSection(); initMockVideoThumbs(); }
      // 배포 탭(4) 진입: 초안 디바운스 즉시 flush 후 배포 요약 재빌드 (stale 데이터 방지)
      if (newStep === 4) {
        flushPendingDraftEdits();
        refreshDeploySummary();
      }
      // ③ ctrl bar 교체 (전체 리렌더 없음, 빈 경우 DOM 삽입/제거)
      var ctrlBarEl = root.querySelector('.bsf-ctrl-bar');
      var newCtrlHtml = makeCtrlBarHtml(newStep);
      if (newCtrlHtml) {
        if (!ctrlBarEl) {
          ctrlBarEl = document.createElement('div');
          ctrlBarEl.className = 'bsf-ctrl-bar';
          var flowCard = root.querySelector('.bsf-flow-card');
          if (flowCard) flowCard.appendChild(ctrlBarEl);
        }
        ctrlBarEl.innerHTML = newCtrlHtml;
      } else {
        if (ctrlBarEl) ctrlBarEl.remove();
      }
    }

    function syncBrandAndProject(brandPatch, projectPatch) {
      return Promise.resolve().then(async function () {
        if (brandId && NK.service && NK.service.brand) {
          if (NK.service.brand.persistShared) {
            await NK.service.brand.persistShared(brandId, brandPatch || {});
          } else if (NK.service.brand.update) {
            NK.service.brand.update(brandId, brandPatch || {});
          }
        }
        var nextDraft = null;
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          var projectResult = await NK.service.project.updatePayload(projectId, projectPatch || {});
          if (projectResult && projectResult.draft) nextDraft = projectResult.draft;
        }
        return { draft: nextDraft || project };
      });
    }

    // 스토리(가상 ID)를 포함한 선택된 자산 총 수
    var persistedSelCount = persistedSelectedAssetItems.length + (storySelected ? 1 : 0);
    var savedActiveStep = parseInt(String(payload.brandStudioActiveStep || '0'), 10);
    var activeStep = (savedActiveStep >= 1 && savedActiveStep <= 4) ? savedActiveStep : (function () {
      if (!persistedSelCount) return 1;
      if (!selectedFormats.length) return 2;
      if (!hasDraftForAnyFormat) return 3;
      return 4;
    }());
    var stepDefs = [
      { id: 1, num: '01', title: T.stepAsset, done: persistedSelCount > 0, value: persistedSelCount ? T.stepValSelected(persistedSelCount) : (assetItems.length ? T.stepItemsVal(assetItems.length) : (isEn ? 'None' : '없음')) },
      { id: 2, num: '02', title: T.stepFormat, done: selectedFormats.length > 0, value: selectedFormats.length ? T.stepValSelected(selectedFormats.length) : T.stepValNone },
      { id: 3, num: '03', title: T.stepDraft, done: hasDraftForAnyFormat, value: hasDraftForAnyFormat ? T.stepValDrafted : T.stepValNeedsDraft },
      { id: 4, num: '04', title: T.stepPublish, done: !!(publishPlan.scheduledAt && publishPlan.channels.length), value: selectedFormats.length ? T.stepValChannels(selectedFormats.length) : T.stepValNoFormat }
    ];
    var timelineHtml = stepDefs.map(function (step) {
      var cls = 'bsf-step' + (step.done ? ' is-done' : '') + (step.id === activeStep ? ' is-active' : '');
      return (
        '<button type="button" class="' + cls + '" data-action="brand-set-step" data-step="' + step.id + '">' +
        '<span class="bsf-step-dot" data-num="' + step.num + '"></span>' +
        '<strong class="bsf-step-name">' + escapeHtml(step.title) + '</strong>' +
        '<em class="bsf-step-val">' + escapeHtml(step.value) + '</em>' +
        '</button>'
      );
    }).join('<span class="bsf-step-line" aria-hidden="true"></span>');
    var __initialSelectedForFormatState = (function () {
      var arr = persistedSelectedAssetItems.slice();
      var sVId = projectId + ':story';
      if (selectedAssetIds.indexOf(sVId) >= 0) arr.push({ id: sVId, type: 'text', virtual: true });
      return arr;
    }());
    // 추천 라벨용 별 아이콘 (Lucide star outline)
    var _starSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
    var formatCards = formatItems.map(function (item) {
      var isSelected = selectedFormats.indexOf(item.id) >= 0;
      var cardState = getFormatCardState(item.id, __initialSelectedForFormatState);
      var fmtDesc = (T.fmtDescs && T.fmtDescs[item.id]) || item.desc;
      var cls = 'bsf-format-card bsf-format-card--' + cardState +
        (isSelected ? ' is-selected' : '');
      var badgeHtml = (cardState === 'recommended')
        ? '<div class="bsf-format-card__badge" aria-label="' + (isEn ? 'Recommended' : '추천') + '">' + _starSvg + '</div>'
        : '';
      var lockHtml = (cardState === 'unavailable')
        ? '<div class="bsf-format-card__lock">' + (isEn ? '🔒 Asset required' : '🔒 자산 필요') + '</div>'
        : '';
      return (
        '<button type="button" class="' + cls + '"' +
        ' data-action="brand-toggle-format"' +
        ' data-format-id="' + escapeHtml(item.id) + '"' +
        (cardState === 'unavailable' ? ' data-unavailable="true"' : '') +
        '>' +
        badgeHtml +
        '<div class="bsf-fmt-card-head">' +
        formatBrandIcon(item.id, 18) +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '</div>' +
        '<p>' + escapeHtml(fmtDesc) + '</p>' +
        lockHtml +
        '</button>'
      );
    }).join('');
    var storyItems = assetItems.filter(function (i) { return String(i.type || '').trim() === 'text'; });
    var imageItems = assetItems.filter(function (i) { return String(i.type || '').trim() === 'image'; });
    // 영상: 씬별 클립이 아닌 포스트 프로덕션 최종 렌더 전용
    var videoItems = assetItems.filter(function (i) {
      if (String(i.type || '').trim() !== 'video') return false;
      var id = String(i.id || '');
      return id.indexOf(':video:render') >= 0 || id.indexOf(':video:store:') >= 0;
    });
    function typeSelected(items) {
      return items.length > 0 && items.every(function (i) { return autoSelectedAssetIds.indexOf(String(i.id || '').trim()) >= 0; });
    }
    function countExplicitSelected(items) {
      return items.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0; }).length;
    }
    var imageSelCount = countExplicitSelected(imageItems);
    var imageAnySelected = imageSelCount > 0;
    var imageAllSelected = imageItems.length > 0 && imageSelCount === imageItems.length;
    var videoSelCount = countExplicitSelected(videoItems);
    var videoAnySelected = videoSelCount > 0;
    var videoAllSelected = videoItems.length > 0 && videoSelCount === videoItems.length;
    // 스토리 카드 — payload.story(이야기) 우선, 없으면 text 자산 텍스트 사용
    var storyNarrative = String(payload.story || payload.storyPrompt || '').trim();
    var storyOverview = storyNarrative || storyItems.map(function (i) { return String(i.text || i.title || '').trim(); }).filter(Boolean).join(' ');
    var storyPreview = storyOverview ? (storyOverview.length > 280 ? storyOverview.slice(0, 280) + '…' : storyOverview) : null;
    // 스토리는 payload.story가 있으면 무조건 1개
    var storyCount = storyNarrative ? 1 : storyItems.length;
    // 메타데이터 (장르·세부장르·시청목적·영상길이·화면비율·톤·스타일)
    var storyMeta = (function () {
      function mv(v) { return String(v || '').trim(); }
      function firstArr(v) { return Array.isArray(v) ? mv(v[0]) : mv(v); }
      var rows = [
        { label: T.metaGenre,    val: mv(payload.purposeCategory) },
        { label: T.metaSubgenre, val: firstArr(payload.purposeTag || payload.purposeTags) },
        { label: T.metaPurpose,  val: firstArr(payload.needs || payload.need) },
        { label: T.metaLength, val: mv(payload.duration) ? mv(payload.duration) + T.durationSuffix : '' },
        { label: T.metaAspect, val: mv(payload.aspectRatio) },
        { label: T.metaTone,   val: firstArr(payload.tones || payload.tone) },
        { label: T.metaStyle,  val: mv(payload.style) }
      ].filter(function (r) { return !!r.val; });
      if (!rows.length) return '';
      return '<ul class="bsf-story-meta">' +
        rows.map(function (r) {
          return '<li><span>' + escapeHtml(r.label) + '</span><strong>' + escapeHtml(r.val) + '</strong></li>';
        }).join('') + '</ul>';
    }());
    var storyCountLabel = isEn ? String(storyCount) : (storyCount + '개');
    var storyCardHtml =
      '<div class="bsf-asset-type-card bsf-story-card' + (storySelected ? ' is-selected' : '') + '"' +
      ((storyNarrative || storyItems.length) ? ' data-action="brand-toggle-story-card"' : '') + '>' +
      '<div class="bsf-asset-type-head"><span class="bsf-asset-type-label">' + T.cardStory + '</span><em>' + storyCountLabel + '</em></div>' +
      '<div class="bsf-asset-story-body">' +
      (storyPreview ? '<p>' + escapeHtml(storyPreview) + '</p>' : '<p class="bsf-asset-empty-hint">' + T.hintStory.replace('\n', '<br>') + '</p>') +
      storyMeta +
      '</div>' +
      '</div>';
    // 이미지 카드 — 개별 썸네일 선택 + 돋보기 팝업
    var imageCountLabel = imageAnySelected
      ? (imageSelCount + '/' + imageItems.length)
      : (isEn ? String(imageItems.length) : imageItems.length + '개');
    var imageThumbsHtml = imageItems.map(function (i) {
      var isSel = selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0;
      return '<div class="bsf-thumb-wrap' + (isSel ? ' is-selected' : '') + '" data-action="brand-toggle-single-asset" data-asset-id="' + escapeHtml(i.id || '') + '">' +
        (i.url
          ? '<img src="' + escapeHtml(i.url) + '" alt="' + escapeHtml(i.title || '') + '" class="bsf-thumb-img" loading="lazy" />'
          : '<div class="bsf-thumb-placeholder"><span>' + escapeHtml(i.title || T.cardImage) + '</span></div>') +
        '<div class="bsf-thumb-check">✓</div>' +
        (i.url ? '<button type="button" class="bsf-thumb-zoom" data-action="bsf-zoom-thumb" data-url="' + escapeHtml(i.url) + '" data-media-type="image" title="View original"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg></button>' : '') +
        '</div>';
    }).join('');
    var imageCardHtml =
      '<div class="bsf-asset-type-card' + (imageAnySelected ? ' is-selected' : '') + '">' +
      '<div class="bsf-asset-type-head"><span class="bsf-asset-type-label">' + T.cardImage + '</span><em>' + escapeHtml(imageCountLabel) + '</em></div>' +
      (imageItems.length ? '<div class="bsf-asset-thumb-grid">' + imageThumbsHtml + '</div>' : '<div class="bsf-asset-story-body"><p class="bsf-asset-empty-hint">' + T.hintImage.replace('\n', '<br>') + '</p></div>') +
      '</div>';
    // 영상 카드 — 개별 썸네일 선택 + 돋보기 팝업 + <video> 첫 프레임
    var videoCountLabel = videoAnySelected
      ? (videoSelCount + '/' + videoItems.length)
      : (isEn ? String(videoItems.length) : videoItems.length + '개');
    var videoThumbsHtml = videoItems.map(function (i) {
      var isSel = selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0;
      return i.url
        ? '<div class="bsf-video-thumb-item' + (isSel ? ' is-selected' : '') + '" data-action="brand-toggle-single-asset" data-asset-id="' + escapeHtml(i.id || '') + '">' +
          '<video class="bsf-thumb-video" data-item-id="' + escapeHtml(i.id || '') + '" src="' + escapeHtml(i.url) + '" preload="auto" muted playsinline></video>' +
          '<span class="bsf-video-thumb-overlay">▶</span>' +
          '<span class="bsf-video-thumb-title">' + escapeHtml(i.title || T.cardVideo) + '</span>' +
          '<div class="bsf-thumb-check">✓</div>' +
          '<button type="button" class="bsf-thumb-zoom" data-action="bsf-zoom-thumb" data-url="' + escapeHtml(i.url) + '" data-media-type="video" title="Play video"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/></svg></button>' +
          '</div>'
        : '<div class="bsf-video-thumb-item bsf-video-thumb-empty">' +
          '<span class="bsf-video-thumb-icon">▶</span>' +
          '<span class="bsf-video-thumb-title">' + escapeHtml(i.title || T.cardVideo) + '</span>' +
          '</div>';
    }).join('');
    var videoCardHtml =
      '<div class="bsf-asset-type-card' + (videoAnySelected ? ' is-selected' : '') + '">' +
      '<div class="bsf-asset-type-head"><span class="bsf-asset-type-label">' + T.cardVideo + '</span><em>' + escapeHtml(videoCountLabel) + '</em></div>' +
      (videoItems.length ? '<div class="bsf-asset-thumb-grid bsf-asset-video-grid">' + videoThumbsHtml + '</div>' : '<div class="bsf-asset-story-body"><p class="bsf-asset-empty-hint">' + T.hintVideo.replace('\n', '<br>') + '</p></div>') +
      '</div>';
    var carouselHintHtml = (imageSelCount > 0 && videoSelCount > 0)
      ? '<div class="bsf-carousel-hint">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>' +
        (isEn ? ' Video will be set as the first slide automatically.' : ' 영상이 첫 번째 슬라이드로 자동 설정됩니다.') +
        '</div>'
      : '';
    var assetTrioHtml = '<div class="bsf-asset-trio">' + storyCardHtml + imageCardHtml + videoCardHtml + '</div>' + carouselHintHtml;

    // 초안 패널용 미디어 미리보기 빌더
    function buildDraftMediaPreview(fmtId) {
      var rows = [];
      // 스토리
      if (storySelected && storyPreview && isFormatCompatible(fmtId, true, false, false)) {
        rows.push(
          '<div class="bsf-dmp-row bsf-dmp-story">' +
          '<span class="bsf-dmp-label">' + (isEn ? 'Story' : '스토리') + '</span>' +
          '<p class="bsf-dmp-story-text">' + escapeHtml(compactSentence(storyPreview, 100)) + '</p>' +
          '</div>'
        );
      }
      // 이미지
      if (isFormatCompatible(fmtId, false, true, false)) {
        var selImgs = imageItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
        if (selImgs.length) {
          var imgHtml = selImgs.slice(0, 6).map(function (i) {
            return '<img class="bsf-dmp-thumb" src="' + escapeHtml(i.url) + '" />';
          }).join('');
          rows.push(
            '<div class="bsf-dmp-row">' +
            '<span class="bsf-dmp-label">' + (isEn ? 'Images' : '이미지') + ' ' + selImgs.length + '</span>' +
            '<div class="bsf-dmp-thumbs">' + imgHtml + '</div>' +
            '</div>'
          );
        }
      }
      // 영상
      if (isFormatCompatible(fmtId, false, false, true)) {
        var selVids = videoItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
        if (selVids.length) {
          var vidHtml = selVids.slice(0, 3).map(function (i) {
            return (
              '<div class="bsf-dmp-vid-wrap">' +
              '<video class="bsf-dmp-thumb bsf-dmp-vid" src="' + escapeHtml(i.url) + '#t=0.001" preload="metadata" muted playsinline></video>' +
              '<span class="bsf-dmp-vid-icon">▶</span>' +
              '</div>'
            );
          }).join('');
          rows.push(
            '<div class="bsf-dmp-row">' +
            '<span class="bsf-dmp-label">' + (isEn ? 'Video' : '영상') + ' ' + selVids.length + '</span>' +
            '<div class="bsf-dmp-thumbs">' + vidHtml + '</div>' +
            '</div>'
          );
        }
      }
      if (!rows.length) return '';
      return '<div class="bsf-draft-media-preview">' + rows.join('') + '</div>';
    }

    // 블로그/롱폼 포맷용 구조화 미리보기 빌더
    var LONG_FORM_FMTS = { 'naver-blog': true, 'facebook': true, 'linkedin': true, 'youtube': true, 'naver-post': true };
    function buildBlogStructHtml(fmtId, storyTxt) {
      if (!LONG_FORM_FMTS[fmtId]) return '';
      var selImgs = imageItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
      var selVids = (fmtId === 'youtube') ? videoItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; }) : [];
      if (!storyTxt && !selImgs.length && !selVids.length) return '';
      // 스토리를 문단 단위로 분할
      var paras = storyTxt ? storyTxt.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
      var half = Math.ceil(paras.length / 2);
      var firstParas = paras.slice(0, half);
      var restParas = paras.slice(half);
      var firstImgs = selImgs.slice(0, 3);
      var restImgs = selImgs.slice(3, 6);
      function imgRow(imgs) {
        return imgs.length ? '<div class="bsf-blog-img-row">' + imgs.map(function (i) {
          return '<img class="bsf-blog-img" src="' + escapeHtml(i.url) + '" />';
        }).join('') + '</div>' : '';
      }
      function paraBlock(ps) {
        return ps.length ? '<p class="bsf-blog-para">' + escapeHtml(ps.join(' ')) + '</p>' : '';
      }
      var inner = '';
      if (fmtId === 'youtube' && selVids.length) {
        inner += '<div class="bsf-blog-img-row">' + selVids.slice(0, 2).map(function (i) {
          return '<div class="bsf-dmp-vid-wrap" style="width:120px;height:68px"><video class="bsf-dmp-vid" src="' + escapeHtml(i.url) + '#t=0.001" preload="metadata" muted playsinline></video><span class="bsf-dmp-vid-icon">▶</span></div>';
        }).join('') + '</div>';
      }
      inner += imgRow(firstImgs) + paraBlock(firstParas);
      if (restImgs.length || restParas.length) {
        inner += imgRow(restImgs) + paraBlock(restParas);
      }
      return '<div class="bsf-blog-struct">' +
        '<div class="bsf-blog-struct-head"><span class="bsf-dmp-label">' + escapeHtml(T.draftStructLabel) + '</span></div>' +
        inner +
        '</div>';
    }

    var epTitle = String(payload.episodeTitle || (project && (project.title || project.seriesTitle)) || '').trim();

    // ── 선택된 미디어 아이템 (초안 목업용) ────────────────────────────────────
    var draftSelImgs = imageItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
    var draftSelVids = videoItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
    var draftFirstImgUrl = draftSelImgs.length ? String(draftSelImgs[0].url || '') : '';
    var draftFirstVidUrl = draftSelVids.length ? String(draftSelVids[0].url || '') : '';

    // ── 3단계 필드 래퍼 ──────────────────────────────────────────────────────
    function afWrap(label, ceHtml) {
      return '<div class="bsf-field bsf-field-auto"><div class="bsf-field-hd"><span class="bsf-badge bsf-badge-auto">AUTO</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>' + ceHtml + '</div>';
    }
    function pvWrap(label, innerHtml) {
      return '<div class="bsf-field bsf-field-preview"><div class="bsf-field-hd"><span class="bsf-badge bsf-badge-preview">PREVIEW</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>' + innerHtml + '</div>';
    }
    function cfWrap(label, ceHtml, fmtId, fieldKey) {
      return '<div class="bsf-field bsf-field-copy"><div class="bsf-field-hd"><span class="bsf-badge bsf-badge-copy">COPY</span><span class="bsf-field-label">' + escapeHtml(label) + '</span>' +
        '<button type="button" class="bsf-copy-btn" data-action="brand-copy-field" data-draft-format="' + escapeHtml(fmtId) + '" data-field-key="' + escapeHtml(fieldKey) + '" title="' + (isEn ? 'Copy' : '복사') + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>' +
        '</button></div>' + ceHtml + '</div>';
    }
    function ceDiv(fmtId, fieldKey, value, rows, placeholder) {
      return '<div class="bsf-ce" contenteditable="true" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '" data-rows="' + (rows || 3) + '" data-placeholder="' + escapeHtml(placeholder || '') + '">' + escapeHtml(value) + '</div>';
    }
    function regenBtnHtml(fmtId) {
      return '<button type="button" class="bsf-draft-regen-btn" data-action="brand-regen-draft" data-format-id="' + escapeHtml(fmtId) + '">' + escapeHtml(T.draftRegen) + '</button>';
    }
    function refineBarHtml(fmtId) {
      var svgRegen = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
      var svgEdit  = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
      return (
        '<div class="bsf-refine-bar">' +
          '<button type="button" class="bsf-card-gen-btn" data-action="brand-regen-draft" data-format-id="' + escapeHtml(fmtId) + '" title="' + (isEn ? 'Generate for this platform only' : '이 플랫폼만 신규 생성') + '">' +
            svgRegen + (isEn ? 'Generate' : '신규 생성') +
          '</button>' +
          '<div class="bsf-refine-input-wrap">' +
            '<input type="text" class="bsf-refine-input" data-refine-format="' + escapeHtml(fmtId) + '" placeholder="' + (isEn ? 'e.g. Make the tone more comic…' : '예: 톤을 더 코믹하게…') + '" maxlength="200">' +
            '<button type="button" class="bsf-refine-btn" data-action="brand-refine-draft" data-format-id="' + escapeHtml(fmtId) + '" title="' + (isEn ? 'AI Refine' : 'AI 보완') + '">' +
              svgEdit +
            '</button>' +
          '</div>' +
        '</div>'
      );
    }
    function showDraftSkeleton(panel) {
      var regenBtn = root.querySelector('.bsf-draft-regen-head');
      if (regenBtn) regenBtn.disabled = true;
      if (panel) {
        panel.querySelectorAll('.bsf-ce[contenteditable]').forEach(function (el) { el.classList.add('bsf-skeleton'); });
        panel.querySelectorAll('input[data-draft-field]:not([disabled]), textarea[data-draft-field]:not([disabled])').forEach(function (el) { el.classList.add('bsf-skeleton'); });
      }
    }
    function hideDraftSkeleton(panel) {
      var regenBtn = root.querySelector('.bsf-draft-regen-head');
      if (regenBtn) regenBtn.disabled = false;
      if (panel) {
        panel.querySelectorAll('.bsf-ce.bsf-skeleton').forEach(function (el) { el.classList.remove('bsf-skeleton'); });
        panel.querySelectorAll('input.bsf-skeleton, textarea.bsf-skeleton').forEach(function (el) { el.classList.remove('bsf-skeleton'); });
      }
    }

    // ── 추가 필드 빌더 함수 ────────────────────────────────────────────────────
    function selectField(fmtId, fieldKey, label, options, currentVal, fieldTier) {
      var wC = fieldTier === 'copy' ? 'bsf-field-copy' : 'bsf-field-auto';
      var bC = fieldTier === 'copy' ? 'bsf-badge-copy' : 'bsf-badge-auto';
      var bT = fieldTier === 'copy' ? 'COPY' : 'AUTO';
      var opts = options.map(function (o) {
        return '<option value="' + escapeHtml(o.value) + '"' + (currentVal === o.value ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
      }).join('');
      return '<div class="bsf-field ' + wC + '"><div class="bsf-field-hd"><span class="bsf-badge ' + bC + '">' + bT + '</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>' +
        '<select class="bsf-select" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '">' + opts + '</select></div>';
    }
    function radioField(fmtId, fieldKey, label, options, currentVal, fieldTier) {
      var wC = fieldTier === 'copy' ? 'bsf-field-copy' : 'bsf-field-auto';
      var bC = fieldTier === 'copy' ? 'bsf-badge-copy' : 'bsf-badge-auto';
      var bT = fieldTier === 'copy' ? 'COPY' : 'AUTO';
      var gName = escapeHtml(fmtId + '_' + fieldKey);
      var radios = options.map(function (o) {
        return '<label><input type="radio" name="' + gName + '" value="' + escapeHtml(o.value) + '"' + (currentVal === o.value ? ' checked' : '') + ' data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '">' + escapeHtml(o.label) + '</label>';
      }).join('');
      return '<div class="bsf-field ' + wC + '"><div class="bsf-field-hd"><span class="bsf-badge ' + bC + '">' + bT + '</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>' +
        '<div class="bsf-radio-group">' + radios + '</div></div>';
    }
    function toggleField(fmtId, fieldKey, label, currentVal, fieldTier) {
      var wC = fieldTier === 'copy' ? 'bsf-field-copy' : 'bsf-field-auto';
      var bC = fieldTier === 'copy' ? 'bsf-badge-copy' : 'bsf-badge-auto';
      var bT = fieldTier === 'copy' ? 'COPY' : 'AUTO';
      var isOn = currentVal === true || currentVal === 'true';
      return '<div class="bsf-field ' + wC + '"><div class="bsf-field-hd"><span class="bsf-badge ' + bC + '">' + bT + '</span><span class="bsf-field-label">' + escapeHtml(label) + '</span>' +
        '<label class="bsf-toggle-wrap"><input type="checkbox" class="bsf-toggle-input" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '"' + (isOn ? ' checked' : '') + '><span class="bsf-toggle"></span></label>' +
        '</div></div>';
    }
    function inputField(fmtId, fieldKey, label, placeholder, currentVal, fieldTier, inputType, disabled) {
      var wC = fieldTier === 'copy' ? 'bsf-field-copy' : 'bsf-field-auto';
      var bC = fieldTier === 'copy' ? 'bsf-badge-copy' : 'bsf-badge-auto';
      var bT = fieldTier === 'copy' ? 'COPY' : 'AUTO';
      var tp = inputType || 'text';
      var disabledAttr = disabled ? ' disabled' : '';
      var head = '<div class="bsf-field ' + wC + '"><div class="bsf-field-hd"><span class="bsf-badge ' + bC + '">' + bT + '</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>';
      if (tp === 'textarea') {
        return head + '<textarea class="bsf-input-textarea" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '" placeholder="' + escapeHtml(placeholder || '') + '"' + disabledAttr + '>' + escapeHtml(String(currentVal || '')) + '</textarea></div>';
      }
      var cls = tp === 'url' ? 'bsf-input-url' : 'bsf-input-text';
      return head + '<input type="' + tp + '" class="' + cls + '" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '" placeholder="' + escapeHtml(placeholder || '') + '" value="' + escapeHtml(String(currentVal || '')) + '"' + disabledAttr + '></div>';
    }
    function scheduledAtField(fmtId, currentVal, privacyStatus) {
      var hidden = privacyStatus !== 'scheduled' ? ' style="display:none"' : '';
      return '<div class="bsf-field bsf-field-auto bsf-scheduled-row" data-draft-format="' + escapeHtml(fmtId) + '"' + hidden + '>' +
        '<div class="bsf-field-hd"><span class="bsf-badge bsf-badge-auto">AUTO</span><span class="bsf-field-label">' + (isEn ? 'Scheduled time' : '예약 일시') + '</span></div>' +
        buildDtPickerHtml(fmtId, 'scheduled_at', currentVal) + '</div>';
    }

    // 목업 공통 파트
    var mockBrandName = escapeHtml((brandView.title || 'Brand').slice(0, 14));
    var mockAvatarUrl = (function () {
      var objName = String(brandView.logoObjectName || payload.thumbnailObjectName || '').trim();
      if (!objName) return '';
      try { return (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(objName) : ''; } catch (_) { return ''; }
    })();
    function mockAvatarEl(cls) {
      if (mockAvatarUrl) {
        return '<div class="' + cls + '" style="background-image:url(\'' + mockAvatarUrl + '\');background-size:cover;background-position:center;"></div>';
      }
      return '<div class="' + cls + '"></div>';
    }
    function mockImgEl(url, cls) {
      if (url) return '<img class="' + (cls || 'bsf-mock-media') + '" src="' + escapeHtml(url) + '" />';
      return '<div class="' + (cls || 'bsf-mock-media') + ' bsf-mock-media-empty"><span>📷</span></div>';
    }
    function mockVidEl(url, cls) {
      if (url) return '<video class="' + (cls || 'bsf-mock-media') + '" src="' + escapeHtml(url) + '#t=0.001" preload="metadata" muted playsinline></video>';
      return '<div class="' + (cls || 'bsf-mock-media') + ' bsf-mock-media-empty"><span>▶</span></div>';
    }

    // ── 12종 플랫폼 목업 빌더 ─────────────────────────────────────────────────
    var ytCatOptions = function () { return [
      { value: 'entertainment', label: isEn ? 'Entertainment' : '엔터테인먼트' },
      { value: 'education',     label: isEn ? 'Education' : '교육' },
      { value: 'gaming',        label: isEn ? 'Gaming' : '게임' },
      { value: 'music',         label: isEn ? 'Music' : '음악' },
      { value: 'etc',           label: isEn ? 'Other' : '기타' },
    ]; };
    var privacyOptions = function () { return [
      { value: 'public',    label: isEn ? 'Public' : '공개' },
      { value: 'unlisted',  label: isEn ? 'Unlisted' : '미공개' },
      { value: 'private',   label: isEn ? 'Private' : '비공개' },
      { value: 'scheduled', label: isEn ? 'Scheduled' : '예약' },
    ]; };

    var _igSvgHeart = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>';
    // YouTube Shorts sidebar SVG icons (Lucide, 24px, white via currentColor)
    var _svgThumbsUp   = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>';
    var _svgThumbsDown = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/><path d="M17 14V2"/></svg>';
    var _svgMsgCircle  = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>';
    var _svgShare2     = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
    var _svgEllipsis   = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';
    var _svgMusic      = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    var _igSvgComment = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>';
    var _igSvgRefresh = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>';
    var _igSvgSend = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';
    var _igSvgBookmark = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>';
    // 24px variants for TikTok sidebar
    var _svgHeart24    = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>';
    var _svgBookmark24 = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>';
    // 18px action-bar icons (shared across platforms)
    var _svgHeart18    = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>';
    var _svgMsg18      = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/></svg>';
    var _svgShare18    = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
    var _svgThumbsUp18 = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/><path d="M7 10v12"/></svg>';
    var _svgRepeat18   = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></svg>';
    var _svgChart18    = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>';
    var _svgUpload18   = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>';
    var _svgSend18     = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';
    var _svgBookmark18 = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/></svg>';

    function buildInstagramPreview(fmtId, captionVal, hashtagVal, draft) {
      var imgs = draftSelImgs;
      var imgCount = imgs.length;
      var slidesHtml = imgCount > 0
        ? imgs.map(function (img, i) {
            return '<img class="bsf-mock-ig-slide" src="' + escapeHtml(String(img.url || '')) + '" data-slide-idx="' + i + '" />';
          }).join('')
        : '<div class="bsf-mock-ig-slide bsf-mock-ig-slide-empty">📷</div>';
      if (imgCount === 0) imgCount = 1;
      var dotCount = Math.min(imgCount, 10);
      var dotsHtml = '<div class="bsf-mock-ig-dots-row">';
      for (var d = 0; d < dotCount; d++) {
        dotsHtml += '<div class="bsf-mock-ig-dot' + (d === 0 ? ' active' : '') + '" data-dot-idx="' + d + '"></div>';
      }
      dotsHtml += '</div>';
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-ig">' +
        '<div class="bsf-mock-ig-hd">' +
          mockAvatarEl('bsf-mock-ig-avatar') +
          '<span class="bsf-mock-ig-uname">' + mockBrandName + '</span>' +
          '<span class="bsf-mock-ig-follow">' + (isEn ? 'Follow' : '팔로우') + '</span>' +
          '<span class="bsf-mock-ig-dots">···</span>' +
        '</div>' +
        '<div class="bsf-mock-ig-slider" data-ig-slider>' +
          '<div class="bsf-mock-ig-slides" data-ig-slides>' + slidesHtml + '</div>' +
        '</div>' +
        dotsHtml +
        '<div class="bsf-mock-ig-actions">' +
          '<span class="bsf-mock-ig-action-icon">' + _igSvgHeart + '</span>' +
          '<span class="bsf-mock-ig-action-icon">' + _igSvgComment + '</span>' +
          '<span class="bsf-mock-ig-action-icon">' + _igSvgRefresh + '</span>' +
          '<span class="bsf-mock-ig-action-icon">' + _igSvgSend + '</span>' +
          '<span class="bsf-mock-ig-save">' + _igSvgBookmark + '</span>' +
        '</div>' +
        '<div class="bsf-mock-ig-likes">' + (isEn ? 'Liked by others' : '좋아요 128개') + '</div>' +
        '<div class="bsf-mock-ig-caption"><strong>' + mockBrandName + '</strong> <span data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</span> <span class="more">' + (isEn ? 'more' : '더 보기') + '</span></div>' +
        '<div class="bsf-mock-ig-comment">' + (isEn ? 'View all 12 comments' : '댓글 12개 모두 보기') + '</div>' +
        '<div class="bsf-mock-ig-time">' + (isEn ? '2 hours ago' : '2시간 전') + '</div>' +
        '</div>') +
      afWrap(isEn ? 'Caption' : '캡션', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Write your caption…' : '캡션을 작성하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag #tag')) +
      inputField(fmtId, 'location_tag', isEn ? 'Location tag' : '위치 태그', isEn ? 'Unavailable' : '비활성', '', 'auto', 'text', true) +
      inputField(fmtId, 'first_comment', isEn ? 'First comment' : '첫 댓글', isEn ? 'Auto-post as first comment (optional)' : '첫 댓글로 자동 게시 (선택)', draft.first_comment || '', 'auto', 'textarea');
    }
    function buildYoutubeShortsPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      var shortsVidHtml = draftFirstVidUrl
        ? '<video class="bsf-mock-shorts-vid" src="' + escapeHtml(draftFirstVidUrl) + '" preload="auto" muted playsinline></video>'
        : '<div class="bsf-mock-shorts-vid-empty">▶</div>';
      return pvWrap(isEn ? 'Shorts preview' : '쇼츠 미리보기',
        '<div class="bsf-mockup bsf-mock-shorts">' +
        shortsVidHtml +
        '<div class="bsf-mock-shorts-sidebar">' +
          '<div class="bsf-mock-shorts-sidebar-item">' +
            mockAvatarEl('bsf-mock-shorts-avatar') +
            '<div class="bsf-mock-shorts-sub-btn">+</div>' +
          '</div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">' + _svgThumbsUp + '</span><span class="bsf-mock-shorts-sidebar-count">1.2K</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">' + _svgThumbsDown + '</span><span class="bsf-mock-shorts-sidebar-count">' + (isEn ? 'Dislike' : '싫어요') + '</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">' + _svgMsgCircle + '</span><span class="bsf-mock-shorts-sidebar-count">48</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">' + _svgShare2 + '</span><span class="bsf-mock-shorts-sidebar-count">' + (isEn ? 'Share' : '공유') + '</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">' + _svgEllipsis + '</span></div>' +
        '</div>' +
        '<div class="bsf-mock-shorts-overlay">' +
          '<div class="bsf-mock-shorts-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml((titleVal || '…').slice(0, 50)) + '</div>' +
          '<div class="bsf-mock-shorts-ch-row"><span class="bsf-mock-shorts-ch">@' + mockBrandName + '</span><button class="bsf-mock-shorts-sub">' + (isEn ? 'Subscribe' : '구독') + '</button></div>' +
          '<div class="bsf-mock-shorts-music">' + _svgMusic + '<div class="bsf-mock-shorts-music-track"><span class="bsf-mock-shorts-music-text">' + mockBrandName + ' - Original Sound</span></div></div>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Title' : '제목', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Shorts title' : '쇼츠 제목')) +
      afWrap(isEn ? 'Description' : '설명', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Describe your video…' : '영상을 설명하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#Shorts #tag')) +
      selectField(fmtId, 'category', isEn ? 'Category' : '카테고리', ytCatOptions(), draft.category || 'entertainment', 'auto') +
      radioField(fmtId, 'privacy_status', isEn ? 'Privacy' : '공개 설정', privacyOptions(), draft.privacy_status || 'public', 'auto') +
      scheduledAtField(fmtId, draft.scheduled_at || '', draft.privacy_status || 'public');
    }
    function buildTiktokPreview(fmtId, captionVal, hashtagVal, draft) {
      var tiktokVidHtml = draftFirstVidUrl
        ? '<video class="bsf-mock-tiktok-vid" src="' + escapeHtml(draftFirstVidUrl) + '" preload="auto" muted playsinline></video>'
        : '<div class="bsf-mock-tiktok-vid-empty">▶</div>';
      return pvWrap(isEn ? 'Video preview' : '영상 미리보기',
        '<div class="bsf-mockup bsf-mock-tiktok">' +
        tiktokVidHtml +
        '<div class="bsf-mock-tiktok-sidebar">' +
          '<div class="bsf-mock-tiktok-sidebar-item">' + mockAvatarEl('bsf-mock-tiktok-avatar') + '<div class="bsf-mock-tiktok-sub-btn">+</div></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">' + _svgHeart24 + '</span><span class="bsf-mock-tiktok-sidebar-count">4.8K</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">' + _svgMsgCircle + '</span><span class="bsf-mock-tiktok-sidebar-count">312</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">' + _svgBookmark24 + '</span><span class="bsf-mock-tiktok-sidebar-count">128</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">' + _svgShare2 + '</span><span class="bsf-mock-tiktok-sidebar-count">' + (isEn ? 'Share' : '공유') + '</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">' + _svgEllipsis + '</span></div>' +
        '</div>' +
        '<div class="bsf-mock-tiktok-overlay">' +
          '<div class="bsf-mock-tiktok-username">@' + mockBrandName + '</div>' +
          '<div class="bsf-mock-tiktok-caption" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</div>' +
          '<div class="bsf-mock-tiktok-music"><span class="bsf-mock-tiktok-music-note">♪</span><div class="bsf-mock-tiktok-music-track"><span class="bsf-mock-tiktok-music-text">' + mockBrandName + ' - Original Sound</span></div></div>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Caption' : '캡션', ceDiv(fmtId, 'caption', captionVal, 3, isEn ? 'Write caption…' : '캡션을 작성하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#FYP #tag')) +
      radioField(fmtId, 'privacy_level', isEn ? 'Audience' : '공개 범위', [
        { value: 'public',      label: isEn ? 'Everyone' : '전체공개' },
        { value: 'friends',     label: isEn ? 'Followers' : '팔로워만' },
        { value: 'private',     label: isEn ? 'Private' : '비공개' },
      ], draft.privacy_level || 'public', 'auto') +
      toggleField(fmtId, 'allow_comment', isEn ? 'Allow comments' : '댓글 허용', draft.allow_comment !== false, 'auto') +
      toggleField(fmtId, 'allow_duet',    isEn ? 'Allow duet' : '듀엣 허용',    draft.allow_duet === true, 'auto');
    }
    function buildXThreadsPreview(fmtId, captionVal, hashtagVal, draft) {
      var isThreads = (fmtId === 'threads');
      var limit = isThreads ? 500 : 280;
      var cLen = captionVal.length;
      var cCls = 'bsf-charcount' + (cLen > limit - 10 ? ' over' : cLen > limit - 60 ? ' warn' : '');
      var bodyClip = isThreads ? 260 : 140;
      // 첨부 미디어 미리보기 (영상 우선, 없으면 이미지 최대 4장 그리드).
      // 실제 발행 시 선택된 이미지·영상·캐러셀이 그대로 Threads 로 전송된다.
      var xtMediaHtml = '';
      if (draftFirstVidUrl) {
        // 영상: 단일 플레이어. initMockVideoThumbs 가 10% 지점(최소 0.5s)으로 시크해 페이드인 검은 프레임 회피.
        xtMediaHtml = '<div class="bsf-mock-x-media bsf-mock-x-media--1"><video class="bsf-mock-x-media-el" src="' + escapeHtml(draftFirstVidUrl) + '" preload="metadata" muted playsinline></video></div>';
      } else if (draftSelImgs.length) {
        if (isThreads) {
          // Threads: 1장 단일(전체 너비), 여러 장이면 스와이프 캐러셀(점 인디케이터).
          if (draftSelImgs.length === 1) {
            xtMediaHtml = '<div class="bsf-mock-x-media bsf-mock-x-media--1"><img class="bsf-mock-x-media-el" src="' + escapeHtml(String(draftSelImgs[0].url || '')) + '" alt="" /></div>';
          } else {
            var thSlides = draftSelImgs.map(function (img) {
              return '<img class="bsf-mock-x-slide" src="' + escapeHtml(String(img.url || '')) + '" alt="" />';
            }).join('');
            var thDots = '';
            for (var thi = 0; thi < draftSelImgs.length; thi++) {
              thDots += '<div class="bsf-mock-x-dot' + (thi === 0 ? ' active' : '') + '" data-dot-idx="' + thi + '"></div>';
            }
            xtMediaHtml = '<div class="bsf-mock-x-carousel">' +
              '<div class="bsf-mock-x-slider" data-ig-slider><div class="bsf-mock-x-slides" data-ig-slides>' + thSlides + '</div></div>' +
              '<div class="bsf-mock-x-dots-row">' + thDots + '</div>' +
            '</div>';
          }
        } else {
          // X: 1장 전체 / 2장 50:50 / 3장 좌1+우2 / 4장 2×2 (CSS bsf-mock-x-media--N 그리드).
          var xtImgs = draftSelImgs.slice(0, 4);
          xtMediaHtml = '<div class="bsf-mock-x-media bsf-mock-x-media--' + xtImgs.length + '">' +
            xtImgs.map(function (img) {
              return '<img class="bsf-mock-x-media-el" src="' + escapeHtml(String(img.url || '')) + '" alt="" />';
            }).join('') +
          '</div>';
        }
      }
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-x">' +
        '<div class="bsf-mock-x-hd">' +
          mockAvatarEl('bsf-mock-x-avatar') +
          '<div class="bsf-mock-x-meta">' +
            '<span class="bsf-mock-x-name">' + mockBrandName + '</span>' +
            '<span class="bsf-mock-x-handle"> · @brand · ' + (isEn ? 'now' : '방금') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-x-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml((captionVal || '').slice(0, bodyClip)) + (captionVal.length > bodyClip ? '…' : '') + '</div>' +
        xtMediaHtml +
        '<div class="bsf-mock-x-actions">' +
          '<span class="bsf-mock-x-action">' + _svgMsg18 + ' 12</span>' +
          '<span class="bsf-mock-x-action">' + _svgRepeat18 + ' 48</span>' +
          '<span class="bsf-mock-x-action">' + _svgHeart18 + ' 128</span>' +
          (isThreads ? '' : '<span class="bsf-mock-x-action">' + _svgChart18 + '</span>') +
          '<span class="bsf-mock-x-action">' + _svgBookmark18 + '</span>' +
          '<span class="bsf-mock-x-action">' + _svgUpload18 + '</span>' +
        '</div>' +
        '<div class="bsf-mock-x-counter"><span class="' + cCls + '">' + cLen + ' / ' + limit + '</span></div>' +
        '</div>') +
      afWrap(isEn ? 'Post text' : '게시 문구',
        ceDiv(fmtId, 'caption', captionVal, 4, isEn ? "What's happening?" : '무슨 일이 있나요?') +
        '<div class="bsf-charcount-row"><span class="' + cCls + '">' + cLen + ' / ' + limit + '</span></div>') +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 1, '#hashtag')) +
      radioField(fmtId, 'reply_setting', isEn ? 'Who can reply' : '답글 허용', [
        { value: 'public',    label: isEn ? 'Everyone' : '전체' },
        { value: 'followers', label: isEn ? 'Followers' : '팔로워만' },
        { value: 'mentioned', label: isEn ? 'Mentioned only' : '언급한 사람만' },
      ], draft.reply_setting || 'public', 'auto');
    }
    function buildNaverBlogPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      var paras = splitIntoParagraphs(captionVal, 3);
      var blogInner = '';
      if (draftFirstImgUrl) blogInner += '<img class="bsf-mock-blog-img" src="' + escapeHtml(draftFirstImgUrl) + '" />';
      if (paras.length) blogInner += '<p class="bsf-mock-blog-para" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml((paras[0] || '').slice(0, 100)) + '…</p>';
      if (draftSelImgs.length > 1) blogInner += '<img class="bsf-mock-blog-img" src="' + escapeHtml(String(draftSelImgs[1].url || '')) + '" />';
      if (paras.length > 1) blogInner += '<p class="bsf-mock-blog-para">' + escapeHtml((paras[1] || '').slice(0, 100)) + '…</p>';
      var seoDesc = String(draft.seo_description || '');
      var seoLen = seoDesc.length;
      return pvWrap(isEn ? 'Blog preview' : '블로그 미리보기',
        '<div class="bsf-mockup bsf-mock-nblog">' +
        '<div class="bsf-mock-nblog-topbar"><span class="bsf-mock-nblog-topbar-logo">N</span><span class="bsf-mock-nblog-topbar-name">' + mockBrandName + '</span></div>' +
        '<div class="bsf-mock-nblog-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml(titleVal || (isEn ? 'Untitled' : '제목없음')) + '</div>' +
        '<div class="bsf-mock-nblog-author">' + mockAvatarEl('bsf-mock-nblog-author-avatar') + '<span class="bsf-mock-nblog-author-name">' + mockBrandName + '</span><span class="bsf-mock-nblog-author-date">' + (isEn ? 'just now' : '방금 전') + '</span></div>' +
        blogInner +
        '<div class="bsf-mock-nblog-reactions">' +
          '<span class="bsf-mock-action-item">' + _svgHeart18 + ' 0</span>' +
          '<span class="bsf-mock-action-item">' + _svgMsg18 + ' 0</span>' +
          '<span class="bsf-mock-action-item">' + _svgShare18 + ' ' + (isEn ? 'Share' : '공유') + '</span>' +
        '</div>' +
        '</div>') +
      cfWrap(isEn ? 'Title' : '제목', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Blog title' : '블로그 제목'), fmtId, 'title') +
      cfWrap(isEn ? 'Body' : '본문', ceDiv(fmtId, 'caption', captionVal, 8, isEn ? 'Blog content…' : '블로그 내용을 작성하세요'), fmtId, 'caption') +
      cfWrap(isEn ? 'Tags' : '태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#태그'), fmtId, 'hashtags') +
      cfWrap(isEn ? 'SEO description' : 'SEO 설명',
        ceDiv(fmtId, 'seo_description', seoDesc, 2, isEn ? 'Search snippet (max 160 chars)' : '검색 노출용 요약 (최대 160자)') +
        '<div class="bsf-charcount-row"><span class="bsf-charcount bsf-seo-count' + (seoLen > 150 ? ' over' : seoLen > 130 ? ' warn' : '') + '">' + seoLen + ' / 160</span></div>',
        fmtId, 'seo_description');
    }
    function buildKakaoPreview(fmtId, captionVal, hashtagVal, draft) {
      return pvWrap(isEn ? 'Channel preview' : '채널 미리보기',
        '<div class="bsf-mockup bsf-mock-kakao">' +
        '<div class="bsf-mock-kakao-hd">' +
          mockAvatarEl('bsf-mock-kakao-ch-icon') +
          '<span class="bsf-mock-kakao-ch-name">' + mockBrandName + '</span>' +
          '<span class="bsf-mock-kakao-badge">' + (isEn ? 'Channel' : '채널') + '</span>' +
        '</div>' +
        '<div class="bsf-mock-kakao-card">' +
          (draftFirstImgUrl ? '<img class="bsf-mock-kakao-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '<div class="bsf-mock-kakao-img" style="display:flex;align-items:center;justify-content:center;font-size:28px;color:#ccc">📢</div>') +
          '<div class="bsf-mock-kakao-card-body">' +
            '<div class="bsf-mock-kakao-card-title">' + escapeHtml(mockBrandName) + '</div>' +
            '<div class="bsf-mock-kakao-card-desc" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</div>' +
            '<div class="bsf-mock-kakao-btn">' + escapeHtml(draft.button_label || (isEn ? 'Learn more' : '자세히 보기')) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-kakao-foot">' +
          '<span class="bsf-mock-action-item">' + _svgHeart18 + ' ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-action-item">' + _svgMsg18 + ' ' + (isEn ? 'Comment' : '댓글') + '</span>' +
        '</div>' +
        '</div>') +
      cfWrap(isEn ? 'Message' : '메시지', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Write message…' : '메시지를 작성하세요'), fmtId, 'caption') +
      cfWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#해시태그'), fmtId, 'hashtags') +
      inputField(fmtId, 'button_label', isEn ? 'Button label' : '버튼 텍스트', isEn ? 'e.g. Learn more' : '예: 자세히 보기', draft.button_label || '자세히 보기', 'copy') +
      inputField(fmtId, 'link_url', isEn ? 'Link URL' : '링크 URL', 'https://', draft.link_url || '', 'copy', 'url');
    }
    function buildFacebookPreview(fmtId, captionVal, hashtagVal, draft) {
      // 선택된 자산의 타입 분석 — 이미지와 영상이 모두 있으면 라디오로 게시 타입 선택
      var fbSelTypes = (assetItems || []).filter(function (i) {
        var t = String(i.type || '').trim();
        return (t === 'image' || t === 'video') &&
          (selectedAssetIds || []).indexOf(String(i.id || '').trim()) >= 0;
      }).map(function (i) { return String(i.type || '').trim(); });
      var fbHasImg = fbSelTypes.indexOf('image') >= 0;
      var fbHasVid = fbSelTypes.indexOf('video') >= 0;
      var fbShowMediaPicker = fbHasImg && fbHasVid;
      var fbMediaTypeVal = String(draft.media_type || 'video');
      var fbMediaPickerHtml = fbShowMediaPicker
        ? radioField(fmtId, 'media_type', isEn ? 'Asset to publish' : '게시할 자산 선택', [
            { value: 'video', label: isEn ? 'Video' : '영상' },
            { value: 'image', label: isEn ? 'Images' : '이미지' },
          ], fbMediaTypeVal, 'auto')
        : '';
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-fb">' +
        '<div class="bsf-mock-fb-hd">' +
          mockAvatarEl('bsf-mock-fb-avatar') +
          '<div class="bsf-mock-fb-meta">' +
            '<div class="bsf-mock-fb-name">' + mockBrandName + '</div>' +
            '<div class="bsf-mock-fb-sub">' + (isEn ? 'Just now · 🌐' : '방금 전 · 🌐') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-fb-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(first2SentencesOf(captionVal) || '…') + '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-fb-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '') +
        '<div class="bsf-mock-fb-reactions"><span>👍❤️😮 128</span><span>' + (isEn ? 'Comments 24 · Shares 6' : '댓글 24 · 공유 6') + '</span></div>' +
        '<div class="bsf-mock-fb-actions">' +
          '<span class="bsf-mock-fb-action-btn bsf-mock-action-item">' + _svgThumbsUp18 + ' ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-fb-action-btn bsf-mock-action-item">' + _svgMsg18 + ' ' + (isEn ? 'Comment' : '댓글') + '</span>' +
          '<span class="bsf-mock-fb-action-btn bsf-mock-action-item">' + _svgShare18 + ' ' + (isEn ? 'Share' : '공유') + '</span>' +
        '</div>' +
        '</div>') +
      fbMediaPickerHtml +
      afWrap(isEn ? 'Post text' : '게시 문구', ceDiv(fmtId, 'caption', captionVal, 5, isEn ? "What's on your mind?" : '무슨 생각을 하고 계신가요?')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag')) +
      inputField(fmtId, 'link_url', isEn ? 'Link URL' : '링크 URL', 'https://', draft.link_url || '', 'auto', 'url') +
      inputField(fmtId, 'first_comment', isEn ? 'First comment' : '첫 댓글', isEn ? 'Auto-post as first comment (optional)' : '첫 댓글로 자동 게시 (선택)', draft.first_comment || '', 'auto', 'textarea');
    }
    function buildLinkedinPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-li">' +
        '<div class="bsf-mock-li-hd">' +
          mockAvatarEl('bsf-mock-li-avatar') +
          '<div class="bsf-mock-li-meta">' +
            '<div class="bsf-mock-li-name">' + mockBrandName + '</div>' +
            '<div class="bsf-mock-li-title">' + (isEn ? 'Brand Page' : '브랜드 페이지') + '</div>' +
            '<div class="bsf-mock-li-sub">' + (isEn ? '1h · 🌐' : '1시간 전 · 🌐') + '</div>' +
          '</div>' +
        '</div>' +
        (titleVal ? '<div class="bsf-mock-li-headline" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml(titleVal.slice(0, 60)) + '</div>' : '') +
        '<div class="bsf-mock-li-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(first2SentencesOf(captionVal) || '…') + '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-li-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '') +
        '<div class="bsf-mock-li-reactions">👍 ❤️ 💡 128 · ' + (isEn ? '24 comments' : '댓글 24개') + '</div>' +
        '<div class="bsf-mock-li-actions">' +
          '<span class="bsf-mock-li-action-btn bsf-mock-action-item">' + _svgThumbsUp18 + ' ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-li-action-btn bsf-mock-action-item">' + _svgMsg18 + ' ' + (isEn ? 'Comment' : '댓글') + '</span>' +
          '<span class="bsf-mock-li-action-btn bsf-mock-action-item">' + _svgRepeat18 + ' ' + (isEn ? 'Repost' : '리포스트') + '</span>' +
          '<span class="bsf-mock-li-action-btn bsf-mock-action-item">' + _svgSend18 + ' ' + (isEn ? 'Send' : '보내기') + '</span>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Headline' : '헤드라인', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Headline or article title' : '헤드라인')) +
      afWrap(isEn ? 'Post body' : '본문', ceDiv(fmtId, 'caption', captionVal, 6, isEn ? 'Write your article…' : '아티클을 작성하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag')) +
      radioField(fmtId, 'visibility', isEn ? 'Visibility' : '공개 범위', [
        { value: 'public',      label: isEn ? 'Everyone' : '전체공개' },
        { value: 'connections', label: isEn ? 'Connections only' : '연결만' },
      ], draft.visibility || 'public', 'auto') +
      inputField(fmtId, 'link_url', isEn ? 'Link URL' : '링크 URL', 'https://', draft.link_url || '', 'auto', 'url');
    }
    function buildPinterestPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      return pvWrap(isEn ? 'Pin preview' : '핀 미리보기',
        '<div class="bsf-mockup bsf-mock-pin">' +
        '<div class="bsf-mock-pin-img-wrap">' +
          (draftFirstImgUrl ? '<img class="bsf-mock-pin-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '<div class="bsf-mock-pin-img-empty">📌</div>') +
          '<div class="bsf-mock-pin-save-btn">' + (isEn ? 'Save' : '저장') + '</div>' +
        '</div>' +
        '<div class="bsf-mock-pin-body">' +
          '<div class="bsf-mock-pin-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml((titleVal || '…').slice(0, 50)) + '</div>' +
          '<div class="bsf-mock-pin-desc" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</div>' +
          '<div class="bsf-mock-pin-author">' + mockAvatarEl('bsf-mock-pin-author-avatar') + '<span class="bsf-mock-pin-author-name">' + mockBrandName + '</span></div>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Title' : '핀 제목', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Pin title' : '핀 제목')) +
      afWrap(isEn ? 'Description' : '설명', ceDiv(fmtId, 'caption', captionVal, 3, isEn ? 'Describe your pin' : '핀을 설명하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag')) +
      inputField(fmtId, 'board_name', isEn ? 'Board name' : '보드명', isEn ? 'Board to pin to' : '게시할 보드명', draft.board_name || '', 'auto') +
      inputField(fmtId, 'link_url', isEn ? 'Destination URL' : '목적지 URL', 'https://', draft.link_url || '', 'auto', 'url');
    }
    function buildYoutubePreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      var playerContent, hasDuration;
      if (draftFirstVidUrl) {
        playerContent = '<video class="bsf-mock-yt-player" src="' + escapeHtml(draftFirstVidUrl) + '" controls preload="metadata"></video>';
        hasDuration = false;
      } else if (draftFirstImgUrl) {
        playerContent = '<img class="bsf-mock-yt-thumb" src="' + escapeHtml(draftFirstImgUrl) + '" />';
        hasDuration = true;
      } else {
        playerContent = '<div class="bsf-mock-yt-thumb bsf-mock-media-empty" style="aspect-ratio:16/9;background:#0f0f0f;font-size:32px;color:#fff">▶</div>';
        hasDuration = true;
      }
      return pvWrap(isEn ? 'Video preview' : '영상 미리보기',
        '<div class="bsf-mockup bsf-mock-yt">' +
        '<div class="bsf-mock-yt-thumb-wrap">' + playerContent + (hasDuration ? '<span class="bsf-mock-yt-duration">0:00</span>' : '') + '</div>' +
        '<div class="bsf-mock-yt-meta">' +
          mockAvatarEl('bsf-mock-yt-ch-avatar') +
          '<div class="bsf-mock-yt-info">' +
            '<div class="bsf-mock-yt-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml((titleVal || (isEn ? 'Video title' : '제목없음')).slice(0, 60)) + '</div>' +
            '<div class="bsf-mock-yt-ch-name">' + mockBrandName + '</div>' +
            '<div class="bsf-mock-yt-stats">' + (isEn ? '0 views · just now' : '조회수 0회 · 방금') + '</div>' +
          '</div>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Title' : '영상 제목', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Video title' : '영상 제목')) +
      afWrap(isEn ? 'Description' : '설명', ceDiv(fmtId, 'caption', captionVal, 6, isEn ? 'Video description…' : '영상 설명을 작성하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag')) +
      selectField(fmtId, 'category', isEn ? 'Category' : '카테고리', ytCatOptions(), draft.category || 'entertainment', 'auto') +
      radioField(fmtId, 'privacy_status', isEn ? 'Privacy' : '공개 설정', privacyOptions(), draft.privacy_status || 'public', 'auto') +
      scheduledAtField(fmtId, draft.scheduled_at || '', draft.privacy_status || 'public');
    }
    function buildNaverPostPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '포스트 미리보기',
        '<div class="bsf-mockup bsf-mock-npost">' +
        '<div class="bsf-mock-npost-hd">' +
          '<span class="bsf-mock-npost-logo">POST</span>' +
          '<span class="bsf-mock-npost-ch-name">' + mockBrandName + '</span>' +
          '<span class="bsf-mock-npost-sub-btn">' + (isEn ? '+ Subscribe' : '+ 구독') + '</span>' +
        '</div>' +
        '<div class="bsf-mock-npost-card">' +
          (draftFirstImgUrl ? '<img class="bsf-mock-npost-card-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '<div class="bsf-mock-npost-card-img" style="display:flex;align-items:center;justify-content:center;font-size:32px;color:#ccc">🖼</div>') +
          '<div class="bsf-mock-npost-card-overlay">' +
            '<div class="bsf-mock-npost-card-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml((titleVal || (isEn ? 'Untitled' : '제목없음')).slice(0, 30)) + '</div>' +
            '<div class="bsf-mock-npost-card-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-npost-foot">' +
          '<span class="bsf-mock-action-item">' + _svgHeart18 + ' 0</span>' +
          '<span class="bsf-mock-action-item">' + _svgMsg18 + ' 0</span>' +
        '</div>' +
        '</div>') +
      cfWrap(isEn ? 'Title' : '제목', ceDiv(fmtId, 'title', titleVal, 1, isEn ? 'Post title' : '포스트 제목'), fmtId, 'title') +
      cfWrap(isEn ? 'Content' : '내용', ceDiv(fmtId, 'caption', captionVal, 5, isEn ? 'Post content…' : '포스트 내용을 작성하세요'), fmtId, 'caption') +
      cfWrap(isEn ? 'Tags' : '태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#태그'), fmtId, 'hashtags') +
      inputField(fmtId, 'series_name', isEn ? 'Series name' : '시리즈명', isEn ? 'Series (optional)' : '시리즈명 (선택)', draft.series_name || '', 'copy');
    }
    function buildBandPreview(fmtId, captionVal, hashtagVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-band">' +
        '<div class="bsf-mock-band-topbar"><span class="bsf-mock-band-topbar-logo">BAND</span><span class="bsf-mock-band-topbar-name">' + mockBrandName + '</span></div>' +
        '<div class="bsf-mock-band-hd">' +
          mockAvatarEl('bsf-mock-band-avatar') +
          '<div>' +
            '<div><span class="bsf-mock-band-name">' + mockBrandName + '</span><span class="bsf-mock-band-badge">' + (isEn ? 'Leader' : '리더') + '</span></div>' +
            '<div class="bsf-mock-band-date">1' + (isEn ? 'm ago' : '분 전') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-band-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(first2SentencesOf(captionVal) || '…') + '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-band-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '') +
        '<div class="bsf-mock-band-foot">' +
          '<span class="bsf-mock-action-item">' + _svgHeart18 + ' ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-action-item">' + _svgMsg18 + ' ' + (isEn ? 'Comment' : '댓글') + '</span>' +
          '<span class="bsf-mock-action-item">' + _svgShare18 + ' ' + (isEn ? 'Share' : '공유') + '</span>' +
        '</div>' +
        '</div>') +
      cfWrap(isEn ? 'Post text' : '게시 문구', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Write post…' : '게시글을 작성하세요'), fmtId, 'caption') +
      cfWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag'), fmtId, 'hashtags') +
      selectField(fmtId, 'category', isEn ? 'Post type' : '게시 유형', [
        { value: 'general',  label: isEn ? 'General' : '일반' },
        { value: 'notice',   label: isEn ? 'Notice' : '공지' },
        { value: 'poll',     label: isEn ? 'Poll' : '투표' },
        { value: 'event',    label: isEn ? 'Event' : '이벤트' },
      ], draft.category || 'general', 'copy');
    }

    // ── 플랫폼 카드 디스패처 ─────────────────────────────────────────────────
    function buildPlatformPreviewCard(formatId, fmt, isActive, draft) {
      var captionVal = String(draft.caption || '').trim() || buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge);
      var hashtagVal = String(draft.hashtags || '').trim() || buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge);
      var titleVal = String(draft.title || '').trim() || epTitle;
      var legendHtml =
        '<div class="bsf-preview-legend">' +
        '<span class="bsf-badge bsf-badge-auto">AUTO</span><span class="bsf-legend-txt">' + (isEn ? 'API sendable' : 'API 자동 전송') + '</span>' +
        '<span class="bsf-badge bsf-badge-copy">COPY</span><span class="bsf-legend-txt">' + (isEn ? 'Copy & post manually' : '복사 후 직접 게시') + '</span>' +
        '<span class="bsf-badge bsf-badge-preview">PREVIEW</span><span class="bsf-legend-txt">' + (isEn ? 'Mockup only' : '미리보기 전용') + '</span>' +
        '</div>';
      var bodyHtml = '';
      switch (formatId) {
        case 'instagram':      bodyHtml = buildInstagramPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'youtube-shorts': bodyHtml = buildYoutubeShortsPreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'tiktok':         bodyHtml = buildTiktokPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'threads':        bodyHtml = buildXThreadsPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'x':              bodyHtml = buildXThreadsPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'naver-blog':     bodyHtml = buildNaverBlogPreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'kakao':          bodyHtml = buildKakaoPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'facebook':       bodyHtml = buildFacebookPreview(formatId, captionVal, hashtagVal, draft); break;
        case 'linkedin':       bodyHtml = buildLinkedinPreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'pinterest':      bodyHtml = buildPinterestPreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'youtube':        bodyHtml = buildYoutubePreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'naver-post':     bodyHtml = buildNaverPostPreview(formatId, captionVal, hashtagVal, titleVal, draft); break;
        case 'band':           bodyHtml = buildBandPreview(formatId, captionVal, hashtagVal, draft); break;
        default:
          bodyHtml = afWrap(isEn ? 'Caption' : '캡션', ceDiv(formatId, 'caption', captionVal, 4, isEn ? 'Caption…' : '캡션을 작성하세요')) +
                     afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(formatId, 'hashtags', hashtagVal, 2, '#hashtag'));
      }
      return (
        '<div class="bsf-format-draft-panel' + (isActive ? ' is-active' : '') + '" data-draft-format="' + escapeHtml(formatId) + '">' +
        bodyHtml +
        refineBarHtml(formatId) +
        '</div>'
      );
    }

    var activeDraftTabOrFirst = activeDraftTab || (selectedFormats.length ? selectedFormats[0] : '');
    var draftTabsHtml = selectedFormats.length
      ? '<div class="bsf-draft-tabs">' + selectedFormats.map(function (formatId) {
          var fmt = formatItems.find(function (f) { return f.id === formatId; });
          var isActive = activeDraftTabOrFirst === formatId;
          var draft = (formatDrafts && formatDrafts[formatId]) || {};
          var hasDraft = !!(String(draft.caption || '').trim() || String(draft.hashtags || '').trim());
          return (
            '<button type="button" class="bsf-draft-tab' + (isActive ? ' is-active' : '') + (hasDraft ? ' has-draft' : '') + '" data-action="brand-set-draft-tab" data-draft-tab="' + escapeHtml(formatId) + '">' +
            escapeHtml(fmt ? fmt.title : formatId) +
            '</button>'
          );
        }).join('') + '</div>'
      : '';
    var draftPanelsHtml = selectedFormats.length
      ? selectedFormats.map(function (formatId) {
          var fmt = formatItems.find(function (f) { return f.id === formatId; });
          var isActive = activeDraftTabOrFirst === formatId;
          var draft = (formatDrafts && formatDrafts[formatId]) || {};
          return buildPlatformPreviewCard(formatId, fmt, isActive, draft);
        }).join('')
      : '<div class="brand-asset-empty">' + T.hintNoFormat + '</div>';
    var _calSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>';
    var _platformIcons = {
      'instagram':      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
      'youtube-shorts': '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23 7s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-.3C16.8 4 12 4 12 4s-4.8 0-6.8.1c-.6-.1-1.9.1-3 1.2C1.3 6.2 1 8 1 8S.7 10 .7 12v1.9c0 2 .3 4 .3 4s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.3 22 12 22 12 22s4.8 0 6.8-.1c.6.1 1.9-.1 3-1.2.9-.8 1.2-2.8 1.2-2.8s.3-2 .3-4v-1.9C23.3 10 23 8 23 7zm-13.5 7.4V9.6l5.6 2.4-5.6 2.4z"/></svg>',
      'tiktok':         '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/></svg>',
      'threads':        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.358-.218-3.255-.801-1.06-.69-1.68-1.738-1.75-2.95-.137-2.395 1.787-4.057 4.785-4.23.95-.054 1.842-.013 2.66.123-.108-.671-.331-1.205-.667-1.594-.461-.535-1.176-.81-2.124-.818h-.029c-.762 0-1.795.21-2.456 1.198l-1.667-1.118c.886-1.319 2.325-2.044 4.123-2.044h.044c3.005.019 4.794 1.86 4.97 5.034.101.043.2.087.297.132 1.39.65 2.4 1.658 2.928 2.916.736 1.756.793 4.638-1.557 6.95-1.79 1.766-3.969 2.583-6.871 2.604zm-1.51-12.252c-.117 0-.236.003-.356.01-2.022.114-3.018.886-2.97 2.04.034.59.443 1.054 1.108 1.293.622.224 1.41.265 2.198.116 1.244-.236 2.07-1.087 2.346-2.41-.74-.165-1.534-.246-2.326-.139z"/></svg>',
      'x':              '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
      'naver-blog':     '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.273 12.845L7.376 0H0v24h7.727V11.155L16.624 24H24V0h-7.727z"/></svg>',
      'kakao':          '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.477 3 2 6.477 2 10.8c0 2.7 1.7 5.1 4.2 6.6L5.1 21l4.4-2.9c.8.1 1.7.2 2.5.2 5.523 0 10-3.477 10-7.5S17.523 3 12 3z"/></svg>',
      'facebook':       '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
      'linkedin':       '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
      'pinterest':      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>',
      'youtube':        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
      'naver-post':     '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5h18v2H3zm0 4h18v2H3zm0 4h12v2H3zm0 4h8v2H3z"/></svg>',
      'band':           '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z"/></svg>'
    };
    function _readSnsStates() {
      // 공유받은 프로젝트는 소유자의 연결 상태(마스킹된 캐시)를 우선 사용.
      try {
        var _so = (NK.api && NK.api.getSharedOwner) ? NK.api.getSharedOwner(projectId) : '';
        if (_so && _sharedSnsStatesCache[projectId]) return _sharedSnsStatesCache[projectId];
      } catch (_) {}
      try { return JSON.parse(localStorage.getItem('nk_sns_states') || '{}'); } catch (e) { return {}; }
    }
    function buildDeploySummaryHtml() {
      var snsStates = _readSnsStates();
      return selectedFormats.length
        ? selectedFormats.map(function (formatId) {
            var fmt = formatItems.find(function (f) { return f.id === formatId; });
            var draft = (formatDrafts && formatDrafts[formatId]) || {};
            var caption = String(draft.caption || '').trim();
            var hasDraft = !!(caption || String(draft.hashtags || '').trim());
            var draftBadge = isEn ? (hasDraft ? 'Draft ready' : 'No draft') : (hasDraft ? '초안 완료' : '초안 없음');
            var icon = _platformIcons[formatId] || '';
            var snsRow = snsStates[formatId] || {};
            var isConnected = !!snsRow.connected;
            // enabled 미정의 + connected:true → 하위호환으로 사용 중으로 간주
            var isEnabled = isConnected && (snsRow.enabled !== false);
            var connectLabel;
            var connectCls;
            if (!isConnected) {
              connectLabel = isEn ? 'Not connected' : '연결 안됨';
              connectCls = 'is-disconnected';
            } else if (isEnabled) {
              connectLabel = isEn ? 'Connected' : '연결 됨';
              connectCls = 'is-connected';
            } else {
              connectLabel = isEn ? 'Paused' : '사용 안 함';
              connectCls = 'is-paused';
            }
            var perCardPicker = buildDtPickerHtml(null, null, '', 'bsf-deploy-dt-' + formatId);
            return (
              '<div class="bsf-deploy-format-row">' +
                '<div class="bsf-deploy-platform-icon">' + icon + '</div>' +
                '<div class="bsf-deploy-format-body">' +
                  '<div class="bsf-deploy-format-head">' +
                    '<strong class="bsf-deploy-fmt-title">' + escapeHtml(fmt ? fmt.title : formatId) + '</strong>' +
                    '<div class="bsf-deploy-card-dt">' + perCardPicker + '</div>' +
                    '<span class="brand-channel-badge bsf-deploy-status-badge">' + draftBadge + '</span>' +
                    (function () {
                      var checkSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
                      var connectIcon = connectCls === 'is-connected' ? checkSvg : '';
                      var isDone = !!_deployedFormats[formatId];
                      var connectBadge = '<span class="bsf-deploy-connect-badge ' + connectCls + '">' + connectIcon + connectLabel + '</span>';
                      var doneBadge = '<span class="bsf-deploy-done-badge' + (isDone ? ' is-done' : '') + '" data-action="toggle-deploy-done" data-deploy-format="' + escapeHtml(formatId) + '">' + (isDone ? checkSvg : '') + (isEn ? 'Published' : '배포 완료') + '</span>';
                      return connectBadge + doneBadge;
                    })() +
                  '</div>' +
                  '<p class="bsf-deploy-caption-preview">' + escapeHtml(caption ? compactSentence(caption, 50) : T.hintNoDraft) + '</p>' +
                '</div>' +
                (function () {
                  var isDeploying = !!_deployingFormats[formatId];
                  var btnCls = 'bsf-deploy-one-btn btn-primary' + (isDeploying ? ' is-deploying' : '');
                  var btnContent = isDeploying ? '<span class="bsf-deploy-btn-spinner"></span>' : (isEn ? 'Deploy' : '배포');
                  // 연결되어 있고 '사용 중'인 플랫폼만 배포 가능
                  var canDeploy = isEnabled && !isDeploying;
                  return '<button type="button" class="' + btnCls + '" data-action="brand-deploy-one-format" data-deploy-format="' + escapeHtml(formatId) + '"' + (canDeploy ? '' : ' disabled') + '>' + btnContent + '</button>';
                })() +
              '</div>'
            );
          }).join('')
        : '<div class="brand-asset-empty">' + T.hintNoFormat + '</div>';
    }
    var _deployedFormats = persistedDeployedFormats;
    var deployFormatSummary = buildDeploySummaryHtml();
    function makeCtrlBarHtml(step) {
      if (step === 1) {
        return '';
      }
      if (step === 2) {
        return '';
      }
      if (step === 3) {
        return '';
      }
      return '';
    }
    var ctrlBarHtml = makeCtrlBarHtml(activeStep);
    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="bsf-flow-card">' +
      '<div class="bsf-flow-head">' +
      '<div class="bsf-flow-title-group">' +
      '<p class="brand-studio-eyebrow">' + T.eyebrow + '</p>' +
      '<h2 class="bsf-title">' + escapeHtml(brandView.title || project.seriesTitle || project.title || (isEn ? 'Project' : '프로젝트')) + '</h2>' +
      '<p class="bsf-desc">' + escapeHtml((isEn ? 'Episode: ' : '에피소드: ') + (String(project.title || '').trim() || (isEn ? 'None' : '없음'))) + '</p>' +
      '</div>' +
      '<div class="bsf-timeline">' + timelineHtml + '</div>' +
      '<div class="bsf-flow-head-actions">' +
      '<button type="button" class="btn-secondary bsf-head-btn" data-action="brand-generate-all-drafts"' + (activeStep === 3 && selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlAutoGen + '</button>' +
      '<button type="button" class="btn-primary bsf-head-btn" data-action="brand-save-format-draft">' + T.ctrlSave + '</button>' +
      '<button type="button" class="btn-primary bsf-head-btn" data-action="brand-oneclick-draft" disabled>' + T.oneClickDraft + '</button>' +
      '</div>' +
      '</div>' +
      (ctrlBarHtml ? '<div class="bsf-ctrl-bar">' + ctrlBarHtml + '</div>' : '') +
      '</div>' +
      '<div class="bsf-detail-card">' +
      '<div class="bsf-detail' + (activeStep === 1 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head bsf-detail-head-asset">' +
        '<strong>' + T.head01 + '</strong>' +
        '<button type="button" class="bsf-clear-type-btn" data-action="brand-clear-assets"' + (persistedSelCount ? '' : ' disabled') + '>' + (isEn ? 'Clear' : '선택 비우기') + '</button>' +
        '<span>' + T.head01sub + '</span>' +
      '</div>' +
      assetTrioHtml +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 2 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head bsf-detail-head-asset">' +
      '<strong>' + T.head02 + '</strong>' +
      '<button type="button" class="bsf-format-guide-btn" data-action="open-format-guide" aria-label="' + (isEn ? 'Format recommendation guide' : '추천 포맷 안내') + '">' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>' +
      '</button>' +
      '<span>' + T.head02sub + '</span>' +
      '</div>' +
      '<div class="bsf-format-grid">' + formatCards + '</div>' +
      '</div>' +
      '<div class="bsf-detail bsf-detail-draft' + (activeStep === 3 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head bsf-detail-head-draft">' +
        '<div class="bsf-draft-head-row"><strong>' + T.head03 + '</strong>' + draftTabsHtml +
          '<button type="button" class="bsf-draft-regen-head" data-action="brand-regen-draft" data-format-id="' + escapeHtml(activeDraftTabOrFirst) + '" title="' + escapeHtml(T.draftRegen) + '">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="bsf-format-draft-panels">' + draftPanelsHtml + '</div>' +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 4 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head bsf-detail-head-asset bsf-detail-head-deploy">' +
        '<strong>' + T.head04 + '</strong>' +
        '<div class="bsf-deploy-head-right">' +
          '<span class="bsf-deploy-global-dt-label">' + T.placeholderSchedule + '</span>' +
          buildDtPickerHtml(null, null, publishPlan.scheduledAt || '', 'brand-publish-datetime') +
          '<button type="button" class="btn-primary compact bsf-deploy-all-btn" data-action="brand-deploy-all-formats"' + (selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlPublishAll + '</button>' +
        '</div>' +
        '<span>' + T.head04sub + '</span>' +
      '</div>' +
      '<div class="bsf-deploy-summary">' + deployFormatSummary + '</div>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
    restoreFieldValueState(root, preservedFieldValues);
    restoreFieldScrollState(root, preservedFieldScroll);
    bindDisclosureState(root);
    initVideoThumbs();
    initImageThumbs();
    initIgSlider();
    initMockVideoThumbs();
    // 초기 렌더 시 stale한 selectedFormats(이전 세션에서 저장된 unavailable 포맷) 즉시 제거
    // 단, 영상/이미지 자산 URL이 아직 비동기 하이드레이션 중이면 prune을 건너뛴다.
    // (로그인 직후 영상 URL 도착 전에 렌더되면 hasVideo=false로 영상 포맷이 잘못 제거+저장되어
    //  배포 탭에 영상 포맷 카드가 누락되는 레이스 방지)
    if (!hasUnhydratedSelectedMedia()) pruneUnavailableSelectedFormats();

    // contenteditable 자동 저장 (즉시 목업 반영 + 디바운스 800ms 서버 저장)
    var _draftSaveTimer = null;
    var _draftDirty = false;
    // 자산 선택 디바운스 저장
    var _assetSaveTimer = null;
    // 포맷 자동 세팅 시 자산 스냅샷 (변경 감지용)
    var _lastAutoFormatSig = '';
    function scheduleAssetSave() {
      if (_assetSaveTimer) clearTimeout(_assetSaveTimer);
      _assetSaveTimer = setTimeout(flushAssetSave, 800);
    }
    function flushAssetSave() {
      if (!_assetSaveTimer) return Promise.resolve(); // 대기 중인 변경 없음 → 즉시 반환
      clearTimeout(_assetSaveTimer);
      _assetSaveTimer = null;
      if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return Promise.resolve();
      return NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: selectedAssetIds.slice() })
        .catch(function () {});
    }
    function getDetailPanel(step) {
      var panels = root.querySelectorAll('.bsf-detail-card > .bsf-detail');
      return panels[step - 1] || null;
    }
    function showStepSpinner(step) {
      var panel = getDetailPanel(step);
      if (!panel || panel.querySelector('.bsf-step-spinner')) return;
      var el = document.createElement('div');
      el.className = 'bsf-step-spinner';
      el.innerHTML = '<div class="bsf-step-spinner-ring"></div>';
      panel.appendChild(el);
    }
    function hideStepSpinner(step) {
      var panel = getDetailPanel(step);
      if (!panel) return;
      var el = panel.querySelector('.bsf-step-spinner');
      if (el) el.remove();
    }
    function setSaveBtnEnabled(val) {
      _draftDirty = val;
      var sb = root.querySelector('[data-action="brand-save-format-draft"]');
      if (sb) sb.disabled = false;
    }
    function showSaveOverlay(label) {
      var existing = document.getElementById('bsf-save-overlay');
      if (existing) return existing;
      var ov = document.createElement('div');
      ov.id = 'bsf-save-overlay';
      ov.className = 'bsf-save-overlay';
      ov.innerHTML = '<div class="bsf-save-overlay-box">' +
        '<div class="bsf-save-overlay-ring"></div>' +
        '<div class="bsf-save-overlay-label">' + escapeHtml(label || T.savingLabel || '저장 중…') + '</div>' +
        '</div>';
      document.body.appendChild(ov);
      return ov;
    }
    function hideSaveOverlay() {
      var ov = document.getElementById('bsf-save-overlay');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }
    // ── 포맷 카드 3단계 상태 판정 ─────────────────────────────────────────────
    // returns 'recommended' | 'available' | 'unavailable'
    function getFormatCardState(formatId, selected) {
      var hasStory = selected.some(function (i) { return i.type === 'text'; });
      var hasImage = selected.some(function (i) { return i.type === 'image' && i.url; });
      var hasVideo = selected.some(function (i) { return i.type === 'video' && i.url; });
      var imageCount = selected.filter(function (i) { return i.type === 'image' && i.url; }).length;
      var videoDuration = null;
      for (var k = 0; k < selected.length; k++) {
        var s = selected[k];
        if (s.type === 'video' && s.duration != null) { videoDuration = s.duration; break; }
      }
      var DURATION_UNKNOWN = (videoDuration === null);
      var OVER_600 = (videoDuration !== null && videoDuration > 600);
      var UNDER_60 = (videoDuration !== null && videoDuration < 60);

      switch (formatId) {
        // ── 핵심 5개: 명시 규칙 ────────────────────────────────────────────
        case 'instagram':
          if (!hasImage && !hasVideo) return 'unavailable';
          if (hasVideo && !DURATION_UNKNOWN && OVER_600) return 'unavailable';
          return 'recommended';
        case 'threads':
        case 'x':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          return 'recommended';
        case 'tiktok':
          if (!hasVideo) return 'unavailable';
          if (!DURATION_UNKNOWN && OVER_600) return 'unavailable';
          return 'recommended';
        case 'youtube':
          if (!hasVideo) return 'unavailable';
          if (!DURATION_UNKNOWN && UNDER_60) return 'unavailable';
          return 'recommended';
        case 'youtube-shorts':
          if (!hasVideo) return 'unavailable';
          if (!DURATION_UNKNOWN && OVER_600) return 'unavailable';
          return 'recommended';
        // ── 나머지 7개: 기존 로직 그대로 case 이전 ─────────────────────────
        case 'pinterest':
          if (!hasImage && !hasVideo) return 'unavailable';
          if (hasImage && imageCount === 1) return 'recommended';
          return 'available';
        case 'facebook':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasImage && imageCount >= 1) return 'recommended';
          if (hasStory) return 'recommended';
          return 'available';
        case 'linkedin':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasStory) return 'recommended';
          return 'available';
        case 'naver-blog':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasImage && imageCount >= 2) return 'recommended';
          if (hasStory) return 'recommended';
          return 'available';
        case 'naver-post':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasImage && imageCount === 1) return 'recommended';
          return 'available';
        case 'kakao':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasImage && imageCount === 1) return 'recommended';
          return 'available';
        case 'band':
          if (!hasStory && !hasImage && !hasVideo) return 'unavailable';
          if (hasStory) return 'recommended';
          return 'available';
        default:
          return 'available';
      }
    }
    function getCurrentSelectedAssetItems() {
      var arr = assetItems.filter(function (item) {
        return selectedAssetIds.indexOf(String(item.id || '').trim()) >= 0;
      });
      // 스토리 가상 카드(projectId:story)는 assetItems에 없으므로 별도 추가
      var storyVId = projectId + ':story';
      if (selectedAssetIds.indexOf(storyVId) >= 0) {
        arr.push({ id: storyVId, type: 'text', virtual: true });
      }
      return arr;
    }
    // 진행 중인 디바운스 저장이 있다면 contenteditable 현재 값을 즉시 formatDrafts에 반영
    function flushPendingDraftEdits() {
      var ces = root.querySelectorAll('[data-draft-field][contenteditable]');
      if (!ces.length) return;
      var nextDrafts = Object.assign({}, formatDrafts || {});
      var changed = false;
      ces.forEach(function (ce) {
        var fmtId = String(ce.dataset.draftFormat || '').trim();
        var fieldKey = String(ce.dataset.draftField || '').trim();
        if (!fmtId || !fieldKey) return;
        var cur = (ce.innerText || ce.textContent || '').trim();
        var stored = String((nextDrafts[fmtId] && nextDrafts[fmtId][fieldKey]) || '').trim();
        if (cur !== stored) {
          nextDrafts[fmtId] = Object.assign({}, nextDrafts[fmtId] || {});
          nextDrafts[fmtId][fieldKey] = cur;
          changed = true;
        }
      });
      if (!changed) return;
      formatDrafts = nextDrafts;
      if (_draftSaveTimer) { clearTimeout(_draftSaveTimer); _draftSaveTimer = null; }
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextDrafts })
          .then(function () { setSaveBtnEnabled(false); })
          .catch(function () {});
      }
    }
    // 배포 완료 상태를 영구 저장
    // ① 전용 localStorage 키 (소용량, 서버 머지 경쟁 조건에 영향 받지 않음)
    // ② payload (다기기 동기화용 서버 저장)
    function persistDeployedFormats() {
      try {
        localStorage.setItem('nk_bs_deployed_' + projectId, JSON.stringify(Object.assign({}, _deployedFormats)));
      } catch (_) {}
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        NK.service.project.updatePayload(projectId, { brandStudioDeployedFormats: Object.assign({}, _deployedFormats) })
          .catch(function () {});
      }
    }
    // 배포 요약 영역을 현재 selectedFormats + formatDrafts 기준으로 재빌드
    function refreshDeploySummary() {
      var summaryEl = root.querySelector('.bsf-deploy-summary');
      if (summaryEl) summaryEl.innerHTML = buildDeploySummaryHtml();
    }
    // 선택된 자산 중 아직 URL이 채워지지 않은(비동기 하이드레이션 중) 미디어가 있는지 판단.
    // 선택 id가 assetItems에 아직 없거나, image/video인데 url이 비어 있으면 로딩 중으로 간주.
    function hasUnhydratedSelectedMedia() {
      return selectedAssetIds.some(function (id) {
        var aid = String(id || '').trim();
        if (!aid || aid === storyVirtualId) return false;
        var item = assetItems.find(function (a) { return String(a.id || '').trim() === aid; });
        if (!item) return true; // 선택됐지만 아직 로드 안 됨
        var type = String(item.type || '').trim();
        if ((type === 'video' || type === 'image') && !item.url) return true;
        return false;
      });
    }
    // selectedFormats에서 unavailable 상태인 포맷을 제거하고 UI/저장까지 동기화
    function pruneUnavailableSelectedFormats() {
      var current = getCurrentSelectedAssetItems();
      var keep = selectedFormats.filter(function (fid) {
        return getFormatCardState(fid, current) !== 'unavailable';
      });
      if (keep.length === selectedFormats.length) return false; // 변경 없음
      selectedFormats = keep;
      // ① 카드 is-selected 동기화
      root.querySelectorAll('[data-action="brand-toggle-format"]').forEach(function (card) {
        var fid = String(card.dataset.formatId || '').trim();
        card.classList.toggle('is-selected', selectedFormats.indexOf(fid) >= 0);
      });
      // ② step 2 바 업데이트
      var step2Btn = root.querySelector('[data-action="brand-set-step"][data-step="2"]');
      if (step2Btn) {
        step2Btn.classList.toggle('is-done', selectedFormats.length > 0);
        var step2Val = step2Btn.querySelector('.bsf-step-val');
        if (step2Val) step2Val.textContent = selectedFormats.length ? T.stepValSelected(selectedFormats.length) : T.stepValNone;
      }
      // ③ ctrl bar 교체 (현재 step이 2일 때만 즉시 반영)
      var ctrlBar = root.querySelector('.bsf-ctrl-bar');
      if (ctrlBar) {
        var activeStepBtn = root.querySelector('[data-action="brand-set-step"].is-active');
        var curStep = activeStepBtn ? parseInt(activeStepBtn.dataset.step || '0', 10) : 0;
        var newCtrlHtml = makeCtrlBarHtml(curStep);
        if (newCtrlHtml) ctrlBar.innerHTML = newCtrlHtml;
        else ctrlBar.remove();
      }
      // ④ 드래프트 탭/패널 visibility 업데이트
      root.querySelectorAll('.bsf-draft-tab').forEach(function (tab) {
        var fid = String(tab.dataset.draftTab || '').trim();
        tab.style.display = (selectedFormats.indexOf(fid) >= 0) ? '' : 'none';
      });
      root.querySelectorAll('.bsf-format-draft-panel').forEach(function (panel) {
        var fid = String(panel.dataset.draftFormat || '').trim();
        panel.style.display = (selectedFormats.indexOf(fid) >= 0) ? '' : 'none';
      });
      // ⑤ activeDraftTab이 제거됐으면 첫 번째로 이동
      if (selectedFormats.indexOf(activeDraftTabOrFirst) < 0) {
        activeDraftTabOrFirst = selectedFormats.length ? selectedFormats[0] : '';
        root.querySelectorAll('.bsf-draft-tab').forEach(function (tab) {
          tab.classList.toggle('is-active', tab.dataset.draftTab === activeDraftTabOrFirst);
        });
        root.querySelectorAll('.bsf-format-draft-panel').forEach(function (panel) {
          panel.classList.toggle('is-active', panel.dataset.draftFormat === activeDraftTabOrFirst);
        });
        var rgnBtn = root.querySelector('.bsf-draft-regen-head');
        if (rgnBtn) rgnBtn.dataset.formatId = activeDraftTabOrFirst;
      }
      // ⑥ 배포 요약 즉시 재빌드 (제거된 포맷 카드 자동 사라짐)
      refreshDeploySummary();
      // ⑦ 비동기 저장
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        var prunePatch = { brandStudioSelectedFormats: selectedFormats.slice() };
        if (activeDraftTabOrFirst) prunePatch.brandStudioActiveDraftTab = activeDraftTabOrFirst;
        NK.service.project.updatePayload(projectId, prunePatch).catch(function () {});
      }
      return true;
    }
    // 초안 탭 DOM이 selectedFormats와 불일치하면 탭·패널을 재빌드
    function refreshDraftSection() {
      var panelsContainer = root.querySelector('.bsf-format-draft-panels');
      if (!panelsContainer) return;
      var domIds = Array.prototype.map.call(
        panelsContainer.querySelectorAll('[data-draft-format]'),
        function (el) { return String(el.dataset.draftFormat || '').trim(); }
      );
      // 선택 포맷과 DOM 패널이 모두 일치하면 건너뜀
      var inSync = domIds.length === selectedFormats.length &&
        selectedFormats.every(function (fid) { return domIds.indexOf(fid) >= 0; }) &&
        domIds.every(function (fid) { return selectedFormats.indexOf(fid) >= 0; });
      if (inSync) return;
      // 편집 중인 contenteditable 내용을 먼저 flush
      flushPendingDraftEdits();
      // 현재 selectedAssetIds 기준으로 미디어 URL 재계산
      var curSelImgs = imageItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
      var curSelVids = videoItems.filter(function (i) { return selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0 && i.url; });
      draftFirstImgUrl = curSelImgs.length ? String(curSelImgs[0].url || '') : '';
      draftFirstVidUrl = curSelVids.length ? String(curSelVids[0].url || '') : '';
      // activeDraftTab 유효성 검증
      if (selectedFormats.indexOf(activeDraftTabOrFirst) < 0) {
        activeDraftTabOrFirst = selectedFormats.length ? selectedFormats[0] : '';
      }
      // 탭 재빌드
      var headRow = root.querySelector('.bsf-draft-head-row');
      if (headRow) {
        var oldTabs = headRow.querySelector('.bsf-draft-tabs');
        if (oldTabs) oldTabs.remove();
        if (selectedFormats.length) {
          var newTabsHtml = '<div class="bsf-draft-tabs">' + selectedFormats.map(function (fid) {
            var fmt = formatItems.find(function (f) { return f.id === fid; });
            var draft = (formatDrafts && formatDrafts[fid]) || {};
            var hasDraft = !!(String(draft.caption || '').trim() || String(draft.hashtags || '').trim());
            var isActive = fid === activeDraftTabOrFirst;
            return '<button type="button" class="bsf-draft-tab' + (isActive ? ' is-active' : '') + (hasDraft ? ' has-draft' : '') + '" data-action="brand-set-draft-tab" data-draft-tab="' + escapeHtml(fid) + '">' +
              escapeHtml(fmt ? fmt.title : fid) + '</button>';
          }).join('') + '</div>';
          var tmp = document.createElement('div');
          tmp.innerHTML = newTabsHtml;
          var regenBtn = headRow.querySelector('.bsf-draft-regen-head');
          headRow.insertBefore(tmp.firstChild, regenBtn || null);
        }
      }
      // 패널 재빌드
      panelsContainer.innerHTML = selectedFormats.map(function (fid) {
        var fmt = formatItems.find(function (f) { return f.id === fid; });
        var isActive = fid === activeDraftTabOrFirst;
        var draft = (formatDrafts && formatDrafts[fid]) || {};
        return buildPlatformPreviewCard(fid, fmt, isActive, draft);
      }).join('');
      // regen 버튼 포맷 ID 동기화
      var rgnBtn = root.querySelector('.bsf-draft-regen-head');
      if (rgnBtn) rgnBtn.dataset.formatId = activeDraftTabOrFirst;
      bindDeferredHydrationFlush(root);
      initMockVideoThumbs();
    }
    // 카드 클래스/뱃지/lock을 in-place로 갱신 (자산 변경/duration 도착 시)
    function refreshFormatCardStates() {
      // 먼저 unavailable로 바뀐 선택 포맷 제거
      pruneUnavailableSelectedFormats();
      var current = getCurrentSelectedAssetItems();
      var cards = root.querySelectorAll('.bsf-format-card');
      cards.forEach(function (card) {
        var fid = String(card.dataset.formatId || '').trim();
        if (!fid) return;
        var newState = getFormatCardState(fid, current);
        card.classList.remove('bsf-format-card--recommended', 'bsf-format-card--available', 'bsf-format-card--unavailable');
        card.classList.add('bsf-format-card--' + newState);
        if (newState === 'unavailable') {
          card.dataset.unavailable = 'true';
        } else {
          delete card.dataset.unavailable;
        }
        var existingBadge = card.querySelector('.bsf-format-card__badge');
        if (newState === 'recommended' && !existingBadge) {
          var b = document.createElement('div');
          b.className = 'bsf-format-card__badge';
          b.setAttribute('aria-label', isEn ? 'Recommended' : '추천');
          b.innerHTML = _starSvg;
          card.insertBefore(b, card.firstChild);
        } else if (newState !== 'recommended' && existingBadge) {
          existingBadge.remove();
        }
        var existingLock = card.querySelector('.bsf-format-card__lock');
        if (newState === 'unavailable' && !existingLock) {
          var l = document.createElement('div');
          l.className = 'bsf-format-card__lock';
          l.textContent = (isEn ? '🔒 Asset required' : '🔒 자산 필요');
          card.appendChild(l);
        } else if (newState !== 'unavailable' && existingLock) {
          existingLock.remove();
        }
      });
    }
    // 영상 썸네일 첫 프레임 강제 시크 + 프레임 준비 후 fade-in + duration 캡처
    function initVideoThumbs() {
      root.querySelectorAll('.bsf-thumb-video').forEach(function (v) {
        if (v.dataset.thumbInit) return; // 이미 처리됨
        v.dataset.thumbInit = '1';
        function showFrame() { v.classList.add('is-loaded'); }
        function trySeek() {
          try {
            // duration이 있으면 10% 지점(최소 0.5s)으로 시크해 검은 첫 프레임 회피
            var t = (v.duration && !isNaN(v.duration)) ? Math.min(Math.max(v.duration * 0.1, 0.5), 5) : 0.5;
            v.currentTime = t;
          } catch (e) { showFrame(); }
        }
        function captureDuration() {
          var itemId = v.dataset.itemId;
          if (!itemId || !v.duration || isNaN(v.duration)) return;
          var sec = Math.round(v.duration);
          for (var i = 0; i < assetItems.length; i++) {
            if (String(assetItems[i].id) === String(itemId)) {
              if (assetItems[i].duration == null) {
                assetItems[i].duration = sec;
                // 자산 변경 없이 duration만 새로 들어왔으면 카드 상태 갱신
                refreshFormatCardStates();
              }
              break;
            }
          }
        }
        var fallback = setTimeout(showFrame, 2000);
        v.addEventListener('seeked', function () { clearTimeout(fallback); showFrame(); }, { once: true });
        v.addEventListener('loadeddata', function () { clearTimeout(fallback); showFrame(); }, { once: true });
        if (v.readyState >= 4) {
          clearTimeout(fallback); showFrame();
        } else if (v.readyState >= 1) {
          captureDuration();
          trySeek();
        } else {
          v.addEventListener('loadedmetadata', function () {
            captureDuration();
            trySeek();
          }, { once: true });
          v.addEventListener('error', function () { clearTimeout(fallback); showFrame(); }, { once: true });
        }
      });
    }
    // 이미지 썸네일 로드 후 fade-in (로드 전엔 배경색 플레이스홀더만 보임)
    function initImageThumbs() {
      root.querySelectorAll('.bsf-thumb-img').forEach(function (img) {
        if (img.dataset.thumbInit) return;
        img.dataset.thumbInit = '1';
        function show() { img.classList.add('is-loaded'); }
        if (img.complete && img.naturalWidth > 0) {
          show();
        } else {
          img.addEventListener('load', show, { once: true });
          img.addEventListener('error', show, { once: true });
        }
      });
    }
    // 초안 미리보기 영상(Shorts·TikTok 목업) 시크 초기화 — 검은 첫 프레임 회피
    function initMockVideoThumbs() {
      root.querySelectorAll('.bsf-mock-shorts-vid, .bsf-mock-tiktok-vid, video.bsf-mock-x-media-el').forEach(function (v) {
        if (v.dataset.mockVidInit) return;
        v.dataset.mockVidInit = '1';
        function trySeekMock() {
          try {
            var t = (v.duration && !isNaN(v.duration)) ? Math.min(Math.max(v.duration * 0.1, 0.5), 5) : 0.5;
            v.currentTime = t;
          } catch (e) {}
        }
        if (v.readyState >= 1) {
          trySeekMock();
        } else {
          v.addEventListener('loadedmetadata', trySeekMock, { once: true });
        }
      });
    }
    // ─── Instagram 이미지 슬라이더 ─────────────────────────────────────────────
    function initIgSlider() {
      root.querySelectorAll('[data-ig-slider]').forEach(function (slider) {
        if (slider.dataset.igSliderInit) return;
        slider.dataset.igSliderInit = '1';
        var slides = slider.querySelector('[data-ig-slides]');
        if (!slides || slides.children.length <= 1) return;
        var mockIg = slider.closest('.bsf-mockup');
        var total = slides.children.length;
        var current = 0;
        function goTo(idx) {
          current = ((idx % total) + total) % total;
          slides.style.transform = 'translateX(-' + (current * 100) + '%)';
          if (mockIg) {
            mockIg.querySelectorAll('[data-dot-idx]').forEach(function (dot) {
              dot.classList.toggle('active', Number(dot.dataset.dotIdx) === current);
            });
          }
        }
        var startX = 0;
        slider.addEventListener('pointerdown', function (e) { startX = e.clientX; });
        slider.addEventListener('pointerup', function (e) {
          var diff = e.clientX - startX;
          if (Math.abs(diff) > 30) goTo(diff < 0 ? current + 1 : current - 1);
        });
      });
      // dot 클릭: 이벤트 위임 (한 번만 등록)
      if (!document.__bsfIgDotBound) {
        document.__bsfIgDotBound = true;
        document.addEventListener('click', function (e) {
          var dot = e.target && e.target.closest ? e.target.closest('[data-dot-idx]') : null;
          if (!dot) return;
          var mockIg = dot.closest('.bsf-mockup');
          if (!mockIg) return;
          var slides = mockIg.querySelector('[data-ig-slides]');
          if (!slides) return;
          var total = slides.children.length;
          var idx = Math.max(0, Math.min(Number(dot.dataset.dotIdx), total - 1));
          slides.style.transform = 'translateX(-' + (idx * 100) + '%)';
          mockIg.querySelectorAll('[data-dot-idx]').forEach(function (d) {
            d.classList.toggle('active', Number(d.dataset.dotIdx) === idx);
          });
        });
      }
    }
    // ─── Custom DateTime Picker ────────────────────────────────────────────────
    function dtParsed(val) {
      var m = (val || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null;
    }
    function dtToISO(y, mo, d, h, mi) {
      var p = function (n) { return String(n).padStart(2, '0'); };
      return y + '-' + p(mo) + '-' + p(d) + 'T' + p(h) + ':' + p(mi);
    }
    function dtDisplay(val) {
      if (val === 'now') return isEn ? 'Immediately' : '즉시';
      var dp = dtParsed(val);
      if (!dp) return isEn ? 'Select date & time' : '날짜 · 시간 선택';
      var p = function (n) { return String(n).padStart(2, '0'); };
      return isEn
        ? (dp.y + '/' + p(dp.mo) + '/' + p(dp.d) + '  ' + p(dp.h) + ':' + p(dp.mi))
        : (dp.y + '. ' + p(dp.mo) + '. ' + p(dp.d) + '.  ' + p(dp.h) + ':' + p(dp.mi));
    }
    function buildDtPickerHtml(fmtId, fieldKey, currentVal, inputId) {
      var draftAttrs = fmtId ? (' data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '"') : '';
      return (
        '<div class="bsf-dt-picker">' +
        '<input type="hidden" class="bsf-dt-hidden"' + (inputId ? ' id="' + escapeHtml(inputId) + '"' : '') + draftAttrs + ' value="' + escapeHtml(currentVal || '') + '">' +
        '<button type="button" class="bsf-dt-trigger" data-action="bsf-dt-toggle">' +
          _calSvg + '<span class="bsf-dt-txt">' + escapeHtml(dtDisplay(currentVal)) + '</span>' +
        '</button>' +
        (currentVal ? '<button type="button" class="bsf-dt-del" data-action="bsf-dt-clear-val">✕</button>' : '') +
        '</div>'
      );
    }
    function buildDtCalInner(picker) {
      var val = String(picker.dataset.dtValue || '');
      var dp = dtParsed(val); var now = new Date();
      var vy = parseInt(picker.dataset.dtViewY || '') || now.getFullYear();
      var vm = parseInt(picker.dataset.dtViewMo || '') || (now.getMonth() + 1);
      var selD = (dp && dp.y === vy && dp.mo === vm) ? dp.d : 0;
      var selH = dp ? dp.h : 9; var selMi = dp ? dp.mi : 0;
      var dayNames = isEn ? ['Su','Mo','Tu','We','Th','Fr','Sa'] : ['일','월','화','수','목','금','토'];
      var firstDay = new Date(vy, vm - 1, 1).getDay();
      var daysInMonth = new Date(vy, vm, 0).getDate();
      var ty = now.getFullYear(), tm = now.getMonth() + 1, td = now.getDate();
      var moLabel = isEn
        ? (['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][vm - 1] + ' ' + vy)
        : (vy + '년 ' + vm + '월');
      var cells = '';
      for (var i = 0; i < firstDay; i++) cells += '<div class="bsf-dt-empty"></div>';
      for (var d = 1; d <= daysInMonth; d++) {
        var isPast = (vy < ty) || (vy === ty && vm < tm) || (vy === ty && vm === tm && d < td);
        var cls = 'bsf-dt-day' + (d === selD ? ' is-sel' : '') + (vy === ty && vm === tm && d === td ? ' is-today' : '') + (isPast ? ' is-past' : '');
        cells += '<button type="button" class="' + cls + '" data-action="bsf-dt-pick-day" data-dt-d="' + d + '"' + (isPast ? ' disabled' : '') + '>' + d + '</button>';
      }
      return (
        '<div class="bsf-dt-nav">' +
          '<button type="button" class="bsf-dt-nav-btn" data-action="bsf-dt-prev-mo">‹</button>' +
          '<span class="bsf-dt-mo-lbl">' + escapeHtml(moLabel) + '</span>' +
          '<button type="button" class="bsf-dt-nav-btn" data-action="bsf-dt-next-mo">›</button>' +
        '</div>' +
        '<div class="bsf-dt-dow">' + dayNames.map(function (n) { return '<span>' + n + '</span>'; }).join('') + '</div>' +
        '<div class="bsf-dt-grid">' + cells + '</div>' +
        '<div class="bsf-dt-time">' +
          '<div class="bsf-dt-time-col">' +
            '<button type="button" class="bsf-dt-spin" data-action="bsf-dt-h-up">▲</button>' +
            '<input type="number" class="bsf-dt-tinp bsf-dt-h-inp" min="0" max="23" value="' + selH + '">' +
            '<button type="button" class="bsf-dt-spin" data-action="bsf-dt-h-dn">▼</button>' +
          '</div>' +
          '<span class="bsf-dt-time-sep">:</span>' +
          '<div class="bsf-dt-time-col">' +
            '<button type="button" class="bsf-dt-spin" data-action="bsf-dt-m-up">▲</button>' +
            '<input type="number" class="bsf-dt-tinp bsf-dt-m-inp" min="0" max="59" step="5" value="' + selMi + '">' +
            '<button type="button" class="bsf-dt-spin" data-action="bsf-dt-m-dn">▼</button>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-dt-foot">' +
          '<button type="button" class="bsf-dt-foot-del" data-action="bsf-dt-del-val">' + (isEn ? 'Delete' : '삭제') + '</button>' +
          '<button type="button" class="bsf-dt-foot-now" data-action="bsf-dt-now">' + (isEn ? 'Now' : '즉시') + '</button>' +
          '<button type="button" class="bsf-dt-foot-today" data-action="bsf-dt-today">' + (isEn ? 'Today' : '오늘') + '</button>' +
        '</div>'
      );
    }
    function openDtPicker(picker) {
      closeAllDtPickers();
      var now = new Date(); var dp = dtParsed(String(picker.dataset.dtValue || ''));
      picker.dataset.dtViewY = dp ? dp.y : now.getFullYear();
      picker.dataset.dtViewMo = dp ? dp.mo : (now.getMonth() + 1);
      picker.classList.add('is-open');
      var popup = picker.querySelector('.bsf-dt-popup');
      if (!popup) { popup = document.createElement('div'); popup.className = 'bsf-dt-popup'; picker.appendChild(popup); }
      popup.innerHTML = buildDtCalInner(picker);

      // Smart fixed positioning: avoids overflow:hidden clipping, auto up/down
      var trigger = picker.querySelector('.bsf-dt-trigger');
      if (trigger) {
        var rect = trigger.getBoundingClientRect();
        var popupW = 280; var popupH = 330;
        var spaceBelow = window.innerHeight - rect.bottom - 8;
        var spaceAbove = rect.top - 8;
        // Horizontal: align to trigger left, clamp to viewport right edge
        var left = rect.left;
        if (left + popupW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popupW - 8);
        popup.style.position = 'fixed';
        popup.style.zIndex = '9999';
        popup.style.width = popupW + 'px';
        popup.style.left = left + 'px';
        popup.style.right = '';
        // Vertical: open downward when enough space below, otherwise upward
        if (spaceBelow >= popupH || spaceBelow >= spaceAbove) {
          popup.style.top = (rect.bottom + 6) + 'px';
          popup.style.bottom = '';
        } else {
          popup.style.top = '';
          popup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        }
      }

      if (!_dtDocListener) {
        _dtDocListener = function (e) {
          if (!e.target || !e.target.closest || !e.target.closest('.bsf-dt-picker')) closeAllDtPickers();
        };
        document.addEventListener('click', _dtDocListener, true);
      }
    }
    function closeDtPicker(picker) { picker.classList.remove('is-open'); }
    function closeAllDtPickers() {
      root.querySelectorAll('.bsf-dt-picker.is-open').forEach(closeDtPicker);
      if (_dtDocListener) { document.removeEventListener('click', _dtDocListener, true); _dtDocListener = null; }
    }
    function getDtHM(picker) {
      var popup = picker.querySelector('.bsf-dt-popup');
      var dp = dtParsed(String(picker.dataset.dtValue || ''));
      var h = dp ? dp.h : 9, mi = dp ? dp.mi : 0;
      if (popup) {
        var hi = popup.querySelector('.bsf-dt-h-inp'), mii = popup.querySelector('.bsf-dt-m-inp');
        if (hi) h = Math.max(0, Math.min(23, parseInt(hi.value) || 0));
        if (mii) mi = Math.max(0, Math.min(59, parseInt(mii.value) || 0));
      }
      return { h: h, mi: mi };
    }
    function setDtPickerValue(picker, newVal) {
      picker.dataset.dtValue = newVal || '';
      var hidden = picker.querySelector('.bsf-dt-hidden');
      if (hidden) {
        hidden.value = newVal || '';
        var ev = document.createEvent('Event'); ev.initEvent('change', true, true); hidden.dispatchEvent(ev);
      }
      var txt = picker.querySelector('.bsf-dt-txt');
      if (txt) txt.textContent = dtDisplay(newVal || '');
      var delBtn = picker.querySelector('.bsf-dt-del');
      if (newVal && !delBtn) {
        var nb = document.createElement('button'); nb.type = 'button';
        nb.className = 'bsf-dt-del'; nb.dataset.action = 'bsf-dt-clear-val'; nb.textContent = '✕';
        picker.insertBefore(nb, picker.querySelector('.bsf-dt-popup') || null);
      } else if (!newVal && delBtn) { delBtn.remove(); }
    }
    function refreshDtCal(picker) {
      var popup = picker.querySelector('.bsf-dt-popup');
      if (popup) popup.innerHTML = buildDtCalInner(picker);
    }
    function applyDtTime(picker) {
      var dp = dtParsed(String(picker.dataset.dtValue || ''));
      if (!dp) return;
      var hm = getDtHM(picker);
      setDtPickerValue(picker, dtToISO(dp.y, dp.mo, dp.d, hm.h, hm.mi));
    }
    // ───────────────────────────────────────────────────────────────────────────

    root.oninput = function (ev) {
      // dt picker time input 직접 입력 처리
      var timeInp = ev.target && ev.target.closest ? ev.target.closest('.bsf-dt-h-inp, .bsf-dt-m-inp') : null;
      if (timeInp) { var tp = timeInp.closest('.bsf-dt-picker'); if (tp) applyDtTime(tp); return; }
      var ce = ev.target && ev.target.closest ? ev.target.closest('[data-draft-field][contenteditable]') : null;
      if (!ce) return;
      var fmtId = String(ce.dataset.draftFormat || '').trim();
      var fieldKey = String(ce.dataset.draftField || '').trim();
      var newText = (ce.innerText || ce.textContent || '').trim();

      // 즉시: 목업 미러 업데이트
      if (fmtId && fieldKey) {
        var mirrors = root.querySelectorAll('[data-mock-mirror="' + fmtId + '"][data-mock-field="' + fieldKey + '"]');
        var mirrorText = newText.length > 80 ? newText.slice(0, 80) + '…' : (newText || '…');
        for (var mi = 0; mi < mirrors.length; mi++) {
          mirrors[mi].textContent = mirrorText;
        }
        // X/Threads 글자수 즉시 업데이트 (Threads 500자, X 280자)
        if (fieldKey === 'caption' && (fmtId === 'threads' || fmtId === 'x')) {
          var xtLimit = (fmtId === 'threads') ? 500 : 280;
          var countEl = ce.parentElement && ce.parentElement.querySelector('.bsf-charcount');
          if (countEl) {
            var cLen = newText.length;
            countEl.textContent = cLen + ' / ' + xtLimit;
            countEl.className = 'bsf-charcount' + (cLen > xtLimit - 10 ? ' over' : cLen > xtLimit - 60 ? ' warn' : '');
          }
        }
        // Naver Blog SEO 설명 글자수 즉시 업데이트
        if (fieldKey === 'seo_description' && fmtId === 'naver-blog') {
          var seoFld = ce.closest && ce.closest('.bsf-field');
          var seoCountEl = seoFld && seoFld.querySelector('.bsf-seo-count');
          if (seoCountEl) {
            var sLen = newText.length;
            seoCountEl.textContent = sLen + ' / 160';
            seoCountEl.className = 'bsf-charcount bsf-seo-count' + (sLen > 150 ? ' over' : sLen > 130 ? ' warn' : '');
          }
        }
      }

      // 변경 발생 시 저장 버튼 활성화
      setSaveBtnEnabled(true);

      // 800ms 디바운스: 서버 저장
      clearTimeout(_draftSaveTimer);
      _draftSaveTimer = setTimeout(function () {
        if (!fmtId || !fieldKey) return;
        var nextFmtDraft = Object.assign({}, (formatDrafts && formatDrafts[fmtId]) || {});
        nextFmtDraft[fieldKey] = newText;
        var nextFormatDrafts = Object.assign({}, formatDrafts || {});
        nextFormatDrafts[fmtId] = nextFmtDraft;
        formatDrafts = nextFormatDrafts;
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextFormatDrafts })
            .then(function () { setSaveBtnEnabled(false); })
            .catch(function () {});
        }
      }, 800);
    };

    // onchange: select / radio / checkbox(toggle) / input[text|url|datetime] 즉시 저장
    root.onchange = function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-draft-field]') : null;
      if (!el) return;
      if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) return;
      var fmtId = String(el.dataset.draftFormat || '').trim();
      var fieldKey = String(el.dataset.draftField || '').trim();
      if (!fmtId || !fieldKey) return;
      var value = el.type === 'checkbox' ? el.checked : String(el.value || '');
      // privacy_status 변경 시 scheduled_at 행 표시/숨김
      if (fieldKey === 'privacy_status') {
        var scheduledRow = root.querySelector('.bsf-scheduled-row[data-draft-format="' + fmtId + '"]');
        if (scheduledRow) scheduledRow.style.display = (value === 'scheduled') ? '' : 'none';
      }
      var nextDrafts = Object.assign({}, formatDrafts || {});
      nextDrafts[fmtId] = Object.assign({}, nextDrafts[fmtId] || {});
      nextDrafts[fmtId][fieldKey] = value;
      formatDrafts = nextDrafts;
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextDrafts }).catch(function () {});
      }
    };

    root.onclick = function (evt) {
      if (!evt.target.closest('.bsf-dt-picker')) closeAllDtPickers();
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action.indexOf('bsf-dt-') === 0) {
        var dtp = btn.closest('.bsf-dt-picker');
        if (!dtp) return;
        if (action === 'bsf-dt-toggle') {
          if (dtp.classList.contains('is-open')) closeDtPicker(dtp); else { closeAllDtPickers(); openDtPicker(dtp); }
        } else if (action === 'bsf-dt-clear-val' || action === 'bsf-dt-del-val') {
          setDtPickerValue(dtp, ''); closeDtPicker(dtp);
        } else if (action === 'bsf-dt-prev-mo' || action === 'bsf-dt-next-mo') {
          var vy = parseInt(dtp.dataset.dtViewY || '') || new Date().getFullYear();
          var vm = parseInt(dtp.dataset.dtViewMo || '') || (new Date().getMonth() + 1);
          if (action === 'bsf-dt-prev-mo') { vm--; if (vm < 1) { vm = 12; vy--; } }
          else { vm++; if (vm > 12) { vm = 1; vy++; } }
          dtp.dataset.dtViewY = vy; dtp.dataset.dtViewMo = vm; refreshDtCal(dtp);
        } else if (action === 'bsf-dt-pick-day') {
          var d = parseInt(btn.dataset.dtD || '') || 0; if (!d) return;
          var hm = getDtHM(dtp);
          var vy2 = parseInt(dtp.dataset.dtViewY || '') || new Date().getFullYear();
          var vm2 = parseInt(dtp.dataset.dtViewMo || '') || (new Date().getMonth() + 1);
          setDtPickerValue(dtp, dtToISO(vy2, vm2, d, hm.h, hm.mi)); refreshDtCal(dtp);
        } else if (action === 'bsf-dt-h-up' || action === 'bsf-dt-h-dn') {
          var hi = dtp.querySelector('.bsf-dt-h-inp');
          if (hi) { hi.value = Math.min(23, Math.max(0, (parseInt(hi.value) || 0) + (action === 'bsf-dt-h-up' ? 1 : -1))); applyDtTime(dtp); }
        } else if (action === 'bsf-dt-m-up' || action === 'bsf-dt-m-dn') {
          var mii = dtp.querySelector('.bsf-dt-m-inp');
          if (mii) { mii.value = Math.min(59, Math.max(0, (parseInt(mii.value) || 0) + (action === 'bsf-dt-m-up' ? 5 : -5))); applyDtTime(dtp); }
        } else if (action === 'bsf-dt-now') {
          setDtPickerValue(dtp, 'now'); closeDtPicker(dtp);
        } else if (action === 'bsf-dt-today') {
          var now2 = new Date(); var hm2 = getDtHM(dtp);
          dtp.dataset.dtViewY = now2.getFullYear(); dtp.dataset.dtViewMo = now2.getMonth() + 1;
          setDtPickerValue(dtp, dtToISO(now2.getFullYear(), now2.getMonth() + 1, now2.getDate(), hm2.h, hm2.mi));
          refreshDtCal(dtp);
        }
        return;
      }
      if (action === 'character-open-new' || action === 'character-edit' || action === 'character-deactivate' || action === 'character-save' || action === 'character-cancel') return;
      if (action === 'brand-set-step') {
        var targetStep = parseInt(String(btn.dataset.step || '0'), 10);
        if (!targetStep || targetStep < 1 || targetStep > 4) return;
        var hasPendingAsset = !!_assetSaveTimer;
        switchToStep(targetStep); // 즉시 패널 전환
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          NK.service.project.updatePayload(projectId, { brandStudioActiveStep: targetStep }).catch(function () {});
        }
        if (hasPendingAsset) {
          // 대기 중인 자산 저장이 있을 때만 스피너 + flush
          showStepSpinner(targetStep);
          Promise.all([flushAssetSave(), new Promise(function (r) { setTimeout(r, 300); })]).then(function () {
            hideStepSpinner(targetStep);
          });
        }
        return;
      }
      if (action === 'brand-step-next') {
        var fromStep = parseInt(String(btn.dataset.step || '0'), 10);
        var nextStep2 = fromStep + 1;
        if (!nextStep2 || nextStep2 < 1 || nextStep2 > 4) return;
        var hasPendingAsset2 = !!_assetSaveTimer;
        switchToStep(nextStep2); // 즉시 패널 전환
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          NK.service.project.updatePayload(projectId, { brandStudioActiveStep: nextStep2 }).catch(function () {});
        }
        if (hasPendingAsset2) {
          showStepSpinner(nextStep2);
          Promise.all([flushAssetSave(), new Promise(function (r) { setTimeout(r, 300); })]).then(function () {
            hideStepSpinner(nextStep2);
          });
        }
        return;
      }
      if (action === 'brand-toggle-format') {
        // 불가 상태 카드는 클릭 완전 차단
        if (btn.dataset.unavailable === 'true') return;
        var formatId = String(btn.dataset.formatId || '').trim();
        if (!formatId) return;
        // 즉시 토글 (리렌더 없음)
        var fmtIdx = selectedFormats.indexOf(formatId);
        if (fmtIdx >= 0) selectedFormats.splice(fmtIdx, 1); else selectedFormats.push(formatId);
        btn.classList.toggle('is-selected', selectedFormats.indexOf(formatId) >= 0);
        // activeDraftTab 유지
        if (selectedFormats.indexOf(activeDraftTabOrFirst) < 0) {
          activeDraftTabOrFirst = selectedFormats.length ? selectedFormats[0] : '';
        }
        // step 2 바 업데이트
        var step2Btn = root.querySelector('[data-action="brand-set-step"][data-step="2"]');
        if (step2Btn) {
          step2Btn.classList.toggle('is-done', selectedFormats.length > 0);
          var step2Val2 = step2Btn.querySelector('.bsf-step-val');
          if (step2Val2) step2Val2.textContent = selectedFormats.length ? T.stepValSelected(selectedFormats.length) : T.stepValNone;
        }
        // ctrl bar 교체
        var fmtCtrlBar = root.querySelector('.bsf-ctrl-bar');
        if (fmtCtrlBar) fmtCtrlBar.innerHTML = makeCtrlBarHtml(2);
        // 변경 발생 → 저장 버튼 활성화 (자산 토글과 동일 패턴)
        setSaveBtnEnabled(true);
        // 비동기 저장
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var fmtPatch = { brandStudioSelectedFormats: selectedFormats.slice(), brandStudioActiveDraftTab: activeDraftTabOrFirst };
        NK.service.project.updatePayload(projectId, fmtPatch)
          .then(function () { setSaveBtnEnabled(false); })
          .catch(function (err) { alert(T.alertSaveFormatFail(err && err.message ? err.message : err)); });
        return;
      }
      if (action === 'brand-set-draft-tab') {
        var tabId = String(btn.dataset.draftTab || '').trim();
        if (!tabId) return;
        // 즉시 탭/패널 전환 (리렌더 없음)
        activeDraftTabOrFirst = tabId;
        root.querySelectorAll('.bsf-draft-tab').forEach(function (tb) {
          tb.classList.toggle('is-active', tb.dataset.draftTab === tabId);
        });
        root.querySelectorAll('.bsf-format-draft-panel').forEach(function (panel) {
          panel.classList.toggle('is-active', panel.dataset.draftFormat === tabId);
        });
        initMockVideoThumbs();
        // 탭 전환 시 저장 버튼 초기화 (새 탭은 변경 없음)
        setSaveBtnEnabled(false);
        // 헤더 재생성 버튼의 data-format-id 동기화
        var rgnBtn = root.querySelector('.bsf-draft-regen-head');
        if (rgnBtn) rgnBtn.dataset.formatId = tabId;
        // 비동기 저장
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        NK.service.project.updatePayload(projectId, { brandStudioActiveDraftTab: tabId })
          .catch(function () {});
        return;
      }
      if (action === 'brand-regen-draft') {
        var regenFmtId = String(btn.dataset.formatId || '').trim();
        if (!regenFmtId) return;
        var regenPanel = (btn.closest ? btn.closest('.bsf-format-draft-panel') : null) ||
          root.querySelector('.bsf-format-draft-panel[data-draft-format="' + regenFmtId + '"]');
        if (!regenPanel) return;
        showDraftSkeleton(regenPanel);
        var brandCtx = buildBrandContext(payload, brandView, knowledge);
        (NK.api && NK.api.draftGenerate
          ? NK.api.draftGenerate({
              platformId: regenFmtId,
              story: buildEpisodeStory(payload, project.scenes || []),
              brandContext: brandCtx,
            })
          : Promise.reject(new Error('api_not_ready'))
        ).then(function (result) {
          hideDraftSkeleton(regenPanel);
          ['caption', 'hashtags', 'title', 'first_comment'].forEach(function (fieldKey) {
            if (!result[fieldKey]) return;
            var ceEl = regenPanel.querySelector('[data-draft-format="' + regenFmtId + '"][data-draft-field="' + fieldKey + '"]');
            if (ceEl) {
              if (ceEl.tagName === 'INPUT' || ceEl.tagName === 'TEXTAREA') ceEl.value = result[fieldKey];
              else ceEl.innerText = result[fieldKey];
            }
            var mirror = regenPanel.querySelector('[data-mock-mirror="' + regenFmtId + '"][data-mock-field="' + fieldKey + '"]');
            if (mirror) {
              var displayText = String(result[fieldKey]);
              mirror.textContent = displayText.length > 80 ? displayText.slice(0, 80) + '…' : displayText;
            }
          });
          var regenDrafts = Object.assign({}, formatDrafts);
          regenDrafts[regenFmtId] = Object.assign({}, regenDrafts[regenFmtId] || {}, result);
          formatDrafts = regenDrafts;
          if (NK.service && NK.service.project && NK.service.project.updatePayload) {
            NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: regenDrafts }).catch(function () {});
          }
        }).catch(function (err) {
          hideDraftSkeleton(regenPanel);
          console.error('[draft-generate]', err && err.message ? err.message : err);
        });
        return;
      }
      if (action === 'brand-refine-draft') {
        var refineFmtId = String(btn.dataset.formatId || '').trim();
        if (!refineFmtId) return;
        var refinePanel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + refineFmtId + '"]');
        if (!refinePanel) return;
        var refineInput = refinePanel.querySelector('.bsf-refine-input[data-refine-format="' + refineFmtId + '"]');
        var instruction = refineInput ? String(refineInput.value || '').trim() : '';
        if (!instruction) {
          if (refineInput) refineInput.focus();
          return;
        }
        var currentDraftObj = formatDrafts && formatDrafts[refineFmtId] ? formatDrafts[refineFmtId] : {};
        btn.disabled = true;
        showDraftSkeleton(refinePanel);
        var refineBrandCtx = buildBrandContext(payload, brandView, knowledge);
        var refineStory = buildEpisodeStory(payload, project.scenes || []);
        (NK.api && NK.api.draftGenerate
          ? NK.api.draftGenerate({
              platformId: refineFmtId,
              story: refineStory,
              brandContext: refineBrandCtx,
              userInstruction: instruction,
              currentDraft: {
                caption:       String(currentDraftObj.caption       || '').trim(),
                hashtags:      String(currentDraftObj.hashtags      || '').trim(),
                title:         String(currentDraftObj.title         || '').trim(),
                first_comment: String(currentDraftObj.first_comment || '').trim(),
              },
            })
          : Promise.reject(new Error('api_not_ready'))
        ).then(function (result) {
          hideDraftSkeleton(refinePanel);
          ['caption', 'hashtags', 'title', 'first_comment'].forEach(function (fieldKey) {
            if (!result[fieldKey]) return;
            var ceEl = refinePanel.querySelector('[data-draft-format="' + refineFmtId + '"][data-draft-field="' + fieldKey + '"]');
            if (ceEl) {
              if (ceEl.tagName === 'INPUT' || ceEl.tagName === 'TEXTAREA') ceEl.value = result[fieldKey];
              else ceEl.innerText = result[fieldKey];
            }
            var mirror = refinePanel.querySelector('[data-mock-mirror="' + refineFmtId + '"][data-mock-field="' + fieldKey + '"]');
            if (mirror) { var dt = String(result[fieldKey]); mirror.textContent = dt.length > 80 ? dt.slice(0, 80) + '…' : dt; }
          });
          var refinedDrafts = Object.assign({}, formatDrafts);
          refinedDrafts[refineFmtId] = Object.assign({}, refinedDrafts[refineFmtId] || {}, result);
          formatDrafts = refinedDrafts;
          if (refineInput) refineInput.value = '';
          if (NK.service && NK.service.project && NK.service.project.updatePayload) {
            NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: refinedDrafts }).catch(function () {});
          }
        }).catch(function (err) {
          hideDraftSkeleton(refinePanel);
          console.error('[draft-refine]', err && err.message ? err.message : err);
        }).finally(function () {
          btn.disabled = false;
          btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
        });
        return;
      }
      if (action === 'brand-copy-field') {
        var copyVal = String(btn.dataset.copyValue || '').trim();
        if (!copyVal) {
          var cpFmt = String(btn.dataset.draftFormat || '').trim();
          var cpKey = String(btn.dataset.fieldKey || '').trim();
          var cpEl = cpFmt && cpKey ? root.querySelector('[data-draft-format="' + cpFmt + '"][data-draft-field="' + cpKey + '"]') : null;
          copyVal = cpEl ? ((cpEl.innerText || cpEl.textContent || '').trim()) : '';
        }
        if (!copyVal) return;
        function applyCopiedFeedback() {
          var origHtml = btn.innerHTML;
          btn.innerHTML = '✓';
          btn.classList.add('copied');
          setTimeout(function () { btn.innerHTML = origHtml; btn.classList.remove('copied'); }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyVal).then(applyCopiedFeedback).catch(function () {
            try { var ta = document.createElement('textarea'); ta.value = copyVal; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); applyCopiedFeedback(); } catch (_) {}
          });
        } else {
          try { var ta = document.createElement('textarea'); ta.value = copyVal; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); applyCopiedFeedback(); } catch (_) {}
        }
        return;
      }
      if (action === 'brand-save-format-draft') {
        if (!activeDraftTabOrFirst || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        flushAssetSave(); // 대기 중인 자산 선택 변경도 함께 flush
        var currentFmtId = activeDraftTabOrFirst;
        var nextFmtDraft = Object.assign({}, (formatDrafts && formatDrafts[currentFmtId]) || {});
        // contenteditable 필드 읽기
        var activePanel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + currentFmtId + '"]');
        if (activePanel) {
          activePanel.querySelectorAll('[data-draft-field]').forEach(function (el) {
            var key = String(el.dataset.draftField || '').trim();
            if (!key) return;
            if (el.getAttribute('contenteditable') === 'true' || el.isContentEditable) {
              nextFmtDraft[key] = (el.innerText || el.textContent || '').trim();
            } else if (el.tagName === 'SELECT') {
              nextFmtDraft[key] = String(el.value || '').trim();
            } else if (el.type === 'radio') {
              if (el.checked) nextFmtDraft[key] = String(el.value || '').trim();
            } else if (el.type === 'checkbox') {
              nextFmtDraft[key] = el.checked;
            } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              nextFmtDraft[key] = String(el.value || '').trim();
            }
          });
        }
        // legacy textarea fallback
        var captionEl = root.querySelector('#brand-draft-caption-' + currentFmtId);
        var hashtagEl = root.querySelector('#brand-draft-hashtag-' + currentFmtId);
        var titleElFmt = root.querySelector('#brand-draft-title-' + currentFmtId);
        if (captionEl) nextFmtDraft.caption = String(captionEl.value || '').trim();
        if (hashtagEl) nextFmtDraft.hashtags = String(hashtagEl.value || '').trim();
        if (titleElFmt) nextFmtDraft.title = String(titleElFmt.value || '').trim();
        var nextFormatDrafts = Object.assign({}, formatDrafts || {});
        nextFormatDrafts[currentFmtId] = nextFmtDraft;
        btn.disabled = true;
        showSaveOverlay();
        NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextFormatDrafts })
          .then(function (result) {
            if (result && result.draft) { renderNext(result.draft); } else { setSaveBtnEnabled(false); }
            alert(T.alertDraftSaved);
          })
          .catch(function (err) { alert(T.alertDraftSaveFail(err && err.message ? err.message : err)); btn.disabled = false; })
          .finally(function () { hideSaveOverlay(); });
        return;
      }
      if (action === 'brand-generate-all-drafts') {
        if (!selectedFormats.length || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        // 원클릭 초안: 풀스크린 블러 + 스피너 (이미 원스탑에서 떠 있다면 그대로 유지)
        showSaveOverlay(T.oneClickLoadingLabel || T.savingLabel);
        // Offline fallback: rule-based only when API is unavailable
        if (!NK.api || !NK.api.draftGenerate) {
          var nextAllDrafts = Object.assign({}, formatDrafts || {});
          selectedFormats.forEach(function (fid) {
            var fmt = formatItems.find(function (f) { return f.id === fid; });
            nextAllDrafts[fid] = Object.assign({}, nextAllDrafts[fid] || {}, {
              caption: buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge),
              hashtags: buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge)
            });
          });
          NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextAllDrafts })
            .then(function (result) { if (result && result.draft) renderNext(result.draft); })
            .catch(function (err) { alert(T.alertDraftGenFail(err && err.message ? err.message : err)); })
            .finally(function () {
              btn.disabled = false;
              if (window.__bsfOneClickInProgress) {
                window.__bsfOneClickInProgress = false;
                if (window.__bsfOneClickSafetyTimer) { clearTimeout(window.__bsfOneClickSafetyTimer); window.__bsfOneClickSafetyTimer = null; }
              }
              hideSaveOverlay();
            });
          return;
        }
        var genBrandCtx = buildBrandContext(payload, brandView, knowledge);
        var genStory = buildEpisodeStory(payload, project.scenes || []);
        // 모든 패널에 스켈레톤 표시
        selectedFormats.forEach(function (fid) {
          var panel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + fid + '"]');
          if (panel) showDraftSkeleton(panel);
        });
        // 패널 DOM 업데이트 헬퍼
        function applyDraftToPanel(fid, res) {
          var panel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + fid + '"]');
          if (!panel) return;
          hideDraftSkeleton(panel);
          ['caption', 'hashtags', 'title', 'first_comment'].forEach(function (fieldKey) {
            if (!res[fieldKey]) return;
            var ceEl = panel.querySelector('[data-draft-format="' + fid + '"][data-draft-field="' + fieldKey + '"]');
            if (ceEl) {
              if (ceEl.tagName === 'INPUT' || ceEl.tagName === 'TEXTAREA') ceEl.value = res[fieldKey];
              else ceEl.innerText = res[fieldKey];
            }
            var mirror = panel.querySelector('[data-mock-mirror="' + fid + '"][data-mock-field="' + fieldKey + '"]');
            if (mirror) { var dt = String(res[fieldKey]); mirror.textContent = dt.length > 80 ? dt.slice(0, 80) + '…' : dt; }
          });
        }
        // 순차 호출: 서버 동시 요청 한계·레이트리밋 회피, 각 포맷 결과 즉시 반영
        // AI 실패 시 해당 포맷은 규칙 기반 폴백으로 콘텐츠 보장
        var _fmtsToGen = selectedFormats.slice();
        function generateNextFormat(idx) {
          if (idx >= _fmtsToGen.length) {
            return NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: formatDrafts })
              .then(function (result) { if (result && result.draft) renderNext(result.draft); })
              .catch(function (err) { alert(T.alertDraftGenFail(err && err.message ? err.message : err)); })
              .finally(function () {
                btn.disabled = false;
                if (window.__bsfOneClickInProgress) {
                  window.__bsfOneClickInProgress = false;
                  if (window.__bsfOneClickSafetyTimer) { clearTimeout(window.__bsfOneClickSafetyTimer); window.__bsfOneClickSafetyTimer = null; }
                }
                hideSaveOverlay();
              });
          }
          var fid = _fmtsToGen[idx];
          return NK.api.draftGenerate({ platformId: fid, story: genStory, brandContext: genBrandCtx })
            .then(function (res) {
              applyDraftToPanel(fid, res);
              var nd = Object.assign({}, formatDrafts); nd[fid] = Object.assign({}, nd[fid] || {}, res); formatDrafts = nd;
            })
            .catch(function (err) {
              // AI 실패 시 규칙 기반 폴백으로 해당 포맷 콘텐츠 생성
              console.error('[draft-generate:' + fid + ']', err && err.message ? err.message : err);
              var fmt = formatItems.find(function (f) { return f.id === fid; });
              var fallbackRes = {
                caption: buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge),
                hashtags: buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge)
              };
              applyDraftToPanel(fid, fallbackRes);
              var nd = Object.assign({}, formatDrafts); nd[fid] = Object.assign({}, nd[fid] || {}, fallbackRes); formatDrafts = nd;
            })
            .then(function () { return generateNextFormat(idx + 1); });
        }
        generateNextFormat(0);
        return;
      }
      if (action === 'brand-oneclick-draft') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        showSaveOverlay(T.oneClickLoadingLabel || T.savingLabel);
        // 플래그: 후속 자동 트리거되는 generate-all-drafts가 완료 시 오버레이 닫도록
        window.__bsfOneClickInProgress = true;
        // 안전 타임아웃: 90초 내 미완료 시 강제 해제 (오버레이 영원히 남는 상황 방지)
        if (window.__bsfOneClickSafetyTimer) clearTimeout(window.__bsfOneClickSafetyTimer);
        window.__bsfOneClickSafetyTimer = setTimeout(function () {
          window.__bsfOneClickInProgress = false;
          hideSaveOverlay();
        }, 90000);
        var defaultFormats = selectedFormats.length ? selectedFormats.slice() : ['instagram', 'threads'];
        var oneClickPayload = {
          brandStudioSelectedAssetIds: selectedAssetIds.length ? selectedAssetIds.slice() : autoSelectedAssetIds.slice(),
          brandStudioSelectedFormats: defaultFormats,
          brandStudioFormatDrafts: Object.assign({}, formatDrafts || {}),
          brandStudioActiveDraftTab: defaultFormats[0] || '',
          brandStudioActiveStep: 3
        };
        NK.service.project.updatePayload(projectId, oneClickPayload)
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            // After step 3 renders, auto-trigger AI generation in the fresh closure context
            setTimeout(function () {
              var t = root.querySelector('.brand-caption-textarea');
              if (t) { scrollNodeIntoPageView(t, 'start'); t.focus(); }
              var genAllBtn = root.querySelector('[data-action="brand-generate-all-drafts"]');
              if (genAllBtn && !genAllBtn.disabled) {
                genAllBtn.click();
              } else {
                // generate 버튼이 없거나 비활성이면 오버레이를 여기서 해제
                window.__bsfOneClickInProgress = false;
                if (window.__bsfOneClickSafetyTimer) { clearTimeout(window.__bsfOneClickSafetyTimer); window.__bsfOneClickSafetyTimer = null; }
                hideSaveOverlay();
              }
            }, 30);
          })
          .catch(function (err) {
            alert(T.alertOneClickFail(err && err.message ? err.message : err));
            btn.disabled = false;
            window.__bsfOneClickInProgress = false;
            if (window.__bsfOneClickSafetyTimer) { clearTimeout(window.__bsfOneClickSafetyTimer); window.__bsfOneClickSafetyTimer = null; }
            hideSaveOverlay();
          });
        return;
      }
      // ── SNS 배포 헬퍼 ─────────────────────────────────
      function snsPublishFormat(formatId, drafts, scheduledAt) {
        var SNS_PLATFORMS = ['instagram', 'tiktok', 'youtube', 'youtube-shorts', 'facebook', 'threads', 'x'];
        if (SNS_PLATFORMS.indexOf(formatId) === -1) {
          return Promise.resolve({ skipped: true });
        }
        var isYoutubeFamily = (formatId === 'youtube' || formatId === 'youtube-shorts');
        // Threads·X 는 텍스트 전용 게시 허용 (이미지·영상 없이 캡션만으로 발행 가능)
        var isTextCapable = (formatId === 'threads' || formatId === 'x');

        // 선택된 이미지+영상 자산 수집 → 영상 먼저, 이미지 나중 정렬
        var selMediaItems = assetItems.filter(function (i) {
          var t = String(i.type || '').trim();
          return (t === 'image' || t === 'video') &&
            selectedAssetIds.indexOf(String(i.id || '').trim()) >= 0;
        }).slice().sort(function (a, b) {
          return (String(a.type || '') === 'video' ? 0 : 1) - (String(b.type || '') === 'video' ? 0 : 1);
        });

        // 각 자산을 { mediaType, gcsPath?, mediaUrl? } 로 변환
        function resolveMediaItem(item) {
          var t = String(item.type || '').trim();
          var id = String(item.id || '');
          var storeMatch = id.match(/:video:store:(\d+)$/);
          if (storeMatch) {
            var idx = parseInt(storeMatch[1], 10);
            var cacheRenders = _renderStorageCache[projectId] || [];
            var r = cacheRenders[idx];
            if (r && r.name) return { mediaType: 'video', gcsPath: String(r.name).trim() };
          }
          if (id.indexOf(':video:render') >= 0) {
            var pp = project.payload || {};
            var rm = (pp.renderMeta && typeof pp.renderMeta === 'object') ? pp.renderMeta : {};
            var on = String(rm.outputVideoObjectName || '').trim();
            if (on) return { mediaType: 'video', gcsPath: on };
          }
          var url = String(item.url || '').trim();
          var gcsPath = extractGcsObjectName(url);
          var mt = t === 'video' ? 'video' : 'image';
          if (gcsPath) return { mediaType: mt, gcsPath: gcsPath };
          if (url && (url.indexOf('http://') === 0 || url.indexOf('https://') === 0)) {
            return { mediaType: mt, mediaUrl: url };
          }
          return null;
        }

        var resolvedItems = selMediaItems.map(resolveMediaItem).filter(Boolean);

        // 선택된 자산 없으면 렌더 캐시 첫 항목으로 폴백 (기존 동작)
        if (!resolvedItems.length && !isTextCapable) {
          var renders = _renderStorageCache[projectId] || [];
          if (!renders.length) {
            alert(isEn
              ? 'No rendered file found. Please render in Post-Production first.'
              : '렌더링된 파일이 없습니다. 포스트프로덕션에서 먼저 렌더링하세요.');
            return Promise.resolve({ skipped: true });
          }
          var fb = renders[0];
          var fbPath = String(fb.name || '').trim();
          if (!fbPath) return Promise.resolve({ skipped: true });
          var fbExt = fbPath.split('.').pop().toLowerCase();
          var fbType = (fbExt === 'mp4' || fbExt === 'webm') ? 'video' : 'image';
          resolvedItems = [{ mediaType: fbType, gcsPath: fbPath }];
        }

        var draft = (drafts && drafts[formatId]) || {};
        var draftCaption = String(draft.caption || '').trim();
        var draftHashtags = String(draft.hashtags || '').trim();
        var finalCaption = [draftCaption, draftHashtags].filter(Boolean).join('\n\n');
        if (!finalCaption) finalCaption = '';
        var firstComment = String(draft.first_comment || '').trim();
        var draftLinkUrl = String(draft.link_url || '').trim();
        var token = localStorage.getItem('nk_auth_token') || '';

        // YouTube 전용 메타 (hasTitle 포맷). draft.title 없으면 에피소드 제목 폴백.
        var ytExtras = null;
        if (isYoutubeFamily) {
          var draftTitle = String(draft.title || '').trim();
          var epTitleBs = '';
          try { epTitleBs = String((project && project.title) || '').trim(); } catch (_) {}
          var ytTags = draftHashtags
            .split(/[\s,]+/)
            .map(function (x) { return x.replace(/^#/, '').trim(); })
            .filter(Boolean);
          ytExtras = {
            title: draftTitle || epTitleBs || 'Untitled',
            tags: ytTags,
            // draft UI 값을 그대로 전달 — 백엔드가 YouTube API 형식으로 변환한다.
            // privacyStatus: 'public' | 'unlisted' | 'scheduled' ('scheduled' 는 publishAt 동반)
            privacyStatus: String(draft.privacy_status || 'public'),
            categoryKey: String(draft.category || 'entertainment'),
            publishAt: String(draft.scheduled_at || '').trim(),
            isShorts: (formatId === 'youtube-shorts'),
          };
        }

        // YouTube는 영상만 — 단일 항목으로 강제, 첫 video 우선
        var requestBody;
        if (isYoutubeFamily) {
          var firstVideo = resolvedItems.find(function (it) { return it.mediaType === 'video'; }) || resolvedItems[0];
          if (!firstVideo || firstVideo.mediaType !== 'video') {
            alert(isEn
              ? 'YouTube requires a video asset. Select a video first.'
              : 'YouTube에는 영상 자산이 필요합니다. 영상을 먼저 선택해 주세요.');
            return Promise.resolve({ skipped: true });
          }
          requestBody = Object.assign({
            platform: formatId,
            mediaType: 'video',
            mediaGcsPath: firstVideo.gcsPath || '',
            mediaDirectUrl: firstVideo.mediaUrl || '',
            caption: finalCaption,
            scheduledAt: (scheduledAt && scheduledAt !== 'now') ? scheduledAt : '',
          }, ytExtras);
        } else if (!resolvedItems.length) {
          // 텍스트 전용 게시 (Threads) — 미디어 없이 캡션만 전송
          requestBody = {
            platform: formatId,
            caption: finalCaption,
            scheduledAt: (scheduledAt && scheduledAt !== 'now') ? scheduledAt : '',
            firstComment: firstComment || '',
          };
        } else if (resolvedItems.length === 1) {
          var single = resolvedItems[0];
          requestBody = {
            platform: formatId,
            mediaType: single.mediaType,
            mediaGcsPath: single.gcsPath || '',
            mediaDirectUrl: single.mediaUrl || '',
            caption: finalCaption,
            scheduledAt: (scheduledAt && scheduledAt !== 'now') ? scheduledAt : '',
            firstComment: firstComment || '',
            linkUrl: draftLinkUrl || '',
          };
        } else {
          requestBody = {
            platform: formatId,
            mediaItems: resolvedItems,
            caption: finalCaption,
            scheduledAt: (scheduledAt && scheduledAt !== 'now') ? scheduledAt : '',
            firstComment: firstComment || '',
            linkUrl: draftLinkUrl || '',
          };
          // Facebook 한정: 이미지+영상 혼합 선택 시 사용자가 라디오로 고른 mediaType 을
          // body 에 명시해 publish.ts 분기가 해당 타입만 게시하도록 한다.
          if (formatId === 'facebook') {
            var fbMediaTypeOverride = String(draft.media_type || '').trim().toLowerCase();
            if (fbMediaTypeOverride === 'video' || fbMediaTypeOverride === 'image') {
              requestBody.mediaType = fbMediaTypeOverride;
            }
          }
        }

        // 공유받은 프로젝트는 소유자 SNS 자격증명으로 게시(서버가 editor 권한 검증).
        try {
          requestBody.projectId = String(projectId || '');
          var _snsOwner = (NK.api && NK.api.getSharedOwner) ? NK.api.getSharedOwner(projectId) : '';
          if (_snsOwner) requestBody.ownerId = String(_snsOwner);
        } catch (_) {}

        return fetch('/api/sns/publish', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })
          .then(function (r) { return r.json().then(function (j) { return { httpStatus: r.status, body: j }; }); })
          .then(function (wrap) {
            var res = wrap.body;
            // YouTube 미연결/연결 만료 → 안내 후 skip (서버 메시지가 있으면 그대로 노출)
            if (wrap.httpStatus === 412 || (res && res.error && /not connected|연결되지 않|만료|expired|revoked/i.test(res.error))) {
              bsfNotify((res && res.error)
                ? res.error
                : (isEn
                    ? 'YouTube is not connected. Connect it in SNS Settings first.'
                    : 'YouTube가 연결되지 않았습니다. SNS 설정에서 먼저 연결해 주세요.'));
              return { skipped: true };
            }
            if (!res || !res.ok) throw new Error((res && res.error) || 'SNS publish failed');

            // 하이브리드: 서버가 직접 PUT한 경우 result.postId 가 채워져 있음 → 그대로 반환
            if (res.result) return res;

            // 큰 영상 → 클라 직접 PUT (resumable session)
            if (res.uploadUrl && res.sourceUrl) {
              return doYoutubeDirectPut(res.uploadUrl, res.sourceUrl, res.contentType, formatId, !!res.scheduledPublish, res.scheduledFor || '');
            }
            throw new Error('Unexpected publish response');
          });
      }

      // YouTube resumable PUT (큰 영상 — XHR로 진행률 표시)
      // sourceUrl 은 백엔드가 발급한 GCS signed URL (또는 mediaDirectUrl).
      function doYoutubeDirectPut(uploadUrl, sourceUrl, contentType, formatId, scheduledPublish, scheduledFor) {
        return fetch(sourceUrl)
          .then(function (r) {
            if (!r.ok) throw new Error('source fetch failed: ' + r.status);
            return r.blob();
          })
          .then(function (blob) {
            return new Promise(function (resolve, reject) {
              var xhr = new XMLHttpRequest();
              xhr.open('PUT', uploadUrl, true);
              xhr.setRequestHeader('Content-Type', contentType || blob.type || 'video/mp4');
              xhr.upload.addEventListener('progress', function (evt) {
                if (!evt.lengthComputable) return;
                var pct = (evt.loaded / evt.total) * 100;
                var fmtCard = document.querySelector('[data-deploy-format-card="' + formatId + '"] .bsf-deploy-status');
                if (fmtCard) fmtCard.textContent = (isEn ? 'Uploading… ' : '업로드 중… ') + pct.toFixed(1) + '%';
              });
              xhr.addEventListener('load', function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                  var parsed = {};
                  try { parsed = JSON.parse(xhr.responseText || '{}'); } catch (e) {}
                  resolve({
                    ok: true,
                    result: {
                      platform: formatId,
                      postId: parsed.id || '',
                      status: scheduledPublish ? 'scheduled' : 'published',
                      publishedAt: new Date().toISOString(),
                      scheduledFor: scheduledFor || '',
                      url: parsed.id ? 'https://youtu.be/' + parsed.id : '',
                    },
                  });
                } else {
                  reject(new Error('YouTube PUT failed: HTTP ' + xhr.status));
                }
              });
              xhr.addEventListener('error', function () { reject(new Error('YouTube PUT network error')); });
              xhr.send(blob);
            });
          });
      }

      if (action === 'brand-deploy-one-format') {
        var oneFmtId = String(btn.dataset.deployFormat || '').trim();
        if (!oneFmtId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var perCardInputOne = root.querySelector('#bsf-deploy-dt-' + oneFmtId);
        var globalInputOne = root.querySelector('#brand-publish-datetime');
        var scheduledAtOne = (perCardInputOne && String(perCardInputOne.value || '').trim()) || (globalInputOne ? String(globalInputOne.value || '').trim() : '');
        _deployingFormats[oneFmtId] = true;
        refreshDeploySummary();
        var deployPlanOne = { channels: [oneFmtId], scheduledAt: scheduledAtOne, status: (scheduledAtOne && scheduledAtOne !== 'now') ? 'scheduled' : 'deploying', formatDrafts: Object.assign({}, formatDrafts || {}) };
        syncBrandAndProject({ brandStudioPublishPlan: deployPlanOne }, { brandStudioPublishPlan: deployPlanOne })
          .then(function (result) {
            // 배포 플랜 저장은 초안 내용을 바꾸지 않으므로 전체 재렌더(renderNext) 대신
            // 배포 요약만 갱신해 깜박임을 막는다.
            refreshDeploySummary();
            return snsPublishFormat(oneFmtId, formatDrafts, scheduledAtOne);
          })
          .then(function (publishResult) {
            if (publishResult && publishResult.skipped) return;
            if (publishResult && publishResult.ok) {
              _deployedFormats[oneFmtId] = true;
              persistDeployedFormats();
              var oneFmt = formatItems.find(function (f) { return f.id === oneFmtId; });
              var oneLabel = oneFmt && oneFmt.title ? oneFmt.title : oneFmtId;
              var oneStatus = publishResult.result && publishResult.result.status;
              var oneUrl = (publishResult.result && publishResult.result.url) ? String(publishResult.result.url) : '';
              var oneMsg = (oneStatus === 'published'
                ? T.alertPublishSuccess(oneLabel)
                : T.alertPublishProcessing(oneLabel));
              // 게시 결과 URL 노출 — 영상이 실제로 어디에 올라갔는지(쇼츠/일반영상·공개여부) 바로 확인 가능.
              if (oneUrl) oneMsg += '\n\n' + oneUrl;
              bsfNotify(oneMsg);
            }
          })
          .catch(function (err) { bsfNotify(T.alertPublishFail(err && err.message ? err.message : err)); })
          .finally(function () { delete _deployingFormats[oneFmtId]; refreshDeploySummary(); });
        return;
      }
      if (action === 'brand-deploy-all-formats') {
        if (!selectedFormats.length || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var publishInputEl = root.querySelector('#brand-publish-datetime');
        var scheduledAt = publishInputEl ? String(publishInputEl.value || '').trim() : '';
        // '사용 중'인 플랫폼만 배포 (사용 안 함으로 꺼둔 채널은 skip)
        var _snsStatesAll = _readSnsStates();
        var allFmtIds = selectedFormats.filter(function (fid) {
          var row = _snsStatesAll[fid] || {};
          return !!row.connected && (row.enabled !== false);
        });
        if (!allFmtIds.length) {
          bsfNotify(isEn
            ? 'No active channels selected. Enable usage in SNS Settings or pick connected channels.'
            : '사용 중으로 설정된 채널이 없습니다. SNS 설정에서 사용을 켜거나 연결된 채널을 선택해 주세요.');
          return;
        }
        allFmtIds.forEach(function (fmtId) { _deployingFormats[fmtId] = true; });
        btn.disabled = true;
        btn.classList.add('is-deploying');
        btn.innerHTML = '<span class="bsf-deploy-btn-spinner"></span>';
        refreshDeploySummary();
        var deployPlan = { channels: allFmtIds, scheduledAt: scheduledAt, status: (scheduledAt && scheduledAt !== 'now') ? 'scheduled' : 'deploying', formatDrafts: Object.assign({}, formatDrafts || {}) };
        var _allDeployedCount = 0;
        syncBrandAndProject({ brandStudioPublishPlan: deployPlan }, { brandStudioPublishPlan: deployPlan })
          .then(function (result) {
            // 배포 플랜 저장은 초안 내용을 바꾸지 않으므로 전체 재렌더(renderNext) 대신
            // 배포 요약만 갱신해 깜박임을 막는다.
            refreshDeploySummary();
            return allFmtIds.reduce(function (chain, fmtId) {
              return chain.then(function () {
                var fmtPerCard = root.querySelector('#bsf-deploy-dt-' + fmtId);
                var fmtScheduledAt = (fmtPerCard && String(fmtPerCard.value || '').trim()) || scheduledAt;
                return snsPublishFormat(fmtId, formatDrafts, fmtScheduledAt)
                  .then(function (pubRes) {
                    if (pubRes && pubRes.skipped) { delete _deployingFormats[fmtId]; refreshDeploySummary(); return; }
                    _deployedFormats[fmtId] = true; persistDeployedFormats();
                    _allDeployedCount += 1;
                    delete _deployingFormats[fmtId]; refreshDeploySummary();
                  });
              });
            }, Promise.resolve());
          })
          .then(function () {
            if (_allDeployedCount > 0) bsfNotify(T.alertPublishAllDone(_allDeployedCount));
          })
          .catch(function (err) { bsfNotify(T.alertPublishFail(err && err.message ? err.message : err)); })
          .finally(function () {
            allFmtIds.forEach(function (fmtId) { delete _deployingFormats[fmtId]; });
            btn.disabled = false;
            btn.classList.remove('is-deploying');
            btn.textContent = isEn ? 'Publish All' : (T.ctrlPublishAll || '전체 배포');
            refreshDeploySummary();
          });
        return;
      }
      if (action === 'toggle-deploy-done') {
        var toggleFmtId = String(btn.dataset.deployFormat || '').trim();
        if (!toggleFmtId) return;
        if (_deployedFormats[toggleFmtId]) {
          delete _deployedFormats[toggleFmtId];
        } else {
          _deployedFormats[toggleFmtId] = true;
        }
        persistDeployedFormats();
        refreshDeploySummary();
        return;
      }
      if (action === 'brand-toggle-story-card') {
        var stVId = projectId + ':story';
        var stIdx = selectedAssetIds.indexOf(stVId);
        var nextStorySel = stIdx < 0;
        // ① selectedAssetIds 인플레이스 업데이트
        if (stIdx >= 0) selectedAssetIds.splice(stIdx, 1); else selectedAssetIds.push(stVId);
        // ② 카드 즉시 CSS 토글 (리렌더 없음)
        btn.classList.toggle('is-selected', nextStorySel);
        // ③ step 바 수술적 업데이트
        updateStep1Bar();
        // ④ 포맷 카드 상태 즉시 갱신
        refreshFormatCardStates();
        // ⑤ 저장 버튼 활성화 + 디바운스 저장
        setSaveBtnEnabled(true);
        scheduleAssetSave();
        return;
      }
      if (action === 'bsf-zoom-thumb') {
        var mediaUrl = String(btn.dataset.url || '').trim();
        var mediaType = String(btn.dataset.mediaType || 'image').trim();
        if (mediaUrl) openBsfMediaPopup(mediaUrl, mediaType);
        return;
      }
      if (action === 'brand-toggle-single-asset') {
        var singleAssetId = String(btn.dataset.assetId || '').trim();
        if (!singleAssetId) return;
        var sidx = selectedAssetIds.indexOf(singleAssetId);
        var isNowSel = sidx < 0;
        // ① selectedAssetIds 인플레이스 업데이트
        if (sidx >= 0) selectedAssetIds.splice(sidx, 1); else selectedAssetIds.push(singleAssetId);
        // ② 썸네일 즉시 토글 (리렌더 없음)
        btn.classList.toggle('is-selected', isNowSel);
        // ③ 카드 하이라이트 + 카운트 라벨 수술적 업데이트
        var thumbCard = btn.closest('.bsf-asset-type-card');
        if (thumbCard) {
          var allThumbs = thumbCard.querySelectorAll('[data-action="brand-toggle-single-asset"]');
          var nowSelCount = 0;
          allThumbs.forEach(function (t) { if (t.classList.contains('is-selected')) nowSelCount++; });
          thumbCard.classList.toggle('is-selected', nowSelCount > 0);
          var countEm = thumbCard.querySelector('.bsf-asset-type-head em');
          if (countEm) {
            countEm.textContent = nowSelCount > 0
              ? (nowSelCount + '/' + allThumbs.length)
              : (isEn ? String(allThumbs.length) : allThumbs.length + '개');
          }
        }
        // ④ step 바 수술적 업데이트
        updateStep1Bar();
        // ⑤ 포맷 카드 상태 즉시 갱신
        refreshFormatCardStates();
        // ⑥ 저장 버튼 활성화 + 디바운스 저장
        setSaveBtnEnabled(true);
        scheduleAssetSave();
        return;
      }
      if (action === 'brand-toggle-asset-type') {
        var assetType = String(btn.dataset.assetType || '').trim();
        if (!assetType || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var typeItems = assetItems.filter(function (i) { return String(i.type || '').trim() === assetType; });
        var typeIds = typeItems.map(function (i) { return String(i.id || '').trim(); }).filter(Boolean);
        var allSel = typeIds.length > 0 && typeIds.every(function (id) { return selectedAssetIds.indexOf(id) >= 0; });
        var nextAssetIds = allSel
          ? selectedAssetIds.filter(function (id) { return typeIds.indexOf(id) < 0; })
          : (function () { var n = selectedAssetIds.slice(); typeIds.forEach(function (id) { if (n.indexOf(id) < 0) n.push(id); }); return n; }());
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioSelectedAssetIds: nextAssetIds }) }));
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextAssetIds })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert(T.alertAssetSaveFail(err && err.message ? err.message : err)); });
        return;
      }
      if (action === 'brand-clear-type-assets') {
        var clearType = String(btn.dataset.assetType || '').trim();
        if (!clearType || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextIds = selectedAssetIds.slice();
        if (clearType === 'story') {
          var storyVId = projectId + ':story';
          var stIdx = nextIds.indexOf(storyVId);
          if (stIdx >= 0) nextIds.splice(stIdx, 1);
        } else if (clearType === 'image') {
          var imgIds = imageItems.map(function (i) { return String(i.id || '').trim(); });
          nextIds = nextIds.filter(function (id) { return imgIds.indexOf(id) < 0; });
        } else if (clearType === 'video') {
          var vidIds = videoItems.map(function (i) { return String(i.id || '').trim(); });
          nextIds = nextIds.filter(function (id) { return vidIds.indexOf(id) < 0; });
        }
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioSelectedAssetIds: nextIds }) }));
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextIds })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function () {});
        return;
      }
      if (action === 'brand-clear-assets') {
        // ① selectedAssetIds 전체 클리어 (인플레이스)
        selectedAssetIds.splice(0, selectedAssetIds.length);
        // ② 스토리 카드 즉시 해제
        var storyCardEl = root.querySelector('.bsf-story-card');
        if (storyCardEl) storyCardEl.classList.remove('is-selected');
        // ③ 모든 썸네일 즉시 해제 + 카드 카운트 리셋
        root.querySelectorAll('[data-action="brand-toggle-single-asset"]').forEach(function (t) { t.classList.remove('is-selected'); });
        root.querySelectorAll('.bsf-asset-type-card').forEach(function (c) {
          c.classList.remove('is-selected');
          var em = c.querySelector('.bsf-asset-type-head em');
          var thumbs = c.querySelectorAll('[data-action="brand-toggle-single-asset"]');
          if (em) em.textContent = isEn ? String(thumbs.length) : thumbs.length + '개';
        });
        // ④ Clear 버튼 비활성화 + step 바 업데이트
        btn.disabled = true;
        updateStep1Bar();
        // ⑤ 포맷 카드 상태 즉시 갱신
        refreshFormatCardStates();
        // ⑥ 저장 버튼 활성화 + 디바운스 저장
        setSaveBtnEnabled(true);
        scheduleAssetSave();
        return;
      }
      if (action === 'open-format-guide') {
        var fgModal = document.getElementById('bsf-format-guide-modal');
        var fgBody = document.getElementById('bsf-format-guide-body');
        if (!fgModal || !fgBody) return;
        var fgTitle = isEn ? 'Format Guide' : '추천 포맷';
        var _fgGroups = [
          {
            title: isEn ? 'Video Based' : '영상 기반',
            items: [
              { name: 'YouTube',        conds: isEn ? ['Video required', 'Min. 1 min (60s)']    : ['영상 필요', '최소 1분(60초) 이상'] },
              { name: 'YouTube Shorts', conds: isEn ? ['Video required', 'Max 10 min (600s)']   : ['영상 필요', '최대 10분(600초) 이내'] },
              { name: 'TikTok',         conds: isEn ? ['Video required', 'Max 10 min (600s)']   : ['영상 필요', '최대 10분(600초) 이내'] },
            ]
          },
          {
            title: isEn ? 'Image or Video' : '이미지·영상 복합',
            items: [
              { name: 'Instagram', conds: isEn ? ['Image or video required', 'Video ≤ 10 min'] : ['이미지 또는 영상 필요', '영상은 10분(600초) 이내'] },
              { name: 'Facebook',  conds: isEn ? ['Image (1+) or story']                       : ['이미지 1장 이상 또는 스토리'] },
            ]
          },
          {
            title: isEn ? 'Single Image' : '이미지 1장 기반',
            items: [
              { name: 'Pinterest',  conds: isEn ? ['Exactly 1 image'] : ['이미지 정확히 1장'] },
              { name: 'Naver Post', conds: isEn ? ['Exactly 1 image'] : ['이미지 정확히 1장'] },
              { name: 'Kakao',      conds: isEn ? ['Exactly 1 image'] : ['이미지 정확히 1장'] },
            ]
          },
          {
            title: isEn ? 'Story Based' : '스토리 기반',
            items: [
              { name: 'LinkedIn',   conds: isEn ? ['Story required']          : ['스토리 필요'] },
              { name: 'Naver Blog', conds: isEn ? ['Story, or 2+ images']     : ['스토리 또는 이미지 2장 이상'] },
              { name: 'Band',       conds: isEn ? ['Story required']          : ['스토리 필요'] },
            ]
          },
          {
            title: isEn ? 'Any Asset' : '자유 조합',
            items: [
              { name: 'Threads', conds: isEn ? ['Story, image, or video — any one'] : ['스토리·이미지·영상 중 하나 이상'] },
              { name: 'X',       conds: isEn ? ['Story, image, or video — any one'] : ['스토리·이미지·영상 중 하나 이상'] },
            ]
          },
        ];
        var fgHtml = '<div class="vocab-modal-titlebar">' +
          '<h2 class="vocab-modal-title">' + escapeHtml(fgTitle) + '</h2>' +
          '<button type="button" class="vocab-modal-close" data-action="close-format-guide" aria-label="닫기">✕</button>' +
          '</div>';
        fgHtml += _fgGroups.map(function (group) {
          var items = group.items.map(function (item) {
            var conds = item.conds.map(function (c) { return '<li>' + escapeHtml(c) + '</li>'; }).join('');
            return '<div class="bsf-fg-item">' +
              '<div class="bsf-fg-item-name">' + escapeHtml(item.name) + '</div>' +
              '<ul class="bsf-fg-item-conds">' + conds + '</ul>' +
              '</div>';
          }).join('');
          return '<section class="vocab-section">' +
            '<h3 class="vocab-section-title">' + escapeHtml(group.title) + '</h3>' +
            '<div class="bsf-fg-grid">' + items + '</div>' +
            '</section>';
        }).join('');
        fgBody.innerHTML = fgHtml;
        fgModal.classList.remove('hidden');
        return;
      }
      if (action === 'close-format-guide') {
        var fgM = document.getElementById('bsf-format-guide-modal');
        if (fgM) fgM.classList.add('hidden');
        return;
      }
      var target = '';
      if (action === 'brand-open-analytics') target = buildStageUrl('analytics.html', projectId, brandId);
      else if (action === 'brand-open-knowledge') target = buildStageUrl('knowledge.html', projectId, brandId);
      else if (action === 'brand-open-library') target = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'brand-open-scenario') target = buildStageUrl('scenario.html', projectId, brandId);
      else if (action === 'brand-open-media') target = buildStageUrl('media.html', projectId, brandId);
      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };
    // Format guide modal: close button + backdrop click + Escape (register once per page)
    if (!document.__bsfFgListenerBound) {
      document.__bsfFgListenerBound = true;
      document.addEventListener('click', function (e) {
        var m = document.getElementById('bsf-format-guide-modal');
        if (!m || m.classList.contains('hidden')) return;
        // 닫기 버튼
        var closeBtn = e.target && e.target.closest ? e.target.closest('[data-action="close-format-guide"]') : null;
        if (closeBtn) { m.classList.add('hidden'); return; }
        // 배경(오버레이) 클릭
        if (e.target === m) m.classList.add('hidden');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var m = document.getElementById('bsf-format-guide-modal');
          if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
        }
      });
    }
  }
  // stub: keep for legacy references
  function inferDefaultContentType() { return 'instagram'; }

  brandStudio.init = function () {
    var root = document.getElementById('brand-studio-root');
    if (!root) return;
    var _initIsEn = !!(NK.state && NK.state.runtime && NK.state.runtime.lang === 'en');
    // Auth guard: 세션 만료 또는 미로그인 → 로그인 안내 (만료 토큰으로 미디어 403 방지)
    if (NK.auth && NK.auth.isAuthed && !NK.auth.isAuthed()) {
      root.innerHTML =
        '<div class="brand-studio-page"><div class="brand-studio-hero empty">' +
        '<h2>' + (_initIsEn ? 'Session Expired' : '세션이 만료되었습니다') + '</h2>' +
        '<p style="margin-top:8px;color:var(--text-3);">' +
          (_initIsEn ? 'Your login session has expired. Please log in again.' : '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.') +
        '</p>' +
        '<a href="index.html" class="btn-primary" style="margin-top:20px;display:inline-block;text-decoration:none;">' +
          (_initIsEn ? 'Log In' : '로그인 하기') +
        '</a>' +
        '</div></div>';
      return;
    }
    if (!NK.service || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, _initIsEn ? 'Unable to load Brand Studio.' : 'Brand Studio를 불러올 수 없습니다.');
      return;
    }
    var context = NK.service.brand.getDisplayContext
      ? NK.service.brand.getDisplayContext({ search: window.location.search })
      : { brand: null, project: NK.service.project.resolveCurrent({ search: window.location.search }) };
    var project = context && context.project ? context.project : NK.service.project.resolveCurrent({ search: window.location.search });
    var brand = context && context.brand ? context.brand : null;
    if (!project || !project.id) {
      renderEmpty(root, _initIsEn ? 'Please select a project first.' : '먼저 프로젝트를 선택해 주세요.');
      return;
    }
    // ① 스피너 즉시 표시 — 빈 화면/깜박임 없음
    root.innerHTML = '<div class="bsf-init-spinner"><div class="bsf-init-spinner-ring"></div></div>';
    bindDeferredHydrationFlush(root);

    // 언어 전환(nk:lang-changed) 수신 — 한 페이지 라이프사이클당 1회만 등록
    if (!window.__brandStudioLangBound) {
      window.__brandStudioLangBound = true;
      // renderProject 내부의 applyCurrentLocale()이 다시 dispatch를 일으키므로
      // 같은 lang은 스킵하여 재귀 호출 차단
      window.__brandStudioLastLang = (NK.state && NK.state.runtime && NK.state.runtime.lang === 'en') ? 'en' : 'ko';
      window.addEventListener('nk:lang-changed', function (e) {
        var newLang = (e && e.detail && e.detail.lang) === 'en' ? 'en' : 'ko';
        if (window.__brandStudioLastLang === newLang) return; // 동일 lang 재진입 차단
        window.__brandStudioLastLang = newLang;
        var rootEl = document.getElementById('brand-studio-root');
        if (!rootEl || !rootEl.isConnected) return;
        if (!NK.service || !NK.service.project || !NK.service.project.resolveCurrent) return;
        var p = NK.service.project.resolveCurrent({ search: window.location.search });
        if (!p) return;
        var b = null;
        var bId = String((p.payload && p.payload.brandId) || p.brandId || '').trim();
        if (bId && NK.service.brand && NK.service.brand.getById) {
          b = NK.service.brand.getById(bId);
        }
        try { renderProject(rootEl, p, b); } catch (_) {}
      });
    }

    var latestProject = project;
    var latestBrand = brand;
    var initDone = false;
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    var initProjectId = String(project.id || '').trim();

    function doFinalRender() {
      if (initDone) return;
      initDone = true;
      clearTimeout(safetyTimer);
      if (!root.isConnected) return;
      try {
        renderProject(root, latestProject, latestBrand);
      } catch (err) {
        try { console.error('BrandStudio render error:', err); } catch (_) {}
        renderEmpty(root, _initIsEn ? 'An error occurred while rendering Brand Studio.' : 'Brand Studio 렌더링 중 오류가 발생했습니다.');
      }
    }
    // 최초 렌더 후 fresh 데이터가 도착했을 때 강제 리렌더
    // (느린 네트워크에서 safety 타임아웃이 먼저 발사되어 stale 데이터로 그려진 경우 대비)
    // 여러 비동기 하이드레이션(projectGet·SNS·렌더목록·영상·이미지)이 제각각 도착할 때마다
    // 전체 DOM 을 다시 그리면 2~3번 깜박인다. trailing 디바운스로 마지막 도착 후 한 번만 렌더한다.
    var _forceRerenderTimer = null;
    function forceRerender() {
      if (!initDone || !root.isConnected) return;
      if (_forceRerenderTimer) clearTimeout(_forceRerenderTimer);
      _forceRerenderTimer = setTimeout(function () {
        _forceRerenderTimer = null;
        if (!initDone || !root.isConnected) return;
        try {
          var freshProject = (NK.state && NK.state.runtime && NK.state.runtime.currentProject) || latestProject;
          renderProject(root, freshProject, latestBrand);
        } catch (_) {}
      }, 350);
    }

    // ② 비동기 작업 병렬 실행 — 결과만 수집, 렌더는 완료 후 딱 한 번
    var promises = [];

    // 다중 기기 동기화: 서버에서 최신 프로젝트 페이로드 로드
    // (학원에서 저장한 brandStudio* 필드가 집에서도 보이도록)
    var refreshProjectPromise = (async function () {
      try {
        if (!NK.api || !NK.api.projectGet || !initProjectId) return;
        var prevPayloadJson = '';
        try { prevPayloadJson = JSON.stringify((latestProject && latestProject.payload) || {}); } catch (_) {}
        // 공유받은 프로젝트는 로컬 store에 없어 projectGet이 ownerId 매핑(sessionStorage)을
        // 통해 소유자 경로에 접근해야 한다. 로컬에 없고 매핑도 비어 있으면 먼저 목록을
        // 동기화해 매핑을 채운다(projectList가 parsed.shared로 채움, 30초 캐시).
        var inLocalStore = !!(NK.service.project.getDraftById && NK.service.project.getDraftById(initProjectId));
        if (!inLocalStore && NK.api.projectList && NK.api.getSharedOwner && !NK.api.getSharedOwner(initProjectId)) {
          try { await NK.api.projectList(); } catch (_) {}
        }
        var res = await NK.api.projectGet(initProjectId);
        var data = (res && res.data) ? res.data : res;
        if (!data || (!data.scenes && !data.payload)) return;
        var updated = NK.service.project.updateLocal(initProjectId, function (cur) {
          var curScenes = Array.isArray(cur && cur.scenes) ? cur.scenes : [];
          var srvScenes = Array.isArray(data.scenes) ? data.scenes : [];
          return Object.assign({}, cur || {}, {
            title: data.title || (cur && cur.title) || '',
            header: data.header || (cur && cur.header) || '',
            aspectRatio: (data.aspectRatio || (data.payload && data.payload.aspectRatio) || (cur && cur.aspectRatio) || ''),
            payload: Object.assign({}, (cur && cur.payload) || {}, data.payload || {}),
            scenes: (function () {
              if (!srvScenes.length) return curScenes;
              var _mf = ['imageDataUrl', 'imagePath', 'generatedImageUrl', 'imageUrl',
                'videoUrl', 'videoPath', 'generatedVideoUrl', 'videoPlaybackUrl',
                'voiceUrl', 'videoStatus', 'videoJobId', 'videoMethod', 'videoError'];
              var _curById = {};
              curScenes.forEach(function (s) { if (s) _curById[String(s.id)] = s; });
              return srvScenes.map(function (srvScene) {
                var cur = _curById[String(srvScene.id)] || {};
                var merged = Object.assign({}, srvScene);
                _mf.forEach(function (f) {
                  if (!merged[f] && cur[f]) {
                    var v = cur[f];
                    if (typeof v === 'string' && (v.slice(0, 5) === 'data:' || v.slice(0, 5) === 'blob:')) return;
                    merged[f] = v;
                  }
                });
                return merged;
              });
            })()
          });
        }, { forceCurrent: true });
        // 공유받은 프로젝트: 로컬 store에 없어 updateLocal이 no-op(null)을 반환한다.
        // 소유자 서버 데이터로 새 드래프트를 생성(upsert)해 현재 프로젝트로 세팅한다.
        // (이 폴백이 없으면 자산/포맷/초안/배포가 모두 빈 스텁으로 남는다.)
        if (!updated && NK.service.project.upsertLocalDraft) {
          var serverDraft = {
            id: initProjectId,
            title: data.title || (latestProject && latestProject.title) || '',
            header: data.header || (latestProject && latestProject.header) || '',
            payload: Object.assign({}, data.payload || {}),
            scenes: Array.isArray(data.scenes) ? data.scenes : []
          };
          updated = NK.service.project.upsertLocalDraft(serverDraft, { setCurrent: true });
        }
        if (updated && root.isConnected) {
          latestProject = updated;
          // safety 타임아웃이 먼저 발사되어 stale 렌더가 끝난 상태라면, 페이로드 변경 시 강제 리렌더
          if (initDone) {
            var nextPayloadJson = '';
            try { nextPayloadJson = JSON.stringify(updated.payload || {}); } catch (_) {}
            if (nextPayloadJson && nextPayloadJson !== prevPayloadJson) forceRerender();
          }
        }
      } catch (_) {}
    })();
    promises.push(refreshProjectPromise);

    // SNS 연결 상태 cache 갱신: 다른 디바이스/세션에서 disconnect 됐을 경우
    // nk_sns_states localStorage 가 stale 상태로 남아 '사용 중' 으로 잘못 표시되는 문제 방지.
    // brand.html 에는 sns-settings.js 가 로드되지 않으므로 직접 fetch 한다.
    promises.push(refreshProjectPromise.then(async function () {
      try {
        var token = localStorage.getItem('nk_auth_token') || '';
        if (!token) return;
        // 공유받은 프로젝트면 소유자 연결 상태를 ownerId로 조회(서버가 토큰 마스킹).
        var _snsOwner = (NK.api && NK.api.getSharedOwner) ? NK.api.getSharedOwner(initProjectId) : '';
        var _snsUrl = '/api/userdata/sns/get';
        if (_snsOwner) {
          _snsUrl += '?ownerId=' + encodeURIComponent(String(_snsOwner)) + '&projectId=' + encodeURIComponent(String(initProjectId));
        }
        var r = await fetch(_snsUrl, {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store'
        });
        var res = await r.json();
        if (res && res.ok && res.settings && res.settings.sns) {
          try {
            if (_snsOwner) {
              // 소유자 상태는 전역 캐시를 오염시키지 않도록 분리 보관
              _sharedSnsStatesCache[initProjectId] = res.settings.sns;
            } else {
              localStorage.setItem('nk_sns_states', JSON.stringify(res.settings.sns));
            }
            if (initDone && root.isConnected) forceRerender();
          } catch (_) {}
        }
        // res.missing 인 경우 캐시 보존(덮어쓰지 않음). 서버 오류도 마찬가지.
      } catch (_) {}
    }));

    if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      promises.push(
        NK.service.brand.hydrateFromServer(brandId, { force: true, ttlMs: 0 })
          .then(function (nextBrand) { if (nextBrand && root.isConnected) latestBrand = nextBrand; })
          .catch(function () {})
      );
    }

    // 씬 이미지/영상 URL 갱신 (만료된 Signed URL 또는 gs:// 경로)
    // 프로젝트 리프레시 이후 실행하여 stale 씬 데이터를 덮어쓰지 않도록 한다.
    if (NK.service && NK.service.sceneAssets && NK.service.sceneAssets.refreshProjectSceneAssets) {
      promises.push(
        refreshProjectPromise
          .then(function () {
            return NK.service.sceneAssets.refreshProjectSceneAssets(latestProject);
          })
          .then(function (updated) {
            if (!updated || !root.isConnected) return;
            latestProject = (NK.state && NK.state.runtime && NK.state.runtime.currentProject) || latestProject;
            try {
              if (brandId && NK.service.brand && NK.service.brand.getById) {
                latestBrand = NK.service.brand.getById(brandId) || latestBrand;
              }
            } catch (_) {}
          })
          .catch(function () {})
      );
    }

    // 렌더 저장소 전체 목록 비동기 로드 → 영상 카드에 표시
    // 공유받은 프로젝트는 소유자 경로 조회에 ownerId 매핑이 필요하다. refreshProjectPromise가
    // 로컬에 없는 경우 projectList를 동기화해 매핑을 채우므로, 그 이후에 호출한다.
    if (NK.api && NK.api.postprodRenderList && initProjectId) {
      promises.push(
        refreshProjectPromise
          .then(function () { return NK.api.postprodRenderList(initProjectId); })
          .then(function (renderList) {
            if (Array.isArray(renderList) && renderList.length && root.isConnected) {
              _renderStorageCache[initProjectId] = renderList;
              // 안전 타이머가 먼저 발사돼 이미 렌더된 경우(initDone) 늦게 도착한 영상 반영
              if (initDone) forceRerender();
            }
          })
          .catch(function () {})
      );
    }

    // AI 시네마 영상 라이브러리 비동기 로드 (ai-video-gen에서 생성한 GCS 영상)
    // - 서버는 source=video-gen + projectId 기반으로 프로젝트 전용 prefix 조회
    if (NK.api && NK.api.videoGenLibrary && initProjectId) {
      promises.push(
        refreshProjectPromise
          .then(function () { return NK.api.videoGenLibrary(initProjectId); })
          .then(function (data) {
            var items = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []);
            if (items.length && root.isConnected) {
              _videoGenStorageCache[initProjectId] = items;
              if (initDone) forceRerender();
            }
          })
          .catch(function () {})
      );
    }

    // AI 이미지 라이브러리 비동기 로드 (ai-image에서 생성한 GCS 이미지)
    // - 반드시 이 프로젝트 payload의 aiImageSessionId만 사용한다.
    //   전역 localStorage 세션으로 폴백하면 다른 프로젝트에서 생성한 이미지까지
    //   모두 끌어오는 교차 오염이 발생하므로 폴백하지 않는다.
    // - 서버 동기화(refreshProjectPromise) 이후 latestProject.payload에서 최신 sessionId 읽음
    if (NK.api && NK.api.aiImageSessionLibrary && initProjectId) {
      promises.push(
        refreshProjectPromise.then(function () {
          var _aiImgSid = '';
          try {
            var _pp = (latestProject && latestProject.payload) || (project && project.payload) || {};
            _aiImgSid = String(_pp.aiImageSessionId || '').trim();
          } catch (_) {}
          // canonical 세션 + 과거(legacy) 세션을 모두 조회해 병합(이전에 다른 세션 id로 생성된 이미지도 포함).
          var _legacy = [];
          try {
            var _pp2 = (latestProject && latestProject.payload) || (project && project.payload) || {};
            _legacy = Array.isArray(_pp2.aiImageLegacySessionIds) ? _pp2.aiImageLegacySessionIds : [];
          } catch (_) {}
          var _sids = [_aiImgSid];
          _legacy.forEach(function (s) { s = String(s || '').trim(); if (s && _sids.indexOf(s) < 0) _sids.push(s); });
          if (!_aiImgSid && !_sids.filter(Boolean).length) return;
          return Promise.all(_sids.filter(Boolean).map(function (sid) {
            return NK.api.aiImageSessionLibrary(sid)
              .then(function (data) { return Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []); })
              .catch(function () { return []; });
          }))
            .then(function (lists) {
              var seen = {};
              var items = [];
              lists.forEach(function (list) {
                (list || []).forEach(function (it) {
                  var name = String(it && (it.name || it.objectName) || '').trim();
                  if (!name || seen[name]) return;
                  seen[name] = true;
                  items.push(it);
                });
              });
              if (items.length && root.isConnected) {
                _aiImageStorageCache[initProjectId] = items;
                if (initDone) forceRerender();
              }
            })
            .catch(function () {});
        })
      );
    }

    // ③ 안전 타이머 — 최대 4초 후 강제 렌더 (느린 API 대비)
    // (느린 네트워크에서 projectGet이 2.5초 안에 못 돌아오면 stale 데이터로 그려지는 문제 완화;
    //  더 늦게 도착해도 forceRerender가 강제 갱신)
    var safetyTimer = setTimeout(function () { doFinalRender(); }, 4000);

    // ④ 모든 비동기 완료 → 단일 렌더
    (promises.length ? Promise.all(promises) : Promise.resolve())
      .then(function () { doFinalRender(); });
  };
})();
