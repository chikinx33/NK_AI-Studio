# NK AI Studio 랜딩 페이지 전면 개편 설계서 (v2)

> 2026-07-31 · 작성: 기획·설계 담당 · 구현/배포: 코드(코딩 에이전트 + git 자동배포)
> 대상: `prototype/index.html`, `prototype/js/landing.js`, `prototype/styles.landing-page.css`
> SSOT: 이 문서. 카피는 여기 확정본을 그대로 옮긴다(코드가 새로 창작하지 않는다).

---

## 0. 한 줄 결론

랜딩의 마지막 **콘텐츠** 수정은 `98189742`(2026-06-13, v3.1092)다. 현재 앱은 **v3.1414**. 그 사이 제품의 무게중심이 "AI 영상 제작 도구"에서 **"11명의 AI 직원이 운영하는 콘텐츠 회사(AI 기업 / RAVIOK)"** 로 이동했는데, 랜딩에는 이 단어가 **단 한 번도 등장하지 않는다**. 성과 분석, 브랜드/에피소드 작업공간, 스킬 플랫폼, 업무 파일 시스템, 음성 대화, 외부 업무툴 연동(Gmail·캘린더·Drive·GitHub·네이버 데이터랩)도 전부 미반영이다.

→ **부분 수정이 아니라 히어로부터 전면 재정의**한다. (사용자 결정 2026-07-31)

---

## 1. 현황 진단

### 1-1. 시점 격차

| 항목 | 값 |
|---|---|
| 랜딩 신설 | `dce8f000` v3.1087 |
| 랜딩 마지막 콘텐츠 수정 | `98189742` **2026-06-13** (v3.1092, IP 섹션 삭제) |
| 현재 앱 버전 | **v3.1414** (2026-07-30) |
| 격차 | 약 **320 버전 / 48일** |

> 참고: `git log -- prototype/index.html` 이 매 커밋에 뜨는 것은 `precommit-bump.js`가 캐시버스트 쿼리(`?v=3.xxxx`)만 자동 갱신하기 때문이다. **본문은 6월 13일에 멈춰 있다.**

### 1-2. 실제 제품 vs 랜딩 반영 — 갭 표

| 실제 기능 (코드 확인) | 근거 | 랜딩 |
|---|---|---|
| **AI 기업 · 11인 에이전트 로스터** (코어·엣지·레이더·마키·플롯·잉크·픽셀·비트·엔지·리치·싱크) | `functions/api/agent/_orchestrator.ts` `ROSTER` | ❌ 없음 |
| **에이전트 도구 81개** (레지스트리 기준) | `_shared.ts` `AGENT_TOOLS` | ❌ 없음 |
| **승인 게이트**(삭제·배포·게시는 항상 사람 승인) | `_shared.ts` `ALWAYS_GATE`, `api/approvals/[id]/*` | ❌ 없음 |
| **업무 파일·폴더 탐색기**(생성/복사/이동/삭제/미리보기) | `api/agent/company-files.ts`, `work-folders.ts`, `work-items.ts` | ❌ 없음 |
| **회사 지식 · 지식 그래프 · 리마인더** | `company-knowledge.ts`, `knowledge-graph.ts`, `reminders.ts` | ❌ 없음 |
| **음성 대화**(전역 마이크, 브라우저 TTS / 자체호스팅 MeloTTS / Gemini 음성) | `melo-tts/`, `api/tts/melo.ts`, v3.1356~3.1374 커밋 | ❌ 없음 |
| **스킬 플랫폼**(스킬 잡·비용 추정·승인·재시도·아티팩트, 인포그래픽 스킬) | `_company-skill-*.ts`, `api/agent/skill-jobs/*` | ❌ 없음 |
| **외부 업무툴 연동**(Gmail 읽기/발송, 캘린더, Drive/Sheets, GitHub, 네이버 데이터랩, 웹 검색/페치) | `AGENT_TOOLS` 목록 | ❌ 없음 |
| **SNS 성과 분석**(6채널 자동 동기화, 브랜드/에피소드 단위 분리, 장기 그래프, 개선 제안, 미분류 게시물 귀속) | `api/sns/analytics/sync.ts`, `analytics.html`, v3.1386~3.1406 | ❌ 없음 |
| **브랜드 ↔ 에피소드 작업공간 계층** | v3.1399·3.1400, `brand-studio.html` | ❌ 없음 (막연한 "IP 브랜드 관리"만) |
| **최종 렌더 · 다운로드**(transcode → final-render.mp4) | `api/postprod/transcode*.ts` | △ "트랜스코드" 태그만 |
| **콘텐츠 라이브러리 · 미디어 · 프로젝트 공유** | `library.html`, `media.html`, `api/project/share.ts` | ❌ 없음 |
| **문서 산출**(PDF·PPT·인포그래픽) | `AGENT_TOOLS` `pdf`/`ppt`/`infographic` | △ "글·문서 생성"만 |
| **Google 로그인** | `api/auth/google/*` | ❌ 없음 |
| **자체 호스팅 TTS(MeloTTS)** | `melo-tts/` | ❌ 없음 (ElevenLabs·GCP TTS만 표기) |
| **업스케일 · 립싱크 · 이미지 인페인팅** | `api/upscale.ts`, `api/video/lipsync.ts` | △ 인페인팅만 언급 |

