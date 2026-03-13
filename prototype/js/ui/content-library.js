; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var libraryUi = ui.contentLibrary || (ui.contentLibrary = {});

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function typeLabel(type) {
    switch (String(type || '').trim()) {
      case 'scene': return 'Scene';
      case 'text': return '텍스트';
      case 'image': return '이미지';
      case 'video': return '영상';
      case 'reference': return '참조';
      case 'publish-result': return '게시 결과';
      default: return '콘텐츠';
    }
  }

  function statusLabel(status) {
    return String(status || '').trim() === 'ready' ? '준비 완료' : '비어 있음';
  }

  function projectMeta(project) {
    var payload = (project && project.payload) || {};
    return {
      projectType: String(payload.projectType || '').trim() || '-',
      brandSummary: String(payload.brandSummary || '').trim() || '브랜드 요약이 아직 없습니다.',
      coreMessage: String(payload.coreMessage || '').trim() || '핵심 메시지가 아직 없습니다.',
      targetAudience: String(payload.targetAudience || payload.target || '').trim() || '-'
    };
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

  function episodeLabel(project) {
    return String(project && (project.title || project.payload && project.payload.episodeTitle || project.seriesTitle || project.id) || '').trim() || '미지정 에피소드';
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="content-library-page">' +
      '<div class="content-library-hero empty">' +
      '<h2>Content Library</h2>' +
      '<p>' + escapeHtml(message || '선택된 프로젝트가 없습니다.') + '</p>' +
      '<div class="content-library-hero-actions">' +
      '<button type="button" class="btn-primary" data-action="library-open-dashboard">대시보드로 이동</button>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action !== 'library-open-dashboard') return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: 'dashboard.html' }, '*');
      } else if (NK.navigation && NK.navigation.loadStage) {
        NK.navigation.loadStage('dashboard.html');
      } else {
        window.location.href = 'dashboard.html';
      }
    };
  }

  function renderProject(root, project, brand) {
    var summary = NK.service.contentLibrary.summarizeProject(brand || project);
    var items = NK.service.contentLibrary.listProjectContents(brand || project);
    var meta = projectMeta(project);
    var projectId = String(project.id || '').trim();
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    var brandTitle = String(brand && brand.brandTitle || project.payload && project.payload.brandTitle || project.title || project.seriesTitle || '프로젝트').trim();
    var brandSummary = String(brand && brand.brandSummary || meta.brandSummary || '').trim();
    var currentEpisodeTitle = episodeLabel(project);
    var groups = ['scene', 'text', 'image', 'video', 'reference', 'publish-result'].map(function (type) {
      var rows = items.filter(function (item) { return item.type === type; });
      var body = rows.length
        ? rows.map(function (item) {
          var hasUrl = !!String(item.url || '').trim();
          return (
            '<article class="content-library-item">' +
            '<div class="content-library-item-top">' +
            '<span class="content-library-badge">' + escapeHtml(typeLabel(item.type)) + '</span>' +
            '<span class="content-library-status ' + (item.status === 'ready' ? 'is-ready' : 'is-empty') + '">' + escapeHtml(statusLabel(item.status)) + '</span>' +
            '</div>' +
            '<h4>' + escapeHtml(item.title || '제목 없음') + '</h4>' +
            '<p>' + escapeHtml(item.text || ('Scene #' + (item.sceneId || '-'))) + '</p>' +
            '<div class="content-library-item-actions">' +
            (hasUrl ? '<a class="btn-secondary compact" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer">열기</a>' : '') +
            '</div>' +
            '</article>'
          );
        }).join('')
        : '<div class="content-library-empty-group">아직 등록된 ' + escapeHtml(typeLabel(type)) + '이 없습니다.</div>';

      return (
        '<section class="content-library-section">' +
        '<div class="content-library-section-head">' +
        '<h3>' + escapeHtml(typeLabel(type)) + '</h3>' +
        '<span>' + escapeHtml(rows.length) + '개</span>' +
        '</div>' +
        '<div class="content-library-grid">' + body + '</div>' +
        '</section>'
      );
    }).join('');

    root.innerHTML =
      '<section class="content-library-page">' +
      '<div class="content-library-hero">' +
      '<div>' +
      '<p class="content-library-eyebrow">Brand Assets</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="content-library-description">' + escapeHtml(brandSummary) + '</p>' +
      '<p class="content-library-description">이 화면은 브랜드 자산함이며, 현재 연결된 에피소드는 ' + escapeHtml(currentEpisodeTitle) + '입니다.</p>' +
      '</div>' +
      '<div class="content-library-hero-actions">' +
      '<button class="btn-secondary" data-action="library-open-knowledge">Knowledge Hub</button>' +
      '<button class="btn-secondary" data-action="library-open-brand">Brand Studio</button>' +
      '</div>' +
      '</div>' +
      '<div class="content-library-summary-grid">' +
      '<article class="content-library-summary-card"><span>운영 브랜드</span><strong>' + escapeHtml(brandTitle || '-') + '</strong></article>' +
      '<article class="content-library-summary-card"><span>현재 연결 에피소드</span><strong>' + escapeHtml(currentEpisodeTitle) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>현재 에피소드 유형</span><strong>' + escapeHtml(meta.projectType) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>타깃</span><strong>' + escapeHtml(meta.targetAudience) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>핵심 메시지</span><strong>' + escapeHtml(meta.coreMessage) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>다음 단계</span><strong>' + escapeHtml(summary.nextAction) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>브랜드 전체 Scene</span><strong>' + escapeHtml(summary.scenes) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>브랜드 전체 이미지 / 영상</span><strong>' + escapeHtml(summary.images) + ' / ' + escapeHtml(summary.videos) + '</strong></article>' +
      '</div>' +
      '<div class="content-library-toolbar">' +
      '<span>현재 브랜드에 연결된 Creative 결과물을 한 곳에서 확인합니다.</span>' +
      '<div class="content-library-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('knowledge.html', projectId, brandId)) + '">Knowledge Hub</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('brand.html', projectId, brandId)) + '">Brand Studio</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenario.html', projectId, brandId)) + '">시나리오 수정</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenes.html', projectId, brandId)) + '">생성 계속</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('media.html', projectId, brandId)) + '">편집 계속</a>' +
      '</div>' +
      '</div>' +
      groups +
      '</section>';
    applyCurrentLocale();

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      if (action === 'library-open-knowledge') target = buildStageUrl('knowledge.html', projectId, brandId);
      else if (action === 'library-open-brand') target = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'library-open-scenario') target = buildStageUrl('scenario.html', projectId, brandId);
      else if (action === 'library-open-scenes') target = buildStageUrl('scenes.html', projectId, brandId);
      else if (action === 'library-open-media') target = buildStageUrl('media.html', projectId, brandId);
      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };
  }

  libraryUi.init = function () {
    var root = document.getElementById('content-library-root');
    if (!root) return;
    if (!NK.service || !NK.service.contentLibrary || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, 'Content Library를 불러올 수 없습니다.');
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
