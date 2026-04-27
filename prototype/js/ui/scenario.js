; (function () {
  const NK = window.NK || (window.NK = {});
  const ui = NK.ui || (NK.ui = {});
  const scenario = ui.scenario || (ui.scenario = {});
  let currentPayload = {};
  const collapsedSceneIds = new Set();
  let sceneFoldMode = 'focus'; // 'expand' | 'collapse' | 'focus'
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
      saveConfirmProductionReset: '시나리오가 변경되었습니다.\n기존 프로덕션에서 생성한 이미지·영상이 초기화됩니다.\n저장하시겠습니까?',
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
      saveConfirmProductionReset: 'The scenario has been modified.\nExisting images and videos from Production will be reset.\nDo you want to save?',
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
        topic: rawTopic,
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
    const voiceMode = (document.getElementById('voice-mode-select') || {}).value || 'none';
    payload.narrationEnabled = voiceMode === 'narration';
    payload.dubbingEnabled = voiceMode === 'dubbing';
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
        // 새 평탄화 모델 — 각 씬은 단일 카메라 셋업
        shotType: String(s.shotType || 'MS'),
        cameraMove: String(s.cameraMove || 'static'),
        composition: String(s.composition || '').trim(),
        action: String(s.action || '').trim(),
        // legacy 호환: shots[] 가 들어오면 보존 (마이그레이션 대상)
        shots: Array.isArray(s.shots) ? s.shots.map((sh, j) => ({
          id: String(sh?.id || `${s.id != null ? s.id : (i + 1)}.${j + 1}`),
          duration: Number(sh?.duration) || 0,
          shotType: String(sh?.shotType || 'MS'),
          cameraMove: String(sh?.cameraMove || 'static'),
          composition: String(sh?.composition || '').trim(),
          action: String(sh?.action || '').trim()
        })) : [],
        estSec: est,
        narrationEnabled: boolVal(s?.narrationEnabled, boolVal(currentPayload?.narrationEnabled, false)),
        dubbingEnabled: boolVal(s?.dubbingEnabled, boolVal(currentPayload?.dubbingEnabled, false))
      };
    });
  };

  const formatCommonInfo = () => '';

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

  const getCommonBackgroundStyleFromCard = () => {
    const node = document.querySelector('.scenario-card-common .view-common-style-lines');
    return String(node?.textContent || '').trim();
  };

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
      // 장소: 새 layout(.location-input) 우선, legacy(.view-location-lines) 폴백
      const locationRawInput = (card.querySelector('.location-input')?.value
        || card.querySelector('.view-location-lines')?.textContent
        || '').trim();
      // 공통 prefix 가 strip 되어 표시 중이면 다시 붙여 원본 형태로 저장
      const locationText = (__currentLocationPrefix && locationRawInput)
        ? (locationRawInput.indexOf(__currentLocationPrefix) === 0
            ? locationRawInput
            : (__currentLocationPrefix + ' — ' + locationRawInput))
        : locationRawInput;
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
    const sel = document.getElementById('voice-mode-select');
    if (sel) {
      if (normalized.narrationEnabled) sel.value = 'narration';
      else if (normalized.dubbingEnabled) sel.value = 'dubbing';
      else sel.value = 'none';
    }
  };

  // ---------- render scenes ----------
  // 모든 씬의 sceneLocation 에서 공통으로 시작하는 prefix 를 찾는다.
  // 예: ["중세 판타지 전장 — 광활한 평원", "중세 판타지 전장 — 황량한 능선"] → "중세 판타지 전장"
  // 끝에 붙은 구분자(— - : · / ( 등)와 공백은 제거 (orphan 괄호 방지).
  function findCommonLocationPrefix(scenes) {
    const locs = (Array.isArray(scenes) ? scenes : [])
      .map((s) => String((s && s.sceneLocation) || '').trim())
      .filter(Boolean);
    if (locs.length < 2) return '';
    let common = locs[0];
    for (const l of locs) {
      while (l.indexOf(common) !== 0) {
        common = common.slice(0, -1);
        if (!common) return '';
      }
    }
    // 의미 있는 길이 (2 자 이상) 만 인정. 끝에 붙은 구분자/괄호 trim.
    const trimmed = common.replace(/[\s—\-:·、,/(]+$/u, '').trim();
    if (trimmed.length < 2) return '';
    return trimmed;
  }

  // 주어진 location 텍스트에서 commonPrefix 를 떼어낸 unique 부분 반환.
  // 양 끝의 orphan 구분자/괄호도 함께 정리.
  function stripLocationPrefix(loc, prefix) {
    const s = String(loc || '');
    if (!prefix || s.indexOf(prefix) !== 0) return s;
    let result = s.slice(prefix.length);
    // 선두 구분자 + 여는 괄호 trim
    result = result.replace(/^[\s—\-:·、,/(]+/u, '');
    // 말미 구분자 + 닫는 괄호 trim
    result = result.replace(/[\s—\-:·、,/)]+$/u, '');
    return result.trim();
  }

  // 현재 렌더 사이클에 적용된 공통 location prefix (collectScenesFromCards 에서 다시 prepend 하기 위해 보관)
  let __currentLocationPrefix = '';

  // legacy 평탄화: scene.shots 가 길이 ≥ 2 면 각 shot 을 새 scene 으로 펼침
  function flattenLegacyShots(rawScenes) {
    if (!Array.isArray(rawScenes)) return [];
    const out = [];
    let mutated = false;
    let nextId = 1;
    rawScenes.forEach((parent) => {
      if (!parent || typeof parent !== 'object') return;
      const shots = Array.isArray(parent.shots) ? parent.shots : [];
      if (shots.length < 2) {
        out.push(parent);
        return;
      }
      mutated = true;
      shots.forEach((sh, j) => {
        if (!sh || typeof sh !== 'object') return;
        const isFirst = j === 0;
        const composition = String(sh.composition || '').trim();
        const action = String(sh.action || '').trim();
        const visualParts = [];
        if (composition) visualParts.push(composition);
        if (action) visualParts.push(action);
        const visual = visualParts.join(' / ').trim() || (parent.visual || parent.shot || '');
        out.push({
          id: nextId++,
          title: parent.title || '',
          sceneLocation: parent.sceneLocation || parent.location || '',
          backgroundStyle: parent.backgroundStyle || '',
          narration: isFirst ? (parent.narration || '') : '',
          dialogue: isFirst ? (parent.dialogue || parent.dialogues || []) : [],
          lines: isFirst ? (parent.lines || '') : '',
          subtitleText: isFirst ? (parent.subtitleText || '') : '',
          videoSpeechPrompt: isFirst ? (parent.videoSpeechPrompt || '') : '',
          script: isFirst ? (parent.script || '') : '',
          visual,
          shot: visual,
          composition,
          action,
          shotType: String(sh.shotType || 'MS'),
          cameraMove: String(sh.cameraMove || 'static'),
          estSec: Math.max(1, Math.round(Number(sh.duration) || 0)),
          parentSceneId: parent.id != null ? parent.id : null,
          shotIndexInParent: j
        });
      });
    });
    if (mutated) {
      // id 1..N 으로 재할당
      return out.map((s, i) => Object.assign({}, s, { id: i + 1 }));
    }
    return out;
  }

  scenario.renderScenes = function (scenes = []) {
    // 진입 직전 legacy shots[] 가 있으면 평탄화
    scenes = flattenLegacyShots(scenes);
    const container = document.getElementById('scenario-cards');
    if (!container) return;
    const sceneList = normalizeScenes(scenes);
    const labels = getSceneFieldLabels();
    // 음성 모드: 없음/나레이션/더빙 → 나레이션/대사 row 표시 여부 결정
    const __voiceFlags = getScenarioFlags(currentPayload || {});
    const __showNarration = !!__voiceFlags.narrationEnabled;
    const __showDialogue = !!__voiceFlags.dubbingEnabled;
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
    // 공통 location prefix 자동 감지 (모든 씬 sceneLocation 의 가장 긴 공통 시작 부분).
    // 발견되면 헤더 입력엔 unique 부분만 표시, 저장 시 다시 prepend → 데이터 손실 없음.
    __currentLocationPrefix = findCommonLocationPrefix(sceneList);
    // 그룹 라벨 메타: sceneLocation 기준. Pass 1 새 프롬프트가 한 비트 안의 sub-location 변화는
    // broad sceneLocation 으로 통일하므로 location 만으로 충분. parentSceneId 는 legacy 데이터에서
    // 제각각이라 그룹화 신호로 부적합. location 비어있으면 매번 새 그룹.
    // 첫 컷은 "Scene N cut1", 이후 컷은 보이지 않는 "Scene N " spacer + "cutM" 로 정렬.
    // 단일 컷은 그냥 "Scene N".
    const labelByIdx = (function () {
      let lastLoc = null;
      let parentNo = 0;
      let cutNo = 0;
      const seq = [];
      const totalByParent = {};
      sceneList.forEach((sc) => {
        const loc = String((sc && sc.sceneLocation) || '').trim();
        if (!loc || loc !== lastLoc) {
          parentNo += 1;
          cutNo = 1;
          lastLoc = loc;
        } else {
          cutNo += 1;
        }
        seq.push({ parentNo, cutNo });
        totalByParent[parentNo] = cutNo;
      });
      return seq.map((g) => {
        const total = totalByParent[g.parentNo] || 1;
        if (total <= 1) {
          // 단일 컷: 평범하게 "Scene N"
          return { html: 'Scene ' + g.parentNo, plain: 'Scene ' + g.parentNo };
        }
        // 복수 컷: prefix "Scene N " + "cutM". cutNo>=2 면 prefix 를 보이지 않게 (visibility:hidden) 하여 정렬 유지.
        const prefixCls = g.cutNo === 1 ? 'label-scene' : 'label-scene label-scene-spacer';
        const html = '<span class="' + prefixCls + '">Scene ' + g.parentNo + ' </span><span class="label-cut">cut' + g.cutNo + '</span>';
        return { html: html, plain: 'Scene ' + g.parentNo + ' cut' + g.cutNo };
      });
    })();

    // 공통 prefix 가 있으면 카드들 위에 작은 배지 한 줄 추가 (참고용 — 사용자가 어떤 prefix 가 strip 됐는지 알 수 있게)
    const commonPrefixBadge = __currentLocationPrefix
      ? `<div class="scenario-common-prefix-badge" title="모든 씬에 공통으로 적용된 배경. 이미지 생성에는 Common 영역을 통해 이미 반영됩니다."><span class="badge-label muted small">공통 배경</span><span class="badge-value">${escapeHtml(__currentLocationPrefix)}</span></div>`
      : '';
    container.innerHTML = commonPrefixBadge + sceneList.map((s, i) => {
      const labelMeta = labelByIdx[i] || { html: 'Scene ' + (i + 1), plain: 'Scene ' + (i + 1) };
      const hasComposition = !!String(s.composition || '').trim();
      const hasAction = !!String(s.action || '').trim();
      const hasStructured = hasComposition || hasAction;
      return `
      <div class="scenario-card${collapsedSceneIds.has(String(s.id)) ? ' is-collapsed' : ''}" data-scene-id="${s.id}">
        <div class="card-top">
          <div class="card-title-row">
            <h5 title="${escapeHtml(labelMeta.plain)}">${labelMeta.html}</h5>
            <input class="chip-input est-input" data-id="${s.id}" value="${fmtEst(s.estSec)}" />
            <input class="chip-input location-input" data-id="${s.id}" value="${escapeHtml(stripLocationPrefix(s.sceneLocation || '', __currentLocationPrefix))}" placeholder="${escapeHtml(labels.location || '장소')}" title="${escapeHtml(s.sceneLocation || labels.location || '장소')}" />
            ${s.shotType ? `<span class="card-camera-chip" title="shot type">${escapeHtml(s.shotType)}</span>` : ''}
            ${s.cameraMove ? `<span class="card-camera-chip" title="camera move">${escapeHtml(s.cameraMove)}</span>` : ''}
          </div>
          <button type="button" class="scenario-circle-toggle scenario-card-toggle" aria-expanded="${collapsedSceneIds.has(String(s.id)) ? 'false' : 'true'}" aria-label="${escapeHtml(collapsedSceneIds.has(String(s.id)) ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse)}" title="${escapeHtml(collapsedSceneIds.has(String(s.id)) ? getScenarioUiText().sceneExpand : getScenarioUiText().sceneCollapse)}">${collapsedSceneIds.has(String(s.id)) ? '+' : '-'}</button>
        </div>
        <div class="scene-visual-grid">
          ${hasStructured ? `
          <div class="field-block">
            <p class="field-label muted small">화면</p>
            <p class="view-lines view-composition-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.composition || '')}</p>
          </div>
          <div class="field-block">
            <p class="field-label muted small">행동</p>
            <p class="view-lines view-action-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.action || '')}</p>
          </div>` : `
          <div class="field-block">
            <p class="field-label muted small">${labels.visual}</p>
            <p class="view-shot view-shot-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.shot || '')}</p>
          </div>`}
          ${__showNarration ? `
          <div class="field-block">
            <p class="field-label muted small">${labels.narration}</p>
            <p class="view-lines view-narration-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(s.narrationText || '')}</p>
          </div>` : ''}
          ${__showDialogue ? `
          <div class="field-block">
            <p class="field-label muted small">${labels.dialogue}</p>
            <p class="view-lines view-dialogue-lines" data-id="${s.id}" contenteditable="true">${escapeHtml(String(s.dialogueText || dialogueToText(s.dialogue || []))
              .replace(/\r?\n+/g, ' · '))}</p>
          </div>` : ''}
        </div>
      </div>
    `;
    }).join('');
    container.querySelectorAll('.scenario-card.is-collapsed').forEach((card) => setScenarioCardCollapsed(card, true, false));
    const firstCard = container.querySelector('.scenario-card:not(.scenario-card-common)');
    if (firstCard) firstCard.classList.add('active-card');
    // focus 모드: 첫 번째만 펼치고 나머지 접기
    if (sceneFoldMode === 'focus') {
      container.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((card, idx) => {
        if (idx > 0 && !card.classList.contains('is-collapsed')) setScenarioCardCollapsed(card, true, false);
      });
    } else if (sceneFoldMode === 'collapse') {
      container.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((card) => {
        if (!card.classList.contains('is-collapsed')) setScenarioCardCollapsed(card, true, false);
      });
    }
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
    if (form.topic) form.topic.value = overviewFields.topic || '';
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
    const _scenarioLoadAt = Date.now();
    if (NK.core && NK.core.setLoading) NK.core.setLoading(true);
    if (pageLoading) pageLoading.classList.remove('hidden');
    const finishLoading = () => {
      try {
        if (pageLoading) pageLoading.classList.add('hidden');
        if (main) main.classList.remove('loading-blur');
        if (NK.core && NK.core.setLoading) NK.core.setLoading(false);
      } catch (_) { }
    };
    const finishLoadingWithMinDelay = () => {
      const _delay = Math.max(0, 300 - (Date.now() - _scenarioLoadAt));
      if (_delay > 0) setTimeout(finishLoading, _delay); else finishLoading();
    };
    if (main) main.classList.add('loading-blur');

    // 로컬 캐시를 먼저 확보
    let draft = null;
    if (NK.service?.project?.resolveCurrent) {
      draft = NK.service.project.resolveCurrent({ search: location.search }) || null;
    }
    if (!draft) {
      try {
        const saved = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
        if (saved) draft = JSON.parse(saved);
      } catch (_) {}
    }
    const pid = draft?.id || new URLSearchParams(location.search).get('projectId');

    // draft가 없을 때만 기본값으로 초기화 (loadDraft 내부에서도 호출되므로 중복 방지)
    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    if (!draft) {
      renderOverviewSelects({
        purposeCategory: categories[0] || '',
        target: TARGET_OPTIONS[0]?.value || '',
        durationPreset: NK.config.DEFAULTS?.DURATION || '15'
      });
    }

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

    // 로컬 캐시로 즉시 렌더 (서버 대기 없이)
    loadDraft(draft);
    if (!draft) {
      currentCharacters = [];
      currentPayload = Object.assign({}, currentPayload || {}, DEFAULT_SCENARIO_FLAGS, { characters: [], charactersEnabled: false });
      setScenarioToggleButtons(DEFAULT_SCENARIO_FLAGS);
      renderCharacterChips();
      syncCharacterUi();
      renderKnowledgeHint(currentPayload);
    }

    // 서버 최신 데이터를 백그라운드에서 갱신 (사용자가 편집 시작 전에 도착하면 재렌더)
    let formDirty = false;
    if (pid && NK.api?.projectGet) {
      NK.api.projectGet(pid).then(srv => {
        if (!srv?.data || formDirty) {
          // 서버 데이터 불필요 or 편집중 → 캐시 없는 경우 스피너 해제
          if (!draft) finishLoadingWithMinDelay();
          return;
        }
        const serverDraft = {
          id: pid,
          title: srv.data.title || draft?.title || '프로젝트',
          payload: srv.data.payload || draft?.payload || {},
          scenes: srv.data.scenes || draft?.scenes || [],
          header: srv.data.header || draft?.header || ''
        };
        if (NK.service?.project?.upsertLocalDraft) {
          draft = NK.service.project.upsertLocalDraft(serverDraft, { setCurrent: true }) || serverDraft;
        } else if (NK.service?.project?.setCurrent) {
          NK.service.project.setCurrent(serverDraft);
          draft = serverDraft;
        } else {
          draft = serverDraft;
        }
        loadDraft(draft);
        // 캐시 없는 경우: 서버 렌더 완료 후 스피너 해제
        if (!draft) finishLoadingWithMinDelay();
      }).catch(() => {
        // 서버 요청 실패 시에도 스피너 해제
        if (!draft) finishLoadingWithMinDelay();
      });
    }

    const syncOverviewPayload = () => {
      currentPayload = Object.assign({}, currentPayload || {}, collectPayload());
      renderKnowledgeHint(currentPayload);
    };

    const applyOverviewSuggestions = (suggestions) => {
      // Phase 0 Step 10 — 이미 채워진 필드는 절대 덮어쓰지 않는다 (사용자 의도 보존)
      if (!suggestions || typeof suggestions !== 'object') return [];
      const current = getOverviewSelections();
      const applied = [];

      const pickText = (v) => String(v == null ? '' : v).trim();
      const pickFirstArr = (v) => {
        if (Array.isArray(v)) return pickText(v[0]);
        return pickText(v);
      };

      // 이미 값이 있으면 스킵하는 헬퍼
      const maybeApply = (currentVal, suggestedVal, label) => {
        const cur = pickText(currentVal);
        const sug = pickText(suggestedVal);
        if (cur || !sug) return null;
        applied.push(label);
        return sug;
      };

      const nextState = {
        purposeCategory: maybeApply(current.purposeCategory, suggestions.purposeCategory, '장르') ?? current.purposeCategory,
        purposeTag:      maybeApply(current.purposeTag,      pickFirstArr(suggestions.purposeTags), '세부 장르') ?? current.purposeTag,
        target:          maybeApply(current.target,          suggestions.target, '시청 타겟') ?? current.target,
        need:            maybeApply(current.need,            suggestions.need, '시청 목적') ?? current.need,
        tone:            maybeApply(current.tone,            pickFirstArr(suggestions.tones), '톤') ?? current.tone,
        style:           maybeApply(current.style,           pickFirstArr(suggestions.styles), '스타일') ?? current.style,
        durationPreset:  current.durationPreset,
      };

      // duration 처리: custom 값이 있으면 보존. preset 도 값이 있으면 보존.
      const customDur = String(current.durationCustom || '').trim();
      const hasCustom = /^\d+$/.test(customDur) && Number(customDur) > 0;
      if (!current.durationPreset && !hasCustom && suggestions.duration) {
        nextState.durationPreset = pickText(suggestions.duration);
        applied.push('영상 길이');
      }

      renderOverviewSelects(nextState);
      // renderOverviewSelects 는 subgenre 를 categories[purposeCategory] 로 다시 그린다.
      // purposeTag 을 보존해 재설정.
      const tagSelect = document.getElementById('purpose-tag-select');
      if (tagSelect && nextState.purposeTag) tagSelect.value = nextState.purposeTag;

      return applied;
    };

    const showOverviewSuggestedToast = (appliedFields) => {
      if (!appliedFields || !appliedFields.length) return;
      const msg = appliedFields.length === 1
        ? `${appliedFields[0]} 항목을 자동 제안했습니다.`
        : `${appliedFields.join(', ')} 항목을 자동 제안했습니다.`;
      // 기존 알림 시스템 재활용 (없으면 console 로그만)
      if (NK.ui?.toast?.show) {
        NK.ui.toast.show(msg, { type: 'info', duration: 3800 });
      } else if (NK.utils?.toast) {
        NK.utils.toast(msg);
      } else {
        try { console.info('[overview-suggest]', msg); } catch (_) {}
      }
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
        // 1) 이야기 정리 + 개요 자동 제안을 병렬 실행 (Phase 0 Step 10)
        const language = getRuntimeLang();
        const currentSel = getOverviewSelections();
        const filled = {
          purposeCategory: currentSel.purposeCategory,
          purposeTags: currentSel.purposeTag ? [currentSel.purposeTag] : [],
          target: currentSel.target,
          need: currentSel.need,
          duration: currentSel.durationPreset || String(currentSel.durationCustom || '').trim(),
          tones: currentSel.tone ? [currentSel.tone] : [],
          styles: currentSel.style ? [currentSel.style] : [],
        };

        const storyReq = NK.api.storyStructure(Object.assign({}, payload, { language }));
        const suggestReq = (NK.api.overviewSuggest
          ? NK.api.overviewSuggest({ topic: payload.topic, story: rawStory, language, filled })
          : Promise.resolve(null)
        ).catch(() => null); // 제안 실패는 조용히 무시 (핵심 흐름은 이야기 정리)

        const [storyResult, suggestResult] = await Promise.all([storyReq, suggestReq]);

        // 2) 이야기 정리 결과 반영
        const nextStory = sanitizeText(storyResult?.story || rawStory);
        if (nextStory) {
          storyField.dataset.userStory = rawStory;
          storyField.dataset.aiStory = nextStory;
          storyField.dataset.view = 'ai';
          storyField.value = nextStory;
          cacheStorySelection(storyField);
          updateStoryToggleButtonUi('ai');
        }

        // 3) 개요 자동 제안 반영 (이미 채워진 필드는 덮어쓰지 않음)
        let appliedFields = [];
        if (suggestResult && suggestResult.suggestions) {
          appliedFields = applyOverviewSuggestions(suggestResult.suggestions);
        }

        syncOverviewPayload();

        // 4) 사용자 피드백 토스트
        if (appliedFields.length) showOverviewSuggestedToast(appliedFields);
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
      const btn = e.target.closest('.ratio-btn');
      if (!btn) return;
      setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      syncOverviewPayload();
    });

    form.addEventListener('change', (e) => {
      formDirty = true;
      const target = e.target;
      if (!target) return;
      if (target.id === 'voice-mode-select') {
        const vm = target.value || 'none';
        currentPayload = Object.assign({}, currentPayload || {}, {
          narrationEnabled: vm === 'narration',
          dubbingEnabled: vm === 'dubbing'
        });
      }
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
      formDirty = true;
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
        const inCardTop = e.target && e.target.closest ? e.target.closest('.card-top') : null;
        // card-top 에 있는 편집 가능 요소(est-input 등) 클릭은 토글에서 제외
        const inEditable = e.target && e.target.closest ? e.target.closest('input, textarea, select, [contenteditable="true"]') : null;
        // 토글 버튼 클릭 OR 상단 바(편집 요소 제외) 어디든 클릭 → 접기/펼치기 양방향 토글
        if (toggleBtn || (inCardTop && !inEditable)) {
          e.preventDefault();
          e.stopPropagation();
          if (sceneFoldMode === 'focus') {
            const willExpand = card.classList.contains('is-collapsed');
            if (willExpand) {
              cardsContainer.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((c) => {
                if (c !== card && !c.classList.contains('is-collapsed')) setScenarioCardCollapsed(c, true);
              });
            }
          }
          setActiveScenarioCard(card);
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
      // Phase 0 Step 9 — 장르/세부장르에 따라 로딩 라벨을 동적으로 전환.
      // 긴 입력은 청크 안내가 우선이므로 기존 문구 유지.
      const uiLangNow = getUiLang();
      let progressTimer = null;
      if (isLongInput) {
        setScenarioLoading(true, uiLangNow === 'en' ? 'Analyzing the long input by parts…' : '긴 입력을 파트별로 분석하는 중...');
      } else if (NK.scenarioProgress && NK.scenarioProgress.buildSequence) {
        const seq = NK.scenarioProgress.buildSequence({
          lang: uiLangNow,
          purposeCategory: payload?.purposeCategory || '',
          purposeTag: (Array.isArray(payload?.purposeTags) ? payload.purposeTags[0] : payload?.purposeTags) || '',
          target: payload?.target || ''
        });
        let seqIdx = 0;
        setScenarioLoading(true, seq[0]);
        progressTimer = setInterval(() => {
          seqIdx = (seqIdx + 1) % seq.length;
          setScenarioLoading(true, seq[seqIdx]);
        }, 2400);
      } else {
        setScenarioLoading(true, uiLangNow === 'en' ? 'Generating scenario…' : '시나리오 생성 중...');
      }
      try {
        const res = await NK.api.scenario(payload);
        const headerText = (NK.service?.project?.buildVisualHeader)
          ? NK.service.project.buildVisualHeader(payload)
          : '';
        if (res?.scenes) {
          // Pass 2: scene 을 콘티 단위 shot 으로 분해. 실패해도 시나리오는 살림.
          // Pass 2: 씬 세분화 (서버에서 평탄화된 scene 배열 반환)
          let flatScenes = res.scenes;
          try {
            if (NK.api?.scenarioShots) {
              const shotsRes = await NK.api.scenarioShots({
                scenes: res.scenes,
                language: payload?.language === 'en' ? 'en' : 'ko'
              });
              // v2.702 부터 서버가 flat scenes 반환 (각 shot → top-level scene).
              // meta.flattened 가 true 인 경우만 채택. 안전.
              if (shotsRes && Array.isArray(shotsRes.scenes) && shotsRes.meta?.flattened) {
                flatScenes = shotsRes.scenes;
              }
            }
          } catch (shotsErr) {
            console.warn('[scenario] scene 세분화 실패; Pass 1 결과 유지', shotsErr);
          }
          const normalized = normalizeScenes(flatScenes);
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
        if (progressTimer) { try { clearInterval(progressTimer); } catch (_) { } progressTimer = null; }
        setScenarioLoading(false);
        NK.core.setLoading(false);
      }
    };

    // 저장 버튼
    const saveBtn = document.getElementById('save-draft');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        // 기존 프로덕션 미디어가 있으면 초기화 경고
        const existingScenes = draft?.scenes || [];
        const hasProductionMedia = existingScenes.some((s) =>
          s.imageDataUrl || s.imagePath || s.generatedImageUrl || s.imageUrl ||
          s.videoUrl || s.videoPlaybackUrl || s.videoPath || s.generatedVideoUrl
        );
        if (hasProductionMedia) {
          const t = getScenarioUiText();
          if (!confirm(t.saveConfirmProductionReset)) return;
        }
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

    // 컷 분해 버튼 — 기존 씬을 유지한 채 Pass 2 만 다시 돌려서 shots 추가/갱신
    const decomposeBtn = document.getElementById('decompose-shots');
    if (decomposeBtn) {
      decomposeBtn.onclick = async () => {
        try {
          if (!NK.api?.scenarioShots) {
            alert('컷 분해 API 가 없습니다.');
            return;
          }
          // 화면의 최신 편집 내용을 먼저 머지
          const latest = collectScenesFromCards();
          const mergedBase = mergeSceneSnapshots(draft?.scenes || [], latest);
          if (!Array.isArray(mergedBase) || !mergedBase.length) {
            alert('분해할 씬이 없습니다. 먼저 시나리오를 생성하거나 불러와 주세요.');
            return;
          }
          const lang = (draft?.payload?.language === 'en') ? 'en' : 'ko';
          NK.core.setLoading(true, '씬을 컷 단위로 분해 중...');
          const shotsRes = await NK.api.scenarioShots({ scenes: mergedBase, language: lang });
          const decomposed = (shotsRes && Array.isArray(shotsRes.scenes)) ? shotsRes.scenes : null;
          if (!decomposed) {
            alert('컷 분해 응답이 비었습니다.');
            return;
          }
          // 기존 scene 의 shots 만 교체 (다른 필드는 그대로)
          const byId = new Map(decomposed.map(s => [String(s?.id), s]));
          const updated = mergedBase.map((s, i) => {
            const fresh = byId.get(String(s?.id)) || decomposed[i];
            const newShots = (fresh && Array.isArray(fresh.shots)) ? fresh.shots : (Array.isArray(s.shots) ? s.shots : []);
            return Object.assign({}, s, { shots: newShots });
          });
          draft = draft || { id: Date.now(), title: '새 프로젝트' };
          draft.scenes = normalizeScenes(updated);
          if (NK.service?.project?.upsertLocalDraft) {
            draft = NK.service.project.upsertLocalDraft(draft, { setCurrent: true }) || draft;
          } else {
            if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
            NK.store.saveDrafts([draft]);
          }
          // 서버에도 즉시 반영 (가능하면)
          if (NK.api?.projectSave) {
            try {
              await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header || '', aspectRatio: draft.payload?.aspectRatio, title: draft.title });
            } catch (saveErr) {
              console.warn('[scenario] decompose-shots: 서버 저장 실패 (로컬은 유지):', saveErr);
            }
          }
          // UI 다시 그림
          scenario.renderScenes(draft.scenes || []);
          const total = decomposed.reduce((acc, s) => acc + (Array.isArray(s.shots) ? s.shots.length : 0), 0);
          const meta = shotsRes.meta || {};
          alert(`컷 분해 완료: ${total} 컷 (성공 ${meta.ok || 0} / 실패 ${meta.failed || 0} / fallback ${meta.fallback || 0}). 저장됨.`);
        } catch (err) {
          alert('컷 분해 실패: ' + (err?.message || err));
        } finally {
          NK.core.setLoading(false);
        }
      };
    }
    // 캐시 있음: 동기 렌더 완료 후 최소 300ms 뒤 해제
    // 캐시 없음: 서버 응답 .then()에서 해제 (안전 fallback 5s)
    if (draft) {
      finishLoadingWithMinDelay();
    } else {
      setTimeout(finishLoading, 5000); // fallback: API 응답 없을 때 stuck 방지
    }
    window.addEventListener('load', finishLoading);

    // 카메라 용어 안내 버튼
    const cameraVocabBtn = document.getElementById('camera-vocab-btn');
    if (cameraVocabBtn) {
      cameraVocabBtn.addEventListener('click', () => {
        const modal = document.getElementById('camera-vocab-modal');
        const body = document.getElementById('camera-vocab-modal-body');
        if (!modal || !body) return;
        const vocab = (window.NK && NK.service && NK.service.shotVocab) || null;
        const lang = getUiLang();
        const titleText = lang === 'en' ? 'Camera Terms' : '카메라 용어 안내';
        if (!vocab) {
          body.innerHTML = (
            '<div class="vocab-modal-titlebar">' +
            '<h2 class="vocab-modal-title">' + escapeHtml(titleText) + '</h2>' +
            '<button class="close-modal vocab-modal-close" data-close="camera-vocab-modal" aria-label="닫기">✕</button>' +
            '</div>' +
            '<p class="muted">' + (lang === 'en' ? 'Failed to load camera vocabulary.' : '카메라 용어 데이터를 불러오지 못했습니다.') + '</p>'
          );
          modal.classList.remove('hidden');
          return;
        }
        const buildSection = (title, dict, keys) => {
          const items = keys.map((k) => {
            const v = dict[k] || {};
            // 영어 모드: 한글(ko) 라벨 + hint 한글 모두 제거. en + enHint 만.
            // 한글 모드: ko 메인, en 보조, hint 한글.
            const headParts = ['<span class="vocab-code">' + escapeHtml(k) + '</span>'];
            if (lang === 'en') {
              headParts.push('<span class="vocab-en">' + escapeHtml(v.en || '') + '</span>');
            } else {
              headParts.push('<span class="vocab-ko">' + escapeHtml(v.ko || '') + '</span>');
              headParts.push('<span class="vocab-en muted small">' + escapeHtml(v.en || '') + '</span>');
            }
            const hint = lang === 'en' ? (v.enHint || '') : (v.hint || '');
            return (
              '<div class="vocab-item">' +
              '<div class="vocab-item-head">' + headParts.join('') + '</div>' +
              '<p class="vocab-hint">' + escapeHtml(hint) + '</p>' +
              '</div>'
            );
          }).join('');
          return (
            '<section class="vocab-section">' +
            '<h3 class="vocab-section-title">' + escapeHtml(title) + '</h3>' +
            '<div class="vocab-grid">' + items + '</div>' +
            '</section>'
          );
        };
        const shotSectionTitle = lang === 'en'
          ? 'Shot Type (' + vocab.SHOT_TYPE_KEYS.length + ')'
          : 'Shot Type (' + vocab.SHOT_TYPE_KEYS.length + '종)';
        const moveSectionTitle = lang === 'en'
          ? 'Camera Move (' + vocab.CAMERA_MOVE_KEYS.length + ')'
          : 'Camera Move (' + vocab.CAMERA_MOVE_KEYS.length + '종)';
        body.innerHTML = (
          '<div class="vocab-modal-titlebar">' +
          '<h2 class="vocab-modal-title">' + escapeHtml(titleText) + '</h2>' +
          '<button class="close-modal vocab-modal-close" data-close="camera-vocab-modal" aria-label="닫기">✕</button>' +
          '</div>' +
          buildSection(shotSectionTitle, vocab.SHOT_TYPES, vocab.SHOT_TYPE_KEYS) +
          buildSection(moveSectionTitle, vocab.CAMERA_MOVES, vocab.CAMERA_MOVE_KEYS)
        );
        modal.classList.remove('hidden');
      });
    }
    // 모달 닫기 (data-close 패턴 공용)
    document.addEventListener('click', (e) => {
      const closeBtn = e.target && e.target.closest ? e.target.closest('[data-close]') : null;
      if (closeBtn) {
        const id = closeBtn.getAttribute('data-close');
        const m = id ? document.getElementById(id) : null;
        if (m) m.classList.add('hidden');
        return;
      }
      // 배경 클릭 시 닫기 (camera-vocab-modal 만)
      const camModal = document.getElementById('camera-vocab-modal');
      if (camModal && !camModal.classList.contains('hidden') && e.target === camModal) {
        camModal.classList.add('hidden');
      }
    });

    // 시나리오 복사 버튼
    const scenarioCopyBtn = document.getElementById('scenario-copy-btn');
    if (scenarioCopyBtn) {
      scenarioCopyBtn.addEventListener('click', async () => {
        try {
          const latest = collectScenesFromCards();
          const mergedScenes = mergeSceneSnapshots(draft?.scenes || [], latest);
          const scenes = mergedScenes.length ? mergedScenes : (draft?.scenes || []);
          if (!scenes.length) { alert('복사할 시나리오가 없습니다.'); return; }
          const makeBlock = (s) => {
            const lines = [];
            lines.push(`Scene ${s.id} · ${fmtEst(s.estSec)}`);
            if (s.sceneLocation || s.location) lines.push(`장소: ${s.sceneLocation || s.location}`);
            if (s.shot || s.visual) lines.push(`시각화: ${s.shot || s.visual}`);
            if (s.narrationText || s.narration) lines.push(`나레이션: ${s.narrationText || s.narration}`);
            const dlg = s.dialogueText || dialogueToText(s.dialogue || []);
            if (dlg) lines.push(`대사:\n${dlg}`);
            return lines.filter(Boolean).join('\n');
          };
          const text = scenes.map(makeBlock).join('\n\n');
          let ok = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text); ok = true;
          }
          if (!ok) {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;top:-1000px';
            document.body.appendChild(ta); ta.focus(); ta.select();
            try { document.execCommand('copy'); ok = true; } catch (_) {}
            document.body.removeChild(ta);
          }
          const t = getScenarioUiText();
          alert(ok ? (t.scenario_copy_success || '시나리오를 복사했습니다.') : (t.scenario_copy_fail || '복사에 실패했습니다.'));
        } catch (err) {
          alert('복사 실패: ' + (err?.message || err));
        }
      });
    }

    // 씬 카드 펼침/접기 모드 버튼
    const expandAllBtn = document.getElementById('scene-expand-all');
    const collapseAllBtn = document.getElementById('scene-collapse-all');
    const focusModeBtn = document.getElementById('scene-focus-mode');
    const foldModeButtons = [expandAllBtn, collapseAllBtn, focusModeBtn].filter(Boolean);
    const setFoldModeActive = (mode) => {
      sceneFoldMode = mode;
      foldModeButtons.forEach((b) => b.classList.remove('active'));
      if (mode === 'expand' && expandAllBtn) expandAllBtn.classList.add('active');
      if (mode === 'collapse' && collapseAllBtn) collapseAllBtn.classList.add('active');
      if (mode === 'focus' && focusModeBtn) focusModeBtn.classList.add('active');
    };
    if (expandAllBtn) {
      expandAllBtn.addEventListener('click', () => {
        setFoldModeActive('expand');
        const container = document.getElementById('scenario-cards');
        if (container) container.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((c) => setScenarioCardCollapsed(c, false));
      });
    }
    if (collapseAllBtn) {
      collapseAllBtn.addEventListener('click', () => {
        setFoldModeActive('collapse');
        const container = document.getElementById('scenario-cards');
        if (container) container.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((c) => setScenarioCardCollapsed(c, true));
      });
    }
    if (focusModeBtn) {
      focusModeBtn.addEventListener('click', () => {
        setFoldModeActive('focus');
        const container = document.getElementById('scenario-cards');
        if (!container) return;
        const activeCard = container.querySelector('.scenario-card.active-card:not(.scenario-card-common)');
        container.querySelectorAll('.scenario-card:not(.scenario-card-common)').forEach((c) => {
          setScenarioCardCollapsed(c, c !== activeCard);
        });
      });
    }

    // 모달 닫기 (레거시)
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
  };
})();