### 1-3. 랜딩 자체의 결함 (기능과 무관한 품질 문제)

| # | 문제 | 근거 | 심각도 |
|---|---|---|---|
| D1 | **푸터에 미완성 플레이스홀더가 라이브로 노출** — `⟨확정 필요: 사업자/대표자 정보⟩` 뱃지가 실제 방문자에게 보인다(점선 테두리 노란 뱃지로 스타일까지 되어 있음) | `index.html` L317, `styles.landing-page.css` L377, 라이브 확인됨 | **P0 · 신뢰도 직격** |
| D2 | **og:image가 SVG** — 카카오톡·페이스북·X 링크 미리보기는 SVG를 렌더하지 않는다. 공유 시 이미지 없이 뜬다 | `index.html` L22/L32 → `images/og-landing.svg` | **P0 · 유입 손실** |
| D3 | `robots.txt` · `sitemap.xml` 부재 | `prototype/` 루트에 파일 없음 | P1 |
| D4 | **영어 SEO 0** — i18n이 JS 런타임 치환뿐이라 크롤러는 한국어만 본다. `hreflang`·별도 `/en` 경로 없음 | `js/landing.js` DICT | P1 |
| D5 | **웹 분석 도구 미설치** — 방문/전환 측정 불가. 개편 효과를 판단할 수 없다 | `index.html`에 gtag/GTM/Clarity 등 0건 | P1 |
| D6 | 구조화 데이터가 `Organization` 하나뿐 | `index.html` L41~52 | P2 |
| D7 | **히어로 비주얼이 CSS 더미 목업** — 실제 화면이 아니다 | `index.html` L101~136 | P1 |
| D8 | 문의처가 개인 Gmail 주소 평문 노출(스팸 수집 대상) | L312, L321 | P2 |
| D9 | 소셜 프루프·FAQ·데모 0 — 전환 근거가 없다 | 라이브 확인 | P1 |
| D10 | `og:locale:alternate en_US` 선언했지만 실제 영문 URL 없음 | L26 | P2 |

---

## 2. 새 정보 구조 (IA)

```
① Hero              — "AI 직원이 일하는 콘텐츠 회사" (전면 재정의)
② 신뢰 밴드         — 11인 · 81개 도구 · 6채널 · 사람 승인
③ AI 기업 [신규]    — 로스터 11인 + 승인 게이트 + 음성 지시
④ 파이프라인        — 4단계 → 5단계(기획·생성·편집/렌더·배포·성과)로 확장
⑤ 핵심 기능         — 8개 → 12개
⑥ 성과 분석 [신규]  — 배포로 안 끝난다, 숫자로 돌아온다
⑦ 연동              — SNS 6채널 + 업무툴 6종
⑧ 작동 방식         — 4단계 → 3단계로 단순화
⑨ 안전·신뢰 [신규]  — 승인 게이트 / BYOK / 내 데이터
⑩ FAQ [신규]        — 전환 + SEO(FAQPage 스키마)
⑪ CTA
⑫ Footer            — 사업자 정보 확정
```

