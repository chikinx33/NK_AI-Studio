;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiAiImage || (NK.uiAiImage = {});

  var STORAGE_SESSION_KEY = 'nk_ai_image_session_id';
  var STORAGE_HISTORY_PREFIX = 'nk_ai_image_history_';
  var MAX_SOURCE_IMAGES = 4;
  var state = {
    lang: 'ko',
    sessionId: '',
    mode: 'text-to-image',
    generationStyle: 'single',
    prompt: '',
    aspectRatio: '1:1',
    imageSize: '1K',
    provider: 'gemini',
    sourceImages: [],
    selectedSourceId: '',
    projectLibraryItems: [],
    brandLibraryItems: [],
    contentLibraryItems: [],
    currentProject: null,
    currentBrand: null,
    currentResultId: '',
    results: [],
    libraryLoading: false,
    brandLibraryLoading: false,
    contentLibraryLoading: false,
    historyLoading: false,
    historyLoadError: '',
    selectedFileName: '',
    sourceSectionCollapsed: { brand: true, content: true, project: true },
    imageModalUrl: '',
    previewTargetType: 'none',
    historyPanelMode: 'history',
    cameraTargetMode: 'scene',
    cameraControls: createDefaultCameraControls(),
    deletedObjectNames: []
  };

  var TEXT = {
    ko: {
      pageTitle: 'NK_Studio · AI 이미지',
      brandSubtitle: 'AI 이미지 생성 플랫폼',
      navDashboard: '대시보드',
      navAiVideo: 'AI Video',
      navAiImage: 'AI 이미지 생성',
      navLibrary: '콘텐츠 저장소',
      heroTitle: 'AI 이미지 생성',
      heroDesc: '',
      sessionLabel: '세션',
      projectLabel: '현재 에피소드',
      brandLabel: '현재 브랜드',
      noneLabel: '없음',
      noProject: '에피소드 없음',
      noBrand: '선택된 브랜드 없음',
      noProjectHelp: '프로젝트를 선택하면 저장소에서 소스를 불러오고 결과를 등록할 수 있습니다.',
      modeText: '텍스트를 이미지로',
      modeImage: '이미지를 이미지로',
      generationStyleLabel: '생성 흐름',
      generationStyleSingle: '단일',
      generationStyleConversation: '대화형',
      generationStyleSingleShort: '단일',
      generationStyleConversationShort: '대화형',
      sourceTitle: '소스 이미지',
      sourceEmpty: '',
      sourceUpload: '이미지 업로드',
      sourceProject: '프로젝트 저장소',
      sourceBrand: '브랜드 IP',
      sourceClear: '소스 비우기',
      sourceProjectEmpty: '현재 프로젝트 저장소에 이미지가 없습니다.',
      sourceProjectLoading: '프로젝트 저장소 불러오는 중...',
      sourceBrandEmpty: '현재 브랜드 IP 라이브러리에 이미지가 없습니다.',
      sourceBrandLoading: '브랜드 IP 라이브러리 불러오는 중...',
      sourceSelected: '선택된 소스',
      sourceLibraryTitle: '프로젝트 저장소',
      sourceBrandTitle: '브랜드 IP',
      sourceContentTitle: '콘텐츠 저장소',
      promptLabel: '프롬프트',
      promptPlaceholderText: '원하는 이미지의 장면, 스타일, 색감, 구도, 재질감을 설명해 주세요.',
      promptPlaceholderImage: '소스 이미지를 어떻게 바꾸거나 유지할지 설명해 주세요. 예: 같은 구도는 유지하고 수채화 질감으로 바꾸기',
      aspectLabel: '비율',
      sizeLabel: '해상도',
      sizeFast: '빠름(512)',
      sizeStd: '표준(1K)',
      sizeHigh: '고품질(2K)',
      providerLabel: '이미지 모델',
      providerGemini: 'Gemini 3.1 Flash',
      providerOpenai: 'GPT Image 2',
      generate: '생성',
      generating: '생성 중...',
      resultsTitle: '결과',
      resultsEmpty: '아직 생성된 이미지가 없습니다.',
      deleteConfirm: '이 이미지를 영구 삭제하시겠습니까?',
      deleteAllConfirm: '생성 히스토리의 모든 이미지를 영구 삭제하시겠습니까?',
      deleteLabel: '삭제',
      deleteAllLabel: '전체 삭제',
      download: '다운로드',
      saveProject: '에피소드 저장',
      saveBrand: '브랜드 IP 등록',
      savedBrand: '브랜드 IP 등록 완료',
      savedProject: '프로젝트 저장소 등록 완료',
      saveDisabled: '프로젝트가 선택되지 않아 등록할 수 없습니다.',
      saveBrandDisabled: '브랜드와 캐릭터가 선택되어야 등록할 수 있습니다.',
      saveBrandNoCharacters: '현재 브랜드에 등록된 캐릭터가 없어 IP로 등록할 수 없습니다.',
      saveBrandChooseCharacter: '등록할 캐릭터를 먼저 선택해 주세요.',
      saveBrandSelectLabel: '브랜드 캐릭터',
      saveBrandSelectPlaceholder: '캐릭터 선택',
      openVideo: 'AI Video로 이동',
      loginRequired: '로그인이 필요합니다.',
      loginAction: '로그인 하기',
      useInProject: '현재 프로젝트에서 소스로 사용 가능',
      createdAt: '생성 시각',
      modeTextShort: '텍스트',
      modeImageShort: '이미지',
      promptRequired: '프롬프트를 입력해 주세요.',
      sourceRequired: '소스 이미지를 먼저 선택해 주세요.',
      generationFailed: '이미지 생성 실패: ',
      projectLoadFailed: '프로젝트 저장소 불러오기 실패: ',
      brandLoadFailed: '브랜드 IP 불러오기 실패: ',
      projectSaveFailed: '프로젝트 저장소 등록 실패: ',
      brandSaveFailed: '브랜드 IP 등록 실패: ',
      downloadFailed: '다운로드 실패: ',
      fileChoose: '파일 선택',
      latestResult: '미리보기',
      historyTitle: '생성 히스토리',
      resultSavedTag: '에피소드 저장 완료',
      resultSavedBrandTag: '브랜드 IP 등록 완료',
      historyLoading: '세션 결과 불러오는 중...',
      historyLoadError: '세션 결과 동기화 실패',
      promptCounterSuffix: '/4000',
      backToLogin: '로그인 페이지로 이동',
      sourceKindUpload: '업로드',
      sourceKindProject: '프로젝트 저장소',
      sourceKindBrand: '브랜드 IP',
      sourceKindContent: '콘텐츠 저장소',
      sourceContent: '콘텐츠 저장소 불러오기',
      sourceContentTitle: '콘텐츠 저장소',
      sourceContentLoading: '콘텐츠 저장소 불러오는 중...',
      sourceContentEmpty: '콘텐츠 저장소에 이미지가 없습니다.',
      fileNone: '선택된 파일 없음',
      sourceLimitLabel: '최대 4장',
      sourceLimitReached: '소스 이미지는 최대 4장까지 등록할 수 있습니다.',
      sourcePrimary: '기준',
      sourceMovePrev: '앞으로 이동',
      sourceMoveNext: '뒤로 이동',
      promptPanelTitle: '프롬프트',
      reusePrompt: '프롬프트 복사',
      useAsSource: '소스 사용',
      regenerateVariation: '재생성',
      upscale2k: '업스케일 2K',
      analyzePrompt: '이미지 분석',
      analyzing: '분석중',
      analyzeFailed: '이미지 분석 실패: ',
      viewOriginal: '원본 보기',
      cameraButton: '카메라 앵글',
      cameraModalTitle: '카메라 앵글 조정',
      cameraModalDesc: '프리셋과 슬라이더를 조합해 다음 생성에 반영할 시점을 정해 주세요.',
      cameraPresetLabel: '앵글 프리셋',
      cameraPresetFront: '초기화',
      cameraPresetRear: '뒷면',
      cameraPresetLeft45: '좌 45°',
      cameraPresetRight45: '우 45°',
      cameraPresetUpperLeft45: '좌상 45°',
      cameraPresetUpperRight45: '우상 45°',
      cameraPresetLowerLeft45: '좌하 45°',
      cameraPresetLowerRight45: '우하 45°',
      cameraPresetHighAngle: '하이 앵글',
      cameraPresetLowAngle: '로우앵글',
      cameraPresetCloseUp: '클로즈업',
      cameraPresetWide: '와이드',
      cameraPresetCustom: 'Custom',
      cameraPan: 'Pan',
      cameraTilt: 'Tilt',
      cameraDistance: 'Distance',
      cameraPreviewLabel: '앵글 미리보기',
      cameraPromptPreviewLabel: '프롬프트 반영 문장',
      cameraTargetScene: '전체',
      cameraTargetSubject: '피사체',
      cameraTargetSceneLabel: '화면 전체 회전',
      cameraTargetSubjectLabel: '피사체만 회전',
      cameraApply: '적용',
      cameraReset: '초기화',
      cameraActiveTag: '앵글 적용됨',
      cameraSummaryOff: '카메라 앵글 제어가 꺼져 있습니다.',
      cameraMetaLabel: '카메라'
    },
    en: {
      pageTitle: 'NK_Studio · AI Image',
      brandSubtitle: 'AI image generation',
      navDashboard: 'Dashboard',
      navAiVideo: 'AI Video',
      navAiImage: 'AI Image',
      navLibrary: 'Content Library',
      heroTitle: 'AI Image Generator',
      heroDesc: 'Handle text generation and reference-based variation in one workspace.',
      sessionLabel: 'Session',
      projectLabel: 'Current episode',
      brandLabel: 'Current brand',
      noneLabel: 'None',
      noProject: 'No episode selected',
      noBrand: 'No brand selected',
      noProjectHelp: 'Select a project to load source images from its library and save results back.',
      modeText: 'Text to image',
      modeImage: 'Image to image',
      generationStyleLabel: 'Generation flow',
      generationStyleSingle: 'Single',
      generationStyleConversation: 'Conversational',
      generationStyleSingleShort: 'Single',
      generationStyleConversationShort: 'Conversational',
      sourceTitle: 'Source image',
      sourceEmpty: '',
      sourceUpload: 'Upload image',
      sourceProject: 'Load from project library',
      sourceBrand: 'Load from brand IP',
      sourceClear: 'Clear source',
      sourceProjectEmpty: 'No images found in the current project library.',
      sourceProjectLoading: 'Loading project library...',
      sourceBrandEmpty: 'No images found in the current brand IP library.',
      sourceBrandLoading: 'Loading brand IP library...',
      sourceSelected: 'Selected source',
      sourceLibraryTitle: 'Project library',
      sourceBrandTitle: 'Brand IP',
      sourceContentTitle: 'Content Library',
      promptLabel: 'Prompt',
      promptPlaceholderText: 'Describe the scene, style, lighting, composition, and textures you want.',
      promptPlaceholderImage: 'Describe what to preserve or transform from the source image. Example: keep the same composition and convert it into watercolor.',
      aspectLabel: 'Aspect ratio',
      sizeLabel: 'Image size',
      sizeFast: 'Fast (512)',
      sizeStd: 'Standard (1K)',
      sizeHigh: 'High (2K)',
      providerLabel: 'Image model',
      providerGemini: 'Gemini 3.1 Flash',
      providerOpenai: 'GPT Image 2',
      generate: 'Generate',
      generating: 'Generating...',
      resultsTitle: 'Results',
      resultsEmpty: 'No generated images yet.',
      deleteConfirm: 'Permanently delete this image?',
      deleteAllConfirm: 'Permanently delete every image in the generation history?',
      deleteLabel: 'Delete',
      deleteAllLabel: 'Delete all',
      download: 'Download',
      saveProject: 'Save to episode',
      saveBrand: 'Save to brand IP',
      savedBrand: 'Saved to brand IP',
      savedProject: 'Saved to project library',
      saveDisabled: 'A selected project is required to save this result.',
      saveBrandDisabled: 'A selected brand and character are required to save this result.',
      saveBrandNoCharacters: 'No registered characters are available in the current brand.',
      saveBrandChooseCharacter: 'Choose a character before saving to brand IP.',
      saveBrandSelectLabel: 'Brand character',
      saveBrandSelectPlaceholder: 'Select a character',
      openVideo: 'Open AI Video',
      loginRequired: 'Sign-in is required.',
      loginAction: 'Sign in',
      useInProject: 'Available as a source for the current project',
      createdAt: 'Created',
      modeTextShort: 'Text',
      modeImageShort: 'Image',
      promptRequired: 'Enter a prompt first.',
      sourceRequired: 'Select a source image first.',
      generationFailed: 'Image generation failed: ',
      projectLoadFailed: 'Failed to load project library: ',
      brandLoadFailed: 'Failed to load brand IP library: ',
      projectSaveFailed: 'Failed to save to project library: ',
      brandSaveFailed: 'Failed to save to brand IP: ',
      downloadFailed: 'Download failed: ',
      fileChoose: 'Choose file',
      latestResult: 'Primary preview',
      historyTitle: 'Generation history',
      resultSavedTag: 'Saved to episode',
      resultSavedBrandTag: 'Saved to brand IP',
      promptPanelTitle: 'Prompt',
      historyLoading: 'Loading session results...',
      historyLoadError: 'Failed to sync session results',
      promptCounterSuffix: '/4000',
      backToLogin: 'Go to sign-in page',
      sourceKindUpload: 'Upload',
      sourceKindProject: 'Project library',
      sourceKindBrand: 'Brand IP',
      sourceKindContent: 'Content Library',
      sourceContent: 'Load from Content Library',
      sourceContentTitle: 'Content Library Images',
      sourceContentLoading: 'Loading Content Library...',
      sourceContentEmpty: 'No images found in Content Library.',
      fileNone: 'No file selected',
      sourceLimitLabel: 'Up to 4 images',
      sourceLimitReached: 'You can register up to 4 source images.',
      sourcePrimary: 'Primary',
      sourceMovePrev: 'Move earlier',
      sourceMoveNext: 'Move later',
      reusePrompt: 'Copy to prompt',
      useAsSource: 'Use as source',
      regenerateVariation: 'Generate variation',
      upscale2k: 'Upscale (2K)',
      analyzePrompt: 'Analyze image',
      analyzing: 'Analyzing',
      analyzeFailed: 'Image analysis failed: ',
      viewOriginal: 'View original',
      cameraButton: 'Camera angle',
      cameraModalTitle: 'Adjust camera angle',
      cameraModalDesc: 'Combine presets and sliders to control the next generation angle.',
      cameraPresetLabel: 'Angle preset',
      cameraPresetFront: 'Reset',
      cameraPresetRear: 'Rear',
      cameraPresetLeft45: 'Left 45°',
      cameraPresetRight45: 'Right 45°',
      cameraPresetUpperLeft45: 'Upper.L 45°',
      cameraPresetUpperRight45: 'Upper.R 45°',
      cameraPresetLowerLeft45: 'Lower.L 45°',
      cameraPresetLowerRight45: 'Lower.R 45°',
      cameraPresetHighAngle: 'High angle',
      cameraPresetLowAngle: 'Low angle',
      cameraPresetCloseUp: 'Close-up',
      cameraPresetWide: 'Wide',
      cameraPresetCustom: 'Custom',
      cameraPan: 'Pan',
      cameraTilt: 'Tilt',
      cameraDistance: 'Distance',
      cameraPreviewLabel: 'Angle preview',
      cameraPromptPreviewLabel: 'Prompt injection',
      cameraTargetScene: 'Whole scene',
      cameraTargetSubject: 'Subject',
      cameraTargetSceneLabel: 'Rotate the whole scene',
      cameraTargetSubjectLabel: 'Rotate the subject only',
      cameraApply: 'Apply',
      cameraReset: 'Reset',
      cameraActiveTag: 'Angle enabled',
      cameraSummaryOff: 'Camera angle control is currently off.',
      cameraMetaLabel: 'Camera'
    }
  };

  function t(key) {
    var lang = state.lang === 'en' ? 'en' : 'ko';
    return (TEXT[lang] && TEXT[lang][key]) || key;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  var CAMERA_FRONT_PAN = 0;
  var CAMERA_PAN_MIN = 0;
  var CAMERA_PAN_MAX = 359;
  var CAMERA_TILT_MIN = -30;
  var CAMERA_TILT_MAX = 60;
  var CAMERA_DISTANCE_MIN = 0;
  var CAMERA_DISTANCE_MAX = 2;
  var CAMERA_ORBIT_EQUATOR_X_RATIO = 0.92;
  var CAMERA_ORBIT_EQUATOR_Y_RATIO = 0.27;

  function createDefaultCameraControls() {
    return {
      orbitPan: true,
      enabled: true,
      preset: 'front',
      pan: CAMERA_FRONT_PAN,
      tilt: 0,
      distance: 1
    };
  }

  function clampNumber(value, min, max, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) num = Number(fallback);
    if (!Number.isFinite(num)) num = min;
    return Math.min(max, Math.max(min, num));
  }

  function wrapPanDegrees(value, fallback) {
    var num = Number(value);
    if (!Number.isFinite(num)) num = Number(fallback);
    if (!Number.isFinite(num)) num = CAMERA_FRONT_PAN;
    var wrapped = num % 360;
    if (wrapped < 0) wrapped += 360;
    return Math.round(wrapped);
  }

  function legacyDistanceToStage(distance) {
    var value = clampNumber(distance, 0, 100, 50);
    if (value <= 33) return 0;
    if (value <= 66) return 1;
    return 2;
  }

  function cameraRelativePanDegrees(raw) {
    var controls = raw && typeof raw === 'object' ? raw : createDefaultCameraControls();
    var delta = wrapPanDegrees(controls.pan, CAMERA_FRONT_PAN) - CAMERA_FRONT_PAN;
    if (delta > 180) delta -= 360;
    if (delta <= -180) delta += 360;
    return Math.round(delta);
  }

  function normalizeCameraControls(raw) {
    var base = raw && typeof raw === 'object' ? raw : {};
    var preset = String(base.preset || 'custom').trim().toLowerCase();
    if (!/^(front|rear|left45|right45|upperleft45|upperright45|lowerleft45|lowerright45|highangle|lowangle|closeup|wide|custom)$/.test(preset)) preset = 'custom';
    var panValue = Number(base.pan);
    var tiltValue = Number(base.tilt);
    var distanceValue = Number(base.distance);
    var orbitPan = base.orbitPan === true
      || (panValue >= CAMERA_PAN_MIN && panValue <= CAMERA_PAN_MAX && distanceValue >= CAMERA_DISTANCE_MIN && distanceValue <= CAMERA_DISTANCE_MAX);
    var normalized = {
      orbitPan: true,
      enabled: !!base.enabled,
      preset: preset,
      pan: orbitPan
        ? wrapPanDegrees(panValue, CAMERA_FRONT_PAN)
        : wrapPanDegrees(CAMERA_FRONT_PAN + clampNumber(panValue, -180, 180, 0), CAMERA_FRONT_PAN),
      tilt: clampNumber(tiltValue, CAMERA_TILT_MIN, CAMERA_TILT_MAX, 0),
      distance: orbitPan
        ? clampNumber(distanceValue, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX, 1)
        : legacyDistanceToStage(distanceValue)
    };
    normalized.enabled = normalized.enabled && !isNeutralCameraControls(normalized);
    return normalized;
  }

  function cloneCameraControls(raw) {
    return normalizeCameraControls(raw);
  }

  function normalizeHistoryPanelMode(value) {
    return String(value || '').trim().toLowerCase() === 'camera' ? 'camera' : 'history';
  }

  function normalizeCameraTargetMode(value) {
    return String(value || '').trim().toLowerCase() === 'subject' ? 'subject' : 'scene';
  }

  function isNeutralCameraControls(raw) {
    var controls = raw && typeof raw === 'object' ? raw : createDefaultCameraControls();
    var distanceValue = Number(controls.distance);
    return wrapPanDegrees(controls.pan, CAMERA_FRONT_PAN) === CAMERA_FRONT_PAN
      && Number(controls.tilt || 0) === 0
      && (Number.isFinite(distanceValue) ? distanceValue : 1) === 1
      && (!controls.enabled || String(controls.preset || '').toLowerCase() === 'front');
  }

  function distanceBucket(distance) {
    var value = clampNumber(distance, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX, 1);
    if (value <= 0) return 'close-up';
    if (value <= 1) return 'medium-shot';
    return 'wide-shot';
  }

  function lerpNumber(start, end, amount) {
    var t = clampNumber(amount, 0, 1, 0);
    return start + ((end - start) * t);
  }

  function roundPreviewNumber(value) {
    return Math.round(Number(value || 0) * 10) / 10;
  }

  function formatOrbitSvgNumber(value) {
    var num = roundPreviewNumber(value);
    return String(num);
  }

  function computeCameraOrbitPreview(raw) {
    var controls = normalizeCameraControls(raw);
    var viewBoxWidth = 400;
    var viewBoxHeight = 340;
    var centerX = 200;
    var centerY = 170;
    var sphereRadius = 132;
    var equatorRadiusX = sphereRadius * CAMERA_ORBIT_EQUATOR_X_RATIO;
    var equatorRadiusY = sphereRadius * CAMERA_ORBIT_EQUATOR_Y_RATIO;
    var axisRadius = sphereRadius * 0.83;
    var panRad = wrapPanDegrees(controls.pan, CAMERA_FRONT_PAN) * Math.PI / 180;
    var previewPanRad = (Math.PI / 2) - panRad;
    var distanceRatio = clampNumber((controls.distance - CAMERA_DISTANCE_MIN) / (CAMERA_DISTANCE_MAX - CAMERA_DISTANCE_MIN), 0, 1, 0.5);
    var positiveTiltRatio = clampNumber(controls.tilt / CAMERA_TILT_MAX, 0, 1, 0);
    var negativeTiltRatio = clampNumber(Math.abs(Math.min(controls.tilt, 0)) / Math.abs(CAMERA_TILT_MIN), 0, 1, 0);
    var orbitRadiusX = distanceRatio <= 0.5
      ? lerpNumber(equatorRadiusX * 0.74, equatorRadiusX, distanceRatio / 0.5)
      : lerpNumber(equatorRadiusX, equatorRadiusX * 1.08, (distanceRatio - 0.5) / 0.5);
    var orbitRadiusY = distanceRatio <= 0.5
      ? lerpNumber(equatorRadiusY * 0.74, equatorRadiusY, distanceRatio / 0.5)
      : lerpNumber(equatorRadiusY, equatorRadiusY * 1.08, (distanceRatio - 0.5) / 0.5);
    var horizontalCompression = clampNumber(1 - (positiveTiltRatio * 0.82) + (negativeTiltRatio * 0.08), 0.18, 1.08, 1);
    var depthScale = clampNumber(1 - (positiveTiltRatio * 0.72), 0.22, 1, 1);
    var orbitX = centerX + (Math.cos(previewPanRad) * orbitRadiusX * horizontalCompression);
    var orbitY = centerY + (Math.sin(previewPanRad) * orbitRadiusY * depthScale);
    var tiltOffset = lerpNumber(0, -108, positiveTiltRatio) + lerpNumber(0, 82, negativeTiltRatio);
    var cameraX = roundPreviewNumber(clampNumber(orbitX, 72, 328, centerX));
    var cameraY = roundPreviewNumber(clampNumber(orbitY + tiltOffset, 54, 286, centerY));
    var focusPull = lerpNumber(0.48, 0.44, distanceRatio);
    var focusX = roundPreviewNumber(centerX + ((cameraX - centerX) * focusPull));
    var focusY = roundPreviewNumber(centerY + ((cameraY - centerY) * focusPull));
    return {
      x: cameraX,
      y: cameraY,
      focusX: focusX,
      focusY: focusY,
      viewBoxWidth: viewBoxWidth,
      viewBoxHeight: viewBoxHeight,
      centerX: centerX,
      centerY: centerY,
      sphereRadius: sphereRadius,
      equatorRadiusX: roundPreviewNumber(equatorRadiusX),
      equatorRadiusY: roundPreviewNumber(equatorRadiusY),
      axisRadius: roundPreviewNumber(axisRadius),
      distanceRatio: distanceRatio,
      cameraRadius: roundPreviewNumber(lerpNumber(15, 18, distanceRatio))
    };
  }

  function buildCameraOrbitSvgMarkup(preview) {
    var data = preview && typeof preview === 'object' ? preview : computeCameraOrbitPreview(createDefaultCameraControls());
    var cx = Number(data.centerX || 200);
    var cy = Number(data.centerY || 170);
    var sphereRadius = Number(data.sphereRadius || 132);
    var equatorRadiusX = Number(data.equatorRadiusX || (sphereRadius * CAMERA_ORBIT_EQUATOR_X_RATIO));
    var equatorRadiusY = Number(data.equatorRadiusY || (sphereRadius * CAMERA_ORBIT_EQUATOR_Y_RATIO));
    var axisRadius = Number(data.axisRadius || (sphereRadius * 0.83));
    var cameraX = Number(data.x || cx);
    var cameraY = Number(data.y || cy);
    var focusX = Number(data.focusX || cx);
    var focusY = Number(data.focusY || cy);
    var cameraRadius = Number(data.cameraRadius || 16);
    var meridians = [-72, -36, 0, 36, 72].map(function (deg) {
      return '<ellipse class="ai-image-camera-orbit-meridian" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(cy) + '" rx="' + formatOrbitSvgNumber(sphereRadius * 0.33) + '" ry="' + formatOrbitSvgNumber(sphereRadius) + '" transform="rotate(' + String(deg) + ' ' + formatOrbitSvgNumber(cx) + ' ' + formatOrbitSvgNumber(cy) + ')" />';
    }).join('');
    var latitudes = [-64, -32, 32, 64].map(function (deg) {
      var rad = deg * Math.PI / 180;
      var rx = Math.cos(rad) * sphereRadius * 0.96;
      var ry = Math.max(5, 12 + (Math.cos(rad) * 15));
      var y = cy + (Math.sin(rad) * sphereRadius * 0.54);
      return '<ellipse class="ai-image-camera-orbit-latitude" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(y) + '" rx="' + formatOrbitSvgNumber(rx) + '" ry="' + formatOrbitSvgNumber(ry) + '" />';
    }).join('');
    return '' +
      '<svg viewBox="0 0 400 340" class="ai-image-camera-orbit-svg" aria-hidden="true">' +
        '<defs>' +
          '<radialGradient id="aiImageSphereGlow" cx="50%" cy="45%" r="50%">' +
            '<stop offset="0%" stop-color="rgba(255,255,255,0.03)"></stop>' +
            '<stop offset="100%" stop-color="rgba(255,255,255,0)"></stop>' +
          '</radialGradient>' +
        '</defs>' +
        '<circle class="ai-image-camera-orbit-glow" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(cy) + '" r="' + formatOrbitSvgNumber(sphereRadius) + '" fill="url(#aiImageSphereGlow)"></circle>' +
        meridians +
        latitudes +
        '<ellipse class="ai-image-camera-orbit-equator" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(cy) + '" rx="' + formatOrbitSvgNumber(equatorRadiusX) + '" ry="' + formatOrbitSvgNumber(equatorRadiusY) + '"></ellipse>' +
        '<line class="ai-image-camera-orbit-axis" x1="' + formatOrbitSvgNumber(cx) + '" y1="' + formatOrbitSvgNumber(cy - axisRadius) + '" x2="' + formatOrbitSvgNumber(cx) + '" y2="' + formatOrbitSvgNumber(cy + axisRadius) + '"></line>' +
        '<circle class="ai-image-camera-orbit-pole is-top" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(cy - axisRadius) + '" r="3"></circle>' +
        '<circle class="ai-image-camera-orbit-pole is-bottom" cx="' + formatOrbitSvgNumber(cx) + '" cy="' + formatOrbitSvgNumber(cy + axisRadius) + '" r="2.5"></circle>' +
        '<g class="ai-image-camera-orbit-subject" transform="translate(' + formatOrbitSvgNumber(cx) + ' ' + formatOrbitSvgNumber(cy) + ')">' +
          '<circle class="ai-image-camera-orbit-subject-glow" r="22"></circle>' +
          '<circle class="ai-image-camera-orbit-subject-core" r="8.5"></circle>' +
        '</g>' +
        '<line class="ai-image-camera-orbit-ray" x1="' + formatOrbitSvgNumber(cx) + '" y1="' + formatOrbitSvgNumber(cy) + '" x2="' + formatOrbitSvgNumber(cameraX) + '" y2="' + formatOrbitSvgNumber(cameraY) + '"></line>' +
        '<circle class="ai-image-camera-orbit-focus" cx="' + formatOrbitSvgNumber(focusX) + '" cy="' + formatOrbitSvgNumber(focusY) + '" r="5"></circle>' +
        '<g class="ai-image-camera-orbit-camera" transform="translate(' + formatOrbitSvgNumber(cameraX) + ' ' + formatOrbitSvgNumber(cameraY) + ')">' +
          '<circle class="ai-image-camera-orbit-camera-ring" r="' + formatOrbitSvgNumber(cameraRadius) + '"></circle>' +
        '</g>' +
      '</svg>';
  }

  function cameraPresetLabel(preset) {
    var keyMap = {
      front: 'cameraPresetFront',
      rear: 'cameraPresetRear',
      left45: 'cameraPresetLeft45',
      right45: 'cameraPresetRight45',
      upperleft45: 'cameraPresetUpperLeft45',
      upperright45: 'cameraPresetUpperRight45',
      lowerleft45: 'cameraPresetLowerLeft45',
      lowerright45: 'cameraPresetLowerRight45',
      highangle: 'cameraPresetHighAngle',
      lowangle: 'cameraPresetLowAngle',
      closeup: 'cameraPresetCloseUp',
      wide: 'cameraPresetWide',
      custom: 'cameraPresetCustom'
    };
    return t(keyMap[String(preset || 'custom')] || 'cameraPresetCustom');
  }

  function distanceLabel(distance) {
    var bucket = distanceBucket(distance);
    if (state.lang === 'en') {
      if (bucket === 'close-up') return 'close-up';
      if (bucket === 'medium-shot') return 'medium shot';
      return 'wide shot';
    }
    if (bucket === 'close-up') return '클로즈업';
    if (bucket === 'medium-shot') return '미디엄 샷';
    return '와이드 샷';
  }

  function cameraPresetDefaults(preset) {
    var next = createDefaultCameraControls();
    next.preset = preset;
    next.enabled = true;
    try {
      var presets = (window.NK && NK.constants && NK.constants.CAMERA_PRESETS) ? NK.constants.CAMERA_PRESETS : null;
      if (presets && presets[preset]) {
        next.pan = Number(presets[preset].pan || CAMERA_FRONT_PAN);
        next.tilt = Number(presets[preset].tilt || 0);
        next.distance = Number.isFinite(Number(presets[preset].distance)) ? Number(presets[preset].distance) : 1;
        return next;
      }
    } catch (_) {}
    if (preset === 'front') { next.pan = CAMERA_FRONT_PAN; next.tilt = 0; next.distance = 1; }
    else if (preset === 'rear') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN + 180, CAMERA_FRONT_PAN); next.tilt = 0; next.distance = 1; }
    else if (preset === 'left45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN - 45, CAMERA_FRONT_PAN); next.tilt = 0; next.distance = 1; }
    else if (preset === 'right45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN + 45, CAMERA_FRONT_PAN); next.tilt = 0; next.distance = 1; }
    else if (preset === 'upperleft45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN - 45, CAMERA_FRONT_PAN); next.tilt = 24; next.distance = 1; }
    else if (preset === 'upperright45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN + 45, CAMERA_FRONT_PAN); next.tilt = 24; next.distance = 1; }
    else if (preset === 'lowerleft45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN - 45, CAMERA_FRONT_PAN); next.tilt = -24; next.distance = 1; }
    else if (preset === 'lowerright45') { next.pan = wrapPanDegrees(CAMERA_FRONT_PAN + 45, CAMERA_FRONT_PAN); next.tilt = -24; next.distance = 1; }
    else if (preset === 'highangle') { next.pan = CAMERA_FRONT_PAN; next.tilt = 24; next.distance = 1; }
    else if (preset === 'lowangle') { next.pan = CAMERA_FRONT_PAN; next.tilt = -24; next.distance = 1; }
    else if (preset === 'closeup') { next.pan = CAMERA_FRONT_PAN; next.tilt = 0; next.distance = 0; }
    else if (preset === 'wide') { next.pan = CAMERA_FRONT_PAN; next.tilt = 0; next.distance = 2; }
    return next;
  }

  function applyCameraPreset(preset) {
    state.cameraControls = cloneCameraControls(cameraPresetDefaults(String(preset || 'custom')));
  }

  function resetCameraControls() {
    state.cameraControls = createDefaultCameraControls();
    state.cameraTargetMode = 'scene';
  }

  function activeCameraControls() {
    var result = currentResult();
    if (result && result.cameraControls) return normalizeCameraControls(result.cameraControls);
    return normalizeCameraControls(state.cameraControls);
  }

  function cameraControlSignature(raw) {
    var controls = normalizeCameraControls(raw);
    return [
      controls.orbitPan ? '1' : '0',
      controls.enabled ? '1' : '0',
      controls.preset,
      controls.pan,
      controls.tilt,
      controls.distance
    ].join(':');
  }

  function cameraTargetModeLabel(mode) {
    return normalizeCameraTargetMode(mode) === 'subject'
      ? t('cameraTargetSubject')
      : t('cameraTargetScene');
  }

  function cameraSummary(raw, targetMode) {
    var controls = normalizeCameraControls(raw);
    var bits = [cameraTargetModeLabel(targetMode)];
    if (!controls.enabled || isNeutralCameraControls(controls)) {
      bits.push(t('cameraSummaryOff'));
      return bits.join(state.lang === 'en' ? ' · ' : ' · ');
    }
    bits.push(cameraPresetLabel(controls.preset));
    bits.push(state.lang === 'en'
      ? ('pan ' + controls.pan + 'deg')
      : ('pan ' + controls.pan + '도'));
    bits.push(state.lang === 'en'
      ? ('tilt ' + controls.tilt + 'deg')
      : ('tilt ' + controls.tilt + '도'));
    bits.push(state.lang === 'en'
      ? ('distance ' + controls.distance)
      : ('거리 ' + controls.distance + '단계'));
    return bits.join(state.lang === 'en' ? ' · ' : ' · ');
  }

  function buildCameraPromptBlock(raw) {
    var controls = normalizeCameraControls(raw);
    if (!controls.enabled || isNeutralCameraControls(controls)) return '';
    var relativePan = cameraRelativePanDegrees(controls);
    var shotLabel = distanceLabel(controls.distance);
    if (state.lang === 'en') {
      var panLineEn = relativePan ? ('Orbit the camera ' + (relativePan > 0 ? 'right' : 'left') + ' by ' + Math.abs(relativePan) + ' degrees around the subject.') : 'Keep the camera at the front-facing orbit position.';
      var tiltLineEn = controls.tilt ? ('Tilt ' + (controls.tilt > 0 ? 'up' : 'down') + ' by ' + Math.abs(controls.tilt) + ' degrees.') : 'Keep tilt at eye level.';
      return [
        'Camera direction:',
        '- Preset: ' + cameraPresetLabel(controls.preset),
        '- ' + panLineEn,
        '- ' + tiltLineEn,
        '- Distance stage: ' + controls.distance + ' (' + shotLabel + ').',
        '- Keep the subject clearly readable while preserving the requested scene and style.'
      ].join('\n');
    }
    var panLineKo = relativePan ? ('카메라를 피사체 기준 ' + (relativePan > 0 ? '오른쪽' : '왼쪽') + '으로 ' + Math.abs(relativePan) + '도 공전.') : '카메라는 정면 공전 위치 유지.';
    var tiltLineKo = controls.tilt ? ('Tilt를 ' + (controls.tilt > 0 ? '위로' : '아래로') + ' ' + Math.abs(controls.tilt) + '도 조정.') : 'Tilt는 아이레벨 유지.';
    return [
      '카메라 연출:',
      '- 프리셋: ' + cameraPresetLabel(controls.preset),
      '- ' + panLineKo,
      '- ' + tiltLineKo,
      '- 거리 단계: ' + controls.distance + ' (' + shotLabel + ')',
      '- 피사체는 또렷하게 보이게 유지하고 요청한 장면과 스타일을 우선 반영.'
    ].join('\n');
  }

  function buildPromptWithCameraControls(basePrompt, raw) {
    var prompt = String(basePrompt || '').trim();
    var build = (window.NK && NK.utils && typeof NK.utils.buildCameraPrompt === 'function') ? NK.utils.buildCameraPrompt : (typeof window.buildCameraPrompt === 'function' ? window.buildCameraPrompt : null);
    var cameraText = build ? build(raw) : '';
    if (!cameraText) {
      var fallback = (window.NK && NK.utils && typeof NK.utils.mapCameraToPrompt === 'function') ? NK.utils.mapCameraToPrompt : (typeof window.mapCameraToPrompt === 'function' ? window.mapCameraToPrompt : null);
      cameraText = fallback ? fallback(raw) : '';
    }
    if (!cameraText) return prompt;
    return prompt ? (prompt + ', ' + cameraText) : cameraText;
  }

  function formatDate(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    try {
      var d = new Date(raw);
      if (Number.isNaN(d.getTime())) return raw;
      return state.lang === 'en'
        ? d.toLocaleString('en-US')
        : d.toLocaleString('ko-KR');
    } catch (_) {
      return raw;
    }
  }

  function isTimeoutLikeImagenError(err) {
    var raw = String((err && err.message) || err || '').trim();
    return /request_timeout|response_timeout|timeout|aborted|network_error|failed to fetch/i.test(raw);
  }

  function shouldRetryImagenRequest(err) {
    var status = Number(err && err.status) || 0;
    return status >= 500 || isTimeoutLikeImagenError(err);
  }

  function readTheme() {
    try {
      return localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.THEME) || 'nk_theme') || 'dark';
    } catch (_) {
      return 'dark';
    }
  }

  function readThemeVariant(theme) {
    try {
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.THEME_VARIANT) || 'nk_theme_variant';
      var fallback = theme === 'light' ? 'light-classic' : 'dark-classic';
      var value = String(localStorage.getItem(key) || '').trim();
      return value && value.indexOf(theme + '-') === 0 ? value : fallback;
    } catch (_) {
      return theme === 'light' ? 'light-classic' : 'dark-classic';
    }
  }

  function readLang() {
    try {
      var value = localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang') || 'ko';
      return value === 'en' ? 'en' : 'ko';
    } catch (_) {
      return 'ko';
    }
  }

  function ensureSessionId() {
    try {
      var current = String(localStorage.getItem(STORAGE_SESSION_KEY) || '').trim();
      if (current) return current;
      var next = 'img_' + Date.now();
      localStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) {
      return 'img_' + Date.now();
    }
  }

  function getHistoryStorageKey() {
    return STORAGE_HISTORY_PREFIX + String(state.sessionId || 'default');
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(getHistoryStorageKey()) || '[]';
      var parsed = JSON.parse(raw);
      state.results = Array.isArray(parsed) ? parsed.map(function (item) {
        var row = item && typeof item === 'object' ? item : {};
        if (row.cameraControls) row.cameraControls = normalizeCameraControls(row.cameraControls);
        row.cameraTargetMode = normalizeCameraTargetMode(row.cameraTargetMode);
        return row;
      }) : [];
      state.currentResultId = '';
      state.previewTargetType = 'none';
      state.historyPanelMode = 'history';
      state.cameraTargetMode = 'scene';
      state.cameraControls = createDefaultCameraControls();
    } catch (_) {
      state.results = [];
      state.currentResultId = '';
      state.previewTargetType = 'none';
      state.historyPanelMode = 'history';
      state.cameraTargetMode = 'scene';
      state.cameraControls = createDefaultCameraControls();
    }
  }

  function persistHistory() {
    try {
      localStorage.setItem(getHistoryStorageKey(), JSON.stringify(state.results.slice(0, 30)));
    } catch (_) { }
  }

  function readCurrentProject() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.project && NK.service.project.resolveCurrent)
        ? NK.service.project.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) {
      return null;
    }
  }

  function readCurrentBrand() {
    try {
      var qp = new URLSearchParams(String(window.location.search || ''));
      if (String(qp.get('detached') || '').trim() === '1') return null;
      return (NK.service && NK.service.brand && NK.service.brand.resolveCurrent)
        ? NK.service.brand.resolveCurrent({ search: window.location.search })
        : null;
    } catch (_) {
      return null;
    }
  }

  function currentResult() {
    var match = state.results.find(function (item) {
      return String(item && item.id || '') === String(state.currentResultId || '');
    });
    return match || null;
  }

  function currentPreviewTarget() {
    var previewType = String(state.previewTargetType || 'none').trim().toLowerCase();
    var selectedSource = primarySourceImage();
    var selectedResult = currentResult();
    if (previewType === 'source' && selectedSource) {
      return {
        type: 'source',
        id: String(selectedSource.id || ''),
        url: String(selectedSource.url || '').trim(),
        name: String(selectedSource.name || '').trim(),
        sourceKind: String(selectedSource.kind || 'upload').trim(),
        cameraTargetMode: normalizeCameraTargetMode(state.cameraTargetMode),
        cameraControls: normalizeCameraControls(state.cameraControls),
        source: selectedSource
      };
    }
    if (previewType === 'result' && selectedResult) {
      return {
        type: 'result',
        id: String(selectedResult.id || ''),
        url: resolveResultUrl(selectedResult),
        name: String(selectedResult.objectName || selectedResult.id || '').trim(),
        sourceKind: '',
        cameraTargetMode: normalizeCameraTargetMode(selectedResult && selectedResult.cameraTargetMode
          ? selectedResult.cameraTargetMode
          : state.cameraTargetMode),
        cameraControls: selectedResult && selectedResult.cameraControls
          ? normalizeCameraControls(selectedResult.cameraControls)
          : normalizeCameraControls(state.cameraControls),
        result: selectedResult
      };
    }
    return null;
  }

  function currentPreviewResult() {
    var preview = currentPreviewTarget();
    return preview && preview.type === 'result' ? preview.result : null;
  }

  function currentPreviewUrl() {
    var preview = currentPreviewTarget();
    return preview ? String(preview.url || '').trim() : '';
  }

  function brandCharacterSignature() {
    return brandCharacterOptions().map(function (item) {
      return String(item && item.token || '') + ':' + String(item && item.label || '');
    }).join('|');
  }

  function historyPanelSignature() {
    return [
      state.lang,
      normalizeHistoryPanelMode(state.historyPanelMode),
      String(state.currentResultId || ''),
      state.historyLoading ? '1' : '0',
      state.historyLoadError ? '1' : '0',
      normalizeCameraTargetMode(state.cameraTargetMode),
      cameraControlSignature(state.cameraControls),
      state.results.map(function (item) {
        var row = item && typeof item === 'object' ? item : {};
        return [
          String(row.id || ''),
          String(resolveResultUrl(row) || ''),
          String(row.prompt || ''),
          String(row.mode || ''),
          String(row.generationStyle || ''),
          normalizeCameraTargetMode(row.cameraTargetMode),
          cameraControlSignature(row.cameraControls),
          row.savedToProject ? '1' : '0'
        ].join('~');
      }).join('||')
    ].join('::');
  }

  function previewPanelSignature(selectedPreview, detached) {
    var preview = selectedPreview && typeof selectedPreview === 'object' ? selectedPreview : {};
    var row = preview.result && typeof preview.result === 'object' ? preview.result : {};
    return [
      state.lang,
      detached ? '1' : '0',
      String(state.currentProject && state.currentProject.id || ''),
      String(state.currentBrand && state.currentBrand.brandId || ''),
      brandCharacterSignature(),
      preview.type === 'result' ? selectedBrandCharacterToken(row) : '',
      String(preview.type || ''),
      String(preview.id || ''),
      String(preview.url || ''),
      String(preview.name || ''),
      String(preview.sourceKind || ''),
      normalizeCameraTargetMode(preview.cameraTargetMode),
      String(row.prompt || ''),
      String(row.mode || ''),
      String(row.generationStyle || ''),
      normalizeHistoryPanelMode(state.historyPanelMode),
      cameraControlSignature(preview.cameraControls),
      row.savedToProject ? '1' : '0'
    ].join('::');
  }

  function promptPanelSignature(detached, project) {
    return [
      state.lang,
      detached ? '1' : '0',
      String(project && project.id || ''),
      String(state.currentBrand && state.currentBrand.brandId || ''),
      String(state.mode || ''),
      String(state.prompt || ''),
      String(state.imageSize || ''),
      String(state.aspectRatio || ''),
      String(normalizeGenerationStyle(state.generationStyle) || ''),
      normalizeCameraTargetMode(state.cameraTargetMode),
      cameraControlSignature(state.cameraControls),
      state.libraryLoading ? '1' : '0',
      state.brandLibraryLoading ? '1' : '0',
      state.contentLibraryLoading ? '1' : '0',
      JSON.stringify(state.sourceSectionCollapsed || {}),
      getSourceImages().map(function (item) {
        var row = item && typeof item === 'object' ? item : {};
        return [
          String(row.id || ''),
          String(row.url || ''),
          String(row.name || ''),
          String(row.kind || '')
        ].join('~');
      }).join('||'),
      state.projectLibraryItems.map(function (item) {
        return String(resolveLibraryItemUrl(item) || '');
      }).join('|'),
      state.brandLibraryItems.map(function (item) {
        return String(resolveLibraryItemUrl(item) || '');
      }).join('|'),
      state.contentLibraryItems.map(function (item) {
        return String(resolveContentItemUrl(item) || '');
      }).join('|')
    ].join('::');
  }

  function sourceSelectionSignature() {
    return [
      state.lang,
      String(state.selectedSourceId || ''),
      getSourceImages().map(function (item) {
        var row = item && typeof item === 'object' ? item : {};
        return [
          String(row.id || ''),
          String(row.url || ''),
          String(row.name || ''),
          String(row.kind || '')
        ].join('~');
      }).join('||')
    ].join('::');
  }

  function normalizeGenerationStyle(value) {
    var raw = String(value || '').trim().toLowerCase();
    return raw === 'conversation' ? 'conversation' : 'single';
  }

  function normalizeProviderValue(value) {
    var raw = String(value || '').trim().toLowerCase();
    return raw === 'openai' ? 'openai' : 'gemini';
  }

  function readStoredProvider() {
    try {
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider';
      return normalizeProviderValue(localStorage.getItem(key) || 'gemini');
    } catch (_) {
      return 'gemini';
    }
  }

  function generationStyleShortLabel(value) {
    return normalizeGenerationStyle(value) === 'conversation'
      ? t('generationStyleConversationShort')
      : t('generationStyleSingleShort');
  }

  function buildConversationHistory(limit) {
    if (normalizeGenerationStyle(state.generationStyle) !== 'conversation') return [];
    var maxTurns = Math.max(0, Number(limit) || 3);
    if (!maxTurns) return [];
    var selectedId = String(state.currentResultId || '').trim();
    var ordered = state.results.slice().sort(function (a, b) {
      return new Date(String(a && a.createdAt || 0)).getTime() - new Date(String(b && b.createdAt || 0)).getTime();
    });
    if (selectedId) {
      var cutIndex = ordered.findIndex(function (item) {
        return String(item && item.id || '') === selectedId;
      });
      if (cutIndex >= 0) ordered = ordered.slice(0, cutIndex + 1);
    }
    return ordered.filter(function (item) {
      return !!(item && item.prompt && resolveResultUrl(item));
    }).slice(-maxTurns).map(function (item) {
      return {
        resultId: String(item.id || '').trim(),
        prompt: String(item.prompt || '').trim(),
        imageDataUrl: resolveResultUrl(item),
        mode: String(item.mode || 'text-to-image').trim(),
        generationStyle: normalizeGenerationStyle(item.generationStyle || 'single'),
        createdAt: String(item.createdAt || '').trim()
      };
    });
  }

  function extractObjectTimestamp(objectName) {
    var raw = String(objectName || '').trim();
    var match = raw.match(/\/(\d{13})-[^/]+\.(?:png|jpg|jpeg|webp)$/i);
    if (!match) return 0;
    var stamp = Number(match[1] || 0);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function resolveResultUrl(result) {
    var row = result && typeof result === 'object' ? result : {};
    var objectName = String(row.objectName || '').trim();
    if (objectName && NK.api && NK.api.mediaProxyObjectUrl) {
      return NK.api.mediaProxyObjectUrl(objectName);
    }
    return String(row.url || '').trim();
  }

  function getDeletedStorageKey() {
    return STORAGE_HISTORY_PREFIX + String(state.sessionId || 'default') + '_deleted';
  }
  function loadDeletedSet() {
    try {
      var raw = localStorage.getItem(getDeletedStorageKey()) || '[]';
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) state.deletedObjectNames = arr.filter(function (s) { return typeof s === 'string' && s.trim(); });
    } catch (_) { state.deletedObjectNames = []; }
  }
  function persistDeletedSet() {
    try { localStorage.setItem(getDeletedStorageKey(), JSON.stringify(state.deletedObjectNames || [])); } catch (_) {}
  }
  function addDeletedTombstone(objectName) {
    var name = String(objectName || '').trim();
    if (!name) return;
    if (!Array.isArray(state.deletedObjectNames)) state.deletedObjectNames = [];
    if (state.deletedObjectNames.indexOf(name) < 0) {
      state.deletedObjectNames.push(name);
      persistDeletedSet();
    }
  }

  function mergeServerResults(items) {
    var incoming = Array.isArray(items) ? items : [];
    var map = new Map();
    var deleted = new Set(Array.isArray(state.deletedObjectNames) ? state.deletedObjectNames : []);
    state.results.forEach(function (item, index) {
      var row = item && typeof item === 'object' ? cloneJson(item, {}) : {};
      var key = String(row.objectName || row.id || ('local_' + index)).trim();
      if (!key) return;
      map.set(key, row);
    });
    incoming.forEach(function (item, index) {
      var row = item && typeof item === 'object' ? item : {};
      var objectName = String(row.name || row.objectName || '').trim();
      if (!objectName) return;
      if (deleted.has(objectName)) return;
      var existing = map.get(objectName) || {};
      var createdAt = String(
        existing.createdAt
        || row.updated
        || row.timeCreated
        || (extractObjectTimestamp(objectName) ? new Date(extractObjectTimestamp(objectName)).toISOString() : '')
      ).trim();
      map.set(objectName, Object.assign({}, existing, {
        id: String(existing.id || ('res_' + objectName.replace(/[^a-z0-9]+/gi, '_') || index)),
        objectName: objectName,
        url: String(existing.url || row.signedUrl || '').trim(),
        prompt: String(existing.prompt || '').trim(),
        mode: String(existing.mode || 'text-to-image').trim(),
        generationStyle: normalizeGenerationStyle(existing.generationStyle || 'single'),
        conversationTurnCount: Number(existing.conversationTurnCount || 0) || 0,
        aspectRatio: String(existing.aspectRatio || '').trim(),
        createdAt: createdAt || new Date().toISOString(),
        sessionId: String(existing.sessionId || state.sessionId || '').trim(),
        cameraTargetMode: normalizeCameraTargetMode(existing.cameraTargetMode),
        cameraControls: existing.cameraControls ? normalizeCameraControls(existing.cameraControls) : undefined,
        savedToProject: existing.savedToProject === true,
        savedBrandTargets: Array.isArray(existing.savedBrandTargets) ? existing.savedBrandTargets.slice() : [],
        selectedBrandCharacterToken: String(existing.selectedBrandCharacterToken || '').trim()
      }));
    });
    state.results = Array.from(map.values()).sort(function (a, b) {
      return new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime();
    }).slice(0, 30);
    if (!state.currentResultId || !state.results.some(function (item) {
      return String(item.id || '') === String(state.currentResultId || '');
    })) {
      state.currentResultId = '';
      if (String(state.previewTargetType || '') === 'result') state.previewTargetType = 'none';
    }
    var selectedResult = currentResult();
    if (selectedResult && selectedResult.cameraControls) {
      state.cameraControls = normalizeCameraControls(selectedResult.cameraControls);
      state.cameraTargetMode = normalizeCameraTargetMode(selectedResult.cameraTargetMode);
    } else if (String(state.previewTargetType || '') !== 'source') {
      state.cameraTargetMode = 'scene';
      state.cameraControls = createDefaultCameraControls();
    }
  }

  function getSourceImages() {
    return Array.isArray(state.sourceImages) ? state.sourceImages : [];
  }

  function ensureSelectedSourceId() {
    var items = getSourceImages();
    var selectedId = String(state.selectedSourceId || '').trim();
    if (selectedId && items.some(function (item) { return String(item && item.id || '') === selectedId; })) {
      return selectedId;
    }
    state.selectedSourceId = items[0] ? String(items[0].id || '').trim() : '';
    return String(state.selectedSourceId || '');
  }

  function primarySourceImage() {
    var items = getSourceImages();
    if (!items.length) {
      state.selectedSourceId = '';
      return null;
    }
    var selectedId = ensureSelectedSourceId();
    return items.find(function (item) {
      return String(item && item.id || '') === selectedId;
    }) || items[0] || null;
  }

  function orderedSourceImages() {
    var items = getSourceImages().slice();
    var primary = primarySourceImage();
    if (!primary) return items;
    return items.sort(function (a, b) {
      var aPrimary = String(a && a.id || '') === String(primary.id || '');
      var bPrimary = String(b && b.id || '') === String(primary.id || '');
      if (aPrimary === bPrimary) return 0;
      return aPrimary ? -1 : 1;
    });
  }

  function setPrimarySourceByIndex(index) {
    var items = getSourceImages();
    if (index < 0 || index >= items.length) return false;
    var nextId = String(items[index] && items[index].id || '').trim();
    if (!nextId || String(state.selectedSourceId || '') === nextId) return false;
    state.selectedSourceId = nextId;
    return true;
  }

  function sourcePreviewUrl() {
    var primary = primarySourceImage();
    return primary ? String(primary.url || '').trim() : '';
  }

  function sourceKindLabel(kind) {
    if (kind === 'project') return t('sourceKindProject');
    if (kind === 'brand') return t('sourceKindBrand');
    if (kind === 'content') return t('sourceKindContent');
    return t('sourceKindUpload');
  }

  function makeSourceImage(url, name, kind) {
    var trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) return null;
    return {
      id: 'src_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      url: trimmedUrl,
      name: String(name || '').trim() || 'source',
      kind: String(kind || 'upload').trim() || 'upload'
    };
  }

  function hasSelectedSourceUrl(url) {
    var trimmed = String(url || '').trim();
    if (!trimmed) return false;
    return getSourceImages().some(function (item) {
      return String(item && item.url || '').trim() === trimmed;
    });
  }

  function removeSourceImageAt(index) {
    var items = getSourceImages().slice();
    if (index < 0 || index >= items.length) return false;
    var removedId = String(items[index] && items[index].id || '').trim();
    items.splice(index, 1);
    state.sourceImages = items;
    if (removedId && String(state.selectedSourceId || '') === removedId) {
      state.selectedSourceId = items[0] ? String(items[0].id || '').trim() : '';
    } else {
      ensureSelectedSourceId();
    }
    return true;
  }

  function appendSourceImages(entries) {
    var items = getSourceImages().slice();
    var incoming = Array.isArray(entries) ? entries : [];
    var changed = false;
    var hitLimit = false;
    var addedIds = [];
    incoming.forEach(function (entry) {
      var normalized = entry && entry.url ? entry : makeSourceImage(entry && entry.url, entry && entry.name, entry && entry.kind);
      if (!normalized || !normalized.url) return;
      if (items.some(function (item) { return String(item && item.url || '') === String(normalized.url || ''); })) return;
      if (items.length >= MAX_SOURCE_IMAGES) {
        hitLimit = true;
        return;
      }
      items.push(normalized);
      addedIds.push(String(normalized.id || ''));
      changed = true;
    });
    if (changed) {
      state.sourceImages = items;
      ensureSelectedSourceId();
    }
    return { changed: changed, hitLimit: hitLimit, addedIds: addedIds };
  }

  function toggleSourceImage(url, name, kind) {
    var trimmedUrl = String(url || '').trim();
    if (!trimmedUrl) return false;
    var existingIndex = getSourceImages().findIndex(function (item) {
      return String(item && item.url || '').trim() === trimmedUrl;
    });
    if (existingIndex >= 0) {
      var removed = removeSourceImageAt(existingIndex);
      if (removed && !getSourceImages().length && String(state.previewTargetType || '') === 'source') {
        state.previewTargetType = 'none';
      }
      return removed;
    }
    var result = appendSourceImages([makeSourceImage(trimmedUrl, name, kind)]);
    if (result.changed && result.addedIds && result.addedIds[0]) {
      state.selectedSourceId = String(result.addedIds[0] || '');
      state.previewTargetType = 'source';
    }
    if (result.hitLimit) alert(t('sourceLimitReached'));
    return result.changed;
  }

  function resolveLibraryItemUrl(item) {
    var row = item && typeof item === 'object' ? item : {};
    return String(
      row.signedUrl
      || ((NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(row.name) : '')
      || ''
    ).trim();
  }
  function resolveContentItemUrl(item) {
    var row = item && typeof item === 'object' ? item : {};
    return String(row.url || '').trim();
  }

  function buildProjectSourceLibraryMarkup() {
    return state.projectLibraryItems.map(function (item, index) {
      var thumb = resolveLibraryItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card' + (hasSelectedSourceUrl(thumb) ? ' active' : '') + '" data-action="select-project-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');
  }

  function buildBrandSourceLibraryMarkup() {
    return state.brandLibraryItems.map(function (item, index) {
      var thumb = resolveLibraryItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card' + (hasSelectedSourceUrl(thumb) ? ' active' : '') + '" data-action="select-brand-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');
  }

  function buildContentSourceLibraryMarkup() {
    return state.contentLibraryItems.map(function (item, index) {
      var thumb = resolveContentItemUrl(item);
      return '' +
        '<button type="button" class="ai-image-source-card' + (hasSelectedSourceUrl(thumb) ? ' active' : '') + '" data-action="select-content-source" data-index="' + index + '">' +
        '<img src="' + escapeHtml(thumb) + '" alt="" class="ai-image-source-thumb" />' +
        '</button>';
    }).join('');
  }

  function buildSelectedSourceMarkup() {
    var items = getSourceImages();
    if (!items.length) {
      return '<div class="ai-image-source-empty" data-selection-signature="' + escapeHtml(sourceSelectionSignature()) + '"></div>';
    }
    return '<div class="ai-image-source-selection" data-selection-signature="' + escapeHtml(sourceSelectionSignature()) + '">' + items.map(function (item, index) {
      var isPrimary = String(item && item.id || '') === String(ensureSelectedSourceId());
      return '' +
        '<div class="ai-image-source-selection-card' + (isPrimary ? ' is-primary' : '') + '" role="button" tabindex="0" data-source-id="' + escapeHtml(String(item && item.id || '')) + '" data-action="select-source-primary" data-index="' + index + '">' +
          '<div class="ai-image-source-selection-media">' +
            '<div class="ai-image-source-selection-trigger">' +
              '<img src="' + escapeHtml(String(item.url || '')) + '" alt="" />' +
            '</div>' +
            '<button type="button" class="ai-image-source-remove" data-action="remove-source" data-index="' + index + '" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button>' +
            '<button type="button" class="ai-image-source-view" data-action="toggle-source-modal" data-url="' + escapeHtml(String(item.url || '')) + '" aria-label="' + escapeHtml(t('viewOriginal')) + '" title="' + escapeHtml(t('viewOriginal')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.2-4.2"></path></svg></button>' +
          '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function localizeSourceSelectionNode(selectionNode) {
    if (!selectionNode) return;
    Array.prototype.forEach.call(selectionNode.querySelectorAll('.ai-image-source-remove') || [], function (btn) {
      btn.setAttribute('aria-label', t('deleteLabel'));
      btn.setAttribute('title', t('deleteLabel'));
    });
    Array.prototype.forEach.call(selectionNode.querySelectorAll('.ai-image-source-view') || [], function (btn) {
      btn.setAttribute('aria-label', t('viewOriginal'));
      btn.setAttribute('title', t('viewOriginal'));
    });
  }

  function projectSaveIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4.5h11l3 3V19a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6a1.5 1.5 0 0 1 1-1.5Z"></path><path d="M8 4.5v5h7v-5"></path><path d="M8 15.5h8"></path></svg>';
  }

  function brandSaveIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"></path></svg>';
  }

  function cameraFabIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5A2.5 2.5 0 0 1 7 7h2.2l1.3-1.7h2.9L14.8 7H17a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 17 18H7a2.5 2.5 0 0 1-2.5-2.5v-6Z"></path><circle cx="12" cy="12.5" r="3.3"></circle><path d="M7.5 9.5h.01"></path></svg>';
  }

  function cameraSceneTargetIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"></path><path d="M4 18l5.2-7.2L13 16l2.7-3.8L20 18"></path><path d="M14 6.5l1.2-1.2L17 7.1l3.1-3.1"></path></svg>';
  }

  function cameraSubjectTargetIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3"></circle><path d="M6.5 19c1.1-3 3.2-4.5 5.5-4.5s4.4 1.5 5.5 4.5"></path></svg>';
  }

  function upscaleIconSvg() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="M8 16l8-8"></path><path d="M12 8h4v4"></path></svg>';
  }

  function trashIconGlyph() {
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.75h6l.6 1.5H19a.75.75 0 0 1 0 1.5h-.66l-.8 10.05A2.25 2.25 0 0 1 15.29 20H8.71a2.25 2.25 0 0 1-2.24-2.2l-.81-10.05H5a.75.75 0 0 1 0-1.5h3.4L9 4.75Z"></path><path d="M10 10v5.25M14 10v5.25"></path></svg>';
  }

  function buildCameraPromptInlinePreview(raw) {
    var controls = normalizeCameraControls(raw);
    var modeLabel = cameraTargetModeLabel(state.cameraTargetMode);
    if (!controls.enabled || isNeutralCameraControls(controls)) return modeLabel + ' · ' + t('cameraSummaryOff');
    return cameraSummary(controls, state.cameraTargetMode);
  }

  function buildCameraApplyPrompt(cameraPrompt, previewTarget, targetMode) {
    var mode = normalizeCameraTargetMode(targetMode);
    var base = String(cameraPrompt || '').trim();
    var modeLead = mode === 'subject'
      ? [
        'Rotate only the main foreground subject relative to the camera.',
        'Keep the background, environment, horizon, and broad composition as stable as possible.',
        'Do not rotate the whole scene viewpoint or rebuild the entire background perspective.'
      ]
      : [
        'Reconstruct the entire frame from a new camera viewpoint that matches the absolute camera direction below.',
        'Rotate the whole scene perspective together, including the background, environment, depth, horizon, and subject placement.',
        'Do not keep the background fixed while rotating only a foreground subject.',
        'Update lighting direction and cast shadows to match the new viewpoint.',
        'Preserve the same scene concept and key subjects, but allow perspective and composition to shift to match the new camera angle.'
      ];
    var sourceContext = [];
    if (previewTarget && previewTarget.type === 'result' && previewTarget.result) {
      var resultPrompt = String(previewTarget.result.prompt || '').trim();
      if (resultPrompt) sourceContext.push('Keep the original scene concept, subjects, and style from this reference image. Original concept: ' + resultPrompt);
      else sourceContext.push('Keep the original scene concept, subjects, and style from this reference image.');
    } else if (previewTarget && previewTarget.url) {
      sourceContext.push('Keep the original scene concept, subjects, and style from this reference image.');
    }
    return []
      .concat(modeLead)
      .concat(base ? [base] : [])
      .concat(sourceContext)
      .filter(Boolean)
      .join('\n');
  }

  function buildCameraControlCardMarkup(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var modeClass = opts.mode === 'history' ? ' is-history-mode' : '';
    var controls = normalizeCameraControls(state.cameraControls);
    var targetMode = normalizeCameraTargetMode(state.cameraTargetMode);
    var orbitPreview = computeCameraOrbitPreview(controls);
    var presetOptions = ['front', 'rear', 'highangle', 'left45', 'right45', 'lowangle', 'upperLeft45', 'upperRight45', 'closeup', 'lowerLeft45', 'lowerRight45', 'wide'].map(function (preset) {
      var presetKey = String(preset || '').toLowerCase();
      var isFrontDefault = presetKey === 'front' && isNeutralCameraControls(controls);
      var isActive = controls.preset === presetKey || isFrontDefault;
      return '<button type="button" class="ai-image-camera-preset' + (isActive ? ' active' : '') + '" data-action="set-camera-preset" data-preset="' + presetKey + '">' + escapeHtml(cameraPresetLabel(presetKey)) + '</button>';
    }).join('');
    return '' +
        '<div class="ai-image-camera-card' + (controls.enabled ? ' is-active' : '') + modeClass + '">' +
          '<div class="ai-image-camera-card-body">' +
            '<div class="ai-image-camera-preview-card is-inline">' +
              '<div class="ai-image-camera-orbit is-inline">' +
                buildCameraOrbitSvgMarkup(orbitPreview) +
                '<div class="ai-image-camera-target-toggle" role="tablist" aria-label="' + escapeHtml(t('cameraButton')) + '">' +
                  '<button type="button" class="ai-image-camera-target-btn is-scene' + (targetMode === 'scene' ? ' active' : '') + '" data-action="set-camera-target-mode" data-mode="scene" aria-label="' + escapeHtml(t('cameraTargetSceneLabel')) + '" title="' + escapeHtml(t('cameraTargetSceneLabel')) + '">' + cameraSceneTargetIconSvg() + '</button>' +
                  '<button type="button" class="ai-image-camera-target-btn is-subject' + (targetMode === 'subject' ? ' active' : '') + '" data-action="set-camera-target-mode" data-mode="subject" aria-label="' + escapeHtml(t('cameraTargetSubjectLabel')) + '" title="' + escapeHtml(t('cameraTargetSubjectLabel')) + '">' + cameraSubjectTargetIconSvg() + '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="ai-image-camera-controls is-inline">' +
              '<div class="ai-image-camera-section is-inline">' +
                '<div class="ai-image-camera-preset-grid is-inline">' + presetOptions + '</div>' +
              '</div>' +
              '<div class="ai-image-camera-inline-sliders">' +
              '<div class="ai-image-camera-section is-inline">' +
                '<div class="ai-image-camera-slider-inline">' +
                  '<label class="ai-image-camera-slider-row" for="ai-image-camera-pan"><span>' + escapeHtml(t('cameraPan')) + '</span></label>' +
                  '<input id="ai-image-camera-pan" type="range" min="0" max="359" step="1" value="' + escapeHtml(String(controls.pan)) + '" />' +
                  '<strong id="ai-image-camera-pan-value">' + escapeHtml(String(controls.pan)) + '</strong>' +
                '</div>' +
              '</div>' +
              '<div class="ai-image-camera-section is-inline">' +
                '<div class="ai-image-camera-slider-inline">' +
                  '<label class="ai-image-camera-slider-row" for="ai-image-camera-tilt"><span>' + escapeHtml(t('cameraTilt')) + '</span></label>' +
                  '<input id="ai-image-camera-tilt" type="range" min="-30" max="60" step="1" value="' + escapeHtml(String(controls.tilt)) + '" />' +
                  '<strong id="ai-image-camera-tilt-value">' + escapeHtml(String(controls.tilt)) + '</strong>' +
                '</div>' +
              '</div>' +
              '<div class="ai-image-camera-section is-inline">' +
                '<div class="ai-image-camera-slider-inline">' +
                  '<label class="ai-image-camera-slider-row" for="ai-image-camera-distance"><span>' + escapeHtml(t('cameraDistance')) + '</span></label>' +
                  '<input id="ai-image-camera-distance" type="range" min="0" max="2" step="1" value="' + escapeHtml(String(controls.distance)) + '" />' +
                  '<strong id="ai-image-camera-distance-value">' + escapeHtml(String(controls.distance)) + '</strong>' +
                '</div>' +
              '</div>' +
              '</div>' +
              '<div class="ai-image-camera-inline-meta">' +
                '<div class="ai-image-camera-actions">' +
                  '<button type="button" class="btn-primary ai-image-camera-apply" data-action="apply-camera-generate"' + (controls.enabled ? '' : ' disabled') + '>' + escapeHtml(t('cameraApply')) + '</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
  }

  function buildSourceFieldMarkup(detached, project, sourceDisabled) {
    var sourceLibrary = buildProjectSourceLibraryMarkup();
    var brandSourceLibrary = buildBrandSourceLibraryMarkup();
    var contentSourceLibrary = buildContentSourceLibraryMarkup();
    return '' +
      '<div class="ai-image-field source-field' + (sourceDisabled ? ' is-disabled' : '') + '">' +
        '<div class="ai-image-label-row ai-image-source-label-row">' +
        '<label>' + escapeHtml(t('sourceTitle')) + '</label>' +
        '<div class="ai-image-source-label-actions">' +
        '<span class="ai-image-source-limit">' + escapeHtml(String(getSourceImages().length) + '/' + String(MAX_SOURCE_IMAGES)) + '</span>' +
        '<button type="button" class="btn-secondary compact source-upload-fab" data-action="open-upload"' + (sourceDisabled ? ' disabled' : '') + '>+</button>' +
        '</div>' +
        '</div>' +
        '<div class="ai-image-source-box' + (sourceDisabled ? ' is-disabled' : '') + (getSourceImages().length ? ' has-image' : '') + '">' +
        buildSelectedSourceMarkup() +
        '<input type="file" id="ai-image-source-file" class="hidden" accept="image/*" multiple' + (sourceDisabled ? ' disabled' : '') + ' />' +
        '</div>' +
        ((!detached && state.brandLibraryItems.length)
          ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceBrandTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="brand" aria-label="브랜드 이미지 ' + (state.sourceSectionCollapsed.brand ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.brand ? '+' : '−') + '</button></div>' + (state.sourceSectionCollapsed.brand ? '' : '<div class="ai-image-source-grid compact collapsible-body">' + brandSourceLibrary + '</div>') + '</div>'
          : '') +
        (!detached
          ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceContentTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="content" aria-label="콘텐츠 저장소 ' + (state.sourceSectionCollapsed.content ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.content ? '+' : '−') + '</button></div>' + (state.sourceSectionCollapsed.content ? '' : (state.contentLibraryItems.length ? ('<div class="ai-image-source-grid compact collapsible-body">' + contentSourceLibrary + '</div>') : '<p class="muted small">' + escapeHtml(t('sourceContentEmpty')) + '</p>')) + '</div>'
          : '') +
        (function () {
          var projectBody = '';
          if (!detached && !state.sourceSectionCollapsed.project) {
            if (project && project.id) {
              projectBody = state.projectLibraryItems.length
                ? '<div class="ai-image-source-grid compact collapsible-body">' + sourceLibrary + '</div>'
                : '<p class="muted small">' + escapeHtml(t('sourceProjectEmpty')) + '</p>';
            } else {
              projectBody = '';
            }
          }
          return (!detached && (project && project.id))
            ? '<div class="ai-image-source-library is-compact"><div class="ai-image-source-library-title-row"><div class="ai-image-source-library-title">' + escapeHtml(t('sourceLibraryTitle')) + '</div><button type="button" class="circle-toggle" data-action="toggle-source-section" data-section="project" aria-label="프로젝트 저장소 ' + (state.sourceSectionCollapsed.project ? '펼치기' : '접기') + '">' + (state.sourceSectionCollapsed.project ? '+' : '−') + '</button></div>' + projectBody + '</div>'
            : '';
        })() +
        ((!detached && state.libraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceProjectLoading')) + '</p>' : '') +
        ((!detached && state.brandLibraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceBrandLoading')) + '</p>' : '') +
        ((!detached && state.contentLibraryLoading) ? '<p class="muted small">' + escapeHtml(t('sourceContentLoading')) + '</p>' : '') +
        '</div>';
  }

  function buildPromptPanelMarkup(detached, project, sourceDisabled) {
    return '' +
      '<section class="card ai-image-panel ai-image-panel-left">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('promptPanelTitle')) + '</h2></div>' +
      '</div>' +
      '<div class="scenario-form">' +
      '<div class="ai-image-mode-tabs">' +
      '<button type="button" class="btn-secondary' + (state.mode === 'text-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="text-to-image">' + escapeHtml(t('modeText')) + '</button>' +
      '<button type="button" class="btn-secondary' + (state.mode === 'image-to-image' ? ' active' : '') + '" data-action="set-mode" data-mode="image-to-image">' + escapeHtml(t('modeImage')) + '</button>' +
      '</div>' +
      buildSourceFieldMarkup(detached, project, sourceDisabled) +
      '<div class="ai-image-field">' +
      '<div class="ai-image-label-row">' +
      '<label for="ai-image-prompt">' + escapeHtml(t('promptLabel')) + '</label>' +
      '<span id="ai-image-prompt-count" class="ai-image-label-count">(' + escapeHtml(String((state.prompt || '').length) + t('promptCounterSuffix')) + ')</span>' +
      '</div>' +
      '<textarea id="ai-image-prompt" rows="8" maxlength="4000" placeholder="' + escapeHtml(state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText')) + '"></textarea>' +
      '</div>' +
      '<div class="ai-image-controls-stack">' +
        '<div class="ai-image-settings-grid">' +
          '<div class="ai-image-setting-card is-compact">' +
            '<div class="ai-image-source-library-title">' + escapeHtml(t('providerLabel')) + '</div>' +
            '<div class="ai-image-size-row">' +
              '<select id="ai-image-provider" class="btn-secondary ai-image-select">' +
                '<option value="gemini"' + (normalizeProviderValue(state.provider) === 'gemini' ? ' selected' : '') + '>' + escapeHtml(t('providerGemini')) + '</option>' +
                '<option value="openai"' + (normalizeProviderValue(state.provider) === 'openai' ? ' selected' : '') + '>' + escapeHtml(t('providerOpenai')) + '</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="ai-image-setting-card is-compact">' +
            '<div class="ai-image-source-library-title">' + escapeHtml(t('sizeLabel')) + '</div>' +
            '<div class="ai-image-size-row">' +
              '<select id="ai-image-size" class="btn-secondary ai-image-select">' +
                '<option value="512"' + (state.imageSize === '512' ? ' selected' : '') + '>' + escapeHtml(t('sizeFast')) + '</option>' +
                '<option value="1K"' + (state.imageSize === '1K' ? ' selected' : '') + '>' + escapeHtml(t('sizeStd')) + '</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
          '<div class="ai-image-setting-card is-compact">' +
            '<div class="ai-image-source-library-title">' + escapeHtml(t('generationStyleLabel')) + '</div>' +
            '<div class="ai-image-size-row">' +
              '<select id="ai-image-generation-style" class="btn-secondary ai-image-select">' +
                '<option value="single"' + (normalizeGenerationStyle(state.generationStyle) === 'single' ? ' selected' : '') + '>' + escapeHtml(t('generationStyleSingle')) + '</option>' +
                '<option value="conversation"' + (normalizeGenerationStyle(state.generationStyle) === 'conversation' ? ' selected' : '') + '>' + escapeHtml(t('generationStyleConversation')) + '</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ai-image-ratio-row">' +
        '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '1:1' ? ' active' : '') + '" data-action="set-aspect" data-ratio="1:1">1:1</button>' +
        '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '16:9' ? ' active' : '') + '" data-action="set-aspect" data-ratio="16:9">16:9</button>' +
        '<button type="button" class="btn-secondary ratio-btn' + (state.aspectRatio === '9:16' ? ' active' : '') + '" data-action="set-aspect" data-ratio="9:16">9:16</button>' +
        '<button type="button" class="btn-primary wide-generate" data-action="generate-image">' + escapeHtml(t('generate')) + '</button>' +
        '</div>' +
      '</div>' +
      '</div>' +
      '</section>';
  }

  function buildPreviewPanelMarkup(detached, project, brand, selectedPreview) {
    var preview = selectedPreview && typeof selectedPreview === 'object' ? selectedPreview : null;
    var selectedResult = preview && preview.type === 'result' ? preview.result : null;
    var brandCharacterList = brandCharacterOptions();
    var selectedBrandToken = selectedBrandCharacterToken(selectedResult);
    var selectedCameraControls = preview && preview.cameraControls
      ? normalizeCameraControls(preview.cameraControls)
      : normalizeCameraControls(state.cameraControls);
    var cameraPanelActive = normalizeHistoryPanelMode(state.historyPanelMode) === 'camera';
    var previewUrl = preview ? String(preview.url || '').trim() : '';
    var sourceMeta = preview && preview.type === 'source'
      ? (sourceKindLabel(preview.sourceKind) + (preview.name ? (' · ' + preview.name) : ''))
      : '';
    return '' +
      '<section class="card ai-image-panel ai-image-panel-preview" data-render-signature="' + escapeHtml(previewPanelSignature(preview, detached)) + '">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(t('latestResult')) + '</h2></div>' +
      '</div>' +
      '<div class="ai-image-preview-layout">' +
      (preview
        ? '<div class="ai-image-preview-stage">' +
          '<div class="ai-image-preview-media">' +
          '<button type="button" class="ai-image-preview-trigger" data-action="toggle-preview-modal" data-url="' + escapeHtml(previewUrl) + '">' +
          '<img src="' + escapeHtml(previewUrl) + '" alt="" class="ai-image-preview-image" />' +
          '</button>' +
          '<button type="button" class="ai-image-camera-fab' + (cameraPanelActive ? ' is-active' : '') + '" data-action="toggle-camera-panel" aria-label="' + escapeHtml(t('cameraButton')) + '" title="' + escapeHtml(t('cameraButton')) + '">' + cameraFabIconSvg() + '</button>' +
          '</div>' +
          '<div class="ai-image-preview-foot">' +
              (selectedResult
              ? 
              '<div class="ai-image-inline-actions' + (detached ? ' is-compact-grid' : '') + '">' +
              '<div class="ai-image-inline-actions-left">' +
                '<button type="button" class="btn-primary compact ai-image-action-icon" data-action="regenerate-variation" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('regenerateVariation')) + '" title="' + escapeHtml(t('regenerateVariation')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v6h6"></path><path d="M20 20v-6h-6"></path><path d="M4 10a8 8 0 0 1 14-5"></path><path d="M20 14a8 8 0 0 1-14 5"></path></svg></button>' +
                '<button type="button" class="btn-secondary compact ai-image-action-icon" data-action="use-result-as-source" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('useAsSource')) + '" title="' + escapeHtml(t('useAsSource')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9"></path><path d="M8 13l4-4 4 4"></path><path d="M5 5h14"></path></svg></button>' +
                '<button type="button" class="btn-primary compact ai-image-action-icon ai-image-upscale-btn" data-action="upscale-result-2k" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('upscale2k')) + '" title="' + escapeHtml(t('upscale2k')) + '">' + upscaleIconSvg() + '</button>' +
                '<button type="button" class="btn-secondary compact ai-image-action-icon" data-action="download-result" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('download')) + '" title="' + escapeHtml(t('download')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"></path><path d="M8 11l4 4 4-4"></path><path d="M5 19h14"></path></svg></button>' +
              '</div>' +
              (detached ? '' : '<div class="ai-image-inline-actions-bottom"><div class="ai-image-brand-actions">' +
              '<label class="ai-image-brand-select-wrap" aria-label="' + escapeHtml(t('saveBrandSelectLabel')) + '">' +
              '<select id="ai-image-brand-target" title="' + escapeHtml(t('saveBrandSelectLabel')) + '">' +
              '<option value="">' + escapeHtml(t('saveBrandSelectPlaceholder')) + '</option>' +
              brandCharacterList.map(function (item) {
                return '<option value="' + escapeHtml(item.token) + '"' + (String(item.token) === String(selectedBrandToken) ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>';
              }).join('') +
              '</select>' +
              '</label>' +
              '<button type="button" class="btn-secondary compact ai-image-action-icon ai-image-action-save" data-action="save-result-brand" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('saveBrand')) + '" title="' + escapeHtml(t('saveBrand')) + '"' + ((brand && brand.brandId && brandCharacterList.length) ? '' : ' disabled') + '>' + brandSaveIconSvg() + '</button>' +
              '<button type="button" class="btn-primary compact ai-image-action-icon ai-image-action-save" data-action="save-result-project" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('saveProject')) + '" title="' + escapeHtml(t('saveProject')) + '"' + ((project && project.id) ? '' : ' disabled') + '>' + projectSaveIconSvg() + '</button>' +
              '</div></div>') +
              '</div>'
              : '') +
              '<div class="ai-image-preview-meta">' +
                (selectedResult
                  ? '<p class="ai-image-preview-created"><button type="button" class="ai-image-analysis-btn" data-action="analyze-result-prompt" data-id="' + escapeHtml(selectedResult.id) + '" aria-label="' + escapeHtml(t('analyzePrompt')) + '" title="' + escapeHtml(t('analyzePrompt')) + '"><span class="ai-image-analysis-icon" aria-hidden="true"></span></button><span class="ai-image-meta-item"><strong>' + escapeHtml(t('createdAt')) + ':</strong> <span>' + escapeHtml(formatDate(selectedResult.createdAt)) + '</span></span><span class="ai-image-meta-sep" aria-hidden="true"></span><span class="ai-image-meta-item ai-image-meta-item-camera"><strong>' + escapeHtml(t('cameraMetaLabel')) + ':</strong> <span>' + escapeHtml(cameraSummary(selectedCameraControls, preview && preview.cameraTargetMode)) + '</span></span></p>'
                  : '<p class="ai-image-preview-created"><strong>' + escapeHtml(t('sourceTitle')) + ':</strong> ' + escapeHtml(sourceMeta || t('sourceKindUpload')) + '</p>') +
                '<p class="ai-image-preview-prompt"><button type="button" class="ai-image-analysis-btn" data-action="copy-result-prompt" data-id="' + escapeHtml(selectedResult ? selectedResult.id : '') + '" aria-label="' + escapeHtml(t('reusePrompt')) + '" title="' + escapeHtml(t('reusePrompt')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="10" height="12" rx="2"></rect><rect x="5" y="5" width="10" height="12" rx="2"></rect><line x1="12" y1="13" x2="17" y2="13"></line><line x1="12" y1="16" x2="17" y2="16"></line></svg></button> ' + escapeHtml(selectedResult ? (selectedResult.prompt || '') : (preview.name || '')) + '</p>' +
              '</div>' +
          '</div>' +
        '</div>'
        : '<div class="ai-image-empty-state"><p>' + escapeHtml(t('resultsEmpty')) + '</p></div>') +
      '</div>' +
      '</section>';
  }

  function buildHistoryPanelMarkup() {
    var cameraPanelActive = normalizeHistoryPanelMode(state.historyPanelMode) === 'camera';
    var historyHeadAction = (!cameraPanelActive && state.results.length)
      ? '<button type="button" class="ai-image-history-clear" data-action="delete-all-results" aria-label="' + escapeHtml(t('deleteAllLabel')) + '" title="' + escapeHtml(t('deleteAllLabel')) + '">' + trashIconGlyph() + '</button>'
      : '';
    var resultCards = state.results.map(function (item) {
      var active = String(item.id || '') === String(state.currentResultId || '');
      return '' +
        '<div class="ai-image-history-card' + (active ? ' active' : '') + '" role="button" tabindex="0" data-action="select-result" data-id="' + escapeHtml(item.id) + '">' +
        '<button type="button" class="ai-image-history-delete" data-action="delete-result" data-id="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button>' +
        '<img src="' + escapeHtml(resolveResultUrl(item)) + '" alt="" class="ai-image-history-thumb" />' +
        '<div class="ai-image-history-meta">' +
        '<strong>' + escapeHtml((item.mode === 'image-to-image' ? t('modeImageShort') : t('modeTextShort')) + ' · ' + generationStyleShortLabel(item.generationStyle || 'single')) + '</strong>' +
        '<p>' + escapeHtml(item.prompt || '') + '</p>' +
        (item.savedToProject ? '<span class="ai-image-saved-chip">' + escapeHtml(t('resultSavedTag')) + '</span>' : '') +
        '</div>' +
        '</div>';
    }).join('');
    return '' +
      '<section class="card ai-image-panel ai-image-panel-history" data-render-signature="' + escapeHtml(historyPanelSignature()) + '">' +
      '<div class="ai-image-preview-head">' +
      '<div><h2>' + escapeHtml(cameraPanelActive ? t('cameraModalTitle') : t('historyTitle')) + '</h2></div>' +
      historyHeadAction +
      '</div>' +
      '<div class="ai-image-history' + (cameraPanelActive ? ' ai-image-history-camera' : '') + '">' +
      (cameraPanelActive
        ? buildCameraControlCardMarkup({ mode: 'history' })
        : (((state.historyLoading && !state.results.length) ? '<p class="muted small">' + escapeHtml(t('historyLoading')) + '</p>' : '') +
          ((!state.historyLoading && state.historyLoadError) ? '<p class="muted small">' + escapeHtml(t('historyLoadError')) + '</p>' : '') +
          (resultCards ? '<div class="ai-image-history-list">' + resultCards + '</div>' : '<p class="muted small">' + escapeHtml(t('resultsEmpty')) + '</p>'))) +
      '</div>' +
      '</section>';
  }

  function cloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value == null ? fallback : value));
    } catch (_) {
      return fallback;
    }
  }

  function normalizeCharacterName(value) {
    return String(value || '').replace(/^@+/, '').trim();
  }

  function normalizeCharacterToken(value) {
    var name = normalizeCharacterName(value).replace(/\s+/g, '');
    return name ? ('@' + name) : '';
  }

  function brandCharacterOptions() {
    var brand = state.currentBrand && typeof state.currentBrand === 'object' ? state.currentBrand : {};
    var options = [];
    var seen = {};
    var sheets = Array.isArray(brand.characterSheets) ? brand.characterSheets : [];
    var knowledgeCharacters = Array.isArray(brand.knowledgeCharacters) ? brand.knowledgeCharacters : [];
    sheets.forEach(function (entry, index) {
      var token = normalizeCharacterToken(entry && (entry.token || entry.displayName || entry.name));
      if (!token || seen[token]) return;
      seen[token] = true;
      options.push({
        token: token,
        label: normalizeCharacterName(entry && (entry.displayName || entry.name || token)) || ('Character ' + (index + 1))
      });
    });
    knowledgeCharacters.forEach(function (entry, index) {
      var token = normalizeCharacterToken(entry && (entry.token || entry.displayName || entry.name));
      if (!token || seen[token]) return;
      seen[token] = true;
      options.push({
        token: token,
        label: normalizeCharacterName(entry && (entry.displayName || entry.name || token)) || ('Character ' + (index + 1))
      });
    });
    return options;
  }

  function selectedBrandCharacterToken(result) {
    var row = result && typeof result === 'object' ? result : {};
    var saved = String(row.selectedBrandCharacterToken || '').trim();
    if (saved) return saved;
    var options = brandCharacterOptions();
    return options[0] ? String(options[0].token || '').trim() : '';
  }

  function isImageLibraryItem(item) {
    var row = item && typeof item === 'object' ? item : {};
    var name = String(row.name || '').trim().toLowerCase();
    var type = String(row.contentType || '').trim().toLowerCase();
    if (type.indexOf('image/') === 0) return true;
    return /\.(png|jpg|jpeg|webp)$/i.test(name);
  }

  function updateDocumentCopy() {
    document.title = t('pageTitle');
    var subtitle = document.querySelector('[data-ai-image-subtitle]');
    if (subtitle) subtitle.textContent = t('brandSubtitle');
    var dashboardLink = document.querySelector('[data-ai-image-nav="dashboard"]');
    if (dashboardLink) dashboardLink.textContent = t('navDashboard');
    var videoLink = document.querySelector('[data-ai-image-nav="video"]');
    if (videoLink) videoLink.textContent = t('navAiVideo');
    var imageLink = document.querySelector('[data-ai-image-nav="image"]');
    if (imageLink) imageLink.textContent = t('navAiImage');
    var libraryLink = document.querySelector('[data-ai-image-nav="library"]');
    if (libraryLink) libraryLink.textContent = t('navLibrary');
    var authTitle = document.querySelector('[data-ai-image-auth-title]');
    if (authTitle) authTitle.textContent = t('loginRequired');
    var authLink = document.querySelector('[data-ai-image-auth-link]');
    if (authLink) authLink.textContent = t('loginAction');
  }

  function updateThemeAndLangButtons() {
    try {
      if (NK.state && NK.state.set) NK.state.set({ lang: state.lang });
    } catch (_) { }
    if (NK.ui && NK.ui.common && NK.ui.common.updateThemeButton) {
      NK.ui.common.updateThemeButton(readTheme(), state.lang);
    }
    if (NK.ui && NK.ui.common && NK.ui.common.updateScreenButton) {
      NK.ui.common.updateScreenButton(state.lang);
    }
    var langBtn = document.querySelector('[data-ai-image-lang-toggle]');
    if (langBtn) {
      var current = state.lang === 'en' ? 'EN' : 'KO';
      langBtn.textContent = current;
      langBtn.setAttribute('aria-label', state.lang === 'en' ? 'Switch to Korean' : 'Switch to English');
      langBtn.setAttribute('title', state.lang === 'en' ? 'Switch to Korean' : 'Switch to English');
    }
  }

  function updatePromptCounterText() {
    var counter = document.getElementById('ai-image-prompt-count');
    if (counter) counter.textContent = String((state.prompt || '').length) + t('promptCounterSuffix');
  }

  function updatePromptFieldUI() {
    var promptEl = document.getElementById('ai-image-prompt');
    if (promptEl) {
      promptEl.value = state.prompt || '';
      promptEl.setAttribute('placeholder', state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText'));
    }
    updatePromptCounterText();
  }

  function updateAspectButtonsUI() {
    var buttons = document.querySelectorAll('.ai-image-ratio-row [data-action="set-aspect"]');
    Array.prototype.forEach.call(buttons || [], function (btn) {
      var ratio = String(btn.getAttribute('data-ratio') || '');
      if (ratio === String(state.aspectRatio || '')) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  function hydratePromptControls() {
    var promptEl = document.getElementById('ai-image-prompt');
    if (promptEl) {
      promptEl.value = state.prompt || '';
      promptEl.oninput = function () {
        state.prompt = String(promptEl.value || '');
        updatePromptCounterText();
      };
    }
    var sizeEl = document.getElementById('ai-image-size');
    if (sizeEl) {
      sizeEl.value = state.imageSize || '1K';
    }
    bindSourceFileInput();
  }

  function updateLocalizedUiPreservingResults() {
    var root = document.getElementById('ai-image-root');
    if (!root) return;
    var project = state.currentProject;
    var brand = state.currentBrand;
    var detached = !(project && project.id);
    var selectedPreview = currentPreviewTarget();
    var existingSourceSelection = root.querySelector('.ai-image-source-selection, .ai-image-source-empty');
    var existingSourceSelectionSignature = existingSourceSelection ? String(existingSourceSelection.getAttribute('data-selection-signature') || '') : '';

    updateHeaderUI();

    var leftPanel = root.querySelector('.ai-image-panel-left');
    if (leftPanel) {
      leftPanel.outerHTML = buildPromptPanelMarkup(detached, project, state.mode !== 'image-to-image');
      hydratePromptControls();
      var nextSourceSelection = root.querySelector('.ai-image-source-selection, .ai-image-source-empty');
      var nextSourceSelectionSignature = nextSourceSelection ? String(nextSourceSelection.getAttribute('data-selection-signature') || '') : '';
      if (existingSourceSelection && nextSourceSelection && existingSourceSelectionSignature && existingSourceSelectionSignature === nextSourceSelectionSignature) {
        nextSourceSelection.parentNode.replaceChild(existingSourceSelection, nextSourceSelection);
        localizeSourceSelectionNode(existingSourceSelection);
      }
    }

    var headings = root.querySelectorAll('.ai-image-preview-head h2');
    if (headings[1]) headings[1].textContent = t('latestResult');
    if (headings[2]) headings[2].textContent = normalizeHistoryPanelMode(state.historyPanelMode) === 'camera' ? t('cameraModalTitle') : t('historyTitle');

    if (selectedPreview) {
      if (selectedPreview.type === 'result') {
        var analyzeBtn = root.querySelector('[data-action="analyze-result-prompt"]');
        if (analyzeBtn) {
          analyzeBtn.setAttribute('aria-label', t('analyzePrompt'));
          analyzeBtn.setAttribute('title', t('analyzePrompt'));
        }
        var regenerateBtn = root.querySelector('[data-action="regenerate-variation"]');
        if (regenerateBtn) {
          regenerateBtn.setAttribute('aria-label', t('regenerateVariation'));
          regenerateBtn.setAttribute('title', t('regenerateVariation'));
        }
        var sourceBtn = root.querySelector('[data-action="use-result-as-source"]');
        if (sourceBtn) {
          sourceBtn.setAttribute('aria-label', t('useAsSource'));
          sourceBtn.setAttribute('title', t('useAsSource'));
        }
            var upscaleBtn = root.querySelector('[data-action="upscale-result-2k"]');
            if (upscaleBtn) {
              upscaleBtn.setAttribute('aria-label', t('upscale2k'));
              upscaleBtn.setAttribute('title', t('upscale2k'));
            }
        var downloadBtn = root.querySelector('[data-action="download-result"]');
        if (downloadBtn) {
          downloadBtn.setAttribute('aria-label', t('download'));
          downloadBtn.setAttribute('title', t('download'));
        }
        var saveProjectBtn = root.querySelector('[data-action="save-result-project"]');
        if (saveProjectBtn) {
          saveProjectBtn.setAttribute('aria-label', t('saveProject'));
          saveProjectBtn.setAttribute('title', t('saveProject'));
          saveProjectBtn.innerHTML = projectSaveIconSvg();
        }
        var saveBrandBtn = root.querySelector('[data-action="save-result-brand"]');
        if (saveBrandBtn) {
          saveBrandBtn.setAttribute('aria-label', t('saveBrand'));
          saveBrandBtn.setAttribute('title', t('saveBrand'));
          saveBrandBtn.innerHTML = brandSaveIconSvg();
        }
        var brandTargetWrap = root.querySelector('.ai-image-brand-select-wrap');
        if (brandTargetWrap) brandTargetWrap.setAttribute('aria-label', t('saveBrandSelectLabel'));
        var brandTargetEl = document.getElementById('ai-image-brand-target');
        if (brandTargetEl) {
          brandTargetEl.setAttribute('title', t('saveBrandSelectLabel'));
          if (brandTargetEl.options.length) brandTargetEl.options[0].text = t('saveBrandSelectPlaceholder');
        }
        var previewMetaLabel = root.querySelector('.ai-image-preview-created strong');
        if (previewMetaLabel) previewMetaLabel.textContent = t('createdAt') + ':';
      } else {
        var sourcePreviewMetaLabel = root.querySelector('.ai-image-preview-created strong');
        if (sourcePreviewMetaLabel) sourcePreviewMetaLabel.textContent = t('sourceTitle') + ':';
      }
      var cameraMetaLabel = root.querySelector('.ai-image-camera-meta strong');
      if (cameraMetaLabel) cameraMetaLabel.textContent = t('cameraMetaLabel') + ':';
    } else {
      var previewEmpty = root.querySelector('.ai-image-panel-preview .ai-image-empty-state p');
      if (previewEmpty) previewEmpty.textContent = t('resultsEmpty');
    }

    var historyMessage = root.querySelector('.ai-image-panel-history .ai-image-history > .muted.small');
    if (historyMessage) {
      if (state.historyLoading) historyMessage.textContent = t('historyLoading');
      else if (state.historyLoadError) historyMessage.textContent = t('historyLoadError');
      else historyMessage.textContent = t('resultsEmpty');
    }

    var historyCards = root.querySelectorAll('.ai-image-history-card');
    Array.prototype.forEach.call(historyCards, function (cardEl, index) {
      var item = state.results[index];
      if (!item) return;
      var deleteBtn = cardEl.querySelector('.ai-image-history-delete');
      if (deleteBtn) {
        deleteBtn.setAttribute('aria-label', t('deleteLabel'));
        deleteBtn.setAttribute('title', t('deleteLabel'));
      }
      var strong = cardEl.querySelector('.ai-image-history-meta strong');
      if (strong) {
        strong.textContent = (item.mode === 'image-to-image' ? t('modeImageShort') : t('modeTextShort')) + ' · ' + generationStyleShortLabel(item.generationStyle || 'single');
      }
      var savedChip = cardEl.querySelector('.ai-image-saved-chip');
      if (savedChip) savedChip.textContent = t('resultSavedTag');
    });
    var historyClearBtn = root.querySelector('.ai-image-history-clear');
    if (historyClearBtn) {
      historyClearBtn.setAttribute('aria-label', t('deleteAllLabel'));
      historyClearBtn.setAttribute('title', t('deleteAllLabel'));
    }
    updatePreviewPanelUI();
    updateHistoryPanelUI();
  }

  function setGlobalLoading(show, message) {
    if (NK.core && NK.core.setLoading) {
      NK.core.setLoading(!!show, message || '로딩중...');
      return;
    }
    var overlay = document.getElementById('page-loading');
    var main = document.querySelector('.main');
    var overlayText = overlay ? overlay.querySelector('p') : null;
    if (overlayText) {
      overlayText.textContent = show ? (message || '로딩중...') : '로딩중...';
    }
    if (overlay) overlay.classList.toggle('hidden', !show);
    if (main) main.classList.toggle('loading-blur', !!show);
  }

  function render() {
    var root = document.getElementById('ai-image-root');
    if (!root) return;
    root.setAttribute('data-no-i18n', 'true');
    var project = state.currentProject;
    var brand = state.currentBrand;
    var detached = !(project && project.id);
    var selectedPreview = currentPreviewTarget();
    var sourceDisabled = state.mode !== 'image-to-image';
    var nextPromptSignature = promptPanelSignature(detached, project);
    var nextPreviewSignature = previewPanelSignature(selectedPreview, detached);
    var nextHistorySignature = historyPanelSignature();
    var existingPromptPanel = root.querySelector('.ai-image-panel-left');
    var existingPreviewPanel = root.querySelector('.ai-image-panel-preview');
    var existingHistoryPanel = root.querySelector('.ai-image-panel-history');
    var preservePromptPanel = !!(existingPromptPanel && existingPromptPanel.getAttribute('data-render-signature') === nextPromptSignature);
    var preservePreviewPanel = !!(existingPreviewPanel && existingPreviewPanel.getAttribute('data-render-signature') === nextPreviewSignature);
    var preserveHistoryPanel = !!(existingHistoryPanel && existingHistoryPanel.getAttribute('data-render-signature') === nextHistorySignature);
    root.innerHTML = '' +
      '<section class="ai-image-shell" data-no-i18n="true">' +
      '<div class="ai-image-header">' +
      '<div>' +
      '<h1>' + escapeHtml(t('heroTitle')) + '</h1>' +
      '</div>' +
      '<div class="ai-image-status-pills">' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('sessionLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : state.sessionId) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('projectLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : (project && project.title ? project.title : t('noProject'))) + '</strong></span>' +
      '<span class="studio-hero-pill"><em>' + escapeHtml(t('brandLabel')) + '</em><strong>' + escapeHtml(detached ? t('noneLabel') : (brand && brand.brandTitle ? brand.brandTitle : t('noBrand'))) + '</strong></span>' +
      '</div>' +
      '</div>' +
      '<div class="ai-image-workspace">' +
      buildPromptPanelMarkup(detached, project, sourceDisabled).replace('<section class="card ai-image-panel ai-image-panel-left">', '<section class="card ai-image-panel ai-image-panel-left" data-render-signature="' + escapeHtml(nextPromptSignature) + '">') +
      buildPreviewPanelMarkup(detached, project, brand, selectedPreview) +
      buildHistoryPanelMarkup() +
      '</div>' +
      (state.imageModalUrl ? '<div class="img-modal" data-action="toggle-source-modal"><img src="' + escapeHtml(state.imageModalUrl) + '" alt="" /></div>' : '') +
      '</section>';

    if (preservePromptPanel) {
      var nextPromptPanel = root.querySelector('.ai-image-panel-left');
      if (nextPromptPanel && nextPromptPanel.parentNode) {
        nextPromptPanel.parentNode.replaceChild(existingPromptPanel, nextPromptPanel);
      }
    }
    if (preservePreviewPanel) {
      var nextPreviewPanel = root.querySelector('.ai-image-panel-preview');
      if (nextPreviewPanel && nextPreviewPanel.parentNode) {
        nextPreviewPanel.parentNode.replaceChild(existingPreviewPanel, nextPreviewPanel);
      }
    }
    if (preserveHistoryPanel) {
      var nextHistoryPanel = root.querySelector('.ai-image-panel-history');
      if (nextHistoryPanel && nextHistoryPanel.parentNode) {
        nextHistoryPanel.parentNode.replaceChild(existingHistoryPanel, nextHistoryPanel);
      }
    }

    hydratePromptControls();
  }

  function bindSourceFileInput() {
    var fileInput = document.getElementById('ai-image-source-file');
    if (fileInput) {
      fileInput.onchange = function () {
        var files = Array.prototype.slice.call(fileInput.files || []);
        if (!files.length) return;
        var availableSlots = Math.max(0, MAX_SOURCE_IMAGES - getSourceImages().length);
        if (!availableSlots) {
          fileInput.value = '';
          alert(t('sourceLimitReached'));
          return;
        }
        var pickedFiles = files.slice(0, availableSlots);
        if (files.length > pickedFiles.length) {
          alert(t('sourceLimitReached'));
        }
        Promise.all(pickedFiles.map(function (file) {
          return new Promise(function (resolve) {
            var reader = new FileReader();
            reader.onload = function () {
              resolve(makeSourceImage(String(reader.result || ''), file.name || 'upload', 'upload'));
            };
            reader.onerror = function () { resolve(null); };
            reader.readAsDataURL(file);
          });
        })).then(function (entries) {
          var result = appendSourceImages(entries.filter(Boolean));
          if (result.hitLimit) alert(t('sourceLimitReached'));
          state.selectedFileName = pickedFiles.map(function (file) { return file.name || 'upload'; }).join(', ');
          updateSourceUI();
        });
        fileInput.value = '';
      };
    }
  }

  function updateModeUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var sourceDisabled = state.mode !== 'image-to-image';
      var tabs = root.querySelectorAll('.ai-image-mode-tabs .btn-secondary');
      Array.prototype.forEach.call(tabs || [], function (btn) {
        var m = String(btn.getAttribute('data-mode') || '');
        if (m && m === state.mode) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      var promptEl = document.getElementById('ai-image-prompt');
      if (promptEl) {
        promptEl.setAttribute('placeholder', sourceDisabled ? t('promptPlaceholderText') : t('promptPlaceholderImage'));
      }
      var sourceField = root.querySelector('.ai-image-field.source-field');
      if (sourceField) {
        sourceField.classList.toggle('is-disabled', sourceDisabled);
      }
      var sourceBox = root.querySelector('.ai-image-source-box');
      if (sourceBox) {
        sourceBox.classList.toggle('is-disabled', sourceDisabled);
      }
      var fileInput = document.getElementById('ai-image-source-file');
      if (fileInput) fileInput.disabled = !!sourceDisabled;
      var uploadBtn = root.querySelector('.source-upload-fab');
      if (uploadBtn) uploadBtn.disabled = !!sourceDisabled;
    } catch (_) { }
  }

  function updateSourceFieldUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var project = state.currentProject;
      var detached = !(project && project.id);
      var sourceDisabled = state.mode !== 'image-to-image';
      var sourceField = root.querySelector('.ai-image-field.source-field');
      if (!sourceField) return;
      var existingSelectionNode = sourceField.querySelector('.ai-image-source-selection, .ai-image-source-empty');
      var existingSelectionSignature = existingSelectionNode ? String(existingSelectionNode.getAttribute('data-selection-signature') || '') : '';
      sourceField.outerHTML = buildSourceFieldMarkup(detached, project, sourceDisabled);
      var nextSourceField = root.querySelector('.ai-image-field.source-field');
      var nextSelectionNode = nextSourceField ? nextSourceField.querySelector('.ai-image-source-selection, .ai-image-source-empty') : null;
      var nextSelectionSignature = nextSelectionNode ? String(nextSelectionNode.getAttribute('data-selection-signature') || '') : '';
      if (existingSelectionNode && nextSelectionNode && existingSelectionSignature && existingSelectionSignature === nextSelectionSignature) {
        nextSelectionNode.parentNode.replaceChild(existingSelectionNode, nextSelectionNode);
      }
      bindSourceFileInput();
    } catch (_) {}
  }

  function updateSourceLibrarySelectionClasses(root) {
    try {
      var scope = root || document.getElementById('ai-image-root');
      if (!scope) return;
      var libraryCards = scope.querySelectorAll('.ai-image-source-card');
      Array.prototype.forEach.call(libraryCards || [], function (card) {
        var img = card.querySelector('img');
        var thumbUrl = img ? String(img.getAttribute('src') || '').trim() : '';
        card.classList.toggle('active', hasSelectedSourceUrl(thumbUrl));
      });
    } catch (_) {}
  }

  function updateSourceSelectionUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var sourceField = root.querySelector('.ai-image-field.source-field');
      var sourceBox = sourceField ? sourceField.querySelector('.ai-image-source-box') : null;
      if (!sourceField || !sourceBox) return;

      var sourceDisabled = state.mode !== 'image-to-image';
      sourceField.classList.toggle('is-disabled', sourceDisabled);
      sourceBox.classList.toggle('is-disabled', sourceDisabled);
      sourceBox.classList.toggle('has-image', !!getSourceImages().length);

      var limitEl = sourceField.querySelector('.ai-image-source-limit');
      if (limitEl) limitEl.textContent = String(getSourceImages().length) + '/' + String(MAX_SOURCE_IMAGES);

      var uploadBtn = sourceBox.querySelector('.source-upload-fab');
      if (uploadBtn) uploadBtn.disabled = !!sourceDisabled;
      var fileInput = document.getElementById('ai-image-source-file');
      if (fileInput) fileInput.disabled = !!sourceDisabled;

      var existingSelection = sourceBox.querySelector('.ai-image-source-selection, .ai-image-source-empty');
      var existingCardMap = new Map();
      Array.prototype.forEach.call(sourceBox.querySelectorAll('.ai-image-source-selection-card[data-source-id]') || [], function (card) {
        existingCardMap.set(String(card.getAttribute('data-source-id') || ''), card);
      });

      var items = getSourceImages();
      var nextSelection;
      if (!items.length) {
        nextSelection = document.createElement('div');
        nextSelection.className = 'ai-image-source-empty';
        nextSelection.setAttribute('data-selection-signature', sourceSelectionSignature());
      } else {
        nextSelection = document.createElement('div');
        nextSelection.className = 'ai-image-source-selection';
        nextSelection.setAttribute('data-selection-signature', sourceSelectionSignature());
        var selectedId = String(ensureSelectedSourceId() || '');
        items.forEach(function (item, index) {
          var sourceId = String(item && item.id || '');
          var existingCard = existingCardMap.get(sourceId) || null;
          var card = existingCard || document.createElement('div');
          card.className = 'ai-image-source-selection-card';
          card.setAttribute('role', 'button');
          card.setAttribute('tabindex', '0');
          card.setAttribute('data-source-id', sourceId);
          card.setAttribute('data-action', 'select-source-primary');
          card.setAttribute('data-index', String(index));
          card.classList.toggle('is-primary', sourceId === selectedId);
          if (!existingCard) {
            card.innerHTML = '' +
              '<div class="ai-image-source-selection-media">' +
                '<div class="ai-image-source-selection-trigger"><img alt="" /></div>' +
                '<button type="button" class="ai-image-source-remove" data-action="remove-source" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button>' +
                '<button type="button" class="ai-image-source-view" data-action="toggle-source-modal" aria-label="' + escapeHtml(t('viewOriginal')) + '" title="' + escapeHtml(t('viewOriginal')) + '"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.2-4.2"></path></svg></button>' +
              '</div>';
          }
          var imageEl = card.querySelector('.ai-image-source-selection-trigger img');
          if (imageEl && String(imageEl.getAttribute('src') || '') !== String(item.url || '')) {
            imageEl.setAttribute('src', String(item.url || ''));
          }
          var removeBtn = card.querySelector('.ai-image-source-remove');
          if (removeBtn) {
            removeBtn.setAttribute('data-index', String(index));
            removeBtn.setAttribute('aria-label', t('deleteLabel'));
            removeBtn.setAttribute('title', t('deleteLabel'));
          }
          var viewBtn = card.querySelector('.ai-image-source-view');
          if (viewBtn) {
            viewBtn.setAttribute('data-url', String(item.url || ''));
            viewBtn.setAttribute('aria-label', t('viewOriginal'));
            viewBtn.setAttribute('title', t('viewOriginal'));
          }
          nextSelection.appendChild(card);
        });
      }

      if (existingSelection && existingSelection.parentNode) {
        existingSelection.parentNode.replaceChild(nextSelection, existingSelection);
      }
      updateSourceLibrarySelectionClasses(root);
    } catch (_) {}
  }

  function updateHeaderUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var project = state.currentProject;
      var brand = state.currentBrand;
      var detached = !(project && project.id);
      var headerTitle = root.querySelector('.ai-image-header h1');
      if (headerTitle) headerTitle.textContent = t('heroTitle');
      var heroPills = root.querySelectorAll('.studio-hero-pill');
      if (heroPills[0]) {
        var em0 = heroPills[0].querySelector('em');
        var strong0 = heroPills[0].querySelector('strong');
        if (em0) em0.textContent = t('sessionLabel');
        if (strong0) strong0.textContent = detached ? t('noneLabel') : state.sessionId;
      }
      if (heroPills[1]) {
        var em1 = heroPills[1].querySelector('em');
        var strong1 = heroPills[1].querySelector('strong');
        if (em1) em1.textContent = t('projectLabel');
        if (strong1) strong1.textContent = detached ? t('noneLabel') : (project && project.title ? project.title : t('noProject'));
      }
      if (heroPills[2]) {
        var em2 = heroPills[2].querySelector('em');
        var strong2 = heroPills[2].querySelector('strong');
        if (em2) em2.textContent = t('brandLabel');
        if (strong2) strong2.textContent = detached ? t('noneLabel') : (brand && brand.brandTitle ? brand.brandTitle : t('noBrand'));
      }
    } catch (_) {}
  }

  function updatePromptPanelUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var project = state.currentProject;
      var detached = !(project && project.id);
      var promptPanel = root.querySelector('.ai-image-panel-left');
      if (promptPanel) {
        promptPanel.outerHTML = buildPromptPanelMarkup(detached, project, state.mode !== 'image-to-image');
        hydratePromptControls();
      }
    } catch (_) {}
  }

  function updatePreviewPanelUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var project = state.currentProject;
      var brand = state.currentBrand;
      var detached = !(project && project.id);
      var selectedPreview = currentPreviewTarget();
      var previewPanel = root.querySelector('.ai-image-panel-preview');
      if (previewPanel) {
        previewPanel.outerHTML = buildPreviewPanelMarkup(detached, project, brand, selectedPreview);
      }
    } catch (_) {}
  }

  function updateInlineCameraControlsFromInputs() {
    var panEl = document.getElementById('ai-image-camera-pan');
    var tiltEl = document.getElementById('ai-image-camera-tilt');
    var distEl = document.getElementById('ai-image-camera-distance');
    var current = normalizeCameraControls(state.cameraControls);
    current.pan = wrapPanDegrees(panEl && panEl.value, current.pan);
    current.tilt = clampNumber(tiltEl && tiltEl.value, CAMERA_TILT_MIN, CAMERA_TILT_MAX, current.tilt);
    current.distance = clampNumber(distEl && distEl.value, CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX, current.distance);
    current.preset = 'custom';
    current.enabled = !isNeutralCameraControls(current);
    state.cameraControls = current;
    var previewResult = currentPreviewResult();
    if (previewResult) previewResult.cameraControls = normalizeCameraControls(current);
  }

  function syncInlineCameraUi() {
    var controls = normalizeCameraControls(state.cameraControls);
    var panValue = document.getElementById('ai-image-camera-pan-value');
    var tiltValue = document.getElementById('ai-image-camera-tilt-value');
    var distValue = document.getElementById('ai-image-camera-distance-value');
    var orbit = document.querySelector('.ai-image-camera-orbit');
    var applyButton = document.querySelector('.ai-image-camera-apply');
    var cameraCard = document.querySelector('.ai-image-camera-card');
    var orbitPreview = computeCameraOrbitPreview(controls);
    if (panValue) panValue.textContent = String(controls.pan);
    if (tiltValue) tiltValue.textContent = String(controls.tilt);
    if (distValue) distValue.textContent = String(controls.distance);
    if (applyButton) applyButton.disabled = !controls.enabled;
    if (cameraCard) cameraCard.classList.toggle('is-active', !!controls.enabled);
    Array.prototype.forEach.call(document.querySelectorAll('.ai-image-camera-preset[data-preset]') || [], function (button) {
      var presetKey = String(button.getAttribute('data-preset') || '').trim().toLowerCase();
      var isResetDefault = presetKey === 'front' && isNeutralCameraControls(controls);
      var isActive = controls.preset === presetKey || isResetDefault;
      button.classList.toggle('active', !!isActive);
    });
    if (orbit) {
      var toggle = orbit.querySelector('.ai-image-camera-target-toggle');
      orbit.innerHTML = buildCameraOrbitSvgMarkup(orbitPreview) + (toggle ? toggle.outerHTML : '');
    }
  }

  function persistInlineCameraControls(options) {
    var opts = options && typeof options === 'object' ? options : {};
    persistHistory();
    updatePreviewPanelUI();
    if (opts.refreshHistoryPanel) updateHistoryPanelUI();
  }

  function updateHistoryPanelUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var historyPanel = root.querySelector('.ai-image-panel-history');
      var prevScroll = 0;
      if (historyPanel) {
        var list = historyPanel.querySelector('.ai-image-history-list');
        if (list) prevScroll = Number(list.scrollTop || 0) || 0;
        historyPanel.outerHTML = buildHistoryPanelMarkup();
        var nextPanel = root.querySelector('.ai-image-panel-history');
        var nextList = nextPanel && nextPanel.querySelector('.ai-image-history-list');
        if (nextList) nextList.scrollTop = prevScroll;
      }
    } catch (_) {}
  }

  function buildHistoryCardMarkup(item) {
    var active = String(item && item.id || '') === String(state.currentResultId || '');
    return '' +
      '<div class="ai-image-history-card' + (active ? ' active' : '') + '" role="button" tabindex="0" data-action="select-result" data-id="' + escapeHtml(String(item && item.id || '')) + '">' +
      '<button type="button" class="ai-image-history-delete" data-action="delete-result" data-id="' + escapeHtml(String(item && item.id || '')) + '" aria-label="' + escapeHtml(t('deleteLabel')) + '" title="' + escapeHtml(t('deleteLabel')) + '">×</button>' +
      '<img src="' + escapeHtml(resolveResultUrl(item)) + '" alt="" class="ai-image-history-thumb" />' +
      '<div class="ai-image-history-meta">' +
      '<strong>' + escapeHtml(((item && item.mode) === 'image-to-image' ? t('modeImageShort') : t('modeTextShort')) + ' · ' + generationStyleShortLabel((item && item.generationStyle) || 'single')) + '</strong>' +
      '<p>' + escapeHtml((item && item.prompt) || '') + '</p>' +
      ((item && item.savedToProject) ? '<span class="ai-image-saved-chip">' + escapeHtml(t('resultSavedTag')) + '</span>' : '') +
      '</div>' +
      '</div>';
  }

  function appendHistoryCardIfPossible(item) {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var panel = root.querySelector('.ai-image-panel-history');
      if (!panel) {
        updateHistoryPanelUI();
        return;
      }
      var list = panel.querySelector('.ai-image-history-list');
      if (!list) {
        updateHistoryPanelUI();
        return;
      }
      var container = document.createElement('div');
      container.innerHTML = buildHistoryCardMarkup(item);
      var card = container.firstChild;
      if (card) {
        list.insertBefore(card, list.firstChild || null);
      }
    } catch (_) {}
  }

  function clearAllHistoryResults(project) {
    var items = Array.isArray(state.results) ? state.results.slice() : [];
    if (!items.length) return false;
    items.forEach(function (item) {
      var row = item && typeof item === 'object' ? item : {};
      var objectName = String(row.objectName || '').trim();
      if (row.savedToProject && objectName && project && project.id && NK.api && NK.api.projectDelete) {
        NK.api.projectDelete(project.id, objectName).catch(function () { });
      }
      if (objectName) addDeletedTombstone(objectName);
    });
    try {
      if (NK.api && typeof NK.api.aiImageSessionLibrary === 'function' && state.sessionId) {
        NK.api.aiImageSessionLibrary(state.sessionId).then(function (res) {
          var items = Array.isArray(res && res.items) ? res.items : [];
          items.forEach(function (it) {
            var name = String((it && (it.name || it.objectName)) || '').trim();
            if (name) addDeletedTombstone(name);
          });
        }).catch(function () { });
      }
    } catch (_) {}
    state.results = [];
    state.currentResultId = '';
    state.previewTargetType = 'none';
    state.historyPanelMode = 'history';
    state.cameraTargetMode = 'scene';
    state.cameraControls = createDefaultCameraControls();
    persistHistory();
    updateResultSelectionUI();
    updatePromptPanelUI();
    updateHistoryPanelUI();
    return true;
  }

  // Partial DOM update for source area to avoid reloading all images
  function updateSourceUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var tabs = root.querySelectorAll('.ai-image-mode-tabs .btn-secondary');
      Array.prototype.forEach.call(tabs || [], function (btn) {
        var m = String(btn.getAttribute('data-mode') || '');
        if (m && m === state.mode) btn.classList.add('active');
        else btn.classList.remove('active');
      });
      var promptEl = document.getElementById('ai-image-prompt');
      if (promptEl) {
        promptEl.setAttribute('placeholder', state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText'));
      }
      updateSourceSelectionUI();
    } catch (_) {}
  }

  function updateHistorySelectionUI() {
    try {
      var root = document.getElementById('ai-image-root');
      if (!root) return;
      var cards = root.querySelectorAll('.ai-image-history-card[data-id]');
      Array.prototype.forEach.call(cards || [], function (card) {
        var isActive = String(card.getAttribute('data-id') || '') === String(state.currentResultId || '');
        card.classList.toggle('active', isActive);
      });
    } catch (_) {}
  }

  function updateResultSelectionUI() {
    try {
      updatePreviewPanelUI();
      updateHistorySelectionUI();
    } catch (_) { }
  }

  function toDownloadName(result) {
    return 'ai-image-' + String(result && result.id || Date.now()) + '.png';
  }

  async function downloadResult(result) {
    try {
      var targetUrl = resolveResultUrl(result);
      if (!result || !targetUrl) return;
      var response = await fetch(targetUrl);
      var blob = await response.blob();
      var objectUrl = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = objectUrl;
      a.download = toDownloadName(result);
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 100);
    } catch (err) {
      alert(t('downloadFailed') + (err && err.message ? err.message : err));
    }
  }

  async function analyzeResultPrompt(resultId) {
    var target = state.results.find(function (item) {
      return String(item && item.id || '') === String(resultId || '');
    });
    if (!target) return;
    setGlobalLoading(true, t('analyzing'));
    try {
      if (!NK.api || typeof NK.api.imagenDescribe !== 'function') {
        throw new Error('imagen_describe_api_missing');
      }
      var response = await NK.api.imagenDescribe({
        imageUrl: resolveResultUrl(target),
        lang: state.lang
      });
      var nextPrompt = String(response && response.prompt || '').trim();
      if (!nextPrompt) {
        throw new Error('empty_analysis_prompt');
      }
      state.prompt = nextPrompt;
      updatePromptFieldUI();
      var promptInput = document.getElementById('ai-image-prompt');
      if (promptInput && typeof promptInput.focus === 'function') {
        try { promptInput.focus({ preventScroll: true }); } catch (_) { promptInput.focus(); }
      }
    } catch (err) {
      alert(t('analyzeFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function resultToFile(result) {
    var url = resolveResultUrl(result);
    if (!url) throw new Error('result_url_missing');
    if (url.indexOf('data:') === 0) {
      var arr = url.split(',');
      var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
      var bstr = atob(arr[1] || '');
      var n = bstr.length;
      var u8 = new Uint8Array(n);
      while (n--) u8[n] = bstr.charCodeAt(n);
      return new File([u8], toDownloadName(result), { type: mime });
    }
    var response = await fetch(url);
    if (!response.ok) throw new Error('result_fetch_failed');
    var blob = await response.blob();
    return new File([blob], toDownloadName(result), { type: blob.type || 'image/png' });
  }

  async function resultToDataUrl(result) {
    var url = resolveResultUrl(result);
    if (!url) throw new Error('result_url_missing');
    if (url.indexOf('data:') === 0) return url;
    var response = await fetch(url);
    if (!response.ok) throw new Error('result_fetch_failed');
    var blob = await response.blob();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('result_read_failed')); };
      reader.readAsDataURL(blob);
    });
  }

  async function saveResultToBrand(resultId) {
    if (!state.currentBrand || !state.currentBrand.brandId) {
      alert(t('saveBrandDisabled'));
      return;
    }
    var result = state.results.find(function (item) {
      return String(item && item.id || '') === String(resultId || '');
    });
    if (!result) return;
    var selectEl = document.getElementById('ai-image-brand-target');
    var selectedToken = normalizeCharacterToken(selectEl && selectEl.value);
    if (!selectedToken) {
      var available = brandCharacterOptions();
      if (!available.length) {
        alert(t('saveBrandNoCharacters'));
        return;
      }
      alert(t('saveBrandChooseCharacter'));
      return;
    }
    setGlobalLoading(true, t('saveBrand'));
    try {
      var savedBrand = await registerImageToBrand(state.currentBrand.brandId, selectedToken, result);
      state.currentBrand = savedBrand || state.currentBrand;
      result.savedBrandTargets = Array.isArray(result.savedBrandTargets) ? result.savedBrandTargets : [];
      if (result.savedBrandTargets.indexOf(selectedToken) < 0) result.savedBrandTargets.push(selectedToken);
      result.selectedBrandCharacterToken = selectedToken;
      persistHistory();
      updateHeaderUI();
      updatePreviewPanelUI();
      alert(t('savedBrand'));
    } catch (err) {
      alert(t('brandSaveFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function loadProjectLibrary() {
    if (!state.currentProject || !state.currentProject.id) return;
    state.libraryLoading = true;
    updateSourceFieldUI();
    try {
      var res = await NK.api.library('image', state.currentProject.id);
      state.projectLibraryItems = (Array.isArray(res && res.items) ? res.items : []).filter(isImageLibraryItem);
    } catch (err) {
      alert(t('projectLoadFailed') + (err && err.message ? err.message : err));
    } finally {
      state.libraryLoading = false;
      updateSourceFieldUI();
    }
  }

  async function loadBrandLibrary() {
    if (!state.currentBrand || !state.currentBrand.brandId) return;
    state.brandLibraryLoading = true;
    updateSourceFieldUI();
    try {
      var res = await NK.api.libraryIP('', { brandId: state.currentBrand.brandId });
      state.brandLibraryItems = (Array.isArray(res && res.items) ? res.items : []).filter(isImageLibraryItem);
      if (!state.brandLibraryItems.length) {
        alert(t('sourceBrandEmpty'));
      }
    } catch (err) {
      alert(t('brandLoadFailed') + (err && err.message ? err.message : err));
    } finally {
      state.brandLibraryLoading = false;
      updateSourceFieldUI();
    }
  }
  async function loadContentLibrary() {
    state.contentLibraryLoading = true;
    updateSourceFieldUI();
    try {
      var target = (state.currentBrand && state.currentBrand.brandId) ? state.currentBrand : state.currentProject;
      if (!NK.service || !NK.service.contentLibrary || !target) {
        state.contentLibraryItems = [];
      } else {
        var items = NK.service.contentLibrary.listProjectContents(target);
        state.contentLibraryItems = (Array.isArray(items) ? items : []).filter(function (it) {
          return String(it && it.type || '') === 'image' && String(it && it.url || '').trim();
        }).map(function (it) {
          return { url: String(it.url || '').trim(), title: String(it.title || '').trim() || 'Image' };
        });
      }
    } catch (err) {
      alert(t('brandLoadFailed'));
    } finally {
      state.contentLibraryLoading = false;
      updateSourceFieldUI();
    }
  }

  async function hydrateSessionHistory() {
    if (!state.sessionId || !NK.api || !NK.api.aiImageSessionLibrary) return;
    loadDeletedSet();
    state.historyLoading = true;
    state.historyLoadError = '';
    updateHistoryPanelUI();
    try {
      var res = await NK.api.aiImageSessionLibrary(state.sessionId);
      mergeServerResults(Array.isArray(res && res.items) ? res.items : []);
      persistHistory();
    } catch (err) {
      console.warn('AI image session history sync failed', err);
      state.historyLoadError = (err && err.status === 404) ? '' : '1';
    } finally {
      state.historyLoading = false;
      updatePreviewPanelUI();
      updateHistoryPanelUI();
    }
  }

  async function saveResultToProject(resultId) {
    if (!state.currentProject || !state.currentProject.id) {
      alert(t('saveDisabled'));
      return;
    }
    var result = state.results.find(function (item) {
      return String(item && item.id || '') === String(resultId || '');
    });
    if (!result) return;
    setGlobalLoading(true, t('saveProject'));
    try {
      await registerImageToProject(state.currentProject.id, result);
      result.savedToProject = true;
      persistHistory();
      updateHistoryPanelUI();
      alert(t('savedProject'));
    } catch (err) {
      alert(t('projectSaveFailed') + (err && err.message ? err.message : err));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function generateImage(attempt) {
    var tryCount = Number(attempt || 0) || 0;
    var prompt = String(state.prompt || '').trim();
    var appliedCameraControls = normalizeCameraControls(state.cameraControls);
    var finalPrompt = buildPromptWithCameraControls(prompt, appliedCameraControls);
    if (!prompt) {
      alert(t('promptRequired'));
      return;
    }
    if (state.mode === 'image-to-image' && !getSourceImages().length) {
      alert(t('sourceRequired'));
      return;
    }

    var chosenSize = String(state.imageSize || '1K').toUpperCase();
    if (tryCount > 0) {
      if (chosenSize === '2K') chosenSize = '1K';
      else if (chosenSize === '1K') chosenSize = '512';
    }
    var payload = {
      prompt: finalPrompt,
      aspectRatio: state.aspectRatio,
      storageService: 'ai-image',
      sessionId: state.sessionId,
      generationMode: state.mode,
      generationStyle: normalizeGenerationStyle(state.generationStyle),
      imageSize: chosenSize,
      cameraTargetMode: (state.mode === 'image-to-image') ? 'subject' : undefined,
      referenceImages: state.mode === 'image-to-image' && getSourceImages().length
        ? orderedSourceImages().map(function (item, index) {
          return {
            referenceId: index + 1,
            imageDataUrl: item.url,
            subjectDescription: sourceKindLabel(item.kind) + ' reference ' + String(index + 1),
            subjectType: 'SUBJECT_TYPE_DEFAULT'
          };
        })
        : [],
      conversationHistory: buildConversationHistory(3)
    };

    setGlobalLoading(true, t('generating'));
    try {
      var response = await NK.api.imagen(payload);
      var result = {
        id: 'res_' + Date.now(),
        url: String(response && (response.signedUrl || response.dataUrl) || '').trim(),
        objectName: String(response && response.objectName || '').trim(),
        imageSize: String(response && response.imageSizeApplied || state.imageSize || '').trim(),
        prompt: prompt,
        resolvedPrompt: finalPrompt,
        mode: state.mode,
        generationStyle: normalizeGenerationStyle(state.generationStyle),
        cameraControls: appliedCameraControls,
        conversationTurnCount: Number(response && response.conversationTurnCount || payload.conversationHistory.length || 0) || 0,
        aspectRatio: state.aspectRatio,
        createdAt: new Date().toISOString(),
        savedToProject: false,
        sessionId: state.sessionId
      };
      if (!result.url) throw new Error('image_result_missing');
      state.results.unshift(result);
      state.results = state.results.slice(0, 30);
      state.currentResultId = result.id;
      state.previewTargetType = 'result';
      state.cameraControls = createDefaultCameraControls();
      persistHistory();
      appendHistoryCardIfPossible(result);
      updateResultSelectionUI();
    } catch (err) {
      if (shouldRetryImagenRequest(err) && tryCount < 1) {
        try {
          await generateImage(tryCount + 1);
          return;
        } catch (_) {}
      }
      var msg = (err && err.message) ? String(err.message) : String(err);
      var hint = '';
      try {
        var raw = String(err && err.detail || '').trim();
        var parsed = raw ? JSON.parse(raw) : null;
        var d = parsed && parsed.detail ? parsed.detail : parsed;
        var code = (parsed && (parsed.code || parsed.status)) || '';
        var status = (err && err.status) || (parsed && parsed.status) || '';
        var serverHint = parsed && parsed.hint ? parsed.hint : '';
        var serverMsg = (d && d.error && d.error.message) || (parsed && parsed.message) || '';
        if (serverMsg && !/Gemini API error/i.test(msg)) msg = serverMsg;
        if (status) hint = String(serverHint || '') + (serverHint ? ' ' : '') + '(status: ' + status + ')';
        else if (serverHint) hint = serverHint;
      } catch (_) {}
      if (!hint && isTimeoutLikeImagenError(err)) {
        hint = state.lang === 'en'
          ? 'The request took too long, so we retried once with a lighter generation payload. Please try again shortly if it still fails.'
          : '생성이 오래 걸려 한 번 더 가벼운 설정으로 자동 재시도했습니다. 계속 실패하면 잠시 후 다시 시도해 주세요.';
      }
      alert(t('generationFailed') + msg + (hint ? ('\n힌트: ' + hint) : ''));
    } finally {
      setGlobalLoading(false);
    }
  }

  async function generateImageCameraApply(attempt) {
    var tryCount = Number(attempt || 0) || 0;
    var appliedCameraControls = normalizeCameraControls(state.cameraControls);
    var appliedCameraTargetMode = normalizeCameraTargetMode(state.cameraTargetMode);
    var previewTarget = currentPreviewTarget();
    var cameraOnly = (window.NK && NK.utils && typeof NK.utils.buildCameraPrompt === 'function')
      ? NK.utils.buildCameraPrompt(appliedCameraControls)
      : (typeof window.buildCameraPrompt === 'function' ? window.buildCameraPrompt(appliedCameraControls) : '');
    if (!cameraOnly) {
      var fallback = (window.NK && NK.utils && typeof NK.utils.mapCameraToPrompt === 'function')
        ? NK.utils.mapCameraToPrompt(appliedCameraControls)
        : (typeof window.mapCameraToPrompt === 'function' ? window.mapCameraToPrompt(appliedCameraControls) : '');
      cameraOnly = fallback || '(camera: cinematic medium shot:1.2)';
    }
    // 카메라 앵글은 매 적용마다 원본 소스 기준으로 산정되도록 primary 소스를 우선 사용.
    // 소스가 없을 때(text-to-image 등)에만 현재 미리보기 대상을 레퍼런스로 사용.
    var primarySource = primarySourceImage();
    var cameraReferenceTarget = previewTarget;
    if (primarySource && String(primarySource.url || '').trim()) {
      cameraReferenceTarget = {
        type: 'source',
        id: String(primarySource.id || ''),
        url: String(primarySource.url || '').trim(),
        name: String(primarySource.name || '').trim(),
        sourceKind: String(primarySource.kind || 'upload').trim()
      };
    }
    var cameraPrompt = buildCameraApplyPrompt(cameraOnly, cameraReferenceTarget, appliedCameraTargetMode);
    var previewReferenceImages = [];
    if (cameraReferenceTarget && cameraReferenceTarget.url) {
      previewReferenceImages = [{
        referenceId: 1,
        imageDataUrl: cameraReferenceTarget.url,
        subjectDescription: cameraReferenceTarget.type === 'source'
          ? (sourceKindLabel(cameraReferenceTarget.sourceKind) + ' source reference')
          : 'preview result reference',
        subjectType: 'SUBJECT_TYPE_DEFAULT'
      }];
    }
    var effectiveMode = previewReferenceImages.length ? 'image-to-image' : state.mode;
    if (effectiveMode === 'image-to-image' && !previewReferenceImages.length) {
      effectiveMode = 'text-to-image';
    }
    var chosenSize = String(state.imageSize || '1K').toUpperCase();
    if (tryCount > 0) {
      if (chosenSize === '2K') chosenSize = '1K';
      else if (chosenSize === '1K') chosenSize = '512';
    }
    var payload = {
      prompt: cameraPrompt,
      aspectRatio: state.aspectRatio,
      storageService: 'ai-image',
      sessionId: state.sessionId,
      generationMode: effectiveMode,
      generationStyle: normalizeGenerationStyle(state.generationStyle),
      cameraTargetMode: appliedCameraTargetMode,
      imageSize: chosenSize,
      referenceImages: previewReferenceImages,
      conversationHistory: previewTarget && previewTarget.type === 'result' ? buildConversationHistory(3) : []
    };
    setGlobalLoading(true, t('generating'));
    try {
      var response = await NK.api.imagen(payload);
      // 결과 카드와 향후 카메라 재적용 시 장면 컨셉을 이어가기 위해 요약 라벨을 prompt로 저장.
      var cameraLabel = cameraSummary(appliedCameraControls, appliedCameraTargetMode);
      var result = {
        id: 'res_' + Date.now(),
        url: String(response && (response.signedUrl || response.dataUrl) || '').trim(),
        objectName: String(response && response.objectName || '').trim(),
        imageSize: String(response && response.imageSizeApplied || state.imageSize || '').trim(),
        prompt: cameraLabel,
        resolvedPrompt: cameraPrompt,
        mode: effectiveMode,
        generationStyle: normalizeGenerationStyle(state.generationStyle),
        cameraTargetMode: appliedCameraTargetMode,
        cameraControls: appliedCameraControls,
        conversationTurnCount: Number(response && response.conversationTurnCount || payload.conversationHistory.length || 0) || 0,
        aspectRatio: state.aspectRatio,
        createdAt: new Date().toISOString(),
        savedToProject: false,
        sessionId: state.sessionId
      };
      if (!result.url) throw new Error('image_result_missing');
      state.results.unshift(result);
      state.results = state.results.slice(0, 30);
      state.currentResultId = result.id;
      state.previewTargetType = 'result';
      state.cameraTargetMode = 'scene';
      state.cameraControls = createDefaultCameraControls();
      persistHistory();
      updateResultSelectionUI();
      // 생성 성공 후 카메라 카드(슬라이더·오빗·Apply 버튼)를 리셋된 state와 동기화
      syncInlineCameraUi();
    } catch (err) {
      if (shouldRetryImagenRequest(err) && tryCount < 1) {
        try {
          await generateImageCameraApply(tryCount + 1);
          return;
        } catch (_) { }
      }
      var msg = (err && err.message) ? String(err.message) : String(err);
      var hint = '';
      try {
        var raw = String(err && err.detail || '').trim();
        var parsed = raw ? JSON.parse(raw) : null;
        var d = parsed && parsed.detail ? parsed.detail : parsed;
        var code = (parsed && (parsed.code || parsed.status)) || '';
        var status = (err && err.status) || (parsed && parsed.status) || '';
        var serverHint = parsed && parsed.hint ? parsed.hint : '';
        var serverMsg = (d && d.error && d.error.message) || (parsed && parsed.message) || '';
        if (serverMsg && !/Gemini API error/i.test(msg)) msg = serverMsg;
        if (status) hint = String(serverHint || '') + (serverHint ? ' ' : '') + '(status: ' + status + ')';
        else if (serverHint) hint = serverHint;
      } catch (_) {}
      if (!hint && isTimeoutLikeImagenError(err)) {
        hint = state.lang === 'en'
          ? 'The request took too long, so we retried once with a lighter generation payload. Please try again shortly if it still fails.'
          : '생성이 오래 걸려 한 번 더 가벼운 설정으로 자동 재시도했습니다. 계속 실패하면 잠시 후 다시 시도해 주세요.';
      }
      alert(t('generationFailed') + msg + (hint ? ('\n힌트: ' + hint) : ''));
    } finally {
      setGlobalLoading(false);
    }
  }

  function bindStaticEvents() {
    var root = document.getElementById('ai-image-root');
    if (root && !root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', function (evt) {
        var btn = evt.target.closest('[data-action]');
        if (!btn) return;
        try {
          evt.preventDefault();
          evt.stopPropagation();
        } catch (_) { }
        var action = btn.getAttribute('data-action') || '';
        var project = state.currentProject;
        if (
          state.mode !== 'image-to-image' &&
          (
            action === 'open-upload' ||
            action === 'remove-source' ||
            action === 'select-source-primary' ||
            action === 'load-project-library' ||
            action === 'load-brand-library' ||
            action === 'load-content-library' ||
            action === 'select-project-source' ||
            action === 'select-brand-source' ||
            action === 'select-content-source' ||
            action === 'toggle-source-section' ||
            action === 'toggle-source-modal'
          )
        ) {
          return;
        }
        if (action === 'set-mode') {
          state.mode = String(btn.getAttribute('data-mode') || 'text-to-image');
          updateModeUI();
          try {
            var tabsNow = root.querySelectorAll('.ai-image-mode-tabs .btn-secondary');
            Array.prototype.forEach.call(tabsNow || [], function(tb){
              var m = String(tb.getAttribute('data-mode') || '');
              if (m && m === state.mode) tb.classList.add('active'); else tb.classList.remove('active');
            });
            var promptEl = document.getElementById('ai-image-prompt');
            if (promptEl) {
              var ph = state.mode === 'image-to-image' ? t('promptPlaceholderImage') : t('promptPlaceholderText');
              promptEl.setAttribute('placeholder', ph);
            }
          } catch (_) {}
          if (state.mode === 'image-to-image') {
            if (!state.brandLibraryItems.length && state.currentBrand && state.currentBrand.brandId) loadBrandLibrary();
            if (!state.contentLibraryItems.length) loadContentLibrary();
            if (!state.projectLibraryItems.length && state.currentProject && state.currentProject.id) loadProjectLibrary();
          }
          return;
        }
        if (action === 'open-upload') {
          var input = document.getElementById('ai-image-source-file');
          if (input) input.click();
          return;
        }
        if (action === 'remove-source') {
          var removeIndex = Number(btn.getAttribute('data-index') || -1);
          removeSourceImageAt(removeIndex);
            if (!getSourceImages().length && String(state.previewTargetType || '') === 'source') {
            state.previewTargetType = 'none';
          }
          updateSourceUI();
          return;
        }
        if (action === 'select-source-primary') {
          var sourceIndex = Number(btn.getAttribute('data-index') || -1);
          setPrimarySourceByIndex(sourceIndex);
          // 카메라 앵글을 바로 사용할 수 있도록 클릭한 소스를 미리보기로 전환
          state.previewTargetType = 'source';
          updateSourceUI();
          updatePreviewPanelUI();
          updatePromptPanelUI();
          return;
        }
        if (action === 'load-project-library') {
          loadProjectLibrary();
          return;
        }
        if (action === 'load-brand-library') {
          loadBrandLibrary();
          return;
        }
        if (action === 'load-content-library') {
          loadContentLibrary();
          return;
        }
        if (action === 'select-project-source') {
          var idx = Number(btn.getAttribute('data-index') || -1);
          var item = idx >= 0 ? state.projectLibraryItems[idx] : null;
          if (!item) return;
          var nextUrl = resolveLibraryItemUrl(item);
          toggleSourceImage(nextUrl, String(item.name || '').trim(), 'project');
          updateSourceUI();
          return;
        }
        if (action === 'select-brand-source') {
          var brandIdx = Number(btn.getAttribute('data-index') || -1);
          var brandItem = brandIdx >= 0 ? state.brandLibraryItems[brandIdx] : null;
          if (!brandItem) return;
          var nextBrandUrl = resolveLibraryItemUrl(brandItem);
          toggleSourceImage(nextBrandUrl, String(brandItem.name || '').trim(), 'brand');
          updateSourceUI();
          return;
        }
        if (action === 'select-content-source') {
          var cIdx = Number(btn.getAttribute('data-index') || -1);
          var cItem = cIdx >= 0 ? state.contentLibraryItems[cIdx] : null;
          if (!cItem) return;
          var nextContentUrl = resolveContentItemUrl(cItem);
          toggleSourceImage(nextContentUrl, String(cItem.title || '').trim(), 'content');
          updateSourceUI();
          return;
        }
        if (action === 'generate-image') {
          generateImage();
          return;
        }
        if (action === 'select-result') {
          state.currentResultId = String(btn.getAttribute('data-id') || '');
          state.previewTargetType = 'result';
          var selected = currentResult();
          state.cameraTargetMode = selected && selected.cameraTargetMode
            ? normalizeCameraTargetMode(selected.cameraTargetMode)
            : 'scene';
          state.cameraControls = selected && selected.cameraControls
            ? normalizeCameraControls(selected.cameraControls)
            : createDefaultCameraControls();
          updateResultSelectionUI();
          updatePromptPanelUI();
          return;
        }
        if (action === 'toggle-camera-panel') {
          state.historyPanelMode = normalizeHistoryPanelMode(state.historyPanelMode) === 'camera' ? 'history' : 'camera';
          updatePreviewPanelUI();
          updateHistoryPanelUI();
          return;
        }
        if (action === 'toggle-source-section') {
          var sec = String(btn.getAttribute('data-section') || '').trim();
          if (sec && state.sourceSectionCollapsed && Object.prototype.hasOwnProperty.call(state.sourceSectionCollapsed, sec)) {
            var nextOpen = !!state.sourceSectionCollapsed[sec];
            state.sourceSectionCollapsed = { brand: true, content: true, project: true };
            state.sourceSectionCollapsed[sec] = !nextOpen;
            updateSourceFieldUI();
          }
          return;
        }
        if (action === 'toggle-preview-modal') {
          var imgUrl = String(btn.getAttribute('data-url') || '').trim();
          var existing = document.querySelector('.img-modal');
          if (existing) {
            existing.parentNode && existing.parentNode.removeChild(existing);
            state.imageModalUrl = '';
            return;
          }
          var urlToShow = imgUrl || currentPreviewUrl();
          if (urlToShow) {
            var modal = document.createElement('div');
            modal.className = 'img-modal';
            modal.setAttribute('data-action', 'toggle-preview-modal');
            var img = document.createElement('img');
            img.src = urlToShow;
            img.alt = '';
            modal.appendChild(img);
            root.appendChild(modal);
            state.imageModalUrl = urlToShow;
          }
          return;
        }
        if (action === 'set-camera-preset') {
          applyCameraPreset(btn.getAttribute('data-preset') || 'custom');
          var resultForPreset = currentPreviewResult();
          if (resultForPreset) {
            resultForPreset.cameraControls = normalizeCameraControls(state.cameraControls);
            resultForPreset.cameraTargetMode = normalizeCameraTargetMode(state.cameraTargetMode);
          }
          persistInlineCameraControls({ refreshHistoryPanel: true });
          return;
        }
        if (action === 'set-camera-target-mode') {
          state.cameraTargetMode = normalizeCameraTargetMode(btn.getAttribute('data-mode') || 'scene');
          var resultForTarget = currentPreviewResult();
          if (resultForTarget) resultForTarget.cameraTargetMode = normalizeCameraTargetMode(state.cameraTargetMode);
          persistInlineCameraControls({ refreshHistoryPanel: true });
          return;
        }
        if (action === 'reset-camera-controls') {
          resetCameraControls();
          var resultForReset = currentPreviewResult();
          if (resultForReset) {
            resultForReset.cameraControls = normalizeCameraControls(state.cameraControls);
            resultForReset.cameraTargetMode = normalizeCameraTargetMode(state.cameraTargetMode);
          }
          persistInlineCameraControls({ refreshHistoryPanel: true });
          return;
        }
        if (action === 'apply-camera-generate') {
          generateImageCameraApply();
          return;
        }
        if (action === 'set-aspect') {
          var nextAspectRatio = String(btn.getAttribute('data-ratio') || '16:9');
          if (String(state.aspectRatio || '') === nextAspectRatio) return;
          state.aspectRatio = nextAspectRatio;
          updateAspectButtonsUI();
          return;
        }
        if (action === 'toggle-source-modal') {
          var overlay = document.querySelector('.img-modal');
          if (overlay) {
            overlay.parentNode && overlay.parentNode.removeChild(overlay);
            state.imageModalUrl = '';
            return;
          }
          var sourceModalUrl = String(btn.getAttribute('data-url') || currentPreviewUrl() || sourcePreviewUrl()).trim();
          if (sourceModalUrl) {
            var el = document.createElement('div');
            el.className = 'img-modal';
            el.setAttribute('data-action', 'toggle-source-modal');
            var img = document.createElement('img');
            img.src = sourceModalUrl;
            img.alt = '';
            el.appendChild(img);
            root.appendChild(el);
            state.imageModalUrl = sourceModalUrl;
          }
          return;
        }
        if (action === 'download-result') {
          var result = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          downloadResult(result);
          return;
        }
        if (action === 'copy-result-prompt') {
          var cp = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          var textToCopy = cp && (cp.prompt || cp.resolvedPrompt || '');
          if (textToCopy) {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(String(textToCopy)).catch(function () { });
              }
            } catch (_) { }
            state.prompt = String(textToCopy || '');
            updatePromptFieldUI();
            updatePromptPanelUI();
            try {
              var promptInput2 = document.getElementById('ai-image-prompt');
              if (promptInput2 && typeof promptInput2.focus === 'function') {
                try { promptInput2.focus({ preventScroll: true }); } catch (_) { promptInput2.focus(); }
              }
            } catch (_) {}
          }
          return;
        }
        if (action === 'analyze-result-prompt') {
          analyzeResultPrompt(btn.getAttribute('data-id') || '');
          return;
        }
        if (action === 'delete-result') {
          var deleteId = String(btn.getAttribute('data-id') || '');
          if (!deleteId) return;
          try {
            var ok = window.confirm(t('deleteConfirm'));
            if (!ok) return;
          } catch (_) {
            // fall through if confirm not available
          }
          var idx = state.results.findIndex(function (r) { return String(r.id || '') === deleteId; });
          if (idx >= 0) {
            var toDelete = state.results[idx];
            var objectName = String(toDelete && toDelete.objectName || '').trim();
            if (toDelete && toDelete.savedToProject && objectName && project && project.id && NK.api && NK.api.projectDelete) {
              NK.api.projectDelete(project.id, objectName).catch(function () { });
            }
            if (objectName) {
              addDeletedTombstone(objectName);
              try {
                if (NK.api && typeof NK.api.aiImageSessionDelete === 'function') {
                  NK.api.aiImageSessionDelete(state.sessionId, { confirm: 'yes', objectName: objectName }).catch(function () { });
                } else {
                  fetch('/api/ai-image/session-delete', {
                    method: 'POST',
                    headers: Object.assign({ 'Content-Type': 'application/json' }, buildAuthHeaders()),
                    body: JSON.stringify({ sessionId: state.sessionId, confirm: 'yes', objectName: objectName })
                  }).catch(function () { });
                }
              } catch (_) {}
            }
            else {
              try {
                var targetUrl = resolveResultUrl(toDelete);
                if (NK.api && typeof NK.api.aiImageSessionLibrary === 'function' && state.sessionId && targetUrl) {
                  NK.api.aiImageSessionLibrary(state.sessionId).then(function (res) {
                    var items = Array.isArray(res && res.items) ? res.items : [];
                    var match = items.find(function (it) { return String(it && it.signedUrl || '').trim() === String(targetUrl || '').trim(); });
                    var name = String(match && (match.name || match.objectName) || '').trim();
                    if (name) {
                      addDeletedTombstone(name);
                      try {
                        if (NK.api && typeof NK.api.aiImageSessionDelete === 'function') {
                          NK.api.aiImageSessionDelete(state.sessionId, { confirm: 'yes', objectName: name }).catch(function () { });
                        } else {
                          fetch('/api/ai-image/session-delete', {
                            method: 'POST',
                            headers: Object.assign({ 'Content-Type': 'application/json' }, buildAuthHeaders()),
                            body: JSON.stringify({ sessionId: state.sessionId, confirm: 'yes', objectName: name })
                          }).catch(function () { });
                        }
                      } catch (_) {}
                    }
                  }).catch(function () { });
                }
              } catch (_) {}
            }
            state.results.splice(idx, 1);
            if (String(state.currentResultId || '') === deleteId) {
              state.currentResultId = '';
              if (String(state.previewTargetType || '') === 'result') state.previewTargetType = 'none';
            }
            if (!state.results.length) state.historyPanelMode = 'history';
            var nextCurrent = currentResult();
            state.cameraTargetMode = nextCurrent && nextCurrent.cameraTargetMode
              ? normalizeCameraTargetMode(nextCurrent.cameraTargetMode)
              : 'scene';
            state.cameraControls = nextCurrent && nextCurrent.cameraControls
              ? normalizeCameraControls(nextCurrent.cameraControls)
              : createDefaultCameraControls();
            persistHistory();
            updateResultSelectionUI();
            updatePromptPanelUI();
            updateHistoryPanelUI();
          }
          return;
        }
        if (action === 'delete-all-results') {
          if (!state.results.length) return;
          try {
            var okAll = window.confirm(t('deleteAllConfirm'));
            if (!okAll) return;
          } catch (_) {
            // fall through if confirm not available
          }
          clearAllHistoryResults(project);
          try {
            if (NK.api && typeof NK.api.aiImageSessionDelete === 'function') {
              NK.api.aiImageSessionDelete(state.sessionId, { confirm: 'yes', all: true }).catch(function () { });
            } else {
              fetch('/api/ai-image/session-delete', {
                method: 'POST',
                headers: Object.assign({ 'Content-Type': 'application/json' }, buildAuthHeaders()),
                body: JSON.stringify({ sessionId: state.sessionId, confirm: 'yes', all: true })
              }).catch(function () { });
            }
          } catch (_) {}
          return;
        }
        if (action === 'save-result-project') {
          saveResultToProject(btn.getAttribute('data-id') || '');
          return;
        }
        if (action === 'save-result-brand') {
          saveResultToBrand(btn.getAttribute('data-id') || '');
          return;
        }
        if (action === 'reuse-prompt') {
          var r1 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r1 && r1.prompt) {
            state.prompt = String(r1.prompt || '');
            state.cameraTargetMode = normalizeCameraTargetMode(r1.cameraTargetMode);
            state.cameraControls = normalizeCameraControls(r1.cameraControls);
            updatePromptFieldUI();
            updatePromptPanelUI();
            var promptInput = document.getElementById('ai-image-prompt');
            if (promptInput && typeof promptInput.focus === 'function') {
              try { promptInput.focus({ preventScroll: true }); } catch (_) { promptInput.focus(); }
            }
          }
          return;
        }
        if (action === 'use-result-as-source') {
          var r2 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r2) {
            state.mode = 'image-to-image';
            state.cameraTargetMode = normalizeCameraTargetMode(r2.cameraTargetMode);
            state.cameraControls = normalizeCameraControls(r2.cameraControls);
            var addResult = appendSourceImages([makeSourceImage(resolveResultUrl(r2), String(r2.objectName || r2.id || 'result'), 'upload')]);
            if (addResult.hitLimit) {
              alert(t('sourceLimitReached'));
            }
            if (addResult.addedIds && addResult.addedIds[0]) {
              state.selectedSourceId = String(addResult.addedIds[0] || '');
              // 유지: 미리보기는 결과 카드 상태를 유지해 액션 버튼과 메타를 보존
            }
            updateSourceUI();
            updatePromptPanelUI();
            updatePreviewPanelUI();
          }
          return;
        }
        if (action === 'regenerate-variation') {
          var r3 = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (r3) {
            state.mode = 'image-to-image';
            state.cameraTargetMode = normalizeCameraTargetMode(r3.cameraTargetMode);
            state.cameraControls = normalizeCameraControls(r3.cameraControls);
            var ensureResult = appendSourceImages([makeSourceImage(resolveResultUrl(r3), String(r3.objectName || r3.id || 'result'), 'upload')]);
            if (ensureResult.hitLimit) {
              alert(t('sourceLimitReached'));
              updateSourceUI();
              return;
            }
            if (ensureResult.addedIds && ensureResult.addedIds[0]) {
              state.selectedSourceId = String(ensureResult.addedIds[0] || '');
              // 유지: 미리보기는 결과 카드 상태를 유지
            }
            updatePromptPanelUI();
            updatePreviewPanelUI();
            generateImage();
          }
          return;
        }
        if (action === 'upscale-result-2k') {
          var ru = state.results.find(function (item) {
            return String(item && item.id || '') === String(btn.getAttribute('data-id') || '');
          });
          if (ru) {
            try {
              var payloadUpscale = {
                prompt: String(ru.prompt || 'Upscale to 2K while preserving original content.'),
                aspectRatio: ru.aspectRatio || state.aspectRatio,
                storageService: 'ai-image',
                sessionId: state.sessionId,
                generationMode: 'image-to-image',
                generationStyle: normalizeGenerationStyle('single'),
                imageSize: '2K',
                referenceImages: [{
                  referenceId: 1,
                  imageDataUrl: resolveResultUrl(ru),
                  subjectDescription: 'upscale source',
                  subjectType: 'SUBJECT_TYPE_DEFAULT'
                }],
                conversationHistory: []
              };
              setGlobalLoading(true, t('generating'));
              NK.api.imagen(payloadUpscale).then(function (responseUpscale) {
                var resultU = {
                  id: 'res_' + Date.now(),
                  url: String(responseUpscale && (responseUpscale.signedUrl || responseUpscale.dataUrl) || '').trim(),
                  objectName: String(responseUpscale && responseUpscale.objectName || '').trim(),
                  imageSize: String(responseUpscale && responseUpscale.imageSizeApplied || '2K').trim(),
                  prompt: String(payloadUpscale.prompt || ''),
                  resolvedPrompt: String(payloadUpscale.prompt || ''),
                  mode: 'image-to-image',
                  generationStyle: 'single',
                  cameraControls: normalizeCameraControls(ru.cameraControls),
                  conversationTurnCount: Number(responseUpscale && responseUpscale.conversationTurnCount || 0) || 0,
                  aspectRatio: payloadUpscale.aspectRatio,
                  createdAt: new Date().toISOString(),
                  savedToProject: false,
                  sessionId: state.sessionId
                };
                if (!resultU.url) throw new Error('image_result_missing');
                state.results.unshift(resultU);
                state.results = state.results.slice(0, 30);
                state.currentResultId = resultU.id;
                state.previewTargetType = 'result';
                persistHistory();
                appendHistoryCardIfPossible(resultU);
                updateResultSelectionUI();
              }).catch(function (err) {
                alert(t('generationFailed') + (err && err.message ? String(err.message) : String(err)));
              }).finally(function () {
                setGlobalLoading(false);
              });
            } catch (e) {
              alert(t('generationFailed') + (e && e.message ? String(e.message) : String(e)));
            }
          }
          return;
        }
      });
    }

    var themeBtn = document.querySelector('[data-theme-toggle]');
    if (themeBtn && !themeBtn.dataset.bound) {
      themeBtn.dataset.bound = '1';
      themeBtn.addEventListener('click', function () {
        var current = readTheme();
        var next = current === 'light' ? 'dark' : 'light';
        var nextVariant = next === 'light' ? 'light-classic' : 'dark-classic';
        NK.ui.common.applyTheme(next, { variant: nextVariant });
        updateThemeAndLangButtons();
      });
    }

    var langBtn = document.querySelector('[data-ai-image-lang-toggle]');
    if (langBtn && !langBtn.dataset.bound) {
      langBtn.dataset.bound = '1';
      langBtn.addEventListener('click', function () {
        state.lang = state.lang === 'en' ? 'ko' : 'en';
        try {
          localStorage.setItem((NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang', state.lang);
        } catch (_) { }
        updateDocumentCopy();
        updateThemeAndLangButtons();
        updateLocalizedUiPreservingResults();
      });
    }

    var screenBtn = document.querySelector('[data-screen-toggle]');
    if (screenBtn && !screenBtn.dataset.bound) {
      screenBtn.dataset.bound = '1';
      screenBtn.addEventListener('click', function () {
        if (NK.ui && NK.ui.common && NK.ui.common.toggleScreenMode) {
          NK.ui.common.toggleScreenMode();
        }
      });
    }

    document.addEventListener('change', function (evt) {
      var target = evt.target;
      if (!target) return;
      if (target.id === 'ai-image-brand-target') {
        var result = currentResult();
        if (!result) return;
        result.selectedBrandCharacterToken = normalizeCharacterToken(target.value);
        persistHistory();
        return;
      }
      if (target.id === 'ai-image-size') {
        var val = String(target.value || '').toUpperCase();
        if (val === '512' || val === '1K' || val === '2K') state.imageSize = val;
        return;
      }
      if (target.id === 'ai-image-generation-style') {
        state.generationStyle = normalizeGenerationStyle(target.value || 'single');
        return;
      }
      if (target.id === 'ai-image-provider') {
        var nextProvider = normalizeProviderValue(target.value || 'gemini');
        state.provider = nextProvider;
        try {
          var providerKey = (NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider';
          localStorage.setItem(providerKey, nextProvider);
        } catch (_) {}
        return;
      }
    });

    document.addEventListener('input', function (evt) {
      var target = evt.target;
      if (!target) return;
      if (
        target.id === 'ai-image-camera-pan' ||
        target.id === 'ai-image-camera-tilt' ||
        target.id === 'ai-image-camera-distance'
      ) {
        updateInlineCameraControlsFromInputs();
        syncInlineCameraUi();
        persistInlineCameraControls();
      }
    });
  }

  function updateAuthState() {
    var overlay = document.getElementById('auth-overlay');
    var authed = NK.auth && NK.auth.isAuthed && NK.auth.isAuthed();
    if (overlay) overlay.classList.toggle('hidden', !!authed);
  }

  function buildAuthHeaders() {
    try {
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.AUTH_TOKEN) || 'nk_auth_token';
      var token = String(localStorage.getItem(key) || '').trim();
      return token ? { Authorization: 'Bearer ' + token } : {};
    } catch (_) {
      return {};
    }
  }

  function init() {
    if (!document.getElementById('ai-image-root')) return;
    state.lang = readLang();
    state.sessionId = ensureSessionId();
    state.currentProject = readCurrentProject();
    state.currentBrand = readCurrentBrand();
    state.provider = readStoredProvider();
    loadHistory();
    try {
      NK.core.APP_VERSION = NK.config.APP_VERSION;
      if (NK.core.applyVersionAndNav) NK.core.applyVersionAndNav();
      if (NK.ui && NK.ui.common && NK.ui.common.applyTheme) {
        var theme = readTheme();
        NK.ui.common.applyTheme(theme, { variant: readThemeVariant(theme) });
      }
      if (NK.state && NK.state.set) NK.state.set({ lang: state.lang });
    } catch (_) { }

    updateDocumentCopy();
    updateThemeAndLangButtons();
    updateAuthState();
    bindStaticEvents();
    render();
    hydrateSessionHistory();
    if (state.currentBrand && state.currentBrand.brandId && NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      NK.service.brand.hydrateFromServer(state.currentBrand.brandId).then(function (brand) {
        if (!brand || !brand.brandId) return;
        state.currentBrand = brand;
        updateHeaderUI();
        updatePreviewPanelUI();
        updateSourceFieldUI();
      }).catch(function () { });
    }
    if (!window.__aiImageLangBound) {
      window.__aiImageLangBound = true;
      window.addEventListener('nk:lang-changed', function (e) {
        var next = (e && e.detail && e.detail.lang) === 'en' ? 'en' : 'ko';
        if (state.lang !== next) {
          state.lang = next;
          updateDocumentCopy();
          updateThemeAndLangButtons();
          updateLocalizedUiPreservingResults();
        }
      });
    }
  }

  async function registerImageToProject(projectId, result) {
    var file = await resultToFile(result);
    await NK.api.imageUpload(projectId, file);
  }
  async function registerImageToBrand(brandId, selectedToken, result) {
    var brandRecord = state.currentBrand;
    if (NK.service && NK.service.brand && NK.service.brand.hydrateFromServer) {
      brandRecord = await NK.service.brand.hydrateFromServer(state.currentBrand.brandId, { force: true, ttlMs: 0 }) || brandRecord;
    }
    var currentSheets = cloneJson((brandRecord && brandRecord.characterSheets) || [], []);
    var currentCharacters = Array.isArray(brandRecord && brandRecord.knowledgeCharacters) ? brandRecord.knowledgeCharacters : [];
    var matchedCharacter = currentCharacters.find(function (item) {
      return String(normalizeCharacterToken(item && (item.token || item.displayName || item.name))) === String(selectedToken);
    }) || null;
    var displayName = normalizeCharacterName(matchedCharacter && (matchedCharacter.displayName || matchedCharacter.name || selectedToken)) || normalizeCharacterName(selectedToken);
    var entry = currentSheets.find(function (item) {
      return String(normalizeCharacterToken(item && (item.token || item.displayName || item.name))) === String(selectedToken);
    });
    if (!entry) {
      entry = {
        characterId: String(matchedCharacter && (matchedCharacter.characterId || matchedCharacter.id) || ('char_' + Date.now())).trim(),
        displayName: displayName,
        token: selectedToken,
        items: []
      };
      currentSheets.push(entry);
    }
    entry.displayName = entry.displayName || displayName;
    entry.token = entry.token || selectedToken;
    entry.items = Array.isArray(entry.items) ? entry.items.slice() : [];
    entry.items.unshift({
      sheetId: 'sheet_' + Date.now(),
      imageDataUrl: await resultToDataUrl(result),
      isPrimary: entry.items.length ? false : true
    });
    entry.items = entry.items.slice(0, 4);
    if (!entry.items.some(function (item) { return item && item.isPrimary; }) && entry.items[0]) {
      entry.items[0].isPrimary = true;
    }
    var savedBrand = null;
    if (NK.service && NK.service.brand && NK.service.brand.persistShared) {
      savedBrand = await NK.service.brand.persistShared(state.currentBrand.brandId, {
        characterSheets: currentSheets
      });
    } else if (NK.api && NK.api.brandSave) {
      var nextBrandPayload = Object.assign({}, cloneJson(brandRecord || {}, {}), { characterSheets: currentSheets });
      var response = await NK.api.brandSave(state.currentBrand.brandId, nextBrandPayload);
      savedBrand = response && response.brand ? response.brand : nextBrandPayload;
    } else {
      throw new Error('brand_save_unavailable');
    }
    return savedBrand;
  }
  ui.init = init;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
