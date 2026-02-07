;(function () {
  const NK = window.NK || (window.NK = {});
  const ui = NK.ui || (NK.ui = {});
  const scenario = ui.scenario || (ui.scenario = {});

  // ---------- helpers ----------
  const fmtEst = (sec) => {
    const n = Number(sec) || 0;
    if (n >= 3600 && n % 3600 === 0) return `${n / 3600}h`;
    if (n >= 60 && n % 60 === 0) return `${n / 60}m`;
    return `${n}s`;
  };

  const parseEst = (txt) => {
    if (NK.utils && NK.utils.parseEst) return NK.utils.parseEst(txt);
    const m = String(txt || '').match(/([0-9.]+)/);
    return m ? Math.max(Math.floor(Number(m[1]) || 0), 1) : 8;
  };

  const renderTagButtons = (box, list, selected = [], single = false) => {
    if (!box) return;
    box.innerHTML = (list || []).map(v => {
      const active = selected.includes(v) ? 'active' : '';
      return `<button type="button" class="tag-toggle ${active}" data-value="${v}" data-single="${single ? '1' : ''}">${v}</button>`;
    }).join('');
  };

  const setActiveButtons = (selector, value) => {
    document.querySelectorAll(selector).forEach(btn => {
      const val = btn.dataset.value || btn.dataset.ratio;
      btn.classList.toggle('active', val === value);
    });
  };

  const collectPayload = () => {
    const form = document.getElementById('scenario-form');
    if (!form) return {};
    const fd = new FormData(form);
    const payload = {};
    fd.forEach((v, k) => { payload[k] = v; });
    payload.purposeTags = Array.from(document.querySelectorAll('#purpose-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.needs = Array.from(document.querySelectorAll('#needs-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.tones = Array.from(document.querySelectorAll('#tone-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.styles = Array.from(document.querySelectorAll('#style-tags .tag-toggle.active')).map(b => b.dataset.value);
    payload.duration = document.querySelector('.duration-toggle.active')?.dataset.value || NK.config.DEFAULTS?.DURATION || '15';
    payload.aspectRatio = document.querySelector('.ratio-btn.active')?.dataset.ratio || '16:9';
    return payload;
  };

  // ---------- render scenes ----------
  scenario.renderScenes = function (scenes = []) {
    const container = document.getElementById('scenario-cards');
    if (!container) return;
    if (!scenes.length) {
      container.innerHTML = `
        <div class="empty-state center-empty">
          <div>
            <p class="muted">생성된 시나리오가 없습니다.</p>
            <p class="muted small">왼쪽 패널에서 조건을 입력하고 '시나리오 생성'을 눌러주세요.</p>
          </div>
        </div>`;
      return;
    }
    container.innerHTML = scenes.map(s => `
      <div class="scenario-card">
        <div class="card-top">
          <div>
            <h5>Scene ${s.id}</h5>
          </div>
          <input class="chip-input est-input" data-id="${s.id}" value="${fmtEst(s.estSec)}" />
        </div>
        <p class="view-lines" data-id="${s.id}" contenteditable="true">${s.lines || ''}</p>
        <p class="muted small">Visual: <span class="view-shot" data-id="${s.id}" contenteditable="true">${s.shot || ''}</span></p>
      </div>
    `).join('');
  };

  // ---------- load draft into form ----------
  const loadDraft = (draft) => {
    const form = document.getElementById('scenario-form');
    if (!form || !draft) return;
    const p = draft.payload || {};
    const defaults = NK.config.DEFAULTS || {};
    const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
    const defaultCat = p.purposeCategory || categories[0] || '';
    const targetSel = document.getElementById('target-select');
    const defaultTarget = p.target || (targetSel && targetSel.options.length ? targetSel.options[0].value : '');

    if (form.topic) form.topic.value = p.topic || draft.title || '';
    if (form.purposeCategory) form.purposeCategory.value = defaultCat;
    if (form.target) form.target.value = defaultTarget;
    if (form.tone) form.tone.value = p.tone || '';
    if (form.style) form.style.value = p.style || '';
    if (form.banned) form.banned.value = p.banned || '';

    // toggles
    setActiveButtons('.duration-toggle', p.duration || defaults.DURATION || '15');
    setActiveButtons('.ratio-btn', p.aspectRatio || '16:9');

    const one = (arr) => Array.isArray(arr) && arr.length ? [arr[0]] : [];
    renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[defaultCat] || [], one(p.purposeTags), true);
    renderTagButtons(document.getElementById('needs-tags'), NK.core.needsList || [], one(p.needs), true);
    renderTagButtons(document.getElementById('tone-tags'), NK.core.toneList || [], one(p.tones), true);
    renderTagButtons(document.getElementById('style-tags'), NK.core.styleList || [], one(p.styles), true);

    scenario.renderScenes(draft.scenes || []);
  };

  // ---------- init ----------
  scenario.init = async function () {
    const form = document.getElementById('scenario-form');
    if (!form) return;

    const pageLoading = document.getElementById('page-loading');
    const main = document.querySelector('.main');
    if (main) main.classList.add('loading-blur');

    // 장르(목적 대분류) 옵션을 주입 - 기본값이 비어 보이는 문제 대응
    const ensurePurposeOptions = () => {
      const sel = document.getElementById('purpose-category');
      if (!sel || sel.options.length) return;
      const categories = NK.core.purposeCategories ? Object.keys(NK.core.purposeCategories) : [];
      categories.forEach((c, idx) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        if (idx === 0) opt.selected = true;
        sel.appendChild(opt);
      });
    };
    ensurePurposeOptions();

    // 화면 비율 버튼(16:9/9:16/1:1)이 폼 밖에 있어 클릭이 안 먹던 문제 해결
    const ratioGroup = document.getElementById('ratio-group');
    if (ratioGroup) {
      ratioGroup.addEventListener('click', (e) => {
        const btn = e.target.closest('.ratio-btn');
        if (!btn) return;
        e.preventDefault();
        setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      });
    }

    let draft = null;
    const saved = localStorage.getItem(NK.config.KEYS.SELECTED_DRAFT);
    if (saved) draft = JSON.parse(saved);
    const pid = draft?.id || new URLSearchParams(location.search).get('projectId');

    // 서버 최신 데이터를 우선 로드
    if (pid && NK.api?.projectGet) {
      try {
        const srv = await NK.api.projectGet(pid);
        if (srv?.data) {
          draft = {
            id: pid,
            title: srv.data.title || draft?.title || '프로젝트',
            payload: srv.data.payload || draft?.payload || {},
            scenes: srv.data.scenes || draft?.scenes || [],
            header: srv.data.header || draft?.header || ''
          };
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          if (NK.state?.set) NK.state.set({ currentProject: draft });
        }
      } catch (_) { }
    }

    // 저장된 초안 로드
    loadDraft(draft);

    // 토글/버튼 클릭
    form.addEventListener('click', (e) => {
      const btn = e.target.closest('.tag-toggle, .duration-toggle, .ratio-btn');
      if (!btn) return;
      if (btn.classList.contains('duration-toggle')) {
        setActiveButtons('.duration-toggle', btn.dataset.value);
      } else if (btn.classList.contains('ratio-btn')) {
        setActiveButtons('.ratio-btn', btn.dataset.ratio || btn.dataset.value);
      } else if (btn.classList.contains('tag-toggle')) {
        if (btn.dataset.single === '1') {
          btn.parentElement.querySelectorAll('.tag-toggle').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        } else {
          btn.classList.toggle('active');
        }
      }
      if (btn.closest('#purpose-tags') || btn.name === 'purposeCategory') {
        const cat = form.purposeCategory ? form.purposeCategory.value : '';
        const sel = Array.from(document.querySelectorAll('#purpose-tags .tag-toggle.active')).map(b => b.dataset.value);
        renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[cat] || [], sel, true);
      }
    });

    // 카테고리 변경 시 목적 태그 재렌더
    if (form.purposeCategory) {
      form.purposeCategory.addEventListener('change', () => {
        const cat = form.purposeCategory.value;
        renderTagButtons(document.getElementById('purpose-tags'), NK.core.purposeCategories[cat] || [], [], true);
      });
    }

    // 시나리오 생성
    form.onsubmit = async (e) => {
      e.preventDefault();
      NK.core.setLoading(true);
      const payload = collectPayload();
      try {
        const res = await NK.api.scenario(payload);
        if (res?.scenes) {
          draft = draft || { id: Date.now(), title: payload.topic || '새 프로젝트' };
          draft.payload = payload;
          draft.scenes = res.scenes;
          draft.header = res.header || draft.header || '';
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          NK.store.saveDrafts([draft]);
          if (NK.api?.projectSave) {
            await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header, aspectRatio: draft.payload?.aspectRatio, title: draft.title });
          }
          loadDraft(draft);
          alert('시나리오를 생성했습니다.');
        }
      } catch (err) {
        alert('시나리오 생성 실패: ' + (err?.message || err));
      } finally {
        NK.core.setLoading(false);
      }
    };

    // 저장 버튼
    const saveBtn = document.getElementById('save-draft');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        NK.core.setLoading(true);
        try {
          draft = draft || { id: Date.now(), title: '새 프로젝트' };
          draft.payload = collectPayload();
          draft.scenes = Array.from(document.querySelectorAll('.scenario-card')).map(card => {
            const id = Number(card.querySelector('.est-input')?.dataset.id);
            const estTxt = card.querySelector('.est-input')?.value || '';
            const est = parseEst(estTxt);
            return {
              id,
              title: '', // 제목은 미사용
              shot: card.querySelector('.view-shot')?.textContent?.trim() || '',
              estSec: est
            };
          });
          localStorage.setItem(NK.config.KEYS.SELECTED_DRAFT, JSON.stringify(draft));
          NK.store.saveDrafts([draft]);
          if (NK.api?.projectSave) {
            await NK.api.projectSave(draft.id, draft.payload, draft.scenes, { header: draft.header || '', aspectRatio: draft.payload?.aspectRatio, title: draft.title });
          }
          alert('저장되었습니다.');
        } catch (err) {
          alert('저장 실패: ' + (err?.message || err));
        } finally {
          NK.core.setLoading(false);
        }
      };
    }
    // 페이지 로딩 종료 처리 (초기 렌더 완료 후)
    setTimeout(() => {
      if (pageLoading) pageLoading.classList.add('hidden');
      if (main) main.classList.remove('loading-blur');
    }, 120);
  };
})();







