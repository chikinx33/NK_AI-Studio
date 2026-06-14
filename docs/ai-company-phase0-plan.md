# 🏢 AI 회사 이식 — Phase 0 구현 계획서

> 작성: 2026-06-14 · 엔케 + 코드(Claude)
> 목적: 라비오크 AI(11인 에이전트 회사)의 **오케스트레이션 두뇌**를 NK_Studio에 이식해,
> "지시 → 에이전트 제작 → 검수 → 배포"가 자율로 도는 완전한 AI 스튜디오를 만든다.
> 이 문서는 ROADMAP처럼 "잊지 않기 위한" 영구 계획서다. 각 항목 완료 시 `[x]` 체크.

---

## 0. 확정된 전제 (2026-06-14 엔케 결정)

- **베이스 = NK_Studio.** 라비오크는 "두뇌(설계·패턴)"만 이식하고, 코드를 복붙하지 않는다.
- **운영 = nkstudio.org 웹서비스(클라우드) 위주.** 따라서 Cloudflare Pages Functions 환경이 기준.
- **잡 저장소 = 기존 Neon Postgres 재사용.** (D1 신설 X — Neon이 이미 지식 RAG용으로 배선됨.
  인프라 추가 0, 회사 두뇌와 같은 DB, pgvector 의미검색 이미 존재. `knowledge/_shared.ts` 패턴 재사용.)
- **UI = 라비오크 React 앱 재사용 + NK에 마운트.** 라비오크 `app/web`(React+Vite SPA: 단톡방·VN·
  아바타·검수 패널)은 "AI 회사 운영 경험"이 담긴 자산 → "코드 복붙 금지" 원칙의 의도적 예외.
  Vite 정적 번들 → `prototype/ai-company.html` + assets로 Cloudflare Pages 서빙. `app/web/src/lib/api.ts`를
  **`/api/agent/*` + Bearer 토큰**으로 재배선하고 멀티테넌시 적용. (NK에 빌드 파이프라인 1개 추가가 대가.)
  Phase 0은 풀 UI 이식 전, 기존 ai-image 페이지의 최소 검수 패널로 루프만 증명 → Phase 1~2에서 본격 마운트.
- 라비오크의 진짜 자산은 코드가 아니라 **"AI 회사를 어떻게 굴리는가"의 설계와 거기서 얻은 교훈**
  (거짓 보고 차단, 정직성 강제, 승인 게이트, 검수→지식 루프).

---

## 0-1. ★ 멀티테넌시 = 최우선 불변 원칙 (상용화 전제)

> 최종 목표는 **상용화**다. A 사용자와 B 사용자는 **각자 완전히 격리된 AI 스튜디오/기업**을 가진다.
> 무엇도 섞이면 안 된다. 이 원칙은 모든 테이블·경로·API·UI에 예외 없이 적용된다.

**모든 것은 `userId`에 귀속된다.** `userId`는 `authorizeRequest`가 토큰에서 검증해 돌려준 값만 신뢰한다
(클라이언트가 보낸 userId·projectId를 권한 근거로 쓰지 않는다).

| 자원 | 격리 방법 | 현황 |
|---|---|---|
| **GCS 산출물(이미지·영상·사운드)** | `buildAiVideoProjectPrefix(basePrefix, userId, …)` → `users/<userId>/…` | **이미 격리됨**(storage.ts). 회사 산출물도 동일 헬퍼 재사용 |
| **잡(agent_jobs)** | 테이블에 `user_id` NOT NULL + **모든** SELECT/UPDATE에 `WHERE user_id = $auth` | Phase 0에서 신설 |
| **회사 지식·결정(회사 두뇌)** | `knowledge_*`에 `user_id` 격리 쿼리(현재 공용일 수 있음 → 회사 지식은 반드시 user 격리) | Phase 3에서 본격화, Phase 0 적재 시 user_id 동봉 |
| **에이전트 정의(11인 페르소나·prompt·goal)** | **공유 템플릿(읽기전용 시드)** + 사용자별 **오버라이드·학습·상태**만 `user_id` 귀속 | Phase 1+ (Phase 0은 pixel 1명, 정의는 상수로 둬도 됨) |
| **결과 서빙(signedUrl/objectName)** | 잡의 `user_id == 요청자 userId` 검증 후에만 서빙(타인 objectName 접근 차단) | Phase 0 필수 |

**설계 결정 — 에이전트는 "공유 템플릿 + 사용자별 인스턴스".**
11인의 기본 페르소나·도구 정의는 코드/시드로 공유(중복 저장 안 함). 각 사용자가 그 위에 쌓는
*학습·지식·잡·결과·페르소나 편집*만 `user_id`로 분리한다. (SaaS 표준 패턴: 템플릿 공유, 데이터 격리)

