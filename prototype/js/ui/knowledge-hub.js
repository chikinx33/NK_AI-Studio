; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var knowledgeHub = ui.knowledgeHub || (ui.knowledgeHub = {});

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

  function splitLines(value) {
    return String(value || '')
      .split(/\n+/)
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean);
  }

  function joinLines(value) {
    return (Array.isArray(value) ? value : [])
      .map(function (item) { return String(item || '').trim(); })
      .filter(Boolean)
      .join('\n');
  }

  function readKnowledge(project) {
    if (NK.service && NK.service.project && NK.service.project.getKnowledgeHub) {
      return NK.service.project.getKnowledgeHub(project);
    }
    return {
      brandVoice: '',
      brandStory: '',
      brandCharacter: '',
      worldSetting: '',
      brandRules: [],
      bannedExpressions: [],
      referenceContents: [],
      successCases: []
    };
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero empty">' +
      '<h2>Knowledge Hub</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<a class="btn-primary" href="dashboard.html">대시보드로 이동</a>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  function renderProject(root, project) {
    var projectId = String(project && project.id || '').trim();
    var payload = (project && project.payload) || {};
    var knowledge = readKnowledge(project);
    var rulesCount = knowledge.brandRules.length;
    var bannedCount = knowledge.bannedExpressions.length;
    var referencesCount = knowledge.referenceContents.length;
    var successesCount = knowledge.successCases.length;

    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero">' +
      '<div>' +
      '<p class="knowledge-hub-eyebrow">Knowledge Hub</p>' +
      '<h2>' + escapeHtml(project.seriesTitle || project.title || '프로젝트') + '</h2>' +
      '<p class="knowledge-hub-description">' + escapeHtml(payload.brandSummary || '브랜드 요약이 아직 없습니다. Knowledge Hub를 먼저 채우면 이후 생성 품질이 안정됩니다.') + '</p>' +
      '</div>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<button class="btn-secondary" data-action="knowledge-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="knowledge-open-brand">Brand Studio</button>' +
      '<button class="btn-primary" data-action="knowledge-save">Knowledge 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="knowledge-hub-summary-grid">' +
      '<article class="knowledge-hub-summary-card"><span>브랜드 보이스</span><strong>' + escapeHtml(knowledge.brandVoice || '-') + '</strong></article>' +
      '<article class="knowledge-hub-summary-card"><span>세계관/배경</span><strong>' + escapeHtml(knowledge.worldSetting || '-') + '</strong></article>' +
      '<article class="knowledge-hub-summary-card"><span>브랜드 규칙</span><strong>' + escapeHtml(rulesCount) + '개</strong></article>' +
      '<article class="knowledge-hub-summary-card"><span>참조 콘텐츠</span><strong>' + escapeHtml(referencesCount) + '개</strong></article>' +
      '</div>' +
      '<div class="knowledge-hub-layout">' +
      '<section class="knowledge-hub-panel">' +
      '<div class="knowledge-hub-panel-head"><h3>브랜드 정체성</h3><span>AI가 계속 참고할 기본 문맥</span></div>' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>브랜드 보이스</span><textarea id="knowledge-brand-voice" placeholder="예: 따뜻하지만 과장하지 않고, 짧고 명확하게 말한다.">' + escapeHtml(knowledge.brandVoice) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>브랜드 스토리</span><textarea id="knowledge-brand-story" placeholder="프로젝트가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.">' + escapeHtml(knowledge.brandStory) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>캐릭터/주체</span><textarea id="knowledge-brand-character" placeholder="대표 캐릭터, 화자, 말하는 주체를 적어 주세요.">' + escapeHtml(knowledge.brandCharacter) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>세계관/배경</span><textarea id="knowledge-world-setting" placeholder="작품 배경, 서비스 맥락, 브랜드 세계관을 적어 주세요.">' + escapeHtml(knowledge.worldSetting) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '<section class="knowledge-hub-panel">' +
      '<div class="knowledge-hub-panel-head"><h3>브랜드 규칙</h3><span>반드시 지켜야 할 운영 기준</span></div>' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>브랜드 규칙</span><textarea id="knowledge-brand-rules" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 캐릭터 말투는 존댓말을 유지한다.">' + escapeHtml(joinLines(knowledge.brandRules)) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>금지 표현</span><textarea id="knowledge-banned" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 선정적 표현 금지">' + escapeHtml(joinLines(knowledge.bannedExpressions)) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '<section class="knowledge-hub-panel">' +
      '<div class="knowledge-hub-panel-head"><h3>참조와 학습</h3><span>좋았던 레퍼런스와 성공 패턴</span></div>' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>참조 콘텐츠</span><textarea id="knowledge-references" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 인스타 릴스 15초 카드뉴스 톤">' + escapeHtml(joinLines(knowledge.referenceContents)) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>과거 성공 사례</span><textarea id="knowledge-success-cases" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 오전 9시 업로드한 짧은 문장형 게시물 반응이 좋았음">' + escapeHtml(joinLines(knowledge.successCases)) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '<section class="knowledge-hub-panel">' +
      '<div class="knowledge-hub-panel-head"><h3>현재 저장 구조</h3><span>다음 단계 연결용</span></div>' +
      '<div class="knowledge-hub-pill-grid">' +
      '<div class="knowledge-hub-pill"><span>규칙</span><strong>' + escapeHtml(rulesCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>금지 표현</span><strong>' + escapeHtml(bannedCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>참조</span><strong>' + escapeHtml(referencesCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>성공 사례</span><strong>' + escapeHtml(successesCount) + '개</strong></div>' +
      '</div>' +
      '<p class="knowledge-hub-help">여기 저장한 내용은 프로젝트 payload의 <code>knowledgeHub</code> 객체로 정규화됩니다. 다음 단계에서는 Brand Studio 생성 입력과 직접 연결합니다.</p>' +
      '</section>' +
      '</div>' +
      '<div class="knowledge-hub-toolbar">' +
      '<span>사용자는 프로젝트별로 브랜드 지식을 한 곳에서 관리하고, 이후 생성 단계에서 그대로 재사용할 수 있어야 합니다.</span>' +
      '<div class="knowledge-hub-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('brand.html', projectId)) + '">Brand Studio</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('library.html', projectId)) + '">Content Library</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenario.html', projectId)) + '">프리 프로덕션</a>' +
      '</div>' +
      '</div>' +
      '</section>';

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      var target = '';
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action === 'knowledge-open-library') target = buildStageUrl('library.html', projectId);
      else if (action === 'knowledge-open-brand') target = buildStageUrl('brand.html', projectId);
      else if (action === 'knowledge-save') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextKnowledge = {
          brandVoice: String((root.querySelector('#knowledge-brand-voice') || {}).value || '').trim(),
          brandStory: String((root.querySelector('#knowledge-brand-story') || {}).value || '').trim(),
          brandCharacter: String((root.querySelector('#knowledge-brand-character') || {}).value || '').trim(),
          worldSetting: String((root.querySelector('#knowledge-world-setting') || {}).value || '').trim(),
          brandRules: splitLines((root.querySelector('#knowledge-brand-rules') || {}).value || ''),
          bannedExpressions: splitLines((root.querySelector('#knowledge-banned') || {}).value || ''),
          referenceContents: splitLines((root.querySelector('#knowledge-references') || {}).value || ''),
          successCases: splitLines((root.querySelector('#knowledge-success-cases') || {}).value || '')
        };
        btn.disabled = true;
        NK.service.project.updatePayload(projectId, {
          knowledgeHub: nextKnowledge,
          brandVoice: nextKnowledge.brandVoice,
          brandStory: nextKnowledge.brandStory,
          brandCharacter: nextKnowledge.brandCharacter,
          brandRules: nextKnowledge.brandRules,
          bannedExpressions: nextKnowledge.bannedExpressions,
          referenceContents: nextKnowledge.referenceContents,
          successCases: nextKnowledge.successCases,
          worldSetting: nextKnowledge.worldSetting,
          knowledgeWorld: nextKnowledge.worldSetting
        })
          .then(function (result) {
            if (result && result.draft) renderProject(root, result.draft);
            alert('Knowledge Hub를 저장했습니다.');
          })
          .catch(function (err) {
            alert('Knowledge Hub 저장 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }

      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };
  }

  knowledgeHub.init = function () {
    var root = document.getElementById('knowledge-hub-root');
    if (!root) return;
    if (!NK.service || !NK.service.project) {
      renderEmpty(root, 'Knowledge Hub를 불러올 수 없습니다.');
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
