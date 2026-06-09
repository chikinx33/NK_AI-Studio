; (function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});
  var dashboard = ui.dashboard || (ui.dashboard = {});

  var serverMerged = false;
  var _sharedSettled = false;        // 공유받은 프로젝트 동기화 완료 여부
  var _initialLoadDone = false;      // 최초 대시보드 로딩(소유+공유) 완료 여부
  var _initialSpinnerActive = false; // 최초 로딩 스피너 표시 중 여부
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

  // 여러 비동기 로딩(소유 동기화 + 공유 동기화)이 겹쳐도 스피너가 모두 끝날 때까지
  // 유지되도록 참조 카운트로 관리한다.
  let _dashLoadingCount = 0;
  const dashLoadingShow = (text) => { _dashLoadingCount++; setDashLoading(true, text); };
  const dashLoadingHide = () => { _dashLoadingCount = Math.max(0, _dashLoadingCount - 1); if (_dashLoadingCount === 0) setDashLoading(false); };

  // 대시보드 진입 즉시(카드 그리기 전) 스피너를 띄우고, 소유 + 공유 동기화가 모두 끝나면 해제한다.
  const startInitialSpinner = () => {
    var authed = !!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed());
    if (authed && NK.api && NK.api.projectList && !_initialLoadDone && !_initialSpinnerActive) {
      _initialSpinnerActive = true;
      dashLoadingShow(DASHBOARD_LOADING_TEXT);
    }
  };
  const finishInitialLoadIfReady = () => {
    if (_initialSpinnerActive && serverMerged && _sharedSettled) {
      _initialSpinnerActive = false;
      _initialLoadDone = true;
      dashLoadingHide();
    }
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
    // 1순위: 사용자가 명시적으로 선택한 런타임 currentProject.
    // (카드 클릭 시 selectProject→setCurrent 가 여기에 반영됨. 명시적 선택은
    //  항상 lastUsedAt 휴리스틱보다 우선해야 한다 — 안 그러면 어떤 카드를
    //  눌러도 가장 최근 작업 프로젝트가 열리는 버그가 생긴다.)
    const runtimeId = String(NK.state?.runtime?.currentProject?.id || '').trim();
    if (runtimeId) return runtimeId;
    // 2순위: 로컬 스토리지에 저장된 명시적 선택
    try {
      const key = (NK.config && NK.config.KEYS && NK.config.KEYS.CURRENT_PROJECT) || 'nk_current_project';
      const raw = localStorage.getItem(key) || localStorage.getItem('nk_current_project');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return String(parsed.id).trim();
      }
    } catch (_) {}
    // 3순위(폴백): 명시적 선택이 없을 때만 — 가장 최근 작업한 프로젝트(lastUsedAt)
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

  // 공유 UI 다국어 — 기존 중앙 사전(NK.core.translations) 재사용.
  function dlang() {
    try {
      var rt = NK.state && NK.state.runtime && NK.state.runtime.lang;
      if (rt === 'en' || rt === 'ko') return rt;
      var k = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
      return String(localStorage.getItem(k) || '').trim().toLowerCase() === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }
  function dt(key) {
    var d = (NK.core && NK.core.translations && NK.core.translations[dlang()]) || {};
    if (key in d) return d[key];
    var ko = (NK.core && NK.core.translations && NK.core.translations.ko) || {};
    return (key in ko) ? ko[key] : key;
  }

  // ─── 프로젝트(시리즈) 공유 모달 — 소유자가 다른 계정에 권한 부여/회수 ───
  // arg: { projectIds:[...에피소드 전체], title, seriesId, seriesTitle } 또는 단일 projectId 문자열
  function openShareModal(arg, maybeTitle) {
    let projectIds, title, seriesId, seriesTitle;
    if (arg && typeof arg === 'object') {
      projectIds = (Array.isArray(arg.projectIds) ? arg.projectIds : []).map(String).filter(Boolean);
      title = arg.title || '';
      seriesId = arg.seriesId || '';
      seriesTitle = arg.seriesTitle || '';
    } else {
      projectIds = arg ? [String(arg)] : [];
      title = maybeTitle || '';
    }
    if (!projectIds.length) { alert(dt('share_no_episodes')); return; }
    if (!(NK.api && NK.api.projectShareGrant)) { alert(dt('share_unavailable')); return; }
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const idSet = new Set(projectIds.map(String));

    const prev = document.getElementById('nk-share-modal');
    if (prev) prev.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nk-share-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    overlay.innerHTML = `
      <div style="width:100%;max-width:460px;background:var(--panel,#0f172a);border:1px solid var(--border,#1b2845);color:var(--text,#e9edf7);border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.4);">
        <h3 style="margin:0 0 4px;font-size:18px;">${esc(dt('share_project'))}</h3>
        <p style="margin:0 0 16px;font-size:13px;color:var(--muted,#8aa0c3);">${esc(title || '')} · ${esc(dt('share_episodes_all').replace('{n}', projectIds.length))}</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
          <input id="nk-share-target" type="text" placeholder="${esc(dt('share_account_ph'))}" style="flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--border,#1b2845);background:var(--bg,#0b1222);color:var(--text,#e9edf7);font-size:14px;" />
          <button id="nk-share-add" type="button" class="btn-primary" style="padding:9px 14px;">${esc(dt('share_btn'))}</button>
        </div>
        <div id="nk-share-error" style="color:#ef4444;font-size:13px;min-height:18px;margin-bottom:8px;"></div>
        <div style="font-size:12.5px;color:var(--muted,#8aa0c3);margin-bottom:6px;">${esc(dt('share_current_targets'))}</div>
        <div id="nk-share-list" style="max-height:220px;overflow:auto;border:1px solid var(--border,#1b2845);border-radius:10px;"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:18px;">
          <button id="nk-share-close" type="button" class="btn-secondary" style="padding:9px 16px;">${esc(dt('share_close'))}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('#nk-share-list');
    const errEl = overlay.querySelector('#nk-share-error');
    const targetEl = overlay.querySelector('#nk-share-target');
    const setErr = (m) => { if (errEl) errEl.textContent = m || ''; };
    const close = () => { overlay.remove(); };
    let busy = false;

    function renderGrants(grants) {
      if (!listEl) return;
      const arr = Object.keys(grants).map((u) => ({ userId: u, role: grants[u] }));
      if (!arr.length) {
        listEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--muted,#8aa0c3);font-size:13px;">' + esc(dt('share_none')) + '</div>';
        return;
      }
      listEl.innerHTML = arr.map((g) => `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border,#1b2845);">
          <div><strong>${esc(g.userId)}</strong></div>
          <button type="button" class="btn-secondary" data-revoke="${esc(g.userId)}" style="padding:4px 10px;font-size:12px;">${esc(dt('share_revoke'))}</button>
        </div>`).join('');
      listEl.querySelectorAll('[data-revoke]').forEach((b) => {
        b.addEventListener('click', async () => {
          if (busy) return; busy = true; setErr('');
          try {
            const u = b.getAttribute('data-revoke');
            // 시리즈 전체 에피소드에서 회수
            for (const pid of projectIds) { await NK.api.projectShareRevoke(pid, u); }
            await refresh();
          } catch (err) { setErr((err && err.message) ? err.message : dt('share_revoke_fail')); }
          finally { busy = false; }
        });
      });
    }

    async function refresh() {
      try {
        const res = await NK.api.projectShareList();
        const mine = (res && Array.isArray(res.sharedByMe)) ? res.sharedByMe : [];
        // 시리즈 내 모든 에피소드의 grant를 사용자별로 통합(에디터 우선 표시)
        const byUser = {};
        mine.forEach((e) => {
          if (!idSet.has(String(e.projectId))) return;
          (e.grants || []).forEach((g) => { byUser[g.userId] = 'editor'; });
        });
        renderGrants(byUser);
      } catch (err) {
        renderGrants({});
        setErr((err && err.message) ? err.message : dt('share_list_fail'));
      }
    }

    overlay.querySelector('#nk-share-add').addEventListener('click', async () => {
      if (busy) return;
      setErr('');
      const target = String(targetEl.value || '').trim();
      if (!target) { setErr(dt('share_enter_account')); return; }
      busy = true;
      try {
        // 시리즈의 모든 에피소드에 편집 권한 부여(프로젝트 전체 공유, 항상 에디터)
        for (const pid of projectIds) {
          await NK.api.projectShareGrant(pid, target, 'editor', title || '', { seriesId: seriesId, seriesTitle: seriesTitle || title });
        }
        targetEl.value = '';
        await refresh();
      } catch (err) {
        let m = (err && err.message) ? err.message : dt('share_fail');
        if (/cannot_share_with_self/.test(m)) m = dt('share_self_forbidden');
        else if (/invalid_target_user/.test(m)) m = dt('share_invalid_target');
        setErr(m);
      } finally { busy = false; }
    });
    overlay.querySelector('#nk-share-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    refresh();
  }

  // ─── 공유받은 프로젝트를 수신자의 카테고리(시리즈)로 통합 ───────────────
  // 별도 섹션 대신, 공유받은 프로젝트를 일반 카테고리 칩으로 합쳐 보여주고,
  // 칩 라벨 앞에 쉐어 아이콘 + 역할(뷰어/에디트) 아이콘을 붙인다.
  var _sharedDrafts = [];                 // 공유받은 에피소드의 의사(pseudo) 드래프트
  var _sharedMeta = new Map();            // seriesId -> { role, ownerId }
  var _sharedFetchedKey = '';

  // 공유 상태 아이콘 (lucide share-2) — 뷰어/에디터 구분 없이 '공유받음' 표시만.
  var ICON_SHARE = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/></svg>';
  function sharedLabelIcons() {
    return `<span class="nk-shared-label-icons" title="${dt('share_received')}" style="display:inline-flex;align-items:center;margin-right:5px;vertical-align:-2px;color:#93c5fd;">${ICON_SHARE}</span>`;
  }

  // 공유받은 에피소드를 의사 드래프트로 변환(소유자 seriesId 기준으로 그룹핑).
  // enriched: [{ share, data }] — data는 소유자 프로젝트 payload(썸네일/메타) 포함.
  function buildSharedDrafts(enriched) {
    _sharedMeta = new Map();
    const out = [];
    (Array.isArray(enriched) ? enriched : []).forEach((row) => {
      const s = row.share || row;
      const data = row.data || {};
      const role = s.role === 'editor' ? 'editor' : 'viewer';
      const ownerId = String(s.ownerId || '');
      const base = s.seriesId ? (ownerId + '_' + s.seriesId) : ('p_' + s.projectId);
      const seriesId = normalizeSeriesId('shr_' + base) || ('shr' + s.projectId);
      const seriesTitle = String(s.seriesTitle || s.title || s.projectId);
      // 소유자 payload(대표 이미지·장르·타겟·길이 등)를 합치고, 그룹핑용 seriesId/seriesTitle을 덮어쓴다.
      const ownerPayload = (data && data.payload && typeof data.payload === 'object') ? data.payload : {};
      const payload = Object.assign({}, ownerPayload, { seriesId: seriesId, seriesTitle: seriesTitle });
      const nd = normalizeDraft({
        id: String(s.projectId),
        title: String((data && data.title) || s.title || s.projectId),
        payload: payload,
        scenes: [],
      });
      if (!nd) return;
      nd.__shared = true;
      nd.__ownerId = ownerId;
      nd.__role = role;
      out.push(nd);
      if (!_sharedMeta.has(nd.seriesId)) _sharedMeta.set(nd.seriesId, { role: role, ownerId: ownerId });
    });
    _sharedDrafts = out;
  }

  // 공유 목록을 서버에서 받아, 각 프로젝트 데이터(썸네일·메타)까지 가져와 카드에 반영.
  // 로딩 스피너는 renderDrafts 진입 시 startInitialSpinner()가 담당하고, 여기서는
  // 공유 동기화가 끝나면 _sharedSettled를 세워 초기 로딩 종료를 알린다.
  async function refreshSharedDrafts() {
    if (!(NK.api && NK.api.projectList)) { _sharedSettled = true; finishInitialLoadIfReady(); return; }
    try {
      const list = await NK.api.projectList();
      const shared = (list && Array.isArray(list.shared)) ? list.shared : [];
      const key = JSON.stringify(shared.map((s) => [s.projectId, s.ownerId, s.role, s.seriesId]));
      if (key === _sharedFetchedKey) return;
      _sharedFetchedKey = key;
      var enriched;
      if (shared.length && NK.api.projectGet) {
        // 소유자 경로에서 각 공유 프로젝트의 payload(대표 이미지 포함)를 가져온다.
        enriched = await runTasksInBatches(shared, async (s) => {
          var data = {}, missing = false;
          try {
            var res = await NK.api.projectGet(String(s.projectId), String(s.ownerId || ''));
            // 소유자가 삭제한 프로젝트는 빈 응답(source:'empty', data 없음) → 목록에서 제외.
            if (res && res.source === 'empty' && !res.data) missing = true;
            data = (res && res.data) || {};
          } catch (_) { data = {}; }
          return { share: s, data: data, missing: missing };
        }, 6);
        enriched = enriched.filter(function (r) { return !r.missing; });
      } else {
        enriched = shared.map(function (s) { return { share: s, data: {} }; });
      }
      buildSharedDrafts(enriched);
      dashboard.renderDrafts();
    } catch (_) { /* 무시 */ }
    finally { _sharedSettled = true; finishInitialLoadIfReady(); }
  }

  // 내가 '공유한(소유)' 프로젝트의 제목/대표이미지를 서버에서 다시 받아 로컬에 반영.
  // 공유받은 협업자가 변경한 내용을 소유자 대시보드에도 보이게 한다(협업 동기화).
  var _ownedSharedKey = '';
  async function refreshOwnedSharedTitles() {
    if (!(NK.api && NK.api.projectShareList && NK.api.projectGet && NK.store)) return;
    try {
      const res = await NK.api.projectShareList();
      const mine = (res && Array.isArray(res.sharedByMe)) ? res.sharedByMe : [];
      const key = JSON.stringify(mine.map(function (e) { return e.projectId; }));
      if (!mine.length) { _ownedSharedKey = key; return; }
      if (key === _ownedSharedKey) return;
      _ownedSharedKey = key;
      const enriched = await runTasksInBatches(mine, async (e) => {
        try { const r = await NK.api.projectGet(String(e.projectId)); return { id: String(e.projectId), data: (r && r.data) || {} }; }
        catch (_) { return null; }
      }, 6);
      let drafts = NK.store.getDrafts();
      let changed = false;
      enriched.filter(Boolean).forEach(function (row) {
        const idx = drafts.findIndex(function (d) { return String(d.id) === row.id; });
        if (idx < 0) return;
        const d = drafts[idx];
        const sTitle = String((row.data && row.data.title) || '').trim();
        const sThumb = String((row.data && row.data.payload && row.data.payload.thumbnailObjectName) || '').trim();
        const lThumb = String((d.payload && d.payload.thumbnailObjectName) || '').trim();
        let nd = d;
        if (sTitle && sTitle !== String(d.title || '')) {
          nd = Object.assign({}, nd, { title: sTitle, payload: Object.assign({}, nd.payload || {}, { episodeTitle: sTitle, topic: sTitle }) });
          changed = true;
        }
        if (sThumb && sThumb !== lThumb) {
          nd = Object.assign({}, nd, { payload: Object.assign({}, nd.payload || {}, { thumbnailObjectName: sThumb }) });
          changed = true;
        }
        if (nd !== d) drafts[idx] = nd;
      });
      if (changed) { NK.store.saveDrafts(drafts); dashboard.renderDrafts(); }
    } catch (_) { /* 무시 */ }
  }

  // 소유 드래프트 + 공유받은 의사 드래프트 합본(렌더·클릭 조회용)
  function getViewDrafts() {
    const owned = (NK.store && NK.store.getDrafts) ? NK.store.getDrafts().map(normalizeDraft).filter(Boolean) : [];
    return owned.concat(_sharedDrafts);
  }

  dashboard.renderDrafts = function () {
    const container = document.getElementById('dashboard-drafts');
    if (!container) return;

    // 대시보드 진입 즉시(카드 그리기 전) 로딩 스피너를 띄운다. 이미 캐시된 카드가 있어도
    // 소유 + 공유 동기화가 모두 끝날 때까지 스피너를 유지(중간에 카드가 먼저 보이는 현상 방지).
    startInitialSpinner();

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

      // 로컬에 표시할 카드가 없으면(새 계정/캐시 비움 등) 서버에서 실제 카드 데이터를
      // 모두 받을 때까지 로딩 스피너를 유지한다. 로컬 카드가 있으면 즉시 보여주고 백그라운드 갱신.
      // 스피너 표시는 renderDrafts 진입 시 startInitialSpinner()가 담당.
      // 여기서는 소유 동기화 완료 시 초기 로딩 종료 여부만 확인한다.
      const clearLoading = () => { finishInitialLoadIfReady(); };

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

        // 1차 렌더(placeholder 포함). 실제 카드 데이터가 도착할 때까지 로딩 스피너는 유지한다
        // (여기서 clearLoading 하지 않음 → 빈 카드만 보이고 스피너가 사라지는 문제 방지).
        // 메모리 store에 임시 반영 (renderDrafts가 store에서 읽음). pending 플래그 포함 - persist는 안 함.
        NK.store.saveDrafts(sortByOrder(nextMap));
        dashboard.renderDrafts();

        // 받아올 항목이 없으면(모두 캐시에 있음) 스피너 해제 후 종료.
        if (!missingIds.length || !NK.api.projectGet) {
          clearLoading();
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

    // 공유받은 프로젝트 목록 갱신(비동기, 변경 시 재렌더). 소유 + 공유 합본으로 카테고리 구성.
    refreshSharedDrafts();
    // 내가 공유한 프로젝트는 협업자 변경(제목/대표이미지)을 서버에서 다시 받아 반영.
    refreshOwnedSharedTitles();
    drafts = getViewDrafts();
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

    // 시리즈(IP) 단위 대표 로고 폴백 맵.
    // 썸네일은 프로젝트별 thumbnailObjectName에 복사되는 구조라, 업로드 이후 시리즈에
    // 추가된 프로젝트는 로고를 잃는다. 같은 시리즈에 썸네일을 가진 형제가 하나라도 있으면
    // 그 값을 공통 로고로 사용해 빈 카드가 생기지 않게 한다.
    const seriesThumbBySeriesId = new Map();
    for (const d of drafts) {
      const sid = d && d.seriesId != null ? String(d.seriesId) : '';
      if (!sid || seriesThumbBySeriesId.has(sid)) continue;
      const obj = String(d.payload?.thumbnailObjectName || '').trim();
      if (obj) seriesThumbBySeriesId.set(sid, obj);
    }

    const fmtDuration = (sec) => {
      const n = Number(sec) || 0;
      if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
      if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
      return `${n}s`;
    };
    const runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    const labels = runtimeLang === 'en'
      ? { project: 'Project', genre: 'Genre', target: 'Target', purpose: 'Purpose', duration: 'Duration', aspect: 'Aspect ratio' }
      : { project: '프로젝트', genre: '장르', target: '타겟', purpose: '시청목적', duration: '길이', aspect: '비율' };
    const categoryTitle = runtimeLang === 'en' ? 'Category' : '카테고리';
    const host = getHostShell();
    const manageBarHtml = host === 'video' ? `
      <div class="series-manage-bar">
        <span class="series-manage-label">${selectedSeries ? `선택된 시리즈: ${escapeHtml(selectedSeries.title)}` : '시리즈를 선택하면 이름 변경/삭제를 할 수 있습니다.'}</span>
        <button class="btn-secondary compact ${selectedSeries ? '' : 'disabled'}" data-action="series-edit" ${selectedSeries ? '' : 'disabled'}>프로젝트 수정</button>
        <button class="btn-secondary compact danger ${selectedSeries ? '' : 'disabled'}" data-action="series-delete" ${selectedSeries ? '' : 'disabled'}>시리즈 삭제</button>
      </div>` : '';

    const showCreateButton = host === 'brand' || host === 'video';

    const _rawSelectedId = getSelectedProjectId();
    const selectedProjectId = _rawSelectedId ||
      (filteredDrafts.length > 0 ? String(filteredDrafts[0].id) : '');

    // 브랜드 스튜디오에서 카테고리(시리즈)를 선택했을 때, 신규 버튼 왼쪽에 공유 버튼 표시.
    // 선택된 시리즈(프로젝트) 전체 = 모든 에피소드를 다른 계정에 공유한다.
    // 공유 버튼은 '내가 소유한' 카테고리에서만 표시(공유받은 카테고리는 재공유 불가).
    const showShareButton = host === 'brand' && currentSeriesFilter !== '__all__' && filteredDrafts.length > 0 && !_sharedMeta.has(currentSeriesFilter);
    const shareBtnHtml = showShareButton
      ? `<button class="btn-primary series-share-btn" data-action="share-series" data-series-id="${escapeHtml(currentSeriesFilter)}" data-series-title="${escapeHtml((selectedSeries && selectedSeries.title) || categoryTitle || '')}" aria-label="${escapeHtml(dt('share_btn'))}" title="${escapeHtml(dt('share_whole_project'))}"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line></svg></button>`
      : '';

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
            ${seriesList.map((s) => {
              const sm = _sharedMeta.get(s.id);
              const iconPrefix = sm ? sharedLabelIcons(sm.role) : '';
              return `
              <button class="chip series-chip ${currentSeriesFilter === s.id ? 'active' : ''}${sm ? ' is-shared' : ''}" data-action="series-filter" data-series-id="${escapeHtml(s.id)}">
                ${iconPrefix}${escapeHtml(s.title)} (${s.count})
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="series-filter-actions" style="display:flex;align-items:center;gap:8px;">
          ${shareBtnHtml}
          ${showCreateButton ? `<button class="btn-primary series-create-btn" data-action="create-project">신규</button>` : ``}
        </div>
      </div>
      ${manageBarHtml}
    `;
    const showStageButtons = host === 'video';
    const showTitleEdit = (host === 'video' || host === 'brand');
    const showDelete = (host === 'video' || host === 'brand');

    const list = filteredDrafts.map(d => {
      const ar = d.payload?.aspectRatio || '16:9';
      const dur = fmtDuration(d.payload?.duration || 0);
      const cat = d.payload?.purposeCategory || '';
      const tags = Array.isArray(d.payload?.purposeTags) ? d.payload.purposeTags.join(', ') : '';
      const tgt = d.payload?.target || '';
      const needs = Array.isArray(d.payload?.needs) ? d.payload.needs.filter(Boolean).join(', ') : (d.payload?.needs || '');
      const genre = `${cat} ${tags}`.trim();
      const isSelected = selectedProjectId && String(selectedProjectId) === String(d.id);
      const thumbObj = String(d.payload?.thumbnailObjectName || '').trim()
        || (d.seriesId != null ? (seriesThumbBySeriesId.get(String(d.seriesId)) || '') : '');
      const thumbUrl = thumbObj && NK.api && typeof NK.api.mediaProxyObjectUrl === 'function'
        ? NK.api.mediaProxyObjectUrl(thumbObj)
        : '';
      // 공유받은 카드도 일반 카드와 100% 동일한 마크업/스타일로 렌더한다.
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
                <div class="draft-meta-project">${escapeHtml(d.seriesTitle || '-')}</div>
                <div class="draft-meta-genre">${labels.genre} : ${escapeHtml(genre || '-')}</div>
                <div>${labels.target} : ${escapeHtml(tgt || '-')}</div>
                <div>${labels.purpose} : ${escapeHtml(needs || '-')}</div>
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
        // 소유 + 공유받은(의사) 드래프트 합본에서 조회 → 공유 카드도 열 수 있게.
        const draft = getViewDrafts().find(d => String(d.id) === cardId);
        if (!draft) return;
        selectProject(draft);
        container.querySelectorAll('.draft-card.is-selected').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        // 공유받은 프로젝트는 소유자 데이터를 원격에서 불러오므로 로딩 스피너(배경 흐림)를 띄운다.
        if (draft.__shared) { try { setDashLoading(true, dt('share_loading')); } catch (_) {} }
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

      if (action === 'share-series') {
        const sid = String(btn.dataset.seriesId || '').trim();
        const stitle = btn.dataset.seriesTitle || '';
        const eps = (NK.store.getDrafts() || []).map(normalizeDraft).filter(Boolean)
          .filter((d) => String(d.seriesId) === sid).map((d) => String(d.id)).filter(Boolean);
        openShareModal({ projectIds: eps, title: stitle, seriesId: sid, seriesTitle: stitle });
        return;
      }
      if (action === 'share-project') { // 단일 프로젝트 공유(호환)
        openShareModal(id, btn.dataset.title || '');
        return;
      }

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
        const commit = async () => {
          if (committed) return;
          committed = true;
          // 소유 + 공유 합본에서 조회(공유 프로젝트도 제목 수정 가능).
          const draft = getViewDrafts().find(d => String(d.id) === String(id));
          if (!draft) return;
          const newTitle = (titleEl.textContent || '').trim() || '제목없음';

          // 공유받은 프로젝트: 로컬 스토어가 아니라 소유자 서버 데이터에 저장(ownerId 자동 첨부).
          // payload는 제목 관련 키만 보내 다른 필드(seriesId 등)를 덮어쓰지 않게 한다(서버 머지).
          if (draft.__shared) {
            titleEl.textContent = newTitle;
            titleEl.contentEditable = 'false';
            titleEl.classList.remove('editing');
            if (NK.api && NK.api.projectSave) {
              try {
                await NK.api.projectSave(String(draft.id), { episodeTitle: newTitle, topic: newTitle }, [], { title: newTitle });
              } catch (_) { /* 저장 실패 시 다음 새로고침에 복원됨 */ }
            }
            _sharedFetchedKey = '';
            try { refreshSharedDrafts(); } catch (_) {}
            alert('제목을 수정했습니다.');
            return;
          }

          const drafts = NK.store.getDrafts().map(normalizeDraft).filter(Boolean);
          const ownedDraft = drafts.find(d => String(d.id) === String(id)) || draft;
          // Update title, episodeTitle AND topic together. Otherwise any sync
          // path that re-derives title from payload.topic (scenario save,
          // generate, etc.) can "undo" the rename on the next reload.
          const nextDraft = Object.assign({}, ownedDraft, {
            title: newTitle,
            payload: Object.assign({}, ownedDraft.payload || {}, { episodeTitle: newTitle, topic: newTitle })
          });
          const savedDraft = NK.service?.project?.updateLocal
            ? NK.service.project.updateLocal(id, nextDraft, { forceCurrent: String(NK.service?.project?.getCurrentProjectId?.() || '') === String(id) })
            : (ownedDraft.title = newTitle, ownedDraft.payload = Object.assign({}, ownedDraft.payload || {}, { episodeTitle: newTitle, topic: newTitle }), NK.store.saveDrafts(drafts), ownedDraft);
          titleEl.textContent = newTitle;
          titleEl.contentEditable = 'false';
          titleEl.classList.remove('editing');
          // 서버 저장이 완료되기 전에 다음 단계(프리프로덕션 등)로 진입하면
          // scenario 화면이 백그라운드 projectGet에서 옛 payload(예: 복제 시점의 topic)를
          // 받아 화면을 덮어쓰는 레이스가 발생한다. await 후 알림을 띄워
          // 사용자가 OK를 누르기 전에 서버 동기화가 끝나도록 보장한다.
          if (NK.api && NK.api.projectSave) {
            const targetDraft = savedDraft || nextDraft;
            try {
              await NK.api.projectSave(targetDraft.id, targetDraft.payload || {}, targetDraft.scenes || [], {
                header: targetDraft.header || '',
                aspectRatio: targetDraft.payload?.aspectRatio,
                title: newTitle
              });
            } catch (_) { /* 저장 실패해도 로컬은 갱신되어 있음 */ }
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
              // 복제본을 current로 교체하지 않음: 원본이 선택 상태를 유지해야
              // Brand Studio가 복제 후에도 올바른 프로젝트를 로드함
              refreshSidebarCardFromState();
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
    const sidebarNeeds = Array.isArray(normalized.payload?.needs)
      ? normalized.payload.needs.filter(Boolean).join(', ')
      : (normalized.payload?.needs || '');
    const genre = `${cat} ${tags}`.trim();
    const runtimeLang = (NK.state && NK.state.runtime && NK.state.runtime.lang) === 'en' ? 'en' : 'ko';
    const labels = runtimeLang === 'en'
      ? { project: 'Project', genre: 'Genre', target: 'Target', purpose: 'Purpose', duration: 'Duration', aspect: 'Aspect ratio' }
      : { project: '프로젝트', genre: '장르', target: '타겟', purpose: '시청목적', duration: '길이', aspect: '비율' };
    const desc = [
      `${labels.project} : ${normalized.seriesTitle || '-'}`,
      `${labels.genre} : ${genre || '-'}`,
      `${labels.target} : ${tgt || '-'}`,
      `${labels.purpose} : ${sidebarNeeds || '-'}`,
      `${labels.duration} : ${dur}`
    ].join('\n');

    // 자체 썸네일이 없으면 같은 시리즈(IP) 형제 프로젝트의 대표 로고로 폴백한다.
    let sidebarThumbObj = String(normalized.payload?.thumbnailObjectName || '').trim();
    if (!sidebarThumbObj && normalized.seriesId != null && NK.store && typeof NK.store.getDrafts === 'function') {
      const sid = String(normalized.seriesId);
      try {
        const sibling = NK.store.getDrafts()
          .map(normalizeDraft)
          .filter(Boolean)
          .find(d => d.seriesId != null && String(d.seriesId) === sid && String(d.payload?.thumbnailObjectName || '').trim());
        if (sibling) sidebarThumbObj = String(sibling.payload.thumbnailObjectName).trim();
      } catch (_) { }
    }
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