**보안 가드(코드로 강제):** 모든 `/api/agent/*` 는 ① `authorizeRequest` 통과 ② 대상 잡/결과의
`user_id`가 토큰 userId와 일치할 때만 동작. 불일치 = 404(존재 자체를 숨김, 403 아님).

---

## 1. 결정적 제약 (설계의 척추)

| 사실 | 출처 | 함의 |
|---|---|---|
| CF Pages Functions = 요청당 **약 30초** 하드 리밋 | `functions/api/scenario.js` (`RULE_RETRY_TOTAL_BUDGET_MS=26000`, "풀 systemPrompt 붙이면 30s 타임아웃") | 에피소드 제작(수 분~수십 분)은 한 요청에 불가 → **비동기 잡 + 폴링**이 필수 |
| 영상은 이미 **비동기 잡(job_id 폴링)** 구조 | `functions/api/video/status.ts` (`GET ?job_id=` → done/processing/error) | 이 패턴을 **회사 전체의 작업 단위로 일반화** |
| 이미지는 **동기 POST**(30초 내 완료) | `functions/api/imagen.ts` | Phase 0 도구로 가장 단순·안전한 출발점 |
| 인증 = **Bearer HMAC 세션 토큰** | `functions/api/_shared/auth.js` (`authorizeRequest(request, env)`) | 에이전트 잡도 같은 토큰 체계를 그대로 사용 |
| **Cloudflare에 Python 런타임 없음** | (런타임 사실) | 라비오크의 `tools/<tool>.py` spawn 모델은 **폐기**. 도구 = TypeScript에서 `fetch(NK API)` |

---

## 2. 핵심 설계 결정

### 2-1. 도구 추상화 전환 (라비오크 → NK)
라비오크: `[[RUN: 도구 | 이유]]` → `decideToolAction`(자율도 게이트) → `runPythonTool`(spawn `.py`).
NK 이식: **도구 = 내부 NK API 호출 함수**. 같은 게이트 개념은 유지하되 실행만 `fetch`로 바꾼다.

| 라비오크 요소 | NK Phase 0 대응 |
|---|---|
| `tools/image_gen.py` (OpenAI 호출) | `POST /api/imagen` 호출하는 어댑터 함수 |
| `runner.ts runPythonTool` | `tools/adapters.ts` 의 `runAgentTool(toolName, input, ctx)` |
| `autonomy.ts decideToolAction` | 동일 판정 로직 이식(read/local/external + ALWAYS_GATE: 삭제·배포·발송·게시) |
| 승인 큐 `approvals/` (파일) | 잡 테이블의 `reviewStatus` 필드 |
| `results.ts` 결과 스캔(tools/outputs) | 잡 테이블 + GCS objectName/signedUrl |

### 2-2. "잡(Job)"이 회사의 작업 단위
모든 에이전트 작업 = 하나의 잡. 영상의 `job_id` 패턴을 일반화한 단일 모델.

```
job = {
  id, type,            // 예: "image" | "scenario" | "video" | "episode"
  user_id,             // ★ 소유 계정(authorizeRequest 검증값). 모든 쿼리의 격리 키. NOT NULL
  agentId,             // 담당 에이전트(예: "pixel")
  status,              // queued | working | review_pending | approved | revise | error
  input,               // 도구 입력(JSON) — 예: { prompt, aspectRatio, projectId }
  output,              // 결과(JSON) — 예: { signedUrl, objectName, model }
  reviewStatus,        // pending | approved | revise
  reviewNote,          // 재검토 노트
  parentJobId,         // 에피소드 등 상위 잡(Phase 1+에서 사용)
  createdAt, updatedAt
}
```
> 인덱스: `(user_id, status)`, `(user_id, created_at)`. 단건 조회도 `WHERE id=$1 AND user_id=$2`.

### 2-3. 비동기 실행 방식 (Phase 0는 가장 단순하게)
- Phase 0 도구(imagen)는 동기로 30초 내 끝나므로, 잡 생성 핸들러에서 `ctx.waitUntil()`로
  **백그라운드 처리** 후 폴링으로 결과를 받는다(영상 status 패턴과 동형).
- Phase 1에서 다단계·장시간(에피소드)으로 갈 때 **Cloudflare Workflows 또는 Queues**로 승격.
  (Phase 0에서 인터페이스를 그에 맞게 잡아둬, 나중에 실행기만 교체)

---

## 3. Phase 0 범위 — "다리 하나" (픽셀 → imagen → 검수)

> 한 에이전트(픽셀)가 한 도구(imagen)를 **잡으로 비동기 실행**하고, 엔케가 **검수 게이트**로
> 승인/재검토하는 *한 줄*을 끝까지 관통한다. 이게 되면 나머지는 같은 패턴의 복제다.

