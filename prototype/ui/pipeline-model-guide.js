;(function () {
  var NK = window.NK || (window.NK = {});
  var guide = NK.uiModelGuide || (NK.uiModelGuide = {});

  /**
   * 영상 모델 선택 가이드.
   *
   * 표의 능력치는 추측이 아니라 이 저장소에서 확인한 값이다:
   *   - 길이 허용 집합: functions/api/_shared/video-specs.ts (MODEL_DURATIONS)
   *   - 시작 이미지 / 레퍼런스 지원: js/ui/ai-video-gen.js (ALL_MODELS caps)
   *   - 레퍼런스 자동 첨부 대상: ui/pipeline-video.js (REFS_MODELS)
   *   - R2V 가 시작 이미지를 버리는 동작: functions/api/video.ts
   *
   * 비용은 상대 등급이다. 공급자 단가표가 저장소에 없고 공개 페이지에서도
   * 확인되지 않아 정확한 금액을 지어내지 않았다. 등급 근거는 아래 costBasis 에 적는다.
   * 실제 단가를 확보하면 COST 만 고치면 된다.
   */
  var COST = {
    low:  { label: '낮음',   cls: 'is-low' },
    mid:  { label: '보통',   cls: 'is-mid' },
    high: { label: '높음',   cls: 'is-high' }
  };

  var MODELS = [
    {
      id: 'wan', name: 'Wan 2.7',
      dur: '4~15', start: '시작+끝', refs: '✓', res: '—', cost: 'mid',
      good: '시작 이미지와 캐릭터 참조를 동시에 사용',
      bad: '화질 최상위는 아님',
      fit: 'best'
    },
    {
      id: 'vidu-q3', name: 'Vidu Q3-Mix',
      dur: '4·5·6·8·10', start: '시작', refs: '✓ 4장', res: '—', cost: 'mid',
      good: '시작 이미지 + 참조, 길이 선택 무난',
      bad: 'Wan 보다 길이 선택지가 좁음',
      fit: 'good'
    },
    {
      id: 'seedance', name: 'Seedance 2.0',
      dur: '4~15', start: '시작', refs: '✗', res: '720p', cost: 'mid',
      good: '길이가 가장 유연, 안정적',
      bad: '캐릭터 참조 없음 · 720p 고정',
      fit: 'ok'
    },
    {
      id: 'grok', name: 'Grok Imagine',
      dur: '4·6·8', start: '시작', refs: '✗', res: '480/720p', cost: 'low',
      good: '가장 저렴, 이미지 애니메이션에 특화',
      bad: '캐릭터 참조 없음 · 길이 3종뿐',
      fit: 'ok'
    },
    {
      id: 'veo', name: 'Veo 3.1 Fast',
      dur: '4·6·8', start: '시작', refs: '✗', res: '—', cost: 'mid',
      good: '움직임이 자연스럽고 빠름',
      bad: '캐릭터 참조 없음',
      fit: 'ok'
    },
    {
      id: 'veo-full', name: 'Veo 3.1 Full',
      dur: '4·6·8', start: '시작', refs: '✗', res: '—', cost: 'high',
      good: '품질 최상위, 네이티브 오디오',
      bad: '노래 모드에선 오디오가 무용 → 값만 비쌈',
      fit: 'poor'
    },
    {
      id: 'kling-final', name: 'Kling Final (v2.6 Pro)',
      dur: '5 또는 10', start: '시작+끝', refs: '✗', res: '1080p FHD', cost: 'high',
      good: '화질 최고 · 카메라 무브 직접 지정',
      bad: '최소 5초 — 2~3초 컷에 안 맞음',
      fit: 'long-only'
    },
    {
      id: 'grok-r2v', name: 'Grok R2V',
      dur: '4·6·8', start: '✗ 버림', refs: '✓ 4장', res: '480/720p', cost: 'low',
      good: '캐릭터 참조로만 생성',
      bad: '시작 이미지를 버려 컷 구도가 날아감',
      fit: 'avoid'
    },
    {
      id: 'seedance-r2v', name: 'Seedance 2.0 Reference',
      dur: '4~15', start: '✗ 버림', refs: '✓', res: '720p', cost: 'mid',
      good: '참조 기반 일관성',
      bad: '시작 이미지를 버려 컷 구도가 날아감',
      fit: 'avoid'
    }
  ];

  var FIT = {
    'best':      { label: '추천', cls: 'is-best' },
    'good':      { label: '무난', cls: 'is-good' },
    'ok':        { label: '보통', cls: 'is-ok' },
    'long-only': { label: '긴 컷만', cls: 'is-warn' },
    'poor':      { label: '비권장', cls: 'is-warn' },
    'avoid':     { label: '피하기', cls: 'is-bad' }
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function rowHtml(m, currentModel) {
    var fit = FIT[m.fit] || FIT.ok;
    var cost = COST[m.cost] || COST.mid;
    return '<tr class="' + (m.id === currentModel ? 'is-current' : '') + '">'
      + '<td class="vmg-name">' + esc(m.name)
        + (m.id === currentModel ? '<span class="vmg-now">현재</span>' : '') + '</td>'
      + '<td class="vmg-c">' + esc(m.dur) + '</td>'
      + '<td class="vmg-c">' + esc(m.start) + '</td>'
      + '<td class="vmg-c">' + esc(m.refs) + '</td>'
      + '<td class="vmg-c">' + esc(m.res) + '</td>'
      + '<td class="vmg-c"><span class="vmg-cost ' + cost.cls + '">' + esc(cost.label) + '</span></td>'
      + '<td class="vmg-good">' + esc(m.good) + '</td>'
      + '<td class="vmg-bad">' + esc(m.bad) + '</td>'
      + '<td class="vmg-c"><span class="vmg-fit ' + fit.cls + '">' + esc(fit.label) + '</span></td>'
      + '</tr>';
  }

  guide.render = function (currentModel) {
    return ''
      + '<div class="vmg-head">'
      +   '<h2 class="vmg-title">영상 모델 고르기</h2>'
      +   '<button type="button" class="vmg-close" data-vmg-close aria-label="닫기">✕</button>'
      + '</div>'
      + '<table class="vmg-table">'
      +   '<thead><tr>'
      +     '<th>모델</th><th>길이(초)</th><th>시작 이미지</th><th>캐릭터 참조</th>'
      +     '<th>화질</th><th>비용</th><th>강점</th><th>약점</th><th>적합도</th>'
      +   '</tr></thead>'
      +   '<tbody>' + MODELS.map(function (m) { return rowHtml(m, currentModel); }).join('') + '</tbody>'
      + '</table>'
      + '<div class="vmg-notes">'
      +   '<p><b>고르는 기준</b> — 이 앱은 컷마다 캐릭터가 정확한 이미지를 먼저 만듭니다. '
      +      '그 이미지를 <b>시작 이미지</b>로 쓰면서 <b>캐릭터 참조</b>까지 얹을 수 있는 모델이 캐릭터 일관성에 가장 유리합니다.</p>'
      +   '<p><b>R2V 주의</b> — Grok R2V · Seedance Reference 는 참조를 쓰면 시작 이미지를 <b>버립니다</b>. '
      +      '공들여 만든 컷 구도·프레이밍이 사라지므로 이 작업 흐름에는 맞지 않습니다.</p>'
      +   '<p><b>길이 주의</b> — 모든 모델의 최소가 4초(Kling 은 5초)입니다. '
      +      '2~3초 컷은 4초로 올려 생성한 뒤 잘라 쓰므로 그만큼 비용이 더 나갑니다. 컷이 짧을수록 낭비가 큽니다.</p>'
      +   '<p class="vmg-caveat"><b>비용 표기</b> — 공급자 단가표가 앱에 없어 <b>상대 등급</b>으로만 표시합니다. '
      +      '등급은 모델 등급(Fast/Lite &lt; 표준 &lt; Pro/Full)과 해상도를 근거로 했습니다. '
      +      '정확한 금액은 공급자 콘솔에서 확인하세요.</p>'
      + '</div>';
  };

  guide.open = function (currentModel) {
    var modal = document.getElementById('video-model-guide-modal');
    var body = document.getElementById('video-model-guide-body');
    if (!modal || !body) return;
    body.innerHTML = guide.render(currentModel);
    modal.classList.remove('hidden');
  };

  guide.close = function () {
    var modal = document.getElementById('video-model-guide-modal');
    if (modal) modal.classList.add('hidden');
  };

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