**가격 섹션은 넣지 않는다.** (사용자 결정: 결제 미연동 상태에서 허위 표기 위험 회피)

---

## 3. 섹션별 확정 카피

> 규칙: 아래 문구를 **그대로** 쓴다. `data-i18n` 키는 기존 네이밍 규칙(`섹션.항목`)을 따른다.
> EN은 `js/landing.js` DICT의 `en` 블록에 같은 키로 넣는다.

### ① Hero

| 키 | KO | EN |
|---|---|---|
| `hero.eyebrow` | AI 기업 · 콘텐츠 제작 · SNS 자동화 | AI Company · Content Production · SNS Automation |
| `hero.title` | 11명의 AI 직원이,<br>당신의 콘텐츠 회사를 굴립니다 | 11 AI teammates,<br>running your content company |
| `hero.lead` | 기획·글·이미지·영상·사운드 제작부터 6개 SNS 배포와 성과 분석까지. 지시만 하면 담당 AI 직원이 실행하고, 배포·삭제 같은 되돌릴 수 없는 일은 **당신 승인** 뒤에만 움직입니다. | From planning, copy, image, video and sound to publishing across 6 social channels and reading the results. Give the instruction — the right AI teammate executes, and anything irreversible waits for your approval. |
| `cta.startFree` | 무료로 시작하기 | Start free |
| `hero.cta2` | AI 직원 만나보기 | Meet the team |
| `hero.trust1` | 지시 → 실행 → 승인 → 배포 원스톱 | Instruct → execute → approve → publish |
| `hero.trust2` | 6개 SNS 자동 게시 + 성과 자동 수집 | Auto-publish to 6 channels, auto-collect results |

**히어로 비주얼 교체(D7) — 2026-07-31 자산 조사 후 확정:**

최종안은 **실제 AI 기업 채팅 화면 스크린샷(승인 카드가 보이는 구도)** 이다. 히어로 비주얼의 목적은 "이 제품이 실제로 이렇게 생겼다"를 증명하는 것이고, 새 포지셔닝의 핵심 차별점인 **승인 게이트**를 한 장으로 보여줄 수 있는 유일한 화면이기 때문이다.

- **Remotion mp4(`nk-studio-intro-video/out/nk-studio-intro.mp4`)는 히어로에 쓰지 않는다.** 1920×1080 풀스크린 타이틀카드 구성이라 폭 ~500px 슬롯에서 헤드라인이 안 읽히고, 영상 속 카피가 구 포지셔닝("한 흐름의 AI 스튜디오", "AI 영상 스튜디오")이라 새 히어로 문구와 정면으로 충돌한다. 카피를 고쳐 재렌더하더라도 타이틀카드 필름은 제품 실물을 보여주지 못한다.
- 이 소개 필름은 폐기하지 말고 **별도 용도**(SNS 홍보 소재, 추후 "소개 영상 보기" 모달)로 남긴다. 필요해지면 그때 새 포지셔닝으로 카피만 교체해 재렌더한다.
- **스크린샷 확보 전까지의 임시 처리:** §3의 히어로 재작성(P1) 시점에 더미 목업(`.lp-mock`)을 **버리지 말고 내용만 새 포지셔닝에 맞게 최소 수정**한다 — 파이프라인 칩(기획/생성/편집/배포) 대신 **승인 카드 형태**(에이전트 이름 + 작업 요약 + 승인/거절 버튼)를 목업 안에 표현한다. 스크린샷이 확보되면 이 블록을 통째로 `<img>`로 교체한다.
- 스크린샷 요건: 가로 1440px 이상(레티나 2배 권장), PNG 원본, **승인 카드가 보이는 상태**. 랜딩은 비로그인 공개 페이지이므로 이메일·실제 브랜드/에피소드명·API 키·결제 정보는 **삽입 전 마스킹** 필수.
- 교체 시: `<img>`에 `width`/`height` 명시(CLS 0), `alt`는 `hero.mockAria` 문구 전환, 목업 전용 i18n 키(`chip.*`, `mock.project`)는 정리.

