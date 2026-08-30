/**
 * episode-locations.js — 에피소드(편) 전용 공간 레퍼런스.
 *
 * 브랜드(IP) 환경자산(environmentAssets, 세계관·프로젝트 관통)과는 별개의,
 * "이 에피소드 한 편에만 쓰이는 공간(장소) 목록"이다. draft.payload.episodeLocations 에 저장된다.
 *
 * 목적: 컷 기반 생성이 "이전 컷 이미지 통짜"를 베껴 모든 컷 구도가 똑같아지는 문제를,
 * 컷마다 "그 장소의 깨끗한 배경 플레이트"만 레퍼런스로 붙여 해결하기 위함.
 * 배경(월드)은 일관되지만 구도는 베끼지 않는다.
 *
 * 1단계(현재): 생성된 씬에서 장소를 보수적으로 1차 추출(데이터 구조 확정). B안: 이후 패널에서 편집.
 * 이후 단계: LLM 그룹핑/묘사 보강 → 배경 플레이트 생성 → 컷 자동 연결.
 *
 * 데이터 구조 (draft.payload.episodeLocations):
 *   [{ id, name, description, refObjectName, sceneIds:[] }]
 *     - id            : 안정적 식별자
 *     - name          : 장소 이름(예: "수영장", "수영장 입구", "길거리")
 *     - description   : 배경 플레이트 생성용 묘사 프롬프트(캐릭터 없는 공간 묘사). 사용자 편집 가능.
 *     - refObjectName : 생성된 배경 플레이트 이미지의 objectName(이후 단계에서 채움)
 *     - sceneIds      : 이 장소를 쓰는 씬 id 목록
 */
; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var mod = service.episodeLocations || (service.episodeLocations = {});

  function slugify(s) {
    var base = String(s || '').toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9가-힣\-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return base || 'loc';
  }

  function normKey(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // 씬의 장소 문자열. sceneLocation 우선, 없으면 visual 첫 문장에서 짧게 추정.
  function locStringOf(scene) {
    var loc = String((scene && (scene.sceneLocation || scene.location)) || '').trim();
    if (loc) return loc;
    var v = String((scene && (scene.visual || scene.shot)) || '').trim();
    if (!v) return '';
    return v.split(/[.\n]/)[0].slice(0, 60).trim();
  }

  /**
   * 생성된 씬들에서 에피소드 공간(장소) 목록을 1차 추출한다.
   * 보수적 그룹핑: 정규화된 장소 문구가 동일한 것만 병합(잘못된 병합 방지). 과분할은 패널에서 사용자가 병합.
   * 기존 목록(opts.existing)의 사용자 편집(description·refObjectName·id)은 이름이 같으면 보존한다.
   *
   * @param {Array} scenes
   * @param {{existing?: Array}} [opts]
   * @returns {Array<{id:string,name:string,description:string,refObjectName:string,sceneIds:string[]}>}
   */
  mod.derive = function (scenes, opts) {
    opts = opts || {};
    var existing = Array.isArray(opts.existing) ? opts.existing : [];
    var existingByKey = {};
    existing.forEach(function (e) { if (e && e.name) existingByKey[normKey(e.name)] = e; });

    var order = [];
    var byKey = {};
    (Array.isArray(scenes) ? scenes : []).forEach(function (sc) {
      if (!sc) return;
      var loc = locStringOf(sc);
      if (!loc) return;
      var key = normKey(loc);
      if (!byKey[key]) {
        byKey[key] = { name: loc, rep: loc, sceneIds: [] };
        order.push(key);
      }
      var sid = sc.id != null ? String(sc.id) : '';
      if (sid && byKey[key].sceneIds.indexOf(sid) < 0) byKey[key].sceneIds.push(sid);
      // 더 묘사적인(긴) 문구를 대표/시드 묘사로
      if (loc.length > byKey[key].rep.length) byKey[key].rep = loc;
    });

    return order.map(function (key) {
      var g = byKey[key];
      var prev = existingByKey[key];
      return {
        id: (prev && prev.id) || slugify(g.name),
        name: g.name,
        description: (prev && prev.description) || g.rep,
        refObjectName: (prev && prev.refObjectName) || '',
        sceneIds: g.sceneIds,
      };
    });
  };

  /**
   * 새로 뽑은 공간 목록에 이전 목록의 "만들어 둔 것"을 얹는다.
   *
   * 시나리오를 다시 생성하면 공간 목록도 다시 추출되는데, 그때 새 목록에는 이미지가 없다.
   * 그대로 갈아끼우면 공들여 만든 배경 플레이트와 세부 배경이 통째로 끊긴다
   * (저장소에는 파일이 남아 있는데 화면에는 '배경 없음' 으로 보이던 문제).
   * 이름이 같으면 같은 공간으로 보고 이미지·세부 배경을 그대로 물려준다.
   *
   * 이름·묘사는 새 추출을 따른다 — 새 시나리오에 맞춰 다시 쓰인 것이기 때문이다.
   * 다만 새 묘사가 비어 있으면 이전 묘사를 지킨다.
   */
  mod.mergeWithExisting = function (nextLocations, existing) {
    var next = Array.isArray(nextLocations) ? nextLocations : [];
    var prevList = Array.isArray(existing) ? existing : [];
    if (!next.length) return next;
    var prevByKey = {};
    prevList.forEach(function (e) {
      if (e && e.name) prevByKey[normKey(e.name)] = e;
    });
    return next.map(function (loc) {
      var row = loc && typeof loc === 'object' ? loc : { name: String(loc || '') };
      var prev = prevByKey[normKey(row.name)];
      if (!prev) return row;
      return {
        id: row.id || prev.id || '',
        name: row.name || prev.name || '',
        description: String(row.description || '').trim() || prev.description || '',
        // 만들어 둔 이미지와 세부 배경은 이름이 같으면 그대로 물려받는다.
        refObjectName: row.refObjectName || prev.refObjectName || '',
        variants: Array.isArray(row.variants) && row.variants.length
          ? row.variants
          : (Array.isArray(prev.variants) ? prev.variants : []),
        sceneIds: Array.isArray(row.sceneIds) ? row.sceneIds : (prev.sceneIds || []),
      };
    });
  };

  // 씬 1개가 어느 episodeLocation 에 속하는지 찾는다(컷 자동 연결 단계에서 사용).
  mod.locationForScene = function (locations, scene) {
    if (!Array.isArray(locations) || !scene) return null;
    var sid = scene.id != null ? String(scene.id) : '';
    if (sid) {
      for (var i = 0; i < locations.length; i++) {
        var l = locations[i];
        if (l && Array.isArray(l.sceneIds) && l.sceneIds.indexOf(sid) >= 0) return l;
      }
    }
    // 폴백: 장소 문자열 일치
    var key = normKey(locStringOf(scene));
    for (var j = 0; j < locations.length; j++) {
      if (locations[j] && normKey(locations[j].name) === key) return locations[j];
    }
    return null;
  };
})();
