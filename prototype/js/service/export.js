; (function () {
  var NK = window.NK || (window.NK = {});
  var service = NK.service || (NK.service = {});
  var exporter = service.exporter || (service.exporter = {});

  function firstFilled(values) {
    var src = Array.isArray(values) ? values : [];
    for (var i = 0; i < src.length; i++) {
      var value = String(src[i] || '').trim();
      if (value) return value;
    }
    return '';
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeWorksheetText(text) {
    return escapeHtml(String(text || '')).replace(/\n/g, '<br/>');
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toNumber(value, fallback) {
    var num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function sceneDuration(scene) {
    return Math.max(1, Math.round(toNumber(scene && (scene.estSec || scene.durationSec || scene.duration), 4)));
  }

  function sceneImageUrl(scene) {
    return firstFilled([
      scene && scene.imageDataUrl,
      scene && scene.imagePath,
      scene && scene.generatedImageUrl,
      scene && scene.imageUrl
    ]);
  }

  function sceneImageLink(scene) {
    return firstFilled([
      scene && scene.imagePath,
      scene && scene.generatedImageUrl,
      scene && scene.imageUrl
    ]);
  }

  function sceneNarrationText(scene, payload) {
    var narrationEnabled = payload && payload.narrationEnabled;
    if (!narrationEnabled) return '';
    return firstFilled([
      scene && scene.narration,
      scene && scene.script,
      scene && scene.videoSpeechPrompt
    ]);
  }

  function sceneVideoUrl(scene) {
    return firstFilled([
      scene && scene.videoUrl,
      scene && scene.videoPlaybackUrl,
      scene && scene.outputVideoUrl,
      scene && scene.generatedVideoUrl,
      scene && scene.videoPath
    ]);
  }

  function stripSpeakerTokens(text) {
    return String(text || '').replace(/@/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  function sceneNarration(scene) {
    return firstFilled([
      scene && scene.videoSpeechPrompt,
      scene && scene.script,
      scene && scene.narration,
      scene && scene.subtitleText,
      scene && scene.caption,
      scene && scene.lines,
      scene && scene.script
    ]);
  }

  function sceneVisual(scene) {
    return firstFilled([
      scene && scene.shot,
      scene && scene.visual,
      scene && scene.promptText
    ]);
  }

  function splitSubtitleText(text, maxChars) {
    var raw = String(text || '').replace(/\r/g, '').trim();
    var limit = Math.max(8, Number(maxChars) || 22);
    if (!raw) return [];
    if (raw.length <= limit) return [raw];

    var tokens = raw.match(/[^,\s.!?;:]+[,\s.!?;:]*/g) || [raw];
    var chunks = [];
    var current = '';

    function flush() {
      var normalized = String(current || '').trim();
      if (normalized) chunks.push(normalized);
      current = '';
    }

    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var candidate = (current + token).trim();
      if (!current) {
        current = token;
        continue;
      }
      if (candidate.length <= limit) {
        current += token;
        continue;
      }
      flush();
      if (String(token || '').trim().length <= limit) {
        current = token;
        continue;
      }
      var fragment = String(token || '').trim();
      while (fragment.length > limit) {
        chunks.push(fragment.slice(0, limit).trim());
        fragment = fragment.slice(limit).trim();
      }
      current = fragment;
    }
    flush();
    return chunks.length ? chunks : [raw];
  }

  function normalizeExplicitSubtitles(scene, baseStart, duration, sceneIndex, options) {
    var list = Array.isArray(scene && scene.subtitles) ? scene.subtitles : [];
    var clips = [];
    var maxChars = options && options.maxChars;
    for (var i = 0; i < list.length; i++) {
      var sub = list[i] || {};
      var subStart = clamp(toNumber(sub.start, 0), 0, Math.max(0, duration - 0.2));
      var subEndRaw = toNumber(sub.end, subStart + 1.2);
      var subEnd = clamp(subEndRaw, subStart + 0.2, duration);
      var rawText = firstFilled([sub.text, sub.caption, sub.label]);
      if (!rawText) continue;
      var pieces = splitSubtitleText(stripSpeakerTokens(rawText) || rawText, maxChars);
      var pieceDuration = Math.max(0.2, (subEnd - subStart) / Math.max(1, pieces.length));
      for (var j = 0; j < pieces.length; j++) {
        var start = subStart + (pieceDuration * j);
        var end = j === pieces.length - 1 ? subEnd : Math.min(subEnd, start + pieceDuration);
        clips.push({
          id: 'sub-' + sceneIndex + '-' + i + '-' + j,
          label: pieces[j],
          start: round3(baseStart + start),
          end: round3(baseStart + Math.max(start + 0.2, end)),
          baseDuration: Math.max(0.2, end - start)
        });
      }
    }
    return clips;
  }

  function normalizeFallbackSubtitles(scene, baseStart, duration, sceneIndex, options) {
    var rawText = firstFilled([scene && scene.subtitleText, scene && scene.caption, sceneNarration(scene)]);
    if (!rawText) return [];
    var pieces = splitSubtitleText(stripSpeakerTokens(rawText) || rawText, options && options.maxChars);
    if (!pieces.length) return [];
    var chunkDuration = Math.max(0.8, duration / Math.max(1, pieces.length));
    return pieces.map(function (piece, idx) {
      var start = chunkDuration * idx;
      var end = idx === pieces.length - 1 ? duration : Math.min(duration, start + chunkDuration);
      return {
        id: 'sub-' + sceneIndex + '-' + idx,
        label: piece,
        start: round3(baseStart + start),
        end: round3(baseStart + Math.max(start + 0.2, end)),
        baseDuration: Math.max(0.2, end - start)
      };
    });
  }

  function round3(value) {
    return Math.round((Number(value) || 0) * 1000) / 1000;
  }

  function toSrtTime(sec) {
    var s = Math.max(0, Number(sec) || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var rs = s % 60;
    var whole = Math.floor(rs);
    var ms = Math.round((rs - whole) * 1000);
    if (ms === 1000) {
      ms = 0;
      whole += 1;
    }
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(whole).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
  }

  function getProject(projectOrId) {
    if (!projectOrId) return null;
    if (typeof projectOrId === 'string') {
      return NK.service && NK.service.project && NK.service.project.getDraftById
        ? NK.service.project.getDraftById(projectOrId)
        : null;
    }
    return projectOrId;
  }

  function fileSafeName(text, fallback) {
    var safe = String(text || fallback || 'project').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
    safe = safe.replace(/\s+/g, ' ').trim();
    return safe || (fallback || 'project');
  }

  function downloadBlob(blob, filename) {
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(objectUrl); } catch (_) { }
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 180);
  }

  exporter.listSubtitleEntries = function (projectOrId, options) {
    var project = getProject(projectOrId);
    if (!project) return [];
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    var entries = [];
    var cursor = 0;
    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i] || {};
      var duration = sceneDuration(scene);
      var explicit = normalizeExplicitSubtitles(scene, cursor, duration, i, options);
      var resolved = explicit.length ? explicit : normalizeFallbackSubtitles(scene, cursor, duration, i, options);
      entries = entries.concat(resolved);
      cursor += duration;
    }
    return entries;
  };

  exporter.buildSrtText = function (projectOrId, options) {
    var entries = exporter.listSubtitleEntries(projectOrId, options);
    if (!entries.length) return '';
    return entries.map(function (entry, index) {
      return [
        String(index + 1),
        toSrtTime(entry.start) + ' --> ' + toSrtTime(entry.end),
        String(entry.label || '').trim(),
        ''
      ].join('\n');
    }).join('\n');
  };

  exporter.downloadSrt = function (projectOrId, options) {
    var project = getProject(projectOrId);
    var srtText = exporter.buildSrtText(project, options);
    if (!srtText) return false;
    var fileName = fileSafeName(project && project.title, 'captions') + '.srt';
    downloadBlob(new Blob([srtText], { type: 'text/plain;charset=utf-8' }), fileName);
    return true;
  };

  function createThumbnail(src, maxW, maxH) {
    return new Promise(function (resolve) {
      if (!src) return resolve('');
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) return resolve('');
          var scale = Math.min(maxW / w, maxH / h, 1);
          var tw = Math.round(w * scale);
          var th = Math.round(h * scale);
          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, tw, th);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        } catch (_) { resolve(''); }
      };
      img.onerror = function () { resolve(''); };
      img.src = src;
    });
  }

  exporter.downloadStoryboardXls = async function (projectOrId) {
    var project = getProject(projectOrId);
    if (!project) return false;
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;
    var payload = project.payload || {};
    var title = fileSafeName(project.title, 'storyboard');

    var thumbPromises = scenes.map(function (scene) {
      var src = firstFilled([
        scene && scene.imageDataUrl,
        scene && scene.imagePath,
        scene && scene.generatedImageUrl,
        scene && scene.imageUrl
      ]);
      return createThumbnail(src, 320, 200);
    });
    var thumbs = await Promise.all(thumbPromises);

    var rows = scenes.map(function (scene, index) {
      var duration = sceneDuration(scene);
      var subtitleRaw = firstFilled([scene.subtitleText, scene.caption, sceneNarration(scene)]);
      var subtitle = splitSubtitleText(stripSpeakerTokens(subtitleRaw) || subtitleRaw, 22).join(' / ');
      var narration = sceneNarrationText(scene, payload);
      var thumb = thumbs[index];
      var imageCell = thumb
        ? '<img src="' + thumb + '" width="240" height="160" style="object-fit:contain;" />'
        : '';
      return '<tr style="height:170px;">' +
        '<td>' + escapeWorksheetText(scene.id || (index + 1)) + '</td>' +
        '<td>' + escapeWorksheetText(firstFilled([scene.title, 'Scene ' + (index + 1)])) + '</td>' +
        '<td>' + escapeWorksheetText(duration + 's') + '</td>' +
        '<td>' + escapeWorksheetText(narration) + '</td>' +
        '<td>' + escapeWorksheetText(subtitle) + '</td>' +
        '<td>' + escapeWorksheetText(sceneVisual(scene)) + '</td>' +
        '<td style="width:260px;text-align:center;vertical-align:middle;">' + imageCell + '</td>' +
        '</tr>';
    }).join('');
    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
      'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="UTF-8">' +
      '<style>' +
      'table{border-collapse:collapse;font-family:Segoe UI,Apple SD Gothic Neo,sans-serif;font-size:12px;}' +
      'th,td{border:1px solid #cbd5e1;padding:8px;vertical-align:top;}' +
      'th{background:#0f172a;color:#fff;}' +
      'td{white-space:pre-wrap;word-break:break-word;}' +
      '</style></head><body>' +
      '<table>' +
      '<thead><tr>' +
      '<th>씬</th><th>제목</th><th>길이</th><th>나레이션</th><th>자막</th><th>비주얼</th><th>이미지</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></body></html>';
    downloadBlob(new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' }), title + '_storyboard.xls');
    return true;
  };

  exporter.getProjectFileName = function (projectOrId, separator) {
    var project = getProject(projectOrId);
    if (!project) return 'render';
    var title = fileSafeName(project.title, '');
    var payload = project.payload || {};
    var topic = fileSafeName(payload.topic || payload.episodeTitle || '', '');
    var sep = separator || ' - ';
    if (title && topic && title !== topic) return title + sep + topic;
    return title || topic || 'render';
  };

  exporter.downloadPremiereZip = async function (projectOrId) {
    if (typeof JSZip === 'undefined') {
      alert('JSZip 라이브러리를 찾을 수 없습니다.');
      return false;
    }
    var project = getProject(projectOrId);
    if (!project) return false;
    var scenes = Array.isArray(project.scenes) ? project.scenes : [];
    if (!scenes.length) return false;

    var fps = 30;
    var projectName = exporter.getProjectFileName(project);
    var zip = new JSZip();
    var mediaFolder = zip.folder('media');
    var clipEntries = [];
    var cursor = 0;

    for (var i = 0; i < scenes.length; i++) {
      var scene = scenes[i] || {};
      var dur = sceneDuration(scene);
      var url = firstFilled([
        scene.videoUrl, scene.videoPlaybackUrl, scene.outputVideoUrl,
        scene.generatedVideoUrl, scene.videoPath,
        scene.imagePath, scene.generatedImageUrl, scene.imageUrl
      ]);
      var isVideo = /\.(mp4|webm|mov)/i.test(url || '');
      var ext = isVideo ? (url.match(/\.(mp4|webm|mov)/i) || ['.mp4'])[0] : '.png';
      if (ext.charAt(0) !== '.') ext = '.' + ext;
      var mediaName = 'scene_' + (i + 1) + ext;
      var startFrame = Math.round(cursor * fps);
      var endFrame = Math.round((cursor + dur) * fps);

      // 미디어 파일 fetch
      if (url) {
        try {
          var resolvedUrl = url;
          if (NK.api && NK.api.mediaProxyObjectUrl && url.indexOf('gs://') === 0) {
            resolvedUrl = NK.api.mediaProxyObjectUrl(url.replace('gs://', ''));
          }
          var resp = await fetch(resolvedUrl, { credentials: 'include' });
          if (resp.ok) {
            var blob = await resp.blob();
            mediaFolder.file(mediaName, blob);
          }
        } catch (_) { }
      } else if (scene.imageDataUrl) {
        try {
          var dataResp = await fetch(scene.imageDataUrl);
          var dataBlob = await dataResp.blob();
          mediaFolder.file(mediaName, dataBlob);
          ext = '.png';
          mediaName = 'scene_' + (i + 1) + ext;
        } catch (_) { }
      }

      clipEntries.push({
        index: i,
        name: firstFilled([scene.title, 'Scene ' + (i + 1)]),
        mediaName: mediaName,
        start: startFrame,
        end: endFrame,
        duration: dur
      });
      cursor += dur;
    }

    var totalFrames = Math.round(cursor * fps);

    // FCP XML 7 생성
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE xmeml>\n' +
      '<xmeml version="5">\n' +
      '  <sequence>\n' +
      '    <name>' + escapeHtml(projectName) + '</name>\n' +
      '    <duration>' + totalFrames + '</duration>\n' +
      '    <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n' +
      '    <media>\n' +
      '      <video>\n' +
      '        <track>\n';

    for (var j = 0; j < clipEntries.length; j++) {
      var c = clipEntries[j];
      xml +=
        '          <clipitem id="clip_' + (j + 1) + '">\n' +
        '            <name>' + escapeHtml(c.name) + '</name>\n' +
        '            <duration>' + (c.end - c.start) + '</duration>\n' +
        '            <rate><timebase>' + fps + '</timebase><ntsc>FALSE</ntsc></rate>\n' +
        '            <start>' + c.start + '</start>\n' +
        '            <end>' + c.end + '</end>\n' +
        '            <in>0</in>\n' +
        '            <out>' + (c.end - c.start) + '</out>\n' +
        '            <file id="file_' + (j + 1) + '">\n' +
        '              <name>' + escapeHtml(c.mediaName) + '</name>\n' +
        '              <pathurl>media/' + escapeHtml(c.mediaName) + '</pathurl>\n' +
        '            </file>\n' +
        '          </clipitem>\n';
    }

    xml +=
      '        </track>\n' +
      '      </video>\n' +
      '    </media>\n' +
      '  </sequence>\n' +
      '</xmeml>';

    zip.file(projectName + '.xml', xml);

    var srtText = exporter.buildSrtText(project, { maxChars: 22 });
    if (srtText) {
      zip.file(projectName + '.srt', srtText);
    }

    var zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(zipBlob, projectName + '_premiere.zip');
    return true;
  };
})();
