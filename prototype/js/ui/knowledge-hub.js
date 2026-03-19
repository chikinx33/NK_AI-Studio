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

  function applyCurrentLocale() {
    if (!NK.ui || !NK.ui.common || !NK.ui.common.applyRuntimeLocale) return;
    var lang = NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
    NK.ui.common.applyRuntimeLocale(lang);
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

  function compactSentence(value, maxLength) {
    var text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    var limit = Number(maxLength) || 120;
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(limit - 1, 1)).trim() + '…';
  }

  function normalizeText(value) {
    return String(value || '').replace(/[<>]/g, '').trim();
  }

  function normalizeCharacterName(value) {
    return normalizeText(value).replace(/^@+/, '').trim();
  }

  function normalizeCharacterPersonality(value) {
    return normalizeText(value).replace(/\s+/g, ' ').trim();
  }

  function getRuntimeLang() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }

  function getCharacterUiText() {
    return getRuntimeLang() === 'en'
      ? {
        traitPlaceholder: 'Enter traits (optional)',
        empty: 'No registered characters.',
        detailHelp: 'Add a character first to show trait inputs here. You can leave them empty.'
      }
      : {
        traitPlaceholder: '성격 입력(선택)',
        empty: '등록된 캐릭터가 없습니다.',
        detailHelp: '캐릭터를 먼저 추가하면 각 성격 입력칸이 여기에 표시됩니다. 비워둬도 저장할 수 있습니다.'
      };
  }

  function getPageScrollContainer(node) {
    var current = node;
    while (current) {
      if (current.classList && current.classList.contains('main-body')) return current;
      current = current.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function scrollDisclosureIntoView(disclosure) {
    if (!disclosure || !disclosure.open) return;
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        var scroller = getPageScrollContainer(disclosure);
        var topMargin = 20;
        var bottomMargin = 20;
        var rect = disclosure.getBoundingClientRect();
        var scrollerRect = scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement
          ? { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight || 0 }
          : scroller.getBoundingClientRect();
        var deltaTop = rect.top - (scrollerRect.top + topMargin);
        var deltaBottom = rect.bottom - (scrollerRect.bottom - bottomMargin);
        var targetDelta = 0;
        if (deltaBottom > 0) {
          targetDelta = deltaBottom;
        }
        if (!targetDelta) return;
        if (scroller === document.body || scroller === document.documentElement || scroller === document.scrollingElement) {
          window.scrollBy({ top: targetDelta, behavior: 'smooth' });
          return;
        }
        scroller.scrollTo({ top: scroller.scrollTop + targetDelta, behavior: 'smooth' });
      });
    });
  }

  function bindDisclosureScroll(root) {
    var disclosures = root && root.querySelectorAll ? root.querySelectorAll('.knowledge-hub-disclosure') : [];
    Array.prototype.forEach.call(disclosures, function (disclosure) {
      disclosure.ontoggle = function () {
        if (!disclosure.open) return;
        scrollDisclosureIntoView(disclosure);
      };
    });
  }

  function getFieldPersistKey(field) {
    if (!field || !field.getAttribute) return '';
    return String(
      field.getAttribute('id') ||
      field.getAttribute('data-character-personality') ||
      ''
    ).trim();
  }

  function captureFieldScrollState(root) {
    var state = {};
    var fields = root && root.querySelectorAll
      ? root.querySelectorAll('textarea, input, select')
      : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      if (!key) return;
      var scrollTop = Number(field.scrollTop || 0);
      var scrollLeft = Number(field.scrollLeft || 0);
      if (scrollTop <= 0 && scrollLeft <= 0) return;
      state[key] = {
        scrollTop: scrollTop,
        scrollLeft: scrollLeft
      };
    });
    return state;
  }

  function restoreFieldScrollState(root, state) {
    if (!root || !state) return;
    var fields = root.querySelectorAll ? root.querySelectorAll('textarea, input, select') : [];
    Array.prototype.forEach.call(fields, function (field) {
      var key = getFieldPersistKey(field);
      var saved = key ? state[key] : null;
      if (!saved) return;
      field.scrollTop = Number(saved.scrollTop || 0);
      field.scrollLeft = Number(saved.scrollLeft || 0);
    });
  }

  function parseCharacterNoteEntries(value) {
    return String(value || '')
      .split(/\n+/)
      .map(function (line) {
        var raw = normalizeText(line).replace(/^[\-*•\s]+/, '');
        if (!raw) return null;
        if (/^(브랜드\s*화자|화자|speaker)$/i.test(raw)) return null;
        var m = raw.match(/^(@?[^\-–—:：()]{1,24}?)(?:\s*[\-–—:：]\s*(.*))?$/);
        if (!m) return null;
        var candidate = normalizeCharacterName(m[1]);
        if (!candidate || /[\.\!\?]/.test(candidate)) return null;
        return {
          displayName: candidate,
          personality: normalizeCharacterPersonality(m[2] || '')
        };
      })
      .filter(Boolean);
  }

  function extractCharacterNoteRemainder(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map(function (line) { return String(line || '').trim(); })
      .filter(Boolean)
      .filter(function (line) { return !parseCharacterNoteEntries(line)[0]; })
      .join('\n');
  }

  function normalizeCharacters(value, fallbackText) {
    var src = Array.isArray(value) ? value : [];
    var out = [];
    var seen = {};
    src.forEach(function (item, index) {
      var raw = item && typeof item === 'object' ? item : { displayName: item };
      var displayName = normalizeCharacterName(raw.displayName || raw.name || raw.token);
      if (!displayName) return;
      var token = '@' + displayName;
      var key = token.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        characterId: normalizeText(raw.characterId || raw.id) || ('char_' + String(index + 1).padStart(3, '0')),
        displayName: displayName,
        token: token,
        personality: normalizeCharacterPersonality(raw.personality || raw.description || raw.profile || raw.note || '')
      });
    });
    if (out.length) return out;
    return parseCharacterNoteEntries(fallbackText).map(function (item, index) {
      return {
        characterId: 'char_' + String(index + 1).padStart(3, '0'),
        displayName: item.displayName,
        token: '@' + item.displayName,
        personality: item.personality
      };
    });
  }

  function serializeCharacterNotes(list) {
    return normalizeCharacters(list).map(function (item) {
      return '• ' + item.displayName + (item.personality ? (' - ' + item.personality) : ' - ');
    }).join('\n');
  }

  function renderCharacterRows(list) {
    var uiText = getCharacterUiText();
    var normalized = normalizeCharacters(list);
    if (!normalized.length) {
      return '<p class="scenario-character-empty">' + escapeHtml(uiText.empty) + '</p>';
    }
    return normalized.map(function (item) {
      return (
        '<label class="knowledge-character-row" data-character-id="' + escapeHtml(item.characterId) + '">' +
        '<span class="knowledge-character-chip" data-character-token="' + escapeHtml(item.token) + '">' +
        '<span>' + escapeHtml(item.token) + '</span>' +
        '<button type="button" class="knowledge-character-remove" data-action="knowledge-remove-character" data-character-token="' + escapeHtml(item.token) + '" aria-label="캐릭터 삭제">×</button>' +
        '</span>' +
        '<input type="text" class="knowledge-character-personality" data-character-personality="' + escapeHtml(item.characterId) + '" value="' + escapeHtml(item.personality || '') + '" placeholder="' + escapeHtml(uiText.traitPlaceholder) + '" />' +
        '</label>'
      );
    }).join('');
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
        characters: normalizeCharacters(project.knowledgeCharacters, project.brandCharacter),
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
      characters: [],
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

  function readKnowledgeDraft(root, referenceItems, characters, characterExtras) {
    var items = Array.isArray(referenceItems) ? referenceItems.slice() : [];
    var normalizedCharacters = normalizeCharacters(characters);
    var characterDescription = [serializeCharacterNotes(normalizedCharacters), String(characterExtras || '').trim()].filter(Boolean).join('\n');
    return {
      brandVoice: String((root.querySelector('#knowledge-brand-voice') || {}).value || '').trim(),
      brandStory: String((root.querySelector('#knowledge-brand-story') || {}).value || '').trim(),
      brandCharacter: characterDescription,
      characters: normalizedCharacters,
      knowledgeCharacters: normalizedCharacters,
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

  function buildStarterKnowledge(knowledge, project, brandTitle, brandSummary) {
    var payload = (project && project.payload) || {};
    var next = Object.assign({}, knowledge || {});
    var target = String(payload.targetAudience || payload.target || '').trim();
    var coreMessage = String(payload.coreMessage || '').trim();
    next.brandVoice = next.brandVoice || [
      target ? (target + '에게') : '',
      '짧고 명확하게 설명하되 과장하지 않는다.'
    ].filter(Boolean).join(' ');
    next.brandStory = next.brandStory || compactSentence(brandSummary || coreMessage || (brandTitle + '의 핵심 메시지를 중심으로 운영합니다.'), 120);
    next.worldSetting = next.worldSetting || compactSentence([
      brandTitle,
      coreMessage ? ('핵심 메시지: ' + coreMessage) : '',
      target ? ('주요 타깃: ' + target) : ''
    ].filter(Boolean).join(' · '), 140);
    next.brandRules = next.brandRules && next.brandRules.length ? next.brandRules : [
      '핵심 메시지에서 벗어나는 과장 표현을 줄인다.',
      '브랜드 말투와 어휘를 일관되게 유지한다.',
      '사용자가 바로 이해할 수 있는 문장으로 정리한다.'
    ];
    next.bannedExpressions = next.bannedExpressions && next.bannedExpressions.length ? next.bannedExpressions : [];
    next.successCases = next.successCases && next.successCases.length ? next.successCases : [];
    return next;
  }

  function renderEmpty(root, message) {
    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero empty">' +
      '<h2>브랜드 허브</h2>' +
      '<p>' + escapeHtml(message || '먼저 프로젝트를 선택해 주세요.') + '</p>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<a class="btn-primary" href="dashboard.html">대시보드로 이동</a>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
  }

  function renderProject(root, project, brand) {
    var preservedFieldScroll = captureFieldScrollState(root);
    var projectId = String(project && project.id || '').trim();
    var brandId = String(brand && brand.brandId || project && project.payload && project.payload.brandId || '').trim();
    var payload = (project && project.payload) || {};
    var knowledge = readKnowledge(brand || project);
    knowledge.characters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);
    var characterUiText = getCharacterUiText();
    var characterExtras = extractCharacterNoteRemainder(knowledge.brandCharacter);
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
            knowledgeCharacters: nextKnowledge.characters,
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
          knowledgeCharacters: nextKnowledge.characters,
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
    var contentItems = (NK.service && NK.service.contentLibrary && NK.service.contentLibrary.listProjectContents)
      ? NK.service.contentLibrary.listProjectContents(brand || project)
      : [];
    var characters = Array.isArray(brand && brand.brandCharacters) ? brand.brandCharacters : [];
    
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
    var mediaCount = contentItems.filter(function (item) {
      var type = String(item && item.type || '').trim();
      return type === 'image' || type === 'video';
    }).length;
    var knowledgeHeroPills = [
      { label: '운영 브랜드', value: brandTitle || '-' },
      { label: '현재 에피소드', value: currentEpisodeTitle },
      { label: '저장된 규칙', value: (rulesCount + bannedCount) + '개' },
      { label: '캐릭터', value: knowledge.characters.length ? (knowledge.characters.length + '명') : '아직 없음' }
    ].map(function (item) {
      return '<span class="studio-hero-pill"><em>' + escapeHtml(item.label) + '</em><strong>' + escapeHtml(item.value) + '</strong></span>';
    }).join('');
    var knowledgeHeroStats = [
      {
        label: '브랜드 규칙',
        value: rulesCount + '개'
      },
      {
        label: '금지 표현',
        value: bannedCount + '개'
      },
      {
        label: '참조 / 성공 패턴',
        value: String(referencesCount + successesCount) + '개'
      },
      {
        label: '연결 자산',
        value: mediaCount + '개'
      }
    ].map(function (item) {
      return (
        '<article class="studio-kpi-card">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '</article>'
      );
    }).join('');
    var knowledgeContextSummary = [
      {
        label: 'AI 기본 문맥',
        value: knowledge.brandVoice ? '톤&매너 설정됨' : '톤 정리 필요',
        detail: knowledge.brandVoice || 'AI가 계속 참고할 말투와 표현 원칙이 아직 없습니다.'
      },
      {
        label: '브랜드 스토리',
        value: knowledge.brandStory ? '브랜드 서사 입력됨' : '스토리 보강 필요',
        detail: knowledge.brandStory || '왜 존재하는지, 어떤 세계를 다루는지 요약해 주세요.'
      },
      {
        label: '세계관 / 배경',
        value: knowledge.worldSetting ? '배경 정의됨' : '배경 정의 필요',
        detail: knowledge.worldSetting || '배경 문맥이 비어 있으면 결과물이 쉽게 흔들립니다.'
      },
      {
        label: '캐릭터 운영',
        value: knowledge.characters.length ? (knowledge.characters.length + '명 관리 중') : '캐릭터 등록 필요',
        detail: knowledge.characters.length ? '캐릭터 토큰과 성격이 자산 목록과 개요에 반영됩니다.' : characterUiText.detailHelp
      }
    ].map(function (item) {
      return (
        '<article class="knowledge-hub-context-item">' +
        '<span>' + escapeHtml(item.label) + '</span>' +
        '<strong>' + escapeHtml(item.value) + '</strong>' +
        '<p>' + escapeHtml(item.detail) + '</p>' +
        '</article>'
      );
    }).join('');

    root.innerHTML =
      '<section class="knowledge-hub-page">' +
      '<div class="knowledge-hub-hero">' +
      '<div class="studio-page-hero-main">' +
      '<p class="knowledge-hub-eyebrow">브랜드 허브</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="knowledge-hub-description">' + escapeHtml(brandSummary || '브랜드 요약이 아직 없습니다. 브랜드 허브를 먼저 채우면 이후 생성 품질이 안정됩니다.') + '</p>' +
      '<div class="studio-hero-pill-row">' + knowledgeHeroPills + '</div>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<button class="btn-secondary" data-action="knowledge-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="knowledge-open-brand">Brand Studio</button>' +
      '<button class="btn-secondary" data-action="knowledge-apply-starter">기본값 채우기</button>' +
      '<button class="btn-secondary" data-action="knowledge-save-and-open-brand">저장 후 Brand Studio</button>' +
      '<button class="btn-primary" data-action="knowledge-save">브랜드 허브 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="studio-page-hero-side"><div class="studio-kpi-grid">' + knowledgeHeroStats + '</div></div>' +
      '</div>' +
      '<div class="knowledge-hub-context-bar">' + knowledgeContextSummary + '</div>' +
      '<div class="knowledge-hub-workspace">' +
      '<div class="knowledge-hub-main">' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>브랜드 정체성</strong><span>AI가 계속 참고할 기본 문맥</span></div><span class="knowledge-hub-disclosure-meta">핵심 4개 필드</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>톤&매너</span><textarea id="knowledge-brand-voice" placeholder="예: 따뜻하지만 과장하지 않고, 짧고 명확하게 말한다.">' + escapeHtml(knowledge.brandVoice) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>브랜드 스토리</span><textarea id="knowledge-brand-story" placeholder="브랜드/시리즈가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.">' + escapeHtml(knowledge.brandStory) + '</textarea></label>' +
      '<label class="knowledge-hub-field knowledge-hub-field-fill"><span>세계관/배경</span><textarea id="knowledge-world-setting" placeholder="작품 배경, 서비스 맥락, 브랜드 세계관을 적어 주세요.">' + escapeHtml(knowledge.worldSetting) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>브랜드 규칙</strong><span>반드시 지켜야 할 운영 기준</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(rulesCount + bannedCount) + '개 항목</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>브랜드 규칙</span><textarea id="knowledge-brand-rules" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 캐릭터 말투는 존댓말을 유지한다.">' + escapeHtml(joinLines(knowledge.brandRules)) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>금지 표현</span><textarea id="knowledge-banned" placeholder="한 줄에 하나씩 입력해 주세요.&#10;예: 선정적 표현 금지">' + escapeHtml(joinLines(knowledge.bannedExpressions)) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</div>' +
      '<div class="knowledge-hub-side">' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>캐릭터 자산</strong><span>브랜드 공용 캐릭터 레코드</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(String(characters.length) + '명') + '</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-field knowledge-character-field"><span>캐릭터</span>' +
      '<input id="knowledge-character-input" class="knowledge-character-input" placeholder="캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)" />' +
      '<div id="knowledge-character-chips" class="knowledge-character-chips">' + renderCharacterRows(knowledge.characters) + '</div>' +
      '<p class="knowledge-character-help">@토큰 형식으로 저장되며 캐릭터 자산 목록과 개요에 반영됩니다. ' + escapeHtml(characterUiText.detailHelp) + '</p></div>' +
      '<div class="brand-publish-summary" style="margin-top:10px;">' +
      '<button class="btn-primary" data-action="knowledge-open-ip-library">IP 라이브러리</button>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure">' +
      '<summary><div><strong>참조와 학습</strong><span>좋았던 레퍼런스와 성공 패턴</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(referencesCount + successesCount) + '개 데이터</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
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
      '<div class="knowledge-reference-grid knowledge-reference-grid-scrollable">' + referenceCards + '</div>' +
      '</div>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</div>' +
      '</div>' +
      '</section>';
    applyCurrentLocale();
    restoreFieldScrollState(root, preservedFieldScroll);

    var currentCharacters = normalizeCharacters(knowledge.characters, knowledge.brandCharacter);

    function syncCharacterUi() {
      var chipBox = root.querySelector('#knowledge-character-chips');
      if (chipBox) chipBox.innerHTML = renderCharacterRows(currentCharacters);
    }

    function addCharacter(name) {
      var displayName = normalizeCharacterName(name);
      if (!displayName) return false;
      var token = '@' + displayName;
      var exists = currentCharacters.some(function (item) {
        return String(item.token || '').toLowerCase() === token.toLowerCase();
      });
      if (exists) return false;
      currentCharacters.push({
        characterId: 'char_' + String(Date.now()),
        displayName: displayName,
        token: token,
        personality: ''
      });
      syncCharacterUi();
      return true;
    }

    function openIpLibrary(items, onSelect) {
      var modal = document.getElementById('lib-modal');
      if (!modal) return;
      var box = modal.querySelector('.lib-content');
      var selected = null;
      if (!box) return;
      if (!items || !items.length) {
        box.innerHTML = '<div class="lib-header" style="display:flex;align-items:center;gap:8px; margin-bottom:12px;"><span class="lib-title" style="font-weight:600;">라이브러리</span><div style="flex:1;"></div><button class="btn-primary" id="lib-use-btn" disabled>사용</button><button class="btn-ghost" id="lib-delete-btn" disabled>삭제</button><button class="btn-secondary lib-close-btn" id="lib-close">닫기</button></div><div class="lib-empty"><p class="muted">항목이 없습니다.</p></div>';
        var closeBtn0 = box.querySelector('#lib-close'); if (closeBtn0) closeBtn0.onclick = function(){ modal.classList.add('hidden'); };
        modal.classList.remove('hidden');
        return;
      }
      var listHtml = items.map(function (it) {
        var name = it.name || '';
        var url = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(name) : '';
        return '<div class="lib-item" data-url="' + url + '" data-name="' + name + '" style="background:none;box-shadow:none;"><img class="lib-thumb" src="' + url + '" alt="" /></div>';
      }).join('');
      box.innerHTML = '<div class="lib-header" style="display:flex;align-items:center;gap:8px; margin-bottom:12px;"><span class="lib-title" style="font-weight:600;">라이브러리</span><div style="flex:1;"></div><button class="btn-primary" id="lib-use-btn" disabled>사용</button><button class="btn-ghost" id="lib-delete-btn" disabled>삭제</button><button class="btn-secondary lib-close-btn" id="lib-close">닫기</button></div><div class="lib-grid">' + listHtml + '</div>';
      var itemsEls = box.querySelectorAll('.lib-item');
      itemsEls.forEach(function (el) {
        el.onclick = function () {
          var already = el.classList.contains('lib-selected');
          itemsEls.forEach(function (x) { x.classList.remove('lib-selected', 'selected'); });
          if (already) { selected = null; }
          else { el.classList.add('lib-selected'); selected = { url: el.dataset.url, name: el.dataset.name }; }
          updateActions();
        };
      });
      var useBtn = box.querySelector('#lib-use-btn');
      var delBtn = box.querySelector('#lib-delete-btn');
      function updateActions() {
        var active = !!(selected && selected.url);
        if (useBtn) { useBtn.disabled = !active; useBtn.classList.toggle('disabled', !active); }
        if (delBtn) { delBtn.disabled = !active; delBtn.classList.toggle('disabled', !active); }
      }
      if (useBtn) useBtn.onclick = function () {
        if (!selected || !selected.url) { alert('이미지를 먼저 선택하세요.'); return; }
        if (onSelect) onSelect(selected);
        modal.classList.add('hidden');
      };
      if (delBtn) delBtn.onclick = async function () {
        if (!selected || !selected.name) { alert('삭제할 이미지를 선택하세요.'); return; }
        var pid = projectId;
        try {
          var res = await NK.api.projectDelete(pid, selected.name);
          if (!res.ok || !res.data || Number(res.data.deletedCount || 0) < 1) throw new Error('delete_failed');
          var left = items.filter(function (it) { return it.name !== selected.name; });
          openIpLibrary(left, onSelect);
        } catch (err) {
          alert('삭제 실패: ' + (err && err.message ? err.message : err));
        }
      };
      var closeBtn = box.querySelector('#lib-close'); if (closeBtn) closeBtn.onclick = function(){ modal.classList.add('hidden'); };
      modal.classList.remove('hidden');
    }

    root.onclick = function (evt) {
      var btn = evt.target && evt.target.closest ? evt.target.closest('[data-action]') : null;
      var target = '';
      if (!btn) return;
      var action = String(btn.dataset.action || '').trim();
      if (action === 'knowledge-open-library') target = buildStageUrl('library.html', projectId, brandId);
      else if (action === 'knowledge-open-brand') target = buildStageUrl('brand.html', projectId, brandId);
      else if (action === 'knowledge-open-ip-library') {
        var pid = projectId;
        if (!pid) { alert('프로젝트가 선택되지 않았습니다.'); return; }
        btn.disabled = true;
        Promise.resolve().then(function(){ return NK.api.libraryIP(pid); })
          .then(function (resp) {
            var items = Array.isArray(resp && resp.items) ? resp.items : [];
            if (!items.length && NK.api && NK.api.projectInit) {
              return NK.api.projectInit(pid).then(function(){ return NK.api.libraryIP(pid); });
            }
            return resp;
          })
          .then(function (resp2) {
            var items = Array.isArray(resp2 && resp2.items) ? resp2.items : [];
            openIpLibrary(items, function (sel) {
              var ref = { id: 'ref_' + Date.now(), type: 'image', title: sel.name.split('/').pop(), source: sel.name, note: '' };
              var nextItems = (knowledge.referenceItems || []).concat([ref]);
              var nextKnowledge = Object.assign({}, knowledge, { referenceItems: nextItems });
              return syncBrandAndProject(nextKnowledge).then(function (result) {
                if (result && result.draft) renderNext(result.draft);
              });
            });
          })
          .catch(function (err) {
            alert('Content Library를 불러올 수 없습니다.');
          })
          .finally(function () { btn.disabled = false; });
        return;
      }
      else if (action === 'knowledge-apply-starter') {
        btn.disabled = true;
        syncBrandAndProject(buildStarterKnowledge(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras), project, brandTitle, brandSummary))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
          })
          .catch(function (err) {
            alert('기본값 채우기 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      else if (action === 'knowledge-save-and-open-brand') {
        btn.disabled = true;
        syncBrandAndProject(readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras))
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            var nextTarget = buildStageUrl('brand.html', projectId, brandId);
            if (window.self !== window.top && window.parent) {
              window.parent.postMessage({ type: 'load-stage', url: nextTarget }, '*');
            } else {
              window.location.href = nextTarget;
            }
          })
          .catch(function (err) {
            alert('저장 후 이동 실패: ' + (err && err.message ? err.message : err));
          })
          .finally(function () {
            btn.disabled = false;
          });
        return;
      }
      // 캐릭터 카드 제거에 따라 비활성화 토글 버튼도 제거됨
      else if (action === 'knowledge-save') {
        if (!NK.service || !NK.service.project || !NK.service.project.updatePayload) return;
        var nextKnowledge = readKnowledgeDraft(root, knowledge.referenceItems || [], currentCharacters, characterExtras);
        btn.disabled = true;
        syncBrandAndProject(nextKnowledge)
          .then(function (result) {
            if (result && result.draft) renderNext(result.draft);
            alert('브랜드 허브를 저장했습니다.');
          })
          .catch(function (err) {
            alert('브랜드 허브 저장 실패: ' + (err && err.message ? err.message : err));
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
        syncBrandAndProject(readKnowledgeDraft(root, nextItems, currentCharacters, characterExtras))
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
        syncBrandAndProject(readKnowledgeDraft(root, remaining, currentCharacters, characterExtras))
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
      if (action === 'knowledge-remove-character') {
        var removeToken = String(btn.dataset.characterToken || '').trim().toLowerCase();
        if (!removeToken) return;
        currentCharacters = currentCharacters.filter(function (item) {
          return String(item.token || '').trim().toLowerCase() !== removeToken;
        });
        syncCharacterUi();
        return;
      }

      if (!target) return;
      if (window.self !== window.top && window.parent) {
        window.parent.postMessage({ type: 'load-stage', url: target }, '*');
      } else {
        window.location.href = target;
      }
    };

    root.onkeydown = function (evt) {
      var targetEl = evt.target;
      if (!targetEl || targetEl.id !== 'knowledge-character-input') return;
      if (evt.key !== 'Enter') return;
      evt.preventDefault();
      var raw = String(targetEl.value || '');
      if (addCharacter(raw)) {
        targetEl.value = '';
        var nameOnly = normalizeCharacterName(raw);
        var trig = nameOnly ? ('@' + nameOnly) : '';
        if (nameOnly && trig) {
          var exists = (Array.isArray(characters) ? characters : []).some(function (c) { return String(c.trigger || '').toLowerCase() === trig.toLowerCase(); });
          if (!exists && brandId && NK.service && NK.service.brand && NK.service.brand.update) {
            var nextList = (Array.isArray(characters) ? characters.slice() : []);
            nextList.unshift({
              id: 'char_' + Date.now(),
              trigger: trig,
              name: nameOnly,
              aliases: [],
              mainAssetId: '',
              referenceAssetIds: [],
              description: '',
              fixedTraits: [],
              bannedTraits: [],
              defaultPromptPrefix: 'Keep character identity consistent.',
              styleGuide: '',
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            NK.service.brand.update(brandId, { brandCharacters: nextList }).then(function(){ renderNext(project); }).catch(function(){});
          }
        }
      }
    };

    root.oninput = function (evt) {
      var targetEl = evt.target;
      if (!targetEl || !targetEl.matches || !targetEl.matches('[data-character-personality]')) return;
      var characterId = String(targetEl.getAttribute('data-character-personality') || '').trim();
      currentCharacters = normalizeCharacters(currentCharacters).map(function (item) {
        if (String(item.characterId) !== characterId) return item;
        return Object.assign({}, item, {
          personality: normalizeCharacterPersonality(targetEl.value || '')
        });
      });
    };

    bindDisclosureScroll(root);
  }

  knowledgeHub.init = function () {
    var root = document.getElementById('knowledge-hub-root');
    if (!root) return;
    if (!NK.service || !NK.service.project || !NK.service.brand) {
      renderEmpty(root, '브랜드 허브를 불러올 수 없습니다.');
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
