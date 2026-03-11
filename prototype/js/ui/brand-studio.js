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

  function readBrandContentType(payload) {
    return String(payload && payload.brandStudioContentType || '').trim();
  }

  function readCaptionDraft(payload) {
    return String(payload && payload.brandStudioCaptionDraft || '').trim();
  }

  function readHashtagDraft(payload) {
    return String(payload && payload.brandStudioHashtagDraft || '').trim();
  }

  function readChannelConnections(payload) {
    var src = payload && Array.isArray(payload.brandStudioChannels) ? payload.brandStudioChannels : [];
    return src.map(function (item) {
      return {
        channelType: String(item && item.channelType || '').trim(),
        accountName: String(item && item.accountName || '').trim(),
        status: String(item && item.status || 'connected').trim() || 'connected'
      };
    }).filter(function (item) { return item.channelType; });
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
    raw = raw.replace(/^#+/, '').replace(/[^0-9A-Za-z가-힣_]+/g, '');
    if (!raw) return '';
    return '#' + raw;
  }

  function buildHashtagDraft(project, selectedOption, sourceTexts) {
    var payload = (project && project.payload) || {};
    var tokens = [];

    function pushToken(value) {
      var tag = normalizeHashtagToken(value);
      if (!tag) return;
      if (tokens.indexOf(tag) >= 0) return;
      tokens.push(tag);
    }

    pushToken(project && (project.seriesTitle || project.title));
    pushToken(payload.projectType);
    pushToken(payload.targetAudience || payload.target);
    pushToken(selectedOption && selectedOption.title);
    toTagList(payload.brandKeywords).slice(0, 4).forEach(pushToken);
    toTagList(payload.purposeTags).slice(0, 3).forEach(pushToken);

    var sourceLine = firstFilled(sourceTexts);
    if (sourceLine) {
      sourceLine.split(/\s+/).slice(0, 3).forEach(pushToken);
    }

    return tokens.slice(0, 8).join(' ');
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
  }

  function renderProject(root, project) {
    var projectId = String(project.id || '').trim();
    var payload = project.payload || {};
    var selectedType = readBrandContentType(payload);
    var savedCaption = readCaptionDraft(payload);
    var savedHashtags = readHashtagDraft(payload);
    var channelConnections = readChannelConnections(payload);
    var summary = (NK.service.contentLibrary && NK.service.contentLibrary.summarizeProject)
      ? NK.service.contentLibrary.summarizeProject(project)
      : { scenes: 0, images: 0, videos: 0, nextAction: '시나리오 작성' };
    var options = contentTypeOptions();
    var channelRows = channelOptions();
    var channelTitleMap = {};
    channelRows.forEach(function (item) {
      channelTitleMap[item.id] = item.title;
    });
    var selectedOption = options.find(function (item) { return item.id === selectedType; }) || null;
    var contentItems = (NK.service.contentLibrary && NK.service.contentLibrary.listProjectContents)
      ? NK.service.contentLibrary.listProjectContents(project)
      : [];
    var sourceTexts = contentItems
      .filter(function (item) { return item.type === 'text'; })
      .map(function (item) { return String(item.text || '').trim(); })
      .filter(Boolean);

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

    var captionValue = savedCaption || '';

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
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>SNS 콘텐츠 유형</h3><span>V1 첫 진입점</span></div>' +
      '<div class="brand-content-type-grid">' + contentTypeCards + '</div>' +
      '<div class="brand-studio-selection-summary">' +
      '<div>' +
      '<span class="brand-studio-selection-label">현재 선택</span>' +
      '<strong>' + escapeHtml(selectedOption ? selectedOption.title : '아직 선택되지 않음') + '</strong>' +
      '<p>' + escapeHtml(selectedOption ? selectedOption.outputs : '먼저 콘텐츠 유형을 선택하면 다음 캡션/해시태그 흐름이 이 기준으로 이어집니다.') + '</p>' +
      '</div>' +
      '<div class="brand-studio-selection-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('library.html', projectId)) + '">소스 확인</a>' +
      '<button class="btn-primary compact" data-action="brand-select-next" ' + (selectedOption ? '' : 'disabled') + '>이 유형으로 계속</button>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>캡션 생성</h3><span>선택한 콘텐츠 유형 기준</span></div>' +
      '<div class="brand-caption-generator">' +
      '<div class="brand-caption-meta">' +
      '<div><span class="brand-caption-meta-label">콘텐츠 유형</span><strong>' + escapeHtml(selectedOption ? selectedOption.title : '미선택') + '</strong></div>' +
      '<div><span class="brand-caption-meta-label">참조 소스</span><strong>' + escapeHtml(sourceTexts.length ? ('텍스트 소스 ' + sourceTexts.length + '개') : '아직 없음') + '</strong></div>' +
      '</div>' +
      '<textarea id="brand-caption-textarea" class="brand-caption-textarea" placeholder="캡션이 여기에 생성됩니다.">' + escapeHtml(captionValue) + '</textarea>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-secondary" data-action="brand-generate-caption" ' + (selectedOption ? '' : 'disabled') + '>자동 생성</button>' +
      '<button class="btn-secondary" data-action="brand-regenerate-caption" ' + (selectedOption ? '' : 'disabled') + '>다시 생성</button>' +
      '<button class="btn-primary" data-action="brand-save-caption" ' + (selectedOption ? '' : 'disabled') + '>캡션 저장</button>' +
      '</div>' +
      '<p class="brand-caption-help">프로젝트 요약, 핵심 메시지, 타깃, 선택한 콘텐츠 유형을 기반으로 캡션을 구성합니다.</p>' +
      '</div>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>해시태그 생성</h3><span>프로젝트 키워드 기반</span></div>' +
      '<div class="brand-hashtag-generator">' +
      '<div class="brand-hashtag-meta">' +
      '<div><span class="brand-caption-meta-label">브랜드 키워드</span><strong>' + escapeHtml(toTagList(payload.brandKeywords).length ? toTagList(payload.brandKeywords).join(', ') : '아직 없음') + '</strong></div>' +
      '<div><span class="brand-caption-meta-label">추천 기준</span><strong>' + escapeHtml(selectedOption ? selectedOption.title : '콘텐츠 유형 미선택') + '</strong></div>' +
      '</div>' +
      '<textarea id="brand-hashtag-textarea" class="brand-caption-textarea brand-hashtag-textarea" placeholder="#해시태그 형식으로 생성됩니다.">' + escapeHtml(savedHashtags || '') + '</textarea>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-secondary" data-action="brand-generate-hashtags" ' + (selectedOption ? '' : 'disabled') + '>자동 생성</button>' +
      '<button class="btn-secondary" data-action="brand-regenerate-hashtags" ' + (selectedOption ? '' : 'disabled') + '>다시 생성</button>' +
      '<button class="btn-primary" data-action="brand-save-hashtags" ' + (selectedOption ? '' : 'disabled') + '>해시태그 저장</button>' +
      '</div>' +
      '<p class="brand-caption-help">프로젝트명, 브랜드 키워드, 콘텐츠 유형, 타깃, 기존 콘텐츠 문맥을 합쳐 해시태그를 추천합니다.</p>' +
      '</div>' +
      '</section>' +
      '<section class="brand-studio-panel">' +
      '<div class="brand-studio-panel-head"><h3>채널 연결</h3><span>프로젝트별 운영 채널</span></div>' +
      '<div class="brand-channel-summary">' +
      '<span class="brand-channel-summary-label">현재 연결</span>' +
      '<strong>' + escapeHtml(channelConnections.length) + '개 채널</strong>' +
      '<p>' + escapeHtml(channelConnections.length ? channelConnections.map(function (item) { return channelTitleMap[item.channelType] || item.channelType; }).join(', ') : '아직 연결된 채널이 없습니다.') + '</p>' +
      '</div>' +
      '<div class="brand-channel-grid">' + channelCards + '</div>' +
      '</section>' +
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
      var captionEl = root.querySelector('#brand-caption-textarea');
      var hashtagEl = root.querySelector('#brand-hashtag-textarea');
      if (action === 'brand-select-content-type') {
        var typeId = String(btn.dataset.contentType || '').trim();
        if (!typeId || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioContentType: typeId })
          .then(function (result) {
            if (result && result.draft) renderProject(root, result.draft);
          })
          .catch(function (err) {
            alert('콘텐츠 유형 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'brand-generate-caption' || action === 'brand-regenerate-caption') {
        if (!selectedOption || !NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var sourceLine = firstFilled(sourceTexts).slice(0, 140);
        var typeLead = selectedOption.title;
        var projectLead = firstFilled([payload.brandSummary, payload.coreMessage, project.seriesTitle, project.title]);
        var audienceLead = firstFilled([payload.targetAudience, payload.target, '프로젝트 팔로워']);
        var detailLine = sourceLine ? ('대표 포인트는 ' + sourceLine + '입니다.') : '';
        var nextCaption = [
          projectLead,
          audienceLead + '에게 맞춘 ' + typeLead + ' 운영 캡션입니다.',
          payload.coreMessage ? ('핵심 메시지는 "' + payload.coreMessage + '" 입니다.') : '',
          detailLine,
          '지금 이 프로젝트의 다음 업데이트를 계속 확인해 주세요.'
        ].filter(Boolean).join(' ');
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioCaptionDraft: nextCaption })
          .then(function (result) {
            if (result && result.draft) renderProject(root, result.draft);
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
            if (result && result.draft) renderProject(root, result.draft);
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
        var nextTags = buildHashtagDraft(project, selectedOption, sourceTexts);
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, { brandStudioHashtagDraft: nextTags })
          .then(function (result) {
            if (result && result.draft) renderProject(root, result.draft);
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
            if (result && result.draft) renderProject(root, result.draft);
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
        NK.service.project.updatePayload(projectId, {
          brandStudioChannels: nextConnections,
          connectedChannels: nextConnections.map(function (row) { return row.channelType; })
        })
          .then(function (result) {
            if (result && result.draft) renderProject(root, result.draft);
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
        alert(selectedOption ? ('선택한 유형: ' + selectedOption.title + '\n다음 단계로 캡션/해시태그 흐름을 연결할 예정입니다.') : '먼저 콘텐츠 유형을 선택해 주세요.');
        return;
      }
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
