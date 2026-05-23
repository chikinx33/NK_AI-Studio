# CLAUDE.md - 마케팅 AI 에이전트 팀 프로젝트

> 이 문서는 Claude Code가 이 프로젝트에서 작업할 때 **항상 먼저 읽어야 하는 표준 업무 규약(SOP)** 입니다.
> 모든 작업 시 이 문서의 규칙을 따라주세요.
> `[대괄호]` 안의 내용은 본인 브랜드 정보로 교체하세요.

---

## 1. 프로젝트 개요 (Project Overview)

### 프로젝트명
**`[본인 브랜드명]` 마케팅 에이전트 팀**

### 목적
`[본인 채널/브랜드명]`의 마케팅 콘텐츠를
**AI 에이전트 팀이 자동으로 제작**할 수 있는 환경을 구축합니다.

### 산출물 종류
1. **카드뉴스** (인스타그램, 링크드인)
2. **유튜브 썸네일**
3. **PPT 사업 소개서/강의 자료**
4. **주간 뉴스레터**

### 핵심 원칙
- 모든 콘텐츠는 **`context/` 폴더의 브랜드 가이드라인**을 따른다
- AI 자동화는 효율을 위한 수단, **품질이 최우선**이다
- 도구가 아니라 **컨텍스트(맥락)** 가 결과를 결정한다

---

## 2. 브랜드 핵심 요약 (Brand Essence)

> 매번 [[context/brand-guideline]]을 읽지 않아도 되도록 핵심만 요약합니다.
> 자세한 내용은 `context/` 폴더의 각 파일 참조.

### 채널 한 줄 정의
**"`[본인 채널/브랜드 한 줄 정의]`"**

### 톤 앤 매너
- **`[본인 브랜드 톤 — 예: 친근한 전문가 / 권위 있는 연구자]`**
- 키워드: `[Tier 1 키워드 3-5개]`
- 금지: `[지양하는 표현 — 예: "꿀팁", "대박" 등]`

### 비주얼 정체성
- 컬러: `[배경 컬러]` / `[메인 텍스트 컬러]` + Accent `[포인트 컬러 HEX]`
- 폰트: **`[한글 폰트 — 예: Pretendard]`** (한글), `[영문 폰트 — 예: Inter]` (영문)
- 컨셉: `[디자인 컨셉 — 예: 미니멀, 에디토리얼]`

---

## 3. 폴더 구조 (Folder Structure)

```
[프로젝트 루트]/
│
├── CLAUDE.md                       ← 이 문서 (SOP)
├── TASK_LIST.md                    ← 전체 프로젝트 작업 가이드
│
├── context/                        ← 📚 브랜드 맥락 (책장)
│   ├── brand-guideline.md          ← 브랜드 정체성, 보이스 톤
│   ├── business-context.md         ← 타겟 고객, 페인포인트, 서비스
│   └── design-style-guide.md       ← 색상, 폰트, 레이아웃
│
├── templates/                      ← 🎨 디자인 템플릿 (도구)
│   ├── card-news-template.md       ← 카드뉴스 구조/규칙
│   ├── ppt-template.md             ← PPT 슬라이드 구조
│   ├── newsletter-template.md      ← 뉴스레터 8개 섹션
│   └── thumbnail-template.md       ← 유튜브 썸네일 패턴
│
├── output/                         ← 📦 결과물 저장소
│   ├── card-news/                  ← 생성된 카드뉴스
│   ├── ppt/                        ← 생성된 PPT
│   ├── newsletter/                 ← 작성된 뉴스레터
│   └── thumbnail/                  ← 생성된 썸네일
│
└── .claude/
    └── agents/                     ← 🤖 서브 에이전트 정의
        ├── research-agent.md       ← 주제 리서치 담당
        ├── content-agent.md        ← 본문/카피 작성 담당
        ├── design-agent.md         ← 시각 디자인 담당
        └── review-agent.md         ← 브랜드 톤 검수 담당
```

---

## 4. 작업 라우팅 규칙 (Routing Rules)

### 어떤 작업이 들어오면 무엇을 참조할 것인가?

