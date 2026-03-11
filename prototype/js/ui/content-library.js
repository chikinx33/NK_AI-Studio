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

  function buildStageUrl(page, projectId) {
    var safePage = String(page || '').trim() || 'dashboard.html';
    var safeProjectId = String(projectId || '').trim();
    if (!safeProjectId) return safePage;
    return safePage + '?projectId=' + encodeURIComponent(safeProjectId);
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="content-library-page">' +
      '<div class="content-library-hero empty">' +
      '<h2>Content Library</h2>' +
      '<p>' + escapeHtml(message || '선택된 프로젝트가 없습니다.') + '</p>' +
      '<div class="content-library-hero-actions">' +
      '<a class="btn-primary" href="dashboard.html">대시보드로 이동</a>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  function renderProject(root, project) {
    var summary = NK.service.contentLibrary.summarizeProject(project);
    var items = NK.service.contentLibrary.listProjectContents(project);
    var meta = projectMeta(project);
    var projectId = String(project.id || '').trim();
    var groups = ['scene', 'text', 'image', 'video'].map(function (type) {
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
      '<p class="content-library-eyebrow">Project Context</p>' +
      '<h2>' + escapeHtml(project.title || project.seriesTitle || '프로젝트') + '</h2>' +
      '<p class="content-library-description">' + escapeHtml(meta.brandSummary) + '</p>' +
      '</div>' +
      '<div class="content-library-hero-actions">' +
      '<button class="btn-secondary" data-action="library-open-scenario">프리 프로덕션</button>' +
      '<button class="btn-secondary" data-action="library-open-scenes">프로덕션</button>' +
      '<button class="btn-primary" data-action="library-open-media">포스트 프로덕션</button>' +
      '</div>' +
      '</div>' +
      '<div class="content-library-summary-grid">' +
      '<article class="content-library-summary-card"><span>프로젝트 유형</span><strong>' + escapeHtml(meta.projectType) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>타깃</span><strong>' + escapeHtml(meta.targetAudience) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>핵심 메시지</span><strong>' + escapeHtml(meta.coreMessage) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>다음 단계</span><strong>' + escapeHtml(summary.nextAction) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>Scene</span><strong>' + escapeHtml(summary.scenes) + '</strong></article>' +
      '<article class="content-library-summary-card"><span>이미지 / 영상</span><strong>' + escapeHtml(summary.images) + ' / ' + escapeHtml(summary.videos) + '</strong></article>' +
      '</div>' +
      '<div class="content-library-toolbar">' +
      '<span>현재 프로젝트의 Creative 결과물을 한 곳에서 확인합니다.</span>' +
      '<div class="content-library-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenario.html', projectId)) + '">시나리오 수정</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenes.html', projectId)) + '">생성 계속</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('media.html', projectId)) + '">편집 계속</a>' +
      '</div>' +
      '</div>' +
      groups +
      '</section>';

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      if (action === 'library-open-scenario') target = buildStageUrl('scenario.html', projectId);
      else if (action === 'library-open-scenes') target = buildStageUrl('scenes.html', projectId);
      else if (action === 'library-open-media') target = buildStageUrl('media.html', projectId);
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
    if (!NK.service || !NK.service.contentLibrary || !NK.service.project) {
      renderEmpty(root, 'Content Library를 불러올 수 없습니다.');
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
