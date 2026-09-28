;(function () {
  var NK = window.NK || (window.NK = {});
  var vgen = NK.uiVideoGen || (NK.uiVideoGen = {});

  // ⚠️ caps 는 **공급자 API 스키마**를 따른다. 여기가 틀리면 UI 가 못 쓰는 옵션을 열어 주고,
  // 모델 가이드까지 거짓 정보를 싣는다(v3.1588 에서 실제로 그런 일이 있었다).
  // 2026-08-30 Atlas Cloud 스키마로 재확인.
  var ALL_MODELS = [
    { id: 'veo',          label: 'Veo 3.1 Fast',          t2v: true,  i2v: true,  caps: ['start'] },
    { id: 'veo-full',     label: 'Veo 3.1 Full',          t2v: true,  i2v: true,  caps: ['start', 'audio'] },
    { id: 'grok',         label: 'Grok Imagine',           t2v: true,  i2v: true,  caps: ['start'] },
    { id: 'grok-r2v',    label: 'Grok R2V',               t2v: false, i2v: true,  caps: ['refs'], maxRefs: 7 },
    { id: 'grok-extend',  label: 'Grok Extend',            t2v: false, i2v: true,  caps: ['video'] },
    { id: 'kling-final',  label: 'Kling Final (v2.6 Pro)', t2v: false, i2v: true,  caps: ['start', 'camera'] },
    { id: 'seedance',     label: 'Seedance 2.0',           t2v: false, i2v: true,  caps: ['start'] },
    { id: 'seedance-r2v', label: 'Seedance 2.0 Reference', t2v: false, i2v: true,  caps: ['refs', 'audio', 'video'], maxRefs: 9 },
    { id: 'seedance-2.5', label: 'Seedance 2.5 Reference', t2v: false, i2v: true,  caps: ['refs', 'audio', 'video'], maxRefs: 30 },
    // wan-2.7/image-to-video 는 image·last_image 만 받는다. refs 는 별도 엔드포인트(reference-to-video)라
    // 시작 이미지와 함께 쓸 수 없다 → 여기서 refs 를 빼야 죽은 옵션이 UI 에 뜨지 않는다.
    { id: 'wan',          label: 'Wan 2.7',                t2v: true,  i2v: true,  caps: ['start', 'end', 'audio'] },
    // vidu 는 images 배열 하나뿐이다. 씬 이미지도 그 배열의 한 칸으로 들어가므로
    // '시작 프레임' 이 보장되지 않는다 → start 를 빼고 refs 만 남긴다.
    { id: 'vidu-q3',      label: 'Vidu Q3-Mix',            t2v: false, i2v: true,  caps: ['refs', 'audio'], maxRefs: 4 },
    // MiniMax H3 계열(2026-09-28 Atlas 스키마). 엔드포인트가 방식별로 따로 있고 입력이 겹치지 않는다:
    //   image-to-video = image·end_image 만(참조 없음), reference-to-video = refers 만(시작·끝 프레임 없음).
    // 그래서 r2v:true 모델은 탭을 셋으로 나눠 탭마다 그 엔드포인트가 받는 슬롯만 보인다(modeAllows).
    // refers 상한 12 를 참조 영상·오디오와 나눠 쓰므로 이미지 슬롯은 10 칸.
    // Max·Max Turbo 는 참조→영상 엔드포인트가 없다 → refs/audio/video 를 빼야 죽은 옵션이 뜨지 않는다.
    { id: 'minimax-h3',           label: 'MiniMax H3',           t2v: true, i2v: true, r2v: true, caps: ['start', 'end', 'refs', 'audio', 'video'], maxRefs: 10 },
    { id: 'minimax-h3-max',       label: 'MiniMax H3 Max',       t2v: true, i2v: true, caps: ['start', 'end'] },
    { id: 'minimax-h3-max-turbo', label: 'MiniMax H3 Max Turbo', t2v: true, i2v: true, caps: ['start', 'end'] },
    { id: 'minimax-h3-fast',      label: 'MiniMax H3 Fast',      t2v: true, i2v: true, r2v: true, caps: ['start', 'end', 'refs', 'audio', 'video'], maxRefs: 10 },
    { id: 'minimax-h3-dev',       label: 'MiniMax H3 Developer', t2v: true, i2v: true, r2v: true, caps: ['start', 'end', 'refs', 'audio', 'video'], maxRefs: 10 },
    // 모션 컨트롤(Kling 3.0, 2026-09-28 Atlas 스키마): 캐릭터 이미지(start 슬롯) + 동작 영상(video 슬롯)만 받는다.
    // 길이·화면비 파라미터가 없다 — 결과 길이는 동작 영상, 화면비는 입력을 따른다. Motion Control 탭에서만 고른다.
    { id: 'kling-motion-pro', label: 'Kling 3.0 Pro Motion Control', t2v: false, i2v: false, motion: true, caps: ['start', 'video'] },
    { id: 'kling-motion-std', label: 'Kling 3.0 Std Motion Control', t2v: false, i2v: false, motion: true, caps: ['start', 'video'] }
  ];

  // ⚠️ functions/api/_shared/motion-control.js 의 KLING_MOTION_MODELS·MOTION_SPEC 미러다(테스트가 일치 검사).
  var MOTION_USD_PER_SEC = { 'kling-motion-pro': 0.143, 'kling-motion-std': 0.107 };
  var MOTION_SPEC = {
    maxBytes:   10 * 1024 * 1024,
    minSeconds: 3,
    maxSeconds: { video: 30, image: 10 },
    videoMimes: ['video/mp4', 'video/quicktime']
  };

  var ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3'];

  // ⚠️ functions/api/_shared/video-specs.ts 의 SEEDANCE_RESOLUTIONS 미러다.
  // 정식 Seedance 2.0 두 모델은 동일한 해상도 집합을 받는다.
  var SEEDANCE_RESOLUTIONS = ['480p', '720p', '720p-SR', '1080p', '1080p-SR', '1440p-SR', '4k'];
  var DEFAULT_SEEDANCE_RESOLUTION = '720p';
  var SEEDANCE_RESOLUTION_LABELS = {
    '480p': '480p',
    '720p': '720p · HD',
    '720p-SR': '720p · SR',
    '1080p': '1080p · FHD',
    '1080p-SR': '1080p · FHD SR',
    '1440p-SR': '1440p · QHD SR',
    '4k': '4K · UHD'
  };

  // ⚠️ functions/api/_shared/video-specs.ts 의 MINIMAX_MODELS 미러다(모드별 공급자 해상도).
  // i2v 탭 목록은 이미지→영상·참조→영상 공통(두 엔드포인트의 집합이 같다).
  var MINIMAX_RESOLUTIONS = {
    'minimax-h3':           { t2v: ['480P', '768P', '2K'], i2v: ['480P', '768P', '2K', '1080p-esr', '1440p-esr', '4k-esr'], def: '768P' },
    'minimax-h3-max':       { t2v: ['480P', '768P', '1440p-sr', '4k-sr'], i2v: ['480P', '768P', '1440p-sr', '4k-sr'], def: '768P' },
    'minimax-h3-max-turbo': { t2v: ['480P', '768P'], i2v: ['480P', '768P'], def: '768P' },
    'minimax-h3-fast':      { t2v: ['480P'], i2v: ['480P'], def: '480P' },
    'minimax-h3-dev':       { t2v: ['480P', '768P', '1440p-sr', '4k-sr'], i2v: ['480P', '768P', '1440p-sr', '4k-sr'], def: '768P' }
  };
  var MINIMAX_RESOLUTION_LABELS = {
    '480P': '480P', '768P': '768P', '2K': '2K · 1440p',
    '1080p-esr': '1080p · ESR', '1440p-esr': '1440p · ESR', '4k-esr': '4K · ESR',
    '1440p-sr': '1440p · SR', '4k-sr': '4K · SR'
  };
  // 텍스트→영상·참조→영상이 받는 화면비(video-specs.ts MINIMAX_ASPECT_RATIOS 미러). 이미지→영상은 입력 이미지를 따른다.
  var MINIMAX_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
  // Atlas 정가(2026-09-28, 초당 USD).
  var MINIMAX_USD_PER_SEC = { 'minimax-h3': 0.038, 'minimax-h3-max': 0.048, 'minimax-h3-max-turbo': 0.024, 'minimax-h3-fast': 0.044, 'minimax-h3-dev': 0.015 };

  var CAMERA_MOVEMENTS = [
    { id: '',           ko: '없음',       en: 'None'       },
    { id: 'zoom_in',    ko: '줌 인',      en: 'Zoom In'    },
    { id: 'zoom_out',   ko: '줌 아웃',    en: 'Zoom Out'   },
    { id: 'pan_left',   ko: '패닝 왼쪽',  en: 'Pan Left'   },
    { id: 'pan_right',  ko: '패닝 오른쪽', en: 'Pan Right'  },
    { id: 'tilt_up',    ko: '틸트 업',    en: 'Tilt Up'    },
    { id: 'tilt_down',  ko: '틸트 다운',  en: 'Tilt Down'  },
    { id: 'rotate',     ko: '회전',       en: 'Rotate'     }
  ];

  // ⚠️ functions/api/_shared/video-specs.ts 의 MODEL_DURATION_CHOICES 미러다.
  // 여기 값은 서버 허용 집합(MODEL_DURATIONS)의 부분집합이어야 한다.
  // (예전엔 Veo 에서 5초를 고를 수 있었지만 서버가 조용히 4초로 스냅했다.)
  // 값을 바꿀 땐 video-specs.ts 를 먼저 고칠 것 — tests/video-duration-spec.test.mjs 가 검사한다.
  var DURATIONS_VEO      = [4, 6, 8];
  var DURATIONS_KLING    = [5, 10];
  var CHOICES_SEEDANCE   = [4, 5, 6, 8, 10, 15];  // 서버 허용은 4~15 전체, 드롭다운은 이 값만
  var CHOICES_SEEDANCE_25 = [4, 5, 6, 8, 10, 15, 20, 30];  // Seedance 2.5: 서버 허용 4~30
  var DURATIONS_VIDU     = [4, 5, 6, 8, 10];
  var CHOICES_MINIMAX    = [4, 5, 6, 8, 10, 12, 15];  // MiniMax H3·Developer: 서버 허용 4~15
  var CHOICES_MINIMAXFIVE = [5, 6, 8, 10, 12, 15];    // MiniMax Max·Max Turbo·Fast: 서버 허용 5~15

  var MODEL_DURATION_CHOICES = {
    'veo':          DURATIONS_VEO,
    'veo-full':     DURATIONS_VEO,
    'grok':         DURATIONS_VEO,
    'grok-r2v':     DURATIONS_VEO,
    'grok-extend':  DURATIONS_VEO,
    'kling':        DURATIONS_KLING,
    'kling-draft':  DURATIONS_KLING,
    'kling-final':  DURATIONS_KLING,
    'seedance':     CHOICES_SEEDANCE,
    'seedance-r2v': CHOICES_SEEDANCE,
    'seedance-2.5': CHOICES_SEEDANCE_25,
    'wan':          CHOICES_SEEDANCE,
    'vidu-q3':      DURATIONS_VIDU,
    'minimax-h3':           CHOICES_MINIMAX,
    'minimax-h3-dev':       CHOICES_MINIMAX,
    'minimax-h3-max':       CHOICES_MINIMAXFIVE,
    'minimax-h3-max-turbo': CHOICES_MINIMAXFIVE,
    'minimax-h3-fast':      CHOICES_MINIMAXFIVE
  };

  var MODEL_DESCS = {
    ko: {
      'veo':          '시작 프레임 선택적. 구글 자체 모델, 1080p 고품질 사실적 영상.',
      'veo-full':     '구글 최고품질 + 네이티브 오디오. Fast 대비 2배 성능, 음향 포함 영상 생성.',
      'grok':         'xAI 모델. 창의적·스타일리시 영상. 텍스트/이미지 모두 지원, 720p.',
      'grok-r2v':     '레퍼런스 이미지 기반 영상 생성. 인물·스타일 일관성 유지. 시작 프레임 고정 없이 참조로만 영향. 720p.',
      'grok-extend':  'Grok 영상을 마지막 프레임에서 자연스럽게 연장. 기존 영상 업로드 → 이어지는 장면 생성. 720p.',
      'kling-final':  '1080p FHD 고화질. 시작 프레임과 프롬프트 기반 카메라 무브먼트를 지원합니다.',
      'seedance':     'ByteDance 모델. 자연스러운 움직임, 최대 15초 영상 지원.',
      'wan':          '시작+끝 프레임과 오디오 입력을 지원합니다. 레퍼런스 이미지는 이 모드에서 지원하지 않습니다.',
      'seedance-r2v': '최대 9장 레퍼런스와 오디오·영상 입력으로 일관성, 편집, 연장을 다룹니다.',
      'seedance-2.5': '최대 30장 참조 이미지·10개 참조 영상, 4~30초 한 테이크, 네이티브 오디오. 스틸·세트 플레이트·캐릭터 시트·직전 컷이 자동으로 참조로 붙습니다.',
      'vidu-q3':      '1~4장 레퍼런스로 인물 일관성을 유지하고 영상과 음향을 함께 생성합니다.',
      'minimax-h3':           '원본 2K(ESR 업스케일 최대 4K), 오디오 자동 생성. Text / Image(첫·끝 프레임) / Reference(이미지·영상·오디오) 세 탭으로 방식을 고릅니다.',
      'minimax-h3-max':       'H3 상위 등급. 480P/768P 원본, SR 업스케일 1440p·4K. 텍스트 또는 첫/끝 프레임으로 생성하며 참조는 받지 않습니다.',
      'minimax-h3-max-turbo': 'Max 의 빠르고 저렴한 판. 480P/768P, 텍스트 또는 첫/끝 프레임. 참조는 받지 않습니다.',
      'minimax-h3-fast':      '480P 전용 가장 빠른 등급. 텍스트·첫/끝 프레임·참조(이미지·영상·오디오)를 모두 지원합니다.',
      'minimax-h3-dev':       'H3 Developer(자체 호스팅판). 가장 저렴하며 480P/768P, SR 1440p·4K. 텍스트·첫/끝 프레임·참조를 모두 지원합니다.'
    },
    en: {
      'veo':          'Optional start frame. Google model, 1080p high-quality realistic video.',
      'veo-full':     'Top Google quality + native audio. 2× quality over Fast, audio included.',
      'grok':         'xAI model. Creative, stylized video. Supports text & image, 720p.',
      'grok-r2v':     'Reference-to-video. Maintains character/style consistency without locking the start frame. 720p.',
      'grok-extend':  'Extend a Grok video from its last frame. Upload an existing video → generate a seamless continuation. 720p.',
      'kling-final':  '1080p FHD quality. Supports a start frame and prompt-based camera movement.',
      'seedance':     'ByteDance model. Smooth motion, up to 15-second video.',
      'wan':          'Supports start/end frames and audio. Reference images are not supported in this mode.',
      'seedance-r2v': 'Use up to 9 references plus audio or video for consistency, editing, and extension.',
      'seedance-2.5': 'Up to 30 reference images and 10 reference videos, 4–30 s one-take, native audio. The still, set plate, character sheets and previous cut are attached automatically.',
      'vidu-q3':      'Uses 1–4 reference images for subject consistency and generates video with audio.',
      'minimax-h3':           'Native 2K (ESR upscale up to 4K) with generated audio. Choose Text, Image (first/last frame), or Reference (image·video·audio) with the tabs.',
      'minimax-h3-max':       'Top H3 tier. Native 480P/768P, SR upscale to 1440p·4K. Text or first/last frame; no references.',
      'minimax-h3-max-turbo': 'Faster, cheaper Max. 480P/768P, text or first/last frame; no references.',
      'minimax-h3-fast':      'Fastest 480P-only tier. Supports text, first/last frame, and references (image·video·audio).',
      'minimax-h3-dev':       'H3 Developer (self-hosted). Cheapest; 480P/768P with SR 1440p·4K. Supports text, first/last frame, and references.'
    }
  };

  // 모델 선택 안내. 기능은 ALL_MODELS/MODEL_DURATION_CHOICES 에서 읽고,
  // 여기에는 사용 목적과 과금 방식만 둔다. 금액은 공급자 공식 가격표를
  // 2026-09-03 확인한 값이며 변동될 수 있다.
  var MODEL_GUIDE = {
    ko: {
      'veo': { best: '빠른 시안 · 일반 광고 · 자연스러운 움직임', how: '텍스트만 쓰거나 시작 이미지를 넣고, 피사체 동작과 카메라 움직임을 한 문장씩 명확히 적으세요.', billing: 'Atlas Cloud · 출력 $0.08/초' },
      'veo-full': { best: '최종 납품 · 사실감 · 품질 우선 장면', how: '속도보다 디테일이 중요한 히어로 컷에 쓰세요. 텍스트 또는 시작 이미지로 생성할 수 있습니다.', billing: 'Atlas Cloud · 출력 $0.20/초' },
      'grok': { best: '스타일리시한 연출 · 아이디어 탐색 · 빠른 변주', how: '텍스트 또는 시작 이미지를 넣고 화면에서 일어나야 할 변화를 중심으로 적으세요. 앱은 720p로 생성합니다.', billing: '회원: Atlas Cloud · $0.05/초 · 마스터: xAI 직접 요율' },
      'grok-r2v': { best: '인물·제품·스타일 레퍼런스 일관성', how: '레퍼런스 이미지를 최대 7장 넣고 프롬프트에서 각 이미지의 역할을 순서대로 설명하세요. 시작 프레임은 고정되지 않습니다.', billing: '회원: Atlas Cloud · $0.05/초 · 마스터: xAI 직접 요율' },
      'grok-extend': { best: '기존 Grok 영상의 자연스러운 이어 만들기', how: '연장할 영상을 넣고, 마지막 프레임 뒤에 이어질 동작만 적으세요. 새 장면을 처음부터 만드는 용도에는 맞지 않습니다.', billing: '회원: Atlas Cloud · $0.07/초 · 마스터: xAI 직접 요율' },
      'kling-final': { best: 'FHD 디테일 · 제품·인물 클로즈업 · 카메라 제어', how: '시작 이미지가 필요합니다. 5초 또는 10초를 고르고 카메라 무브먼트를 선택하세요. 끝 프레임은 지원하지 않습니다.', billing: 'Atlas Cloud · $0.06/회' },
      'seedance': { best: '4~15초 유연한 길이 · 부드러운 동작 · 시작 구도 유지', how: '시작 이미지를 넣고, 이미지에 없는 변화만 프롬프트로 지시한 뒤 480p~4K 해상도를 고르세요. SR은 업스케일 출력입니다.', billing: 'Atlas Cloud · 720p 기준 출력 $0.112/초 · 다른 해상도는 공급자 견적 확인' },
      'seedance-r2v': { best: '여러 인물·제품 참조 · 영상 편집·연장 · 오디오 참고', how: '레퍼런스를 최대 9장 넣고 image 1, image 2처럼 순서를 지칭한 뒤 출력 해상도를 고르세요. 시작 프레임을 고정하는 모델은 아닙니다.', billing: 'Atlas Cloud · 1080p 약 48,600 출력 토큰/초 · 이미지만 $11.20/100만 토큰 · 영상 포함 $6.88/100만 토큰(입력 영상 토큰 추가, SR/4K 배율 적용)' },
      'seedance-2.5': { best: '컷 간 일관성 · 4~30초 롱테이크 · 네이티브 오디오', how: '스틸을 첫 프레임으로, 세트 플레이트·캐릭터 시트·직전 컷을 참조로 자동 첨부합니다. 프롬프트에는 행동과 카메라만 적으세요.', billing: 'Atlas Cloud · $0.134/초' },
      'wan': { best: '시작→끝 프레임 전환 · 오디오 기반 움직임', how: '시작 이미지를 넣고 필요하면 끝 이미지를 추가하세요. 이 I2V 모드에서는 별도 레퍼런스 이미지를 함께 쓸 수 없습니다.', billing: 'Atlas Cloud · 720p $0.10/초 · 최소 5초 과금' },
      'vidu-q3': { best: '1~4개 참조의 인물·제품 일관성 · 오디오 포함', how: '레퍼런스 1~4장을 넣고 각 이미지의 대상과 행동을 프롬프트에 적으세요. 첫 이미지는 시작 프레임으로 고정되지 않습니다.', billing: 'Atlas Cloud · $0.106/회' },
      'minimax-h3': { best: '저렴한 고해상도(원본 2K) · 15초 이하 컷 · 오디오 포함', how: 'Image to Video 탭은 시작·끝 프레임만, Reference to Video 탭은 참조(이미지 최대 10·영상·오디오)만 받습니다. 공급자 엔드포인트가 달라 두 입력을 함께 쓸 수 없고, 참조는 오디오만으로는 만들 수 없습니다.', billing: 'Atlas Cloud · $0.038/초' },
      'minimax-h3-max': { best: 'H3 최상위 품질 · 첫/끝 프레임 제어', how: '텍스트만 쓰거나 시작 이미지(필요하면 끝 이미지)를 넣으세요. 참조 이미지·영상·오디오는 받지 않습니다. 5~15초.', billing: 'Atlas Cloud · $0.048/초' },
      'minimax-h3-max-turbo': { best: 'Max 계열을 빠르고 싸게 · 시안', how: '텍스트 또는 시작(·끝) 이미지로 480P/768P 를 만듭니다. 참조는 받지 않습니다. 5~15초.', billing: 'Atlas Cloud · $0.024/초' },
      'minimax-h3-fast': { best: '가장 빠른 480P 시안 · 참조 일관성 테스트', how: 'H3 와 같은 세 방식(텍스트·첫/끝 프레임·참조)을 480P 로 빠르게 만듭니다. 5~15초.', billing: 'Atlas Cloud · $0.044/초' },
      'minimax-h3-dev': { best: '최저가 대량 생성 · 참조 일관성', how: 'H3 와 같은 세 방식을 지원하고 480P/768P 원본, SR 1440p·4K 를 고를 수 있습니다. 4~15초.', billing: 'Atlas Cloud · $0.015/초' },
      'kling-motion-pro': { best: '유행 춤·동작 영상을 내 캐릭터로 따라 하기 · 동작 재현 품질 우선', how: 'Motion Control 탭에서 캐릭터 이미지(JPG·PNG)와 동작 영상(MP4·MOV, 3~30초, 10MB 이하)을 넣으세요. 결과 길이는 동작 영상 길이를 따릅니다. "캐릭터 이미지 방향 유지"는 영상 10초까지만 됩니다. 프롬프트는 선택입니다.', billing: 'Atlas Cloud · $0.143/초(동작 영상 길이)' },
      'kling-motion-std': { best: '모션 컨트롤을 더 저렴하게 · 시안·테스트', how: 'Pro 와 입력이 같습니다. 캐릭터 이미지와 동작 영상을 넣고 방향 기준과 원본 소리 유지를 고르세요.', billing: 'Atlas Cloud · $0.107/초(동작 영상 길이)' }
    },
    en: {
      'veo': { best: 'Fast drafts · general ads · natural motion', how: 'Use text alone or add a start image, then describe subject and camera motion in separate, direct sentences.', billing: 'Atlas Cloud · $0.08/sec output' },
      'veo-full': { best: 'Final delivery · realism · quality-first shots', how: 'Use for hero shots where detail matters more than speed. Generate from text or a start image.', billing: 'Atlas Cloud · $0.20/sec output' },
      'grok': { best: 'Stylized direction · ideation · quick variations', how: 'Use text or a start image and focus the prompt on what should change on screen. The app outputs 720p.', billing: 'Members: Atlas Cloud · $0.05/sec · Master: direct xAI rate' },
      'grok-r2v': { best: 'Character, product, and style consistency', how: 'Add up to 7 references and explain each image role in order. This does not lock the first frame.', billing: 'Members: Atlas Cloud · $0.05/sec · Master: direct xAI rate' },
      'grok-extend': { best: 'Continue an existing Grok video', how: 'Upload the source video and describe only what should follow its last frame. It is not meant for a new scene from scratch.', billing: 'Members: Atlas Cloud · $0.07/sec · Master: direct xAI rate' },
      'kling-final': { best: 'FHD detail · close-ups · camera control', how: 'A start image is required. Choose 5 or 10 seconds and a camera move. End frames are not supported.', billing: 'Atlas Cloud · $0.06/run' },
      'seedance': { best: 'Flexible 4–15s shots · smooth motion · preserve opening composition', how: 'Add a start image, prompt only changes not already present, and choose an output from 480p to 4K. SR options are upscaled outputs.', billing: 'Atlas Cloud · $0.112/sec at 720p · check provider quote for other resolutions' },
      'seedance-r2v': { best: 'Multiple subject references · edit/extend · audio guidance', how: 'Add up to 9 references, call them image 1, image 2, and so on, then choose the output resolution. It does not lock a start frame.', billing: 'Atlas Cloud · ~48,600 output tokens/sec at 1080p · $11.20/1M image-only · $6.88/1M with video (input video tokens and SR/4K multipliers added)' },
      'seedance-2.5': { best: 'Shot-to-shot consistency · 4–30 s one-take · native audio', how: 'The still is the first frame; set plate, character sheets and the previous cut are attached as references automatically. Prompt only action and camera.', billing: 'Atlas Cloud · $0.134/sec' },
      'wan': { best: 'First-to-last frame transitions · audio-driven motion', how: 'Add a start image and optionally an end image. This I2V mode cannot combine separate reference images.', billing: 'Atlas Cloud · $0.10/sec at 720p · 5s billing minimum' },
      'vidu-q3': { best: '1–4 subject references · generated audio', how: 'Add 1–4 references and name each subject and action in the prompt. The first image is not a locked start frame.', billing: 'Atlas Cloud · $0.106/run' },
      'minimax-h3': { best: 'Affordable high resolution (native 2K) · shots up to 15 s · audio included', how: 'The Image to Video tab takes only start/end frames; the Reference to Video tab takes only references (up to 10 images, a video, audio). They are separate provider endpoints, so the two cannot be combined, and audio alone is not enough.', billing: 'Atlas Cloud · $0.038/sec' },
      'minimax-h3-max': { best: 'Top H3 quality · first/last frame control', how: 'Use text alone or add a start image (and optionally an end image). No reference images, video, or audio. 5–15 s.', billing: 'Atlas Cloud · $0.048/sec' },
      'minimax-h3-max-turbo': { best: 'Faster, cheaper Max · drafts', how: 'Text or a start (and end) image at 480P/768P. No references. 5–15 s.', billing: 'Atlas Cloud · $0.024/sec' },
      'minimax-h3-fast': { best: 'Fastest 480P drafts · reference consistency tests', how: 'Same three modes as H3 (text, first/last frame, references) at 480P. 5–15 s.', billing: 'Atlas Cloud · $0.044/sec' },
      'minimax-h3-dev': { best: 'Lowest-cost volume · reference consistency', how: 'Same three modes as H3 with native 480P/768P and SR 1440p·4K. 4–15 s.', billing: 'Atlas Cloud · $0.015/sec' },
      'kling-motion-pro': { best: 'Your character performing a trending dance or motion clip · best motion fidelity', how: 'In the Motion Control tab, add a character image (JPG/PNG) and a motion video (MP4/MOV, 3–30 s, up to 10 MB). Output length follows the motion video. "Keep the character image" orientation only works with videos up to 10 s. The prompt is optional.', billing: 'Atlas Cloud · $0.143/sec (motion video length)' },
      'kling-motion-std': { best: 'Cheaper motion control · drafts and tests', how: 'Same inputs as Pro. Add a character image and a motion video, then choose the orientation and whether to keep the original sound.', billing: 'Atlas Cloud · $0.107/sec (motion video length)' }
    }
  };

  var STORAGE_KEY         = 'nk_video_gen_results_v1';
  var STORAGE_SESSION_KEY = 'nk_video_gen_session_id';
  var MAX_RESULTS  = 50;
  var POLL_INTERVAL_MS = 4000;
  var MAX_POLL_ATTEMPTS = 120; // ~8 min (veo/grok 기본)
  // 느린 모델은 8분 안에 끝나지 않아 성공한 생성을 timeout 으로 버리는 일이 있었다.
  var MAX_POLL_ATTEMPTS_SLOW = 300; // ~20 min
  var SLOW_MODELS = ['seedance', 'seedance-r2v', 'seedance-2.5', 'wan', 'vidu-q3',
    'minimax-h3', 'minimax-h3-max', 'minimax-h3-max-turbo', 'minimax-h3-fast', 'minimax-h3-dev',
    'kling-motion-pro', 'kling-motion-std'];

  function maxPollAttemptsFor(model) {
    return SLOW_MODELS.indexOf(String(model || '')) !== -1
      ? MAX_POLL_ATTEMPTS_SLOW
      : MAX_POLL_ATTEMPTS;
  }

  var i18n = {
    ko: {
      title:             'AI 영상생성',
      tab_t2v:           'Text to Video',
      tab_i2v:           'Image to Video',
      tab_r2v:           'Reference to Video',
      tab_motion:        'Motion Control',
      motion_character:  '캐릭터 이미지',
      motion_video:      '동작 영상',
      motion_orient_label: '캐릭터 방향',
      motion_orient_video: '동작 영상 방향 따라가기 (영상 최대 30초)',
      motion_orient_image: '캐릭터 이미지 방향 유지 (영상 최대 10초)',
      motion_keep_sound: '동작 영상의 원본 소리 유지',
      motion_hint:       '영상 속 동작을 캐릭터가 따라 합니다. 결과 길이는 동작 영상 길이를 따릅니다. 캐릭터 이미지 JPG·PNG, 동작 영상 MP4·MOV 3~30초·10MB 이하.',
      motion_prompt_placeholder: '(선택) 배경·분위기·표정 등 추가로 원하는 점을 적어 주세요. 동작은 영상에서 가져옵니다.',
      motion_no_image_alert: '캐릭터 이미지를 넣어 주세요.',
      motion_no_video_alert: '동작 영상을 넣어 주세요.',
      motion_video_type_alert: '동작 영상은 MP4 또는 MOV 파일만 올릴 수 있습니다.',
      motion_video_size_alert: '동작 영상은 10MB 이하여야 합니다. (현재 %sMB)',
      motion_video_dims_alert: '동작 영상은 가로·세로 300px 이상, 비율 1:2.5~2.5:1 이어야 합니다. (현재 %s×%s)',
      motion_video_duration_alert: '동작 영상은 3~30초여야 합니다. (현재 %s초)',
      motion_duration_image_alert: '캐릭터 이미지 방향 유지는 동작 영상이 10초 이하일 때만 쓸 수 있습니다. (현재 %s초) 방향을 "동작 영상 방향 따라가기"로 바꾸거나 영상을 줄여 주세요.',
      motion_seconds:    '%s초',
      motion_length_note:'결과 길이 = 동작 영상 길이 (3~30초)',
      model_label:       '모델',
      aspect_label:      '화면비',
      duration_label:    '길이',
      resolution_label:  '출력 해상도',
      resolution_hint:   'Seedance 출력 품질 · SR은 업스케일',
      resolution_4k_hint:'4K는 3840×2160, 16:9로만 생성됩니다.',
      resolution_hint_minimax: 'ESR·SR은 업스케일 · 이미지→영상은 입력 이미지 비율을 따릅니다 · 오디오 자동 생성',
      duration_unit:     '초',
      start_frame:       '시작 프레임',
      end_frame:         '끝 프레임 (선택)',
      prompt_placeholder:'영상의 장면을 자세히 묘사해주세요...',
      camera_label:      '카메라 무브먼트',
      generate_btn:      '영상 생성',
      generating:        '생성 중...',
      credit_loading:    '크레딧 확인 중...',
      credit_ready:      '필요 {required} C · 사용 가능 {available} C',
      credit_insufficient:'크레딧 부족 · 필요 {required} C / 사용 가능 {available} C',
      credit_unavailable:'크레딧을 확인할 수 없어 생성을 시작할 수 없습니다.',
      credit_btn_loading:'크레딧 확인 중...',
      credit_btn_insufficient:'크레딧 부족',
      credit_notice_title:'크레딧 부족',
      credit_service_title:'크레딧 확인 실패',
      credit_notice:     '이 작업은 {required} C가 필요하지만 현재 {available} C를 사용할 수 있습니다.',
      results_title:     '생성 결과',
      results_empty:     '아직 생성된 영상이 없습니다.\n오른쪽 패널에서 영상을 생성해보세요.',
      status_processing: '생성 중',
      status_done:       '완료',
      status_error:      '오류',
      error_unknown:     '알 수 없는 오류',
      retry:             '다시 시도',
      image_too_large:   '이미지가 너무 큽니다. 더 작은 이미지를 사용해 주세요.',
      image_type_alert:  'PNG, JPEG, WebP 이미지만 사용할 수 있어요.',
      image_ratio_alert: '이 이미지는 가로세로 비율이 모델 지원 범위(0.4~2.5)를 벗어납니다.\n잘라내거나 다른 이미지를 사용해 주세요. (현재 %s×%s)',
      image_upscale_confirm: '이미지가 작아 %s배로 늘려야 합니다. 화질이 떨어질 수 있어요.\n계속할까요?',
      retry_no_image:    '이전 이미지는 복원되지 않습니다. 이미지를 다시 선택해 주세요.',
      retry_settings_only: '설정만 복원됩니다 — 이미지는 다시 선택해 주세요',
      badge_temp_link:   '임시 링크 · 곧 만료',
      badge_temp_link_tip: '용량이 커서 서버에 보관하지 못했습니다. 링크가 만료되기 전에 내려받아 주세요.',
      tracking_lost:     '세션 종료로 추적 실패',
      no_prompt_alert:   '프롬프트를 입력해주세요.',
      no_image_alert:    'Image to Video 모드에서는 시작 프레임 이미지가 필요합니다.',
      no_video_alert:    '이 모델은 연장할 영상을 업로드해야 합니다.',
      minimax_audio_only_alert: '오디오만으로는 만들 수 없습니다. 이미지나 영상 참조를 하나 이상 넣어 주세요.',
      no_ref_alert:      'Reference to Video 모드에서는 참조 이미지나 참조 영상이 하나 이상 필요합니다.',
      upload_image:      '이미지 업로드',
      drop_image:        '이미지를 여기에 놓으세요',
      drop_video:        '영상을 여기에 놓으세요',
      remove_image:      '제거',
      download:          '다운로드',
      delete_result:     '삭제',
      delete_all:        '전체 삭제',
      confirm_delete:    '이 영상을 서버에서 완전히 삭제합니다.\n다른 기기에서도 사라지며 되돌릴 수 없습니다. 계속할까요?',
      confirm_delete_all:'생성된 영상 전체를 서버에서 완전히 삭제합니다.\n모든 기기에서 사라지며 되돌릴 수 없습니다. 계속할까요?',
      confirm_delete_all_typed: '삭제할 영상 {n}개입니다. 정말 지우려면 "삭제" 를 입력해 주세요.',
      confirm_delete_all_word:  '삭제',
      delete_failed:     '삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      delete_failed_n:   '{n}개를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      history_loading:   '히스토리 불러오는 중...',
      server_item:       '클라우드 보관',
      refs_label:        '레퍼런스 이미지',
      audio_label:       '오디오',
      video_edit_label:  '편집할 영상',
      upload_audio:      '오디오 업로드',
      upload_video:      '영상 업로드',
      remove_audio:      '제거',
      remove_video:      '제거',
      ref_slot_label:    '레퍼런스 {n}',
      sessionLabel:      '세션',
      projectLabel:      '현재 에피소드',
      brandLabel:        '현재 브랜드',
      noProject:         '에피소드 없음',
      noBrand:           '브랜드 없음',
      noneLabel:         '없음',
      creditLabel:       '크레딧',
      creditPillValue:   '{available} C',
      creditPillReserved:' · 예약 {reserved} C',
      creditPillLoading: '확인 중',
      creditPillError:   '확인 불가'
    },
    en: {
      title:             'AI Video Gen',
      tab_t2v:           'Text to Video',
      tab_i2v:           'Image to Video',
      tab_r2v:           'Reference to Video',
      tab_motion:        'Motion Control',
      motion_character:  'Character Image',
      motion_video:      'Motion Video',
      motion_orient_label: 'Character orientation',
      motion_orient_video: 'Follow the motion video (video up to 30 s)',
      motion_orient_image: 'Keep the character image (video up to 10 s)',
      motion_keep_sound: 'Keep the original sound of the motion video',
      motion_hint:       'The character performs the motion from the video. Output length follows the motion video. Character image JPG/PNG; motion video MP4/MOV, 3–30 s, up to 10 MB.',
      motion_prompt_placeholder: '(Optional) Describe background, mood, or expression. The motion comes from the video.',
      motion_no_image_alert: 'Please add a character image.',
      motion_no_video_alert: 'Please add a motion video.',
      motion_video_type_alert: 'The motion video must be an MP4 or MOV file.',
      motion_video_size_alert: 'The motion video must be 10 MB or smaller. (Currently %s MB)',
      motion_video_dims_alert: 'The motion video must be at least 300 px on each side with a ratio between 1:2.5 and 2.5:1. (Currently %s×%s)',
      motion_video_duration_alert: 'The motion video must be 3–30 seconds long. (Currently %s s)',
      motion_duration_image_alert: 'Keeping the character image orientation only works with motion videos up to 10 seconds. (Currently %s s) Switch to "Follow the motion video" or trim the video.',
      motion_seconds:    '%s s',
      motion_length_note:'Output length = motion video length (3–30 s)',
      model_label:       'Model',
      aspect_label:      'Aspect',
      duration_label:    'Duration',
      resolution_label:  'Output resolution',
      resolution_hint:   'Seedance output quality · SR is upscaled',
      resolution_4k_hint:'4K outputs 3840×2160 in 16:9 only.',
      resolution_hint_minimax: 'ESR/SR are upscaled · Image to Video follows the input image ratio · audio is generated',
      duration_unit:     's',
      start_frame:       'Start Frame',
      end_frame:         'End Frame (optional)',
      prompt_placeholder:'Describe the scene in detail...',
      camera_label:      'Camera Movement',
      generate_btn:      'Generate',
      generating:        'Generating...',
      credit_loading:    'Checking credits...',
      credit_ready:      'Required {required} C · Available {available} C',
      credit_insufficient:'Insufficient credits · Required {required} C / Available {available} C',
      credit_unavailable:'Credits could not be checked, so generation cannot start.',
      credit_btn_loading:'Checking credits...',
      credit_btn_insufficient:'Insufficient credits',
      credit_notice_title:'Insufficient credits',
      credit_service_title:'Credit check failed',
      credit_notice:     'This job requires {required} C, but only {available} C is currently available.',
      results_title:     'Results',
      results_empty:     'No videos generated yet.\nUse the panel on the right to get started.',
      status_processing: 'Processing',
      status_done:       'Done',
      status_error:      'Error',
      error_unknown:     'Unknown error',
      retry:             'Retry',
      image_too_large:   'This image is too large. Please use a smaller one.',
      image_type_alert:  'Only PNG, JPEG, and WebP images are supported.',
      image_ratio_alert: 'This image aspect ratio is outside the supported range (0.4–2.5).\nPlease crop it or use another image. (currently %s×%s)',
      image_upscale_confirm: 'This image is small and must be upscaled %s×. Quality may suffer.\nContinue?',
      retry_no_image:    'The previous image was not restored. Please select an image again.',
      retry_settings_only: 'Settings only — please select the image again',
      badge_temp_link:   'Temporary link · expires soon',
      badge_temp_link_tip: 'This video was too large to store on the server. Please download it before the link expires.',
      tracking_lost:     'Tracking lost (session ended)',
      no_prompt_alert:   'Please enter a prompt.',
      no_image_alert:    'A start frame image is required for Image to Video mode.',
      no_video_alert:    'This model requires uploading a source video to extend.',
      minimax_audio_only_alert: 'Audio alone is not enough. Add at least one image or video reference.',
      no_ref_alert:      'Reference to Video mode needs at least one reference image or video.',
      upload_image:      'Upload Image',
      drop_image:        'Drop images here',
      drop_video:        'Drop video here',
      remove_image:      'Remove',
      download:          'Download',
      delete_result:     'Delete',
      delete_all:        'Clear All',
      confirm_delete:    'This permanently deletes the video from the server.\nIt will disappear on all your devices and cannot be undone. Continue?',
      confirm_delete_all:'This permanently deletes ALL generated videos from the server.\nThey will disappear on all your devices and cannot be undone. Continue?',
      confirm_delete_all_typed: '{n} video(s) will be deleted. Type "DELETE" to confirm.',
      confirm_delete_all_word:  'DELETE',
      delete_failed:     'Delete failed. Please try again.',
      delete_failed_n:   'Failed to delete {n} item(s). Please try again.',
      history_loading:   'Loading history...',
      server_item:       'Cloud saved',
      refs_label:        'Reference Images',
      audio_label:       'Audio',
      video_edit_label:  'Video to Edit',
      upload_audio:      'Upload Audio',
      upload_video:      'Upload Video',
      remove_audio:      'Remove',
      remove_video:      'Remove',
      ref_slot_label:    'Ref {n}',
      sessionLabel:      'Session',
      projectLabel:      'Current episode',
      brandLabel:        'Current brand',
      noProject:         'No episode',
      noBrand:           'No brand',
      noneLabel:         'None',
      creditLabel:       'Credits',
      creditPillValue:   '{available} C',
      creditPillReserved:' · {reserved} C reserved',
      creditPillLoading: 'Checking',
      creditPillError:   'Unavailable'
    }
  };

  // ─── State ────────────────────────────────────────────────

  var state = {
    mode:           't2v',
    model:          'veo',
    aspectRatio:    '16:9',
    duration:       5,
    resolution:     DEFAULT_SEEDANCE_RESOLUTION,
    prompt:         '',
    startImageUrl:  '',
    endImageUrl:    '',
    cameraMovement: '',
    audioUrl:       '',
    audioFileName:  '',
    videoUrl:       '',
    videoFileName:  '',
    // 모션 컨트롤: 동작 영상 길이(초, 브라우저가 잰 값 — 서버는 파일에서 다시 읽는다)·미리보기 URL·방향·원본 소리
    motionSeconds:     0,
    motionPreviewUrl:  '',
    motionOrientation: 'video',
    motionKeepSound:   true,
    referenceUrls:  [],
    results:        [],
    serverItems:    [],   // GCS에서 로드된 서버 항목
    deletedSet:     {},   // 삭제된 항목 tombstone (objectName → true)
    selectedId:     null,
    generating:     false,
    creditChecking: false,
    credit:         { status: 'idle', key: '', required: 0, available: 0, reserved: 0, error: '' },
    // 헤더 크레딧 현황: 견적을 새로 받는 동안(loading)에도 마지막으로 확인한 잔액을 유지한다(깜빡임 방지).
    creditBalance:  { known: false, available: 0, reserved: 0 },
    historyLoading: false,
    lang:           'ko',
    polls:          {},
    projectId:      '',   // from URL ?projectId=; empty = detached mode
    sessionId:      '',
    currentProject: null,
    currentBrand:   null
  };

  var DELETED_KEY = 'nk_video_gen_deleted_v1';

  // ─── Helpers ──────────────────────────────────────────────

  function t(key) {
    var lang = state.lang;
    return (i18n[lang] && i18n[lang][key]) || i18n.ko[key] || key;
  }

  function camLabel(c) {
    return state.lang === 'en' ? c.en : c.ko;
  }

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'textContent') { e.textContent = attrs[k]; }
        else if (k === 'innerHTML') { e.innerHTML = attrs[k]; }
        else { e.setAttribute(k, attrs[k]); }
      });
    }
    return e;
  }

  function generateId() {
    return 'vg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  }

  var _creditQuoteSeq = 0;
  var _creditEventsBound = false;

  function creditQuoteInput() {
    var referenceCount = hasCap('refs')
      ? (state.referenceUrls || []).filter(Boolean).length
      : 0;
    return {
      videoModel: state.model,
      // 모션 컨트롤은 길이를 고르지 않는다. 동작 영상 길이로 견적한다(영상 전이면 최소 3초).
      durationSeconds: isMotionModel(state.model)
        ? Math.max(MOTION_SPEC.minSeconds, Math.ceil(state.motionSeconds || 0))
        : state.duration,
      // 견적 서버는 배열 길이만 사용한다. 큰 data URL을 견적 요청에 중복 전송하지 않는다.
      referenceImages: Array(referenceCount).fill('reference'),
      aspectRatio: state.aspectRatio,
      resolution: hasResolutionChoice(state.model) ? state.resolution : ''
    };
  }

  function creditQuoteKey() {
    var input = creditQuoteInput();
    return [input.videoModel, input.durationSeconds, input.referenceImages.length, input.aspectRatio, input.resolution].join('|');
  }

  function creditIsInsufficient() {
    return state.credit.status === 'ready' && state.credit.available < state.credit.required;
  }

  function creditMessage(key) {
    return t(key)
      .replace('{required}', String(state.credit.required || 0))
      .replace('{available}', String(state.credit.available || 0));
  }

  function creditStatusText() {
    if (state.credit.status === 'ready') {
      return creditMessage(creditIsInsufficient() ? 'credit_insufficient' : 'credit_ready');
    }
    return t(state.credit.status === 'error' ? 'credit_unavailable' : 'credit_loading');
  }

  function creditButtonText() {
    if (state.generating) return t('generating');
    if (creditIsInsufficient()) return t('credit_btn_insufficient');
    if (state.credit.status !== 'ready') return t('credit_btn_loading');
    return t('generate_btn');
  }

  function creditPillText() {
    var b = state.creditBalance;
    if (!b.known) return t(state.credit.status === 'error' ? 'creditPillError' : 'creditPillLoading');
    var locale = state.lang === 'en' ? 'en-US' : 'ko-KR';
    var text = t('creditPillValue').replace('{available}', b.available.toLocaleString(locale));
    if (b.reserved > 0) text += t('creditPillReserved').replace('{reserved}', b.reserved.toLocaleString(locale));
    return text;
  }

  function updateCreditControls() {
    if (!root) return;
    if (state.credit.status === 'ready') {
      state.creditBalance = { known: true, available: state.credit.available, reserved: state.credit.reserved };
    }
    var creditPillEl = root.querySelector('#vgen-credit-pill-value');
    if (creditPillEl) creditPillEl.textContent = creditPillText();
    var statusEl = root.querySelector('#vgen-credit-status');
    var insufficient = creditIsInsufficient();
    if (statusEl) {
      statusEl.textContent = creditStatusText();
      statusEl.classList.toggle('is-loading', state.credit.status === 'idle' || state.credit.status === 'loading');
      statusEl.classList.toggle('is-insufficient', insufficient);
      statusEl.classList.toggle('is-error', state.credit.status === 'error');
      statusEl.setAttribute('role', insufficient || state.credit.status === 'error' ? 'alert' : 'status');
      statusEl.setAttribute('aria-live', insufficient || state.credit.status === 'error' ? 'assertive' : 'polite');
    }
    var button = root.querySelector('#vgen-generate-btn');
    if (button) {
      var blocked = state.generating || state.creditChecking || state.credit.status !== 'ready' || insufficient;
      button.disabled = blocked;
      button.textContent = creditButtonText();
      button.classList.toggle('is-loading', state.generating || state.creditChecking || state.credit.status === 'loading');
      button.classList.toggle('is-credit-blocked', insufficient || state.credit.status === 'error');
      button.setAttribute('aria-disabled', blocked ? 'true' : 'false');
      button.title = insufficient ? creditMessage('credit_notice') : (state.credit.status === 'error' ? t('credit_unavailable') : '');
    }
  }

  function ensureCreditQuote(force) {
    var key = creditQuoteKey();
    if (!force && state.credit.key === key && (state.credit.status === 'loading' || state.credit.status === 'ready')) {
      updateCreditControls();
      return Promise.resolve(state.credit.status === 'ready' && !creditIsInsufficient());
    }

    var seq = ++_creditQuoteSeq;
    state.credit = { status: 'loading', key: key, required: 0, available: 0, reserved: 0, error: '' };
    updateCreditControls();

    if (!(NK.api && typeof NK.api.creditQuote === 'function')) {
      state.credit.status = 'error';
      state.credit.error = 'credit_quote_unavailable';
      updateCreditControls();
      return Promise.resolve(false);
    }

    return NK.api.creditQuote('video', creditQuoteInput()).then(function (data) {
      if (seq !== _creditQuoteSeq) return false;
      var quote = data && data.quote || {};
      var summary = data && data.summary || {};
      state.credit = {
        status: 'ready',
        key: key,
        required: Math.max(0, Number(quote.credits) || 0),
        available: Math.max(0, Number(summary.available) || 0),
        reserved: Math.max(0, Number(summary.reserved) || 0),
        error: ''
      };
      updateCreditControls();
      return !creditIsInsufficient();
    }).catch(function (err) {
      if (seq !== _creditQuoteSeq) return false;
      state.credit = {
        status: 'error', key: key, required: 0, available: 0, reserved: 0,
        error: String(err && err.message || 'credit_quote_error')
      };
      updateCreditControls();
      return false;
    });
  }

  function showCreditNotice(message) {
    var title = creditIsInsufficient() ? t('credit_notice_title') : t('credit_service_title');
    var text = message || (creditIsInsufficient() ? creditMessage('credit_notice') : t('credit_unavailable'));
    if (NK.ui && NK.ui.dialog && NK.ui.dialog.alert) return NK.ui.dialog.alert(text, { title: title });
    window.alert(text);
    return Promise.resolve();
  }

  // ─── Image intake ─────────────────────────────────────────
  // 두 가지를 동시에 만족시켜야 한다.
  //  1) 원본 사진을 그대로 data URL로 보내면 Worker 가 base64 디코드 도중 죽어(1102)
  //     사유 없는 실패가 된다 → 축소·JPEG 정규화.
  //  2) 공급자(Atlas)가 변 길이 300~6000px, 종횡비 0.4~2.5 를 요구한다 → 게이트.
  // ⚠️ IMAGE_SPEC 값은 functions/api/_shared/video-specs.ts 의 미러다(테스트가 일치 검사).
  var IMAGE_SPEC = {
    minEdge:  300,
    maxEdge:  6000,
    minRatio: 0.4,
    maxRatio: 2.5,
    mimes:    ['image/jpeg', 'image/png', 'image/webp']
  };
  var IMAGE_MAX_EDGE  = 1536;                // 우리 쪽 전송 상한(공급자 상한보다 훨씬 작다)
  var IMAGE_MAX_CHARS = 4 * 1024 * 1024;     // 축소 후에도 이보다 크면 거부
  var UPSCALE_WARN_FACTOR = 2;               // 이 배율을 넘겨 늘려야 하면 사용자에게 묻는다

  function ratioOf(w, h) { return h > 0 ? (w / h) : 0; }

  // 목표 배율. 짧은 변 하한이 긴 변 상한보다 우선하고, 공급자 상한이 최종적으로 이긴다.
  function targetScale(w, h) {
    var longEdge = Math.max(w, h), shortEdge = Math.min(w, h);
    var scale = Math.min(1, IMAGE_MAX_EDGE / longEdge);
    if (shortEdge * scale < IMAGE_SPEC.minEdge) scale = IMAGE_SPEC.minEdge / shortEdge;
    if (longEdge * scale > IMAGE_SPEC.maxEdge) scale = IMAGE_SPEC.maxEdge / longEdge;
    return scale;
  }

  // 원본 그대로 보내도 되는가? (용량이 작아도 치수가 규격을 벗어나면 안 된다)
  function fitsSpecAsIs(w, h, chars) {
    var longEdge = Math.max(w, h), shortEdge = Math.min(w, h);
    return shortEdge >= IMAGE_SPEC.minEdge
      && longEdge <= Math.min(IMAGE_SPEC.maxEdge, IMAGE_MAX_EDGE)
      && chars < IMAGE_MAX_CHARS;
  }

  function downscaleImageFile(file, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var src = ev.target.result;
      var img = new Image();
      img.onload = async function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { cb(src); return; }

        // 종횡비는 축소로 해결되지 않는다 → 업로드 시점에 거부.
        var ratio = ratioOf(w, h);
        if (ratio < IMAGE_SPEC.minRatio || ratio > IMAGE_SPEC.maxRatio) {
          window.alert(t('image_ratio_alert').replace('%s', String(w)).replace('%s', String(h)));
          cb('');
          return;
        }

        // 용량이 작아도 치수가 규격을 벗어나면 통과시키지 않는다.
        if (fitsSpecAsIs(w, h, String(src || '').length)) { cb(src); return; }

        var scale = targetScale(w, h);
        if (scale > UPSCALE_WARN_FACTOR) {
          // 너무 작은 원본을 크게 늘리면 화질이 무너진다 → 진행 여부를 묻는다.
          if (!(await NK.ui.dialog.confirm(t('image_upscale_confirm').replace('%s', scale.toFixed(1)), { title: t('upload_image') || '이미지 확대' }))) {
            cb('');
            return;
          }
        }
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        var ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, cw, ch);
        try { cb(c.toDataURL('image/jpeg', 0.9)); } catch (_) { cb(src); }
      };
      img.onerror = function () { cb(src); };
      img.src = src;
    };
    reader.onerror = function () { cb(''); };
    reader.readAsDataURL(file);
  }

  // 모든 이미지 슬롯(시작/끝/레퍼런스)이 거치는 단 하나의 관문.
  // 형식 → 치수·종횡비 게이트 → 축소 → 용량 재확인을 마친 data URL만 onReady 로 넘긴다.
  function acceptImageFile(file, onReady) {
    var onRejected = arguments[2];
    var reject = typeof onRejected === 'function' ? onRejected : function () {};
    if (!file) { reject(); return; }
    if (IMAGE_SPEC.mimes.indexOf(String(file.type || '').toLowerCase()) === -1) {
      window.alert(t('image_type_alert'));
      reject();
      return;
    }
    downscaleImageFile(file, function (dataUrl) {
      if (!dataUrl) { reject(); return; } // 게이트에서 이미 안내함
      if (dataUrl.length > IMAGE_MAX_CHARS) {
        window.alert(t('image_too_large'));
        reject();
        return;
      }
      onReady(dataUrl);
    });
  }

  function prepareImageFile(file) {
    return new Promise(function (resolve) {
      acceptImageFile(file, resolve, function () { resolve(''); });
    });
  }

  function droppedImageFiles(dataTransfer) {
    return Array.prototype.slice.call((dataTransfer && dataTransfer.files) || []).filter(function (file) {
      return String(file && file.type || '').toLowerCase().indexOf('image/') === 0;
    });
  }

  function hasDraggedImage(dataTransfer) {
    var items = Array.prototype.slice.call((dataTransfer && dataTransfer.items) || []);
    if (items.length) {
      return items.some(function (item) {
        return item.kind === 'file' && String(item.type || '').toLowerCase().indexOf('image/') === 0;
      });
    }
    return droppedImageFiles(dataTransfer).length > 0;
  }

  // 모션 컨트롤 동작 영상. 형식·용량·길이 검사는 acceptMotionVideoFile 이 한다(여기선 영상 파일인지만).
  // 형식이 비어 오는 파일은 확장자로 판단한다.
  function isVideoFile(type, name) {
    var t = String(type || '').toLowerCase();
    return t.indexOf('video/') === 0 || (!t && /\.(mp4|mov)$/i.test(String(name || '')));
  }

  function droppedVideoFiles(dataTransfer) {
    return Array.prototype.slice.call((dataTransfer && dataTransfer.files) || []).filter(function (file) {
      return file && isVideoFile(file.type, file.name);
    });
  }

  function hasDraggedVideo(dataTransfer) {
    var items = Array.prototype.slice.call((dataTransfer && dataTransfer.items) || []);
    if (items.length) {
      // dragover 단계에선 파일 이름을 볼 수 없다. 형식이 빈 파일도 일단 받고 drop 에서 확장자로 거른다.
      return items.some(function (item) {
        var type = String(item.type || '').toLowerCase();
        return item.kind === 'file' && (type.indexOf('video/') === 0 || !type);
      });
    }
    return droppedVideoFiles(dataTransfer).length > 0;
  }

  function bindImageDropTarget(target, onFiles) {
    bindDropTarget(target, onFiles, hasDraggedImage, droppedImageFiles);
  }

  function bindVideoDropTarget(target, onFiles) {
    bindDropTarget(target, onFiles, hasDraggedVideo, droppedVideoFiles);
  }

  function bindDropTarget(target, onFiles, hasDragged, dropped) {
    if (!target) return;
    ['dragenter', 'dragover'].forEach(function (eventName) {
      target.addEventListener(eventName, function (event) {
        // dragover 단계에서는 브라우저가 files를 숨길 수 있어 items의 MIME을 먼저 본다.
        if (!hasDragged(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
        target.classList.add('is-dragover');
      });
    });
    target.addEventListener('dragleave', function (event) {
      if (event.relatedTarget && target.contains(event.relatedTarget)) return;
      target.classList.remove('is-dragover');
    });
    target.addEventListener('drop', function (event) {
      var files = dropped(event.dataTransfer);
      target.classList.remove('is-dragover');
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      onFiles(files);
    });
  }

  async function setReferenceImages(files, startIndex, replaceTarget) {
    var pending = Array.prototype.slice.call(files || []);
    if (!pending.length) return;
    if (!state.referenceUrls) state.referenceUrls = [];

    var max = maxRefs();
    var normalizedStart = Number.isInteger(startIndex) && startIndex >= 0 && startIndex < max
      ? startIndex
      : 0;
    var targets = [];
    if (replaceTarget && normalizedStart < max) targets.push(normalizedStart);
    for (var offset = 0; offset < max; offset++) {
      var idx = (normalizedStart + offset) % max;
      if (targets.indexOf(idx) === -1 && !state.referenceUrls[idx]) targets.push(idx);
    }

    var changed = false;
    for (var fileIndex = 0; fileIndex < pending.length && targets.length; fileIndex++) {
      var dataUrl = await prepareImageFile(pending[fileIndex]);
      if (!dataUrl) continue;
      state.referenceUrls[targets.shift()] = dataUrl;
      changed = true;
    }
    if (changed) render();
  }

  function availableModels() {
    return ALL_MODELS.filter(function (m) {
      if (state.mode === 'motion') return !!m.motion;
      if (state.mode === 'r2v') return !!m.r2v;
      return state.mode === 't2v' ? m.t2v : m.i2v;
    });
  }

  // 지금 탭에서 이 입력 슬롯을 보이고 요청에 싣는가.
  // r2v 탭이 있는 모델(MiniMax H3·Fast·Developer)은 공급자 엔드포인트가 방식별로 입력을 나눠 받는다:
  //   Image to Video = 시작·끝 프레임만, Reference to Video = 참조 이미지·영상·오디오만, Text to Video = 입력 없음.
  // 그 밖의 모델은 예전처럼 caps 만 본다.
  function modeAllows(cap) {
    if (!hasCap(cap)) return false;
    if (!currentModelObj().r2v) return true;
    if (state.mode === 'r2v') return cap === 'refs' || cap === 'audio' || cap === 'video';
    if (state.mode === 'i2v') return cap === 'start' || cap === 'end';
    return false;
  }

  function isKling() {
    return state.model === 'kling-final';
  }

  function isMotionModel(modelId) {
    var m = ALL_MODELS.find(function (x) { return x.id === modelId; });
    return !!(m && m.motion);
  }

  function formatSeconds(sec) {
    return (Math.round(Number(sec || 0) * 10) / 10).toString();
  }

  // 모션 영상을 바꾸거나 모델 계열을 옮길 때 이전 영상과 미리보기를 함께 비운다.
  function clearMotionVideo() {
    if (state.motionPreviewUrl) { try { URL.revokeObjectURL(state.motionPreviewUrl); } catch (_) {} }
    state.motionPreviewUrl = '';
    state.motionSeconds = 0;
    state.videoUrl = ''; state.videoFileName = '';
  }

  // 브라우저가 못 여는 코덱이면 길이·치수를 모른 채(null) 통과시키고, 서버가 파일에서 길이를 다시 읽어 검사한다.
  function readMotionVideoMeta(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      var settled = false;
      function done(meta) { if (settled) return; settled = true; resolve({ url: url, meta: meta }); }
      v.preload = 'metadata';
      v.muted = true;
      v.addEventListener('loadedmetadata', function () {
        done({ seconds: Number(v.duration) || 0, width: v.videoWidth || 0, height: v.videoHeight || 0 });
      });
      v.addEventListener('error', function () { done(null); });
      setTimeout(function () { done(null); }, 15000);
      v.src = url;
    });
  }

  // 공급자 규격(motion-control.js MOTION_SPEC)을 업로드 시점에 확인한다.
  function acceptMotionVideoFile(file) {
    if (!file) return;
    var name = String(file.name || '').toLowerCase();
    var mime = String(file.type || '').toLowerCase();
    if (!mime && /\.mp4$/.test(name)) mime = 'video/mp4';
    if (!mime && /\.mov$/.test(name)) mime = 'video/quicktime';
    if (MOTION_SPEC.videoMimes.indexOf(mime) === -1) { window.alert(t('motion_video_type_alert')); return; }
    if (file.size > MOTION_SPEC.maxBytes) {
      window.alert(t('motion_video_size_alert').replace('%s', (file.size / 1048576).toFixed(1)));
      return;
    }
    readMotionVideoMeta(file).then(function (res) {
      var meta = res.meta;
      if (meta) {
        var w = meta.width, h = meta.height, ratio = h > 0 ? w / h : 0;
        if (w && h && (Math.min(w, h) < 300 || ratio < 0.4 || ratio > 2.5)) {
          URL.revokeObjectURL(res.url);
          window.alert(t('motion_video_dims_alert').replace('%s', String(w)).replace('%s', String(h)));
          return;
        }
        if (meta.seconds && (meta.seconds < MOTION_SPEC.minSeconds || meta.seconds > MOTION_SPEC.maxSeconds.video + 0.05)) {
          URL.revokeObjectURL(res.url);
          window.alert(t('motion_video_duration_alert').replace('%s', formatSeconds(meta.seconds)));
          return;
        }
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        clearMotionVideo();
        // 확장자로만 형식을 알 수 있는 파일은 data URL 의 형식을 바로잡는다(서버가 형식으로 거부한다).
        state.videoUrl = String(ev.target.result || '').replace(/^data:[^;,]*/, 'data:' + mime);
        state.videoFileName = file.name;
        state.motionPreviewUrl = res.url;
        state.motionSeconds = meta ? meta.seconds : 0;
        render();
        ensureCreditQuote(false);
      };
      reader.onerror = function () { URL.revokeObjectURL(res.url); };
      reader.readAsDataURL(file);
    });
  }

  // Kling 모션 컨트롤은 캐릭터 이미지를 JPG·PNG 로만 받는다. WebP 원본은 전송 직전에 JPEG 로 바꾼다.
  function toJpegIfWebp(dataUrl) {
    if (!/^data:image\/webp/i.test(String(dataUrl || ''))) return Promise.resolve(dataUrl);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d').drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', 0.92));
        } catch (_) { resolve(dataUrl); }
      };
      img.onerror = function () { resolve(dataUrl); };
      img.src = dataUrl;
    });
  }

  function durations() {
    return MODEL_DURATION_CHOICES[state.model] || DURATIONS_VEO;
  }

  function currentModelObj() {
    return ALL_MODELS.find(function (m) { return m.id === state.model; }) || ALL_MODELS[0];
  }

  function hasCap(cap) {
    return (currentModelObj().caps || []).indexOf(cap) !== -1;
  }

  function isSeedanceModel(modelId) {
    return modelId === 'seedance' || modelId === 'seedance-r2v' || modelId === 'seedance-2.5';
  }

  function isMinimaxModel(modelId) {
    return Object.prototype.hasOwnProperty.call(MINIMAX_RESOLUTIONS, String(modelId || ''));
  }

  // 해상도 선택지가 있는 모델(요청에 resolution 을 싣는다).
  function hasResolutionChoice(modelId) {
    return isSeedanceModel(modelId) || isMinimaxModel(modelId);
  }

  function minimaxResolutionChoices(modelId) {
    var spec = MINIMAX_RESOLUTIONS[modelId];
    if (!spec) return [];
    // 이미지→영상·참조→영상은 같은 해상도 집합(spec.i2v), 텍스트→영상만 다르다.
    return state.mode === 't2v' && currentModelObj().t2v ? spec.t2v : spec.i2v;
  }

  function normalizeResolutionFor(modelId, value) {
    if (isMinimaxModel(modelId)) {
      var list = minimaxResolutionChoices(modelId);
      var raw = String(value || '').toLowerCase();
      return list.find(function (item) { return item.toLowerCase() === raw; }) || MINIMAX_RESOLUTIONS[modelId].def;
    }
    return normalizeSeedanceResolution(value);
  }

  function aspectChoices() {
    return isMinimaxModel(state.model) ? MINIMAX_ASPECT_RATIOS : ASPECT_RATIOS;
  }

  function normalizeSeedanceResolution(value) {
    var raw = String(value || '').toLowerCase();
    return SEEDANCE_RESOLUTIONS.find(function (item) { return item.toLowerCase() === raw; })
      || DEFAULT_SEEDANCE_RESOLUTION;
  }

  function resolutionLabel(value) {
    return SEEDANCE_RESOLUTION_LABELS[value] || MINIMAX_RESOLUTION_LABELS[value] || value || DEFAULT_SEEDANCE_RESOLUTION;
  }

  function maxRefs() {
    var mo = currentModelObj();
    if (mo.maxRefs) return mo.maxRefs;
    if (state.model === 'wan') return 4;
    if (state.model === 'vidu-q3') return 4;
    if (state.model === 'seedance-r2v') return 5;
    return 0;
  }

  function modeLabelsFor(model) {
    var out = [];
    if (model.t2v) out.push('T2V');
    if (model.i2v) out.push('I2V');
    if (model.r2v) out.push('R2V');
    if (model.motion) out.push('Motion');
    return out;
  }

  function guideDurationFor(modelId) {
    var choices = MODEL_DURATION_CHOICES[modelId] || DURATIONS_VEO;
    if (choices.indexOf(state.duration) !== -1) return state.duration;
    var target = Number(state.duration) || choices[0];
    return choices.reduce(function (best, value) {
      return Math.abs(value - target) < Math.abs(best - target) ? value : best;
    }, choices[0]);
  }

  function money(n) {
    return '$' + Number(n || 0).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  function currentUsageEstimate() {
    var id = state.model;
    var duration = guideDurationFor(id);
    var suffix = state.lang === 'en' ? ' estimated' : ' 예상';
    if (id === 'kling-final') return '$0.06' + suffix;
    if (id === 'vidu-q3') return '$0.106' + suffix;
    if (id === 'veo') return money(duration * 0.08) + suffix;
    if (id === 'veo-full') return money(duration * 0.20) + suffix;
    if (id === 'seedance-2.5') return money(duration * 0.134) + suffix;
    if (MINIMAX_USD_PER_SEC[id]) return money(duration * MINIMAX_USD_PER_SEC[id]) + suffix;
    if (MOTION_USD_PER_SEC[id]) {
      // 결과 길이 = 동작 영상 길이. 영상을 넣기 전에는 초당 단가만 보여 준다.
      if (state.motionSeconds > 0) return money(Math.ceil(state.motionSeconds) * MOTION_USD_PER_SEC[id]) + suffix;
      return (state.lang === 'en' ? 'Motion video length × ' : '동작 영상 길이 × ') + money(MOTION_USD_PER_SEC[id]) + (state.lang === 'en' ? '/sec' : '/초');
    }
    if (id === 'seedance') {
      if (state.resolution === '720p') return money(duration * 0.112) + suffix;
      return (state.lang === 'en' ? 'Provider quote · ' : '공급자 견적 · ') + resolutionLabel(state.resolution);
    }
    if (id === 'wan') return money(Math.max(5, duration) * 0.10) + suffix;
    if (id === 'grok' || id === 'grok-r2v' || id === 'grok-extend') {
      var base = duration * 0.07;
      if (id === 'grok' && state.startImageUrl) base += 0.002;
      if (id === 'grok-r2v') base += state.referenceUrls.filter(Boolean).length * 0.002;
      var extra = id === 'grok-extend'
        ? (state.lang === 'en' ? ' + input video' : ' + 입력 영상')
        : '';
      return money(base) + extra + suffix;
    }
    if (id === 'seedance-r2v') {
      var tokenProfiles = {
        '480p': { perSecond: 9607.5, multiplier: 1 },
        '720p': { perSecond: 21600, multiplier: 1 },
        '720p-SR': { perSecond: 21600, multiplier: 1.8 },
        '1080p': { perSecond: 48600, multiplier: 1 },
        '1080p-SR': { perSecond: 48600, multiplier: 1.8 },
        '1440p-SR': { perSecond: 86400, multiplier: 3.2 },
        '4k': { perSecond: 194400, multiplier: 0.57 }
      };
      var profile = tokenProfiles[state.resolution] || tokenProfiles[DEFAULT_SEEDANCE_RESOLUTION];
      var tokens = Math.round(profile.perSecond * duration);
      var tokenText = tokens.toLocaleString(state.lang === 'en' ? 'en-US' : 'ko-KR');
      if (state.videoUrl) {
        return state.lang === 'en'
          ? '~' + tokenText + ' output tokens + input video tokens · provider quote'
          : '약 ' + tokenText + ' 출력 토큰 + 입력 영상 토큰 · 공급자 견적';
      }
      var cost = money(tokens / 1000000 * 11.20 * profile.multiplier);
      return state.lang === 'en'
        ? '~' + tokenText + ' video tokens · ' + cost + ' estimated'
        : '약 ' + tokenText + ' 영상 토큰 · ' + cost + ' 예상';
    }
    return state.lang === 'en' ? 'See provider quote' : '공급자 견적 확인';
  }

  var _modelGuideOpener = null;

  function openModelGuide(opener) {
    closeModelGuide();
    _modelGuideOpener = opener || null;
    var lang = state.lang === 'en' ? 'en' : 'ko';
    var copy = lang === 'en' ? {
      title: 'Video model guide',
      subtitle: 'Choose by input type, desired result, and actual billing unit.',
      current: 'Current selection', best: 'Best for', how: 'How to use', usage: 'Usage / cost', close: 'Close',
      note: 'Opening this guide does not start a generation or spend credits. Video models do not all use text tokens: most bill per second or per run, while Seedance Reference uses output video tokens. Rates were checked against official provider pricing on Sep 3, 2026 and may change. Failed Atlas Cloud tasks are not charged.'
    } : {
      title: '영상 생성 모델 가이드',
      subtitle: '입력 방식, 원하는 결과, 실제 과금 단위를 비교해 모델을 고르세요.',
      current: '현재 선택', best: '추천 용도', how: '사용법', usage: '사용량 / 비용', close: '닫기',
      note: '이 안내를 여는 것만으로 생성이나 비용 차감은 발생하지 않습니다. 영상 모델은 모두 텍스트 토큰으로 차감되는 것이 아니라 대부분 초당 또는 회당 과금되며, Seedance Reference만 출력 영상 토큰을 사용합니다. 단가는 2026-09-03 공급자 공식 가격 기준이며 변동될 수 있습니다. Atlas Cloud의 실패 작업은 과금되지 않습니다.'
    };
    var modal = el('div', 'vgen-guide-modal', {
      'data-vgen-guide-modal': '1', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'vgen-guide-title'
    });
    var box = el('div', 'vgen-guide-box');
    var head = el('div', 'vgen-guide-head');
    var headCopy = el('div', 'vgen-guide-head-copy');
    headCopy.appendChild(el('h2', 'vgen-guide-title', { id: 'vgen-guide-title', textContent: copy.title }));
    headCopy.appendChild(el('p', 'vgen-guide-subtitle', { textContent: copy.subtitle }));
    head.appendChild(headCopy);
    var closeBtn = el('button', 'vgen-guide-close', { type: 'button', 'data-vgen-guide-close': '1', 'aria-label': copy.close, textContent: '×' });
    head.appendChild(closeBtn);
    box.appendChild(head);

    var current = currentModelObj();
    var currentBar = el('div', 'vgen-guide-current');
    currentBar.appendChild(el('span', 'vgen-guide-current-label', { textContent: copy.current }));
    var currentSummary = current.label + ' · ' + (current.motion
      ? (state.motionSeconds > 0 ? t('motion_seconds').replace('%s', formatSeconds(state.motionSeconds)) : t('motion_length_note'))
      : guideDurationFor(current.id) + (lang === 'en' ? 's' : '초'));
    if (hasResolutionChoice(current.id)) currentSummary += ' · ' + resolutionLabel(state.resolution);
    currentBar.appendChild(el('strong', '', { textContent: currentSummary }));
    currentBar.appendChild(el('span', 'vgen-guide-current-cost', { textContent: currentUsageEstimate() }));
    box.appendChild(currentBar);

    var grid = el('div', 'vgen-guide-grid');
    var guideSet = MODEL_GUIDE[lang] || MODEL_GUIDE.ko;
    ALL_MODELS.forEach(function (model) {
      var info = guideSet[model.id];
      if (!info) return;
      var card = el('article', 'vgen-guide-card' + (model.id === state.model ? ' is-current' : ''));
      var cardHead = el('div', 'vgen-guide-card-head');
      cardHead.appendChild(el('h3', '', { textContent: model.label }));
      var badges = el('div', 'vgen-guide-badges');
      modeLabelsFor(model).forEach(function (label) {
        badges.appendChild(el('span', 'vgen-guide-badge', { textContent: label }));
      });
      cardHead.appendChild(badges);
      card.appendChild(cardHead);
      card.appendChild(el('p', 'vgen-guide-lengths', {
        textContent: model.motion
          ? t('motion_length_note')
          : (lang === 'en' ? 'Lengths ' : '지원 길이 ') + (MODEL_DURATION_CHOICES[model.id] || DURATIONS_VEO).join('·') + (lang === 'en' ? 's' : '초')
      }));
      [[copy.best, info.best], [copy.how, info.how], [copy.usage, info.billing]].forEach(function (row) {
        var section = el('div', 'vgen-guide-card-row');
        section.appendChild(el('span', 'vgen-guide-card-label', { textContent: row[0] }));
        section.appendChild(el('p', '', { textContent: row[1] }));
        card.appendChild(section);
      });
      grid.appendChild(card);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'vgen-guide-note', { textContent: copy.note }));
    modal.appendChild(box);
    document.body.appendChild(modal);
    document.body.classList.add('vgen-guide-open');
    document.addEventListener('keydown', onModelGuideKeydown);
    closeBtn.focus();
  }

  function closeModelGuide() {
    var modal = document.querySelector('[data-vgen-guide-modal]');
    if (modal) modal.remove();
    document.body.classList.remove('vgen-guide-open');
    document.removeEventListener('keydown', onModelGuideKeydown);
    if (_modelGuideOpener && document.documentElement.contains(_modelGuideOpener)) {
      try { _modelGuideOpener.focus(); } catch (_) {}
    }
    _modelGuideOpener = null;
  }

  function onModelGuideKeydown(e) {
    if (e.key === 'Escape') closeModelGuide();
  }

  // ─── Persistence ──────────────────────────────────────────

  // 결과 목록은 컨텍스트(프로젝트 종속/비종속)별로 분리 저장한다.
  // 프로젝트를 골라 만든 영상은 그 프로젝트에서만, 비종속 영상은 비종속 화면에서만 보인다.
  function scopedResultsKey(baseKey, projectId) {
    return baseKey + ':' + (projectId ? ('p:' + projectId) : 'detached');
  }

  // 예전 단일 키에 컨텍스트 구분 없이 쌓인 결과를 GCS objectName 경로로 판별해
  // 컨텍스트별 키로 한 번만 옮긴다. (projects{pid}/videos/ ↔ videos/)
  function migrateLegacyResults(legacyKey) {
    var raw = null;
    try { raw = localStorage.getItem(legacyKey); } catch (_) { return; }
    if (!raw) return;
    var items = [];
    try { items = JSON.parse(raw) || []; } catch (_) { items = []; }
    var buckets = {};
    items.forEach(function (r) {
      if (!r) return;
      var pid = String(r.projectId || '').trim();
      if (!pid) {
        var name = String(r.videoObjectName || '');
        var m = name.match(/\/ai-video-gen\/projects([^/]+)\/videos\//);
        if (m) pid = m[1];
      }
      var key = scopedResultsKey(legacyKey, pid);
      (buckets[key] = buckets[key] || []).push(r);
    });
    try {
      Object.keys(buckets).forEach(function (key) {
        var existing = [];
        try { existing = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (_) {}
        localStorage.setItem(key, JSON.stringify(existing.concat(buckets[key]).slice(-MAX_RESULTS)));
      });
      localStorage.removeItem(legacyKey);
    } catch (_) {}
  }

  function loadResults() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.results = JSON.parse(raw) || [];
    } catch (_) { state.results = []; }
  }

  function saveResults() {
    try {
      var toSave = state.results.slice(-MAX_RESULTS).map(function (r) {
        var s = Object.assign({}, r);
        // strip large data-URLs from thumbnails to keep localStorage lean
        if (s.thumbnailDataUrl && s.thumbnailDataUrl.length > 60000) delete s.thumbnailDataUrl;
        // 만료되는 인증 토큰은 절대 영구 저장하지 않는다 (재생 시점에 새로 만든다).
        delete s.videoUrl;
        if (s.rawVideoUrl && String(s.rawVideoUrl).indexOf('nk_token=') !== -1) delete s.rawVideoUrl;
        return s;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (_) {}
  }

  // 저장된 objectName으로 "지금 이 순간"의 토큰이 붙은 재생 URL을 만든다.
  function resultPlayUrl(r) {
    if (!r) return '';
    var n = resultObjectName(r);
    if (n && NK.api && NK.api.mediaProxyObjectUrl) return NK.api.mediaProxyObjectUrl(n);
    // 미러링을 건너뛴 대용량 결과는 원본 URL이 유일한 재생 경로다.
    return /^https?:\/\//i.test(r.rawVideoUrl || '') ? r.rawVideoUrl : '';
  }

  function resultObjectName(r) {
    if (!r) return '';
    return r.videoObjectName
      || ((NK.api && NK.api.objectNameFromUrl) ? NK.api.objectNameFromUrl(r.videoUrl || r.rawVideoUrl || '') : '');
  }

  // 같은 생성 결과(resultId)의 서버 영상 묶음 키. 예전 서버는 완료 뒤 상태 조회마다 같은 영상을
  // 시각만 다른 이름으로 또 저장해, 목록에 동일한 결과가 여러 개 떴다(2026-09-17). 묶어서 한 장만 보여준다.
  function serverGroupKey(s) {
    var meta = (s && s.metadata) || {};
    if (meta.resultId) return 'r:' + String(meta.resultId);
    var fileName = String((s && s.name) || '').split('/').pop();
    var m = /(vg-\d+-[a-z0-9]+)/i.exec(fileName);
    return m ? 'r:' + m[1] : 'n:' + String((s && s.name) || '');
  }

  function serverGroupNames(key) {
    return state.serverItems
      .filter(function (s) { return serverGroupKey(s) === key; })
      .map(function (s) { return s.name; });
  }

  // 로컬 결과 ID와 GCS objectName은 서로 다른 식별자 공간이므로 서버 선택값에 접두사를 붙인다.
  // 그래야 어느 출처의 카드를 눌러도 같은 selectedId 하나로 선택 표시와 프롬프트 복원을 처리할 수 있다.
  function serverSelectionId(objectName) {
    return 'server:' + String(objectName || '');
  }

  // ─── 결과 카드의 입력 이미지 복원 ─────────────────────────
  // 결과에는 입력 이미지를 저장하지 않는다(용량·localStorage 한도). 그래서 카드를 다시 열면 프롬프트·모델은
  // 돌아와도 시작·끝·참조 이미지가 비어 있었다. 이번 세션의 재시도 스냅샷이 있으면 그것을 쓰고, 없으면
  // /api/video 가 공급자에게 넘기려고 올려 둔 원본을 결과 ID 로 찾아(api.videoGenInputs) data URL 로 되살린다.
  // data URL 로 바꿔 두어야 그대로 다시 생성해도 새로 만든 입력과 똑같은 경로(업로드·검증)를 탄다.
  var _inputRestoreSeq = 0;
  var IMAGE_EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  function storedImageToDataUrl(objectName) {
    var url = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(objectName) : '';
    if (!url) return Promise.resolve('');
    var ext = String(objectName || '').split('.').pop().toLowerCase();
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('input_fetch_failed');
      return res.blob();
    }).then(function (blob) {
      // 프록시가 octet-stream 으로 주면 서버 mime 검사(unsupported_image_mime)에 걸리므로 확장자로 바로잡는다.
      var mime = /^image\//.test(blob.type) ? blob.type : (IMAGE_EXT_MIME[ext] || 'image/png');
      var typed = blob.type === mime ? blob : new Blob([blob], { type: mime });
      return new Promise(function (resolve) {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { resolve(''); };
        fr.readAsDataURL(typed);
      });
    }).catch(function () { return ''; });
  }

  function rerenderKeepingResultsScroll() {
    var list = root && root.querySelector('.vgen-results-list');
    renderPreservingResultsScroll(list ? list.scrollTop : 0);
  }

  function restoreInputImages(resultId) {
    var seq = ++_inputRestoreSeq;
    var id = String(resultId || '');
    var snap = id && _retryInputs[id];
    if (snap) {
      state.startImageUrl = snap.startImageUrl || '';
      state.endImageUrl = snap.endImageUrl || '';
      state.referenceUrls = (snap.referenceUrls || []).slice();
      state.audioUrl = snap.audioUrl || ''; state.audioFileName = snap.audioFileName || '';
      state.videoUrl = snap.videoUrl || ''; state.videoFileName = snap.videoFileName || '';
      state.motionSeconds = snap.motionSeconds || 0;
      state.motionPreviewUrl = '';
      return;
    }
    if (!/^vg-\d+-[a-z0-9]+$/i.test(id) || !NK.api || !NK.api.videoGenInputs) return;
    NK.api.videoGenInputs(state.projectId || null, id).then(function (data) {
      var inputs = (data && data.inputs) || {};
      var names = [inputs.start || '', inputs.end || ''].concat(Array.isArray(inputs.refs) ? inputs.refs : []);
      return Promise.all(names.map(function (n) { return n ? storedImageToDataUrl(n) : Promise.resolve(''); }));
    }).then(function (urls) {
      // 그 사이 다른 카드를 눌렀으면 늦게 온 응답으로 덮어쓰지 않는다.
      if (!urls || seq !== _inputRestoreSeq) return;
      state.startImageUrl = urls[0] || '';
      state.endImageUrl = urls[1] || '';
      state.referenceUrls = urls.slice(2).filter(Boolean);
      rerenderKeepingResultsScroll();
    }).catch(function (err) {
      console.warn('[vgen] input image restore failed', err && err.message);
    });
  }

  // 서버 결과 카드의 결과 ID: 업로드 메타의 resultId, 없으면(예전 업로드) 파일 이름의 vg-… 조각.
  function serverResultId(item) {
    var meta = (item && item.metadata) || {};
    if (meta.resultId) return String(meta.resultId);
    var m = /(vg-\d+-[a-z0-9]+)/i.exec(String((item && item.name) || '').split('/').pop());
    return m ? m[1] : '';
  }

  // 결과 카드를 다시 열 때 생성 당시의 폼 선택값을 한 곳에서 복원한다.
  // 저장된 값이 현재 지원 목록에 없으면 임의로 추측하지 않고 현재 값을 유지한다.
  function restoreGenerationSettings(snapshot) {
    if (!snapshot) return;

    state.prompt = String(snapshot.prompt || '');

    var requestedModel = String(snapshot.model || '');
    var model = ALL_MODELS.find(function (m) { return m.id === requestedModel; });
    if (model) state.model = model.id;

    var requestedMode = snapshot.mode === 't2v' || snapshot.mode === 'i2v' || snapshot.mode === 'r2v' || snapshot.mode === 'motion' ? snapshot.mode : '';
    var activeModel = currentModelObj();
    if (requestedMode && activeModel[requestedMode]) {
      state.mode = requestedMode;
    } else if (activeModel.motion) {
      state.mode = 'motion';
    } else if (!activeModel.t2v && activeModel.i2v) {
      // 과거 메타에 mode가 없어도 I2V 전용 모델은 선택 가능한 모드가 하나뿐이다.
      state.mode = 'i2v';
    }

    var aspectRatio = String(snapshot.aspectRatio || '');
    if (aspectChoices().indexOf(aspectRatio) !== -1) state.aspectRatio = aspectRatio;

    if (hasResolutionChoice(state.model) && snapshot.resolution) {
      state.resolution = normalizeResolutionFor(state.model, snapshot.resolution);
    }

    var duration = Number(snapshot.duration);
    if (durations().indexOf(duration) !== -1) state.duration = duration;
  }

  function renderPreservingResultsScroll(scrollTop) {
    render();
    var list = root && root.querySelector('.vgen-results-list');
    if (list) list.scrollTop = Number(scrollTop) || 0;
  }

  // 생성 날짜·시각: 2026-09-17 14:05
  function formatCreatedAt(value) {
    var d = new Date(typeof value === 'number' ? value : String(value || ''));
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function loadDeletedSet() {
    try { state.deletedSet = JSON.parse(localStorage.getItem(DELETED_KEY) || '{}') || {}; } catch (_) {}
  }

  function saveDeletedSet() {
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(state.deletedSet)); } catch (_) {}
  }

  // 삭제된 영상 objectName을 참조하는 프로젝트 씬/컷의 videoUrl을 모두 제거
  function clearProjectVideoRef(projectId, objectName) {
    if (!projectId || !objectName) return;
    var fname = String(objectName).split('/').pop();
    if (!fname) return;
    var vidKeys = ['videoUrl', 'videoPlaybackUrl', 'generatedVideoUrl', 'videoPath'];
    function urlMatchesFile(url) {
      if (!url) return false;
      var s = String(url);
      return s.indexOf(fname) >= 0 || s.indexOf(encodeURIComponent(objectName)) >= 0;
    }
    function clearScene(scene) {
      var next = scene;
      var sc = false;
      vidKeys.forEach(function(k) {
        if (urlMatchesFile(next[k])) {
          if (!sc) { sc = true; next = Object.assign({}, next, { videoStatus: '', videoJobId: '', videoError: '' }); }
          next[k] = '';
        }
      });
      if (Array.isArray(scene.shots)) {
        var newShots = scene.shots.map(function(sh) {
          var ns = sh; var shC = false;
          vidKeys.forEach(function(k) {
            if (urlMatchesFile(ns && ns[k])) {
              if (!shC) { shC = true; ns = Object.assign({}, ns, { videoStatus: '', videoJobId: '', videoError: '' }); }
              ns[k] = '';
            }
          });
          return ns;
        });
        if (newShots.some(function(s, i) { return s !== scene.shots[i]; })) {
          if (!sc) { sc = true; next = Object.assign({}, next); }
          next.shots = newShots;
        }
      }
      return next;
    }
    function applyUpdate(project) {
      var scenes = Array.isArray(project && project.scenes) ? project.scenes : [];
      var nextScenes = scenes.map(clearScene);
      if (nextScenes.every(function(s, i) { return s === scenes[i]; })) return project;
      return Object.assign({}, project, { scenes: nextScenes });
    }
    try {
      var svc = NK.service && NK.service.project;
      if (svc && svc.updateLocal) { svc.updateLocal(projectId, applyUpdate); return; }
      var drafts = NK.store && NK.store.getDrafts ? NK.store.getDrafts() : null;
      if (!Array.isArray(drafts)) return;
      var idx = drafts.findIndex(function(d) { return String(d && d.id) === String(projectId); });
      if (idx < 0) return;
      var updated = applyUpdate(drafts[idx]);
      if (updated === drafts[idx]) return;
      drafts[idx] = updated;
      NK.store.saveDrafts(drafts);
      try {
        var rt = NK.state && NK.state.runtime;
        if (rt && rt.currentProject && String(rt.currentProject.id) === String(projectId)) rt.currentProject = updated;
      } catch (_) {}
    } catch (_) {}
  }

  function syncServerHistory() {
    if (!NK.api || !NK.api.videoGenLibrary) return;
    state.historyLoading = true;
    render();
    NK.api.videoGenLibrary(state.projectId || null).then(function (data) {
      var items = Array.isArray(data) ? data : (Array.isArray(data && data.items) ? data.items : []);
      // 서버(GCS)가 삭제의 단일 출처다. 목록에서 이미 사라진 tombstone은 캐시로서 역할이
      // 끝났으므로 정리한다 (무한히 쌓이면 다른 기기의 유효 항목까지 가릴 위험이 있다).
      var present = {};
      items.forEach(function (s) { if (s && s.name) present[s.name] = true; });
      var pruned = false;
      Object.keys(state.deletedSet).forEach(function (name) {
        if (!present[name]) { delete state.deletedSet[name]; pruned = true; }
      });
      if (pruned) saveDeletedSet();
      state.serverItems = items.filter(function (s) { return !state.deletedSet[s.name]; });
      state.historyLoading = false;
      render();
    }).catch(function () {
      state.historyLoading = false;
      render();
    });
  }

  function updateResult(id, updates) {
    state.results = state.results.map(function (r) {
      return r.id === id ? Object.assign({}, r, updates) : r;
    });
  }

  // ─── Render ───────────────────────────────────────────────

  var root = null;

  function ensureSessionId() {
    try {
      var cur = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (cur) return cur;
      var next = 'vg_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) { return 'vg_' + Date.now(); }
  }

  function readCurrentProject() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) { return null; }
  }

  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) { return null; }
  }

  function makePill(labelText, valueText) {
    var pill = el('span', 'studio-hero-pill');
    pill.appendChild(el('em', '', { textContent: labelText }));
    pill.appendChild(el('strong', '', { textContent: valueText }));
    return pill;
  }

  var _capturingIds = {};
  var _serverThumbCache = {};

  function tryCaptureThumbnail(r) {
    if (!r || !r.id || r.thumbnailDataUrl || r.status !== 'done') return;
    var playUrl = resultPlayUrl(r);
    if (!playUrl) return;
    if (_capturingIds[r.id]) return;
    _capturingIds[r.id] = true;
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.preload = 'metadata';
    vid.src = playUrl;
    var captured = false;
    function captureFrame() {
      if (captured) return;
      try {
        var w = Math.min(vid.videoWidth || 320, 320);
        var h = Math.min(vid.videoHeight || 180, 180);
        if (!w || !h) return;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(vid, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl && dataUrl.length > 200) {
          captured = true;
          updateResult(r.id, { thumbnailDataUrl: dataUrl });
          saveResults();
          render();
        }
      } catch (_) {}
      delete _capturingIds[r.id];
    }
    vid.addEventListener('seeked', captureFrame);
    vid.addEventListener('loadeddata', function () { try { vid.currentTime = 0.5; } catch (_) {} });
    vid.addEventListener('error', function () { delete _capturingIds[r.id]; });
    vid.load();
  }

  function tryCaptureThumbnailServer(objectName, videoUrl, onDone) {
    if (!objectName || !videoUrl || _serverThumbCache[objectName]) return;
    _serverThumbCache[objectName] = 'loading';
    var vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.muted = true;
    vid.preload = 'metadata';
    vid.src = videoUrl;
    vid.addEventListener('seeked', function () {
      try {
        var w = Math.min(vid.videoWidth || 320, 320);
        var h = Math.min(vid.videoHeight || 180, 180);
        if (!w || !h) return;
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(vid, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.78);
        if (dataUrl && dataUrl.length > 200) {
          _serverThumbCache[objectName] = dataUrl;
          if (onDone) onDone(dataUrl);
        }
      } catch (_) { delete _serverThumbCache[objectName]; }
    });
    vid.addEventListener('loadeddata', function () { try { vid.currentTime = 0.5; } catch (_) {} });
    vid.addEventListener('error', function () { delete _serverThumbCache[objectName]; });
    vid.load();
  }

  function openImageModal(url) {
    closeVideoModal();
    var overlay = document.createElement('div');
    overlay.className = 'vgen-modal-overlay';
    overlay.setAttribute('data-vgen-modal', '1');
    var inner = document.createElement('div');
    inner.className = 'vgen-modal-inner';
    inner.style.background = 'transparent';
    inner.style.boxShadow = 'none';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'vgen-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    var img = document.createElement('img');
    img.className = 'vgen-img-modal-img';
    img.src = url;
    inner.appendChild(closeBtn);
    inner.appendChild(img);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    closeBtn.addEventListener('click', closeVideoModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVideoModal(); });
    document.addEventListener('keydown', _modalKeyHandler);
  }

  var DOWNLOAD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
  var TRASH_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.75h6l.6 1.5H19a.75.75 0 0 1 0 1.5h-.66l-.8 10.05A2.25 2.25 0 0 1 15.29 20H8.71a2.25 2.25 0 0 1-2.24-2.2l-.81-10.05H5a.75.75 0 0 1 0-1.5h3.4L9 4.75Z"/><path d="M10 10v5.25M14 10v5.25"/></svg>';
  var PLAY_SVG     = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
  // lucide: rotate-ccw
  var RETRY_SVG    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

  function expiredMessage() {
    return state.lang === 'en'
      ? 'Playback permission expired. Please refresh the page and try again.'
      : '재생 권한이 만료되었습니다. 새로고침 후 다시 시도해 주세요.';
  }

  async function downloadVideo(url, filename) {
    var name = filename || 'video.mp4';
    try {
      var res = await fetch(url);
      var ctype = String(res.headers.get('Content-Type') || '').toLowerCase();
      // 401/403 등의 JSON 오류 본문을 .mp4로 저장하는 사고를 막는다.
      if (!res.ok || ctype.indexOf('application/json') !== -1) {
        window.alert(expiredMessage());
        return;
      }
      var blob = await res.blob();
      var blobUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = blobUrl; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 60000);
    } catch (_) {
      window.alert(expiredMessage());
    }
  }

  // retryFn: 호출하면 최신 토큰이 붙은 URL을 새로 만들어 주는 함수 (1회 자동 재시도용)
  function openVideoModal(url, retryFn) {
    closeVideoModal();
    var overlay = document.createElement('div');
    overlay.className = 'vgen-modal-overlay';
    overlay.setAttribute('data-vgen-modal', '1');
    var inner = document.createElement('div');
    inner.className = 'vgen-modal-inner';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'vgen-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    var vid = document.createElement('video');
    vid.className = 'vgen-modal-video';
    vid.src = url;
    vid.controls = true;
    vid.autoplay = true;
    vid.setAttribute('playsinline', '1');
    var retried = false;
    vid.addEventListener('error', function () {
      if (!retried && typeof retryFn === 'function') {
        retried = true;
        var next = '';
        try { next = retryFn() || ''; } catch (_) { next = ''; }
        if (next) { vid.src = next; try { vid.load(); } catch (_) {} return; }
      }
      if (inner.querySelector('.vgen-modal-error')) return;
      vid.style.display = 'none';
      inner.appendChild(el('p', 'vgen-modal-error', { textContent: expiredMessage() }));
    });
    inner.appendChild(closeBtn);
    inner.appendChild(vid);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    closeBtn.addEventListener('click', closeVideoModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeVideoModal(); });
    document.addEventListener('keydown', _modalKeyHandler);
  }

  function _modalKeyHandler(e) {
    if (e.key === 'Escape') closeVideoModal();
  }

  function closeVideoModal() {
    document.querySelectorAll('[data-vgen-modal]').forEach(function (el) {
      var vid = el.querySelector('video');
      if (vid) { try { vid.pause(); } catch (_) {} }
      el.remove();
    });
    document.removeEventListener('keydown', _modalKeyHandler);
  }

  document.addEventListener('click', function (e) {
    var modal = e.target && e.target.closest ? e.target.closest('[data-vgen-guide-modal]') : null;
    if (!modal) return;
    if (e.target === modal || (e.target.closest && e.target.closest('[data-vgen-guide-close]'))) closeModelGuide();
  });

  function render() {
    if (!root) return;
    root.innerHTML = '';

    var wrap = el('div', 'vgen-wrap');

    // Header with title + status pills
    var header = el('div', 'vgen-header');
    var titleWrap = el('div');
    titleWrap.appendChild(el('h2', 'vgen-title', { textContent: t('title') }));
    header.appendChild(titleWrap);

    var detached = !state.projectId;
    var project  = state.currentProject;
    var brand    = state.currentBrand;
    var pillsRow = el('div', 'vgen-status-pills');
    var creditPill = makePill(t('creditLabel'), creditPillText());
    creditPill.classList.add('vgen-credit-pill');
    creditPill.querySelector('strong').id = 'vgen-credit-pill-value';
    pillsRow.appendChild(creditPill);
    pillsRow.appendChild(makePill(t('sessionLabel'), detached ? t('noneLabel') : state.sessionId));
    pillsRow.appendChild(makePill(t('projectLabel'), detached ? t('noneLabel') : (project && project.title ? project.title : t('noProject'))));
    pillsRow.appendChild(makePill(t('brandLabel'),   detached ? t('noneLabel') : (brand && brand.brandTitle ? brand.brandTitle : t('noBrand'))));
    header.appendChild(pillsRow);
    wrap.appendChild(header);

    // Two-panel layout
    var layout = el('div', 'vgen-layout');
    layout.appendChild(renderResultsPanel());
    layout.appendChild(renderGenPanel());
    wrap.appendChild(layout);

    root.appendChild(wrap);
    bindEvents();
    // 모델·길이·참조 수가 바뀌었을 때만 새 견적을 받고, 결과 목록은 다시 렌더하지 않는다.
    ensureCreditQuote(false);
  }

  // ── Left: Results ──────────────────────────────────────────

  function renderResultsPanel() {
    var panel = el('div', 'vgen-results-panel');

    var panelHeader = el('div', 'vgen-panel-header');
    panelHeader.appendChild(el('span', 'vgen-panel-title', { textContent: t('results_title') }));
    var headerActions = el('div', 'vgen-panel-header-actions');
    if (state.results.length > 0 || state.serverItems.length > 0) {
      var clearBtn = el('button', 'btn-ghost vgen-clear-all-btn', {
        type: 'button', textContent: t('delete_all'), id: 'vgen-clear-all'
      });
      headerActions.appendChild(clearBtn);
    }
    panelHeader.appendChild(headerActions);
    panel.appendChild(panelHeader);

    var list = el('div', 'vgen-results-list');
    if (state.historyLoading) {
      list.appendChild(el('div', 'vgen-empty vgen-loading', { textContent: t('history_loading') }));
    } else if (!state.results.length && !state.serverItems.length) {
      var empty = el('div', 'vgen-empty');
      empty.textContent = t('results_empty');
      list.appendChild(empty);
    } else {
      state.results.slice().reverse().forEach(function (r) { list.appendChild(renderResultCard(r)); });
      var localIds = state.results.map(function (r) { return r.id; });
      // 로컬 카드가 이미 가리키는 객체는 서버 카드로 중복 표시하지 않는다.
      var localObjects = {};
      state.results.forEach(function (r) {
        var n = resultObjectName(r);
        if (n) localObjects[n] = true;
      });
      // 같은 결과의 복제본은 가장 최근 것 한 장만 보인다(serverItems 는 최신순).
      var shownGroups = {};
      state.serverItems.filter(function (s) {
        if (state.deletedSet[s.name] || localObjects[s.name]) return false;
        if (localIds.some(function (id) { return s.name.indexOf(id) !== -1 || serverGroupKey(s) === 'r:' + id; })) return false;
        var key = serverGroupKey(s);
        if (shownGroups[key]) return false;
        shownGroups[key] = true;
        return true;
      }).forEach(function (s) { list.appendChild(renderServerCard(s)); });
    }
    panel.appendChild(list);
    return panel;
  }

  function renderResultCard(r) {
    var isSelected = r.id === state.selectedId;
    var card = el('div', 'vgen-result-card' + (isSelected ? ' is-selected' : ''));
    card.dataset.id = r.id;

    var thumb = el('div', 'vgen-result-thumb');
    if (r.thumbnailDataUrl) {
      thumb.appendChild(el('img', '', { src: r.thumbnailDataUrl, alt: '' }));
    } else if (r.status === 'processing') {
      thumb.appendChild(el('div', 'vgen-spinner'));
    } else if (r.status === 'done') {
      thumb.classList.add('vgen-result-thumb--done');
      thumb.innerHTML = PLAY_SVG;
    } else {
      thumb.classList.add('vgen-result-thumb--error');
      thumb.textContent = '!';
    }
    card.appendChild(thumb);

    var info = el('div', 'vgen-result-info');
    var promptText = (r.prompt || '').slice(0, 60) + ((r.prompt || '').length > 60 ? '…' : '');
    info.appendChild(el('p', 'vgen-result-prompt', { textContent: promptText }));
    info.appendChild(el('p', 'vgen-result-meta', {
      textContent: [
        r.modelLabel || r.model || '',
        r.aspectRatio || '',
        r.resolution || '',
        r.duration ? (String(r.duration) + (state.lang === 'ko' ? '초' : 's')) : ''
      ].filter(Boolean).join(' · ')
    }));
    var localDate = formatCreatedAt(r.createdAt);
    if (localDate) info.appendChild(el('p', 'vgen-result-date', { textContent: localDate }));
    info.appendChild(el('span', 'vgen-result-status vgen-status--' + (r.status || 'processing'), { textContent: t('status_' + (r.status || 'processing')) }));
    // 실패 사유를 카드에 직접 노출한다. 전문은 title(툴팁)로.
    if (r.status === 'error') {
      var errAttrs = { textContent: r.errorMessage || t('error_unknown') };
      var tip = [r.errorStatus ? ('HTTP ' + r.errorStatus) : '', r.errorMessage || '', r.errorDetail || '']
        .filter(Boolean).join('\n');
      if (tip) errAttrs.title = tip;
      info.appendChild(el('p', 'vgen-result-error', errAttrs));
    }
    // 서버 복제를 건너뛴 결과는 원본 링크가 만료되면 사라진다 → '완료'로 위장하지 않는다.
    if (r.status === 'done' && r.mirrored === false) {
      info.appendChild(el('span', 'vgen-result-badge vgen-badge--temp', {
        textContent: t('badge_temp_link'),
        title: t('badge_temp_link_tip')
      }));
    }
    card.appendChild(info);

    var actions = el('div', 'vgen-result-actions');
    // 원본 URL만 남은 경우(대용량이라 미러링을 건너뜀)도 재생할 수 있어야 한다.
    var rObjectName = r.status === 'done' ? resultObjectName(r) : '';
    var rDirectUrl = (!rObjectName && r.status === 'done' && /^https?:\/\//i.test(r.rawVideoUrl || '')) ? r.rawVideoUrl : '';
    if (rObjectName || rDirectUrl) {
      var playAttrs = { type: 'button', title: '재생', 'data-action': 'play-result', innerHTML: PLAY_SVG };
      var dlAttrs = { type: 'button', title: t('download'), 'data-action': 'download-result', 'data-id': r.id, innerHTML: DOWNLOAD_SVG };
      if (rObjectName) { playAttrs['data-object'] = rObjectName; dlAttrs['data-object'] = rObjectName; }
      else { playAttrs['data-url'] = rDirectUrl; dlAttrs['data-url'] = rDirectUrl; }
      actions.appendChild(el('button', 'vgen-action-btn vgen-action-btn--play', playAttrs));
      actions.appendChild(el('button', 'vgen-action-btn', dlAttrs));
    }
    if (r.status === 'error' && r.canRetry) {
      // 새로고침 이후엔 이미지 스냅샷이 사라진다 → 무엇이 복원되는지 미리 알린다.
      var hasSnap = !!_retryInputs[r.id];
      actions.appendChild(el('button', 'vgen-action-btn vgen-action-btn--retry', {
        type: 'button',
        title: hasSnap ? t('retry') : t('retry_settings_only'),
        'data-action': 'retry-result', 'data-id': r.id, innerHTML: RETRY_SVG
      }));
    }
    var delBtn = el('button', 'vgen-action-btn vgen-action-btn--danger vgen-delete-btn', {
      type: 'button', title: t('delete_result'), 'data-action': 'delete-result', 'data-id': r.id, innerHTML: TRASH_SVG
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
    return card;
  }

  function renderServerCard(s) {
    var objectName = String(s.name || '');
    var isSelected = state.selectedId === serverSelectionId(objectName);
    var card = el('div', 'vgen-result-card vgen-server-card' + (isSelected ? ' is-selected' : ''));
    card.dataset.serverName = objectName;

    // signedUrl(1h 만료) 대신 objectName 기반 프록시 URL을 매 렌더마다 새로 만든다.
    var playUrl = (objectName && NK.api && NK.api.mediaProxyObjectUrl)
      ? NK.api.mediaProxyObjectUrl(objectName)
      : '';

    var thumb = el('div', 'vgen-result-thumb');
    var cachedThumb = _serverThumbCache[objectName];
    if (cachedThumb && cachedThumb !== 'loading') {
      thumb.appendChild(el('img', '', { src: cachedThumb, alt: '' }));
    } else {
      thumb.classList.add('vgen-result-thumb--done');
      thumb.innerHTML = PLAY_SVG;
      if (playUrl && cachedThumb !== 'loading') {
        tryCaptureThumbnailServer(objectName, playUrl, function () { render(); });
      }
    }
    card.appendChild(thumb);

    // 업로드 시 GCS object metadata에 기록해 둔 생성 정보(있으면 로컬 카드와 같은 형태로 렌더)
    var meta = s.metadata || {};
    var nameParts = objectName.split('/');
    var fileName = nameParts[nameParts.length - 1] || objectName;
    var metaPrompt = String(meta.prompt || '').trim();
    var metaLine = '';
    if (meta.model || meta.aspectRatio || meta.resolution || meta.duration) {
      metaLine = [
        String(meta.modelLabel || meta.model || '').trim(),
        String(meta.aspectRatio || '').trim(),
        String(meta.resolution || '').trim(),
        meta.duration ? (String(meta.duration) + (state.lang === 'ko' ? '초' : 's')) : ''
      ].filter(Boolean).join(' · ');
    }

    var info = el('div', 'vgen-result-info');
    if (metaPrompt) {
      var shown = metaPrompt.slice(0, 60) + (metaPrompt.length > 60 ? '…' : '');
      info.appendChild(el('p', 'vgen-result-prompt', { textContent: shown }));
    } else {
      info.appendChild(el('p', 'vgen-result-prompt', { textContent: fileName }));
    }
    if (metaLine) info.appendChild(el('p', 'vgen-result-meta', { textContent: metaLine }));
    var serverDate = formatCreatedAt(s.timeCreated || s.updated);
    if (serverDate) info.appendChild(el('p', 'vgen-result-date', { textContent: serverDate }));
    info.appendChild(el('span', 'vgen-result-status vgen-status--done', { textContent: t('server_item') }));
    card.appendChild(info);

    var actions = el('div', 'vgen-result-actions');
    if (objectName) {
      var playBtn = el('button', 'vgen-action-btn vgen-action-btn--play', {
        type: 'button', title: '재생', 'data-action': 'play-result', 'data-object': objectName, innerHTML: PLAY_SVG
      });
      actions.appendChild(playBtn);
      var dlBtn = el('button', 'vgen-action-btn', {
        type: 'button', title: t('download'), 'data-action': 'download-result', 'data-object': objectName, innerHTML: DOWNLOAD_SVG
      });
      actions.appendChild(dlBtn);
    }
    var delBtn = el('button', 'vgen-action-btn vgen-action-btn--danger vgen-server-delete-btn', {
      type: 'button', title: t('delete_result'), 'data-action': 'delete-server', 'data-name': objectName, innerHTML: TRASH_SVG
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
    return card;
  }

  // ── Right: Generation Panel ────────────────────────────────

  function renderModelDesc() {
    var mo = currentModelObj();
    var descObj = MODEL_DESCS[state.lang] || MODEL_DESCS.ko;
    var desc = descObj[mo.id] || '';
    if (!desc) return document.createDocumentFragment();
    var wrap = el('div', 'vgen-model-desc');
    var tags = el('div', 'vgen-feature-tags');
    var CAP_LABELS = {
      ko: { start: '시작 프레임', end: '끝 프레임', refs: '레퍼런스', audio: '오디오', camera: '카메라', video: '영상 편집' },
      en: { start: 'Start Frame', end: 'End Frame', refs: 'Reference', audio: 'Audio', camera: 'Camera', video: 'Video Edit' }
    };
    var capLabels = CAP_LABELS[state.lang] || CAP_LABELS.ko;
    (mo.caps || []).forEach(function (cap) {
      if (capLabels[cap]) {
        var tag = el('span', 'vgen-feature-tag', { textContent: capLabels[cap] });
        tags.appendChild(tag);
      }
    });
    wrap.appendChild(tags);
    // 지원 길이를 설명 끝에 덧붙인다. MODEL_DESCS 문구에 직접 적으면 duration 표와
    // 이중 관리가 되므로 표에서 만들어 붙인다(예전엔 UI가 5초를 제시하고 서버가
    // 조용히 4초로 스냅해 사용자가 이유를 알 수 없었다).
    var descEl = el('p', 'vgen-model-desc-text', { textContent: desc + ' ' + durationNote() });
    wrap.appendChild(descEl);
    return wrap;
  }

  function durationNote() {
    var list = durations().join('·');
    return state.lang === 'en'
      ? '(Supported lengths: ' + list + 's)'
      : '(지원 길이: ' + list + '초)';
  }

  function renderRefSection() {
    var max = maxRefs();
    if (!max) return document.createDocumentFragment();
    var combineAudio = (state.model === 'vidu-q3' || state.model === 'wan') && hasCap('audio');
    var section = el('div', 'vgen-refs-section');
    var grid = el('div', 'vgen-refs-grid');
    grid.setAttribute('data-image-drop-grid', '1');
    for (var i = 0; i < max; i++) {
      var slotUrl = state.referenceUrls[i] || '';
      var slot = el('div', 'vgen-ref-slot' + (slotUrl ? ' has-image' : ''));
      slot.setAttribute('data-ref-idx', i);
      slot.setAttribute('data-image-drop', 'ref');
      slot.setAttribute('data-drop-label', t('drop_image'));
      slot.setAttribute('aria-label', t('ref_slot_label').replace('{n}', String(i + 1)));
      if (slotUrl) {
        var img = el('img', 'vgen-ref-thumb', { src: slotUrl, alt: '' });
        img.setAttribute('data-action', 'preview-image');
        img.setAttribute('data-src', slotUrl);
        slot.appendChild(img);
        var removeBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×' });
        removeBtn.setAttribute('data-ref-idx', i);
        slot.appendChild(removeBtn);
      } else {
        var addBtn = el('button', 'vgen-ref-add', { type: 'button', textContent: '+' });
        addBtn.setAttribute('data-ref-idx', i);
        slot.appendChild(addBtn);
        var fileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'image/*', multiple: 'multiple', id: 'vgen-ref-file-' + i });
        fileInp.setAttribute('data-ref-idx', i);
        slot.appendChild(fileInp);
      }
      grid.appendChild(slot);
    }
    // vidu-q3: 오디오 슬롯을 레퍼런스 그리드 마지막에 통합 (5번째 슬롯)
    if (combineAudio) {
      var audioSlot = el('div', 'vgen-ref-slot vgen-ref-slot--audio' + (state.audioUrl ? ' has-file' : ''));
      if (state.audioUrl) {
        var audioIcon = el('span', 'vgen-audio-grid-icon', { textContent: '♪' });
        var audioName = el('span', 'vgen-audio-name-mini', { textContent: state.audioFileName || 'audio' });
        audioName.title = state.audioFileName || 'audio';
        var audioRemoveBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×', 'data-grid-audio-remove': '1' });
        audioSlot.appendChild(audioIcon);
        audioSlot.appendChild(audioName);
        audioSlot.appendChild(audioRemoveBtn);
      } else {
        var audioAddBtn = el('button', 'vgen-ref-add vgen-ref-add--audio', {
          type: 'button',
          innerHTML: '<span class="vgen-audio-grid-icon">♪</span><span class="vgen-audio-grid-label">' + t('audio_label') + '</span>'
        });
        var audioFileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'audio/*', id: 'vgen-audio-file', style: 'display:none' });
        audioSlot.appendChild(audioAddBtn);
        audioSlot.appendChild(audioFileInp);
      }
      grid.appendChild(audioSlot);
    }
    section.appendChild(grid);
    return section;
  }

  function renderStandaloneAudioSlot() {
    var section = el('div', 'vgen-audio-solo-section');
    var audioSlot = el('div', 'vgen-ref-slot vgen-ref-slot--audio' + (state.audioUrl ? ' has-file' : ''));
    if (state.audioUrl) {
      var icon = el('span', 'vgen-audio-grid-icon', { textContent: '♪' });
      var nameEl = el('span', 'vgen-audio-name-mini', { textContent: state.audioFileName || 'audio' });
      nameEl.title = state.audioFileName || 'audio';
      var removeBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×', 'data-grid-audio-remove': '1' });
      audioSlot.appendChild(icon);
      audioSlot.appendChild(nameEl);
      audioSlot.appendChild(removeBtn);
    } else {
      var addBtn = el('button', 'vgen-ref-add vgen-ref-add--audio', {
        type: 'button',
        innerHTML: '<span class="vgen-audio-grid-icon">♪</span><span class="vgen-audio-grid-label">' + t('audio_label') + '</span>'
      });
      var fileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'audio/*', id: 'vgen-audio-file', style: 'display:none' });
      audioSlot.appendChild(addBtn);
      audioSlot.appendChild(fileInp);
    }
    section.appendChild(audioSlot);
    return section;
  }

  function renderStandaloneVideoSlot() {
    var section = el('div', 'vgen-video-solo-section');
    var videoSlot = el('div', 'vgen-ref-slot vgen-ref-slot--video' + (state.videoUrl ? ' has-file' : ''));
    var videoLabel = state.lang === 'en' ? 'Video' : '영상';
    if (state.videoUrl) {
      var icon = el('span', 'vgen-video-grid-icon', { textContent: '▶' });
      var nameEl = el('span', 'vgen-audio-name-mini', { textContent: state.videoFileName || 'video' });
      nameEl.title = state.videoFileName || 'video';
      var removeBtn = el('button', 'vgen-ref-remove', { type: 'button', textContent: '×', 'data-grid-video-remove': '1' });
      videoSlot.appendChild(icon);
      videoSlot.appendChild(nameEl);
      videoSlot.appendChild(removeBtn);
    } else {
      var addBtn = el('button', 'vgen-ref-add vgen-ref-add--video', {
        type: 'button',
        innerHTML: '<span class="vgen-video-grid-icon">▶</span><span class="vgen-video-grid-label">' + videoLabel + '</span>'
      });
      var fileInp = el('input', 'vgen-ref-file', { type: 'file', accept: 'video/*', id: 'vgen-video-file', style: 'display:none' });
      videoSlot.appendChild(addBtn);
      videoSlot.appendChild(fileInp);
    }
    section.appendChild(videoSlot);
    return section;
  }

  function renderGenPanel() {
    var panel = el('div', 'vgen-gen-panel');
    var mo = currentModelObj();
    var isI2vOnly = !mo.t2v;
    var isI2vMode = isI2vOnly || state.mode === 'i2v';

    // Mode tabs (항상 표시; I2V 전용 모델은 T2V 탭 비활성)
    var tabsRow = el('div', 'vgen-tabs-row');
    // r2v 탭은 참조→영상 엔드포인트가 따로 있는 모델에만 보인다. Motion Control 탭은 늘 보이고,
    // 누르면 모션 컨트롤 모델로 바뀐다(모션 모델에서 다른 탭을 누르면 그 탭의 첫 모델로 돌아간다).
    var tabModes = (mo.r2v ? ['t2v', 'i2v', 'r2v'] : ['t2v', 'i2v']).concat(['motion']);
    var tabs = el('div', 'vgen-tabs vgen-tabs--' + tabModes.length);
    tabModes.forEach(function (mode) {
      var isActive = state.mode === mode;
      var isDisabled = mode === 't2v' && isI2vOnly && !mo.motion;
      var cls = 'vgen-tab' + (isActive ? ' is-active' : '') + (isDisabled ? ' is-disabled' : '');
      var tab = el('button', cls, {
        textContent: t('tab_' + mode),
        'data-mode': mode,
        type: 'button'
      });
      if (isDisabled) tab.setAttribute('disabled', '');
      tabs.appendChild(tab);
    });
    tabsRow.appendChild(tabs);
    tabsRow.appendChild(el('button', 'vgen-model-guide-btn', {
      id: 'vgen-model-guide-btn', type: 'button', textContent: '?',
      'aria-label': state.lang === 'en' ? 'Open video model guide' : '영상 모델 안내 열기',
      title: state.lang === 'en' ? 'Video model guide' : '영상 모델 안내'
    }));
    panel.appendChild(tabsRow);

    // Settings row: model / aspect / duration
    var row1 = el('div', 'vgen-row');

    var modelGrp = el('div', 'vgen-field vgen-field--model');
    var modelSel = el('select', 'vgen-select', { id: 'vgen-model' });
    ALL_MODELS.forEach(function (m) {
      var opt = el('option', '', { value: m.id, textContent: m.label });
      if (m.id === state.model) opt.selected = true;
      modelSel.appendChild(opt);
    });
    modelGrp.appendChild(modelSel);
    row1.appendChild(modelGrp);

    // 모션 컨트롤은 화면비·길이를 받지 않는다(입력 영상·이미지를 따른다) → 셀렉트를 그리지 않는다.
    var isMotion = !!mo.motion;
    var aspectGrp = el('div', 'vgen-field');
    var aspectSel = el('select', 'vgen-select', { id: 'vgen-aspect' });
    // 모델마다 받는 화면비가 다르다(MiniMax 는 21:9·3:4 까지). 목록에 없는 값이 남아 있으면 첫 값으로.
    if (aspectChoices().indexOf(state.aspectRatio) === -1) state.aspectRatio = aspectChoices()[0];
    aspectChoices().forEach(function (r) {
      var opt = el('option', '', { value: r, textContent: r });
      if (r === state.aspectRatio) opt.selected = true;
      aspectSel.appendChild(opt);
    });
    aspectGrp.appendChild(aspectSel);
    if (!isMotion) row1.appendChild(aspectGrp);

    var durGrp = el('div', 'vgen-field');
    var durSel = el('select', 'vgen-select', { id: 'vgen-duration' });
    // 선택지에 없는 값이 state 에 남아 있으면 화면과 실제 전송값이 어긋난다.
    if (durations().indexOf(state.duration) === -1) state.duration = durations()[0];
    durations().forEach(function (d) {
      var opt = el('option', '', { value: d, textContent: d + t('duration_unit') });
      if (d === state.duration) opt.selected = true;
      durSel.appendChild(opt);
    });
    durGrp.appendChild(durSel);
    if (!isMotion) row1.appendChild(durGrp);

    panel.appendChild(row1);

    // Seedance 정식 모델은 해상도를 공급자 요청에 직접 전달한다.
    if (isSeedanceModel(state.model)) {
      state.resolution = normalizeSeedanceResolution(state.resolution);
      // 공급자 문서상 4K는 native 3840×2160(16:9)만 지원한다.
      if (state.resolution === '4k') state.aspectRatio = '16:9';
      aspectSel.value = state.aspectRatio;
      aspectSel.disabled = state.resolution === '4k';
      aspectSel.title = state.resolution === '4k' ? t('resolution_4k_hint') : '';

      var resolutionRow = el('div', 'vgen-resolution-row');
      var resolutionHead = el('div', 'vgen-resolution-head');
      resolutionHead.appendChild(el('label', 'vgen-resolution-label', {
        for: 'vgen-resolution', textContent: t('resolution_label')
      }));
      resolutionHead.appendChild(el('span', 'vgen-resolution-hint', {
        textContent: state.resolution === '4k' ? t('resolution_4k_hint') : t('resolution_hint')
      }));
      resolutionRow.appendChild(resolutionHead);
      var resolutionSel = el('select', 'vgen-select vgen-resolution-select', { id: 'vgen-resolution' });
      SEEDANCE_RESOLUTIONS.forEach(function (resolution) {
        var opt = el('option', '', { value: resolution, textContent: resolutionLabel(resolution) });
        if (resolution === state.resolution) opt.selected = true;
        resolutionSel.appendChild(opt);
      });
      resolutionRow.appendChild(resolutionSel);
      panel.appendChild(resolutionRow);
    } else if (isMinimaxModel(state.model)) {
      // MiniMax: 탭(텍스트/이미지)마다 받는 해상도가 다르다 → 렌더마다 현재 탭 목록으로 맞춘다.
      state.resolution = normalizeResolutionFor(state.model, state.resolution);
      var mmRow = el('div', 'vgen-resolution-row');
      var mmHead = el('div', 'vgen-resolution-head');
      mmHead.appendChild(el('label', 'vgen-resolution-label', { for: 'vgen-resolution', textContent: t('resolution_label') }));
      mmHead.appendChild(el('span', 'vgen-resolution-hint', { textContent: t('resolution_hint_minimax') }));
      mmRow.appendChild(mmHead);
      var mmSel = el('select', 'vgen-select vgen-resolution-select', { id: 'vgen-resolution' });
      minimaxResolutionChoices(state.model).forEach(function (resolution) {
        var opt = el('option', '', { value: resolution, textContent: resolutionLabel(resolution) });
        if (resolution === state.resolution) opt.selected = true;
        mmSel.appendChild(opt);
      });
      mmRow.appendChild(mmSel);
      panel.appendChild(mmRow);
    }

    if (isMotion) {
      var motionSection = el('div', 'vgen-image-section');
      motionSection.appendChild(renderImageSlot('start', t('motion_character'), state.startImageUrl, true));
      motionSection.appendChild(renderMotionVideoSlot());
      panel.appendChild(motionSection);
      panel.appendChild(renderMotionOptions());
    }

    // Image slots (start/end)
    if (!isMotion && isI2vMode && modeAllows('start')) {
      var imgSection = el('div', 'vgen-image-section');
      imgSection.appendChild(renderImageSlot('start', t('start_frame'), state.startImageUrl, true));
      if (modeAllows('end')) {
        imgSection.appendChild(renderImageSlot('end', t('end_frame'), state.endImageUrl, false));
      }
      panel.appendChild(imgSection);
    }

    // Reference images
    if (modeAllows('refs')) {
      panel.appendChild(renderRefSection());
    }

    // Audio + Video: 둘 다 있으면 한 행으로 묶기 (seedance-r2v 등)
    var showAudio = modeAllows('audio') && state.model !== 'vidu-q3' && state.model !== 'wan';
    var showVideo = modeAllows('video') && !isMotion;
    if (showAudio && showVideo) {
      var avRow = el('div', 'vgen-av-row');
      avRow.appendChild(renderStandaloneAudioSlot());
      avRow.appendChild(renderStandaloneVideoSlot());
      panel.appendChild(avRow);
    } else {
      if (showAudio) panel.appendChild(renderStandaloneAudioSlot());
      if (showVideo) panel.appendChild(renderStandaloneVideoSlot());
    }

    // Prompt
    var promptWrap = el('div', 'vgen-prompt-wrap');
    var promptTA = el('textarea', 'vgen-prompt', {
      id: 'vgen-prompt',
      placeholder: t(isMotion ? 'motion_prompt_placeholder' : 'prompt_placeholder'),
      rows: '5'
    });
    promptTA.value = state.prompt;
    promptWrap.appendChild(promptTA);
    panel.appendChild(promptWrap);

    // Camera movement (caps에 camera가 있을 때만)
    if (hasCap('camera')) {
      var camSection = el('div', 'vgen-cam-section');
      var camGrid = el('div', 'vgen-cam-grid');
      CAMERA_MOVEMENTS.forEach(function (c) {
        var btn = el('button', 'vgen-cam-btn' + (state.cameraMovement === c.id ? ' is-active' : ''), {
          type: 'button',
          textContent: camLabel(c),
          'data-cam': c.id
        });
        camGrid.appendChild(btn);
      });
      camSection.appendChild(camGrid);
      panel.appendChild(camSection);
    }

    // 서버와 동일한 요율로 계산한 필요 크레딧과 실제 사용 가능 잔액을 생성 전에 보여준다.
    var creditStatus = el('div', 'vgen-credit-status', {
      id: 'vgen-credit-status',
      textContent: creditStatusText(),
      role: 'status',
      'aria-live': 'polite'
    });
    panel.appendChild(creditStatus);

    // Generate button
    var genBtn = el('button', 'btn-primary vgen-gen-btn', {
      id: 'vgen-generate-btn',
      type: 'button',
      textContent: creditButtonText()
    });
    panel.appendChild(genBtn);
    // root에 붙기 전에도 버튼이 잘못 활성화되는 순간이 없도록 초기 상태를 직접 적용한다.
    var creditBlocked = state.credit.status !== 'ready' || creditIsInsufficient();
    genBtn.disabled = state.generating || state.creditChecking || creditBlocked;
    genBtn.setAttribute('aria-disabled', genBtn.disabled ? 'true' : 'false');

    return panel;
  }

  // 모션 컨트롤 동작 영상 칸: 캐릭터 이미지 칸과 같은 크기로 나란히 둔다(미리보기 + 길이·용량).
  function renderMotionVideoSlot() {
    var slot = el('div', 'vgen-image-slot vgen-image-slot--required');
    var preview = el('div', 'vgen-image-preview', { id: 'vgen-img-preview-motion', 'data-drop-label': t('drop_video') });
    if (state.videoUrl) {
      var vid = el('video', 'vgen-image-thumb vgen-motion-thumb', {
        src: state.motionPreviewUrl || state.videoUrl, muted: 'muted', loop: 'loop', autoplay: 'autoplay', playsinline: 'playsinline'
      });
      vid.muted = true;
      preview.appendChild(vid);
      var info = [state.videoFileName || t('motion_video')];
      if (state.motionSeconds > 0) info.push(t('motion_seconds').replace('%s', formatSeconds(state.motionSeconds)));
      preview.appendChild(el('span', 'vgen-motion-meta', { textContent: info.join(' · '), title: state.videoFileName || '' }));
      preview.appendChild(el('button', 'btn-ghost vgen-remove-img vgen-motion-remove', { type: 'button', textContent: t('remove_image') }));
    } else {
      preview.appendChild(el('button', 'btn-secondary vgen-upload-trigger', { type: 'button', textContent: t('motion_video'), 'data-slot': 'motion' }));
      preview.appendChild(el('input', 'vgen-motion-file', { type: 'file', accept: 'video/mp4,video/quicktime,.mp4,.mov', id: 'vgen-file-motion' }));
    }
    slot.appendChild(preview);
    return slot;
  }

  function renderMotionOptions() {
    var row = el('div', 'vgen-resolution-row vgen-motion-options');
    var head = el('div', 'vgen-resolution-head');
    head.appendChild(el('label', 'vgen-resolution-label', { for: 'vgen-motion-orientation', textContent: t('motion_orient_label') }));
    head.appendChild(el('span', 'vgen-resolution-hint', { textContent: t('motion_hint') }));
    row.appendChild(head);
    var sel = el('select', 'vgen-select vgen-resolution-select', { id: 'vgen-motion-orientation' });
    [['video', 'motion_orient_video'], ['image', 'motion_orient_image']].forEach(function (o) {
      var opt = el('option', '', { value: o[0], textContent: t(o[1]) });
      if (o[0] === state.motionOrientation) opt.selected = true;
      sel.appendChild(opt);
    });
    row.appendChild(sel);
    var soundLabel = el('label', 'vgen-motion-sound');
    var cb = el('input', '', { type: 'checkbox', id: 'vgen-motion-sound' });
    cb.checked = !!state.motionKeepSound;
    soundLabel.appendChild(cb);
    soundLabel.appendChild(el('span', '', { textContent: t('motion_keep_sound') }));
    row.appendChild(soundLabel);
    return row;
  }

  function renderImageSlot(slotId, labelText, currentUrl, required) {
    var slot = el('div', 'vgen-image-slot' + (required ? ' vgen-image-slot--required' : ''));

    var preview = el('div', 'vgen-image-preview', {
      id: 'vgen-img-preview-' + slotId,
      'data-image-drop': 'slot',
      'data-slot': slotId,
      'data-drop-label': t('drop_image')
    });

    if (currentUrl) {
      var previewImg = el('img', 'vgen-image-thumb', {
        src: currentUrl, alt: '',
        'data-action': 'preview-image', 'data-src': currentUrl
      });
      preview.appendChild(previewImg);
      var removeBtn = el('button', 'btn-ghost vgen-remove-img', {
        type: 'button',
        textContent: t('remove_image'),
        'data-slot': slotId
      });
      preview.appendChild(removeBtn);
    } else {
      var btnText = slotId === 'start'
        ? (isMotionModel(state.model) ? t('motion_character') : (state.lang === 'en' ? 'Start Image' : '시작 이미지'))
        : (state.lang === 'en' ? 'End Image'   : '끝 이미지');
      var uploadBtn = el('button', 'btn-secondary vgen-upload-trigger', {
        type: 'button',
        textContent: btnText,
        'data-slot': slotId
      });
      var fileInp = el('input', 'vgen-file-input', {
        type: 'file',
        accept: 'image/*',
        id: 'vgen-file-' + slotId,
        'data-slot': slotId
      });
      preview.appendChild(uploadBtn);
      preview.appendChild(fileInp);
    }

    slot.appendChild(preview);
    return slot;
  }

  // ─── Events ───────────────────────────────────────────────

  function bindEvents() {
    if (!root) return;

    var guideBtn = root.querySelector('#vgen-model-guide-btn');
    if (guideBtn) guideBtn.addEventListener('click', function () { openModelGuide(guideBtn); });

    // Mode tabs
    root.querySelectorAll('.vgen-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var mode = tab.dataset.mode;
        if (mode === state.mode) return;
        var wasMotion = isMotionModel(state.model);
        state.mode = mode;
        var avail = availableModels();
        if (!avail.find(function (m) { return m.id === state.model; })) {
          state.model = avail[0].id;
        }
        // 모션 영상과 다른 모델의 편집·참조 영상은 규격이 달라 서로 넘기지 않는다.
        if (wasMotion !== isMotionModel(state.model)) clearMotionVideo();
        render();
        ensureCreditQuote(false);
      });
    });

    // Model
    var modelSel = root.querySelector('#vgen-model');
    if (modelSel) {
      modelSel.addEventListener('change', function () {
        var wasMotion = isMotionModel(state.model);
        state.model = modelSel.value;
        var newMo = ALL_MODELS.find(function (m) { return m.id === modelSel.value; });
        // 모션 모델은 Motion Control 탭, 거기서 다른 모델로 나오면 그 모델이 받는 탭으로.
        if (newMo && newMo.motion) state.mode = 'motion';
        else if (state.mode === 'motion') state.mode = newMo && newMo.t2v ? 't2v' : 'i2v';
        // I2V only 모델로 전환 시 mode를 i2v로 고정
        if (newMo && !newMo.t2v && !newMo.motion) state.mode = 'i2v';
        if (newMo && state.mode === 'r2v' && !newMo.r2v) state.mode = 'i2v';
        if (wasMotion !== isMotionModel(state.model)) clearMotionVideo();
        // 모델 전환 시 caps에 없는 상태 초기화
        if (!hasCap('refs')) state.referenceUrls = [];
        if (!hasCap('audio')) { state.audioUrl = ''; state.audioFileName = ''; }
        if (!hasCap('video')) { state.videoUrl = ''; state.videoFileName = ''; }
        if (!hasCap('end')) state.endImageUrl = '';
        if (!isKling()) state.cameraMovement = '';
        // Refresh duration options
        var durSel = root.querySelector('#vgen-duration');
        if (durSel) {
          durSel.innerHTML = '';
          durations().forEach(function (d) {
            var opt = el('option', '', { value: d, textContent: d + t('duration_unit') });
            if (d === state.duration) opt.selected = true;
            durSel.appendChild(opt);
          });
          if (!durations().includes(state.duration)) {
            state.duration = durations()[0];
            durSel.value = state.duration;
          }
        }
        render();
      });
    }

    // Aspect
    var aspectSel = root.querySelector('#vgen-aspect');
    if (aspectSel) aspectSel.addEventListener('change', function () {
      state.aspectRatio = aspectSel.value;
      ensureCreditQuote(false);
    });

    // Duration
    var durSel = root.querySelector('#vgen-duration');
    if (durSel) durSel.addEventListener('change', function () {
      state.duration = parseInt(durSel.value, 10);
      ensureCreditQuote(false);
    });

    // Seedance resolution (4K는 공급자 제약에 맞춰 16:9로 전환)
    var resolutionSel = root.querySelector('#vgen-resolution');
    if (resolutionSel) resolutionSel.addEventListener('change', function () {
      state.resolution = normalizeResolutionFor(state.model, resolutionSel.value);
      if (isSeedanceModel(state.model) && state.resolution === '4k') state.aspectRatio = '16:9';
      render();
    });

    // Prompt
    var promptTA = root.querySelector('#vgen-prompt');
    if (promptTA) promptTA.addEventListener('input', function () { state.prompt = promptTA.value; });

    // Camera movement buttons (Kling 전용)
    root.querySelectorAll('.vgen-cam-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.cameraMovement = btn.dataset.cam;
        root.querySelectorAll('.vgen-cam-btn').forEach(function (b) {
          b.classList.toggle('is-active', b.dataset.cam === state.cameraMovement);
        });
      });
    });

    // Image upload trigger buttons
    root.querySelectorAll('.vgen-upload-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-file-' + btn.dataset.slot);
        if (inp) inp.click();
      });
    });

    // File inputs
    root.querySelectorAll('.vgen-file-input').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var file = inp.files && inp.files[0];
        if (!file) return;
        var slot = inp.dataset.slot;
        prepareImageFile(file).then(function (dataUrl) {
          if (!dataUrl) return;
          if (slot === 'start') state.startImageUrl = dataUrl;
          else state.endImageUrl = dataUrl;
          render();
        });
      });
    });

    // Start/end image drag and drop
    root.querySelectorAll('.vgen-image-preview[data-image-drop="slot"]').forEach(function (preview) {
      bindImageDropTarget(preview, function (files) {
        var slot = preview.getAttribute('data-slot');
        prepareImageFile(files[0]).then(function (dataUrl) {
          if (!dataUrl) return;
          if (slot === 'start') state.startImageUrl = dataUrl;
          else state.endImageUrl = dataUrl;
          render();
        });
      });
    });

    // Remove image
    root.querySelectorAll('.vgen-remove-img').forEach(function (btn) {
      if (btn.classList.contains('vgen-motion-remove')) return; // 동작 영상 제거는 아래 모션 핸들러가 맡는다
      btn.addEventListener('click', function () {
        if (btn.dataset.slot === 'start') state.startImageUrl = '';
        else state.endImageUrl = '';
        render();
      });
    });

    // Generate
    var genBtn = root.querySelector('#vgen-generate-btn');
    if (genBtn) genBtn.addEventListener('click', startGeneration);

    // Result card click (select / deselect + copy prompt to input)
    // 로컬 결과와 서버 이력은 저장 위치만 다를 뿐 같은 결과 카드이므로 둘 다 동일하게 복원한다.
    root.querySelectorAll('.vgen-result-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-action]')) return;
        var resultsList = card.closest('.vgen-results-list');
        var resultsScrollTop = resultsList ? resultsList.scrollTop : 0;
        var id = card.dataset.id;
        if (id) {
          var r = state.results.find(function (x) { return x.id === id; });
          if (r) { restoreGenerationSettings(r); restoreInputImages(r.id); }
          state.selectedId = (state.selectedId === id) ? null : id;
          renderPreservingResultsScroll(resultsScrollTop);
          return;
        }

        var serverName = card.dataset.serverName;
        if (serverName) {
          var serverItem = state.serverItems.find(function (s) { return s.name === serverName; });
          if (!serverItem) return;
          restoreGenerationSettings(serverItem.metadata || {});
          restoreInputImages(serverResultId(serverItem));
          var selectionId = serverSelectionId(serverName);
          state.selectedId = (state.selectedId === selectionId) ? null : selectionId;
          renderPreservingResultsScroll(resultsScrollTop);
        }
      });
    });

    // Action buttons (play / download / delete)
    root.querySelectorAll('[data-action]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        var action = btn.dataset.action;
        // 클릭하는 "그 순간" 최신 토큰으로 URL을 만든다 (저장된 URL은 만료돼 있을 수 있음).
        var freshUrl = function () {
          var obj = btn.dataset.object;
          if (obj && NK.api && NK.api.mediaProxyObjectUrl) return NK.api.mediaProxyObjectUrl(obj);
          return btn.dataset.url || '';
        };
        if (action === 'play-result') {
          var url = freshUrl();
          if (url) openVideoModal(url, freshUrl);
        } else if (action === 'download-result') {
          var url = freshUrl();
          var id  = btn.dataset.id;
          var r   = id && state.results.find(function (x) { return x.id === id; });
          var filename = r ? ('vg_' + (r.model || 'video') + '_' + r.id + '.mp4') : 'video.mp4';
          if (url) downloadVideo(url, filename);
        } else if (action === 'retry-result') {
          retryResult(btn.dataset.id);
        } else if (action === 'delete-result') {
          if (!(await NK.ui.dialog.confirm(t('confirm_delete'), { title: t('delete') || '삭제 확인' }))) return;
          btn.disabled = true;
          deleteResult(btn.dataset.id).then(function (ok) {
            if (!ok) window.alert(t('delete_failed'));
          });
        } else if (action === 'preview-image') {
          var src = btn.getAttribute('data-src') || btn.getAttribute('src') || '';
          if (src) openImageModal(src);
        } else if (action === 'delete-server') {
          if (!(await NK.ui.dialog.confirm(t('confirm_delete'), { title: t('delete') || '삭제 확인' }))) return;
          var name = btn.dataset.name;
          if (name) {
            btn.disabled = true;
            deleteServerItem(name).then(function (ok) {
              if (!ok) {
                btn.disabled = false;
                window.alert(t('delete_failed'));
              }
            });
          }
        }
      });
    });

    // Clear all
    var clearAllBtn = root.querySelector('#vgen-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', async function () {
        if (!(await NK.ui.dialog.confirm(t('confirm_delete_all'), { title: t('clear_all') || '전체 삭제' }))) return;
        // 되돌릴 수 없는 전체 삭제라 2단계 확인을 둔다.
        var count = visibleResultCount();
        var typed = await NK.ui.dialog.prompt(t('confirm_delete_all_typed').replace('{n}', String(count)), { title: t('clear_all') || '전체 삭제 확인', defaultValue: '' });
        if (String(typed || '').trim() !== t('confirm_delete_all_word')) return;
        clearAllBtn.disabled = true;
        clearAllResults().then(function (failedCount) {
          clearAllBtn.disabled = false;
          if (failedCount > 0) {
            window.alert(t('delete_failed_n').replace('{n}', String(failedCount)));
          }
        });
      });
    }

    // Reference image add buttons
    root.querySelectorAll('.vgen-ref-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ref-idx'), 10);
        var inp = root.querySelector('#vgen-ref-file-' + idx);
        if (inp) inp.click();
      });
    });

    // Reference file inputs
    root.querySelectorAll('.vgen-ref-file[data-ref-idx]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var idx = parseInt(inp.getAttribute('data-ref-idx'), 10);
        setReferenceImages(inp.files, idx, true);
      });
    });

    // Reference images: a file dropped on an occupied slot replaces it; additional files fill empty slots.
    root.querySelectorAll('.vgen-ref-slot[data-image-drop="ref"]').forEach(function (slot) {
      bindImageDropTarget(slot, function (files) {
        setReferenceImages(files, parseInt(slot.getAttribute('data-ref-idx'), 10), true);
      });
    });
    var refsGrid = root.querySelector('.vgen-refs-grid[data-image-drop-grid]');
    bindImageDropTarget(refsGrid, function (files) {
      setReferenceImages(files, 0, false);
    });

    // Reference remove buttons
    root.querySelectorAll('.vgen-ref-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-ref-idx'), 10);
        state.referenceUrls[idx] = '';
        render();
      });
    });

    // Audio-in-grid add button (vidu-q3 통합 슬롯)
    root.querySelectorAll('.vgen-ref-add--audio').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-audio-file');
        if (inp) inp.click();
      });
    });
    // Audio-in-grid remove button
    root.querySelectorAll('[data-grid-audio-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.audioUrl = ''; state.audioFileName = '';
        render();
      });
    });

    // Audio trigger
    var audioTrigger = root.querySelector('.vgen-audio-trigger');
    if (audioTrigger) {
      audioTrigger.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-audio-file');
        if (inp) inp.click();
      });
    }
    var audioFile = root.querySelector('#vgen-audio-file');
    if (audioFile) {
      audioFile.addEventListener('change', function () {
        var file = audioFile.files && audioFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          state.audioUrl = ev.target.result;
          state.audioFileName = file.name;
          render();
        };
        reader.readAsDataURL(file);
      });
    }
    var audioRemove = root.querySelector('.vgen-audio-remove');
    if (audioRemove) {
      audioRemove.addEventListener('click', function () {
        state.audioUrl = ''; state.audioFileName = '';
        render();
      });
    }

    // Video slot (standalone grid style)
    root.querySelectorAll('.vgen-ref-add--video').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var inp = root.querySelector('#vgen-video-file');
        if (inp) inp.click();
      });
    });
    root.querySelectorAll('[data-grid-video-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.videoUrl = ''; state.videoFileName = '';
        render();
      });
    });
    // 모션 컨트롤: 동작 영상·방향·원본 소리
    bindVideoDropTarget(root.querySelector('#vgen-img-preview-motion'), function (files) {
      acceptMotionVideoFile(files[0]);
    });
    var motionFile = root.querySelector('#vgen-file-motion');
    if (motionFile) motionFile.addEventListener('change', function () {
      acceptMotionVideoFile(motionFile.files && motionFile.files[0]);
    });
    var motionRemove = root.querySelector('.vgen-motion-remove');
    if (motionRemove) motionRemove.addEventListener('click', function () {
      clearMotionVideo();
      render();
      ensureCreditQuote(false);
    });
    var motionOrient = root.querySelector('#vgen-motion-orientation');
    if (motionOrient) motionOrient.addEventListener('change', function () {
      state.motionOrientation = motionOrient.value === 'image' ? 'image' : 'video';
    });
    var motionSound = root.querySelector('#vgen-motion-sound');
    if (motionSound) motionSound.addEventListener('change', function () {
      state.motionKeepSound = !!motionSound.checked;
    });

    var videoFile = root.querySelector('#vgen-video-file');
    if (videoFile) {
      videoFile.addEventListener('change', function () {
        var file = videoFile.files && videoFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          state.videoUrl = ev.target.result;
          state.videoFileName = file.name;
          render();
        };
        reader.readAsDataURL(file);
      });
    }
  }

  // 실패 카드의 "다시 시도"용 입력 스냅샷. 이미지 data URL은 localStorage 를 터뜨리므로
  // 메모리에만 둔다(같은 세션 안에서의 재시도를 커버).
  var _retryInputs = {};

  function retryResult(id) {
    var r = state.results.find(function (x) { return x.id === id; });
    if (!r) return;
    // 설정을 폼으로 되돌린다.
    restoreGenerationSettings(r);

    var snap = _retryInputs[id];
    if (snap) {
      state.startImageUrl = snap.startImageUrl || '';
      state.endImageUrl   = snap.endImageUrl || '';
      state.referenceUrls = (snap.referenceUrls || []).slice();
      state.audioUrl      = snap.audioUrl || '';
      state.videoUrl      = snap.videoUrl || '';
      state.videoFileName = snap.videoFileName || '';
      state.audioFileName = snap.audioFileName || '';
    }

    // 새로고침 이후엔 이미지 스냅샷이 사라진다. 그대로 생성을 걸면 '이미지를 업로드하세요'
    // 경고가 떠서 버그처럼 보이므로, 폼만 복원하고 무엇을 해야 하는지 알려준다.
    if (!snap && requiredInputMissing()) {
      render();
      focusImageSlot();
      window.alert(t('retry_no_image'));
      return;
    }

    // 실패 카드는 치우고 같은 조건으로 새로 요청한다.
    deleteResult(id);
    delete _retryInputs[id];
    render();
    startGeneration();
  }

  // 생성에 필요한 입력이 빠졌는지 한 곳에서 판정한다(생성 버튼과 재시도가 같은 규칙을 쓰도록).
  function requiredInputMissing() {
    var isI2vMode = state.mode === 'i2v' || !currentModelObj().t2v;
    var refCount = (state.referenceUrls || []).filter(Boolean).length;
    if (isMotionModel(state.model)) {
      if (!state.startImageUrl) return 'motion_no_image_alert';
      if (!state.videoUrl) return 'motion_no_video_alert';
      if (state.motionOrientation === 'image' && state.motionSeconds > MOTION_SPEC.maxSeconds.image + 0.05) return 'motion_duration_image_alert';
      return '';
    }
    // MiniMax: 탭마다 받는 입력이 다르다(modeAllows). 참조→영상은 이미지·영상 참조가 하나는 있어야 하고
    // 오디오만으로는 못 만든다(공급자 규칙, video-specs.ts resolveMinimaxRoute 와 같다).
    if (isMinimaxModel(state.model)) {
      if (state.mode === 'r2v') {
        var hasVisualRef = (modeAllows('refs') && refCount > 0) || (modeAllows('video') && !!state.videoUrl);
        if (hasVisualRef) return '';
        return (modeAllows('audio') && state.audioUrl) ? 'minimax_audio_only_alert' : 'no_ref_alert';
      }
      if (isI2vMode && !state.startImageUrl) return 'no_image_alert';
      return '';
    }
    if (isI2vMode && hasCap('start') && !state.startImageUrl && refCount === 0) return 'no_image_alert';
    if (hasCap('video') && !hasCap('start') && !hasCap('refs') && !state.videoUrl) return 'no_video_alert';
    return '';
  }

  function focusImageSlot() {
    if (!root) return;
    var slot = root.querySelector('.vgen-image-slot') || root.querySelector('.vgen-ref-slot');
    if (!slot) return;
    try { slot.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    var trigger = slot.querySelector('.vgen-upload-trigger, .vgen-ref-add');
    if (trigger && trigger.focus) { try { trigger.focus(); } catch (_) {} }
  }

  // 삭제의 단일 출처(SSOT)는 GCS 객체다. 서버 삭제가 실패했는데 로컬 tombstone 만 남기면
  // "이 기기에서만 영구 숨김 + 다른 기기엔 그대로" 라는 어긋난 상태가 된다.
  // → tombstone 은 성공 응답 이후에만 기록하고, 실패하면 카드를 원위치로 되돌린다.
  function deleteResult(id) {
    if (state.polls[id]) { clearInterval(state.polls[id]); delete state.polls[id]; }
    var snapshot = _retryInputs[id];
    delete _retryInputs[id];

    var index = state.results.findIndex(function (r) { return r.id === id; });
    if (index < 0) return Promise.resolve(true);
    var target = state.results[index];
    var wasSelected = state.selectedId === id;

    state.results = state.results.filter(function (r) { return r.id !== id; });
    if (wasSelected) state.selectedId = null;
    saveResults();
    render();

    function restore() {
      // 원래 인덱스를 유지해 목록 순서가 흔들리지 않게 되돌린다.
      var next = state.results.slice();
      next.splice(Math.min(index, next.length), 0, target);
      state.results = next;
      if (wasSelected) state.selectedId = id;
      if (snapshot) _retryInputs[id] = snapshot;
      saveResults();
      render();
    }

    var objectName = resultObjectName(target);
    // 서버에 올라간 적 없는 결과(생성 실패 등)는 로컬 제거로 끝난다.
    if (!objectName) return Promise.resolve(true);
    if (!(NK.api && NK.api.videoDelete)) { restore(); return Promise.resolve(false); }

    var prevServerItems = state.serverItems;
    state.serverItems = state.serverItems.filter(function (s) { return s.name !== objectName; });

    return NK.api.videoDelete(objectName)
      .then(function () {
        state.deletedSet[objectName] = true;
        saveDeletedSet();
        if (state.projectId) clearProjectVideoRef(state.projectId, objectName);
        // 같은 결과의 서버 복제본(예전 중복 저장분)도 지운다. 남겨 두면 로컬 카드가 사라진 뒤 서버 카드로 다시 나타난다.
        var sibling = state.serverItems.find(function (s) { return s.name !== objectName && serverGroupKey(s) === 'r:' + id; });
        return sibling ? deleteServerItem(sibling.name).then(function () { return true; }) : true;
      })
      .catch(function (err) {
        console.error('[vgen] delete failed', objectName, err);
        delete state.deletedSet[objectName];
        saveDeletedSet();
        state.serverItems = prevServerItems;
        restore();
        return false;
      });
  }

  // 미러링을 건너뛴 결과는 원본 링크가 만료되기 전에 서버 복제를 한 번 더 시도한다.
  // status 를 다시 물으면 서버가 flattenPlayback 을 재실행한다(공급자에 예측이 남아 있는 동안만
  // 성공한다 — 실패해도 조용히 임시 링크 상태를 유지한다).
  function tryRemirror(r) {
    if (!r || r.status !== 'done' || r.mirrored !== false || !r.jobId) return;
    if (_remirrorTried[r.id]) return;
    _remirrorTried[r.id] = true;
    if (!(NK.api && NK.api.videoStatus)) return;

    NK.api.videoStatus({
      projectId: state.projectId || null,
      sceneId: r.id,
      jobId: r.jobId,
      source: 'video-gen',
      meta: {
        prompt: r.prompt, model: r.model, modelLabel: r.modelLabel,
        mode: r.mode, aspectRatio: r.aspectRatio, resolution: r.resolution, duration: r.duration, resultId: r.id
      }
    }).then(function (data) {
      var rawUrl = data.playbackUrl || data.playback || data.videoUrl || data.video_url || '';
      var objectName = (NK.api && NK.api.objectNameFromUrl) ? NK.api.objectNameFromUrl(rawUrl) : '';
      if (!objectName) return; // 여전히 미러링되지 않음 — 뱃지 유지
      updateResult(r.id, { videoObjectName: objectName, rawVideoUrl: rawUrl, mirrored: true });
      saveResults();
      render();
    }).catch(function (err) {
      console.error('[vgen] remirror failed', r.id, err && err.message);
    });
  }
  var _remirrorTried = {};

  // 화면에 실제로 보이는 카드 수(로컬 + 중복되지 않는 서버 카드).
  function visibleResultCount() {
    var localObjects = {};
    state.results.forEach(function (r) {
      var n = resultObjectName(r);
      if (n) localObjects[n] = true;
    });
    var serverOnly = state.serverItems.filter(function (s) {
      return s && s.name && !state.deletedSet[s.name] && !localObjects[s.name];
    });
    return state.results.length + serverOnly.length;
  }

  // 전체 삭제: 개별 결과를 하나씩 처리해 성공분만 제거하고 실패분은 목록에 남긴다.
  function clearAllResults() {
    Object.values(state.polls).forEach(function (id) { clearInterval(id); });
    state.polls = {};

    var localObjects = {};
    state.results.forEach(function (r) {
      var n = resultObjectName(r);
      if (n) localObjects[n] = true;
    });
    var serverOnlyNames = state.serverItems
      .map(function (s) { return s && s.name; })
      .filter(function (n) { return n && !localObjects[n]; });

    // 서버에 없는 결과(생성 실패 등)는 되돌릴 것이 없으므로 즉시 제거한다.
    var localOnly = state.results.filter(function (r) { return !resultObjectName(r); });
    localOnly.forEach(function (r) { delete _retryInputs[r.id]; });
    state.results = state.results.filter(function (r) { return !!resultObjectName(r); });
    state.selectedId = null;
    saveResults();
    render();

    // 하나씩 순차 처리한다. 동시에 돌리면 각 삭제가 뜬 롤백 스냅샷(results 인덱스,
    // serverItems)이 서로를 덮어써 실패분이 엉뚱한 자리로 되살아난다.
    // 실패해도 중단하지 않고 끝까지 진행한 뒤 실패 건수만 돌려준다.
    var jobs = state.results
      .map(function (r) { return r.id; })
      .map(function (id) { return function () { return deleteResult(id); }; })
      .concat(serverOnlyNames.map(function (name) {
        return function () { return deleteServerItem(name); };
      }));

    var failed = 0;
    return jobs.reduce(function (chain, run) {
      return chain.then(function () {
        return run().then(
          function (ok) { if (!ok) failed++; },
          function (err) { failed++; console.error('[vgen] delete failed', err); }
        );
      });
    }, Promise.resolve()).then(function () { return failed; });
  }

  // 서버 카드 삭제도 로컬 카드와 같은 규칙: tombstone 은 성공 후에만, 실패하면 원위치.
  function deleteServerItem(objectName) {
    if (!objectName || state.deletedSet[objectName]) return Promise.resolve(true);
    if (!(NK.api && NK.api.videoDelete)) return Promise.resolve(false);

    // 목록엔 한 장만 보이는 같은 결과의 복제본을 함께 지운다(하나만 지우면 숨어 있던 복제본이 다시 나타난다).
    var item = state.serverItems.find(function (s) { return s.name === objectName; });
    var names = item ? serverGroupNames(serverGroupKey(item)) : [];
    if (names.indexOf(objectName) < 0) names.push(objectName);

    var prevServerItems = state.serverItems;
    var selectedServerName = names.find(function (name) {
      return state.selectedId === serverSelectionId(name);
    }) || '';
    state.serverItems = state.serverItems.filter(function (s) { return names.indexOf(s.name) < 0; });
    if (selectedServerName) state.selectedId = null;
    render();

    var failedNames = [];
    return names.reduce(function (chain, name) {
      return chain.then(function () {
        return NK.api.videoDelete(name).then(function () {
          state.deletedSet[name] = true;
          if (state.projectId) clearProjectVideoRef(state.projectId, name);
        }, function (err) {
          console.error('[vgen] delete failed', name, err);
          failedNames.push(name);
        });
      });
    }, Promise.resolve()).then(function () {
      saveDeletedSet();
      if (failedNames.length) {
        state.serverItems = prevServerItems.filter(function (s) {
          return names.indexOf(s.name) < 0 || failedNames.indexOf(s.name) >= 0;
        });
        if (selectedServerName && failedNames.indexOf(selectedServerName) >= 0) {
          state.selectedId = serverSelectionId(selectedServerName);
        }
      }
      render();
      return failedNames.length === 0;
    });
  }

  // ─── Generation ───────────────────────────────────────────

  async function startGeneration() {
    if (state.generating || state.creditChecking) return;

    var prompt = (root.querySelector('#vgen-prompt') && root.querySelector('#vgen-prompt').value || state.prompt || '').trim();
    var isMotion = isMotionModel(state.model);
    // 모션 컨트롤은 동작을 영상에서 가져오므로 프롬프트가 선택이다.
    if (!prompt && !isMotion) { alert(t('no_prompt_alert')); return; }

    var isI2vMode = state.mode === 'i2v' || !currentModelObj().t2v;
    var missingKey = requiredInputMissing();
    if (missingKey) { alert(t(missingKey).replace('%s', formatSeconds(state.motionSeconds))); return; }

    state.prompt = prompt;
    // 표시 중인 잔액이 다른 탭/기기에서 이미 바뀌었을 수 있으므로 접수 직전에 다시 확인한다.
    // 견적 확인 실패도 fail-closed로 처리해 공급자 요청 및 과금이 먼저 나가지 않게 한다.
    state.creditChecking = true;
    updateCreditControls();
    var creditOk = await ensureCreditQuote(true);
    state.creditChecking = false;
    updateCreditControls();
    if (!creditOk) {
      await showCreditNotice();
      return;
    }

    state.generating = true;
    render();

    var resultId = generateId();
    var modelInfo = ALL_MODELS.find(function (m) { return m.id === state.model; }) || ALL_MODELS[0];

    var newResult = {
      id:              resultId,
      prompt:          prompt,
      model:           state.model,
      modelLabel:      modelInfo.label,
      aspectRatio:     isMotion ? '' : state.aspectRatio,
      resolution:      hasResolutionChoice(state.model) ? state.resolution : '',
      duration:        isMotion ? Math.ceil(state.motionSeconds || 0) : state.duration,
      mode:            state.mode,
      projectId:       state.projectId || '',
      status:          'processing',
      videoObjectName: '',
      thumbnailDataUrl: state.startImageUrl || '',
      createdAt:       Date.now()
    };

    state.results.push(newResult);
    state.selectedId = resultId;
    // ★ 생성 잠금(state.generating)은 서버가 작업을 접수할 때까지 유지한다(아래 finally 에서 푼다).
    //   예전엔 여기서 바로 풀어, 참조 업로드로 접수가 수십 초 걸리는 Seedance 2.5 에서 버튼이 다시 눌려
    //   누른 횟수만큼 영상이 생성되고 크레딧이 빠졌다(2026-09-17 한 번에 4개).
    // 실패 시 같은 입력으로 재시도할 수 있도록 스냅샷을 남긴다(메모리 전용).
    _retryInputs[resultId] = {
      startImageUrl: state.startImageUrl,
      endImageUrl:   state.endImageUrl,
      referenceUrls: (state.referenceUrls || []).slice(),
      audioUrl:      state.audioUrl,
      audioFileName: state.audioFileName,
      videoUrl:      state.videoUrl,
      videoFileName: state.videoFileName,
      motionSeconds: state.motionSeconds
    };
    saveResults();
    render();

    try {
      var camSuffix = state.cameraMovement
        ? '\nCamera movement: ' + state.cameraMovement.replace(/_/g, ' ') + '.'
        : '';
      var finalPrompt = prompt + camSuffix;

      var payload = {
        source:          'video-gen',
        sceneId:         resultId,
        promptText:      finalPrompt,
        aspectRatio:     state.aspectRatio,
        durationSeconds: state.duration,
        videoModel:      state.model
      };
      if (hasResolutionChoice(state.model)) payload.resolution = state.resolution;
      if (state.projectId) payload.projectId = state.projectId;

      // start image
      if (isI2vMode && modeAllows('start') && state.startImageUrl) {
        payload.imageDataUrl = state.startImageUrl;
        payload.image        = state.startImageUrl;
      }
      // end image
      // 끝 프레임 슬롯은 I2V 탭에만 있다. T2V 탭으로 옮긴 뒤 남은 값을 보내면 서버가 '시작 없는 끝 프레임' 으로 거부한다.
      if (isI2vMode && modeAllows('end') && state.endImageUrl) {
        payload.endImageDataUrl = state.endImageUrl;
      }
      // reference images
      var refs = (state.referenceUrls || []).filter(Boolean);
      if (modeAllows('refs') && refs.length > 0) {
        payload.referenceImages = refs;
      }
      // audio
      if (modeAllows('audio') && state.audioUrl) {
        payload.audioDataUrl = state.audioUrl;
      }
      // video (for editing)
      if (modeAllows('video') && state.videoUrl) {
        payload.videoDataUrl = state.videoUrl;
      }
      // kling quality
      if (state.model === 'kling-final') {
        payload.quality = 'final';
      }
      // 모션 컨트롤: 캐릭터 이미지 + 동작 영상 + 방향·원본 소리. 길이는 서버가 영상에서 읽는다.
      if (isMotion) {
        payload.imageDataUrl = await toJpegIfWebp(state.startImageUrl);
        payload.image = payload.imageDataUrl;
        payload.videoDataUrl = state.videoUrl;
        payload.characterOrientation = state.motionOrientation;
        payload.keepOriginalSound = !!state.motionKeepSound;
        payload.durationSeconds = Math.max(MOTION_SPEC.minSeconds, Math.ceil(state.motionSeconds || 0));
        delete payload.aspectRatio;
      }

      var startRes = await NK.api.videoStart(payload);
      updateResult(resultId, { jobId: startRes.jobId });
      saveResults();
      pollVideoStatus(resultId, startRes.jobId, state.projectId || null, {
        prompt:      prompt,
        model:       state.model,
        modelLabel:  modelInfo.label,
        mode:        state.mode,
        aspectRatio: isMotion ? '' : state.aspectRatio,
        resolution:  hasResolutionChoice(state.model) ? state.resolution : '',
        duration:    isMotion ? Math.ceil(state.motionSeconds || 0) : state.duration,
        resultId:    resultId
      });

    } catch (err) {
      var msg = (err && err.message) || 'error';
      var detail = '';
      try {
        detail = typeof (err && err.detail) === 'string' ? err.detail : JSON.stringify((err && err.detail) || '');
      } catch (_) { detail = ''; }
      console.error('[vgen] start failed', err && err.status, msg, detail);
      if (/credit_(?:insufficient|service_unavailable)/.test(detail)) {
        // 견적 직후 다른 탭에서 잔액을 사용한 경합도 서버가 최종 차단한다.
        // 최신 잔액으로 버튼을 즉시 잠그고 사람이 읽을 수 있는 모달을 함께 보여준다.
        ensureCreditQuote(true).then(function () { showCreditNotice(msg); });
      }
      updateResult(resultId, {
        status: 'error',
        errorMessage: msg,
        errorDetail: String(detail || '').slice(0, 2000),
        errorStatus: (err && err.status) || 0
      });
      saveResults();
    } finally {
      // 접수(성공·실패) 뒤에야 다음 생성을 받는다. 진행 상태는 결과 카드의 폴링이 이어서 보여준다.
      state.generating = false;
      render();
    }
  }

  // 서버가 준 error 는 문자열일 수도, {code,message} 객체일 수도 있다. 사람이 읽을 문구로 편다.
  function readErrorMessage(data) {
    var e = data && data.error;
    if (typeof e === 'string' && e) return e;
    if (e && typeof e === 'object') {
      if (e.message) return String(e.message);
      if (e.code) return String(e.code);
    }
    if (data && data.message) return String(data.message);
    return 'failed';
  }

  function readErrorDetail(data) {
    try { return JSON.stringify((data && data.error) || data || '').slice(0, 2000); }
    catch (_) { return ''; }
  }

  function pollVideoStatus(resultId, jobId, projectId, meta) {
    var attempts = 0;
    var consecutiveErrors = 0;
    var maxAttempts = maxPollAttemptsFor((meta && meta.model) || '');
    // 앞선 상태 조회가 끝나기 전엔 다음 조회를 보내지 않는다. 완료 직후 서버가 큰 영상을 복제하는 동안
    // 조회가 겹치면 조회마다 복제가 한 번씩 더 일어나 같은 영상이 여러 개 저장됐다.
    var inFlight = false;
    var stopped = false;

    function stop() {
      stopped = true;
      clearInterval(state.polls[resultId]);
      delete state.polls[resultId];
    }

    function check() {
      if (stopped || inFlight) return;
      if (attempts >= maxAttempts) {
        stop();
        var mins = Math.round((maxAttempts * POLL_INTERVAL_MS) / 60000);
        console.error('[vgen] poll timeout', { resultId: resultId, jobId: jobId, attempts: attempts });
        updateResult(resultId, {
          status: 'error',
          errorMessage: 'timeout(' + mins + '분)',
          errorDetail: 'jobId=' + jobId,
          canRetry: true
        });
        saveResults();
        render();
        return;
      }
      attempts++;
      inFlight = true;

      NK.api.videoStatus({ projectId: projectId, sceneId: resultId, jobId: jobId, source: 'video-gen', meta: meta })
        .then(function (data) {
          inFlight = false;
          if (stopped) return;
          consecutiveErrors = 0;
          var s = String((data && (data.status || data.state)) || '').toLowerCase();
          var done = /^(done|succeeded|success|completed)$/.test(s);
          var failed = /^(error|failed|cancelled)$/.test(s);

          if (done) {
            stop();
            var rawUrl = data.playbackUrl || data.playback || data.videoUrl || data.video_url || data.outputUrl || data.output_url || '';
            // 토큰이 박힌 URL은 저장하지 않는다(12h TTL 만료 후 401 → 재생 불가).
            // objectName만 보관하고 재생 직전에 최신 토큰으로 URL을 만든다.
            var objectName = (NK.api && NK.api.objectNameFromUrl) ? NK.api.objectNameFromUrl(rawUrl) : '';
            // objectName 이 없다 = 서버가 GCS 복제를 건너뛰고 원본(만료되는) 링크를 준 것.
            // '완료'로 위장하지 않고 임시 링크임을 표시한다.
            updateResult(resultId, {
              status: 'done',
              videoObjectName: objectName,
              rawVideoUrl: rawUrl,
              mirrored: !!objectName
            });
            saveResults();
            render();
            tryCaptureThumbnail(state.results.find(function (r) { return r.id === resultId; }));
          } else if (failed) {
            stop();
            var msg = readErrorMessage(data);
            console.error('[vgen] generation failed', resultId, msg, data);
            updateResult(resultId, {
              status: 'error',
              errorMessage: msg,
              errorDetail: readErrorDetail(data),
              canRetry: true
            });
            saveResults();
            render();
          }
        })
        .catch(function (err) {
          inFlight = false;
          if (stopped) return;
          // 조용히 삼키면 카드가 영원히 'processing' 으로 남는다. 연속 3회면 실패로 확정.
          consecutiveErrors++;
          console.error('[vgen] status poll error', resultId, consecutiveErrors, err && err.message);
          if (consecutiveErrors >= 3) {
            stop();
            updateResult(resultId, {
              status: 'error',
              errorMessage: 'status_polling_failed',
              errorDetail: String((err && err.message) || '').slice(0, 2000),
              canRetry: true
            });
            saveResults();
            render();
          }
        });
    }

    state.polls[resultId] = setInterval(check, POLL_INTERVAL_MS);
    check();
  }

  // ─── Lang sync ────────────────────────────────────────────

  function detectLang() {
    try {
      var stored = localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang');
      if (stored === 'en' || stored === 'ko') state.lang = stored;
    } catch (_) {}
  }

  // ─── Boot ─────────────────────────────────────────────────

  vgen.mount = function (container) {
    root = container;
    // Per-user storage isolation: namespace keys by logged-in userId
    var _baseResultsKey = 'nk_video_gen_results_v1';
    try {
      var _uid = (NK.auth && NK.auth.getUser) ? String(NK.auth.getUser() || '').trim() : '';
      if (_uid) {
        _baseResultsKey     = 'nk_video_gen_results_v1_'   + _uid;
        STORAGE_SESSION_KEY = 'nk_video_gen_session_id_'   + _uid;
        DELETED_KEY         = 'nk_video_gen_deleted_v1_'   + _uid;
      }
    } catch (_) {}
    try {
      var urlParams = new URLSearchParams(window.location.search);
      var pid = (urlParams.get('projectId') || '').trim();
      var det = urlParams.get('detached') === '1';
      state.projectId = (pid && !det) ? pid : '';
    } catch (_) {}
    // 결과 캐시를 컨텍스트별 키로 전환한다. 예전 통합 키는 첫 진입 때 컨텍스트별로 분배.
    migrateLegacyResults(_baseResultsKey);
    STORAGE_KEY = scopedResultsKey(_baseResultsKey, state.projectId);
    state.sessionId      = ensureSessionId();
    state.currentProject = readCurrentProject();

    state.currentBrand   = readCurrentBrand();
    // Brand Studio 자산 발견용: 프로젝트 컨텍스트일 때 sessionId를 payload에 동기화.
    // payload.videoGenSessionId가 이미 있으면 그 값을 권위로 삼아 localStorage도 맞춤
    // (다른 브라우저/세션 재진입 시에도 같은 GCS 세션에 누적되도록).
    try {
      var _pidSync = state.projectId || (state.currentProject && state.currentProject.id ? String(state.currentProject.id).trim() : '');
      if (_pidSync && NK.service && NK.service.project && NK.service.project.updatePayload) {
        var _projForSync = state.currentProject || (NK.service.project.getDraftById ? NK.service.project.getDraftById(_pidSync) : null);
        var _existingVgSid = String((_projForSync && _projForSync.payload && _projForSync.payload.videoGenSessionId) || '').trim();
        if (_existingVgSid && _existingVgSid !== state.sessionId) {
          try { localStorage.setItem(STORAGE_SESSION_KEY, _existingVgSid); } catch (_) {}
          state.sessionId = _existingVgSid;
        } else if (!_existingVgSid && state.sessionId) {
          NK.service.project.updatePayload(_pidSync, { videoGenSessionId: state.sessionId }).catch(function () {});
        }
      }
    } catch (_) {}
    loadResults();
    // 레거시 마이그레이션: 만료 토큰이 박힌 videoUrl을 objectName으로 바꿔 저장한다.
    var _migrated = false;
    state.results = state.results.map(function (r) {
      if (!r) return r;
      if (!r.videoObjectName && (r.videoUrl || r.rawVideoUrl)) {
        var n = (NK.api && NK.api.objectNameFromUrl)
          ? NK.api.objectNameFromUrl(r.videoUrl || r.rawVideoUrl)
          : '';
        if (n) { _migrated = true; return Object.assign({}, r, { videoObjectName: n, videoUrl: '' }); }
      }
      if (r.videoUrl) { _migrated = true; return Object.assign({}, r, { videoUrl: '' }); }
      return r;
    });
    if (_migrated) saveResults();
    detectLang(); // 아래 tracking_lost 문구가 현재 언어를 따르도록 먼저 확정한다

    // 새로고침하면 폴링 타이머가 사라져 'processing' 카드가 영원히 남는다.
    // jobId 가 있으면 폴링을 재개하고, 없으면 추적 불가로 확정한다.
    var _settled = false;
    state.results.forEach(function (r) {
      if (!r || r.status !== 'processing') return;
      if (r.jobId) return; // 아래에서 폴링 재개
      updateResult(r.id, { status: 'error', errorMessage: t('tracking_lost'), canRetry: true });
      _settled = true;
    });
    if (_settled) saveResults();

    // '조회 실패'는 작업의 결말이 아니다(공급자에선 이미 완료·실패로 끝났을 수 있다). 다시 열면 조회를 재개해
    // 실제 결과를 받고, 서버가 그 결과로 크레딧 예약을 확정·환불하게 한다(예약이 묶인 채 남지 않도록).
    var _repoll = false;
    state.results.forEach(function (r) {
      if (!r || r.status !== 'error' || r.errorMessage !== 'status_polling_failed' || !r.jobId) return;
      updateResult(r.id, { status: 'processing', errorMessage: '', errorDetail: '' });
      _repoll = true;
    });
    if (_repoll) saveResults();

    loadDeletedSet();
    render();
    // 기존 완료 결과 중 썸네일 없는 것 캡처 시도
    state.results.forEach(function (r) {
      if (r.status === 'done' && !r.thumbnailDataUrl) tryCaptureThumbnail(r);
    });
    // 임시 링크 상태로 남은 결과는 서버 복제를 1회 재시도
    state.results.forEach(tryRemirror);
    // 진행 중이던 작업 폴링 재개
    state.results.forEach(function (r) {
      if (!r || r.status !== 'processing' || !r.jobId || state.polls[r.id]) return;
      pollVideoStatus(r.id, r.jobId, state.projectId || null, {
        prompt:      r.prompt,
        model:       r.model,
        modelLabel:  r.modelLabel,
        mode:        r.mode,
        aspectRatio: r.aspectRatio,
        resolution:  r.resolution,
        duration:    r.duration,
        resultId:    r.id
      });
    });
    syncServerHistory();
    // 조회가 끊겨 예약된 채 남은 크레딧을 서버가 공급자 결과로 정산한다(실패=환불, 완료=확정). 결과는 콘솔에 남긴다.
    if (NK.api && typeof NK.api.creditReconcile === 'function') {
      NK.api.creditReconcile().then(function (r) {
        console.info('[vgen] credit reconcile', r);
        ensureCreditQuote(true);
      }).catch(function (err) {
        console.warn('[vgen] credit reconcile failed', err && err.status, err && err.detail);
      });
    }

    // 다른 기능/탭에서 크레딧이 예약·정산되면 현재 설정의 생성 가능 여부를 즉시 다시 계산한다.
    if (!_creditEventsBound) {
      window.addEventListener('nk:credits-changed', function () { ensureCreditQuote(true); });
      _creditEventsBound = true;
    }

    window.addEventListener('message', function (evt) {
      try {
        var data = evt.data || {};
        if (data.type === 'lang-apply' && (data.lang === 'en' || data.lang === 'ko')) {
          state.lang = data.lang;
          render();
        }
      } catch (_) {}
    });
  };


})();
