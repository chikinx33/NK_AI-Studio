;(function () {
  var NK = window.NK || (window.NK = {});
  var edit = NK.uiPipelineImageEdit || (NK.uiPipelineImageEdit = {});

  var MAX_MASK_DIM = 1024;       // 마스크 PNG 최대 변 길이 (페이로드 제한)
  var MAX_SCENE_HISTORY = 10;    // 씬당 보관 버전 이력 개수

  // 모듈 세션 상태 (모달 1개를 재사용)
  var S = {
    opts: null,
    idx: -1,
    aspectRatio: '16:9',
    originalImageUrl: '',   // 모달 열 때의 씬 이미지 (적용 시 이력으로 보존)
    workingImageUrl: '',    // 현재 미리보기 이미지 (아직 미적용)
    editStack: [],          // 모달 내 되돌리기용 이전 workingImageUrl 목록
    conversation: [],       // {prompt, imageDataUrl, mode}
    busy: false,
    hasStrokes: false,
    drawing: false
  };

  function getProvider() {
    try {
      var sel = document.getElementById('image-provider-select');
      if (sel && sel.value) {
        return String(sel.value).trim().toLowerCase() === 'openai' ? 'openai' : 'gemini';
      }
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider';
      var raw = String(localStorage.getItem(key) || '').trim().toLowerCase();
      return raw === 'openai' ? 'openai' : 'gemini';
    } catch (_) { return 'gemini'; }
  }

  function toPlayable(url) {
    if (S.opts && typeof S.opts.toPlayableMediaUrl === 'function') return S.opts.toPlayableMediaUrl(url);
    return String(url || '').trim();
  }

  function injectStyleOnce() {
    if (document.getElementById('img-edit-style')) return;
    var st = document.createElement('style');
    st.id = 'img-edit-style';
    st.textContent = [
      '.img-edit-modal{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(4,8,16,0.72);backdrop-filter:blur(3px);}',
      '.img-edit-modal.hidden{display:none;}',
      '.img-edit-dialog{width:min(1040px,94vw);max-height:92vh;display:flex;flex-direction:column;background:#0e1729;border:1px solid rgba(255,255,255,0.12);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,0.5);overflow:hidden;}',
      '.img-edit-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);}',
      '.img-edit-title{font-size:15px;font-weight:600;color:#e8f1ff;}',
      '.img-edit-body{display:flex;gap:16px;padding:16px;overflow:auto;}',
      '.img-edit-canvas-wrap{position:relative;flex:1 1 60%;min-width:0;display:flex;align-items:center;justify-content:center;background:#05080f;border-radius:10px;overflow:hidden;}',
      '.img-edit-base{max-width:100%;max-height:64vh;display:block;border-radius:8px;user-select:none;}',
      '.img-edit-mask{position:absolute;top:0;left:0;cursor:crosshair;opacity:0.5;touch-action:none;}',
      '.img-edit-mask.off{pointer-events:none;}',
      '.img-edit-side{flex:1 1 40%;min-width:260px;display:flex;flex-direction:column;gap:10px;}',
      '.img-edit-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.img-edit-tools label{font-size:12px;color:rgba(255,255,255,0.7);}',
      '.img-edit-brush{flex:1;min-width:90px;}',
      '.img-edit-instruction{width:100%;min-height:88px;resize:vertical;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:#0a1322;color:#e8f1ff;font-size:13px;line-height:1.5;}',
      '.img-edit-status{min-height:18px;font-size:12px;color:#8fb7ff;}',
      '.img-edit-status.error{color:#ff8585;}',
      '.img-edit-history{display:flex;gap:6px;flex-wrap:wrap;max-height:120px;overflow:auto;}',
      '.img-edit-history .thumb{width:54px;height:54px;border-radius:6px;border:1px solid rgba(255,255,255,0.14);object-fit:cover;cursor:pointer;}',
      '.img-edit-history .thumb.cur{outline:2px solid var(--accent,#7bd7ff);}',
      '.img-edit-foot{margin-top:auto;display:flex;gap:8px;justify-content:flex-end;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);}',
      '.img-edit-hint{font-size:11px;color:rgba(255,255,255,0.5);}'
    ].join('');
    document.head.appendChild(st);
  }

  function ensureModal() {
    var existing = document.getElementById('img-edit-modal');
    if (existing) return existing;
    injectStyleOnce();
    var m = document.createElement('div');
    m.id = 'img-edit-modal';
    m.className = 'img-edit-modal hidden';
    m.innerHTML = [
      '<div class="img-edit-dialog">',
      '<div class="img-edit-head">',
      '<span class="img-edit-title">이미지 수정</span>',
      '<button class="btn-secondary compact" data-edit="close">닫기</button>',
      '</div>',
      '<div class="img-edit-body">',
      '<div class="img-edit-canvas-wrap">',
      '<img class="img-edit-base" alt="edit base" />',
      '<canvas class="img-edit-mask"></canvas>',
      '</div>',
      '<div class="img-edit-side">',
      '<div class="img-edit-tools">',
      '<label>인페인팅</label>',
      '<button class="btn-secondary compact" data-edit="mask-toggle" style="min-width:78px;">브러시 ON</button>',
      '<input type="range" class="img-edit-brush" min="6" max="140" value="44" />',
      '<button class="btn-ghost compact" data-edit="mask-clear">마스크 지우기</button>',
      '</div>',
      '<p class="img-edit-hint">수정할 영역을 칠하면 그 부분만 바뀌어요. 칠하지 않으면 지시문만으로 전체를 수정해요.</p>',
      '<textarea class="img-edit-instruction" placeholder="예) 왼쪽 인물의 머리색을 검정으로 / 배경 조명을 노을빛으로 / 표정만 미소로"></textarea>',
      '<div style="display:flex;gap:8px;">',
      '<button class="btn-primary compact" data-edit="generate" style="flex:1;">수정 생성</button>',
      '<button class="btn-secondary compact" data-edit="undo">되돌리기</button>',
      '</div>',
      '<div class="img-edit-status"></div>',
      '<div class="img-edit-history"></div>',
      '<div class="img-edit-foot">',
      '<button class="btn-ghost compact" data-edit="cancel">취소</button>',
      '<button class="btn-primary compact" data-edit="apply">적용</button>',
      '</div>',
      '</div>',
      '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(m);
    bindModal(m);
    return m;
  }

  function el(sel) {
    var m = document.getElementById('img-edit-modal');
    return m ? m.querySelector(sel) : null;
  }

  function setStatus(text, isError) {
    var s = el('.img-edit-status');
    if (!s) return;
    s.textContent = text || '';
    s.classList.toggle('error', !!isError);
  }

  // ── 마스크 캔버스 ──────────────────────────────────────────
  function sizeMaskCanvas() {
    var img = el('.img-edit-base');
    var canvas = el('.img-edit-mask');
    if (!img || !canvas) return;
    var rect = img.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var nw = img.naturalWidth || rect.width;
    var nh = img.naturalHeight || rect.height;
    var scale = Math.min(1, MAX_MASK_DIM / Math.max(nw, nh));
    canvas.width = Math.max(1, Math.round(nw * scale));
    canvas.height = Math.max(1, Math.round(nh * scale));
    // 표시 크기는 이미지 렌더 박스에 정확히 맞춘다
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    var wrap = canvas.parentElement;
    if (wrap) {
      var wrapRect = wrap.getBoundingClientRect();
      canvas.style.left = (rect.left - wrapRect.left) + 'px';
      canvas.style.top = (rect.top - wrapRect.top) + 'px';
    }
  }

  function clearMask() {
    var canvas = el('.img-edit-mask');
    if (!canvas) return;
    var cx = canvas.getContext('2d');
    cx.clearRect(0, 0, canvas.width, canvas.height);
    S.hasStrokes = false;
  }

  function paintAt(ev) {
    var canvas = el('.img-edit-mask');
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var px = (ev.clientX - rect.left) / rect.width * canvas.width;
    var py = (ev.clientY - rect.top) / rect.height * canvas.height;
    var brushEl = el('.img-edit-brush');
    var brushCss = brushEl ? Number(brushEl.value) || 44 : 44;
    var radius = brushCss * (canvas.width / rect.width) / 2;
    var cx = canvas.getContext('2d');
    cx.fillStyle = '#ff5555';
    cx.beginPath();
    cx.arc(px, py, Math.max(1, radius), 0, Math.PI * 2);
    cx.fill();
    S.hasStrokes = true;
  }

  // Gemini: 흑배경 + 흰색 칠한 영역. OpenAI: 흰 불투명 + 칠한 영역 투명(알파=0).
  function exportMask(provider) {
    var src = el('.img-edit-mask');
    if (!src || !S.hasStrokes) return '';
    // OpenAI native mask 는 소스 이미지와 픽셀 크기가 정확히 일치해야 한다.
    // 따라서 OpenAI 일 때는 베이스 이미지의 natural 크기로 마스크를 렌더한다.
    var img = el('.img-edit-base');
    var outW = src.width;
    var outH = src.height;
    if (provider === 'openai' && img && img.naturalWidth && img.naturalHeight) {
      outW = img.naturalWidth;
      outH = img.naturalHeight;
    }
    var out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    var ox = out.getContext('2d');
    if (provider === 'openai') {
      // 칠한 영역 = 투명(알파 0) = 수정 대상, 나머지 = 불투명 흰색 = 보존.
      ox.fillStyle = '#ffffff';
      ox.fillRect(0, 0, outW, outH);
      ox.globalCompositeOperation = 'destination-out';
      ox.drawImage(src, 0, 0, outW, outH);
      ox.globalCompositeOperation = 'source-over';
    } else {
      // Gemini: 흑배경 + 칠한 영역을 흰색으로.
      ox.fillStyle = '#000000';
      ox.fillRect(0, 0, outW, outH);
      var tmp = document.createElement('canvas');
      tmp.width = outW; tmp.height = outH;
      var tx = tmp.getContext('2d');
      tx.fillStyle = '#ffffff';
      tx.fillRect(0, 0, outW, outH);
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(src, 0, 0, outW, outH);
      ox.drawImage(tmp, 0, 0);
    }
    try { return out.toDataURL('image/png'); } catch (_) { return ''; }
  }

  // ── 미리보기/이력 렌더 ─────────────────────────────────────
  function renderBase() {
    var img = el('.img-edit-base');
    if (!img) return;
    img.onload = function () { sizeMaskCanvas(); clearMask(); };
    img.src = toPlayable(S.workingImageUrl);
  }

  function renderHistory() {
    var box = el('.img-edit-history');
    if (!box) return;
    var urls = S.editStack.concat([S.workingImageUrl]);
    box.innerHTML = urls.map(function (u, i) {
      var cur = (i === urls.length - 1) ? ' cur' : '';
      return '<img class="thumb' + cur + '" data-edit-idx="' + i + '" src="' + toPlayable(u) + '" alt="ver ' + (i + 1) + '" title="버전 ' + (i + 1) + '" />';
    }).join('');
  }

  function refreshView() {
    renderBase();
    renderHistory();
  }

  // ── 생성 ──────────────────────────────────────────────────
  async function runGenerate() {
    if (S.busy) return;
    var ta = el('.img-edit-instruction');
    var instruction = ta ? String(ta.value || '').trim() : '';
    if (!instruction && !S.hasStrokes) {
      setStatus('수정 지시문을 입력하거나 영역을 칠해주세요.', true);
      return;
    }
    var opts = S.opts || {};
    var projectId = (opts.getProjectId ? opts.getProjectId() : '') || '';
    if (!projectId) { setStatus('프로젝트가 선택되지 않았습니다.', true); return; }
    var provider = getProvider();
    var maskDataUrl = S.hasStrokes ? exportMask(provider) : '';

    S.busy = true;
    var genBtn = el('[data-edit="generate"]');
    if (genBtn) genBtn.disabled = true;
    setStatus('수정 생성 중...');

    try {
      var body = {
        prompt: instruction || '마스크로 표시한 영역을 자연스럽게 다듬어 주세요.',
        aspectRatio: S.aspectRatio,
        projectId: projectId,
        provider: provider,
        generationMode: 'image-to-image',
        generationStyle: 'conversation',
        cameraTargetMode: 'subject',
        referenceImages: [{
          referenceId: 1,
          referenceType: 'REFERENCE_TYPE_SUBJECT',
          imageDataUrl: S.workingImageUrl,
          subjectDescription: 'Current scene image to edit. Preserve subject identity, composition, framing, and lighting unless the instruction explicitly changes them.',
          subjectType: 'SUBJECT_TYPE_DEFAULT'
        }],
        conversationHistory: S.conversation.slice(-3)
      };
      if (maskDataUrl) body.maskDataUrl = maskDataUrl;

      var json = await NK.api.imagen(body);
      var dataUrl = json.dataUrl || json.bytesBase64Encoded || '';
      var signedUrl = String(json.signedUrl || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error('이미지 데이터가 비었습니다.');
      if (typeof opts.enforceImageAspectRatio === 'function') {
        try {
          var normalized = await opts.enforceImageAspectRatio(imageRef, S.aspectRatio);
          if (normalized && normalized.url) imageRef = normalized.url;
        } catch (_) {}
      }
      // 이전 이미지를 되돌리기 스택과 대화 이력에 보존
      S.editStack.push(S.workingImageUrl);
      S.conversation.push({ prompt: instruction || 'masked refinement', imageDataUrl: imageRef, mode: 'image-to-image' });
      S.workingImageUrl = imageRef;
      if (ta) ta.value = '';
      S.hasStrokes = false;
      refreshView();
      setStatus('수정 완료 — 결과를 확인하고 "적용"을 누르면 저장돼요.');
    } catch (err) {
      var msg = (err && err.message) ? String(err.message) : '수정 생성 실패';
      var detail = '';
      try {
        if (err && err.detail) {
          var dj = JSON.parse(err.detail);
          detail = (dj && (dj.hint || (dj.error && dj.error.message))) || '';
        }
      } catch (_) {}
      setStatus(msg + (detail ? ' · ' + detail : ''), true);
    } finally {
      S.busy = false;
      if (genBtn) genBtn.disabled = false;
    }
  }

  function undo() {
    if (S.busy || !S.editStack.length) return;
    S.workingImageUrl = S.editStack.pop();
    if (S.conversation.length) S.conversation.pop();
    refreshView();
    setStatus('이전 버전으로 되돌렸어요.');
  }

  function applyToScene() {
    if (S.busy) return;
    var opts = S.opts || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) { close(); return; }
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes) || S.idx < 0 || S.idx >= st.scenes.length) { close(); return; }
    var scene = st.scenes[S.idx];
    if (String(S.workingImageUrl || '') === String(S.originalImageUrl || '')) { close(); return; }
    // 적용 전 원본을 버전 이력에 보존
    var history = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
    if (S.originalImageUrl) {
      history.push(S.originalImageUrl);
      if (history.length > MAX_SCENE_HISTORY) history = history.slice(history.length - MAX_SCENE_HISTORY);
    }
    st.scenes[S.idx] = Object.assign({}, scene, {
      imageDataUrl: S.workingImageUrl,
      imageHistory: history,
      imgError: '',
      imgLoading: false
    });
    ctx.setState(st);
    if (typeof opts.updateSceneRow === 'function') opts.updateSceneRow(S.idx, st.header || '', 'image');
    if (ctx.persistPipeline) ctx.persistPipeline();
    close();
  }

  function bindModal(m) {
    m.addEventListener('click', function (e) {
      if (e.target === m) { close(); return; }
      var btn = e.target.closest('[data-edit]');
      if (btn) {
        var act = btn.dataset.edit;
        if (act === 'close' || act === 'cancel') { close(); return; }
        if (act === 'apply') { applyToScene(); return; }
        if (act === 'generate') { runGenerate(); return; }
        if (act === 'undo') { undo(); return; }
        if (act === 'mask-clear') { clearMask(); return; }
        if (act === 'mask-toggle') {
          var canvas = el('.img-edit-mask');
          if (canvas) {
            var off = canvas.classList.toggle('off');
            btn.textContent = off ? '브러시 OFF' : '브러시 ON';
          }
          return;
        }
      }
      var thumb = e.target.closest('.thumb[data-edit-idx]');
      if (thumb) {
        var i = Number(thumb.dataset.editIdx);
        var urls = S.editStack.concat([S.workingImageUrl]);
        if (i >= 0 && i < urls.length && urls[i] !== S.workingImageUrl) {
          // 선택한 버전으로 이동: 그 이후 편집은 스택에서 제거
          S.workingImageUrl = urls[i];
          S.editStack = urls.slice(0, i);
          S.conversation = S.conversation.slice(0, i);
          refreshView();
          setStatus('버전 ' + (i + 1) + ' 선택됨.');
        }
        return;
      }
    });

    var canvas = m.querySelector('.img-edit-mask');
    if (canvas) {
      canvas.addEventListener('pointerdown', function (e) {
        if (canvas.classList.contains('off')) return;
        S.drawing = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        paintAt(e);
      });
      canvas.addEventListener('pointermove', function (e) {
        if (S.drawing) paintAt(e);
      });
      var stop = function () { S.drawing = false; };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
      canvas.addEventListener('pointerleave', stop);
    }

    window.addEventListener('resize', function () {
      if (!m.classList.contains('hidden')) sizeMaskCanvas();
    });
  }

  function close() {
    var m = document.getElementById('img-edit-modal');
    if (m) m.classList.add('hidden');
    S.opts = null;
    S.idx = -1;
    S.editStack = [];
    S.conversation = [];
    S.busy = false;
    S.hasStrokes = false;
    S.drawing = false;
  }

  edit.open = function (options) {
    var opts = options || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) return;
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var idx = Number(opts.idx);
    var scene = st.scenes[idx];
    if (!scene) return;
    var imageUrl = String(scene.imageDataUrl || '').trim();
    if (!imageUrl) { alert('먼저 이미지를 생성하거나 등록한 뒤 수정할 수 있어요.'); return; }

    ensureModal();
    S.opts = opts;
    S.idx = idx;
    S.aspectRatio = (typeof opts.resolveEffectiveAspectRatio === 'function')
      ? opts.resolveEffectiveAspectRatio(st, ctx)
      : (st.aspectRatio || '16:9');
    S.originalImageUrl = imageUrl;
    S.workingImageUrl = imageUrl;
    S.editStack = [];
    S.conversation = [];
    S.busy = false;
    S.hasStrokes = false;

    var ta = el('.img-edit-instruction');
    if (ta) ta.value = '';
    var toggle = el('[data-edit="mask-toggle"]');
    var canvas = el('.img-edit-mask');
    if (canvas) canvas.classList.remove('off');
    if (toggle) toggle.textContent = '브러시 ON';
    setStatus('');

    var m = document.getElementById('img-edit-modal');
    if (m) m.classList.remove('hidden');
    refreshView();
    // 이미지 캐시되어 onload 가 안 뜰 수 있으니 한 번 더 사이징
    setTimeout(sizeMaskCanvas, 60);
  };

  edit.close = close;
})();
