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

      case 'x-threads':
        parts.push(compactSentence(storyText || coreMsg, 200));
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
      'x-threads':       3,
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

  function isFormatCompatible(id, hasStory, hasImage, hasVideo) {
    switch (id) {
      case 'instagram':    return hasImage || hasVideo;
      case 'youtube-shorts': return hasVideo;
      case 'tiktok':       return hasVideo;
      case 'x-threads':    return hasStory || hasImage;
      case 'naver-blog':   return hasStory || hasImage;
      case 'kakao':        return hasImage || hasStory;
      case 'facebook':     return hasImage || hasVideo || hasStory;
      case 'linkedin':     return hasStory || hasImage;
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
      // 포맷 탭 진입 시 자산 기반 자동 선택 (기존 선택 없을 때만)
      if (newStep === 2 && selectedFormats.length === 0) {
        var storySel2 = !!root.querySelector('.bsf-story-card.is-selected');
        var imgSel2 = root.querySelectorAll('.bsf-asset-thumb-grid .bsf-thumb-wrap.is-selected').length > 0;
        var vidSel2 = root.querySelectorAll('.bsf-asset-video-grid .bsf-video-thumb-item.is-selected').length > 0;
        if (storySel2 || imgSel2 || vidSel2) {
          var autoFormats = formatItems.filter(function (fmt) {
            return isFormatCompatible(fmt.id, storySel2, imgSel2, vidSel2);
          }).map(function (fmt) { return fmt.id; });
          if (autoFormats.length) {
            selectedFormats = autoFormats;
            autoFormats.forEach(function (fid) {
              var card = root.querySelector('[data-action="brand-toggle-format"][data-format-id="' + fid + '"]');
              if (card) card.classList.add('is-selected');
            });
            var step2Btn = root.querySelector('[data-action="brand-set-step"][data-step="2"]');
            if (step2Btn) {
              step2Btn.classList.add('is-done');
              var step2Val = step2Btn.querySelector('.bsf-step-val');
              if (step2Val) step2Val.textContent = T.stepValSelected(autoFormats.length);
            }
            if (NK.service && NK.service.project && NK.service.project.updatePayload) {
              NK.service.project.updatePayload(projectId, { brandStudioSelectedFormats: autoFormats }).catch(function () {});
            }
          }
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
    var formatCards = formatItems.map(function (item) {
      var isSelected = selectedFormats.indexOf(item.id) >= 0;
      var compatible = !anyAssetSelected || isFormatCompatible(item.id, storySelected, selHasImage, selHasVideo);
      var fmtDesc = (T.fmtDescs && T.fmtDescs[item.id]) || item.desc;
      var cls = 'bsf-format-card' + (isSelected ? ' is-selected' : '') +
        (anyAssetSelected ? (compatible ? ' is-recommended' : ' is-unavailable') : '');
      return (
        '<button type="button" class="' + cls + '" data-action="brand-toggle-format" data-format-id="' + escapeHtml(item.id) + '">' +
        '<div class="bsf-fmt-card-head">' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '</div>' +
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
    function showDraftSkeleton(panel) {
      var regenBtn = root.querySelector('.bsf-draft-regen-head');
      if (regenBtn) regenBtn.disabled = true;
      if (panel) panel.querySelectorAll('.bsf-ce[contenteditable]').forEach(function (el) { el.classList.add('bsf-skeleton'); });
    }
    function hideDraftSkeleton(panel) {
      var regenBtn = root.querySelector('.bsf-draft-regen-head');
      if (regenBtn) regenBtn.disabled = false;
      if (panel) panel.querySelectorAll('.bsf-ce.bsf-skeleton').forEach(function (el) { el.classList.remove('bsf-skeleton'); });
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
    function inputField(fmtId, fieldKey, label, placeholder, currentVal, fieldTier, inputType) {
      var wC = fieldTier === 'copy' ? 'bsf-field-copy' : 'bsf-field-auto';
      var bC = fieldTier === 'copy' ? 'bsf-badge-copy' : 'bsf-badge-auto';
      var bT = fieldTier === 'copy' ? 'COPY' : 'AUTO';
      var tp = inputType || 'text';
      var cls = tp === 'url' ? 'bsf-input-url' : 'bsf-input-text';
      return '<div class="bsf-field ' + wC + '"><div class="bsf-field-hd"><span class="bsf-badge ' + bC + '">' + bT + '</span><span class="bsf-field-label">' + escapeHtml(label) + '</span></div>' +
        '<input type="' + tp + '" class="' + cls + '" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="' + escapeHtml(fieldKey) + '" placeholder="' + escapeHtml(placeholder || '') + '" value="' + escapeHtml(String(currentVal || '')) + '"></div>';
    }
    function scheduledAtField(fmtId, currentVal, privacyStatus) {
      var hidden = privacyStatus !== 'scheduled' ? ' style="display:none"' : '';
      return '<div class="bsf-field bsf-field-auto bsf-scheduled-row" data-draft-format="' + escapeHtml(fmtId) + '"' + hidden + '>' +
        '<div class="bsf-field-hd"><span class="bsf-badge bsf-badge-auto">AUTO</span><span class="bsf-field-label">' + (isEn ? 'Scheduled time' : '예약 일시') + '</span></div>' +
        '<input type="datetime-local" class="bsf-input-datetime" data-draft-format="' + escapeHtml(fmtId) + '" data-draft-field="scheduled_at" value="' + escapeHtml(String(currentVal || '')) + '"></div>';
    }

    // 목업 공통 파트
    var mockAvatarHtml = '<div class="bsf-mock-avatar"></div>';
    var mockBrandName = escapeHtml((brandView.title || 'Brand').slice(0, 14));
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
      { value: 'scheduled', label: isEn ? 'Scheduled' : '예약' },
    ]; };

    function buildInstagramPreview(fmtId, captionVal, hashtagVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-ig">' +
        '<div class="bsf-mock-ig-hd">' +
          '<div class="bsf-mock-ig-avatar"></div>' +
          '<span class="bsf-mock-ig-uname">' + mockBrandName + '</span>' +
          '<span class="bsf-mock-ig-follow">' + (isEn ? 'Follow' : '팔로우') + '</span>' +
          '<span class="bsf-mock-ig-dots">···</span>' +
        '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-ig-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '<div class="bsf-mock-ig-img-empty">📷</div>') +
        '<div class="bsf-mock-ig-dots-row"><div class="bsf-mock-ig-dot active"></div><div class="bsf-mock-ig-dot"></div><div class="bsf-mock-ig-dot"></div></div>' +
        '<div class="bsf-mock-ig-actions">' +
          '<span class="bsf-mock-ig-action-icon">♡</span>' +
          '<span class="bsf-mock-ig-action-icon">✦</span>' +
          '<span class="bsf-mock-ig-action-icon">✉</span>' +
          '<span class="bsf-mock-ig-save">⊡</span>' +
        '</div>' +
        '<div class="bsf-mock-ig-likes">' + (isEn ? 'Liked by others' : '좋아요 128개') + '</div>' +
        '<div class="bsf-mock-ig-caption"><strong>' + mockBrandName + '</strong> <span data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</span> <span class="more">' + (isEn ? 'more' : '더 보기') + '</span></div>' +
        '<div class="bsf-mock-ig-comment">' + (isEn ? 'View all 12 comments' : '댓글 12개 모두 보기') + '</div>' +
        '<div class="bsf-mock-ig-time">' + (isEn ? '2 hours ago' : '2시간 전') + '</div>' +
        '</div>') +
      afWrap(isEn ? 'Caption' : '캡션', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Write your caption…' : '캡션을 작성하세요')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag #tag')) +
      inputField(fmtId, 'location_tag', isEn ? 'Location tag' : '위치 태그', isEn ? 'Location (optional)' : '위치 태그 (선택)', draft.location_tag || '', 'auto') +
      inputField(fmtId, 'first_comment', isEn ? 'First comment' : '첫 댓글', isEn ? 'Auto-post as first comment (optional)' : '첫 댓글로 자동 게시 (선택)', draft.first_comment || '', 'auto');
    }
    function buildYoutubeShortsPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      var shortsVidHtml = draftFirstVidUrl
        ? '<video class="bsf-mock-shorts-vid" src="' + escapeHtml(draftFirstVidUrl) + '#t=0.001" preload="metadata" muted playsinline></video>'
        : '<div class="bsf-mock-shorts-vid-empty">▶</div>';
      return pvWrap(isEn ? 'Shorts preview' : '쇼츠 미리보기',
        '<div class="bsf-mockup bsf-mock-shorts">' +
        shortsVidHtml +
        '<div class="bsf-mock-shorts-sidebar">' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">♡</span><span class="bsf-mock-shorts-sidebar-count">1.2K</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">💬</span><span class="bsf-mock-shorts-sidebar-count">48</span></div>' +
          '<div class="bsf-mock-shorts-sidebar-item"><span class="bsf-mock-shorts-sidebar-icon">↗</span><span class="bsf-mock-shorts-sidebar-count">' + (isEn ? 'Share' : '공유') + '</span></div>' +
        '</div>' +
        '<div class="bsf-mock-shorts-overlay">' +
          '<div class="bsf-mock-shorts-title" data-mock-mirror="' + fmtId + '" data-mock-field="title">' + escapeHtml((titleVal || '…').slice(0, 50)) + '</div>' +
          '<div class="bsf-mock-shorts-ch">' + mockBrandName + '</div>' +
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
        ? '<video class="bsf-mock-tiktok-vid" src="' + escapeHtml(draftFirstVidUrl) + '#t=0.001" preload="metadata" muted playsinline></video>'
        : '<div class="bsf-mock-tiktok-vid-empty">▶</div>';
      return pvWrap(isEn ? 'Video preview' : '영상 미리보기',
        '<div class="bsf-mockup bsf-mock-tiktok">' +
        tiktokVidHtml +
        '<div class="bsf-mock-tiktok-sidebar">' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">♡</span><span class="bsf-mock-tiktok-sidebar-count">4.8K</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">💬</span><span class="bsf-mock-tiktok-sidebar-count">312</span></div>' +
          '<div class="bsf-mock-tiktok-sidebar-item"><span class="bsf-mock-tiktok-sidebar-icon">↗</span><span class="bsf-mock-tiktok-sidebar-count">' + (isEn ? 'Share' : '공유') + '</span></div>' +
        '</div>' +
        '<div class="bsf-mock-tiktok-overlay">' +
          '<div class="bsf-mock-tiktok-username">@' + mockBrandName + '</div>' +
          '<div class="bsf-mock-tiktok-caption" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(firstSentenceOf(captionVal) || '…') + '</div>' +
          '<div class="bsf-mock-tiktok-music"><span>♪</span><span class="bsf-mock-tiktok-music-text">' + mockBrandName + ' - Original Sound</span></div>' +
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
      var cLen = captionVal.length;
      var cCls = 'bsf-charcount' + (cLen > 270 ? ' over' : cLen > 220 ? ' warn' : '');
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-x">' +
        '<div class="bsf-mock-x-hd">' +
          '<div class="bsf-mock-x-avatar"></div>' +
          '<div class="bsf-mock-x-meta">' +
            '<span class="bsf-mock-x-name">' + mockBrandName + '</span>' +
            '<span class="bsf-mock-x-handle"> · @brand · ' + (isEn ? 'now' : '방금') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-x-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml((captionVal || '').slice(0, 140)) + (captionVal.length > 140 ? '…' : '') + '</div>' +
        '<div class="bsf-mock-x-actions">♡ &nbsp; ↺ &nbsp; 📤 &nbsp; ···</div>' +
        '<div class="bsf-mock-x-counter"><span class="' + cCls + '">' + cLen + ' / 280</span></div>' +
        '</div>') +
      afWrap(isEn ? 'Post text' : '게시 문구',
        ceDiv(fmtId, 'caption', captionVal, 4, isEn ? "What's happening?" : '무슨 일이 있나요?') +
        '<div class="bsf-charcount-row"><span class="' + cCls + '">' + cLen + ' / 280</span></div>') +
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
        '<div class="bsf-mock-nblog-author"><div class="bsf-mock-nblog-author-avatar"></div><span class="bsf-mock-nblog-author-name">' + mockBrandName + '</span><span class="bsf-mock-nblog-author-date">' + (isEn ? 'just now' : '방금 전') + '</span></div>' +
        blogInner +
        '<div class="bsf-mock-nblog-reactions"><span>♡ 0</span><span>💬 0</span><span>↗ ' + (isEn ? 'Share' : '공유') + '</span></div>' +
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
          '<div class="bsf-mock-kakao-ch-icon"></div>' +
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
        '<div class="bsf-mock-kakao-foot"><span>♡ ' + (isEn ? 'Like' : '좋아요') + '</span><span>💬 ' + (isEn ? 'Comment' : '댓글') + '</span></div>' +
        '</div>') +
      cfWrap(isEn ? 'Message' : '메시지', ceDiv(fmtId, 'caption', captionVal, 4, isEn ? 'Write message…' : '메시지를 작성하세요'), fmtId, 'caption') +
      cfWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#해시태그'), fmtId, 'hashtags') +
      inputField(fmtId, 'button_label', isEn ? 'Button label' : '버튼 텍스트', isEn ? 'e.g. Learn more' : '예: 자세히 보기', draft.button_label || '자세히 보기', 'copy') +
      inputField(fmtId, 'link_url', isEn ? 'Link URL' : '링크 URL', 'https://', draft.link_url || '', 'copy', 'url');
    }
    function buildFacebookPreview(fmtId, captionVal, hashtagVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-fb">' +
        '<div class="bsf-mock-fb-hd">' +
          '<div class="bsf-mock-fb-avatar"></div>' +
          '<div class="bsf-mock-fb-meta">' +
            '<div class="bsf-mock-fb-name">' + mockBrandName + '</div>' +
            '<div class="bsf-mock-fb-sub">' + (isEn ? 'Just now · 🌐' : '방금 전 · 🌐') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-fb-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(first2SentencesOf(captionVal) || '…') + '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-fb-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '') +
        '<div class="bsf-mock-fb-reactions"><span>👍❤️😮 128</span><span>' + (isEn ? 'Comments 24 · Shares 6' : '댓글 24 · 공유 6') + '</span></div>' +
        '<div class="bsf-mock-fb-actions">' +
          '<span class="bsf-mock-fb-action-btn">👍 ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-fb-action-btn">💬 ' + (isEn ? 'Comment' : '댓글') + '</span>' +
          '<span class="bsf-mock-fb-action-btn">↗ ' + (isEn ? 'Share' : '공유') + '</span>' +
        '</div>' +
        '</div>') +
      afWrap(isEn ? 'Post text' : '게시 문구', ceDiv(fmtId, 'caption', captionVal, 5, isEn ? "What's on your mind?" : '무슨 생각을 하고 계신가요?')) +
      afWrap(isEn ? 'Hashtags' : '해시태그', ceDiv(fmtId, 'hashtags', hashtagVal, 2, '#hashtag')) +
      inputField(fmtId, 'link_url', isEn ? 'Link URL' : '링크 URL', 'https://', draft.link_url || '', 'auto', 'url') +
      radioField(fmtId, 'privacy_status', isEn ? 'Privacy' : '공개 설정', [
        { value: 'public',   label: isEn ? 'Everyone' : '전체공개' },
        { value: 'friends',  label: isEn ? 'Friends' : '친구만' },
        { value: 'private',  label: isEn ? 'Only me' : '비공개' },
      ], draft.privacy_status || 'public', 'auto');
    }
    function buildLinkedinPreview(fmtId, captionVal, hashtagVal, titleVal, draft) {
      return pvWrap(isEn ? 'Post preview' : '게시물 미리보기',
        '<div class="bsf-mockup bsf-mock-li">' +
        '<div class="bsf-mock-li-hd">' +
          '<div class="bsf-mock-li-avatar"></div>' +
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
          '<span class="bsf-mock-li-action-btn">👍 ' + (isEn ? 'Like' : '좋아요') + '</span>' +
          '<span class="bsf-mock-li-action-btn">💬 ' + (isEn ? 'Comment' : '댓글') + '</span>' +
          '<span class="bsf-mock-li-action-btn">↗ ' + (isEn ? 'Repost' : '리포스트') + '</span>' +
          '<span class="bsf-mock-li-action-btn">✉ ' + (isEn ? 'Send' : '보내기') + '</span>' +
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
          '<div class="bsf-mock-pin-author"><div class="bsf-mock-pin-author-avatar"></div><span class="bsf-mock-pin-author-name">' + mockBrandName + '</span></div>' +
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
          '<div class="bsf-mock-yt-ch-avatar"></div>' +
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
        '<div class="bsf-mock-npost-foot"><span>♡ 0</span><span>💬 0</span></div>' +
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
          '<div class="bsf-mock-band-avatar"></div>' +
          '<div>' +
            '<div><span class="bsf-mock-band-name">' + mockBrandName + '</span><span class="bsf-mock-band-badge">' + (isEn ? 'Leader' : '리더') + '</span></div>' +
            '<div class="bsf-mock-band-date">1' + (isEn ? 'm ago' : '분 전') + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="bsf-mock-band-body" data-mock-mirror="' + fmtId + '" data-mock-field="caption">' + escapeHtml(first2SentencesOf(captionVal) || '…') + '</div>' +
        (draftFirstImgUrl ? '<img class="bsf-mock-band-img" src="' + escapeHtml(draftFirstImgUrl) + '" />' : '') +
        '<div class="bsf-mock-band-foot"><span>♡ ' + (isEn ? 'Like' : '좋아요') + '</span><span>💬 ' + (isEn ? 'Comment' : '댓글') + '</span><span>↗ ' + (isEn ? 'Share' : '공유') + '</span></div>' +
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
        case 'x-threads':      bodyHtml = buildXThreadsPreview(formatId, captionVal, hashtagVal, draft); break;
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
    var deployFormatSummary = selectedFormats.length
      ? selectedFormats.map(function (formatId) {
          var fmt = formatItems.find(function (f) { return f.id === formatId; });
          var draft = (formatDrafts && formatDrafts[formatId]) || {};
          var caption = String(draft.caption || '').trim();
          var hasDraft = !!(caption || String(draft.hashtags || '').trim());
          var draftBadge = isEn ? (hasDraft ? 'Draft ready' : 'No draft') : (hasDraft ? '초안 완료' : '초안 없음');
          return (
            '<div class="bsf-deploy-format-row">' +
            '<div class="bsf-deploy-format-head"><strong>' + escapeHtml(fmt ? fmt.title : formatId) + '</strong>' +
            '<div class="bsf-deploy-format-head-right"><span class="brand-channel-badge">' + draftBadge + '</span>' +
            '<button type="button" class="bsf-deploy-one-btn" data-action="brand-deploy-one-format" data-deploy-format="' + escapeHtml(formatId) + '">' + (isEn ? 'Deploy' : '배포') + '</button></div></div>' +
            '<p class="bsf-deploy-caption-preview">' + escapeHtml(caption ? compactSentence(caption, 100) : T.hintNoDraft) + '</p>' +
            '</div>'
          );
        }).join('')
      : '<div class="brand-asset-empty">' + T.hintNoFormat + '</div>';
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
      '<button type="button" class="btn-primary bsf-head-btn" data-action="brand-save-format-draft" disabled>' + T.ctrlSave + '</button>' +
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
      '<div class="bsf-detail-head"><strong>' + T.head02 + '</strong><span>' + T.head02sub + '</span></div>' +
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
      '<div class="bsf-detail-head bsf-detail-head-asset">' +
        '<strong>' + T.head04 + '</strong>' +
        '<button type="button" class="btn-primary compact" data-action="brand-deploy-all-formats"' + (selectedFormats.length ? '' : ' disabled') + '>' + T.ctrlPublishAll + '</button>' +
        '<span>' + T.head04sub + '</span>' +
      '</div>' +
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

    // contenteditable 자동 저장 (즉시 목업 반영 + 디바운스 800ms 서버 저장)
    var _draftSaveTimer = null;
    var _draftDirty = false;
    function setSaveBtnEnabled(val) {
      _draftDirty = val;
      var sb = root.querySelector('[data-action="brand-save-format-draft"]');
      if (sb) sb.disabled = !val;
    }
    root.oninput = function (ev) {
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
        // X/Threads 글자수 즉시 업데이트
        if (fieldKey === 'caption' && fmtId === 'x-threads') {
          var countEl = ce.parentElement && ce.parentElement.querySelector('.bsf-charcount');
          if (countEl) {
            var cLen = newText.length;
            countEl.textContent = cLen + ' / 280';
            countEl.className = 'bsf-charcount' + (cLen > 270 ? ' over' : cLen > 220 ? ' warn' : '');
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
        // 비동기 저장
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var fmtPatch = { brandStudioSelectedFormats: selectedFormats.slice(), brandStudioActiveDraftTab: activeDraftTabOrFirst };
        NK.service.project.updatePayload(projectId, fmtPatch)
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
              story: String(payload.story || payload.storyPrompt || '').trim(),
              brandContext: brandCtx,
            })
          : Promise.reject(new Error('api_not_ready'))
        ).then(function (result) {
          hideDraftSkeleton(regenPanel);
          ['caption', 'hashtags', 'title'].forEach(function (fieldKey) {
            if (!result[fieldKey]) return;
            var ceEl = regenPanel.querySelector('[data-draft-format="' + regenFmtId + '"][data-draft-field="' + fieldKey + '"]');
            if (ceEl) ceEl.innerText = result[fieldKey];
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
        var currentFmtId = activeDraftTabOrFirst;
        var nextFmtDraft = Object.assign({}, (formatDrafts && formatDrafts[currentFmtId]) || {});
        // contenteditable 필드 읽기
        var activePanel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + currentFmtId + '"]');
        if (activePanel) {
          activePanel.querySelectorAll('[data-draft-field]').forEach(function (el) {
            var key = String(el.dataset.draftField || '').trim();
            if (key) nextFmtDraft[key] = (el.innerText || el.textContent || '').trim();
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
        NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: nextFormatDrafts })
          .then(function (result) {
            if (result && result.draft) { renderNext(result.draft); } else { setSaveBtnEnabled(false); }
            alert(T.alertDraftSaved);
          })
          .catch(function (err) { alert(T.alertDraftSaveFail(err && err.message ? err.message : err)); btn.disabled = false; });
        return;
      }
      if (action === 'brand-generate-all-drafts') {
        if (!selectedFormats.length || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
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
            .finally(function () { btn.disabled = false; });
          return;
        }
        var genBrandCtx = buildBrandContext(payload, brandView, knowledge);
        var genStory = String(payload.story || payload.storyPrompt || '').trim();
        // Immediately show skeleton on every selected panel
        selectedFormats.forEach(function (fid) {
          var panel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + fid + '"]');
          if (panel) showDraftSkeleton(panel);
        });
        // Parallel AI calls — each panel updates independently as it resolves
        var aiCalls = selectedFormats.map(function (fid) {
          return NK.api.draftGenerate({ platformId: fid, story: genStory, brandContext: genBrandCtx })
            .then(function (res) {
              var panel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + fid + '"]');
              if (panel) {
                hideDraftSkeleton(panel);
                ['caption', 'hashtags', 'title'].forEach(function (fieldKey) {
                  if (!res[fieldKey]) return;
                  var ceEl = panel.querySelector('[data-draft-format="' + fid + '"][data-draft-field="' + fieldKey + '"]');
                  if (ceEl) ceEl.innerText = res[fieldKey];
                  var mirror = panel.querySelector('[data-mock-mirror="' + fid + '"][data-mock-field="' + fieldKey + '"]');
                  if (mirror) { var dt = String(res[fieldKey]); mirror.textContent = dt.length > 80 ? dt.slice(0, 80) + '…' : dt; }
                });
              }
              var nd = Object.assign({}, formatDrafts); nd[fid] = Object.assign({}, nd[fid] || {}, res); formatDrafts = nd;
              return res;
            })
            .catch(function (err) {
              var panel = root.querySelector('.bsf-format-draft-panel[data-draft-format="' + fid + '"]');
              if (panel) hideDraftSkeleton(panel);
              console.error('[draft-generate:' + fid + ']', err && err.message ? err.message : err);
              return null;
            });
        });
        Promise.all(aiCalls)
          .then(function () { return NK.service.project.updatePayload(projectId, { brandStudioFormatDrafts: formatDrafts }); })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); })
          .catch(function (err) { alert(T.alertDraftGenFail(err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      if (action === 'brand-oneclick-draft') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        var defaultFormats = selectedFormats.length ? selectedFormats.slice() : ['instagram', 'x-threads'];
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
              if (genAllBtn && !genAllBtn.disabled) genAllBtn.click();
            }, 30);
          })
          .catch(function (err) { alert(T.alertOneClickFail(err && err.message ? err.message : err)); btn.disabled = false; });
        return;
      }
      if (action === 'brand-deploy-one-format') {
        var oneFmtId = String(btn.dataset.deployFormat || '').trim();
        if (!oneFmtId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var publishInputElOne = root.querySelector('#brand-publish-datetime');
        var scheduledAtOne = publishInputElOne ? String(publishInputElOne.value || '').trim() : '';
        btn.disabled = true;
        var deployPlanOne = { channels: [oneFmtId], scheduledAt: scheduledAtOne, status: scheduledAtOne ? 'scheduled' : 'deploying', formatDrafts: Object.assign({}, formatDrafts || {}) };
        syncBrandAndProject({ brandStudioPublishPlan: deployPlanOne }, { brandStudioPublishPlan: deployPlanOne })
          .then(function (result) { if (result && result.draft) renderNext(result.draft); alert(T.alertPublishSaved(1)); })
          .catch(function (err) { alert(T.alertPublishFail(err && err.message ? err.message : err)); })
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