### 구현 항목
- [ ] **잡 저장소** — D1(권장) 또는 KV에 `agent_jobs` 모델. (§5 미결)
- [ ] **`tools/adapters.ts`** — `runImagenTool(input, ctx)` = `/api/imagen` 내부 호출 어댑터.
      도구 레지스트리 `{ image: { agentId:"pixel", kind:"external", run } }`.
- [ ] **게이트 이식** — `autonomy.ts decideToolAction` 로직을 TS로 이식(삭제·배포·발송·게시 = 항상 게이트).
      Phase 0 imagen은 `kind:external`이지만 부수효과 없음 → 자동 실행 허용, 결과는 **검수 게이트**로.
- [ ] **`POST /api/agent/job`** — `{ type, agentId, input }` → 잡 생성(status=queued) → jobId 반환 →
      `waitUntil`로 어댑터 실행 → status=working → 완료 시 output 저장 + status=review_pending.
- [ ] **`GET /api/agent/job?id=`** — 잡 상태 폴링(영상 status.ts 응답 형태와 통일).
- [ ] **`GET /api/agent/jobs`** — 검수 대기/내역 목록.
- [ ] **`POST /api/agent/job/review`** — `{ id, decision:"approved"|"revise", note? }` → reviewStatus 갱신.
- [ ] **검수 UI** — 결과 카드(아바타·픽셀·썸네일·상태) + 승인/재검토 버튼.
      (라비오크 `Results.tsx`·검수 패턴의 NK판. 기존 ai-image 라이브러리 UI 재사용 가능)
- [ ] **승인 → 지식 적재(맛보기)** — 승인 시 `/api/knowledge`에 "결정"으로 1줄 기록(Phase 3 예고).

### 인증·권한
- 모든 `/api/agent/*` 는 `authorizeRequest`로 Bearer 토큰 검증. imagen과 동일하게 page 권한 체크.

---

## 4. 데이터 흐름 (Phase 0)

```
엔케 "픽셀아 이 프롬프트로 표지 이미지 만들어줘"
  → POST /api/agent/job { type:"image", agentId:"pixel", input:{prompt, aspectRatio, projectId} }
  → 잡 생성(queued) + jobId 반환, ctx.waitUntil(처리)
       처리: runImagenTool → POST /api/imagen → {signedUrl, objectName}
             → 잡 output 저장, status=review_pending
  → 프런트가 GET /api/agent/job?id= 폴링 → review_pending + 썸네일
  → 검수 UI: [승인] / [재검토+노트]
       승인 → reviewStatus=approved + /api/knowledge "결정" 적재
       재검토 → reviewStatus=revise + note (다음 잡 입력으로 환류)
```

---

## 5. 미결 질문 (엔케/코드 결정 필요)

1. **잡 저장소: D1 vs KV vs R2-json.**
   - 추천: **D1(SQLite)**. 잡은 관계형 질의(상태별·에이전트별·부모별)가 필요하고 회사 두뇌(Phase 3)도 SQL이 유리.
   - 단, Pages에 D1 바인딩 추가 필요(현재 `wrangler.toml` 없음 — 대시보드 바인딩 또는 설정 파일 신설).
2. **비동기 실행기: `waitUntil`(Phase 0) → Workflows vs Queues(Phase 1).**
   - 추천: Phase 0 `waitUntil`로 시작, Phase 1에서 **Cloudflare Workflows**(durable, 다단계 재시도)로 승격.
3. **검수 UI 위치**: ~~기존 vs 신규~~ → **확정**: Phase 0는 기존 ai-image 페이지 최소 검수 패널,
   Phase 1~2에서 라비오크 React UI(`app/web`)를 `ai-company.html`로 빌드·마운트(api.ts 재배선).

---

## 6. 명시적 비범위 (Phase 0에서 안 하는 것)

- 코어 오케스트레이터의 작업 분해·통솔(→ Phase 1)
- 11인 전원·다도구 배선(→ Phase 2)
- 회사 두뇌(지식그래프·학습 루프) 본격 구축(→ Phase 3)
- 자율 근무·스케줄(→ Phase 4)
- 라비오크 Node/React 코드의 직접 포팅(패턴만 이식)

---

## 7. 검증 기준 (Phase 0 완료 정의)

- [ ] `POST /api/agent/job`(image) → jobId 즉시 반환, 인증 없으면 401.
- [ ] 폴링이 queued→working→review_pending 전이를 보여주고, output.signedUrl로 이미지 표시.
- [ ] 검수 승인 → reviewStatus=approved + 지식에 "결정" 1건 적재 확인.
- [ ] 재검토+노트 → reviewStatus=revise + note 저장.
- [ ] **★ 멀티테넌시 격리**: B 사용자 토큰으로 A의 jobId 조회·검수 시도 → 404(존재 숨김).
      A의 GCS objectName을 B가 서빙 요청 → 거부. 잡 목록은 본인 것만 반환.