| 사용자 요청 패턴 | 참조 파일 | 사용 에이전트 |
|----------------|----------|--------------|
| "카드뉴스 만들어줘" | `templates/card-news-template.md` + `context/*.md` | research → content → design → review |
| "썸네일 만들어줘" | `templates/thumbnail-template.md` + `context/design-style-guide.md` | content → design → review |
| "PPT 만들어줘" | `templates/ppt-template.md` + `context/business-context.md` | research → content → design → review |
| "뉴스레터 작성해줘" | `templates/newsletter-template.md` + `context/brand-guideline.md` | research → content → review |
| "마케팅 캠페인 전체" | 모든 templates + 모든 context | **전체 에이전트 팀 가동** |

### 작업 전 필수 체크
모든 콘텐츠 생성 작업 시 **반드시** 아래 3가지를 먼저 확인:
1. `context/brand-guideline.md` - 톤이 맞는가?
2. `context/design-style-guide.md` - 디자인이 맞는가?
3. 해당 산출물의 `templates/*.md` - 구조가 맞는가?

---

## 5. 에이전트 파이프라인 (Agent Pipeline)

### 표준 4단계 파이프라인
```
[리서치] → [콘텐츠 작성] → [디자인 생성] → [검수]
   ↓           ↓              ↓             ↓
research    content        design        review
```

### 각 단계별 역할

#### Stage 1: 리서치 (Research Agent)
- **인풋**: 주제, 타겟 키워드
- **아웃풋**: 핵심 팩트 5개 + 통찰 + 출처
- **참조**: `context/business-context.md`
- **저장 위치**: `output/research/[주제]-research.md`

#### Stage 2: 콘텐츠 작성 (Content Agent)
- **인풋**: 리서치 결과
- **아웃풋**: 카드뉴스 카피 / 뉴스레터 원고 / PPT 슬라이드 텍스트
- **참조**: `context/brand-guideline.md` + 해당 `templates/*.md`
- **저장 위치**: `output/[산출물 종류]/[제목]-copy.md`

#### Stage 3: 디자인 생성 (Design Agent)
- **인풋**: 콘텐츠 카피
- **아웃풋**: 실제 이미지/PPTX 파일
- **사용 도구**: Nano Banana MCP, PPTX 스킬
- **참조**: `context/design-style-guide.md` + 해당 `templates/*.md`
- **저장 위치**: `output/[산출물 종류]/[제목].png` 또는 `.pptx`

#### Stage 4: 검수 (Review Agent)
- **인풋**: 최종 산출물
- **체크 항목**:
  1. 브랜드 톤이 맞는가? (브랜드 가이드라인 대비)
  2. 디자인 일관성이 있는가? (스타일 가이드 대비)
  3. 오탈자/문법 오류는 없는가?
  4. CTA가 명확한가?
- **아웃풋**: 통과 OR 수정 요청서

---

## 6. 산출물 저장 규칙 (Output Rules)

### 파일명 컨벤션
```
output/[종류]/[YYYY-MM-DD]-[주제-슬러그].[확장자]
```

**예시**:
- `output/card-news/2026-05-20-[주제-슬러그].png`
- `output/ppt/2026-05-20-[brand-pitch-deck].pptx`
- `output/newsletter/2026-05-20-issue-01.md`

### 폴더 자동 생성
산출물 종류별 폴더가 없으면 자동 생성:
- `output/card-news/`
- `output/ppt/`
- `output/newsletter/`
- `output/thumbnail/`
- `output/research/` (중간 산출물)

---

## 7. 사용 가능한 외부 도구 (External Tools)

### MCP
- **Nano Banana (Gemini)**: 카드뉴스, 썸네일, 일러스트 이미지 생성
  - 사용 시: `templates/*.md`의 "AI 이미지 생성 프롬프트" 섹션 참조

### Anthropic 공식 스킬
- **PPTX**: PowerPoint 파일 생성
- **DOCX**: Word 문서 생성 (필요 시)
- **PDF**: PDF 변환

