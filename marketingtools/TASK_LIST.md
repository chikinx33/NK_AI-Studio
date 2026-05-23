# 마케팅 AI 에이전트 팀 구축 — 따라하기 가이드

> 빌더 조쉬 유튜브 영상 ([링크](https://www.youtube.com/watch?v=6MJ-pmckowQ)) 기반
> **이 한 파일만 보고 따라하면 본인 브랜드의 마케팅 자동화 시스템을 만들 수 있습니다.**

---

## 🎯 이 가이드 사용법

1. **순서대로 진행하세요** — Phase 0 → Phase 1 → ... → Phase 8
2. **체크박스로 진행 상황을 표시하세요** — `- [ ]` → `- [x]`
3. **`복붙용 프롬프트` 박스의 내용은 Claude Code에 그대로 입력하면 됩니다**
4. **`[대괄호]` 부분은 본인 정보로 교체하세요** — 예: `[브랜드명]` → 본인 회사명
5. 모르겠는 부분이 있으면 Phase 별 **💡 팁** 섹션을 확인하세요

---

## 📌 전체 작업 개요 (9단계)

영상에서는 클로드 코드(Claude Code) 셋업에 **95%의 시간**을 쓰라고 강조합니다.
실행보다 **사전 준비(컨텍스트·스킬·에이전트 세팅)** 가 훨씬 중요합니다.

| Phase | 단계 | 무엇을 하는지 |
|-------|------|-------------|
| **0** | 🎨 본인 브랜드 정보 정리 | 시작 전 필요한 정보 수집 |
| **1** | 📁 폴더 구조 만들기 | 맥락을 담을 그릇 짓기 |
| **2** | 📚 컨텍스트 작성 | 브랜드 정보를 MD로 |
| **3** | 🎨 템플릿 작성 | 디자인 규칙 정리 |
| **4** | 📜 CLAUDE.md 작성 | 표준 업무 규약(SOP) |
| **5** | 🔌 스킬 & MCP 설치 | 외부 도구 연결 |
| **6** | 🤖 서브 에이전트 팀 구성 | 4단계 파이프라인 |
| **7** | 🧪 첫 콘텐츠 테스트 | 실제로 만들어보기 |
| **8** | 📲 자동 배포 (Buffer) | SNS 예약 포스팅 |

---

## ✅ Phase 0: 본인 브랜드 정보 정리

> **이 Phase가 가장 중요합니다.** AI는 도구일 뿐, 결과를 결정하는 건 **맥락(컨텍스트)** 입니다.
> 본인 브랜드 정보가 명확할수록 결과물 품질이 올라갑니다.

### Task 0.1 — 브랜드 기본 정보 정리

다음 정보를 메모장이나 종이에 미리 정리해두세요:

- [ ] **브랜드명** (회사/개인 채널명) — 예: `마이브랜드`
- [ ] **한 줄 소개** — "[누구]를 위한 [무엇]을 하는 [어떤] 브랜드"
- [ ] **웹사이트 URL** (있다면)
- [ ] **SNS 채널** (인스타, 링크드인, 유튜브 등)
- [ ] **뉴스레터 URL** (있다면)

### Task 0.2 — 비즈니스 정보 정리

- [ ] **타겟 고객** — 누가 우리 콘텐츠를 보길 원하는지
- [ ] **고객 페인포인트** — 그들이 해결하고 싶은 문제 3가지
- [ ] **주요 서비스/제품** — 우리가 파는 것
- [ ] **경쟁사 대비 차별점** — 왜 우리인지

### Task 0.3 — 디자인 정보 정리

- [ ] **브랜드 컬러** — 메인 컬러 + 보조 컬러 1-2개 (HEX 코드)
- [ ] **폰트** — 한글 폰트 / 영문 폰트
- [ ] **로고 파일** — PNG 또는 SVG (배경 투명 권장)
- [ ] **레퍼런스 디자인 이미지** — 좋아하는 카드뉴스/썸네일 스크린샷 (Pinterest 등)

### Task 0.4 — API 키 발급 준비

- [ ] **Google AI Studio 계정** — https://aistudio.google.com/ (Gemini 이미지 생성용)
- [ ] **Buffer 계정** — https://buffer.com/ (SNS 자동 포스팅, 선택)
- [ ] **결제 카드 준비** — API 무료 등급은 품질 제한 있음

**💡 팁:** 본인 웹사이트가 있다면 스크린샷 1-2장만 캡처해두면 됩니다.
다음 단계에서 Claude가 자동으로 분석해서 컨텍스트 파일을 생성해줍니다.

---

## ✅ Phase 1: 폴더 구조 만들기

> 맥락(컨텍스트)을 담을 "정리된 책장"을 만드는 단계입니다.

### Task 1.1 — 프로젝트 폴더 생성

```bash
# 원하는 위치에 프로젝트 폴더를 만들고 이동
mkdir my-marketing-team
cd my-marketing-team
```

### Task 1.2 — 기본 폴더 구조 생성

Claude Code를 실행한 뒤 아래 프롬프트를 그대로 복붙하세요:

> **📋 복붙용 프롬프트:**
> ```
> 마케팅 AI 에이전트 팀 프로젝트를 시작하려고 해.
> 다음 폴더 구조를 만들어줘:
> - context/ (브랜드 맥락 저장용)
> - templates/ (디자인 템플릿 저장용)
> - output/ (최종 결과물 저장용)
> - .claude/agents/ (서브 에이전트 정의 파일용)
> ```

### Task 1.3 — 폴더 생성 확인

- [ ] `context/` 폴더 생성됨
- [ ] `templates/` 폴더 생성됨
- [ ] `output/` 폴더 생성됨
- [ ] `.claude/agents/` 폴더 생성됨

**💡 왜 폴더를 나누나요?**
AI가 우리 정보를 빠르게 찾을 수 있도록 "정리된 책장"을 만드는 것과 같습니다.
AI는 **MD 파일(마크다운)** 을 가장 잘 읽기 때문에 모든 정보를 MD로 저장합니다.

---

## ✅ Phase 2: 컨텍스트 작성 (3개 MD 파일)

> Phase 0에서 정리한 본인 브랜드 정보를 MD 파일로 만드는 단계입니다.

### Task 2.1 — brand-guideline.md 작성

> **📋 복붙용 프롬프트:**
> ```
> context/brand-guideline.md 파일을 만들어줘.
> 아래 정보를 바탕으로 브랜드 가이드라인을 작성해줘:
>
> - 브랜드명: [본인 브랜드명]
> - 한 줄 소개: [Phase 0.1에서 정리한 내용]
> - 채널 정의: [어떤 채널인지]
> - 보이스 톤: [예: 친근한 / 전문가 / 권위 있는]
> - 카피라이팅 키워드: [브랜드를 대표하는 단어 5개]
> - 금지 표현: [절대 쓰지 말아야 할 표현]
> ```

작성된 `context/brand-guideline.md`에 포함되어야 하는 섹션:

- [ ] 브랜드 정체성 (한 줄 정의)
- [ ] 보이스 톤 (어떻게 말하는지)
- [ ] 핵심 키워드 (자주 쓰는 단어)
- [ ] 금지 표현 (쓰지 말아야 할 단어)
- [ ] 카피라이팅 예시 (좋은 예 / 나쁜 예)

### Task 2.2 — business-context.md 작성

> **📋 복붙용 프롬프트:**
> ```
> context/business-context.md 파일을 만들어줘.
> 아래 정보를 바탕으로 비즈니스 컨텍스트를 작성해줘:
>
> - 타겟 고객: [Phase 0.2 내용]
> - 고객 페인포인트: [3가지]
> - 주요 서비스: [우리가 파는 것]
> - 차별점: [경쟁사 대비]
> - 비즈니스 목표: [성장 목표 또는 핵심 KPI]
> ```

작성된 `context/business-context.md`에 포함되어야 하는 섹션:

- [ ] 타겟 페르소나 (구체적인 한 사람처럼)
- [ ] 페인포인트 3가지
- [ ] 서비스/제품 라인
- [ ] 차별화 포인트
- [ ] 비즈니스 목표

### Task 2.3 — design-style-guide.md 작성

> **📋 복붙용 프롬프트:**
> ```
> context/design-style-guide.md 파일을 만들어줘.
> 아래 정보를 바탕으로 디자인 스타일 가이드를 작성해줘:
>
> - 브랜드 컬러: [메인 #코드], [보조 #코드]
> - 한글 폰트: [예: Pretendard]
> - 영문 폰트: [예: Inter]
> - 디자인 스타일: [미니멀 / 화려한 / 에디토리얼 등]
> - 레이아웃 규칙: [여백 많이 / 빽빽하게 등]
> - 금지 사항: [절대 쓰지 말아야 할 디자인 요소]
> ```

작성된 `context/design-style-guide.md`에 포함되어야 하는 섹션:

- [ ] 컬러 팔레트 (HEX 코드)
- [ ] 타이포그래피 규칙
- [ ] 레이아웃 원칙
- [ ] 이미지 스타일
- [ ] 디자인 금지 사항

**💡 팁:** 본인 웹사이트 스크린샷이 있다면 이렇게 한번에 만들 수도 있어요:
> ```
> [웹사이트 스크린샷 첨부하면서]
> 이 웹사이트를 분석해서 context/ 폴더 안에
> brand-guideline.md, business-context.md, design-style-guide.md
> 3개 파일을 자동으로 만들어줘.
> ```

---

## ✅ Phase 3: 템플릿 작성 (디자인 규칙)

> 각 산출물(카드뉴스, PPT 등)의 구조와 디자인 규칙을 정리하는 단계입니다.

### Task 3.1 — 레퍼런스 이미지 수집

- [ ] 좋아하는 카드뉴스 디자인 2-3장 (`templates/card-news-ref.png`)
- [ ] 좋아하는 PPT 디자인 1-2장 (`templates/ppt-ref.png`)
- [ ] 좋아하는 썸네일 디자인 2-3장 (`templates/thumbnail-ref.png`)

### Task 3.2 — 템플릿 MD 파일 4종 작성

> **📋 복붙용 프롬프트:**
> ```
> templates/ 폴더에 디자인 템플릿 4개를 만들어줘:
> 1. card-news-template.md (카드뉴스 구조/규칙)
> 2. ppt-template.md (PPT 슬라이드 구조)
> 3. newsletter-template.md (뉴스레터 8개 섹션)
> 4. thumbnail-template.md (유튜브 썸네일 패턴)
>
> 각 템플릿은 context/design-style-guide.md를 참조해서
> 우리 브랜드에 맞게 작성해줘.
> 첨부한 레퍼런스 이미지의 디자인 패턴도 분석해서 반영해줘.
> ```

각 템플릿에 포함되어야 하는 내용:

- [ ] **card-news-template.md** — 카드별 구조, 카피 패턴, 디자인 규칙
- [ ] **ppt-template.md** — 슬라이드 종류별 구조, 타이포 규칙
- [ ] **newsletter-template.md** — 8개 섹션 구성, 톤
- [ ] **thumbnail-template.md** — 후킹 패턴, 타이포 크기, 색상 규칙

**💡 중요:** 이미지를 매번 읽으면 토큰 소모가 큽니다.
이미지를 Claude에게 한 번 분석시킨 뒤 **MD 파일로 텍스트화** 하세요.
앞으로는 MD만 참조하면 되니 효율적입니다.

---

## ✅ Phase 4: CLAUDE.md 작성 (표준 업무 규약)

> 신입사원(AI)에게 "우리 회사는 이렇게 일합니다"라고 알려주는 매뉴얼을 만드는 단계입니다.

### Task 4.1 — CLAUDE.md 자동 생성

프로젝트 루트(가장 바깥 폴더)에 `CLAUDE.md` 파일을 만듭니다.

> **📋 복붙용 프롬프트:**
> ```
> 프로젝트 루트에 CLAUDE.md 파일을 만들자.
> 전체 프로젝트의 폴더를 스캔해서 맥락을 파악하고
> 마케팅 AI 에이전트 팀에 걸맞는 SOP(표준 업무 규약) 문서로 생성해줘.
>
> 다음 섹션을 포함해줘:
> 1. 프로젝트 개요
> 2. 브랜드 핵심 정보 요약 (context/brand-guideline.md 참조)
> 3. 폴더 구조 설명
> 4. 작업 라우팅 규칙 (어떤 작업에 어떤 파일을 참조할지)
> 5. 에이전트 파이프라인 (research → content → design → review)
> 6. 산출물 저장 규칙 (output/ 폴더 컨벤션)
> 7. 절대 규칙 (해야 하는 것 / 하지 말아야 하는 것)
> ```

### Task 4.2 — CLAUDE.md 내용 확인

- [ ] 프로젝트 개요가 명확한가
- [ ] 우리 브랜드 핵심이 잘 요약되어 있는가
- [ ] 폴더 구조 설명이 정확한가
- [ ] 작업 라우팅 규칙이 명확한가 ("카드뉴스 만들어줘"라고 했을 때 어떤 파일들을 참조할지)
- [ ] 에이전트 파이프라인이 그려져 있는가
- [ ] 절대 규칙 섹션이 있는가

**💡 비유:** CLAUDE.md는 회사의 **SOP(표준 업무 규약)** 와 같습니다.
이 문서가 잘 작성되어 있으면 매번 같은 설명을 반복할 필요가 없습니다.

---

## ✅ Phase 5: 스킬 & MCP 설치

> 외부 도구를 연결하는 단계입니다. PPT/PDF 생성, 이미지 생성 등이 가능해집니다.

### Task 5.1 — Anthropic 공식 스킬 설치

> **📋 복붙용 프롬프트:**
> ```
> Anthropic 공식 스킬 저장소를 플러그인 마켓플레이스에 추가해줘.
> URL: https://github.com/anthropics/skills
> 그리고 document-skills를 설치해줘 (PPTX, PDF, DOCX 포함).
> ```

설치 확인:

- [ ] 플러그인 마켓플레이스에 URL 추가됨
- [ ] `document-skills` 설치됨
- [ ] `/skill` 명령어로 사용 가능한 스킬 확인됨

**💡 왜 설치하나요?**
AI가 PPT/PDF를 임의로 만드는 게 아니라 **공식 표준 형식**으로 정확하게 생성하도록 도와줍니다.

### Task 5.2 — Nano Banana (Gemini 이미지) MCP 설치

#### Step 1. Google AI Studio에서 API 키 발급

- [ ] https://aistudio.google.com/ 접속
- [ ] Google 계정으로 로그인
- [ ] `Get API Key` 클릭
- [ ] 새 프로젝트 만들고 API 키 발급
- [ ] 결제 계정 설정 (Pay-as-you-go 권장)

#### Step 2. .env 파일 생성

> **📋 복붙용 프롬프트:**
> ```
> 프로젝트 루트에 .env 파일과 .env.example 파일을 만들어줘.
> .env에는 다음 변수를 비워둔 채로 만들고:
> GEMINI_API_KEY=
> BUFFER_API_KEY=
>
> .env.example에는 같은 구조에 예시 값을 넣어줘.
> 그리고 .gitignore에 .env를 추가해줘 (API 키 보안).
> ```

API 키 입력:

- [ ] `.env` 파일 열기
- [ ] `GEMINI_API_KEY=` 뒤에 발급받은 키 붙여넣기
- [ ] 파일 저장

#### Step 3. Nano Banana MCP 설치

> **📋 복붙용 프롬프트:**
> ```
> Nano Banana MCP (Gemini 이미지 생성) 를 설치해줘.
> .env 파일의 GEMINI_API_KEY를 사용하도록 설정해줘.
> ```

설치 확인:

- [ ] `claude mcp list` 명령어로 `nano-banana` 표시됨
- [ ] `/mcp` 명령어로 정상 작동 확인

**⚠️ 보안 주의:**
- API 키는 절대 GitHub에 올리거나 공유하지 마세요
- `.gitignore`에 `.env` 추가 필수
- 실수로 키를 노출했다면 즉시 Google AI Studio에서 키를 재발급하세요

---

## ✅ Phase 6: 서브 에이전트 팀 구성

> 4단계 파이프라인으로 작동하는 마케팅 팀을 만드는 단계입니다.

### Task 6.1 — 4단계 파이프라인 이해

```
[리서치] → [콘텐츠] → [디자인] → [검수]
   ↓          ↓          ↓         ↓
research → content → design → review
```

- **리서치 에이전트** — 주제 조사, 통계, 사례 수집
- **콘텐츠 에이전트** — 카피라이팅, 본문 작성 (브랜드 톤 적용)
- **디자인 에이전트** — 이미지/PPT 생성 (스타일 가이드 적용)
- **검수 에이전트** — 브랜드 톤·디자인 일관성·오탈자 체크

### Task 6.2 — 에이전트 4종 자동 생성

> **📋 복붙용 프롬프트:**
> ```
> 클로드 코드의 공식 가이드라인에 따라 서브에이전트 4개를 만들어줘.
> 리서치 → 콘텐츠 → 디자인 → 검수 4단계 파이프라인으로 구성하고
> .claude/agents/ 폴더에 다음 파일을 생성해줘:
>
> - research-agent.md
> - content-agent.md
> - design-agent.md
> - review-agent.md
>
> 각 에이전트는 context/ 폴더의 brand-guideline.md, business-context.md,
> design-style-guide.md를 참조하도록 설정하고
> templates/ 폴더의 해당 템플릿도 참조하도록 해줘.
>
> 마지막으로 CLAUDE.md에 에이전트 라우팅 규칙도 추가해줘.
> ```

생성 확인:

- [ ] `.claude/agents/research-agent.md` 생성됨
- [ ] `.claude/agents/content-agent.md` 생성됨
- [ ] `.claude/agents/design-agent.md` 생성됨
- [ ] `.claude/agents/review-agent.md` 생성됨
- [ ] CLAUDE.md에 라우팅 규칙 추가됨

### Task 6.3 — 개별 에이전트 테스트

> **📋 복붙용 프롬프트 (예시):**
> ```
> 리서치 에이전트로 "AI 마케팅 트렌드 2026" 주제를 조사해줘.
> 결과는 output/research/ 폴더에 저장해줘.
> ```

테스트 항목:

- [ ] 리서치 에이전트 단독 실행 — 결과물이 `output/research/`에 저장되는지
- [ ] 콘텐츠 에이전트 단독 실행 — 우리 브랜드 톤이 반영되는지
- [ ] 디자인 에이전트 단독 실행 — 우리 컬러/폰트가 적용되는지
- [ ] 검수 에이전트 단독 실행 — 브랜드 가이드 위반을 잘 찾는지

---

## ✅ Phase 7: 첫 콘텐츠 테스트 (통합 실행)

> 드디어 실제로 마케팅 자료를 만들어보는 단계입니다.

### Task 7.1 — 카드뉴스 1개 만들어보기 (간단 테스트)

> **📋 복붙용 프롬프트:**
> ```
> [본인이 다루고 싶은 주제]에 대한 카드뉴스 5장을 만들어줘.
> templates/card-news-template.md와 context/의 모든 파일을 참조하고
> Nano Banana MCP로 이미지 생성, output/card-news/에 저장해줘.
> ```

체크:

- [ ] 카드 5장이 생성됨
- [ ] 우리 브랜드 톤이 반영됨
- [ ] 우리 컬러/폰트가 적용됨
- [ ] 카피가 자연스러움

### Task 7.2 — 전체 마케팅 캠페인 통합 테스트

> **📋 복붙용 프롬프트:**
> ```
> [캠페인 주제] 마케팅 캠페인을 만들어줘.
> 모든 자료(카드뉴스, 썸네일, PPT, 뉴스레터)를 만들어줘.
> 모든 에이전트 팀(research → content → design → review)을 가동해서 진행하고
> 결과물은 output 폴더에 종류별로 저장해줘.
> ```

⏱️ **예상 시간:** 약 10-15분

체크:

- [ ] 카드뉴스 생성됨 (`output/card-news/`)
- [ ] 유튜브 썸네일 생성됨 (`output/thumbnail/`)
- [ ] PPT 생성됨 (`output/ppt/`)
- [ ] 뉴스레터 생성됨 (`output/newsletter/`)
- [ ] 모든 결과물이 우리 브랜드 일관성 있음

### Task 7.3 — 검수 및 수정 반복

- [ ] 첫 결과물 확인
- [ ] 마음에 안 드는 부분을 구체적으로 피드백
- [ ] context/ 또는 templates/ 파일 업데이트 (재발 방지)
- [ ] 다시 생성해서 개선 확인

**💡 팁:** 결과물이 마음에 안 들 때는 결과물을 고치지 말고,
**컨텍스트(context/, templates/)를 고치세요.** 그래야 다음에 같은 실수를 안 합니다.

---

## ✅ Phase 8: 자동 배포 (Buffer API)

> 만들어진 콘텐츠를 SNS에 자동으로 예약 포스팅하는 단계입니다.

### Task 8.1 — Buffer 계정 세팅

- [ ] https://buffer.com/ 가입
- [ ] SNS 계정 연동 (인스타그램/링크드인/X/쓰레드 등)
- [ ] https://developers.buffer.com/ 접속
- [ ] Personal Access Token 발급

### Task 8.2 — API 키 안전하게 저장

`.env` 파일을 열어서 추가:

```
BUFFER_API_KEY=발급받은_키_붙여넣기
```

확인:

- [ ] `.env` 파일에 `BUFFER_API_KEY` 추가됨
- [ ] `.gitignore`에 `.env` 포함되어 있음

### Task 8.3 — 예약 포스팅 테스트

> **📋 복붙용 프롬프트:**
> ```
> Buffer API 키를 .env에 저장해놨어.
> 예약 포스팅 기능을 테스트해줘.
> output/card-news/ 폴더의 가장 최근 카드뉴스로
> [날짜 시간]에 예약 포스팅해줘.
> ```

확인:

- [ ] Buffer 대시보드에서 예약 상태 확인
- [ ] 실제 예약 시간에 포스팅 정상 발행 확인

---

## 🎯 최종 체크리스트

작업이 완전히 끝났을 때 아래 모든 항목이 ✅ 되어야 합니다:

- [ ] Phase 0: 본인 브랜드 정보 정리 완료
- [ ] Phase 1: 폴더 구조 완성 (context, templates, output, .claude/agents)
- [ ] Phase 2: 컨텍스트 MD 3종 작성 완료
- [ ] Phase 3: 템플릿 MD 4종 작성 완료
- [ ] Phase 4: CLAUDE.md 작성 완료
- [ ] Phase 5: Anthropic 공식 스킬 + Nano Banana MCP 설치 완료
- [ ] Phase 6: 서브 에이전트 4종 생성 및 개별 테스트 완료
- [ ] Phase 7: 전체 파이프라인 통합 실행 성공
- [ ] Phase 8: Buffer API 예약 포스팅 성공

---

## 🚨 트러블슈팅 (자주 묻는 질문)

### Q1. 결과물이 브랜드 톤과 다르게 나옵니다

`context/brand-guideline.md`를 다시 확인하세요. 특히:
- "권장 표현"과 "금지 표현"이 명확한가
- 보이스 톤이 구체적인가 (애매한 형용사 NG)
- 실제 카피 예시가 포함되어 있는가

### Q2. 디자인이 너무 화려하게 나옵니다

`context/design-style-guide.md`의 "금지 사항" 섹션을 강조하세요.
- 화려한 그라데이션 금지
- 다양한 색상 사용 금지
- 등을 명시적으로 적어두세요

프롬프트에 `"minimalist, lots of whitespace"`를 추가해도 효과적입니다.

### Q3. MCP가 작동하지 않습니다

1. `/mcp` 명령어로 MCP 서버 상태 확인
2. Claude Code 재시작
3. API 키 만료 확인 (Google AI Studio 결제 계정)
4. `.env` 파일에 키가 정확히 입력되었는지 확인

### Q4. API 키를 실수로 GitHub에 올렸어요

1. 즉시 해당 키를 발급 사이트에서 폐기
2. 새 키 발급
3. `.gitignore`에 `.env` 추가 확인
4. Git history도 정리 (BFG Repo-Cleaner 추천)

### Q5. 폰트가 적용 안 됩니다

PPTX 생성 시 시스템에 해당 폰트가 설치되어 있어야 합니다.
- 한글 폰트가 없으면: Pretendard 설치 (https://github.com/orioncactus/pretendard)
- 대체 폰트: Apple SD Gothic Neo (Mac), 맑은 고딕 (Windows)

---

## 📚 참고 자료

- 원본 영상: https://www.youtube.com/watch?v=6MJ-pmckowQ
- Anthropic Skills: https://github.com/anthropics/skills
- Google AI Studio: https://aistudio.google.com/
- Buffer Developer: https://developers.buffer.com/
- Pretendard 폰트: https://github.com/orioncactus/pretendard

---

## 💬 시작 전 마지막 체크

다음 정보를 미리 준비해두면 작업이 훨씬 빨라집니다:

1. **본인 브랜드 정보**
   - [ ] 회사/개인 브랜드명
   - [ ] 웹사이트 URL (또는 SNS 계정)
   - [ ] 주요 서비스/제품
   - [ ] 타겟 고객

2. **API 키**
   - [ ] Google AI Studio (Gemini) API 키
   - [ ] Buffer API 키 (선택)

3. **레퍼런스 이미지**
   - [ ] 좋아하는 카드뉴스 디자인 (Pinterest 등에서 수집)
   - [ ] 본인 로고/색상 정보

준비 완료되면 **Phase 0부터 차근차근 따라하세요!** 🚀
