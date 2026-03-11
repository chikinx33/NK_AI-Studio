; (function () {
  const NK = window.NK || (window.NK = {});
  const ui = NK.ui || (NK.ui = {});
  const scenario = ui.scenario || (ui.scenario = {});
  let currentPayload = {};
  const DEFAULT_SCENARIO_FLAGS = {
    narrationEnabled: false,
    dubbingEnabled: false
  };
  let currentCharacters = [];
  let characterSeq = 1;

  // ---------- helpers ----------
  const fmtEst = (sec) => {
    const n = Number(sec) || 0;
    if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
    if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
    return `${n}s`;
  };

  const parseEst = (txt) => {
    if (NK.utils && NK.utils.parseEst) return NK.utils.parseEst(txt);
    const m = String(txt || '').match(/([0-9.]+)/);
    return m ? Math.max(Math.floor(Number(m[1]) || 0), 1) : 8;
  };

  const boolVal = (v, fallback = false) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const x = v.trim().toLowerCase();
      if (x === 'true' || x === '1' || x === 'on' || x === 'yes') return true;
      if (x === 'false' || x === '0' || x === 'off' || x === 'no') return false;
    }
    return !!fallback;
  };

  const sanitizeText = (v) => String(v == null ? '' : v).replace(/[<>]/g, '').trim();

  const makeCharacterId = () => `char_${String(characterSeq++).padStart(3, '0')}`;

  const normalizeCharacters = (list = []) => {
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((c) => {
      const raw = sanitizeText(c?.displayName || c?.name || c?.token || '');
      if (!raw) return;
      const displayName = raw.replace(/^@+/, '').trim();
      if (!displayName) return;
      const token = `@${displayName}`;
      const key = token.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        characterId: sanitizeText(c?.characterId || c?.id) || makeCharacterId(),
        displayName,
        token
      });
    });
    return out;
  };

  const syncCharacterSeq = (list = []) => {
    let max = 0;
    (Array.isArray(list) ? list : []).forEach((c) => {
      const m = String(c?.characterId || '').match(/^char_(\d+)$/i);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    characterSeq = Math.max(characterSeq, max + 1);
  };

  const applyCharacterTokenHints = (text, characters = []) => {
    let out = String(text || '');
    (Array.isArray(characters) ? characters : []).forEach((c) => {
      const display = String(c?.displayName || '').trim();
      const token = String(c?.token || '').trim();
      if (!display || !token) return;
      if (!out.includes(display) || out.includes(token)) return;
      out = out.replaceAll(display, token);
    });
    return out;
  };

  const normalizeDialogue = (value = [], characters = []) => {
    const tokens = new Set((Array.isArray(characters) ? characters : []).map(c => String(c?.token || '').trim()).filter(Boolean));
    const toSpeaker = (v) => {
      const raw = String(v || '').trim();
      if (!raw) return '';
      if (tokens.has(raw)) return raw;
      if (raw.startsWith('@')) return raw;
      return `@${raw.replace(/^@+/, '')}`;
    };
    if (Array.isArray(value)) {
      return value.map((d) => ({
        speaker: toSpeaker(d?.speaker),
        line: String(d?.line || '').trim()
      })).filter(d => d.speaker || d.line);
    }
    if (typeof value === 'string') {
      return value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf(':');
          if (idx > -1) {
            return {
              speaker: toSpeaker(line.slice(0, idx).trim()),
              line: line.slice(idx + 1).trim()
            };
          }
          return { speaker: '', line };
        })
        .filter(d => d.speaker || d.line);
    }
    return [];
  };

  const dialogueToText = (list = []) => {
    return (Array.isArray(list) ? list : [])
      .map((d) => {
        const speaker = String(d?.speaker || '').trim();
        const line = String(d?.line || '').trim();
        if (speaker && line) return `${speaker}: ${line}`;
        return line || speaker || '';
      })
      .filter(Boolean)
      .join('\n');
  };

  const getScenarioFlags = (payload = {}) => ({
    narrationEnabled: boolVal(payload?.narrationEnabled, DEFAULT_SCENARIO_FLAGS.narrationEnabled),
    dubbingEnabled: boolVal(payload?.dubbingEnabled, DEFAULT_SCENARIO_FLAGS.dubbingEnabled)
  });

  const getUiLang = () => {
    try {
      const key = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
      const raw = String(localStorage.getItem(key) || document.documentElement.getAttribute('lang') || 'ko').toLowerCase();
      return raw === 'en' ? 'en' : 'ko';
    } catch (_) {
      return 'ko';
    }
  };

  const getSceneFieldLabels = () => {
    if (getUiLang() === 'en') {
      return {
        visual: 'Visualization',
        narration: 'Narration',
        dialogue: 'Dialogue'
      };
    }
    return {
      visual: '시각화',
      narration: '나레이션',
      dialogue: '대사'
    };
  };

  const extractNarrationOnlyText = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const line = raw.split('\n').map(x => x.trim()).find(Boolean) || raw;
    const m = line.match(/^(?:narration|나레이션)\s*[:：]?\s*["“”]?([\s\S]*?)["“”]?\s*$/i);
    if (!m) return raw;
    return String(m[1] || '').trim();
  };

  const renderTagButtons = (box, list, selected = [], single = false) => {
    if (!box) return;
    box.innerHTML = (list || []).map(v => {
      const active = selected.includes(v) ? 'active' : '';
      return `<button type="button" class="tag-toggle ${active}" data-value="${v}" data-single="${single ? '1' : ''}">${v}</button>`;
    }).join('');
  };

  const toArray = (v) => {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  };

  const setActiveButtons = (selector, value) => {
    document.querySelectorAll(selector).forEach(btn => {
      const val = btn.dataset.value || btn.dataset.ratio;
      btn.classList.toggle('active', val === value);
    });
  };

  const collectPayload = () => {
    const form = document.getElementById('scenario-form');
    if (!form) return {};
    const fd = new FormData(form);
    const payload = {};
    fd.forEach((v, k) => { payload[k] = v; });
    payload.purposeTags = Array.from(document.querySelectorAll('#purpose-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.needs = Array.from(document.querySelectorAll('#needs-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.tones = Array.from(document.querySelectorAll('#tone-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.styles = Array.from(document.querySelectorAll('#style-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.duration = document.querySelector('.duration-toggle.active')?.dataset.value || NK.config.DEFAULTS?.DURATION || '15';
    payload.aspectRatio = document.querySelector('.ratio-btn.active')?.dataset.ratio || '16:9';
    if (form.target) payload.target = form.target.value;
    const normalizedCharacters = normalizeCharacters(currentCharacters);
    currentCharacters = normalizedCharacters;
    syncCharacterSeq(currentCharacters);
    payload.characters = normalizedCharacters.map((c) => ({
      characterId: c.characterId,
      displayName: c.displayName,
      token: c.token
    }));
    payload.narrationEnabled = !!document.querySelector('.scenario-flag-toggle[data-flag="narrationEnabled"]')?.classList.contains('active');
    payload.dubbingEnabled = !!document.querySelector('.scenario-flag-toggle[data-flag="dubbingEnabled"]')?.classList.contains('active');
    const matchedTokens = payload.characters
      .filter(c => String(payload.topic || '').includes(c.displayName))
      .map(c => c.token);
    if (matchedTokens.length) payload.characterHints = matchedTokens;
    // Keep project/episode metadata while editing scenario fields.
    if (currentPayload && typeof currentPayload === 'object') {
      if (currentPayload.seriesId && !payload.seriesId) payload.seriesId = currentPayload.seriesId;
      if (currentPayload.seriesTitle && !payload.seriesTitle) payload.seriesTitle = currentPayload.seriesTitle;
      if (currentPayload.episodeTitle && !payload.episodeTitle) payload.episodeTitle = currentPayload.episodeTitle;
    }
    if (NK.service?.project?.applyProjectCore) {
      return NK.service.project.applyProjectCore(payload, currentPayload);
    }
    return payload;
  };

  const normalizeScenes = (scenes = []) => {
    return (Array.isArray(scenes) ? scenes : []).map((s, i) => {
      const est = parseEst(s.estSec || s.duration || s.len || s.length || 8);
      const rawLine = String(s.lines || '').trim();
      const cleanedLine = extractNarrationOnlyText(rawLine);
      const rawNarration = s.narration || cleanedLine || s.story || s.text || s.script || s.content || '';
      const dialogues = normalizeDialogue(s.dialogue || s.dialogues || [], currentCharacters);
      const lines = String(cleanedLine || rawNarration || '').trim();
      const shot =
        s.shot ||
        s.visual ||
        s.camera ||
        s.scene_visual ||
        s.image ||
        (lines ? String(lines).split(/(?<=[.!?])\s+/)[0] || '' : '') ||
        '';
      const narration = applyCharacterTokenHints(String(rawNarration || lines || '').trim(), currentCharacters);
      const dialogue = dialogues.map((d) => ({
        speaker: applyCharacterTokenHints(d.speaker, currentCharacters),
        line: applyCharacterTokenHints(d.line, currentCharacters)
      }));
      const dialogueText = dialogue
        .map((d) => `${d.speaker ? `${d.speaker}: ` : ''}${d.line || ''}`.trim())
        .filter(Boolean)
        .join('\n');
      const legacyStory = lines || extractNarrationOnlyText(narration) || dialogueText;
      const narrationText = extractNarrationOnlyText(narration || legacyStory);
      return {
        id: s.id != null ? s.id : (i + 1),
        lines: legacyStory,
        narrationText,
        dialogueText,
        narration,
        dialogue,
        shot: applyCharacterTokenHints(String(shot || '').trim(), currentCharacters),
        estSec: est,
        narrationEnabled: boolVal(s?.narrationEnabled, boolVal(currentPayload?.narrationEnabled, false)),
        dubbingEnabled: boolVal(s?.dubbingEnabled, boolVal(currentPayload?.dubbingEnabled, false))
      };
    });
  };

  const formatCommonInfo = () => {
    const p = currentPayload || {};
    const parts = [];
    if (p.topic) parts.push(`Topic: ${p.topic}`);
    if (p.purposeCategory) parts.push(`Genre: ${p.purposeCategory}${p.purposeTags?.length ? ` (${p.purposeTags.join(', ')})` : ''}`);
    if (p.target) parts.push(`Audience: ${p.target}`);
    if (p.needs?.length) parts.push(`Needs: ${p.needs.join(', ')}`);
    const toneStr = [...(p.tones || []), p.tone || ''].filter(Boolean).join(', ');
    if (toneStr) parts.push(`Tone: ${toneStr}`);
    const styleStr = [...(p.styles || []), p.style || ''].filter(Boolean).join(', ');
    if (styleStr) parts.push(`Style: ${styleStr}`);
    if (p.banned) parts.push(`Directives: ${p.banned}`);
    return parts.join(' · ');
  };

  const buildCommonDetail = () => {
    const p = currentPayload || {};
    const lines = [];
    lines.push('Common');
    lines.push(p.header || '(Common 블록이 아직 생성되지 않았습니다)');
    return lines.join('\n');
  };

  const setActiveScenarioCard = (targetCard) => {
    const container = document.getElementById('scenario-cards');
    if (!container || !targetCard) return;
    container.querySelectorAll('.scenario-card.active-card').forEach(card => {
      card.classList.remove('active-card');
    });
    targetCard.classList.add('active-card');
  };

  const collectScenesFromCards = () => {
    return Array.from(document.querySelectorAll('.scenario-card')).map((card) => {
      const id = Number(card.querySelector('.est-input')?.dataset.id);
      const estTxt = card.querySelector('.est-input')?.value || '';
      const est = parseEst(estTxt);
      const narrationText = card.querySelector('.view-narration-lines')?.textContent?.trim() || '';
      const dialogueText = card.querySelector('.view-dialogue-lines')?.textContent?.trim() || '';
      const dialogue = normalizeDialogue(dialogueText, currentCharacters);
      const visualText = card.querySelector('.view-shot')?.textContent?.trim() || '';
      return {
        id,
        title: '',
        lines: extractNarrationOnlyText(narrationText),
        narration: extractNarrationOnlyText(narrationText),
        dialogue,
        shot: visualText,
        visual: visualText,
        estSec: est
      };
    });
  };

  const mergeSceneSnapshots = (baseScenes = [], latestScenes = []) => {
    const byId = new Map((Array.isArray(baseScenes) ? baseScenes : []).map((s) => [String(s?.id), s]));
    return (Array.isArray(latestScenes) ? latestScenes : []).map((s) => {
      const prev = byId.get(String(s?.id)) || {};
      const narration = (s.narration !== undefined ? s.narration : prev.narration) || '';
      const dialogue = (s.dialogue !== undefined ? s.dialogue : prev.dialogue) || [];
      const visual = s.visual || s.shot || prev.visual || prev.shot || '';
      const lines = s.lines || prev.lines || narration || '';
      return Object.assign({}, prev, s, {
        lines,
        narration,
        dialogue,
        shot: visual,
        visual
      });
    });
  };

  const renderCharacterChips = () => {
    const box = document.getElementById('character-chips');
    if (!box) return;
    const list = normalizeCharacters(currentCharacters);
    currentCharacters = list;
    syncCharacterSeq(list);
    box.innerHTML = list.map((c) => `
      <span class="character-chip" data-character-id="${c.characterId}">
        <span class="chip-token">${c.token}</span>
        <button type="button" class="chip-remove" data-remove-character="${c.characterId}" aria-label="캐릭터 삭제">×</button>
      </span>
    `).join('');
  };

  const setScenarioToggleButtons = (flags = {}) => {
    const normalized = getScenarioFlags(flags);
    document.querySelectorAll('.scenario-flag-toggle').forEach((btn) => {
      const key = btn.dataset.flag;
      btn.classList.toggle('active', !!normalized[key]);
    });
  };

  // ---------- render scenes ----------
  scenario.renderScenes = function (scenes = []) {
    const container = document.getElementById('scenario-cards');
    if (!container) return;
    const sceneList = normalizeScenes(scenes);
    const labels = getSceneFieldLabels();
    const commonInfo = formatCommonInfo();
    if (!sceneList.length) {
      container.innerHTML = `
        <div class="empty-state center-empty">
          <div>
            <p class="muted">생성된 시나리오가 없습니다.</p>
            <p class="muted small">왼쪽 패널에서 조건을 입력하고 '시나리오 생성'을 눌러주세요.</p>
          </div>
        </div>`;
      return;
    }
    const commonBlock = commonInfo ? `<div class="common-info-row" id="common-info-row"><button class="common-info-play" id="common-info-btn" aria-label="공통 프롬프트 보기">▶</button><span class="muted tiny">${commonInfo}</span></div>` : '';
    container.innerHTML = commonBlock + sceneList.map(s => `
      <div class="scenario-card" data-scene-id="${s.id}">
        <div class="card-top">
          <div>
            <h5>Scene ${s.id}</h5>
          </div>
          <input class="chip-input est-input" data-id="${s.id}" value="${fmtEst(s.estSec)}" />
        </div>
        <div class="scene-visual-grid">
          <div class="field-block">
            <p class="field-label muted small">${labels.visual}</p>
            <p class="view-shot view-shot-lines" data-id="${s.id}" contenteditable="true">${s.shot || ''}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">${labels.narration}</p>
            <p class="view-lines view-narration-lines" data-id="${s.id}" contenteditable="true">${s.narrationText || ''}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">${labels.dialogue}</p>
            <p class="view-lines view-dialogue-lines" data-id="${s.id}" contenteditable="true">${s.dialogueText || dialogueToText(s.dialogue || [])}</p>
          </div>
        </div>
      </div>
    `).join('');
    const firstCard = container.querySelector('.scenario-card');
    if (firstCard) firstCard.classList.add('active-card');
  };

  // ---------- load draft into form ----------
  const sanitizeHeader = (text) => {
    if (!text) return '';
    const stripTokens = (line) => {
      return line
        .replace(/비주얼\s*스타일[^.\n]*/gi, '')
        .replace(/종횡비[^.\n]*/gi, '')
        .replace(/^\s*\d+\s*:\s*\d+\s*$/g, '') // 16:9 등 비율만 있는 줄
        .replace(/[#>\-\s]*\d+\s*:\s*\d+\s*/gi, '') // 문장 내 비율 토큰 제거
        .replace(/aspect\s*ratio[^.\n]*/gi, '')
        .replace(/화면\s*비율[^.\n]*/gi, '')
        .replace(/target\s*duration[^.\n]*/gi, '')
        .replace(/[#>\-\s]*타겟\s*[:.]?\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/[#>\-\s]*target\s*[:.]?\s*\d+\s*s?\s*[.]?/gi, '')
        .replace(/타겟\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/^\s*\d+\s*(초|s)\s*$/gi, '')
        .replace(/분량[^.\n]*/gi, '')
        .replace(/연속성[^.\n]*/gi, '')
        .replace(/이야기의?\s*흐름[^.\n]*/gi, '')
        .replace(/흐름이\s*자연스럽[^.\n]*/gi, '')
        .replace(/매끄럽게\s*연결[^.\n]*/gi, '')
        .replace(/일관되도록\s*유지[^.\n]*/gi, '')
        .replace(/필수\s*지침\s*없음/gi, '')
        .replace(/규칙\s*없음/gi, '')
        .replace(/^#+\s*/g, '') // Markdown 헤더 기호 제거
        .replace(/##+/g, '') // 남은 이중 해시 제거
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    return String(text)
      .split(/\n+/)
      .map(stripTokens)
      .filter(Boolean)
      .join('\n')
      .trim();
  };

  const loadDraft = (draft) => {
    const form = document.getElementById('scenario-form');
    if (!form || !draft) return;
    const p = draft.payload || {};
    const rawHeader = draft.header || p.header || '';
    const header = sanitizeHeader(rawHeader);
    const flags = getScenarioFlags(p || {});
    currentCharacters = normalizeCharacters(p.characters || draft.characters || []);
    syncCharacterSeq(currentCharacters);
    currentPayload = Object.assign({}, p || {}, flags, { characters: currentCharacters, header });
    const defaults = NK.config.DEFAULTS || {};
    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    const defaultCat = p.purposeCategory || categories[0] || '';
    const targetSel = document.getElementById('target-select');
    const defaultTarget = p.target || (targetSel && targetSel.options.length ? targetSel.options[0].value : '');

    if (form.topic) form.topic.value = p.topic || draft.title || '';
    if (form.purposeCategory) form.purposeCategory.value = defaultCat;
    if (form.target) form.target.value = defaultTarget;
    if (form.tone) form.tone.value = p.tone || '';
    if (form.style) form.style.value = p.style || '';
    if (form.banned) form.banned.value = p.banned || '';

    // toggles
    setActiveButtons('.duration-toggle', p.duration || defaults.DURATION || '15');
    setActiveButtons('.ratio-btn', p.aspectRatio || '16:9');
    setScenarioToggleButtons(flags);
    renderCharacterChips();
    const characterInput = document.getElementById('character-input');
    if (characterInput) characterInput.value = '';

    const one = (arr) => Array.isArray(arr) && arr.length ? [arr[0]] : [];
    renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[defaultCat] || [], one(p.purposeTags), true);
    renderTagButtons(document.getElementById('needs-tags'), NK.core.needsList || [], one(p.needs), true);
    renderTagButtons(document.getElementById('tone-tags'), NK.core.toneList || [], toArray(p.tones), true);
    renderTagButtons(document.getElementById('style-tags'), NK.core.styleList || [], toArray(p.styles), true);

    scenario.renderScenes(draft.scenes || []);
  };

  // ---------- init ----------
  scenario.init = async function () {
    const form = document.getElementById('scenario-form');
    if (!form) return;

    const pageLoading = document.getElementById('page-loading');
    const main = document.querySelector('.main');
    if (NK.core && NK.core.setLoading) NK.core.setLoading(true);
    if (pageLoading) pageLoading.classList.remove('hidden');
    const finishLoading = () => {
      try {
        if (pageLoading) pageLoading.classList.add('hidden');
        if (main) main.classList.remove('loading-blur');
        if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
      } catch (_) { }
    };
    if (main) main.classList.add('loading-blur');

    // 장르(목적 대분류) 옵션을 주입 - 기본값이 비어 보이는 문제 대응
    const ensurePurposeOptions = () => {
      const sel = document.getElementById('purpose-category');
      if (!sel || sel.options.length) return;
      const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
      categories.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (idx === 0) opt.selected = true;
        sel.appendChild(opt);
      });
    };
    ensurePurposeOptions();

    // 화면 비율 버튼(16:9/9:16/1:1)이 폼 밖에 있어 클릭이 안 먹던 문제 해결
    const ratioGroup = document.getElementById('ratio-group');
    if (ratioGroup) {
      ratioGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.ratio-btn');
        if (!btn) return;
        e.preventDefault();
        setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      });
    }

    let draft = null;
    if (NK.service?.project?.resolveCurrent) {
      draft = NK.service.project.resolveCurrent({ search: location.search }) || null;
    }
    if (!draft) {
      const saved = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
      if (saved) draft = JSON.parse(saved);
    }
    const pid = draft?.id || new URLSearchParams(location.search).get('projectId');

    // 서버 최신 데이터를 우선 로드
    if (pid && NK.api?.projectGet) {
      try {
        const srv = await NK.api.projectGet(pid);
        if (srv?.data) {
          draft = {
            id: pid,
            title: srv.data.title || draft?.title || '프로젝트',
            payload: srv.data.payload || draft?.payload || {},
            scenes: srv.data.scenes || draft?.scenes || [],
            header: srv.data.header || draft?.header || ''
          };
          if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
          if (NK.state?.set) NK.state.set({ currentProject: draft });
        }
      } catch (_) { }
    }

    // 저장된 초안 로드
    loadDraft(draft);
    if (!draft) {
      currentCharacters = [];
      currentPayload = Object.assign({}, currentPayload || {}, DEFAULT_SCENARIO_FLAGS, { characters: [] });
      setScenarioToggleButtons(DEFAULT_SCENARIO_FLAGS);
      renderCharacterChips();
    }

    const addCharacter = (name) => {
      const displayName = sanitizeText(name).replace(/^@+/, '');
      if (!displayName) return false;
      const token = `@${displayName}`;
      const exists = currentCharacters.some(c => String(c.token || '').toLowerCase() === token.toLowerCase());
      if (exists) return false;
      currentCharacters.push({
        characterId: makeCharacterId(),
        displayName,
        token
      });
      renderCharacterChips();
      return true;
    };

    const characterInput = document.getElementById('character-input');
    if (characterInput) {
      characterInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const ok = addCharacter(characterInput.value || '');
        if (ok) characterInput.value = '';
      });
    }

    // 토글/버튼 클릭
    form.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag-toggle, .duration-toggle, .ratio-btn, .scenario-flag-toggle');
      if (!btn) return;
      if (btn.classList.contains('duration-toggle')) {
        setActiveButtons('.duration-toggle', btn.dataset.value);
      } else if (btn.classList.contains('ratio-btn')) {
        setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      } else if (btn.classList.contains('scenario-flag-toggle')) {
        btn.classList.toggle('active');
        currentPayload = Object.assign({}, currentPayload || {}, {
          narrationEnabled: !!document.querySelector('.scenario-flag-toggle[data-flag="narrationEnabled"]')?.classList.contains('active'),
          dubbingEnabled: !!document.querySelector('.scenario-flag-toggle[data-flag="dubbingEnabled"]')?.classList.contains('active'),
          characters: currentCharacters
        });
      } else if (btn.classList.contains('tag-toggle')) {
        if (btn.dataset.single === '1') {
          btn.parentElement.querySelectorAll('.tag-toggle').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        } else {
          btn.classList.toggle('active');
        }
      }
      if (btn.closest('#purpose-tags') || btn.name === 'purposeCategory') {
        const cat = form.purposeCategory ? form.purposeCategory.value : '';
        const sel = Array.from(document.querySelectorAll('#purpose-tags .tag-toggle.active')).map(b => b.dataset.value);
        renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[cat] || [], sel, true);
      }
    });

    form.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('[data-remove-character]');
      if (!removeBtn) return;
      const removeId = removeBtn.dataset.removeCharacter;
      if (!removeId) return;
      currentCharacters = currentCharacters.filter(c => String(c.characterId) !== String(removeId));
      renderCharacterChips();
    });

    const cardsContainer = document.getElementById('scenario-cards');
    if (cardsContainer) {
      cardsContainer.addEventListener('click', (e) => {
        const card = e.target && e.target.closest ? e.target.closest('.scenario-card') : null;
        if (!card) return;
        setActiveScenarioCard(card);
      });

      cardsContainer.addEventListener('focusin', (e) => {
        const card = e.target && e.target.closest ? e.target.closest('.scenario-card') : null;
        if (!card) return;
        setActiveScenarioCard(card);
      });
    }

    const rerenderForLocale = () => {
      const latest = collectScenesFromCards();
      const mergedScenes = mergeSceneSnapshots(draft?.scenes || [], latest);
      if (draft) draft.scenes = mergedScenes;
      scenario.renderScenes(mergedScenes.length ? mergedScenes : (draft?.scenes || []));
    };

    window.addEventListener('message', (evt) => {
      const data = evt && evt.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'lang-apply') rerenderForLocale();
    });

    window.addEventListener('storage', (evt) => {
      const key = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
      if (!evt) return;
      if (evt.key === key || evt.key === 'nk_lang') rerenderForLocale();
    });

    // 카테고리 변경 시 목적 태그 재렌더
    if (form.purposeCategory) {
      form.purposeCategory.addEventListener('change', () => {
        const cat = form.purposeCategory.value;
        renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[cat] || [], [], true);
      });
    }

    form.addEventListener('reset', () => {
      setTimeout(() => {
        currentCharacters = [];
        renderCharacterChips();
        setScenarioToggleButtons(DEFAULT_SCENARIO_FLAGS);
        currentPayload = Object.assign({}, currentPayload || {}, DEFAULT_SCENARIO_FLAGS, { characters: [] });
      }, 0);
    });

    // 시나리오 생성
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('scenario-error');
      if (errEl) errEl.classList.add('hidden');
      NK.core.setLoading(true);
      const payload = collectPayload();
      try {
        const res = await NK.api.scenario(payload);
        const headerText = (NK.service?.project?.getPromptHeader)
          ? await NK.service.project.getPromptHeader(payload)
          : '';
        if (res?.scenes) {
          const normalized = normalizeScenes(res.scenes);
          draft = draft || { id: Date.now(), title: payload.topic || '새 프로젝트' };
          draft.payload = payload;
          draft.scenes = normalized;
          draft.header = sanitizeHeader(res.header || headerText || draft.header || '');
          currentPayload = Object.assign({}, draft.payload, { header: draft.header });
          if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
          NK.store.saveDrafts([draft]);
          if (NK.api?.projectSave) {
            await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header, aspectRatio: draft.payload?.aspectRatio, title: draft.title });
          }
          if (NK.state) {
            if (NK.state.set) NK.state.set({ currentProject: draft });
            if (NK.state.broadcast) NK.state.broadcast('update-project', { project: draft });
          }
          loadDraft(draft);
          alert('시나리오를 생성했습니다.');
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = '시나리오 생성 실패: ' + (err?.message || err);
          errEl.classList.remove('hidden');
        } else {
          alert('시나리오 생성 실패: ' + (err?.message || err));
        }
      } finally {
        NK.core.setLoading(false);
      }
    };

    // 저장 버튼
    const saveBtn = document.getElementById('save-draft');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        NK.core.setLoading(true);
        try {
          draft = draft || { id: Date.now(), title: '새 프로젝트' };
          draft.payload = collectPayload();
          draft.scenes = mergeSceneSnapshots(draft.scenes || [], collectScenesFromCards());
          if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
          NK.store.saveDrafts([draft]);
          if (NK.api?.projectSave) {
            await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header || '', aspectRatio: draft.payload?.aspectRatio, title: draft.title });
            // 저장 직후 사이드바/대시보드 카드에 메타(장르/타겟/길이) 반영
            try {
              if (NK.ui?.dashboard?.renderSidebarProjectCard) {
                NK.ui.dashboard.renderSidebarProjectCard(draft);
              }
              if (NK.ui?.dashboard?.renderDrafts) {
                NK.ui.dashboard.renderDrafts();
              }
              if (NK.state) {
                if (NK.state.set) NK.state.set({ currentProject: draft });
                if (NK.state.broadcast) NK.state.broadcast('update-project', { project: draft });
              }
            } catch (_) { }
          }
          alert('저장되었습니다.');
        } catch (err) {
          alert('저장 실패: ' + (err?.message || err));
        } finally {
          NK.core.setLoading(false);
        }
      };
    }
    // 페이지 로딩 종료 처리 (초기 렌더 완료 후)
    setTimeout(finishLoading, 350); // 약간의 딜레이로 로딩/블러가 눈에 띄게 표시되도록
    window.addEventListener('load', finishLoading);

    // 공통 프롬프트 팝업
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && target.id === 'common-info-btn') {
        const modal = document.getElementById('common-modal');
        const body = document.getElementById('common-modal-body');
        if (modal && body) {
          body.textContent = buildCommonDetail();
          modal.classList.remove('hidden');
        }
      }
      if (target && target.dataset && target.dataset.close === 'common-modal') {
        document.getElementById('common-modal')?.classList.add('hidden');
      }
      const modal = document.getElementById('common-modal');
      if (modal && !modal.classList.contains('hidden') && target === modal) {
        modal.classList.add('hidden');
      }
    });
  };
})();
