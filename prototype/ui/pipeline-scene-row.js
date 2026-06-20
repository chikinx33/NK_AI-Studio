;(function () {
  var NK = window.NK || (window.NK = {});
  var sceneRow = NK.uiPipelineSceneRow || (NK.uiPipelineSceneRow = {});

  function toBool(v, fallback) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      var x = v.trim().toLowerCase();
      if (x === 'true' || x === '1' || x === 'yes' || x === 'on') return true;
      if (x === 'false' || x === '0' || x === 'no' || x === 'off') return false;
    }
    return !!fallback;
  }

  function normalizeDialogueForScript(value) {
    if (Array.isArray(value)) {
      return value.map(function (d) {
        return {
          speaker: String((d && d.speaker) || '').trim(),
          line: String((d && d.line) || '').trim()
        };
      }).filter(function (d) { return d.speaker || d.line; });
    }
    if (typeof value === 'string') {
      return value.split('\n').map(function (line) {
        return String(line || '').trim();
      }).filter(Boolean).map(function (line) {
        var idx = line.indexOf(':');
        if (idx > -1) {
          return {
            speaker: line.slice(0, idx).trim(),
            line: line.slice(idx + 1).trim()
          };
        }
        return { speaker: '', line: line };
      }).filter(function (d) { return d.speaker || d.line; });
    }
    return [];
  }

  function isVoiceFeatureEnabled(payload) {
    var p = payload || {};
    return !!(toBool(p.narrationEnabled, false) || toBool(p.dubbingEnabled, false));
  }

  function isSceneVideoProcessing(scene) {
    return String((scene && scene.videoStatus) || '').trim().toLowerCase() === 'processing';
  }

  function isSceneVoiceProcessing(scene) {
    return /^생성\s*중/.test(String((scene && scene.voiceStatus) || '').trim());
  }

  function extractNarrationDisplay(text) {
    var raw = String(text || '').trim();
    if (!raw) return '';
    var first = raw.split(/\n+/).map(function (x) { return String(x || '').trim(); }).find(Boolean) || raw;
    var m = first.match(/^(?:나레이션|Narration)\s*[:：]?\s*["“”]?([\s\S]*?)["“”]?\s*$/i);
    return m ? String(m[1] || '').trim() : raw;
  }

  function buildVoiceScriptForVideo(scene, payload) {
    var p = payload || {};
    var narrationEnabled = toBool(p.narrationEnabled, false);
    var dubbingEnabled = toBool(p.dubbingEnabled, false);
    if (!narrationEnabled && !dubbingEnabled) return '';

    // 사용자가 명시적으로 편집했으면(빈 값 포함) 그 값을 그대로 사용 — 자동 대사로 폴백하지 않음.
    if (scene && scene.scriptEdited) return String(scene.script || '').trim();
    var existing = String((scene && scene.script) || '').trim();
    if (existing) return existing;

    var narration = String((scene && scene.narration) || '').trim();
    if (!narration) narration = extractNarrationDisplay((scene && scene.lines) || '');
    var dialogue = normalizeDialogueForScript((scene && scene.dialogue) || []);

    if (dubbingEnabled && !dialogue.length && narration) {
      dialogue = [{ speaker: '@narrator', line: narration }];
    }

    var rows = [];
    if (narrationEnabled && narration) rows.push('나레이션 "' + narration + '"');
    if (dubbingEnabled && dialogue.length) {
      rows.push('대사');
      dialogue.forEach(function (d) {
        rows.push((d.speaker || '@narrator') + ' "' + (d.line || '...') + '"');
      });
    }
    if (rows.length) return rows.join('\n').trim();

    var fallback = extractNarrationDisplay((scene && scene.lines) || '');
    return fallback ? ('나레이션 "' + fallback + '"') : '';
  }

  function buildImageCard(scene, mediaUrlResolver) {
    var imagePlayableUrl = mediaUrlResolver(scene.imageDataUrl || '');
    if (scene.imgLoading) return '<div class="image-placeholder tall loading"><div class="spinner"></div><span>이미지 생성 중...</span></div>';
    if (scene.imgError) return '<div class="image-placeholder tall error-state"><span>이미지 생성 실패</span></div>';
    if (scene.imageDataUrl) {
      return '<div class="image-box"><img class="scene-img" loading="lazy" decoding="async" data-src="' + imagePlayableUrl + '" src="' + imagePlayableUrl + '" alt="scene image" /></div>';
    }
    return '<div class="image-placeholder tall no-plus"><span>image</span></div>';
  }

  function buildVideoCard(scene, mediaUrlResolver) {
    var videoPlayableUrl = mediaUrlResolver(scene.videoUrl || '');
    if (scene.videoUrl) {
      var note = scene.videoMethod === 'inline' ? '<div class="video-note">내장 재생(임시 변환)</div>' : '';
      var badge = scene.videoModelLabel
        ? '<div class="video-model-badge">' + scene.videoModelLabel.replace(/</g, '&lt;') + '</div>'
        : '';
      // iOS(아이패드)는 poster 가 없으면 영상 첫 프레임을 렌더하지 않고 재생버튼만 보인다.
      // 영상의 시작 이미지(scene.imageDataUrl)를 poster 로 지정해 어떤 환경에서도 첫 화면이 보이게 한다.
      var posterSrc = mediaUrlResolver(scene.imageDataUrl || '');
      var posterAttr = posterSrc ? ' poster="' + escapeAttr(posterSrc) + '"' : '';
      return '<div class="video-box">' +
        '<video class="scene-video" controls muted playsinline webkit-playsinline preload="metadata"' + posterAttr + '><source src="' + videoPlayableUrl + '" type="video/mp4" /></video>' +
        badge + note +
        '</div>';
    }
    if (scene.videoStatus === 'processing') return '<div class="video-placeholder loading"><div class="spinner"></div><span>영상 생성 중...</span></div>';
    if (scene.videoError) return '<div class="video-placeholder error-state"><span>생성 실패</span></div>';
    return '<div class="video-placeholder"><span>video</span></div>';
  }

  function buildVoiceBlock(scene, options) {
    var voiceEnabled = !!options.voiceEnabled;
    var voiceBusy = !!options.voiceBusy;
    var mediaUrlResolver = typeof options.toPlayableMediaUrl === 'function'
      ? options.toPlayableMediaUrl
      : function (value) { return String(value || '').trim(); };
    var voiceId = String(scene.voiceVoiceId || 'engine:gemini:voice:Kore');
    var voiceOptions = [
      { id: 'engine:gemini:voice:Kore', label: 'Gemini · Kore (Neutral)' },
      { id: 'engine:gemini:preset:child:female:Kore:rate=1.08:pitch=4', label: 'Gemini · Kore (어린 소녀)' },
      { id: 'engine:gemini:preset:child:male:Kore:rate=1.06:pitch=2', label: 'Gemini · Kore (어린 소년)' },
      { id: 'engine:gemini:preset:char:robot:Kore:rate=1.00:pitch=0', label: 'Gemini · Kore (로봇)' },
      { id: 'engine:gemini:preset:char:magician:Kore:rate=1.00:pitch=0', label: 'Gemini · Kore (마법사)' },
      { id: 'engine:gemini:preset:char:trick:Kore:rate=1.05:pitch=1', label: 'Gemini · Kore (장난꾸러기)' }
    ];
    var optionsHtml = voiceOptions.map(function (o) {
      var sel = (voiceId === o.id) ? ' selected' : '';
      return '<option value="' + o.id + '"' + sel + '>' + o.label + '</option>';
    }).join('');
    var errorLine = scene.voiceError ? ('<p class="small" style="color:#ff6b6b; margin:6px 0 0;">' + String(scene.voiceError) + '</p>') : '';
    var fallbackVoiceUrl = '';
    try {
      if (!scene.voiceUrl && scene.voiceObjectName && window.NK && NK.api && NK.api.mediaProxyObjectUrl) {
        fallbackVoiceUrl = NK.api.mediaProxyObjectUrl(scene.voiceObjectName);
      }
    } catch (_) { }
    var audioPlayableUrl = mediaUrlResolver(scene.voiceUrl || fallbackVoiceUrl || '');
    return (
      '<div class="voice-block" style="margin-top:8px;">' +
      '<div class="voice-title-row">' +
      '<span class="voice-title">AI 보이스</span>' +
      '</div>' +
      '<div class="voice-row voice-controls">' +
      '<select class="voice-select" data-id="' + scene.id + '" style="flex:1; min-width:120px;">' +
      optionsHtml +
      '</select>' +
      '<button class="btn-secondary compact" data-action="voice-generate" data-id="' + scene.id + '"' + (!voiceEnabled ? ' disabled' : '') + '>' + (voiceBusy ? '생성중(취소)' : '음성 생성') + '</button>' +
      '</div>' +
      '<div class="voice-player" data-id="' + scene.id + '" style="margin-top:10px;">' +
      '<audio controls preload="auto" style="width:100%;" ' + (audioPlayableUrl ? '' : 'disabled') + ' src="' + (audioPlayableUrl || '') + '"></audio>' +
      '</div>' +
      (!voiceEnabled ? '<p class="muted small">프리프로덕션에서 나레이션/더빙을 켜야 음성 생성이 가능합니다.</p>' : '') +
      errorLine +
      '</div>'
    );
  }

  var collapsedPipelineSceneIds = new Set();

  function isPipelineSceneCollapsed(id) {
    return collapsedPipelineSceneIds.has(String(id));
  }

  function togglePipelineSceneCollapsed(id) {
    var key = String(id);
    if (collapsedPipelineSceneIds.has(key)) collapsedPipelineSceneIds.delete(key);
    else collapsedPipelineSceneIds.add(key);
  }

  function setPipelineSceneCollapsed(id, collapsed) {
    var key = String(id);
    if (collapsed) collapsedPipelineSceneIds.add(key);
    else collapsedPipelineSceneIds.delete(key);
  }

  function escapeAttr(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildShotMiniMedia(shot, mediaUrlResolver) {
    var imgUrl = (shot && (shot.imageDataUrl || shot.imagePath || shot.generatedImageUrl || shot.imageUrl)) || '';
    var vidUrl = (shot && (shot.videoUrl || shot.videoPlaybackUrl || shot.generatedVideoUrl || shot.videoPath)) || '';
    var resolvedImg = imgUrl ? mediaUrlResolver(imgUrl) : '';
    var resolvedVid = vidUrl ? mediaUrlResolver(vidUrl) : '';
    var imgHtml;
    if (shot && shot.imgLoading) {
      imgHtml = '<div class="shot-thumb shot-thumb-img loading"><div class="spinner"></div></div>';
    } else if (shot && shot.imgError) {
      imgHtml = '<div class="shot-thumb shot-thumb-img error" title="' + escapeAttr(shot.imgError) + '">!</div>';
    } else if (resolvedImg) {
      imgHtml = '<div class="shot-thumb shot-thumb-img"><img class="shot-img" loading="lazy" decoding="async" src="' + escapeAttr(resolvedImg) + '" alt="shot image" /></div>';
    } else {
      imgHtml = '<div class="shot-thumb shot-thumb-img empty">img</div>';
    }
    var vidHtml;
    var shotVideoBusy = String(shot && shot.videoStatus || '').toLowerCase() === 'processing';
    if (shotVideoBusy) {
      vidHtml = '<div class="shot-thumb shot-thumb-vid loading"><div class="spinner"></div></div>';
    } else if (shot && shot.videoError) {
      vidHtml = '<div class="shot-thumb shot-thumb-vid error" title="' + escapeAttr(shot.videoError) + '">!</div>';
    } else if (resolvedVid) {
      vidHtml = '<div class="shot-thumb shot-thumb-vid"><video class="shot-video" muted playsinline preload="metadata"><source src="' + escapeAttr(resolvedVid) + '" type="video/mp4" /></video></div>';
    } else {
      vidHtml = '<div class="shot-thumb shot-thumb-vid empty">vid</div>';
    }
    return '<div class="shot-thumbs">' + imgHtml + vidHtml + '</div>';
  }

  function buildShotRowHtml(scene, shot, idx, mediaUrlResolver) {
    var sceneId = scene && scene.id;
    var sid = String((shot && shot.id) || (sceneId + '.' + (idx + 1)));
    var dur = Math.max(Number(shot && shot.duration) || 0, 0);
    var hasImage = !!(shot && (shot.imageDataUrl || shot.imagePath || shot.generatedImageUrl || shot.imageUrl));
    var hasVideo = !!(shot && (shot.videoUrl || shot.videoPlaybackUrl || shot.generatedVideoUrl || shot.videoPath));
    var imgBusy = !!(shot && shot.imgLoading);
    var vidBusy = String(shot && shot.videoStatus || '').toLowerCase() === 'processing';
    var imgBtnLabel = imgBusy ? '생성중(취소)' : (hasImage ? '재생성' : '이미지');
    var vidBtnLabel = vidBusy ? '생성중(취소)' : (hasVideo ? '재생성' : '영상');
    var thumbs = buildShotMiniMedia(shot, mediaUrlResolver);
    var typeLabel = (shot && shot.shotType) || '';
    var moveLabel = (shot && shot.cameraMove) || '';
    return (
      '<li class="shot-row" data-scene-id="' + escapeAttr(sceneId) + '" data-shot-id="' + escapeAttr(sid) + '">' +
      '<div class="shot-row-head">' +
      '<span class="shot-id">' + escapeText(sid) + '</span>' +
      '<span class="shot-type-chip" title="shot type">' + escapeText(typeLabel) + '</span>' +
      '<span class="shot-move-chip" title="camera move">' + escapeText(moveLabel) + '</span>' +
      '<span class="shot-dur">' + dur + 's</span>' +
      '</div>' +
      thumbs +
      '<div class="shot-row-body">' +
      '<p class="shot-comp"><span class="shot-tag">화면</span> ' + escapeText((shot && shot.composition) || '') + '</p>' +
      '<p class="shot-act"><span class="shot-tag">행동</span> ' + escapeText((shot && shot.action) || '') + '</p>' +
      '</div>' +
      '<div class="shot-row-actions">' +
      '<button class="btn-secondary compact" data-action="shot-image" data-scene-id="' + escapeAttr(sceneId) + '" data-shot-id="' + escapeAttr(sid) + '">' + imgBtnLabel + '</button>' +
      '<button class="btn-secondary compact" data-action="shot-video" data-scene-id="' + escapeAttr(sceneId) + '" data-shot-id="' + escapeAttr(sid) + '">' + vidBtnLabel + '</button>' +
      '<button class="btn-ghost compact" data-action="shot-delete-image" data-scene-id="' + escapeAttr(sceneId) + '" data-shot-id="' + escapeAttr(sid) + '"' + (hasImage ? '' : ' disabled') + ' title="이미지 삭제">img×</button>' +
      '<button class="btn-ghost compact" data-action="shot-delete-video" data-scene-id="' + escapeAttr(sceneId) + '" data-shot-id="' + escapeAttr(sid) + '"' + (hasVideo ? '' : ' disabled') + ' title="영상 삭제">vid×</button>' +
      '</div>' +
      '</li>'
    );
  }

  function buildShotSection(scene, options) {
    // v2.702: 평탄화 모델로 전환 — shot 서브섹션은 더 이상 렌더하지 않음.
    // scene 자체가 한 카메라 셋업 단위라서 shots 가 들어와도 무시 (legacy 데이터 안전 처리).
    return '';
    // 이하 데드 코드 (참고용 — 다음 cleanup 단계에서 제거 예정):
    var opts = options || {};
    var mediaUrlResolver = typeof opts.toPlayableMediaUrl === 'function'
      ? opts.toPlayableMediaUrl
      : function (value) { return String(value || ''); };
    var shots = (scene && Array.isArray(scene.shots)) ? scene.shots : [];
    if (!shots.length) return '';
    var hasSceneImage = !!(scene && scene.imageDataUrl);
    // 씬 이미지가 이미 있으면 접힘으로 시작 (워크플로 방해 없음)
    var collapsed = !!hasSceneImage;
    var anyShotImg = shots.some(function (sh) { return !!(sh && (sh.imageDataUrl || sh.imagePath)); });
    var anyShotVid = shots.some(function (sh) { return !!(sh && (sh.videoUrl || sh.videoPath)); });
    if (anyShotImg || anyShotVid) collapsed = false; // 컷별 결과가 있으면 항상 펼침
    var rowsHtml = shots.map(function (sh, i) { return buildShotRowHtml(scene, sh, i, mediaUrlResolver); }).join('');
    var batchBusy = shots.some(function (sh) { return !!(sh && sh.imgLoading) || String(sh && sh.videoStatus || '').toLowerCase() === 'processing'; });
    return (
      '<div class="scene-shot-section' + (collapsed ? ' is-collapsed' : '') + '" data-scene-id="' + escapeAttr(scene.id) + '">' +
      '<div class="scene-shot-section-head">' +
      '<button type="button" class="scene-shot-toggle" data-action="shot-section-toggle" data-scene-id="' + escapeAttr(scene.id) + '" title="' + (collapsed ? '펼치기' : '접기') + '">' + (collapsed ? '▸' : '▾') + '</button>' +
      '<span class="scene-shot-section-title">콘티 / Shot (' + shots.length + ')</span>' +
      '<button class="btn-secondary compact scene-shot-batch-btn" data-action="scene-shots-batch" data-scene-id="' + escapeAttr(scene.id) + '"' + (batchBusy ? ' disabled' : '') + '>' + (batchBusy ? '생성 중...' : '컷 전체 이미지 생성') + '</button>' +
      '</div>' +
      '<ol class="shot-row-list">' + rowsHtml + '</ol>' +
      '</div>'
    );
  }

  function buildCutRefOptions(allScenes, currentId, selectedId) {
    var result = '<option value="">컷 선택</option>';
    (allScenes || []).forEach(function (s) {
      if (!s || String(s.id) === String(currentId) || !s.imageDataUrl) return;
      var lbl = escapeText(s.displayLabel || ('cut ' + s.id));
      var sel = String(s.id) === String(selectedId) ? ' selected' : '';
      result += '<option value="' + escapeAttr(String(s.id)) + '"' + sel + '>' + lbl + '</option>';
    });
    return result;
  }

  // 컷 기반 레퍼런스 선택 버튼에 표시할 라벨(이미 escape 된 텍스트 반환).
  // 선택된 컷이 없거나 그 컷에 이미지가 없으면 기본 안내 문구를 보여준다.
  function buildCutRefButtonLabel(allScenes, currentId, selectedId) {
    if (!selectedId) return '컷 선택';
    var found = null;
    (allScenes || []).forEach(function (s) {
      if (!found && s && String(s.id) === String(selectedId)) found = s;
    });
    if (!found || !found.imageDataUrl || String(found.id) === String(currentId)) return '컷 선택';
    return escapeText(found.displayLabel || ('cut ' + found.id));
  }

  function buildSceneRowHtml(scene, header, options) {
    var opts = options || {};
    var statePayload = opts.statePayload || {};
    var allScenes = Array.isArray(opts.allScenes) ? opts.allScenes : [];
    var mediaUrlResolver = typeof opts.toPlayableMediaUrl === 'function'
      ? opts.toPlayableMediaUrl
      : function (value) { return String(value || ''); };
    var videoBusy = isSceneVideoProcessing(scene);
    var voiceBusy = isSceneVoiceProcessing(scene);
    var voiceBlock = buildVoiceBlock(scene, {
      voiceEnabled: isVoiceFeatureEnabled(statePayload),
      voiceBusy: voiceBusy,
      toPlayableMediaUrl: mediaUrlResolver
    });
    var img = buildImageCard(scene, mediaUrlResolver);
    var videoCard = buildVideoCard(scene, mediaUrlResolver);
    var isCollapsed = isPipelineSceneCollapsed(scene.id);
    var collapseClass = isCollapsed ? ' is-collapsed' : '';
    var toggleIcon = isCollapsed ? '+' : '-';
    var toggleLabel = isCollapsed ? '펼치기' : '접기';
    var narrationPreview = extractNarrationDisplay(scene.lines || '');
    if (narrationPreview.length > 40) narrationPreview = narrationPreview.slice(0, 40) + '…';
    var hasImage = !!scene.imageDataUrl;
    var hasVideo = !!(scene.videoUrl || scene.videoPlaybackUrl);

    var statusChips = '';
    // 카메라 셋업 칩 (scene 단위)
    if (scene.shotType) statusChips += '<span class="scene-row-chip chip-shot-type" title="shot type">' + escapeText(scene.shotType) + '</span>';
    if (scene.cameraMove) statusChips += '<span class="scene-row-chip chip-camera-move" title="camera move">' + escapeText(scene.cameraMove) + '</span>';
    if (hasImage) statusChips += '<span class="scene-row-chip chip-image">IMG</span>';
    if (hasVideo) statusChips += '<span class="scene-row-chip chip-video">VID</span>';
    if (scene.imgLoading) statusChips += '<span class="scene-row-chip chip-loading">생성중</span>';
    if (videoBusy) statusChips += '<span class="scene-row-chip chip-loading">영상중</span>';

    return (
      '<div class="scene-row' + collapseClass + '" data-id="' + scene.id + '">' +
      '<div class="scene-row-header">' +
      '<button type="button" class="scene-row-toggle" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '" aria-label="' + toggleLabel + '" title="' + toggleLabel + '">' + toggleIcon + '</button>' +
      '<span class="scene-row-title" title="' + escapeAttr(scene.displayLabel || ('Scene ' + scene.id)) + '">' + (scene.displayLabelHtml || escapeText(scene.displayLabel || ('Scene ' + scene.id))) + '</span>' +
      '<span class="scene-row-preview">' + narrationPreview + '</span>' +
      '<span class="scene-row-chips">' + statusChips + '</span>' +
      '</div>' +
      '<div class="scene-row-body-wrap">' +
      '<div class="scene-row-body">' +
      '<div class="scene-cell story">' +
      '<div class="story-inner">' +
      (function () {
        var narOn = toBool(statePayload.narrationEnabled, false);
        var dubOn = toBool(statePayload.dubbingEnabled, false);
        if (!narOn && !dubOn) {
          return '<p class="eyebrow muted">대본 없음</p>';
        }
        var modeLabel = dubOn ? '더빙' : '나레이션';
        // 사용자가 직접 수정한 대본(scene.script)이 있으면 그것을 최우선 표시·사용한다.
        // (buildVoiceScriptForVideo·TTS·영상 프롬프트 주입 모두 scene.script 를 우선함)
        var scriptOverride = String((scene && scene.script) || '').trim();
        var linesHtml = '';
        if (scene && scene.scriptEdited) {
          // 명시적으로 편집한 대본(빈 값 포함)은 그대로 표시 — 자동 대사로 폴백하지 않음.
          linesHtml = escapeText(scriptOverride).replace(/\n/g, '<br>');
        } else if (scriptOverride) {
          linesHtml = escapeText(scriptOverride).replace(/\n/g, '<br>');
        } else if (dubOn && Array.isArray(scene.dialogue) && scene.dialogue.length) {
          linesHtml = scene.dialogue.map(function (d) {
            var speaker = String((d && d.speaker) || '').trim();
            var line = String((d && d.line) || '').trim();
            if (!line) return '';
            if (speaker) {
              return '<span class="dialogue-speaker">' + speaker + ':</span> ' + line;
            }
            return line;
          }).filter(Boolean).join('<br>');
        } else {
          linesHtml = extractNarrationDisplay(scene.lines || '');
        }
        // 별도 버튼 없이 텍스트 영역을 클릭하면 바로 편집. Enter 로 적용, 전역 "저장"으로 영속화.
        return '<p class="eyebrow">' + modeLabel + '</p>' +
          '<p class="story-lines is-editable" data-id="' + scene.id + '" data-dub-edit="1" contenteditable="true" spellcheck="false" ' +
          'title="클릭해 대본을 수정 · Enter로 적용 (Shift+Enter 줄바꿈)">' + linesHtml + '</p>' +
          voiceBlock;
      })() +
      '</div>' +
      '</div>' +
      // 프롬프트도 더빙처럼 인라인 편집: 별도 편집/저장/취소 버튼 없이 클릭→타이핑→Enter 적용.
      '<div class="scene-cell prompt">' +
      '<p class="eyebrow">Common</p>' +
      '<p class="prompt-common is-editable" data-id="' + scene.id + '" data-prompt-edit="1" contenteditable="true" spellcheck="false" title="클릭해 수정 · Enter로 적용 (Shift+Enter 줄바꿈)">' + header + '</p>' +
      // composition/action 이 있으면 화면/행동을 별도 라인으로 (Visual 라인은 숨김 — 중복 방지).
      // 둘 다 없으면 기존 Visual 사용.
      ((scene.composition || scene.action)
        ? ('<p class="eyebrow">화면</p>' +
           '<p class="prompt-composition is-editable" data-id="' + scene.id + '" data-prompt-edit="1" contenteditable="true" spellcheck="false">' + escapeText(scene.composition || '') + '</p>' +
           '<p class="eyebrow">행동</p>' +
           '<p class="prompt-action is-editable" data-id="' + scene.id + '" data-prompt-edit="1" contenteditable="true" spellcheck="false">' + escapeText(scene.action || '') + '</p>')
        : ('<p class="eyebrow">Visual</p>' +
           '<p class="prompt-visual is-editable" data-id="' + scene.id + '" data-prompt-edit="1" contenteditable="true" spellcheck="false">' + (scene.shot || '') + '</p>')
      ) +
      '<p class="eyebrow">Duration</p>' +
      '<p class="prompt-duration is-editable" data-id="' + scene.id + '" data-prompt-edit="1" contenteditable="true" spellcheck="false">' + (Math.max(Number(scene.estSec) || 0, 1)) + 's.</p>' +
      '</div>' +
      '<div class="scene-cell image"><div class="scene-media-stack"><div class="image-slot">' + img + '</div><div class="video-slot">' + videoCard + '</div></div></div>' +
      '<div class="scene-cell actions">' +
      '<div class="action-buttons grid">' +
      '<button class="btn-secondary compact span2" data-action="regen-image" data-id="' + scene.id + '">' + (scene.imgLoading ? '생성중(취소)' : '이미지 생성') + '</button>' +
      '<button class="btn-secondary compact" data-action="edit-image" data-id="' + scene.id + '"' + (scene.imageDataUrl ? '' : ' disabled') + ' title="채팅·인페인팅으로 수정">수정</button>' +
      '<button class="btn-secondary compact" data-action="revert-image" data-id="' + scene.id + '"' + ((Array.isArray(scene.imageHistory) && scene.imageHistory.length) ? '' : ' disabled') + ' title="이전 버전으로 되돌리기">되돌리기</button>' +
      '<button class="btn-secondary compact" data-action="delete-image" data-id="' + scene.id + '"' + (scene.imageDataUrl ? '' : ' disabled') + '>삭제</button>' +
      '<button class="btn-secondary compact" data-action="upload-image" data-id="' + scene.id + '">업로드</button>' +
      '<button class="btn-secondary compact" data-action="library-image" data-id="' + scene.id + '">저장소</button>' +
      '<button class="btn-secondary compact" data-action="download-image" data-id="' + scene.id + '"' + (scene.imageDataUrl ? '' : ' disabled') + '>다운로드</button>' +
      '<label class="cut-ref-check-label">' +
      '<input type="checkbox" class="cut-ref-check" data-action="toggle-cut-ref" data-id="' + scene.id + '"' + (scene.cutRefEnabled ? ' checked' : '') + '>' +
      ' 컷 기반 생성' +
      '</label>' +
      '<button type="button" class="btn-secondary compact cut-ref-pick-btn" data-action="pick-cut-ref" data-id="' + scene.id + '"' + (!scene.cutRefEnabled ? ' disabled' : '') + ' title="레퍼런스로 쓸 컷을 썸네일에서 선택">' +
      '<span class="cut-ref-pick-ico">🖼</span><span class="cut-ref-pick-text">' + buildCutRefButtonLabel(allScenes, scene.id, scene.cutRefId) + '</span>' +
      '</button>' +
      '</div>' +
      '<div class="action-buttons grid video-actions">' +
      '<button class="btn-secondary compact span2" data-action="video" data-id="' + scene.id + '">' + (videoBusy ? '생성중(취소)' : '영상 생성') + '</button>' +
      '<button class="btn-secondary compact" data-action="delete-video" data-id="' + scene.id + '"' + (scene.videoUrl ? '' : ' disabled') + '>삭제</button>' +
      '<button class="btn-secondary compact" data-action="upload-video" data-id="' + scene.id + '">업로드</button>' +
      '<button class="btn-secondary compact" data-action="library-video" data-id="' + scene.id + '">저장소</button>' +
      '<button class="btn-secondary compact" data-action="download-video" data-id="' + scene.id + '"' + (scene.videoUrl ? '' : ' disabled') + '>다운로드</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      buildShotSection(scene, { toPlayableMediaUrl: mediaUrlResolver }) +
      '</div>' +
      '</div>'
    );
  }

  sceneRow.buildShotSection = buildShotSection;
  sceneRow.buildShotRowHtml = buildShotRowHtml;
  sceneRow.buildShotMiniMedia = buildShotMiniMedia;
  sceneRow.buildImageCard = buildImageCard;
  sceneRow.buildVideoCard = buildVideoCard;
  sceneRow.buildVoiceBlock = buildVoiceBlock;
  sceneRow.isVoiceFeatureEnabled = isVoiceFeatureEnabled;
  sceneRow.isSceneVideoProcessing = isSceneVideoProcessing;
  sceneRow.isSceneVoiceProcessing = isSceneVoiceProcessing;
  sceneRow.extractNarrationDisplay = extractNarrationDisplay;
  sceneRow.buildVoiceScriptForVideo = buildVoiceScriptForVideo;
  sceneRow.buildSceneRowHtml = buildSceneRowHtml;
  sceneRow.buildCutRefOptions = buildCutRefOptions;
  sceneRow.buildCutRefButtonLabel = buildCutRefButtonLabel;
  sceneRow.togglePipelineSceneCollapsed = togglePipelineSceneCollapsed;
  sceneRow.setPipelineSceneCollapsed = setPipelineSceneCollapsed;
  sceneRow.isPipelineSceneCollapsed = isPipelineSceneCollapsed;
  sceneRow.collapsedPipelineSceneIds = collapsedPipelineSceneIds;
})();
