# AI 문서 — Neon RAG 활성화 가이드 (사용자용)

이 가이드를 따라 **5단계**만 진행하면 AI 문서의 "Neon DB 기반 똑똑한 지식 검색"이 활성화됩니다.
**개발자 지식 없이도 클릭 위주로 가능합니다.** 약 15분 소요.

> ✅ **현재 상태**
> - 코드와 API는 모두 배포 완료된 상태입니다
> - 환경변수(`DATABASE_URL`)가 등록되는 순간 자동으로 활성화됩니다
> - 등록 전까지는 기존 "로컬 fallback" 방식으로 정상 동작합니다 (서비스 중단 없음)

---

## 📋 전체 흐름 한눈에 보기

```
1. Neon 가입 (3분)
       ↓
2. 무료 프로젝트 생성 + pgvector 활성화 (3분)
       ↓
3. 연결 문자열(DATABASE_URL) 복사 (1분)
       ↓
4. Cloudflare Pages 환경변수에 등록 (3분)
       ↓
5. 사이트 재배포 + 브라우저에서 확인 (5분)
```

---

## 1️⃣ Neon 가입 (3분)

1. https://neon.tech 접속
2. 우측 상단 **"Sign Up"** 클릭
3. **"Continue with GitHub"** 또는 **"Continue with Google"** 선택 (가장 빠름)
4. 약관 동의 후 가입 완료

> 💡 무료 플랜으로 시작하시면 됩니다. 신용카드 등록 불필요.

---

## 2️⃣ 프로젝트 생성 + pgvector 활성화 (3분)

### 2-1. 프로젝트 만들기
1. 로그인 후 자동으로 **"Create your first project"** 화면이 뜸
   - 안 뜨면 좌측 메뉴 **Projects → New Project** 클릭
2. 입력값:
   - **Project name**: `nk-studio` (자유)
   - **Database name**: `neondb` (기본값 그대로)
   - **Postgres version**: 16 (기본값 그대로)
   - **Region**: `AWS / Asia Pacific (Singapore)` 또는 가장 가까운 곳 선택
3. **Create project** 클릭

### 2-2. pgvector 확장 활성화

**방법 A — 자동 (권장, 아무것도 안 해도 됨)**
- 우리 코드가 첫 호출 시 `CREATE EXTENSION IF NOT EXISTS vector`를 자동 실행함
- **Neon 무료 플랜은 pgvector를 기본 지원하므로 대부분 자동 활성화됨**
- 5단계에서 확인 시 에러 없으면 OK

**방법 B — 수동 (자동 실패 시만)**
1. Neon 콘솔 좌측 메뉴 **SQL Editor** 클릭
2. 다음 한 줄 입력 후 **Run**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. 성공 메시지 확인 (`CREATE EXTENSION`)

---

## 3️⃣ 연결 문자열(DATABASE_URL) 복사 (1분)

1. Neon 콘솔 **Dashboard** 화면으로 이동
2. 중앙 또는 우측에 있는 **"Connection string"** 박스 찾기
3. **"Pooled connection"** 탭 선택 (중요! 일반 connection 아님)
4. 보여지는 문자열 형식:
   ```
   postgresql://neondb_owner:xxx****xxx@ep-cool-name-12345-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
5. **Show password** 토글을 켠 뒤 우측 복사 버튼 🗐 클릭

> ⚠️ **꼭 "Pooled connection"으로 복사하세요.** Cloudflare 서버리스 환경에서 안정적입니다.
> 일반 connection을 쓰면 동시 요청 많을 때 연결 한도 초과 위험.

> ⚠️ 이 문자열에는 비밀번호가 포함되어 있으므로 **절대 외부에 노출되지 않도록 주의**하세요.

---

## 4️⃣ Cloudflare Pages 환경변수 등록 (3분)

1. https://dash.cloudflare.com 접속 후 로그인
2. 좌측 메뉴 **Workers & Pages** 클릭
3. 프로젝트 목록에서 **`nk-ai-studio`** (또는 본인 프로젝트 이름) 클릭
4. 상단 탭 **Settings** 클릭
5. 좌측 메뉴 **Environment variables** 클릭

### 4-1. 필수 환경변수 추가

**Production** 환경에 다음을 추가합니다 (각각 **Add variable** 클릭):

| Variable name | Value | 비고 |
|---|---|---|
| `DATABASE_URL` | (3단계에서 복사한 문자열 전체) | 🔒 **Encrypt** 체크 (필수) |
| `KNOWLEDGE_ADMIN_KEY` | `nk-admin-2026` (또는 본인이 정한 비밀번호) | 🔒 **Encrypt** 체크 |

> **`KNOWLEDGE_ADMIN_KEY`란?**
> 지식파일 등록/삭제 권한을 가진 비밀번호입니다. 운영자(=본인)만 알아야 합니다.
> 위 예시값을 그대로 써도 되지만 **본인만의 비밀번호로 바꾸시는 것을 권장**합니다.
> 이 값은 나중에 AI 문서 페이지의 "지식파일 등록" 모달에 입력하게 됩니다.

### 4-2. (선택) 사용자 접근 제한

여러 사용자가 동시에 RAG를 쓰고 일부에게만 접근 권한을 주려면:

| Variable name | Value | 비고 |
|---|---|---|
| `KNOWLEDGE_ACCESS_KEYS` | `user1-key,user2-key` (쉼표로 구분) | 🔒 **Encrypt** 체크 |

생략 시 로그인한 모든 사용자가 RAG 검색 사용 가능.

### 4-3. 기존 환경변수 확인 (이미 설정되어 있어야 함)

다음은 이미 등록되어 있을 것입니다. 누락 시 추가:
- `OPENAI_API_KEY` (필수 — 임베딩 생성에 사용)

> ⚠️ Preview 환경(Preview) 변수에도 같은 값을 넣으면 미리보기 배포에서도 RAG를 쓸 수 있습니다. 운영만 쓸 거면 Production만 추가하면 됩니다.

---

## 5️⃣ 재배포 + 동작 확인 (5분)

### 5-1. 재배포 트리거
환경변수 추가 후에는 **재배포가 필요**합니다.

**방법 A — 클릭 한 번 (가장 쉬움)**
1. 같은 Cloudflare 화면에서 상단 탭 **Deployments** 클릭
2. 가장 최근 Production 배포 옆 **... (점 3개)** 메뉴 클릭
3. **Retry deployment** 클릭

**방법 B — 자동 재배포 대기**
- 다음에 GitHub에 푸시가 일어나면 자동 재배포됨 (그때까지 기다리기)

배포 완료까지 약 2-3분 소요. **Deployments** 탭에서 "Active" 상태 확인.

### 5-2. 동작 확인 (브라우저)
1. 사이트(예: `https://nkstudio.org`) 접속 → 로그인
2. 상단 **AI 문서** 메뉴 클릭
3. **대시보드** 화면에서 우측 **"사전 지식 라이브러리"** 카드 확인
   - 정상: **"Neon RAG 활성 (0 chunks)"** 칩 표시
   - 비정상: **"로컬 fallback (RAG 미설정)"** → 환경변수 등록 또는 재배포 누락
