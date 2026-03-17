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
    if (scene.imgLoading) return '<div class="image-placeholder tall loading"><span>생성 중...</span></div>';
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
      return '<div class="video-box"><video class="scene-video" controls muted playsinline preload="metadata"><source src="' + videoPlayableUrl + '" type="video/mp4" /></video>' + note + '</div>';
    }
    if (scene.videoStatus === 'processing') return '<div class="video-placeholder loading"><span>영상 생성중...</span></div>';
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
      '<button class="btn-secondary compact" data-action="voice-generate" data-id="' + scene.id + '"' + ((voiceBusy || !voiceEnabled) ? ' disabled' : '') + '>' + (voiceBusy ? '음성 생성중...' : '음성 생성') + '</button>' +
      '</div>' +
      '<div class="voice-player" data-id="' + scene.id + '" style="margin-top:10px;">' +
      '<audio controls preload="auto" style="width:100%;" ' + (audioPlayableUrl ? '' : 'disabled') + ' src="' + (audioPlayableUrl || '') + '"></audio>' +
      '</div>' +
      (!voiceEnabled ? '<p class="muted small">프리프로덕션에서 나레이션/더빙을 켜야 음성 생성이 가능합니다.</p>' : '') +
      errorLine +
      '</div>'
    );
  }

  function buildSceneRowHtml(scene, header, options) {
    var opts = options || {};
    var statePayload = opts.statePayload || {};
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

    return (
      '<div class="scene-row" data-id="' + scene.id + '">' +
      '<div class="scene-cell story">' +
      '<div class="story-inner">' +
      '<p class="eyebrow">Scene ' + scene.id + '</p>' +
      '<p class="story-lines" data-id="' + scene.id + '">' + extractNarrationDisplay(scene.lines || '') + '</p>' +
      voiceBlock +
      '</div>' +
      '</div>' +
      '<div class="scene-cell prompt">' +
      '<p class="eyebrow">Common</p>' +
      '<p class="prompt-common" data-id="' + scene.id + '"' + (scene.editingPrompt ? ' contenteditable="true"' : '') + '>' + header + '</p>' +
      '<p class="eyebrow">Visual</p>' +
      '<p class="prompt-visual" data-id="' + scene.id + '"' + (scene.editingPrompt ? ' contenteditable="true"' : '') + '>' + (scene.shot || '') + '</p>' +
      '<p class="eyebrow">Duration</p>' +
      '<p class="prompt-duration" data-id="' + scene.id + '"' + (scene.editingPrompt ? ' contenteditable="true"' : '') + '>' + (Math.max(Number(scene.estSec) || 0, 1)) + 's.</p>' +
      '<div class="cell-actions br">' +
      (scene.editingPrompt
        ? '<button class="btn-secondary compact" data-action="save-prompt" data-id="' + scene.id + '">저장</button><button class="btn-ghost compact" data-action="cancel-prompt" data-id="' + scene.id + '">취소</button>'
        : '<button class="btn-ghost compact" data-action="edit-prompt" data-id="' + scene.id + '">편집</button>') +
      '</div>' +
      '</div>' +
      '<div class="scene-cell image"><div class="scene-media-stack"><div class="image-slot">' + img + '</div><div class="video-slot">' + videoCard + '</div></div></div>' +
      '<div class="scene-cell actions">' +
      '<div class="action-buttons grid">' +
      '<button class="btn-secondary compact span2" data-action="regen-image" data-id="' + scene.id + '"' + (scene.imgLoading ? ' disabled' : '') + '>' + (scene.imgLoading ? '이미지 생성중...' : '이미지 생성') + '</button>' +
      '<button class="btn-secondary compact" data-action="delete-image" data-id="' + scene.id + '"' + (scene.imageDataUrl ? '' : ' disabled') + '>삭제</button>' +
      '<button class="btn-secondary compact" data-action="upload-image" data-id="' + scene.id + '">업로드</button>' +
      '<button class="btn-secondary compact" data-action="library-image" data-id="' + scene.id + '">저장소</button>' +
      '<button class="btn-secondary compact" data-action="download-image" data-id="' + scene.id + '"' + (scene.imageDataUrl ? '' : ' disabled') + '>다운로드</button>' +
      '</div>' +
      '<div class="action-buttons grid video-actions">' +
      '<button class="btn-secondary compact span2" data-action="video" data-id="' + scene.id + '"' + (videoBusy ? ' disabled' : '') + '>' + (videoBusy ? '영상 생성중...' : '영상 생성') + '</button>' +
      '<button class="btn-secondary compact" data-action="delete-video" data-id="' + scene.id + '"' + (scene.videoUrl ? '' : ' disabled') + '>삭제</button>' +
      '<button class="btn-secondary compact" data-action="upload-video" data-id="' + scene.id + '">업로드</button>' +
      '<button class="btn-secondary compact" data-action="library-video" data-id="' + scene.id + '">저장소</button>' +
      '<button class="btn-secondary compact" data-action="download-video" data-id="' + scene.id + '"' + (scene.videoUrl ? '' : ' disabled') + '>다운로드</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  sceneRow.isVoiceFeatureEnabled = isVoiceFeatureEnabled;
  sceneRow.isSceneVideoProcessing = isSceneVideoProcessing;
  sceneRow.isSceneVoiceProcessing = isSceneVoiceProcessing;
  sceneRow.extractNarrationDisplay = extractNarrationDisplay;
  sceneRow.buildVoiceScriptForVideo = buildVoiceScriptForVideo;
  sceneRow.buildSceneRowHtml = buildSceneRowHtml;
})();
