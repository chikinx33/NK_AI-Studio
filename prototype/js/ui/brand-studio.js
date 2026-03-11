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

  function buildStageUrl(page, projectId) {
    var safePage = String(page || '').trim() || 'dashboard.html';
    var safeProjectId = String(projectId || '').trim();
    if (!safeProjectId) return safePage;
    return safePage + '?projectId=' + encodeURIComponent(safeProjectId);
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
  }

  function renderProject(root, project) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var summary = (NK.service.contentLibrary && NK.service.contentLibrary.summarizeProject)
      ? NK.service.contentLibrary.summarizeProject(project)
      : { scenes: 0, images: 0, videos: 0, nextAction: '시나리오 작성' };

    var readiness = [
      {
        title: '프로젝트 문맥',
        ready: !!(payload.projectType || payload.brandSummary || payload.coreMessage),
        desc: '프로젝트 유형, 브랜드 요약, 핵심 메시지가 있어야 브랜드 운영 기준이 선명해집니다.'
      },
      {
        title: '콘텐츠 소스',
        ready: Number(summary.images || 0) > 0 || Number(summary.videos || 0) > 0,
        desc: 'Content Library의 이미지/영상 자산이 Brand Studio의 운영 소재가 됩니다.'
      },
      {
        title: '다음 운영 단계',
        ready: true,
        desc: '현재 기준 추천 단계는 "' + String(summary.nextAction || '준비 중') + '" 입니다.'
      }
    ];

    var ops = [
      { title: 'SNS 콘텐츠 운영', desc: '프로젝트 문맥에 맞는 SNS 포맷 운영 화면을 여는 자리입니다.', status: '준비 중' },
      { title: '캡션 생성', desc: '프로젝트 핵심 메시지와 브랜드 톤을 기반으로 문구를 구성할 예정입니다.', status: '다음 단계' },
      { title: '해시태그 구성', desc: '콘텐츠 유형과 타깃에 맞는 해시태그 추천 흐름이 여기 붙습니다.', status: '다음 단계' },
      { title: '채널 배포', desc: '채널 연결과 예약 게시가 이 영역에 연결됩니다.', status: '후속 구현' }
    ];

    root.innerHTML =
      '<section class="brand-studio-page">' +
      '<div class="brand-studio-hero">' +
      '<div>' +
      '<p class="brand-studio-eyebrow">Brand Operations</p>' +
      '<h2>' + escapeHtml(project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="brand-studio-description">' + escapeHtml(payload.brandSummary || '브랜드 요약을 먼저 입력하면 Brand Studio 품질이 올라갑니다.') + '</p>' +
      '</div>' +
      '<div class="brand-studio-hero-actions">' +
      '<button class="btn-secondary" data-action="brand-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="brand-open-scenario">프리 프로덕션</button>' +
      '<button class="btn-primary" data-action="brand-open-media">포스트 프로덕션</button>' +
      '</div>' +
      '</div>' +
      '<div class="brand-studio-summary-grid">' +
      '<article class="brand-studio-summary-card"><span>프로젝트 유형</span><strong>' + escapeHtml(payload.projectType || '-') + '</strong></article>' +
      '<article class="brand-studio-summary-card"><span>핵심 메시지</span><strong>' + escapeHtml(payload.coreMessage || '-') + '</strong></article>' +
      '<article class="brand-studio-summary-card"><span>타깃</span><strong>' + escapeHtml(payload.targetAudience || payload.target || '-') + '</strong></article>' +
      '<article class="brand-studio-summary-card"><span>소스 자산</span><strong>씬 ' + escapeHtml(summary.scenes) + ' · 이미지 ' + escapeHtml(summary.images) + ' · 영상 ' + escapeHtml(summary.videos) + '</strong></article>' +
      '</div>' +
      '<div class="brand-studio-layout">' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>브랜드 운영 준비도</h3><span>현재 프로젝트 기준</span></div>' +
      '<div class="brand-studio-checklist">' +
      readiness.map(function (item) {
        return (
          '<article class="brand-studio-check ' + (item.ready ? 'is-ready' : 'is-pending') + '">' +
          '<div class="brand-studio-check-mark">' + (item.ready ? '완료' : '대기') + '</div>' +
          '<div>' +
          '<h4>' + escapeHtml(item.title) + '</h4>' +
          '<p>' + escapeHtml(item.desc) + '</p>' +
          '</div>' +
          '</article>'
        );
      }).join('') +
      '</div>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>운영 모듈</h3><span>V1 기준 골격</span></div>' +
      '<div class="brand-studio-ops-grid">' +
      ops.map(function (item) {
        return (
          '<article class="brand-studio-op-card">' +
          '<span class="brand-studio-op-status">' + escapeHtml(item.status) + '</span>' +
          '<h4>' + escapeHtml(item.title) + '</h4>' +
          '<p>' + escapeHtml(item.desc) + '</p>' +
          '</article>'
        );
      }).join('') +
      '</div>' +
      '</section>' +
      '</div>' +
      '<div class="brand-studio-toolbar">' +
      '<span>Brand Studio는 Content Library 이후 운영 단계입니다. 지금은 운영 기준 화면과 진입 동선이 연결된 상태입니다.</span>' +
      '<div class="brand-studio-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('library.html', projectId)) + '">소스 확인</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenario.html', projectId)) + '">문맥 수정</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('media.html', projectId)) + '">최종 편집</a>' +
      '</div>' +
      '</div>' +
      '</section>';

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      var target = '';
      if (action === 'brand-open-library') target = buildStageUrl('library.html', projectId);
      else if (action === 'brand-open-scenario') target = buildStageUrl('scenario.html', projectId);
      else if (action === 'brand-open-media') target = buildStageUrl('media.html', projectId);
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
    if (!NK.service || !NK.service.project) {
      renderEmpty(root, 'Brand Studio를 불러올 수 없습니다.');
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
