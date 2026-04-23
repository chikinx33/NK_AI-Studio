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
    return String(NK.state?.runtime?.currentProject?.id || '').trim();
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
      const showBlockingLoading = !(Array.isArray(drafts) && drafts.length);
      try {
        if (showBlockingLoading) setDashLoading(true, DASHBOARD_LOADING_TEXT);
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
        let changed = false;
        const idSet = new Set(ids.map((v) => String(v)));
        const filtered = drafts.filter(d => idSet.has(String(d.id)));
        if (filtered.length !== drafts.length) {
          drafts = filtered;
          changed = true;
        }
        const knownIds = new Set(drafts.map((d) => String(d.id)));
        const missingIds = ids.filter((id) => !knownIds.has(String(id)));
        if (changed) {
          if (NK.service?.project?.replaceLocalDrafts) NK.service.project.replaceLocalDrafts(drafts);
          else NK.store.saveDrafts(drafts);
        }
        if (!missingIds.length || !NK.api.projectGet) return;

        const fetchedDrafts = (await runTasksInBatches(missingIds, async (id) => {
          try {
            const res = await NK.api.projectGet(id);
            const data = res?.data || {};
            return normalizeDraft({
              id,
              title: data.title || data.payload?.episodeTitle || data.payload?.topic || '프로젝트',
              payload: data.payload || {},
              scenes: data.scenes || [],
              header: data.header || '',
            });
          } catch (_) {
            return normalizeDraft({ id, title: '프로젝트', payload: {}, scenes: [], header: '' });
          }
        }, 16)).filter(Boolean);

        if (!fetchedDrafts.length) return;
        const nextMap = new Map(drafts.map((draft) => [String(draft.id), draft]));
        fetchedDrafts.forEach((draft) => {
          nextMap.set(String(draft.id), draft);
        });
        const orderMap = new Map(ids.map((id, index) => [String(id), index]));
        drafts = Array.from(nextMap.values()).sort((a, b) => {
          const ai = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
          const bi = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
          return ai - bi;
        });
        if (NK.service?.project?.replaceLocalDrafts) NK.service.project.replaceLocalDrafts(drafts);
        else NK.store.saveDrafts(drafts);
        serverMerged = true;
      } catch (err) {
        serverMerged = true;
        const msg = String(err && err.message ? err.message : '');
        if (/invalid_session|auth_required|session_expired|\\b401\\b|\\b403\\b/i.test(msg)) {
          try { if (NK.auth && NK.auth.logout) NK.auth.logout(); } catch (_) {}
        }
      }
      finally {
        if (showBlockingLoading) setDashLoading(false);
      }
    };

    if (NK.api && NK.api.projectList && !serverMerged) {
      mergeFromServer().then(() => dashboard.renderDrafts());
    }

    drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
    const seriesList = listSeriesFromDrafts(drafts);
    if (currentSeriesFilter !== '__all__' && !seriesList.some((s) => s.id === currentSeriesFilter)) {
      currentSeriesFilter = '__all__';
    }
    const selectedSeries = seriesList.find((s) => s.id === currentSeriesFilter) || null;
    const filteredDrafts = currentSeriesFilter === '__all__'
      ? drafts
      : drafts.filter((d) => d.seriesId === currentSeriesFilter);

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

    const showCreateButton = host === 'brand';
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

    const selectedProjectId = getSelectedProjectId();
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

      return `
        <article class="draft-card ${isSelected ? 'is-selected' : ''}" data-draft-id="${escapeHtml(d.id)}">
          ${showTitleEdit ? `<button class="edit-btn top-right" data-action="title-edit" data-id="${escapeHtml(d.id)}" aria-label="제목 수정">&#9998;</button>` : ``}
          ${showDelete ? `<button class="trash-btn top-right action-trash" data-action="draft-delete" data-id="${escapeHtml(d.id)}" aria-label="삭제">&#128465;</button>` : ``}
          <div class="draft-top">
            <div class="draft-thumb"></div>
            <div class="draft-info">
              <div class="draft-title-row">
                <h4 class="draft-title" data-id="${escapeHtml(d.id)}">${escapeHtml(d.title || '제목없음')}</h4>
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
              <button class="btn-primary" data-action="draft-edit" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_preproduction_fixed">Pre - production</button>
              <button class="btn-secondary" data-action="draft-production" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_production_fixed">Production</button>
              <button class="btn-secondary" data-action="draft-post" data-id="${escapeHtml(d.id)}" data-i18n="sidebar_postproduction_fixed">Post - production</button>
            </div>` : ``}
        </article>
      `;
    }).join('');

    container.innerHTML = filterBar + list;

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
        dashboard.renderDrafts();
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
      } else if (action === 'draft-delete') {
        (async () => {
          var ok = true;
          if (NK.ui && NK.ui.dialog && NK.ui.dialog.confirm) {
            ok = await NK.ui.dialog.confirm('삭제하시겠습니까?', { title: '삭제 확인' });
          } else {
            ok = confirm('삭제하시겠습니까?');
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

    container.innerHTML = `
      <div class="draft-top">
        <div class="draft-thumb"></div>
      </div>
      <h4 class="sidebar-card-title">${escapeHtml(normalized.title || '제목없음')}</h4>
      <p class="sidebar-card-lines">${escapeHtml(desc)}</p>
      <div class="sidebar-card-actions">
        <button class="btn-secondary" data-action="sidebar-edit-scenario" data-i18n="sidebar_preproduction_fixed">Pre - production</button>
        <button class="btn-secondary" data-action="sidebar-edit-scenes" data-i18n="sidebar_production_fixed">Production</button>
        <button class="btn-secondary" data-action="sidebar-edit-media" data-i18n="sidebar_postproduction_fixed">Post - production</button>
      </div>
    `;
    container.style.display = 'block';
    setSidebarProjectLayout(true);
  };
})();
