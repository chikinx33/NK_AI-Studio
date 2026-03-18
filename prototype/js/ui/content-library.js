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

  function typeDescription(type) {
    switch (String(type || '').trim()) {
      case 'scene': return '생성 파이프라인의 기본 장면 구조';
      case 'text': return '내레이션, 스크립트, 텍스트 초안';
      case 'image': return '완성된 대표 이미지와 스틸컷';
      case 'video': return '완성된 영상 또는 미리보기 결과';
      case 'reference': return '브랜드 허브에서 관리하는 참고 자료';
      case 'publish-result': return '실제 게시 후 기록한 운영 결과';
      default: return '브랜드에 연결된 콘텐츠 자산';
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
    function countByType(type) {
      return items.filter(function (item) { return item.type === type; }).length;
    }
    var sceneCount = countByType('scene');
    var textCount = countByType('text');
    var imageCount = countByType('image');
    var videoCount = countByType('video');
    var referenceCount = countByType('reference');
    var publishCount = countByType('publish-result');
    var libraryHeroPills = [
      { label: '현재 에피소드', value: currentEpisodeTitle },
      { label: '프로젝트 유형', value: meta.projectType },
      { label: '타깃', value: meta.targetAudience },
      { label: '다음 단계', value: summary.nextAction }
    ].map(function (item) {
      return '<span class="studio-hero-pill"><em>' + escapeHtml(item.label) + '</em><strong>' + escapeHtml(item.value) + '</strong></span>';
    }).join('');
    var libraryHeroStats = [
      {
        label: '전체 Scene',
        value: String(sceneCount),
        detail: sceneCount ? '브랜드 전체 Scene 자산을 한곳에서 탐색합니다.' : '아직 저장된 Scene이 없습니다.',
        accent: true
      },
      {
        label: '이미지 / 영상',
        value: String(imageCount) + ' / ' + String(videoCount),
        detail: (imageCount || videoCount) ? '시각 결과물을 빠르게 훑고 바로 열 수 있습니다.' : '시각 결과물이 아직 충분하지 않습니다.'
      },
      {
        label: '텍스트 / 참조',
        value: String(textCount) + ' / ' + String(referenceCount),
        detail: '브랜드 문맥과 생성 초안까지 함께 살펴봅니다.'
      },
      {
        label: '게시 결과',
        value: String(publishCount) + '건',
        detail: publishCount ? '성과 기록도 이 라이브러리 안에서 함께 확인합니다.' : '아직 저장된 게시 결과가 없습니다.'
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
    var summaryCards = [
      { label: '운영 브랜드', value: brandTitle || '-', detail: '현재 브랜드에 연결된 모든 크리에이티브 결과물을 보여 줍니다.' },
      { label: '현재 연결 에피소드', value: currentEpisodeTitle, detail: '필요하면 다른 화면으로 이동해 바로 이어서 수정할 수 있습니다.' },
      { label: '핵심 메시지', value: meta.coreMessage, detail: '브랜드가 계속 전달하려는 메시지 기준입니다.' },
      { label: '다음 단계', value: summary.nextAction, detail: '현재 자산 상태를 기준으로 다음 작업 흐름을 제안합니다.' },
      { label: '텍스트 자산', value: String(textCount) + '개', detail: '시나리오, 내레이션, 캡션 초안 등이 포함됩니다.' },
      { label: '참조 자산', value: String(referenceCount) + '개', detail: '브랜드 허브의 레퍼런스와 성공 패턴을 같이 확인합니다.' }
    ].map(function (item) {
      return (
        '<article class="content-library-summary-card">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');
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
        '<div><h3>' + escapeHtml(typeLabel(type)) + '</h3><p>' + escapeHtml(typeDescription(type)) + '</p></div>' +
        '<span>' + escapeHtml(rows.length) + '개</span>' +
        '</div>' +
        '<div class="content-library-grid">' + body + '</div>' +
        '</section>'
      );
    }).join('');

    root.innerHTML =
      '<section class="content-library-page">' +
      '<div class="content-library-hero">' +
      '<div class="studio-page-hero-main">' +
      '<p class="content-library-eyebrow">Brand Assets</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="content-library-description">' + escapeHtml(brandSummary) + '</p>' +
      '<p class="content-library-description">이 화면은 브랜드 자산함이며, 현재 연결된 에피소드는 ' + escapeHtml(currentEpisodeTitle) + '입니다.</p>' +
      '<div class="studio-hero-pill-row">' + libraryHeroPills + '</div>' +
      '<div class="content-library-hero-actions">' +
      '<button class="btn-secondary" data-action="library-open-knowledge">브랜드 허브</button>' +
      '<button class="btn-secondary" data-action="library-open-brand">Brand Studio</button>' +
      '</div>' +
      '</div>' +
      '<div class="studio-page-hero-side"><div class="studio-kpi-grid">' + libraryHeroStats + '</div></div>' +
      '</div>' +
      '<div class="content-library-summary-grid">' + summaryCards + '</div>' +
      '<div class="content-library-toolbar">' +
      '<span>현재 브랜드에 연결된 Creative 결과물을 한 곳에서 확인합니다.</span>' +
      '<div class="content-library-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('knowledge.html', projectId, brandId)) + '">브랜드 허브</a>' +
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
