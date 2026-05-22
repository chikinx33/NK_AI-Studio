;(function () {
  var NK = window.NK || (window.NK = {});
  var ui = NK.ui || (NK.ui = {});

  // 권한 키 정의(서버 admin-users.ts의 PERMISSION_PAGES와 동기화).
  var PERMISSION_PAGES = [
    { key: 'videogen', label: 'AI 영상 생성' },
    { key: 'image',    label: 'AI 이미지' },
    { key: 'video',    label: 'AI 영상' },
    { key: 'brand',    label: '브랜드 스튜디오' }
  ];

  var state = {
    loading: false,
    error: '',
    users: [],
    search: '',
    filter: 'all',          // all | admin | member | active | inactive
    modalOpen: false,
    modalMode: 'create',    // create | edit
    modalError: '',
    saving: false,
    edit: null              // 편집 중 사용자(편집 모드) 또는 null
  };

  function t(ko) { return ko; } // 현재 한국어 우선. (다국어 확장 지점)

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function isAdminUser(u) {
    return (String(u.role || '').toLowerCase() === 'admin') ||
           (Array.isArray(u.permissions) && u.permissions.length === 0);
  }

  function permLabel(key) {
    var found = PERMISSION_PAGES.find(function (p) { return p.key === key; });
    return found ? found.label : key;
  }

  // ─── 데이터 로드 ────────────────────────────────────────────
  function loadUsers() {
    state.loading = true;
    state.error = '';
    render();
    return NK.api.adminUsersList()
      .then(function (res) {
        state.users = (res && Array.isArray(res.users)) ? res.users : [];
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        var msg = (err && err.message) ? err.message : '목록을 불러오지 못했습니다.';
        try { console.error('[admin-users] 목록 조회 실패:', msg, err); } catch (_) { }
        state.error = '목록을 불러오지 못했습니다: ' + msg;
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
        case 'admin':    return isAdminUser(u);
        case 'member':   return !isAdminUser(u);
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

    if (NK.auth && NK.auth.isAdmin && !NK.auth.isAdmin()) {
      root.innerHTML = '<div class="admin-page"><div class="bsf-detail-card"><div class="admin-error">관리자만 접근할 수 있는 페이지입니다.</div><div style="text-align:center;margin-top:14px;"><button type="button" class="admin-icon-btn" data-action="go-home">홈으로</button></div></div></div>';
      root.querySelectorAll('[data-action="go-home"]').forEach(function (el) { el.addEventListener('click', onAction); });
      return;
    }

    var rows;
    if (state.loading) {
      rows = '<tr><td colspan="5"><div class="admin-empty">불러오는 중...</div></td></tr>';
    } else if (state.error) {
      rows = '<tr><td colspan="5"><div class="admin-error">' + escapeHtml(state.error) + '</div></td></tr>';
    } else {
      var list = visibleUsers();
      if (!list.length) {
        rows = '<tr><td colspan="5"><div class="admin-empty">표시할 회원이 없습니다.</div></td></tr>';
      } else {
        rows = list.map(buildRow).join('');
      }
    }

    root.innerHTML = [
      '<div class="admin-page">',
        '<div class="bsf-flow-card">',
          '<div class="bsf-flow-head">',
            '<div class="bsf-flow-title-group">',
              '<p class="brand-studio-eyebrow">관리자 › 회원 관리</p>',
              '<h2 class="bsf-title">회원 관리</h2>',
              '<p class="bsf-desc">회원 계정을 생성·수정·삭제하고 접근 권한을 설정합니다.</p>',
            '</div>',
            '<div class="bsf-flow-head-actions">',
              '<button type="button" class="admin-sq-btn" data-action="go-home" aria-label="홈으로" title="홈으로">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
              '</button>',
              '<button type="button" class="admin-sq-btn admin-sq-btn--primary" data-action="new-user" aria-label="신규 회원" title="신규 회원">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21a8 8 0 0 1 13.292-6"/><circle cx="10" cy="8" r="5"/><path d="M19 16v6"/><path d="M22 19h-6"/></svg>',
              '</button>',
              '<button type="button" class="admin-sq-btn" data-action="reload" aria-label="새로고침" title="새로고침">',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>',
              '</button>',
            '</div>',
          '</div>',
        '</div>',

        '<div class="bsf-detail-card">',
          '<div class="admin-toolbar">',
            '<div class="admin-search"><input type="text" id="admin-search" placeholder="ID 또는 이름 검색" value="' + escapeHtml(state.search) + '" /></div>',
            '<select id="admin-filter">',
              '<option value="all"' + (state.filter === 'all' ? ' selected' : '') + '>전체</option>',
              '<option value="admin"' + (state.filter === 'admin' ? ' selected' : '') + '>관리자</option>',
              '<option value="member"' + (state.filter === 'member' ? ' selected' : '') + '>일반 회원</option>',
              '<option value="active"' + (state.filter === 'active' ? ' selected' : '') + '>활성</option>',
              '<option value="inactive"' + (state.filter === 'inactive' ? ' selected' : '') + '>비활성</option>',
            '</select>',
          '</div>',
          '<div class="admin-table-wrap">',
            '<table class="admin-table">',
              '<thead><tr><th>ID</th><th>이름</th><th>권한</th><th>상태</th><th>관리</th></tr></thead>',
              '<tbody>', rows, '</tbody>',
            '</table>',
          '</div>',
        '</div>',

        state.modalOpen ? buildModal() : '',
      '</div>'
    ].join('');

    bindEvents(root);
  }

  function buildRow(u) {
    var admin = isAdminUser(u);
    var permHtml = admin
      ? '<span class="admin-perm-chip">전체 권한</span>'
      : (Array.isArray(u.permissions) && u.permissions.length
          ? u.permissions.map(function (p) { return '<span class="admin-perm-chip">' + escapeHtml(permLabel(p)) + '</span>'; }).join('')
          : '<span class="admin-perm-chip">권한 없음</span>');
    var roleBadge = admin
      ? '<span class="admin-badge admin-badge--admin">관리자</span>'
      : '<span class="admin-badge admin-badge--member">회원</span>';
    var stateBadge = (u.active === false)
      ? '<span class="admin-badge admin-badge--off">비활성</span>'
      : '<span class="admin-badge admin-badge--on">활성</span>';
    var id = escapeHtml(u.id);
    return [
      '<tr data-id="' + id + '">',
        '<td><strong>' + id + '</strong></td>',
        '<td>' + escapeHtml(u.name || '-') + '</td>',
        '<td>' + roleBadge + ' ' + permHtml + '</td>',
        '<td>' + stateBadge + '</td>',
        '<td><div class="admin-row-actions">',
          '<button type="button" class="admin-icon-btn" data-action="edit-user" data-id="' + id + '">수정</button>',
          '<button type="button" class="admin-icon-btn admin-icon-btn--danger" data-action="delete-user" data-id="' + id + '">삭제</button>',
        '</div></td>',
      '</tr>'
    ].join('');
  }

  function buildModal() {
    var isEdit = state.modalMode === 'edit';
    var u = state.edit || { id: '', name: '', permissions: [], role: 'member', active: true };
    var admin = isAdminUser(u);
    var permChecks = PERMISSION_PAGES.map(function (p) {
      var checked = !admin && Array.isArray(u.permissions) && u.permissions.indexOf(p.key) !== -1;
      return '<label><input type="checkbox" class="admin-perm-check" value="' + p.key + '"' + (checked ? ' checked' : '') + ' />' + escapeHtml(p.label) + '</label>';
    }).join('');

    return [
      '<div class="admin-modal-backdrop" data-action="modal-backdrop">',
        '<div class="admin-modal" data-modal>',
          '<h3>' + (isEdit ? '회원 수정' : '신규 회원') + '</h3>',
          '<div class="admin-field">',
            '<label>ID</label>',
            '<input type="text" id="admin-f-id" value="' + escapeHtml(u.id) + '"' + (isEdit ? ' disabled' : '') + ' placeholder="영문 소문자/숫자/._-" />',
          '</div>',
          '<div class="admin-field">',
            '<label>이름</label>',
            '<input type="text" id="admin-f-name" value="' + escapeHtml(u.name || '') + '" placeholder="표시 이름(선택)" />',
          '</div>',
          '<div class="admin-field">',
            '<label>비밀번호</label>',
            '<input type="password" id="admin-f-pw" placeholder="' + (isEdit ? '변경 시에만 입력' : '비밀번호') + '" autocomplete="new-password" />',
            (isEdit ? '<p class="admin-hint">비워두면 기존 비밀번호가 유지됩니다.</p>' : ''),
          '</div>',
          '<div class="admin-field">',
            '<label>권한</label>',
            '<div class="admin-perms">',
              permChecks,
            '</div>',
            '<label style="margin-top:10px;display:flex;align-items:center;gap:6px;color:#fbbf24;">',
              '<input type="checkbox" id="admin-f-admin"' + (admin ? ' checked' : '') + ' /> 전체 권한(관리자)',
            '</label>',
          '</div>',
          '<div class="admin-field">',
            '<label style="display:flex;align-items:center;gap:6px;color:#e2e8f0;">',
              '<input type="checkbox" id="admin-f-active"' + (u.active !== false ? ' checked' : '') + ' /> 활성 계정',
            '</label>',
          '</div>',
          '<div class="admin-modal-error" id="admin-modal-error">' + escapeHtml(state.modalError || '') + '</div>',
          '<div class="admin-modal-actions">',
            '<button type="button" class="admin-icon-btn" data-action="modal-cancel">취소</button>',
            '<button type="button" class="bsf-head-btn btn-primary" data-action="modal-save"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? '저장 중...' : '저장(적용)') + '</button>',
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
          tbody.innerHTML = list.length ? list.map(buildRow).join('') : '<tr><td colspan="5"><div class="admin-empty">표시할 회원이 없습니다.</div></td></tr>';
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
    root.querySelectorAll('[data-action="edit-user"], [data-action="delete-user"]').forEach(function (el) {
      el.addEventListener('click', onAction);
    });
  }

  function onAction(e) {
    var el = e.currentTarget;
    var action = el.getAttribute('data-action');
    if (action === 'go-home') { goHome(); }
    else if (action === 'new-user') { openModal('create'); }
    else if (action === 'reload') { loadUsers(); }
    else if (action === 'edit-user') { openModal('edit', el.getAttribute('data-id')); }
    else if (action === 'delete-user') { deleteUser(el.getAttribute('data-id')); }
    else if (action === 'modal-cancel') { closeModal(); }
    else if (action === 'modal-backdrop') { if (e.target === el) closeModal(); }
    else if (action === 'modal-save') { saveModal(); }
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
    var adminEl = root.querySelector('#admin-f-admin');
    var activeEl = root.querySelector('#admin-f-active');
    var isAdmin = !!(adminEl && adminEl.checked);
    var perms = [];
    if (!isAdmin) {
      root.querySelectorAll('.admin-perm-check').forEach(function (c) { if (c.checked) perms.push(c.value); });
    }
    return {
      id: idEl ? String(idEl.value || '').trim() : '',
      name: nameEl ? String(nameEl.value || '').trim() : '',
      password: pwEl ? String(pwEl.value || '') : '',
      role: isAdmin ? 'admin' : 'member',
      permissions: perms,
      active: !!(activeEl && activeEl.checked)
    };
  }

  function saveModal() {
    var root = document.querySelector('.content');
    if (!root) return;
    var form = readModalForm(root);
    state.modalError = '';

    if (state.modalMode === 'create') {
      if (!form.id) { state.modalError = 'ID를 입력하세요.'; render(); return; }
      if (!form.password) { state.modalError = '비밀번호를 입력하세요.'; render(); return; }
    }

    state.saving = true;
    render();

    var p;
    if (state.modalMode === 'create') {
      p = NK.api.adminUserCreate({
        id: form.id, name: form.name, password: form.password,
        permissions: form.permissions, role: form.role, active: form.active
      });
    } else {
      var payload = {
        id: state.edit.id, name: form.name,
        permissions: form.permissions, role: form.role, active: form.active,
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
      var msg = (err && err.message) ? err.message : '저장 실패';
      if (/user_exists/.test(msg)) msg = '이미 존재하는 ID입니다.';
      else if (/conflict/.test(msg)) msg = '다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.';
      else if (/password_required/.test(msg)) msg = '비밀번호를 입력하세요.';
      else if (/invalid_user_id/.test(msg)) msg = '유효하지 않은 ID입니다.';
      else if (/admin_required/.test(msg)) msg = '관리자 권한이 필요합니다.';
      state.modalError = msg;
      render();
    });
  }

  function deleteUser(id) {
    var u = state.users.find(function (x) { return String(x.id) === String(id); });
    if (!u) return;
    if (!window.confirm('회원 "' + (u.name || u.id) + '"을(를) 삭제할까요?')) return;
    NK.api.adminUserDelete(id)
      .then(function () { return loadUsers(); })
      .catch(function (err) {
        var msg = (err && err.message) ? err.message : '삭제 실패';
        if (/cannot_delete_primary_admin/.test(msg)) msg = '기본 관리자 계정은 삭제할 수 없습니다.';
        else if (/admin_required/.test(msg)) msg = '관리자 권한이 필요합니다.';
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
    if (NK.auth && NK.auth.isAdmin && !NK.auth.isAdmin()) { render(); return; }
    loadUsers();
  }

  ui.adminUsers = { init: init, loadUsers: loadUsers };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
