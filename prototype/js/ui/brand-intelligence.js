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

  function buildStageUrl(page, projectId) {
    var safePage = String(page || '').trim() || 'dashboard.html';
    var safeProjectId = String(projectId || '').trim();
    if (!safeProjectId) return safePage;
    return safePage + '?projectId=' + encodeURIComponent(safeProjectId);
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

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="analytics-page">' +
      '<div class="analytics-hero empty">' +
      '<h2>Brand Intelligence</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="analytics-hero-actions"><a class="btn-primary" href="dashboard.html">대시보드로 이동</a></div>' +
      '</div>' +
      '</section>';
  }

  function renderProject(root, project) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var summary = NK.service.analytics.summarizeProject(project);
    var channels = NK.service.analytics.summarizeByChannel(project);
    var contentTypes = NK.service.analytics.summarizeByContentType(project);
    var uploadTimes = NK.service.analytics.summarizeByUploadTime(project);
    var hashtags = NK.service.analytics.summarizeByHashtag(project);
    var recommendations = NK.service.strategyEngine
      ? NK.service.strategyEngine.buildRecommendations(project)
      : [];

    root.innerHTML =
      '<section class="analytics-page">' +
      '<div class="analytics-hero">' +
      '<div>' +
      '<p class="analytics-eyebrow">Brand Intelligence</p>' +
      '<h2>' + escapeHtml(project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="analytics-description">' + escapeHtml(payload.brandSummary || '게시 결과를 수집하면 채널별 성과를 여기서 한눈에 확인할 수 있습니다.') + '</p>' +
      '</div>' +
      '<div class="analytics-hero-actions">' +
      '<button class="btn-secondary" data-action="analytics-open-brand">Brand Studio</button>' +
      '<button class="btn-secondary" data-action="analytics-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="analytics-open-knowledge">Knowledge Hub</button>' +
      '</div>' +
      '</div>' +
      '<div class="analytics-summary-grid">' +
      '<article class="analytics-summary-card"><span>누적 게시</span><strong>' + escapeHtml(summary.totalPosts) + '개</strong></article>' +
      '<article class="analytics-summary-card"><span>총 조회수</span><strong>' + escapeHtml(summary.views) + '</strong></article>' +
      '<article class="analytics-summary-card"><span>총 반응</span><strong>' + escapeHtml(summary.likes + summary.comments + summary.shares) + '</strong></article>' +
      '<article class="analytics-summary-card"><span>상위 채널</span><strong>' + escapeHtml(channelLabel(summary.topChannel || '-')) + '</strong></article>' +
      '</div>' +
      '<section class="analytics-panel">' +
      '<div class="analytics-panel-head"><h3>전략 추천</h3><span>현재 데이터 기반 우선 액션</span></div>' +
      '<div class="analytics-recommendation-grid">' +
      (recommendations.length
        ? recommendations.map(recommendationCardHtml).join('')
        : '<div class="analytics-empty">아직 추천을 만들 만큼의 데이터가 없습니다.</div>') +
      '</div>' +
      '</section>' +
      '<section class="analytics-panel">' +
      '<div class="analytics-panel-head"><h3>채널별 성과</h3><span>V2 첫 분석 화면</span></div>' +
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
          '<p class="analytics-channel-note">현재 저장된 게시 결과 기준으로 집계했습니다. 다음 단계에서는 콘텐츠 유형별, 업로드 시간별 분석을 이 화면에 이어 붙입니다.</p>' +
          '</article>'
        );
      }).join('') : '<div class="analytics-empty">아직 게시 결과가 없습니다. Brand Studio에서 먼저 게시 결과를 기록해 주세요.</div>') +
      '</div>' +
      '</section>' +
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
          '<p class="analytics-channel-note">현재는 게시 결과에 저장된 콘텐츠 유형 기준으로 집계합니다. 다음 단계에서는 업로드 시간, 해시태그 패턴까지 연결합니다.</p>' +
          '</article>'
        );
      }).join('') : '<div class="analytics-empty">아직 콘텐츠 유형별로 비교할 게시 결과가 없습니다.</div>') +
      '</div>' +
      '</section>' +
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
          '<p class="analytics-channel-note">현재는 저장된 게시 시각 기준으로 오전, 오후, 저녁, 심야 구간을 나눠 집계합니다.</p>' +
          '</article>'
        );
      }).join('') : '<div class="analytics-empty">업로드 시각이 저장된 게시 결과가 아직 없습니다.</div>') +
      '</div>' +
      '</section>' +
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
      '</section>' +
      '<div class="analytics-toolbar">' +
      '<span>사용자는 채널별로 어떤 곳이 반응이 좋은지 한눈에 보고, 다음 운영 방향을 바로 정해야 합니다.</span>' +
      '<div class="analytics-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('brand.html', projectId)) + '">Brand Studio</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('knowledge.html', projectId)) + '">Knowledge Hub</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('library.html', projectId)) + '">Content Library</a>' +
      '</div>' +
      '</div>' +
      '</section>';

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      if (action === 'analytics-open-brand') target = buildStageUrl('brand.html', projectId);
      else if (action === 'analytics-open-library') target = buildStageUrl('library.html', projectId);
      else if (action === 'analytics-open-knowledge') target = buildStageUrl('knowledge.html', projectId);
      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };
  }

  intelligence.init = function () {
    var root = document.getElementById('analytics-root');
    if (!root) return;
    if (!NK.service || !NK.service.project || !NK.service.analytics) {
      renderEmpty(root, '분석 화면을 불러올 수 없습니다.');
      return;
    }
    var project = NK.service.project.resolveCurrent({ search: window.location.search });
    if (!project || !project.id) {
      renderEmpty(root, '먼저 프로젝트를 선택해 주세요.');
      return;
    }
    renderProject(root, project);
  };
})();
