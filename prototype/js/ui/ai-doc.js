;(function () {
  'use strict';

  const NK = window.NK || (window.NK = {});
  const STORAGE = {
    projectsDb: 'nk-ai-doc-projects',
    projectStore: 'projects',
    knowledge: 'nk_ai_doc_knowledge_v1',
    sharedToggle: 'nk_ai_doc_use_shared',
    lastModel: 'nk_ai_doc_model',
    adminKey: 'nk_ai_doc_admin_key',
    accessKey: 'nk_ai_doc_access_key',
  };

  // RAG 서버 상태 (Neon 활성화 여부 등)
  const ragState = {
    configured: false,
    documents: 0,
    chunks: 0,
    adminRequired: false,
    accessRequired: false,
    lastFetchedAt: 0,
  };

  // 8개 기본 섹션 템플릿 (원본 IrumHahn/redesign-maker-10 기준, 한이룸 브랜드 표현 제거)
  const SECTION_TEMPLATES = [
    { id: 'S1', name: 'S1 히어로', purpose: '3초 안에 제품, 타겟, 핵심 약속, CTA를 전달합니다.', source: '제품컷, 대표 USP',
      layout: '제품컷을 크게 쓰는 히어로. 상단은 짧은 약속, 하단은 CTA/핵심 배지.' },
    { id: 'S2', name: 'S2 문제 공감', purpose: '고객이 자기 상황이라고 느끼는 체크리스트를 배치합니다.', source: '사용 전 고민 문구',
      layout: '제품컷은 보조로, 체크리스트/상황 카드 중심. 대화형 질문 구조.' },
    { id: 'S3', name: 'S3 베네핏 3개', purpose: '기능 나열을 체감 언어로 바꿔 기억 구조를 만듭니다.', source: '기능 설명, 사용 장점',
      layout: '3개 베네핏을 세로 스텝 또는 아이콘 타일로 구성.' },
    { id: 'S4', name: 'S4 USP 차별점', purpose: '경쟁 제품 대비 선택 이유를 한 문장으로 압축합니다.', source: '소재, 구성, 가격',
      layout: '비교표/선택 이유 카드 중심. 제품컷은 우측 하단에 작게 배치.' },
    { id: 'S5', name: 'S5 근거/신뢰', purpose: '결과, 조건, 해석의 3단 구조로 신뢰를 설계합니다.', source: '인증, 수치, 테스트',
      layout: '문서/라벨/성분표를 읽기 쉬운 정보 패널로 구성. 데이터 카드 중심.' },
    { id: 'S6', name: 'S6 사용법', purpose: '선택지를 2~3개로 줄여 구매 후 사용 장벽을 낮춥니다.', source: '루틴, 구성품',
      layout: '타임라인/루틴 플로우 중심. 제품은 사용 장면과 함께 작게 배치.' },
    { id: 'S7', name: 'S7 후기 카드', purpose: '실제 리뷰가 있을 때 사용감 문장 후기 카드로 구성합니다.', source: '리뷰, 평점',
      layout: '후기 카드 6개 내외의 콜라주형 레이아웃. 제품컷은 배경 요소로만 약하게 사용.' },
    { id: 'S8', name: 'S8 FAQ/오퍼', purpose: '마지막 구매 저항을 해소하고 CTA로 마무리합니다.', source: '배송, AS, 혜택',
      layout: 'FAQ 아코디언처럼 보이는 질문 카드와 하단 CTA.' },
    { id: 'S9', name: 'S9 비교/보증', purpose: '선택 불안을 줄이는 비교표와 보증 구조를 제안합니다.', source: '보증, 비교 근거',
      layout: '비교 매트릭스와 보증 배지 중심.' },
    { id: 'S10', name: 'S10 최종 CTA', purpose: '혜택과 구매 이유를 다시 압축해 마지막 행동을 유도합니다.', source: '오퍼, 사은품, 한정 조건',
      layout: '최종 CTA 전용. 기존 섹션 요약 3개와 구매 버튼을 하단에 강하게 배치.' },
  ];

  const COMMERCE_TIPS = [
    '첫 화면은 제품명보다 누구의 어떤 문제를 해결하는지가 먼저 보여야 이탈이 줄어듭니다.',
    '상세페이지의 수치는 조건이 함께 있을 때 신뢰가 생깁니다. 기간·대상·기준을 같이 적어주세요.',
    '구매전환을 높이는 CTA는 \'구매하기\'만 반복하기보다 혜택·안심·한정 이유를 번갈아 보여주는 편이 좋습니다.',
    '제품 구성이 복잡하면 선택지가 많아 보여 구매가 밀립니다. 대표 1개 + 비교 1~2개로 압축해보세요.',
    '리뷰는 별점보다 사용감 문장이 강합니다. 짧은 후기 카드가 스캔에 유리합니다.',
    '고가 상품은 장점보다 불안 제거가 먼저입니다. 배송·교환·AS·보증을 초반부터 노출하세요.',
    '혜택은 마지막에만 두지 말고 히어로·근거 후·후기 후·최종 CTA에 리듬 있게 반복하세요.',
    '제품컷은 예쁘게보다 크기·질감·구성품·사용 상황이 이해되는 쪽이 구매에 더 가깝습니다.',
    '스마트스토어·쿠팡은 브랜드 서사보다 스캔 속도가 중요합니다.',
    '건강·뷰티·식품은 효능 단정보다 원료·사용감·루틴 중심으로 풀어야 안전합니다.',
    '한 장에는 메시지 하나만. 여러 주장을 한 화면에 넣으면 모두 약해집니다.',
    '구매 저항은 가격 때문만은 아닙니다. 나에게 맞을지·쉬울지·믿을 수 있는지가 먼저 해결되어야 합니다.',
  ];

  const SAFETY_LINES = [
    '근거 없는 수치, 리뷰, 인증, 효과 표현을 새로 만들지 않는다.',
    '원본 이미지에 없는 새 브랜드명, 새 제품명, 새 로고를 만들지 않는다.',
    '한 장에 메시지 하나만 담는다. 한국어 문구는 크게, 작은 글씨는 줄인다.',
    '규제 리스크가 있는 표현은 안전하게 완화한다.',
    '같은 상세페이지 안에서 이어 붙였을 때 레이아웃이 반복되지 않도록 카드 구조·타이포·정보 배치를 섹션마다 다르게 한다.',
  ];

  // 상태
  const state = {
    view: 'dashboard',
    files: [],            // File[]
    referenceDataUrls: [],// data URLs prepared from files
    request: '',
    channel: '스마트스토어',
    count: 8,
    ratio: '9:16',
    model: 'openai',      // 'openai' | 'gemini'
    useShared: true,
    knowledge: [],        // [{id, name, type, size, text, createdAt}]
    projects: [],         // saved projects
    activeProject: null,  // current results project
    generating: false,
    abortFlag: false,
    progress: { startedAt: 0, sectionIndex: 0, total: 0 },
    tipTimer: null,
    progressTimer: null,
  };

  // ── i18n helper ────────────────────────────────────────
  function t(key, vars) {
    try {
      const lang = localStorage.getItem('nk_lang') || 'ko';
      const tr = window.NK && window.NK.core && window.NK.core.translations && window.NK.core.translations[lang];
      let text = (tr && tr[key]) || key;
      if (vars) Object.keys(vars).forEach((k) => { text = text.replace('{' + k + '}', vars[k]); });
      return text;
    } catch (_) { return key; }
  }

  // ── DOM helpers ─────────────────────────────────────────
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  // ── Toast ──────────────────────────────────────────────
  let toastTimer = null;
  function toast(msg, ms) {
    const el = $('#ai-doc-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), Math.max(1500, Number(ms) || 2800));
  }

  // ── View routing ───────────────────────────────────────
  function setView(view) {
    state.view = view;
    $$('.ai-doc-view').forEach((el) => {
      if (el.getAttribute('data-view') === view) el.classList.remove('hidden');
      else el.classList.add('hidden');
    });
    $$('.sidebar .nav-item[data-ai-doc-view]').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-ai-doc-view') === view);
    });
    if (view === 'dashboard') renderDashboard();
    if (view === 'results') renderResults();
    try {
      const params = new URLSearchParams(window.location.search);
      params.set('view', view);
      const next = window.location.pathname + '?' + params.toString();
      history.replaceState(null, '', next);
    } catch (_) {}
  }

  // ── IndexedDB (projects) ───────────────────────────────
  function openProjectDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(STORAGE.projectsDb, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORAGE.projectStore)) {
          db.createObjectStore(STORAGE.projectStore, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadProjectsFromDb() {
    const db = await openProjectDb();
    if (!db) return [];
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.projectStore, 'readonly');
      const req = tx.objectStore(STORAGE.projectStore).getAll();
      req.onsuccess = () => {
        const list = (req.result || []).filter((p) => p && p.id && Array.isArray(p.sections));
        list.sort((a, b) => new Date(b.savedAt || b.createdAt || 0).getTime() - new Date(a.savedAt || a.createdAt || 0).getTime());
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveProjectToDb(project) {
    const db = await openProjectDb();
    if (!db) throw new Error('브라우저 저장소를 열 수 없습니다.');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.projectStore, 'readwrite');
      tx.objectStore(STORAGE.projectStore).put(project);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteProjectFromDb(id) {
    const db = await openProjectDb();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORAGE.projectStore, 'readwrite');
      tx.objectStore(STORAGE.projectStore).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── Knowledge (localStorage) ───────────────────────────
  function loadKnowledge() {
    try {
      const raw = localStorage.getItem(STORAGE.knowledge);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 10) : [];
    } catch (_) { return []; }
  }

  function saveKnowledge(items) {
    try {
      localStorage.setItem(STORAGE.knowledge, JSON.stringify(items.slice(0, 10)));
    } catch (e) {
      toast('지식파일 텍스트가 커서 일부 저장에 실패했습니다. 파일 수나 크기를 줄여주세요.');
    }
  }

  // ── PDF.js (lazy loaded via CDN) ───────────────────────
  let pdfjsLib = null;
  async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.mjs');
      mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.mjs';
      pdfjsLib = mod;
      return mod;
    } catch (e) {
      throw new Error('PDF 처리 라이브러리를 불러오지 못했습니다. 네트워크를 확인해주세요.');
    }
  }

  async function extractPdfText(file) {
    const pdfjs = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const max = Math.min(pdf.numPages, 60);
    const out = [];
    for (let p = 1; p <= max; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items.map((it) => (it && 'str' in it ? it.str : '')).filter(Boolean).join(' ');
      if (text.trim()) out.push('[p.' + p + '] ' + text);
      if (out.join('\n').length > 60000) break;
    }
    return out.join('\n');
  }

  async function renderPdfFirstPagesToDataUrls(file, maxPages) {
    const pdfjs = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const max = Math.min(pdf.numPages, Math.max(1, maxPages || 2));
    const urls = [];
    for (let p = 1; p <= max; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      urls.push(canvas.toDataURL('image/png'));
    }
    return urls;
  }

  // ── File handling ──────────────────────────────────────
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
      reader.readAsDataURL(file);
    });
  }

  async function compressImageDataUrl(dataUrl, maxWidth) {
    if (!dataUrl.startsWith('data:image/')) return dataUrl;
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('이미지 로드 실패'));
        i.src = dataUrl;
      });
      const W = img.naturalWidth || img.width;
      const H = img.naturalHeight || img.height;
      const scale = Math.min(1, (maxWidth || 1100) / Math.max(1, W));
      const w = Math.max(1, Math.round(W * scale));
      const h = Math.max(1, Math.round(H * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { alpha: false });
      if (!ctx) return dataUrl;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.86);
    } catch (_) { return dataUrl; }
  }

  async function prepareReferences(files) {
    const out = [];
    for (const f of files) {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        try {
          const urls = await renderPdfFirstPagesToDataUrls(f, 2);
          for (const u of urls) out.push(await compressImageDataUrl(u, 1100));
        } catch (e) {
          toast('PDF를 이미지로 변환하지 못했습니다: ' + (e && e.message || ''));
        }
      } else if (f.type.startsWith('image/')) {
        const url = await fileToDataUrl(f);
        out.push(await compressImageDataUrl(url, 1100));
      }
      if (out.length >= 4) break;
    }
    return out.slice(0, 4);
  }

  // ── Prompt builder ─────────────────────────────────────
  function buildSectionPrompt(template, opts) {
    const lines = [
      '너는 커머스 상세페이지 리디자인 이미지 생성 엔진이다.',
      '세로형 ' + (opts.ratio || '9:16') + ' 상세페이지 섹션 이미지 1장을 생성한다.',
      '섹션: ' + template.name,
      '목적: ' + template.purpose,
      '원본 참조: ' + template.source,
      '권장 레이아웃: ' + template.layout,
      '판매 채널: ' + (opts.channel || '스마트스토어'),
      '추가 요청사항: ' + (opts.request || '전환율 중심으로 리디자인'),
    ];
    if (opts.knowledge) lines.push('참고 사전 지식 (요약): ' + opts.knowledge.slice(0, 4000));
    lines.push('전체 연결 규칙: 같은 상세페이지를 이어 붙였을 때 하나의 흐름처럼 보여야 한다. 동일 브랜드 색·폰트 감각·제품 사진 톤은 유지하되 섹션마다 레이아웃을 다르게 구성한다.');
    lines.push('안전 규칙: ' + SAFETY_LINES.join(' '));
    return lines.join('\n');
  }

  function buildEditPrompt(section, requestText, project) {
    return [
      '너는 커머스 상세페이지 섹션 이미지 편집 엔진이다.',
      '첨부된 ' + (project.ratio || '9:16') + ' 상세페이지 섹션 이미지를 기반으로 같은 제품과 전체 톤앤매너를 유지하면서 필요한 부분만 편집한다.',
      '프로젝트: ' + (project.title || '상세페이지 리디자인'),
      '판매 채널: ' + (project.channel || '스마트스토어'),
      '섹션: ' + section.id + ' ' + section.name,
      '섹션 목적: ' + section.purpose,
      '원본 참조: ' + section.source,
      '사용자 수정 요청: ' + requestText,
      '규칙: 제품명·패키지·핵심 수치·안전한 표현 원칙은 유지한다. ' + SAFETY_LINES.join(' '),
    ].join('\n');
  }

  function buildKnowledgeText() {
    if (!state.useShared) return '';
    if (!state.knowledge.length) return '';
    return state.knowledge
      .map((k, i) => '# 등록 지식파일 ' + (i + 1) + ': ' + k.name + '\n' + (k.text || ''))
      .join('\n\n')
      .slice(0, 12000);
  }

  // ── /api/imagen call ──────────────────────────────────
  async function callImagen(payload, signal) {
    if (!NK.api || !NK.api.imagen) throw new Error('API client가 로드되지 않았습니다.');
    return await NK.api.imagen(payload, { signal, timeoutMs: 180000 });
  }

  // ── RAG (Neon Postgres + pgvector) ─────────────────────
  async function fetchRagStats(force) {
    if (!NK.api || !NK.api.knowledgeStats) return;
    if (!force && (Date.now() - ragState.lastFetchedAt) < 30000) return;
    try {
      const data = await NK.api.knowledgeStats();
      ragState.configured = Boolean(data && data.configured);
      ragState.documents = Number(data && data.documents || 0);
      ragState.chunks = Number(data && data.chunks || 0);
      ragState.adminRequired = Boolean(data && data.adminRequired);
      ragState.accessRequired = Boolean(data && data.accessRequired);
      ragState.lastFetchedAt = Date.now();
    } catch (_) {
      ragState.configured = false;
      ragState.lastFetchedAt = Date.now();
    }
    reflectRagStatus();
  }

  function reflectRagStatus() {
    const libRag = $('#ai-doc-lib-rag');
    if (libRag) {
      if (ragState.configured) {
        libRag.textContent = t('ai_doc_rag_active', { n: ragState.chunks });
        libRag.classList.remove('ai-doc-chip-muted');
        libRag.classList.add('ai-doc-chip-good');
      } else {
        libRag.textContent = t('ai_doc_rag_inactive');
        libRag.classList.add('ai-doc-chip-muted');
        libRag.classList.remove('ai-doc-chip-good');
      }
    }
    const docs = $('#ai-doc-lib-docs');
    if (docs) {
      const localCount = state.knowledge.length;
      const serverCount = ragState.documents;
      docs.textContent = (ragState.configured ? serverCount : localCount) + t('ai_doc_count_unit');
    }
    const adminRow = $('#ai-doc-admin-key-row');
    if (adminRow) adminRow.style.display = ragState.adminRequired ? '' : 'none';
    const accessRow = $('#ai-doc-access-key-row');
    if (accessRow) accessRow.style.display = ragState.accessRequired ? '' : 'none';
    const status = $('#ai-doc-knowledge-status');
    if (status) {
      if (ragState.configured) {
        status.textContent = t('ai_doc_rag_server_active', { docs: ragState.documents, chunks: ragState.chunks });
        status.className = 'ai-doc-chip ai-doc-chip-good';
      } else {
        status.textContent = t('ai_doc_rag_server_inactive');
        status.className = 'ai-doc-chip ai-doc-chip-muted';
      }
    }
  }

  function getAdminKey() {
    try { return String(localStorage.getItem(STORAGE.adminKey) || '').trim(); } catch (_) { return ''; }
  }
  function setAdminKey(v) {
    try { localStorage.setItem(STORAGE.adminKey, String(v || '').trim()); } catch (_) {}
  }
  function getAccessKey() {
    try { return String(localStorage.getItem(STORAGE.accessKey) || '').trim(); } catch (_) { return ''; }
  }
  function setAccessKey(v) {
    try { localStorage.setItem(STORAGE.accessKey, String(v || '').trim()); } catch (_) {}
  }

  async function searchKnowledgeContext(queryText) {
    if (!state.useShared) return '';
    if (!ragState.configured) return buildKnowledgeText(); // 로컬 fallback
    if (!NK.api || !NK.api.knowledgeSearch) return buildKnowledgeText();
    try {
      const data = await NK.api.knowledgeSearch({ query: queryText, limit: 8, accessKey: getAccessKey() });
      const chunks = (data && data.chunks) || [];
      if (!chunks.length) return buildKnowledgeText();
      return chunks
        .map((c, i) => '# RAG 검색 ' + (i + 1) + ' (' + (c.sourceName || '문서') + ' / chunk ' + ((c.chunkIndex || 0) + 1) + ', similarity ' + (Number(c.similarity || 0).toFixed(3)) + ')\n' + c.content)
        .join('\n\n')
        .slice(0, 12000);
    } catch (e) {
      return buildKnowledgeText();
    }
  }

  // ── Progress overlay ──────────────────────────────────
  function showProgress(total) {
    state.progress = { startedAt: Date.now(), sectionIndex: 0, total: total };
    const ov = $('#ai-doc-progress'); if (!ov) return;
    show(ov);
    $('#ai-doc-progress-title').textContent = total > 1 ? ('섹션 1/' + total + ' 생성 중…') : '생성 중…';
    $('#ai-doc-progress-fill').style.width = '4%';
    $('#ai-doc-progress-phase').textContent = '원본 분석';
    $('#ai-doc-progress-time').textContent = '0s';
    rotateTip();
    state.tipTimer = setInterval(rotateTip, 7000);
    state.progressTimer = setInterval(updateProgressClock, 1000);
  }

  function updateProgress(sectionIndex, label) {
    state.progress.sectionIndex = sectionIndex;
    const total = state.progress.total || 1;
    const pct = Math.min(96, Math.max(4, Math.round(((sectionIndex + 0.4) / total) * 100)));
    const fill = $('#ai-doc-progress-fill'); if (fill) fill.style.width = pct + '%';
    const title = $('#ai-doc-progress-title');
    if (title) title.textContent = total > 1 ? ('섹션 ' + (sectionIndex + 1) + '/' + total + ' 생성 중…') : '생성 중…';
    const phase = $('#ai-doc-progress-phase');
    if (phase && label) phase.textContent = label;
  }

  function updateProgressClock() {
    const t = Math.max(0, Math.floor((Date.now() - state.progress.startedAt) / 1000));
    const el = $('#ai-doc-progress-time');
    if (el) el.textContent = t + 's';
  }

  function rotateTip() {
    const tip = COMMERCE_TIPS[Math.floor(Math.random() * COMMERCE_TIPS.length)];
    const el = $('#ai-doc-progress-tip');
    if (el) el.textContent = tip;
  }

  function hideProgress() {
    hide($('#ai-doc-progress'));
    if (state.tipTimer) { clearInterval(state.tipTimer); state.tipTimer = null; }
    if (state.progressTimer) { clearInterval(state.progressTimer); state.progressTimer = null; }
  }

  // ── Generation flow ────────────────────────────────────
  function newProjectId() {
    return 'aidoc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  async function startGeneration() {
    if (state.generating) return;
    if (!state.files.length) { toast('기존 상세페이지 이미지 또는 PDF를 먼저 업로드해주세요.'); return; }

    state.generating = true;
    state.abortFlag = false;
    const total = Math.max(1, Math.min(10, Number(state.count) || 8));
    const templates = SECTION_TEMPLATES.slice(0, total);
    const projectId = newProjectId();
    const project = {
      id: projectId,
      title: (state.channel || '스마트스토어') + ' 상세페이지 리디자인',
      channel: state.channel,
      ratio: state.ratio,
      count: total,
      model: state.model,
      request: state.request,
      files: state.files.map((f) => f.name),
      createdAt: new Date().toISOString(),
      status: '진행 중',
      sections: templates.map((t) => ({ id: t.id, name: t.name, purpose: t.purpose, source: t.source, imageUrl: '', prompt: '' })),
    };
    state.activeProject = project;
    setView('results');
    renderResults();

    try {
      // 원본 자료를 데이터 URL로 변환 (PDF → PNG 변환 포함)
      showProgress(total);
      updateProgress(0, '원본 자료 분석');
      state.referenceDataUrls = await prepareReferences(state.files);
      if (!state.referenceDataUrls.length) throw new Error('참조 이미지를 준비하지 못했습니다.');

      // RAG 검색 1회 — 채널·요청·전체 흐름을 쿼리로 사용 (활성화 시), 미설정 시 로컬 fallback
      await fetchRagStats(true);
      const ragQuery = [
        '상세페이지 리디자인 CRO 지식',
        '판매 채널: ' + state.channel,
        '추가 요청사항: ' + (state.request || '전환율 중심 리디자인'),
      ].join('\n');
      const knowledgeText = await searchKnowledgeContext(ragQuery);
      const aspectRatio = state.ratio || '9:16';

      for (let i = 0; i < templates.length; i++) {
        if (state.abortFlag) break;
        updateProgress(i, '섹션 생성 (' + templates[i].name + ')');
        markSectionLoading(templates[i].id, true);

        const prompt = buildSectionPrompt(templates[i], {
          channel: state.channel,
          request: state.request,
          ratio: aspectRatio,
          knowledge: knowledgeText,
        });

        try {
          const resp = await callImagen({
            prompt,
            aspectRatio,
            provider: state.model === 'gemini' ? 'gemini' : 'openai',
            generationMode: 'image-to-image',
            referenceImages: state.referenceDataUrls.map((u, idx) => ({
              referenceId: idx + 1,
              imageDataUrl: u,
              subjectDescription: '원본 상세페이지 ' + (idx + 1),
            })),
            imageSize: '1K',
            projectId: project.id,
            sessionId: 'ai-doc',
            storageService: 'ai-image',
          });

          const url = (resp && (resp.dataUrl || (resp.bytesBase64Encoded ? ('data:image/png;base64,' + resp.bytesBase64Encoded) : ''))) || '';
          if (!url) throw new Error('이미지 응답이 비어 있습니다.');

          project.sections[i].imageUrl = url;
          project.sections[i].prompt = prompt;
          markSectionLoading(templates[i].id, false);
          renderSection(project.sections[i]);
        } catch (err) {
          markSectionLoading(templates[i].id, false);
          const msg = err && err.message || '생성 실패';
          toast(templates[i].name + ' 생성 실패: ' + msg);
          if (i === 0) throw err;
          break;
        }
      }

      project.status = state.abortFlag ? '취소됨' : '완료';
      state.activeProject = project;
      renderResults();
      toast('상세페이지 ' + project.sections.filter((s) => s.imageUrl).length + '장 생성 완료');
    } catch (e) {
      toast(e && e.message || '생성 중 오류가 발생했습니다.');
    } finally {
      hideProgress();
      state.generating = false;
    }
  }

  function markSectionLoading(id, loading) {
    const el = document.querySelector('[data-section-id="' + id + '"] .ai-doc-section-thumb');
    if (!el) return;
    el.classList.toggle('is-loading', !!loading);
    el.classList.toggle('is-pending', !loading && !el.querySelector('img'));
  }

  // ── Section edit ───────────────────────────────────────
  let editTarget = null;
  function openEditModal(sectionId) {
    const project = state.activeProject;
    if (!project) return;
    const section = project.sections.find((s) => s.id === sectionId);
    if (!section || !section.imageUrl) { toast('수정할 이미지가 아직 생성되지 않았습니다.'); return; }
    editTarget = section;
    $('#ai-doc-edit-title').textContent = '섹션 수정 — ' + section.name;
    $('#ai-doc-edit-request').value = '';
    show($('#ai-doc-edit-modal'));
    setTimeout(() => $('#ai-doc-edit-request').focus(), 50);
  }

  async function submitSectionEdit() {
    const project = state.activeProject;
    if (!project || !editTarget) return;
    const requestText = String($('#ai-doc-edit-request').value || '').trim();
    if (!requestText) { toast('수정 요청을 입력해주세요.'); return; }

    hide($('#ai-doc-edit-modal'));
    state.generating = true;
    showProgress(1);
    updateProgress(0, editTarget.name + ' 수정');

    try {
      const compressed = await compressImageDataUrl(editTarget.imageUrl, 960);
      const prompt = buildEditPrompt(editTarget, requestText, project);
      const resp = await callImagen({
        prompt,
        aspectRatio: project.ratio || '9:16',
        provider: state.model === 'gemini' ? 'gemini' : 'openai',
        generationMode: 'image-to-image',
        referenceImages: [{ referenceId: 1, imageDataUrl: compressed, subjectDescription: editTarget.name + ' 원본' }],
        imageSize: '1K',
        projectId: project.id,
        sessionId: 'ai-doc-edit',
        storageService: 'ai-image',
      });
      const url = (resp && (resp.dataUrl || (resp.bytesBase64Encoded ? ('data:image/png;base64,' + resp.bytesBase64Encoded) : ''))) || '';
      if (!url) throw new Error('수정 응답이 비어 있습니다.');

      const idx = project.sections.findIndex((s) => s.id === editTarget.id);
      if (idx >= 0) {
        const revisions = project.sections[idx].revisions || [{ id: editTarget.id + '-original', imageUrl: editTarget.imageUrl, label: '원본', createdAt: editTarget.createdAt || project.createdAt }];
        revisions.push({ id: editTarget.id + '-r' + Date.now(), imageUrl: url, label: '수정 ' + revisions.length, createdAt: new Date().toISOString(), request: requestText });
        project.sections[idx] = Object.assign({}, project.sections[idx], { imageUrl: url, prompt, revisions: revisions });
      }
      state.activeProject = project;
      renderResults();
      toast(editTarget.name + ' 수정 완료');
    } catch (e) {
      toast(e && e.message || '섹션 수정 실패');
    } finally {
      hideProgress();
      state.generating = false;
      editTarget = null;
    }
  }

  // ── Render: Dashboard ──────────────────────────────────
  async function renderDashboard() {
    const list = $('#ai-doc-recent-list');
    const empty = $('#ai-doc-recent-empty');
    if (!list || !empty) return;

    let projects = state.projects;
    try { projects = await loadProjectsFromDb(); state.projects = projects; } catch (_) {}

    Array.from(list.querySelectorAll('.ai-doc-recent-item')).forEach((el) => el.remove());

    if (!projects.length) {
      empty.style.display = '';
    } else {
      empty.style.display = 'none';
      projects.slice(0, 8).forEach((p) => {
        const div = document.createElement('div');
        div.className = 'ai-doc-recent-item';
        div.innerHTML =
          '<div class="ai-doc-recent-thumb">📄</div>' +
          '<div class="ai-doc-recent-info">' +
            '<strong></strong>' +
            '<div class="ai-doc-recent-meta">' +
              '<span></span><span></span><span></span>' +
            '</div>' +
          '</div>' +
          '<div class="ai-doc-recent-actions">' +
            '<button type="button" class="btn-ghost" data-action="open" data-i18n="ai_doc_btn_open" title="열기">열기</button>' +
            '<button type="button" class="btn-ghost" data-action="delete" data-i18n="ai_doc_btn_delete" title="삭제">삭제</button>' +
          '</div>';
        const spans = div.querySelectorAll('.ai-doc-recent-meta span');
        div.querySelector('strong').textContent = p.title || '프로젝트';
        spans[0].textContent = p.channel || '';
        spans[1].textContent = (p.sections && p.sections.length || 0) + '장';
        spans[2].textContent = p.ratio || '9:16';
        div.querySelector('[data-action="open"]').addEventListener('click', () => { state.activeProject = p; setView('results'); });
        div.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          if (!confirm('이 프로젝트를 삭제할까요?')) return;
          await deleteProjectFromDb(p.id);
          renderDashboard();
        });
        list.appendChild(div);
      });
    }

    const statRecent = $('#ai-doc-stat-recent'); if (statRecent) statRecent.textContent = String(projects.length || 0);
    const statAvg = $('#ai-doc-stat-avg');
    if (statAvg) statAvg.textContent = projects.length
      ? (projects.reduce((s, p) => s + (p.sections ? p.sections.length : 0), 0) / projects.length).toFixed(1)
      : '-';

    const libDocs = $('#ai-doc-lib-docs'); if (libDocs) libDocs.textContent = state.knowledge.length + '개';
    const libChars = $('#ai-doc-lib-chars');
    if (libChars) libChars.textContent = state.knowledge.reduce((s, k) => s + (k.text ? k.text.length : 0), 0).toLocaleString();
    const kBadge = $('#ai-doc-knowledge-count');
    if (kBadge) {
      if (state.knowledge.length) { kBadge.textContent = String(state.knowledge.length); kBadge.hidden = false; }
      else kBadge.hidden = true;
    }
    const sharedCount = $('#ai-doc-shared-count');
    if (sharedCount) sharedCount.textContent = t('ai_doc_shared_count', { n: state.knowledge.length });
  }

  // ── Render: Results ────────────────────────────────────
  function renderResults() {
    const project = state.activeProject;
    const grid = $('#ai-doc-section-grid');
    const title = $('#ai-doc-results-title');
    const summary = $('#ai-doc-results-summary');
    const status = $('#ai-doc-results-status');
    if (!grid) return;
    grid.innerHTML = '';
    if (!project) {
      title.textContent = '결과 없음';
      summary.textContent = '먼저 새 프로젝트를 생성하세요.';
      status.textContent = '-';
      return;
    }
    title.textContent = project.title;
    summary.textContent = (project.channel || '') + ' · ' + (project.sections ? project.sections.length : 0) + '장 · ' + (project.ratio || '9:16');
    status.textContent = project.status || '완료';

    (project.sections || []).forEach((section) => {
      grid.appendChild(buildSectionCard(section));
    });
  }

  function renderSection(section) {
    const existing = document.querySelector('[data-section-id="' + section.id + '"]');
    const card = buildSectionCard(section);
    if (existing) existing.replaceWith(card);
    else {
      const grid = $('#ai-doc-section-grid');
      if (grid) grid.appendChild(card);
    }
  }

  function buildSectionCard(section) {
    const card = document.createElement('div');
    card.className = 'ai-doc-section-card';
    card.setAttribute('data-section-id', section.id);

    const thumb = document.createElement('div');
    thumb.className = 'ai-doc-section-thumb' + (section.imageUrl ? '' : ' is-pending');
    if (section.imageUrl) {
      const img = document.createElement('img');
      img.src = section.imageUrl;
      img.alt = section.name;
      thumb.appendChild(img);
    }

    const meta = document.createElement('div');
    meta.className = 'ai-doc-section-meta';
    meta.innerHTML = '<strong></strong><span class="ai-doc-chip"></span>';
    meta.querySelector('strong').textContent = section.name;
    meta.querySelector('.ai-doc-chip').textContent = section.id;

    const purpose = document.createElement('div');
    purpose.className = 'ai-doc-section-purpose';
    purpose.textContent = section.purpose || '';

    const actions = document.createElement('div');
    actions.className = 'ai-doc-section-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'btn-secondary';
    editBtn.textContent = t('ai_doc_btn_edit');
    editBtn.setAttribute('data-i18n', 'ai_doc_btn_edit');
    editBtn.addEventListener('click', () => openEditModal(section.id));
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button'; dlBtn.className = 'btn-ghost';
    dlBtn.textContent = t('ai_doc_btn_download');
    dlBtn.setAttribute('data-i18n', 'ai_doc_btn_download');
    dlBtn.addEventListener('click', () => downloadSection(section));
    actions.appendChild(editBtn); actions.appendChild(dlBtn);

    card.appendChild(thumb);
    card.appendChild(meta);
    card.appendChild(purpose);
    card.appendChild(actions);
    return card;
  }

  function downloadSection(section) {
    if (!section.imageUrl) { toast('다운로드할 이미지가 없습니다.'); return; }
    const ext = (section.imageUrl.match(/^data:image\/(\w+)/) || [, 'png'])[1].replace('jpeg', 'jpg');
    const a = document.createElement('a');
    a.href = section.imageUrl;
    a.download = (state.activeProject && state.activeProject.title ? state.activeProject.title + '-' : '') + section.id + '.' + ext;
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function downloadAll() {
    const project = state.activeProject; if (!project) return;
    for (const s of project.sections) {
      if (s.imageUrl) {
        downloadSection(s);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
  }

  async function saveCurrent() {
    const p = state.activeProject; if (!p) { toast('저장할 프로젝트가 없습니다.'); return; }
    const saved = Object.assign({}, p, { savedAt: new Date().toISOString(), status: '저장됨' });
    try {
      await saveProjectToDb(saved);
      state.activeProject = saved;
      toast('프로젝트를 저장했습니다.');
      renderResults();
    } catch (e) {
      toast(e && e.message || '저장 실패');
    }
  }

  async function generateRemaining() {
    const project = state.activeProject;
    if (!project) { toast('먼저 프로젝트를 생성해주세요.'); return; }
    if (state.generating) { toast('생성 작업이 이미 진행 중입니다.'); return; }
    const existingIds = new Set(project.sections.filter((s) => s.imageUrl).map((s) => s.id));
    const remaining = SECTION_TEMPLATES.slice(0, 8).filter((t) => !existingIds.has(t.id));
    if (!remaining.length) { toast('이미 8장이 생성되어 있습니다.'); return; }
    if (!state.referenceDataUrls.length) {
      if (!state.files.length) {
        toast('원본 파일이 세션에 없습니다. 새 프로젝트로 다시 시작해주세요.');
        return;
      }
      state.referenceDataUrls = await prepareReferences(state.files);
    }

    state.generating = true;
    state.abortFlag = false;
    await fetchRagStats(true);
    const ragQuery = [
      '상세페이지 리디자인 CRO 지식',
      '판매 채널: ' + (project.channel || '스마트스토어'),
      '추가 요청사항: ' + (project.request || '전환율 중심 리디자인'),
    ].join('\n');
    const knowledgeText = await searchKnowledgeContext(ragQuery);
    const aspectRatio = project.ratio || '9:16';
    showProgress(remaining.length);

    try {
      for (let i = 0; i < remaining.length; i++) {
        if (state.abortFlag) break;
        const t = remaining[i];
        updateProgress(i, '섹션 생성 (' + t.name + ')');
        // ensure section exists in project
        let section = project.sections.find((s) => s.id === t.id);
        if (!section) { section = { id: t.id, name: t.name, purpose: t.purpose, source: t.source, imageUrl: '', prompt: '' }; project.sections.push(section); renderResults(); }
        markSectionLoading(t.id, true);
        const prompt = buildSectionPrompt(t, { channel: project.channel, request: project.request, ratio: aspectRatio, knowledge: knowledgeText });
        try {
          const resp = await callImagen({
            prompt,
            aspectRatio,
            provider: state.model === 'gemini' ? 'gemini' : 'openai',
            generationMode: 'image-to-image',
            referenceImages: state.referenceDataUrls.map((u, idx) => ({ referenceId: idx + 1, imageDataUrl: u })),
            imageSize: '1K',
            projectId: project.id, sessionId: 'ai-doc', storageService: 'ai-image',
          });
          const url = (resp && (resp.dataUrl || (resp.bytesBase64Encoded ? ('data:image/png;base64,' + resp.bytesBase64Encoded) : ''))) || '';
          if (!url) throw new Error('응답 비어 있음');
          section.imageUrl = url; section.prompt = prompt;
          markSectionLoading(t.id, false);
          renderSection(section);
        } catch (e) {
          markSectionLoading(t.id, false);
          toast(t.name + ' 생성 실패: ' + (e && e.message || ''));
          break;
        }
      }
      project.status = '완료';
      renderResults();
    } finally {
      hideProgress();
      state.generating = false;
    }
  }

  // ── Knowledge upload ───────────────────────────────────
  async function registerKnowledgeFiles(files) {
    const selected = Array.from(files || []).slice(0, 5);
    if (!selected.length) return;

    await fetchRagStats(true);
    const isAuthed = !!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed());
    const adminKey = (!isAuthed && ragState.adminRequired) ? getAdminKey() : '';
    if (!isAuthed && ragState.adminRequired && !adminKey) {
      toast('지식파일 등록용 운영자 키를 먼저 입력해주세요.');
      const input = $('#ai-doc-admin-key-input'); if (input) input.focus();
      return;
    }

    toast('지식파일 텍스트를 추출하는 중입니다…');
    const next = [];
    for (const f of selected) {
      try {
        let text = '';
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          text = await extractPdfText(f);
        } else if (f.type.startsWith('text/') || /\.(txt|md)$/i.test(f.name)) {
          text = await f.text();
        } else {
          continue;
        }
        if (!text.trim()) continue;

        // 서버 인덱싱 시도 (RAG 활성 시)
        let indexed = false;
        let documentId = '';
        let chunks = 0;
        let reason = '';
        if (NK.api && NK.api.knowledgeIndex) {
          try {
            const res = await NK.api.knowledgeIndex({ name: f.name, text, adminKey });
            if (res && res.indexed) {
              indexed = true; documentId = res.documentId; chunks = Number(res.chunks || 0);
            } else if (res && res.reason) {
              reason = String(res.reason);
            }
          } catch (e) {
            reason = (e && e.message) || '인덱싱 실패';
          }
        }

        next.push({
          id: f.name + '-' + f.size + '-' + Date.now() + '-' + Math.random().toString(16).slice(2),
          name: f.name,
          type: f.type || 'file',
          size: f.size,
          text: text.slice(0, 18000),
          createdAt: new Date().toISOString(),
          indexed,
          documentId,
          chunks,
          reason,
        });
      } catch (e) {
        toast(f.name + ' 처리 실패: ' + (e && e.message || ''));
      }
    }
    state.knowledge = [...next, ...state.knowledge].slice(0, 10);
    saveKnowledge(state.knowledge);
    await fetchRagStats(true);
    renderKnowledgeList();
    renderDashboard();
    const indexedCount = next.filter((k) => k.indexed).length;
    if (indexedCount) {
      toast(indexedCount + '개를 Neon RAG로 인덱싱했습니다.');
    } else if (next.length) {
      toast(next.length + '개 지식파일을 로컬 fallback으로 등록했습니다.');
    }
  }

  function renderKnowledgeList() {
    const list = $('#ai-doc-knowledge-list'); if (!list) return;
    list.innerHTML = '';
    state.knowledge.forEach((k) => {
      const row = document.createElement('div');
      row.className = 'ai-doc-knowledge-item';
      const left = document.createElement('span');
      left.innerHTML = '📄 ';
      const name = document.createElement('strong'); name.textContent = k.name; left.appendChild(name);
      const meta = document.createElement('span'); meta.className = 'muted';
      const sizeLabel = (k.text ? k.text.length.toLocaleString() : 0) + t('ai_doc_char_unit');
      const ragLabel = k.indexed ? ' · RAG ' + (k.chunks || 0) + ' chunks' : ' · ' + t('ai_doc_rag_inactive').split(' (')[0];
      meta.textContent = '  ' + sizeLabel + ragLabel;
      left.appendChild(meta);
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'btn-ghost';
      del.textContent = t('ai_doc_btn_delete');
      del.setAttribute('data-i18n', 'ai_doc_btn_delete');
      del.addEventListener('click', async () => {
        // 서버 RAG에서도 삭제 시도
        if (k.indexed && k.documentId && NK.api && NK.api.knowledgeDelete) {
          try {
            const _isAuthed = !!(NK.auth && NK.auth.isAuthed && NK.auth.isAuthed());
            await NK.api.knowledgeDelete({ documentId: k.documentId, adminKey: _isAuthed ? '' : getAdminKey() });
          } catch (e) {
            toast('서버 RAG 삭제 실패: ' + (e && e.message || '')); // UI는 계속 진행
          }
        }
        state.knowledge = state.knowledge.filter((x) => x.id !== k.id);
        saveKnowledge(state.knowledge);
        await fetchRagStats(true);
        renderKnowledgeList(); renderDashboard();
      });
      row.appendChild(left); row.appendChild(del);
      list.appendChild(row);
    });
  }

  // ── File list rendering (workspace) ─────────────────────
  function renderFileList() {
    const wrap = $('#ai-doc-file-list'); if (!wrap) return;
    wrap.innerHTML = '';
    if (!state.files.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    state.files.forEach((f, i) => {
      const pill = document.createElement('span');
      pill.className = 'ai-doc-file-pill';
      pill.innerHTML = '<span></span><button type="button" aria-label="삭제">✕</button>';
      pill.querySelector('span').textContent = (f.type === 'application/pdf' ? '📑 ' : '🖼 ') + f.name;
      pill.querySelector('button').addEventListener('click', () => {
        state.files.splice(i, 1);
        renderFileList();
      });
      wrap.appendChild(pill);
    });
  }

  // ── Modals ─────────────────────────────────────────────
  function bindModalCloseButtons() {
    $$('.ai-doc-modal-overlay [data-action="close"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        btn.closest('.ai-doc-modal-overlay').classList.add('hidden');
      });
    });
    $$('.ai-doc-modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
      });
    });
  }

  // ── Init ───────────────────────────────────────────────
  function bindEvents() {
    // sidebar nav
    $$('.sidebar .nav-item[data-ai-doc-view]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setView(el.getAttribute('data-ai-doc-view'));
      });
    });

    // dashboard buttons
    const newBtn = $('#ai-doc-new-project'); if (newBtn) newBtn.addEventListener('click', () => setView('workspace'));
    const settingsBtn = $('#ai-doc-open-settings'); if (settingsBtn) settingsBtn.addEventListener('click', () => show($('#ai-doc-settings-modal')));
    const kBtn = $('#ai-doc-open-knowledge'); if (kBtn) kBtn.addEventListener('click', async () => {
      await fetchRagStats(true);
      renderKnowledgeList();
      show($('#ai-doc-knowledge-modal'));
    });

    // Admin / access key inputs
    const adminInput = $('#ai-doc-admin-key-input');
    if (adminInput) {
      adminInput.value = getAdminKey();
      adminInput.addEventListener('input', (e) => setAdminKey(e.target.value));
    }
    const accessInput = $('#ai-doc-access-key-input');
    if (accessInput) {
      accessInput.value = getAccessKey();
      accessInput.addEventListener('input', (e) => setAccessKey(e.target.value));
    }

    // workspace
    const dropzone = $('#ai-doc-dropzone');
    const fileInput = $('#ai-doc-file-input');
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const files = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
        state.files = files.slice(0, 4);
        renderFileList();
      });
      fileInput.addEventListener('change', () => {
        state.files = Array.from(fileInput.files || []).slice(0, 4);
        renderFileList();
        fileInput.value = '';
      });
    }

    $('#ai-doc-request') && $('#ai-doc-request').addEventListener('input', (e) => { state.request = e.target.value; });
    $('#ai-doc-channel') && $('#ai-doc-channel').addEventListener('change', (e) => { state.channel = e.target.value; });
    $('#ai-doc-count') && $('#ai-doc-count').addEventListener('change', (e) => { state.count = Number(e.target.value) || 8; });
    $('#ai-doc-ratio') && $('#ai-doc-ratio').addEventListener('change', (e) => { state.ratio = e.target.value; });

    $$('.ai-doc-toggle-btn[data-shared]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.useShared = btn.getAttribute('data-shared') === 'on';
        $$('.ai-doc-toggle-btn[data-shared]').forEach((b) => b.classList.toggle('is-active', b === btn));
        try { localStorage.setItem(STORAGE.sharedToggle, String(state.useShared)); } catch (_) {}
      });
    });

    $$('.ai-doc-model-btn[data-model]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.model = btn.getAttribute('data-model') === 'gemini' ? 'gemini' : 'openai';
        $$('.ai-doc-model-btn[data-model]').forEach((b) => b.classList.toggle('is-active', b === btn));
        try { localStorage.setItem(STORAGE.lastModel, state.model); } catch (_) {}
      });
    });

    $('#ai-doc-generate') && $('#ai-doc-generate').addEventListener('click', startGeneration);
    $('#ai-doc-back-dashboard') && $('#ai-doc-back-dashboard').addEventListener('click', () => setView('dashboard'));

    // results
    $('#ai-doc-results-back') && $('#ai-doc-results-back').addEventListener('click', () => setView('dashboard'));
    $('#ai-doc-results-rest') && $('#ai-doc-results-rest').addEventListener('click', generateRemaining);
    $('#ai-doc-results-save') && $('#ai-doc-results-save').addEventListener('click', saveCurrent);
    $('#ai-doc-results-download') && $('#ai-doc-results-download').addEventListener('click', downloadAll);

    // knowledge modal
    const kDrop = $('#ai-doc-knowledge-dropzone');
    const kInput = $('#ai-doc-knowledge-input');
    if (kDrop && kInput) {
      kDrop.addEventListener('click', () => kInput.click());
      kInput.addEventListener('change', () => {
        registerKnowledgeFiles(kInput.files);
        kInput.value = '';
      });
    }

    // edit modal
    $('#ai-doc-edit-submit') && $('#ai-doc-edit-submit').addEventListener('click', submitSectionEdit);

    // progress cancel
    $('#ai-doc-progress-cancel') && $('#ai-doc-progress-cancel').addEventListener('click', () => {
      state.abortFlag = true;
      toast('현재 호출 중인 작업이 끝나면 중단됩니다.');
    });

    bindModalCloseButtons();
  }

  function applyInitialState() {
    try {
      const saved = localStorage.getItem(STORAGE.sharedToggle);
      if (saved !== null) state.useShared = saved === 'true';
    } catch (_) {}
    try {
      const m = localStorage.getItem(STORAGE.lastModel);
      if (m === 'gemini' || m === 'openai') state.model = m;
    } catch (_) {}
    state.knowledge = loadKnowledge();
    $$('.ai-doc-toggle-btn[data-shared]').forEach((b) => b.classList.toggle('is-active', (b.getAttribute('data-shared') === 'on') === state.useShared));
    $$('.ai-doc-model-btn[data-model]').forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-model') === state.model));
    const requestEl = $('#ai-doc-request'); if (requestEl) state.request = requestEl.value || '';
    const channelEl = $('#ai-doc-channel'); if (channelEl) state.channel = channelEl.value || '스마트스토어';
    const countEl = $('#ai-doc-count'); if (countEl) state.count = Number(countEl.value) || 8;
    const ratioEl = $('#ai-doc-ratio'); if (ratioEl) state.ratio = ratioEl.value || '9:16';
  }

  function readInitialView() {
    try {
      const params = new URLSearchParams(window.location.search);
      const v = params.get('view');
      if (v === 'workspace' || v === 'results' || v === 'dashboard') return v;
    } catch (_) {}
    return 'dashboard';
  }

  function hookI18n() {
    const common = NK.ui && NK.ui.common;
    if (!common || typeof common.applyI18n !== 'function') return;
    const _orig = common.applyI18n.bind(common);
    common.applyI18n = function (lang) {
      _orig(lang);
      reflectRagStatus();
      renderKnowledgeList();
      if (state.view === 'dashboard') renderDashboard().catch(() => {});
    };
  }

  function init() {
    if (!document.querySelector('.page-shell-ai-doc')) return;
    hookI18n();
    applyInitialState();
    bindEvents();
    setView(readInitialView());
    // 백그라운드에서 RAG 상태 조회 (Neon 활성화 여부)
    fetchRagStats(true).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // expose for debug
  NK.aiDoc = { state, setView };
})();
