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

  function episodeLabel(project) {
    return String(project && (project.title || project.payload && project.payload.episodeTitle || project.seriesTitle || project.id) || '').trim() || '미지정 에피소드';
  }

  function readKnowledge(project) {
    if (project && project.brandId && !project.id) {
      return {
        brandVoice: String(project.brandVoice || '').trim(),
        brandStory: String(project.brandStory || '').trim(),
        brandCharacter: String(project.brandCharacter || '').trim(),
        worldSetting: String(project.worldSetting || project.knowledgeWorld || '').trim(),
        brandRules: Array.isArray(project.brandRules) ? project.brandRules.slice() : [],
        bannedExpressions: Array.isArray(project.bannedExpressions) ? project.bannedExpressions.slice() : [],
        referenceContents: Array.isArray(project.referenceContents) ? project.referenceContents.slice() : [],
        referenceItems: Array.isArray(project.referenceContentEntries) ? project.referenceContentEntries.slice() : [],
        successCases: Array.isArray(project.successCases) ? project.successCases.slice() : []
      };
    }
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
      referenceItems: [],
      successCases: []
    };
  }

  function referenceTypeLabel(type) {
    switch (String(type || '').trim()) {
      case 'video': return '영상';
      case 'image': return '이미지';
      case 'post': return '게시물';
      case 'channel': return '채널';
      case 'article': return '문서';
      default: return '참조';
    }
  }

  function buildReferenceDraft(root, knowledge) {
    var typeEl = root.querySelector('#knowledge-reference-type');
    var titleEl = root.querySelector('#knowledge-reference-title');
    var sourceEl = root.querySelector('#knowledge-reference-source');
    var noteEl = root.querySelector('#knowledge-reference-note');
    var nextItem = {
      id: 'ref_' + Date.now(),
      type: String((typeEl && typeEl.value) || 'reference').trim() || 'reference',
      title: String((titleEl && titleEl.value) || '').trim(),
      source: String((sourceEl && sourceEl.value) || '').trim(),
      note: String((noteEl && noteEl.value) || '').trim()
    };
    if (!nextItem.title && !nextItem.source && !nextItem.note) return null;
    return (knowledge.referenceItems || []).concat([nextItem]);
  }

  function readKnowledgeDraft(root, referenceItems) {
    var items = Array.isArray(referenceItems) ? referenceItems.slice() : [];
    return {
      brandVoice: String((root.querySelector('#knowledge-brand-voice') || {}).value || '').trim(),
      brandStory: String((root.querySelector('#knowledge-brand-story') || {}).value || '').trim(),
      brandCharacter: String((root.querySelector('#knowledge-brand-character') || {}).value || '').trim(),
      worldSetting: String((root.querySelector('#knowledge-world-setting') || {}).value || '').trim(),
      brandRules: splitLines((root.querySelector('#knowledge-brand-rules') || {}).value || ''),
      bannedExpressions: splitLines((root.querySelector('#knowledge-banned') || {}).value || ''),
      referenceItems: items,
      referenceContents: items.map(function (item) {
        return [item.type, item.title, item.note].filter(Boolean).join(' ');
      }).filter(Boolean),
      successCases: splitLines((root.querySelector('#knowledge-success-cases') || {}).value || '')
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

  function renderProject(root, project, brand) {
    var projectId = String(project && project.id || '').trim();
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    var payload = (project && project.payload) || {};
    var knowledge = readKnowledge(brand || project);
    var brandTitle = String(brand && brand.brandTitle || payload.brandTitle || project.seriesTitle || project.title || '브랜드').trim();
    var brandSummary = String(brand && brand.brandSummary || payload.brandSummary || '').trim();
    var currentEpisodeTitle = episodeLabel(project);
    var rulesCount = knowledge.brandRules.length;
    var bannedCount = knowledge.bannedExpressions.length;
    var referencesCount = (knowledge.referenceItems || []).length || knowledge.referenceContents.length;
    var successesCount = knowledge.successCases.length;
    function renderNext(nextProject) {
      var fallbackProject = nextProject && nextProject.id ? nextProject : project;
      var nextBrandId = String(fallbackProject && fallbackProject.payload && fallbackProject.payload.brandId || brandId).trim();
      var nextBrand = (NK.service && NK.service.brand && NK.service.brand.getById && nextBrandId)
        ? NK.service.brand.getById(nextBrandId)
        : null;
      renderProject(root, fallbackProject, nextBrand || brand);
    }
    function syncBrandAndProject(nextKnowledge) {
      var tasks = [];
      if (brandId && NK.service && NK.service.brand && NK.service.brand.update) {
        tasks.push(Promise.resolve().then(function () {
          return NK.service.brand.update(brandId, {
            brandVoice: nextKnowledge.brandVoice,
            brandStory: nextKnowledge.brandStory,
            brandCharacter: nextKnowledge.brandCharacter,
            worldSetting: nextKnowledge.worldSetting,
            brandRules: nextKnowledge.brandRules,
            bannedExpressions: nextKnowledge.bannedExpressions,
            referenceContents: nextKnowledge.referenceContents,
            referenceContentEntries: nextKnowledge.referenceItems,
            successCases: nextKnowledge.successCases
          });
        }));
      }
      if (NK.service && NK.service.project && NK.service.project.updatePayload) {
        tasks.push(NK.service.project.updatePayload(projectId, {
          knowledgeHub: nextKnowledge,
          brandVoice: nextKnowledge.brandVoice,
          brandStory: nextKnowledge.brandStory,
          brandCharacter: nextKnowledge.brandCharacter,
          brandRules: nextKnowledge.brandRules,
          bannedExpressions: nextKnowledge.bannedExpressions,
          referenceContents: nextKnowledge.referenceContents,
          referenceContentEntries: nextKnowledge.referenceItems,
          successCases: nextKnowledge.successCases,
          worldSetting: nextKnowledge.worldSetting,
          knowledgeWorld: nextKnowledge.worldSetting
        }));
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
    var referenceCards = (knowledge.referenceItems || []).length
      ? knowledge.referenceItems.map(function (item) {
        return (
          '<article class="knowledge-reference-card">' +
          '<div class="knowledge-reference-top">' +
          '<span class="knowledge-reference-badge">' + escapeHtml(referenceTypeLabel(item.type)) + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="knowledge-remove-reference" data-reference-id="' + escapeHtml(item.id) + '">삭제</button>' +
          '</div>' +
          '<strong>' + escapeHtml(item.title || '참조 콘텐츠') + '</strong>' +
          '<p>' + escapeHtml(item.note || item.source || '메모 없음') + '</p>' +
          (item.source ? '<a class="btn-secondary compact" href="' + escapeHtml(item.source) + '" target="_blank" rel="noopener noreferrer">열기</a>' : '') +
          '</article>'
        );
      }).join('')
      : '<div class="knowledge-reference-empty">아직 저장된 참조 콘텐츠가 없습니다.</div>';

    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero">' +
      '<div>' +
      '<p class="knowledge-hub-eyebrow">Knowledge Hub</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="knowledge-hub-description">' + escapeHtml(brandSummary || '브랜드 요약이 아직 없습니다. Knowledge Hub를 먼저 채우면 이후 생성 품질이 안정됩니다.') + '</p>' +
      '<p class="knowledge-hub-description">이 화면은 브랜드 공용 지식 저장소이며, 현재 연결된 에피소드는 ' + escapeHtml(currentEpisodeTitle) + '입니다.</p>' +
      '</div>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<button class="btn-secondary" data-action="knowledge-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="knowledge-open-brand">Brand Studio</button>' +
      '<button class="btn-primary" data-action="knowledge-save">Knowledge 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="knowledge-hub-summary-grid">' +
      '<article class="knowledge-hub-summary-card"><span>운영 브랜드</span><strong>' + escapeHtml(brandTitle || '-') + '</strong></article>' +
      '<article class="knowledge-hub-summary-card"><span>현재 연결 에피소드</span><strong>' + escapeHtml(currentEpisodeTitle) + '</strong></article>' +
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
      '<label class="knowledge-hub-field"><span>브랜드 스토리</span><textarea id="knowledge-brand-story" placeholder="브랜드/시리즈가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.">' + escapeHtml(knowledge.brandStory) + '</textarea></label>' +
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
      '<label class="knowledge-hub-field"><span>과거 성공 사례</span><textarea id="knowledge-success-cases" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 오전 9시 업로드한 짧은 문장형 게시물 반응이 좋았음">' + escapeHtml(joinLines(knowledge.successCases)) + '</textarea></label>' +
      '<div class="knowledge-hub-field knowledge-reference-builder">' +
      '<span>참조 콘텐츠 구조</span>' +
      '<div class="knowledge-reference-form">' +
      '<select id="knowledge-reference-type" class="knowledge-reference-input">' +
      '<option value="reference">참조</option>' +
      '<option value="video">영상</option>' +
      '<option value="image">이미지</option>' +
      '<option value="post">게시물</option>' +
      '<option value="channel">채널</option>' +
      '<option value="article">문서</option>' +
      '</select>' +
      '<input id="knowledge-reference-title" class="knowledge-reference-input" placeholder="참조 제목" />' +
      '<input id="knowledge-reference-source" class="knowledge-reference-input" placeholder="링크 또는 출처" />' +
      '<textarea id="knowledge-reference-note" class="knowledge-reference-textarea" placeholder="왜 참고하는지 메모를 남겨 주세요."></textarea>' +
      '<button type="button" class="btn-secondary" data-action="knowledge-add-reference">참조 추가</button>' +
      '</div>' +
      '<div class="knowledge-reference-grid">' + referenceCards + '</div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '<section class="knowledge-hub-panel">' +
      '<div class="knowledge-hub-panel-head"><h3>현재 저장 구조</h3><span>Brand Core 우선 저장</span></div>' +
      '<div class="knowledge-hub-pill-grid">' +
      '<div class="knowledge-hub-pill"><span>규칙</span><strong>' + escapeHtml(rulesCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>금지 표현</span><strong>' + escapeHtml(bannedCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>참조</span><strong>' + escapeHtml(referencesCount) + '개</strong></div>' +
      '<div class="knowledge-hub-pill"><span>성공 사례</span><strong>' + escapeHtml(successesCount) + '개</strong></div>' +
      '</div>' +
      '<p class="knowledge-hub-help">여기 저장한 내용은 Brand Core를 기준으로 저장되고, 기존 호환을 위해 현재 연결 에피소드 payload의 <code>knowledgeHub</code>에도 함께 반영됩니다. 다음 단계에서는 Brand Studio 생성 입력과 직접 연결합니다.</p>' +
      '</section>' +
      '</div>' +
      '<div class="knowledge-hub-toolbar">' +
      '<span>사용자는 브랜드 지식을 한 곳에서 관리하고, 이후 각 에피소드 운영 단계에서 그대로 재사용할 수 있어야 합니다.</span>' +
      '<div class="knowledge-hub-toolbar-actions">' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('brand.html', projectId, brandId)) + '">Brand Studio</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('library.html', projectId, brandId)) + '">Content Library</a>' +
      '<a class="btn-secondary compact" href="' + escapeHtml(buildStageUrl('scenario.html', projectId, brandId)) + '">프리 프로덕션</a>' +
      '</div>' +
      '</div>' +
      '</section>';

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      var target = '';
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action === 'knowledge-open-library') target = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'knowledge-open-brand') target = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'knowledge-save') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextKnowledge = readKnowledgeDraft(root, knowledge.referenceItems || []);
        btn.disabled = true;
        syncBrandAndProject(nextKnowledge)
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
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
      if (action === 'knowledge-add-reference') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextItems = buildReferenceDraft(root, knowledge);
        if (!nextItems) {
          alert('참조 제목, 출처, 메모 중 하나는 입력해 주세요.');
          return;
        }
        btn.disabled = true;
        syncBrandAndProject(readKnowledgeDraft(root, nextItems))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('참조 콘텐츠 추가 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      if (action === 'knowledge-remove-reference') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var removeId = String(btn.dataset.referenceId || '').trim();
        var remaining = (knowledge.referenceItems || []).filter(function (item) {
          return String(item.id || '') !== removeId;
        });
        btn.disabled = true;
        syncBrandAndProject(readKnowledgeDraft(root, remaining))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('참조 콘텐츠 삭제 실패: ' + (err && err.message ? err.message : err));
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
    if (!NK.service || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, 'Knowledge Hub를 불러올 수 없습니다.');
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
