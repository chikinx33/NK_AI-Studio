/**
 * set-plates.js — 세트(장소) 배경 플레이트를 "파이프라인 필수 단계"로 만드는 서비스.
 *
 * 왜 있는가: 지금까지 배경 플레이트(장소의 빈 배경 + 4방위 플레이트)는 사용자가 별도 모달에서
 * 추출 → 플레이트 생성 → 방위 생성을 손으로 눌러야만 존재했다. 플레이트가 없는 컷은
 * 텍스트만으로 컷마다 공간을 새로 지어 배경이 컷마다 달라졌다.
 *
 * 원칙: "세트를 먼저 짓고, 컷은 그 세트 위에서 카메라만 옮긴다."
 *  - 컷 이미지를 만들기 전에 그 컷의 장소 플레이트가 반드시 준비돼 있어야 한다.
 *  - 장소 목록이 없으면 씬에서 자동 추출한다(LLM → 규칙 폴백).
 *  - 마스터(정면) 플레이트가 없으면 만든다.
 *  - 컷들이 실제로 쓰는 방위(back/left/right)의 플레이트만 만든다(안 쓰는 방위는 만들지 않는다).
 *  - 플레이트가 하나 만들어질 때마다 payload 에 바로 저장한다(중간 실패해도 진행분은 남는다).
 *
 * 프롬프트는 이 파일이 단일 원천이다. 배경 레퍼런스 모달(ui/pipeline.js)도 여기 것을 쓴다.
 * 순수 로직(장소 찾기·필요 방위 계산·프롬프트)은 window 에 의존하지 않아 테스트에서 vm 으로 돌린다.
 */
; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var mod = service.setPlates || (service.setPlates = {});

  var DIRECTIONS = ['back', 'left', 'right'];

  // 방위 플레이트 사양 — id 규약(dir-back 등)은 stage-geometry.directionVariantId 와 같다.
  mod.DIRECTION_PLATE_SPECS = [
    {
      dir: 'back',
      labelKey: 'dirBack',
      instruction: 'REVERSE ANGLE of the exact same place: the camera has turned around 180 degrees and now shows the side that was BEHIND the camera in the reference image. Invent that opposite side so it believably belongs to the same room — same architecture language, materials, palette and lighting. Do NOT reproduce the reference framing or the wall it shows.'
    },
    {
      dir: 'left',
      labelKey: 'dirLeft',
      instruction: 'The camera has turned 90 degrees to the LEFT inside the exact same place, now showing its left side. Invent that side so it believably belongs to the same room — same architecture language, materials, palette and lighting. Do NOT reproduce the reference framing.'
    },
    {
      dir: 'right',
      labelKey: 'dirRight',
      instruction: 'The camera has turned 90 degrees to the RIGHT inside the exact same place, now showing its right side. Invent that side so it believably belongs to the same room — same architecture language, materials, palette and lighting. Do NOT reproduce the reference framing.'
    }
  ];

  // 한/영 문구. 컷 행의 진행 표시와 모달 라벨이 같은 사전을 쓴다.
  var TEXT = {
    ko: {
      preparingSet: '세트 준비 중',
      extractingLocations: '장소 추출 중',
      generatingMaster: '배경 플레이트 생성 중',
      generatingDirection: '방위 플레이트 생성 중',
      plateFailed: '세트 플레이트를 만들지 못해 컷 이미지를 생성하지 않았습니다',
      dirBack: '후면(리버스)',
      dirLeft: '좌측',
      dirRight: '우측'
    },
    en: {
      preparingSet: 'Preparing the set',
      extractingLocations: 'Extracting locations',
      generatingMaster: 'Generating background plate',
      generatingDirection: 'Generating direction plate',
      plateFailed: 'The set plate could not be created, so the cut image was not generated',
      dirBack: 'Back (reverse)',
      dirLeft: 'Left side',
      dirRight: 'Right side'
    }
  };

  function currentLang() {
    return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko';
  }
  mod.text = function (key, lang) {
    var l = lang || currentLang();
    return (TEXT[l] && TEXT[l][key]) || TEXT.ko[key] || key;
  };
  mod.TEXT = TEXT;

  function normKey(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function slugify(s) {
    var base = String(s || '').toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣\-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return base || 'loc';
  }

  // ── 순수 로직 ─────────────────────────────────────────────────────────

  /**
   * 씬(컷)이 속한 장소. ① 추출 때 배정된 sceneIds ② 장소 이름 완전 일치 ③ 씬 텍스트에 이름 포함.
   * pipeline-image 의 matchEpisodeLocation 과 달리 플레이트가 아직 없는 장소도 찾는다(만들려고 찾는 것이므로).
   */
  mod.findLocationForScene = function (locations, scene) {
    var locs = Array.isArray(locations) ? locations.filter(Boolean) : [];
    if (!locs.length || !scene) return null;
    var sid = scene.id != null ? String(scene.id) : '';
    if (sid) {
      for (var i = 0; i < locs.length; i++) {
        var ids = Array.isArray(locs[i].sceneIds) ? locs[i].sceneIds : [];
        for (var j = 0; j < ids.length; j++) if (String(ids[j]) === sid) return locs[i];
      }
    }
    var locStr = normKey(scene.sceneLocation || scene.location || '');
    if (locStr) {
      for (var k = 0; k < locs.length; k++) if (normKey(locs[k].name) === locStr) return locs[k];
    }
    var hay = [scene.sceneLocation, scene.location, scene.composition, scene.shot, scene.visual]
      .map(function (v) { return String(v || ''); }).join('\n').toLowerCase();
    if (!hay.trim()) return null;
    for (var m = 0; m < locs.length; m++) {
      var name = normKey(locs[m].name);
      if (!name || name.length < 2) continue;
      var compact = name.replace(/\s+/g, '');
      if (hay.indexOf(name) >= 0 || (compact.length >= 2 && hay.indexOf(compact) >= 0)) return locs[m];
    }
    return null;
  };

  function dirOf(row) {
    var d = String((row && row.cameraDirection) || 'front').trim().toLowerCase();
    return DIRECTIONS.indexOf(d) >= 0 ? d : '';
  }

  /** 씬 한 개(및 그 샷들)가 필요로 하는 비정면 방위 목록. */
  mod.directionsOfScene = function (scene) {
    var out = {};
    var d = dirOf(scene);
    if (d) out[d] = 1;
    (Array.isArray(scene && scene.shots) ? scene.shots : []).forEach(function (sh) {
      var sd = dirOf(sh);
      if (sd) out[sd] = 1;
    });
    return Object.keys(out);
  };

  /** 장소 하나를 쓰는 모든 씬이 필요로 하는 비정면 방위 목록. */
  mod.neededDirections = function (locations, loc, scenes) {
    var out = {};
    (Array.isArray(scenes) ? scenes : []).forEach(function (sc) {
      var hit = mod.findLocationForScene(locations, sc);
      if (!hit || hit !== loc) return;
      mod.directionsOfScene(sc).forEach(function (d) { out[d] = 1; });
    });
    return Object.keys(out);
  };

  mod.hasMasterPlate = function (loc) {
    return !!(loc && String(loc.refObjectName || '').trim());
  };
  mod.hasDirectionPlate = function (loc, dir) {
    var want = 'dir-' + String(dir || '').toLowerCase();
    var vs = Array.isArray(loc && loc.variants) ? loc.variants : [];
    for (var i = 0; i < vs.length; i++) {
      if (vs[i] && String(vs[i].id || '') === want && String(vs[i].refObjectName || '').trim()) return true;
    }
    return false;
  };

  /** 장소에 빠진 플레이트 목록: ['master', 'back', ...] */
  mod.missingPlates = function (loc, directions) {
    var out = [];
    if (!mod.hasMasterPlate(loc)) out.push('master');
    (Array.isArray(directions) ? directions : []).forEach(function (d) {
      if (DIRECTIONS.indexOf(d) >= 0 && !mod.hasDirectionPlate(loc, d)) out.push(d);
    });
    return out;
  };

  mod.buildMasterPlatePrompt = function (common, loc) {
    return [
      String(common || '').trim(),
      String((loc && (loc.description || loc.name)) || '').trim(),
      'Empty location background plate of this place. Wide establishing view of the environment ONLY — no characters, no people, no creatures, nothing held by anyone. Clean background for compositing.',
      'IMPORTANT: Render this in the EXACT SAME art style, medium, and visual look defined by the style/mood/background lines above. Do not invent or change the art style — match the rest of this episode.'
    ].filter(Boolean).join('\n');
  };

  mod.buildDirectionPlatePrompt = function (common, loc, spec) {
    var placeName = String((loc && loc.name) || 'this place').trim();
    return [
      String(common || '').trim(),
      'SUBJECT: the ' + spec.dir + '-facing view of ' + placeName + '.',
      spec.instruction,
      'CONTEXT (materials, palette and lighting only): ' + String((loc && loc.description) || placeName).trim(),
      'Empty environment ONLY: no characters, no people, no creatures. Clean background plate for compositing.',
      'IMPORTANT: Render this in the EXACT SAME art style, medium, and visual look defined by the style/mood lines above and the reference image. Do not invent or change the art style.'
    ].filter(Boolean).join('\n');
  };

  mod.specFor = function (dir) {
    for (var i = 0; i < mod.DIRECTION_PLATE_SPECS.length; i++) {
      if (mod.DIRECTION_PLATE_SPECS[i].dir === dir) return mod.DIRECTION_PLATE_SPECS[i];
    }
    return null;
  };

  /** 방위 플레이트 결과를 variants 에 기록(있으면 갱신, 없으면 추가). loc 을 그대로 돌려준다. */
  mod.setDirectionPlate = function (loc, dir, objectName, label) {
    var wantId = 'dir-' + dir;
    loc.variants = Array.isArray(loc.variants) ? loc.variants : [];
    var hit = null;
    for (var i = 0; i < loc.variants.length; i++) {
      if (loc.variants[i] && String(loc.variants[i].id || '') === wantId) { hit = loc.variants[i]; break; }
    }
    if (!hit) { hit = { id: wantId, label: '', description: '', refObjectName: '' }; loc.variants.push(hit); }
    hit.label = label || hit.label || dir;
    hit.refObjectName = objectName;
    return loc;
  };

  // ── 실행(브라우저 의존) ──────────────────────────────────────────────

  function commonPromptOf(st) {
    var h = String((st && st.header) || '').trim();
    if (h) return h;
    try {
      if (NK.service && NK.service.project && NK.service.project.buildVisualHeader) {
        return String(NK.service.project.buildVisualHeader(st && st.payload) || '').trim();
      }
    } catch (_) {}
    return '';
  }

  function proxyUrl(objectName) {
    return (objectName && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(objectName) : '';
  }

  function cleanLocationsForSave(locs) {
    return (Array.isArray(locs) ? locs : [])
      .filter(function (l) { return l && (String(l.name || '').trim() || String(l.description || '').trim()); })
      .map(function (l) {
        var variants = (Array.isArray(l.variants) ? l.variants : [])
          .filter(function (v) { return v && v.refObjectName; })
          .map(function (v) {
            return { id: v.id || ('v-' + slugify(v.label)), label: String(v.label || '').trim(), description: String(v.description || '').trim(), refObjectName: v.refObjectName };
          });
        return {
          id: l.id || slugify(l.name),
          name: String(l.name || '').trim(),
          description: String(l.description || '').trim(),
          refObjectName: l.refObjectName || '',
          variants: variants,
          sceneIds: Array.isArray(l.sceneIds) ? l.sceneIds.slice() : []
        };
      });
  }

  /** payload.episodeLocations 를 갱신하고 로컬·드래프트·서버에 저장한다. */
  mod.persistLocations = function (ctx, locs) {
    if (!ctx || !ctx.getState || !ctx.setState) return;
    var st = ctx.getState();
    if (!st) return;
    var cleaned = cleanLocationsForSave(locs);
    st.payload = Object.assign({}, st.payload, { episodeLocations: cleaned });
    ctx.setState(st);
    try { if (ctx.persistPipeline) ctx.persistPipeline(); } catch (_) {}
    try { if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline(); } catch (_) {}
    try {
      var pid = st.draftId || '';
      if (pid && NK.api && NK.api.projectSave) {
        NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '' }).catch(function () {});
      }
    } catch (_) {}
    return cleaned;
  };

  function currentLocations(ctx) {
    var st = ctx.getState();
    var list = (st && st.payload && Array.isArray(st.payload.episodeLocations)) ? st.payload.episodeLocations : [];
    // 작업용 복사본(깊이 1 + variants)
    return list.map(function (l) {
      return Object.assign({}, l, { variants: Array.isArray(l.variants) ? l.variants.map(function (v) { return Object.assign({}, v); }) : [] });
    });
  }

  // 장소 목록이 비어 있으면 씬에서 추출한다(LLM → 규칙 폴백). 추출 결과를 저장하고 돌려준다.
  var extractInFlight = null;
  mod.ensureLocations = async function (ctx, opts) {
    var o = opts || {};
    var locs = currentLocations(ctx);
    if (locs.length) return locs;
    if (extractInFlight) return extractInFlight;
    extractInFlight = (async function () {
      var st = ctx.getState();
      var scenes = (st && Array.isArray(st.scenes)) ? st.scenes : [];
      if (!scenes.length) return [];
      if (o.onStatus) o.onStatus('extractingLocations');
      var found = null;
      try {
        if (NK.api && NK.api.scenarioLocations) {
          var r = await NK.api.scenarioLocations(scenes, (st.payload && st.payload.language) === 'en' ? 'en' : 'ko');
          if (r && Array.isArray(r.locations) && r.locations.length) found = r.locations;
        }
      } catch (e) { try { console.warn('[set-plates] 장소 추출(LLM) 실패 → 규칙 폴백', e && e.message); } catch (_) {} }
      if (!found && NK.service && NK.service.episodeLocations && NK.service.episodeLocations.derive) {
        found = NK.service.episodeLocations.derive(scenes, { existing: [] });
      }
      if (!found || !found.length) return [];
      mod.persistLocations(ctx, found);
      return currentLocations(ctx);
    })();
    try { return await extractInFlight; } finally { extractInFlight = null; }
  };

  // 같은 장소를 두 경로(단일 컷·일괄)가 동시에 만들지 않도록 장소별 진행 중 약속을 공유한다.
  var plateInFlight = {};

  /**
   * 장소 하나의 빠진 플레이트를 만든다. 마스터 → 필요한 방위 순서(방위는 마스터를 참조하므로).
   * 플레이트 하나가 끝날 때마다 저장한다.
   * @returns {Promise<{loc:Object, generated:string[], failed:string[]}>}
   */
  mod.ensureLocationPlates = async function (ctx, loc, directions, opts) {
    var o = opts || {};
    var key = String((loc && (loc.id || loc.name)) || '').trim().toLowerCase();
    if (!key) return { loc: loc, generated: [], failed: [] };
    if (plateInFlight[key]) return plateInFlight[key];
    plateInFlight[key] = (async function () {
      var generated = [];
      var failed = [];
      var st = ctx.getState();
      var common = commonPromptOf(st);
      var aspect = (st && st.aspectRatio) || '16:9';
      var projectId = (st && st.draftId) || '';
      var missing = mod.missingPlates(loc, directions);
      if (!missing.length) return { loc: loc, generated: generated, failed: failed };

      function persistCurrent(updated) {
        var list = currentLocations(ctx);
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (String((list[i].id || list[i].name) || '').trim().toLowerCase() === key) { idx = i; break; }
        }
        if (idx >= 0) list[idx] = Object.assign({}, list[idx], updated, { variants: updated.variants || list[idx].variants });
        else list.push(updated);
        mod.persistLocations(ctx, list);
      }

      if (missing.indexOf('master') >= 0) {
        if (o.onStatus) o.onStatus('generatingMaster', loc);
        try {
          var json = await NK.api.imagen({
            prompt: mod.buildMasterPlatePrompt(common, loc),
            aspectRatio: aspect,
            projectId: projectId,
            generationMode: 'text-to-image',
            referenceImages: []
          });
          var obj = String((json && json.objectName) || '').trim();
          if (!obj) throw new Error('no objectName');
          loc.refObjectName = obj;
          generated.push('master');
          persistCurrent(loc);
        } catch (e) {
          failed.push('master');
          try { console.warn('[set-plates] 마스터 플레이트 실패:', loc.name, e && e.message); } catch (_) {}
          return { loc: loc, generated: generated, failed: failed }; // 마스터 없이는 방위도 못 만든다
        }
      }

      var primaryUrl = proxyUrl(loc.refObjectName);
      for (var d = 0; d < missing.length; d++) {
        var dir = missing[d];
        if (dir === 'master') continue;
        var spec = mod.specFor(dir);
        if (!spec) continue;
        if (o.onStatus) o.onStatus('generatingDirection', loc, dir);
        try {
          var dj = await NK.api.imagen({
            prompt: mod.buildDirectionPlatePrompt(common, loc, spec),
            aspectRatio: aspect,
            projectId: projectId,
            generationMode: 'text-to-image',
            referenceImages: primaryUrl ? [{
              referenceId: 1,
              referenceType: 'REFERENCE_TYPE_STYLE',
              referenceKind: 'environment-detail',
              imageDataUrl: primaryUrl,
              subjectDescription: String(loc.name || 'this place') + ' (front-facing master plate)',
              subjectType: 'SUBJECT_TYPE_DEFAULT'
            }] : []
          });
          var dobj = String((dj && dj.objectName) || '').trim();
          if (!dobj) throw new Error('no objectName');
          mod.setDirectionPlate(loc, dir, dobj, mod.text(spec.labelKey));
          generated.push(dir);
          persistCurrent(loc);
        } catch (e2) {
          failed.push(dir);
          try { console.warn('[set-plates] 방위 플레이트 실패:', loc.name, dir, e2 && e2.message); } catch (_) {}
        }
      }
      return { loc: loc, generated: generated, failed: failed };
    })();
    try { return await plateInFlight[key]; } finally { delete plateInFlight[key]; }
  };

  /**
   * 컷 하나를 만들기 전에 그 컷의 세트가 준비됐는지 보장한다.
   * @returns {Promise<{ok:boolean, loc:Object|null, reason?:string, failed?:string[]}>}
   *   ok=false 는 "장소는 있는데 플레이트를 못 만들었다" — 호출부는 컷 생성을 멈춰야 한다.
   *   loc=null 이면 이 컷에 배정된 장소 자체가 없다(추상 컷 등) — 호출부는 그냥 진행한다.
   */
  mod.ensureForScene = async function (ctx, sceneIdx, opts) {
    var o = opts || {};
    if (!ctx || !ctx.getState) return { ok: true, loc: null };
    if (!NK.api || !NK.api.imagen) return { ok: true, loc: null };
    var locs = await mod.ensureLocations(ctx, o);
    var st = ctx.getState();
    var scene = st && st.scenes ? st.scenes[sceneIdx] : null;
    if (!scene) return { ok: true, loc: null };
    var loc = mod.findLocationForScene(locs, scene);
    if (!loc) return { ok: true, loc: null };
    var dirs = mod.directionsOfScene(scene);
    if (!mod.missingPlates(loc, dirs).length) return { ok: true, loc: loc };
    if (o.onStatus) o.onStatus('preparingSet', loc);
    var res = await mod.ensureLocationPlates(ctx, loc, dirs, o);
    var stillMissing = mod.missingPlates(res.loc, dirs);
    // 마스터가 있으면 방위 하나가 실패해도 진행한다(방위 미등록은 폴백 문구가 있다). 마스터 실패는 멈춘다.
    if (stillMissing.indexOf('master') >= 0) {
      return { ok: false, loc: res.loc, reason: 'master_failed', failed: res.failed };
    }
    return { ok: true, loc: res.loc, failed: res.failed };
  };

  /**
   * 일괄 생성 전: 모든 장소의 마스터 + 실제로 쓰이는 방위 플레이트를 준비한다.
   * 장소끼리는 병렬, 한 장소 안에서는 순차.
   */
  mod.ensureAll = async function (ctx, opts) {
    var o = opts || {};
    if (!ctx || !ctx.getState) return { locations: [], failed: [] };
    if (!NK.api || !NK.api.imagen) return { locations: [], failed: [] };
    var locs = await mod.ensureLocations(ctx, o);
    var st = ctx.getState();
    var scenes = (st && Array.isArray(st.scenes)) ? st.scenes : [];
    var jobs = locs.map(function (loc) {
      var dirs = mod.neededDirections(locs, loc, scenes);
      if (!mod.missingPlates(loc, dirs).length) return Promise.resolve({ loc: loc, generated: [], failed: [] });
      return mod.ensureLocationPlates(ctx, loc, dirs, o);
    });
    var results = await Promise.all(jobs);
    var failed = [];
    results.forEach(function (r) {
      (r.failed || []).forEach(function (f) { failed.push(String(r.loc && r.loc.name) + ':' + f); });
    });
    return { locations: currentLocations(ctx), failed: failed };
  };
})();
