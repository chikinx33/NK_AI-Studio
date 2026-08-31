/**
 * stage-geometry.js — 무대(세트) 좌표계와 카메라 방위 기하.
 *
 * 블로킹(blocking)은 "마스터 플레이트를 정면(front)에서 봤을 때" 기준으로 적는다:
 *   { token: '@네모', x: 'left'|'center'|'right', depth: 'near'|'mid'|'far',
 *     facing: 'camera'|'away'|'left'|'right' }
 *   - x     : 정면 카메라가 봤을 때의 좌/중/우
 *   - depth : 정면 카메라 기준 근경/중경/원경
 *   - facing: 정면 카메라 기준 시선 방향 (camera=정면 카메라 쪽, away=반대,
 *             left/right=정면 프레임의 좌/우)
 *
 * cameraDirection(front/back/left/right)이 정해지면 이 모듈이 무대 좌표를
 * "그 카메라의 프레임 좌표"로 회전시켜 영어 프롬프트 문장을 만든다.
 * 리버스 샷(back)에서 좌우가 뒤집히고, 정면을 보던 캐릭터가 등을 보이는 것이
 * 추론이 아니라 조회표(기하)로 결정된다.
 *
 * 전부 순수 함수 — 단위 테스트(tests/stage-geometry.test.mjs)가 못박는다.
 */