### ② 신뢰 밴드 (히어로 바로 아래, 신규)

| 키 | KO | EN |
|---|---|---|
| `band.item1` | **11명** AI 직원 로스터 | **11** AI teammates |
| `band.item2` | **81개** 실행 도구 | **81** execution tools |
| `band.item3` | **6개** SNS 채널 자동 배포 | **6** social channels |
| `band.item4` | 되돌릴 수 없는 작업은 **100% 사람 승인** | Irreversible actions **always** need your approval |

> 숫자는 코드 기준 실측치다(`AGENT_TOOLS` 81개, `ROSTER` 11인). **도구가 늘면 이 숫자도 같이 갱신**해야 하므로, 코드는 이 값을 `index.html`에 하드코딩하되 주석으로 출처(`_shared.ts AGENT_TOOLS`)를 남긴다.

### ③ AI 기업 (신규 섹션 — `#company`)

| 키 | KO | EN |
|---|---|---|
| `co.eyebrow` | AI 기업 | AI Company |
| `co.title` | 도구를 배우지 말고, 직원에게 시키세요 | Don't learn the tool. Just tell your team. |
| `co.sub` | 총괄 에이전트 '코어'가 요청을 쪼개 담당자에게 넘깁니다. 각 직원은 자기 직무의 실제 도구를 들고 실행합니다. | Core, the orchestrator, breaks your request down and routes it. Each teammate executes with the real tools for their job. |

**로스터 카드 11개** (이모지·이름·직무 — `ROSTER` 원문 그대로):

| 이모지 | 이름 | 직무 카피 |
|---|---|---|
| 🧭 | 코어 | 총괄 — 작업 분해·라우팅·최종 판단 |
| 💼 | 엣지 | 전략·비즈니스 — 수익모델·가격·KPI |
| 🔍 | 레이더 | 리서치 — 트렌드·경쟁사·사실확인 |
| 📈 | 마키 | 마케팅·그로스 — 캠페인·퍼널 |
| 🎬 | 플롯 | 콘텐츠 디렉터 — 기획·포맷·후크 |
| ✍️ | 잉크 | 작가·카피 — 스크립트·캡션·문서 |
| 🎨 | 픽셀 | 디자인 — 브랜드·비주얼·영상 |
| 🎵 | 비트 | 사운드 — BGM·효과음·더빙 |
| 💻 | 엔지 | 엔지니어 — 코드·자동화·API |
| 📡 | 리치 | 채널·배포 — 전 채널 발행·해시태그·SEO |
| 📱 | 싱크 | PM·비서 — 일정·할일·요약·보고 |

**서브 기능 3칸:**

| 키 | KO | EN |
|---|---|---|
| `co.f1.t` / `co.f1.d` | 승인 게이트 / 게시·삭제·발송처럼 되돌릴 수 없는 일은 실행 전에 승인 카드로 올라옵니다. | Approval gate / Publishing, deleting, sending — all stop for your approval first. |
| `co.f2.t` / `co.f2.d` | 말로 지시 / 마이크를 켜고 말하면 그대로 업무가 됩니다. 답변도 음성으로 돌아옵니다. | Talk to your team / Speak, and it becomes work. Answers come back as voice. |
| `co.f3.t` / `co.f3.d` | 업무 파일함 / 직원이 만든 산출물은 폴더로 정리되고, 프로젝트에 그대로 연결됩니다. | Work files / Everything your team produces lands in folders, linked to the project. |