4. 상단 **"지식파일 등록"** 버튼 클릭
   - 모달 상단 칩에 **"서버 RAG 활성"** 표시
   - **"운영자 등록 키"** 입력란이 나타남 → 4-1에서 정한 `KNOWLEDGE_ADMIN_KEY` 값 입력
5. 테스트 PDF 또는 TXT 한 개 업로드
6. 토스트에 **"1개를 Neon RAG로 인덱싱했습니다"** 표시되면 성공 ✅
7. 등록 항목 옆에 **"RAG N chunks"** 라벨 확인

---

## 🎉 완료 후 사용 방법

이후로는 **AI 문서 생성 시 자동으로 RAG가 동작**합니다:
1. 워크스페이스에서 상세페이지 원본 업로드
2. "공통 사전 지식 사용 — 사용" 토글 ON (기본값)
3. **리디자인 생성** 클릭
4. 백그라운드에서 RAG가 등록된 지식파일 중 관련 청크 8개를 자동 검색해 프롬프트에 첨부

---

## 🔧 문제 해결 (Troubleshooting)

### Q1. "Neon RAG 활성" 칩이 안 보임
- 환경변수 `DATABASE_URL`이 등록되어 있는지 확인
- 재배포가 완료되었는지 확인 (Deployments 탭)
- 브라우저 강제 새로고침 (Ctrl+Shift+R)

### Q2. 지식파일 업로드 시 "permission denied to create extension vector" 에러
- pgvector 자동 활성화 실패. **2-2 방법 B**를 수동으로 실행

### Q3. 지식파일 업로드 시 "OpenAI Embeddings 호출 실패"
- Cloudflare 환경변수에 `OPENAI_API_KEY`가 등록되어 있는지 확인
- 키가 만료되었거나 결제 한도 초과 가능성 — OpenAI 대시보드 확인

### Q4. "DATABASE_URL이 잘못되었습니다" 같은 에러
- 3단계에서 **Pooled connection**이 아닌 일반 connection을 복사했을 가능성
- Neon 콘솔 → Connection string → **Pooled connection** 탭에서 다시 복사

### Q5. 비용이 걱정됩니다
- **Neon 무료 플랜**: 0.5GB 저장, 100시간 컴퓨트/월 — PDF 200~300페이지까지 무료
- **OpenAI Embeddings**: 1만 자 인덱싱 ≈ $0.0001 (천 개 등록해도 1달러 미만)
- **검색**: 매 생성마다 1회 검색 ≈ $0.0001 — 사실상 무료

---

## 📞 막힐 때

각 단계의 스크린샷을 찍어서 알려주시면 어디서 막혔는지 같이 진단해드리겠습니다.

특히 다음 정보가 도움됩니다:
- Neon 콘솔 Dashboard 화면 캡처
- Cloudflare Environment variables 화면 캡처 (값은 가린 채)
- AI 문서 페이지 "사전 지식 라이브러리" 카드 캡처
- 브라우저 개발자 도구 Console 탭의 빨간 에러 메시지
