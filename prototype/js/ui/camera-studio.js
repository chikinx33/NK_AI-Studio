;(function () {
  // === Virtual Cinematographer Pro — 3D 카메라 스튜디오 ===
  // 원본: F:\Download\virtual cinematographer pro (React + r3f) 를 바닐라 three.js 로 완전 이식.
  // 카메라 앵글 버튼을 누르면 스테이지 전체를 덮는 오버레이로 열린다 (미리보기 영역까지 확장).
  var NK = window.NK || (window.NK = {});

  var THREE_URL = 'lib/three/three.module.min.js';
  var ORBIT_URL = 'lib/three/OrbitControls.js';
  var SENSOR_HEIGHT = 24; // 35mm full frame
  var LOOK_AT = [0, 0, 0];

  var TEXT = {
    ko: {
      title: 'Virtual Cinematographer',
      close: '닫기',
      reference: '참조 이미지 (REFERENCE)',
      selectImage: '이미지 선택',
      useCurrentPreview: '현재 미리보기 사용',
      uploadFile: '파일 업로드',
      precision: '정밀 카메라 컨트롤',
      azimuth: '수평 회전 (Azimuth)',
      elevation: '수직 고도 (Elevation)',
      distance: '카메라 거리 (Distance)',
      lens: '초점 거리 (Lens mm)',
      anglePresets: '프리셋 각도 (ANGLE PRESETS)',
      framing: '샷 사이즈 (FRAMING)',
      reset: '초기화',
      styleLabel: '스타일',
      styleTitle: '시각적 스타일 선택',
      promptPreview: '프롬프트 반영 문장',
      generate: '시네마틱 샷 생성하기',
      generating: '영화적 구도 캡처 중...',
      gallery: '생성 기록 (CAPTURE GALLERY)',
      galleryEmpty: '이미지가 생성되면 여기에 표시됩니다',
      gridOn: '그리드 끄기',
      gridOff: '그리드 켜기',
      viewDetail: '자세히 보기',
      shotMeta: 'Shot Metadata',
      cameraParams: 'Camera Parameters',
      timestamp: 'Timestamp',
      syncCamera: '3D 뷰포트 동기화',
      setReference: '참조 설정',
      download: '저장',
      needReference: '참조 이미지를 먼저 선택해 주세요.',
      genFailed: '생성 실패',
      refLoadFailed: '참조 이미지를 불러오지 못했습니다.'
    },
    en: {
      title: 'Virtual Cinematographer',
      close: 'Close',
      reference: 'REFERENCE IMAGE',
      selectImage: 'Select image',
      useCurrentPreview: 'Use current preview',
      uploadFile: 'Upload file',
      precision: 'Precision camera controls',
      azimuth: 'Azimuth',
      elevation: 'Elevation',
      distance: 'Camera distance',
      lens: 'Focal length (mm)',
      anglePresets: 'ANGLE PRESETS',
      framing: 'SHOT SIZE (FRAMING)',
      reset: 'Reset',
      styleLabel: 'Style',
      styleTitle: 'Choose visual style',
      promptPreview: 'Prompt injection',
      generate: 'Capture cinematic shot',
      generating: 'Capturing cinematic composition...',
      gallery: 'CAPTURE GALLERY',
      galleryEmpty: 'Generated images will appear here',
      gridOn: 'Hide grid',
      gridOff: 'Show grid',
      viewDetail: 'View detail',
      shotMeta: 'Shot Metadata',
      cameraParams: 'Camera Parameters',
      timestamp: 'Timestamp',
      syncCamera: 'Sync 3D viewport',
      setReference: 'Set reference',
      download: 'Save',
      needReference: 'Select a reference image first.',
      genFailed: 'Generation failed',
      refLoadFailed: 'Failed to load the reference image.'
    }
  };

  // lucide.dev 아이콘 (stroke 기반)
  function icon(name, size) {
    var s = size || 18;
    var paths = {
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
      video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
      imagePlus: '<path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/><circle cx="9" cy="9" r="2"/>',
      rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
      palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
      maximize: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
      download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
      loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
      eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
      eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>'
    };
    return '<svg class="nk-camstudio-icon" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clamp(v, min, max) { var n = Number(v); if (!Number.isFinite(n)) n = min; return Math.min(max, Math.max(min, n)); }

  function defaultCamera() {
    var c = (NK.constants && NK.constants.CINE_INITIAL_CAMERA) || { azimuth: 0, elevation: 0, distance: 0.8, focalLength: 35, style: 'None' };
    return { azimuth: c.azimuth, elevation: c.elevation, distance: c.distance, focalLength: c.focalLength, style: c.style };
  }

  function anglePresets() { return (NK.constants && NK.constants.CINE_ANGLE_PRESETS) || {}; }
  function shotSizePresets() { return (NK.constants && NK.constants.CINE_SHOT_SIZE_PRESETS) || {}; }
  function stylePresets() { return (NK.constants && NK.constants.CINE_STYLE_PRESETS) || { None: '' }; }

  function focalLengthToFov(focalLength) {
    return 2 * Math.atan(SENSOR_HEIGHT / (2 * focalLength)) * (180 / Math.PI);
  }

  function cameraWorldPos(cam) {
    var phi = (90 - cam.elevation) * (Math.PI / 180);
    var theta = cam.azimuth * (Math.PI / 180);
    var radius = cam.distance * 5;
    return [
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.cos(theta)
    ];
  }

  // ===== 모듈 상태 =====
  var studio = {
    open: false,
    lang: 'ko',
    bridge: null,
    camera: defaultCamera(),
    viewMode: 'world', // 'world' | 'pov'
    showGrid: true,
    reference: null,   // { url, name, generationUrl }
    isGenerating: false,
    error: '',
    showStyles: false,
    selectedShot: null,
    overlayEl: null,
    three: null,       // three.js 컨텍스트
    keydownHandler: null,
    langHandler: null
  };

  function t(key) {
    var dict = TEXT[studio.lang] || TEXT.ko;
    return dict[key] != null ? dict[key] : (TEXT.ko[key] != null ? TEXT.ko[key] : key);
  }

  function setCamera(update) {
    var next = Object.assign({}, studio.camera, update || {});
    next.azimuth = ((Number(next.azimuth) || 0) % 360 + 360) % 360;
    next.elevation = clamp(next.elevation, -85, 85);
    next.distance = clamp(next.distance, 0.1, 3.5);
    next.focalLength = clamp(next.focalLength, 12, 200);
    studio.camera = next;
    syncSlidersFromState();
    updateHud();
    updatePromptPreview();
    if (studio.three) studio.three.syncScene();
  }

  function spatialInstruction() {
    if (NK.utils && typeof NK.utils.buildCineSpatialInstruction === 'function') {
      return NK.utils.buildCineSpatialInstruction(studio.camera);
    }
    return '';
  }

  function buildFinalPrompt() {
    var styles = stylePresets();
    var styleText = styles[studio.camera.style] != null ? styles[studio.camera.style] : styles.None;
    if (NK.utils && typeof NK.utils.buildCinematicPrompt === 'function') {
      return NK.utils.buildCinematicPrompt(studio.camera, styleText);
    }
    return spatialInstruction() + ' ' + styleText;
  }

  // ===== DOM 빌드 =====
  function sliderRow(id, label, min, max, step, value, formatted) {
    return '' +
      '<div class="nk-camstudio-slider">' +
        '<div class="nk-camstudio-slider-head">' +
          '<span>' + esc(label) + '</span>' +
          '<span class="nk-camstudio-slider-value" id="' + id + '-value">' + esc(formatted) + '</span>' +
        '</div>' +
        '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '" />' +
      '</div>';
  }

  /**
   * 프리셋 버튼 라벨 축약표. 버튼이 3행씩 차지해 생성 버튼이 화면 밖으로 밀리던 문제 때문에
   * 화면에는 약자만 쓰고, 풀 명칭은 툴팁(title/aria-label)으로 알린다.
   * 키는 constants 의 프리셋 키와 1:1 로 맞춘다.
   */
  var PRESET_LABELS = {
    'Eye Level': { abbr: 'EL', ko: '아이 레벨', en: 'Eye Level' },
    'Low Angle': { abbr: 'LA', ko: '로우 앵글', en: 'Low Angle' },
    'High Angle': { abbr: 'HA', ko: '하이 앵글', en: 'High Angle' },
    "Bird's Eye": { abbr: 'BE', ko: '버즈아이(부감)', en: "Bird's Eye" },
    '45° Side': { abbr: '45S', ko: '45° 측면', en: '45° Side' },
    'Profile': { abbr: 'PRF', ko: '프로파일(정측면)', en: 'Profile' },
    'Over the Shoulder': { abbr: 'OTS', ko: '오버 더 숄더', en: 'Over the Shoulder' },
    "Worm's Eye": { abbr: 'WE', ko: '웜즈아이(앙각)', en: "Worm's Eye" },
    'Extreme CU': { abbr: 'ECU', ko: '익스트림 클로즈업', en: 'Extreme Close Up' },
    'Close Up': { abbr: 'CU', ko: '클로즈업', en: 'Close Up' },
    'Bust': { abbr: 'BS', ko: '바스트', en: 'Bust' },
    'Medium': { abbr: 'MS', ko: '미디엄', en: 'Medium' },
    'American': { abbr: 'AS', ko: '아메리칸(카우보이)', en: 'American (Cowboy)' },
    'Full Shot': { abbr: 'FS', ko: '풀 샷', en: 'Full Shot' },
    'Wide': { abbr: 'WS', ko: '와이드', en: 'Wide' }
  };

  /** 툴팁 문구: 한국어일 때는 한글명과 원어를 함께 보여 준다. */
  function presetFullLabel(key) {
    var entry = PRESET_LABELS[key];
    if (!entry) return key;
    if (studio.lang === 'en') return entry.en;
    return entry.ko === entry.en ? entry.en : (entry.ko + ' (' + entry.en + ')');
  }

  function presetButtonHtml(action, key) {
    var entry = PRESET_LABELS[key];
    var full = presetFullLabel(key);
    return '<button type="button" class="nk-camstudio-preset" data-camstudio="' + action + '" data-key="' + esc(key) + '"' +
      ' title="' + esc(full) + '" aria-label="' + esc(full) + '">' + esc(entry ? entry.abbr : key) + '</button>';
  }

  function formatAz(v) { return Number(v).toFixed(1) + '°'; }
  function formatEl(v) { return Number(v).toFixed(1) + '°'; }
  function formatDist(v) { return Number(v).toFixed(2) + 'm'; }
  function formatLens(v) { return Math.round(Number(v)) + 'mm'; }

  function buildSidebarHtml() {
    var cam = studio.camera;
    var presetButtons = Object.keys(anglePresets()).map(function (key) {
      return presetButtonHtml('angle-preset', key);
    }).join('');
    var shotButtons = Object.keys(shotSizePresets()).map(function (key) {
      return presetButtonHtml('shot-preset', key);
    }).join('');
    var styleOptions = Object.keys(stylePresets()).map(function (key) {
      return '<button type="button" class="nk-camstudio-style-option' + (studio.camera.style === key ? ' active' : '') + '" data-camstudio="set-style" data-key="' + esc(key) + '">' + esc(key) + '</button>';
    }).join('');
    return '' +
      '<div class="nk-camstudio-section">' +
        '<div class="nk-camstudio-label">' + esc(t('reference')) + '</div>' +
        '<button type="button" class="nk-camstudio-pill' + (studio.reference ? ' is-outline' : ' is-solid') + '" data-camstudio="select-reference">' +
          icon('imagePlus') + '<span class="nk-camstudio-pill-text">' + esc(studio.reference ? (studio.reference.name || 'Reference') : t('selectImage')) + '</span>' +
        '</button>' +
        '<div class="nk-camstudio-ref-menu" id="nk-camstudio-ref-menu" hidden>' +
          '<button type="button" data-camstudio="ref-use-preview">' + esc(t('useCurrentPreview')) + '</button>' +
          '<button type="button" data-camstudio="ref-upload">' + esc(t('uploadFile')) + '</button>' +
        '</div>' +
        '<input type="file" id="nk-camstudio-file" accept="image/*" hidden />' +
      '</div>' +
      '<div class="nk-camstudio-section">' +
        '<div class="nk-camstudio-label">' + esc(t('precision')) + '</div>' +
        '<div class="nk-camstudio-slider-card">' +
          sliderRow('nk-camstudio-az', t('azimuth'), 0, 360, 0.1, cam.azimuth, formatAz(cam.azimuth)) +
          sliderRow('nk-camstudio-el', t('elevation'), -85, 85, 0.1, cam.elevation, formatEl(cam.elevation)) +
          sliderRow('nk-camstudio-dist', t('distance'), 0.1, 3.5, 0.01, cam.distance, formatDist(cam.distance)) +
          sliderRow('nk-camstudio-lens', t('lens'), 12, 200, 1, cam.focalLength, formatLens(cam.focalLength)) +
        '</div>' +
      '</div>' +
      '<div class="nk-camstudio-section">' +
        '<div class="nk-camstudio-label">' + esc(t('anglePresets')) + '</div>' +
        '<div class="nk-camstudio-preset-grid">' + presetButtons + '</div>' +
      '</div>' +
      '<div class="nk-camstudio-section">' +
        '<div class="nk-camstudio-label">' + esc(t('framing')) + '</div>' +
        '<div class="nk-camstudio-preset-grid">' + shotButtons + '</div>' +
      '</div>' +
      '<div class="nk-camstudio-row">' +
        '<button type="button" class="nk-camstudio-pill is-outline nk-camstudio-half" data-camstudio="reset">' + icon('rotateCcw') + '<span>' + esc(t('reset')) + '</span></button>' +
        '<div class="nk-camstudio-style-wrap">' +
          '<button type="button" class="nk-camstudio-pill is-outline" data-camstudio="toggle-styles">' + icon('palette') + '<span class="nk-camstudio-pill-text">' + esc(t('styleLabel')) + ': ' + esc(studio.camera.style) + '</span></button>' +
          '<div class="nk-camstudio-style-menu' + (studio.showStyles ? '' : ' hidden') + '" id="nk-camstudio-style-menu">' +
            '<div class="nk-camstudio-style-menu-head">' + esc(t('styleTitle')) + '</div>' +
            '<div class="nk-camstudio-style-menu-list">' + styleOptions + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="nk-camstudio-section nk-camstudio-prompt-preview-wrap">' +
        '<div class="nk-camstudio-label">' + esc(t('promptPreview')) + '</div>' +
        '<p class="nk-camstudio-prompt-preview" id="nk-camstudio-prompt-preview">' + esc(spatialInstruction()) + '</p>' +
      '</div>' +
      '<div class="nk-camstudio-generate-wrap">' +
        '<button type="button" class="nk-camstudio-generate' + ((!studio.reference || studio.isGenerating) ? ' is-disabled' : '') + '" data-camstudio="generate"' + ((!studio.reference || studio.isGenerating) ? ' disabled' : '') + '>' +
          (studio.isGenerating
            ? ('<span class="nk-camstudio-spin">' + icon('loader') + '</span>' + esc(t('generating')))
            : (icon('video') + esc(t('generate')))) +
        '</button>' +
        '<p class="nk-camstudio-error" id="nk-camstudio-error"' + (studio.error ? '' : ' hidden') + '>' + esc(studio.error) + '</p>' +
      '</div>';
  }

  function shotLabelOf(result) {
    var cs = result && result.cameraShot ? result.cameraShot : null;
    if (!cs) return '';
    return 'az ' + Number(cs.azimuth).toFixed(1) + '° · el ' + Number(cs.elevation).toFixed(1) + '° · ' + Number(cs.distance).toFixed(2) + 'm · ' + Math.round(cs.focalLength) + 'mm';
  }

  function buildGalleryHtml() {
    var shots = (studio.bridge && typeof studio.bridge.getShots === 'function') ? (studio.bridge.getShots() || []) : [];
    if (!shots.length) {
      return '<div class="nk-camstudio-gallery-empty">' + esc(t('galleryEmpty')) + '</div>';
    }
    return shots.map(function (result) {
      return '' +
        '<div class="nk-camstudio-shot" data-camstudio="open-shot" data-id="' + esc(result.id) + '" role="button" tabindex="0">' +
          // 링크가 죽은 옛 기록은 깨진 아이콘 대신 빈 칸으로 둔다 (만료된 서명 URL 등)
          '<img src="' + esc(result.url) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'" />' +
          '<div class="nk-camstudio-shot-hover">' + icon('maximize', 28) + '<p>' + esc(t('viewDetail')) + '</p></div>' +
        '</div>';
    }).join('');
  }

  function buildModalHtml(result) {
    var cs = result.cameraShot || {};
    var created = result.createdAt ? new Date(result.createdAt) : null;
    var stamp = created && !Number.isNaN(created.getTime())
      ? created.toLocaleString(studio.lang === 'en' ? 'en-US' : 'ko-KR')
      : '';
    return '' +
      '<div class="nk-camstudio-modal" data-camstudio="close-modal">' +
        '<div class="nk-camstudio-modal-box" data-camstudio="modal-noop">' +
          '<div class="nk-camstudio-modal-media"><img src="' + esc(result.url) + '" alt="" /></div>' +
          '<div class="nk-camstudio-modal-side">' +
            '<div class="nk-camstudio-modal-head">' +
              '<h3>' + esc(t('shotMeta')) + '</h3>' +
              '<button type="button" class="nk-camstudio-close-mini" data-camstudio="close-modal" aria-label="' + esc(t('close')) + '">' + icon('x', 16) + '</button>' +
            '</div>' +
            '<div class="nk-camstudio-label">' + esc(t('cameraParams')) + '</div>' +
            '<div class="nk-camstudio-meta-grid">' +
              '<div><span>Azimuth</span><strong>' + esc(Number(cs.azimuth || 0).toFixed(1)) + '°</strong></div>' +
              '<div><span>Elevation</span><strong>' + esc(Number(cs.elevation || 0).toFixed(1)) + '°</strong></div>' +
              '<div><span>Distance</span><strong>' + esc(Number(cs.distance || 0).toFixed(2)) + 'm</strong></div>' +
              '<div><span>Focal Length</span><strong class="is-gold">' + esc(Math.round(cs.focalLength || 0)) + 'mm</strong></div>' +
              '<div class="nk-camstudio-meta-wide"><span>Style Preset</span><strong>' + esc(cs.style || 'None') + '</strong></div>' +
            '</div>' +
            '<div class="nk-camstudio-label">' + esc(t('timestamp')) + '</div>' +
            '<p class="nk-camstudio-modal-stamp">' + esc(stamp) + '</p>' +
            '<div class="nk-camstudio-modal-actions">' +
              '<button type="button" class="nk-camstudio-pill is-solid" data-camstudio="modal-sync" data-id="' + esc(result.id) + '">' + icon('video') + '<span>' + esc(t('syncCamera')) + '</span></button>' +
              '<div class="nk-camstudio-modal-actions-row">' +
                '<button type="button" class="nk-camstudio-pill is-outline" data-camstudio="modal-set-reference" data-id="' + esc(result.id) + '">' + icon('imagePlus') + '<span>' + esc(t('setReference')) + '</span></button>' +
                '<button type="button" class="nk-camstudio-pill is-outline" data-camstudio="modal-download" data-id="' + esc(result.id) + '">' + icon('download') + '<span>' + esc(t('download')) + '</span></button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function buildOverlayHtml() {
    return '' +
      '<div class="nk-camstudio">' +
        '<div class="nk-camstudio-main">' +
          '<div class="nk-camstudio-viewport" id="nk-camstudio-viewport">' +
            '<div class="nk-camstudio-mode-toggle">' +
              '<button type="button" class="nk-camstudio-mode-btn' + (studio.viewMode === 'world' ? ' active' : '') + '" data-camstudio="set-mode" data-mode="world">WORLD</button>' +
              '<button type="button" class="nk-camstudio-mode-btn' + (studio.viewMode === 'pov' ? ' active' : '') + '" data-camstudio="set-mode" data-mode="pov">POV</button>' +
            '</div>' +
            '<div class="nk-camstudio-pov-overlay" id="nk-camstudio-pov-overlay"' + (studio.viewMode === 'pov' ? '' : ' hidden') + '>' +
              '<div class="nk-camstudio-pov-frame">' +
                '<div class="nk-camstudio-pov-crosshair"><i></i><i></i></div>' +
              '</div>' +
            '</div>' +
            '<div class="nk-camstudio-hud" id="nk-camstudio-hud"></div>' +
            '<button type="button" class="nk-camstudio-grid-toggle' + (studio.showGrid ? '' : ' is-off') + '" id="nk-camstudio-grid-toggle" data-camstudio="toggle-grid" aria-pressed="' + (studio.showGrid ? 'true' : 'false') + '" aria-label="' + esc(studio.showGrid ? t('gridOn') : t('gridOff')) + '" title="' + esc(studio.showGrid ? t('gridOn') : t('gridOff')) + '">' + icon(studio.showGrid ? 'eye' : 'eyeOff') + '</button>' +
          '</div>' +
          '<div class="nk-camstudio-gallery-wrap">' +
            '<div class="nk-camstudio-label">' + esc(t('gallery')) + '</div>' +
            '<div class="nk-camstudio-gallery" id="nk-camstudio-gallery">' + buildGalleryHtml() + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="nk-camstudio-sidebar" id="nk-camstudio-sidebar">' + buildSidebarHtml() + '</div>' +
        '<button type="button" class="nk-camstudio-close" data-camstudio="close" aria-label="' + esc(t('close')) + '" title="' + esc(t('close')) + '">' + icon('x', 20) + '</button>' +
      '</div>';
  }

  // ===== 갱신 헬퍼 (드래그 중 전체 재렌더 방지) =====
  function syncSlidersFromState() {
    var cam = studio.camera;
    var pairs = [
      ['nk-camstudio-az', cam.azimuth, formatAz(cam.azimuth)],
      ['nk-camstudio-el', cam.elevation, formatEl(cam.elevation)],
      ['nk-camstudio-dist', cam.distance, formatDist(cam.distance)],
      ['nk-camstudio-lens', cam.focalLength, formatLens(cam.focalLength)]
    ];
    pairs.forEach(function (pair) {
      var input = document.getElementById(pair[0]);
      var label = document.getElementById(pair[0] + '-value');
      if (input && document.activeElement !== input) input.value = String(pair[1]);
      if (label) label.textContent = pair[2];
    });
  }

  function updateHud() {
    var hud = document.getElementById('nk-camstudio-hud');
    if (!hud) return;
    var cam = studio.camera;
    hud.innerHTML = '' +
      '<div><span>LENS REACH</span><strong class="is-gold">' + Math.round(cam.focalLength) + 'mm</strong></div>' +
      '<div><span>AZIMUTH</span><strong>' + cam.azimuth.toFixed(1) + '°</strong></div>' +
      '<div><span>ELEVATION</span><strong>' + cam.elevation.toFixed(1) + '°</strong></div>';
  }

  function updatePromptPreview() {
    var el = document.getElementById('nk-camstudio-prompt-preview');
    if (el) el.textContent = spatialInstruction();
  }

  function renderSidebar() {
    var sidebar = document.getElementById('nk-camstudio-sidebar');
    if (sidebar) sidebar.innerHTML = buildSidebarHtml();
  }

  function renderGallery() {
    var gallery = document.getElementById('nk-camstudio-gallery');
    if (gallery) gallery.innerHTML = buildGalleryHtml();
  }

  function updateGridToggle() {
    var btn = document.getElementById('nk-camstudio-grid-toggle');
    if (!btn) return;
    var label = studio.showGrid ? t('gridOn') : t('gridOff');
    btn.classList.toggle('is-off', !studio.showGrid);
    btn.setAttribute('aria-pressed', studio.showGrid ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.innerHTML = icon(studio.showGrid ? 'eye' : 'eyeOff');
  }

  function updateModeButtons() {
    var overlay = studio.overlayEl;
    if (!overlay) return;
    Array.prototype.forEach.call(overlay.querySelectorAll('.nk-camstudio-mode-btn'), function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === studio.viewMode);
    });
    var pov = document.getElementById('nk-camstudio-pov-overlay');
    if (pov) pov.hidden = studio.viewMode !== 'pov';
  }

  function setError(message) {
    studio.error = String(message || '');
    var el = document.getElementById('nk-camstudio-error');
    if (el) {
      el.textContent = studio.error;
      el.hidden = !studio.error;
    }
  }

  // ===== 참조 이미지 =====
  function downscaleToDataUrl(img, maxDim, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var scale = Math.min(1, maxDim / Math.max(w, h));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (!/^data:/i.test(url)) img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image_load_failed')); };
      img.src = url;
    });
  }

  async function setReference(url, name, generationUrl) {
    try {
      var img = await loadImage(url);
      // OOM 방지: 빌보드 텍스처는 1024px, 생성 페이로드는 원본 URL(원격) 또는 1600px 다운스케일(data:)
      var texCanvas = downscaleToDataUrl(img, 1024);
      var genUrl = generationUrl || url;
      if (/^data:/i.test(url) && !generationUrl) {
        var genCanvas = downscaleToDataUrl(img, 1600);
        genUrl = genCanvas.toDataURL('image/jpeg', 0.92);
      }
      studio.reference = { url: url, name: String(name || 'Reference'), generationUrl: genUrl };
      if (studio.three) studio.three.setBillboard(texCanvas);
      setError('');
      renderSidebar();
    } catch (err) {
      setError(t('refLoadFailed'));
    }
  }

  // ===== 생성 =====
  async function generateShot() {
    if (studio.isGenerating) return;
    if (!studio.reference) { setError(t('needReference')); return; }
    if (!studio.bridge || typeof studio.bridge.generate !== 'function') return;
    studio.isGenerating = true;
    setError('');
    renderSidebar();
    try {
      await studio.bridge.generate({
        prompt: buildFinalPrompt(),
        referenceUrl: studio.reference.generationUrl || studio.reference.url,
        camera: Object.assign({}, studio.camera),
        label: shotLabelOf({ cameraShot: studio.camera })
      });
      renderGallery();
    } catch (err) {
      setError(t('genFailed') + ': ' + (err && err.message ? err.message : err));
    } finally {
      studio.isGenerating = false;
      renderSidebar();
    }
  }

  function findShot(id) {
    var shots = (studio.bridge && typeof studio.bridge.getShots === 'function') ? (studio.bridge.getShots() || []) : [];
    return shots.find(function (item) { return String(item && item.id || '') === String(id || ''); }) || null;
  }

  function openShotModal(result) {
    closeShotModal();
    if (!result) return;
    studio.selectedShot = result;
    var wrap = document.createElement('div');
    wrap.innerHTML = buildModalHtml(result);
    var node = wrap.firstChild;
    if (node && studio.overlayEl) studio.overlayEl.appendChild(node);
  }

  function closeShotModal() {
    studio.selectedShot = null;
    if (!studio.overlayEl) return;
    var existing = studio.overlayEl.querySelector('.nk-camstudio-modal');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  // ===== three.js 씬 =====
  async function initThree(container) {
    var THREE = await import('./' + THREE_URL).catch(function () { return import('/' + THREE_URL); });
    var orbitModule = await import('./' + ORBIT_URL).catch(function () { return import('/' + ORBIT_URL); });
    var OrbitControls = orbitModule.OrbitControls;

    var ctx = {
      THREE: THREE,
      disposed: false,
      isInteracting: false,
      worldViewPos: new THREE.Vector3(3, 2, 3),
      billboardMesh: null,
      billboardTexture: null,
      lastArcSignature: ''
    };

    var width = Math.max(1, container.clientWidth);
    var height = Math.max(1, container.clientHeight);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = 'nk-camstudio-canvas';
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x011a14, 9, 24);

    var viewCamera = new THREE.PerspectiveCamera(50, width / height, 0.01, 200);
    viewCamera.position.set(4, 3, 4);

    var controls = new OrbitControls(viewCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);

    // 조명 (원본 Scene 과 동일 구성)
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    var hemi = new THREE.HemisphereLight(0xffffff, 0x011a14, 1.0);
    scene.add(hemi);
    var point = new THREE.PointLight(0x00A86B, 2.5);
    point.position.set(5, 5, 5);
    scene.add(point);
    var dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(-10, 10, -5);
    scene.add(dir);

    // 그리드 (drei Grid 대체: 셀 0.2 + 섹션 1, fog 로 페이드)
    var cellGrid = new THREE.GridHelper(40, 200, 0x005C3B, 0x005C3B);
    cellGrid.material.transparent = true;
    cellGrid.material.opacity = 0.34;
    scene.add(cellGrid);
    var sectionGrid = new THREE.GridHelper(40, 40, 0x00A86B, 0x00A86B);
    sectionGrid.material.transparent = true;
    sectionGrid.material.opacity = 0.5;
    sectionGrid.position.y = 0.002;
    scene.add(sectionGrid);

    // 원점 마커
    var origin = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x00A86B, transparent: true, opacity: 0.8 })
    );
    scene.add(origin);

    // ContactShadows 대체: 방사형 그라디언트 텍스처 플레인
    var shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 256;
    var sctx = shadowCanvas.getContext('2d');
    var grad = sctx.createRadialGradient(128, 128, 8, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,17,0,0.6)');
    grad.addColorStop(1, 'rgba(0,17,0,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 256, 256);
    var shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    var shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.01;
    scene.add(shadowPlane);

    // 궤적 (방위 원 + 고도 아크)
    var arcMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 });
    var azimuthLoop = new THREE.LineLoop(new THREE.BufferGeometry(), arcMaterial);
    var elevationLine = new THREE.Line(new THREE.BufferGeometry(), arcMaterial.clone());
    scene.add(azimuthLoop);
    scene.add(elevationLine);

    // 포커스 라인 + 초점 마커
    var focusLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x3399ff, transparent: true, opacity: 0.3, depthTest: false })
    );
    focusLine.renderOrder = 5;
    scene.add(focusLine);
    var focalMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xFFD700, depthTest: false })
    );
    focalMarker.renderOrder = 6;
    var focalLight = new THREE.PointLight(0xFFD700, 0.5, 1);
    focalMarker.add(focalLight);
    scene.add(focalMarker);

    // 카메라 메쉬 (바디 + 렌즈 + 렌즈 글라스)
    var camGroup = new THREE.Group();
    var camMaterial = new THREE.MeshStandardMaterial({ color: 0x3399ff, transparent: true, opacity: 0.4, roughness: 0.2, metalness: 0.5, side: THREE.DoubleSide });
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.195, 0.24), camMaterial);
    body.position.set(0, 0, -0.09);
    camGroup.add(body);
    var lensGroup = new THREE.Group();
    lensGroup.position.set(0, 0, 0.03);
    var lens = new THREE.Mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.12, 32), camMaterial);
    lens.rotation.x = Math.PI / 2;
    lensGroup.add(lens);
    var lensGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0525, 0.0525, 0.0075, 32),
      new THREE.MeshBasicMaterial({ color: 0x33ccff, transparent: true, opacity: 0.3 })
    );
    lensGlass.position.set(0, 0, 0.0615);
    lensGlass.rotation.x = Math.PI / 2;
    lensGroup.add(lensGlass);
    camGroup.add(lensGroup);
    scene.add(camGroup);

    function rebuildArcs() {
      var cam = studio.camera;
      var radius = cam.distance * 5;
      var signature = radius.toFixed(3) + ':' + cam.azimuth.toFixed(2);
      if (signature === ctx.lastArcSignature) return;
      ctx.lastArcSignature = signature;
      var azPoints = [];
      for (var i = 0; i <= 128; i++) {
        var a = (i / 128) * Math.PI * 2;
        azPoints.push(new THREE.Vector3(Math.cos(a) * radius, 0.01, Math.sin(a) * radius));
      }
      azimuthLoop.geometry.setFromPoints(azPoints);
      var elPoints = [];
      var phiStart = (90 - 85) * (Math.PI / 180);
      var phiEnd = (90 + 85) * (Math.PI / 180);
      var theta = cam.azimuth * (Math.PI / 180);
      for (var j = 0; j <= 64; j++) {
        var phi = phiStart + (j / 64) * (phiEnd - phiStart);
        elPoints.push(new THREE.Vector3(
          radius * Math.sin(phi) * Math.sin(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.cos(theta)
        ));
      }
      elevationLine.geometry.setFromPoints(elPoints);
    }

    function syncScene() {
      if (ctx.disposed) return;
      var cam = studio.camera;
      var pos = cameraWorldPos(cam);
      var posVec = new THREE.Vector3(pos[0], pos[1], pos[2]);
      var dirVec = new THREE.Vector3(0, 0, 0).sub(posVec).normalize();
      var lensTip = posVec.clone().add(dirVec.clone().multiplyScalar(0.09));

      camGroup.position.copy(posVec);
      camGroup.lookAt(0, 0, 0);
      camGroup.visible = studio.viewMode === 'world';

      rebuildArcs();
      azimuthLoop.visible = elevationLine.visible = studio.viewMode === 'world';

      focusLine.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), lensTip]);
      focusLine.visible = studio.viewMode === 'world';
      var ratio = (cam.focalLength - 12) / (200 - 12);
      focalMarker.position.lerpVectors(lensTip, new THREE.Vector3(0, 0, 0), ratio * 0.8);
      focalMarker.visible = studio.viewMode === 'world';

      if (!ctx.isInteracting) {
        if (studio.viewMode === 'pov') {
          viewCamera.position.copy(posVec);
          viewCamera.lookAt(0, 0, 0);
          viewCamera.fov = focalLengthToFov(cam.focalLength);
          viewCamera.updateProjectionMatrix();
        } else {
          if (viewCamera.position.distanceTo(new THREE.Vector3(0, 0, 0)) < 0.5) {
            viewCamera.position.copy(ctx.worldViewPos);
          }
          if (viewCamera.fov !== 50) {
            viewCamera.fov = 50;
            viewCamera.updateProjectionMatrix();
          }
        }
        controls.enablePan = studio.viewMode === 'world';
        controls.update();
      }
    }

    controls.addEventListener('start', function () { ctx.isInteracting = true; });
    controls.addEventListener('end', function () {
      ctx.isInteracting = false;
      syncScene();
    });
    controls.addEventListener('change', function () {
      if (!ctx.isInteracting) return;
      if (studio.viewMode === 'pov') {
        var p = viewCamera.position;
        var radius = p.length();
        if (radius < 0.0001) return;
        var phi = Math.acos(clamp(p.y / radius, -1, 1));
        var theta = Math.atan2(p.x, p.z);
        var elevation = 90 - (phi * 180 / Math.PI);
        var azimuth = theta * 180 / Math.PI;
        if (azimuth < 0) azimuth += 360;
        studio.camera = Object.assign({}, studio.camera, {
          azimuth: azimuth,
          elevation: clamp(elevation, -85, 85),
          distance: clamp(radius / 5, 0.1, 3.5)
        });
        viewCamera.fov = focalLengthToFov(studio.camera.focalLength);
        viewCamera.updateProjectionMatrix();
        syncSlidersFromState();
        updateHud();
        updatePromptPreview();
      } else {
        ctx.worldViewPos.copy(viewCamera.position);
      }
    });

    function setBillboard(sourceCanvas) {
      if (ctx.billboardMesh) {
        scene.remove(ctx.billboardMesh);
        ctx.billboardMesh.geometry.dispose();
        ctx.billboardMesh.material.dispose();
        ctx.billboardMesh = null;
      }
      if (ctx.billboardTexture) {
        ctx.billboardTexture.dispose();
        ctx.billboardTexture = null;
      }
      if (!sourceCanvas) return;
      var texture = new THREE.CanvasTexture(sourceCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      var aspect = sourceCanvas.width / Math.max(1, sourceCanvas.height);
      var mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(aspect * 2, 2),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
      );
      scene.add(mesh);
      ctx.billboardMesh = mesh;
      ctx.billboardTexture = texture;
    }

    var rafId = 0;
    function animate() {
      if (ctx.disposed) return;
      rafId = requestAnimationFrame(animate);
      controls.update();
      // 빌보드 뒷면 감지 → 투명도 부드럽게 전환 (원본 useFrame 로직)
      if (ctx.billboardMesh) {
        var isBackside = viewCamera.position.z < 0;
        var target = isBackside ? 0.3 : 0.95;
        var mat = ctx.billboardMesh.material;
        mat.opacity = mat.opacity + (target - mat.opacity) * 0.1;
      }
      renderer.render(scene, viewCamera);
    }
    animate();

    var resizeObserver = new ResizeObserver(function () {
      if (ctx.disposed) return;
      var w = Math.max(1, container.clientWidth);
      var h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      viewCamera.aspect = w / h;
      viewCamera.updateProjectionMatrix();
    });
    resizeObserver.observe(container);

    ctx.syncScene = syncScene;
    ctx.setBillboard = setBillboard;
    // 그리드 토글: 바닥 그리드 2겹 + 접지 그림자를 함께 숨겨 피사체만 남긴다.
    ctx.setGridVisible = function (visible) {
      cellGrid.visible = !!visible;
      sectionGrid.visible = !!visible;
      shadowPlane.visible = !!visible;
    };
    ctx.resetView = function () {
      ctx.worldViewPos.set(3, 2, 3);
      viewCamera.position.set(4, 3, 4);
      viewCamera.fov = 50;
      viewCamera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      ctx.lastArcSignature = '';
      syncScene();
    };
    ctx.dispose = function () {
      ctx.disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(function (m) {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
      shadowTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    };

    syncScene();
    return ctx;
  }

  // ===== 이벤트 =====
  function onOverlayClick(event) {
    var target = event.target.closest('[data-camstudio]');
    if (!target) {
      // 스타일 메뉴 밖 클릭 시 닫기
      if (studio.showStyles && !event.target.closest('.nk-camstudio-style-wrap')) {
        studio.showStyles = false;
        var menu = document.getElementById('nk-camstudio-style-menu');
        if (menu) menu.classList.add('hidden');
      }
      var refMenu = document.getElementById('nk-camstudio-ref-menu');
      if (refMenu && !refMenu.hidden && !event.target.closest('.nk-camstudio-section')) refMenu.hidden = true;
      return;
    }
    var action = target.getAttribute('data-camstudio');
    if (action === 'close') { close(); return; }
    if (action === 'set-mode') {
      studio.viewMode = target.getAttribute('data-mode') === 'pov' ? 'pov' : 'world';
      updateModeButtons();
      if (studio.three) studio.three.syncScene();
      return;
    }
    if (action === 'toggle-grid') {
      studio.showGrid = !studio.showGrid;
      updateGridToggle();
      if (studio.three) studio.three.setGridVisible(studio.showGrid);
      return;
    }
    if (action === 'select-reference') {
      var candidate = (studio.bridge && typeof studio.bridge.getReferenceCandidate === 'function') ? studio.bridge.getReferenceCandidate() : null;
      var menu = document.getElementById('nk-camstudio-ref-menu');
      if (!candidate) {
        var file = document.getElementById('nk-camstudio-file');
        if (file) file.click();
        return;
      }
      if (menu) menu.hidden = !menu.hidden;
      return;
    }
    if (action === 'ref-use-preview') {
      var cand = (studio.bridge && typeof studio.bridge.getReferenceCandidate === 'function') ? studio.bridge.getReferenceCandidate() : null;
      var refMenu2 = document.getElementById('nk-camstudio-ref-menu');
      if (refMenu2) refMenu2.hidden = true;
      if (cand && cand.url) setReference(cand.url, cand.name || 'Preview');
      return;
    }
    if (action === 'ref-upload') {
      var refMenu3 = document.getElementById('nk-camstudio-ref-menu');
      if (refMenu3) refMenu3.hidden = true;
      var fileInput = document.getElementById('nk-camstudio-file');
      if (fileInput) fileInput.click();
      return;
    }
    if (action === 'angle-preset') {
      var preset = anglePresets()[target.getAttribute('data-key')] || {};
      setCamera(preset);
      return;
    }
    if (action === 'shot-preset') {
      var dist = shotSizePresets()[target.getAttribute('data-key')];
      if (Number.isFinite(Number(dist))) setCamera({ distance: Number(dist) });
      return;
    }
    if (action === 'reset') {
      studio.camera = defaultCamera();
      studio.viewMode = 'world';
      studio.showStyles = false;
      setError('');
      renderSidebar();
      updateModeButtons();
      updateHud();
      if (studio.three) studio.three.resetView();
      return;
    }
    if (action === 'toggle-styles') {
      studio.showStyles = !studio.showStyles;
      var styleMenu = document.getElementById('nk-camstudio-style-menu');
      if (styleMenu) styleMenu.classList.toggle('hidden', !studio.showStyles);
      return;
    }
    if (action === 'set-style') {
      studio.camera.style = target.getAttribute('data-key') || 'None';
      studio.showStyles = false;
      renderSidebar();
      return;
    }
    if (action === 'generate') { generateShot(); return; }
    if (action === 'open-shot') { openShotModal(findShot(target.getAttribute('data-id'))); return; }
    if (action === 'close-modal') {
      if (event.target === target || target.classList.contains('nk-camstudio-close-mini')) closeShotModal();
      return;
    }
    if (action === 'modal-noop') { return; }
    if (action === 'modal-sync') {
      var syncResult = findShot(target.getAttribute('data-id'));
      if (syncResult && syncResult.cameraShot) {
        setCamera(syncResult.cameraShot);
        if (syncResult.cameraShot.style) studio.camera.style = syncResult.cameraShot.style;
        studio.viewMode = 'pov';
        updateModeButtons();
        renderSidebar();
        if (studio.three) studio.three.syncScene();
      }
      closeShotModal();
      return;
    }
    if (action === 'modal-set-reference') {
      var refResult = findShot(target.getAttribute('data-id'));
      if (refResult && refResult.url) setReference(refResult.url, 'Shot ' + String(refResult.id || '').slice(-5));
      closeShotModal();
      return;
    }
    if (action === 'modal-download') {
      var dlResult = findShot(target.getAttribute('data-id'));
      if (dlResult && studio.bridge && typeof studio.bridge.download === 'function') studio.bridge.download(dlResult);
      return;
    }
  }

  function onOverlayInput(event) {
    var id = event.target && event.target.id;
    if (id === 'nk-camstudio-az') setCamera({ azimuth: Number(event.target.value) });
    else if (id === 'nk-camstudio-el') setCamera({ elevation: Number(event.target.value) });
    else if (id === 'nk-camstudio-dist') setCamera({ distance: Number(event.target.value) });
    else if (id === 'nk-camstudio-lens') setCamera({ focalLength: Number(event.target.value) });
  }

  function onOverlayChange(event) {
    if (event.target && event.target.id === 'nk-camstudio-file') {
      var file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        setReference(String(reader.result || ''), file.name);
      };
      reader.readAsDataURL(file);
    }
  }

  // ===== 열기/닫기 =====
  async function open(bridge) {
    if (studio.open) { close(); }
    studio.open = true;
    studio.bridge = bridge || {};
    studio.lang = (bridge && bridge.lang) || (NK.state && NK.state.lang) || 'ko';
    studio.camera = defaultCamera();
    studio.viewMode = 'world';
    studio.showGrid = true;
    studio.reference = null;
    studio.isGenerating = false;
    studio.error = '';
    studio.showStyles = false;

    var overlay = document.createElement('div');
    overlay.className = 'nk-camstudio-overlay';
    overlay.innerHTML = buildOverlayHtml();
    document.body.appendChild(overlay);
    studio.overlayEl = overlay;

    overlay.addEventListener('click', onOverlayClick);
    overlay.addEventListener('input', onOverlayInput);
    overlay.addEventListener('change', onOverlayChange);

    studio.keydownHandler = function (event) {
      if (event.key !== 'Escape') return;
      if (studio.selectedShot) closeShotModal();
      else close();
    };
    document.addEventListener('keydown', studio.keydownHandler);

    studio.langHandler = function (event) {
      studio.lang = (event && event.detail && event.detail.lang) === 'en' ? 'en' : 'ko';
      renderSidebar();
      renderGallery();
      updateGridToggle();
      var galleryLabel = overlay.querySelector('.nk-camstudio-gallery-wrap .nk-camstudio-label');
      if (galleryLabel) galleryLabel.textContent = t('gallery');
    };
    window.addEventListener('nk:lang-changed', studio.langHandler);

    updateHud();
    updatePromptPreview();

    try {
      var viewport = document.getElementById('nk-camstudio-viewport');
      studio.three = await initThree(viewport);
      studio.three.setGridVisible(studio.showGrid);
    } catch (err) {
      try { console.error('[camera-studio] three init failed', err); } catch (_) {}
    }

    // 열자마자 현재 미리보기가 있으면 자동으로 참조 이미지로 세팅 (Flow.media.select 대응 편의)
    try {
      var candidate = (studio.bridge && typeof studio.bridge.getReferenceCandidate === 'function') ? studio.bridge.getReferenceCandidate() : null;
      if (candidate && candidate.url) await setReference(candidate.url, candidate.name || 'Preview');
    } catch (_) {}
  }

  function close() {
    if (!studio.open) return;
    studio.open = false;
    closeShotModal();
    if (studio.keydownHandler) document.removeEventListener('keydown', studio.keydownHandler);
    if (studio.langHandler) window.removeEventListener('nk:lang-changed', studio.langHandler);
    studio.keydownHandler = null;
    studio.langHandler = null;
    if (studio.three) {
      try { studio.three.dispose(); } catch (_) {}
      studio.three = null;
    }
    if (studio.overlayEl && studio.overlayEl.parentNode) studio.overlayEl.parentNode.removeChild(studio.overlayEl);
    studio.overlayEl = null;
    studio.reference = null;
    studio.bridge = null;
  }

  NK.cameraStudio = {
    open: open,
    close: close,
    isOpen: function () { return !!studio.open; },
    refreshGallery: renderGallery
  };
})();