### ④ 파이프라인 (4 → 5단계)

| STEP | 키 | KO 제목 | KO 설명 | 태그 |
|---|---|---|---|---|
| 01 | `pipe1` | 기획 | 주제·브랜드만 주면 스토리 비트와 숏 단위 시나리오로 분해합니다. | 시나리오 / 숏 분해 |
| 02 | `pipe2` | 생성 | 글·이미지·영상·사운드를 한 자리에서 만듭니다. 장면마다 필요한 소재를 즉시. | 글 / 이미지 / 영상 / 사운드 |
| 03 | `pipe3` | 편집 · 렌더 | 씬을 배열하고 나레이션·음악·효과음을 입힌 뒤 최종본까지 렌더·다운로드합니다. | 씬 편집 / 최종 렌더 |
| 04 | `pipe4` | SNS 배포 | 채널별 캡션·해시태그를 정리해 6개 SNS에 한 번에 게시합니다. | 자동 캡션 / 동시 배포 |
| **05** | `pipe5` **[신규]** | **성과 분석** | **조회수·반응을 자동으로 모아 브랜드·에피소드 단위로 보여주고, 다음에 뭘 바꿀지 제안합니다.** | 자동 수집 / 개선 제안 |

EN: `Planning / Generation / Edit & Render / Publish / Analytics`

### ⑤ 핵심 기능 (8 → 12개)

기존 8개는 아래처럼 **문구만 갱신**하고, 4개를 **신규 추가**한다.

| # | 제목 | 설명 | 모델·태그 |
|---|---|---|---|
| 1 | 기획 · 시나리오 | 장르·톤·길이에 맞춰 비트와 숏으로 자동 구조화합니다. | Claude |
| 2 | 글 · 문서 | SNS 카피·상세페이지는 물론 PDF·PPT·인포그래픽까지 산출합니다. | Claude / PDF / PPT |
| 3 | 이미지 생성 · 편집 | 텍스트·이미지로 생성하고, 인페인팅으로 원하는 부분만 다시 그리고, 업스케일까지. | Gemini Image / OpenAI / 업스케일 |
| 4 | 영상 생성 | 이미지와 프롬프트로 장면을 영상화. 립싱크로 입모양까지 맞춥니다. | Kling / Veo / Grok / Seedance / 립싱크 |
| 5 | 편집 · 최종 렌더 | 씬을 배열하고 채널 규격에 맞춰 최종본을 렌더·다운로드합니다. | 씬 편집 / 트랜스코드 |
| 6 | 사운드 · 음성 | 나레이션·BGM·효과음·캐릭터 더빙. 자체 호스팅 음성 엔진도 씁니다. | ElevenLabs / Google Cloud TTS / MeloTTS |
| 7 | 브랜드 · 에피소드 작업공간 | 캐릭터·세계관·말투를 브랜드에 정의하고, 에피소드 단위로 작업을 나눕니다. | 브랜드 허브 / 에피소드 |
| 8 | SNS 자동 배포 | 6개 채널에 동시 게시하고 채널별 메타데이터를 자동 정리합니다. | 6개 채널 / 동시 게시 |
| **9** | **AI 직원 · 승인 게이트** | **11명이 직무별 도구 81개로 실행하고, 되돌릴 수 없는 일은 승인 뒤에만 진행합니다.** | 11인 / 81 도구 |
| **10** | **성과 분석** | **게시물 성과를 자동 수집해 브랜드·에피소드별 장기 그래프와 개선 제안으로 보여줍니다.** | 자동 동기화 / 개선 제안 |
| **11** | **업무 파일 · 회사 지식** | **산출물은 폴더로 정리되고, 회사 지식과 지식 그래프로 쌓여 다음 작업에 쓰입니다.** | 파일 탐색기 / 지식 그래프 |
| **12** | **외부 업무 연동** | **Gmail·캘린더·Drive/Sheets·GitHub·네이버 데이터랩·웹 검색을 직원이 직접 씁니다.** | Gmail / Calendar / Drive / GitHub |

