// 스토리보드 제작 서비스 — 씬별 시트 계획·생성·격자 크롭(콘티)·저장·패널→스틸컷.
// 프롬프트는 서버(/api/storyboard/sheet-plan → _shared/storyboard-sheet.js)가 조립한다. 이 파일은 실행(브라우저 의존)만 담당.
// 라벨 규칙: 시트에서 잘라낸 패널은 "콘티", 컷을 정식 생성한 이미지는 "스틸컷"(설계서 2.0절).
// 시트는 payload.storyboardSheets 에 저장한다(설계서 3.2). 컷의 imageDataUrl(스틸컷 자리)에는 콘티를 넣지 않는다.
; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var mod = service.storyboardSheet || (service.storyboardSheet = {});

  var TEXT = {
    ko: {
      labelConti: '콘티',
      labelStill: '스틸컷',
      labelBible: '바이블',
      generating: '시트 생성 중',
      cropping: '패널 자르는 중',
      uploading: '콘티 저장 중',
      rendering: '스틸컷 생성 중',
      noObjectName: '생성 결과에 저장 경로가 없어요',
      stale: '순서가 바뀌어 다시 만들어야 해요'
    },
    en: {
      labelConti: 'Conti',
      labelStill: 'Still',
      labelBible: 'Bible',
      generating: 'Generating sheet',
      cropping: 'Cropping panels',
      uploading: 'Saving conti panels',
      rendering: 'Rendering still',
      noObjectName: 'The result has no storage path',
      stale: 'Cut order changed — regenerate this sheet'
    }
  };
  function currentLang() { return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko'; }
  mod.text = function (key, lang) { var l = lang || currentLang(); return (TEXT[l] && TEXT[l][key]) || TEXT.ko[key] || key; };
  mod.TEXT = TEXT;

  function proxyUrl(objectName) {
    return (objectName && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(objectName) : '';
  }
  mod.proxyUrl = proxyUrl;

  function commonPromptOf(st) {
    var h = String((st && st.header) || '').trim();
    if (h) return h;
    try {
      if (NK.service.project && NK.service.project.buildVisualHeader) return String(NK.service.project.buildVisualHeader(st && st.payload) || '').trim();
    } catch (_) {}
    return '';
  }
  mod.commonPromptOf = commonPromptOf;

  /** 서버 계획/프롬프트 조립. kind: plan | bible-characters | bible-set | board | angle-plate */
  mod.requestPlan = function (body) {
    if (!NK.api || !NK.api.storyboardSheetPlan) return Promise.reject(new Error('api.storyboardSheetPlan missing'));
    return NK.api.storyboardSheetPlan(body || {});
  };

  /** 세트(장소) 목록 — set-plates 와 같은 원천(payload.episodeLocations). */
  mod.locations = function (st) {
    var list = (st && st.payload && Array.isArray(st.payload.episodeLocations)) ? st.payload.episodeLocations : [];
    return list.filter(function (l) { return l && (String(l.name || '').trim() || String(l.description || '').trim()); });
  };

  /** 배경의 단일 기준인 부감 마스터(angle-top). 옛 프로젝트만 정면 refObjectName 으로 폴백한다. */
  function topMasterOf(loc) {
    var variants = Array.isArray(loc && loc.variants) ? loc.variants : [];
    for (var i = 0; i < variants.length; i++) {
      if (variants[i] && String(variants[i].id || '') === 'angle-top' && String(variants[i].refObjectName || '').trim()) {
        return String(variants[i].refObjectName).trim();
      }
    }
    return '';
  }
  mod.topMasterOf = topMasterOf;

  /** 스토리보드의 배경 참조. 부감 마스터를 우선해 공간 배치의 진실을 고정한다. */
  mod.plateReference = function (loc, referenceId) {
    var master = topMasterOf(loc);
    var objectName = master || String((loc && loc.refObjectName) || '').trim();
    var url = proxyUrl(objectName);
    if (!url) return null;
    return {
      referenceId: referenceId || 1,
      // 부감 마스터는 분위기 참고가 아니라 공간·사물 배치를 보존할 피사체 기준이다.
      referenceType: master ? 'REFERENCE_TYPE_SUBJECT' : 'REFERENCE_TYPE_STYLE',
      referenceKind: 'environment',
      imageDataUrl: url,
      subjectDescription: String((loc && loc.name) || 'the set') + (master
        ? ' (TOP-DOWN MASTER PLATE — layout truth; preserve every wall, prop and object position while reconstructing each storyboard camera)'
        : ' (legacy front-facing set plate — preserve its architecture, props, materials and lighting)'),
      subjectType: 'SUBJECT_TYPE_DEFAULT'
    };
  };

  function cameraDirectionOf(scene) {
    var d = String((scene && scene.cameraDirection) || 'front').trim().toLowerCase();
    return ['front', 'back', 'left', 'right'].indexOf(d) >= 0 ? d : 'front';
  }

  function directionPlateObject(loc, direction) {
    var want = 'dir-' + String(direction || 'front').toLowerCase();
    var variants = Array.isArray(loc && loc.variants) ? loc.variants : [];
    for (var i = 0; i < variants.length; i++) {
      if (variants[i] && String(variants[i].id || '') === want && String(variants[i].refObjectName || '').trim()) return String(variants[i].refObjectName).trim();
    }
    return '';
  }

  mod.requiredDirections = function (cuts) {
    var seen = {}; var out = [];
    (Array.isArray(cuts) ? cuts : []).forEach(function (cut) {
      var dir = cameraDirectionOf(cut);
      if (!seen[dir]) { seen[dir] = 1; out.push(dir); }
    });
    return out;
  };

  /** 프롬프트 조립 시 사용할 고정 참조 번호. startId 는 부감 마스터 번호다. */
  mod.storyboardPlateManifest = function (cuts, startId) {
    var next = Number(startId) || 1;
    return mod.requiredDirections(cuts).map(function (direction) {
      next += 1;
      return { direction: direction, referenceId: next };
    });
  };

  /** 부감 마스터 + 현재 시트가 실제로 쓰는 방향 플레이트. manifest 와 같은 순서/번호를 유지한다. */
  mod.storyboardPlateReferences = function (loc, cuts, startId) {
    var base = Number(startId) || 1;
    var refs = [];
    var master = mod.plateReference(loc, base);
    if (master) refs.push(master);
    mod.storyboardPlateManifest(cuts, base).forEach(function (entry) {
      var objectName = directionPlateObject(loc, entry.direction);
      if (!objectName) return;
      refs.push({
        referenceId: entry.referenceId,
        referenceType: 'REFERENCE_TYPE_SUBJECT',
        referenceKind: 'environment-direction',
        imageDataUrl: proxyUrl(objectName),
        subjectDescription: String((loc && loc.name) || 'the set') + ' — exact ' + entry.direction.toUpperCase() + ' wall view; preserve this wall and its fixed objects for cuts assigned to this direction',
        subjectType: 'SUBJECT_TYPE_DEFAULT'
      });
    });
    return refs;
  };

  /** 정식 스틸은 해당 컷의 방향 플레이트를 우선 사용하고, 없을 때만 부감으로 폴백한다. */
  mod.plateReferenceForScene = function (loc, scene, referenceId) {
    var direction = cameraDirectionOf(scene);
    var objectName = directionPlateObject(loc, direction);
    if (!objectName) return mod.plateReference(loc, referenceId);
    return {
      referenceId: referenceId || 1,
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceKind: 'environment-direction',
      imageDataUrl: proxyUrl(objectName),
      subjectDescription: String((loc && loc.name) || 'the set') + ' — exact ' + direction.toUpperCase() + ' wall view for this cut',
      subjectType: 'SUBJECT_TYPE_DEFAULT'
    };
  };

  mod.needsDirectionSheet = function (loc, cuts) {
    if (!topMasterOf(loc)) return false;
    return mod.requiredDirections(cuts).some(function (direction) { return !directionPlateObject(loc, direction); });
  };

  /** 등록 캐릭터 참조 — pipeline-image 의 해석기(캐릭터 시트 → referenceImages)를 그대로 쓴다. */
  mod.characterReferences = async function (st, text, projectId) {
    var helpers = NK.uiPipelineImage && NK.uiPipelineImage._helpers;
    if (!helpers || !helpers.resolveCharacterReferences) return { referenceImages: [], characters: [] };
    try { return await helpers.resolveCharacterReferences(st, text, projectId); } catch (_) { return { referenceImages: [], characters: [] }; }
  };

  /** 시트 이미지 생성. 결과 objectName 은 프로젝트 이미지 저장소에 남는다. */
  mod.generateSheet = async function (st, spec) {
    var json = await NK.api.imagen({
      prompt: spec.prompt,
      aspectRatio: spec.aspect || (st && st.aspectRatio) || '16:9',
      projectId: (st && st.draftId) || '',
      generationMode: spec.generationMode || 'text-to-image',
      cameraTargetMode: spec.cameraTargetMode || undefined,
      imageSize: spec.resolution || '2K',
      provider: spec.provider || undefined,
      referenceImages: Array.isArray(spec.referenceImages) ? spec.referenceImages : []
    });
    var obj = String((json && json.objectName) || '').trim();
    return { objectName: obj, dataUrl: json && json.dataUrl, signedUrl: json && json.signedUrl, model: json && json.model, imageSizeApplied: json && json.imageSizeApplied, promptEcho: json && json.promptEcho };
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  /**
   * 여백선 보정: 기대 경계 주변(셀의 ±8%)에서 가장 밝은 줄을 찾는다(밝기 240 이상이면 채택, 아니면 기대값).
   * 행·열 밝기 프로파일은 축소 캔버스(최대 512px)에서 구해 비용을 줄인다.
   */
  function refineBoundaries(img, cols, rows) {
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var scale = Math.min(1, 512 / Math.max(W, H));
    var w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    var data;
    try { data = g.getImageData(0, 0, w, h).data; } catch (_) { return null; }
    var colB = new Float32Array(w), rowB = new Float32Array(h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4; var b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      colB[x] += b / h; rowB[y] += b / w;
    }
    function pick(profile, n, count) {
      var out = [0];
      for (var k = 1; k < count; k++) {
        var expect = Math.round(n * k / count); var win = Math.max(2, Math.round(n / count * 0.08));
        var best = expect, bestB = -1;
        for (var p = Math.max(1, expect - win); p <= Math.min(n - 2, expect + win); p++) if (profile[p] > bestB) { bestB = profile[p]; best = p; }
        out.push(bestB >= 240 ? best : expect);
      }
      out.push(n);
      return out;
    }
    var xs = pick(colB, w, cols).map(function (v) { return Math.round(v / scale); });
    var ys = pick(rowB, h, rows).map(function (v) { return Math.round(v / scale); });
    return { xs: xs, ys: ys };
  }

  /** 시트를 격자로 자른다 → [{index, dataUrl, w, h}]. 여백선 검출 실패 시 고정 격자. */
  mod.cropPanels = async function (imageUrl, grid, opts) {
    var cols = (grid && grid.cols) || 3, rows = (grid && grid.rows) || 3;
    var img = await loadImage(imageUrl);
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var bounds = null;
    try { bounds = refineBoundaries(img, cols, rows); } catch (_) { bounds = null; }
    var xs = bounds ? bounds.xs : null, ys = bounds ? bounds.ys : null;
    var out = [];
    var inset = Math.round(Math.min(W, H) * 0.006); // 여백선 안쪽으로 살짝
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      var x0 = xs ? xs[c] : Math.round(W * c / cols), x1 = xs ? xs[c + 1] : Math.round(W * (c + 1) / cols);
      var y0 = ys ? ys[r] : Math.round(H * r / rows), y1 = ys ? ys[r + 1] : Math.round(H * (r + 1) / rows);
      var sx = x0 + inset, sy = y0 + inset, sw = Math.max(1, x1 - x0 - inset * 2), sh = Math.max(1, y1 - y0 - inset * 2);
      var cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      out.push({ index: r * cols + c + 1, dataUrl: cv.toDataURL('image/png'), w: sw, h: sh });
    }
    return out;
  };

  function dataUrlToFile(dataUrl, name) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/data:([^;]+)/) || [])[1] || 'image/png';
    var bin = atob(parts[1] || '');
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name || 'panel.png', { type: mime });
  }

  /** 콘티 패널을 프로젝트 저장소에 올린다 → objectName. (data: URL 은 영속화하지 않는다) */
  mod.uploadPanel = async function (projectId, dataUrl, name) {
    var res = await NK.api.imageUpload(projectId, dataUrlToFile(dataUrl, name), { kind: 'image' });
    var obj = String((res && res.objectName) || '').trim();
    if (!obj) throw new Error(mod.text('noObjectName'));
    return obj;
  };

  var directionSheetInFlight = {};

  /**
   * 부감 마스터 한 장에서 정면·후면·좌측·우측을 2×2 한 장으로 만든 뒤 각 방향 캐시에 저장한다.
   * 개별 방향을 따로 생성하지 않아 네 벽의 관계와 렌더링 스타일을 한 호출 안에서 고정한다.
   */
  mod.ensureDirectionSheet = async function (ctx, loc, cuts, opts) {
    var o = opts || {};
    if (!loc || !mod.requiredDirections(cuts).length || !mod.needsDirectionSheet(loc, cuts)) return { loc: loc, generated: false, objectName: '' };
    var master = topMasterOf(loc);
    if (!master) throw new Error(mod.text('noObjectName'));
    var key = String(loc.id || loc.name || '').trim().toLowerCase();
    if (directionSheetInFlight[key]) return directionSheetInFlight[key];
    directionSheetInFlight[key] = (async function () {
      var st = ctx.getState();
      if (o.onStatus) o.onStatus('directionSheet');
      var planned = await mod.requestPlan({
        kind: 'direction-sheet',
        header: commonPromptOf(st),
        aspect: (st && st.aspectRatio) || '16:9',
        set: { name: loc.name, description: loc.description, layout: loc.layout },
        resolution: o.resolution || '2K'
      });
      var masterRef = mod.plateReference(loc, 1);
      var out = await mod.generateSheet(st, {
        prompt: planned.prompt,
        aspect: (st && st.aspectRatio) || '16:9',
        generationMode: 'image-to-image',
        cameraTargetMode: 'scene',
        referenceImages: masterRef ? [masterRef] : [],
        resolution: o.resolution || '2K',
        provider: o.provider
      });
      if (!out.objectName) throw new Error(mod.text('noObjectName'));
      var crops = await mod.cropPanels(proxyUrl(out.objectName), { cols: 2, rows: 2 });
      var directions = ['front', 'back', 'left', 'right'];
      loc.variants = Array.isArray(loc.variants) ? loc.variants : [];
      for (var i = 0; i < directions.length; i++) {
        var crop = crops[i];
        if (!crop || !crop.dataUrl) throw new Error('direction sheet crop failed: ' + directions[i]);
        var objectName = await mod.uploadPanel(st.draftId, crop.dataUrl, 'direction-' + directions[i] + '-' + Date.now().toString(36) + '.png');
        if (NK.service.setPlates && NK.service.setPlates.setDirectionPlate) NK.service.setPlates.setDirectionPlate(loc, directions[i], objectName, directions[i]);
        else {
          var id = 'dir-' + directions[i]; var hit = null;
          for (var v = 0; v < loc.variants.length; v++) if (loc.variants[v] && loc.variants[v].id === id) { hit = loc.variants[v]; break; }
          if (!hit) { hit = { id: id, label: directions[i], description: '', refObjectName: '' }; loc.variants.push(hit); }
          hit.refObjectName = objectName;
        }
      }
      loc.directionSheet = { objectName: out.objectName, createdAt: new Date().toISOString(), source: 'angle-top' };
      var locations = mod.locations(st).map(function (entry) {
        var same = String(entry.id || entry.name || '').trim().toLowerCase() === key;
        return same ? loc : entry;
      });
      if (NK.service.setPlates && NK.service.setPlates.persistLocations) NK.service.setPlates.persistLocations(ctx, locations);
      return { loc: loc, generated: true, objectName: out.objectName };
    })();
    try { return await directionSheetInFlight[key]; } finally { delete directionSheetInFlight[key]; }
  };

  /** 시트 목록(payload.storyboardSheets). */
  mod.listSheets = function (st) {
    var list = st && st.payload && Array.isArray(st.payload.storyboardSheets) ? st.payload.storyboardSheets : [];
    return list.slice();
  };

  /** 시트 저장(추가/갱신) → 상태 + 서버. */
  mod.persistSheet = function (ctx, sheet) {
    var st = ctx.getState();
    if (!st) return Promise.resolve(null);
    st.payload = st.payload || {};
    var list = Array.isArray(st.payload.storyboardSheets) ? st.payload.storyboardSheets.slice() : [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === sheet.id) { idx = i; break; }
    if (idx >= 0) list[idx] = sheet; else list.push(sheet);
    st.payload.storyboardSheets = list;
    ctx.setState(st);
    try { if (ctx.persistPipeline) ctx.persistPipeline(); } catch (_) {}
    try {
      var pid = st.draftId;
      if (pid && NK.api && NK.api.projectSave) return NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '' });
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(null);
  };

  /** 시트 stale 판정(순서 변경 뒤): cutIds 가 현재 scenes 에 연속·같은 순서로 없으면 stale. 서버 isSheetStale 과 같은 규칙. */
  mod.isStale = function (sheet, scenes) {
    var list = Array.isArray(scenes) ? scenes : [];
    var ids = list.map(function (s, i) { return String(s && s.id != null && s.id !== '' ? s.id : i + 1); });
    var want = (sheet && Array.isArray(sheet.cutIds) ? sheet.cutIds : []).map(String);
    if (!want.length) return false;
    var start = ids.indexOf(want[0]);
    if (start < 0) return true;
    for (var k = 0; k < want.length; k++) {
      if (ids[start + k] !== want[k]) return true;
      if (k > 0) {
        var prevLoc = String((list[start + k - 1] && (list[start + k - 1].sceneLocation || list[start + k - 1].location)) || '').trim();
        var loc = String((list[start + k] && (list[start + k].sceneLocation || list[start + k].location)) || '').trim();
        if ((list[start + k] && list[start + k].sceneBreak) || (prevLoc && loc && prevLoc !== loc)) return true;
      }
    }
    return false;
  };

  /** 이어지는 시트의 1번 참조: 최신 유효 시트에서 앞 시트의 마지막 콘티 패널을 찾는다. */
  mod.overlapReference = function (st, cutId, referenceId) {
    var sheets = mod.listSheets(st).slice().reverse();
    for (var i = 0; i < sheets.length; i++) {
      var sheet = sheets[i];
      if (!sheet || sheet.kind !== 'board' || mod.isStale(sheet, st && st.scenes)) continue;
      var panels = Array.isArray(sheet.panels) ? sheet.panels : [];
      for (var k = 0; k < panels.length; k++) {
        var panel = panels[k];
        if (panel && panel.role === 'cut' && String(panel.ref) === String(cutId) && String(panel.objectName || '').trim()) {
          return {
            referenceId: referenceId || 1,
            referenceType: 'REFERENCE_TYPE_SUBJECT',
            referenceKind: 'conti-panel',
            imageDataUrl: proxyUrl(panel.objectName),
            subjectDescription: 'previous storyboard sheet final panel — repeat this frame exactly as panel 1',
            subjectType: 'SUBJECT_TYPE_DEFAULT'
          };
        }
      }
    }
    return null;
  };

  /**
   * E4: 승인한 콘티 패널을 1번 참조로 컷의 스틸컷을 만든다(image-to-image, 카메라 재구성 경로 재사용).
   * 참조 2~ = 캐릭터 시트(화면의 캐릭터만), 세트 플레이트(목표 앵글).
   */
  mod.renderStillFromPanel = async function (ctx, sceneIdx, panelObjectName, opts) {
    var st = ctx.getState();
    var scene = st && st.scenes && st.scenes[sceneIdx];
    if (!scene) throw new Error('scene not found');
    var o = opts || {};
    var panelUrl = proxyUrl(panelObjectName);
    var header = commonPromptOf(st);
    var cutText = String(scene.composition || scene.shot || scene.visual || '').trim();
    var prompt = [
      header,
      'Reproduce the first reference image (a storyboard conti panel) at full resolution as a finished frame.',
      'Same composition, same character placement, same camera angle and framing. Do not reframe.',
      'Restore face, costume and body details from the registered character references. Keep the set exactly as in the set plate reference.',
      cutText ? 'Frame content: ' + cutText : '',
      'Do not add text, panel numbers, borders or gutters.'
    ].filter(Boolean).join('\n');
    var refs = [{
      referenceId: 1,
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceKind: 'conti-panel',
      imageDataUrl: panelUrl,
      subjectDescription: 'storyboard conti panel for cut ' + String(scene.id),
      subjectType: 'SUBJECT_TYPE_DEFAULT'
    }];
    (Array.isArray(o.characterReferences) ? o.characterReferences : []).forEach(function (r, i) { refs.push(Object.assign({}, r, { referenceId: i + 2 })); });
    if (o.plateReference) refs.push(Object.assign({}, o.plateReference, { referenceId: refs.length + 1 }));
    var json = await NK.api.imagen({
      prompt: prompt,
      aspectRatio: st.aspectRatio || '16:9',
      projectId: st.draftId || '',
      generationMode: 'image-to-image',
      cameraTargetMode: 'scene',
      imageSize: o.resolution || undefined,
      referenceImages: refs
    });
    var objectName = String((json && json.objectName) || '').trim();
    var imageRef = String((json && (json.signedUrl || json.dataUrl)) || '').trim();
    if (!imageRef) throw new Error('empty image');
    return { objectName: objectName, imageRef: imageRef, prompt: prompt, model: json && json.model };
  };

  /** E4 결과를 컷의 스틸컷으로 쓴다(imageDataUrl/imagePath + lineage.imageContinuity='sheet-panel'). 콘티는 sheet 기록으로만 남는다. */
  mod.applyStillToScene = function (ctx, sceneIdx, result, sheetRef) {
    var st = ctx.getState();
    var scene = st && st.scenes && st.scenes[sceneIdx];
    if (!scene) return Promise.resolve(null);
    var prevImg = String(scene.imageDataUrl || '').trim();
    var hist = Array.isArray(scene.imageHistory) ? scene.imageHistory.slice() : [];
    if (prevImg && prevImg !== result.imageRef) { hist.push(prevImg); if (hist.length > 10) hist = hist.slice(hist.length - 10); }
    var prevLineage = (scene.lineage && typeof scene.lineage === 'object') ? scene.lineage : {};
    st.scenes[sceneIdx] = Object.assign({}, scene, {
      imageDataUrl: result.imageRef,
      imagePath: result.objectName || scene.imagePath || '',
      imageHistory: hist,
      lineage: Object.assign({}, prevLineage, {
        imagePrompt: String(result.prompt || ''),
        imageContinuity: 'sheet-panel',
        sheetPanelRef: sheetRef || null,
        imageAttempts: (Number(prevLineage.imageAttempts) || 0) + 1,
        updatedAt: new Date().toISOString()
      }),
      imgLoading: false,
      imgError: ''
    });
    ctx.setState(st);
    try { if (ctx.persistPipeline) ctx.persistPipeline(); } catch (_) {}
    try { if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render(); } catch (_) {}
    try {
      var pid = st.draftId;
      if (pid && NK.api && NK.api.projectSave) return NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '' });
    } catch (e) { return Promise.reject(e); }
    return Promise.resolve(null);
  };
})();
