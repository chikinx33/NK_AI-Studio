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
    var assetMap = {};
    contentItems.forEach(function (it) { assetMap[String(it.id || '')] = it; });
    var characters = Array.isArray(brand && brand.brandCharacters) ? brand.brandCharacters : [];
    var characterCards = characters.length
      ? characters.map(function (c) {
        var mainAsset = assetMap[String(c.mainAssetId || '')];
        var img = mainAsset && mainAsset.url ? ('<img class="chip-thumb" src="' + escapeHtml(mainAsset.url) + '" alt="" />') : '';
        var missingNote = (!mainAsset && String(c.mainAssetId || '').trim()) ? '<span class="knowledge-badge" style="margin-left:6px;color:#ff9;">대표 이미지 누락</span>' : '';
        return (
          '<article class="knowledge-reference-card">' +
          '<div class="knowledge-reference-top">' +
          '<span class="knowledge-reference-badge">' + escapeHtml(c.trigger || '@') + '</span>' +
          '<button type="button" class="btn-secondary compact" data-action="char-edit" data-char-id="' + escapeHtml(c.id) + '">수정</button>' +
          '<button type="button" class="btn-secondary compact" data-action="char-deactivate" data-char-id="' + escapeHtml(c.id) + '">' + (c.isActive ? '비활성화' : '활성화') + '</button>' +
          '</div>' +
          '<strong>' + (img ? img + ' ' : '') + escapeHtml(c.name || c.trigger || '캐릭터') + '</strong>' +
          '<p>' + escapeHtml(c.description || (Array.isArray(c.fixedTraits) && c.fixedTraits.length ? c.fixedTraits.join(', ') : '') || '설명 없음') + '</p>' +
          (missingNote || '') +
          '</article>'
        );
      }).join('')
      : '<div class="knowledge-reference-empty">등록된 캐릭터가 없습니다.</div>';
    var assetOptions = contentItems
      .filter(function (it) { return it.type === 'image' || it.type === 'video'; })
      .map(function (it) {
        var label = (it.type === 'image' ? '이미지 ' : '영상 ') + (it.title || it.id);
        return '<option value="' + escapeHtml(String(it.id || '')) + '">' + escapeHtml(label) + '</option>';
      }).join('');
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
      '<p class="knowledge-hub-eyebrow">브랜드 허브</p>' +
      '<h2>' + escapeHtml(brandTitle) + '</h2>' +
      '<p class="knowledge-hub-description">' + escapeHtml(brandSummary || '브랜드 요약이 아직 없습니다. 브랜드 허브를 먼저 채우면 이후 생성 품질이 안정됩니다.') + '</p>' +
      '</div>' +
      '<div class="knowledge-hub-hero-actions">' +
      '<button class="btn-secondary" data-action="knowledge-open-library">Content Library</button>' +
      '<button class="btn-secondary" data-action="knowledge-open-brand">Brand Studio</button>' +
      '<button class="btn-primary" data-action="knowledge-save">브랜드 허브 저장</button>' +
      '</div>' +
      '</div>' +
      '<div class="knowledge-hub-context-bar">' +
      '<div class="knowledge-hub-context-item"><strong>' + escapeHtml('운영 브랜드 · ' + (brandTitle || '-')) + '</strong></div>' +
      '<div class="knowledge-hub-context-item"><strong>' + escapeHtml('현재 기준 에피소드 · ' + currentEpisodeTitle) + '</strong></div>' +
      '<div class="knowledge-hub-context-item"><strong>' + escapeHtml('브랜드 규칙 · ' + rulesCount + '개') + '</strong></div>' +
      '<div class="knowledge-hub-context-item"><strong>' + escapeHtml('참조 콘텐츠 · ' + referencesCount + '개') + '</strong></div>' +
      '</div>' +
      '<div class="knowledge-hub-workspace">' +
      '<div class="knowledge-hub-main">' +
      '<details class="knowledge-hub-disclosure" open>' +
      '<summary><div><strong>브랜드 정체성</strong><span>AI가 계속 참고할 기본 문맥</span></div><span class="knowledge-hub-disclosure-meta">핵심 4개 필드</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-hub-form-grid">' +
      '<label class="knowledge-hub-field"><span>톤&매너</span><textarea id="knowledge-brand-voice" placeholder="예: 따뜻하지만 과장하지 않고, 짧고 명확하게 말한다.">' + escapeHtml(knowledge.brandVoice) + '</textarea></label>' +
      '<label class="knowledge-hub-field"><span>브랜드 스토리</span><textarea id="knowledge-brand-story" placeholder="브랜드/시리즈가 왜 존재하는지, 어떤 세계를 다루는지 적어 주세요.">' + escapeHtml(knowledge.brandStory) + '</textarea></label>' +
      '<div class="knowledge-hub-field knowledge-character-field"><span>캐릭터</span>' +
      '<input id="knowledge-character-input" class="knowledge-character-input" placeholder="캐릭터 이름 입력 후 Enter (예: @네모 또는 네모)" />' +
      '<div id="knowledge-character-chips" class="knowledge-character-chips">' + renderCharacterRows(knowledge.characters) + '</div>' +
      '<p class="knowledge-character-help">@토큰 형식으로 저장되며 개요의 캐릭터 항목에 자동 등록됩니다. ' + escapeHtml(characterUiText.detailHelp) + '</p></div>' +
      '<label class="knowledge-hub-field knowledge-hub-field-fill"><span>세계관/배경</span><textarea id="knowledge-world-setting" placeholder="작품 배경, 서비스 맥락, 브랜드 세계관을 적어 주세요.">' + escapeHtml(knowledge.worldSetting) + '</textarea></label>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure" open>' +
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
      '<details class="knowledge-hub-disclosure" open>' +
      '<summary><div><strong>캐릭터 자산</strong><span>브랜드 공용 캐릭터 레코드</span></div><span class="knowledge-hub-disclosure-meta">' + escapeHtml(String(characters.length) + '명') + '</span></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<div class="knowledge-reference-grid knowledge-reference-grid-scrollable">' + characterCards + '</div>' +
      '<div class="brand-publish-summary" style="margin-top:10px;">' +
      '<button class="btn-primary" data-action="char-open-new">캐릭터 추가</button>' +
      '</div>' +
      '<details class="knowledge-hub-disclosure" id="char-form-box">' +
      '<summary><div><strong>캐릭터 추가/수정</strong><span>trigger는 @필수, 대표 이미지 없으면 경고</span></div></summary>' +
      '<div class="knowledge-hub-disclosure-body">' +
      '<section class="knowledge-hub-panel knowledge-hub-panel-embedded">' +
      '<input type="hidden" id="char-id" />' +
      '<div class="brand-publish-fields">' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">이름</span><input id="char-name" class="brand-publish-input" placeholder="예: 세모" /></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">호출명(@)</span><input id="char-trigger" class="brand-publish-input" placeholder="@세모" /></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">별칭</span><input id="char-aliases" class="brand-publish-input" placeholder="쉼표로 구분" /></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">대표 이미지</span><select id="char-main-asset" class="brand-publish-input"><option value="">선택 안 함</option>' + assetOptions + '</select></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">참조 자산(다중)</span><select id="char-ref-assets" class="brand-publish-input" multiple size="5">' + assetOptions + '</select></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">설명</span><textarea id="char-desc" class="brand-caption-textarea" placeholder="캐릭터 설명"></textarea></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">고정 요소</span><textarea id="char-fixed" class="brand-caption-textarea" placeholder="쉼표/줄바꿈으로 여러 개 입력"></textarea></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">금지 요소</span><textarea id="char-banned" class="brand-caption-textarea" placeholder="쉼표/줄바꿈으로 여러 개 입력"></textarea></div>' +
      '<div class="brand-publish-field"><span class="brand-caption-meta-label">스타일 가이드</span><textarea id="char-style" class="brand-caption-textarea" placeholder=""></textarea></div>' +
      '<div class="brand-publish-field"><label class="brand-caption-meta-label"><input type="checkbox" id="char-active" checked /> 활성</label></div>' +
      '</div>' +
      '<div class="brand-caption-actions">' +
      '<button class="btn-primary" data-action="char-save">저장</button>' +
      '<button class="btn-secondary" data-action="char-cancel">취소</button>' +
      '</div>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '</section>' +
      '</div>' +
      '</details>' +
      '<details class="knowledge-hub-disclosure" open>' +
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
      '<button type="button" class="btn-primary" data-action="knowledge-open-ip-library">IP 라이브러리</button>' +
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
      else if (action === 'char-open-new') {
        var box = root.querySelector('#char-form-box');
        if (box && !box.open) box.open = true;
        ['char-id','char-name','char-trigger','char-aliases','char-main-asset','char-desc','char-fixed','char-banned','char-style'].forEach(function(id){ var el = root.querySelector('#'+id); if (el) el.value = ''; });
        var refSel = root.querySelector('#char-ref-assets'); if (refSel) { Array.from(refSel.options).forEach(function(o){ o.selected = false; }); }
        var act = root.querySelector('#char-active'); if (act) act.checked = true;
        return;
      }
      else if (action === 'char-edit') {
        var cid = String(btn.dataset.charId || '').trim();
        var row = characters.find(function (c) { return String(c.id) === cid; }) || null;
        if (!row) return;
        var box2 = root.querySelector('#char-form-box');
        if (box2 && !box2.open) box2.open = true;
        var set = function (id, v) { var el = root.querySelector('#' + id); if (el) el.value = String(v || ''); };
        set('char-id', row.id);
        set('char-name', row.name || '');
        set('char-trigger', row.trigger || '');
        set('char-aliases', (Array.isArray(row.aliases) ? row.aliases.join(', ') : ''));
        set('char-main-asset', row.mainAssetId || '');
        set('char-desc', row.description || '');
        set('char-fixed', (Array.isArray(row.fixedTraits) ? row.fixedTraits.join(', ') : ''));
        set('char-banned', (Array.isArray(row.bannedTraits) ? row.bannedTraits.join(', ') : ''));
        set('char-style', row.styleGuide || '');
        var refSel2 = root.querySelector('#char-ref-assets');
        if (refSel2) {
          Array.from(refSel2.options).forEach(function (o){ o.selected = (Array.isArray(row.referenceAssetIds) ? row.referenceAssetIds : []).indexOf(String(o.value)) >= 0; });
        }
        var act2 = root.querySelector('#char-active'); if (act2) act2.checked = !!row.isActive;
        return;
      }
      else if (action === 'char-cancel') {
        var box3 = root.querySelector('#char-form-box');
        if (box3 && box3.open) box3.open = false;
        return;
      }
      else if (action === 'char-deactivate') {
        var dcid = String(btn.dataset.charId || '').trim();
        if (!brandId || !dcid || !NK.service || !NK.service.brand || !NK.service.brand.update) return;
        var nextList = characters.map(function (c) {
          if (String(c.id) !== dcid) return c;
          return Object.assign({}, c, { isActive: !c.isActive, updatedAt: new Date().toISOString() });
        });
        btn.disabled = true;
        NK.service.brand.update(brandId, { brandCharacters: nextList })
          .then(function () { renderNext(project); })
          .catch(function (err) { alert('상태 변경 실패: ' + (err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
      else if (action === 'char-save') {
        if (!brandId || !NK.service || !NK.service.brand || !NK.service.brand.update) return;
        var idEl = root.querySelector('#char-id');
        var nameEl = root.querySelector('#char-name');
        var triggerEl = root.querySelector('#char-trigger');
        var aliasesEl = root.querySelector('#char-aliases');
        var mainEl = root.querySelector('#char-main-asset');
        var refSelEl = root.querySelector('#char-ref-assets');
        var descEl = root.querySelector('#char-desc');
        var fixedEl = root.querySelector('#char-fixed');
        var bannedEl = root.querySelector('#char-banned');
        var styleEl = root.querySelector('#char-style');
        var activeEl = root.querySelector('#char-active');
        var cid2 = String((idEl && idEl.value) || '').trim();
        var nm = String((nameEl && nameEl.value) || '').trim();
        var trg = String((triggerEl && triggerEl.value) || '').trim();
        if (trg && trg[0] !== '@') trg = '@' + trg.replace(/^@+/, '');
        if (!/^@[0-9A-Za-z가-힣_]{1,24}$/.test(trg)) { alert('trigger는 @로 시작하며 1~24자여야 합니다. 예: @세모'); return; }
        var dup = characters.some(function (c) { return String(c.trigger).toLowerCase() === String(trg).toLowerCase() && String(c.id) !== cid2; });
        if (dup) { alert('같은 trigger가 이미 등록되어 있습니다.'); return; }
        var mainId = String((mainEl && mainEl.value) || '').trim();
        if (!mainId) { alert('대표 이미지가 비었습니다. 대표 이미지를 선택하지 않으면 품질이 낮아질 수 있습니다.'); }
        var refs = [];
        if (refSelEl) { Array.from(refSelEl.options).forEach(function (o){ if (o.selected) refs.push(String(o.value)); }); }
        var nextRow = {
          id: cid2 || ('char_' + Date.now()),
          trigger: trg,
          name: nm || trg,
          aliases: String((aliasesEl && aliasesEl.value) || '').split(/[,\n]/).map(function (t){ return String(t||'').trim(); }).filter(Boolean),
          mainAssetId: mainId,
          referenceAssetIds: refs,
          description: String((descEl && descEl.value) || '').trim(),
          fixedTraits: String((fixedEl && fixedEl.value) || '').split(/[,\n]/).map(function (t){ return String(t||'').trim(); }).filter(Boolean),
          bannedTraits: String((bannedEl && bannedEl.value) || '').split(/[,\n]/).map(function (t){ return String(t||'').trim(); }).filter(Boolean),
          defaultPromptPrefix: 'Keep character identity consistent.',
          styleGuide: String((styleEl && styleEl.value) || '').trim(),
          isActive: !!(activeEl && activeEl.checked),
          createdAt: '',
          updatedAt: new Date().toISOString()
        };
        var nextList2 = [];
        var found = false;
        characters.forEach(function (c) {
          if (String(c.id) === String(nextRow.id)) { found = true; nextList2.push(Object.assign({}, c, nextRow, { createdAt: c.createdAt || nextRow.createdAt })); }
          else nextList2.push(c);
        });
        if (!found) nextList2.unshift(nextRow);
        btn.disabled = true;
        NK.service.brand.update(brandId, { brandCharacters: nextList2 })
          .then(function () { renderNext(project); })
          .catch(function (err) { alert('저장 실패: ' + (err && err.message ? err.message : err)); })
          .finally(function () { btn.disabled = false; });
        return;
      }
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
      if (addCharacter(targetEl.value || '')) {
        targetEl.value = '';
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
