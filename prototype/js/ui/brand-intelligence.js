; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var intelligence = ui.brandIntelligence || (ui.brandIntelligence = {});

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

  function channelLabel(type) {
    switch (String(type || '').trim()) {
      case 'youtube': return 'YouTube';
      case 'instagram': return 'Instagram';
      case 'tiktok': return 'TikTok';
      case 'x': return 'X';
      default: return String(type || 'Unknown');
    }
  }

  function contentTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'sns-post': return 'SNS 게시물';
      case 'shorts-promo': return '쇼츠 홍보';
      case 'promo-image': return '홍보 이미지';
      case 'blog-post': return '블로그 글';
      case 'unknown': return '미분류';
      default: return String(type || 'Unknown');
    }
  }

  function recommendationCardHtml(item) {
    return (
      '<article class="analytics-recommendation-card">' +
      '<span class="analytics-channel-badge">' + escapeHtml(item.category || '추천') + '</span>' +
      '<h4>' + escapeHtml(item.title || '전략 추천') + '</h4>' +
      '<p>' + escapeHtml(item.reason || '') + '</p>' +
      '<strong>' + escapeHtml(item.action || '') + '</strong>' +
      '</article>'
    );
  }

  function suggestionCardHtml(item) {
    return (
      '<article class="analytics-suggestion-card">' +
      '<span class="analytics-channel-badge">' + escapeHtml(item.targetChannel ? channelLabel(item.targetChannel) : '자동 제안') + '</span>' +
      '<h4>' + escapeHtml(item.title || '콘텐츠 제안') + '</h4>' +
      '<p>' + escapeHtml(item.summary || '') + '</p>' +
      '<strong>' + escapeHtml(item.reason || '') + '</strong>' +
      '<div class="analytics-suggestion-meta">' +
      '<span>유형: ' + escapeHtml(contentTypeLabel(item.contentType || 'sns-post')) + '</span>' +
      '<span>추천 시간: ' + escapeHtml(item.recommendedTime || '-') + '</span>' +
      '</div>' +
      '<button type="button" class="btn-primary compact" data-action="analytics-apply-suggestion" data-suggestion-id="' + escapeHtml(item.id || '') + '">Brand Studio에 적용</button>' +
      '</article>'
    );
  }

  function metricCardHtml(item) {
    return (
      '<div class="analytics-channel-metrics">' +
      '<span>조회수</span><strong>' + escapeHtml(item.views) + '</strong>' +
      '<span>좋아요</span><strong>' + escapeHtml(item.likes) + '</strong>' +
      '<span>댓글</span><strong>' + escapeHtml(item.comments) + '</strong>' +
      '<span>공유</span><strong>' + escapeHtml(item.shares) + '</strong>' +
      '<span>클릭</span><strong>' + escapeHtml(item.clicks) + '</strong>' +
      '</div>'
    );
  }

  function normalizeFilters(filters) {
    var src = filters && typeof filters === 'object' ? filters : {};
    return {
      episodeId: String(src.episodeId || '').trim(),
      channelType: String(src.channelType || '').trim(),
      contentType: String(src.contentType || '').trim(),
      seasonId: String(src.seasonId || '').trim(),
      campaignId: String(src.campaignId || '').trim(),
      purposeKey: String(src.purposeKey || '').trim()
    };
  }

  function normalizeAnalyticsView(view) {
    switch (String(view || '').trim()) {
      case 'channel':
      case 'episode':
      case 'content':
      case 'time':
      case 'hashtag':
        return String(view).trim();
      default:
        return 'overview';
    }
  }

  function normalizeViewState(state) {
    var src = state && typeof state === 'object' ? state : {};
    var hasNestedState = Object.prototype.hasOwnProperty.call(src, 'filters') || Object.prototype.hasOwnProperty.call(src, 'activeView');
    return {
      filters: normalizeFilters(hasNestedState ? src.filters : src),
      activeView: normalizeAnalyticsView(hasNestedState ? src.activeView : 'overview')
    };
  }

  function selectHtml(key, options, currentValue, title, formatter) {
    var rows = Array.isArray(options) ? options : [];
    var current = String(currentValue || '').trim();
    var toLabel = typeof formatter === 'function' ? formatter : function (item) { return item.label || item.value || ''; };
    return (
      '<label class="analytics-filter-field">' +
      '<span>' + escapeHtml(title) + '</span>' +
      '<select class="analytics-filter-select" data-analytics-filter="' + escapeHtml(key) + '">' +
      '<option value="">전체</option>' +
      rows.map(function (item) {
        var value = String(item && item.value || '').trim();
        return '<option value="' + escapeHtml(value) + '" ' + (value === current ? 'selected' : '') + '>' + escapeHtml(toLabel(item)) + '</option>';
      }).join('') +
      '</select>' +
      '</label>'
    );
  }

  function episodeLabel(project) {
    return String(project && (project.title || project.payload && project.payload.episodeTitle || project.seriesTitle || project.id) || '').trim() || '미지정 에피소드';
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="analytics-page">' +
      '<div class="analytics-hero empty">' +
      '<h2>Brand Intelligence</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="analytics-hero-actions"><a class="btn-primary" href="dashboard.html">대시보드로 이동</a></div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
  }

  function renderProject(root, project, brand, state) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var brandId = String(brand && brand.brandId || payload.brandId || '').trim();
    var currentEpisodeTitle = episodeLabel(project);
    var analyticsTarget = brand || project;
    var currentState = normalizeViewState(state);
    var currentFilters = currentState.filters;
    var activeView = currentState.activeView;
    var filterOptions = NK.service.analytics.listFilterOptions
      ? NK.service.analytics.listFilterOptions(analyticsTarget)
      : { episodes: [], channels: [], contentTypes: [], seasons: [], campaigns: [], purposes: [] };
    var filteredRows = NK.service.analytics.filterPublishResults
      ? NK.service.analytics.filterPublishResults(analyticsTarget, currentFilters)
      : [];
    var summary = NK.service.analytics.summarizeProject(analyticsTarget, currentFilters);
    var channels = NK.service.analytics.summarizeByChannel(analyticsTarget, currentFilters);
    var episodes = NK.service.analytics.summarizeByEpisode
      ? NK.service.analytics.summarizeByEpisode(analyticsTarget, currentFilters)
      : [];
    var contentTypes = NK.service.analytics.summarizeByContentType(analyticsTarget, currentFilters);
    var uploadTimes = NK.service.analytics.summarizeByUploadTime(analyticsTarget, currentFilters);
    var hashtags = NK.service.analytics.summarizeByHashtag(analyticsTarget, currentFilters);
    var recommendations = NK.service.strategyEngine
      ? NK.service.strategyEngine.buildRecommendations(analyticsTarget)
      : [];
    var suggestions = NK.service.strategyEngine
      ? NK.service.strategyEngine.buildContentSuggestions(analyticsTarget)
      : [];
    var tabs = [
      { id: 'overview', title: '개요' },
      { id: 'channel', title: '채널' },
      { id: 'episode', title: '에피소드' },
      { id: 'content', title: '콘텐츠 유형' },
      { id: 'time', title: '업로드 시간' },
      { id: 'hashtag', title: '해시태그' }
    ];
    var tabsHtml = tabs.map(function (item) {
      return (
        '<button type="button" class="analytics-view-tab ' + (item.id === activeView ? 'is-active' : '') + '" data-action="analytics-change-view" data-analytics-view="' + escapeHtml(item.id) + '">' +
        escapeHtml(item.title) +
        '</button>'
      );
    }).join('');
    var activeTabTitle = (tabs.find(function (item) { return item.id === activeView; }) || tabs[0] || {}).title || '개요';
    var activeFilterCount = [
      currentFilters.episodeId,
      currentFilters.channelType,
      currentFilters.contentType,
      currentFilters.seasonId,
      currentFilters.campaignId,
      currentFilters.purposeKey
    ].filter(Boolean).length;
    var analyticsHeroPills = [
      { label: '현재 보기', value: activeTabTitle },
      { label: '활성 필터', value: activeFilterCount ? (activeFilterCount + '개 적용') : '필터 없음' },
      { label: '상위 채널', value: channelLabel(summary.topChannel || '-') },
      { label: '자동 제안', value: suggestions.length ? (suggestions.length + '개') : '아직 없음' }
    ].map(function (item) {
      return '<span class="studio-hero-pill"><em>' + escapeHtml(item.label) + '</em><strong>' + escapeHtml(item.value) + '</strong></span>';
    }).join('');
    var analyticsHeroStats = [
      {
        label: '누적 게시',
        value: String(summary.totalPosts) + '개',
        detail: summary.totalPosts ? '채널별 실운영 데이터가 분석에 반영되고 있습니다.' : 'Brand Studio에서 게시 결과를 먼저 쌓아 주세요.',
        accent: true
      },
      {
        label: '총 조회수',
        value: String(summary.views),
        detail: summary.totalPosts ? '좋아요 ' + String(summary.likes) + ' · 댓글 ' + String(summary.comments) : '조회수 데이터가 아직 없습니다.'
      },
      {
        label: '전략 추천',
        value: recommendations.length + '개',
        detail: recommendations.length ? '데이터를 바탕으로 바로 실행 가능한 운영 제안입니다.' : '추천을 만들 만큼의 데이터가 아직 부족합니다.'
      },
      {
        label: '상위 채널',
        value: channelLabel(summary.topChannel || '-'),
        detail: channels.length ? ('최근 성과가 가장 좋은 채널은 ' + channelLabel(channels[0].channelType || '-')) : '비교 가능한 채널 데이터가 없습니다.'
      }
    ].map(function (item) {
      return (
        '<article class="studio-kpi-card ' + (item.accent ? 'is-accent' : '') + '">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');
    var analyticsSummaryCards = [
      { label: '분석 브랜드', value: brand && brand.brandTitle || payload.brandTitle || '-', detail: '현재 브랜드 기준의 게시 결과를 집계합니다.' },
      { label: '현재 기준 에피소드', value: currentEpisodeTitle, detail: '필요하면 아래 필터에서 다른 에피소드나 시즌으로 좁힐 수 있습니다.' },
      { label: '누적 게시', value: String(summary.totalPosts) + '개', detail: summary.totalPosts ? '실제 성과 데이터가 누적되고 있습니다.' : '분석을 시작하려면 게시 결과 입력이 필요합니다.' },
      { label: '총 조회수', value: String(summary.views), detail: '조회수 기반으로 상위 채널과 시간대를 계산합니다.' },
      { label: '총 반응', value: String(summary.likes + summary.comments + summary.shares), detail: '좋아요, 댓글, 공유를 합산한 참여 반응입니다.' },
      { label: '상위 채널', value: channelLabel(summary.topChannel || '-'), detail: '가장 높은 조회수를 만든 채널입니다.' }
    ].map(function (item) {
      return (
        '<article class="analytics-summary-card">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');
    var overviewBlocks = [
      {
        title: '상위 채널',
        value: channelLabel(summary.topChannel || '-'),
        detail: summary.totalPosts ? ('누적 게시 ' + summary.totalPosts + '개') : '게시 결과를 더 모아 주세요.'
      },
      {
        title: '상위 에피소드',
        value: episodes.length ? String(episodes[0].projectTitle || '에피소드') : '아직 없음',
        detail: episodes.length ? ('게시 ' + episodes[0].totalPosts + '개 · 최근 ' + (episodes[0].latestPublishedAt || '-')) : '비교할 데이터가 없습니다.'
      },
      {
        title: '강한 업로드 시간',
        value: uploadTimes.length ? String(uploadTimes[0].label || '아직 없음') : '아직 없음',
        detail: uploadTimes.length ? ('게시 ' + uploadTimes[0].totalPosts + '개') : '업로드 시각 데이터가 없습니다.'
      }
    ].map(function (item) {
      return (
        '<article class="analytics-overview-card">' +
        '<span>' + escapeHtml(item.title) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');
    var activePanelHtml = '';
    if (activeView === 'channel') {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>채널별 성과</h3><span>채널 성과만 집중해서 비교</span></div>' +
        '<div class="analytics-channel-grid">' +
        (channels.length ? channels.map(function (item) {
          return (
            '<article class="analytics-channel-card">' +
            '<div class="analytics-channel-top">' +
            '<span class="analytics-channel-badge">' + escapeHtml(channelLabel(item.channelType)) + '</span>' +
            '<strong>' + escapeHtml(item.totalPosts) + '개 게시</strong>' +
            '</div>' +
            metricCardHtml(item) +
            '<div class="analytics-channel-metrics analytics-channel-meta">' +
            '<span>최근 게시</span><strong>' + escapeHtml(item.latestPublishedAt || '-') + '</strong>' +
            '</div>' +
            '</article>'
          );
        }).join('') : '<div class="analytics-empty">아직 게시 결과가 없습니다. Brand Studio에서 먼저 게시 결과를 기록해 주세요.</div>') +
        '</div>' +
        '</section>';
    } else if (activeView === 'episode') {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>에피소드별 성과</h3><span>브랜드 안에서 어떤 편이 잘 반응하는지 비교</span></div>' +
        '<div class="analytics-type-grid">' +
        (episodes.length ? episodes.map(function (item) {
          return (
            '<article class="analytics-type-card">' +
            '<div class="analytics-channel-top">' +
            '<span class="analytics-channel-badge">' + escapeHtml(item.projectTitle || '에피소드') + '</span>' +
            '<strong>' + escapeHtml(item.totalPosts) + '개 게시</strong>' +
            '</div>' +
            metricCardHtml(item) +
            '<div class="analytics-channel-metrics analytics-channel-meta">' +
            '<span>상위 채널</span><strong>' + escapeHtml(channelLabel(item.topChannel || '-')) + '</strong>' +
            '<span>최근 게시</span><strong>' + escapeHtml(item.latestPublishedAt || '-') + '</strong>' +
            '</div>' +
            '</article>'
          );
        }).join('') : '<div class="analytics-empty">아직 에피소드별로 비교할 게시 결과가 없습니다.</div>') +
        '</div>' +
        '</section>';
    } else if (activeView === 'content') {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>콘텐츠 유형별 성과</h3><span>어떤 포맷이 강한지 비교</span></div>' +
        '<div class="analytics-type-grid">' +
        (contentTypes.length ? contentTypes.map(function (item) {
          return (
            '<article class="analytics-type-card">' +
            '<div class="analytics-channel-top">' +
            '<span class="analytics-channel-badge">' + escapeHtml(contentTypeLabel(item.contentType)) + '</span>' +
            '<strong>' + escapeHtml(item.totalPosts) + '개 운영</strong>' +
            '</div>' +
            metricCardHtml(item) +
            '<div class="analytics-channel-metrics analytics-channel-meta">' +
            '<span>주요 채널</span><strong>' + escapeHtml(channelLabel(item.topChannel || '-')) + '</strong>' +
            '</div>' +
            '</article>'
          );
        }).join('') : '<div class="analytics-empty">아직 콘텐츠 유형별로 비교할 게시 결과가 없습니다.</div>') +
        '</div>' +
        '</section>';
    } else if (activeView === 'time') {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>업로드 시간별 성과</h3><span>언제 올릴 때 반응이 좋은지 비교</span></div>' +
        '<div class="analytics-type-grid">' +
        (uploadTimes.some(function (item) { return item.totalPosts > 0; }) ? uploadTimes.map(function (item) {
          return (
            '<article class="analytics-type-card">' +
            '<div class="analytics-channel-top">' +
            '<span class="analytics-channel-badge">' + escapeHtml(item.label) + '</span>' +
            '<strong>' + escapeHtml(item.totalPosts) + '개 게시</strong>' +
            '</div>' +
            metricCardHtml(item) +
            '</article>'
          );
        }).join('') : '<div class="analytics-empty">업로드 시각이 저장된 게시 결과가 아직 없습니다.</div>') +
        '</div>' +
        '</section>';
    } else if (activeView === 'hashtag') {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>해시태그 성과</h3><span>반응이 좋은 태그 패턴</span></div>' +
        '<div class="analytics-hashtag-grid">' +
        (hashtags.length ? hashtags.map(function (item) {
          return (
            '<article class="analytics-hashtag-card">' +
            '<div class="analytics-channel-top">' +
            '<span class="analytics-channel-badge">' + escapeHtml(item.hashtag) + '</span>' +
            '<strong>' + escapeHtml(item.totalPosts) + '회 사용</strong>' +
            '</div>' +
            metricCardHtml(item) +
            '</article>'
          );
        }).join('') : '<div class="analytics-empty">게시 결과에 저장된 해시태그가 아직 없습니다.</div>') +
        '</div>' +
        '</section>';
    } else {
      activePanelHtml =
        '<section class="analytics-panel">' +
        '<div class="analytics-panel-head"><h3>핵심 개요</h3><span>추천과 요약을 먼저 보고, 필요할 때 탭으로 drill-down</span></div>' +
        '<div class="analytics-overview-grid">' + overviewBlocks + '</div>' +
        '<div class="analytics-recommendation-grid">' +
        (recommendations.length
          ? recommendations.slice(0, 2).map(recommendationCardHtml).join('')
          : '<div class="analytics-empty">아직 추천을 만들 만큼의 데이터가 없습니다.</div>') +
        '</div>' +
        '<div class="analytics-suggestion-grid">' +
        (suggestions.length
          ? suggestions.slice(0, 2).map(suggestionCardHtml).join('')
          : '<div class="analytics-empty">자동 제안을 만들 만큼의 데이터가 없습니다.</div>') +
        '</div>' +
        '</section>';
    }

    root.dataset.analyticsView = activeView;
    root.innerHTML =
      '<section class="analytics-page">' +
      '<div class="analytics-hero">' +
      '<div class="studio-page-hero-main">' +
      '<p class="analytics-eyebrow">Brand Intelligence</p>' +
      '<h2>' + escapeHtml(brand && brand.brandTitle || payload.brandTitle || project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="analytics-description">' + escapeHtml(brand && brand.brandSummary || payload.brandSummary || '게시 결과를 수집하면 채널별 성과를 여기서 한눈에 확인할 수 있습니다.') + '</p>' +
      '<div class="studio-hero-pill-row">' + analyticsHeroPills + '</div>' +
      '<div class="analytics-hero-actions">' +
      '<button class="btn-secondary" data-action="analytics-open-brand">Brand Studio</button>' +
      '<button class="btn-secondary" data-action="analytics-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="analytics-open-knowledge">브랜드 허브</button>' +
      '</div>' +
      '</div>' +
      '<div class="studio-page-hero-side"><div class="studio-kpi-grid">' + analyticsHeroStats + '</div></div>' +
      '</div>' +
      '<div class="analytics-summary-grid">' + analyticsSummaryCards + '</div>' +
      '<section class="analytics-panel">' +
      '<div class="analytics-panel-head"><h3>분석 필터</h3><span>브랜드 전체에서 세부 활동으로 drill-down</span></div>' +
      '<div class="analytics-filter-grid">' +
      selectHtml('episodeId', filterOptions.episodes, currentFilters.episodeId, '에피소드') +
      selectHtml('channelType', filterOptions.channels, currentFilters.channelType, '채널', function (item) { return channelLabel(item.value || item.label); }) +
      selectHtml('contentType', filterOptions.contentTypes, currentFilters.contentType, '콘텐츠 유형', function (item) { return contentTypeLabel(item.value || item.label); }) +
      selectHtml('seasonId', filterOptions.seasons, currentFilters.seasonId, '시즌') +
      selectHtml('campaignId', filterOptions.campaigns, currentFilters.campaignId, '캠페인') +
      selectHtml('purposeKey', filterOptions.purposes, currentFilters.purposeKey, '운영 목적') +
      '</div>' +
      '<div class="analytics-filter-summary">' +
      '<span>현재 필터 결과</span><strong>' + escapeHtml(filteredRows.length) + '개 게시 결과</strong>' +
      '<button type="button" class="btn-secondary compact" data-action="analytics-clear-filters" ' + (
        currentFilters.episodeId || currentFilters.channelType || currentFilters.contentType || currentFilters.seasonId || currentFilters.campaignId || currentFilters.purposeKey ? '' : 'disabled'
      ) + '>필터 초기화</button>' +
      '</div>' +
      '</section>' +
      '<section class="analytics-panel">' +
      '<div class="analytics-panel-head"><h3>분석 보기</h3><span>기본은 개요, 세부 분석은 탭으로 전환</span></div>' +
      '<div class="analytics-view-tabs">' + tabsHtml + '</div>' +
      '</section>' +
      activePanelHtml +
      '</section>';
    applyCurrentLocale();

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      var viewToKeep = normalizeAnalyticsView(root.dataset.analyticsView || activeView);
      if (action === 'analytics-clear-filters') {
        renderProject(root, project, brand, { filters: {}, activeView: viewToKeep });
        return;
      }
      if (action === 'analytics-change-view') {
        renderProject(root, project, brand, { filters: currentFilters, activeView: String(btn.dataset.analyticsView || '').trim() });
        return;
      }
      if (action === 'analytics-apply-suggestion') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload || !NK.service.strategyEngine) return;
        var suggestionId = String(btn.dataset.suggestionId || '').trim();
        var suggestion = suggestions.find(function (item) { return String(item.id || '') === suggestionId; }) || null;
        if (!suggestion) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, {
          brandStudioContentType: suggestion.contentType || 'sns-post',
          brandStudioCaptionDraft: String(suggestion.captionDraft || '').trim(),
          brandStudioHashtagDraft: Array.isArray(suggestion.hashtags) ? suggestion.hashtags.join(' ') : '',
          brandStudioAutoSuggestion: {
            id: suggestion.id,
            title: suggestion.title,
            targetChannel: suggestion.targetChannel,
            recommendedTime: suggestion.recommendedTime,
            reason: suggestion.reason
          }
        })
          .then(function () {
            var url = buildStageUrl('brand.html', projectId, brandId);
            if (window.self !== window.top && window.parent) {
              window.parent.postMessage({ type: 'load-stage', url: url }, '*');
            } else {
              window.location.href = url;
            }
          })
          .catch(function (err) {
            alert('자동 제안 적용 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'analytics-open-brand') target = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'analytics-open-library') target = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'analytics-open-knowledge') target = buildStageUrl('knowledge.html', projectId, brandId);
      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };
    root.onchange = function (evt) {
      var select = evt.target && evt.target.matches ? evt.target : null;
      if (!select || !select.matches('[data-analytics-filter]')) return;
      renderProject(root, project, brand, {
        filters: {
          episodeId: String((root.querySelector('[data-analytics-filter="episodeId"]') || {}).value || '').trim(),
          channelType: String((root.querySelector('[data-analytics-filter="channelType"]') || {}).value || '').trim(),
          contentType: String((root.querySelector('[data-analytics-filter="contentType"]') || {}).value || '').trim(),
          seasonId: String((root.querySelector('[data-analytics-filter="seasonId"]') || {}).value || '').trim(),
          campaignId: String((root.querySelector('[data-analytics-filter="campaignId"]') || {}).value || '').trim(),
          purposeKey: String((root.querySelector('[data-analytics-filter="purposeKey"]') || {}).value || '').trim()
        },
        activeView: normalizeAnalyticsView(root.dataset.analyticsView || activeView)
      });
    };
  }

  intelligence.init = function () {
    var root = document.getElementById('analytics-root');
    if (!root) return;
    if (!NK.service || !NK.service.project || !NK.service.analytics || !NK.service.brand) {
      renderEmpty(root, '분석 화면을 불러올 수 없습니다.');
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
    renderProject(root, project, brand, {});
  };
})();