### ⑥ 성과 분석 (신규 섹션 — `#analytics`)

| 키 | KO | EN |
|---|---|---|
| `an.eyebrow` | 성과 분석 | Analytics |
| `an.title` | 올리고 끝이 아니라, 숫자로 돌아옵니다 | Publishing isn't the end — the numbers come back |
| `an.sub` | 연결한 채널의 게시물 성과를 자동으로 모아 브랜드·에피소드 단위로 나눠 보여주고, 다음 콘텐츠에서 뭘 바꿀지 제안합니다. | Performance from connected channels is collected automatically, split by brand and episode, with concrete suggestions for what to change next. |
| `an.p1` | 채널 6곳 성과 자동 동기화 | Auto-sync across 6 channels |
| `an.p2` | 브랜드 · 에피소드 단위 분리 집계 | Split by brand and episode |
| `an.p3` | 장기 추세 그래프 | Long-range trend graphs |
| `an.p4` | 개선 제안과 적용 | Suggestions you can apply |

### ⑦ 연동 (기존 SNS 밴드 확장)

| 키 | KO | EN |
|---|---|---|
| `sns.title` | 한 번 만들고, 여섯 채널에 동시에 | Make once, publish to six |
| `sns.sub` | 계정을 연결해 두면 채널별 형식에 맞춰 자동 게시하고, 성과까지 다시 끌어옵니다. | Connect once — we publish in each channel's format and pull the results back. |
| `int.title` **[신규]** | 업무 도구도 그대로 붙습니다 | Your work tools, connected |
| `int.sub` **[신규]** | 메일·일정·문서·코드까지, AI 직원이 직접 사용합니다. | Mail, calendar, docs, code — your AI teammates use them directly. |

연동 배지: `YouTube · Instagram · TikTok · Facebook · Threads · X` + `Gmail · Google Calendar · Google Drive/Sheets · GitHub · 네이버 데이터랩 · 웹 검색`

### ⑧ 작동 방식 (4 → 3단계)

| 키 | KO 제목 | KO 설명 |
|---|---|---|
| `how1` | 하고 싶은 걸 말한다 | "엘리더스 ep2 숏폼 만들어서 유튜브랑 인스타에 올려줘" 처럼 그냥 지시하면 됩니다. |
| `how2` | AI 직원이 만들고, 당신이 승인한다 | 담당 직원이 시나리오·영상·사운드를 만들고, 게시 직전에 승인 카드가 올라옵니다. |
| `how3` | 배포하고 성과를 본다 | 승인하면 채널에 올라가고, 며칠 뒤 성과가 자동으로 모여 다음 기획에 반영됩니다. |

`how.title`: **"세 마디면 끝납니다"** / EN: *"Three steps. That's it."*

### ⑨ 안전 · 신뢰 (신규 섹션 — `#trust`)

| 키 | KO | EN |
|---|---|---|
| `tr.title` | 자동화하되, 통제는 당신에게 | Automate the work, keep the control |
| `tr.i1.t` / `tr.i1.d` | 승인 없이는 배포 없음 / 게시·삭제·발송은 자율도와 무관하게 항상 사람 승인을 거칩니다. | No publish without approval / Publishing, deleting and sending always stop for a human. |
| `tr.i2.t` / `tr.i2.d` | 내 계정, 내 데이터 / 브랜드·프로젝트·산출물은 내 계정 스코프 안에서만 조회·수정됩니다. | Your account, your data / Brands, projects and outputs stay inside your own scope. |
| `tr.i3.t` / `tr.i3.d` | 연결은 내가 고른다 / SNS·업무툴 연동은 필요한 것만 직접 연결하고 언제든 해제할 수 있습니다. | You choose the connections / Connect only what you need, disconnect anytime. |

### ⑩ FAQ (신규 — 전환 + SEO)

