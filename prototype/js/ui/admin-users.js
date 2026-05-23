;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  // 권한 키 정의(서버 admin-users.ts의 PERMISSION_PAGES와 동기화).
  var PERMISSION_PAGES = [
    { key: 'videogen', label: { ko: 'AI 영상 생성', en: 'AI Video Gen' } },
    { key: 'image',    label: { ko: 'AI 이미지', en: 'AI Image' } },
    { key: 'video',    label: { ko: 'AI 영상', en: 'AI Video' } },
    { key: 'brand',    label: { ko: '브랜드 스튜디오', en: 'Brand Studio' } }
  ];

  var state = {
    loading: false,
    error: '',
    users: [],
    primaryAdminId: '',     // 최고(슈퍼) 관리자 ID — 서버 응답에서 받음
    search: '',
    filter: 'all',          // all | admin | member | active | inactive
    modalOpen: false,
    modalMode: 'create',    // create | edit
    modalError: '',
    saving: false,
    edit: null              // 편집 중 사용자(편집 모드) 또는 null
  };

  // ─── 다국어(한/영) — 기존 중앙 사전(NK.core.translations) 재사용 ───
  function curLang() {
    try {
      var rt = NK.state && NK.state.runtime && NK.state.runtime.lang;
      if (rt === 'en' || rt === 'ko') return rt;
      var key = (NK.config && NK.config.KEYS && NK.config.KEYS.LANG) || 'nk_lang';
      var v = String(localStorage.getItem(key) || '').trim().toLowerCase();
      return v === 'en' ? 'en' : 'ko';
    } catch (_) { return 'ko'; }
  }
  function t(key) {
    var dict = (NK.core && NK.core.translations && NK.core.translations[curLang()]) || {};
    if (key in dict) return dict[key];
    var ko = (NK.core && NK.core.translations && NK.core.translations.ko) || {};
    return (key in ko) ? ko[key] : key;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 마스터(유일 최고 관리자) 여부 — ID가 서버가 알려준 primaryAdminId와 같을 때만.
  function isMasterUser(u) {
    return !!u && !!state.primaryAdminId && String(u.id) === String(state.primaryAdminId);
  }

  function permLabel(key) {
    var found = PERMISSION_PAGES.find(function (p) { return p.key === key; });
    return found ? t('admin_perm_' + key) : key;
  }

  // ─── 데이터 로드 ────────────────────────────────────────────
  function loadUsers() {
    state.loading = true;
    state.error = '';
    render();
    return NK.api.adminUsersList()
      .then(function (res) {
        state.users = (res && Array.isArray(res.users)) ? res.users : [];
        state.primaryAdminId = (res && res.primaryAdminId) ? String(res.primaryAdminId) : '';
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        var msg = (err && err.message) ? err.message : t('admin_list_fail');
        try { console.error('[admin-users] list load failed:', msg, err); } catch (_) { }
        state.error = t('admin_list_fail') + ': ' + msg;
        render();
      });
  }

  // ─── 필터링 ────────────────────────────────────────────────
  function visibleUsers() {
    var q = String(state.search || '').trim().toLowerCase();
    return state.users.filter(function (u) {
      if (q) {
        var hay = (String(u.id || '') + ' ' + String(u.name || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      switch (state.filter) {
        case 'admin':    return isMasterUser(u);
        case 'member':   return !isMasterUser(u);
        case 'active':   return u.active !== false;
        case 'inactive': return u.active === false;
        default:         return true;
      }
    });
  }

  // ─── 렌더 ──────────────────────────────────────────────────
  function render() {
    var root = document.querySelector('.content');
    if (!root) return;

    var authed = NK.auth && NK.auth.isAuthed && NK.auth.isAuthed();
    if (!authed) { root.innerHTML = ''; return; } // auth-overlay가 처리

    if (NK.auth && NK.auth.isMaster && !NK.auth.isMaster()) {
      root.innerHTML = '<div class="admin-page"><div class="bsf-detail-card"><div class="admin-error">' + escapeHtml(t('admin_no_access')) + '</div><div style="text-align:center;margin-top:14px;"><button type="button" class="admin-icon-btn" data-action="go-home">' + escapeHtml(t('admin_home')) + '</button></div></div></div>';
      root.querySelectorAll('[data-action="go-home"]').forEach(function (el) { el.addEventListener('click', onAction); });
      return;
    }

    var rows;
    if (state.loading) {
      rows = '<tr><td colspan="5"><div class="admin-empty">' + escapeHtml(t('admin_loading')) + '</div></td></tr>';
    } else if (state.error) {
      rows = '<tr><td colspan="5"><div class="admin-error">' + escapeHtml(state.error) + '</div></td></tr>';
    } else {
      var list = visibleUsers();
      var primaryRow = buildPrimaryAdminRowIfNeeded();
      var listRows = list.length ? list.map(buildRow).join('') : '';
      rows = primaryRow + listRows;
      if (!rows) rows = '<tr><td colspan="5"><div class="admin-empty">' + escapeHtml(t('admin_empty')) + '</div></td></tr>';
    }

    root.innerHTML = [
      '<div class="admin-page">',
        '<div class="bsf-flow-card">',
          '<div class="bsf-flow-head">',
            '<div class="bsf-flow-title-group">',
              '<p class="brand-studio-eyebrow">' + escapeHtml(t('admin_eyebrow')) + '</p>',
              '<h2 class="bsf-title">' + escapeHtml(t('admin_title')) + '</h2>',
              '<p class="bsf-desc">' + escapeHtml(t('admin_desc')) + '</p>',
            '</div>',
            '<div class="bsf-flow-head-actions">',
              '<button type="button" class="admin-sq-btn" data-action="go-home" aria-label="' + escapeHtml(t('admin_home')) + '" title="' + escapeHtml(t('admin_home')) + '">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
              '</button>',
              '<button type="button" class="admin-sq-btn" data-action="reload" aria-label="' + escapeHtml(t('admin_reload')) + '" title="' + escapeHtml(t('admin_reload')) + '">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
              '</button>',
              '<button type="button" class="admin-sq-btn admin-sq-btn--primary" data-action="new-user" aria-label="' + escapeHtml(t('admin_new_user')) + '" title="' + escapeHtml(t('admin_new_user')) + '">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>',

        '<div class="bsf-detail-card admin-list-card">',
          '<div class="admin-card-inner">',
            '<div class="admin-toolbar">',
              '<div class="admin-search"><input type="text" id="admin-search" placeholder="' + escapeHtml(t('admin_search_ph')) + '" value="' + escapeHtml(state.search) + '" /></div>',
              '<select id="admin-filter">',
                '<option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>' + escapeHtml(t('admin_f_all')) + '</option>',
                '<option value="admin"' + (state.filter === 'admin' ? ' selected' : '') + '>' + escapeHtml(t('admin_f_master')) + '</option>',
                '<option value="member"' + (state.filter === 'member' ? ' selected' : '') + '>' + escapeHtml(t('admin_f_member')) + '</option>',
                '<option value="active"' + (state.filter === 'active' ? ' selected' : '') + '>' + escapeHtml(t('admin_f_active')) + '</option>',
                '<option value="inactive"' + (state.filter === 'inactive' ? ' selected' : '') + '>' + escapeHtml(t('admin_f_inactive')) + '</option>',
              '</select>',
            '</div>',
            '<div class="admin-table-wrap">',
              '<table class="admin-table">',
                '<thead><tr><th>ID</th><th>' + escapeHtml(t('admin_th_name')) + '</th><th>' + escapeHtml(t('admin_th_perm')) + '</th><th>' + escapeHtml(t('admin_th_status')) + '</th><th>' + escapeHtml(t('admin_th_manage')) + '</th></tr></thead>',
                '<tbody>', rows, '</tbody>',
              '</table>',
            '</div>',
          '</div>',
        '</div>',

        '<div class="admin-version">v' + escapeHtml((NK.config && NK.config.APP_VERSION) || '') + '</div>',

        state.modalOpen ? buildModal() : '',
      '</div>'
    ].join('');

    bindEvents(root);
  }

  function isPrimaryRegistered() {
    var pid = String(state.primaryAdminId || '');
    if (!pid) return true; // 알 수 없으면 안내 행 미표시
    return state.users.some(function (u) { return String(u.id) === pid; });
  }

  // 최고 관리자가 아직 레지스트리에 등록되지 않은 경우(=기본 비밀번호 사용 중),
  // 비밀번호를 설정할 수 있도록 안내용 행을 목록 맨 위에 노출한다.
  function buildPrimaryAdminRowIfNeeded() {
    var pid = String(state.primaryAdminId || '');
    if (!pid || isPrimaryRegistered()) return '';
    return [
      '<tr>',
        '<td><strong>' + escapeHtml(pid) + '</strong></td>',
        '<td>' + escapeHtml(t('admin_master')) + '</td>',
        '<td><span class="admin-badge admin-badge--admin">' + escapeHtml(t('admin_master')) + '</span> <span class="admin-perm-chip">' + escapeHtml(t('admin_full_perm')) + '</span></td>',
        '<td><span class="admin-badge admin-badge--off">' + escapeHtml(t('admin_default_pw')) + '</span></td>',
        '<td><div class="admin-row-actions"><button type="button" class="admin-icon-btn admin-sq-btn--primary" data-action="set-primary-pw" style="min-width:auto;padding:6px 12px;">' + escapeHtml(t('admin_set_pw')) + '</button></div></td>',
      '</tr>'
    ].join('');
  }

  function buildRow(u) {
    var master = isMasterUser(u);
    var permHtml = master
      ? '<span class="admin-perm-chip">' + escapeHtml(t('admin_full_perm')) + '</span>'
      : (Array.isArray(u.permissions) && u.permissions.length
          ? u.permissions.map(function (p) { return '<span class="admin-perm-chip">' + escapeHtml(permLabel(p)) + '</span>'; }).join('')
          : '<span class="admin-perm-chip">' + escapeHtml(t('admin_no_perm')) + '</span>');
    var roleBadge = master
      ? '<span class="admin-badge admin-badge--admin">' + escapeHtml(t('admin_master')) + '</span>'
      : '<span class="admin-badge admin-badge--member">' + escapeHtml(t('admin_member')) + '</span>';
    var stateBadge = (u.active === false)
      ? '<span class="admin-badge admin-badge--off">' + escapeHtml(t('admin_inactive')) + '</span>'
      : '<span class="admin-badge admin-badge--on">' + escapeHtml(t('admin_active')) + '</span>';
    var id = escapeHtml(u.id);
    // 마스터 행은 삭제 불가(유일 운영 계정), 비밀번호 등 수정만 가능.
    var deleteBtn = master ? '' : '<button type="button" class="admin-icon-btn admin-icon-btn--danger" data-action="delete-user" data-id="' + id + '">' + escapeHtml(t('admin_delete')) + '</button>';
    return [
      '<tr data-id="' + id + '">',
        '<td><strong>' + id + '</strong></td>',
        '<td>' + escapeHtml(u.name || '-') + '</td>',
        '<td>' + roleBadge + ' ' + permHtml + '</td>',
        '<td>' + stateBadge + '</td>',
        '<td><div class="admin-row-actions">',
          '<button type="button" class="admin-icon-btn" data-action="edit-user" data-id="' + id + '">' + escapeHtml(t('admin_edit')) + '</button>',
          deleteBtn,
        '</div></td>',
      '</tr>'
    ].join('');
  }

  function buildModal() {
    var isEdit = state.modalMode === 'edit';
    var u = state.edit || { id: '', name: '', permissions: [], role: 'member', active: true };
    var isMasterTarget = !!(u && u.__lockId) || isMasterUser(u);  // 마스터 대상(비번 설정/수정)
    var lockId = isEdit || !!(u && u.__lockId);                    // ID 잠금
    var title = (u && u.__lockId && !isEdit) ? t('admin_m_set_master_pw') : (isEdit ? (isMasterTarget ? t('admin_m_edit_master') : t('admin_m_edit_member')) : t('admin_m_new'));
    var permChecks = PERMISSION_PAGES.map(function (p) {
      var checked = Array.isArray(u.permissions) && u.permissions.indexOf(p.key) !== -1;
      return '<label><input type="checkbox" class="admin-perm-check" value="' + p.key + '"' + (checked ? ' checked' : '') + ' />' + escapeHtml(permLabel(p.key)) + '</label>';
    }).join('');
    // 마스터: 모든 권한 보유 → 권한/활성 항목 숨기고 비밀번호만. 회원: 페이지 권한 선택.
    var permSection = isMasterTarget
      ? '<div class="admin-field"><p class="admin-hint">' + escapeHtml(t('admin_master_all_perm')) + '</p></div>'
      : ('<div class="admin-field"><label>' + escapeHtml(t('admin_lbl_access')) + '</label><div class="admin-perms">' + permChecks + '</div></div>');
    var activeSection = isMasterTarget
      ? ''
      : ('<div class="admin-field"><label style="display:flex;align-items:center;gap:6px;color:var(--text);"><input type="checkbox" id="admin-f-active"' + (u.active !== false ? ' checked' : '') + ' /> ' + escapeHtml(t('admin_active_account')) + '</label></div>');

    return [
      '<div class="admin-modal-backdrop" data-action="modal-backdrop">',
        '<div class="admin-modal" data-modal>',
          '<h3>' + escapeHtml(title) + '</h3>',
          '<div class="admin-field">',
            '<label>ID</label>',
            '<input type="text" id="admin-f-id" value="' + escapeHtml(u.id) + '"' + (lockId ? ' disabled' : '') + ' placeholder="' + escapeHtml(t('admin_ph_id')) + '" />',
          '</div>',
          '<div class="admin-field">',
            '<label>' + escapeHtml(t('admin_lbl_name')) + '</label>',
            '<input type="text" id="admin-f-name" value="' + escapeHtml(u.name || '') + '" placeholder="' + escapeHtml(t('admin_ph_name')) + '" />',
          '</div>',
          '<div class="admin-field">',
            '<label>' + escapeHtml(t('admin_lbl_pw')) + '</label>',
            '<input type="password" id="admin-f-pw" placeholder="' + escapeHtml(isEdit ? t('admin_ph_pw_edit') : t('admin_ph_pw')) + '" autocomplete="new-password" />',
            (isEdit ? '<p class="admin-hint">' + escapeHtml(t('admin_hint_pw_keep')) + '</p>' : ''),
          '</div>',
          permSection,
          activeSection,
          '<div class="admin-modal-error" id="admin-modal-error">' + escapeHtml(state.modalError || '') + '</div>',
          '<div class="admin-modal-actions">',
            '<button type="button" class="admin-icon-btn" data-action="modal-cancel">' + escapeHtml(t('admin_cancel')) + '</button>',
            '<button type="button" class="bsf-head-btn btn-primary" data-action="modal-save"' + (state.saving ? ' disabled' : '') + '>' + escapeHtml(state.saving ? t('admin_saving') : t('admin_save_apply')) + '</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');
  }

  // ─── 이벤트 ────────────────────────────────────────────────
  function bindEvents(root) {
    var search = root.querySelector('#admin-search');
    if (search) {
      search.addEventListener('input', function () {
        state.search = search.value;
        // 입력 중 포커스 유지를 위해 테이블 본문만 갱신
        var tbody = root.querySelector('table.admin-table tbody');
        if (tbody) {
          var list = visibleUsers();
          var primaryRow = buildPrimaryAdminRowIfNeeded();
          var listRows = list.length ? list.map(buildRow).join('') : '';
          tbody.innerHTML = (primaryRow + listRows) || '<tr><td colspan="5"><div class="admin-empty">' + escapeHtml(t('admin_empty')) + '</div></td></tr>';
          bindRowActions(root);
        }
      });
    }
    var filter = root.querySelector('#admin-filter');
    if (filter) filter.addEventListener('change', function () { state.filter = filter.value; render(); });

    root.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', onAction);
    });
  }

  function bindRowActions(root) {
    root.querySelectorAll('[data-action="edit-user"], [data-action="delete-user"], [data-action="set-primary-pw"]').forEach(function (el) {
      el.addEventListener('click', onAction);
    });
  }

  function onAction(e) {
    var el = e.currentTarget;
    var action = el.getAttribute('data-action');
    if (action === 'go-home') { goHome(); }
    else if (action === 'new-user') { openModal('create'); }
    else if (action === 'set-primary-pw') { openPrimaryPwModal(); }
    else if (action === 'reload') { loadUsers(); }
    else if (action === 'edit-user') { openModal('edit', el.getAttribute('data-id')); }
    else if (action === 'delete-user') { deleteUser(el.getAttribute('data-id')); }
    else if (action === 'modal-cancel') { closeModal(); }
    else if (action === 'modal-backdrop') { if (e.target === el) closeModal(); }
    else if (action === 'modal-save') { saveModal(); }
  }

  // 마스터 비밀번호 설정: ID 잠금으로 신규 등록 모달을 연다(권한은 서버가 전체로 강제).
  function openPrimaryPwModal() {
    var pid = String(state.primaryAdminId || '');
    if (!pid) return;
    state.modalMode = 'create';
    state.modalError = '';
    state.edit = { id: pid, name: t('admin_master'), permissions: [], role: 'master', active: true, __lockId: true };
    state.modalOpen = true;
    render();
  }

  function goHome() {
    try {
      if (window.top && window.top !== window) { window.top.location.href = 'index.html'; return; }
    } catch (_) { }
    window.location.href = 'index.html';
  }

  function openModal(mode, id) {
    state.modalMode = mode;
    state.modalError = '';
    if (mode === 'edit') {
      var u = state.users.find(function (x) { return String(x.id) === String(id); });
      state.edit = u ? JSON.parse(JSON.stringify(u)) : null;
      if (!state.edit) return;
    } else {
      state.edit = { id: '', name: '', permissions: [], role: 'member', active: true };
    }
    state.modalOpen = true;
    render();
  }

  function closeModal() {
    state.modalOpen = false;
    state.edit = null;
    state.modalError = '';
    render();
  }

  function readModalForm(root) {
    var idEl = root.querySelector('#admin-f-id');
    var nameEl = root.querySelector('#admin-f-name');
    var pwEl = root.querySelector('#admin-f-pw');
    var activeEl = root.querySelector('#admin-f-active');
    var perms = [];
    root.querySelectorAll('.admin-perm-check').forEach(function (c) { if (c.checked) perms.push(c.value); });
    return {
      id: idEl ? String(idEl.value || '').trim() : '',
      name: nameEl ? String(nameEl.value || '').trim() : '',
      password: pwEl ? String(pwEl.value || '') : '',
      permissions: perms,
      // 회원은 항상 member(서버에서도 강제). 활성 토글은 마스터 모달엔 없으므로 기본 true.
      active: activeEl ? !!activeEl.checked : true
    };
  }

  function saveModal() {
    var root = document.querySelector('.content');
    if (!root) return;
    var form = readModalForm(root);
    state.modalError = '';

    if (state.modalMode === 'create') {
      if (!form.id) { state.modalError = t('admin_err_enter_id'); render(); return; }
      if (!form.password) { state.modalError = t('admin_err_enter_pw'); render(); return; }
    }

    state.saving = true;
    render();

    // 역할은 보내지 않는다 — 서버가 마스터/회원을 강제(회원에게 관리자 역할 불가).
    var p;
    if (state.modalMode === 'create') {
      p = NK.api.adminUserCreate({
        id: form.id, name: form.name, password: form.password,
        permissions: form.permissions, active: form.active
      });
    } else {
      var payload = {
        id: state.edit.id, name: form.name,
        permissions: form.permissions, active: form.active,
        expectedUpdatedAt: state.edit.updatedAt || ''
      };
      if (form.password) payload.password = form.password;
      p = NK.api.adminUserUpdate(payload);
    }

    p.then(function () {
      state.saving = false;
      state.modalOpen = false;
      state.edit = null;
      return loadUsers();
    }).catch(function (err) {
      state.saving = false;
      var msg = (err && err.message) ? err.message : t('admin_err_save_fail');
      if (/user_exists/.test(msg)) msg = t('admin_err_exists');
      else if (/conflict/.test(msg)) msg = t('admin_err_conflict');
      else if (/password_required/.test(msg)) msg = t('admin_err_enter_pw');
      else if (/invalid_user_id/.test(msg)) msg = t('admin_err_invalid_id');
      else if (/master_required|admin_required/.test(msg)) msg = t('admin_err_master_only');
      state.modalError = msg;
      render();
    });
  }

  function deleteUser(id) {
    var u = state.users.find(function (x) { return String(x.id) === String(id); });
    if (!u) return;
    if (!window.confirm(t('admin_confirm_delete') + ' (' + (u.name || u.id) + ')')) return;
    NK.api.adminUserDelete(id)
      .then(function () { return loadUsers(); })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : t('admin_err_del_fail');
        if (/cannot_delete_primary_admin/.test(msg)) msg = t('admin_err_cannot_delete_primary');
        else if (/master_required|admin_required/.test(msg)) msg = t('admin_err_master_only');
        window.alert(msg);
      });
  }

  function updateAuthState() {
    var overlay = document.getElementById('auth-overlay');
    var authed = NK.auth && NK.auth.isAuthed && NK.auth.isAuthed();
    if (overlay) overlay.classList.toggle('hidden', !!authed);
  }

  function init() {
    if (!document.querySelector('.content')) return;
    updateAuthState();
    var authed = NK.auth && NK.auth.isAuthed && NK.auth.isAuthed();
    if (!authed) { render(); return; }
    if (NK.auth && NK.auth.isMaster && !NK.auth.isMaster()) { render(); return; }
    loadUsers();
  }

  ui.adminUsers = { init: init, loadUsers: loadUsers };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
