; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var brandStudio = ui.brandStudio || (ui.brandStudio = {});

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
      { id: 'kakao', title: 'Kakao', desc: '카카오채널·카카오스토리 운영', hasTitle: false }
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

  function renderProject(root, project, brand, options) {
    var renderOptions = options || {};
    var preservedFieldScroll = captureFieldScrollState(root);
    var preservedFieldValues = renderOptions.preserveInputs === false ? null : captureFieldValueState(root);
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandView = readBrandView(brand, project);
    var brandId = String(brandView.brandId || '').trim();
    var selectedAssetIds = readSelectedAssetIds(payload);
    var assetTypeFilter = readAssetTypeFilter(payload);
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
    var assetItems = contentItems.filter(function (item) {
      return ['text', 'image', 'video'].indexOf(String(item.type || '').trim()) >= 0;
    });
    var filteredAssetItems = assetItems.filter(function (item) {
      return assetTypeFilter === 'all' || String(item.type || '').trim() === assetTypeFilter;
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
    var assetTypeFilters = [
      { id: 'all', title: '전체' },
      { id: 'text', title: '스토리' },
      { id: 'image', title: '이미지' },
      { id: 'video', title: '영상' }
    ];
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

    var savedActiveStep = parseInt(String(payload.brandStudioActiveStep || '0'), 10);
    var activeStep = (savedActiveStep >= 1 && savedActiveStep <= 4) ? savedActiveStep : (function () {
      if (!persistedSelectedAssetItems.length) return 1;
      if (!selectedFormats.length) return 2;
      if (!hasDraftForAnyFormat) return 3;
      return 4;
    }());
    var stepDefs = [
      { id: 1, num: '01', title: '자산', done: persistedSelectedAssetItems.length > 0, value: persistedSelectedAssetItems.length ? (persistedSelectedAssetItems.length + '개 선택') : (assetItems.length ? (assetItems.length + '개 있음') : '없음') },
      { id: 2, num: '02', title: '포맷', done: selectedFormats.length > 0, value: selectedFormats.length ? (selectedFormats.length + '개 선택') : '미선택' },
      { id: 3, num: '03', title: '초안', done: hasDraftForAnyFormat, value: hasDraftForAnyFormat ? '작성됨' : '작성 필요' },
      { id: 4, num: '04', title: '배포', done: !!(publishPlan.scheduledAt && publishPlan.channels.length), value: selectedFormats.length ? (selectedFormats.length + '개 채널') : '포맷 없음' }
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
      return (
        '<button type="button" class="bsf-format-card' + (isSelected ? ' is-selected' : '') + '" data-action="brand-toggle-format" data-format-id="' + escapeHtml(item.id) + '">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<p>' + escapeHtml(item.desc) + '</p>' +
        '</button>'
      );
    }).join('');
    var assetTypeFilterButtons = assetTypeFilters.map(function (item) {
      var isActive = item.id === assetTypeFilter;
      var count = item.id === 'all'
        ? assetItems.length
        : assetItems.filter(function (row) { return row.type === item.id; }).length;
      return (
        '<button type="button" class="brand-asset-filter ' + (isActive ? 'is-active' : '') + '" data-action="brand-filter-assets-type" data-asset-type-filter="' + escapeHtml(item.id) + '">' +
        '<span>' + escapeHtml(item.title) + '</span>' +
        '<strong>' + escapeHtml(count) + '</strong>' +
        '</button>'
      );
    }).join('');
    var assetCards = filteredAssetItems.length
      ? filteredAssetItems.map(function (item) {
        var itemId = String(item.id || '').trim();
        var isSelected = autoSelectedAssetIds.indexOf(itemId) >= 0;
        var sceneLabel = item.sceneId ? ('씬 ' + item.sceneId) : '';
        return (
          '<article class="brand-asset-card ' + (isSelected ? 'is-selected' : '') + '">' +
          '<div class="brand-asset-card-top">' +
          '<span class="brand-channel-badge">' + escapeHtml(assetTypeLabel(item.type)) + '</span>' +
          (sceneLabel ? '<span class="brand-content-type-state">' + escapeHtml(sceneLabel) + '</span>' : '') +
          '</div>' +
          '<strong>' + escapeHtml(item.title || '자산') + '</strong>' +
          '<p>' + escapeHtml(assetPreviewText(item) || '미리보기 정보가 없습니다.') + '</p>' +
          '<div class="brand-asset-actions">' +
          '<button type="button" class="btn-secondary compact" data-action="brand-toggle-asset" data-asset-id="' + escapeHtml(itemId) + '">' + (isSelected ? '선택 해제' : '자산 선택') + '</button>' +
          (item.url ? '<a class="btn-secondary compact" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">열기</a>' : '') +
          '</div>' +
          '</article>'
        );
      }).join('')
      : '<div class="brand-asset-empty">현재 필터에 맞는 자산이 없습니다.<br><small>시나리오 작성·이미지 생성·영상 렌더링 후 자산이 표시됩니다.</small></div>';
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
            (fmt && fmt.hasTitle ? '<div class="bsf-draft-title-row"><span class="brand-caption-meta-label">제목</span><input class="brand-publish-input" id="brand-draft-title-' + escapeHtml(formatId) + '" placeholder="콘텐츠 제목" value="' + escapeHtml(titleVal) + '" /></div>' : '') +
            '<div class="bsf-draft-layout">' +
            '<div class="bsf-draft-col"><span class="brand-caption-meta-label">캡션</span><textarea class="brand-caption-textarea" id="brand-draft-caption-' + escapeHtml(formatId) + '" placeholder="캡션을 작성하세요.">' + escapeHtml(captionVal) + '</textarea></div>' +
            '<div class="bsf-draft-col"><span class="brand-caption-meta-label">해시태그</span><textarea class="brand-caption-textarea brand-hashtag-textarea" id="brand-draft-hashtag-' + escapeHtml(formatId) + '" placeholder="#해시태그">' + escapeHtml(hashtagVal) + '</textarea></div>' +
            '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="brand-asset-empty">포맷을 먼저 선택해 주세요.</div>';
    var deployFormatSummary = selectedFormats.length
      ? selectedFormats.map(function (formatId) {
          var fmt = formatItems.find(function (f) { return f.id === formatId; });
          var draft = (formatDrafts && formatDrafts[formatId]) || {};
          var caption = String(draft.caption || '').trim();
          var hasDraft = !!(caption || String(draft.hashtags || '').trim());
          return (
            '<div class="bsf-deploy-format-row">' +
            '<div class="bsf-deploy-format-head"><strong>' + escapeHtml(fmt ? fmt.title : formatId) + '</strong><span class="brand-channel-badge">' + (hasDraft ? '초안 완료' : '초안 없음') + '</span></div>' +
            '<p class="bsf-deploy-caption-preview">' + escapeHtml(caption ? compactSentence(caption, 100) : '초안을 먼저 작성해 주세요.') + '</p>' +
            '</div>'
          );
        }).join('')
      : '<div class="brand-asset-empty">포맷을 선택하지 않았습니다.</div>';
    var ctrlBarHtml = (function () {
      if (activeStep === 1) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<span class="bsf-ctrl-info">' + escapeHtml(persistedSelectedAssetItems.length ? (persistedSelectedAssetItems.length + '개 선택됨') : '선택 없음') + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="brand-clear-assets"' + (persistedSelectedAssetItems.length ? '' : ' disabled') + '>선택 비우기</button>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="1">포맷 선택으로 →</button>' +
          '</div>'
        );
      }
      if (activeStep === 2) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<span class="bsf-ctrl-info">' + escapeHtml(selectedFormats.length ? (selectedFormats.length + '개 포맷 선택됨') : '포맷을 선택하세요') + '</span>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="2"' + (selectedFormats.length ? '' : ' disabled') + '>초안 작성으로 →</button>' +
          '</div>'
        );
      }
      if (activeStep === 3) {
        return (
          '<div class="bsf-ctrl-row">' +
          '<button type="button" class="btn-secondary compact" data-action="brand-generate-all-drafts"' + (selectedFormats.length ? '' : ' disabled') + '>전체 자동 생성</button>' +
          '<button type="button" class="btn-primary compact" data-action="brand-save-format-draft"' + (activeDraftTabOrFirst ? '' : ' disabled') + '>저장</button>' +
          '<span class="bsf-ctrl-divider"></span>' +
          '<button type="button" class="btn-primary compact" data-action="brand-step-next" data-step="3"' + (hasDraftForAnyFormat ? '' : ' disabled') + '>배포 설정으로 →</button>' +
          '</div>'
        );
      }
      return (
        '<div class="bsf-ctrl-row">' +
        '<span class="bsf-ctrl-info">' + escapeHtml(selectedFormats.length ? (selectedFormats.length + '개 채널에 배포 준비') : '포맷 없음') + '</span>' +
        '<button type="button" class="btn-primary compact" data-action="brand-deploy-all-formats"' + (selectedFormats.length ? '' : ' disabled') + '>전체 배포</button>' +
        '</div>'
      );
    }());
    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="bsf-flow-card">' +
      '<div class="bsf-flow-head">' +
      '<div>' +
      '<p class="brand-studio-eyebrow">Brand Operations</p>' +
      '<h2 class="bsf-title">' + escapeHtml(brandView.title || project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="bsf-desc">' + escapeHtml(compactSentence(brandView.summary || payload.brandSummary || '브랜드 요약을 먼저 입력하면 Brand Studio 품질이 올라갑니다.', 100)) + '</p>' +
      '</div>' +
      '<div class="bsf-flow-head-actions">' +
      '<button type="button" class="btn-primary" data-action="brand-oneclick-draft">원클릭 초안</button>' +
      '</div>' +
      '</div>' +
      '<div class="bsf-timeline">' + timelineHtml + '</div>' +
      '<div class="bsf-ctrl-bar">' + ctrlBarHtml + '</div>' +
      '</div>' +
      '<div class="bsf-detail-card">' +
      '<div class="bsf-detail' + (activeStep === 1 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>01 — 자산</strong><span>사용할 영상 또는 이미지 자산을 선택하세요</span></div>' +
      '<div class="brand-asset-filter-row">' + assetTypeFilterButtons + '</div>' +
      '<div class="brand-asset-grid brand-asset-grid-scrollable">' + assetCards + '</div>' +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 2 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>02 — 포맷</strong><span>배포할 플랫폼을 복수로 선택하세요</span></div>' +
      '<div class="bsf-format-grid">' + formatCards + '</div>' +
      '</div>' +
      '<div class="bsf-detail bsf-detail-draft' + (activeStep === 3 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>03 — 초안</strong><span>각 플랫폼별 문구를 작성하세요</span></div>' +
      draftTabsHtml +
      '<div class="bsf-format-draft-panels">' + draftPanelsHtml + '</div>' +
      '</div>' +
      '<div class="bsf-detail' + (activeStep === 4 ? ' is-active' : '') + '">' +
      '<div class="bsf-detail-head"><strong>04 — 배포</strong><span>선택한 모든 채널에 일괄 배포합니다</span></div>' +
      '<div class="bsf-deploy-summary">' + deployFormatSummary + '</div>' +
      '<div class="brand-publish-fields" style="padding-top:12px;">' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">예약 시각 (선택)</span>' +
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
        if (!targetStep || targetStep < 1 || targetStep > 4 || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioActiveStep: targetStep }) }));
        NK.service.project.updatePayload(projectId, { brandStudioActiveStep: targetStep })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function () {});
        return;
      }
      if (action === 'brand-step-next') {
        var fromStep = parseInt(String(btn.dataset.step || '0'), 10);
        var nextStep = fromStep + 1;
        if (!nextStep || nextStep < 1 || nextStep > 4 || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioActiveStep: nextStep }) }));
        NK.service.project.updatePayload(projectId, { brandStudioActiveStep: nextStep })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function () {});
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
          .catch(function (err) { alert('포맷 선택 저장 실패: ' + (err && err.message ? err.message : err)); });
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
          .then(function (result) { if (result && result.draft) renderNext(result.draft); alert('초안을 저장했습니다.'); })
          .catch(function (err) { alert('초안 저장 실패: ' + (err && err.message ? err.message : err)); })
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
          .catch(function (err) { alert('초안 생성 실패: ' + (err && err.message ? err.message : err)); })
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
          .catch(function (err) { alert('원클릭 초안 생성 실패: ' + (err && err.message ? err.message : err)); })
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
          .then(function (result) { if (result && result.draft) renderNext(result.draft); alert(selectedFormats.length + '개 포맷에 배포 계획을 저장했습니다.'); })
          .catch(function (err) { alert('배포 실패: ' + (err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-filter-assets-type') {
        var nextTypeFilter = String(btn.dataset.assetTypeFilter || 'all').trim() || 'all';
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioAssetTypeFilter: nextTypeFilter }) }));
        NK.service.project.updatePayload(projectId, { brandStudioAssetTypeFilter: nextTypeFilter })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert('자산 유형 필터 저장 실패: ' + (err && err.message ? err.message : err)); });
        return;
      }
      if (action === 'brand-toggle-asset') {
        var assetId = String(btn.dataset.assetId || '').trim();
        if (!assetId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextAssetIds = selectedAssetIds.slice();
        var selIdx = nextAssetIds.indexOf(assetId);
        if (selIdx >= 0) nextAssetIds.splice(selIdx, 1); else nextAssetIds.push(assetId);
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioSelectedAssetIds: nextAssetIds }) }));
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextAssetIds })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert('브랜드 자산 선택 저장 실패: ' + (err && err.message ? err.message : err)); });
        return;
      }
      if (action === 'brand-clear-assets') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        renderNext(Object.assign({}, project, { payload: Object.assign({}, project.payload || {}, { brandStudioSelectedAssetIds: [] }) }));
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: [] })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert('선택 자산 초기화 실패: ' + (err && err.message ? err.message : err)); });
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
    if (!NK.service || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, 'Brand Studio를 불러올 수 없습니다.');
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
    } catch (err) {
      try { console.error('BrandStudio render error:', err); } catch (_) {}
      renderEmpty(root, 'Brand Studio 렌더링 중 오류가 발생했습니다.');
    }
  };
})();
