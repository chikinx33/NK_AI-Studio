# AI 문서 (상세페이지 리디자인 마법사) 통합 계획

## 출처
- 원본 깃허브: https://github.com/IrumHahn/redesign-maker-10
- 로컬 사본: `_external/redesign-maker-10/` (분석 전용, 빌드 대상 아님)
- 원본 스택: Next.js 15 + React + TypeScript + Tailwind
- 우리 스택: 순수 HTML/CSS/Vanilla JS + Cloudflare Pages Functions (`prototype/functions/api/*.ts`)

## 목표
원본의 "상세페이지 리디자인 마법사" 기능을 우리 프로젝트의 디자인 컨셉/UI/스타일로 재구현한다.
- 메뉴: 랜딩 페이지 상단 가장 오른쪽 비활성 슬롯 `icon-ai-doc.png` 활성화, 라벨 **"AI 문서"**
- 페이지: `prototype/ai-doc.html` + `prototype/js/ui/ai-doc.js`
- 우리 사이드바/테마 토글/언어 토글/로그인 게이트 포함

## 기능 명세 (원본 기준)

### 화면 구성 — 3 view
1. **Dashboard** — 최근 프로젝트 목록, API 키 설정 진입, 지식파일 등록 진입, 새 프로젝트 생성
2. **Workspace** — 이미지/PDF 업로드, 채널·장수·비율 설정, 모델 선택(OpenAI/Google), 추가 요청사항, 공통 지식 사용 토글, 생성 버튼
3. **Results** — 섹션 카드(이미지·프롬프트·수정 요청), 섹션별 재생성/수정, 다운로드, 저장(IndexedDB), 나머지 섹션 일괄 생성

### 부가 모달
- **API 키 설정** — OpenAI/Google API 키(localStorage)
- **지식파일 등록** — PDF/TXT/MD 업로드 후 RAG 인덱싱
- **생성 진행 패널** — 진행률·예상 시간·팁

### 8개 기본 섹션 템플릿
S1 히어로, S2 문제 공감, S3 베네핏 3개, S4 USP 차별점, S5 근거/신뢰, S6 사용법, S7 후기 카드, S8 FAQ/오퍼
(추가로 S9 비교/보증, S10 최종 CTA 까지 최대 10장)

### 클라이언트 측 처리
- PDF → PNG 변환: `pdfjs-dist` (CDN으로 로드 예정)
- 긴 이미지 자동 슬라이스 (세로 > 가로*2.2)
- 이미지 압축 (수정 요청용)
- IndexedDB 프로젝트 저장 (`hanirum-redesign-projects` → 우리는 `nk-ai-doc-projects`로 리네이밍)
- localStorage 키 prefix: `hanirum-` → `nk_ai_doc_`

### 안전·브랜드 규칙 (프롬프트에 항상 포함)
- 근거 없는 수치/리뷰/인증/효과 금지
- "한이룸" 등 출처 브랜드 단어를 제품명/로고로 사용 금지
- 원본 이미지의 제품 브랜드명만 사용, 새 브랜드/로고 생성 금지

---

## API 매핑 — 재사용 vs 신규

| 원본 API | 우리 API | 재사용 가능? | 비고 |
|---|---|---|---|
| `POST /api/generate` (multipart, 이미지 N장 생성) | `POST /api/imagen` (OpenAI Image Edits + Gemini, 레퍼런스 이미지 지원) | ✅ 재사용 | 클라이언트에서 섹션별로 1장씩 N번 호출. 프롬프트는 클라이언트에서 조립 |
| `POST /api/edit-section` (단일 섹션 수정) | `POST /api/imagen` (referenceImages로 image-to-image) | ✅ 재사용 | 동일 |
| 분석 (analyzeSource — 멀티 이미지 → JSON) | `POST /api/imagen-describe` (단일 이미지 → 텍스트) | ⚠️ 부분 재사용 | 1차 구현에서는 단일 이미지 분석으로 시작. 필요 시 확장 |
| `GET/POST/DELETE /api/knowledge` (RAG + Neon pgvector) | **없음** | ❌ 신규 필요 | 1차 구현은 로컬 fallback만 |
| `GET /api/config` (서버 상태) | **없음** | ❌ 신규 필요(선택) | 1차 구현은 클라이언트 상수 |
| `POST /api/client-log` (클라 로그) | **없음** | — | 1차 구현은 console.log |

### 인증
우리 `/api/imagen`는 Bearer 토큰 인증 필요(`authorizeRequest`). 우리 페이지는 로그인된 사용자에게만 노출되므로 동일 패턴 적용.

### 원본의 "사용자 입력 API 키" vs 우리의 "서버 환경변수 키"
원본은 **사용자가 입력한 OpenAI/Google 키**로 호출하지만, 우리는 **서버 환경변수**(`OPENAI_API_KEY`, `GOOGLE_API_KEY`)를 사용한다.
- 우리 UI에는 사용자 키 입력 폼을 두지 않는다(또는 "고급 옵션"으로 숨김)
- `/api/imagen`는 환경변수 키 사용 — 추가 변경 불필요

---

## 사용자에게 보고할 누락 항목 (질문 필요)

다음 API/리소스는 우리 프로젝트에 **없으며**, 본격 통합 시 추가 필요:

