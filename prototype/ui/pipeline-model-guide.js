;(function () {
  var NK = window.NK || (window.NK = {});
  var guide = NK.uiModelGuide || (NK.uiModelGuide = {});

  /**
   * 영상 모델 선택 가이드.
   *
   * ⚠️ 값의 출처는 **공급자 API 스키마**다. 앱 내부의 caps 표가 아니다.
   * v3.1588 가이드는 js/ui/ai-video-gen.js 의 caps 를 근거로 삼았는데, 그 표가
   * 실제 API 와 달라 거짓 정보를 실었다. 대표적으로 Wan 2.7 을 "시작 이미지 +
   * 캐릭터 참조 동시 사용 / 추천" 으로 표시했지만, alibaba/wan-2.7/image-to-video
   * 스키마에는 reference_images 파라미터가 아예 없다(우리가 보내는 값은 조용히 버려진다).
   *
   * 2026-08-30 Atlas Cloud 스키마로 확인:
   *   google/veo3.1-fast/image-to-video      image · last_image                 $0.08
   *   google/veo3.1/image-to-video           image · last_image                 $0.20
   *   xai/grok-imagine-video/image-to-video  image                              (미확인)
   *   xai/grok-imagine-video/reference-to-video  image_urls 1~7                 $0.05
   *   kwaivgi/kling-v2.6-pro/image-to-video  image (last_image 없음, 5·10초)     $0.06 (85% 할인)
   *   bytedance/seedance-2.0/image-to-video  image · last_image, 4~15초, ~4K     $0.112
   *   bytedance/seedance-2.0/reference-to-video  reference_images 최대 9         $0.112
   *   alibaba/wan-2.7/image-to-video         image · last_image (참조 없음)      $0.10
   *   alibaba/wan-2.7/reference-to-video     images (주체당 1장, 시작 이미지 없음) $0.10
   *   vidu/q3-mix/reference-to-video         images 1~4 (필수, 시작 이미지 없음)  $0.106 (85% 할인)
   */

  // 요청당 기본 단가(USD). 확인 못 한 값은 null → 화면에 "미확인".
  var COST = {
    'veo':          { usd: 0.08,  note: '요청당 기본 단가' },
    'veo-full':     { usd: 0.20,  note: '요청당 기본 단가' },
    'grok':         { usd: null,  note: '' },
    'grok-r2v':     { usd: 0.05,  note: '요청당 기본 단가' },
    'kling-final':  { usd: 0.06,  note: '85% 할인 반영가' },
    'seedance':     { usd: 0.112, note: '요청당 기본 단가' },
    'seedance-r2v': { usd: 0.112, note: '요청당 기본 단가' },
    'wan':          { usd: 0.10,  note: '요청당 기본 단가' },
    'vidu-q3':      { usd: 0.106, note: '85% 할인 반영가' }
  };

  // 이 앱은 컷마다 스틸컷을 먼저 만든다. 그래서 "시작 이미지를 쓰는가" 가 1차 정렬 기준이다.
  var MODELS = [
    {
      id: 'seedance', name: 'Seedance 2.0',
      dur: '4~15', start: '시작+끝', refs: '✗', res: '720p~4K',
      good: '스틸컷 유지 · 길이 가장 유연 · 4K 지원',
      bad: '캐릭터 참조 없음 (앱은 720p 고정)',
      fit: 'best'
    },
    {
      id: 'veo', name: 'Veo 3.1 Fast',
      dur: '4·6·8', start: '시작+끝', refs: '✗', res: '720p~4K',
      good: '움직임이 자연스럽고 값이 낮은 편',
      bad: '캐릭터 참조 없음 · 길이 3종뿐',
      fit: 'good'
    },
    {
      id: 'kling-final', name: 'Kling v2.6 Pro',
      dur: '5 또는 10', start: '시작만', refs: '✗', res: '1080p FHD',
      good: '화질 최고인데 단가는 가장 낮은 축',
      bad: '최소 5초 — 2~3초 컷에 안 맞음 · 끝 프레임 미지원',
      fit: 'long-only'
    },
    {
      id: 'wan', name: 'Wan 2.7',
      dur: '4~15', start: '시작+끝', refs: '✗', res: '720p/1080p',
      good: '시작+끝 프레임, 1080p',
      bad: '★참조 미지원 — i2v 스키마에 파라미터가 없음',
      fit: 'ok'
    },
    {
      id: 'grok', name: 'Grok Imagine',
      dur: '4·6·8', start: '시작만', refs: '✗', res: '480/720p',
      good: '이미지 애니메이션에 특화',
      bad: '캐릭터 참조 없음 · 화질 상한 720p',
      fit: 'ok'
    },
    {
      id: 'veo-full', name: 'Veo 3.1 Full',
      dur: '4·6·8', start: '시작+끝', refs: '✗', res: '720p~4K',
      good: '품질 최상위',
      bad: '가장 비쌈 · 노래 모드에선 오디오가 무용',
      fit: 'poor'
    },
    {
      id: 'seedance-r2v', name: 'Seedance 2.0 Reference',
      dur: '4~15', start: '✗ 버림', refs: '✓ 9장', res: '720p~4K',
      good: '참조 9장 — 캐릭터 일관성엔 가장 유리',
      bad: '스틸컷을 버려 컷 구도가 날아감',
      fit: 'avoid'
    },
    {
      id: 'grok-r2v', name: 'Grok R2V',
      dur: '4·6·8', start: '✗ 버림', refs: '✓ 7장', res: '480/720p',
      good: '참조 7장 · 가장 저렴',
      bad: '스틸컷을 버려 컷 구도가 날아감',
      fit: 'avoid'
    },
    {
      id: 'vidu-q3', name: 'Vidu Q3-Mix',
      dur: '4·5·6·8·10', start: '✗ 참조에 섞임', refs: '✓ 1~4장', res: '720p~1440p',
      good: '참조 기반, 화질 선택 폭이 넓음',
      bad: '스틸컷이 참조 중 하나로 섞여 구도가 보장되지 않음',
      fit: 'avoid'
    }
  ];

  var FIT = {
    'best':      { label: '추천',    en: 'Best',      cls: 'is-best' },
    'good':      { label: '무난',    en: 'Good',      cls: 'is-good' },
    'ok':        { label: '보통',    en: 'OK',        cls: 'is-ok' },
    'long-only': { label: '긴 컷만', en: 'Long cuts', cls: 'is-warn' },
    'poor':      { label: '비권장',  en: 'Not ideal', cls: 'is-warn' },
    'avoid':     { label: '피하기',  en: 'Avoid',     cls: 'is-bad' }
  };

  function guideLang() {
    return (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
  }

  function fitLabel(fit) {
    return guideLang() === 'en' ? (fit.en || fit.label) : fit.label;
  }

  function closeLabel() {
    return guideLang() === 'en' ? 'Close' : '닫기';
  }

  // 지금 열려 있는 표(영상/이미지)와 그때의 선택값.
  var openState = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function formatUsd(n) {
    var s = n.toFixed(3);
    while (s.length > 4 && s.charAt(s.length - 1) === '0') s = s.slice(0, -1);
    return '$' + s;
  }

  function costCell(id) {
    var c = COST[id];
    if (!c || c.usd == null) return '<span class="vmg-cost is-unknown">미확인</span>';
    var cls = c.usd <= 0.08 ? 'is-low' : (c.usd <= 0.12 ? 'is-mid' : 'is-high');
    return '<span class="vmg-cost ' + cls + '" title="' + esc(c.note) + '">' + formatUsd(c.usd) + '</span>';
  }

  function rowHtml(m, currentModel) {
    var fit = FIT[m.fit] || FIT.ok;
    return '<tr class="' + (m.id === currentModel ? 'is-current' : '') + '">'
      + '<td class="vmg-name">' + esc(m.name)
        + (m.id === currentModel ? '<span class="vmg-now">현재</span>' : '') + '</td>'
      + '<td class="vmg-c">' + esc(m.dur) + '</td>'
      + '<td class="vmg-c">' + esc(m.start) + '</td>'
      + '<td class="vmg-c">' + esc(m.refs) + '</td>'
      + '<td class="vmg-c">' + esc(m.res) + '</td>'
      + '<td class="vmg-c">' + costCell(m.id) + '</td>'
      + '<td class="vmg-good">' + esc(m.good) + '</td>'
      + '<td class="vmg-bad">' + esc(m.bad) + '</td>'
      + '<td class="vmg-c"><span class="vmg-fit ' + fit.cls + '">' + esc(fitLabel(fit)) + '</span></td>'
      + '</tr>';
  }

  guide.render = function (currentModel) {
    return ''
      + '<div class="vmg-head">'
      +   '<h2 class="vmg-title">영상 모델 고르기</h2>'
      +   '<button type="button" class="vmg-close" data-vmg-close aria-label="' + esc(closeLabel()) + '">✕</button>'
      + '</div>'
      + '<table class="vmg-table">'
      +   '<thead><tr>'
      +     '<th>모델</th><th>길이(초)</th><th>시작 이미지</th><th>캐릭터 참조</th>'
      +     '<th>화질</th><th>비용/컷</th><th>강점</th><th>약점</th><th>적합도</th>'
      +   '</tr></thead>'
      +   '<tbody>' + MODELS.map(function (m) { return rowHtml(m, currentModel); }).join('') + '</tbody>'
      + '</table>'
      + '<div class="vmg-notes">'
      +   '<p><b>고르는 기준</b> — 이 앱은 컷마다 캐릭터가 정확한 <b>스틸컷</b>을 먼저 만듭니다. '
      +      '그 스틸컷을 시작 이미지로 쓰는 모델이라야 공들인 구도·프레이밍이 살아납니다.</p>'
      +   '<p><b>시작 이미지 vs 참조는 택일입니다</b> — 두 가지를 동시에 받는 모델은 없습니다. '
      +      '참조를 쓰는 모델(R2V)은 예외 없이 스틸컷을 버리고 프롬프트만으로 다시 그립니다.</p>'
      +   '<p><b>Wan 2.7 주의</b> — 앱은 참조를 보내지만 i2v 스키마에 그 파라미터가 없어 '
      +      '<b>조용히 버려집니다</b>. 참조가 필요하면 다른 모델을 고르세요.</p>'
      +   '<p><b>길이 주의</b> — 모든 모델의 최소가 4초(Kling 은 5초)입니다. '
      +      '2~3초 컷도 4초로 생성한 뒤 잘라 쓰므로 컷이 짧을수록 낭비가 큽니다.</p>'
      +   '<p class="vmg-caveat"><b>비용</b> — Atlas Cloud <b>요청당 기본 단가</b>(2026-08-30 확인)입니다. '
      +      '길이·해상도에 따라 실제 청구액은 달라질 수 있고, 할인율은 변동됩니다. '
      +      'Grok Imagine 은 단가를 확인하지 못해 "미확인" 으로 둡니다.</p>'
      + '</div>';
  };


  /**
   * 이미지 모델 선택 가이드.
   *
   * ⚠️ 값의 출처는 **공급자 공식 문서**다(2026-08-30 확인).
   *   OpenAI  gpt-image-2  /v1/images/edits : 이미지 16장, 장당 png·webp·jpg 50MB 미만
   *                        가격 1M 토큰당 텍스트 입력 $5 / 이미지 입력 $8 / 이미지 출력 $30
   *   Gemini  3.1 Flash Image               : 레퍼런스 14장(오브젝트 10 + 캐릭터 4 권장)
   *                        가격 입력 $0.50/1M · 출력 이미지 1K $0.067 · 2K $0.101 · 4K $0.151
   * 앱 동작 차이도 함께 적는다 — 레퍼런스를 이미지에 묶는 방법이 서로 다르다.
   */
  // 수치·기호는 언어와 무관하고, 문장만 사전에서 고른다.
  var IMAGE_MODELS = [
    { id: 'openai', name: 'GPT Image 2', fit: 'best' },
    { id: 'gemini', name: 'Gemini 3.1 Flash Image', fit: 'good' }
  ];

  var IMAGE_TEXT = {
    ko: {
      title: '이미지 모델 고르기',
      cols: ['모델', '레퍼런스 최대', '이미지 구분 방식', '마스크 편집', '비용', '강점', '약점', '적합도'],
      now: '현재',
      models: {
        openai: {
          refs: '16장', bind: '보내는 순서', mask: '✓ 알파 마스크', cost: '출력 $30 / 1M 토큰',
          good: '레퍼런스를 가장 많이 받음 · 지시 이행이 또렷함',
          bad: '이미지별 라벨을 못 붙여 순서로만 구분 · 일부 지역에서 엣지 차단(프록시 경유)'
        },
        gemini: {
          refs: '14장', bind: '이미지 옆 라벨', mask: '✓ 인페인팅 권장', cost: '1K $0.067 · 2K $0.101',
          good: '이미지 바로 옆 라벨로 다중 캐릭터 바인딩이 정확 · 컷당 비용 예측이 쉬움',
          bad: '캐릭터 레퍼런스는 4장까지 권장(넘기면 오히려 흔들림)'
        }
      },
      notes: [
        '<b>레퍼런스가 하는 일</b> — 컷 하나에 캐릭터 시트 · 배경 플레이트 · 소품 · 이전 컷을 함께 붙여 일관성을 잡습니다. 상한을 넘기면 <b>각 캐릭터의 첫 시트 → 컷 레퍼런스 → 배경 → 소품 → 캐릭터 추가 포즈</b> 순으로 남깁니다.',
        '<b>이미지 구분 방식</b> — Gemini 는 각 이미지 <b>바로 옆</b>에 "이건 @네모의 시트" 같은 라벨을 끼워 넣을 수 있어 다중 캐릭터 바인딩이 정확합니다. GPT Image 는 그 자리가 없어 <b>보내는 순서</b>로만 구분되므로, 앱이 프롬프트에 순서 목록을 덧붙여 역할을 알려줍니다.',
        '<b>몇 장이 적당한가</b> — 많이 붙일수록 장당 반영도는 옅어지고 입력 비용·시간은 늘어납니다. Gemini 문서는 캐릭터 일관성용으로 <b>4장까지</b>를 권합니다. 상한은 막아두지 않았으니 컷 성격에 맞게 쓰세요.',
        '<b>폴백</b> — GPT Image 호출이 실패하면 Gemini 로 자동 대체 생성합니다. 이때는 Gemini 상한에 맞춰 뒤쪽 레퍼런스부터 줄여 보냅니다(중요한 것이 앞에 오도록 정렬돼 있습니다).'
      ],
      caveat: '<b>비용</b> — 공급자 공식 가격표(2026-08-30 확인)입니다. GPT Image 2 는 1M 토큰당 텍스트 입력 $5 · 이미지 입력 $8 · 이미지 출력 $30 이라 컷당 금액이 해상도·품질에 따라 달라집니다. Gemini 3.1 Flash Image 는 이미지 1장 기준 1K $0.067 · 2K $0.101 · 4K $0.151 로 예측이 쉽습니다.'
    },
    en: {
      title: 'Choosing an image model',
      cols: ['Model', 'Max references', 'How images are told apart', 'Mask editing', 'Cost', 'Strengths', 'Weaknesses', 'Fit'],
      now: 'current',
      models: {
        openai: {
          refs: '16', bind: 'Upload order', mask: '✓ Alpha mask', cost: 'Output $30 / 1M tokens',
          good: 'Takes the most references · follows instructions crisply',
          bad: 'No per-image labels — order is the only cue · edge-blocked in some regions (routed via proxy)'
        },
        gemini: {
          refs: '14', bind: 'Label beside image', mask: '✓ Inpainting preferred', cost: '1K $0.067 · 2K $0.101',
          good: 'Labels sit next to each image, so multi-character binding is precise · cost per cut is predictable',
          bad: 'Up to 4 character references recommended (more can hurt consistency)'
        }
      },
      notes: [
        '<b>What references do</b> — a single cut can carry character sheets, a background plate, props and the previous cut together to keep things consistent. Over the limit, what survives is <b>each character\'s first sheet → the cut reference → background → props → extra character poses</b>.',
        '<b>How images are told apart</b> — Gemini can slot a label such as "this is @Nemo\'s sheet" <b>right next to</b> each image, so multi-character binding is precise. GPT Image has no such slot and relies on <b>upload order</b>, so the app appends an ordered manifest to the prompt to explain each image\'s role.',
        '<b>How many is right</b> — the more you attach, the weaker each one lands, while input cost and latency grow. Gemini\'s docs recommend <b>up to 4</b> for character consistency. The limit is not enforced, so use what the cut needs.',
        '<b>Fallback</b> — if the GPT Image call fails, generation falls back to Gemini automatically. References are then trimmed from the end to fit Gemini\'s limit (the important ones are ordered first).'
      ],
      caveat: '<b>Cost</b> — provider price lists (checked 2026-08-30). GPT Image 2 is $5 text input · $8 image input · $30 image output per 1M tokens, so the per-cut amount varies with resolution and quality. Gemini 3.1 Flash Image is $0.067 (1K) · $0.101 (2K) · $0.151 (4K) per image, which is easier to predict.'
    }
  };

  function imageText() {
    return IMAGE_TEXT[guideLang()];
  }

  function imageRowHtml(m, current) {
    var fit = FIT[m.fit] || FIT.ok;
    var t = imageText();
    var d = (t.models && t.models[m.id]) || {};
    return '<tr class="' + (m.id === current ? 'is-current' : '') + '">'
      + '<td class="vmg-name">' + esc(m.name)
        + (m.id === current ? '<span class="vmg-now">' + esc(t.now) + '</span>' : '') + '</td>'
      + '<td class="vmg-c">' + esc(d.refs) + '</td>'
      + '<td class="vmg-c">' + esc(d.bind) + '</td>'
      + '<td class="vmg-c">' + esc(d.mask) + '</td>'
      + '<td class="vmg-c">' + esc(d.cost) + '</td>'
      + '<td class="vmg-good">' + esc(d.good) + '</td>'
      + '<td class="vmg-bad">' + esc(d.bad) + '</td>'
      + '<td class="vmg-c"><span class="vmg-fit ' + fit.cls + '">' + esc(fitLabel(fit)) + '</span></td>'
      + '</tr>';
  }

  guide.renderImage = function (currentProvider) {
    var t = imageText();
    // 영상 표(9칸)와 칸 수가 달라 폭 규칙을 공유하면 안 된다 — 전용 클래스로 폭을 따로 준다.
    return ''
      + '<div class="vmg-head">'
      +   '<h2 class="vmg-title">' + esc(t.title) + '</h2>'
      +   '<button type="button" class="vmg-close" data-vmg-close aria-label="' + esc(closeLabel()) + '">✕</button>'
      + '</div>'
      + '<table class="vmg-table vmg-table-image">'
      +   '<thead><tr>' + t.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>'
      +   '<tbody>' + IMAGE_MODELS.map(function (m) { return imageRowHtml(m, currentProvider); }).join('') + '</tbody>'
      + '</table>'
      + '<div class="vmg-notes">'
      +   t.notes.map(function (n) { return '<p>' + n + '</p>'; }).join('')
      +   '<p class="vmg-caveat">' + t.caveat + '</p>'
      + '</div>';
  };

  guide.openImage = function (currentProvider) {
    var modal = document.getElementById('video-model-guide-modal');
    var body = document.getElementById('video-model-guide-body');
    if (!modal || !body) return;
    body.innerHTML = guide.renderImage(currentProvider);
    openState = { kind: 'image', current: currentProvider };
    modal.classList.remove('hidden');
  };

  guide.open = function (currentModel) {
    var modal = document.getElementById('video-model-guide-modal');
    var body = document.getElementById('video-model-guide-body');
    if (!modal || !body) return;
    body.innerHTML = guide.render(currentModel);
    openState = { kind: 'video', current: currentModel };
    modal.classList.remove('hidden');
  };

  guide.close = function () {
    var modal = document.getElementById('video-model-guide-modal');
    if (modal) modal.classList.add('hidden');
    openState = null;
  };

  // 어떤 표가 열려 있는지 기억해 두고, 언어를 바꾸면 그대로 다시 그린다.
  window.addEventListener('nk:lang-changed', function () {
    if (!openState) return;
    var modal = document.getElementById('video-model-guide-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (openState.kind === 'image') guide.openImage(openState.current);
    else guide.open(openState.current);
  });

  // 닫기: ✕ · 배경 클릭 · Esc
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    if (t.closest && t.closest('[data-vmg-close]')) { guide.close(); return; }
    if (t.id === 'video-model-guide-modal') guide.close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('video-model-guide-modal');
    if (modal && !modal.classList.contains('hidden')) guide.close();
  });
})();
