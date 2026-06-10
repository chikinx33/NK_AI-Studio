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
    versions: [],           // [{url, prompt}] — index 0 = 원본, 이후 생성 결과 누적
    cur: 0,                 // 현재 선택된 버전 인덱스
    busy: false,
    hasStrokes: false,
    drawing: false
  };

  function curUrl() {
    var v = S.versions[S.cur];
    return v ? v.url : '';
  }
  function originalUrl() {
    var v = S.versions[0];
    return v ? v.url : '';
  }

  // 편집창 자체의 엔진 토글이 진실의 원천이다 (상단 페이지 선택과 독립).
  function getProvider() {
    var m = document.getElementById('img-edit-modal');
    var checked = m ? m.querySelector('input[name="img-edit-engine"]:checked') : null;
    return (checked && checked.value === 'openai') ? 'openai' : 'gemini';
  }

  // 현재 언어. 영문 모드면 모달을 영문으로 직접 렌더해 전역 로케일 치환과 충돌하지 않게 한다.
  function currentLang() {
    try {
      if (NK.state && NK.state.runtime && NK.state.runtime.lang) {
        return NK.state.runtime.lang === 'en' ? 'en' : 'ko';
      }
      var k = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
      return String(localStorage.getItem(k) || '').toLowerCase() === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }
  function L(ko, en) {
    return currentLang() === 'en' ? en : ko;
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
      '.img-edit-engine{display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border:1px solid rgba(255,255,255,0.12);border-radius:8px;background:#0a1322;}',
      '.img-edit-engine-opt{display:flex;align-items:center;gap:5px;font-size:13px;color:#e8f1ff;cursor:pointer;}',
      '.img-edit-engine-opt input{accent-color:var(--accent,#7bd7ff);}',
      '.img-edit-engine-hint{font-size:11px;color:rgba(255,255,255,0.55);}',
      '.img-edit-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.img-edit-tools label{font-size:12px;color:rgba(255,255,255,0.7);}',
      '.img-edit-brush{flex:1;min-width:90px;}',
      '.img-edit-instruction{width:100%;min-height:88px;resize:vertical;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:#0a1322;color:#e8f1ff;font-size:13px;line-height:1.5;}',
      '.img-edit-status{min-height:18px;font-size:12px;color:#8fb7ff;}',
      '.img-edit-status.error{color:#ff8585;}',
      '.img-edit-history{display:flex;gap:8px;flex-wrap:wrap;max-height:120px;overflow:auto;padding:4px;}',
      '.img-edit-history .thumb{width:54px;height:54px;border-radius:6px;border:1px solid rgba(255,255,255,0.14);object-fit:cover;cursor:pointer;box-sizing:border-box;}',
      '.img-edit-history .thumb.cur{outline:3px solid var(--accent,#7bd7ff);outline-offset:-3px;}',
      '.img-edit-foot{margin-top:auto;display:flex;gap:8px;justify-content:flex-end;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);}',
      '.img-edit-hint{font-size:11px;color:rgba(255,255,255,0.5);}'
    ].join('');
    document.head.appendChild(st);
  }

  function ensureModal() {
    var existing = document.getElementById('img-edit-modal');
    if (existing) {
      // 언어가 바뀌었으면 현재 언어로 다시 렌더
      if (existing.dataset.lang === currentLang()) return existing;
      try { existing.parentNode && existing.parentNode.removeChild(existing); } catch (_) {}
    }
    injectStyleOnce();
    var m = document.createElement('div');
    m.id = 'img-edit-modal';
    m.className = 'img-edit-modal hidden';
    m.innerHTML = [
      '<div class="img-edit-dialog">',
      '<div class="img-edit-head">',
      '<span class="img-edit-title">' + L('이미지 수정', 'Edit image') + '</span>',
      '<button class="btn-secondary compact" data-edit="close">' + L('닫기', 'Close') + '</button>',
      '</div>',
      '<div class="img-edit-body">',
      '<div class="img-edit-canvas-wrap">',
      '<img class="img-edit-base" alt="edit base" />',
      '<canvas class="img-edit-mask"></canvas>',
      '</div>',
      '<div class="img-edit-side">',
      '<div class="img-edit-engine">',
      '<label class="img-edit-engine-opt"><input type="radio" name="img-edit-engine" value="gemini"> Gemini <span class="img-edit-engine-hint">' + L('· 일반 채팅 수정', '· General chat edit') + '</span></label>',
      '<label class="img-edit-engine-opt"><input type="radio" name="img-edit-engine" value="openai" checked> GPT <span class="img-edit-engine-hint">' + L('· 마스크/인페인팅 권장', '· Mask / inpainting (recommended)') + '</span></label>',
      '</div>',
      '<div class="img-edit-tools">',
      '<label>' + L('인페인팅', 'Inpainting') + '</label>',
      '<button class="btn-secondary compact" data-edit="mask-toggle" style="min-width:78px;">' + L('브러시 ON', 'Brush ON') + '</button>',
      '<input type="range" class="img-edit-brush" min="6" max="140" value="44" />',
      '<button class="btn-ghost compact" data-edit="mask-clear">' + L('마스크 지우기', 'Clear mask') + '</button>',
      '</div>',
      '<p class="img-edit-hint">' + L('수정할 영역을 칠하면 그 부분만 바뀌어요. 칠하지 않으면 지시문만으로 전체를 수정해요.', 'Paint a region to edit only that area. Without painting, the whole image is edited from the instruction.') + '</p>',
      '<textarea class="img-edit-instruction" placeholder="' + L('예) 왼쪽 인물의 머리색을 검정으로 / 배경 조명을 노을빛으로 / 표정만 미소로', 'e.g. Make the left character\'s hair black / warm sunset lighting / just a smiling expression') + '"></textarea>',
      '<div style="display:flex;gap:8px;">',
      '<button class="btn-primary compact" data-edit="generate" style="flex:1;">' + L('수정 생성', 'Generate edit') + '</button>',
      '<button class="btn-secondary compact" data-edit="undo">' + L('되돌리기', 'Undo') + '</button>',
      '</div>',
      '<div class="img-edit-status"></div>',
      '<div class="img-edit-history"></div>',
      '<div class="img-edit-foot">',
      '<button class="btn-ghost compact" data-edit="cancel">' + L('취소', 'Cancel') + '</button>',
      '<button class="btn-primary compact" data-edit="apply">' + L('적용', 'Apply') + '</button>',
      '</div>',
      '</div>',
      '</div>',
      '</div>'
    ].join('');
    m.dataset.lang = currentLang();
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
    img.src = toPlayable(curUrl());
  }

  function renderHistory() {
    var box = el('.img-edit-history');
    if (!box) return;
    box.innerHTML = S.versions.map(function (v, i) {
      var cur = (i === S.cur) ? ' cur' : '';
      var label = (i === 0) ? L('원본', 'Original') : L('수정 ' + i, 'Edit ' + i);
      return '<img class="thumb' + cur + '" data-edit-idx="' + i + '" src="' + toPlayable(v.url) + '" alt="' + label + '" title="' + label + '" />';
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
      setStatus(L('수정 지시문을 입력하거나 영역을 칠해주세요.', 'Enter an instruction or paint a region.'), true);
      return;
    }
    var opts = S.opts || {};
    var projectId = (opts.getProjectId ? opts.getProjectId() : '') || '';
    if (!projectId) { setStatus(L('프로젝트가 선택되지 않았습니다.', 'No project selected.'), true); return; }
    var provider = getProvider();
    var maskDataUrl = S.hasStrokes ? exportMask(provider) : '';

    S.busy = true;
    var genBtn = el('[data-edit="generate"]');
    if (genBtn) genBtn.disabled = true;
    setStatus(L('수정 생성 중...', 'Generating edit...'));

    try {
      var sourceUrl = curUrl();
      // 비율은 프로젝트/에피소드 개요에 지정된 값(resolveEffectiveAspectRatio)을 사용.
      var aspect = S.aspectRatio;
      // 캐릭터 자산은 "사용자가 지시문에 직접 언급한 경우"에만 첨부한다.
      // 씬 대본/내레이션 맥락은 넣지 않는다 — 안 그러면 지시와 무관하게 그 씬에
      // 등장하는 캐릭터(예: 세모)가 참조로 붙어 빈 영역에 그려지는 문제가 생긴다.
      var charRefs = [];
      var subjects = [];
      var negativeText = '';
      var envPromptLines = [];
      if (instruction && NK.uiPipelineImage && NK.uiPipelineImage.resolveCharacterReferencesForText) {
        try {
          var resolved = await NK.uiPipelineImage.resolveCharacterReferencesForText({
            ctx: opts.ctx,
            projectId: projectId,
            scene: {},
            text: instruction
          });
          if (resolved) {
            if (Array.isArray(resolved.referenceImages)) charRefs = resolved.referenceImages;
            if (Array.isArray(resolved.subjects)) subjects = resolved.subjects;
            if (Array.isArray(resolved.promptLines)) envPromptLines = resolved.promptLines;
            negativeText = resolved.negativePromptText || '';
          }
        } catch (_) {}
      }

      // 편집 의도를 명확히: 소스를 그대로 두고 지시한 부분만 수정. 백엔드 editInPlace
      // 가 보존 지시문을 추가하므로 여기서는 지시문 + 캐릭터 신원 고정만 덧붙인다.
      var promptText = instruction || 'Naturally refine the area marked by the mask.';
      if (subjects.length) {
        promptText += '\nKeep ' + subjects.join(', ') + ' on-model using the additional reference images (same face, silhouette, colors, costume, and proportions). Do not change any other character.';
      }
      // 배경·소품(@) 레퍼런스에 대한 보존 지시문을 덧붙인다.
      if (envPromptLines.length) {
        promptText += '\n' + envPromptLines.join('\n');
      }
      if (negativeText) promptText += '\nDo not include: ' + negativeText;

      // 소스 이미지(편집 대상)를 ref 1 로 둔다. 지시문에서 "@"로 직접 언급한
      // 캐릭터 + 배경/소품 자산을 신원/배경 가이드로 첨부한다(총 4장 이내로 제한 —
      // 이미지 과다 시 모델이 요청을 거부할 수 있어 상한을 둔다).
      var MAX_EDIT_REFS = 4;
      var referenceImages = [{
        referenceId: 1,
        referenceType: 'REFERENCE_TYPE_SUBJECT',
        imageDataUrl: sourceUrl,
        subjectDescription: 'SOURCE image to edit in place.',
        subjectType: 'SUBJECT_TYPE_DEFAULT'
      }];
      var nextRefId = 2;
      (charRefs || []).forEach(function (r) {
        if (!r || !r.imageDataUrl) return;
        if (referenceImages.length >= MAX_EDIT_REFS) return;
        referenceImages.push(Object.assign({}, r, { referenceId: nextRefId++ }));
      });

      // 현재 선택 버전까지의 수정 이력을 대화 맥락으로 전달 (연속 지시 지원).
      // 단, 마스크/캐릭터 참조가 있으면 맥락 이미지가 혼선을 줄 수 있어 생략.
      var convo = [];
      if (!maskDataUrl && !charRefs.length) {
        for (var ci = 1; ci <= S.cur; ci++) {
          var vv = S.versions[ci];
          if (vv && vv.url && vv.prompt) convo.push({ prompt: vv.prompt, imageDataUrl: vv.url, mode: 'image-to-image' });
        }
      }

      var body = {
        prompt: promptText,
        aspectRatio: aspect,
        projectId: projectId,
        provider: provider,
        generationMode: 'image-to-image',
        generationStyle: convo.length ? 'conversation' : 'single',
        editInPlace: true,
        referenceImages: referenceImages,
        conversationHistory: convo.slice(-3)
      };
      if (maskDataUrl) body.maskDataUrl = maskDataUrl;

      var json = await NK.api.imagen(body);
      var dataUrl = json.dataUrl || (json.bytesBase64Encoded ? ('data:image/png;base64,' + json.bytesBase64Encoded) : '');
      var signedUrl = String(json.signedUrl || '').trim();
      var imageRef = signedUrl || dataUrl;
      if (!imageRef) throw new Error(L('이미지 데이터가 비었습니다.', 'No image data returned.'));
      // 결과물은 일절 후처리하지 않는다. 비율은 요청 시 보낸 규격(aspect)으로만 유지.
      // 새 버전 추가 (기존 버전은 모두 유지) 후 현재 선택을 새 버전으로 이동
      S.versions.push({ url: imageRef, prompt: instruction || 'masked refinement' });
      S.cur = S.versions.length - 1;
      // 입력 텍스트는 유지한다(어떤 내용을 보완할지 확인 가능하도록).
      S.hasStrokes = false;
      refreshView();
      setStatus(L('수정 완료 — 썸네일에서 원본/수정본을 비교하고 "적용"을 누르면 저장돼요.', 'Done — compare original/edits in the thumbnails, then press "Apply" to save.'));
    } catch (err) {
      var msg = (err && err.message) ? String(err.message) : L('수정 생성 실패', 'Edit generation failed');
      var detail = '';
      try {
        if (err && err.detail) {
          var dj = JSON.parse(err.detail);
          // 모델이 돌려준 실제 사유를 우선 노출 (일반 안내 hint 보다 구체적)
          var deep = dj && dj.detail && dj.detail.error && dj.detail.error.message;
          detail = String((dj && dj.message) || deep || (dj && dj.error && dj.error.message) || (dj && dj.hint) || '');
        }
      } catch (_) {}
      console.error('이미지 수정 실패:', msg, err && err.detail);
      setStatus(msg + (detail ? ' · ' + detail : ''), true);
    } finally {
      S.busy = false;
      if (genBtn) genBtn.disabled = false;
    }
  }

  function undo() {
    if (S.busy || S.cur <= 0) return;
    // 버전은 모두 유지하고 선택만 이전으로 이동
    S.cur -= 1;
    refreshView();
    setStatus(L('이전 버전을 선택했어요. (생성본은 썸네일에 그대로 남아 있어요)', 'Selected the previous version. (Generated versions remain in the thumbnails.)'));
  }

  function applyToScene() {
    if (S.busy) return;
    var opts = S.opts || {};
    var ctx = opts.ctx;
    if (!ctx || !ctx.getState) { close(); return; }
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes) || S.idx < 0 || S.idx >= st.scenes.length) { close(); return; }
    var scene = st.scenes[S.idx];
    var chosen = curUrl();
    var original = originalUrl();
    if (String(chosen || '') === String(original || '')) { close(); return; }
    // 적용 전 원본을 버전 이력에 보존
    var history = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
    if (original) {
      history.push(original);
      if (history.length > MAX_SCENE_HISTORY) history = history.slice(history.length - MAX_SCENE_HISTORY);
    }
    st.scenes[S.idx] = Object.assign({}, scene, {
      imageDataUrl: chosen,
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
            btn.textContent = off ? L('브러시 OFF', 'Brush OFF') : L('브러시 ON', 'Brush ON');
          }
          return;
        }
      }
      var thumb = e.target.closest('.thumb[data-edit-idx]');
      if (thumb) {
        var i = Number(thumb.dataset.editIdx);
        // 선택만 이동 — 어떤 버전도 삭제하지 않는다 (원본/수정본 자유 비교)
        if (i >= 0 && i < S.versions.length && i !== S.cur) {
          S.cur = i;
          refreshView();
          setStatus(i === 0 ? L('원본을 선택했어요.', 'Selected the original.') : L('수정 ' + i + ' 버전을 선택했어요.', 'Selected edit ' + i + '.'));
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
    S.versions = [];
    S.cur = 0;
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
    if (!imageUrl) { alert(L('먼저 이미지를 생성하거나 등록한 뒤 수정할 수 있어요.', 'Generate or add an image first, then you can edit it.')); return; }

    ensureModal();
    S.opts = opts;
    S.idx = idx;
    S.aspectRatio = (typeof opts.resolveEffectiveAspectRatio === 'function')
      ? opts.resolveEffectiveAspectRatio(st, ctx)
      : (st.aspectRatio || '16:9');
    S.versions = [{ url: imageUrl, prompt: '' }];
    S.cur = 0;
    S.busy = false;
    S.hasStrokes = false;

    var ta = el('.img-edit-instruction');
    if (ta) ta.value = '';
    var toggle = el('[data-edit="mask-toggle"]');
    var canvas = el('.img-edit-mask');
    if (canvas) canvas.classList.remove('off');
    if (toggle) toggle.textContent = L('브러시 ON', 'Brush ON');
    // 엔진 기본값: GPT (마스크/인페인팅에 안정적)
    var def = el('input[name="img-edit-engine"][value="openai"]');
    if (def) def.checked = true;
    setStatus('');

    var m = document.getElementById('img-edit-modal');
    if (m) m.classList.remove('hidden');
    refreshView();
    // 이미지 캐시되어 onload 가 안 뜰 수 있으니 한 번 더 사이징
    setTimeout(sizeMaskCanvas, 60);
  };

  edit.close = close;
})();