;(function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});

  var X_KEYS = ['left', 'center', 'right'];
  var DEPTH_KEYS = ['near', 'mid', 'far'];
  var FACING_KEYS = ['camera', 'away', 'left', 'right'];

  function mirrorX(x) { return x === 'left' ? 'right' : (x === 'right' ? 'left' : 'center'); }
  function invertDepth(d) { return d === 'near' ? 'far' : (d === 'far' ? 'near' : 'mid'); }

  // 프레임 기준 시선 표현 (영문 프롬프트 조각)
  var FACING_TEXT = {
    toCamera: 'facing the camera',
    fromCamera: 'seen from behind, back to the camera',
    profileLeft: 'in profile, facing frame-left',
    profileRight: 'in profile, facing frame-right'
  };

  // cameraDirection 별 무대→프레임 변환표.
  // xFrom/depthFrom: 프레임 x/depth 를 무대의 어느 축에서 가져오는가.
  var TRANSFORMS = {
    front: {
      frameX: function (e) { return e.x; },
      frameDepth: function (e) { return e.depth; },
      facing: { camera: 'toCamera', away: 'fromCamera', left: 'profileLeft', right: 'profileRight' }
    },
    back: {
      frameX: function (e) { return mirrorX(e.x); },
      frameDepth: function (e) { return invertDepth(e.depth); },
      facing: { camera: 'fromCamera', away: 'toCamera', left: 'profileRight', right: 'profileLeft' }
    },
    // 카메라가 세트 왼쪽 벽에서 오른쪽(동쪽)을 본다: 근경(남)=프레임 우, 원경(북)=프레임 좌.
    right: {
      frameX: function (e) { return e.depth === 'near' ? 'right' : (e.depth === 'far' ? 'left' : 'center'); },
      frameDepth: function (e) { return e.x === 'left' ? 'near' : (e.x === 'right' ? 'far' : 'mid'); },
      facing: { camera: 'profileRight', away: 'profileLeft', left: 'toCamera', right: 'fromCamera' }
    },
    // 카메라가 세트 오른쪽 벽에서 왼쪽(서쪽)을 본다: 근경(남)=프레임 좌, 원경(북)=프레임 우.
    left: {
      frameX: function (e) { return e.depth === 'near' ? 'left' : (e.depth === 'far' ? 'right' : 'center'); },
      frameDepth: function (e) { return e.x === 'right' ? 'near' : (e.x === 'left' ? 'far' : 'mid'); },
      facing: { camera: 'profileLeft', away: 'profileRight', left: 'fromCamera', right: 'toCamera' }
    }
  };

  function normalizeKey(value, allowed, fallback) {
    var key = String(value || '').trim().toLowerCase();
    return allowed.indexOf(key) >= 0 ? key : fallback;
  }

  // 블로킹 배열 정규화. 유효 항목이 없으면 null.
  function normalizeBlocking(value) {
    if (!Array.isArray(value)) return null;
    var out = [];
    value.forEach(function (raw) {
      if (!raw || typeof raw !== 'object') return;
      var token = String(raw.token || raw.name || '').trim();
      if (!token) return;
      if (token.charAt(0) !== '@') token = '@' + token.replace(/^@+/, '');
      out.push({
        token: token,
        x: normalizeKey(raw.x, X_KEYS, 'center'),
        depth: normalizeKey(raw.depth, DEPTH_KEYS, 'mid'),
        facing: normalizeKey(raw.facing, FACING_KEYS, 'camera')
      });
    });
    return out.length ? out : null;
  }

  // 한 항목을 해당 카메라의 프레임 좌표로 변환.
  function transformEntry(entry, cameraDirection) {
    var dir = TRANSFORMS[String(cameraDirection || 'front').toLowerCase()] ? String(cameraDirection).toLowerCase() : 'front';
    var t = TRANSFORMS[dir] || TRANSFORMS.front;
    return {
      token: entry.token,
      frameX: t.frameX(entry),
      frameDepth: t.frameDepth(entry),
      facingText: FACING_TEXT[t.facing[entry.facing] || 'toCamera']
    };
  }

  var FRAME_X_TEXT = { left: 'on the left of frame', center: 'at the center of frame', right: 'on the right of frame' };
  var FRAME_DEPTH_TEXT = { near: 'in the foreground close to camera', mid: 'at mid-distance', far: 'in the background far from camera' };

  /**
   * 이미지 프롬프트에 붙일 공간 배치 문장.
   * @param blocking  normalizeBlocking 을 통과한 배열 (무대 좌표)
   * @param cameraDirection  'front'|'back'|'left'|'right'
   * @param allowedTokens  이 컷의 화면에 실제로 등장하는 @토큰 배열.
   *        여기 없는 캐릭터는 문장에서 제외한다 — 화면 밖 캐릭터를 프롬프트로
   *        끌어들이지 않기 위한 필터(화면/행동 분리 기획의 연장).
   */
  function buildBlockingLines(blocking, cameraDirection, allowedTokens) {
    var rows = normalizeBlocking(blocking);
    if (!rows) return '';
    var allow = null;
    if (Array.isArray(allowedTokens) && allowedTokens.length) {
      allow = {};
      allowedTokens.forEach(function (t) {
        var k = String(t || '').trim().toLowerCase();
        if (k) allow[k.charAt(0) === '@' ? k : ('@' + k)] = 1;
      });
    }
    var parts = [];
    rows.forEach(function (entry) {
      if (allow && !allow[entry.token.toLowerCase()]) return;
      var f = transformEntry(entry, cameraDirection);
      parts.push(f.token.replace(/^@/, '') + ' — ' + FRAME_X_TEXT[f.frameX] + ', ' + FRAME_DEPTH_TEXT[f.frameDepth] + ', ' + f.facingText);
    });
    if (!parts.length) return '';
    return 'Spatial layout as seen from THIS camera: ' + parts.join('; ') + '.';
  }

  // 장소 자산의 방위 플레이트 variant id 규약. bgref 모달의 생성기와
  // pipeline-image 의 플레이트 선택이 같은 id 를 쓴다.
  var DIRECTION_VARIANT_IDS = { front: 'dir-front', back: 'dir-back', left: 'dir-left', right: 'dir-right' };

  function directionVariantId(cameraDirection) {
    var key = String(cameraDirection || '').trim().toLowerCase();
    return DIRECTION_VARIANT_IDS[key] || '';
  }

  service.stageGeometry = {
    X_KEYS: X_KEYS,
    DEPTH_KEYS: DEPTH_KEYS,
    FACING_KEYS: FACING_KEYS,
    DIRECTION_VARIANT_IDS: DIRECTION_VARIANT_IDS,
    normalizeBlocking: normalizeBlocking,
    transformEntry: transformEntry,
    buildBlockingLines: buildBlockingLines,
    directionVariantId: directionVariantId
  };
})();
