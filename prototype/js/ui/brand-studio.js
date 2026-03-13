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
    var src = payload && payload.knowledgeHub && typeof payload.knowledgeHub === 'object'
      ? payload.knowledgeHub
      : payload || {};
    return {
      brandVoice: String(src.brandVoice || '').trim(),
      brandStory: String(src.brandStory || '').trim(),
      brandCharacter: String(src.brandCharacter || '').trim(),
      worldSetting: String(src.worldSetting || src.knowledgeWorld || '').trim(),
      brandRules: toTagList(src.brandRules),
      bannedExpressions: toTagList(src.bannedExpressions || src.banned),
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
      case 'text': return '글';
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

  function contentTypeOptions() {
    return [
      {
        id: 'sns-post',
        title: 'SNS 게시물',
        desc: '짧은 문구와 대표 이미지를 중심으로 운영하는 기본 포맷입니다.',
        outputs: '본문 · 캡션 · 해시태그'
      },
      {
        id: 'shorts-promo',
        title: '쇼츠 홍보',
        desc: '기존 영상/씬 자산을 짧은 홍보 포맷으로 다시 운영하는 흐름입니다.',
        outputs: '짧은 영상 · 캡션 · 업로드 문구'
      },
      {
        id: 'promo-image',
        title: '홍보 이미지',
        desc: '카드형 프로모션이나 SNS 썸네일 중심 운영에 적합합니다.',
        outputs: '대표 이미지 · 카피 · 해시태그'
      },
      {
        id: 'blog-post',
        title: '블로그 글',
        desc: '프로젝트 메시지를 문서형 콘텐츠로 확장하는 운영 포맷입니다.',
        outputs: '본문 초안 · 요약 문구 · 태그'
      }
    ];
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

  function renderProject(root, project, brand) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandView = readBrandView(brand, project);
    var currentEpisodeTitle = episodeLabel(project);
    var brandId = String(brandView.brandId || '').trim();
    var selectedType = readBrandContentType(payload);
    var savedCaption = readCaptionDraft(payload);
    var savedHashtags = readHashtagDraft(payload);
    var selectedAssetIds = readSelectedAssetIds(payload);
    var assetTypeFilter = readAssetTypeFilter(payload);
    var assetProjectFilter = readAssetProjectFilter(payload);
    var autoSuggestion = readAutoSuggestion(payload);
    var knowledge = readKnowledge(brand && typeof brand === 'object' ? brand : payload);
    var channelConnections = readChannelConnections(brand, payload);
    var publishPlan = readPublishPlan(brand, payload);
    var publishResults = readPublishResults(brand, payload);
    var summary = (NK.service.contentLibrary && NK.service.contentLibrary.summarizeProject)
      ? NK.service.contentLibrary.summarizeProject(brand || project)
      : { scenes: 0, images: 0, videos: 0, nextAction: '시나리오 작성' };
    var options = contentTypeOptions();
    var channelRows = channelOptions();
    var channelTitleMap = {};
    channelRows.forEach(function (item) {
      channelTitleMap[item.id] = item.title;
    });
    var selectedOption = options.find(function (item) { return item.id === selectedType; }) || null;
    var contentItems = (NK.service.contentLibrary && NK.service.contentLibrary.listProjectContents)
      ? NK.service.contentLibrary.listProjectContents(brand || project)
      : [];
    var projectRows = (NK.service && NK.service.brand && NK.service.brand.listProjects && brandId)
      ? NK.service.brand.listProjects(brand || brandId)
      : [project];
    var projectTitleMap = {};
    projectRows.forEach(function (item) {
      projectTitleMap[String(item.id || '').trim()] = String(item.title || item.seriesTitle || item.id || '').trim() || '프로젝트';
    });
    if (!projectTitleMap[projectId]) {
      projectTitleMap[projectId] = String(project.title || project.seriesTitle || projectId).trim();
    }
    var assetItems = contentItems.filter(function (item) {
      return ['text', 'image', 'video', 'reference', 'publish-result'].indexOf(String(item.type || '').trim()) >= 0;
    });
    var filteredAssetItems = assetItems.filter(function (item) {
      var typeMatch = assetTypeFilter === 'all' || String(item.type || '').trim() === assetTypeFilter;
      var projectMatch = assetProjectFilter === 'all' || String(item.projectId || '').trim() === assetProjectFilter;
      return typeMatch && projectMatch;
    });
    var selectedAssetItems = assetItems.filter(function (item) {
      return selectedAssetIds.indexOf(String(item.id || '').trim()) >= 0;
    });
    var sourceAssetItems = selectedAssetItems.length
      ? selectedAssetItems
      : assetItems.filter(function (item) { return item.type === 'text' || item.type === 'reference'; });
    var sourceTexts = sourceAssetItems
      .map(function (item) { return String(item.text || item.title || '').trim(); })
      .filter(Boolean);
    var assetTypeFilters = [
      { id: 'all', title: '전체' },
      { id: 'video', title: '영상' },
      { id: 'image', title: '이미지' },
      { id: 'text', title: '글' },
      { id: 'reference', title: '참조' },
      { id: 'publish-result', title: '게시 결과' }
    ];

    function renderNext(nextProject) {
      var fallbackProject = nextProject && nextProject.id ? nextProject : project;
      var nextBrandId = String(fallbackProject && fallbackProject.payload && fallbackProject.payload.brandId || brandId).trim();
      var nextBrand = (NK.service && NK.service.brand && NK.service.brand.getById && nextBrandId)
        ? NK.service.brand.getById(nextBrandId)
        : null;
      renderProject(root, fallbackProject, nextBrand || brand);
    }

    function syncBrandAndProject(brandPatch, projectPatch) {
      var tasks = [];
      if (brandId && NK.service && NK.service.brand && NK.service.brand.update) {
        tasks.push(Promise.resolve().then(function () {
          return NK.service.brand.update(brandId, brandPatch || {});
        }));
      }
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        tasks.push(NK.service.project.updatePayload(projectId, projectPatch || {}));
      }
      return Promise.all(tasks).then(function (results) {
        var nextDraft = null;
        for (var i = 0; i < results.length; i++) {
          if (results[i] && results[i].draft) {
            nextDraft = results[i].draft;
            break;
          }
        }
        return { draft: nextDraft || project };
      });
    }

    var contentTypeCards = options.map(function (item) {
      var isActive = item.id === selectedType;
      return (
        '<button type="button" class="brand-content-type-card ' + (isActive ? 'is-active' : '') + '" data-action="brand-select-content-type" data-content-type="' + escapeHtml(item.id) + '">' +
        '<span class="brand-content-type-state">' + (isActive ? '선택됨' : '선택') + '</span>' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<p>' + escapeHtml(item.desc) + '</p>' +
        '<span class="brand-content-type-output">' + escapeHtml(item.outputs) + '</span>' +
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
    var assetProjectFilterButtons = [
      '<button type="button" class="brand-asset-filter ' + (assetProjectFilter === 'all' ? 'is-active' : '') + '" data-action="brand-filter-assets-project" data-asset-project-filter="all"><span>전체 에피소드</span><strong>' + escapeHtml(projectRows.length) + '</strong></button>'
    ].concat(projectRows.map(function (item) {
      var itemId = String(item.id || '').trim();
      var count = assetItems.filter(function (row) { return String(row.projectId || '').trim() === itemId; }).length;
      return (
        '<button type="button" class="brand-asset-filter ' + (assetProjectFilter === itemId ? 'is-active' : '') + '" data-action="brand-filter-assets-project" data-asset-project-filter="' + escapeHtml(itemId) + '">' +
        '<span>' + escapeHtml(projectTitleMap[itemId] || itemId) + '</span>' +
        '<strong>' + escapeHtml(count) + '</strong>' +
        '</button>'
      );
    })).join('');
    var selectedAssetSummary = selectedAssetItems.length
      ? selectedAssetItems.map(function (item) { return assetTypeLabel(item.type) + ' ' + (item.title || '자산'); }).slice(0, 3).join(' · ')
      : '아직 선택된 브랜드 자산이 없습니다.';
    var assetCards = filteredAssetItems.length
      ? filteredAssetItems.map(function (item) {
        var itemId = String(item.id || '').trim();
        var isSelected = selectedAssetIds.indexOf(itemId) >= 0;
        var projectTitle = projectTitleMap[String(item.projectId || '').trim()] || String(item.projectId || '프로젝트').trim();
        return (
          '<article class="brand-asset-card ' + (isSelected ? 'is-selected' : '') + '">' +
          '<div class="brand-asset-card-top">' +
          '<span class="brand-channel-badge">' + escapeHtml(assetTypeLabel(item.type)) + '</span>' +
          '<span class="brand-content-type-state">' + escapeHtml(projectTitle) + '</span>' +
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
      : '<div class="brand-asset-empty">현재 필터에 맞는 브랜드 자산이 없습니다.</div>';
    var channelCards = channelRows.map(function (item) {
      var current = channelConnections.find(function (row) { return row.channelType === item.id; }) || null;
      var connected = !!current;
      return (
        '<article class="brand-channel-card ' + (connected ? 'is-connected' : '') + '">' +
        '<div class="brand-channel-card-top">' +
        '<div>' +
        '<span class="brand-channel-badge">' + (connected ? '연결됨' : '미연결') + '</span>' +
        '<h4>' + escapeHtml(item.title) + '</h4>' +
        '</div>' +
        '<span class="brand-channel-formats">' + escapeHtml(item.formats) + '</span>' +
        '</div>' +
        '<p>' + escapeHtml(item.desc) + '</p>' +
        '<input class="brand-channel-input" id="brand-channel-input-' + escapeHtml(item.id) + '" data-channel-type="' + escapeHtml(item.id) + '" placeholder="@account 또는 채널명" value="' + escapeHtml(current ? current.accountName : '') + '" />' +
        '<div class="brand-channel-actions">' +
        '<button class="btn-secondary compact" data-action="brand-toggle-channel" data-channel-type="' + escapeHtml(item.id) + '">' + (connected ? '연결 해제' : '채널 연결') + '</button>' +
        '</div>' +
        '</article>'
      );
    }).join('');
    var publishChannelOptions = channelConnections.map(function (item) {
      var checked = publishPlan.channels.indexOf(item.channelType) >= 0;
      var title = channelTitleMap[item.channelType] || item.channelType;
      return (
        '<label class="brand-publish-channel-option">' +
        '<input type="checkbox" data-publish-channel="' + escapeHtml(item.channelType) + '" ' + (checked ? 'checked' : '') + ' />' +
        '<span>' + escapeHtml(title) + ' · ' + escapeHtml(item.accountName || '계정명 없음') + '</span>' +
        '</label>'
      );
    }).join('');
    var publishResultCards = publishResults.length
      ? publishResults.map(function (item) {
        var channelTitle = channelTitleMap[item.channelType] || item.channelType || '채널 미지정';
        return (
          '<article class="brand-publish-result-card">' +
          '<div class="brand-publish-result-top">' +
          '<span class="brand-channel-badge">' + escapeHtml(channelTitle) + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="brand-remove-publish-result" data-publish-result-id="' + escapeHtml(item.id) + '">삭제</button>' +
          '</div>' +
          '<strong>' + escapeHtml(item.title || item.remotePostId || '게시 결과') + '</strong>' +
          '<p>' + escapeHtml([
            item.status,
            item.publishedAt,
            item.remotePostId ? ('ID ' + item.remotePostId) : '',
            item.note
          ].filter(Boolean).join(' · ') || '세부 정보 없음') + '</p>' +
          '<div class="brand-publish-result-metrics">' +
          '<span>조회 ' + escapeHtml(item.metrics.views) + '</span>' +
          '<span>좋아요 ' + escapeHtml(item.metrics.likes) + '</span>' +
          '<span>댓글 ' + escapeHtml(item.metrics.comments) + '</span>' +
          '<span>공유 ' + escapeHtml(item.metrics.shares) + '</span>' +
          '<span>클릭 ' + escapeHtml(item.metrics.clicks) + '</span>' +
          '</div>' +
          '</article>'
        );
      }).join('')
      : '<div class="brand-publish-empty">아직 저장된 게시 결과가 없습니다.</div>';

    var captionValue = savedCaption || '';
    var brandContextSummary = [
      { label: '운영 브랜드', value: brandView.title || '-' },
      { label: '현재 기준 에피소드', value: currentEpisodeTitle },
      { label: '선택 자산', value: selectedAssetItems.length ? (selectedAssetItems.length + '개') : '미선택' },
      { label: '게시 데이터', value: publishResults.length ? (publishResults.length + '건 누적') : '아직 없음' }
    ].map(function (item) {
      return (
        '<div class="brand-studio-context-item">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '</div>'
      );
    }).join('');
    var knowledgeCards = [
      { label: '브랜드 보이스', value: compactSentence(knowledge.brandVoice || '아직 설정되지 않았습니다.', 72) },
      { label: '운영 규칙', value: summarizeList(knowledge.brandRules, '규칙 없음', 54) },
      { label: '금지 표현', value: summarizeList(knowledge.bannedExpressions, '금지 표현 없음', 48) },
      { label: '참조/성공 패턴', value: summarizeList(knowledge.referenceContents.length ? knowledge.referenceContents : knowledge.successCases, '참조 데이터 없음', 54) }
    ].map(function (item) {
      return (
        '<article class="brand-knowledge-card">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '</article>'
      );
    }).join('');

    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="brand-studio-hero">' +
      '<div>' +
      '<p class="brand-studio-eyebrow">Brand Operations</p>' +
      '<h2>' + escapeHtml(brandView.title || project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="brand-studio-description">' + escapeHtml(brandView.summary || payload.brandSummary || '브랜드 요약을 먼저 입력하면 Brand Studio 품질이 올라갑니다.') + '</p>' +
      '</div>' +
      '<div class="brand-studio-hero-actions">' +
      '<button class="btn-secondary" data-action="brand-open-analytics">Analytics</button>' +
      '<button class="btn-secondary" data-action="brand-open-knowledge">Knowledge Hub</button>' +
      '<button class="btn-secondary" data-action="brand-open-library">Content Library</button>' +
      '</div>' +
      '</div>' +
      '<div class="brand-studio-context-bar">' + brandContextSummary + '</div>' +
      '<div class="brand-studio-workspace">' +
      '<div class="brand-studio-main">' +
      (autoSuggestion
        ? '<section class="brand-studio-panel brand-auto-suggestion-panel">' +
          '<div class="brand-studio-panel-head"><h3>적용된 자동 제안</h3><span>Analytics에서 가져온 초안</span></div>' +
          '<div class="brand-auto-suggestion-card">' +
          '<strong>' + escapeHtml(autoSuggestion.title || '자동 제안') + '</strong>' +
          '<p>' + escapeHtml(autoSuggestion.reason || '추천 근거 없음') + '</p>' +
          '<div class="brand-auto-suggestion-meta">' +
          '<span>채널: ' + escapeHtml(autoSuggestion.targetChannel || '-') + '</span>' +
          '<span>추천 시간: ' + escapeHtml(autoSuggestion.recommendedTime || '-') + '</span>' +
          '</div>' +
          '</div>' +
          '</section>'
        : '') +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>Knowledge 스냅샷</h3><span>지금 필요한 규칙만 짧게 확인</span></div>' +
      '<div class="brand-knowledge-grid">' + knowledgeCards + '</div>' +
      '<p class="brand-caption-help">브랜드 보이스와 금지 표현은 캡션/해시태그 생성에 바로 반영됩니다. 상세 수정은 Knowledge Hub에서 관리합니다.</p>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>브랜드 자산 선택</h3><span>긴 목록은 내부 스크롤로 제한하고, 필요한 자산만 고릅니다</span></div>' +
      '<div class="brand-asset-filter-row">' + assetTypeFilterButtons + '</div>' +
      '<div class="brand-asset-filter-row">' + assetProjectFilterButtons + '</div>' +
      '<div class="brand-asset-selection-summary">' +
      '<div>' +
      '<span class="brand-studio-selection-label">현재 선택 자산</span>' +
      '<strong>' + escapeHtml(selectedAssetItems.length ? (selectedAssetItems.length + '개') : '미선택') + '</strong>' +
      '<p>' + escapeHtml(selectedAssetSummary) + '</p>' +
      '</div>' +
      '<div class="brand-studio-selection-actions">' +
      '<span class="brand-content-type-state">소스 자산: 씬 ' + escapeHtml(summary.scenes) + ' · 이미지 ' + escapeHtml(summary.images) + ' · 영상 ' + escapeHtml(summary.videos) + '</span>' +
      '<button class="btn-secondary compact" data-action="brand-clear-assets" ' + (selectedAssetItems.length ? '' : 'disabled') + '>선택 비우기</button>' +
      '</div>' +
      '</div>' +
      '<div class="brand-asset-grid brand-asset-grid-scrollable">' + assetCards + '</div>' +
      '<p class="brand-caption-help">선택한 자산이 있으면 캡션과 해시태그 생성에 우선 반영합니다. 선택하지 않으면 브랜드 전체 텍스트 자산을 참고합니다.</p>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>SNS 콘텐츠 유형</h3><span>운영 포맷을 먼저 정하면 다음 입력이 단순해집니다</span></div>' +
      '<div class="brand-content-type-grid">' + contentTypeCards + '</div>' +
      '<div class="brand-studio-selection-summary">' +
      '<div>' +
      '<span class="brand-studio-selection-label">현재 선택</span>' +
      '<strong>' + escapeHtml(selectedOption ? selectedOption.title : '아직 선택되지 않음') + '</strong>' +
      '<p>' + escapeHtml(selectedOption ? selectedOption.outputs : '먼저 콘텐츠 유형을 선택하면 오른쪽 발행 초안 패널이 이 기준으로 이어집니다.') + '</p>' +
      '</div>' +
      '<div class="brand-studio-selection-actions">' +
      '<button class="btn-primary compact" data-action="brand-select-next" ' + (selectedOption ? '' : 'disabled') + '>발행 초안으로 이동</button>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '<div class="brand-studio-side">' +
      '<section class="brand-studio-panel brand-studio-composer-panel" id="brand-publish-composer">' +
      '<div class="brand-studio-panel-head"><h3>발행 초안</h3><span>캡션과 해시태그를 한 곳에서 정리</span></div>' +
      '<div class="brand-studio-context-bar brand-studio-context-bar-compact">' +
      '<div class="brand-studio-context-item"><span>콘텐츠 유형</span><strong>' + escapeHtml(selectedOption ? selectedOption.title : '미선택') + '</strong></div>' +
      '<div class="brand-studio-context-item"><span>다음 단계</span><strong>' + escapeHtml(summary.nextAction || '준비 중') + '</strong></div>' +
      '</div>' +
      '<div class="brand-caption-generator">' +
      '<div class="brand-caption-meta">' +
      '<div><span class="brand-caption-meta-label">참조 소스</span><strong>' + escapeHtml(selectedAssetItems.length ? ('선택 자산 ' + selectedAssetItems.length + '개') : (sourceTexts.length ? ('브랜드 텍스트 소스 ' + sourceTexts.length + '개') : '아직 없음')) + '</strong></div>' +
      '<div><span class="brand-caption-meta-label">핵심 메시지</span><strong>' + escapeHtml(brandView.coreMessage || payload.coreMessage || '아직 없음') + '</strong></div>' +
      '</div>' +
      '<textarea id="brand-caption-textarea" class="brand-caption-textarea" placeholder="캡션이 여기에 생성됩니다.">' + escapeHtml(captionValue) + '</textarea>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-secondary" data-action="brand-generate-caption" ' + (selectedOption ? '' : 'disabled') + '>자동 생성</button>' +
      '<button class="btn-secondary" data-action="brand-regenerate-caption" ' + (selectedOption ? '' : 'disabled') + '>다시 생성</button>' +
      '<button class="btn-primary" data-action="brand-save-caption" ' + (selectedOption ? '' : 'disabled') + '>캡션 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="brand-hashtag-generator">' +
      '<div class="brand-hashtag-meta">' +
      '<div><span class="brand-caption-meta-label">브랜드 키워드</span><strong>' + escapeHtml(brandView.brandKeywords.length ? brandView.brandKeywords.join(', ') : '아직 없음') + '</strong></div>' +
      '<div><span class="brand-caption-meta-label">타깃</span><strong>' + escapeHtml(brandView.targetAudience || payload.targetAudience || payload.target || '아직 없음') + '</strong></div>' +
      '</div>' +
      '<textarea id="brand-hashtag-textarea" class="brand-caption-textarea brand-hashtag-textarea" placeholder="#해시태그 형식으로 생성됩니다.">' + escapeHtml(savedHashtags || '') + '</textarea>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-secondary" data-action="brand-generate-hashtags" ' + (selectedOption ? '' : 'disabled') + '>자동 생성</button>' +
      '<button class="btn-secondary" data-action="brand-regenerate-hashtags" ' + (selectedOption ? '' : 'disabled') + '>다시 생성</button>' +
      '<button class="btn-primary" data-action="brand-save-hashtags" ' + (selectedOption ? '' : 'disabled') + '>해시태그 저장</button>' +
      '</div>' +
      '</div>' +
      '<p class="brand-caption-help">채널 연결, 예약, 게시 결과는 아래 접힘 섹션에서 관리합니다. 기본 화면은 초안 작성에 집중합니다.</p>' +
      '</section>' +
      '<details class="brand-studio-disclosure" ' + (!channelConnections.length || publishPlan.scheduledAt ? 'open' : '') + '>' +
      '<summary><div><strong>채널 연결과 예약</strong><span>브랜드 공용 채널과 예약 게시 설정</span></div><span class="brand-studio-disclosure-meta">' + escapeHtml(channelConnections.length ? (channelConnections.length + '개 채널') : '미연결') + '</span></summary>' +
      '<div class="brand-studio-disclosure-body">' +
      '<section class="brand-studio-panel brand-studio-panel-embedded">' +
      '<div class="brand-channel-summary">' +
      '<span class="brand-channel-summary-label">현재 연결</span>' +
      '<strong>' + escapeHtml(channelConnections.length) + '개 채널</strong>' +
      '<p>' + escapeHtml(channelConnections.length ? channelConnections.map(function (item) { return channelTitleMap[item.channelType] || item.channelType; }).join(', ') : '아직 연결된 브랜드 공용 채널이 없습니다.') + '</p>' +
      '</div>' +
      '<div class="brand-channel-grid">' + channelCards + '</div>' +
      '<div class="brand-publish-planner">' +
      '<div class="brand-publish-summary">' +
      '<span class="brand-channel-summary-label">현재 계획</span>' +
      '<strong>' + escapeHtml(publishPlan.scheduledAt ? publishPlan.scheduledAt : '아직 저장된 예약 없음') + '</strong>' +
      '<p>' + escapeHtml(publishPlan.channels.length ? publishPlan.channels.map(function (item) { return channelTitleMap[item] || item; }).join(', ') : '채널을 선택하고 예약 시각을 저장하면 현재 연결 에피소드를 기준으로 브랜드 운영 계획을 남깁니다.') + '</p>' +
      '</div>' +
      '<div class="brand-publish-fields">' +
      '<div class="brand-publish-field">' +
      '<span class="brand-caption-meta-label">예약 채널</span>' +
      '<div class="brand-publish-channel-list">' + (publishChannelOptions || '<div class="brand-publish-empty">먼저 채널을 연결해 주세요.</div>') + '</div>' +
      '</div>' +
      '<div class="brand-publish-field">' +
      '<span class="brand-caption-meta-label">예약 시각</span>' +
      '<input id="brand-publish-datetime" class="brand-publish-input" type="datetime-local" value="' + escapeHtml(publishPlan.scheduledAt || '') + '" />' +
      '</div>' +
      '</div>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-primary" data-action="brand-save-publish-plan" ' + (channelConnections.length && selectedOption ? '' : 'disabled') + '>예약 계획 저장</button>' +
      '<button class="btn-secondary" data-action="brand-clear-publish-plan" ' + (publishPlan.scheduledAt || publishPlan.channels.length ? '' : 'disabled') + '>예약 계획 비우기</button>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="brand-studio-disclosure" ' + (publishResults.length ? 'open' : '') + '>' +
      '<summary><div><strong>게시 결과 관리</strong><span>분석에 들어갈 실제 운영 데이터를 기록</span></div><span class="brand-studio-disclosure-meta">' + escapeHtml(publishResults.length ? (publishResults.length + '건 누적') : '아직 없음') + '</span></summary>' +
      '<div class="brand-studio-disclosure-body">' +
      '<section class="brand-studio-panel brand-studio-panel-embedded">' +
      '<div class="brand-publish-summary">' +
      '<span class="brand-channel-summary-label">현재 누적</span>' +
      '<strong>' + escapeHtml(publishResults.length) + '개 게시 결과</strong>' +
      '<p>' + escapeHtml(publishResults.length ? '채널별 게시 결과와 반응 수치를 브랜드 분석 데이터에 누적하고 있습니다.' : '채널별 결과를 입력하면 이후 브랜드 성과 분석의 기초 데이터가 됩니다.') + '</p>' +
      '</div>' +
      '<div class="brand-publish-result-form">' +
      '<select id="brand-result-channel" class="brand-publish-input">' +
      '<option value="">채널 선택</option>' +
      channelConnections.map(function (item) {
        return '<option value="' + escapeHtml(item.channelType) + '">' + escapeHtml(channelTitleMap[item.channelType] || item.channelType) + '</option>';
      }).join('') +
      '</select>' +
      '<input id="brand-result-title" class="brand-publish-input" placeholder="게시 제목 또는 콘텐츠명" value="' + escapeHtml(selectedOption ? selectedOption.title : '') + '" />' +
      '<input id="brand-result-remote-id" class="brand-publish-input" placeholder="게시물 ID 또는 링크 식별자" />' +
      '<input id="brand-result-published-at" class="brand-publish-input" type="datetime-local" value="' + escapeHtml(publishPlan.scheduledAt || '') + '" />' +
      '<select id="brand-result-status" class="brand-publish-input">' +
      '<option value="published">게시 완료</option>' +
      '<option value="scheduled">예약됨</option>' +
      '<option value="failed">실패</option>' +
      '</select>' +
      '<textarea id="brand-result-note" class="brand-caption-textarea brand-publish-note" placeholder="게시 결과 메모를 남겨 주세요."></textarea>' +
      '<div class="brand-publish-metric-grid">' +
      '<input id="brand-result-views" class="brand-publish-input" type="number" min="0" placeholder="조회수" />' +
      '<input id="brand-result-likes" class="brand-publish-input" type="number" min="0" placeholder="좋아요" />' +
      '<input id="brand-result-comments" class="brand-publish-input" type="number" min="0" placeholder="댓글" />' +
      '<input id="brand-result-shares" class="brand-publish-input" type="number" min="0" placeholder="공유" />' +
      '<input id="brand-result-clicks" class="brand-publish-input" type="number" min="0" placeholder="클릭" />' +
      '</div>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-primary" data-action="brand-save-publish-result" ' + (channelConnections.length ? '' : 'disabled') + '>게시 결과 저장</button>' +
      '</div>' +
      '<div class="brand-publish-result-grid">' + publishResultCards + '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      var captionEl = root.querySelector('#brand-caption-textarea');
      var hashtagEl = root.querySelector('#brand-hashtag-textarea');
      var publishInputEl = root.querySelector('#brand-publish-datetime');
      var resultChannelEl = root.querySelector('#brand-result-channel');
      var resultTitleEl = root.querySelector('#brand-result-title');
      var resultRemoteIdEl = root.querySelector('#brand-result-remote-id');
      var resultPublishedAtEl = root.querySelector('#brand-result-published-at');
      var resultStatusEl = root.querySelector('#brand-result-status');
      var resultNoteEl = root.querySelector('#brand-result-note');
      var resultViewsEl = root.querySelector('#brand-result-views');
      var resultLikesEl = root.querySelector('#brand-result-likes');
      var resultCommentsEl = root.querySelector('#brand-result-comments');
      var resultSharesEl = root.querySelector('#brand-result-shares');
      var resultClicksEl = root.querySelector('#brand-result-clicks');
      if (action === 'brand-select-content-type') {
        var typeId = String(btn.dataset.contentType || '').trim();
        if (!typeId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioContentType: typeId })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('콘텐츠 유형 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-filter-assets-type') {
        var nextTypeFilter = String(btn.dataset.assetTypeFilter || 'all').trim() || 'all';
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioAssetTypeFilter: nextTypeFilter })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('자산 유형 필터 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-filter-assets-project') {
        var nextProjectFilter = String(btn.dataset.assetProjectFilter || 'all').trim() || 'all';
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioAssetProjectFilter: nextProjectFilter })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('에피소드 필터 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-toggle-asset') {
        var assetId = String(btn.dataset.assetId || '').trim();
        if (!assetId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextAssetIds = selectedAssetIds.slice();
        var selectedIdx = nextAssetIds.indexOf(assetId);
        if (selectedIdx >= 0) nextAssetIds.splice(selectedIdx, 1);
        else nextAssetIds.push(assetId);
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: nextAssetIds })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('브랜드 자산 선택 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-clear-assets') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioSelectedAssetIds: [] })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('선택 자산 초기화 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-generate-caption' || action === 'brand-regenerate-caption') {
        if (!selectedOption || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextCaption = buildCaptionDraft(project, brandView, selectedOption, sourceTexts, knowledge);
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioCaptionDraft: nextCaption })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('캡션 생성 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-save-caption') {
        if (!selectedOption || !captionEl || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextText = String(captionEl.value || '').trim();
        if (!nextText) {
          alert('저장할 캡션을 입력해 주세요.');
          captionEl.focus();
          return;
        }
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioCaptionDraft: nextText })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('캡션을 저장했습니다.');
          })
          .catch(function (err) {
            alert('캡션 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-generate-hashtags' || action === 'brand-regenerate-hashtags') {
        if (!selectedOption || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        Promise.resolve()
          .then(function () {
            if (!NK.api || !NK.api.generateHashtags) {
              return {
                text: buildHashtagDraft(project, brandView, selectedOption, sourceTexts, knowledge),
                fallback: true
              };
            }
            return NK.api.generateHashtags(buildHashtagRequestPayload(project, brandView, selectedOption, sourceTexts, knowledge))
              .catch(function () {
                return {
                  text: buildHashtagDraft(project, brandView, selectedOption, sourceTexts, knowledge),
                  fallback: true
                };
              });
          })
          .then(function (generated) {
            var nextTags = String(generated && (generated.text || (Array.isArray(generated.hashtags) ? generated.hashtags.join(' ') : '')) || '').trim();
            if (!nextTags) {
              nextTags = buildHashtagDraft(project, brandView, selectedOption, sourceTexts, knowledge);
            }
            return NK.service.project.updatePayload(projectId, { brandStudioHashtagDraft: nextTags });
          })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('해시태그 생성 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-save-hashtags') {
        if (!selectedOption || !hashtagEl || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextTagsText = String(hashtagEl.value || '').trim();
        if (!nextTagsText) {
          alert('저장할 해시태그를 입력해 주세요.');
          hashtagEl.focus();
          return;
        }
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioHashtagDraft: nextTagsText })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('해시태그를 저장했습니다.');
          })
          .catch(function (err) {
            alert('해시태그 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-toggle-channel') {
        var channelType = String(btn.dataset.channelType || '').trim();
        var inputEl = root.querySelector('#brand-channel-input-' + channelType);
        if (!channelType || !inputEl || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var accountName = String(inputEl.value || '').trim();
        var nextConnections = channelConnections.slice();
        var existingIdx = nextConnections.findIndex(function (row) { return row.channelType === channelType; });
        if (existingIdx >= 0) {
          nextConnections.splice(existingIdx, 1);
        } else {
          if (!accountName) {
            alert('채널 계정 이름을 입력해 주세요.');
            inputEl.focus();
            return;
          }
          nextConnections.push({
            channelType: channelType,
            accountName: accountName,
            status: 'connected'
          });
        }
        btn.disabled = true;
        syncBrandAndProject({
          connectedChannels: nextConnections
        }, {
          brandStudioChannels: nextConnections,
          connectedChannels: nextConnections.map(function (row) { return row.channelType; })
        })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('채널 연결 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-select-next') {
        if (!selectedOption) {
          alert('먼저 콘텐츠 유형을 선택해 주세요.');
          return;
        }
        var composerEl = root.querySelector('#brand-publish-composer');
        if (composerEl && composerEl.scrollIntoView) composerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (captionEl) captionEl.focus();
        return;
      }
      if (action === 'brand-save-publish-plan') {
        if (!selectedOption || !channelConnections.length || !publishInputEl || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var scheduledAt = String(publishInputEl.value || '').trim();
        var selectedChannels = Array.from(root.querySelectorAll('[data-publish-channel]:checked'))
          .map(function (input) { return String(input.getAttribute('data-publish-channel') || '').trim(); })
          .filter(Boolean);
        if (!selectedChannels.length) {
          alert('예약할 채널을 선택해 주세요.');
          return;
        }
        if (!scheduledAt) {
          alert('예약 시각을 입력해 주세요.');
          publishInputEl.focus();
          return;
        }
        btn.disabled = true;
        var nextPlan = {
          channels: selectedChannels,
          scheduledAt: scheduledAt,
          status: 'scheduled',
          contentType: selectedType,
          captionDraft: readCaptionDraft(payload),
          hashtagDraft: readHashtagDraft(payload)
        };
        syncBrandAndProject({
          brandStudioPublishPlan: nextPlan
        }, {
          brandStudioPublishPlan: nextPlan
        })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('예약 게시 계획을 저장했습니다.');
          })
          .catch(function (err) {
            alert('예약 계획 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-clear-publish-plan') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        syncBrandAndProject({
          brandStudioPublishPlan: null
        }, {
          brandStudioPublishPlan: null
        })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('예약 계획 삭제 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-save-publish-result') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload || !resultChannelEl) return;
        var nextChannel = String(resultChannelEl.value || '').trim();
        var nextTitle = String((resultTitleEl && resultTitleEl.value) || '').trim();
        var nextRemoteId = String((resultRemoteIdEl && resultRemoteIdEl.value) || '').trim();
        var nextPublishedAt = String((resultPublishedAtEl && resultPublishedAtEl.value) || '').trim();
        if (!nextChannel) {
          alert('결과를 저장할 채널을 선택해 주세요.');
          resultChannelEl.focus();
          return;
        }
        if (!nextTitle && !nextRemoteId) {
          alert('게시 제목 또는 게시물 ID 중 하나는 입력해 주세요.');
          if (resultTitleEl) resultTitleEl.focus();
          return;
        }
        var nextResult = {
          id: 'publish_' + Date.now(),
          channelType: nextChannel,
          contentType: selectedType || (publishPlan.contentType || ''),
          status: String((resultStatusEl && resultStatusEl.value) || 'published').trim() || 'published',
          publishedAt: nextPublishedAt,
          remotePostId: nextRemoteId,
          title: nextTitle,
          projectId: projectId,
          projectTitle: String(project.title || project.seriesTitle || projectId).trim(),
          seasonId: String(payload.seasonId || '').trim(),
          seasonLabel: String(payload.seasonLabel || payload.seasonTitle || '').trim(),
          campaignId: String(payload.campaignId || '').trim(),
          campaignTitle: String(payload.campaignTitle || payload.campaignLabel || '').trim(),
          purposeCategory: String(payload.purposeCategory || '').trim(),
          purposeTags: Array.isArray(payload.purposeTags) ? payload.purposeTags.slice() : [],
          note: String((resultNoteEl && resultNoteEl.value) || '').trim(),
          caption: String((captionEl && captionEl.value) || readCaptionDraft(payload) || '').trim(),
          hashtags: parseHashtagTokens((hashtagEl && hashtagEl.value) || readHashtagDraft(payload) || ''),
          metrics: {
            views: Math.max(0, Number((resultViewsEl && resultViewsEl.value) || 0) || 0),
            likes: Math.max(0, Number((resultLikesEl && resultLikesEl.value) || 0) || 0),
            comments: Math.max(0, Number((resultCommentsEl && resultCommentsEl.value) || 0) || 0),
            shares: Math.max(0, Number((resultSharesEl && resultSharesEl.value) || 0) || 0),
            clicks: Math.max(0, Number((resultClicksEl && resultClicksEl.value) || 0) || 0)
          }
        };
        var nextResults = publishResults.concat([nextResult]);
        var nextSnapshots = nextResults.map(function (item) {
          return {
            id: item.id,
            channelType: item.channelType,
            contentType: item.contentType,
            capturedAt: item.publishedAt,
            remotePostId: item.remotePostId,
            metrics: Object.assign({}, item.metrics)
          };
        });
        btn.disabled = true;
        syncBrandAndProject({
          brandStudioPublishResults: nextResults
        }, {
          brandStudioPublishResults: nextResults,
          publishResults: nextResults,
          analyticsSnapshots: nextSnapshots
        })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('게시 결과를 저장했습니다.');
          })
          .catch(function (err) {
            alert('게시 결과 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-remove-publish-result') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var removeId = String(btn.dataset.publishResultId || '').trim();
        var remainingResults = publishResults.filter(function (item) { return String(item.id) !== removeId; });
        var remainingSnapshots = remainingResults.map(function (item) {
          return {
            id: item.id,
            channelType: item.channelType,
            contentType: item.contentType,
            capturedAt: item.publishedAt,
            remotePostId: item.remotePostId,
            metrics: Object.assign({}, item.metrics)
          };
        });
        btn.disabled = true;
        syncBrandAndProject({
          brandStudioPublishResults: remainingResults
        }, {
          brandStudioPublishResults: remainingResults,
          publishResults: remainingResults,
          analyticsSnapshots: remainingSnapshots
        })
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('게시 결과 삭제 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
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
    renderProject(root, project, brand);
  };
})();
