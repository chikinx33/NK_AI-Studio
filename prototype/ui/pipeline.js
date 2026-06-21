; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.uiPipeline || (NK.uiPipeline = {});
  var ctx = null;
  var lastProjectId = null;
  var subscribed = false;
  var __pipelineSpinnerAt = 0;
  // 샘플 보이스 파일 URL (짧은 무음 wav)
  var SAMPLE_VOICE_URL = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  var getProjectId = function () {
    if (lastProjectId) return lastProjectId;
    var resolved = NK.service && NK.service.project && NK.service.project.getCurrentProjectId
      ? NK.service.project.getCurrentProjectId({ search: window.location.search })
      : '';
    return resolved || null;
  };

  // 공통 모달 / 다운로드 헬퍼
  async function downloadFile(url, filename) {
    try {
      if (!url) return;
      var playableUrl = toPlayableMediaUrl(url);
      let blob;
      if (url.startsWith('data:')) {
        const arr = url.split(',');
        const mime = arr[0].match(/:(.*?);/)[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8 = new Uint8Array(n);
        while (n--) u8[n] = bstr.charCodeAt(n);
        blob = new Blob([u8], { type: mime });
      } else {
        const res = await fetch(playableUrl);
        blob = await res.blob();
      }
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        document.body.removeChild(a);
      }, 100);
    } catch (e) {
      console.error('download failed', e);
      alert('다운로드 실패: ' + (e && e.message ? e.message : e));
    }
  }

  function openImageModal(src) {
    const modal = document.getElementById('img-modal');
    if (!modal || !src) return;
    const img = modal.querySelector('img');
    img.src = toPlayableMediaUrl(src);
    modal.classList.remove('hidden');
  }

  function openVideoModal(src) {
    const modal = document.getElementById('video-modal');
    if (!modal || !src) return;
    const video = modal.querySelector('video');
    video.src = toPlayableMediaUrl(src);
    video.load();
    modal.classList.remove('hidden');
  }

  function openLibraryModal(items, kind, onSelect, projectId) {
    const modal = document.getElementById('lib-modal');
    if (!modal) return;
    const box = modal.querySelector('.lib-content');
    const kindLabel = kind === 'video' ? '영상' : '이미지';
    if (!box) return;

    if (!document.getElementById('lib-dnd-style')) {
      var __libStyle = document.createElement('style');
      __libStyle.id = 'lib-dnd-style';
      __libStyle.textContent = '.lib-item.lib-dragging{opacity:.4;} .lib-item.lib-drop-target{outline:2px dashed var(--accent,#7bd7ff);outline-offset:2px;border-radius:8px;}';
      document.head.appendChild(__libStyle);
    }

    let selectedNames = new Set();
    let deleting = false;

    // 라이브러리(저장소)에서 미디어를 삭제하면, 그 객체를 참조하던 씬/컷의 미디어 필드도 비운다.
    // 안 그러면 GCS 에서 지워졌는데도 컷에는 삭제된 영상/이미지가 계속 표시되는 회귀가 생긴다.
    function purgeDeletedMediaFromScenes(deletedSet) {
      try {
        if (!ctx || !ctx.getState || !ctx.setState || !deletedSet || !deletedSet.size) return;
        var st = ctx.getState();
        if (!st || !Array.isArray(st.scenes)) return;
        var isVideo = (kind === 'video');
        var refMatches = function (ref) {
          if (!ref || typeof ref !== 'string') return false;
          if (deletedSet.has(ref)) return true;
          var on = extractObjectNameFromMediaRef(ref);
          return !!on && deletedSet.has(on);
        };
        var hit = function (o) {
          var refs = isVideo
            ? [o.videoUrl, o.videoPath, o.videoPlaybackUrl, o.generatedVideoUrl]
            : [o.imageDataUrl, o.imagePath, o.generatedImageUrl, o.imageUrl];
          return refs.some(refMatches);
        };
        var clearFn = function (o) {
          return isVideo
            ? Object.assign({}, o, {
                videoUrl: '', videoPath: '', videoPlaybackUrl: '', generatedVideoUrl: '',
                videoStatus: '', videoError: '', videoJobId: '', videoMethod: '',
                lastFrameDataUrl: '', videoModelLabel: ''
              })
            : Object.assign({}, o, { imageDataUrl: '', imagePath: '', generatedImageUrl: '', imageUrl: '' });
        };
        var changed = false;
        var newScenes = st.scenes.map(function (s) {
          if (!s || typeof s !== 'object') return s;
          var ns = hit(s) ? (changed = true, clearFn(s)) : s;
          if (Array.isArray(s.shots) && s.shots.length) {
            var shotsChanged = false;
            var newShots = s.shots.map(function (sh) {
              if (sh && typeof sh === 'object' && hit(sh)) { shotsChanged = true; return clearFn(sh); }
              return sh;
            });
            if (shotsChanged) { ns = Object.assign({}, ns, { shots: newShots }); changed = true; }
          }
          return ns;
        });
        if (!changed) return;
        st.scenes = newScenes;
        ctx.setState(st);
        if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
        if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline();
        try {
          var pid = st.draftId || projectId;
          if (pid && NK.api && NK.api.projectSave) {
            NK.api.projectSave(pid, st.payload || {}, st.scenes || [], {
              header: st.header || '', aspectRatio: st.aspectRatio || ''
            }).catch(function () {});
          }
        } catch (_) {}
      } catch (_) {}
    }

    // 사용자가 드래그로 정한 순서를 프로젝트·종류별로 저장(저장소 보기 전용).
    function orderKey() {
      return 'nk_lib_order_' + String(kind || 'image') + '_' + String(projectId || 'default');
    }
    function loadOrder() {
      try {
        var v = JSON.parse(localStorage.getItem(orderKey()) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (_) { return []; }
    }
    function saveOrder() {
      try {
        localStorage.setItem(orderKey(), JSON.stringify(currentItems.map(function (it) { return String(it && it.name || ''); })));
      } catch (_) {}
    }
    // 저장된 순서가 있으면 그대로, 없으면 최신 항목이 앞에 오도록 역순.
    function applyInitialOrder(arr) {
      var base = (Array.isArray(arr) ? arr.slice() : []).reverse();
      var saved = loadOrder();
      if (!saved.length) return base;
      var pos = {};
      saved.forEach(function (n, i) { pos[n] = i; });
      return base.sort(function (a, b) {
        var ai = Object.prototype.hasOwnProperty.call(pos, String(a && a.name || '')) ? pos[String(a.name)] : Infinity;
        var bi = Object.prototype.hasOwnProperty.call(pos, String(b && b.name || '')) ? pos[String(b.name)] : Infinity;
        return ai - bi;
      });
    }

    let currentItems = applyInitialOrder(items);

    function getSelectedItems() {
      return currentItems.filter(function (it) {
        return selectedNames.has(String(it && it.name || ''));
      });
    }

    function syncActionState() {
      const selectedItems = getSelectedItems();
      const singleSelected = selectedItems.length === 1 ? selectedItems[0] : null;
      const useBtn = box.querySelector('#lib-use-btn');
      const deleteBtn = box.querySelector('#lib-delete-btn');
      const countEl = box.querySelector('#lib-selection-count');
      // 사용: 정확히 1개 선택 시에만(다중 선택이면 비활성). 삭제: 1개 이상.
      const canUse = !deleting && !!(singleSelected && singleSelected.name);
      const canDelete = !deleting && selectedItems.length > 0;

      if (useBtn) {
        useBtn.disabled = !canUse;
        useBtn.classList.toggle('disabled', useBtn.disabled);
      }
      if (deleteBtn) {
        deleteBtn.disabled = !canDelete;
        deleteBtn.classList.toggle('disabled', !canDelete);
        deleteBtn.textContent = deleting ? '삭제 중...' : '삭제';
      }
      if (countEl) {
        countEl.textContent = selectedItems.length ? ('선택 ' + selectedItems.length + '개') : '';
      }
    }

    let dragFromIdx = -1;
    let didReorder = false;

    function bindGridEvents() {
      const itemEls = box.querySelectorAll('.lib-item');
      itemEls.forEach(function (itemEl) {
        itemEl.onclick = function () {
          if (deleting) return;
          if (didReorder) { didReorder = false; return; } // 드래그 직후의 클릭은 무시
          const idx = Number(itemEl.dataset.idx || -1);
          const target = (idx >= 0 && idx < currentItems.length) ? currentItems[idx] : null;
          const name = String(target && target.name || '');
          if (!name) return;
          // 항상 다중 선택: 클릭하면 토글
          if (selectedNames.has(name)) selectedNames.delete(name);
          else selectedNames.add(name);
          renderGridState();
          syncActionState();
        };

        // ── 드래그&드롭 재정렬 ──
        itemEl.ondragstart = function (e) {
          if (deleting) { e.preventDefault(); return; }
          dragFromIdx = Number(itemEl.dataset.idx || -1);
          didReorder = false;
          itemEl.classList.add('lib-dragging');
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragFromIdx)); } catch (_) {}
        };
        itemEl.ondragover = function (e) {
          e.preventDefault();
          try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
          itemEl.classList.add('lib-drop-target');
        };
        itemEl.ondragleave = function () {
          itemEl.classList.remove('lib-drop-target');
        };
        itemEl.ondrop = function (e) {
          e.preventDefault();
          itemEl.classList.remove('lib-drop-target');
          const toIdx = Number(itemEl.dataset.idx || -1);
          if (dragFromIdx < 0 || toIdx < 0 || dragFromIdx === toIdx) return;
          if (dragFromIdx >= currentItems.length || toIdx >= currentItems.length) return;
          const moved = currentItems.splice(dragFromIdx, 1)[0];
          currentItems.splice(toIdx, 0, moved);
          didReorder = true;
          saveOrder();
          render();
        };
        itemEl.ondragend = function () {
          itemEl.classList.remove('lib-dragging');
          box.querySelectorAll('.lib-drop-target').forEach(function (el) { el.classList.remove('lib-drop-target'); });
          dragFromIdx = -1;
        };
      });
    }

    function renderGridState() {
      const itemEls = box.querySelectorAll('.lib-item');
      itemEls.forEach(function (itemEl) {
        const idx = Number(itemEl.dataset.idx || -1);
        const target = (idx >= 0 && idx < currentItems.length) ? currentItems[idx] : null;
        const active = !!(target && selectedNames.has(String(target.name || '')));
        itemEl.classList.toggle('lib-selected', active);
        itemEl.classList.toggle('selected', active);
        itemEl.classList.add('lib-multi-select');
      });
    }

    function render() {
      const hasItems = currentItems.length > 0;
      const list = currentItems.map(function (it, idx) {
        const name = String(it && it.name || '');
        const url = (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(name) : '';
        const thumb = (kind === 'image')
          ? '<img class="lib-thumb" src="' + url + '" alt="" />'
          : '<video class="lib-thumb" src="' + url + '" muted playsinline preload="metadata"></video>';
        return (
          '<div class="lib-item" data-idx="' + idx + '" draggable="true" style="background:none;box-shadow:none;cursor:move;">' +
          thumb +
          '</div>'
        );
      }).join('');

      box.innerHTML = '' +
        '<div class="lib-header">' +
        '<span class="lib-title">라이브러리</span>' +
        '<span class="lib-selection-count muted" id="lib-selection-count"></span>' +
        '<div class="lib-header-spacer"></div>' +
        '<div class="lib-toolbar">' +
        '<button class="btn-primary" id="lib-use-btn"' + (hasItems ? '' : ' disabled') + '>사용</button>' +
        '<button class="btn-ghost" id="lib-delete-btn" disabled>삭제</button>' +
        '<button class="btn-secondary lib-close-btn" id="lib-close">닫기</button>' +
        '</div>' +
        '</div>' +
        (hasItems
          ? '<div class="lib-grid">' + list + '</div>'
          : '<div class="lib-empty"><p class="muted">항목이 없습니다.</p></div>');

      const closeBtn = box.querySelector('#lib-close');
      const useBtn = box.querySelector('#lib-use-btn');
      const deleteBtn = box.querySelector('#lib-delete-btn');

      if (closeBtn) closeBtn.onclick = function () { closeModals(); };
      if (useBtn) {
        useBtn.onclick = function () {
          const selectedItems = getSelectedItems();
          const selected = selectedItems.length === 1 ? selectedItems[0] : null;
          const url = selected && selected.name && NK.api && NK.api.mediaProxyObjectUrl
            ? NK.api.mediaProxyObjectUrl(selected.name)
            : '';
          if (!selected || !url) {
            alert(kindLabel + '를 먼저 선택하세요.');
            return;
          }
          if (onSelect) onSelect(url);
          closeModals();
        };
      }
      if (deleteBtn) {
        deleteBtn.onclick = async function () {
          if (!projectId) { alert('프로젝트 ID를 찾을 수 없습니다.'); return; }
          const selectedItems = getSelectedItems();
          const names = selectedItems.map(function (it) { return String(it && it.name || ''); }).filter(Boolean);
          if (!names.length) { alert('삭제할 ' + kindLabel + '를 선택하세요.'); return; }
          const confirmMessage = names.length > 1
            ? (kindLabel + ' ' + names.length + '개를 삭제하시겠습니까?')
            : ('이 ' + kindLabel + '를 삭제하시겠습니까?');
          if (!window.confirm(confirmMessage)) return;
          deleting = true;
          syncActionState();
          try {
            const res = await NK.api.projectDelete(projectId, names);
            if (!res.ok || !res.data || Number(res.data.deletedCount || 0) < 1) {
              throw new Error(res.error || (res.data && res.data.error) || 'delete_failed');
            }
            const results = Array.isArray(res.data && res.data.results) ? res.data.results : [];
            const deletedSet = new Set(results
              .filter(function (item) { return Number(item && item.status) === 204; })
              .map(function (item) { return String(item && item.name || ''); })
              .filter(Boolean));
            if (!deletedSet.size) {
              throw new Error(res.error || (res.data && res.data.error) || 'delete_failed');
            }
            currentItems = currentItems.filter(function (it) {
              return !deletedSet.has(String(it && it.name || ''));
            });
            selectedNames = new Set();
            // 삭제된 미디어를 참조하던 씬/컷의 미디어 필드도 비워 표시 잔존을 막는다.
            purgeDeletedMediaFromScenes(deletedSet);
            render();
            if (deletedSet.size !== names.length) {
              alert(kindLabel + ' 일부만 삭제되었습니다.');
            }
          } catch (err) {
            alert(kindLabel + ' 삭제 실패: ' + (err && err.message ? err.message : err));
          } finally {
            deleting = false;
            syncActionState();
          }
        };
      }

      bindGridEvents();
      renderGridState();
      syncActionState();
    }

    render();
    modal.classList.remove('hidden');
  }

  // 컷 기반 레퍼런스 선택 모달. 저장소(lib-modal)와 같은 그리드 UI 를 재사용하되,
  // 항목은 "현재 프로젝트의 다른 컷 중 이미지가 있는 것"으로 채운다. 드롭다운으로 cut N 만
  // 보면 어떤 그림인지 알기 어렵다는 요청에 따라 썸네일로 고르게 한다.
  function openCutRefModal(scenes, currentSceneId, selectedId, onSelect) {
    var modal = document.getElementById('lib-modal');
    if (!modal) return;
    var box = modal.querySelector('.lib-content');
    if (!box) return;

    var esc = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    var candidates = (Array.isArray(scenes) ? scenes : []).filter(function (s) {
      return s && String(s.id) !== String(currentSceneId) && s.imageDataUrl;
    });
    var chosenId = String(selectedId || '');

    // 이 에피소드의 "공간 배경 플레이트"(배경 레퍼런스 모달에서 생성한 것)도 레퍼런스로 고를 수 있게
    // 목록에 추가한다. 컷이 이전 컷 통짜를 베끼는 대신 깨끗한 배경만 참조 → 배경 일관·구도 자유.
    // 선택 시 cutRefId 는 "loc:<locationId>" 형태로 저장된다.
    var locPlates = [];
    try {
      var _stx = (ctx && ctx.getState) ? ctx.getState() : null;
      var _eps = (_stx && _stx.payload && Array.isArray(_stx.payload.episodeLocations)) ? _stx.payload.episodeLocations : [];
      _eps.forEach(function (l) {
        if (l && l.refObjectName) {
          locPlates.push({
            locId: String(l.id || l.name || ''),
            name: String(l.name || '장소'),
            url: (NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(l.refObjectName) : ''
          });
        }
      });
    } catch (_) {}

    // 저장소에서 삭제된 이미지의 죽은 참조(예: 502 나는 /api/media/proxy URL)가 컷에 남아 있으면
    // 컷 선택 모달에 뜨고, 그걸 레퍼런스로 생성하면 OpenAI edits(지역 차단 취약) 경로로 빠져
    // 무한로딩처럼 보인다. 썸네일 로드 실패를 감지하면 해당 컷의 죽은 이미지 필드와, 그 컷을
    // 가리키던 다른 컷의 cutRefId 를 상태에서 비워(self-heal) 다시는 선택/사용되지 않게 한다.
    function clearDeadCut(deadId) {
      try {
        if (!ctx || !ctx.getState || !ctx.setState) return;
        var stx = ctx.getState();
        if (!stx || !Array.isArray(stx.scenes)) return;
        var changed = false;
        stx.scenes = stx.scenes.map(function (s) {
          if (!s || typeof s !== 'object') return s;
          var ns = s;
          if (String(s.id) === String(deadId)) {
            ns = Object.assign({}, ns, { imageDataUrl: '', imagePath: '', generatedImageUrl: '', imageUrl: '' });
            changed = true;
          }
          if (String(ns.cutRefId == null ? '' : ns.cutRefId) === String(deadId)) {
            ns = Object.assign({}, ns, { cutRefId: '' });
            changed = true;
          }
          return ns;
        });
        if (!changed) return;
        ctx.setState(stx);
        if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render();
        if (ctx.persistPipeline) ctx.persistPipeline();
        if (ctx.updateDraftFromPipeline) ctx.updateDraftFromPipeline();
      } catch (_) {}
    }

    function render() {
      var hasCuts = candidates.length > 0;
      var hasPlates = locPlates.length > 0;
      var list = candidates.map(function (s) {
        var url = toPlayableMediaUrl(s.imageDataUrl);
        var lbl = esc(s.displayLabel || ('cut ' + s.id));
        var active = String(s.id) === chosenId;
        return (
          '<div class="lib-item cut-ref-pick-item' + (active ? ' lib-selected selected' : '') + '" data-id="' + esc(s.id) + '" title="' + lbl + '">' +
          '<img class="lib-thumb" src="' + esc(url) + '" alt="" />' +
          '<span class="cut-ref-pick-thumb-label">' + lbl + '</span>' +
          '</div>'
        );
      }).join('');
      var plateList = locPlates.map(function (p) {
        var id = 'loc:' + p.locId;
        var active = String(id) === chosenId;
        return (
          '<div class="lib-item cut-ref-pick-item' + (active ? ' lib-selected selected' : '') + '" data-id="' + esc(id) + '" data-loc="1" title="' + esc(p.name) + ' (공간 배경)">' +
          '<img class="lib-thumb" src="' + esc(p.url) + '" alt="" />' +
          '<span class="cut-ref-pick-thumb-label">📍 ' + esc(p.name) + '</span>' +
          '</div>'
        );
      }).join('');

      box.innerHTML = '' +
        '<div class="lib-header">' +
        '<span class="lib-title">컷 기반 레퍼런스 선택</span>' +
        '<span class="muted">' + ((hasPlates || hasCuts) ? '배경 일관성 기준이 될 공간/컷을 고르세요' : '') + '</span>' +
        '<div class="lib-header-spacer"></div>' +
        '<div class="lib-toolbar">' +
        '<button class="btn-primary" id="cutref-use-btn"' + (chosenId ? '' : ' disabled') + '>사용</button>' +
        '<button class="btn-ghost" id="cutref-clear-btn">선택 해제</button>' +
        '<button class="btn-secondary lib-close-btn" id="cutref-close">닫기</button>' +
        '</div>' +
        '</div>' +
        (hasPlates ? '<div class="cutref-subhead">공간 배경 (이 에피소드)</div><div class="lib-grid">' + plateList + '</div>' : '') +
        (hasCuts ? '<div class="cutref-subhead">다른 컷 이미지</div><div class="lib-grid">' + list + '</div>' : '') +
        ((!hasPlates && !hasCuts)
          ? '<div class="lib-empty"><p class="muted">참조할 공간 배경이나 다른 컷 이미지가 없어요. 상단 “배경 레퍼런스”에서 배경을 생성하거나, 다른 컷의 이미지를 먼저 만들어 주세요.</p></div>'
          : '');

      box.querySelectorAll('.cut-ref-pick-item').forEach(function (el) {
        var itemSceneId = String(el.dataset.id || '');
        var isLoc = el.dataset.loc === '1';
        var thumb = el.querySelector('img.lib-thumb');
        if (thumb) {
          thumb.onerror = function () {
            // 삭제된(로드 실패) 이미지: 선택 불가 처리.
            el.classList.add('cut-ref-pick-broken');
            el.onclick = null;
            el.ondblclick = null;
            var lbl2 = el.querySelector('.cut-ref-pick-thumb-label');
            if (lbl2) lbl2.textContent = '없음';
            el.title = '이미지를 불러올 수 없어요 — 선택할 수 없어요';
            if (chosenId === itemSceneId) {
              chosenId = '';
              var ub = box.querySelector('#cutref-use-btn');
              if (ub) ub.disabled = true;
            }
            // 공간 배경 플레이트는 씬이 아니므로 죽은-컷 self-heal 대상이 아니다(컷만 정리).
            if (!isLoc) {
              candidates = candidates.filter(function (s) { return String(s.id) !== itemSceneId; });
              clearDeadCut(itemSceneId);
            }
          };
        }
        el.onclick = function () {
          chosenId = String(el.dataset.id || '');
          render();
        };
        // 더블클릭은 선택 즉시 적용.
        el.ondblclick = function () {
          chosenId = String(el.dataset.id || '');
          if (onSelect) onSelect(chosenId);
          closeModals();
        };
      });
      var useBtn = box.querySelector('#cutref-use-btn');
      if (useBtn) useBtn.onclick = function () {
        if (!chosenId) { alert('레퍼런스로 쓸 컷을 선택하세요.'); return; }
        if (onSelect) onSelect(chosenId);
        closeModals();
      };
      var clearBtn = box.querySelector('#cutref-clear-btn');
      if (clearBtn) clearBtn.onclick = function () {
        if (onSelect) onSelect('');
        closeModals();
      };
      var closeBtn = box.querySelector('#cutref-close');
      if (closeBtn) closeBtn.onclick = function () { closeModals(); };
    }

    render();
    modal.classList.remove('hidden');
  }

  function closeModals() {
    ['img-modal', 'video-modal', 'lib-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m) m.classList.add('hidden');
      if (id === 'video-modal') {
        const v = m && m.querySelector('video');
        if (v) { v.pause(); v.src = ''; }
      }
    });
  }

  function isBucketVideoUrl(url) {
    var raw = String(url || '').trim();
    if (!raw) return false;
    if (raw.indexOf('data:video/') === 0) return true;
    if (raw.indexOf('gs://') === 0) return true;
    try {
      var u = new URL(raw);
      return u.hostname === 'storage.googleapis.com';
    } catch (_) {
      return raw.indexOf('storage.googleapis.com') >= 0;
    }
  }

  // Header에서 화면비/분량 문구를 제거해 프롬프트에 중복 반영되지 않도록 정리
  function cleanHeader(text) {
    if (!text) return '';
    const stripTokens = (line) => {
      return line
        .replace(/비주얼\s*스타일[^.\n]*/gi, '')
        .replace(/종횡비[^.\n]*/gi, '')
        .replace(/^\s*\d+\s*:\s*\d+\s*$/g, '') // 16:9 등 비율만 있는 줄 제거
        .replace(/[#>\-\s]*\d+\s*:\s*\d+\s*/gi, '') // 문장 내 비율 토큰 제거
        .replace(/aspect\s*ratio[^.\n]*/gi, '')
        .replace(/화면\s*비율[^.\n]*/gi, '')
        .replace(/target\s*duration[^.\n]*/gi, '')
        .replace(/[#>\-\s]*타겟\s*[:.]?\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/[#>\-\s]*target\s*[:.]?\s*\d+\s*s?\s*[.]?/gi, '')
        .replace(/타겟\s*\d+\s*(초|s)?\s*[.]?/gi, '')
        .replace(/^\s*\d+\s*(초|s)\s*$/gi, '')
        .replace(/분량[^.\n]*/gi, '')
        .replace(/연속성[^.\n]*/gi, '')
        .replace(/이야기의?\s*흐름[^.\n]*/gi, '')
        .replace(/흐름이\s*자연스럽[^.\n]*/gi, '')
        .replace(/매끄럽게\s*연결[^.\n]*/gi, '')
        .replace(/일관되도록\s*유지[^.\n]*/gi, '')
        .replace(/필수\s*지침\s*없음/gi, '')
        .replace(/규칙\s*없음/gi, '')
        .replace(/^#+\s*/g, '') // Markdown 헤더 기호 제거
        .replace(/##+/g, '') // 남은 이중 해시 제거
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    return String(text)
      .split(/\n+/)
      .map(stripTokens)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  function setPipelineLoading(show) {
    const overlay = document.getElementById('pipeline-loading');
    if (overlay) overlay.classList.toggle('hidden', !show);
    const blurTargets = [
      document.getElementById('pipeline-scenes'),
      document.getElementById('pipeline-meta')
    ];
    blurTargets.forEach(el => {
      if (!el) return;
      el.classList.toggle('blurred-content', show);
      el.style.pointerEvents = show ? 'none' : '';
    });
  }

  function setPipelinePageLoading(show, message) {
    const pipelineOverlay = document.getElementById('pipeline-loading');
    if (show && pipelineOverlay) pipelineOverlay.classList.add('hidden');
    if (NK.core && NK.core.setLoading) {
      NK.core.setLoading(!!show, message || '로딩중...');
      return;
    }
    const overlay = document.getElementById('page-loading');
    if (overlay) overlay.classList.toggle('hidden', !show);
    const main = document.querySelector('.main');
    if (main) main.classList.toggle('loading-blur', !!show);
  }

  var getProjectTitle = function () {
    if (NK.service && NK.service.project && NK.service.project.getCurrentProjectTitle) {
      return NK.service.project.getCurrentProjectTitle({ search: window.location.search }) || '';
    }
    return '';
  };
  ui.init = function (c) {
    ctx = c || {};
    ui.__ctx = ctx; // 외부 헬퍼가 ctx에 접근할 수 있도록 공유
    // 가장 최근 사용 시점 기록 (대시보드 카드 하이라이트용)
    try {
      var pid = (NK.service && NK.service.project && NK.service.project.getCurrentProjectId)
        ? NK.service.project.getCurrentProjectId({ search: window.location.search })
        : (new URLSearchParams(window.location.search).get('projectId') || '');
      if (pid && NK.service && NK.service.project && NK.service.project.markUsed) {
        NK.service.project.markUsed(pid);
      }
    } catch (_) {}
  };
  // 영상 모델 셀렉트 전용 스타일을 주입해 테마에 맞는 형태로 표시
  (function injectVideoModelStyle() {
    if (document.getElementById('video-model-style')) return;
    var style = document.createElement('style');
    style.id = 'video-model-style';
    style.textContent = `
      .video-model-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        flex-wrap: wrap;
        padding-left: 6px;
      }
      .video-model-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 220px;
        padding-left: 4px;
      }
      .video-model-select {
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        padding: 8px 36px 8px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.14);
        background: linear-gradient(135deg, rgba(15, 26, 46, 0.9), rgba(11, 20, 36, 0.85));
        color: #e8f1ff;
        font-size: 13px;
        line-height: 1.4;
        position: relative;
        box-shadow: 0 0 0 1px rgba(123,215,255,0.25), 0 6px 16px rgba(0,0,0,0.25);
      }
      .video-model-select option {
        color: #111827;
        background: #f7fbff;
      }
      [data-theme="dark"] .video-model-select option {
        color: #0f1724;
        background: #e9f2ff;
      }
      .video-model-select option[disabled] {
        color: rgba(0,0,0,0.35);
        background: #f0f4f9;
      }
      [data-theme="light"] .video-model-select {
        border: 1px solid rgba(0,0,0,0.12);
        background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(245,245,245,0.9));
        color: #1f2a36;
      }
      .video-model-select:focus {
        outline: 1px solid var(--accent, #7bd7ff);
        box-shadow: 0 0 0 3px rgba(123,215,255,0.15);
      }
      .video-model-label {
        font-size: 13px;
        color: rgba(255,255,255,0.85);
        letter-spacing: 0.01em;
        min-width: 90px;
      }
      [data-theme="light"] .video-model-label { color: rgba(0,0,0,0.72); }
      .video-model-select::-ms-expand { display: none; }
      .video-model-badge {
        position: absolute;
        top: 8px;
        left: 8px;
        background: rgba(8, 16, 34, 0.86);
        color: #c8e4ff;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 8px 8px 8px 2px;
        border: 1px solid rgba(123,215,255,0.22);
        letter-spacing: 0.02em;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
        z-index: 10;
        backdrop-filter: blur(4px);
        box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      }
      .video-model-badge::after {
        content: '';
        position: absolute;
        bottom: -5px;
        left: 12px;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 5px solid rgba(8,16,34,0.86);
      }
      .video-box:hover .video-model-badge {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  })();

  ui.render = async function () {
    if (!subscribed && NK.state && NK.state.subscribe) {
      subscribed = true;
      NK.state.subscribe(function (rt) {
        var pid = rt && rt.currentProject && rt.currentProject.id;
        if (pid && pid !== lastProjectId) {
          lastProjectId = pid;
          try { ctx && ctx.setState && ctx.setState(null); } catch (_) { }
          ui.render();
        }
      });
    }
    var pipelineMeta = document.getElementById('pipeline-meta');
    var pipelineScenes = document.getElementById('pipeline-scenes');
    if (!pipelineMeta || !pipelineScenes || !ctx) return;
    var isFile = (typeof window !== 'undefined' && window.location && window.location.protocol === 'file:');
    var state = ctx.getState();
    if (state && state.header) {
      var cleaned = cleanHeader(state.header);
      if (cleaned !== state.header) {
        // 렌더용으로만 정제된 헤더를 사용해 사이클을 막는다.
        state = Object.assign({}, state, { header: cleaned });
      }
    }
    var aspectRatio = resolveEffectiveAspectRatio(state, ctx);
    var persistPipeline = ctx.persistPipeline;
    var updateDraftFromPipeline = ctx.updateDraftFromPipeline;
    var withAspectInHeader = ctx.withAspectInHeader;
    var loadPipeline = ctx.loadPipeline;
    var loadHeader = ctx.loadHeader;
    var saveAspect = ctx.saveAspect;
    var projectId = getProjectId();
    if (projectId) lastProjectId = projectId;
    if (state && projectId && String(state.draftId || '') !== String(projectId)) {
      state = null;
      ctx.setState(null);
    }
    if (!state) {
      __pipelineSpinnerAt = Date.now();
      setPipelinePageLoading(true, '로딩중...');
      setPipelineLoading(false);
      try {
        var stored = (function () { try { return loadPipeline ? loadPipeline() : null; } catch (_) { return null; } })();
        if (stored && projectId && stored.draftId && String(stored.draftId) !== String(projectId)) stored = null;
        try { sessionStorage.removeItem('nk_pipeline_keep'); } catch (_) { }

        const loadReferenceFallback = async function () {
          const candidates = [];
          try { candidates.push('/reference/' + encodeURIComponent(projectId) + '/data.json'); } catch (_) { }
          try {
            const origin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
            if (origin) candidates.push(origin.replace(/\/+$/, '') + '/reference/' + encodeURIComponent(projectId) + '/data.json');
          } catch (_) { }
          try {
            if (NK.config && NK.config.API_BASE) {
              const b = (NK.config.API_BASE || '').replace(/\/+$/, '');
              if (b) candidates.push(b + '/reference/' + encodeURIComponent(projectId) + '/data.json');
            }
          } catch (_) { }
          for (var i = 0; i < candidates.length; i++) {
            const url = candidates[i];
            try {
              const resp = await fetch(url);
              if (!resp.ok) continue;
              const txt = await resp.text();
              const j = JSON.parse(txt);
              if (j && (j.scenes || j.payload)) return j;
            } catch (_) { }
          }
          return null;
        };

        const loadLocalDraftById = (pid) => {
          try {
            const drafts = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts() : [];
            return drafts.find(d => String(d.id) === String(pid)) || null;
          } catch (_) { return null; }
        };

        const buildStateFromData = function (data, draftId) {
          var ratio = normalizeAspectRatio(data.aspectRatio || data.payload?.aspectRatio || aspectRatio);
          if (ratio && saveAspect) saveAspect(ratio);
          aspectRatio = ratio || aspectRatio;
          var pl = Object.assign({}, data.payload || {});
          pl.aspectRatio = normalizeAspectRatio(pl.aspectRatio || aspectRatio);
          var hRaw = data.header || data.payload?.header || (loadHeader ? loadHeader() : '') || '';
          var hWithAspect = withAspectInHeader ? withAspectInHeader(hRaw, aspectRatio) : hRaw;
          var hClean = cleanHeader(hWithAspect);
          // legacy 마이그레이션: scene.shots 가 길이 ≥ 2 면 평탄화 (각 shot → 개별 scene)
          var rawScenes = Array.isArray(data.scenes) ? data.scenes : [];
          var migratedScenes = [];
          var migratedAny = false;
          var nextFlatId = 1;
          rawScenes.forEach(function (parent) {
            if (!parent || typeof parent !== 'object') return;
            var shots = Array.isArray(parent.shots) ? parent.shots : [];
            if (shots.length < 2) {
              migratedScenes.push(parent);
              return;
            }
            // 평탄화: 각 shot 을 새 scene 으로
            migratedAny = true;
            shots.forEach(function (sh, j) {
              if (!sh || typeof sh !== 'object') return;
              var isFirst = j === 0;
              var composition = String(sh.composition || '').trim();
              var action = String(sh.action || '').trim();
              var visualParts = [];
              if (composition) visualParts.push(composition);
              if (action) visualParts.push(action);
              var visual = visualParts.join(' / ').trim() || (parent.visual || parent.shot || '');
              migratedScenes.push({
                id: nextFlatId++,
                title: parent.title || '',
                sceneLocation: parent.sceneLocation || parent.location || '',
                backgroundStyle: parent.backgroundStyle || '',
                narration: isFirst ? (parent.narration || '') : '',
                dialogue: isFirst ? (parent.dialogue || parent.dialogues || []) : [],
                lines: isFirst ? (parent.lines || '') : '',
                subtitleText: isFirst ? (parent.subtitleText || '') : '',
                videoSpeechPrompt: isFirst ? (parent.videoSpeechPrompt || '') : '',
                script: isFirst ? (parent.script || '') : '',
                visual: visual,
                shot: visual,
                composition: composition,
                action: action,
                shotType: String(sh.shotType || 'MS'),
                cameraMove: String(sh.cameraMove || 'static'),
                estSec: Math.max(1, Math.round(Number(sh.duration) || 0)),
                // shot 의 기존 미디어가 있으면 새 scene 의 미디어로 승격
                imageDataUrl: sh.imageDataUrl || sh.imagePath || '',
                imagePath: sh.imagePath || '',
                videoUrl: sh.videoUrl || sh.videoPath || '',
                videoPath: sh.videoPath || '',
                videoStatus: sh.videoStatus || '',
                videoError: sh.videoError || '',
                videoJobId: sh.videoJobId || '',
                videoMethod: sh.videoMethod || '',
                parentSceneId: parent.id != null ? parent.id : null,
                shotIndexInParent: j
              });
            });
          });
          // 마이그레이션이 일어나면 id 를 1..N 으로 재할당해 일관성 유지
          if (migratedAny) {
            migratedScenes = migratedScenes.map(function (s, i) {
              return Object.assign({}, s, { id: i + 1 });
            });
          }
          var scenes = migratedScenes.map(function (s, idx) {
            var imageRef = s.imageDataUrl || s.imagePath || s.generatedImageUrl || s.imageUrl || s.image || s.image_url || s.init_image || s.source_image || '';
            var videoRef = s.videoUrl || s.videoPlaybackUrl || s.videoPath || s.generatedVideoUrl || '';
            var sceneId = (s.id != null ? s.id : (idx + 1));
            var shots = Array.isArray(s.shots) ? s.shots.map(function (sh, j) {
              if (!sh || typeof sh !== 'object') return null;
              var shImg = sh.imageDataUrl || sh.imagePath || sh.generatedImageUrl || sh.imageUrl || '';
              var shVid = sh.videoUrl || sh.videoPlaybackUrl || sh.videoPath || sh.generatedVideoUrl || '';
              return {
                id: String(sh.id || (sceneId + '.' + (j + 1))),
                duration: Number(sh.duration) || 0,
                shotType: String(sh.shotType || 'MS'),
                cameraMove: String(sh.cameraMove || 'static'),
                composition: String(sh.composition || ''),
                action: String(sh.action || ''),
                imageDataUrl: shImg,
                imagePath: sh.imagePath || '',
                videoUrl: shVid,
                videoPath: sh.videoPath || '',
                videoStatus: sh.videoStatus || '',
                videoError: sh.videoError || '',
                videoJobId: sh.videoJobId || '',
                videoMethod: sh.videoMethod || '',
                imgLoading: false,
                imgError: ''
              };
            }).filter(Boolean) : [];
            return {
              id: sceneId,
              lines: s.lines || '',
              shot: s.shot || s.visual || '',
              sceneLocation: s.sceneLocation || s.location || '',
              narration: s.narration || '',
              dialogue: s.dialogue || s.dialogues || [],
              script: s.script || '',
              // 사용자가 더빙 대본을 명시적으로 편집/삭제했는지(빈 값 영속 보존용)
              scriptEdited: !!s.scriptEdited,
              estSec: s.estSec,
              // 새 평탄화 모델: scene 자체에 카메라 셋업
              shotType: String(s.shotType || 'MS'),
              cameraMove: String(s.cameraMove || 'static'),
              composition: String(s.composition || ''),
              action: String(s.action || ''),
              promptText: (s.promptText || ['Common', hClean, 'Visual', (s.shot || '')].join('\n')),
              imageDataUrl: imageRef,
              imageHistory: Array.isArray(s.imageHistory) ? s.imageHistory.filter(Boolean) : [],
              imgLoading: false,
              imgError: '',
              videoUrl: videoRef,
              videoStatus: s.videoStatus || '',
              videoError: s.videoError || '',
              videoJobId: s.videoJobId || '',
              promptEdited: !!s.promptEdited,
              editingPrompt: !!s.editingPrompt,
              voiceUrl: s.voiceUrl || '',
              voiceObjectName: s.voiceObjectName || '',
              voiceStatus: s.voiceStatus || '',
              voiceError: s.voiceError || '',
              voiceVoiceId: s.voiceVoiceId || '',
              // legacy 호환: shots 는 더 이상 사용하지 않지만 그대로 두면 무해 (UI 가 무시)
              shots: shots,
            };
          });
          return { payload: pl, header: hClean, scenes: scenes, savedAt: data.savedAt || '', aspectRatio: aspectRatio, isPlaceholder: false, draftId: (draftId || null) };
        };

        const fetchFromServer = async function () {
          if (!projectId || !NK.api || !NK.api.projectGet) return null;
          var sd = null;
          try {
            var res = await NK.api.projectGet(projectId);
            if (res) sd = (res.data || res);
          } catch (err) {
            const localDraft = loadLocalDraftById(projectId);
            if (localDraft && NK.api.projectSave) {
              try {
                await NK.api.projectSave(
                  projectId,
                  localDraft.payload || {},
                  localDraft.scenes || [],
                  { header: localDraft.header || '', aspectRatio: localDraft.payload?.aspectRatio, title: localDraft.title || '' }
                );
                sd = { title: localDraft.title || '', payload: localDraft.payload || {}, scenes: localDraft.scenes || [], header: localDraft.header || '', aspectRatio: localDraft.payload?.aspectRatio || '' };
              } catch (_) { }
            }
          }
          if (!sd || (!sd.scenes && !sd.payload)) {
            try { sd = await loadReferenceFallback(); } catch (_) { }
          }
          return sd;
        };

        if (stored) {
          // 로컬 캐시 우선 렌더링 → 스피너는 DOM 완성 후 해제 (ui.render 말미에서 처리)
          state = buildStateFromData(stored, stored.draftId || projectId);
          ctx.setState(state);
          // 백그라운드: 서버 동기화 — 새 shots / 미디어가 있을 수 있으므로 재렌더 필요
          fetchFromServer().then(function (sd) {
            if (!sd) return;
            var freshState = buildStateFromData(sd, projectId);
            // 서버에 더 풍부한 데이터가 있거나 시나리오 편집(재생시간/화면/행동/장소) 이 바뀌었을 때만 재렌더.
            // 프리프로덕션에서 씬 텍스트를 수정·저장한 뒤 메인 프로덕션에 진입했을 때
            // stale 한 로컬 캐시(nk_pipeline_last) 만 보여주던 회귀를 막는다.
            var prev = ctx.getState ? ctx.getState() : state;
            var prevScenes = (prev && Array.isArray(prev.scenes)) ? prev.scenes : [];
            // 로컬 캐시의 미디어 URL을 항상 우선 보존. 서버 데이터의 imageDataUrl이 비어 있거나
            // gs:// raw 경로이면 로컬 프록시 URL이 더 안전하다(초기 렌더에서 정상 동작 검증됨).
            // ID 매칭 실패에 대비해 index 기반 fallback도 둔다(샷 평탄화 후 ID 재할당 케이스).
            if (Array.isArray(freshState.scenes) && freshState.scenes.length && prevScenes.length) {
              var _mediaUrlFields = ['imageDataUrl', 'imagePath', 'generatedImageUrl', 'imageUrl',
                'videoUrl', 'videoPath', 'generatedVideoUrl', 'videoPlaybackUrl', 'voiceUrl'];
              var _statusFields = ['videoStatus', 'videoJobId', 'videoMethod', 'videoError'];
              var _prevById = {};
              prevScenes.forEach(function (s) { if (s) _prevById[String(s.id)] = s; });
              freshState = Object.assign({}, freshState, {
                scenes: freshState.scenes.map(function (srv, idx) {
                  var cur = _prevById[String(srv.id)] || prevScenes[idx] || {};
                  var merged = Object.assign({}, srv);
                  // 미디어 URL: 로컬에 값이 있으면 무조건 우선(data:/blob: 제외)
                  _mediaUrlFields.forEach(function (f) {
                    var v = cur[f];
                    if (!v || typeof v !== 'string') return;
                    if (v.slice(0, 5) === 'data:' || v.slice(0, 5) === 'blob:') return;
                    merged[f] = v;
                  });
                  // 상태 필드: 서버가 비었을 때만 로컬 사용
                  _statusFields.forEach(function (f) {
                    if (!merged[f] && cur[f]) merged[f] = cur[f];
                  });
                  // 버전 이력: 서버가 아직 저장하지 않았을 수 있으니 로컬 이력이 더 많으면 보존
                  var srvHist = Array.isArray(merged.imageHistory) ? merged.imageHistory : [];
                  var locHist = Array.isArray(cur.imageHistory) ? cur.imageHistory : [];
                  if (locHist.length > srvHist.length) merged.imageHistory = locHist.slice();
                  return merged;
                })
              });
            }
            var nextScenes = Array.isArray(freshState.scenes) ? freshState.scenes : [];
            var changed = false;
            // 미디어 URL(imageDataUrl/videoUrl) 차이는 재렌더 트리거에서 제외.
            // 로컬 캐시 우선 정책으로 URL은 사실상 변하지 않으며, 변하더라도 placeholder가 잠시
            // 보이는 회귀(이미지가 사라졌다 나타나는 깜빡임)를 만들지 않기 위함.
            if (prevScenes.length !== nextScenes.length) changed = true;
            if (!changed) {
              for (var i = 0; i < nextScenes.length; i++) {
                var ps = prevScenes[i] || {};
                var ns = nextScenes[i] || {};
                var pShots = Array.isArray(ps.shots) ? ps.shots.length : 0;
                var nShots = Array.isArray(ns.shots) ? ns.shots.length : 0;
                if (pShots !== nShots) { changed = true; break; }
                if (Number(ps.estSec || 0) !== Number(ns.estSec || 0)) { changed = true; break; }
                if (String(ps.sceneLocation || '') !== String(ns.sceneLocation || '')) { changed = true; break; }
                if (String(ps.composition || '') !== String(ns.composition || '')) { changed = true; break; }
                if (String(ps.action || '') !== String(ns.action || '')) { changed = true; break; }
                if (String(ps.shot || ps.visual || '') !== String(ns.shot || ns.visual || '')) { changed = true; break; }
                if (String(ps.narration || '') !== String(ns.narration || '')) { changed = true; break; }
              }
            }
            ctx.setState(freshState);
            if (changed && NK.uiPipeline && NK.uiPipeline.render) {
              try { NK.uiPipeline.render(); } catch (_) {}
            }
          }).catch(function () {});
        } else {
          // 로컬 캐시 없음: 서버 응답 대기 후 렌더링
          var serverData = await fetchFromServer();
          if (serverData) {
            state = buildStateFromData(serverData, projectId);
            ctx.setState(state);
          } else {
            var payload = { topic: '', purposeCategory: '', purposeTags: [], target: '', needs: [], tones: [], styles: [], tone: '', style: '', banned: '', duration: '', aspectRatio: aspectRatio };
            var headerInit = withAspectInHeader ? withAspectInHeader('', aspectRatio) : '';
            state = { payload: payload, header: headerInit, scenes: [], savedAt: '', aspectRatio: aspectRatio, isPlaceholder: true };
            ctx.setState(state);
          }
        }
      } finally {
        setPipelineLoading(false);
        // 스피너(setPipelinePageLoading) 해제는 DOM 완성 후 ui.render 말미에서 처리
      }
    }
    var payload = state.payload;
    var scenes = state.scenes;
    var savedAt = state.savedAt;
    var header = state.header;
    var videoModel = state.videoModel || localStorage.getItem((NK.config && NK.config.KEYS && NK.config.KEYS.VIDEO_MODEL) || 'nk_video_model') || 'grok';
    // Kling Draft(v1.6) 제거됨 — 구버전 저장값은 Kling Final로 자동 전환
    if (videoModel === 'kling-draft') videoModel = 'kling-final';
    var imageProvider = (function () {
      try {
        var key = (NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider';
        var raw = String(localStorage.getItem(key) || '').trim().toLowerCase();
        return raw === 'openai' ? 'openai' : 'gemini';
      } catch (_) { return 'gemini'; }
    })();
    var __modelAspectSupport = {
      'veo':          ['16:9', '9:16'],
      'veo-full':     ['16:9', '9:16'],
      'grok':         ['16:9', '9:16'],
      'grok-r2v':     ['16:9', '9:16'],
      'kling-final':  ['16:9', '9:16', '1:1'],
      'seedance':     ['16:9', '9:16', '1:1'],
      'seedance-r2v': ['16:9', '9:16', '1:1'],
      'wan':          ['16:9', '9:16', '1:1'],
      'vidu-q3':      ['16:9', '9:16', '1:1']
    };
    var __mopt = function (val, label, sel, ar) {
      var ok = !__modelAspectSupport[val] || __modelAspectSupport[val].indexOf(ar) !== -1;
      return '<option value="' + val + '"' + (sel === val ? ' selected' : '') + (ok ? '' : ' disabled') + '>' +
        label + (ok ? '' : ' (' + ar + ' 미지원)') + '</option>';
    };
    pipelineMeta.innerHTML = (
      '<div class="pipeline-actions video-model-bar">' +
      '<div class="video-model-left">' +
      '<span class="video-model-label">이미지생성 모델</span>' +
      '<select id="image-provider-select" class="video-model-select">' +
      '<option value="gemini"' + (imageProvider === 'gemini' ? ' selected' : '') + '>Gemini 3.1 Flash</option>' +
      '<option value="openai"' + (imageProvider === 'openai' ? ' selected' : '') + '>GPT Image 2</option>' +
      '</select>' +
      '<span class="video-model-label">영상생성 모델</span>' +
      '<select id="video-model-select" class="video-model-select">' +
      __mopt('veo',          'Veo 3.1 Fast',              videoModel, aspectRatio) +
      __mopt('veo-full',     'Veo 3.1 Full',              videoModel, aspectRatio) +
      __mopt('grok',         'Grok Imagine',              videoModel, aspectRatio) +
      __mopt('grok-r2v',     'Grok R2V',                  videoModel, aspectRatio) +
      __mopt('kling-final',  'Kling Final (v2.6 Pro · FHD)', videoModel, aspectRatio) +
      __mopt('seedance',     'Seedance 2.0',              videoModel, aspectRatio) +
      __mopt('seedance-r2v', 'Seedance 2.0 Reference',   videoModel, aspectRatio) +
      __mopt('wan',          'Wan 2.7',                   videoModel, aspectRatio) +
      __mopt('vidu-q3',      'Vidu Q3-Mix',               videoModel, aspectRatio) +
      '</select>' +
      '</div>' +
      '<div class="pipeline-fold-center">' +
      '<button type="button" class="btn-icon-sm" id="pipeline-expand-all" title="전체 펼침" aria-label="전체 펼침" data-i18n-title="scene_expand_all" data-i18n-aria-label="scene_expand_all"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 10 12 4 18 10"/><polyline points="6 14 12 20 18 14"/></svg></button>' +
      '<button type="button" class="btn-icon-sm" id="pipeline-collapse-all" title="전체 접기" aria-label="전체 접기" data-i18n-title="scene_collapse_all" data-i18n-aria-label="scene_collapse_all"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 12 10 18 4"/><polyline points="6 20 12 14 18 20"/></svg></button>' +
      '<button type="button" class="btn-icon-sm active" id="pipeline-focus-mode" title="부분 펼침" aria-label="부분 펼침" data-i18n-title="scene_focus_mode" data-i18n-aria-label="scene_focus_mode"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 10 12 4 18 10" stroke-width="3.2"/><polyline points="6 14 12 20 18 14" stroke-width="2.2"/></svg></button>' +
      '</div>' +
      '<div class="pipeline-actions" style="display:flex; align-items:center; gap:8px;">' +
      '<button class="btn-secondary" id="bg-ref-btn" ' + (state.isPlaceholder ? 'disabled' : '') + ' title="이 에피소드의 공간(배경) 레퍼런스를 보고 편집하거나 배경 이미지를 생성">배경 레퍼런스</button>' +
      '<button class="btn-secondary" id="common-prompt-batch-btn" ' + (state.isPlaceholder ? 'disabled' : '') + ' title="모든 씬에 공통 적용되는 프롬프트(스타일·분위기·배경/세계관·대상)를 한 번에 편집">공통 프롬프트</button>' +
      '<button class="btn-secondary" id="save-pipeline-btn" ' + (state.isPlaceholder ? 'disabled' : '') + '>저장하기</button>' +
      '<button class="btn-secondary" id="bulk-generate" disabled>이미지 일괄 생성</button>' +
      '<button class="btn-secondary" id="bulk-video" disabled>영상 일괄 생성</button>' +
      '</div>' +
      '</div>'
    );
    state.videoModel = videoModel;
    if (scenes && scenes.length) {
      var voiceCacheKey = 'nk_voice_cache_' + String(state.draftId || '');
      var voiceCache = {};
      try { voiceCache = JSON.parse(localStorage.getItem(voiceCacheKey) || '{}') || {}; } catch (_) { voiceCache = {}; }
      pipelineScenes.classList.remove('empty');
      // 그룹 라벨: sceneLocation 기준. Pass 1 새 프롬프트가 sub-location 변화는 broad
      // sceneLocation 으로 통일하므로 location 만으로 충분.
      var __lastLoc = null;
      var __parentNo = 0;
      var __cutNo = 0;
      var __totalByParent = {};
      var __labels = scenes.map(function (s) {
        var loc = String((s && s.sceneLocation) || '').trim();
        if (!loc || loc !== __lastLoc) {
          __parentNo += 1;
          __cutNo = 1;
          __lastLoc = loc;
        } else {
          __cutNo += 1;
        }
        __totalByParent[__parentNo] = __cutNo;
        return { parentNo: __parentNo, cutNo: __cutNo };
      });
      var rows = scenes.map(function (s, i) {
        var lab = __labels[i];
        var totalCuts = __totalByParent[lab.parentNo] || 1;
        var displayLabel, displayLabelHtml;
        if (totalCuts <= 1) {
          displayLabel = 'Scene ' + lab.parentNo;
          displayLabelHtml = displayLabel;
        } else {
          // 복수 컷: cut1 은 "Scene N cut1" 로, cut2~ 는 "Scene N " spacer 로 정렬 유지
          var prefixCls = lab.cutNo === 1 ? 'label-scene' : 'label-scene label-scene-spacer';
          displayLabel = 'Scene ' + lab.parentNo + ' cut' + lab.cutNo;
          displayLabelHtml = '<span class="' + prefixCls + '">Scene ' + lab.parentNo + ' </span><span class="label-cut">cut' + lab.cutNo + '</span>';
        }
        var computedPrompt = ['Common', cleanHeader(header), 'Visual', (s.shot || '')].join('\\n');
        var displayPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        var updatedScene = Object.assign({}, s, { promptText: displayPrompt, displayLabel: displayLabel, displayLabelHtml: displayLabelHtml });
        return buildSceneRowHtml(updatedScene, header);
      }).join('');
      state.scenes = scenes.map(function (s) {
        var computedPrompt = ['Common', header, 'Visual', (s.shot || ''), 'Duration', ((Math.max(Number(s.estSec) || 0, 1)) + 's.')].join('\\n');
        var finalPrompt = s.promptEdited ? (s.promptText || '') : computedPrompt;
        var vcEntry = voiceCache && voiceCache[String(s.id)];
        var cachedVoiceUrl = '';
        if (vcEntry && typeof vcEntry === 'object' && vcEntry.objectName) {
          try {
            cachedVoiceUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(vcEntry.objectName) : '';
          } catch (_) { cachedVoiceUrl = ''; }
        } else if (typeof vcEntry === 'string') {
          cachedVoiceUrl = vcEntry;
        }
        if (!cachedVoiceUrl && s.voiceObjectName) {
          try { cachedVoiceUrl = NK.api && NK.api.mediaProxyObjectUrl ? NK.api.mediaProxyObjectUrl(s.voiceObjectName) : ''; } catch (_) { cachedVoiceUrl = ''; }
        }
        return Object.assign({}, s, {
          promptText: finalPrompt,
          voiceUrl: (s.voiceUrl || cachedVoiceUrl || ''),
          voiceStatus: (s.voiceStatus || ''),
          voiceVoiceId: (s.voiceVoiceId || ''),
          voiceObjectName: (s.voiceObjectName || (vcEntry && vcEntry.objectName) || ''),
          voiceError: (s.voiceError || ''),
          videoUrl: (s.videoUrl || s.videoPlaybackUrl || ''),
          videoStatus: (s.videoStatus || ''),
          videoMethod: (s.videoMethod || ''),
          videoError: (s.videoError || ''),
          videoJobId: (s.videoJobId || ''),
          editingPrompt: !!s.editingPrompt,

          promptEdited: !!s.promptEdited,
          editingPromptRaw: false
        });
      });
      ctx.setState(state);
      pipelineScenes.innerHTML = (
        '<div class="scene-table">' +
        '<div class="scene-row head">' +
        '<div class="scene-cell">Story</div>' +
        '<div class="scene-cell">Prompt</div>' +
        '<div class="scene-cell">Image/Video</div>' +
        '<div class="scene-cell">Actions</div>' +
        '</div>' +
        rows +
        '</div>'
      );
      try {
        var vids = pipelineScenes.querySelectorAll('video.scene-video');
        Array.prototype.forEach.call(vids, function (v) {
          v.preload = 'metadata';
          v.addEventListener('loadedmetadata', function () { console.log('video loadedmetadata', { src: v.currentSrc, duration: v.duration }); });
          v.addEventListener('canplay', function () { console.log('video canplay', { src: v.currentSrc }); });
          v.addEventListener('error', function () { console.error('video error', v.error || null); });
          var se = v.querySelector('source');
          var src = ((se && se.getAttribute('src')) || v.getAttribute('src') || '');
          if (src && src.indexOf('data:video/mp4;base64,') === 0 && !v.dataset.hydrated) {
            v.dataset.hydrated = '1';
            (function () {
              fetch(src).then(function (resp) { return resp.blob(); }).then(function (blob) {
                var url = URL.createObjectURL(blob);
                if (se) se.setAttribute('src', url);
                else v.src = url;
                v.load();
                console.log('video inline hydrated', { size: blob.size });
              }).catch(function (e) { console.error('video inline hydrate fail', e); });
            })();
          } else {
            v.load();
          }
        });
      } catch (_) { }
      // 초기 렌더 시 focus 모드: 첫 번째만 펼치고 나머지 접기
      var initFoldMode = (ctx.getPipelineFoldMode ? ctx.getPipelineFoldMode() : 'focus');
      if (initFoldMode === 'focus' || initFoldMode === 'collapse') {
        var allRows = pipelineScenes.querySelectorAll('.scene-row:not(.head)');
        var srMod = NK.uiPipelineSceneRow || {};
        allRows.forEach(function (row, idx) {
          var shouldCollapse = initFoldMode === 'collapse' || idx > 0;
          if (shouldCollapse) {
            var rid = row.dataset.id;
            if (srMod.setPipelineSceneCollapsed) srMod.setPipelineSceneCollapsed(rid, true);
            row.classList.add('is-collapsed');
            var wrapEl = row.querySelector('.scene-row-body-wrap');
            if (wrapEl) wrapEl.style.height = '0px';
            var tbtn = row.querySelector('.scene-row-toggle');
            if (tbtn) { tbtn.textContent = '+'; tbtn.setAttribute('aria-expanded', 'false'); }
          }
        });
      }
      // 동적 렌더 후 i18n 재적용
      if (NK.ui && NK.ui.common && NK.ui.common.applyI18n) {
        var lang = (NK.config && NK.config.KEYS && localStorage.getItem(NK.config.KEYS.LANG)) || 'ko';
        NK.ui.common.applyI18n(lang);
      }
    } else {
      pipelineScenes.classList.add('empty');
      pipelineScenes.innerHTML = '<div class="card video-stage-empty-card"><p class="muted">장면이 없습니다</p></div>';
    }
    // [자동 매핑 제거] 저장소 이미지를 빈 컷에 시간순으로 다시 매핑하던 '자동 매핑' 버튼/핸들러
    // 는 삭제됨. 컷 상태는 오직 ① 생성 ② 저장소 선택·사용 ③ 삭제 후 빈 칸 유지로만 결정된다.
    var savePipelineBtn = document.getElementById('save-pipeline-btn');
    if (savePipelineBtn) {
      savePipelineBtn.onclick = async function () {
        const originalText = savePipelineBtn.textContent;
        savePipelineBtn.disabled = true;
        savePipelineBtn.textContent = '저장 중...';
        setPipelineLoading(true);
        var st = ctx.getState();
        if (!st) return;
        // 저장 = 현재 화면의 이미지·영상 배치를 그대로 확정. 자동 매핑이 제거되어
        // 빈 컷은 빈 채로, 채워진 컷은 그 이미지 그대로 저장된다(별도 마킹 불필요).
        ctx.savePipeline(st.payload, st.scenes, st.header);
        if (updateDraftFromPipeline) updateDraftFromPipeline();
        if (projectId && NK.api && NK.api.projectSave) {
          try {
            await NK.api.projectSave(projectId, st.payload || {}, st.scenes || [], {
              header: st.header || '',
              aspectRatio: st.aspectRatio || '',
              title: getProjectTitle()
            });
            // 로컬 파이프라인 캐시는 지우지 않는다 — 사용자가 확정·저장한 미디어 배치를
            // 새로고침 후에도 그대로 복원하기 위한 source of truth 로 보존(계정별 스코프 캐시).
            // 직전엔 clearPipeline 으로 캐시를 비워 서버 왕복 + 시간순 자동매핑에만 의존시켰는데,
            // 그 과정에서 확정 배치가 어긋나거나 컷 이미지가 사라지는 회귀가 있었다.
            // 저장 직후 캐시는 방금 확정한 st 와 동일하므로 stale 위험 없음.
            alert('저장되었습니다.');
          } catch (err) {
            alert('저장 실패: ' + (err && err.message ? err.message : err));
          } finally {
            savePipelineBtn.disabled = false;
            savePipelineBtn.textContent = originalText;
            setPipelineLoading(false);
          }
          return;
        }
        // projectId가 없을 때 버튼 상태 복구
        savePipelineBtn.disabled = false;
        savePipelineBtn.textContent = originalText;
        setPipelineLoading(false);
        alert('저장되었습니다.');
      };
    }
    // 배경 레퍼런스: 이 에피소드의 공간(장소) 목록을 보고 편집 + 배경 플레이트 생성.
    var bgRefBtn = document.getElementById('bg-ref-btn');
    if (bgRefBtn) {
      bgRefBtn.onclick = function () { openBackgroundReferenceModal(); };
    }
    // 공통 프롬프트 일괄 편집: state.header(모든 씬 공유) 를 한 번에 수정 → 전체 씬 행 재렌더.
    // 개별 씬의 화면/행동/Duration 편집(씬별 "편집" 버튼)과 공존한다.
    var commonBatchBtn = document.getElementById('common-prompt-batch-btn');
    if (commonBatchBtn) {
      commonBatchBtn.onclick = function () {
        var st = ctx.getState();
        if (!st) return;
        var currentCommon = cleanHeader(st.header || '');
        openCommonPromptBatchModal(currentCommon, async function (newText) {
          var st2 = ctx.getState();
          if (!st2) return;
          var cleaned = String(newText || '').trim();
          // 종횡비 메타는 보존(표시는 cleanHeader 로 strip 되지만 데이터엔 유지).
          st2.header = withAspectInHeader ? withAspectInHeader(cleaned, st2.aspectRatio) : cleaned;
          ctx.setState(st2);
          if (ctx.persistPipeline) ctx.persistPipeline();
          if (updateDraftFromPipeline) updateDraftFromPipeline();
          // 모든 씬 행을 새 공통 프롬프트로 즉시 재렌더 (full reload 없이).
          (st2.scenes || []).forEach(function (_, i) {
            try { updateSceneRow(i, st2.header || '', null); } catch (_) {}
          });
          // 서버에도 비동기 저장 (실패해도 로컬은 이미 반영됨).
          if (projectId && NK.api && NK.api.projectSave) {
            try {
              await NK.api.projectSave(projectId, st2.payload || {}, st2.scenes || [], {
                header: st2.header || '',
                aspectRatio: st2.aspectRatio || '',
                title: getProjectTitle()
              });
            } catch (_) { /* 백그라운드 저장 실패 무시 */ }
          }
        });
      };
    }

    var modelSelect = document.getElementById('video-model-select');
    if (modelSelect) {
      modelSelect.onchange = function () {
        var val = modelSelect.value || 'veo';
        var st2 = ctx.getState() || {};
        st2.videoModel = val;
        ctx.setState(st2);
        try { localStorage.setItem((NK.config && NK.config.KEYS && NK.config.KEYS.VIDEO_MODEL) || 'nk_video_model', val); } catch (_) { }
      };
    }

    var providerSelect = document.getElementById('image-provider-select');
    if (providerSelect) {
      providerSelect.onchange = function () {
        var raw = String(providerSelect.value || '').trim().toLowerCase();
        var val = raw === 'openai' ? 'openai' : 'gemini';
        try { localStorage.setItem((NK.config && NK.config.KEYS && NK.config.KEYS.IMAGE_PROVIDER) || 'nk_ai_image_provider', val); } catch (_) { }
      };
    }

    var bulkGen = document.getElementById('bulk-generate');
    if (bulkGen) {
      bulkGen.onclick = async function () {
        var st = ctx.getState();
        if (!st || !st.scenes.length) return;
        for (var i = 0; i < st.scenes.length; i++) {
          await ui.generateImageForIdx(i);
        }
      };
    }
    var bulkVid = document.getElementById('bulk-video');
    if (bulkVid) {
      bulkVid.onclick = async function () {
        var st = ctx.getState();
        if (!st || !st.scenes.length) return;
        for (var i = 0; i < st.scenes.length; i++) {
          await startVideoForIdx(i);
        }
      };
    }

    // ── 씬 행 펼침/접기 모드 버튼 ──
    var pipelineFoldMode = 'focus';
    var pExpandAll = document.getElementById('pipeline-expand-all');
    var pCollapseAll = document.getElementById('pipeline-collapse-all');
    var pFocusMode = document.getElementById('pipeline-focus-mode');
    var pFoldBtns = [pExpandAll, pCollapseAll, pFocusMode].filter(Boolean);
    var setPipelineFoldActive = function (mode) {
      pipelineFoldMode = mode;
      pFoldBtns.forEach(function (b) { b.classList.remove('active'); });
      if (mode === 'expand' && pExpandAll) pExpandAll.classList.add('active');
      if (mode === 'collapse' && pCollapseAll) pCollapseAll.classList.add('active');
      if (mode === 'focus' && pFocusMode) pFocusMode.classList.add('active');
    };
    var sceneRowMod = NK.uiPipelineSceneRow || {};
    var applyFoldToAllRows = function (collapsed) {
      pipelineScenes.querySelectorAll('.scene-row:not(.head)').forEach(function (row) {
        var id = row.dataset.id;
        if (sceneRowMod.setPipelineSceneCollapsed) sceneRowMod.setPipelineSceneCollapsed(id, collapsed);
        row.classList.toggle('is-collapsed', collapsed);
        var wrap = row.querySelector('.scene-row-body-wrap');
        if (wrap) wrap.style.cssText = collapsed ? 'height:0px;overflow:hidden' : '';
        var btn = row.querySelector('.scene-row-toggle');
        if (btn) { btn.textContent = collapsed ? '+' : '-'; btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true'); }
      });
    };
    if (pExpandAll) pExpandAll.onclick = function () { setPipelineFoldActive('expand'); applyFoldToAllRows(false); };
    if (pCollapseAll) pCollapseAll.onclick = function () { setPipelineFoldActive('collapse'); applyFoldToAllRows(true); };
    if (pFocusMode) pFocusMode.onclick = function () {
      setPipelineFoldActive('focus');
      pipelineScenes.querySelectorAll('.scene-row:not(.head)').forEach(function (row) {
        var id = row.dataset.id;
        if (sceneRowMod.setPipelineSceneCollapsed) sceneRowMod.setPipelineSceneCollapsed(id, true);
        row.classList.add('is-collapsed');
        var wrap = row.querySelector('.scene-row-body-wrap');
        if (wrap) wrap.style.cssText = 'height:0px;overflow:hidden';
        var btn = row.querySelector('.scene-row-toggle');
        if (btn) { btn.textContent = '+'; btn.setAttribute('aria-expanded', 'false'); }
      });
    };
    // Expose fold mode for toggle handler
    ctx.getPipelineFoldMode = function () { return pipelineFoldMode; };

    if (window.NK && NK.uiPipelineSceneActions && NK.uiPipelineSceneActions.bindSceneEvents) {
      NK.uiPipelineSceneActions.bindSceneEvents({
        rootEl: pipelineScenes,
        ctx: ctx,
        ui: ui,
        getProjectId: getProjectId,
        getProjectTitle: getProjectTitle,
        openLibraryModal: openLibraryModal,
        openCutRefModal: openCutRefModal,
        downloadFile: downloadFile,
        openImageModal: openImageModal,
        openVideoModal: openVideoModal,
        updateSceneRow: updateSceneRow,
        startVideoForIdx: startVideoForIdx,
        isSceneVoiceProcessing: isSceneVoiceProcessing,
        isVoiceFeatureEnabled: isVoiceFeatureEnabled,
        sampleVoiceUrl: SAMPLE_VOICE_URL
      });
    }
    try {
      if (!window.NK._voiceCatalogLoading && !window.NK._voiceCatalogLoaded) {
        window.NK._voiceCatalogLoading = true;
        NK.api.ttsVoices().then(function (res) {
          var list = Array.isArray(res && res.voices) ? res.voices : [];
          window.NK._voiceCatalog = list;
          window.NK._voiceCatalogLoaded = true;
          hydrateVoiceSelects();
        }).catch(function () {
          window.NK._voiceCatalogLoaded = false;
        }).finally(function () { window.NK._voiceCatalogLoading = false; });
      } else if (window.NK._voiceCatalogLoaded) {
        hydrateVoiceSelects();
      }
    } catch (_) { }

    // 모달 오버레이 클릭 시 닫기
    ['img-modal', 'video-modal', 'lib-modal'].forEach(id => {
      const m = document.getElementById(id);
      if (m && !m.dataset.bound) {
        m.dataset.bound = '1';
        m.addEventListener('click', (e) => {
          if (e.target === m) closeModals();
        });
      }
    });

    // 비디오 생성 공통 함수
    async function startVideoForIdx(i) {
      if (window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.startVideoForIdx) {
        await NK.uiPipelineVideo.startVideoForIdx({
          idx: i,
          ctx: ctx,
          getProjectId: getProjectId,
          updateSceneRow: updateSceneRow,
          pollVideoStatus: pollVideoStatus,
          resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
          ensureStateAspectRatio: ensureStateAspectRatio,
          enforceImageAspectRatio: enforceImageAspectRatio,
          enforceVideoAspectRatio: enforceVideoAspectRatio,
          isSceneVideoProcessing: isSceneVideoProcessing,
          isVoiceFeatureEnabled: isVoiceFeatureEnabled,
          buildVoiceScriptForVideo: buildVoiceScriptForVideo,
          toBool: toBool,
          isBucketVideoUrl: isBucketVideoUrl,
          showCopyableError: showCopyableError,
          videoModel: (function () { var sel = document.getElementById('video-model-select'); return (sel && sel.value) || (ctx.getState() && ctx.getState().videoModel) || videoModel; })()
        });
      }
    }

    // GCS 자산 자동 갱신 — 페이지 진입 시 만료/누락된 이미지·영상 URL을
    // 서버 라이브러리에서 최신 프록시 URL로 교체. 내부에 state._assetsRefreshed
    // 가드가 있어 매 render마다 호출돼도 실제 GCS 호출은 한 번만 실행됨.
    try { ui.refreshAssets(); } catch (_) {}

    // DOM 렌더 완전 완료 후 스피너 해제 (최소 300ms 보장)
    if (__pipelineSpinnerAt > 0) {
      var _spinDelay = Math.max(0, 300 - (Date.now() - __pipelineSpinnerAt));
      __pipelineSpinnerAt = 0;
      setTimeout(function () { setPipelinePageLoading(false); }, _spinDelay);
    }
  };

  function hydrateVoiceSelects() {
    var buildOption = function (value, label, selected) { return '<option value="' + value + '"' + (selected ? ' selected' : '') + '>' + label + '</option>'; };
    var selects = document.querySelectorAll('.voice-select');
    Array.prototype.forEach.call(selects, function (sel) {
      var cur = sel.value || '';
      try {
        var sid = sel.getAttribute('data-id') || '';
        var stx = (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx && NK.uiPipeline.__ctx.getState) ? NK.uiPipeline.__ctx.getState() : null;
        var sc = (stx && stx.scenes) ? stx.scenes.find(function (s) { return String(s.id) === String(sid); }) : null;
        if (sc && sc.voiceVoiceId) cur = sc.voiceVoiceId;
      } catch (_) { }
      if (cur === 'kr_female_narration' || cur === 'kr_male_narration') cur = 'engine:gemini:voice:Kore';
      if (cur.indexOf('voice:ko-KR-') === 0) cur = 'engine:gemini:voice:Kore'; // legacy google -> gemini
      if (cur.indexOf('engine:google:voice:') === 0) cur = 'engine:gemini:voice:Kore';
      if (cur.indexOf('voice:Kore') === 0) cur = 'engine:gemini:voice:Kore';

      var opts = [];
      opts.push(buildOption('engine:gemini:voice:Kore', 'Gemini · Kore (Neutral)', cur === 'engine:gemini:voice:Kore'));
      opts.push(buildOption('engine:gemini:preset:child:female:Kore:rate=1.15:pitch=6', 'Gemini · Kore (어린 소녀)', cur.indexOf('engine:gemini:preset:child:female:') === 0));
      opts.push(buildOption('engine:gemini:preset:child:male:Kore:rate=1.12:pitch=4', 'Gemini · Kore (어린 소년)', cur.indexOf('engine:gemini:preset:child:male:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:robot:Kore:rate=0.95:pitch=-2', 'Gemini · Kore (로봇)', cur.indexOf('engine:gemini:preset:char:robot:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:magician:Kore:rate=0.90:pitch=-1', 'Gemini · Kore (마법사)', cur.indexOf('engine:gemini:preset:char:magician:') === 0));
      opts.push(buildOption('engine:gemini:preset:char:trick:Kore:rate=1.15:pitch=3', 'Gemini · Kore (장난꾸러기)', cur.indexOf('engine:gemini:preset:char:trick:') === 0));
      var html = opts.join('');
      sel.innerHTML = html;
      if (!cur) sel.value = 'engine:gemini:voice:Kore';
      else {
        if (!Array.prototype.some.call(sel.options, function (o) { return o.value === cur; })) {
          sel.value = 'engine:gemini:voice:Kore';
        } else {
          sel.value = cur;
        }
      }
    });
  }

  async function pollVideoStatus(projectId, jobId, idx, attempt) {
    if (window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.pollVideoStatus) {
      await NK.uiPipelineVideo.pollVideoStatus({
        projectId: projectId,
        jobId: jobId,
        idx: idx,
        attempt: attempt,
        ctx: ctx,
        updateSceneRow: updateSceneRow,
        resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
        enforceVideoAspectRatio: enforceVideoAspectRatio,
        isBucketVideoUrl: isBucketVideoUrl,
        scheduleNext: function (nextAttempt) {
          var st = ctx.getState() || {};
          var sid = (st.scenes && st.scenes[idx] && st.scenes[idx].id) || '';
          var cancelled = !!(ctx._cancelVideoPoll && ctx._cancelVideoPoll[String(sid)]);
          if (!cancelled) pollVideoStatus(projectId, jobId, idx, nextAttempt);
        }
      });
    }
  }
  ui.cancelVideoForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelVideo || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    ctx._cancelVideoPoll = ctx._cancelVideoPoll || {};
    ctx._cancelVideoPoll[String(id)] = true;
    st.scenes[idx] = Object.assign({}, scene, { videoStatus: '', videoError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'video');
  };
  ui.cancelVoiceForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelVoice || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    st.scenes[idx] = Object.assign({}, scene, { voiceStatus: '', voiceError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'voice');
  };
  ui.refreshAssets = async function () {
    if (window.NK && NK.uiPipelineAssets && NK.uiPipelineAssets.refreshAssets) {
      await NK.uiPipelineAssets.refreshAssets({
        ctx: ctx,
        render: ui.render,
        extractObjectNameFromMediaRef: extractObjectNameFromMediaRef
      });
    }
  };
  ui.generateImageForIdx = async function (idx, retryCount) {
    if (window.NK && NK.uiPipelineImage && NK.uiPipelineImage.generateImageForIdx) {
      await NK.uiPipelineImage.generateImageForIdx({
        idx: idx,
        retryCount: retryCount,
        ctx: ctx,
        getProjectId: getProjectId,
        resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
        ensureStateAspectRatio: ensureStateAspectRatio,
        cleanHeader: cleanHeader,
        toBool: toBool,
        enforceImageAspectRatio: enforceImageAspectRatio,
        updateSceneRow: updateSceneRow,
        retryImage: function (targetIdx, nextRetryCount) {
          return ui.generateImageForIdx(targetIdx, nextRetryCount);
        }
      });
    }
  };
  ui.cancelImageForIdx = function (idx) {
    var st = ctx.getState();
    if (!st || !st.scenes || st.scenes.length <= idx) return;
    var scene = st.scenes[idx];
    var id = scene.id;
    try {
      var map = ctx._cancelImage || {};
      var ctrl = map[String(id)];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    st.scenes[idx] = Object.assign({}, scene, { imgLoading: false, imgError: '' });
    ctx.setState(st);
    updateSceneRow(idx, st.header || '', 'image');
  };
  // 이미지 수정 모달 (채팅형 + 인페인팅 + 버전 이력)
  ui.openImageEditModal = function (idx) {
    if (!(window.NK && NK.uiPipelineImageEdit && NK.uiPipelineImageEdit.open)) {
      alert('이미지 수정 모듈을 불러오지 못했습니다.');
      return;
    }
    NK.uiPipelineImageEdit.open({
      idx: idx,
      ctx: ctx,
      getProjectId: getProjectId,
      resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
      ensureStateAspectRatio: ensureStateAspectRatio,
      enforceImageAspectRatio: enforceImageAspectRatio,
      updateSceneRow: updateSceneRow,
      toPlayableMediaUrl: toPlayableMediaUrl,
      cleanHeader: cleanHeader
    });
  };

  // ── 컷(shot) 단위 영상 생성 ──
  async function pollShotVideoStatus(sceneIdx, shotIdx, projectId, jobId, attempt) {
    if (!(window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.pollShotVideoStatus)) return;
    await NK.uiPipelineVideo.pollShotVideoStatus({
      projectId: projectId,
      jobId: jobId,
      sceneIdx: sceneIdx,
      shotIdx: shotIdx,
      attempt: attempt,
      ctx: ctx,
      updateSceneRow: updateSceneRow,
      resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
      enforceVideoAspectRatio: enforceVideoAspectRatio,
      isBucketVideoUrl: isBucketVideoUrl,
      scheduleNext: function (nextAttempt) {
        var st = ctx.getState() || {};
        var scene = st.scenes && st.scenes[sceneIdx];
        var shot = scene && Array.isArray(scene.shots) ? scene.shots[shotIdx] : null;
        if (!scene || !shot) return;
        var key = String(scene.id) + '/' + String(shot.id);
        var cancelled = !!(ctx._cancelShotVideoPoll && ctx._cancelShotVideoPoll[key]);
        if (!cancelled) pollShotVideoStatus(sceneIdx, shotIdx, projectId, jobId, nextAttempt);
      }
    });
  }

  ui.startVideoForShot = async function (sceneIdx, shotIdx) {
    if (!(window.NK && NK.uiPipelineVideo && NK.uiPipelineVideo.startVideoForShot)) return;
    await NK.uiPipelineVideo.startVideoForShot({
      sceneIdx: sceneIdx,
      shotIdx: shotIdx,
      ctx: ctx,
      getProjectId: getProjectId,
      updateSceneRow: updateSceneRow,
      resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
      ensureStateAspectRatio: ensureStateAspectRatio,
      enforceImageAspectRatio: enforceImageAspectRatio,
      enforceVideoAspectRatio: enforceVideoAspectRatio,
      isVoiceFeatureEnabled: isVoiceFeatureEnabled,
      toBool: toBool,
      isBucketVideoUrl: isBucketVideoUrl,
      videoModel: (function () { var sel = document.getElementById('video-model-select'); return (sel && sel.value) || (ctx.getState() && ctx.getState().videoModel) || ''; })(),
      scheduleShotPoll: function (sIdx, shIdx, projectId, jobId, attempt) {
        pollShotVideoStatus(sIdx, shIdx, projectId, jobId, attempt);
      }
    });
  };

  ui.cancelVideoForShot = function (sceneIdx, shotIdx) {
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var scene = st.scenes[sceneIdx];
    if (!scene || !Array.isArray(scene.shots)) return;
    var shot = scene.shots[shotIdx];
    if (!shot) return;
    var key = String(scene.id) + '/' + String(shot.id);
    try {
      ctx._cancelShotVideoPoll = ctx._cancelShotVideoPoll || {};
      ctx._cancelShotVideoPoll[key] = true;
      var ctrl = ctx._cancelShotVideo && ctx._cancelShotVideo[key];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    var nextShots = scene.shots.slice();
    nextShots[shotIdx] = Object.assign({}, shot, { videoStatus: '', videoError: '' });
    st.scenes[sceneIdx] = Object.assign({}, scene, { shots: nextShots });
    ctx.setState(st);
    updateSceneRow(sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
  };

  // ── 컷(shot) 단위 이미지 생성 ──
  ui.generateImageForShot = async function (sceneIdx, shotIdx, retryCount) {
    if (!(window.NK && NK.uiPipelineImage && NK.uiPipelineImage.generateImageForShot)) return;
    await NK.uiPipelineImage.generateImageForShot({
      sceneIdx: sceneIdx,
      shotIdx: shotIdx,
      retryCount: retryCount,
      ctx: ctx,
      getProjectId: getProjectId,
      resolveEffectiveAspectRatio: resolveEffectiveAspectRatio,
      ensureStateAspectRatio: ensureStateAspectRatio,
      cleanHeader: cleanHeader,
      toBool: toBool,
      enforceImageAspectRatio: enforceImageAspectRatio,
      updateSceneRow: updateSceneRow,
      retryShotImage: function (sIdx, shIdx, nextRetry) {
        return ui.generateImageForShot(sIdx, shIdx, nextRetry);
      }
    });
  };

  ui.cancelImageForShot = function (sceneIdx, shotIdx) {
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var scene = st.scenes[sceneIdx];
    if (!scene || !Array.isArray(scene.shots)) return;
    var shot = scene.shots[shotIdx];
    if (!shot) return;
    try {
      var map = ctx._cancelShotImage || {};
      var key = String(scene.id) + '/' + String(shot.id);
      var ctrl = map[key];
      if (ctrl && ctrl.abort) ctrl.abort();
    } catch (_) {}
    var nextShots = scene.shots.slice();
    nextShots[shotIdx] = Object.assign({}, shot, { imgLoading: false, imgError: '' });
    st.scenes[sceneIdx] = Object.assign({}, scene, { shots: nextShots });
    ctx.setState(st);
    updateSceneRow(sceneIdx, st.header || '', 'shot:' + scene.id + ':' + shot.id);
  };

  // 한 씬의 모든 컷을 직렬로 이미지 생성
  ui.generateAllShotImagesForScene = async function (sceneIdx) {
    var st = ctx.getState();
    if (!st || !Array.isArray(st.scenes)) return;
    var scene = st.scenes[sceneIdx];
    if (!scene || !Array.isArray(scene.shots) || !scene.shots.length) return;
    for (var i = 0; i < scene.shots.length; i++) {
      // 매 반복마다 fresh state 에서 가져옴 (취소/삭제 반영)
      var stCur = ctx.getState();
      var sceneCur = stCur && stCur.scenes && stCur.scenes[sceneIdx];
      if (!sceneCur || !Array.isArray(sceneCur.shots) || i >= sceneCur.shots.length) break;
      var shotCur = sceneCur.shots[i];
      if (!shotCur || shotCur.imageDataUrl) continue; // 이미 있으면 스킵
      try {
        await ui.generateImageForShot(sceneIdx, i);
      } catch (_) { /* 다음 컷으로 진행 */ }
    }
  };
})();

function pickValidAspectRatio(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.pickValidAspectRatio) return media.pickValidAspectRatio(raw);
  return '';
}

function normalizeAspectRatio(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.normalizeAspectRatio) return media.normalizeAspectRatio(raw);
  return pickValidAspectRatio(raw) || '16:9';
}

function getAspectRatioSize(raw) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.getAspectRatioSize) return media.getAspectRatioSize(raw);
  return { w: 16, h: 9 };
}

function resolveEffectiveAspectRatio(state, ctxRef) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.resolveEffectiveAspectRatio) return media.resolveEffectiveAspectRatio(state, ctxRef);
  return '16:9';
}

function ensureStateAspectRatio(state, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.ensureStateAspectRatio) return media.ensureStateAspectRatio(state, rawRatio);
  return state;
}

function waitMs(ms) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.waitMs) return media.waitMs(ms);
  return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, Number(ms) || 0)); });
}

function isAspectRatioClose(width, height, rawRatio, tolerance) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.isAspectRatioClose) return media.isAspectRatioClose(width, height, rawRatio, tolerance);
  return false;
}

function loadImageByUrl(url) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.loadImageByUrl) return media.loadImageByUrl(url);
  return Promise.reject(new Error('image_load_failed'));
}

async function enforceImageAspectRatio(imageRef, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.enforceImageAspectRatio) return media.enforceImageAspectRatio(imageRef, rawRatio);
  return { url: String(imageRef || '').trim(), changed: false };
}

function readVideoMeta(videoUrl) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.readVideoMeta) return media.readVideoMeta(videoUrl);
  return Promise.reject(new Error('video_metadata_load_failed'));
}

function extractObjectNameFromMediaRef(rawRef) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.extractObjectNameFromMediaRef) return media.extractObjectNameFromMediaRef(rawRef);
  return '';
}

async function transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.transcodeVideoObjectToAspect) return media.transcodeVideoObjectToAspect(projectId, sourceObjectName, rawRatio);
  return '';
}

async function enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.enforceVideoAspectRatio) return media.enforceVideoAspectRatio(projectId, sourceHint, videoRef, rawRatio);
  return { url: String(videoRef || '').trim(), changed: false };
}

function toPlayableMediaUrl(url) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.toPlayableMediaUrl) return media.toPlayableMediaUrl(url);
  return String(url || '').trim();
}

// 복사 가능한 에러 알림 (alert 대체)
function showCopyableError(title, detail) {
  var media = (window.NK && NK.uiPipelineMedia) ? NK.uiPipelineMedia : null;
  if (media && media.showCopyableError) return media.showCopyableError(title, detail);
  alert(detail ? (title + '\n' + detail) : title);
}

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

function getPipelineSceneRowHelpers() {
  return (window.NK && NK.uiPipelineSceneRow) ? NK.uiPipelineSceneRow : {};
}

function isVoiceFeatureEnabled(payload) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isVoiceFeatureEnabled) return helpers.isVoiceFeatureEnabled(payload);
  var p = payload || {};
  return !!(toBool(p.narrationEnabled, false) || toBool(p.dubbingEnabled, false));
}

function isSceneVideoProcessing(scene) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isSceneVideoProcessing) return helpers.isSceneVideoProcessing(scene);
  return String((scene && scene.videoStatus) || '').trim().toLowerCase() === 'processing';
}

function isSceneVoiceProcessing(scene) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.isSceneVoiceProcessing) return helpers.isSceneVoiceProcessing(scene);
  return /^생성\s*중/.test(String((scene && scene.voiceStatus) || '').trim());
}

function extractNarrationDisplay(text) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.extractNarrationDisplay) return helpers.extractNarrationDisplay(text);
  return String(text || '').trim();
}

function buildVoiceScriptForVideo(scene, payload) {
  var helpers = getPipelineSceneRowHelpers();
  if (helpers.buildVoiceScriptForVideo) return helpers.buildVoiceScriptForVideo(scene, payload);
  return '';
}

// 공통 프롬프트 일괄 편집 모달 (동적 생성). currentText 를 채우고 일괄 적용 시 onApply(newText) 호출.
function openCommonPromptBatchModal(currentText, onApply) {
  var existing = document.getElementById('common-prompt-batch-modal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'common-prompt-batch-modal';
  overlay.className = 'cpbm-overlay';
  overlay.innerHTML =
    '<div class="cpbm-box">' +
    '<h3 class="cpbm-title">공통 프롬프트 일괄 편집</h3>' +
    '<p class="cpbm-help">모든 씬에 공통으로 들어가는 프롬프트(스타일·분위기·배경/세계관·대상)예요. 여기서 한 번 수정하면 <strong>모든 씬</strong>의 공통(Common) 영역에 일괄 적용돼요. 각 씬의 화면/행동/Duration 은 씬별 “편집”에서 따로 수정하세요.</p>' +
    '<textarea id="cpbm-textarea" class="cpbm-textarea" spellcheck="false"></textarea>' +
    '<div class="cpbm-actions">' +
    '<button type="button" class="btn-ghost" id="cpbm-cancel">취소</button>' +
    '<button type="button" class="btn-primary" id="cpbm-apply">일괄 적용</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  var ta = overlay.querySelector('#cpbm-textarea');
  if (ta) ta.value = currentText || '';
  var close = function () { try { overlay.remove(); } catch (_) {} };
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  var cancelBtn = overlay.querySelector('#cpbm-cancel');
  if (cancelBtn) cancelBtn.onclick = close;
  var applyBtn = overlay.querySelector('#cpbm-apply');
  if (applyBtn) applyBtn.onclick = function () {
    var val = ta ? ta.value : '';
    close();
    try { if (typeof onApply === 'function') onApply(val); }
    catch (e) { alert('적용 실패: ' + (e && e.message ? e.message : e)); }
  };
  setTimeout(function () { if (ta) ta.focus(); }, 0);
}

// 배경 레퍼런스 모달 — 이 에피소드의 공간(장소) 목록을 보고 편집하고, 각 공간의 "배경 플레이트"
// (캐릭터 없는 빈 배경)를 생성한다. draft.payload.episodeLocations 를 읽고 쓴다.
function openBackgroundReferenceModal() {
  var ctxRef = (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  if (!ctxRef || !ctxRef.getState || !ctxRef.setState) { alert('상태를 불러올 수 없습니다.'); return; }
  var st0 = ctxRef.getState();
  if (!st0) return;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var slug = function (s) {
    return String(s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9가-힣\-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || ('loc-' + (st0.scenes ? st0.scenes.length : 0));
  };
  var thumbUrl = function (obj) { return (obj && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(obj) : ''; };

  // 작업용 복사본
  var locs = (st0.payload && Array.isArray(st0.payload.episodeLocations))
    ? st0.payload.episodeLocations.map(function (l) {
        return { id: l.id || '', name: l.name || '', description: l.description || '', refObjectName: l.refObjectName || '', sceneIds: Array.isArray(l.sceneIds) ? l.sceneIds.slice() : [], _busy: false };
      })
    : [];

  var existing = document.getElementById('bg-ref-modal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'bg-ref-modal';
  overlay.className = 'cpbm-overlay';
  document.body.appendChild(overlay);
  var close = function () { try { overlay.remove(); } catch (_) {} };
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  function syncFromInputs() {
    overlay.querySelectorAll('.bgref-item').forEach(function (el) {
      var i = Number(el.getAttribute('data-idx'));
      if (!locs[i]) return;
      var nm = el.querySelector('.bgref-name'); if (nm) locs[i].name = nm.value;
      var ds = el.querySelector('.bgref-desc'); if (ds) locs[i].description = ds.value;
    });
  }

  function render() {
    var inStyle = 'width:100%;padding:5px 7px;background:var(--input-bg,#1a1a2e);color:var(--text-primary,#eee);border:1px solid var(--border);border-radius:4px;';
    // 버튼 높이 통일용 공통 스타일
    var btnH = 'height:30px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;line-height:1;';
    var rows = locs.map(function (l, i) {
      var turl = thumbUrl(l.refObjectName) || (l._dataUrl || '');
      return (
        '<div class="bgref-item" data-idx="' + i + '" style="display:flex;gap:10px;padding:10px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">' +
          '<div style="width:140px;height:84px;flex:0 0 140px;border-radius:6px;overflow:hidden;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;">' +
            (turl ? '<img class="bgref-thumb-img" src="' + esc(turl) + '" data-full="' + esc(turl) + '" alt="" title="클릭하면 크게 보기" style="width:100%;height:100%;object-fit:cover;cursor:zoom-in;" onerror="this.style.display=\'none\'"/>' : '<span class="muted" style="font-size:11px;">배경 없음</span>') +
          '</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<input class="bgref-name" type="text" value="' + esc(l.name) + '" placeholder="장소 이름 (예: 수영장)" style="' + inStyle + 'margin-bottom:6px;"/>' +
            '<textarea class="bgref-desc" placeholder="배경 플레이트 묘사 (캐릭터·동작 없이 공간만)" style="' + inStyle + 'resize:none;overflow:hidden;min-height:64px;">' + esc(l.description) + '</textarea>' +
            '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;">' +
              '<button type="button" class="btn-secondary compact bgref-gen" style="' + btnH + '"' + (l._busy ? ' disabled' : '') + '>' + (l._busy ? '생성 중...' : (l.refObjectName ? '배경 재생성' : '배경 생성')) + '</button>' +
              '<button type="button" class="btn-ghost compact bgref-del" style="' + btnH + '">삭제</button>' +
              '<span class="muted" style="font-size:11px;">씬 ' + (l.sceneIds ? l.sceneIds.length : 0) + '개</span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
    overlay.innerHTML =
      '<div class="cpbm-box" style="max-width:820px;width:92vw;max-height:88vh;display:flex;flex-direction:column;">' +
        '<h3 class="cpbm-title">배경 레퍼런스 (공간)</h3>' +
        '<p class="cpbm-help">이 에피소드의 공간 목록이에요. 각 공간의 <strong>배경 플레이트</strong>(캐릭터 없는 빈 배경)를 생성해 두면, 컷 생성 시 그 컷의 장소 배경을 참조해 <strong>배경은 일관되게·구도는 자유롭게</strong> 만들 수 있어요. (브랜드 세계관 배경과 별개의 에피소드 전용입니다.)</p>' +
        '<div style="overflow-y:auto;flex:1;min-height:80px;">' + (rows || '<p class="muted" style="text-align:center;padding:20px;">추출된 공간이 없어요. "씬에서 다시 추출"을 눌러보세요.</p>') + '</div>' +
        '<div style="display:flex;gap:6px;margin-top:8px;">' +
          '<button type="button" class="btn-secondary compact" id="bgref-add">+ 장소 추가</button>' +
          '<button type="button" class="btn-secondary compact" id="bgref-reextract">씬에서 다시 추출</button>' +
        '</div>' +
        '<div class="cpbm-actions">' +
          '<button type="button" class="btn-ghost" id="bgref-cancel">닫기</button>' +
          '<button type="button" class="btn-primary" id="bgref-save">저장</button>' +
        '</div>' +
      '</div>';
    bind();
  }

  // 묘사 텍스트영역 자동 높이(스크롤 없이 전체 내용이 보이도록).
  function autoGrow(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  // 썸네일 클릭 라이트박스(원본 크기 보기).
  function openLightbox(url) {
    if (!url) return;
    var lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
    lb.innerHTML = '<img src="' + esc(url) + '" alt="" style="max-width:92vw;max-height:92vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);"/>';
    lb.addEventListener('click', function () { try { lb.remove(); } catch (_) {} });
    document.body.appendChild(lb);
  }

  function bind() {
    overlay.querySelectorAll('.bgref-item').forEach(function (el) {
      var i = Number(el.getAttribute('data-idx'));
      var del = el.querySelector('.bgref-del');
      if (del) del.onclick = function () { syncFromInputs(); locs.splice(i, 1); render(); };
      var gen = el.querySelector('.bgref-gen');
      if (gen) gen.onclick = function () { syncFromInputs(); generatePlate(i); };
      var ta = el.querySelector('.bgref-desc');
      if (ta) { autoGrow(ta); ta.addEventListener('input', function () { autoGrow(ta); }); }
      var thumb = el.querySelector('.bgref-thumb-img');
      if (thumb) thumb.onclick = function () { openLightbox(thumb.getAttribute('data-full')); };
    });
    var addBtn = overlay.querySelector('#bgref-add');
    if (addBtn) addBtn.onclick = function () { syncFromInputs(); locs.push({ id: '', name: '', description: '', refObjectName: '', sceneIds: [], _busy: false }); render(); };
    var reBtn = overlay.querySelector('#bgref-reextract');
    if (reBtn) reBtn.onclick = reextract;
    var cancel = overlay.querySelector('#bgref-cancel'); if (cancel) cancel.onclick = close;
    var saveBtn = overlay.querySelector('#bgref-save'); if (saveBtn) saveBtn.onclick = doSave;
  }

  async function generatePlate(i) {
    var l = locs[i]; if (!l) return;
    if (!String(l.description || '').trim() && !String(l.name || '').trim()) { alert('묘사 또는 이름을 입력하세요.'); return; }
    l._busy = true; render();
    try {
      var st = ctxRef.getState();
      var prompt = [st.header || '', l.description || l.name,
        'Empty location background plate of this place. Wide establishing view of the environment ONLY — no characters, no people, no creatures, nothing held by anyone. Clean background for compositing.'
      ].filter(Boolean).join('\n');
      var json = await NK.api.imagen({
        prompt: prompt,
        aspectRatio: st.aspectRatio || '16:9',
        projectId: st.draftId || '',
        generationMode: 'text-to-image',
        referenceImages: []
      });
      l.refObjectName = String(json.objectName || '').trim() || l.refObjectName;
      if (!l.refObjectName && json.dataUrl) l._dataUrl = json.dataUrl;
      l._busy = false; render();
    } catch (e) {
      l._busy = false; render();
      alert('배경 생성 실패: ' + (e && e.message ? e.message : e));
    }
  }

  async function reextract() {
    var st = ctxRef.getState();
    if (!NK.api || !NK.api.scenarioLocations) { alert('추출 API를 사용할 수 없습니다.'); return; }
    var reBtn = overlay.querySelector('#bgref-reextract');
    if (reBtn) { reBtn.disabled = true; reBtn.textContent = '추출 중...'; }
    try {
      syncFromInputs();
      var r = await NK.api.scenarioLocations(st.scenes || [], (st.payload && st.payload.language) === 'en' ? 'en' : 'ko');
      if (r && Array.isArray(r.locations)) {
        var prevByName = {};
        locs.forEach(function (p) { if (p.name) prevByName[String(p.name).trim().toLowerCase()] = p; });
        locs = r.locations.map(function (nl) {
          var prev = prevByName[String(nl.name || '').trim().toLowerCase()];
          return { id: nl.id || '', name: nl.name || '', description: nl.description || '', refObjectName: (prev && prev.refObjectName) || nl.refObjectName || '', sceneIds: nl.sceneIds || [], _busy: false };
        });
        render();
      }
    } catch (e) {
      alert('추출 실패: ' + (e && e.message ? e.message : e));
      var rb = overlay.querySelector('#bgref-reextract'); if (rb) { rb.disabled = false; rb.textContent = '씬에서 다시 추출'; }
    }
  }

  function doSave() {
    syncFromInputs();
    var cleaned = locs
      .filter(function (l) { return String(l.name || '').trim() || String(l.description || '').trim(); })
      .map(function (l) {
        return { id: l.id || slug(l.name), name: String(l.name || '').trim(), description: String(l.description || '').trim(), refObjectName: l.refObjectName || '', sceneIds: Array.isArray(l.sceneIds) ? l.sceneIds : [] };
      });
    var st = ctxRef.getState();
    st.payload = Object.assign({}, st.payload, { episodeLocations: cleaned });
    ctxRef.setState(st);
    if (ctxRef.persistPipeline) ctxRef.persistPipeline();
    if (ctxRef.updateDraftFromPipeline) ctxRef.updateDraftFromPipeline();
    try {
      var pid = st.draftId || '';
      if (pid && NK.api && NK.api.projectSave) {
        NK.api.projectSave(pid, st.payload || {}, st.scenes || [], { header: st.header || '', aspectRatio: st.aspectRatio || '' }).catch(function () {});
      }
    } catch (_) {}
    close();
  }

  render();
}

function buildSceneRowHtml(s, header) {
  var helpers = getPipelineSceneRowHelpers();
  var ctxRef = (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  var st = (ctxRef && ctxRef.getState) ? ctxRef.getState() : null;
  if (!helpers.buildSceneRowHtml) return '';
  return helpers.buildSceneRowHtml(s, header, {
    statePayload: st && st.payload ? st.payload : {},
    toPlayableMediaUrl: toPlayableMediaUrl,
    allScenes: st && st.scenes ? st.scenes : []
  });
}

// 'image' 부분 업데이트는 이미지 슬롯만 교체하므로, 이미지 유무에 의존하는 액션 버튼
// (수정/삭제/다운로드/되돌리기)과 헤더의 IMG 칩이 이전 상태로 남는다.
// → "이미지 생성했는데 수정 버튼이 비활성" 버그(생성은 part='image' 로 갱신하기 때문).
// 이미지 슬롯을 갱신할 때 이 컨트롤들을 현재 scene 상태로 함께 동기화한다.
function syncImageDependentControls(row, scene) {
  if (!row || !scene) return;
  var hasImage = !!scene.imageDataUrl;
  var hasHistory = Array.isArray(scene.imageHistory) && scene.imageHistory.length > 0;
  var byAction = function (action) {
    return row.querySelector('[data-action="' + action + '"][data-id="' + scene.id + '"]');
  };
  [['edit-image', !hasImage], ['delete-image', !hasImage], ['download-image', !hasImage], ['revert-image', !hasHistory]]
    .forEach(function (pair) { var btn = byAction(pair[0]); if (btn) btn.disabled = !!pair[1]; });
  var regenBtn = byAction('regen-image');
  if (regenBtn) regenBtn.textContent = scene.imgLoading ? '생성중(취소)' : '이미지 생성';
  var chips = row.querySelector('.scene-row-chips');
  if (chips) {
    var imgChip = chips.querySelector('.chip-image');
    if (hasImage && !imgChip) {
      var vidChip = chips.querySelector('.chip-video');
      var chipHtml = '<span class="scene-row-chip chip-image">IMG</span>';
      if (vidChip) vidChip.insertAdjacentHTML('beforebegin', chipHtml);
      else chips.insertAdjacentHTML('beforeend', chipHtml);
    } else if (!hasImage && imgChip) {
      imgChip.remove();
    }
  }
}

// part='video' 부분 갱신은 비디오 슬롯만 교체하므로, 영상 유무에 의존하는 액션 버튼
// (삭제/다운로드)과 VID 칩, 영상 생성 버튼 라벨이 stale 로 남는다.
// → "영상 생성했는데 다운로드 버튼이 비활성" 버그. 비디오 슬롯 갱신 시 함께 동기화한다.
function syncVideoDependentControls(row, scene) {
  if (!row || !scene) return;
  // 표시(buildVideoCard)와 다운로드 핸들러 모두 scene.videoUrl 기준이므로 동일 기준으로 맞춘다.
  var hasVideo = !!scene.videoUrl;
  var srMod = (window.NK && NK.uiPipelineSceneRow) || {};
  var videoBusy = srMod.isSceneVideoProcessing
    ? srMod.isSceneVideoProcessing(scene)
    : (String(scene.videoStatus || '').toLowerCase() === 'processing');
  var byAction = function (action) {
    return row.querySelector('[data-action="' + action + '"][data-id="' + scene.id + '"]');
  };
  [['delete-video', !hasVideo], ['download-video', !hasVideo]]
    .forEach(function (pair) { var btn = byAction(pair[0]); if (btn) btn.disabled = !!pair[1]; });
  var vidBtn = byAction('video');
  if (vidBtn) vidBtn.textContent = videoBusy ? '생성중(취소)' : '영상 생성';
  var chips = row.querySelector('.scene-row-chips');
  if (chips) {
    var vidChip = chips.querySelector('.chip-video');
    if (hasVideo && !vidChip) {
      chips.insertAdjacentHTML('beforeend', '<span class="scene-row-chip chip-video">VID</span>');
    } else if (!hasVideo && vidChip) {
      vidChip.remove();
    }
  }
}

function updateSceneRow(idx, headerText, partHint) {
  // ctx는 IIFE 내부 변수라 외부 헬퍼에서 접근할 수 있도록 ui.__ctx를 참조
  var ctxRef = (typeof ctx !== 'undefined' && ctx) || (window.NK && NK.uiPipeline && NK.uiPipeline.__ctx) || null;
  if (!ctxRef || !ctxRef.getState) return;
  var st = ctxRef.getState();
  if (!st || !st.scenes || st.scenes.length <= idx) return;
  var scene = st.scenes[idx];
  var header = headerText || st.header || '';
  var row = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
  if (!row) { if (NK.uiPipeline && NK.uiPipeline.render) NK.uiPipeline.render(); return; }

  var helpers = getPipelineSceneRowHelpers();
  var payload = st && st.payload ? st.payload : {};
  var voiceEnabled = isVoiceFeatureEnabled(payload);
  var voiceBusy = isSceneVoiceProcessing(scene);

  if (partHint === 'voice' && helpers.buildVoiceBlock) {
    var target = row.querySelector('.voice-block');
    if (target) {
      var resolved = '';
      try {
        var raw = scene && scene.voiceUrl;
        var obj = scene && scene.voiceObjectName;
        var viaObj = (obj && window.NK && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(obj) : '';
        resolved = toPlayableMediaUrl(raw || viaObj || '');
      } catch (_) { resolved = ''; }
      var html = helpers.buildVoiceBlock(scene, { voiceEnabled: voiceEnabled, voiceBusy: voiceBusy, toPlayableMediaUrl: toPlayableMediaUrl });
      target.outerHTML = html;
      try {
        var checkRow = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
        var audioEl = checkRow ? checkRow.querySelector('audio') : null;
        if (audioEl && resolved) {
          if (!audioEl.src || audioEl.src !== resolved) {
            audioEl.src = resolved;
            try { audioEl.removeAttribute('disabled'); } catch (_) {}
            try { audioEl.load(); } catch (_) {}
          }
        }
        var audioCount = checkRow ? checkRow.querySelectorAll('audio').length : 0;
      } catch (_) {}
      return;
    }
  }
  if (partHint === 'image' && helpers.buildImageCard) {
    var stack = row.querySelector('.scene-media-stack');
    if (stack) {
      var imgSlot = stack.querySelector('.image-slot');
      var imgHtml = helpers.buildImageCard(scene, toPlayableMediaUrl);
      if (imgSlot) imgSlot.innerHTML = imgHtml;
      else stack.insertAdjacentHTML('afterbegin', '<div class="image-slot">' + imgHtml + '</div>');
      // 이미지 슬롯만 바꾸면 수정/삭제/다운로드/되돌리기 버튼과 IMG 칩이 stale 상태로 남으므로 함께 동기화
      syncImageDependentControls(row, scene);
      return;
    }
  }
  if (partHint === 'video' && helpers.buildVideoCard) {
    var stack2 = row.querySelector('.scene-media-stack');
    if (stack2) {
      var vidSlot = stack2.querySelector('.video-slot');
      var vidHtml = helpers.buildVideoCard(scene, toPlayableMediaUrl);
      if (vidSlot) vidSlot.innerHTML = vidHtml;
      else stack2.insertAdjacentHTML('beforeend', '<div class="video-slot">' + vidHtml + '</div>');
      // 비디오 슬롯만 바꾸면 삭제/다운로드 버튼·VID 칩이 stale 상태로 남으므로 함께 동기화
      syncVideoDependentControls(row, scene);
      return;
    }
  }
  if (partHint === 'shots' && helpers.buildShotSection) {
    var existing = row.querySelector('.scene-shot-section');
    var newShotsHtml = helpers.buildShotSection(scene, { toPlayableMediaUrl: toPlayableMediaUrl });
    if (existing) {
      // 펼침 상태 보존
      var wasCollapsed = existing.classList.contains('is-collapsed');
      if (newShotsHtml) {
        existing.outerHTML = newShotsHtml;
        if (wasCollapsed) {
          var refreshed = row.querySelector('.scene-shot-section');
          if (refreshed) refreshed.classList.add('is-collapsed');
        }
      } else {
        existing.remove();
      }
    } else if (newShotsHtml) {
      var bodyWrap = row.querySelector('.scene-row-body-wrap');
      if (bodyWrap) bodyWrap.insertAdjacentHTML('beforeend', newShotsHtml);
    }
    return;
  }
  // shot 단위 부분 업데이트 — 'shot:<sceneId>:<shotId>'
  if (typeof partHint === 'string' && partHint.indexOf('shot:') === 0 && helpers.buildShotRowHtml) {
    var parts = partHint.split(':');
    var targetShotId = parts.slice(2).join(':');
    var shots = Array.isArray(scene.shots) ? scene.shots : [];
    var shotIdx = shots.findIndex(function (sh) { return String(sh && sh.id) === String(targetShotId); });
    if (shotIdx >= 0) {
      var shotLi = row.querySelector('.shot-row[data-shot-id="' + (window.CSS && CSS.escape ? CSS.escape(targetShotId) : targetShotId) + '"]');
      var newRowHtml = helpers.buildShotRowHtml(scene, shots[shotIdx], shotIdx, toPlayableMediaUrl);
      if (shotLi) {
        shotLi.outerHTML = newRowHtml;
      } else {
        // shot 섹션을 통째로 다시
        if (helpers.buildShotSection) {
          var existing2 = row.querySelector('.scene-shot-section');
          var newShotsHtml2 = helpers.buildShotSection(scene, { toPlayableMediaUrl: toPlayableMediaUrl });
          if (existing2) existing2.outerHTML = newShotsHtml2;
          else if (newShotsHtml2) {
            var bw = row.querySelector('.scene-row-body-wrap');
            if (bw) bw.insertAdjacentHTML('beforeend', newShotsHtml2);
          }
        }
      }
      return;
    }
  }

  // 폴백: 행 전체 재구성
  var rebuilt = buildSceneRowHtml(scene, header);
  row.outerHTML = rebuilt;
  try {
    var newRow = document.querySelector('.scene-row[data-id="' + scene.id + '"]');
    var audioEl2 = newRow ? newRow.querySelector('audio') : null;
    var raw2 = scene && scene.voiceUrl;
    var obj2 = scene && scene.voiceObjectName;
    var viaObj2 = (obj2 && window.NK && NK.api && NK.api.mediaProxyObjectUrl) ? NK.api.mediaProxyObjectUrl(obj2) : '';
    var resolved2 = toPlayableMediaUrl(raw2 || viaObj2 || '');
    if (audioEl2 && resolved2) {
      audioEl2.src = resolved2;
      try { audioEl2.removeAttribute('disabled'); } catch (_) {}
      try { audioEl2.load(); } catch (_) {}
    }
    var audioCount2 = newRow ? newRow.querySelectorAll('audio').length : 0;
  } catch (_) {}
}
