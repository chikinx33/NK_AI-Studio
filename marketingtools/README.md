# 🤖 마케팅 AI 에이전트 팀 — 따라하기 템플릿

> 빌더 조쉬 유튜브 영상([링크](https://www.youtube.com/watch?v=6MJ-pmckowQ)) 기반
> **본인 브랜드의 마케팅 자동화 시스템을 구축할 수 있는 Claude Code 템플릿**입니다.
>
> 시작점: `TASK_LIST.md` 한 파일만 보고 따라하면 됩니다.

---

## 📂 프로젝트 구조

```
[프로젝트 루트]/
│
├── 📜 README.md                ← 이 파일 (전체 가이드)
├── 📋 TASK_LIST.md             ← ⭐ 마스터 가이드 (먼저 읽기)
├── 📘 CLAUDE.md                ← AI 표준 업무 규약 (SOP)
├── 🔧 SETUP_GUIDE.md           ← 스킬/MCP 설치 가이드
├── 📤 BUFFER_GUIDE.md          ← Buffer API 자동 배포 가이드
│
├── 🔐 .env.example             ← API 키 입력 양식
├── 🚫 .gitignore               ← 민감 파일 보호
│
├── 📚 context/                 ← 브랜드 맥락 (본인 정보로 채우기)
│   ├── brand-guideline.md      ← 보이스 톤, 키워드
│   ├── business-context.md     ← 타겟 고객, 페인포인트
│   └── design-style-guide.md   ← 색상, 폰트, 레이아웃
│
├── 🎨 templates/               ← 디자인 템플릿
│   ├── card-news-template.md   ← 카드뉴스 구조
│   ├── ppt-template.md         ← PPT 슬라이드
│   ├── newsletter-template.md  ← 뉴스레터 8섹션
│   └── thumbnail-template.md   ← 유튜브 썸네일
│
├── 📦 output/                  ← 생성된 결과물
│   └── (실행 시 자동 생성)
│
└── 🤖 .claude/agents/          ← 서브 에이전트 4종
    ├── research-agent.md       ← 리서치 (주제 조사)
    ├── content-agent.md        ← 콘텐츠 (카피 작성)
    ├── design-agent.md         ← 디자인 (이미지/PPT 생성)
    └── review-agent.md         ← 검수 (품질 게이트키퍼)
```

---

## 🚀 시작하기

### **👉 가장 먼저 [`TASK_LIST.md`](TASK_LIST.md) 를 여세요!**

TASK_LIST.md는 이 프로젝트의 **마스터 가이드**입니다.
Phase 0부터 Phase 8까지 순서대로 따라하면 본인 브랜드의 마케팅 자동화 시스템이 완성됩니다.

### 단계 요약

```
Phase 0  본인 브랜드 정보 정리      ← 여기서 시작!
Phase 1  폴더 구조 만들기
Phase 2  컨텍스트 작성 (3 MD)
Phase 3  템플릿 작성 (4 MD)
Phase 4  CLAUDE.md 작성
Phase 5  스킬 & MCP 설치
Phase 6  서브 에이전트 팀 구성
Phase 7  첫 콘텐츠 테스트
Phase 8  자동 배포 (Buffer)
```

---

## 💡 핵심 컨셉

### 1️⃣ 컨텍스트 우선 (Context First)
영상의 핵심 메시지대로 **셋업에 95%의 시간** 투자.
컨텍스트(맥락) 문서가 잘 정리되면 AI 결과 품질이 폭발적으로 좋아집니다.

### 2️⃣ 표준화된 SOP
`CLAUDE.md` 하나로 AI가 매번 같은 방식으로 일관되게 작업합니다.
회사 신입사원에게 업무 매뉴얼을 주는 것과 같은 효과.

### 3️⃣ 4단계 파이프라인
**리서치 → 콘텐츠 → 디자인 → 검수**
각 단계마다 전문 에이전트가 담당. 인계 프로토콜로 정보 손실 없음.

### 4️⃣ 다중 산출물
하나의 주제 → 카드뉴스 + 뉴스레터 + PPT + 썸네일 + SNS 포스트
**1번 작업으로 4~5개 채널 콘텐츠** 동시 생성.

---

## 📊 만들 수 있는 산출물

| 산출물 | 출력 형식 | 사용 도구 |
|--------|----------|----------|
| **카드뉴스** | PNG (1080×1080) | Nano Banana MCP |
| **유튜브 썸네일** | PNG (1280×720) | Nano Banana MCP |
| **PPT 사업 소개서** | PPTX | Anthropic PPTX Skill |
| **주간 뉴스레터** | MD / HTML | 텍스트 생성 |
| **SNS 포스트** | 텍스트 + 이미지 | 통합 |
| **검수 보고서** | MD | Review Agent |

---

## ✨ 영상과의 차별점

영상에서 한 단계 더 나아간 부분들:

| 영상 | 이 템플릿 |
|------|----------|
| AI에게 "알아서 만들어줘" | 명시적 SOP + 라우팅 규칙 |
| 에이전트만 만들고 끝 | 검수 게이트키퍼까지 4단계 |
| 단편적 가이드 | 모든 절차 표준 보고서 포맷 |
| API 키 즉석 입력 | `.env` + `.gitignore` 보안 강화 |
| 따라하면서 검증 | 체크리스트 기반 검증 |

---

## 🛡️ 보안 주의사항

- ✅ `.env` 파일은 절대 GitHub에 커밋 X
- ✅ API 키를 스크린샷/영상에 노출 X
- ✅ `.gitignore`가 제대로 동작하는지 확인
- ✅ 키 노출 시 즉시 폐기 후 재발급

---

## 📞 도움이 필요할 때

### 트러블슈팅
- [TASK_LIST.md](TASK_LIST.md)의 트러블슈팅 섹션 (Q1~Q5)
- [SETUP_GUIDE.md](SETUP_GUIDE.md)의 트러블슈팅 섹션
- [BUFFER_GUIDE.md](BUFFER_GUIDE.md)의 트러블슈팅 섹션

### 문서 빠른 링크
- 📋 [TASK_LIST.md - ⭐ 마스터 가이드 (먼저 읽기)](TASK_LIST.md)
- 📘 [CLAUDE.md - 표준 업무 규약](CLAUDE.md)
- 🔧 [SETUP_GUIDE.md - 설치 가이드](SETUP_GUIDE.md)
- 📤 [BUFFER_GUIDE.md - Buffer 자동 배포](BUFFER_GUIDE.md)

---

## 🎯 완성 후 다음 단계 (선택)

이 시스템을 더 발전시키고 싶다면:

1. **Make/Zapier 연동**: Buffer 외 다른 자동화 추가
2. **Notion 연동**: 콘텐츠 캘린더 관리
3. **분석 자동화**: Buffer Analytics → AI 분석 → 다음 주 전략
4. **A/B 테스트**: 같은 콘텐츠로 다른 카피 변형 테스트
5. **다국어 확장**: 영어 버전 콘텐츠 자동 생성

---

## 🙏 크레딧

- **영상 출처**: [빌더 조쉬 YouTube](https://www.youtube.com/watch?v=6MJ-pmckowQ)
- **템플릿 라이선스**: 자유 사용 가능

---

> "도구가 아니라, 맥락(컨텍스트)이 결과를 결정한다."