- [ ] 경로 안전·권한: 타 사용자 잡 접근 차단, page 권한 없으면 403.
- [ ] 타입체크 통과, APP_VERSION +1, 커밋·푸시.

---

## 8. 이후 단계 (요약)

- **Phase 1 — 두뇌 이식**: 코어 분해·라우팅·통솔 + 라비오크 안전장치(정직성·게이트) 이식. (아래 §9 상세)
- **Phase 1.5 — UI 마운트**: 라비오크 `app/web`(React/Vite)을 NK 빌드에 통합 → `ai-company.html`.
  `api.ts`를 `/api/agent/*`+Bearer로 재배선, NK 세션 인증 통합, 멀티테넌시(userId) 적용.
  단톡방·VN·아바타·검수 패널 경험을 클라우드에서 그대로.

---

## 9. Phase 1 설계 — 코어 두뇌 이식

> 라비오크 `orchestrator/converse.ts`(`runGroupChat`) + `prompts.ts`(`groupChatSystem`)를 NK 클라우드로.
> **두뇌의 본질 = 프롬프트(정체성·정직성·위임·안전장치) + 오케스트레이션 흐름 + 마커 처리.**
> LLM = NK가 쓰는 Claude(`api.anthropic.com/v1/messages`, sonnet-4-6, `ANTHROPIC_API_KEY`)로 고정.

### 라비오크 runGroupChat 흐름 (이식 대상)
1. 컨텍스트(정체성·목표·지식·보드·현황·프로필) 주입 → 2. 라우팅(멘션/포커스) →
3. 코어 1차 응답(`speak`) → 4. 위임(`[[CALL:id|지시]]`/추론/라우터) → 5. 직원 작업·보고(+도구 `[[RUN]]`) →
6. 코어 통솔 마무리(종합·결론) → 7. 백그라운드 학습(캡처·요약·보드).
안전장치 마커: `[[RULE]]`(규칙등록) `[[RETRACT]]`(철회) `[[CLEANUP]]`(정리) `[[AGENTRULE]]`(직원규칙). 정직성 가드(거짓 보고 금지).

### ★ 30초 제약 → 단계 분리 (필수)
멀티 Claude 호출(1차+위임N+통솔)은 한 요청에 불가. 그래서:
- **Phase 1a — 대화 인프라 + 코어 단일 응답** (Claude 1회, `waitUntil` 안전). 단톡방에서 코어와 진짜 대화.
- **Phase 1b — 위임·통솔** (멀티 호출 → Cloudflare Workflows durable 도입). 코어가 직원 부려 종합.

### 멀티테넌시
- 회사 정체성/목표/페르소나 = **공유 템플릿(코드 시드)**. 라비오크의 구체 정체성("우울의 숲" 등)은
  엔케 개인 데이터라 포팅 금지 — 일반 "AI 콘텐츠 스튜디오" 템플릿. 사용자별 오버라이드는 후속(Neon `company_profile`).
- 대화·메시지(`agent_messages`)는 `user_id` + `conversation_id` 격리. 모든 조회 `WHERE user_id`.

### Phase 1a 구현 항목
- [ ] `agent_messages` 스키마(Neon): id, user_id, conversation_id, role, agent_id, name, text, created_at. 인덱스 `(user_id, conversation_id, created_at)`.
- [ ] `agent/_orchestrator.ts`: ROSTER(11인 포팅) + 회사 템플릿 + 코어 페르소나 + `callClaude`(NK Claude fetch) + `stripThink` + `buildAgentSystem`(groupChatSystem 포팅) + `speak`.
- [ ] `POST /api/agent/chat { message, conversationId? }` → 사용자 메시지 저장 + 잡(type=chat) → `waitUntil`(코어 speak → 메시지 저장).
- [ ] `GET /api/agent/messages?conversationId=` → 메시지 폴링(user_id 격리).
- [ ] ai-company.html에 최소 단톡방 섹션(입력+메시지 스트림).
- [ ] 검증: 코어가 페르소나대로 응답, B 사용자는 A 대화 안 보임(404/빈 목록).
- **Phase 2 — 11인 도구 배선**: 잉크→/api/scenario, 비트→/api/sound, 리치→/api/sns/publish …
- **Phase 3 — 회사 두뇌**: D1/R2 지식·학습·콘텐츠 라이브러리 + 성과 피드백.
- **Phase 4 — 자율·스케줄**: 24시간 자율 근무, 정기 에피소드 파이프라인.
