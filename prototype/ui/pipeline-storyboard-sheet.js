// 스토리보드 제작 모달 — 씬별 스토리보드 시트(콘티), 패널 승인/부분 수정 → 정식 스틸컷, 바이블 시트.
// 실행은 js/service/storyboard-sheet.js, 프롬프트는 서버 /api/storyboard/sheet-plan. 결과는 payload.storyboardSheets 에 남는다.
// 라벨: 시트 패널 = "콘티", 컷 정식 이미지 = "스틸컷"(설계서 2.0). 문구는 한/영 사전(SB_TEXT)만 쓴다.
; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiStoryboardSheet || (NK.uiStoryboardSheet = {});

  var SB_TEXT = {
    ko: {
      openBtn: '스토리보드 제작',
      openTitle: '부감 마스터와 같은 씬의 컷을 한 장에서 만들고 승인 후 정식 스틸컷을 만들어요',
      title: '스토리보드 제작',
      help: '한 씬씩 콘티를 만들고, 패널 승인 후 정식 스틸컷으로 전환합니다.',
      guideTitle: '사용 순서',
      guideStep1: '만들 항목 선택',
      guideStep2: '대상·해상도 선택',
      guideStep3: '프롬프트 확인',
      guideStep4: '생성 후 패널 승인',
      kind: '만들 항목',
      kindGuide: '필요한 시트 종류를 선택하세요.',
      kindChars: '캐릭터 시트 · 3×3',
      kindSet: '배경 시트 · 2×2',
      kindBoard: '부감 포함 스토리보드 · 씬별 6~8컷',
      kindAngle: '앵글 플레이트',
      kindHelpBoard: '1번 칸의 부감 마스터와 선택한 씬의 실제 컷을 한 장에서 함께 만듭니다.',
      kindHelpCharacters: '등록 캐릭터의 정면·측면 등 일관성 기준 이미지를 만듭니다.',
      kindHelpSet: '배경 세트의 정면·후면·부감·로우 앵글 기준 이미지를 만듭니다.',
      kindHelpAngle: '기존 부감 마스터를 선택한 카메라 방향으로 변형합니다.',
      set: '배경 세트',
      setGuide: '기준으로 사용할 배경을 선택하세요.',
      sheet: '대상 씬',
      sheetGuide: '한 장에 묶을 씬과 컷을 선택하세요. 다른 씬은 섞이지 않습니다.',
      resolution: '해상도',
      resolutionGuide: '요청 해상도입니다. 실제 적용값은 생성 결과에 표시됩니다.',
      angle: '앵글',
      angleGuide: '부감 마스터에서 파생할 카메라 방향을 선택하세요.',
      angleHigh: '하이앵글(부감)',
      angleLow: '로우앵글',
      angleTop: '수직 부감',
      angleBack: '후면(리버스)',
      prompt: '생성 프롬프트',
      promptGuide: '자동으로 조립됩니다. 꼭 필요한 내용만 직접 수정하세요.',
      generate: '현재 시트 생성',
      generateAll: '전체 시트 생성',
      generateGuide: '현재 시트 생성은 선택한 1장만, 전체 시트 생성은 모든 씬을 순서대로 만듭니다.',
      approveAll: '현재 시트 모두 승인',
      approvedBatch: '승인 콘티 일괄 스틸 생성',
      revise: '부분 수정',
      reviseAsk: '이 콘티에서 수정할 내용을 입력해 주세요.',
      batchConfirm: '부감 포함 스토리보드 {count}장을 생성합니다. 이미지 생성은 총 {count}회입니다. 계속할까요?',
      stillBatchConfirm: '승인된 콘티 {count}개로 정식 스틸컷을 생성하고 각 컷에 바로 적용합니다. 이미지 생성 호출도 {count}회 발생합니다. 계속할까요?',
      needOverlap: '이 시트는 이전 시트의 마지막 콘티가 필요해요. 앞 시트를 먼저 생성해 주세요.',
      generating: '생성 중…',
      close: '닫기',
      noSets: '세트(장소)가 없어요. 먼저 "배경 레퍼런스"에서 장소를 추출·생성해 주세요.',
      needPlate: '앵글 변형에 사용할 부감 마스터가 없어요. 먼저 스토리보드나 배경 레퍼런스에서 만들어 주세요.',
      needProject: '프로젝트를 먼저 저장해 주세요.',
      planFailed: '계획을 만들지 못했어요: ',
      genFailed: '생성 실패: ',
      result: '결과',
      panels: '콘티 패널',
      approve: '승인',
      approved: '승인됨',
      reject: '거절',
      toStill: '스틸컷 만들기',
      applyStill: '이 컷의 스틸컷으로 쓰기',
      stillDone: '스틸컷을 컷에 적용했어요.',
      cutLabel: '컷',
      setPanel: '부감 마스터',
      overlapPanel: '겹침',
      emptyPanel: '빈 칸',
      meta: '모델 · 적용 해상도',
      refs: '참조',
      refsChars: '캐릭터',
      refsPlate: '플레이트',
      refsNone: '없음',
      contiBadge: '콘티',
      masterBadge: '부감',
      stillBadge: '스틸컷',
      bibleBadge: '바이블',
      saveNote: '생성 결과는 프로젝트에 자동 저장됩니다.',
      anglePlateDone: '앵글 플레이트를 이 세트의 변형으로 저장했어요.',
      cutsInSheet: '이 시트의 컷'
    },
    en: {
      openBtn: 'Storyboard production',
      openTitle: 'Generate the top-down master and scene cuts together, approve panels, then render final stills',
      title: 'Storyboard production',
      help: 'Build one scene at a time, approve its panels, then promote them to final stills.',
      guideTitle: 'How to use',
      guideStep1: 'Choose an item',
      guideStep2: 'Choose target and size',
      guideStep3: 'Review the prompt',
      guideStep4: 'Generate and approve',
      kind: 'Create',
      kindGuide: 'Choose the type of sheet you need.',
      kindChars: 'Character sheet · 3×3',
      kindSet: 'Set sheet · 2×2',
      kindBoard: 'Storyboard with top-down master · 6–8 cuts per scene',
      kindAngle: 'Angle plate',
      kindHelpBoard: 'Creates the top-down master in Panel 1 and the selected scene cuts in the same grid.',
      kindHelpCharacters: 'Creates consistent front and side reference views for registered characters.',
      kindHelpSet: 'Creates front, rear, high, and low-angle references for the set.',
      kindHelpAngle: 'Derives the selected camera angle from the existing top-down master.',
      set: 'Background set',
      setGuide: 'Choose the background to use as the reference.',
      sheet: 'Target scene',
      sheetGuide: 'Choose the scene and cuts for this sheet. Different scenes are never mixed.',
      resolution: 'Resolution',
      resolutionGuide: 'Requested size. The actual applied size appears with the result.',
      angle: 'Angle',
      angleGuide: 'Choose the camera direction derived from the top-down master.',
      angleHigh: 'High angle',
      angleLow: 'Low angle',
      angleTop: 'Top-down',
      angleBack: 'Reverse',
      prompt: 'Generation prompt',
      promptGuide: 'Built automatically. Edit only what you need to change.',
      generate: 'Generate this sheet',
      generateAll: 'Generate all sheets',
      generateGuide: 'Generate this sheet makes one selected sheet; Generate all sheets processes every scene in order.',
      approveAll: 'Approve current sheet',
      approvedBatch: 'Render approved stills',
      revise: 'Revise panel',
      reviseAsk: 'Describe what to change in this storyboard panel.',
      batchConfirm: 'Generate {count} storyboard sheets with their top-down masters. Total image-generation calls: {count}. Continue?',
      stillBatchConfirm: 'Render and apply {count} final stills from approved panels. This also makes {count} image-generation calls. Continue?',
      needOverlap: 'This sheet needs the previous sheet’s final conti panel. Generate the preceding sheet first.',
      generating: 'Generating…',
      close: 'Close',
      noSets: 'No sets (locations) yet. Extract or create them in "Background references" first.',
      needPlate: 'This set has no top-down master for angle editing. Create one from a storyboard or Background references first.',
      needProject: 'Save the project first.',
      planFailed: 'Could not build the plan: ',
      genFailed: 'Generation failed: ',
      result: 'Result',
      panels: 'Conti panels',
      approve: 'Approve',
      approved: 'Approved',
      reject: 'Reject',
      toStill: 'Make still',
      applyStill: 'Use as this cut’s still',
      stillDone: 'Applied the still to the cut.',
      cutLabel: 'Cut',
      setPanel: 'Top-down master',
      overlapPanel: 'Overlap',
      emptyPanel: 'Empty',
      meta: 'Model · applied size',
      refs: 'References',
      refsChars: 'characters',
      refsPlate: 'plate',
      refsNone: 'none',
      contiBadge: 'Conti',
      masterBadge: 'Top-down',
      stillBadge: 'Still',
      bibleBadge: 'Bible',
      saveNote: 'Generated results are saved with the project automatically.',
      anglePlateDone: 'Saved the angle plate as a variant of this set.',
      cutsInSheet: 'Cuts on this sheet'
    }
  };
  function T() {
    var lang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    return SB_TEXT[lang];
  }
  ui.TEXT = SB_TEXT;
  ui.text = function (key) { return T()[key] || key; };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  ui.open = function (options) {
    options = options || {};
    var auto = options.auto === true;
    var ctx = (NK.uiPipeline && NK.uiPipeline.__ctx) || null;
    var svc = NK.service && NK.service.storyboardSheet;
    if (!ctx || !ctx.getState || !svc) return;
    var st0 = ctx.getState();
    if (!st0) return;

    var existing = document.getElementById('sb-sheet-modal');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.id = 'sb-sheet-modal';
    overlay.className = 'cpbm-overlay';
    if (!auto) document.body.appendChild(overlay);

    // 모달 상태(입력값·결과). 언어를 바꿔도 다시 그릴 때 유지된다.
    var m = {
      kind: 'board', setIdx: 0, sheetIdx: 0, resolution: options.resolution === '4K' ? '4K' : '2K', angle: 'high',
      provider: String(options.provider || '').trim(),
      prompt: '', planned: null, plan: null, busy: false, status: '', error: '',
      batchBusy: false, batchDone: 0, batchTotal: 0,
      stillBatchBusy: false, stillBatchDone: 0, stillBatchTotal: 0,
      result: null,       // { objectName, url, panels:[{index, role, ref, objectName, dataUrl, status}], meta }
      stillBusy: {},      // sceneId → true
      stills: {}          // sceneId → { objectName, imageRef, prompt }
    };

    function notify(status, extra) {
      if (!auto || !window.parent || window.parent === window) return;
      try {
        window.parent.postMessage(Object.assign({
          type: 'nk:storyboard-batch',
          projectId: String(state().draftId || ''),
          runId: String(options.runId || ''),
          status: status,
          done: m.batchDone,
          total: m.batchTotal,
          error: m.error || ''
        }, extra || {}), window.location.origin);
      } catch (_) {}
    }

    var onLangChanged = function () { try { render(); } catch (_) {} };
    var close = function () {
      try { window.removeEventListener('nk:lang-changed', onLangChanged); } catch (_) {}
      try { overlay.remove(); } catch (_) {}
    };
    window.addEventListener('nk:lang-changed', onLangChanged);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    function state() { return ctx.getState() || st0; }
    function sets() { return svc.locations(state()); }
    function currentSet() { var l = sets(); return l[m.setIdx] || l[0] || null; }
    function setByName(name) {
      var key = String(name || '').trim().toLowerCase();
      var list = sets();
      for (var i = 0; i < list.length; i++) if (String(list[i] && list[i].name || '').trim().toLowerCase() === key) return list[i];
      return key ? { id: name, name: name, description: '' } : null;
    }
    function targetSheet() { return (m.plan || [])[m.sheetIdx] || (m.plan || [])[0] || null; }
    function activeSet() { var target = targetSheet(); return m.kind === 'board' && target ? (setByName(target.setName) || { id: '', name: target.setName || 'Unspecified set', description: '' }) : currentSet(); }
    function scenesOfSet(set) {
      var sc = state().scenes || [];
      var name = String((set && set.name) || '').trim().toLowerCase();
      return sc.filter(function (s) { return String((s && s.sceneLocation) || '').trim().toLowerCase() === name; });
    }
    function scenesOfTarget() {
      var target = targetSheet();
      var ids = new Set((target && target.cutIds || []).map(String));
      return (state().scenes || []).filter(function (s, i) { return ids.has(String(s && s.id != null ? s.id : i + 1)); });
    }
    function characterNames() {
      var p = state().payload || {};
      var list = Array.isArray(p.characters) ? p.characters : [];
      return list.map(function (c) { return String((c && (c.name || c.displayName || c.trigger)) || '').replace(/^@/, '').trim(); }).filter(Boolean);
    }
    function characterEntries() {
      var p = state().payload || {};
      var list = Array.isArray(p.characters) ? p.characters : [];
      return list.map(function (c) { return { name: String((c && (c.name || c.displayName || c.trigger)) || '').replace(/^@/, '').trim(), description: String((c && c.description) || '').trim() }; }).filter(function (c) { return c.name; });
    }

    /** 서버에 계획(시트 묶음)과 프롬프트를 요청해 m.prompt 를 채운다. */
    async function plan() {
      m.error = ''; m.planned = null;
      var s = state();
      var set = activeSet();
      try {
        if (m.kind === 'board') {
          var planRes = await svc.requestPlan({ kind: 'plan', scenes: s.scenes || [] });
          m.plan = planRes.sheets || [];
          var target = targetSheet();
          if (!target) { m.error = T().noSets; render(); return; }
          set = setByName(target.setName) || { id: '', name: target.setName || 'Unspecified set', description: '' };
          var masterMode = svc.storyboardMasterMode(set, target);
          var hasTopMaster = masterMode === 'reuse' && !!svc.topMasterOf(set);
          var res = await svc.requestPlan({ kind: 'board', header: svc.commonPromptOf(s), aspect: s.aspectRatio || '16:9', scenes: s.scenes || [], set: { name: set.name, description: set.description, layout: set.layout }, hasTopMaster: hasTopMaster, createTopMaster: masterMode === 'create', previousCutRef: target.previousCutRef || '', cutIds: target.cutIds, characterNames: characterNames(), resolution: m.resolution });
          m.planned = Object.assign({ target: target, masterMode: masterMode }, res);
        } else if (m.kind === 'bible-characters') {
          var resC = await svc.requestPlan({ kind: 'bible-characters', header: svc.commonPromptOf(s), aspect: s.aspectRatio || '16:9', characters: characterEntries(), resolution: m.resolution });
          m.planned = resC;
        } else if (m.kind === 'bible-set') {
          if (!set) { m.error = T().noSets; render(); return; }
          var resS = await svc.requestPlan({ kind: 'bible-set', header: svc.commonPromptOf(s), aspect: s.aspectRatio || '16:9', set: { name: set.name, description: set.description }, resolution: m.resolution });
          m.planned = resS;
        } else if (m.kind === 'angle-plate') {
          if (!set) { m.error = T().noSets; render(); return; }
          var resA = await svc.requestPlan({ kind: 'angle-plate', header: svc.commonPromptOf(s), set: { name: set.name, description: set.description }, angle: m.angle });
          m.planned = resA;
        }
        m.prompt = (m.planned && m.planned.prompt) || '';
      } catch (e) {
        m.error = T().planFailed + ((e && e.message) || e);
      }
      render();
    }

    async function generate() {
      if (m.busy || !m.planned) return;
      var s = state();
      var set = activeSet();
      if (!s.draftId) { m.error = T().needProject; render(); return; }
      m.busy = true; m.error = ''; m.result = null; m.status = svc.text('generating'); render();
      try {
        var refs = [];
        var plateRef = set ? svc.plateReference(set, 1) : null;
        if (m.kind === 'angle-plate') {
          if (!plateRef) throw new Error(T().needPlate);
          // 편집 모드: 마스터 플레이트가 0번 소스, 정면 참조는 섞지 않는다(설계서 5.3).
          refs = [Object.assign({}, plateRef, { referenceId: 1 })];
          var outA = await svc.generateSheet(s, { prompt: m.prompt, aspect: s.aspectRatio || '16:9', generationMode: 'image-to-image', cameraTargetMode: 'scene', referenceImages: refs, resolution: m.resolution, provider: m.provider });
          if (!outA.objectName) throw new Error(svc.text('noObjectName'));
          if (NK.service.setPlates && NK.service.setPlates.setDirectionPlate) {
            // 앵글 변형은 angle-<id> 로 기록(방위 dir-* 와 구분).
            set.variants = Array.isArray(set.variants) ? set.variants : [];
            var vid = 'angle-' + m.angle; var hit = null;
            for (var i = 0; i < set.variants.length; i++) if (set.variants[i] && set.variants[i].id === vid) { hit = set.variants[i]; break; }
            if (!hit) { hit = { id: vid, label: '', description: '', refObjectName: '' }; set.variants.push(hit); }
            hit.label = T()['angle' + m.angle.charAt(0).toUpperCase() + m.angle.slice(1)] || m.angle;
            hit.refObjectName = outA.objectName;
            var locs = svc.locations(s).map(function (l) { return l === set ? set : l; });
            NK.service.setPlates.persistLocations(ctx, locs);
          }
          m.result = { objectName: outA.objectName, url: svc.proxyUrl(outA.objectName), panels: [], meta: outA, note: T().anglePlateDone };
        } else {
          if (m.kind === 'board' && m.planned && m.planned.masterMode === 'reuse' && plateRef) refs.push(Object.assign({}, plateRef, { referenceId: refs.length + 1 }));
          if (m.kind === 'board' && m.planned && m.planned.target && m.planned.target.previousCutRef) {
            var overlapRef = svc.overlapReference(s, m.planned.target.previousCutRef, refs.length + 1);
            if (!overlapRef) throw new Error(T().needOverlap);
            refs.push(overlapRef);
          }
          if (m.kind !== 'board' && m.kind !== 'bible-set' && m.kind !== 'bible-characters' && plateRef) refs.push(plateRef);
          if (m.kind === 'bible-set' && plateRef) refs.push(plateRef);
          if (m.kind !== 'bible-set') {
            var text = m.kind === 'bible-characters' ? characterNames().map(function (n) { return '@' + n; }).join(' ') : (m.kind === 'board' ? scenesOfTarget() : scenesOfSet(set)).map(function (sc) { return [sc.composition, sc.shot, sc.visual, sc.action].filter(Boolean).join(' '); }).join('\n');
            var cr = await svc.characterReferences(s, text, s.draftId);
            (cr.referenceImages || []).forEach(function (r) { refs.push(Object.assign({}, r, { referenceId: refs.length + 1 })); });
          }
          m.refsUsed = { chars: refs.filter(function (r) { return r.referenceKind !== 'environment' && r.referenceKind !== 'conti-panel'; }).length, plate: refs.some(function (r) { return r.referenceKind === 'environment'; }), plateCount: refs.filter(function (r) { return r.referenceKind === 'environment'; }).length, overlap: refs.some(function (r) { return r.referenceKind === 'conti-panel'; }) };
          var out = await svc.generateSheet(s, { prompt: m.prompt, aspect: s.aspectRatio || '16:9', referenceImages: refs, resolution: m.resolution, provider: m.provider });
          if (!out.objectName) throw new Error(svc.text('noObjectName'));
          var url = svc.proxyUrl(out.objectName);
          m.status = svc.text('cropping'); render();
          var grid = (m.planned && m.planned.grid) || { cols: 3, rows: 3 };
          var crops = await svc.cropPanels(url, grid);
          var panelSpecs = (m.planned && m.planned.panels) || crops.map(function (c) { return { index: c.index, role: 'cut', ref: '', label: 'conti' }; });
          var panels = crops.map(function (c) {
            var spec = panelSpecs[c.index - 1] || { role: 'cut', ref: '' };
            return { index: c.index, role: spec.role, ref: spec.ref, dataUrl: c.dataUrl, objectName: '', status: 'pending', label: m.kind === 'board' ? (spec.label || 'conti') : 'bible' };
          }).filter(function (p) { return p.role !== 'empty'; });
          m.status = svc.text('uploading'); render();
          for (var k = 0; k < panels.length; k++) {
            try { panels[k].objectName = await svc.uploadPanel(s.draftId, panels[k].dataUrl, 'sheet-' + out.objectName.split('/').pop().replace(/\.[a-z]+$/i, '') + '-p' + panels[k].index + '.png'); } catch (_) {}
          }
          var sheetId = 'sheet_' + Date.now().toString(36);
          var masterPanel = m.kind === 'board' ? panels.filter(function (p) { return p.role === 'set' && Number(p.index) === 1; })[0] : null;
          if (m.kind === 'board' && (!masterPanel || !masterPanel.objectName)) throw new Error(svc.text('noObjectName'));
          var replacesMaster = m.kind === 'board' && m.planned && m.planned.masterMode === 'create';
          if (replacesMaster) {
            svc.applyStoryboardMaster(set, masterPanel.objectName, { sheetId: sheetId, masterSourceKey: m.planned.target.masterSourceKey });
            s.payload = s.payload || {};
            var knownLocations = Array.isArray(s.payload.episodeLocations) ? s.payload.episodeLocations : [];
            var setKey = String((set && (set.id || set.name)) || '').trim().toLowerCase();
            if (!knownLocations.some(function (loc) { return String((loc && (loc.id || loc.name)) || '').trim().toLowerCase() === setKey; })) knownLocations.push(set);
            s.payload.episodeLocations = knownLocations;
          }
          var sheet = {
            id: sheetId,
            kind: m.kind,
            setId: set ? String(set.id || set.name || '') : '',
            setName: set ? String(set.name || '') : '',
            cutIds: m.kind === 'board' && m.planned.target ? m.planned.target.cutIds.slice() : [],
            sceneNo: m.kind === 'board' && m.planned.target ? Number(m.planned.target.sceneNo) || 0 : 0,
            sceneKey: m.kind === 'board' && m.planned.target ? String(m.planned.target.sceneKey || '') : '',
            anchor: m.kind === 'board' && m.planned.target ? m.planned.target.anchor : null,
            previousCutRef: m.kind === 'board' && m.planned.target ? String(m.planned.target.previousCutRef || '') : '',
            masterSourceKey: m.kind === 'board' && m.planned.target ? String(m.planned.target.masterSourceKey || '') : '',
            masterMode: m.kind === 'board' && m.planned ? String(m.planned.masterMode || '') : '',
            masterObjectName: m.kind === 'board' ? (replacesMaster ? masterPanel.objectName : svc.topMasterOf(set)) : '',
            masterReplaced: !!replacesMaster,
            status: 'fresh',
            resolution: m.resolution,
            grid: grid,
            objectName: out.objectName,
            panels: panels.map(function (p) { return { index: p.index, role: p.role, ref: p.ref, objectName: p.objectName, status: p.status, label: p.label }; }),
            prompt: m.prompt,
            referenceMeta: m.refsUsed,
            model: out.model || '',
            imageSizeApplied: out.imageSizeApplied || '',
            createdAt: new Date().toISOString()
          };
          await svc.persistSheet(ctx, sheet);
          m.result = { sheetId: sheet.id, objectName: out.objectName, url: url, panels: panels, meta: out };
        }
        return true;
      } catch (e) {
        m.error = T().genFailed + ((e && e.message) || e);
        return false;
      } finally {
        m.busy = false; m.status = '';
        render();
      }
    }

    async function generateAll(skipConfirm) {
      if (m.batchBusy || m.busy || m.kind !== 'board') return;
      if (!m.plan || !m.plan.length) await plan();
      var total = (m.plan || []).length;
      if (!total) { m.error = m.error || T().noSets; notify('failed'); return; }
      var confirmText = T().batchConfirm.replace(/\{count\}/g, String(total));
      if (!skipConfirm && !(await NK.ui.dialog.confirm(confirmText, { title: T().generateAll }))) return;
      m.batchBusy = true; m.batchDone = 0; m.batchTotal = total; m.error = ''; render();
      notify('running');
      try {
        for (var i = 0; i < total; i++) {
          m.sheetIdx = i; m.planned = null; m.prompt = '';
          await plan();
          if (!m.planned || !(await generate())) break;
          m.batchDone = i + 1; render(); notify('running');
        }
      } finally {
        m.batchBusy = false; render();
        if (auto) notify(m.batchDone === total ? 'completed' : 'failed', { error: m.error || (m.batchDone + '/' + total + ' sheets completed') });
      }
    }

    function updatePanelStatus(sheetId, index, status) {
      var s = state();
      var list = svc.listSheets(s);
      var sheet = null;
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === sheetId) { sheet = list[i]; break; }
      if (!sheet) return;
      sheet.panels = (sheet.panels || []).map(function (p) { return p.index === index ? Object.assign({}, p, { status: status }) : p; });
      svc.persistSheet(ctx, sheet).catch(function (e) { m.error = T().genFailed + ((e && e.message) || e); render(); });
      if (m.result && m.result.sheetId === sheetId) m.result.panels.forEach(function (p) { if (p.index === index) p.status = status; });
      render();
    }

    async function approveCurrentSheet() {
      if (!m.result || !m.result.sheetId) return;
      var list = svc.listSheets(state());
      var sheet = list.filter(function (x) { return x && x.id === m.result.sheetId; })[0];
      if (!sheet) return;
      sheet.panels = (sheet.panels || []).map(function (p) { return p.role === 'cut' || p.role === 'set' ? Object.assign({}, p, { status: 'approved' }) : p; });
      m.result.panels.forEach(function (p) { if (p.role === 'cut' || p.role === 'set') p.status = 'approved'; });
      await svc.persistSheet(ctx, sheet);
      render();
    }

    async function revisePanel(sheetId, panel) {
      if (!panel || !panel.objectName || m.busy) return;
      var instruction = await NK.ui.dialog.prompt(T().reviseAsk, { title: T().revise, defaultValue: '' });
      if (!String(instruction || '').trim()) return;
      var s = state();
      var sceneIdx = (s.scenes || []).findIndex(function (sc) { return String(sc && sc.id) === String(panel.ref); });
      if (sceneIdx < 0) return;
      var scene = s.scenes[sceneIdx];
      var list = svc.listSheets(s); var sheet = list.filter(function (x) { return x && x.id === sheetId; })[0];
      if (!sheet) return;
      var set = setByName(sheet.setName);
      m.busy = true; m.status = T().revise; m.error = ''; render();
      try {
        var refs = [{ referenceId: 1, referenceType: 'REFERENCE_TYPE_SUBJECT', referenceKind: 'conti-panel', imageDataUrl: svc.proxyUrl(panel.objectName), subjectDescription: 'current storyboard panel to revise', subjectType: 'SUBJECT_TYPE_DEFAULT' }];
        var cr = await svc.characterReferences(s, [scene.composition, scene.shot, scene.visual, scene.action].filter(Boolean).join(' '), s.draftId);
        (cr.referenceImages || []).forEach(function (r) { refs.push(Object.assign({}, r, { referenceId: refs.length + 1 })); });
        var plate = set ? svc.plateReferenceForScene(set, scene, refs.length + 1) : null; if (plate) refs.push(plate);
        var prompt = ['Revise only this storyboard panel according to the correction below.', 'Preserve the same character identities, set, art style and all details not mentioned.', 'Keep it as one clean 16:9 storyboard frame with no text, number, border or gutter.', 'Correction: ' + String(instruction).trim()].join('\n');
        var out = await svc.generateSheet(s, { prompt: prompt, aspect: s.aspectRatio || '16:9', generationMode: 'image-to-image', cameraTargetMode: 'scene', referenceImages: refs, resolution: m.resolution, provider: m.provider });
        if (!out.objectName) throw new Error(svc.text('noObjectName'));
        sheet.panels = (sheet.panels || []).map(function (p) { return Number(p.index) === Number(panel.index) ? Object.assign({}, p, { objectName: out.objectName, status: 'pending', revisedAt: new Date().toISOString(), revisionPrompt: String(instruction).trim() }) : p; });
        await svc.persistSheet(ctx, sheet);
        var hit = (m.result && m.result.sheetId === sheetId) ? m.result.panels.filter(function (p) { return Number(p.index) === Number(panel.index); })[0] : null;
        if (hit) { hit.objectName = out.objectName; hit.dataUrl = ''; hit.status = 'pending'; }
      } catch (e) { m.error = T().genFailed + ((e && e.message) || e); }
      finally { m.busy = false; m.status = ''; render(); }
    }

    async function renderApprovedStills() {
      if (m.stillBatchBusy) return;
      var s = state();
      var seen = new Set(); var targets = [];
      svc.listSheets(s).slice().reverse().forEach(function (sheet) {
        if (!sheet || sheet.kind !== 'board' || svc.isStale(sheet, s.scenes)) return;
        (sheet.panels || []).forEach(function (panel) {
          var id = String(panel && panel.ref || '');
          if (!id || seen.has(id) || panel.role !== 'cut' || panel.status !== 'approved' || !panel.objectName) return;
          seen.add(id); targets.push({ sheet: sheet, panel: panel });
        });
      });
      if (!targets.length) return;
      if (!(await NK.ui.dialog.confirm(T().stillBatchConfirm.replace(/\{count\}/g, String(targets.length)), { title: T().approvedBatch }))) return;
      m.stillBatchBusy = true; m.stillBatchDone = 0; m.stillBatchTotal = targets.length; m.error = ''; render();
      try {
        for (var i = 0; i < targets.length; i++) {
          var target = targets[i]; var panel = target.panel;
          var sceneIdx = (s.scenes || []).findIndex(function (sc) { return String(sc && sc.id) === String(panel.ref); });
          if (sceneIdx < 0) continue;
          var scene = s.scenes[sceneIdx]; var set = setByName(target.sheet.setName);
          var cr = await svc.characterReferences(s, [scene.composition, scene.shot, scene.visual, scene.action].filter(Boolean).join(' '), s.draftId);
          var res = await svc.renderStillFromPanel(ctx, sceneIdx, panel.objectName, { characterReferences: cr.referenceImages || [], plateReference: set ? svc.plateReferenceForScene(set, scene) : null, resolution: m.resolution === '4K' ? '2K' : m.resolution });
          m.stills[String(panel.ref)] = Object.assign({ sheetId: target.sheet.id, panelIndex: panel.index, sceneIdx: sceneIdx }, res);
          await svc.applyStillToScene(ctx, sceneIdx, res, { sheetId: target.sheet.id, panelIndex: panel.index });
          s = state(); m.stillBatchDone = i + 1; render();
        }
      } catch (e) { m.error = T().genFailed + ((e && e.message) || e); }
      finally { m.stillBatchBusy = false; render(); }
    }

    async function makeStill(sheetId, panel) {
      var s = state();
      var sceneIdx = -1;
      for (var i = 0; i < (s.scenes || []).length; i++) if (String(s.scenes[i].id) === String(panel.ref)) { sceneIdx = i; break; }
      if (sceneIdx < 0 || !panel.objectName) return;
      var sid = String(panel.ref);
      m.stillBusy[sid] = true; render();
      try {
        var set = activeSet();
        var scene = s.scenes[sceneIdx];
        var cr = await svc.characterReferences(s, [scene.composition, scene.shot, scene.visual].filter(Boolean).join(' '), s.draftId);
        var res = await svc.renderStillFromPanel(ctx, sceneIdx, panel.objectName, { characterReferences: cr.referenceImages || [], plateReference: set ? svc.plateReferenceForScene(set, scene) : null, resolution: m.resolution === '4K' ? '2K' : m.resolution });
        m.stills[sid] = Object.assign({ sheetId: sheetId, panelIndex: panel.index, sceneIdx: sceneIdx }, res);
      } catch (e) {
        m.error = T().genFailed + ((e && e.message) || e);
      } finally {
        delete m.stillBusy[sid];
        render();
      }
    }

    async function applyStill(sid) {
      var r = m.stills[sid];
      if (!r) return;
      await svc.applyStillToScene(ctx, r.sceneIdx, r, { sheetId: r.sheetId, panelIndex: r.panelIndex });
      m.notice = T().stillDone;
      render();
    }

    function badge(kind) {
      var label = kind === 'still' ? T().stillBadge : kind === 'bible' ? T().bibleBadge : kind === 'master' ? T().masterBadge : T().contiBadge;
      var color = kind === 'still' ? '#10b981' : kind === 'bible' ? '#a78bfa' : kind === 'master' ? '#38bdf8' : '#f59e0b';
      return '<span style="position:absolute;left:4px;top:4px;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:800;color:#111;background:' + color + ';">' + esc(label) + '</span>';
    }

    function render() {
      if (auto) return;
      var s = state();
      var setList = sets();
      var set = activeSet();
      var scenesHere = set ? scenesOfSet(set) : [];
      var setOptions = setList.map(function (l, i) { return '<option value="' + i + '"' + (i === m.setIdx ? ' selected' : '') + '>' + esc(l.name || ('#' + (i + 1))) + (l.refObjectName ? '' : ' (—)') + '</option>'; }).join('');
      var sheetOptions = (m.plan || []).map(function (x, i) { return '<option value="' + i + '"' + (i === m.sheetIdx ? ' selected' : '') + '>' + esc('Scene ' + (x.sceneNo || '?') + ' · ' + (x.setName || '—') + ' · ' + T().cutLabel + ' ' + x.cutIds.join(', ')) + '</option>'; }).join('');
      var kindOptions = [['board', T().kindBoard], ['bible-characters', T().kindChars], ['bible-set', T().kindSet], ['angle-plate', T().kindAngle]].map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === m.kind ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
      var angleOptions = [['high', T().angleHigh], ['low', T().angleLow], ['top', T().angleTop], ['back', T().angleBack]].map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === m.angle ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('');
      var kindHelp = m.kind === 'board' ? T().kindHelpBoard : m.kind === 'bible-characters' ? T().kindHelpCharacters : m.kind === 'bible-set' ? T().kindHelpSet : T().kindHelpAngle;

      var resultHtml = '';
      if (m.result) {
        var r = m.result;
        var panelsHtml = (r.panels || []).map(function (p) {
          var sid = String(p.ref);
          var isCut = p.role === 'cut';
          var title = p.role === 'set' ? T().setPanel : p.role === 'overlap' ? T().overlapPanel : (T().cutLabel + ' ' + p.ref);
          var still = m.stills[sid];
          return '<div style="width:calc(33.33% - 6px);position:relative;border:1px solid ' + (p.status === 'approved' ? '#10b981' : p.status === 'rejected' ? '#ef4444' : 'var(--line, #333)') + ';border-radius:8px;overflow:hidden;">' +
            '<div style="position:relative;"><img src="' + esc(p.dataUrl || svc.proxyUrl(p.objectName)) + '" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover;">' + badge(p.label === 'bible' ? 'bible' : p.label === 'master' ? 'master' : 'conti') + '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;font-size:11px;">' +
              '<span style="flex:1;font-weight:700;">' + esc('#' + p.index + ' ' + title) + '</span>' +
              (isCut ? '<button type="button" class="btn-secondary compact sb-approve" data-i="' + p.index + '" data-s="' + (p.status === 'approved' ? 'pending' : 'approved') + '" style="min-width:56px;">' + esc(p.status === 'approved' ? T().approved : T().approve) + '</button>' +
                        '<button type="button" class="btn-ghost compact sb-reject" data-i="' + p.index + '" style="min-width:44px;">' + esc(T().reject) + '</button>' +
                        '<button type="button" class="btn-ghost compact sb-revise" data-i="' + p.index + '" style="min-width:54px;">' + esc(T().revise) + '</button>' : '') +
            '</div>' +
            (isCut && p.status === 'approved' ? '<div style="padding:0 6px 6px;"><button type="button" class="btn-primary compact sb-still" data-i="' + p.index + '" ' + (m.stillBusy[sid] ? 'disabled' : '') + ' style="width:100%;min-width:120px;">' + esc(m.stillBusy[sid] ? T().generating : T().toStill) + '</button></div>' : '') +
            (still ? '<div style="position:relative;border-top:1px solid var(--line,#333);"><img src="' + esc(still.imageRef) + '" style="width:100%;display:block;aspect-ratio:16/9;object-fit:cover;">' + badge('still') +
                      '<div style="padding:4px 6px;"><button type="button" class="btn-secondary compact sb-apply" data-sid="' + esc(sid) + '" style="width:100%;min-width:120px;">' + esc(T().applyStill) + '</button></div></div>' : '') +
          '</div>';
        }).join('');
        resultHtml =
          '<div style="margin-top:10px;font-size:12px;font-weight:800;">' + esc(T().result) + '</div>' +
          (r.note ? '<p class="muted" style="font-size:11px;margin:2px 0 6px;">' + esc(r.note) + '</p>' : '') +
          '<div style="position:relative;"><img src="' + esc(r.url) + '" style="width:100%;display:block;border-radius:8px;border:1px solid var(--line,#333);">' + (m.kind === 'angle-plate' ? '' : badge(m.kind === 'board' ? 'conti' : 'bible')) + '</div>' +
          '<p class="muted" style="font-size:11px;margin:4px 0;">' + esc(T().meta + ': ' + ((r.meta && r.meta.model) || '?') + ' · ' + ((r.meta && r.meta.imageSizeApplied) || m.resolution)) +
            (m.refsUsed ? esc(' · ' + T().refs + ': ' + T().refsChars + ' ' + m.refsUsed.chars + ', ' + T().refsPlate + ' ' + (m.refsUsed.plate ? 'O' : 'X')) : '') + '</p>' +
          (panelsHtml ? '<div style="font-size:12px;font-weight:800;margin:8px 0 4px;">' + esc(T().panels) + '</div><div style="display:flex;flex-wrap:wrap;gap:6px;">' + panelsHtml + '</div>' : '');
      }

      overlay.innerHTML =
        '<div class="cpbm-box sb-modal" style="max-width:960px;width:94vw;max-height:90vh;display:flex;flex-direction:column;">' +
          '<h3 class="cpbm-title">' + esc(T().title) + '</h3>' +
          '<p class="cpbm-help">' + esc(T().help) + '</p>' +
          '<div class="sb-guide"><strong>' + esc(T().guideTitle) + '</strong><span><b>1</b>' + esc(T().guideStep1) + '</span><span><b>2</b>' + esc(T().guideStep2) + '</span><span><b>3</b>' + esc(T().guideStep3) + '</span><span><b>4</b>' + esc(T().guideStep4) + '</span></div>' +
          '<div class="sb-toolbar">' +
            '<label class="sb-field sb-field-kind"><span class="sb-field-label">' + esc(T().kind) + '</span><select id="sb-kind">' + kindOptions + '</select><small>' + esc(T().kindGuide + ' ' + kindHelp) + '</small></label>' +
            (m.kind === 'board' ? '' : '<label class="sb-field"><span class="sb-field-label">' + esc(T().set) + '</span><select id="sb-set">' + (setOptions || '<option value="0">—</option>') + '</select><small>' + esc(T().setGuide) + '</small></label>') +
            (m.kind === 'board' ? '<label class="sb-field sb-field-target"><span class="sb-field-label">' + esc(T().sheet) + '</span><select id="sb-sheet">' + (sheetOptions || '<option value="0">—</option>') + '</select><small>' + esc(T().sheetGuide) + '</small></label>' : '') +
            (m.kind === 'angle-plate' ? '<label class="sb-field"><span class="sb-field-label">' + esc(T().angle) + '</span><select id="sb-angle">' + angleOptions + '</select><small>' + esc(T().angleGuide) + '</small></label>' : '') +
            '<label class="sb-field sb-field-resolution"><span class="sb-field-label">' + esc(T().resolution) + '</span><select id="sb-res"><option value="2K"' + (m.resolution === '2K' ? ' selected' : '') + '>2K</option><option value="4K"' + (m.resolution === '4K' ? ' selected' : '') + '>4K</option></select><small>' + esc(T().resolutionGuide) + '</small></label>' +
          '</div>' +
          (m.kind === 'board' && set ? '<p class="sb-cut-summary">' + esc(T().cutsInSheet + ': ' + ((m.planned && m.planned.target) ? m.planned.target.cutIds.join(', ') : scenesHere.map(function (x) { return x.id; }).join(', '))) + '</p>' : '') +
          '<label class="sb-field sb-prompt-field"><span class="sb-field-label">' + esc(T().prompt) + '</span><textarea id="sb-prompt" rows="6">' + esc(m.prompt) + '</textarea><small>' + esc(T().promptGuide) + '</small></label>' +
          '<div class="sb-generate-row"><div class="sb-generate-help">' + esc(T().generateGuide) + '</div><button type="button" class="btn-primary" id="sb-generate" ' + (m.busy || !m.prompt ? 'disabled' : '') + '>' + esc(m.busy ? (m.status || T().generating) : T().generate) + '</button>' +
            (m.kind === 'board' ? '<button type="button" class="btn-secondary" id="sb-generate-all" ' + (m.busy || m.batchBusy || !(m.plan || []).length ? 'disabled' : '') + '>' + esc(m.batchBusy ? (T().generating + ' ' + m.batchDone + '/' + m.batchTotal) : T().generateAll) + '</button>' : '') + '</div>' +
          (m.error ? '<p style="color:#ef4444;font-size:12px;margin:6px 0 0;">' + esc(m.error) + '</p>' : '') +
          (m.notice ? '<p style="color:#10b981;font-size:12px;margin:6px 0 0;">' + esc(m.notice) + '</p>' : '') +
          '<div style="overflow-y:auto;flex:1;min-height:80px;">' +
            resultHtml +
            (m.result && m.kind === 'board' ? '<div style="display:flex;gap:8px;margin-top:8px;"><button type="button" class="btn-secondary" id="sb-approve-all">' + esc(T().approveAll) + '</button><button type="button" class="btn-primary" id="sb-still-batch" ' + (m.stillBatchBusy ? 'disabled' : '') + '>' + esc(m.stillBatchBusy ? (T().generating + ' ' + m.stillBatchDone + '/' + m.stillBatchTotal) : T().approvedBatch) + '</button></div>' : '') +
          '</div>' +
          '<p class="muted" style="font-size:11px;margin:6px 0 0;">' + esc(T().saveNote) + '</p>' +
          '<div class="cpbm-actions"><button type="button" class="btn-ghost" id="sb-close">' + esc(T().close) + '</button></div>' +
        '</div>';
      bind();
    }

    function bind() {
      var q = function (sel) { return overlay.querySelector(sel); };
      var kindEl = q('#sb-kind'); if (kindEl) kindEl.onchange = function () { m.kind = kindEl.value; m.sheetIdx = 0; m.result = null; m.prompt = ''; plan(); };
      var setEl = q('#sb-set'); if (setEl) setEl.onchange = function () { m.setIdx = Number(setEl.value) || 0; m.sheetIdx = 0; m.result = null; m.prompt = ''; plan(); };
      var sheetEl = q('#sb-sheet'); if (sheetEl) sheetEl.onchange = function () { m.sheetIdx = Number(sheetEl.value) || 0; m.result = null; m.prompt = ''; plan(); };
      var angleEl = q('#sb-angle'); if (angleEl) angleEl.onchange = function () { m.angle = angleEl.value; m.prompt = ''; plan(); };
      var resEl = q('#sb-res'); if (resEl) resEl.onchange = function () { m.resolution = resEl.value; };
      var promptEl = q('#sb-prompt'); if (promptEl) promptEl.oninput = function () { m.prompt = promptEl.value; var g = q('#sb-generate'); if (g) g.disabled = m.busy || !m.prompt; };
      var gen = q('#sb-generate'); if (gen) gen.onclick = function () { generate(); };
      var genAll = q('#sb-generate-all'); if (genAll) genAll.onclick = function () { generateAll(); };
      var approveAll = q('#sb-approve-all'); if (approveAll) approveAll.onclick = function () { approveCurrentSheet(); };
      var stillBatch = q('#sb-still-batch'); if (stillBatch) stillBatch.onclick = function () { renderApprovedStills(); };
      var closeBtn = q('#sb-close'); if (closeBtn) closeBtn.onclick = close;
      overlay.querySelectorAll('.sb-approve').forEach(function (b) { b.onclick = function () { updatePanelStatus(m.result.sheetId, Number(b.getAttribute('data-i')), b.getAttribute('data-s')); }; });
      overlay.querySelectorAll('.sb-reject').forEach(function (b) { b.onclick = function () { updatePanelStatus(m.result.sheetId, Number(b.getAttribute('data-i')), 'rejected'); }; });
      overlay.querySelectorAll('.sb-revise').forEach(function (b) { b.onclick = function () { var idx = Number(b.getAttribute('data-i')); var p = (m.result.panels || []).filter(function (x) { return x.index === idx; })[0]; if (p) revisePanel(m.result.sheetId, p); }; });
      overlay.querySelectorAll('.sb-still').forEach(function (b) { b.onclick = function () { var idx = Number(b.getAttribute('data-i')); var p = (m.result.panels || []).filter(function (x) { return x.index === idx; })[0]; if (p) makeStill(m.result.sheetId, p); }; });
      overlay.querySelectorAll('.sb-apply').forEach(function (b) { b.onclick = function () { void applyStill(b.getAttribute('data-sid')); }; });
    }

    if (auto) {
      notify('starting');
      plan().then(function () { return generateAll(true); }).catch(function (e) {
        m.error = String((e && e.message) || e || T().genFailed);
        notify('failed');
      });
    } else {
      render();
      plan();
    }
  };
})();
