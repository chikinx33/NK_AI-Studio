// prototype/functions/api/_shared/overview-options.js
// 프리프로덕션 개요에서 고를 수 있는 값의 단일 출처.
//
// 예전엔 이 목록이 브라우저(prototype/core.js · js/ui/scenario.js)에만 있어서, 직원(에이전트)과
// 제작 캔버스는 무엇을 고를 수 있는지 몰랐다. 모르면 지어내고, 지어내면 폼과 값이 갈린다.
// 브라우저 쪽 목록과 어긋나지 않도록 테스트(scenario-overview-options)가 두 벌을 맞대어 본다.

export const PURPOSE_CATEGORIES = {
  '키즈 · 영유아': ['유아 교육', '키즈 놀이', '키즈 학습', '동요', '율동', '동화'],
  '스토리 · 서사': ['동화', '창작', '에피소드', '세계관', '판타지', '힐링'],
  '지식 · 교양': ['상식', '과학', '수학', '역사', '인문학', '철학', '심리', '시사'],
  '교육 · 학습': ['공부법', '시험 대비', '자격증', '언어 학습', '코딩', '튜토리얼'],
  '음식 · 요리': ['레시피', '먹방', '맛집 소개', '요리 과정', '음식 리뷰', '홈쿡'],
  '여행 · 관광': ['국내 여행', '해외 여행', '관광지 소개', '숨은 명소', '랜선 여행'],
  '라이프 · 일상': ['브이로그', '일상 기록', '루틴', '자취', '육아', '직장 생활'],
  '리뷰 · 추천': ['제품', '서비스', '콘텐츠 추천', '앱', '게임', '책', '영화'],
  '엔터테인먼트': ['코미디', '패러디', '챌린지', '리액션', '밈 콘텐츠'],
  '게임': ['게임 플레이', '공략', '하이라이트', '게임 리뷰', '모바일 게임'],
  '음악 · 사운드': ['음악 소개', 'BGM', '커버', 'ASMR', '사운드 콘텐츠'],
  '스포츠 · 피트니스': ['운동 루틴', '스트레칭', '홈트레이닝', '스포츠 해설', '경기 요약'],
  '취미 · 크리에이티브': ['그림', 'DIY', '공예', '디자인', '글쓰기', '사진'],
  '비즈니스 · 경제': ['창업', '재테크', '경제 상식', '마케팅', '브랜딩'],
  '테크 · IT': ['AI', '신기술', '앱 소개', '기기 리뷰', '생산성 툴'],
  '힐링 · 감성': ['명상', '위로', '힐링 영상', '감성 브이로그', '자연 풍경'],
  '종교 · 신앙': ['말씀 묵상', '설교 요약', '신앙 이야기', '간증', '기도'],
  '사회 · 공감': ['인터뷰', '다큐형 콘텐츠', '사회 이슈', '공감 토크'],
};

export const NEEDS_LIST = [
  '학습', '놀이', '엔터테인먼트', '스토리', '힐링', '생활 정보', '자기계발', '커리어',
  '재테크', '시사', '건강', '여가', '가정', '라이프스타일', '광고',
];

export const TONE_LIST = [
  '차분', '진지', '유머', '공감', '전문', '친근', '설득', '중립', '풍자', '스토리',
];

export const STYLE_LIST = [
  '실사', '애니메이션(2D)', '애니메이션(3D)', '일러스트', '모션그래픽', '인포그래픽',
  '클레이(스톱모션)', '스케치', '시네마틱',
];

export const TARGET_OPTIONS = [
  { value: '영유아', ko: '영유아 · 학습/놀이/감성 발달', en: 'Infants · learning/play/emotional development' },
  { value: '아동', ko: '아동 · 기초 학습/호기심/놀이/이야기', en: 'Children · basic learning/curiosity/play/stories' },
  { value: '청소년', ko: '청소년 · 학습/시험/자기 정체성/엔터테인먼트', en: 'Teens · study/exams/identity/entertainment' },
  { value: '청년', ko: '청년 · 엔터테인먼트/감성/힐링/정보/자기계발', en: 'Young adults · entertainment/emotion/healing/info/self-growth' },
  { value: '직장인', ko: '직장인 · 업무 효율/실용 정보/자기계발/스트레스 해소', en: 'Office workers · productivity/practical info/self-growth/stress relief' },
  { value: '중장년', ko: '중장년 · 생활 정보/가정/경제/건강/취미/노후 설계', en: 'Middle-aged adults · life info/family/economy/health/hobbies/retirement planning' },
  { value: '시니어', ko: '시니어 · 건강/여가/힐링/회고/정치', en: 'Seniors · health/leisure/healing/reflection/current affairs' },
  { value: '전 연령', ko: '전 연령 · 공감/정보/엔터테인먼트', en: 'All ages · empathy/info/entertainment' },
];

export const DURATION_OPTIONS = [
  { value: '15', ko: '15초', en: '15s' },
  { value: '30', ko: '30초', en: '30s' },
  { value: '45', ko: '45초', en: '45s' },
  { value: '60', ko: '1분', en: '1m' },
  { value: '1800', ko: '30분', en: '30m' },
  { value: '3600', ko: '1시간', en: '1h' },
  { value: '7200', ko: '2시간', en: '2h' },
];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

// 폼의 '음성 모드'. 시나리오 도구의 voiceMode 와 같은 값이다.
export const VOICE_MODES = [
  { value: 'none', ko: '없음', en: 'None' },
  { value: 'narration', ko: '나레이션', en: 'Narration' },
  { value: 'dubbing', ko: '더빙', en: 'Dubbing' },
];

/** 개요 선택지 전부. API 응답과 프롬프트가 같은 것을 본다. */
export function overviewOptions() {
  return {
    purposeCategories: PURPOSE_CATEGORIES,
    needs: NEEDS_LIST,
    tones: TONE_LIST,
    styles: STYLE_LIST,
    targets: TARGET_OPTIONS,
    durations: DURATION_OPTIONS,
    aspectRatios: ASPECT_RATIOS,
    voiceModes: VOICE_MODES,
  };
}

const normalize = (value) => String(value || '').normalize('NFC').trim();

/**
 * 준 값이 고를 수 있는 값인지 본다. 맞으면 정규화한 값을, 아니면 빈 문자열을 준다.
 * 직원이 비슷한 말을 지어내도 폼과 같은 값만 저장되게 하는 문지기.
 */
export function matchOption(list, value) {
  const wanted = normalize(value).toLocaleLowerCase('ko-KR');
  if (!wanted) return '';
  const values = list.map((item) => (typeof item === 'string' ? item : item.value));
  const exact = values.find((item) => normalize(item).toLocaleLowerCase('ko-KR') === wanted);
  return exact || '';
}

/** 장르(대분류) 안에서 세부 장르를 고른다. 장르를 모르면 전체에서 찾는다. */
export function matchSubgenre(category, value) {
  const inCategory = PURPOSE_CATEGORIES[normalize(category)] || [];
  return matchOption(inCategory, value)
    || matchOption(Object.values(PURPOSE_CATEGORIES).flat(), value);
}