| Q | A |
|---|---|
| 영상 편집을 해본 적이 없어도 쓸 수 있나요? | 네. 주제와 브랜드만 정하면 시나리오·영상·사운드까지 AI 직원이 만들고, 사용자는 확인하고 승인만 하면 됩니다. |
| AI가 마음대로 게시하지는 않나요? | 게시·삭제·발송처럼 되돌리기 어려운 작업은 항상 승인 카드로 먼저 올라옵니다. 승인 전에는 실행되지 않습니다. |
| 어떤 SNS에 올릴 수 있나요? | YouTube, Instagram, TikTok, Facebook, Threads, X 6개 채널입니다. 계정 연결 후 한 번에 게시됩니다. |
| 성과는 어떻게 확인하나요? | 연결된 채널의 게시물 성과를 자동으로 모아 브랜드·에피소드 단위 그래프와 개선 제안으로 보여줍니다. |
| 어떤 AI 모델을 쓰나요? | 기획·글은 Claude, 이미지는 Gemini Image·OpenAI, 영상은 Kling·Veo·Grok·Seedance, 음성은 ElevenLabs·Google Cloud TTS·자체 호스팅 엔진을 단계별로 씁니다. |
| 지금 유료인가요? | 현재는 가입 후 무료로 사용할 수 있습니다. 유료 플랜은 준비 중입니다. |

> 마지막 Q는 결제 미연동 상태를 정직하게 표기한 것이다. 결제 붙는 시점에 이 답변부터 갱신한다.

### ⑪ CTA / ⑫ Footer

| 키 | KO | EN |
|---|---|---|
| `cta.title` | 아이디어를 콘텐츠로,<br>지금 시작하세요 | Turn the idea into content — today |
| `cta.sub` | 지시 한 줄이면 AI 직원이 움직입니다. 첫 콘텐츠를 만들어 보세요. | One instruction and your team starts. Make your first piece. |
| `footer.desc` | AI 직원이 운영하는 콘텐츠 제작 · IP 브랜드 · SNS 자동화 플랫폼.<br>기획부터 배포와 성과 분석까지 하나로 잇습니다. | — |

**푸터 필수 수정(D1):** `lp-todo` 플레이스홀더 뱃지를 **삭제**하고, 다음 중 하나로 대체한다.
- (A) 사업자 정보가 확정됐다면: `상호 / 대표자 / 사업자등록번호 / 통신판매업신고번호 / 주소 / 문의` 표기
- (B) 아직 미확정이면: **뱃지·문구를 통째로 제거**하고 `© 2026 NK Studio · 문의 …` 만 남긴다

> 결제를 붙이는 순간 (A)는 전자상거래법상 필수다. 지금은 최소한 **(B)로 즉시 제거**한다.

---

## 4. SEO · 메타 · 구조화 데이터

| 항목 | 조치 |
|---|---|
| `<title>` | `NK AI Studio — AI 직원이 콘텐츠를 만들고 배포까지 하는 AI 기업 플랫폼` |
| `description` | `11명의 AI 직원이 기획·글·이미지·영상·사운드를 만들고 YouTube·Instagram·TikTok·Facebook·Threads·X에 배포한 뒤 성과까지 분석합니다. 배포·삭제는 사람 승인 후에만 실행됩니다.` |
| `keywords` | 기존 + `AI 에이전트, AI 직원, 콘텐츠 자동화, SNS 성과 분석, 숏폼 자동 배포` |
| **og:image (D2)** | **`images/og-landing.png` 1200×630 PNG 신규 제작** 후 `og:image`·`twitter:image` 교체. `og:image:type`=`image/png` 추가. (SVG는 카카오/메타/X 미지원) |
| **robots.txt (D3)** | 신규: 전체 허용 + `Sitemap: https://nkstudio.org/sitemap.xml` |
| **sitemap.xml (D3)** | 신규: `/`, `/terms`, `/privacy` (앱 내부 페이지는 제외 — 로그인 필요) |
| **hreflang (D4)** | 정적 `/en/index.html` 생성 후 `ko`↔`en` `alternate` 상호 선언. *분리가 부담이면 최소한 `og:locale:alternate` 허위 선언(D10)을 제거한다.* |
| **JSON-LD (D6)** | `Organization` 유지 + `SoftwareApplication`(name, applicationCategory: `MultimediaApplication`, operatingSystem: `Web`) + `FAQPage`(§3-⑩ 6문항) 추가 |
| **분석 (D5)** | **Cloudflare Pages 대시보드에서 활성화**(Workers & Pages → 프로젝트 → Metrics → Web Analytics → Enable). 다음 배포부터 beacon이 **자동 주입**되므로 **토큰도 `index.html` 수정도 불필요**. 쿠키리스라 동의 배너 부담 없음. *수동 스니펫 삽입 방식은 쓰지 않는다.* |
| 이메일 (D8) | `mailto:` 평문 → 난독화하거나 `contact@nkstudio.org` 도메인 메일로 교체 |

