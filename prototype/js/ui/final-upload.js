// 완성 콘텐츠 등록 — SNS 세팅(브랜드 스튜디오) 오른쪽 아래 '+' 버튼.
// 이미 만든 스토리·이미지·영상을 에피소드의 정식 데이터로 넣는다(서버: /api/project/final-upload → sequences op=finalUpload).
// 디렉터 확정과 같은 잠금이 걸려 시나리오·메인 프로덕션에선 '수정 불가', 내용은 어디서나 보이고, 영상 수정은 포스트 프로덕션에서 한다.
// 지금 에피소드에 컷이 있으면 덮어쓰지 않고 새 에피소드를 만들어 넣는다.
;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var finalUpload = ui.finalUpload || (ui.finalUpload = {});

  var IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
  var MAX_IMAGES = 40;
  // 서명 URL 로 바로 올리지 못할 때(브라우저 차단 등) 사이트를 거쳐 올리는 상한 — Worker 요청 본문 한도(약 100MB) 안쪽.
  var WORKER_UPLOAD_LIMIT = 95 * 1024 * 1024;

  var TEXT = {
    ko: {
      open: '완성 콘텐츠 등록',
      title: '완성 콘텐츠 등록',
      desc: '이미 만든 스토리·이미지·영상을 이 에피소드에 등록해요. 등록하면 시나리오와 메인 프로덕션에서는 수정할 수 없고(내용은 어디서나 보여요), 영상 수정은 포스트 프로덕션에서 해요. 이미 컷이 있는 에피소드라면 새 에피소드로 등록돼요.',
      nameLabel: '제목',
      namePh: '비우면 에피소드 제목을 써요',
      storyLabel: '스토리',
      storyPh: '영상·이미지에 담긴 이야기나 소개 글',
      imagesLabel: '이미지 (PNG·JPG·WEBP, 여러 장)',
      videoLabel: '영상 (MP4·MOV, 1개)',
      cancel: '취소',
      submit: '등록',
      empty: '스토리·이미지·영상 중 하나 이상 넣어 주세요.',
      noProject: '먼저 에피소드를 선택해 주세요.',
      badType: '지원하지 않는 파일 형식이에요: ',
      tooManyImages: '이미지는 한 번에 40장까지 등록할 수 있어요.',
      tooLarge: '파일이 너무 커서 올리지 못했어요: ',
      readingVideo: '영상 정보 읽는 중…',
      uploading: '올리는 중… ({done}/{total})',
      saving: '에피소드에 등록하는 중…',
      doneSame: '이 에피소드에 등록했어요.',
      doneNew: '컷이 있는 에피소드라 새 에피소드 "{title}"에 등록했어요.',
      failed: '등록하지 못했어요: ',
      sharedOccupied: '공유받은 에피소드에 이미 컷이 있어 새 에피소드를 만들 수 없어요. 빈 에피소드에서 등록해 주세요.'
    },
    en: {
      open: 'Register finished content',
      title: 'Register finished content',
      desc: 'Register a story, images or a finished video you already made into this episode. Once registered, Scenario and Main Production become read-only (the content stays visible everywhere) and the video is edited in Post-production. If this episode already has cuts, a new episode is created for it.',
      nameLabel: 'Title',
      namePh: 'Leave empty to use the episode title',
      storyLabel: 'Story',
      storyPh: 'The story or description of the video/images',
      imagesLabel: 'Images (PNG, JPG, WEBP — several)',
      videoLabel: 'Video (MP4, MOV — one)',
      cancel: 'Cancel',
      submit: 'Register',
      empty: 'Add at least a story, an image or a video.',
      noProject: 'Select an episode first.',
      badType: 'Unsupported file type: ',
      tooManyImages: 'You can register up to 40 images at once.',
      tooLarge: 'The file is too large to upload: ',
      readingVideo: 'Reading the video…',
      uploading: 'Uploading… ({done}/{total})',
      saving: 'Registering to the episode…',
      doneSame: 'Registered to this episode.',
      doneNew: 'This episode already had cuts, so it was registered to a new episode "{title}".',
      failed: 'Could not register: ',
      sharedOccupied: 'This shared episode already has cuts and a new episode cannot be created here. Register from an empty episode.'
    }
  };
  function lang() { return NK.state && NK.state.runtime && NK.state.runtime.lang === 'en' ? 'en' : 'ko'; }
  function t(key) { var d = TEXT[lang()] || TEXT.ko; return key in d ? d[key] : (TEXT.ko[key] || key); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function authToken() { try { return localStorage.getItem('nk_auth_token') || ''; } catch (_) { return ''; } }

  function currentContext() {
    var ctx = (ui.brandStudio && ui.brandStudio.currentContext) || {};
    return { projectId: String(ctx.projectId || '').trim(), ownerId: String(ctx.ownerId || '').trim(), title: String(ctx.title || '') };
  }

  // ─── 영상 정보: 길이·비율·첫 장면(스틸) ─────────────────────────
  function aspectOf(w, h) {
    if (!w || !h) return '';
    var r = w / h;
    var known = [['9:16', 9 / 16], ['16:9', 16 / 9], ['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['4:3', 4 / 3]];
    var best = known.reduce(function (a, b) { return Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a; });
    return Math.abs(best[1] - r) < 0.03 ? best[0] : '';
  }
  function readVideoMeta(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      var settled = false;
      var meta = { durationSec: 0, aspectRatio: '', still: null };
      function finish() {
        if (settled) return;
        settled = true;
        try { URL.revokeObjectURL(url); } catch (_) { }
        resolve(meta);
      }
      var timer = setTimeout(finish, 15000);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.onloadedmetadata = function () {
        meta.durationSec = Math.round((Number(video.duration) || 0) * 10) / 10;
        meta.aspectRatio = aspectOf(video.videoWidth, video.videoHeight);
        try { video.currentTime = Math.min(0.1, (Number(video.duration) || 0) / 2); } catch (_) { clearTimeout(timer); finish(); }
      };
      video.onseeked = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (blob) meta.still = new File([blob], 'still.jpg', { type: 'image/jpeg' });
            clearTimeout(timer);
            finish();
          }, 'image/jpeg', 0.9);
        } catch (_) { clearTimeout(timer); finish(); }
      };
      video.onerror = function () { clearTimeout(timer); finish(); };
      video.src = url;
    });
  }

  // ─── 파일 올리기: 서명 URL(PUT) 우선, 막히면 사이트 경유 ─────────────
  function uploadFile(projectId, file, kind) {
    var contentType = String(file.type || '');
    return fetch('/api/director/media-url', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + authToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ upload: { projectId: projectId, filename: file.name || ('upload.' + (kind === 'video' ? 'mp4' : 'jpg')), contentType: contentType } })
    }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('sign_failed')); })
      .then(function (signed) {
        return fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': signed.contentType || contentType }, body: file })
          .then(function (put) { if (!put.ok) throw new Error('put_failed'); return signed.gsUri; });
      })
      .catch(function () {
        if (file.size > WORKER_UPLOAD_LIMIT) throw new Error(t('tooLarge') + (file.name || ''));
        var job = kind === 'video'
          ? NK.api.videoUpload(projectId, 'final', file, {})
          : NK.api.imageUpload(projectId, file);
        return job.then(function (res) {
          var obj = res && (res.objectName || res.gcsPath);
          if (!obj) throw new Error('upload_failed');
          return obj;
        });
      });
  }

  // ─── 등록 후: 대상 에피소드를 현재로 두고 다시 연다 ────────────────
  function openTarget(projectId, created) {
    return NK.api.projectGet(projectId).then(function (res) {
      var data = (res && res.data) || res || {};
      var draft = { id: projectId, title: data.title || '', payload: data.payload || {}, scenes: data.scenes || [], aspectRatio: data.aspectRatio };
      try {
        if (NK.service && NK.service.project && NK.service.project.upsertLocalDraft) {
          NK.service.project.upsertLocalDraft(draft, { setCurrent: true });
        }
        if (NK.state && NK.state.broadcast) NK.state.broadcast('update-project', { project: draft });
      } catch (_) { }
    }).catch(function () { }).then(function () {
      if (created) {
        var url = new URL(window.location.href);
        url.searchParams.set('projectId', projectId);
        window.location.href = url.toString();
      } else {
        window.location.reload();
      }
    });
  }

  // ─── 창 ──────────────────────────────────────────────────────
  function closeDialog() {
    var el = document.getElementById('nk-final-upload-modal');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function openDialog() {
    var ctx = currentContext();
    if (!ctx.projectId) {
      if (NK.ui.dialog && NK.ui.dialog.alert) NK.ui.dialog.alert(t('noProject'));
      return;
    }
    closeDialog();
    var wrap = document.createElement('div');
    wrap.id = 'nk-final-upload-modal';
    wrap.className = 'nk-fu-backdrop';
    wrap.innerHTML = [
      '<div class="nk-fu-modal" role="dialog" aria-modal="true" aria-labelledby="nk-fu-title">',
        '<h3 id="nk-fu-title">' + esc(t('title')) + '</h3>',
        '<p class="nk-fu-desc">' + esc(t('desc')) + '</p>',
        '<label class="nk-fu-field"><span>' + esc(t('nameLabel')) + '</span><input type="text" id="nk-fu-name" maxlength="120" placeholder="' + esc(t('namePh')) + '" /></label>',
        '<label class="nk-fu-field"><span>' + esc(t('storyLabel')) + '</span><textarea id="nk-fu-story" rows="4" maxlength="20000" placeholder="' + esc(t('storyPh')) + '"></textarea></label>',
        '<label class="nk-fu-field"><span>' + esc(t('imagesLabel')) + '</span><input type="file" id="nk-fu-images" accept="' + IMAGE_TYPES.join(',') + '" multiple /></label>',
        '<label class="nk-fu-field"><span>' + esc(t('videoLabel')) + '</span><input type="file" id="nk-fu-video" accept="' + VIDEO_TYPES.join(',') + '" /></label>',
        '<div class="nk-fu-status" id="nk-fu-status" aria-live="polite"></div>',
        '<div class="nk-fu-actions">',
          '<button type="button" class="nk-fu-btn" data-fu="cancel">' + esc(t('cancel')) + '</button>',
          '<button type="button" class="nk-fu-btn nk-fu-btn--primary" data-fu="submit">' + esc(t('submit')) + '</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap && !wrap.dataset.busy) closeDialog();
      var action = e.target && e.target.closest ? e.target.closest('[data-fu]') : null;
      if (!action) return;
      if (action.getAttribute('data-fu') === 'cancel' && !wrap.dataset.busy) closeDialog();
      if (action.getAttribute('data-fu') === 'submit') submit(wrap, ctx);
    });
  }

  function setStatus(wrap, message, isError) {
    var el = wrap.querySelector('#nk-fu-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', !!isError);
  }
  function setBusy(wrap, busy) {
    if (busy) wrap.dataset.busy = '1'; else delete wrap.dataset.busy;
    wrap.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = !!busy; });
  }

  function submit(wrap, ctx) {
    if (wrap.dataset.busy) return;
    var name = String(wrap.querySelector('#nk-fu-name').value || '').trim();
    var story = String(wrap.querySelector('#nk-fu-story').value || '').trim();
    var images = Array.prototype.slice.call(wrap.querySelector('#nk-fu-images').files || []);
    var video = (wrap.querySelector('#nk-fu-video').files || [])[0] || null;
    if (!story && !images.length && !video) { setStatus(wrap, t('empty'), true); return; }
    if (images.length > MAX_IMAGES) { setStatus(wrap, t('tooManyImages'), true); return; }
    var bad = images.filter(function (f) { return IMAGE_TYPES.indexOf(f.type) === -1; })
      .concat(video && VIDEO_TYPES.indexOf(video.type) === -1 ? [video] : []);
    if (bad.length) { setStatus(wrap, t('badType') + bad.map(function (f) { return f.name; }).join(', '), true); return; }

    setBusy(wrap, true);
    var total = images.length + (video ? 2 : 0);
    var done = 0;
    function progress() { setStatus(wrap, t('uploading').replace('{done}', done).replace('{total}', total)); }
    var body = { projectId: ctx.projectId, title: name, story: story, images: [], video: null };
    if (ctx.ownerId) body.ownerId = ctx.ownerId;

    var chain = Promise.resolve();
    if (video) {
      chain = chain.then(function () {
        setStatus(wrap, t('readingVideo'));
        return readVideoMeta(video);
      }).then(function (meta) {
        if (!meta.still) total -= 1;
        progress();
        return uploadFile(ctx.projectId, video, 'video').then(function (obj) {
          done += 1; progress();
          body.video = { object: obj, durationSec: meta.durationSec, aspectRatio: meta.aspectRatio, still: '' };
          if (!meta.still) return null;
          return uploadFile(ctx.projectId, meta.still, 'image').then(function (stillObj) {
            done += 1; progress();
            body.video.still = stillObj;
          });
        });
      });
    }
    images.forEach(function (file) {
      chain = chain.then(function () {
        progress();
        return uploadFile(ctx.projectId, file, 'image').then(function (obj) { done += 1; body.images.push(obj); });
      });
    });
    chain.then(function () {
      setStatus(wrap, t('saving'));
      return fetch('/api/project/final-upload', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok || !data.ok) throw new Error(String((data && data.error) || ('HTTP ' + r.status)));
          return data;
        });
      });
    }).then(function (data) {
      var message = data.created ? t('doneNew').replace('{title}', data.title || '') : t('doneSame');
      if (NK.ui.toast) NK.ui.toast(message, { tone: 'ok', ms: 4000 });
      return openTarget(String(data.projectId), !!data.created);
    }).catch(function (err) {
      var msg = String((err && err.message) || err || '');
      setBusy(wrap, false);
      setStatus(wrap, msg === 'final_upload_shared_episode_occupied' ? t('sharedOccupied') : (t('failed') + msg), true);
    });
  }

  // ─── 오른쪽 아래 '+' 버튼(글자 없음) ─────────────────────────────
  function mountFab() {
    if (document.getElementById('nk-final-upload-fab')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'nk-final-upload-fab';
    btn.className = 'nk-fu-fab';
    // Lucide plus
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
    function label() { btn.setAttribute('aria-label', t('open')); btn.title = t('open'); }
    label();
    window.addEventListener('nk:lang-changed', function () {
      label();
      // 열린 창은 올리는 중이 아니면 새 언어로 다시 연다.
      var open = document.getElementById('nk-final-upload-modal');
      if (open && !open.dataset.busy) openDialog();
    });
    btn.addEventListener('click', openDialog);
    document.body.appendChild(btn);
  }

  finalUpload.open = openDialog;
  finalUpload.mount = mountFab;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFab);
  else mountFab();
})();
