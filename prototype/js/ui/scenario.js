; (function () {
  const NK = window.NK || (window.NK = {});
  const ui = NK.ui || (NK.ui = {});
  const scenario = ui.scenario || (ui.scenario = {});
  let currentPayload = {};
  const collapsedSceneIds = new Set();
  const DEFAULT_SCENARIO_FLAGS = {
    narrationEnabled: false,
    dubbingEnabled: false
  };
  const TARGET_OPTIONS = [
    {
      value: '영유아',
      ko: '영유아 · 학습/놀이/감성 발달',
      en: 'Infants · learning/play/emotional development'
    },
    {
      value: '아동',
      ko: '아동 · 기초 학습/호기심/놀이/이야기',
      en: 'Children · basic learning/curiosity/play/stories'
    },
    {
      value: '청소년',
      ko: '청소년 · 학습/시험/자기 정체성/엔터테인먼트',
      en: 'Teens · study/exams/identity/entertainment'
    },
    {
      value: '청년',
      ko: '청년 · 엔터테인먼트/감성/힐링/정보/자기계발',
      en: 'Young adults · entertainment/emotion/healing/info/self-growth'
    },
    {
      value: '직장인',
      ko: '직장인 · 업무 효율/실용 정보/자기계발/스트레스 해소',
      en: 'Office workers · productivity/practical info/self-growth/stress relief'
    },
    {
      value: '중장년',
      ko: '중장년 · 생활 정보/가정/경제/건강/취미/노후 설계',
      en: 'Middle-aged adults · life info/family/economy/health/hobbies/retirement planning'
    },
    {
      value: '시니어',
      ko: '시니어 · 건강/여가/힐링/회고/정치',
      en: 'Seniors · health/leisure/healing/reflection/current affairs'
    },
    {
      value: '전 연령',
      ko: '전 연령 · 공감/정보/엔터테인먼트',
      en: 'All ages · empathy/info/entertainment'
    }
  ];
  const DURATION_OPTIONS = [
    { value: '15', ko: '15초', en: '15s' },
    { value: '30', ko: '30초', en: '30s' },
    { value: '45', ko: '45초', en: '45s' },
    { value: '60', ko: '1분', en: '1m' },
    { value: '1800', ko: '30분', en: '30m' },
    { value: '3600', ko: '1시간', en: '1h' },
    { value: '7200', ko: '2시간', en: '2h' }
  ];
  const SCENARIO_UI_TEXT = {
    ko: {
      genrePlaceholder: '장르 선택',
      subgenrePlaceholder: '세부 장르 선택',
      targetPlaceholder: '시청 타겟 선택',
      purposePlaceholder: '시청 목적 선택',
      durationPlaceholder: '길이 선택',
      tonePlaceholder: '톤 선택',
      stylePlaceholder: '스타일 선택',
      durationCustomPlaceholder: '직접 입력(초)',
      knowledgeEmpty: '브랜드 허브에 저장된 내용이 아직 없습니다.',
      commonBackgroundLabel: '배경',
      emptyScenarioTitle: '생성된 시나리오가 없습니다.',
      emptyScenarioHelp: "왼쪽 패널에서 조건을 입력하고 '시나리오 생성'을 눌러주세요.",
      commonPromptAria: '공통 프롬프트 보기',
      sceneExpand: '씬 펼치기',
      sceneCollapse: '씬 접기',
      commonInfoLabels: {
        topic: '주제',
        story: '이야기',
        genre: '장르',
        audience: '타겟',
        needs: '목적',
        tone: '톤',
        style: '스타일',
        brandRules: '브랜드 허브 규칙',
        blockedTerms: '금지어'
      },
      copyTitle: '복사',
      copyScenarioAria: '시나리오 복사',
      scenario_story_ai_title: '이야기를 AI로 정리',
      commonDetailLabels: {
        title: '공통',
        modalTitle: '공통 프롬프트',
        sectionBlock: '공통 블록',
        sectionOverview: '에피소드 개요',
        sectionHub: '브랜드 허브',
        empty: '(공통 블록이 아직 생성되지 않았습니다)',
        brandVoice: '브랜드 보이스',
        brandStory: '브랜드 스토리',
        brandCharacter: '브랜드 캐릭터',
        worldSetting: '세계관',
        brandRules: '브랜드 규칙',
        bannedExpressions: '금지 표현'
      },
      scenario_copy_success: '시나리오를 복사했습니다.',
      scenario_copy_fail: '복사에 실패했습니다.',
      scenario_copy_error_prefix: '복사 실패: ',
      scenario_story_toggle_title: '원본/AI 전환',
      scenario_story_toggle_view_ai: 'AI 글 보기',
      scenario_story_toggle_view_user: '원본 보기',
      knowledgeLabels: {
        brandStory: '브랜드 스토리',
        worldSetting: '세계관/배경',
        brandCharacter: '대표 캐릭터/주체',
        brandVoice: '톤&매너',
        brandRules: '브랜드 규칙',
        bannedExpressions: '금지 표현',
        referenceContents: '참조 콘텐츠',
        successCases: '성공 패턴'
      }
    },
    en: {
      genrePlaceholder: 'Select genre',
      subgenrePlaceholder: 'Select subgenre',
      targetPlaceholder: 'Select target',
      purposePlaceholder: 'Select viewing purpose',
      durationPlaceholder: 'Select duration',
      tonePlaceholder: 'Select tone',
      stylePlaceholder: 'Select style',
      durationCustomPlaceholder: 'Enter seconds',
      knowledgeEmpty: 'No Brand Hub content has been saved yet.',
      commonBackgroundLabel: 'Background',
      emptyScenarioTitle: 'No scenario has been generated.',
      emptyScenarioHelp: "Fill out the overview on the left and click 'Generate scenario'.",
      commonPromptAria: 'View common prompt',
      sceneExpand: 'Expand scene',
      sceneCollapse: 'Collapse scene',
      commonInfoLabels: {
        topic: 'Topic',
        story: 'Story',
        genre: 'Genre',
        audience: 'Audience',
        needs: 'Purpose',
        tone: 'Tone',
        style: 'Style',
        brandRules: 'Brand Hub rules',
        blockedTerms: 'Blocked terms'
      },
      copyTitle: 'Copy',
      copyScenarioAria: 'Copy scenario',
      scenario_story_ai_title: 'Refine story with AI',
      commonDetailLabels: {
        title: 'Common',
        modalTitle: 'Common Prompt',
        sectionBlock: 'Common Block',
        sectionOverview: 'Episode Overview',
        sectionHub: 'Brand Hub',
        empty: '(Common block has not been generated yet)',
        brandVoice: 'Brand voice',
        brandStory: 'Brand story',
        brandCharacter: 'Brand character',
        worldSetting: 'World setting',
        brandRules: 'Brand rules',
        bannedExpressions: 'Banned expressions'
      },
      scenario_copy_success: 'Scenario copied.',
      scenario_copy_fail: 'Copy failed.',
      scenario_copy_error_prefix: 'Copy failed: ',
      scenario_story_toggle_title: 'Toggle original/AI text',
      scenario_story_toggle_view_ai: 'View AI text',
      scenario_story_toggle_view_user: 'View original',
      knowledgeLabels: {
        brandStory: 'Brand story',
        worldSetting: 'World / setting',
        brandCharacter: 'Main character / subject',
        brandVoice: 'Tone & Manner',
        brandRules: 'Brand rules',
        bannedExpressions: 'Banned expressions',
        referenceContents: 'Reference content',
        successCases: 'Successful patterns'
      }
    }
  };
  const OPTION_LABELS_EN = {
    '키즈 · 영유아': 'Kids · Infants',
    '유아 교육': 'Early childhood education',
    '키즈 놀이': 'Kids play',
    '키즈 학습': 'Kids learning',
    '동요': 'Nursery rhymes',
    '율동': 'Dance songs',
    '동화': 'Fairy tale',
    '스토리 · 서사': 'Story · Narrative',
    '창작': 'Creative storytelling',
    '에피소드': 'Episode',
    '세계관': 'Worldbuilding',
    '판타지': 'Fantasy',
    '힐링': 'Healing',
    '지식 · 교양': 'Knowledge · Culture',
    '상식': 'General knowledge',
    '과학': 'Science',
    '수학': 'Math',
    '역사': 'History',
    '인문학': 'Humanities',
    '철학': 'Philosophy',
    '심리': 'Psychology',
    '시사': 'Current affairs',
    '교육 · 학습': 'Education · Learning',
    '공부법': 'Study methods',
    '시험 대비': 'Exam prep',
    '자격증': 'Certification',
    '언어 학습': 'Language learning',
    '코딩': 'Coding',
    '튜토리얼': 'Tutorial',
    '음식 · 요리': 'Food · Cooking',
    '레시피': 'Recipe',
    '먹방': 'Mukbang',
    '맛집 소개': 'Restaurant guide',
    '요리 과정': 'Cooking process',
    '음식 리뷰': 'Food review',
    '홈쿡': 'Home cooking',
    '여행 · 관광': 'Travel · Tourism',
    '국내 여행': 'Domestic travel',
    '해외 여행': 'Overseas travel',
    '관광지 소개': 'Attraction guide',
    '숨은 명소': 'Hidden gems',
    '랜선 여행': 'Virtual travel',
    '라이프 · 일상': 'Life · Daily',
    '브이로그': 'Vlog',
    '일상 기록': 'Daily log',
    '루틴': 'Routine',
    '자취': 'Living alone',
    '육아': 'Parenting',
    '직장 생활': 'Work life',
    '리뷰 · 추천': 'Review · Recommendations',
    '제품': 'Product',
    '서비스': 'Service',
    '콘텐츠 추천': 'Content recommendation',
    '앱': 'App',
    '게임': 'Game',
    '책': 'Book',
    '영화': 'Movie',
    '엔터테인먼트': 'Entertainment',
    '코미디': 'Comedy',
    '패러디': 'Parody',
    '챌린지': 'Challenge',
    '리액션': 'Reaction',
    '밈 콘텐츠': 'Meme content',
    '게임 플레이': 'Gameplay',
    '공략': 'Walkthrough',
    '하이라이트': 'Highlights',
    '게임 리뷰': 'Game review',
    '모바일 게임': 'Mobile games',
    '음악 · 사운드': 'Music · Sound',
    '음악 소개': 'Music introduction',
    'BGM': 'BGM',
    '커버': 'Cover',
    'ASMR': 'ASMR',
    '사운드 콘텐츠': 'Sound content',
    '스포츠 · 피트니스': 'Sports · Fitness',
    '운동 루틴': 'Workout routine',
    '스트레칭': 'Stretching',
    '홈트레이닝': 'Home training',
    '스포츠 해설': 'Sports commentary',
    '경기 요약': 'Match summary',
    '취미 · 크리에이티브': 'Hobby · Creative',
    '그림': 'Drawing',
    'DIY': 'DIY',
    '공예': 'Crafts',
    '디자인': 'Design',
    '글쓰기': 'Writing',
    '사진': 'Photography',
    '비즈니스 · 경제': 'Business · Economy',
    '창업': 'Startup',
    '재테크': 'Finance',
    '경제 상식': 'Economic basics',
    '마케팅': 'Marketing',
    '브랜딩': 'Branding',
    '테크 · IT': 'Tech · IT',
    'AI': 'AI',
    '신기술': 'Emerging tech',
    '앱 소개': 'App introduction',
    '기기 리뷰': 'Device review',
    '생산성 툴': 'Productivity tools',
    '힐링 · 감성': 'Healing · Mood',
    '명상': 'Meditation',
    '위로': 'Comfort',
    '힐링 영상': 'Healing video',
    '감성 브이로그': 'Emotional vlog',
    '자연 풍경': 'Nature scenery',
    '종교 · 신앙': 'Religion · Faith',
    '말씀 묵상': 'Scripture meditation',
    '설교 요약': 'Sermon summary',
    '신앙 이야기': 'Faith story',
    '간증': 'Testimony',
    '기도': 'Prayer',
    '사회 · 공감': 'Society · Empathy',
    '인터뷰': 'Interview',
    '다큐형 콘텐츠': 'Documentary format',
    '사회 이슈': 'Social issues',
    '공감 토크': 'Empathy talk',
    '학습': 'Learning',
    '놀이': 'Play',
    '생활 정보': 'Lifestyle info',
    '자기계발': 'Self-development',
    '커리어': 'Career',
    '건강': 'Health',
    '여가': 'Leisure',
    '가정': 'Family',
    '라이프스타일': 'Lifestyle',
    '광고': 'Advertising',
    '차분': 'Calm',
    '진지': 'Serious',
    '유머': 'Humorous',
    '공감': 'Empathetic',
    '전문': 'Professional',
    '친근': 'Friendly',
    '설득': 'Persuasive',
    '중립': 'Neutral',
    '풍자': 'Satirical',
    '스토리': 'Story-driven',
    '실사': 'Live action',
    '애니메이션(2D)': 'Animation (2D)',
    '애니메이션(3D)': 'Animation (3D)',
    '일러스트': 'Illustration',
    '모션그래픽': 'Motion graphics',
    '인포그래픽': 'Infographic',
    '클레이(스톱모션)': 'Clay (stop motion)',
    '스케치': 'Sketch',
    '시네마틱': 'Cinematic'
  };
  let currentCharacters = [];
  let characterSeq = 1;
  const getRuntimeLang = () => (NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko');
  const getScenarioText = (key, fallback = '') => {
    const lang = getRuntimeLang();
    return NK.core?.translations?.[lang]?.[key] || fallback;
  };

  const looksLikeLegacyStoryText = (value = '') => {
    const text = sanitizeText(value);
    if (!text) return false;
    if (text.length >= 48) return true;
    return /[\n.!?。！？]/.test(text);
  };

  const resolveOverviewStoryFields = (payload = {}, draft = null) => {
    const rawTopic = sanitizeText(payload?.topic || '');
    const rawStory = sanitizeText(payload?.story || payload?.storyPrompt || '');
    if (rawStory) {
      return {
        topic: rawTopic || sanitizeText(draft?.title || payload?.episodeTitle || ''),
        story: rawStory
      };
    }
    if (looksLikeLegacyStoryText(rawTopic)) {
      return {
        topic: sanitizeText(draft?.title || payload?.episodeTitle || ''),
        story: rawTopic
      };
    }
    return {
      topic: rawTopic,
      story: ''
    };
  };

  const getScenarioNarrativeText = (payload = {}) => {
    const story = sanitizeText(payload?.story || payload?.storyPrompt || '');
    const topic = sanitizeText(payload?.topic || '');
    return story || topic;
  };

  const getScenarioPromptSeed = (payload = {}) => {
    const topic = sanitizeText(payload?.topic || '');
    const story = getScenarioNarrativeText(payload);
    if (topic && story && topic !== story) return `${topic}\n${story}`;
    return story || topic;
  };

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
  const firstFilledText = (...values) => {
    for (const value of values) {
      const text = String(value == null ? '' : value).trim();
      if (text) return text;
    }
    return '';
  };
  const escapeHtml = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const makeCharacterId = () => `char_${String(characterSeq++).padStart(3, '0')}`;

  const normalizeCharacterName = (value) => sanitizeText(value).replace(/^@+/, '').trim();

  const normalizeCharacterPersonality = (value) => sanitizeText(value).replace(/\s+/g, ' ').trim();

  const normalizeCharacters = (list = [], options = {}) => {
    const defaultActive = Object.prototype.hasOwnProperty.call(options, 'defaultActive')
      ? !!options.defaultActive
      : true;
    const seen = new Set();
    const out = [];
    (Array.isArray(list) ? list : []).forEach((c) => {
      const displayName = normalizeCharacterName(c?.displayName || c?.name || c?.token || '');
      if (!displayName) return;
      const token = `@${displayName}`;
      const key = token.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        characterId: sanitizeText(c?.characterId || c?.id) || makeCharacterId(),
        displayName,
        token,
        personality: normalizeCharacterPersonality(c?.personality || c?.description || c?.profile || c?.note || ''),
        isActive: boolVal(c?.isActive, defaultActive)
      });
    });
    return out;
  };

  const parseCharacterNoteEntries = (value = '') => {
    return String(value || '')
      .split(/\n+/)
      .map((line) => {
        const raw = sanitizeText(line).replace(/^[\-*•\s]+/, '');
        if (!raw) return null;
        if (/^(브랜드\s*화자|화자|speaker)$/i.test(raw)) return null;
        const match = raw.match(/^(@?[^\-–—:：()]{1,24}?)(?:\s*[\-–—:：]\s*(.*))?$/);
        if (!match) return null;
        const candidate = normalizeCharacterName(match[1]);
        if (!candidate || /[.!?]/.test(candidate)) return null;
        return {
          displayName: candidate,
          personality: normalizeCharacterPersonality(match[2] || '')
        };
      })
      .filter(Boolean);
  };

  const normalizeKnowledgeCharacters = (list = [], fallbackText = '') => {
    const normalized = normalizeCharacters(list, { defaultActive: false });
    if (normalized.length) return normalized;
    return normalizeCharacters(parseCharacterNoteEntries(fallbackText), { defaultActive: false });
  };

  const mergeCharacterSources = (explicitList = [], knowledgeList = [], fallbackText = '') => {
    const explicit = normalizeCharacters(explicitList, { defaultActive: true });
    const knowledge = normalizeKnowledgeCharacters(knowledgeList, fallbackText);
    if (!explicit.length) return knowledge;
    const knowledgeMap = new Map(knowledge.map((item) => [String(item.token || '').toLowerCase(), item]));
    const merged = explicit.map((item) => {
      const matched = knowledgeMap.get(String(item.token || '').toLowerCase());
      if (!matched) return item;
      return Object.assign({}, matched, item, {
        characterId: item.characterId || matched.characterId,
        personality: normalizeCharacterPersonality(item.personality || matched.personality || ''),
        isActive: boolVal(item.isActive, true)
      });
    });
    const explicitKeys = new Set(merged.map((item) => String(item.token || '').toLowerCase()));
    knowledge.forEach((item) => {
      const key = String(item.token || '').toLowerCase();
      if (explicitKeys.has(key)) return;
      merged.push(item);
    });
    return merged;
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

  const readKnowledgeHub = (payload = {}) => {
    const hasNested = payload?.knowledgeHub && typeof payload.knowledgeHub === 'object';
    const src = hasNested
      ? payload.knowledgeHub
      : payload || {};
    const legacyBanned = !hasNested && !sanitizeText(payload?.manualDirectives || payload?.extraNotes || '')
      ? src.banned
      : '';
    return {
      brandVoice: sanitizeText(src.brandVoice || ''),
      brandStory: sanitizeText(src.brandStory || ''),
      brandCharacter: sanitizeText(src.brandCharacter || ''),
      characters: normalizeKnowledgeCharacters(
        hasNested ? src.characters : (payload?.knowledgeCharacters || []),
        src.brandCharacter || ''
      ),
      worldSetting: sanitizeText(src.worldSetting || src.knowledgeWorld || ''),
      brandRules: toArray(src.brandRules),
      bannedExpressions: toArray(src.bannedExpressions || legacyBanned),
      referenceContents: toArray(src.referenceContents),
      successCases: toArray(src.successCases)
    };
  };

  const splitNoteLines = (value = '') => {
    return String(value || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  };

  const buildLegacyKnowledgeLines = (knowledge) => {
    const lines = [];
    if (knowledge.brandVoice) lines.push(`브랜드 보이스: ${knowledge.brandVoice}`);
    if (knowledge.brandStory) lines.push(`브랜드 스토리: ${knowledge.brandStory}`);
    if (knowledge.brandCharacter) lines.push(`대표 캐릭터/주체: ${knowledge.brandCharacter}`);
    if (knowledge.worldSetting) lines.push(`세계관/배경: ${knowledge.worldSetting}`);
    if (knowledge.brandRules.length) lines.push(`반드시 지킬 브랜드 규칙: ${knowledge.brandRules.join(', ')}`);
    if (knowledge.bannedExpressions.length) lines.push(`금지 표현: ${knowledge.bannedExpressions.join(', ')}`);
    if (knowledge.referenceContents.length) lines.push(`참조 콘텐츠 방향: ${knowledge.referenceContents.join(', ')}`);
    if (knowledge.successCases.length) lines.push(`과거 성공 패턴: ${knowledge.successCases.join(', ')}`);
    return lines;
  };

  const extractManualDirectives = (payload = {}, knowledge = readKnowledgeHub(payload)) => {
    const preferred = sanitizeText(payload?.manualDirectives || '');
    if (preferred) return preferred;
    const legacyRaw = sanitizeText(payload?.extraNotes || payload?.banned || '');
    if (!legacyRaw) return '';
    const autoLines = new Set(buildLegacyKnowledgeLines(knowledge));
    return splitNoteLines(legacyRaw)
      .filter(line => !autoLines.has(line))
      .join('\n');
  };

  const renderKnowledgeHint = (payload = {}) => {
    const box = document.getElementById('scenario-knowledge-summary');
    if (!box) return;
    const knowledge = readKnowledgeHub(payload);
    const uiText = getScenarioUiText();
    const summaryItems = [
      knowledge.brandStory ? { key: 'brandStory', value: knowledge.brandStory } : null,
      knowledge.worldSetting ? { key: 'worldSetting', value: knowledge.worldSetting } : null,
      knowledge.brandCharacter ? { key: 'brandCharacter', value: knowledge.brandCharacter } : null,
      knowledge.brandVoice ? { key: 'brandVoice', value: knowledge.brandVoice } : null,
      knowledge.brandRules.length ? { key: 'brandRules', value: knowledge.brandRules.join(', ') } : null,
      knowledge.bannedExpressions.length ? { key: 'bannedExpressions', value: knowledge.bannedExpressions.join(', ') } : null,
      knowledge.referenceContents.length ? { key: 'referenceContents', value: knowledge.referenceContents.join(', ') } : null,
      knowledge.successCases.length ? { key: 'successCases', value: knowledge.successCases.join(', ') } : null
    ].filter(Boolean);
    if (!summaryItems.length) {
      box.innerHTML = `<p class="scenario-knowledge-empty">${escapeHtml(uiText.knowledgeEmpty)}</p>`;
      return;
    }
    box.innerHTML = summaryItems.map((item) => `
      <div class="scenario-knowledge-item" data-knowledge-key="${escapeHtml(item.key)}">
        <div class="scenario-knowledge-item-head">
          <strong>${escapeHtml(uiText.knowledgeLabels[item.key] || item.key)}</strong>
        </div>
        <span class="scenario-knowledge-item-body">${escapeHtml(normalizeKnowledgeDisplayValue(item.key, item.value))}</span>
      </div>
    `).join('');
  };

  const setScenarioLoading = (show, message) => {
    const overlay = document.getElementById('scenario-loading');
    if (!overlay) return;
    overlay.classList.toggle('hidden', !show);
    const textEl = overlay.querySelector('p');
    if (textEl) {
      textEl.textContent = show
        ? (message || '생성중...')
        : '생성중...';
    }
  };

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
        location: 'Location',
        visual: 'Visualization',
        narration: 'Narration',
        dialogue: 'Dialogue'
      };
    }
    return {
      location: '장소',
      visual: '시각화',
      narration: '나레이션',
      dialogue: '대사'
    };
  };

  const getScenarioUiText = () => SCENARIO_UI_TEXT[getUiLang()] || SCENARIO_UI_TEXT.ko;

  const normalizeKnowledgeDisplayValue = (key, value) => {
    const raw = String(value || '').trim();
    if (!raw) return raw;
    if (key !== 'brandCharacter') return raw;
    return raw
      .split('\n')
      .map(l => l.replace(/^[\s\-*•]+/, '').trim())
      .filter(l => !!l && !/^(브랜드\s*화자|화자|brand\s*speaker|speaker)$/i.test(l))
      .join('\n');
  };

  const translateScenarioOption = (value) => {
    const raw = String(value || '').trim();
    if (!raw || getUiLang() !== 'en') return raw;
    return OPTION_LABELS_EN[raw] || raw;
  };

  const firstOf = (value) => {
    if (Array.isArray(value)) return String(value.find(Boolean) || '').trim();
    return String(value || '').trim();
  };

  const extractNarrationOnlyText = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const line = raw.split('\n').map(x => x.trim()).find(Boolean) || raw;
    const m = line.match(/^(?:narration|나레이션)\s*[:：]?\s*["“”]?([\s\S]*?)["“”]?\s*$/i);
    if (!m) return raw;
    return String(m[1] || '').trim();
  };

  const renderSelectOptions = (select, items = [], selectedValue = '', placeholder = '', options = {}) => {
    if (!select) return;
    const allowEmpty = options.allowEmpty !== false;
    const current = String(selectedValue || '');
    const normalized = (Array.isArray(items) ? items : []).map((item) => {
      if (typeof item === 'string') {
        return {
          value: item,
          label: translateScenarioOption(item)
        };
      }
      return {
        value: String(item?.value || ''),
        label: getUiLang() === 'en' ? String(item?.en || item?.label || item?.ko || item?.value || '') : String(item?.ko || item?.label || item?.value || '')
      };
    });
    const html = [];
    if (allowEmpty) {
      html.push(`<option value="">${escapeHtml(placeholder)}</option>`);
    }
    normalized.forEach((item) => {
      const selected = item.value === current ? ' selected' : '';
      html.push(`<option value="${escapeHtml(item.value)}"${selected}>${escapeHtml(item.label)}</option>`);
    });
    select.innerHTML = html.join('');
    if (!allowEmpty && !normalized.some(item => item.value === current) && normalized[0]) {
      select.value = normalized[0].value;
    } else {
      select.value = current;
    }
  };

  const hasPresetDuration = (value) => DURATION_OPTIONS.some(item => item.value === String(value || ''));

  const getSelectedCharacters = (list = currentCharacters) => (
    normalizeCharacters(list, { defaultActive: false }).filter((character) => character.isActive)
  );

  const insertStoryCharacterToken = (currentValue, token, selectionStart, selectionEnd) => {
    const text = String(currentValue || '');
    const normalizedToken = String(token || '').trim();
    const max = text.length;
    const start = Math.max(0, Math.min(Number.isFinite(selectionStart) ? selectionStart : max, max));
    const end = Math.max(start, Math.min(Number.isFinite(selectionEnd) ? selectionEnd : start, max));
    if (!normalizedToken) return { value: text, caret: start };
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needsLeadingSpace = !!before && !/[\s([{'"“‘]$/.test(before);
    const needsTrailingSpace = !!after && !/^[\s)\]}"'”’.,!?;:]/.test(after);
    const inserted = `${needsLeadingSpace ? ' ' : ''}${normalizedToken}${needsTrailingSpace ? ' ' : ''}`;
    return {
      value: `${before}${inserted}${after}`,
      caret: before.length + inserted.length
    };
  };

  const cacheStorySelection = (textarea) => {
    if (!textarea) return;
    textarea.dataset.selectionStart = String(Number(textarea.selectionStart) || 0);
    textarea.dataset.selectionEnd = String(Number(textarea.selectionEnd) || 0);
  };

  const readStorySelection = (textarea) => {
    if (!textarea) return { start: 0, end: 0 };
    const valueLength = String(textarea.value || '').length;
    const active = document.activeElement === textarea;
    const start = active
      ? Number(textarea.selectionStart)
      : Number(textarea.dataset.selectionStart);
    const end = active
      ? Number(textarea.selectionEnd)
      : Number(textarea.dataset.selectionEnd);
    const safeStart = Number.isFinite(start) ? start : valueLength;
    const safeEnd = Number.isFinite(end) ? end : safeStart;
    return {
      start: Math.max(0, Math.min(safeStart, valueLength)),
      end: Math.max(0, Math.min(safeEnd, valueLength))
    };
  };

  const insertTokenIntoStoryField = (textarea, token) => {
    if (!textarea) return;
    const selection = readStorySelection(textarea);
    const next = insertStoryCharacterToken(textarea.value, token, selection.start, selection.end);
    textarea.value = next.value;
    textarea.focus();
    try {
      textarea.setSelectionRange(next.caret, next.caret);
    } catch (_) { }
    cacheStorySelection(textarea);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const isCharacterGenerationDisabled = (payload = {}) => {
    if (Array.isArray(payload?.characters)) {
      return !normalizeCharacters(payload.characters, { defaultActive: true }).some((character) => character.isActive);
    }
    return !getSelectedCharacters(currentCharacters).length;
  };
  const getActiveCharactersForPayload = (payload = {}) => (
    isCharacterGenerationDisabled(payload)
      ? []
      : (Array.isArray(payload?.characters) && payload.characters.length
        ? normalizeCharacters(payload.characters, { defaultActive: true }).filter((character) => character.isActive)
        : getSelectedCharacters(currentCharacters))
  );

  const renderStoryCharacterTokens = () => {
    const field = document.getElementById('scenario-story-field');
    const tokenBar = document.getElementById('scenario-story-token-bar');
    if (!field || !tokenBar) return;
    const activeCharacters = getSelectedCharacters(currentCharacters);
    if (!activeCharacters.length) {
      field.classList.remove('has-token-buttons');
      tokenBar.hidden = true;
      tokenBar.innerHTML = '';
      return;
    }
    tokenBar.innerHTML = activeCharacters.map((character) => `
      <button
        type="button"
        class="scenario-story-token-btn"
        data-insert-story-character="${escapeHtml(character.token)}"
        title="${escapeHtml(character.token)}">${escapeHtml(character.displayName)}</button>
    `).join('');
    tokenBar.hidden = false;
    field.classList.add('has-token-buttons');
  };

  const syncCharacterUi = () => {
    renderStoryCharacterTokens();
  };

  const setStoryStructureLoading = (loading) => {
    const storyFieldWrap = document.getElementById('scenario-story-field');
    const storyField = document.getElementById('scenario-story-input');
    const loadingEl = document.getElementById('scenario-story-loading');
    const aiBtn = document.querySelector('[data-action="scenario-structure-story"]');
    if (storyFieldWrap) storyFieldWrap.classList.toggle('is-loading', !!loading);
    if (loadingEl) loadingEl.hidden = !loading;
    if (storyField) {
      storyField.readOnly = !!loading;
      storyField.setAttribute('aria-busy', loading ? 'true' : 'false');
    }
    if (aiBtn) {
      aiBtn.disabled = !!loading;
      aiBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
    }
  };

  const updateStoryToggleButtonUi = (view) => {
    const toggleBtn = document.querySelector('[data-action="scenario-toggle-story-view"]');
    if (!toggleBtn) return;
    const isUser = String(view || '').trim() === 'user';
    const t = getScenarioUiText();
    const nextLabel = isUser ? (t.scenario_story_toggle_view_ai || 'AI 글 보기') : (t.scenario_story_toggle_view_user || '원본 보기');
    toggleBtn.setAttribute('aria-label', nextLabel);
    toggleBtn.setAttribute('title', nextLabel);
  };

  const renderOverviewSelects = (state = {}) => {
    const uiText = getScenarioUiText();
    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    const categoryValue = String(state.purposeCategory || categories[0] || '');
    const subgenres = NK.core.purposeCategories?.[categoryValue] || [];
    renderSelectOptions(document.getElementById('purpose-category'), categories, categoryValue, uiText.genrePlaceholder, { allowEmpty: false });
    renderSelectOptions(document.getElementById('purpose-tag-select'), subgenres, state.purposeTag, uiText.subgenrePlaceholder);
    renderSelectOptions(document.getElementById('target-select'), TARGET_OPTIONS, state.target, uiText.targetPlaceholder, { allowEmpty: false });
    renderSelectOptions(document.getElementById('needs-select'), NK.core.needsList || [], state.need, uiText.purposePlaceholder);
    renderSelectOptions(document.getElementById('tone-select'), NK.core.toneList || [], state.tone, uiText.tonePlaceholder);
    renderSelectOptions(document.getElementById('style-select'), NK.core.styleList || [], state.style, uiText.stylePlaceholder);
    renderSelectOptions(document.getElementById('duration-select'), DURATION_OPTIONS, state.durationPreset, uiText.durationPlaceholder);
    const durationCustomInput = document.getElementById('duration-custom-input');
    if (durationCustomInput) durationCustomInput.placeholder = uiText.durationCustomPlaceholder;
  };

  const getOverviewSelections = () => ({
    purposeCategory: document.getElementById('purpose-category')?.value || '',
    purposeTag: document.getElementById('purpose-tag-select')?.value || '',
    target: document.getElementById('target-select')?.value || '',
    need: document.getElementById('needs-select')?.value || '',
    tone: document.getElementById('tone-select')?.value || '',
    style: document.getElementById('style-select')?.value || '',
    durationPreset: document.getElementById('duration-select')?.value || '',
    durationCustom: document.getElementById('duration-custom-input')?.value || ''
  });

  const syncDurationInputs = (source = '') => {
    const durationSelect = document.getElementById('duration-select');
    const customInput = document.getElementById('duration-custom-input');
    if (!durationSelect || !customInput) return;
    const customValue = String(customInput.value || '').trim();
    if (source === 'custom' && customValue) {
      durationSelect.value = '';
      return;
    }
    if (source === 'preset' && durationSelect.value) {
      customInput.value = '';
      return;
    }
    if (!customValue && !durationSelect.value) {
      durationSelect.value = NK.config.DEFAULTS?.DURATION || '15';
    }
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
    payload.topic = sanitizeText(payload.topic || '');
    payload.story = sanitizeText(payload.story || '');
    const purposeTag = document.getElementById('purpose-tag-select')?.value || '';
    const need = document.getElementById('needs-select')?.value || '';
    const tone = document.getElementById('tone-select')?.value || '';
    const style = document.getElementById('style-select')?.value || '';
    const durationPreset = document.getElementById('duration-select')?.value || '';
    const durationCustom = String(document.getElementById('duration-custom-input')?.value || '').trim();
    const hasCustomDuration = /^\d+$/.test(durationCustom) && Number(durationCustom) > 0;
    payload.purposeTags = purposeTag ? [purposeTag] : [];
    payload.needs = need ? [need] : [];
    payload.tones = tone ? [tone] : [];
    payload.styles = style ? [style] : [];
    payload.tone = '';
    payload.style = '';
    payload.duration = hasCustomDuration
      ? String(Math.max(1, Math.floor(Number(durationCustom) || 0)))
      : (durationPreset || NK.config.DEFAULTS?.DURATION || '15');
    payload.durationMode = hasCustomDuration ? 'custom' : 'preset';
    payload.durationCustom = hasCustomDuration ? payload.duration : '';
    payload.aspectRatio = document.querySelector('.ratio-btn.active')?.dataset.ratio || '16:9';
    if (form.target) payload.target = form.target.value;
    const normalizedCharacters = normalizeCharacters(currentCharacters, { defaultActive: false });
    currentCharacters = normalizedCharacters;
    syncCharacterSeq(currentCharacters);
    const selectedCharacters = normalizedCharacters.filter((character) => character.isActive);
    payload.charactersEnabled = selectedCharacters.length > 0;
    payload.characters = selectedCharacters.map((c) => ({
      characterId: c.characterId,
      displayName: c.displayName,
      token: c.token,
      personality: c.personality || ''
    }));
    payload.narrationEnabled = !!document.querySelector('.scenario-flag-toggle[data-flag="narrationEnabled"]')?.classList.contains('active');
    payload.dubbingEnabled = !!document.querySelector('.scenario-flag-toggle[data-flag="dubbingEnabled"]')?.classList.contains('active');
    if (selectedCharacters.length) {
      const promptSeed = getScenarioPromptSeed(payload);
      const matchedTokens = payload.characters
        .filter(c => String(promptSeed || '').includes(c.displayName))
        .map(c => c.token);
      if (matchedTokens.length) payload.characterHints = matchedTokens;
    } else {
      payload.characterHints = [];
    }
    // Keep project/episode metadata while editing scenario fields.
    if (currentPayload && typeof currentPayload === 'object') {
      if (currentPayload.seriesId && !payload.seriesId) payload.seriesId = currentPayload.seriesId;
      if (currentPayload.seriesTitle && !payload.seriesTitle) payload.seriesTitle = currentPayload.seriesTitle;
      if (currentPayload.episodeTitle && !payload.episodeTitle) payload.episodeTitle = currentPayload.episodeTitle;
      if (currentPayload.parentProjectId && !payload.parentProjectId) payload.parentProjectId = currentPayload.parentProjectId;
      if (currentPayload.parentProjectTitle && !payload.parentProjectTitle) payload.parentProjectTitle = currentPayload.parentProjectTitle;
      if (currentPayload.sourceProjectId && !payload.sourceProjectId) payload.sourceProjectId = currentPayload.sourceProjectId;
      if (currentPayload.sourceProjectTitle && !payload.sourceProjectTitle) payload.sourceProjectTitle = currentPayload.sourceProjectTitle;
    }
    if (NK.service?.project?.applyProjectCore) {
      Object.assign(payload, NK.service.project.applyProjectCore(payload, { payload: currentPayload }));
    }
    const knowledge = readKnowledgeHub(payload);
    payload.manualDirectives = extractManualDirectives(payload, knowledge);
    payload.knowledgeHub = Object.assign({}, knowledge);
    return payload;
  };

  const renderDetectedCharacters = (brandId, rawPrompt, payload = {}) => {
    if (isCharacterGenerationDisabled(payload)) {
      return { ids: [], resolvedPrompt: String(rawPrompt || '') };
    }
    if (!(NK.service && NK.service.characterRegistry)) {
      return { ids: [], resolvedPrompt: String(rawPrompt || '') };
    }
    const knowledge = readKnowledgeHub(payload);
    const resolved = NK.service.characterRegistry.resolveCharactersFromPrompt(brandId, rawPrompt || '', { payload, allowNameFallback: true });
    try { console.log('Character parse (scenario):', { triggers: resolved.triggers || [], missing: resolved.missing || [] }); } catch (_) {}
    const ids = (resolved.characters || []).map(c => c.id);
    const res = NK.service.characterRegistry.buildResolvedPrompt({
      rawPrompt: String(rawPrompt || ''),
      characters: resolved.characters || [],
      brandRules: knowledge.brandRules || [],
      bannedExpressions: knowledge.bannedExpressions || []
    });
    try { console.log('Resolved prompt (scenario):', { resolvedPrompt: res.resolvedPrompt }); } catch (_) {}
    return { ids, resolvedPrompt: res.resolvedPrompt || '' };
  };

  const isAuthErrorMessage = (err) => {
    const msg = String(err?.message || err || '').trim();
    return /\b(401|403)\b|auth_required|invalid_session|session_expired/i.test(msg);
  };

  const normalizeScenes = (scenes = []) => {
    const activeCharacters = getActiveCharactersForPayload(currentPayload || {});
    const flags = getScenarioFlags(currentPayload || {});
    return (Array.isArray(scenes) ? scenes : []).map((s, i) => {
      const est = parseEst(s.estSec || s.duration || s.len || s.length || 8);
      const rawSubtitle = String(s.subtitleText || s.caption || s.lines || '').trim();
      const cleanedSubtitle = extractNarrationOnlyText(rawSubtitle);
      const rawNarration = s.narration || s.story || s.text || s.content || (
        (!Array.isArray(s.dialogue) || !s.dialogue.length) ? cleanedSubtitle : ''
      ) || '';
      const dialogues = normalizeDialogue(s.dialogue || s.dialogues || [], activeCharacters);
      const subtitleText = String(cleanedSubtitle || '').trim();
      const shot = firstFilledText(
        s.shot,
        s.visual,
        s.camera,
        s.scene_visual,
        s.image,
        rawNarration ? (String(rawNarration).split(/(?<=[.!?])\s+/)[0] || '') : ''
      );
      const narration = applyCharacterTokenHints(String(rawNarration || '').trim(), activeCharacters);
      const dialogue = dialogues.map((d) => ({
        speaker: applyCharacterTokenHints(d.speaker, activeCharacters),
        line: applyCharacterTokenHints(d.line, activeCharacters)
      }));
      const dialogueText = dialogue
        .map((d) => `${d.speaker ? `${d.speaker}: ` : ''}${d.line || ''}`.trim())
        .filter(Boolean)
        .join('\n');
      const narrationText = extractNarrationOnlyText(narration || '');
      const resolvedSubtitleText = subtitleText || (
        flags.narrationEnabled && flags.dubbingEnabled
          ? dialogue.map((d) => d.line || '').filter(Boolean).join(' ')
          : (flags.narrationEnabled ? narrationText : dialogue.map((d) => d.line || '').filter(Boolean).join(' '))
      );
      return {
        id: s.id != null ? s.id : (i + 1),
        lines: resolvedSubtitleText,
        narrationText,
        dialogueText,
        narration,
        dialogue,
        sceneLocation: firstFilledText(s.sceneLocation, s.location),
        backgroundStyle: firstFilledText(s.backgroundStyle, s.sharedBackgroundStyle),
        subtitleText: resolvedSubtitleText,
        videoSpeechPrompt: String(s.videoSpeechPrompt || '').trim(),
        script: String(s.script || '').trim(),
        shot: applyCharacterTokenHints(String(shot || '').trim(), activeCharacters),
        estSec: est,
        narrationEnabled: boolVal(s?.narrationEnabled, boolVal(currentPayload?.narrationEnabled, false)),
        dubbingEnabled: boolVal(s?.dubbingEnabled, boolVal(currentPayload?.dubbingEnabled, false))
      };
    });
  };

  const formatCommonInfo = () => {
    const p = currentPayload || {};
    const knowledge = readKnowledgeHub(p);
    const labels = getScenarioUiText().commonInfoLabels || {};
    const parts = [];
    if (p.topic) parts.push(`${labels.topic || 'Topic'}: ${p.topic}`);
    if (p.purposeCategory) parts.push(`${labels.genre || 'Genre'}: ${p.purposeCategory}${p.purposeTags?.length ? ` (${p.purposeTags.join(', ')})` : ''}`);
    if (p.target) parts.push(`${labels.audience || 'Audience'}: ${p.target}`);
    if (p.needs?.length) parts.push(`${labels.needs || 'Needs'}: ${p.needs.join(', ')}`);
    const toneStr = Array.from(new Set([...(p.tones || []), p.tone || ''].filter(Boolean))).join(', ');
    if (toneStr) parts.push(`${labels.tone || 'Tone'}: ${toneStr}`);
    const styleStr = Array.from(new Set([...(p.styles || []), p.style || ''].filter(Boolean))).join(', ');
    if (styleStr) parts.push(`${labels.style || 'Style'}: ${styleStr}`);
    if (knowledge.brandRules.length) parts.push(`${labels.brandRules || 'Brand Hub rules'}: ${knowledge.brandRules.length}개`);
    if (knowledge.bannedExpressions.length) parts.push(`${labels.blockedTerms || 'Blocked terms'}: ${knowledge.bannedExpressions.length}개`);
    return parts.join(' · ');
  };

  const buildCommonDetail = () => {
    const p = currentPayload || {};
    const knowledge = readKnowledgeHub(p);
    const labels = getScenarioUiText().commonDetailLabels || {};
    const infoLabels = getScenarioUiText().commonInfoLabels || {};
    const esc = escapeHtml;

    const field = (label, value) => {
      if (!value) return '';
      const lines = String(value).split('\n').map(l => l.trim()).filter(Boolean);
      const valueHtml = lines.length > 1
        ? `<ul class="cpd-list">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
        : `<span class="cpd-value">${esc(lines[0] || '')}</span>`;
      return `<div class="cpd-field"><span class="cpd-label">${esc(label)}</span>${valueHtml}</div>`;
    };

    const parts = [];
    parts.push(`<h2 class="cpd-modal-title">${esc(labels.modalTitle || 'Common Prompt')}</h2>`);

    // Common Block
    const headerText = p.header || '';
    parts.push(`<section class="cpd-section">`);
    parts.push(`<h3 class="cpd-section-title"><span class="cpd-section-marker">◆</span>${esc(labels.sectionBlock || labels.title || 'Common Block')}</h3>`);
    if (headerText) {
      const headerHtml = String(headerText).split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => `<p>${esc(l)}</p>`).join('');
      parts.push(`<div class="cpd-header-block">${headerHtml}</div>`);
    } else {
      parts.push(`<p class="cpd-empty">${esc(labels.empty || '')}</p>`);
    }
    parts.push(`</section>`);

    // Episode Overview
    if (p.topic || p.story) {
      parts.push(`<section class="cpd-section">`);
      parts.push(`<h3 class="cpd-section-title"><span class="cpd-section-marker">◆</span>${esc(labels.sectionOverview || 'Episode Overview')}</h3>`);
      parts.push(`<div class="cpd-fields">`);
      if (p.topic) parts.push(field(infoLabels.topic || 'Topic', p.topic));
      if (p.story) parts.push(field(infoLabels.story || 'Story', p.story));
      parts.push(`</div>`);
      parts.push(`</section>`);
    }

    // Brand Hub
    const hasHub = knowledge.brandVoice || knowledge.brandStory || knowledge.brandCharacter
      || knowledge.worldSetting || knowledge.brandRules.length || knowledge.bannedExpressions.length;
    if (hasHub) {
      parts.push(`<section class="cpd-section">`);
      parts.push(`<h3 class="cpd-section-title"><span class="cpd-section-marker">◆</span>${esc(labels.sectionHub || 'Brand Hub')}</h3>`);
      parts.push(`<div class="cpd-fields">`);
      if (knowledge.brandVoice) parts.push(field(labels.brandVoice || 'Brand voice', knowledge.brandVoice));
      if (knowledge.brandStory) parts.push(field(labels.brandStory || 'Brand story', knowledge.brandStory));
      if (knowledge.brandCharacter) parts.push(field(labels.brandCharacter || 'Brand character', normalizeKnowledgeDisplayValue('brandCharacter', knowledge.brandCharacter)));
      if (knowledge.worldSetting) parts.push(field(labels.worldSetting || 'World setting', knowledge.worldSetting));
      if (knowledge.brandRules.length) parts.push(field(labels.brandRules || 'Brand rules', knowledge.brandRules.join('\n')));
      if (knowledge.bannedExpressions.length) parts.push(field(labels.bannedExpressions || 'Banned expressions', knowledge.bannedExpressions.join('\n')));
      parts.push(`</div>`);
      parts.push(`</section>`);
    }

    return parts.join('');
  };

  const getCommonBackgroundStyleFromCard = () => '';

  const setActiveScenarioCard = (targetCard) => {
    const container = document.getElementById('scenario-cards');
    if (!container || !targetCard) return;
    container.querySelectorAll('.scenario-card.active-card').forEach(card => {
      card.classList.remove('active-card');
    });
    targetCard.classList.add('active-card');
  };

  const clearActiveScenarioCards = () => {
    const container = document.getElementById('scenario-cards');
    if (!container) return;
    container.querySelectorAll('.scenario-card.active-card').forEach(card => {
      card.classList.remove('active-card');
    });
  };

  const setScenarioCardCollapsed = (card, collapsed, animate) => {
    if (!card || card.classList.contains('scenario-card-common')) return;
    const sceneId = String(card.dataset.sceneId || '').trim();
    const toggleBtn = card.querySelector('.scenario-card-toggle');
    const updateToggle = () => {
      if (toggleBtn) {
        toggleBtn.textContent = collapsed ? '+' : '-';
        toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggleBtn.setAttribute('aria-label', collapsed ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse);
        toggleBtn.setAttribute('title', collapsed ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse);
      }
    };
    if (sceneId) { if (collapsed) collapsedSceneIds.add(sceneId); else collapsedSceneIds.delete(sceneId); }

    if (animate !== false && card.offsetParent !== null) {
      const DURATION = 280;
      if (collapsed) {
        const startH = card.scrollHeight;
        card.style.transition = 'none';
        card.style.height = startH + 'px';
        card.style.minHeight = startH + 'px';
        card.style.maxHeight = startH + 'px';
        card.style.overflow = 'hidden';
        card.offsetHeight; // reflow
        card.style.transition = 'height ' + DURATION + 'ms ease, min-height ' + DURATION + 'ms ease, max-height ' + DURATION + 'ms ease, padding ' + DURATION + 'ms ease';
        card.classList.add('is-collapsed');
        card.style.height = '46px';
        card.style.minHeight = '46px';
        card.style.maxHeight = '46px';
        updateToggle();
        setTimeout(() => { card.style.cssText = ''; }, DURATION + 20);
      } else {
        card.classList.remove('is-collapsed');
        card.style.transition = 'none';
        card.style.height = '46px';
        card.style.minHeight = '46px';
        card.style.maxHeight = '46px';
        card.style.overflow = 'hidden';
        card.offsetHeight; // reflow
        const targetH = card.scrollHeight;
        card.style.transition = 'height ' + DURATION + 'ms ease, min-height ' + DURATION + 'ms ease, max-height ' + DURATION + 'ms ease, padding ' + DURATION + 'ms ease';
        card.style.height = targetH + 'px';
        card.style.minHeight = targetH + 'px';
        card.style.maxHeight = targetH + 'px';
        updateToggle();
        setTimeout(() => { card.style.cssText = ''; }, DURATION + 20);
      }
    } else {
      card.classList.toggle('is-collapsed', !!collapsed);
      updateToggle();
    }
  };

  const toggleScenarioCardCollapsed = (card) => {
    if (!card || card.classList.contains('scenario-card-common')) return;
    setScenarioCardCollapsed(card, !card.classList.contains('is-collapsed'));
  };

  const collectScenesFromCards = () => {
    const flags = getScenarioFlags(currentPayload || {});
    const composeDialogueOnlyText = (dialogue = []) => (Array.isArray(dialogue) ? dialogue : [])
      .map((d) => String(d?.line || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    const composeDialoguePrompt = (dialogue = []) => (Array.isArray(dialogue) ? dialogue : [])
      .map((d) => {
        const speaker = String(d?.speaker || '').trim();
        const line = String(d?.line || '').trim();
        if (!line) return '';
        if (!speaker || speaker === '@narrator') return `"${line}"`;
        return `${speaker.replace(/^@+/, '')}가 말한다. "${line}"`;
      })
      .filter(Boolean)
      .join(' ')
      .trim();
    return Array.from(document.querySelectorAll('.scenario-card:not(.scenario-card-common)')).map((card) => {
      const id = Number(card.querySelector('.est-input')?.dataset.id);
      const estTxt = card.querySelector('.est-input')?.value || '';
      const est = parseEst(estTxt);
      const narrationText = card.querySelector('.view-narration-lines')?.textContent?.trim() || '';
      const uiDialogueText = card.querySelector('.view-dialogue-lines')?.textContent?.trim() || '';
      const locationText = card.querySelector('.view-location-lines')?.textContent?.trim() || '';
      const normalizedDialogueText = uiDialogueText.replace(/\s*·\s*/g, '\n');
      const dialogue = normalizeDialogue(normalizedDialogueText, currentCharacters);
      const visualText = card.querySelector('.view-shot')?.textContent?.trim() || '';
      const cleanNarration = extractNarrationOnlyText(narrationText);
      const dialogueOnly = composeDialogueOnlyText(dialogue);
      const videoSpeechPrompt = flags.narrationEnabled && flags.dubbingEnabled
        ? [cleanNarration ? `"${cleanNarration}"` : '', composeDialoguePrompt(dialogue)].filter(Boolean).join(' ').trim()
        : (flags.narrationEnabled
          ? cleanNarration
          : composeDialoguePrompt(dialogue));
      const subtitleText = flags.narrationEnabled && flags.dubbingEnabled
        ? dialogueOnly
        : (flags.narrationEnabled ? cleanNarration : dialogueOnly);
      const script = flags.narrationEnabled && flags.dubbingEnabled
        ? [cleanNarration, dialogueOnly].filter(Boolean).join('\n').trim()
        : (flags.narrationEnabled ? cleanNarration : dialogueOnly);
      return {
        id,
        title: '',
        lines: subtitleText,
        subtitleText,
        sceneLocation: locationText,
        videoSpeechPrompt,
        script,
        narration: cleanNarration,
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
      const sceneLocation = (s.sceneLocation !== undefined ? s.sceneLocation : prev.sceneLocation) || '';
      const subtitleText = (s.subtitleText !== undefined ? s.subtitleText : prev.subtitleText) || s.lines || prev.lines || '';
      const videoSpeechPrompt = (s.videoSpeechPrompt !== undefined ? s.videoSpeechPrompt : prev.videoSpeechPrompt) || '';
      const script = (s.script !== undefined ? s.script : prev.script) || '';
      return Object.assign({}, prev, s, {
        lines: subtitleText,
        narration,
        dialogue,
        sceneLocation,
        subtitleText,
        videoSpeechPrompt,
        script,
        shot: visual,
        visual
      });
    });
  };

  const renderCharacterChips = () => {
    const box = document.getElementById('character-chips');
    const list = normalizeCharacters(currentCharacters, { defaultActive: false });
    currentCharacters = list;
    syncCharacterSeq(list);
    if (!list.length) {
      if (box) box.innerHTML = `<p class="scenario-character-empty">${escapeHtml(getScenarioText('scenario_character_empty', '등록된 캐릭터가 없습니다.'))}</p>`;
      return;
    }
    if (box) {
      box.innerHTML = list.map((c) => `
      <button
        type="button"
        class="scenario-flag-toggle scenario-character-toggle${c.isActive ? ' active' : ''}"
        data-toggle-character="${c.characterId}"
        aria-pressed="${c.isActive ? 'true' : 'false'}">${escapeHtml(c.displayName)}</button>
    `).join('');
    }
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
            <p class="muted">${escapeHtml(getScenarioUiText().emptyScenarioTitle)}</p>
            <p class="muted small">${escapeHtml(getScenarioUiText().emptyScenarioHelp)}</p>
          </div>
        </div>`;
      return;
    }
    const tCopyTitle = (getScenarioUiText().copyTitle || '복사');
    const tCopyAria = (getScenarioUiText().copyScenarioAria || '시나리오 복사');
    const commonInfoRow = commonInfo
      ? `<div class="common-info-row" id="common-info-row"><button class="common-info-play common-info-copy" id="common-copy-btn" data-i18n-title="copyTitle" data-i18n-aria-label="copyScenarioAria" title="${escapeHtml(tCopyTitle)}" aria-label="${escapeHtml(tCopyAria)}">⧉</button><button class="common-info-play" id="common-info-btn" aria-label="${escapeHtml(getScenarioUiText().commonPromptAria)}">▶</button><span class="muted tiny">${commonInfo}</span></div>`
      : '';
    const commonBlock = commonInfoRow;
    container.innerHTML = commonBlock + sceneList.map(s => `
      <div class="scenario-card${collapsedSceneIds.has(String(s.id)) ? ' is-collapsed' : ''}" data-scene-id="${s.id}">
        <div class="card-top">
          <div class="card-title-row">
            <h5>Scene ${s.id}</h5>
            <input class="chip-input est-input" data-id="${s.id}" value="${fmtEst(s.estSec)}" />
          </div>
          <button type="button" class="scenario-circle-toggle scenario-card-toggle" aria-expanded="${collapsedSceneIds.has(String(s.id)) ? 'false' : 'true'}" aria-label="${escapeHtml(collapsedSceneIds.has(String(s.id)) ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse)}" title="${escapeHtml(collapsedSceneIds.has(String(s.id)) ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse)}">${collapsedSceneIds.has(String(s.id)) ? '+' : '-'}</button>
        </div>
        <div class="scene-visual-grid">
          <div class="field-block">
            <p class="field-label muted small">${labels.location}</p>
            <p class="view-lines view-location-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.sceneLocation || '')}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">${labels.visual}</p>
            <p class="view-shot view-shot-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.shot || '')}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">${labels.narration}</p>
            <p class="view-lines view-narration-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.narrationText || '')}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">${labels.dialogue}</p>
            <p class="view-lines view-dialogue-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(String(s.dialogueText || dialogueToText(s.dialogue || []))
              .replace(/\r?\n+/g, ' · '))}</p>
          </div>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('.scenario-card.is-collapsed').forEach((card) => setScenarioCardCollapsed(card, true));
    const firstCard = container.querySelector('.scenario-card:not(.scenario-card-common)');
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
    const overviewFields = resolveOverviewStoryFields(p, draft);
    const rawHeader = draft.header || p.header || '';
    const header = sanitizeHeader(rawHeader);
    const flags = getScenarioFlags(p || {});
    const explicitCharacters = normalizeCharacters(p.characters || draft.characters || [], { defaultActive: true });
    const knowledgeCharacters = readKnowledgeHub(p || {}).characters || [];
    currentCharacters = mergeCharacterSources(explicitCharacters, knowledgeCharacters, p.brandCharacter || '');
    syncCharacterSeq(currentCharacters);
    currentPayload = Object.assign({}, p || {}, overviewFields, flags, {
      characters: getSelectedCharacters(currentCharacters),
      charactersEnabled: getSelectedCharacters(currentCharacters).length > 0,
      header
    });
    const defaults = NK.config.DEFAULTS || {};
    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    const defaultCat = p.purposeCategory || categories[0] || '';
    const selectedPurposeTag = firstOf(p.purposeTags);
    const selectedNeed = firstOf(p.needs);
    const selectedTone = firstOf(p.tones) || sanitizeText(p.tone || '');
    const selectedStyle = firstOf(p.styles) || sanitizeText(p.style || '');
    const durationValue = String(p.duration || defaults.DURATION || '15');
    const selectedDurationPreset = hasPresetDuration(p.durationMode === 'custom' ? '' : durationValue) ? durationValue : '';
    const selectedDurationCustom = p.durationMode === 'custom'
      ? String(p.durationCustom || durationValue || '')
      : (hasPresetDuration(durationValue) ? '' : durationValue);
    if (form.topic) form.topic.value = overviewFields.topic || draft.title || '';
    if (form.story) form.story.value = overviewFields.story || '';
    if (form.story) cacheStorySelection(form.story);
    renderOverviewSelects({
      purposeCategory: defaultCat,
      purposeTag: selectedPurposeTag,
      target: p.target || TARGET_OPTIONS[0]?.value || '',
      need: selectedNeed,
      tone: selectedTone,
      style: selectedStyle,
      durationPreset: selectedDurationPreset || defaults.DURATION || '15',
      durationCustom: selectedDurationCustom
    });
    const customDurationInput = document.getElementById('duration-custom-input');
    if (customDurationInput) customDurationInput.value = selectedDurationCustom;
    // toggles
    setActiveButtons('.ratio-btn', p.aspectRatio || '16:9');
    setScenarioToggleButtons(flags);
    renderCharacterChips();
    syncCharacterUi();
    syncDurationInputs(selectedDurationCustom ? 'custom' : 'preset');
    renderKnowledgeHint(currentPayload);

    scenario.renderScenes(draft.scenes || []);
  };

  // ---------- init ----------
  scenario.init = async function () {
    const form = document.getElementById('scenario-form');
    if (!form) return;
    const tInit = getScenarioUiText();
    const aiBtnInit = document.querySelector('.scenario-story-ai-btn');
    if (aiBtnInit) {
      const titleText = tInit.scenario_story_ai_title || '이야기를 AI로 정리';
      aiBtnInit.setAttribute('title', titleText);
      aiBtnInit.setAttribute('aria-label', titleText);
    }
    const storyField = form.story || document.getElementById('scenario-story-input');
    if (storyField) {
      ['focus', 'click', 'keyup', 'select', 'input'].forEach((eventName) => {
        storyField.addEventListener(eventName, () => cacheStorySelection(storyField));
      });
      cacheStorySelection(storyField);
    }
    const knowledgeGroup = document.querySelector('.scenario-knowledge-group');
    const knowledgeToggle = document.getElementById('scenario-knowledge-toggle');
    const knowledgeSummary = document.getElementById('scenario-knowledge-summary');
    const syncKnowledgeToggle = (collapsed) => {
      if (knowledgeGroup) knowledgeGroup.classList.toggle('is-collapsed', !!collapsed);
      if (knowledgeToggle) {
        knowledgeToggle.textContent = collapsed ? '+' : '-';
        knowledgeToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      }
    };
    syncKnowledgeToggle(true);
    if (knowledgeToggle) {
      knowledgeToggle.addEventListener('click', () => {
        const collapsed = !(knowledgeGroup && knowledgeGroup.classList.contains('is-collapsed'));
        syncKnowledgeToggle(collapsed);
        if (!collapsed) {
          window.setTimeout(() => {
            if (knowledgeGroup && typeof knowledgeGroup.scrollIntoView === 'function') {
              knowledgeGroup.scrollIntoView({ behavior: 'smooth', block: 'end' });
            } else if (knowledgeSummary && typeof knowledgeSummary.scrollIntoView === 'function') {
              knowledgeSummary.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }
          }, 120);
        }
      });
    }

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

    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    renderOverviewSelects({
      purposeCategory: categories[0] || '',
      target: TARGET_OPTIONS[0]?.value || '',
      durationPreset: NK.config.DEFAULTS?.DURATION || '15'
    });

    // 화면 비율 버튼 이벤트
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
          if (NK.service?.project?.upsertLocalDraft) {
            draft = NK.service.project.upsertLocalDraft(draft, { setCurrent: true }) || draft;
          } else if (NK.service?.project?.setCurrent) {
            NK.service.project.setCurrent(draft);
          }
        }
      } catch (_) { }
    }

    // 저장된 초안 로드
    loadDraft(draft);
    if (!draft) {
      currentCharacters = [];
      currentPayload = Object.assign({}, currentPayload || {}, DEFAULT_SCENARIO_FLAGS, { characters: [], charactersEnabled: false });
      setScenarioToggleButtons(DEFAULT_SCENARIO_FLAGS);
      renderCharacterChips();
      syncCharacterUi();
      renderKnowledgeHint(currentPayload);
    }

    const syncOverviewPayload = () => {
      currentPayload = Object.assign({}, currentPayload || {}, collectPayload());
      renderKnowledgeHint(currentPayload);
    };

    const organizeStoryDraft = async (triggerBtn) => {
      const storyField = form.story || document.getElementById('scenario-story-input');
      if (!storyField) return;
      const payload = collectPayload();
      const rawStory = String(payload.story || '').trim();
      if (!rawStory) {
        alert(getScenarioText('scenario_story_required', '이야기를 먼저 입력해 주세요.'));
        storyField.focus();
        return;
      }
      if (!NK.api || !NK.api.storyStructure) {
        storyField.value = rawStory.replace(/\s+/g, ' ').trim();
        syncOverviewPayload();
        return;
      }
      setStoryStructureLoading(true);
      try {
        const result = await NK.api.storyStructure(Object.assign({}, payload, { language: getRuntimeLang() }));
        const nextStory = sanitizeText(result?.story || rawStory);
        if (nextStory) {
          storyField.dataset.userStory = rawStory;
          storyField.dataset.aiStory = nextStory;
          storyField.dataset.view = 'ai';
          storyField.value = nextStory;
          cacheStorySelection(storyField);
          syncOverviewPayload();
          updateStoryToggleButtonUi('ai');
        }
      } catch (err) {
        alert(getScenarioText('scenario_story_structure_failed', '이야기 정리 실패') + ': ' + (err?.message || err));
      } finally {
        setStoryStructureLoading(false);
      }
    };

    const toggleStoryView = () => {
      const storyField = form.story || document.getElementById('scenario-story-input');
      if (!storyField) return;
      const aiText = String(storyField.dataset.aiStory || '').trim();
      const userText = String(storyField.dataset.userStory || '').trim() || String(storyField.value || '').trim();
      if (!aiText) {
        alert(getScenarioText('scenario_story_ai_unavailable', 'AI로 정리한 내용이 없습니다.'));
        return;
      }
      const currentView = String(storyField.dataset.view || 'ai');
      if (currentView === 'ai') {
        storyField.value = userText;
        storyField.dataset.view = 'user';
        storyField.dataset.userStory = userText;
        cacheStorySelection(storyField);
        syncOverviewPayload();
        updateStoryToggleButtonUi('user');
      } else {
        storyField.value = aiText;
        storyField.dataset.view = 'ai';
        storyField.dataset.aiStory = aiText;
        cacheStorySelection(storyField);
        syncOverviewPayload();
        updateStoryToggleButtonUi('ai');
      }
    };

    // 토글/버튼 클릭
    form.addEventListener('click', (e) => {
      const storyTokenBtn = e.target.closest('[data-insert-story-character]');
      if (storyTokenBtn) {
        e.preventDefault();
        insertTokenIntoStoryField(storyField, storyTokenBtn.dataset.insertStoryCharacter || '');
        return;
      }
      const aiBtn = e.target.closest('[data-action="scenario-structure-story"]');
      if (aiBtn) {
        e.preventDefault();
        organizeStoryDraft(aiBtn);
        return;
      }
      const toggleBtn = e.target.closest('[data-action="scenario-toggle-story-view"]');
      if (toggleBtn) {
        e.preventDefault();
        toggleStoryView();
        return;
      }
      const btn = e.target.closest('.ratio-btn, .scenario-flag-toggle');
      if (!btn) return;
      if (btn.classList.contains('ratio-btn')) {
        setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      } else if (btn.classList.contains('scenario-flag-toggle')) {
        btn.classList.toggle('active');
        currentPayload = Object.assign({}, currentPayload || {}, {
          narrationEnabled: !!document.querySelector('.scenario-flag-toggle[data-flag="narrationEnabled"]')?.classList.contains('active'),
          dubbingEnabled: !!document.querySelector('.scenario-flag-toggle[data-flag="dubbingEnabled"]')?.classList.contains('active'),
          characters: getSelectedCharacters(currentCharacters)
        });
      }
      syncOverviewPayload();
    });

    form.addEventListener('change', (e) => {
      const target = e.target;
      if (!target) return;
      if (target.id === 'purpose-category') {
        renderOverviewSelects(Object.assign({}, getOverviewSelections(), {
          purposeCategory: target.value,
          purposeTag: ''
        }));
      } else if (target.id === 'duration-select') {
        syncDurationInputs('preset');
      }
      syncOverviewPayload();
    });

    form.addEventListener('input', (e) => {
      const target = e.target;
      if (!target) return;
      if (target.id === 'duration-custom-input') {
        syncDurationInputs('custom');
      }
      if (target.name === 'story') {
        const storyField = target;
        const view = String(storyField.dataset.view || '').trim();
        if (view === 'user') storyField.dataset.userStory = String(storyField.value || '');
        else if (view === 'ai') storyField.dataset.aiStory = String(storyField.value || '');
      }
      if (target.id === 'duration-custom-input' || target.name === 'topic' || target.name === 'story') syncOverviewPayload();
    });

    form.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('[data-toggle-character]');
      if (!toggleBtn) return;
      const toggleId = String(toggleBtn.dataset.toggleCharacter || '').trim();
      if (!toggleId) return;
      currentCharacters = normalizeCharacters(currentCharacters, { defaultActive: false }).map((character) => (
        String(character.characterId) === toggleId
          ? Object.assign({}, character, { isActive: !character.isActive })
          : character
      ));
      renderCharacterChips();
      syncCharacterUi();
      syncOverviewPayload();
    });

    const cardsContainer = document.getElementById('scenario-cards');
    if (cardsContainer) {
      cardsContainer.addEventListener('click', (e) => {
        const card = e.target && e.target.closest ? e.target.closest('.scenario-card') : null;
        if (!card) return;
        const toggleBtn = e.target && e.target.closest ? e.target.closest('.scenario-card-toggle') : null;
        if (toggleBtn) {
          e.preventDefault();
          e.stopPropagation();
          toggleScenarioCardCollapsed(card);
          return;
        }
        setActiveScenarioCard(card);
      });

      document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (target.closest('.scenario-card')) return;
        clearActiveScenarioCards();
      });

      cardsContainer.addEventListener('focusin', (e) => {
        const card = e.target && e.target.closest ? e.target.closest('.scenario-card') : null;
        if (!card) return;
        setActiveScenarioCard(card);
      });
      
      cardsContainer.addEventListener('keydown', (e) => {
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (!target.matches('.view-dialogue-lines[contenteditable="true"]')) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          try {
            document.execCommand('insertText', false, ' · ');
          } catch (_) {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(' · '));
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
      
      cardsContainer.addEventListener('paste', (e) => {
        const target = e.target;
        if (!target || !(target instanceof HTMLElement)) return;
        if (!target.matches('.view-dialogue-lines[contenteditable="true"]')) return;
        e.preventDefault();
        let text = '';
        try {
          text = (e.clipboardData || window.clipboardData).getData('text');
        } catch (_) { }
        const oneLine = String(text || '').replace(/\r?\n+/g, ' · ');
        try {
          document.execCommand('insertText', false, oneLine);
        } catch (_) {
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(oneLine));
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }

    const rerenderForLocale = () => {
      const latest = collectScenesFromCards();
      const mergedScenes = mergeSceneSnapshots(draft?.scenes || [], latest);
      if (draft) draft.scenes = mergedScenes;
      renderOverviewSelects(getOverviewSelections());
      syncDurationInputs();
      renderCharacterChips();
      syncCharacterUi();
      renderKnowledgeHint(currentPayload);
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

    form.addEventListener('reset', () => {
      setTimeout(() => {
        const knowledge = readKnowledgeHub(currentPayload || {});
        currentCharacters = normalizeKnowledgeCharacters(knowledge.characters || [], knowledge.brandCharacter || '');
        renderOverviewSelects({
          purposeCategory: categories[0] || '',
          target: TARGET_OPTIONS[0]?.value || '',
          durationPreset: NK.config.DEFAULTS?.DURATION || '15'
        });
        const durationCustomInput = document.getElementById('duration-custom-input');
        if (durationCustomInput) durationCustomInput.value = '';
        renderCharacterChips();
        syncDurationInputs();
        syncCharacterUi();
        setScenarioToggleButtons(DEFAULT_SCENARIO_FLAGS);
        currentPayload = Object.assign({}, currentPayload || {}, DEFAULT_SCENARIO_FLAGS, { characters: [], charactersEnabled: false });
        renderKnowledgeHint(currentPayload);
      }, 0);
    });

    // 시나리오 생성
    form.onsubmit = async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('scenario-error');
      if (errEl) errEl.classList.add('hidden');
      NK.core.setLoading(true, '생성중...');
      const payload = collectPayload();
      try {
        const brandId = (NK.service && NK.service.project && NK.service.project.getBrandId) ? NK.service.project.getBrandId(payload) : (payload.brandId || '');
        const promptSeed = getScenarioPromptSeed(payload);
        const preview = renderDetectedCharacters(brandId, promptSeed, payload) || { ids: [], resolvedPrompt: '' };
        payload.rawPrompt = promptSeed;
        payload.resolvedPrompt = preview.resolvedPrompt || promptSeed;
        payload.resolvedCharacterIds = preview.ids || [];
        payload.characterRegistryVersion = (NK.service && NK.service.characterRegistry && NK.service.characterRegistry.VERSION) ? NK.service.characterRegistry.VERSION : '0';
      } catch (_) { }
      const topicLength = String(getScenarioNarrativeText(payload) || '').length;
      const isLongInput = topicLength >= 2800;
      setScenarioLoading(true, isLongInput ? '긴 입력을 파트별로 분석하는 중...' : '시나리오 생성 중...');
      try {
        const res = await NK.api.scenario(payload);
        const headerText = (NK.service?.project?.buildVisualHeader)
          ? NK.service.project.buildVisualHeader(payload)
          : '';
        if (res?.scenes) {
          const normalized = normalizeScenes(res.scenes);
          draft = draft || { id: Date.now(), title: payload.topic || '새 프로젝트' };
          draft.title = payload.topic || draft.title || '새 프로젝트';
          draft.payload = payload;
          draft.scenes = normalized;
          draft.header = headerText || draft.header || '';
          currentPayload = Object.assign({}, draft.payload, { header: draft.header });
          if (NK.service?.project?.upsertLocalDraft) {
            draft = NK.service.project.upsertLocalDraft(draft, { setCurrent: true }) || draft;
          } else {
            if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
            NK.store.saveDrafts([draft]);
          }
          let saveWarning = '';
          if (NK.api?.projectSave) {
            try {
              await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header, aspectRatio: draft.payload?.aspectRatio, title: draft.title });
            } catch (saveErr) {
              if (isAuthErrorMessage(saveErr)) {
                saveWarning = '로그인되지 않아 서버 저장은 건너뛰고 이 브라우저에만 저장했습니다.';
                try { if (NK.auth?.logout) NK.auth.logout(); } catch (_) { }
              } else {
                throw saveErr;
              }
            }
          }
          if (NK.state) {
            if (NK.state.broadcast) NK.state.broadcast('update-project', { project: draft });
          }
          loadDraft(draft);
          if (errEl) {
            const notices = [];
            if (res?.fallback) notices.push('일부 오류로 기본 시나리오를 사용했습니다.');
            if (res?.meta?.partial) notices.push(`긴 입력 중 일부 파트가 실패해 생성 가능한 씬만 반영했습니다. (${res.meta.failedChunks || 0}개 파트 실패)`);
            if (saveWarning) notices.push(saveWarning);
            if (notices.length) {
              errEl.textContent = `안내: ${notices.join(' ')}`;
              errEl.classList.remove('hidden');
            } else {
              errEl.classList.add('hidden');
            }
          }
          if (res?.meta?.chunked) {
            alert(`시나리오를 생성했습니다. 긴 입력을 ${res.meta.chunkCount}개 파트로 나누어 처리했습니다.${saveWarning ? (' ' + saveWarning) : ''}`);
          } else {
            alert(`시나리오를 생성했습니다.${saveWarning ? (' ' + saveWarning) : ''}`);
          }
        }
      } catch (err) {
        const isCreditErr = err?.creditExhausted || /CREDIT_EXHAUSTED/.test(err?.message || '');
        if (isCreditErr) {
          if (errEl) {
            errEl.innerHTML = '크레딧이 소진되었습니다. <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Anthropic 콘솔</a>에서 충전 후 다시 시도해 주세요.';
            errEl.classList.remove('hidden');
          }
          alert('크레딧이 소진되었습니다.\n\nconsole.anthropic.com/settings/billing 에서 충전 후 다시 시도해 주세요.');
        } else if (errEl) {
          errEl.textContent = '시나리오 생성 실패: ' + (err?.message || err);
          errEl.classList.remove('hidden');
        } else {
          alert('시나리오 생성 실패: ' + (err?.message || err));
        }
      } finally {
        setScenarioLoading(false);
        NK.core.setLoading(false);
      }
    };

    // 저장 버튼
    const saveBtn = document.getElementById('save-draft');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        NK.core.setLoading(true, '저장중...');
        try {
          draft = draft || { id: Date.now(), title: '새 프로젝트' };
          draft.payload = collectPayload();
          draft.title = draft.payload.topic || draft.title || '새 프로젝트';
          draft.scenes = mergeSceneSnapshots(draft.scenes || [], collectScenesFromCards());
          if (NK.service?.project?.upsertLocalDraft) {
            draft = NK.service.project.upsertLocalDraft(draft, { setCurrent: true }) || draft;
          } else {
            if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
            NK.store.saveDrafts([draft]);
          }
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
          body.innerHTML = buildCommonDetail();
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
    document.addEventListener('click', async (e) => {
      const target = e.target;
      if (target && target.id === 'common-copy-btn') {
        try {
          const info = formatCommonInfo();
          const headerText = buildCommonDetail();
          const latest = collectScenesFromCards();
          const mergedScenes = mergeSceneSnapshots(draft?.scenes || [], latest);
          const makeBlock = (s) => {
            const lines = [];
            lines.push(`Scene ${s.id} · ${fmtEst(s.estSec)}`);
            if (s.sceneLocation || s.location) lines.push(`장소: ${s.sceneLocation || s.location || ''}`.trim());
            if (s.shot || s.visual) lines.push(`시각화: ${s.shot || s.visual || ''}`.trim());
            if (s.narrationText || s.narration) lines.push(`나레이션: ${s.narrationText || s.narration || ''}`.trim());
            const dlg = s.dialogueText || dialogueToText(s.dialogue || []);
            if (dlg) lines.push(`대사:\n${dlg}`);
            return lines.filter(Boolean).join('\n');
          };
          const sceneBlocks = (mergedScenes.length ? mergedScenes : (draft?.scenes || [])).map(makeBlock).join('\n\n');
          const parts = [];
          if (info) parts.push(`▶ ${info}`);
          if (headerText) parts.push(headerText);
          if (sceneBlocks) parts.push(sceneBlocks);
          const text = parts.filter(Boolean).join('\n\n');
          let ok = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
          }
          if (!ok) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand('copy'); ok = true; } catch (_) {}
            document.body.removeChild(ta);
          }
          const t = getScenarioUiText();
          alert(ok ? (t.scenario_copy_success || '시나리오를 복사했습니다.') : (t.scenario_copy_fail || '복사에 실패했습니다.'));
        } catch (err) {
          const t = getScenarioUiText();
          alert((t.scenario_copy_error_prefix || '복사 실패: ') + (err?.message || err));
        }
      }
    });
  };
})();
