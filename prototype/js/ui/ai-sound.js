;(function () {
  var NK = window.NK || (window.NK = {});
  var snd = NK.uiSound || (NK.uiSound = {});

  // ─── Constants ────────────────────────────────────────────
  var MODELS = [
    { id: 'eleven_v3',             ko: 'ElevenLabs v3 (표현력)',        en: 'ElevenLabs v3' },
    { id: 'eleven_multilingual_v2', ko: 'Multilingual v2 (음색 일관성)', en: 'Multilingual v2' },
    { id: 'gemini_tts',            ko: 'Gemini 3.1 TTS (감정 연출)',    en: 'Gemini 3.1 TTS (directed)' }
  ];

  // Gemini TTS 프리셋 보이스.
  // providerVoiceId = Gemini TTS 보이스 이름 (연출 프리셋의 추천 보이스를 모두 포함).
  var GEMINI_VOICES = [
    { n: 'Achird',       g: 'male',   d: '친근하고 편안한 톤' },
    { n: 'Algenib',      g: 'male',   d: '거칠고 묵직한 저음' },
    { n: 'Algieba',      g: 'male',   d: '부드럽고 매끄러운 음색' },
    { n: 'Alnilam',      g: 'male',   d: '단단하고 확고한 전달' },
    { n: 'Charon',       g: 'male',   d: '단단하고 절제된 지적 중음' },
    { n: 'Enceladus',    g: 'male',   d: '숨결이 섞인 나직한 음색' },
    { n: 'Fenrir',       g: 'male',   d: '묵직하고 깊은 중저음' },
    { n: 'Orus',         g: 'male',   d: '단호하고 또렷한 진행' },
    { n: 'Puck',         g: 'male',   d: '에너지 넘치는 명료한 청년음' },
    { n: 'Sadachbia',    g: 'male',   d: '생동감 있고 경쾌한 톤' },
    { n: 'Achernar',     g: 'female', d: '부드럽고 섬세한 음색' },
    { n: 'Aoede',        g: 'female', d: '가볍고 산뜻한 톤' },
    { n: 'Autonoe',      g: 'female', d: '밝고 또렷한 내레이션' },
    { n: 'Callirrhoe',   g: 'female', d: '여유롭고 차분한 톤' },
    { n: 'Gacrux',       g: 'female', d: '성숙하고 안정적인 음색' },
    { n: 'Kore',         g: 'female', d: '확신에 찬 명료한 전달' },
    { n: 'Pulcherrima',  g: 'female', d: '당당하고 세련된 직진형 음색' },
    { n: 'Sulafat',      g: 'female', d: '포근하고 자상한 온기' },
    { n: 'Vindemiatrix', g: 'female', d: '온화하고 다정한 톤' },
    { n: 'Zephyr',       g: 'female', d: '맑고 경쾌한 캐릭터 보이스' }
  ].map(function (v) {
    return {
      id: 'gemini-' + v.n, name: v.n, gender: v.g, language: 'ko', category: 'adult',
      description: v.d, styleTags: [], scope: 'global',
      provider: 'gemini', providerVoiceId: v.n, previewUrl: ''
    };
  });

  // 여아·남아·캐릭터 보이스 — Gemini TTS 에는 아이 보이스가 없어 '기본 보이스 + 고정 연기 지시문' 조합으로 만든다.
  // 연기 지시문은 서버(functions/api/sound/_character-voices.ts)에만 있다. 여기 id 는 그 목록과 같아야 한다.
  // providerVoiceId = 'char:<id>' — 서버가 기본 보이스와 지시문으로 풀어 합성한다.
  var CHARACTER_VOICES = [
    { id: 'girl-5',        c: 'girl',      g: 'female', ko: '아기 여아 (5세)',       en: 'Little girl (5)',        dk: '작고 달콤한 고음, 또박또박 말 배우는 아이',       de: 'Tiny, sweet high voice of a small child' },
    { id: 'girl-8',        c: 'girl',      g: 'female', ko: '명랑한 여아 (8세)',     en: 'Cheerful girl (8)',      dk: '밝고 맑은 초등학생, 통통 튀는 리듬',            de: 'Bright, bouncy elementary-school girl' },
    { id: 'girl-shy',      c: 'girl',      g: 'female', ko: '수줍은 여아 (7세)',     en: 'Shy girl (7)',           dk: '작고 조용한 목소리, 살짝 머뭇거림',             de: 'Soft, quiet and a little hesitant' },
    { id: 'girl-teen',     c: 'girl',      g: 'female', ko: '10대 소녀 (15세)',      en: 'Teen girl (15)',         dk: '발랄하고 가벼운 청소년 톤',                     de: 'Lively, light teenage tone' },
    { id: 'boy-5',         c: 'boy',       g: 'male',   ko: '아기 남아 (5세)',       en: 'Little boy (5)',         dk: '작고 살짝 허스키한 아이 목소리, 서툴고 순수함', de: 'Small, slightly husky, innocent child voice' },
    { id: 'boy-8',         c: 'boy',       g: 'male',   ko: '개구쟁이 남아 (8세)',   en: 'Mischievous boy (8)',    dk: '에너지 넘치고 장난스러운 초등학생',             de: 'Energetic, cheeky elementary-school boy' },
    { id: 'boy-smart',     c: 'boy',       g: 'male',   ko: '똑똑한 남아 (10세)',    en: 'Smart boy (10)',         dk: '또렷하고 차분한, 조금 진지한 아이',             de: 'Clear, calm and a little serious' },
    { id: 'boy-teen',      c: 'boy',       g: 'male',   ko: '10대 소년 (변성기)',    en: 'Teen boy (voice breaking)', dk: '가볍고 풋풋한 변성기 소년',                 de: 'Light, youthful voice just breaking' },
    { id: 'char-rabbit',   c: 'character', g: 'female', ko: '토끼 · 들뜬 잘난척쟁이', en: 'Rabbit · boastful',     dk: '높고 빠르게 통통 튀는 뽐내는 말투',             de: 'High, fast, springy and cocky' },
    { id: 'char-turtle',   c: 'character', g: 'male',   ko: '거북이 · 느긋한 현자',   en: 'Turtle · calm sage',     dk: '느리고 따뜻하게, 구절마다 여유',                de: 'Slow, warm, long easy pauses' },
    { id: 'char-mascot',   c: 'character', g: 'female', ko: '마스코트 요정',          en: 'Mascot fairy',           dk: '아주 높고 귀여운 재잘거림',                     de: 'Very high, cute and chattery' },
    { id: 'char-robot',    c: 'character', g: 'male',   ko: '친근한 로봇',            en: 'Friendly robot',         dk: '또박또박 끊기는 기계적 말투',                   de: 'Even, clipped, slightly mechanical' },
    { id: 'char-grandpa',  c: 'character', g: 'male',   ko: '할아버지 이야기꾼',      en: 'Grandpa storyteller',    dk: '나이 든 거친 저음, 느리고 다정하게',            de: 'Aged, raspy, slow and warm' },
    { id: 'char-grandma',  c: 'character', g: 'female', ko: '할머니 이야기꾼',        en: 'Grandma storyteller',    dk: '포근하고 떨리는 노년 목소리',                   de: 'Gentle, slightly shaky, soothing' },
    { id: 'char-princess', c: 'character', g: 'female', ko: '공주 · 우아한 히로인',   en: 'Princess heroine',       dk: '맑고 기품 있는 선율적인 목소리',                de: 'Clear, elegant and melodic' },
    { id: 'char-hero',     c: 'character', g: 'male',   ko: '열혈 주인공',            en: 'Hot-blooded hero',       dk: '밝고 힘찬 젊은 남성, 결연함',                   de: 'Bright, energetic, determined' },
    { id: 'char-witch',    c: 'character', g: 'female', ko: '마녀 · 음흉한 악당',     en: 'Wicked witch',           dk: '비꼬는 듯 음흉하게, 늘어지는 말끝',             de: 'Sly, mocking, playful menace' },
    { id: 'char-villain',  c: 'character', g: 'male',   ko: '마왕 · 보스 악당',       en: 'Demon lord villain',     dk: '깊고 음산한 위압감, 느린 말투',                 de: 'Deep, slow, sinister and heavy' }
  ].map(function (v) {
    return {
      id: 'gemini-char-' + v.id, name: v.ko, nameEn: v.en, gender: v.g, language: 'ko', category: v.c,
      description: v.dk, descriptionEn: v.de, styleTags: [], scope: 'global',
      provider: 'gemini', providerVoiceId: 'char:' + v.id, previewUrl: ''
    };
  });
  var VOICE_CATEGORIES = ['', 'adult', 'girl', 'boy', 'character'];

  var VOICE_SPEEDS = [0.5, 1, 1.2, 1.5];
  var FORMATS = [
    { id: 'mp3_44100_128', label: 'MP3 44.1kHz 128kbps' },
    { id: 'mp3_44100_192', label: 'MP3 44.1kHz 192kbps' },
    { id: 'mp3_22050_32',  label: 'MP3 22kHz 32kbps' }
  ];
  // Gemini TTS 는 모델 원본(24kHz 16bit PCM)을 재인코딩 없이 WAV 로 저장한다.
  var GEMINI_FORMATS = [{ id: 'wav_24000', label: 'WAV 24kHz 16bit' }];

  // 연출 지시문 프리셋 — Google AI Studio 'Emotional Voice Studio' 의 장르 프리셋 지시문 원문.
  // 지시문은 모델에 그대로 보내는 영문 디렉션이고, voice 는 추천 보이스(라벨에 표시만 한다).
  var DIRECTION_PRESETS = [
    { id: "cf-commercial-narrator-40s", genre: { ko: "광고 / CF", en: "Ad / CF" }, ko: "40대 진중한 공익·금융 광고", en: "Sincere public-service / finance ad (40s)", voice: "Fenrir",
      text: "Say this in a calm, serious, low and steady voice, like a seasoned Korean TV commercial narrator in his mid-forties speaking sincerely to one listener. Do not perform or dramatize: no theatrical emphasis, no rising intonation at sentence ends, no smiling tone. Keep an even, unhurried pace of about 4.5 to 5 Korean syllables per second, and end every sentence with a firm, settled downward close. Pause for about one second between lines. Keep the first four lines slightly graver; from the fifth line, let the voice ease very slightly warmer while staying restrained, and finish the last line with quiet, trustworthy warmth. Clean close-mic studio sound:" },
    { id: "cf-premium-tech", genre: { ko: "광고 / CF", en: "Ad / CF" }, ko: "미니멀 럭셔리 & 테크 브랜드", en: "Minimal luxury & tech brand", voice: "Charon",
      text: "Deliver this in an ultra-clean, minimalist, and intimate whisper-tone commercial style (like an iconic Apple or luxury Scandinavian design film). Speak close to the microphone with subtle breathiness, quiet confidence, and zero theatrical salesmanship. Every word is deliberate, modern, and effortless. Generous pauses between key statements. A calm, intelligent downward cadence:" },
    { id: "cf-food-sale", genre: { ko: "광고 / CF", en: "Ad / CF" }, ko: "침샘을 자극하는 F&B & 파격 세일", en: "Mouth-watering F&B & flash sale", voice: "Sadachbia",
      text: "Say this with mouth-watering excitement, snappy crisp consonants, and high-energy sales charm. Fast-paced, bright, and inviting, like an appetizing gourmet food commercial or a flash discount announcement. Punchy rhythm, cheerful rising inflections on highlights, and an irresistible, irresistible smile in the tone:" },
    { id: "cf-warm-family", genre: { ko: "광고 / CF", en: "Ad / CF" }, ko: "가슴 뭉클한 감성 가족·기업 PR", en: "Heartwarming family / corporate PR", voice: "Kore",
      text: "Speak in a deeply heartfelt, tender, and empathetic tone, like a loving family member speaking from the heart in a heartwarming documentary PR commercial. Soft vocal fry, gentle warm cadence, slight smile audible in the breath, compassionate and emotionally grounding:" },
    { id: "anime-shonen-hero", genre: { ko: "애니메이션", en: "Animation" }, ko: "열혈 소년만화 주인공의 결전", en: "Shonen hero's final battle", voice: "Puck",
      text: "Perform as a fierce, passionate shonen anime protagonist in the climax of a desperate battle! Speak with raw determination, gritted teeth, adrenaline, and explosive conviction. Fast tempo with rising emotional intensity, breathing heavily between passionate declarations:" },
    { id: "anime-cool-rival", genre: { ko: "애니메이션", en: "Animation" }, ko: "냉철한 천재 엘리트 라이벌", en: "Cold genius elite rival", voice: "Charon",
      text: "Voice an icy, razor-sharp anime rival genius. Deliver each line with cold intellectual arrogance, slight quiet mockery, and absolute calculated composure. No shouting; the power comes from deadpan precision, chilly pauses, and a subtle smirk in the tone:" },
    { id: "anime-magical-heroine", genre: { ko: "애니메이션", en: "Animation" }, ko: "발랄한 마법소녀 & 히로인", en: "Bubbly magical-girl heroine", voice: "Zephyr",
      text: "Voice a cheerful, sparkling anime magical girl full of courage, innocence, and radiant optimism! High, melodious pitch with bouncy rhythm, adorable gasps of joy, and a triumphant, lovely chant at the finale:" },
    { id: "anime-epic-villain", genre: { ko: "애니메이션", en: "Animation" }, ko: "어둠의 대마왕 / 심연의 빌런", en: "Dark lord / abyssal villain", voice: "Fenrir",
      text: "Perform as an ancient, omnipotent dark lord or supreme anime villain. Deep cavernous chest resonance, slow sinister cadence, arrogant chuckles, and chilling theatrical malice. Every syllable carries the weight of impending doom:" },
    { id: "anime-mascot-fairy", genre: { ko: "애니메이션", en: "Animation" }, ko: "깜찍한 마스코트 요정", en: "Cute mascot fairy", voice: "Zephyr",
      text: "Voice a cute, tiny magical pet mascot (like a talking fairy or fantasy creature). High squeaky pitch, lively chatter, cute exaggerated reactions, breathing enthusiastically with adorable gasps:" },
    { id: "cinema-blockbuster-trailer", genre: { ko: "영화 / 트레일러", en: "Film / Trailer" }, ko: "헐리우드 블록버스터 예고편", en: "Hollywood blockbuster trailer", voice: "Fenrir",
      text: "Epic cinematic movie trailer voiceover (classic 'In a world' trailer style). Sub-bass chest resonance, tremendous gravity, pregnant dramatic pauses of 1.5 seconds between epochal statements. Build tension toward an explosive climax:" },
    { id: "cinema-thriller-suspense", genre: { ko: "영화 / 트레일러", en: "Film / Trailer" }, ko: "심리 스릴러 & 미스터리 범죄", en: "Psychological thriller & crime mystery", voice: "Enceladus",
      text: "Chilling, psychological thriller film narration. Very close to mic, muted breathy undertones, eerie quiet calmness with unsettling subtle paranoia. Every pause builds goosebumps and suspense:" },
    { id: "cinema-indie-melodrama", genre: { ko: "영화 / 트레일러", en: "Film / Trailer" }, ko: "서정적인 독립영화 독백", en: "Lyrical indie-film monologue", voice: "Aoede",
      text: "Poetic, melancholic indie cinema voiceover monologue. Fragile, gentle pacing, thoughtful sighs, reflective and deeply honest as if reading from a handwritten personal diary late at night:" },
    { id: "drama-historical-king", genre: { ko: "드라마 / 오디오북", en: "Drama / Audiobook" }, ko: "정통 대하사극 왕의 어명", en: "Historical drama: the king's decree", voice: "Fenrir",
      text: "Deliver as an authoritative Korean historical Joseon king in a royal drama court scene. Resonant dignified voice, stern royal majesty, traditional cadence, commanding deep presence with firm unyielding stops:" },
    { id: "drama-romantic-confession", genre: { ko: "드라마 / 오디오북", en: "Drama / Audiobook" }, ko: "정통 멜로 드라마의 눈물 고백", en: "Melodrama tearful confession", voice: "Kore",
      text: "Perform an emotional, heartbreaking romantic melodrama confession scene. The voice quivers with suppressed tears, soft emotional cracks, tender desperation, speaking right into the listener's heart:" },
    { id: "drama-hardboiled-noir", genre: { ko: "드라마 / 오디오북", en: "Drama / Audiobook" }, ko: "하드보일드 느와르 형사의 독백", en: "Hard-boiled noir detective monologue", voice: "Charon",
      text: "Grit-soaked hardboiled noir detective monologue. Gravelly, weary, disillusioned tone, cigarette smoke rasp, speak with cynical honesty under neon rain:" },
    { id: "drama-midnight-radio", genre: { ko: "드라마 / 오디오북", en: "Drama / Audiobook" }, ko: "심야 라디오 DJ의 따뜻한 위로", en: "Late-night radio DJ comfort", voice: "Kore",
      text: "Late-night soothing radio host voice. Cozy, mellow, empathetic close-mic warmth. Speaking softly as if sitting across the table with a cup of hot tea for someone who had a hard day:" },
    { id: "shorts-hook-knowledge", genre: { ko: "숏츠 / 숏폼", en: "Shorts" }, ko: "3초 후킹 지식·정보 숏츠", en: "3-second hook knowledge Shorts", voice: "Puck",
      text: "Super high-retention viral YouTube Shorts narration style! Rapid-fire 6.5 to 7.0 syllables per second, crisp punchy consonants, zero hesitation, breathless momentum, sharp question hooks, ending with an energetic punch:" },
    { id: "shorts-viral-storytelling", genre: { ko: "숏츠 / 숏폼", en: "Shorts" }, ko: "몰입도 100% 썰 & 괴담 스토리텔러", en: "Immersive story & ghost-tale teller", voice: "Achird",
      text: "Dynamic, captivating conversational storyteller for viral story shorts. Expressive pitch swings, dramatic tension building, sudden gasps and hushed whispering followed by fast punchlines:" },
    { id: "shorts-comic-reaction", genre: { ko: "숏츠 / 숏폼", en: "Shorts" }, ko: "텐션 폭발 밈 & 코믹 리뷰", en: "High-tension meme & comic review", voice: "Pulcherrima",
      text: "Hilarious, sassy, super-expressive Korean comedy reaction and meme dubbing voice! Playful sarcasm, lively bounce, rapid-fire punchy delivery with witty, confident flair:" }
  ];
  // 감정 태그 — 버튼 라벨만 UI 언어로 보이고, 대사에 넣는 태그는 항상 영어다
  // (Gemini TTS 문서: 한국어 대본이라도 태그는 영어로 쓰는 편이 결과가 좋다).
  var EMOTION_TAGS = [
    { tag: 'calm',       ko: '차분하게' },
    { tag: 'warmly',     ko: '따뜻하게' },
    { tag: 'cheerfully', ko: '밝게' },
    { tag: 'sadly',      ko: '슬프게' },
    { tag: 'excited',    ko: '신나게' },
    { tag: 'whispering', ko: '속삭이듯' },
    { tag: 'angry',      ko: '화나게' },
    { tag: 'nervous',    ko: '긴장하며' }
  ];
  var SFX_CATEGORIES = ['Animals', 'Bass', 'Booms', 'Braams', 'Brass', 'Cymbals', 'Foley', 'Nature', 'Sci-Fi', 'UI', 'Whoosh'];
  var SFX_DURATIONS = [1, 2, 3, 5, 8, 10];
  var CHAR_LIMIT = 5000;

  var STORAGE_SESSION_KEY = 'nk_sound_session_id';
  var STORAGE_SEGMENTS_KEY = 'nk_sound_segments_v1';
  var STORAGE_DIRECTION_KEY = 'nk_sound_direction_v1';

  var i18n = {
    ko: {
      title: 'AI 오디오 생성',
      nav_dashboard: '대시보드',
      dash_title: 'AI 오디오',
      dash_hint: '프로젝트(에피소드)를 선택하면 해당 브랜드·에피소드와 연동돼요.\n프로젝트 없이 좌측 VOICE·SFX를 누르면 단독 모드로 열려요.',
      dash_empty: '연동할 프로젝트가 아직 없어요.\n좌측 VOICE·SFX로 단독 생성을 시작할 수 있어요.',
      dash_standalone: '단독으로 시작',
      dash_open_voice: 'VOICE 단독', dash_open_sfx: 'SFX 단독',
      mode_label: '모드', mode_project: '프로젝트', mode_instance: '단독',
      tab_voice: 'VOICE', tab_music: 'MUSIC', tab_sfx: 'SFX', music_badge: '준비중',
      segments_title: '대화 세그먼트', add_segment: '＋ 세그먼트', seg_placeholder: '대사 텍스트 입력…  (감정 태그: [calm] [warmly])',
      scene_import: '씬 대사 불러오기',
      settings_title: '설정', voice_label: '보이스', voice_pick: '보이스 선택', voice_none: '보이스를 선택하세요',
      model_label: '모델', stability_label: 'Stability', creative: 'Creative', robust: 'Robust',
      speed_label: '재생 속도', preview_line: '테스트 멘트', preview_pick_first: '먼저 보이스를 선택해주세요.',
      format_label: '출력 포맷', generate_voice: '음성 생성', generating: '생성 중…',
      direction_label: '연출 지시문', direction_preset: '연출 프리셋', direction_preset_custom: '직접 작성',
      direction_placeholder: '감정·템포·호흡·전체 흐름을 성우에게 디렉팅하듯 적어주세요.\n예: 처음 네 줄은 무겁게, 다섯째 줄부터 조금씩 따뜻하게. 문장 끝은 내려서 닫고, 줄 사이 1초 쉼.\n비워두면 기본 디렉션으로 읽어요.',
      direction_voice_hint: '추천 보이스',
      seg_direction_placeholder: '이 대사의 캐릭터·감정 연출 (선택) — 예: 느리고 차분하게, 단어마다 여유를 두고',
      cat_all: '전체 분류', cat_adult: '성인', cat_girl: '여아', cat_boy: '남아', cat_character: '캐릭터',
      sfx_title: '효과음', sfx_placeholder: '효과음 프롬프트 입력…  (예: heavy rain on a tin roof)',
      looping: 'Looping', duration: 'Duration', influence: '영향도', generate_sfx: '효과음 생성',
      assets_title: '오디오 자산', assets_empty: '아직 생성된 사운드가 없습니다.\n오른쪽 패널에서 생성해보세요.',
      download: '다운로드', reuse: '재사용', del: '삭제', clear_all: '전체 삭제', preview: '미리듣기',
      lib_title: '보이스 라이브러리', lib_search: '이름·스타일 검색…', tab_all: '전체', tab_brand: '브랜드', tab_user: '내 보이스',
      gender_all: '전체', gender_male: '남', gender_female: '여',
      sessionLabel: '세션', projectLabel: '현재 에피소드', brandLabel: '현재 브랜드',
      noProject: '에피소드 없음', noBrand: '브랜드 없음', noneLabel: '없음',
      no_text: '대사를 입력해주세요.', no_prompt: '효과음 프롬프트를 입력해주세요.', char_unit: '자',
      r2v_none: '레퍼런스 없음', r2v_generating: '레퍼런스 생성중', r2v_ready: '레퍼런스 준비됨',
      confirm_clear: '생성된 사운드 자산을 전체 삭제할까요?'
    },
    en: {
      title: 'AI Audio',
      nav_dashboard: 'Dashboard',
      dash_title: 'AI Audio',
      dash_hint: 'Pick a project (episode) to bind its brand & episode.\nOpen VOICE·SFX on the left without a project for standalone mode.',
      dash_empty: 'No projects to bind yet.\nUse VOICE·SFX on the left to start standalone.',
      dash_standalone: 'Start standalone',
      dash_open_voice: 'VOICE solo', dash_open_sfx: 'SFX solo',
      mode_label: 'Mode', mode_project: 'Project', mode_instance: 'Standalone',
      tab_voice: 'VOICE', tab_music: 'MUSIC', tab_sfx: 'SFX', music_badge: 'Soon',
      segments_title: 'Dialogue Segments', add_segment: '+ Segment', seg_placeholder: 'Enter dialogue…  (emotion tags: [calm] [warmly])',
      scene_import: 'Import scene lines',
      settings_title: 'Settings', voice_label: 'Voice', voice_pick: 'Select voice', voice_none: 'Please select a voice',
      model_label: 'Model', stability_label: 'Stability', creative: 'Creative', robust: 'Robust',
      speed_label: 'Playback speed', preview_line: 'Test line', preview_pick_first: 'Select a voice first.',
      format_label: 'Output format', generate_voice: 'Generate voice', generating: 'Generating…',
      direction_label: 'Voice direction', direction_preset: 'Direction preset', direction_preset_custom: 'Custom',
      direction_placeholder: 'Direct the voice actor: emotion, tempo, breathing, and the arc across the script.\ne.g. First four lines graver, then slightly warmer from line five. Close each sentence downward, 1-second pause between lines.\nLeave empty to use the default direction.',
      direction_voice_hint: 'Suggested voice',
      seg_direction_placeholder: 'Character / emotion direction for this line (optional) — e.g. slow and calm, leisurely on every word',
      cat_all: 'All types', cat_adult: 'Adult', cat_girl: 'Girl', cat_boy: 'Boy', cat_character: 'Character',
      sfx_title: 'Sound Effects', sfx_placeholder: 'Enter SFX prompt…  (e.g. heavy rain on a tin roof)',
      looping: 'Looping', duration: 'Duration', influence: 'Influence', generate_sfx: 'Generate SFX',
      assets_title: 'Audio Assets', assets_empty: 'No sounds generated yet.\nUse the panel on the right.',
      download: 'Download', reuse: 'Reuse', del: 'Delete', clear_all: 'Clear all', preview: 'Preview',
      lib_title: 'Voice Library', lib_search: 'Search name·style…', tab_all: 'All', tab_brand: 'Brand', tab_user: 'My voices',
      gender_all: 'All', gender_male: 'M', gender_female: 'F',
      sessionLabel: 'Session', projectLabel: 'Current episode', brandLabel: 'Current brand',
      noProject: 'No episode', noBrand: 'No brand', noneLabel: 'None',
      no_text: 'Please enter dialogue text.', no_prompt: 'Please enter an SFX prompt.', char_unit: 'chars',
      r2v_none: 'No reference', r2v_generating: 'Generating ref', r2v_ready: 'Ref ready',
      confirm_clear: 'Delete all generated sound assets?'
    }
  };

  // ─── State ────────────────────────────────────────────────
  var state = {
    view: 'dashboard',     // 'dashboard' | 'studio'
    tab: 'voice',
    lang: 'ko',
    drafts: [],
    dashFilter: '__all__',
    previewBusyId: '',     // 미리듣기 생성 중인 voice id
    segments: [],          // [{ id, voiceId, voiceName, voiceInitial, text }]
    defaultVoice: null,    // { id, name, ... }
    model: 'gemini_tts',   // 기본값: 별도 구독 없이 Google 자격증명으로 동작하는 Gemini TTS
    stability: 0.5,
    format: 'mp3_44100_128',
    direction: '',         // Gemini TTS 연출 지시문 (프롬프트로 그대로 전달)
    directionPreset: '',   // 마지막으로 고른 연출 프리셋 id ('' = 직접 작성)
    speed: 1,              // 미리듣기·자산 재생 속도 (playbackRate)
    previewLine: '',       // 미리듣기 샘플 멘트(서버가 돌려준 고정 문장)
    sfxPrompt: '',
    sfxDuration: 2,
    sfxLooping: false,
    sfxInfluence: 0.3,
    sfxCategory: '',
    voices: [],
    assets: [],
    generating: false,
    assetsLoading: false,
    // context
    projectId: '',
    sessionId: '',
    currentProject: null,
    currentBrand: null,
    // modal
    modalOpen: false,
    modalSegmentId: null,  // null = setting default voice; else target segment
    modalTab: 'all',
    modalGender: '',
    modalCategory: '',     // '' | adult | girl | boy | character
    modalSearch: '',
    _previewAudio: null
  };

  var root = null;

  // ─── Helpers ──────────────────────────────────────────────
  function t(key) { var l = state.lang; return (i18n[l] && i18n[l][key]) || i18n.ko[key] || key; }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'textContent') e.textContent = attrs[k];
      else if (k === 'innerHTML') e.innerHTML = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    return e;
  }
  function genId(p) { return (p || 'sg') + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }
  function initialOf(name) { return String(name || '?').trim().charAt(0) || '?'; }
  function isProjectMode() { return !!state.projectId || !!(state.currentProject && state.currentProject.id); }
  function brandId() { return (state.currentBrand && state.currentBrand.id) ? String(state.currentBrand.id) : ''; }
  function episodeId() {
    if (state.projectId) return state.projectId;
    return (state.currentProject && state.currentProject.id) ? String(state.currentProject.id) : '';
  }

  // ─── Persistence ──────────────────────────────────────────
  function ensureSessionId() {
    try {
      var cur = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (cur) return cur;
      var next = 'sg_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) { return 'sg_' + Date.now(); }
  }
  function saveSegments() {
    try { localStorage.setItem(STORAGE_SEGMENTS_KEY, JSON.stringify(state.segments)); } catch (_) {}
  }
  function saveDirection() {
    try { localStorage.setItem(STORAGE_DIRECTION_KEY, JSON.stringify({ text: state.direction, preset: state.directionPreset })); } catch (_) {}
  }
  function loadDirection() {
    try {
      var raw = localStorage.getItem(STORAGE_DIRECTION_KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (d && typeof d.text === 'string') { state.direction = d.text; state.directionPreset = String(d.preset || ''); }
    } catch (_) {}
  }
  function loadSegments() {
    try {
      var raw = localStorage.getItem(STORAGE_SEGMENTS_KEY);
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) state.segments = arr; }
    } catch (_) {}
  }

  // ─── Context ──────────────────────────────────────────────
  function readCurrentProject() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search }) : null;
    } catch (_) { return null; }
  }
  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search }) : null;
    } catch (_) { return null; }
  }
  function makePill(labelText, valueText) {
    var pill = el('span', 'studio-hero-pill');
    pill.appendChild(el('em', '', { textContent: labelText }));
    pill.appendChild(el('strong', '', { textContent: valueText }));
    return pill;
  }

  // ─── Voices ───────────────────────────────────────────────
  function loadVoices() {
    if (!NK.api || !NK.api.voicesList) return;
    var q = {};
    if (isProjectMode() && brandId()) q.brandId = brandId();
    NK.api.voicesList(q).then(function (data) {
      state.voices = (data && data.voices) || [];
      reconcileVoicesWithModel();
      render();
    }).catch(function () { render(); });
  }
  function voiceById(id) { return availableVoices().find(function (v) { return String(v.id) === String(id); }) || null; }

  // 선택한 모델에 맞는 보이스 목록. Gemini TTS는 서버 voices 테이블이 아닌 프리셋을 쓴다.
  function isGeminiModel() { return String(state.model || '').indexOf('gemini') === 0; }
  function availableVoices() { return isGeminiModel() ? GEMINI_VOICES.concat(CHARACTER_VOICES) : state.voices; }
  function voiceLabel(v) { return (state.lang === 'en' && v && v.nameEn) || (v && v.name) || ''; }
  function voiceDesc(v) { return (state.lang === 'en' && v && v.descriptionEn) || (v && v.description) || ''; }
  function voiceMatchesModel(v) { return !!v && (v.provider === 'gemini') === isGeminiModel(); }

  // 모델을 바꾸면 다른 프로바이더의 보이스가 남지 않도록 기본 보이스·세그먼트를 재배정.
  function reconcileVoicesWithModel() {
    var list = availableVoices();
    if (!list.length) return;
    if (!voiceMatchesModel(state.defaultVoice)) {
      state.defaultVoice = list.find(function (v) { return v.scope === 'global'; }) || list[0];
    }
    state.segments.forEach(function (s) {
      var cur = voiceById(s.voiceId);
      if (!cur) assignVoiceToSegment(s, state.defaultVoice);
    });
    saveSegments();
  }

  function assignVoiceToSegment(seg, voice) {
    seg.voiceId = voice.id;
    seg.providerVoiceId = voice.providerVoiceId || '';
    seg.voiceName = voiceLabel(voice);
    seg.voiceInitial = initialOf(voiceLabel(voice));
  }

  // ─── Segments ─────────────────────────────────────────────
  function addSegment() {
    var seg = { id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: '' };
    if (state.defaultVoice) assignVoiceToSegment(seg, state.defaultVoice);
    state.segments.push(seg);
    saveSegments();
    render();
  }
  function removeSegment(id) {
    state.segments = state.segments.filter(function (s) { return s.id !== id; });
    saveSegments();
    render();
  }
  function totalChars() { return state.segments.reduce(function (n, s) { return n + (s.text || '').length; }, 0); }

  // ─── Assets ───────────────────────────────────────────────
  function loadAssets() {
    if (!NK.api || !NK.api.soundAssets) return;
    state.assetsLoading = true;
    var q = isProjectMode()
      ? { scope: 'project', brandId: brandId(), episodeId: episodeId() }
      : { scope: 'instance', sessionId: state.sessionId };
    NK.api.soundAssets(q).then(function (data) {
      var server = (data && data.assets) || [];
      // merge: keep local pending (processing) that aren't in server yet
      var pending = state.assets.filter(function (a) { return a.status === 'processing' || a._local; });
      var serverIds = {};
      server.forEach(function (a) { serverIds[a.id] = true; });
      var keep = pending.filter(function (a) { return !serverIds[a.id]; });
      state.assets = keep.concat(server);
      state.assetsLoading = false;
      render();
    }).catch(function () { state.assetsLoading = false; render(); });
  }

  // ─── Render ───────────────────────────────────────────────
  function render() {
    if (!root) return;
    root.innerHTML = '';
    if (state.view === 'dashboard') { renderDashboard(); syncSidebarNav(); return; }

    var wrap = el('div', 'snd-wrap');

    // Header
    var header = el('div', 'snd-header');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', 'snd-title', { textContent: t('title') }));
    header.appendChild(titleWrap);
    var detached = !isProjectMode();
    var pills = el('div', 'snd-status-pills');
    pills.appendChild(makePill(t('mode_label'), t(detached ? 'mode_instance' : 'mode_project')));
    // 영상생성 페이지와 동일: 단독(detached) 모드에서는 세션 ID를 노출하지 않고 '없음'으로 표기.
    pills.appendChild(makePill(t('sessionLabel'), detached ? t('noneLabel') : (state.sessionId || t('noneLabel'))));
    pills.appendChild(makePill(t('projectLabel'), detached ? t('noneLabel') : ((state.currentProject && state.currentProject.title) || t('noProject'))));
    pills.appendChild(makePill(t('brandLabel'), detached ? t('noBrand') : ((state.currentBrand && state.currentBrand.brandTitle) || t('noBrand'))));
    header.appendChild(pills);
    wrap.appendChild(header);

    // Tabs
    var tabbar = el('div', 'snd-tabbar');
    var tabs = el('div', 'snd-tabs');
    tabs.appendChild(makeTab('voice', t('tab_voice')));
    var musicTab = makeTab('music', t('tab_music'), true);
    musicTab.appendChild(el('span', 'snd-tab-badge', { textContent: t('music_badge') }));
    tabs.appendChild(musicTab);
    tabs.appendChild(makeTab('sfx', t('tab_sfx')));
    tabbar.appendChild(tabs);
    wrap.appendChild(tabbar);

    // Layout
    var layout = el('div', 'snd-layout');
    var left = el('div', 'snd-left');
    if (state.tab === 'voice') left.appendChild(renderSegmentsPanel());
    left.appendChild(renderAssetsPanel());
    layout.appendChild(left);
    layout.appendChild(state.tab === 'sfx' ? renderSfxPanel() : renderVoiceSettingsPanel());
    wrap.appendChild(layout);

    root.appendChild(wrap);

    if (state.modalOpen) renderVoiceModal();
    syncSidebarNav();
  }

  // ── Dashboard view ──
  // 다른 앱과 100% 동일한 방식: 공용 dashboard.js(NK.ui.dashboard)가 서버에서 프로젝트를
  // 불러오고(로딩 스피너+블러), 카드(브랜드 로고 썸네일 SSOT 포함)를 #dashboard-drafts에 렌더한다.
  // 호스트 판별은 page-shell-ai-sound → 'sound'. 카드 클릭은 dashboard.js의 'sound' 분기가
  // NK.uiSound.enterProject(draft)를 호출한다.
  function renderDashboard() {
    // 다른 대시보드 페이지와 동일한 스캐폴드 DOM (.projects > #dashboard-drafts.draft-card-grid + 로딩 오버레이)
    var scroll = el('div', 'snd-dash-scroll');
    var projects = el('div', 'projects');
    projects.appendChild(el('div', 'draft-card-grid', { id: 'dashboard-drafts' }));
    var loading = el('div', 'loading-overlay hidden', { id: 'dashboard-loading' });
    loading.appendChild(el('div', 'spinner'));
    loading.appendChild(el('p', '', { textContent: state.lang === 'en' ? 'Loading projects...' : '프로젝트 불러오는 중...' }));
    projects.appendChild(loading);
    scroll.appendChild(projects);
    root.appendChild(scroll);

    // 공용 대시보드 렌더(서버 동기화 + 스피너 + 카드). dashboard.js 미로드 시 안내만 표시.
    if (NK.ui && NK.ui.dashboard && NK.ui.dashboard.renderDrafts) {
      try { NK.ui.dashboard.renderDrafts(); } catch (_) {}
    } else {
      var empty = el('div', 'snd-empty');
      empty.style.gridColumn = '1 / -1';
      empty.textContent = state.lang === 'en' ? 'Dashboard module unavailable.' : '대시보드 모듈을 불러오지 못했어요.';
      projects.querySelector('#dashboard-drafts').appendChild(empty);
    }
  }

  // dashboard.js 'sound' 카드 클릭 진입점 (전역 노출)
  snd.enterProject = function (d) {
    if (!d) return;
    openStudioProject(d);
  };

  // ── View switching ──
  function openDashboard() { state.view = 'dashboard'; render(); }
  function openStudioInstance(tab) {
    // 단독(인스턴스) 모드 — 전역 프로젝트 컨텍스트는 건드리지 않고 로컬만 분리
    state.projectId = '';
    state.currentProject = null;
    state.currentBrand = null;
    state.view = 'studio';
    state.tab = (tab === 'sfx') ? 'sfx' : 'voice';
    render();
    loadVoices();
    loadAssets();
  }
  function openStudioProject(d) {
    // selectProject(setCurrent)는 dashboard.js 카드 클릭에서 이미 수행됨. 여기선 컨텍스트를 읽어 스튜디오로 전환.
    try { if (NK.service && NK.service.project && NK.service.project.setCurrent) NK.service.project.setCurrent(d); } catch (_) {}
    state.projectId = String(d.id || '');
    state.currentProject = (NK.service && NK.service.project && NK.service.project.normalizeDraft) ? NK.service.project.normalizeDraft(d) : d;
    state.currentBrand = readCurrentBrand() || { id: d.brandId || '', brandTitle: d.brandTitle || d.seriesTitle || '' };
    state.view = 'studio';
    state.tab = 'voice';
    render();
    loadVoices();
    loadAssets();
  }

  // 사이드바 nav(대시보드/VOICE/SFX) ↔ 현재 뷰 동기화
  function syncSidebarNav() {
    try {
      document.querySelectorAll('.sidebar [data-snd-view]').forEach(function (a) {
        var v = a.getAttribute('data-snd-view');
        var active = (state.view === 'dashboard') ? (v === 'dashboard') : (v === state.tab);
        a.classList.toggle('active', active);
      });
    } catch (_) {}
  }
  snd.setView = function (v) {
    if (v === 'dashboard') { openDashboard(); return; }
    if (v === 'voice' || v === 'sfx') { openStudioInstance(v); return; }
  };
  snd.setTab = function (tab) {
    if (tab !== 'voice' && tab !== 'sfx') return;
    state.view = 'studio';
    state.tab = tab;
    render();
  };

  function makeTab(id, label, disabled) {
    var b = el('button', 'snd-tab' + (state.tab === id ? ' is-active' : '') + (disabled ? ' is-disabled' : ''), { type: 'button', textContent: label });
    if (!disabled) b.addEventListener('click', function () { state.tab = id; render(); });
    return b;
  }

  // ── Segments panel (VOICE left-top) ──
  function renderSegmentsPanel() {
    var panel = el('div', 'snd-panel');
    panel.style.flex = '1 1 auto';
    var head = el('div', 'snd-panel-header');
    head.appendChild(el('span', 'snd-panel-title', { textContent: t('segments_title') }));
    var addBtn = el('button', 'snd-add-btn', { type: 'button', textContent: t('add_segment') });
    addBtn.addEventListener('click', addSegment);
    head.appendChild(addBtn);
    panel.appendChild(head);

    var body = el('div', 'snd-panel-body');
    if (!state.segments.length) {
      var hint = el('div', 'snd-empty', { textContent: state.lang === 'en' ? 'Add a segment to start.' : '세그먼트를 추가해 시작하세요.' });
      body.appendChild(hint);
    } else {
      state.segments.forEach(function (seg, idx) { body.appendChild(renderSegment(seg, idx)); });
    }

    // 씬 대사 불러오기 (프로젝트 모드 전용)
    if (isProjectMode()) {
      var sceneBtn = el('button', 'btn-secondary snd-scene-btn', { type: 'button', textContent: t('scene_import') });
      sceneBtn.addEventListener('click', importSceneLines);
      body.appendChild(sceneBtn);
    }
    panel.appendChild(body);
    return panel;
  }

  function renderSegment(seg, idx) {
    var card = el('div', 'snd-segment');
    var head = el('div', 'snd-seg-head');
    head.appendChild(el('span', 'snd-seg-handle', { textContent: '⠿', title: '드래그 정렬' }));
    var spk = el('button', 'snd-speaker-btn', { type: 'button' });
    spk.appendChild(el('span', 'snd-speaker-avatar', { textContent: seg.voiceInitial || '?' }));
    spk.appendChild(el('span', '', { textContent: seg.voiceName || t('voice_pick') }));
    spk.appendChild(el('span', '', { innerHTML: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' }));
    spk.addEventListener('click', function () { openVoiceModal(seg.id); });
    head.appendChild(spk);
    head.appendChild(el('span', 'snd-seg-spacer'));
    var del = el('button', 'snd-seg-del', { type: 'button', title: t('del'), innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.75h6l.6 1.5H19a.75.75 0 0 1 0 1.5h-.66l-.8 10.05A2.25 2.25 0 0 1 15.29 20H8.71a2.25 2.25 0 0 1-2.24-2.2l-.81-10.05H5a.75.75 0 0 1 0-1.5h3.4L9 4.75Z"/><path d="M10 10v5.25M14 10v5.25"/></svg>' });
    del.addEventListener('click', function () { removeSegment(seg.id); });
    head.appendChild(del);
    card.appendChild(head);

    var ta = el('textarea', 'snd-seg-text', { placeholder: t('seg_placeholder') });
    ta.value = seg.text || '';
    ta.addEventListener('input', function () { seg.text = ta.value; saveSegments(); updateMeter(); });
    card.appendChild(ta);

    // 대사별 연출 — 공통 연출 지시문 뒤에 이 대사에만 붙는다(대화에서 캐릭터마다 다르게 연기시키기).
    if (isGeminiModel()) {
      var dir = el('input', 'snd-seg-text snd-seg-direction', { type: 'text', placeholder: t('seg_direction_placeholder') });
      dir.style.minHeight = '0';
      dir.value = seg.direction || '';
      dir.addEventListener('input', function () { seg.direction = dir.value; saveSegments(); });
      card.appendChild(dir);
    }

    // emotion tag chips — insert at caret
    var chips = el('div', 'snd-chips');
    EMOTION_TAGS.forEach(function (et) {
      var label = state.lang === 'en' ? et.tag : et.ko;
      var c = el('button', 'snd-chip', { type: 'button', textContent: '[' + label + ']', title: '[' + et.tag + ']' });
      c.addEventListener('click', function () { insertTag(ta, seg, '[' + et.tag + '] '); });
      chips.appendChild(c);
    });
    card.appendChild(chips);
    return card;
  }

  function insertTag(textarea, seg, tag) {
    var start = textarea.selectionStart || 0;
    var v = textarea.value;
    textarea.value = v.slice(0, start) + tag + v.slice(textarea.selectionEnd || start);
    seg.text = textarea.value;
    saveSegments();
    textarea.focus();
    var pos = start + tag.length;
    try { textarea.setSelectionRange(pos, pos); } catch (_) {}
    updateMeter();
  }

  function updateMeter() {
    var m = root && root.querySelector('[data-snd-meter]');
    if (!m) return;
    var chars = totalChars();
    m.querySelector('[data-meter-chars]').textContent = chars + ' / ' + CHAR_LIMIT;
  }

  // ── Voice field: 보이스 선택 + 속도 + 미리듣기 (설정 패널 최상단) ──
  function renderVoiceField() {
    var vf = el('div', 'snd-field');
    vf.appendChild(el('span', 'snd-label', { textContent: t('voice_label') }));
    var pick = el('button', 'snd-voice-pick', { type: 'button' });
    var dv = state.defaultVoice;
    var info = el('div');
    info.appendChild(el('div', 'snd-voice-pick-name', { textContent: dv ? voiceLabel(dv) : t('voice_pick') }));
    info.appendChild(el('div', 'snd-voice-pick-sub', { textContent: dv ? ((dv.gender || '').toUpperCase() + ' · ' + voiceDesc(dv)) : t('voice_none') }));
    pick.appendChild(el('span', 'snd-speaker-avatar', { textContent: dv ? initialOf(voiceLabel(dv)) : '🎙' }));
    pick.appendChild(info);
    pick.appendChild(el('span', 'snd-voice-pick-arrow', { innerHTML: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>' }));
    pick.addEventListener('click', function () { openVoiceModal(null); });
    vf.appendChild(pick);

    // 속도 + 미리듣기 (AI 기업 에이전트 페이지와 동일 구성)
    var prow = el('div', 'snd-preview-row');
    var spd = el('button', 'snd-speed-btn', { type: 'button', title: t('speed_label'), textContent: 'x' + state.speed });
    spd.addEventListener('click', function () {
      var i = VOICE_SPEEDS.indexOf(state.speed);
      state.speed = VOICE_SPEEDS[(i + 1) % VOICE_SPEEDS.length];
      spd.textContent = 'x' + state.speed;
      if (state._previewAudio) applyPlaybackRate(state._previewAudio);
      applyRateToAssetAudios();
    });
    prow.appendChild(spd);

    var busy = !!state.defaultVoice && state.previewBusyId === String(state.defaultVoice.id);
    var pv = el('button', 'snd-preview-btn', { type: 'button' });
    if (busy) {
      pv.appendChild(el('span', 'snd-spinner'));
      pv.appendChild(document.createTextNode(state.lang === 'en' ? 'Loading' : '생성 중'));
      pv.disabled = true;
    } else {
      pv.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      pv.appendChild(document.createTextNode(t('preview')));
      pv.addEventListener('click', function () {
        if (!state.defaultVoice) { alert(t('preview_pick_first')); return; }
        previewVoice(state.defaultVoice);
      });
    }
    prow.appendChild(pv);
    vf.appendChild(prow);

    if (state.previewLine) vf.appendChild(el('div', 'snd-preview-line', { textContent: t('preview_line') + ': ' + state.previewLine }));
    return vf;
  }

  // ── Direction field: 연출 프리셋 + 지시문 (Gemini TTS 전용) ──
  function renderDirectionField() {
    var en = state.lang === 'en';
    var df = el('div', 'snd-field');
    df.appendChild(el('span', 'snd-label', { textContent: t('direction_label') }));

    var psel = el('select', 'snd-select', { 'aria-label': t('direction_preset') });
    var custom = el('option', '', { value: '', textContent: t('direction_preset') + ' · ' + t('direction_preset_custom') });
    psel.appendChild(custom);
    var groups = {};
    DIRECTION_PRESETS.forEach(function (p) {
      var gl = en ? p.genre.en : p.genre.ko;
      if (!groups[gl]) { groups[gl] = el('optgroup', '', { label: gl }); psel.appendChild(groups[gl]); }
      var o = el('option', '', { value: p.id, textContent: (en ? p.en : p.ko) + ' · ' + p.voice });
      if (p.id === state.directionPreset) o.selected = true;
      groups[gl].appendChild(o);
    });
    df.appendChild(psel);

    var ta = el('textarea', 'snd-seg-text', { placeholder: t('direction_placeholder'), rows: '6' });
    ta.style.minHeight = '120px';
    ta.value = state.direction || '';
    df.appendChild(ta);

    var hint = el('div', 'snd-preview-line');
    function updateHint() {
      var p = DIRECTION_PRESETS.find(function (x) { return x.id === state.directionPreset; });
      hint.textContent = p ? (t('direction_voice_hint') + ': ' + p.voice) : '';
      hint.style.display = p ? '' : 'none';
    }
    updateHint();
    df.appendChild(hint);

    psel.addEventListener('change', function () {
      var p = DIRECTION_PRESETS.find(function (x) { return x.id === psel.value; });
      state.directionPreset = p ? p.id : '';
      if (p) { state.direction = p.text; ta.value = p.text; }
      updateHint();
      saveDirection();
    });
    ta.addEventListener('input', function () {
      state.direction = ta.value;
      // 프리셋 원문에서 손으로 고치면 '직접 작성'으로 표시한다.
      var p = DIRECTION_PRESETS.find(function (x) { return x.id === state.directionPreset; });
      if (p && p.text !== ta.value) { state.directionPreset = ''; psel.value = ''; updateHint(); }
      saveDirection();
    });
    return df;
  }

  // ── Voice settings panel (VOICE right) ──
  function renderVoiceSettingsPanel() {
    var panel = el('div', 'snd-gen-panel');
    panel.appendChild(el('div', 'snd-panel-title', { textContent: t('settings_title') }));
    panel.appendChild(renderVoiceField());

    // model
    var mf = el('div', 'snd-field');
    mf.appendChild(el('span', 'snd-label', { textContent: t('model_label') }));
    var msel = el('select', 'snd-select');
    MODELS.forEach(function (m) {
      var o = el('option', '', { value: m.id, textContent: state.lang === 'en' ? m.en : m.ko });
      if (m.id === state.model) o.selected = true;
      msel.appendChild(o);
    });
    msel.addEventListener('change', function () {
      state.model = msel.value;
      stopPreview();
      reconcileVoicesWithModel();
      render();
    });
    mf.appendChild(msel);
    panel.appendChild(mf);

    // 연출 지시문 — Gemini TTS 는 이 문단을 대본 앞에 붙여 한 프롬프트로 연기한다.
    if (isGeminiModel()) panel.appendChild(renderDirectionField());

    // stability slider — ElevenLabs 전용 파라미터라 Gemini TTS에서는 숨긴다.
    if (!isGeminiModel()) {
      var sf = el('div', 'snd-field');
      sf.appendChild(el('span', 'snd-label', { textContent: t('stability_label') }));
      var srow = el('div', 'snd-slider-row');
      srow.appendChild(el('span', 'snd-slider-ends', { textContent: t('creative') }));
      var slider = el('input', '', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.stability) });
      slider.addEventListener('input', function () { state.stability = Number(slider.value); });
      srow.appendChild(slider);
      srow.appendChild(el('span', 'snd-slider-ends', { textContent: t('robust') }));
      sf.appendChild(srow);
      panel.appendChild(sf);
    }

    // format
    var ff = el('div', 'snd-field');
    ff.appendChild(el('span', 'snd-label', { textContent: t('format_label') }));
    var fsel = el('select', 'snd-select');
    (isGeminiModel() ? GEMINI_FORMATS : FORMATS).forEach(function (f) {
      var o = el('option', '', { value: f.id, textContent: f.label });
      if (f.id === state.format) o.selected = true;
      fsel.appendChild(o);
    });
    if (isGeminiModel()) fsel.disabled = true;
    fsel.addEventListener('change', function () { state.format = fsel.value; });
    ff.appendChild(fsel);
    panel.appendChild(ff);

    // meter
    var meter = el('div', 'snd-meter', { 'data-snd-meter': '1' });
    var chars = totalChars();
    var cspan = el('span'); cspan.appendChild(el('strong', '', { 'data-meter-chars': '1', textContent: chars + ' / ' + CHAR_LIMIT })); cspan.appendChild(document.createTextNode(' ' + t('char_unit')));
    meter.appendChild(cspan);
    panel.appendChild(meter);

    // generate
    var gen = el('button', 'btn-primary snd-gen-btn' + (state.generating ? ' is-loading' : ''), { type: 'button', textContent: state.generating ? t('generating') : t('generate_voice') });
    if (state.generating) gen.disabled = true;
    gen.addEventListener('click', generateVoice);
    panel.appendChild(gen);
    return panel;
  }

  // ── SFX panel (SFX right) ──
  function renderSfxPanel() {
    var panel = el('div', 'snd-gen-panel');
    panel.appendChild(el('div', 'snd-panel-title', { textContent: t('sfx_title') }));

    // category chips
    var cats = el('div', 'snd-cat-chips');
    SFX_CATEGORIES.forEach(function (cat) {
      var c = el('button', 'snd-cat-chip' + (state.sfxCategory === cat ? ' is-active' : ''), { type: 'button', textContent: cat });
      c.addEventListener('click', function () {
        state.sfxCategory = (state.sfxCategory === cat) ? '' : cat;
        render();
      });
      cats.appendChild(c);
    });
    panel.appendChild(cats);

    // prompt
    var pf = el('div', 'snd-field');
    pf.appendChild(el('span', 'snd-label', { textContent: t('sfx_title') }));
    var ta = el('textarea', 'snd-prompt', { placeholder: t('sfx_placeholder') });
    ta.value = state.sfxPrompt;
    ta.addEventListener('input', function () { state.sfxPrompt = ta.value; });
    pf.appendChild(ta);
    panel.appendChild(pf);

    // duration + looping row
    var row = el('div', 'snd-row');
    var df = el('div', 'snd-field');
    df.appendChild(el('span', 'snd-label', { textContent: t('duration') }));
    var dsel = el('select', 'snd-select');
    SFX_DURATIONS.forEach(function (d) {
      var o = el('option', '', { value: String(d), textContent: d + 's' });
      if (d === state.sfxDuration) o.selected = true;
      dsel.appendChild(o);
    });
    dsel.addEventListener('change', function () { state.sfxDuration = Number(dsel.value); });
    df.appendChild(dsel);
    row.appendChild(df);

    var lf = el('div', 'snd-field');
    lf.appendChild(el('span', 'snd-label', { textContent: t('looping') }));
    var lbtn = el('button', 'snd-toggle-btn' + (state.sfxLooping ? ' is-on' : ''), { type: 'button', textContent: state.sfxLooping ? 'On' : 'Off' });
    lbtn.addEventListener('click', function () { state.sfxLooping = !state.sfxLooping; render(); });
    lf.appendChild(lbtn);
    row.appendChild(lf);
    panel.appendChild(row);

    // influence slider
    var inf = el('div', 'snd-field');
    inf.appendChild(el('span', 'snd-label', { textContent: t('influence') + ' · ' + Math.round(state.sfxInfluence * 100) + '%' }));
    var slider = el('input', '', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.sfxInfluence) });
    slider.addEventListener('input', function () {
      state.sfxInfluence = Number(slider.value);
      inf.querySelector('.snd-label').textContent = t('influence') + ' · ' + Math.round(state.sfxInfluence * 100) + '%';
    });
    inf.appendChild(slider);
    panel.appendChild(inf);

    // generate
    var gen = el('button', 'btn-primary snd-gen-btn' + (state.generating ? ' is-loading' : ''), { type: 'button', textContent: state.generating ? t('generating') : t('generate_sfx') });
    if (state.generating) gen.disabled = true;
    gen.addEventListener('click', generateSfx);
    panel.appendChild(gen);
    return panel;
  }

  // ── Assets / history panel (left-bottom) ──
  function renderAssetsPanel() {
    var panel = el('div', 'snd-panel');
    panel.style.flex = state.tab === 'voice' ? '0 0 40%' : '1 1 auto';
    var head = el('div', 'snd-panel-header');
    head.appendChild(el('span', 'snd-panel-title', { textContent: t('assets_title') }));
    if (state.assets.length) {
      var clr = el('button', 'snd-clear-btn', { type: 'button', textContent: t('clear_all') });
      clr.addEventListener('click', async function () {
        if (!(await NK.ui.dialog.confirm(t('confirm_clear'), { title: t('clear_all') }))) return;
        state.assets = []; render();
      });
      head.appendChild(clr);
    }
    panel.appendChild(head);

    var body = el('div', 'snd-panel-body');
    var list = state.assets;
    if (state.tab === 'sfx') list = list.filter(function (a) { return a.type === 'sfx'; });
    else if (state.tab === 'voice') list = list.filter(function (a) { return a.type === 'voice'; });

    if (!list.length) {
      body.appendChild(el('div', 'snd-empty', { textContent: state.assetsLoading ? (state.lang === 'en' ? 'Loading…' : '불러오는 중…') : t('assets_empty') }));
    } else {
      list.forEach(function (a) { body.appendChild(renderAsset(a)); });
    }
    panel.appendChild(body);
    return panel;
  }

  function renderAsset(a) {
    var card = el('div', 'snd-asset' + (a.status === 'processing' ? ' is-processing' : ''));
    var top = el('div', 'snd-asset-top');
    top.appendChild(el('span', 'snd-asset-type' + (a.type === 'sfx' ? ' snd-asset-type--sfx' : ''), { textContent: a.type === 'sfx' ? 'SFX' : 'VOICE' }));
    top.appendChild(el('span', 'snd-asset-title', { textContent: a.title || a.prompt || a.textContent || '사운드' }));
    if (a.status === 'processing') top.appendChild(el('span', 'snd-spinner'));
    card.appendChild(top);

    var metaParts = [];
    if (a.model) metaParts.push(a.model);
    if (a.durationSeconds) metaParts.push(a.durationSeconds + 's');
    if (metaParts.length) card.appendChild(el('div', 'snd-asset-meta', { textContent: metaParts.join(' · ') }));

    if (a.outputUrl && a.status !== 'processing') {
      var audio = el('audio', '', { controls: '1', preload: 'none', src: a.outputUrl });
      applyPlaybackRate(audio);
      audio.addEventListener('loadedmetadata', function () { applyPlaybackRate(audio); });
      card.appendChild(audio);
      var actions = el('div', 'snd-asset-actions');
      var dl = el('a', 'snd-mini-btn', { href: a.outputUrl, download: (a.title || 'sound') + (/^wav/i.test(String(a.outputFormat || '')) ? '.wav' : '.mp3'), target: '_blank', innerHTML: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>' });
      dl.appendChild(document.createTextNode(t('download')));
      actions.appendChild(dl);
      card.appendChild(actions);
    }
    return card;
  }

  // ─── Voice library modal ──────────────────────────────────
  function openVoiceModal(segmentId) {
    state.modalOpen = true;
    state.modalSegmentId = segmentId;
    state.modalTab = 'all';
    state.modalGender = '';
    state.modalCategory = '';
    state.modalSearch = '';
    render();
  }
  function closeVoiceModal() {
    stopPreview();
    state.modalOpen = false;
    state.modalSegmentId = null;
    render();
  }
  function stopPreview() { if (state._previewAudio) { try { state._previewAudio.pause(); } catch (_) {} state._previewAudio = null; } }

  function renderVoiceModal() {
    var overlay = el('div', 'snd-modal-overlay');
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVoiceModal(); });
    var modal = el('div', 'snd-modal');

    // filtered voices
    var list = filteredModalVoices();

    var head = el('div', 'snd-modal-head');
    var titleBox = el('div');
    titleBox.appendChild(el('span', 'snd-modal-title', { textContent: t('lib_title') }));
    head.appendChild(titleBox);
    head.appendChild(el('span', 'snd-modal-count', { textContent: '(' + list.length + '/' + availableVoices().length + ')' }));
    var close = el('button', 'snd-modal-close', { type: 'button', innerHTML: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' });
    close.addEventListener('click', closeVoiceModal);
    head.appendChild(close);
    modal.appendChild(head);

    var filters = el('div', 'snd-modal-filters');
    var search = el('input', 'snd-modal-search', { type: 'text', placeholder: t('lib_search'), value: state.modalSearch });
    search.addEventListener('input', function () { state.modalSearch = search.value; refreshModalBody(modal); });
    filters.appendChild(search);

    // 3-tier scope tabs
    var segTabs = el('div', 'snd-seg-tabs');
    segTabs.appendChild(makeModalTab('all', t('tab_all')));
    if (isProjectMode()) segTabs.appendChild(makeModalTab('brand', t('tab_brand')));
    segTabs.appendChild(makeModalTab('user', t('tab_user')));
    // gender filters
    ['', 'male', 'female'].forEach(function (g) {
      var label = g === '' ? t('gender_all') : (g === 'male' ? t('gender_male') : t('gender_female'));
      var gt = el('button', 'snd-seg-tab' + (state.modalGender === g ? ' is-active' : ''), { type: 'button', textContent: (state.lang === 'en' ? 'Gender: ' : '성별: ') + label });
      if (g !== '') gt.textContent = label;
      gt.addEventListener('click', function () { state.modalGender = g; refreshModalBody(modal); markGender(segTabs); });
      gt.setAttribute('data-gender', g);
      segTabs.appendChild(gt);
    });
    filters.appendChild(segTabs);
    // 분류(성인·여아·남아·캐릭터) — Gemini 보이스에만 있다.
    if (isGeminiModel()) {
      var catTabs = el('div', 'snd-seg-tabs');
      VOICE_CATEGORIES.forEach(function (c) {
        var ct = el('button', 'snd-seg-tab' + (state.modalCategory === c ? ' is-active' : ''), { type: 'button', textContent: t(c ? 'cat_' + c : 'cat_all'), 'data-category': c });
        ct.addEventListener('click', function () {
          state.modalCategory = c;
          catTabs.querySelectorAll('[data-category]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-category') === c); });
          refreshModalBody(modal);
        });
        catTabs.appendChild(ct);
      });
      filters.appendChild(catTabs);
    }
    modal.appendChild(filters);

    var body = el('div', 'snd-modal-body');
    modal.appendChild(body);
    overlay.appendChild(modal);
    root.appendChild(overlay);
    refreshModalBody(modal);
    setTimeout(function () { try { search.focus(); } catch (_) {} }, 30);
  }
  function makeModalTab(id, label) {
    var b = el('button', 'snd-seg-tab' + (state.modalTab === id ? ' is-active' : ''), { type: 'button', textContent: label, 'data-scope': id });
    b.addEventListener('click', function () {
      state.modalTab = id;
      // toggle active class without full re-render
      var modal = b.closest('.snd-modal');
      modal.querySelectorAll('[data-scope]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-scope') === id); });
      refreshModalBody(modal);
    });
    return b;
  }
  function markGender(segTabs) {
    segTabs.querySelectorAll('[data-gender]').forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-gender') === state.modalGender); });
  }
  function filteredModalVoices() {
    var q = state.modalSearch.trim().toLowerCase();
    return availableVoices().filter(function (v) {
      if (state.modalTab === 'brand' && v.scope !== 'brand') return false;
      if (state.modalTab === 'user' && v.scope !== 'user') return false;
      if (state.modalTab === 'all' && v.scope === 'brand' && !isProjectMode()) return false;
      if (state.modalGender && v.gender !== state.modalGender) return false;
      if (state.modalCategory && (v.category || 'adult') !== state.modalCategory) return false;
      if (q) {
        var hay = (v.name + ' ' + (v.nameEn || '') + ' ' + (v.description || '') + ' ' + (v.descriptionEn || '') + ' ' + (v.category ? t('cat_' + v.category) : '') + ' ' + (v.styleTags || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }
  function refreshModalBody(modal) {
    var body = modal.querySelector('.snd-modal-body');
    if (!body) return;
    body.innerHTML = '';
    var list = filteredModalVoices();
    var countEl = modal.querySelector('.snd-modal-count');
    if (countEl) countEl.textContent = '(' + list.length + '/' + availableVoices().length + ')';
    if (!list.length) {
      body.appendChild(el('div', 'snd-modal-empty', { textContent: state.lang === 'en' ? 'No voices found.' : '보이스가 없습니다.' }));
      return;
    }
    var selectedId = state.modalSegmentId ? (segById(state.modalSegmentId) || {}).voiceId : (state.defaultVoice && state.defaultVoice.id);
    list.forEach(function (v) { body.appendChild(renderVoiceCard(v, String(selectedId) === String(v.id))); });
  }
  function segById(id) { return state.segments.find(function (s) { return s.id === id; }); }

  function renderVoiceCard(v, selected) {
    var card = el('div', 'snd-voice-card' + (selected ? ' is-selected' : ''));
    var head = el('div', 'snd-vc-head');
    head.appendChild(el('span', 'snd-vc-avatar', { textContent: initialOf(voiceLabel(v)) }));
    var nb = el('div');
    nb.appendChild(el('div', 'snd-vc-name', { textContent: voiceLabel(v) }));
    nb.appendChild(el('div', 'snd-vc-sub', { textContent: (v.gender || 'neutral').toUpperCase() + ' · ' + (v.language || 'ko').toUpperCase() + (v.category && v.category !== 'adult' ? ' · ' + t('cat_' + v.category) : '') + (v.scope === 'brand' ? ' · 브랜드' : (v.scope === 'user' ? ' · 내 보이스' : '')) }));
    head.appendChild(nb);
    var fav = el('button', 'snd-vc-fav' + (v.favorite ? ' is-fav' : ''), { type: 'button', textContent: v.favorite ? '★' : '☆', title: '즐겨찾기' });
    fav.addEventListener('click', function (e) { e.stopPropagation(); toggleFavorite(v, fav); });
    head.appendChild(fav);
    card.appendChild(head);

    if (voiceDesc(v)) card.appendChild(el('div', 'snd-vc-desc', { textContent: voiceDesc(v) }));
    if (v.styleTags && v.styleTags.length) {
      var tags = el('div', 'snd-vc-tags');
      v.styleTags.slice(0, 5).forEach(function (tg) { tags.appendChild(el('span', 'snd-vc-tag', { textContent: tg })); });
      card.appendChild(tags);
    }
    var foot = el('div', 'snd-vc-foot');
    // 미리듣기 — 항상 노출. previewUrl이 있으면 그걸, 없으면 짧은 TTS 샘플을 즉석 생성해 재생.
    var busy = state.previewBusyId === String(v.id);
    var pv = el('button', 'snd-vc-preview', { type: 'button' });
    if (busy) {
      pv.appendChild(el('span', 'snd-spinner'));
      pv.appendChild(document.createTextNode(state.lang === 'en' ? 'Loading' : '생성 중'));
      pv.disabled = true;
    } else {
      pv.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      pv.appendChild(document.createTextNode(t('preview')));
      pv.addEventListener('click', function (e) { e.stopPropagation(); previewVoice(v); });
    }
    foot.appendChild(pv);
    // Phase 2 R2V status badge (brand voices)
    if (v.scope === 'brand') {
      var rk = v.r2vReferenceStatus || 'none';
      foot.appendChild(el('span', 'snd-vc-r2v', { textContent: rk === 'ready' ? t('r2v_ready') : (rk === 'generating' ? t('r2v_generating') : t('r2v_none')) }));
    }
    if (foot.childNodes.length) card.appendChild(foot);

    card.addEventListener('click', function () { selectVoice(v); });
    return card;
  }

  // 프로바이더 원문 오류를 사용자가 조치할 수 있는 문장으로 바꾼다.
  function explainError(err) {
    var msg = String((err && err.message) || err || 'error');
    var en = state.lang === 'en';
    if (/payment_issue|payment_required/i.test(msg)) {
      return en
        ? 'The ElevenLabs subscription has an unpaid invoice, so its API is blocked. Settle the invoice, or switch the model to Gemini TTS.'
        : 'ElevenLabs 구독에 미결제 인보이스가 있어 API가 막혀 있어요. 결제를 완료하거나, 모델을 Gemini TTS로 바꿔서 생성해주세요.';
    }
    if (/elevenlabs_tts_failed::429|quota|rate.?limit/i.test(msg)) {
      return en ? 'ElevenLabs quota or rate limit exceeded. Try again later or switch to Gemini TTS.'
                : 'ElevenLabs 사용량·호출 제한에 걸렸어요. 잠시 후 다시 시도하거나 Gemini TTS로 바꿔주세요.';
    }
    if (/ELEVENLABS_API_KEY not configured/i.test(msg)) {
      return en ? 'ELEVENLABS_API_KEY is not configured on the server.' : '서버에 ELEVENLABS_API_KEY가 설정되어 있지 않아요.';
    }
    if (/TTS_GOOGLE_CLIENT_EMAIL|TTS_GOOGLE_PRIVATE_KEY/i.test(msg)) {
      return en ? 'Google TTS credentials are not configured on the server.' : '서버에 Google TTS 자격증명이 설정되어 있지 않아요.';
    }
    if (/gemini_tts_failed::40[13]|PERMISSION_DENIED/i.test(msg)) {
      return en ? 'Gemini TTS permission denied. Grant the service account roles/aiplatform.user.'
                : 'Gemini TTS 권한이 없어요. 서비스 계정에 roles/aiplatform.user 권한을 부여해주세요.';
    }
    return msg.slice(0, 300);
  }

  // 속도를 바꿔도 음정이 흔들리지 않도록 preservesPitch를 켠다.
  function applyPlaybackRate(audio) {
    try {
      audio.playbackRate = state.speed;
      audio.preservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.webkitPreservesPitch = true;
    } catch (_) {}
  }
  function applyRateToAssetAudios() {
    if (!root) return;
    root.querySelectorAll('.snd-asset audio').forEach(applyPlaybackRate);
  }
  function playPreview(url) {
    stopPreview();
    try {
      var a = new Audio(url);
      state._previewAudio = a;
      applyPlaybackRate(a);
      a.play();
    } catch (_) {}
  }

  // 보이스 미리듣기: 서버가 보이스마다 한 번만 합성해 저장해 둔 고정 멘트 샘플을 재생한다.
  // 누를 때마다 새로 생성하지 않는다(서버 공용 캐시 + 이 탭의 메모리 캐시).
  function previewVoice(v) {
    if (!v) return;
    if (state.previewBusyId) return; // 동시 1건만
    if (!NK.api || !NK.api.soundVoicePreview) return;
    if (v._previewUrl) { state.previewLine = v._previewLine || ''; playPreview(v._previewUrl); renderPreviewControls(); return; }

    state.previewBusyId = String(v.id);
    renderPreviewControls();
    refreshModalIfOpen();
    NK.api.soundVoicePreview({
      provider: v.provider === 'gemini' ? 'gemini' : 'elevenlabs',
      voice: v.providerVoiceId || v.name || ''
    }).then(function (res) {
      state.previewBusyId = '';
      if (res && res.url) {
        v._previewUrl = res.url;
        v._previewLine = res.line || '';
        state.previewLine = v._previewLine;
        playPreview(res.url);
      }
      renderPreviewControls();
      refreshModalIfOpen();
    }).catch(function (err) {
      state.previewBusyId = '';
      renderPreviewControls();
      refreshModalIfOpen();
      alert((state.lang === 'en' ? 'Preview failed: ' : '미리듣기 실패: ') + explainError(err));
    });
  }
  // 설정 패널의 미리듣기 버튼·멘트만 다시 그린다(전체 render는 모달을 닫으므로 사용 안 함).
  function renderPreviewControls() {
    if (!root || state.modalOpen || state.tab !== 'voice') return;
    var panel = root.querySelector('.snd-gen-panel');
    if (!panel) return;
    var oldField = panel.querySelector('.snd-field');
    if (!oldField) return;
    panel.replaceChild(renderVoiceField(), oldField);
  }
  // 모달이 열려 있으면 보이스 그리드만 다시 그린다(전체 render는 모달을 닫으므로 사용 안 함).
  function refreshModalIfOpen() {
    if (!state.modalOpen || !root) return;
    var modal = root.querySelector('.snd-modal');
    if (modal) refreshModalBody(modal);
  }
  function toggleFavorite(v, btn) {
    var next = !v.favorite;
    v.favorite = next;
    btn.classList.toggle('is-fav', next);
    btn.textContent = next ? '★' : '☆';
    if (NK.api && NK.api.voicePatch && String(v.id).indexOf('seed-') !== 0) {
      NK.api.voicePatch(v.id, { favorite: next }).catch(function () {});
    }
  }
  function selectVoice(v) {
    if (state.modalSegmentId) {
      var seg = segById(state.modalSegmentId);
      if (seg) { assignVoiceToSegment(seg, v); saveSegments(); }
    } else {
      state.defaultVoice = v;
      // also apply to segments without a voice
      state.segments.forEach(function (s) { if (!s.voiceId) assignVoiceToSegment(s, v); });
      saveSegments();
    }
    closeVoiceModal();
  }

  // ─── Scene import (project mode) ──────────────────────────
  function importSceneLines() {
    var proj = state.currentProject;
    var lines = [];
    try {
      var payload = (proj && proj.payload) || {};
      var scenes = payload.scenes || (payload.scenario && payload.scenario.scenes) || [];
      (scenes || []).forEach(function (sc) {
        var beats = sc.beats || sc.shots || [];
        beats.forEach(function (b) {
          var txt = String(b.dialogue || b.line || b.narration || b.text || '').trim();
          if (txt) lines.push({ speaker: String(b.speaker || b.character || '').trim(), text: txt });
        });
      });
    } catch (_) {}
    if (!lines.length) {
      alert(state.lang === 'en' ? 'No scene dialogue found in this episode.' : '이 에피소드에서 불러올 씬 대사를 찾지 못했어요.');
      return;
    }
    lines.forEach(function (ln) {
      var seg = { id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: ln.text };
      // 화자 이름으로 보이스 자동 배정 (이름 매칭)
      var match = state.voices.find(function (v) { return ln.speaker && v.name === ln.speaker; });
      if (match) assignVoiceToSegment(seg, match);
      else if (state.defaultVoice) assignVoiceToSegment(seg, state.defaultVoice);
      state.segments.push(seg);
    });
    saveSegments();
    render();
  }

  // ─── Generate ─────────────────────────────────────────────
  function generateVoice() {
    var valid = state.segments.filter(function (s) { return (s.text || '').trim(); });
    if (!valid.length) { alert(t('no_text')); return; }
    state.generating = true;
    render();

    var localId = genId('asset');
    var preview = valid.map(function (s) { return s.text; }).join('\n').slice(0, 60);
    var pending = { id: localId, _local: true, type: 'voice', status: 'processing', title: preview, model: state.model, outputUrl: '' };
    state.assets.unshift(pending);
    render();

    var payload = {
      mode: isProjectMode() ? 'project' : 'instance',
      model: state.model,
      format: state.format,
      stability: state.stability,
      direction: isGeminiModel() ? state.direction : '',
      segments: valid.map(function (s) { return { voiceId: s.voiceId || '', providerVoiceId: s.providerVoiceId || '', text: s.text, speaker: s.voiceName || '', direction: isGeminiModel() ? (s.direction || '') : '' }; })
    };
    if (isProjectMode()) { payload.brandId = brandId(); payload.episodeId = episodeId(); }
    else { payload.sessionId = state.sessionId; }

    NK.api.soundVoiceGenerate(payload).then(function (res) {
      state.generating = false;
      // replace pending with result
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      state.assets.unshift({ id: res.assetId || localId, type: 'voice', status: 'ready', title: preview, model: res.engine || state.model, outputUrl: res.outputUrl, outputFormat: res.format || state.format, durationSeconds: res.durationSeconds || null, creditsUsed: res.creditsUsed });
      render();
      loadAssets();
    }).catch(function (err) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      render();
      alert((state.lang === 'en' ? 'Generation failed: ' : '생성 실패: ') + explainError(err));
    });
  }

  function generateSfx() {
    var prompt = (state.sfxPrompt || '').trim();
    if (state.sfxCategory && prompt.toLowerCase().indexOf(state.sfxCategory.toLowerCase()) === -1) {
      prompt = state.sfxCategory + ': ' + prompt;
    }
    if (!prompt) { alert(t('no_prompt')); return; }
    state.generating = true;
    render();

    var localId = genId('asset');
    var pending = { id: localId, _local: true, type: 'sfx', status: 'processing', title: prompt.slice(0, 60), outputUrl: '' };
    state.assets.unshift(pending);
    render();

    var payload = {
      mode: isProjectMode() ? 'project' : 'instance',
      prompt: prompt,
      duration: state.sfxDuration,
      looping: state.sfxLooping,
      influence: state.sfxInfluence
    };
    if (isProjectMode()) { payload.brandId = brandId(); payload.episodeId = episodeId(); }
    else { payload.sessionId = state.sessionId; }

    NK.api.soundSfxGenerate(payload).then(function (res) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      state.assets.unshift({ id: res.assetId || localId, type: 'sfx', status: 'ready', title: prompt.slice(0, 60), durationSeconds: state.sfxDuration, outputUrl: res.outputUrl, creditsUsed: res.creditsUsed });
      render();
      loadAssets();
    }).catch(function (err) {
      state.generating = false;
      state.assets = state.assets.filter(function (a) { return a.id !== localId; });
      render();
      alert((state.lang === 'en' ? 'Generation failed: ' : '생성 실패: ') + explainError(err));
    });
  }

  function detectLang() {
    try {
      var l = String(localStorage.getItem('nk_lang') || 'ko').toLowerCase();
      state.lang = (l === 'en') ? 'en' : 'ko';
    } catch (_) { state.lang = 'ko'; }
  }

  // ─── Mount ────────────────────────────────────────────────
  snd.mount = function (container) {
    root = container;
    var det = false, pid = '', tabParam = '';
    try {
      var urlParams = new URLSearchParams(window.location.search);
      pid = (urlParams.get('projectId') || '').trim();
      det = urlParams.get('detached') === '1';
      tabParam = String(urlParams.get('tab') || '').trim().toLowerCase();
      state.projectId = (pid && !det) ? pid : '';
    } catch (_) {}
    state.sessionId = ensureSessionId();
    state.currentProject = readCurrentProject();
    state.currentBrand = readCurrentBrand();
    detectLang();
    loadSegments();
    loadDirection();
    if (!state.segments.length) state.segments = [{ id: genId(), voiceId: '', providerVoiceId: '', voiceName: '', voiceInitial: '?', text: '' }];

    // 초기 뷰 결정(다른 앱과 동일 — 파라미터 없이 진입하면 무조건 대시보드가 첫 화면):
    //  ?projectId → 프로젝트 스튜디오 / ?detached·?tab → 단독 스튜디오 / 그 외 → 대시보드
    if (state.projectId) {
      state.view = 'studio';
      state.tab = (tabParam === 'sfx') ? 'sfx' : 'voice';
    } else if (det || tabParam) {
      state.view = 'studio';
      state.tab = (tabParam === 'sfx') ? 'sfx' : 'voice';
      state.currentProject = null; state.currentBrand = null;
    } else {
      state.view = 'dashboard';
      state.currentProject = null; state.currentBrand = null;
    }

    render();
    loadVoices();
    loadAssets();

    // 사이드바 nav(대시보드/VOICE/SFX) → 뷰 전환
    try {
      document.querySelectorAll('.sidebar [data-snd-view]').forEach(function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); snd.setView(a.getAttribute('data-snd-view')); });
      });
    } catch (_) {}

    window.addEventListener('message', function (evt) {
      try {
        var data = evt.data || {};
        if (data.type === 'lang-apply' && (data.lang === 'en' || data.lang === 'ko')) { state.lang = data.lang; render(); }
      } catch (_) {}
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.modalOpen) closeVoiceModal(); });
  };

})();
