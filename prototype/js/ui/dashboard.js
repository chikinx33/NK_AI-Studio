; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var dashboard = ui.dashboard || (ui.dashboard = {});

  var serverMerged = false;
  var currentSeriesFilter = '__all__';
  var DASHBOARD_LOADING_TEXT = '프로젝트 불러오는 중...';

  const escapeHtml = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const truncateEpisodeTitle = (value) => {
    const s = String(value == null ? '' : value);
    const arr = Array.from(s);
    const max = 20;
    return arr.length > max ? arr.slice(0, max).join('') + '...' : s;
  };

  const triggerThumbnailUpload = (projectId, anchorEl) => {
    const id = String(projectId || '').trim();
    if (!id) return;
    if (!NK.api || typeof NK.api.imageUpload !== 'function') {
      alert('이미지 업로드 API를 사용할 수 없습니다.');
      return;
    }
    if (!NK.service || !NK.service.project || typeof NK.service.project.updatePayload !== 'function') {
      alert('프로젝트 저장 API를 사용할 수 없습니다.');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => {
      try { input.remove(); } catch (_) { }
    };
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) { cleanup(); return; }
      const prevDisabled = anchorEl && 'disabled' in anchorEl ? anchorEl.disabled : false;
      try {
        if (anchorEl) {
          anchorEl.classList.add('is-busy');
          if ('disabled' in anchorEl) anchorEl.disabled = true;
        }
        const resp = await NK.api.imageUpload(id, file);
        const objectName = String(resp && resp.objectName || '').trim();
        if (!objectName) throw new Error('objectName_missing');
        const allDrafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const thisDraft = allDrafts.find(d => String(d.id) === id);
        const seriesId = thisDraft && thisDraft.seriesId;
        const targets = seriesId
          ? allDrafts.filter(d => String(d.seriesId) === String(seriesId))
          : allDrafts.filter(d => String(d.id) === id);
        await Promise.all(targets.map(d => NK.service.project.updatePayload(d.id, { thumbnailObjectName: objectName })));
        if (NK.ui && NK.ui.dashboard && typeof NK.ui.dashboard.renderDrafts === 'function') {
          NK.ui.dashboard.renderDrafts();
        }
        try {
          const current = NK.service.project.resolveCurrent
            ? NK.service.project.resolveCurrent({ search: window.location.search })
            : null;
          if (current && String(current.id) === id && NK.ui && NK.ui.dashboard && typeof NK.ui.dashboard.renderSidebarProjectCard === 'function') {
            NK.ui.dashboard.renderSidebarProjectCard(current);
          }
        } catch (_) { }
      } catch (err) {
        alert('썸네일 업로드 실패: ' + (err && err.message ? err.message : err));
      } finally {
        if (anchorEl) {
          anchorEl.classList.remove('is-busy');
          if ('disabled' in anchorEl) anchorEl.disabled = prevDisabled;
        }
        cleanup();
      }
    }, { once: true });
    input.click();
  };

  const setDashLoading = (show, text) => {
    const overlay = document.getElementById('dashboard-loading');
    const blurTarget = document.getElementById('dashboard-drafts');
    if (!overlay) return;
    const p = overlay.querySelector('p');
    if (p) p.textContent = text || DASHBOARD_LOADING_TEXT;
    overlay.classList.toggle('hidden', !show);
    if (blurTarget) blurTarget.classList.toggle('blur-active', !!show);
  };

  const normalizeSeriesId = (value) => String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '');

  const normalizeDraft = (draft) => {
    if (NK.service?.project?.normalizeDraft) {
      return NK.service.project.normalizeDraft(draft);
    }
    const id = String(draft?.id || '').trim();
    if (!id) return null;
    const payload = Object.assign({}, draft?.payload || {});
    const seriesId = normalizeSeriesId(payload.seriesId || draft?.seriesId) || ('projects' + id);
    const seriesTitle = String(payload.seriesTitle || draft?.seriesTitle || draft?.title || seriesId).trim() || seriesId;
    payload.seriesId = seriesId;
    payload.seriesTitle = seriesTitle;
    const title = String(draft?.title || payload.episodeTitle || seriesTitle || '제목없음').trim() || '제목없음';
    return Object.assign({}, draft || {}, { id, title, seriesId, seriesTitle, payload });
  };

  const listSeriesFromDrafts = (drafts) => {
    const map = new Map();
    (Array.isArray(drafts) ? drafts : []).forEach((d) => {
      const nd = normalizeDraft(d);
      if (!nd) return;
      if (!map.has(nd.seriesId)) map.set(nd.seriesId, { id: nd.seriesId, title: nd.seriesTitle, count: 0, latestEpisodeId: nd.id });
      const row = map.get(nd.seriesId);
      row.count += 1;
      if (Number(nd.id) > Number(row.latestEpisodeId || 0)) row.latestEpisodeId = nd.id;
    });
    return Array.from(map.values()).sort((a, b) => Number(b.latestEpisodeId || 0) - Number(a.latestEpisodeId || 0));
  };

  const runTasksInBatches = async (items, worker, concurrency) => {
    const src = Array.isArray(items) ? items.slice() : [];
    const limit = Math.max(1, Number(concurrency) || 6);
    if (!src.length) return [];
    const results = new Array(src.length);
    let nextIdx = 0;
    const runWorker = async () => {
      while (nextIdx < src.length) {
        const i = nextIdx++;
        results[i] = await Promise.resolve().then(() => worker(src[i], i));
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, src.length) }, runWorker));
    return results;
  };

  const getContentSummary = (draft) => {
    try {
      if (NK.service && NK.service.contentLibrary && NK.service.contentLibrary.summarizeProject) {
        return NK.service.contentLibrary.summarizeProject(draft);
      }
    } catch (_) { }
    return { scenes: 0, texts: 0, images: 0, videos: 0, completedScenes: 0, nextAction: '시나리오 작성' };
  };

  const refreshSidebarCardFromState = () => {
    if (!NK.ui || !NK.ui.dashboard || !NK.ui.dashboard.renderSidebarProjectCard) return;
    const cur = NK.state?.runtime?.currentProject || null;
    NK.ui.dashboard.renderSidebarProjectCard(cur);
  };

  const setSidebarProjectLayout = (hasProject) => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('has-project-selection', !!hasProject);
  };

  const getSelectedProjectId = () => {
    // 1순위: pre/prod/post에서 가장 최근 작업한 프로젝트 (lastUsedAt)
    try {
      const drafts = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts() : [];
      if (Array.isArray(drafts) && drafts.length) {
        let recentId = '';
        let recentTs = 0;
        drafts.forEach(d => {
          if (!d || !d.id) return;
          const ts = Date.parse(d.lastUsedAt || '');
          if (Number.isFinite(ts) && ts > recentTs) {
            recentTs = ts;
            recentId = String(d.id).trim();
          }
        });
        if (recentId) return recentId;
      }
    } catch (_) {}
    // 2순위: 런타임 currentProject
    const runtimeId = String(NK.state?.runtime?.currentProject?.id || '').trim();
    if (runtimeId) return runtimeId;
    // 3순위: 로컬 스토리지
    try {
      const key = (NK.config && NK.config.KEYS && NK.config.KEYS.CURRENT_PROJECT) || 'nk_current_project';
      const raw = localStorage.getItem(key) || localStorage.getItem('nk_current_project');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return String(parsed.id).trim();
      }
    } catch (_) {}
    return '';
  };

  const getHostShell = () => {
    const body = document.body || {};
    const html = document.documentElement || {};
    const cls = (String(html.className || '') + ' ' + String(body.className || '')).toLowerCase();
    if (/\bpage-shell-brand\b/.test(cls)) return 'brand';
    if (/\bpage-shell-videogen\b/.test(cls)) return 'videogen';
    if (/\bpage-shell-video\b/.test(cls)) return 'video';
    if (/\bpage-shell-image\b/.test(cls)) return 'image';
    try {
      const url = String(window.location && window.location.href || '').toLowerCase();
      if (/brand-dashboard\.html|brand-studio\.html|brand\.html|knowledge\.html|analytics\.html/.test(url)) return 'brand';
      if (/video-gen-dashboard\.html|ai-video-gen\.html|ai-video-gen-stage\.html/.test(url)) return 'videogen';
      if (/video-dashboard\.html|ai-video\.html/.test(url)) return 'video';
      if (/image-dashboard\.html|ai-image\.html|ai-image-stage\.html/.test(url)) return 'image';
    } catch (_) { }
    try {
      const ref = String(document.referrer || '').toLowerCase();
      if (/brand-dashboard\.html|brand-studio\.html|brand\.html|knowledge\.html|analytics\.html/.test(ref)) return 'brand';
      if (/video-gen-dashboard\.html|ai-video-gen\.html|ai-video-gen-stage\.html/.test(ref)) return 'videogen';
      if (/video-dashboard\.html|ai-video\.html/.test(ref)) return 'video';
      if (/image-dashboard\.html|ai-image\.html|ai-image-stage\.html/.test(ref)) return 'image';
    } catch (_) { }
    try {
      const qp = new URLSearchParams(String(window.location.search || ''));
      const h = String(qp.get('host') || '').toLowerCase();
      if (h === 'brand' || h === 'video' || h === 'image' || h === 'videogen') return h;
    } catch (_) { }
    return 'video';
  };

  const getPrimaryDraftForSeries = (seriesId, drafts) => {
    const targetSeriesId = String(seriesId || '').trim();
    if (!targetSeriesId) return null;
    return (Array.isArray(drafts) ? drafts : [])
      .filter((draft) => String(draft?.seriesId || '').trim() === targetSeriesId)
      .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))[0] || null;
  };

  const syncBrandContextFromDraft = (draft) => {
    if (!draft || !NK.service?.brand) return;
    const payload = draft.payload || {};
    try {
      let currentBrand = null;
      if (payload.brandId && NK.service.brand.getById) {
        currentBrand = NK.service.brand.getById(payload.brandId);
      }
      if (!currentBrand && draft.seriesId && NK.service.brand.getBySeriesId) {
        currentBrand = NK.service.brand.getBySeriesId(draft.seriesId);
      }
      if (!currentBrand && NK.service.brand.upsertFromProject) {
        currentBrand = NK.service.brand.upsertFromProject(draft);
      }
      if (currentBrand && NK.service.brand.setCurrent) {
        NK.service.brand.setCurrent(currentBrand);
      }
    } catch (_) { }
  };

  const selectProject = (draft) => {
    if (!draft) return;
    if (NK.service?.project?.setCurrent) NK.service.project.setCurrent(draft);
    syncBrandContextFromDraft(draft);
    if (NK.state?.broadcast) NK.state.broadcast('update-project', { project: draft });
  };

  dashboard.triggerThumbnailUpload = triggerThumbnailUpload;

  dashboard.renderDrafts = function () {
    const container = document.getElementById('dashboard-drafts');
    if (!container) return;

    if (!window.__nk_dashboard_global_click_bound) {
      window.__nk_dashboard_global_click_bound = true;
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action || '';
        if (!['draft-edit', 'draft-production', 'draft-post'].includes(action)) return;
        try { if (container.onclick) container.onclick(e); } catch (_) { }
      }, true);
    }

    try {
      if (getHostShell() === 'image') sessionStorage.removeItem('nk_ai_image_selection_explicit');
      if (getHostShell() === 'videogen') sessionStorage.removeItem('nk_ai_video_gen_selection_explicit');
    } catch (_) {}
    let drafts = NK.store.getDrafts();
    const mergeFromServer = async () => {
      if (!NK.api || !NK.api.projectList) return;
      if (serverMerged) return;
      if (typeof window !== 'undefined') {
        if (window.__nk_projects_sync_started) {
          serverMerged = true;
          return;
        }
        window.__nk_projects_sync_started = true;
      }
      if (!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed())) return;

      // 안전망: projectList가 600ms 안에 응답 안 오면 그제야 로딩 오버레이 (빠른 응답에는 안 보임)
      const hasLocalDrafts = Array.isArray(drafts) && drafts.length > 0;
      let loadingTimer = null;
      if (!hasLocalDrafts) {
        loadingTimer = setTimeout(() => {
          loadingTimer = null;
          setDashLoading(true, DASHBOARD_LOADING_TEXT);
        }, 600);
      }
      const clearLoading = () => {
        if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
        if (!hasLocalDrafts) setDashLoading(false);
      };

      try {
        // 부모 창에서 미리 시작한 prefetch 결과 재사용 (없으면 직접 호출)
        const prefetchedList = (() => { try { return window.parent !== window && window.parent.__nk_projects_list_prefetch ? window.parent.__nk_projects_list_prefetch : null; } catch (_) { return null; } })();
        if (prefetchedList) { try { window.parent.__nk_projects_list_prefetch = null; } catch (_) {} }
        const list = await (prefetchedList || NK.api.projectList());
        const ids = Array.isArray(list?.ids) ? list.ids.filter(id => id && String(id) !== 'default') : [];
        if (!ids.length) {
          drafts = [];
          if (NK.service?.project?.replaceLocalDrafts) NK.service.project.replaceLocalDrafts(drafts);
          else NK.store.saveDrafts(drafts);
          serverMerged = true;
          return;
        }

        drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const idSet = new Set(ids.map((v) => String(v)));
        drafts = drafts.filter(d => idSet.has(String(d.id)));
        const knownIds = new Set(drafts.map((d) => String(d.id)));
        const missingIds = ids.filter((id) => !knownIds.has(String(id)));

        const orderMap = new Map(ids.map((id, index) => [String(id), index]));
        const nextMap = new Map(drafts.map((draft) => [String(draft.id), draft]));

        // Placeholder: 모르는 id에 빈 draft를 즉시 추가하여 카드 슬롯이 바로 보이게 함
        // (__pending 플래그로 표시, 최종 persist 시 제외)
        missingIds.forEach((id) => {
          nextMap.set(String(id), normalizeDraft({
            id, title: '', payload: {}, scenes: [], header: '', __pending: true
          }));
        });

        const sortByOrder = (map) => Array.from(map.values()).sort((a, b) => {
          const ai = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
          const bi = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
        const persistFinal = () => {
          const sorted = sortByOrder(nextMap);
          const persistList = sorted.filter(d => !d.__pending);
          if (NK.service?.project?.replaceLocalDrafts) NK.service.project.replaceLocalDrafts(persistList);
          else NK.store.saveDrafts(persistList);
        };

        // 1차 즉시 렌더 (placeholder 포함). 로딩 오버레이는 즉시 해제.
        clearLoading();
        // 메모리 store에 임시 반영 (renderDrafts가 store에서 읽음)
        // pending 플래그 포함 - persist는 안 함
        NK.store.saveDrafts(sortByOrder(nextMap));
        dashboard.renderDrafts();

        if (!missingIds.length || !NK.api.projectGet) {
          serverMerged = true;
          return;
        }

        // worker pool로 병렬 fetch + 도착 즉시 부분 업데이트 (50ms throttled render)
        // - requestAnimationFrame은 background tab에서 throttle되므로 setTimeout 사용
        let renderScheduled = false;
        const scheduleRender = () => {
          if (renderScheduled) return;
          renderScheduled = true;
          setTimeout(() => {
            renderScheduled = false;
            NK.store.saveDrafts(sortByOrder(nextMap));
            dashboard.renderDrafts();
          }, 50);
        };

        await runTasksInBatches(missingIds, async (id) => {
          try {
            const res = await NK.api.projectGet(id);
            const data = res?.data || {};
            nextMap.set(String(id), normalizeDraft({
              id,
              title: data.title || data.payload?.episodeTitle || data.payload?.topic || '프로젝트',
              payload: data.payload || {},
              scenes: data.scenes || [],
              header: data.header || '',
            }));
          } catch (_) {
            nextMap.set(String(id), normalizeDraft({ id, title: '프로젝트', payload: {}, scenes: [], header: '' }));
          }
          scheduleRender();
        }, 16);

        // 모든 데이터 도착 - 최종 persist + 마지막 render
        persistFinal();
        dashboard.renderDrafts();
        serverMerged = true;
      } catch (err) {
        serverMerged = true;
        const msg = String(err && err.message ? err.message : '');
        if (/invalid_session|auth_required|session_expired|\\b401\\b|\\b403\\b/i.test(msg)) {
          try { if (NK.auth && NK.auth.logout) NK.auth.logout(); } catch (_) {}
        }
      }
      finally {
        clearLoading();
      }
    };

    if (NK.api && NK.api.projectList && !serverMerged) {
      // mergeFromServer 자체가 점진적으로 renderDrafts를 호출하므로 .then 추가 호출은 불필요
      mergeFromServer();
    }

    drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
    const seriesList = listSeriesFromDrafts(drafts);
    if (currentSeriesFilter !== '__all__' && !seriesList.some((s) => s.id === currentSeriesFilter)) {
      currentSeriesFilter = '__all__';
    }
    const selectedSeries = seriesList.find((s) => s.id === currentSeriesFilter) || null;
    // 최신순 정렬: lastUsedAt 내림차순 → ID(생성 timestamp) 내림차순 폴백
    const sortByRecency = (a, b) => {
      const ta = Date.parse(a && a.lastUsedAt || '') || 0;
      const tb = Date.parse(b && b.lastUsedAt || '') || 0;
      if (ta !== tb) return tb - ta;
      return Number((b && b.id) || 0) - Number((a && a.id) || 0);
    };
    const filteredDrafts = (currentSeriesFilter === '__all__'
      ? drafts.slice()
      : drafts.filter((d) => d.seriesId === currentSeriesFilter)
    ).sort(sortByRecency);

    const fmtDuration = (sec) => {
      const n = Number(sec) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return `${n}s`;
    };
    const runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    const labels = runtimeLang === 'en'
      ? { project: 'Project', genre: 'Genre', target: 'Target', duration: 'Duration', aspect: 'Aspect ratio' }
      : { project: '프로젝트', genre: '장르', target: '타겟', duration: '길이', aspect: '비율' };
    const categoryTitle = runtimeLang === 'en' ? 'Category' : '카테고리';
    const host = getHostShell();
    const manageBarHtml = host === 'video' ? `
      <div class="series-manage-bar">
        <span class="series-manage-label">${selectedSeries ? `선택된 시리즈: ${escapeHtml(selectedSeries.title)}` : '시리즈를 선택하면 이름 변경/삭제를 할 수 있습니다.'}</span>
        <button class="btn-secondary compact ${selectedSeries ? '' : 'disabled'}" data-action="series-edit" ${selectedSeries ? '' : 'disabled'}>프로젝트 수정</button>
        <button class="btn-secondary compact danger ${selectedSeries ? '' : 'disabled'}" data-action="series-delete" ${selectedSeries ? '' : 'disabled'}>시리즈 삭제</button>
      </div>` : '';

    const showCreateButton = host === 'brand' || host === 'video';
    const filterBar = `
      <div class="series-filter-bar">
        <div class="series-filter-main">
          <div class="series-filter-header">
            <div class="series-filter-title-block">
              <p class="series-filter-eyebrow">Dashboard</p>
              <strong class="series-filter-title">${categoryTitle}</strong>
            </div>
          </div>
          <div class="series-filter-chip-row">
            <button class="chip series-chip ${currentSeriesFilter === '__all__' ? 'active' : ''}" data-action="series-filter" data-series-id="__all__">전체</button>
            ${seriesList.map((s) => `
              <button class="chip series-chip ${currentSeriesFilter === s.id ? 'active' : ''}" data-action="series-filter" data-series-id="${escapeHtml(s.id)}">
                ${escapeHtml(s.title)} (${s.count})
              </button>
            `).join('')}
          </div>
        </div>
        ${showCreateButton ? `<button class="btn-primary series-create-btn" data-action="create-project">신규</button>` : ``}
      </div>
      ${manageBarHtml}
    `;

    const _rawSelectedId = getSelectedProjectId();
    const selectedProjectId = _rawSelectedId ||
      (filteredDrafts.length > 0 ? String(filteredDrafts[0].id) : '');
    const showStageButtons = host === 'video';
    const showTitleEdit = (host === 'video' || host === 'brand');
    const showDelete = (host === 'video' || host === 'brand');

    const list = filteredDrafts.map(d => {
      const ar = d.payload?.aspectRatio || '16:9';
      const dur = fmtDuration(d.payload?.duration || 0);
      const cat = d.payload?.purposeCategory || '';
      const tags = Array.isArray(d.payload?.purposeTags) ? d.payload.purposeTags.join(', ') : '';
      const tgt = d.payload?.target || '';
      const genre = `${cat} ${tags}`.trim();
      const isSelected = selectedProjectId && String(selectedProjectId) === String(d.id);
      const thumbObj = String(d.payload?.thumbnailObjectName || '').trim();
      const thumbUrl = thumbObj && NK.api && typeof NK.api.mediaProxyObjectUrl === 'function'
        ? NK.api.mediaProxyObjectUrl(thumbObj)
        : '';
      const thumbHtml = thumbUrl
        ? `<button type="button" class="draft-thumb has-image" data-action="thumb-upload" data-id="${escapeHtml(d.id)}" aria-label="썸네일 변경" title="썸네일 변경"><img src="${escapeHtml(thumbUrl)}" alt="" /></button>`
        : `<button type="button" class="draft-thumb empty" data-action="thumb-upload" data-id="${escapeHtml(d.id)}" aria-label="썸네일 추가" title="썸네일 추가"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg></button>`;

      const editBtn = showTitleEdit ? `<button class="edit-btn" data-action="title-edit" data-id="${escapeHtml(d.id)}" aria-label="제목 수정">&#9998;</button>` : '';
      const duplicateBtn = showDelete ? `<button class="copy-btn" data-action="draft-duplicate" data-id="${escapeHtml(d.id)}" aria-label="복제" title="복제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="15" x2="15" y1="12" y2="18"></line><line x1="12" x2="18" y1="15" y2="15"></line><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button>` : '';
      const deleteBtn = showDelete ? `<button class="trash-btn action-trash" data-action="draft-delete" data-id="${escapeHtml(d.id)}" aria-label="삭제">&#128465;</button>` : '';
      const thumbBtnsHtml = (editBtn || duplicateBtn || deleteBtn) ? `<div class="draft-thumb-btns">${editBtn}${duplicateBtn}${deleteBtn}</div>` : '';

      const isPending = !!d.__pending;
      return `
        <article class="draft-card ${isSelected ? 'is-selected' : ''} ${isPending ? 'is-pending' : ''}" data-draft-id="${escapeHtml(d.id)}">
          <div class="draft-top">
            <div class="draft-thumb-col">
              ${thumbHtml}
              ${thumbBtnsHtml}
            </div>
            <div class="draft-info">
              <div class="draft-title-row">
                <h4 class="draft-title" data-id="${escapeHtml(d.id)}" title="${escapeHtml(d.title || '제목없음')}">${escapeHtml(host === 'video' ? truncateEpisodeTitle(d.title || '제목없음') : (d.title || '제목없음'))}</h4>
              </div>
              <div class="draft-meta">
                <div class="draft-meta-project">${labels.project} : ${escapeHtml(d.seriesTitle || '-')}</div>
                <div class="draft-meta-genre">${labels.genre} : ${escapeHtml(genre || '-')}</div>
                <div>${labels.target} : ${escapeHtml(tgt || '-')}</div>
                <div>${labels.duration} : ${escapeHtml(dur)} · ${labels.aspect} : ${escapeHtml(ar)}</div>
              </div>
            </div>
          </div>
          ${showStageButtons ? `
            <div class="draft-actions">
              <button class="btn-primary" data-action="draft-edit" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_preproduction_fixed">Pre-Prod</button>
              <button class="btn-secondary" data-action="draft-production" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_production_fixed">Production</button>
              <button class="btn-secondary" data-action="draft-post" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_postproduction_fixed">Post-Prod</button>
            </div>` : ``}
        </article>
      `;
    }).join('');

    container.innerHTML = filterBar + list;

    // 선택된 카드를 뷰포트 안으로 스크롤
    try {
      const selectedCard = container.querySelector('.draft-card.is-selected');
      if (selectedCard) selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (_) {}

    container.onclick = (e) => {
      const btn = e.target.closest('[data-action]');
      const card = e.target.closest('.draft-card[data-draft-id]');
      if (!btn && card) {
        const cardId = String(card.getAttribute('data-draft-id') || '').trim();
        if (!cardId) return;
        const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const draft = drafts.find(d => String(d.id) === cardId);
        if (!draft) return;
        selectProject(draft);
        container.querySelectorAll('.draft-card.is-selected').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const host = getHostShell();
        if (host === 'brand') {
          if (NK.navigation && NK.navigation.loadStage) NK.navigation.loadStage('brand.html');
          return;
        }
        if (host === 'image') {
          try { sessionStorage.setItem('nk_ai_image_selection_explicit', '1'); } catch (_) {}
          if (NK.navigation && NK.navigation.loadStage) NK.navigation.loadStage('ai-image-stage.html');
          return;
        }
        if (host === 'videogen') {
          try { sessionStorage.setItem('nk_ai_video_gen_selection_explicit', '1'); } catch (_) {}
          if (NK.navigation && NK.navigation.loadStage) NK.navigation.loadStage('ai-video-gen-stage.html');
          return;
        }
        return;
      }
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const isIframe = window.self !== window.top;
      const isStandaloneStage = !isIframe && document.querySelector('.app.no-sidebar');

      if (action === 'series-filter') {
        currentSeriesFilter = String(btn.dataset.seriesId || '__all__');
        if (currentSeriesFilter !== '__all__') {
          const primaryDraft = getPrimaryDraftForSeries(currentSeriesFilter, drafts);
          if (primaryDraft) selectProject(primaryDraft);
        }
        dashboard.renderDrafts();
        return;
      }

      // series-rename 기능은 영상 대시보드에서 제거됨

      if (action === 'series-edit') {
        if (!selectedSeries) return;
        if (NK.ui && NK.ui.openProjectOverlay) {
          NK.ui.openProjectOverlay({
            mode: 'edit-series',
            seriesId: selectedSeries.id
          });
        }
        return;
      }

      if (action === 'series-delete') {
        if (!selectedSeries) return;
        const targetCount = Number(selectedSeries.count || 0);
        const message = `시리즈 "${selectedSeries.title}"의 에피소드 ${targetCount}개를 모두 삭제합니다.\n계속하시겠습니까?`;
        (async () => {
          var ok = true;
          if (NK.ui && NK.ui.dialog && NK.ui.dialog.confirm) {
            ok = await NK.ui.dialog.confirm(message, { title: '시리즈 삭제 확인' });
          } else {
            ok = confirm(message);
          }
          if (!ok) return;
          setDashLoading(true, '시리즈 삭제 중...');
          try {
            await NK.service.project.deleteSeries(selectedSeries.id);
            currentSeriesFilter = '__all__';
            serverMerged = false;
            dashboard.renderDrafts();
            refreshSidebarCardFromState();
            alert('시리즈와 하위 에피소드가 삭제되었습니다.');
          } catch (err) {
            alert('시리즈 삭제 실패: ' + (err?.message || err));
          } finally {
            setDashLoading(false);
          }
        })();
        return;
      }

      if (action === 'title-edit') {
        const titleEl = container.querySelector(`.draft-title[data-id="${id}"]`);
        if (!titleEl) return;
        if (titleEl.isContentEditable) return;

        titleEl.contentEditable = 'true';
        titleEl.classList.add('editing');
        const range = document.createRange();
        range.selectNodeContents(titleEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        titleEl.focus();

        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
          const draft = drafts.find(d => String(d.id) === String(id));
          if (!draft) return;
          const newTitle = (titleEl.textContent || '').trim() || '제목없음';
          const nextDraft = Object.assign({}, draft, {
            title: newTitle,
            payload: Object.assign({}, draft.payload || {}, { episodeTitle: newTitle })
          });
          const savedDraft = NK.service?.project?.updateLocal
            ? NK.service.project.updateLocal(id, nextDraft, { forceCurrent: String(NK.service?.project?.getCurrentProjectId?.() || '') === String(id) })
            : (draft.title = newTitle, draft.payload = Object.assign({}, draft.payload || {}, { episodeTitle: newTitle }), NK.store.saveDrafts(drafts), draft);
          titleEl.textContent = newTitle;
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          if (NK.api && NK.api.projectSave) {
            const targetDraft = savedDraft || nextDraft;
            NK.api.projectSave(targetDraft.id, targetDraft.payload || {}, targetDraft.scenes || [], {
              header: targetDraft.header || '',
              aspectRatio: targetDraft.payload?.aspectRatio,
              title: newTitle
            }).catch(() => { });
          }
          alert('제목을 수정했습니다.');
        };

        const cancel = () => {
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          titleEl.textContent = titleEl.textContent || '제목없음';
        };

        titleEl.onkeydown = (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            cancel();
          }
        };
        titleEl.onblur = () => { commit(); titleEl.onblur = null; titleEl.onkeydown = null; };
      } else if (action === 'draft-edit') {
        const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          selectProject(draft);
          const url = draft.id ? `scenario.html?projectId=${encodeURIComponent(draft.id)}` : 'scenario.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
          }
        }
      } else if (action === 'draft-production') {
        const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          selectProject(draft);
          const url = draft.id ? `scenes.html?projectId=${encodeURIComponent(draft.id)}` : 'scenes.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
          }
        }
      } else if (action === 'draft-post') {
        const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
        const draft = drafts.find(d => String(d.id) === String(id));
        if (draft) {
          selectProject(draft);
          const url = draft.id ? `media.html?projectId=${encodeURIComponent(draft.id)}` : 'media.html';
          if (isStandaloneStage) {
            window.location.href = url;
          } else {
            NK.navigation.loadStage(url);
          }
        }
      } else if (action === 'create-project') {
        if (NK.ui && NK.ui.openProjectOverlay) {
          NK.ui.openProjectOverlay();
        } else {
          const overlay = document.getElementById('project-overlay');
          const app = document.querySelector('.app');
          if (overlay) overlay.classList.remove('hidden');
          if (app) app.classList.add('blur-active');
        }
      } else if (action === 'thumb-upload') {
        triggerThumbnailUpload(id, btn);
        return;
      } else if (action === 'draft-duplicate') {
        (async () => {
          if (!NK.service || !NK.service.project || !NK.service.project.duplicate) {
            alert('복제 기능을 사용할 수 없습니다.');
            return;
          }
          setDashLoading(true, '복제 중...');
          try {
            const cloned = await NK.service.project.duplicate(id);
            serverMerged = false;
            dashboard.renderDrafts();
            if (cloned) {
              NK.service.project.setCurrent(cloned);
              if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
                NK.ui.dashboard.renderSidebarProjectCard(cloned);
              }
            }
          } catch (err) {
            alert('복제 실패: ' + (err?.message || err));
          } finally {
            setDashLoading(false);
          }
        })();
      } else if (action === 'draft-delete') {
        (async () => {
          var ok = true;
          if (NK.ui && NK.ui.dialog && NK.ui.dialog.confirm) {
            ok = await NK.ui.dialog.confirm('해당 에피소드를 삭제하시겠습니까?', { title: '삭제 확인' });
          } else {
            ok = confirm('해당 에피소드를 삭제하시겠습니까?');
          }
          if (!ok) return;
          setDashLoading(true, '삭제 중...');
          NK.service.project.delete(id).catch((err) => {
            alert('삭제 중 오류가 발생했지만 로컬 목록은 정리했습니다. 새로고침 후 확인하세요.\n' + (err?.message || err));
          }).finally(() => {
            serverMerged = false;
            setDashLoading(false);
            dashboard.renderDrafts();
            if (NK.ui.dashboard && NK.ui.dashboard.renderSidebarProjectCard) {
              NK.ui.dashboard.renderSidebarProjectCard(null);
            }
          });
        })();
      }
    };

  };

  dashboard.renderSidebarProjectCard = function (draft) {
    const container = document.getElementById('sidebar-project-card');
    if (!container) return;
    const htmlCls = String(document.documentElement && document.documentElement.className || '').toLowerCase();
    const path = String(window.location.pathname || '').toLowerCase();
    const isBrandShell = /\bpage-shell-brand\b/.test(htmlCls) || /brand-studio|brand-dashboard/.test(path);
    const isImageShell = /\bpage-shell-image\b/.test(htmlCls) || /ai-image|image-dashboard/.test(path);
    const isVideoGenShell = /\bpage-shell-videogen\b/.test(htmlCls) || /ai-video-gen|video-gen-dashboard/.test(path);
    if (isBrandShell || isImageShell || isVideoGenShell) {
      container.innerHTML = '';
      container.style.display = 'none';
      setSidebarProjectLayout(false);
      return;
    }

    if (!draft) {
      container.innerHTML = '';
      container.style.display = 'none';
      setSidebarProjectLayout(false);
      return;
    }

    const normalized = normalizeDraft(draft) || draft;
    const ar = normalized.payload?.aspectRatio || '16:9';
    const dur = (() => {
      const n = Number(normalized.payload?.duration) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return n ? `${n}s` : '-';
    })();
    const cat = normalized.payload?.purposeCategory || '';
    const tags = Array.isArray(normalized.payload?.purposeTags) ? normalized.payload.purposeTags.join(', ') : '';
    const tgt = normalized.payload?.target || '';
    const genre = `${cat} ${tags}`.trim();
    const runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    const labels = runtimeLang === 'en'
      ? { project: 'Project', genre: 'Genre', target: 'Target', duration: 'Duration', aspect: 'Aspect ratio' }
      : { project: '프로젝트', genre: '장르', target: '타겟', duration: '길이', aspect: '비율' };
    const desc = [
      `${labels.project} : ${normalized.seriesTitle || '-'}`,
      `${labels.genre} : ${genre || '-'}`,
      `${labels.target} : ${tgt || '-'}`,
      `${labels.duration} : ${dur}`
    ].join('\n');

    const sidebarThumbObj = String(normalized.payload?.thumbnailObjectName || '').trim();
    const sidebarThumbUrl = sidebarThumbObj && NK.api && typeof NK.api.mediaProxyObjectUrl === 'function'
      ? NK.api.mediaProxyObjectUrl(sidebarThumbObj)
      : '';
    const sidebarThumbHtml = sidebarThumbUrl
      ? `<button type="button" class="draft-thumb has-image" data-action="thumb-upload" data-id="${escapeHtml(normalized.id)}" aria-label="썸네일 변경" title="썸네일 변경"><img src="${escapeHtml(sidebarThumbUrl)}" alt="" /></button>`
      : `<button type="button" class="draft-thumb empty" data-action="thumb-upload" data-id="${escapeHtml(normalized.id)}" aria-label="썸네일 추가" title="썸네일 추가"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg></button>`;

    container.innerHTML = `
      <div class="draft-top">
        ${sidebarThumbHtml}
      </div>
      <h4 class="sidebar-card-title" title="${escapeHtml(normalized.title || '제목없음')}">${escapeHtml(truncateEpisodeTitle(normalized.title || '제목없음'))}</h4>
      <p class="sidebar-card-lines">${escapeHtml(desc)}</p>
      <div class="sidebar-card-actions">
        <button class="btn-secondary" data-action="sidebar-edit-scenario" data-i18n="sidebar_preproduction_fixed">Pre-Prod</button>
        <button class="btn-secondary" data-action="sidebar-edit-scenes" data-i18n="sidebar_production_fixed">Production</button>
        <button class="btn-secondary" data-action="sidebar-edit-media" data-i18n="sidebar_postproduction_fixed">Post-Prod</button>
      </div>
    `;
    container.style.display = 'block';
    setSidebarProjectLayout(true);
  };
})();