1. **`/api/knowledge` (RAG 인덱싱·검색)**
   - 원본은 Neon Postgres + pgvector + OpenAI embeddings(`text-embedding-3-small`) 사용
   - 우리는 Neon DB 미사용. **결정 필요**:
     - (a) Neon Postgres 신규 도입 → DATABASE_URL 환경변수 추가
     - (b) Cloudflare D1 / Workers AI Embeddings로 대체 (비용·구조 변경)
     - (c) 1차 구현은 RAG 없이 **로컬 fallback**만 (사용자가 업로드한 텍스트를 그대로 프롬프트에 첨부, 최대 60KB)
   - **1단계~3단계까지는 (c) 로컬 fallback으로 진행**, 4단계에서 사용자 결정 요청
2. **`/api/config` (서버 상태)** — 1차에서는 클라이언트 상수로 대체 (RAG 미설정 표시)
3. **`/api/client-log`** — `console.log`로 충분
4. **다중 이미지 → JSON 분석** — `imagen-describe.ts`는 단일 이미지 텍스트 응답. 필요 시 신규 엔드포인트(`/api/ai-doc/analyze`) 또는 `imagen-describe.ts` 확장 결정

### 환경변수 (이미 우리 환경에 설정되어 있어야 함)
- `OPENAI_API_KEY` ✅ (기존 사용)
- `GOOGLE_API_KEY` ✅ (기존 사용)
- `GEMINI_IMAGE_MODEL` (기본값 `gemini-3.1-flash-image-preview`) — 선택
- `OPENAI_IMAGE_MODEL` (기본값 `gpt-image-2`) — 선택

추가로 검토 필요한 키 (4단계용, RAG 활성화 시):
- `DATABASE_URL` — Neon Postgres 도입 시
- `KNOWLEDGE_ACCESS_KEYS` — 사용자별 사전 지식 접근 키
- `KNOWLEDGE_ADMIN_KEY` — 지식 등록·삭제 권한 키

---

## 단계별 구현 계획 (체크리스트)

### 단계 1 — 랜딩 메뉴 활성화 + 페이지 셸 (이번 작업)
- [ ] `prototype/index.html`의 비활성 `icon-ai-doc.png`를 `<a href="ai-doc.html" class="login-icon-link">`로 변경, 라벨 "AI 문서" 추가
- [ ] `prototype/ai-doc.html` 생성 — 우리 표준 사이드바·테마 토글 포함
- [ ] `prototype/styles.ai-doc.css` 생성 — 우리 변수(`--panel`, `--border`, `--muted`) 사용
- [ ] `prototype/js/ui/ai-doc.js` 생성 — 빈 셸 + 3-view 라우팅 골격

### 단계 2 — 생성 흐름 (Dashboard → Workspace → Results)
- [ ] Workspace: 파일 업로드, 채널/장수/비율/모델/요청 입력
- [ ] PDF → PNG 변환: `pdfjs-dist` CDN 로드
- [ ] 클라이언트에서 섹션별 프롬프트 조립 → `/api/imagen` 호출(섹션당 1회)
- [ ] 생성 진행 패널 (퍼센티지·팁 로테이션)
- [ ] Results: 8장 갤러리, 다운로드, 프로젝트 IndexedDB 저장
- [ ] Dashboard: 최근 프로젝트 목록(IndexedDB에서 로드)

### 단계 3 — 섹션 편집 + 추가 기능
- [ ] 섹션별 "수정 요청" 모달 → `/api/imagen` (referenceImages로 image-to-image)
- [ ] 섹션 수정 이력(revisions) 관리
- [ ] "나머지 섹션 일괄 생성" (히어로 검토 후)
- [ ] "API 키 설정" 모달 — 서버 키 사용 시 안내 메시지로 대체
- [ ] 생성 취소 (AbortController)

### 단계 4 — 지식파일 / RAG (사용자 결정 필요)
- [ ] 지식파일 업로드 UI (PDF/TXT/MD)
- [ ] **1차**: 로컬 fallback (텍스트만 추출해 프롬프트에 첨부)
- [ ] **2차** (사용자 결정 후): `/api/knowledge` 신규 구현 — Neon pgvector 또는 대체 솔루션
- [ ] Knowledge stats 표시 (RAG 활성화 시)

---

## 디자인 적용 원칙
1. 색상: `--panel`, `--border`, `--muted`, `--text` 등 우리 CSS 변수만 사용 (Tailwind 클래스 사용 금지)
2. 폰트: Space Grotesk (우리 표준)
3. 사이드바: 다른 페이지(`ai-image.html`, `brand.html`)와 동일 구조 — 브랜드 마크, nav, 푸터 토글
4. 버튼: `.btn-primary`, `.btn-secondary`, `.btn-ghost` 기존 클래스 재사용
5. 카드: `.card` + 페이지별 모디파이어(`.ai-doc-card` 등)
6. 토스트: 우리 기존 토스트 패턴 사용 (있으면 재사용, 없으면 신규 작은 컴포넌트)
7. 다국어: `data-i18n` 속성으로 한국어/영문 토글 지원
8. 다크/라이트: 우리 테마 토글 그대로 작동 (CSS 변수 기반)

## 페이지 라우팅 / URL
- `ai-doc.html` — 기본 진입(Dashboard)
- `ai-doc.html?view=workspace` — 새 프로젝트
- `ai-doc.html?view=results&id={projectId}` — 결과 보기
- IndexedDB DB명: `nk-ai-doc-projects`, store: `projects`
- localStorage prefix: `nk_ai_doc_`

## 비고
- 원본의 `한이룸의 상세페이지 리디자인 마법사 1.0` 텍스트와 "HR" 마크는 모두 우리 브랜드 표기로 교체 ("NK Studio · AI 문서")
- 원본의 한이룸 유튜브 카드(7개)는 제거 (브랜드 종속)
- 원본의 `commerceTips` 12개는 보존 — CRO 일반 지식이라 재사용 가치 있음
