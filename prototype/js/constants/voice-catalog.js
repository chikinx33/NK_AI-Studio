// 보이스 카탈로그(Gemini 프리셋 + 여아·남아·캐릭터 보이스) — 사운드 스튜디오와 IP 라이브러리 보이스 선택이 같이 쓴다.
;(function () {
  var NK = window.NK || (window.NK = {});
  var constants = NK.constants || (NK.constants = {});

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

  constants.voiceCatalog = {
    GEMINI_VOICES: GEMINI_VOICES,
    CHARACTER_VOICES: CHARACTER_VOICES,
    VOICE_CATEGORIES: VOICE_CATEGORIES
  };
})();