### 외부 API
- **Buffer API**: 소셜 미디어 예약 포스팅
  - API 키는 `.env` 파일에서 로드
  - 절대 코드/메시지에 직접 노출 금지

---

## 8. 작업 시 절대 규칙 (Hard Rules)

### ✅ 반드시 해야 하는 것
1. 모든 작업 시작 전에 **이 문서(CLAUDE.md)** 를 먼저 읽기
2. 콘텐츠 생성 전에 **3대 컨텍스트 파일** 확인
3. 결과물은 반드시 **`output/` 폴더 안에** 저장
4. 한글 콘텐츠는 디자인 가이드의 지정 폰트 사용
5. 산출물 생성 후 **review-agent로 검수**

### ❌ 절대 하지 말아야 하는 것
1. 브랜드 가이드라인에 어긋나는 톤 사용
2. 지정된 컬러 팔레트 외 색상 사용
3. 산출물을 `output/` 외 폴더에 저장
4. `.env` 파일을 git에 커밋하거나 외부 노출
5. API 키를 코드/메시지에 평문으로 작성
6. context/ 와 templates/ 폴더의 파일을 임의로 수정 (사용자 동의 필요)

---

## 9. 자주 쓰는 명령 패턴 (Common Commands)

### 패턴 1: 단일 카드뉴스 제작
```
"[주제]에 대한 카드뉴스 5장을 만들어줘.
templates/card-news-template.md와 context/의 모든 파일을 참조하고
Nano Banana MCP로 이미지 생성, output/card-news/에 저장해줘"
```

### 패턴 2: 전체 마케팅 캠페인
```
"[캠페인 주제] 마케팅 캠페인을 만들어줘.
모든 자료(카드뉴스, 썸네일, PPT, 뉴스레터)를 만들어줘.
모든 에이전트 팀을 가동해서 진행하고
결과물은 output 폴더에 종류별로 저장해줘"
```

### 패턴 3: 뉴스레터만 제작
```
"이번 주 뉴스레터를 작성해줘.
주제: [주제]
templates/newsletter-template.md 구조 따르고
output/newsletter/에 저장해줘"
```

### 패턴 4: Buffer로 예약 포스팅
```
"output/card-news/[파일명]을 [날짜 시간]에 [SNS 채널]에
예약 포스팅해줘. .env의 Buffer API 키 사용"
```

---

## 10. 트러블슈팅 (Troubleshooting)

### Q. 생성된 결과물이 브랜드 톤과 다르다면?
- `context/brand-guideline.md`의 "권장 표현" 섹션 다시 읽고 재생성
- review-agent에게 검수 요청 후 수정

### Q. 디자인이 너무 화려하게 나온다면?
- `context/design-style-guide.md`의 "금지 사항 ❌" 섹션 강조
- 프롬프트에 "minimalist, lots of whitespace" 추가

### Q. MCP가 작동하지 않으면?
- `/mcp` 명령으로 MCP 서버 상태 확인
- Claude Code 재시작
- API 키 만료 확인

### Q. 한글 폰트가 적용 안 되면?
- PPTX 생성 시 시스템에 지정 폰트 설치 확인
- 대체 폰트: Apple SD Gothic Neo (Mac), 맑은 고딕 (Windows)

---

## 11. 변경 이력 (Change Log)

| 날짜 | 변경 사항 | 변경자 |
|------|----------|--------|
| `[YYYY-MM-DD]` | 초기 작성 | `[작성자]` |

---

## 12. 빠른 링크 (Quick Links)

### 핵심 컨텍스트
- [브랜드 가이드라인](context/brand-guideline.md)
- [비즈니스 컨텍스트](context/business-context.md)
- [디자인 스타일 가이드](context/design-style-guide.md)

### 템플릿
- [카드뉴스 템플릿](templates/card-news-template.md)
- [PPT 템플릿](templates/ppt-template.md)
- [뉴스레터 템플릿](templates/newsletter-template.md)
- [썸네일 템플릿](templates/thumbnail-template.md)

### 전체 작업 진행 상황
- [TASK_LIST.md](TASK_LIST.md)
