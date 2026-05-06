; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var brandStudio = ui.brandStudio || (ui.brandStudio = {});

  // 렌더 저장소 캐시: projectId → [{name, size}]
  var _renderStorageCache = {};

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

  function getPageScrollContainer(node) {
    var current = node;
    while (current) {
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

  function readSelectedFormats(payload) {
    var src = payload && Array.isArray(payload.brandStudioSelectedFormats)
      ? payload.brandStudioSelectedFormats
      : [];
    return src.map(function (item) { return String(item || '').trim(); }).filter(Boolean);
  }

  function readFormatDrafts(payload) {
    var src = payload && payload.brandStudioFormatDrafts && typeof payload.brandStudioFormatDrafts === 'object'
      ? payload.brandStudioFormatDrafts
      : {};
    return Object.assign({}, src);
  }

  function readActiveDraftTab(payload) {
    return String(payload && payload.brandStudioActiveDraftTab || '').trim();
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

  function buildCaptionDraft(project, brandView, selectedOption, sourceTexts, knowledge) {
    var payload = (project && project.payload) || {};
    var sourceLine = compactSentence(firstFilled(sourceTexts), 90);
    var storyLine = compactSentence(knowledge.brandStory, 90);
    var worldLine = compactSentence(knowledge.worldSetting, 70);
    var successLine = compactSentence(knowledge.successCases[0], 64);
    var ruleLead = compactSentence(knowledge.brandRules[0], 50);
    var parts = [
      firstFilled([brandView.summary, brandView.title, payload.brandSummary, project && (project.seriesTitle || project.title), brandView.coreMessage, payload.coreMessage]),
      selectedOption ? (selectedOption.title + ' 형식으로 정리한 브랜드 운영 문구입니다.') : '',
      payload.coreMessage ? ('핵심 메시지는 "' + payload.coreMessage + '" 입니다.') : '',
      storyLine ? ('브랜드 맥락은 ' + storyLine) : '',
      worldLine ? ('배경 문맥은 ' + worldLine) : '',
      sourceLine ? ('이번 포인트는 ' + sourceLine + ' 입니다.') : '',
      successLine ? ('기존에 반응이 좋았던 흐름은 ' + successLine + ' 입니다.') : '',
      ruleLead ? ('운영 규칙은 "' + ruleLead + '"를 우선합니다.') : '',
      knowledge.brandVoice ? ('말투 기준은 ' + compactSentence(knowledge.brandVoice, 60) + ' 입니다.') : '',
      payload.targetAudience || payload.target ? (String(payload.targetAudience || payload.target) + '에게 자연스럽게 전달되도록 구성했습니다.') : '',
      '자세한 내용은 프로젝트 업데이트에서 계속 이어집니다.'
    ].filter(Boolean);
    return scrubBannedText(parts.join(' '), knowledge.bannedExpressions);
  }

  function buildHashtagDraft(project, brandView, selectedOption, sourceTexts, knowledge) {
    var payload = (project && project.payload) || {};
    var tokens = [];

    function pushToken(value) {
      var tag = normalizeHashtagToken(value);
      if (!tag) return;
      if (tokens.indexOf(tag) >= 0) return;
      tokens.push(tag);
    }

    function pushKeywords(value) {
      splitHashtagKeywordCandidates(value).forEach(pushToken);
    }

    pushToken(brandView.title || (project && (project.seriesTitle || project.title)));
    pushToken(payload.projectType);
    pushToken(payload.targetAudience || payload.target);
    pushToken(selectedOption && selectedOption.title);
    pushKeywords(knowledge.brandCharacter);
    pushKeywords(knowledge.worldSetting);
    toTagList(payload.brandKeywords).slice(0, 4).forEach(pushToken);
    toTagList(knowledge.referenceContents).slice(0, 2).forEach(pushKeywords);
    toTagList(knowledge.successCases).slice(0, 2).forEach(pushKeywords);
    toTagList(payload.purposeTags).slice(0, 3).forEach(pushToken);

    var sourceLine = firstFilled(sourceTexts);
    if (sourceLine) {
      sourceLine.split(/\s+/).slice(0, 3).forEach(pushKeywords);
    }

    return tokens.filter(function (token) {
      return !knowledge.bannedExpressions.some(function (term) {
        return token.toLowerCase().indexOf(String(term || '').trim().toLowerCase()) >= 0;
      });
    }).slice(0, 8).join(' ');
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
    var targetFormats = (selectedFormats && selectedFormats.length) ? selectedFormats : ['instagram', 'x-threads'];
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
      eyebrow: '브랜드 운영', oneClickDraft: '원클릭 초안',
      stepAsset: '자산', stepFormat: '포맷', stepDraft: '초안', stepPublish: '배포',
      stepValNoFormat: '포맷 없음', stepValDrafted: '작성됨', stepValNeedsDraft: '작성 필요',
      stepValChannels: function (n) { return n + '개 채널'; },
      stepValSelected: function (n) { return n + '개 선택'; }, stepValNone: '미선택',
      stepItemsVal: function (n) { return n + '개 있음'; },
      ctrlNoSelection: '선택 없음', ctrlNSelected: function (n) { return n + '개 선택됨'; },
      ctrlClearSel: '선택 비우기', ctrlToFormat: '포맷 선택으로 →',
      ctrlNFormats: function (n) { return n + '개 포맷 선택됨'; },
      ctrlSelectFormat: '포맷을 선택하세요', ctrlToDraft: '초안 작성으로 →',
      ctrlAutoGen: '전체 자동 생성', ctrlSave: '저장', ctrlToPublish: '배포 설정으로 →',
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
        'x-threads': '짧은 글·링크 중심 실시간 확산 채널',
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
      alertDraftSaved: '초안을 저장했습니다.',
      alertDraftSaveFail: function (e) { return '초안 저장 실패: ' + e; },
      alertDraftGenFail: function (e) { return '초안 생성 실패: ' + e; },
      alertOneClickFail: function (e) { return '원클릭 초안 생성 실패: ' + e; },
      alertPublishSaved: function (n) { return n + '개 포맷에 배포 계획을 저장했습니다.'; },
      alertPublishFail: function (e) { return '배포 실패: ' + e; },
      alertAssetSaveFail: function (e) { return '자산 선택 저장 실패: ' + e; },
      alertAssetResetFail: function (e) { return '선택 자산 초기화 실패: ' + e; }
    };
    return {
      eyebrow: 'Brand Operations', oneClickDraft: 'One-Click Draft',
      stepAsset: 'Assets', stepFormat: 'Format', stepDraft: 'Draft', stepPublish: 'Publish',
      stepValNoFormat: 'No format', stepValDrafted: 'Written', stepValNeedsDraft: 'Needs draft',
      stepValChannels: function (n) { return n + ' channels'; },
      stepValSelected: function (n) { return n + ' selected'; }, stepValNone: 'None',
      stepItemsVal: function (n) { return n + ' items'; },
      ctrlNoSelection: 'No selection', ctrlNSelected: function (n) { return n + ' selected'; },
      ctrlClearSel: 'Clear selection', ctrlToFormat: 'To Format →',
      ctrlNFormats: function (n) { return n + ' format' + (n === 1 ? '' : 's') + ' selected'; },
      ctrlSelectFormat: 'Select a format', ctrlToDraft: 'To Draft →',
      ctrlAutoGen: 'Auto Generate All', ctrlSave: 'Save', ctrlToPublish: 'To Publish →',
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
        'x-threads': 'Short text & link real-time distribution',
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
      alertDraftSaved: 'Draft saved.',
      alertDraftSaveFail: function (e) { return 'Failed to save draft: ' + e; },
      alertDraftGenFail: function (e) { return 'Failed to generate draft: ' + e; },
      alertOneClickFail: function (e) { return 'One-click draft failed: ' + e; },
      alertPublishSaved: function (n) { return 'Publish plan saved for ' + n + ' format' + (n === 1 ? '' : 's') + '.'; },
      alertPublishFail: function (e) { return 'Publish failed: ' + e; },
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
      { id: 'x-threads', title: 'X · Threads', desc: '짧은 글·링크 중심 실시간 확산 채널', hasTitle: false },
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
    var cachedRenders = _renderStorageCache[projectId] || [];
    if (cachedRenders.length) {
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
        contentItems.push({
          id: rid, projectId: projectId, type: 'video',
          title: '렌더 ' + label, url: rUrl, status: 'ready'
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
      // ③ ctrl bar만 교체 (전체 리렌더 없음)
      var ctrlBarEl = root.querySelector('.bsf-ctrl-bar');
      if (ctrlBarEl) ctrlBarEl.innerHTML = makeCtrlBarHtml(newStep);
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
    var formatCards = formatItems.map(function (item) {
      var isSelected = selectedFormats.indexOf(item.id) >= 0;
      var fmtDesc = (T.fmtDescs && T.fmtDescs[item.id]) || item.desc;
      return (
        '<button type="button" class="bsf-format-card' + (isSelected ? ' is-selected' : '') + '" data-action="brand-toggle-format" data-format-id="' + escapeHtml(item.id) + '">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<p>' + escapeHtml(fmtDesc) + '</p>' +
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
    var storyVirtualId = projectId + ':story';
    var storySelected = selectedAssetIds.indexOf(storyVirtualId) >= 0;
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
          '<video class="bsf-thumb-video" src="' + escapeHtml(i.url) + '#t=0.001" preload="metadata" muted playsinline></video>' +
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
    var assetTrioHtml = '<div class="bsf-asset-trio">' + storyCardHtml + imageCardHtml + videoCardHtml + '</div>';
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
          var captionVal = String(draft.caption || '').trim() || buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge);
          var hashtagVal = String(draft.hashtags || '').trim() || buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge);
          var titleVal = String(draft.title || '').trim();
          return (
            '<div class="bsf-format-draft-panel' + (isActive ? ' is-active' : '') + '" data-draft-format="' + escapeHtml(formatId) + '">' +
            (fmt && fmt.hasTitle ? '<div class="bsf-draft-title-row"><span class="brand-caption-meta-label">' + T.labelTitle + '</span><input class="brand-publish-input" id="brand-draft-title-' + escapeHtml(formatId) + '" placeholder="' + escapeHtml(T.placeholderTitle) + '" value="' + escapeHtml(titleVal) + '" /></div>' : '') +
            '<div class="bsf-draft-layout">' +
            '<div class="bsf-draft-col"><span class="brand-caption-meta-label">' + T.labelCaption + '</span><textarea class="brand-caption-textarea" id="brand-draft-caption-' + escapeHtml(formatId) + '" placeholder="' + escapeHtml(T.placeholderCaption) + '">' + escapeHtml(captionVal) + '</textarea></div>' +
            '<div class="bsf-draft-col"><span class="brand-caption-meta-label">' + T.labelHashtag + '</span><textarea class="brand-caption-textarea brand-hashtag-textarea" id="brand-draft-hashtag-' + escapeHtml(formatId) + '" placeholder="' + escapeHtml(T.placeholderHashtag) + '">' + escapeHtml(hashtagVal) + '</textarea></div>' +
            '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="brand-asset-empty">' + T.hintNoFormat + '</div>';
    var deployFormatSummary = selectedFormats.length
      ? selectedFormats.map(function (formatId) {
          var fmt = formatItems.find(function (f) { return f.id === formatId; });
          var draft = (formatDrafts && formatDrafts[formatId]) || {};
          var caption = String(draft.caption || '').trim();
          var hasDraft = !!(caption || String(draft.hashtags || '').trim());
          var draftBadge = isEn ? (hasDraft ? 'Draft ready' : 'No draft') : (hasDraft ? '초안 완료' : '초안 없음');
          return (
            '<div class="bsf-deploy-format-row">' +
            '<div class="bsf-deploy-format-head"><strong>' + escapeHtml(fmt ? fmt.title : formatId) + '</strong><span class="brand-channel-badge">' + draftBadge + '</span></div>' +
            '<p class="bsf-deploy-caption-preview">' + escapeHtml(caption ? compactSentence(caption, 100) : T.hintNoDraft) + '</p>' +
            '</div>'
          );
        }).join('')
      : '<div class="brand-asset-empty">' + T.hintNoFormat + '</div>';
    function makeCtrlBarHtml(step) {
      if (step === 1) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<span class="bsf-ctrl-info">' + escapeHtml(persistedSelCount ? T.ctrlNSelected(persistedSelCount) : T.ctrlNoSelection) + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="brand-clear-assets"' + (persistedSelCount ? '' : ' disabled') + '>' + T.ctrlClearSel + '</button>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="1">' + T.ctrlToFormat + '</button>' +
          '</div>'
        );
      }
      if (step === 2) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<span class="bsf-ctrl-info">' + escapeHtml(selectedFormats.length ? T.ctrlNFormats(selectedFormats.length) : T.ctrlSelectFormat) + '</span>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="2"' + (selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlToDraft + '</button>' +
          '</div>'
        );
      }
      if (step === 3) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<button type="button" class="btn-secondary compact" data-action="brand-generate-all-drafts"' + (selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlAutoGen + '</button>' +
          '<button type="button" class="btn-primary compact" data-action="brand-save-format-draft"' + (activeDraftTabOrFirst ? '' : ' disabled') + '>' + T.ctrlSave + '</button>' +
          '<span class="bsf-ctrl-divider"></span>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="3"' + (hasDraftForAnyFormat ? '' : ' disabled') + '>' + T.ctrlToPublish + '</button>' +
          '</div>'
        );
      }
      return (
        '<div class="bsf-ctrl-row">' +
        '<span class="bsf-ctrl-info">' + escapeHtml(selectedFormats.length ? T.ctrlNChannelsReady(selectedFormats.length) : T.stepValNoFormat) + '</span>' +
        '<button type="button" class="btn-primary compact" data-action="brand-deploy-all-formats"' + (selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlPublishAll + '</button>' +
        '</div>'
      );
    }
    var ctrlBarHtml = makeCtrlBarHtml(activeStep);
    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="bsf-flow-card">' +
      '<div class="bsf-flow-head">' +
      '<div>' +
      '<p class="brand-studio-eyebrow">' + T.eyebrow + '</p>' +
      '<h2 class="bsf-title">' + escapeHtml(brandView.title || project.seriesTitle || project.title || (isEn ? 'Project' : '프로젝트')) + '</h2>' +
      '<p class="bsf-desc">' + escapeHtml(compactSentence(brandView.summary || payload.brandSummary || T.brandSummaryHint, 100)) + '</p>' +
      '</div>' +
      '<div class="bsf-flow-head-actions">' +
      '<button type="button" class="btn-primary" data-action="brand-oneclick-draft">' + T.oneClickDraft + '</button>' +
      '</div>' +
      '</div>' +
      '<div class="bsf-timeline">' + timelineHtml + '</div>' +
      '<div class="bsf-ctrl-bar">' + ctrlBarHtml + '</div>' +
      '</div>' +
      '<div class="bsf-detail-card">' +
      '<div class="bsf-detail' + (activeStep === 1 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>' + T.head01 + '</strong><span>' + T.head01sub + '</span></div>' +
      assetTrioHtml +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 2 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>' + T.head02 + '</strong><span>' + T.head02sub + '</span></div>' +
      '<div class="bsf-format-grid">' + formatCards + '</div>' +
      '</div>' +
      '<div class="bsf-detail bsf-detail-draft' + (activeStep === 3 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>' + T.head03 + '</strong><span>' + T.head03sub + '</span></div>' +
      draftTabsHtml +
      '<div class="bsf-format-draft-panels">' + draftPanelsHtml + '</div>' +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 4 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>' + T.head04 + '</strong><span>' + T.head04sub + '</span></div>' +
      '<div class="bsf-deploy-summary">' + deployFormatSummary + '</div>' +
      '<div class="brand-publish-fields" style="padding-top:12px;">' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">' + T.placeholderSchedule + '</span>' +
      '<input id="brand-publish-datetime" class="brand-publish-input" type="datetime-local" value="' + escapeHtml(publishPlan.scheduledAt || '') + '" /></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
    restoreFieldValueState(root, preservedFieldValues);
    restoreFieldScrollState(root, preservedFieldScroll);
    bindDisclosureState(root);


    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action === 'character-open-new' || action === 'character-edit' || action === 'character-deactivate' || action === 'character-save' || action === 'character-cancel') return;
      if (action === 'brand-set-step') {
        var targetStep = parseInt(String(btn.dataset.step || '0'), 10);
        if (!targetStep || targetStep < 1 || targetStep > 4) return;
        // 즉시 단계 전환 — 리렌더 없음
        switchToStep(targetStep);
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          NK.service.project.updatePayload(projectId, { brandStudioActiveStep: targetStep })
            .catch(function () {});
        }
        return;
      }
      if (action === 'brand-step-next') {
        var fromStep = parseInt(String(btn.dataset.step || '0'), 10);
        var nextStep = fromStep + 1;
        if (!nextStep || nextStep < 1 || nextStep > 4) return;
        // 즉시 단계 전환 — 리렌더 없음
        switchToStep(nextStep);
        if (NK.service && NK.service.project && NK.service.project.updatePayload) {
          NK.service.project.updatePayload(projectId, { brandStudioActiveStep: nextStep })
            .catch(function () {});
        }
        return;
      }
      if (action === 'brand-toggle-format') {
        var formatId = String(btn.dataset.formatId || '').trim();
        if (!formatId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextFormats = selectedFormats.slice();
        var fmtIdx = nextFormats.indexOf(formatId);
        if (fmtIdx >= 0) nextFormats.splice(fmtIdx, 1); else nextFormats.push(formatId);
        var nextTab = nextFormats.indexOf(activeDraftTabOrFirst) >= 0 ? activeDraftTabOrFirst : (nextFormats.length ? nextFormats[0] : '');
        var fmtPatch = { brandStudioSelectedFormats: nextFormats, brandStudioActiveDraftTab: nextTab };
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, fmtPatch) }));
        NK.service.project.updatePayload(projectId, fmtPatch)
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert(T.alertSaveFormatFail(err && err.message ? err.message : err)); });
        return;
      }
      if (action === 'brand-set-draft-tab') {
        var tabId = String(btn.dataset.draftTab || '').trim();
        if (!tabId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioActiveDraftTab: tabId }) }));
        NK.service.project.updatePayload(projectId, { brandStudioActiveDraftTab: tabId })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function () {});
        return;
      }
      if (action === 'brand-save-format-draft') {
        if (!activeDraftTabOrFirst || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var currentFmtId = activeDraftTabOrFirst;
        var captionEl = root.querySelector('#brand-draft-caption-' + currentFmtId);
        var hashtagEl = root.querySelector('#brand-draft-hashtag-' + currentFmtId);
        var titleElFmt = root.querySelector('#brand-draft-title-' + currentFmtId);
        var nextFmtDraft = Object.assign({}, (formatDrafts && formatDrafts[currentFmtId]) || {});
        if (captionEl) nextFmtDraft.caption = String(captionEl.value || '').trim();
        if (hashtagEl) nextFmtDraft.hashtags = String(hashtagEl.value || '').trim();
        if (titleElFmt) nextFmtDraft.title = String(titleElFmt.value || '').trim();
        var nextFormatDrafts = Object.assign({}, formatDrafts || {});
        nextFormatDrafts[currentFmtId] = nextFmtDraft;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextFormatDrafts })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); alert(T.alertDraftSaved); })
          .catch(function (err) { alert(T.alertDraftSaveFail(err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-generate-all-drafts') {
        if (!selectedFormats.length || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
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
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-oneclick-draft') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        var defaultFormats = selectedFormats.length ? selectedFormats.slice() : ['instagram', 'x-threads'];
        var autoFormatDrafts = Object.assign({}, formatDrafts || {});
        defaultFormats.forEach(function (fid) {
          var fmt = formatItems.find(function (f) { return f.id === fid; });
          autoFormatDrafts[fid] = { caption: buildCaptionDraft(project, brandView, fmt, sourceTexts, knowledge), hashtags: buildHashtagDraft(project, brandView, fmt, sourceTexts, knowledge) };
        });
        var oneClickPayload = {
          brandStudioSelectedAssetIds: selectedAssetIds.length ? selectedAssetIds.slice() : autoSelectedAssetIds.slice(),
          brandStudioSelectedFormats: defaultFormats,
          brandStudioFormatDrafts: autoFormatDrafts,
          brandStudioActiveDraftTab: defaultFormats[0] || '',
          brandStudioActiveStep: 3
        };
        NK.service.project.updatePayload(projectId, oneClickPayload)
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            setTimeout(function () { var t = root.querySelector('.brand-caption-textarea'); if (t) { scrollNodeIntoPageView(t, 'start'); t.focus(); } }, 30);
          })
          .catch(function (err) { alert(T.alertOneClickFail(err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-deploy-all-formats') {
        if (!selectedFormats.length || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var publishInputEl = root.querySelector('#brand-publish-datetime');
        var scheduledAt = publishInputEl ? String(publishInputEl.value || '').trim() : '';
        btn.disabled = true;
        var deployPlan = { channels: selectedFormats.slice(), scheduledAt: scheduledAt, status: scheduledAt ? 'scheduled' : 'deploying', formatDrafts: Object.assign({}, formatDrafts || {}) };
        syncBrandAndProject({ brandStudioPublishPlan: deployPlan }, { brandStudioPublishPlan: deployPlan })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); alert(T.alertPublishSaved(selectedFormats.length)); })
          .catch(function (err) { alert(T.alertPublishFail(err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-toggle-story-card') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var stVId = projectId + ':story';
        var nextStoryIds = selectedAssetIds.slice();
        var stIdx = nextStoryIds.indexOf(stVId);
        var nextStorySel = stIdx < 0;
        if (stIdx >= 0) nextStoryIds.splice(stIdx, 1); else nextStoryIds.push(stVId);
        // ① 카드 즉시 CSS 토글
        btn.classList.toggle('is-selected', nextStorySel);
        // ② step 바 수술적 업데이트
        updateStep1Bar();
        // ③ 비동기 저장
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextStoryIds })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function () {});
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
        if (!singleAssetId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextSingleIds = selectedAssetIds.slice();
        var sidx = nextSingleIds.indexOf(singleAssetId);
        var isNowSel = sidx < 0;
        if (sidx >= 0) nextSingleIds.splice(sidx, 1); else nextSingleIds.push(singleAssetId);
        // ① 썸네일 즉시 토글 (리렌더 없음)
        btn.classList.toggle('is-selected', isNowSel);
        // ② 카드 하이라이트 + 카운트 라벨 수술적 업데이트
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
        // ③ step 바 수술적 업데이트
        updateStep1Bar();
        // ④ 비동기 저장 — 응답 후에만 전체 리렌더
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextSingleIds })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert(T.alertAssetSaveFail(err && err.message ? err.message : err)); });
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
      if (action === 'brand-clear-assets') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioSelectedAssetIds: [] }) }));
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: [] })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert(T.alertAssetResetFail(err && err.message ? err.message : err)); });
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
  }
  // stub: keep for legacy references
  function inferDefaultContentType() { return 'instagram'; }

  brandStudio.init = function () {
    var root = document.getElementById('brand-studio-root');
    if (!root) return;
    var _initIsEn = !!(NK.state && NK.state.runtime && NK.state.runtime.lang === 'en');
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
    bindDeferredHydrationFlush(root);
    try {
      renderProject(root, project, brand);
      var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
      if (brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
        NK.service.brand.hydrateFromServer(brandId, { force: true, ttlMs: 0 })
          .then(function (nextBrand) {
            if (!nextBrand || !root.isConnected) return;
            renderProject(root, project, nextBrand);
          })
          .catch(function () {});
      }
      // 씬 이미지/영상 URL 갱신 (만료된 Signed URL 또는 gs:// 경로)
      if (NK.service && NK.service.sceneAssets && NK.service.sceneAssets.refreshProjectSceneAssets) {
        NK.service.sceneAssets.refreshProjectSceneAssets(project)
          .then(function (updated) {
            if (!updated || !root.isConnected) return;
            var freshProject = (NK.state && NK.state.runtime && NK.state.runtime.currentProject) || project;
            var freshBrand = brand;
            try {
              if (brandId && NK.service.brand && NK.service.brand.getById) {
                freshBrand = NK.service.brand.getById(brandId) || brand;
              }
            } catch (_) {}
            renderProject(root, freshProject, freshBrand);
          })
          .catch(function () {});
      }
      // 렌더 저장소 전체 목록 비동기 로드 → 영상 카드에 표시
      var initProjectId = String(project.id || '').trim();
      if (NK.api && NK.api.postprodRenderList && initProjectId) {
        NK.api.postprodRenderList(initProjectId)
          .then(function (renderList) {
            if (!Array.isArray(renderList) || !renderList.length || !root.isConnected) return;
            _renderStorageCache[initProjectId] = renderList;
            var freshProject = (NK.state && NK.state.runtime && NK.state.runtime.currentProject) || project;
            renderProject(root, freshProject, brand);
          })
          .catch(function () {});
      }
    } catch (err) {
      try { console.error('BrandStudio render error:', err); } catch (_) {}
      renderEmpty(root, _initIsEn ? 'An error occurred while rendering Brand Studio.' : 'Brand Studio 렌더링 중 오류가 발생했습니다.');
    }
  };
})();