---

## 5. 우선순위 · 실행 순서

| 순위 | 묶음 | 내용 | 예상 |
|---|---|---|---|
| **P0** | 즉시 결함 | D1(플레이스홀더 제거), D2(OG PNG), D5(분석 스니펫) | 1커밋 |
| **P1** | 콘텐츠 전면 개편 | §3 전 섹션 교체 + `landing.js` DICT KO/EN 갱신 + `styles.landing-page.css` 신규 섹션 스타일 | 2~3커밋 |
| **P2** | SEO 보강 | §4 robots/sitemap/JSON-LD/메타 | 1커밋 |
| **P3** | 비주얼 | D7 히어로 스크린샷 교체(**사용자 캡처 대기 · 블로킹**), 로스터 아바타 이미지 | 1커밋 |
| **P4** | 영문 | `/en` 정적 페이지 + hreflang | 별건 |

---

## 6. 범위 밖 (하지 말 것)

- **가격/요금제 섹션 신설** — 결제 미연동. 명시적으로 제외한다.
- 앱 내부 페이지(`app.html` 이하) 리디자인 — 이 문서는 **공개 랜딩 한정**.
- 로스터 11인의 이름·직무 **창작·변경** — `ROSTER` 원문 고정.
- 실측 없는 수치(사용자 수, 제작 편수, 만족도 등) 표기 — 소셜 프루프는 실데이터 확보 후.
- `terms.html` / `privacy.html` 본문 개정 — 별건.

---

## 7. 완료 확인 기준

1. 라이브 `nkstudio.org` 어디에도 `확정 필요` / `준비중` 류 플레이스홀더가 **0건**.
2. 카카오톡·X에 링크를 붙여넣었을 때 **1200×630 이미지 미리보기가 뜬다**.
3. 랜딩 본문에 `AI 직원`·`승인`·`성과 분석` 키워드가 각각 최소 1회 등장한다.
4. KO/EN 토글 시 신규 섹션이 **모두** 번역된다(미번역 키 0).
5. `view-source`에 `FAQPage`·`SoftwareApplication` JSON-LD가 존재하고 Rich Results Test를 통과한다.
6. `https://nkstudio.org/robots.txt`, `/sitemap.xml` 이 200을 반환한다.
7. 모바일 375px 폭에서 로스터 11카드·기능 12카드가 깨지지 않는다.
8. Lighthouse 성능/접근성 점수가 개편 전보다 떨어지지 않는다.

---

## 8. 주의

- **커밋 = 라이브 배포**다(`.githooks` pre-commit 버전범프 → post-commit `push origin HEAD:main` → Cloudflare Pages). P0 묶음을 먼저 단독 커밋해 즉시 반영하고, 대규모 개편은 검증 후 커밋한다.
- 한국어 텍스트 파일은 저장소 관례상 **UTF-8 (BOM)** 을 유지한다(`AGENTS.md`). 편집 후 한글 깨짐 여부를 바이트 단위로 확인한다.
- `?v=3.xxxx` 캐시버스트는 `precommit-bump.js`가 처리하므로 손대지 않는다.
