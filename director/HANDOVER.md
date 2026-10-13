# NK 디렉터 인계 문서 (2026-10-13)

이 저장소에서 작업하는 세션은 디렉터 관련 작업 전에 이 문서를 읽는다.
작성 세션은 "AI 영상 편집 협업 구조 개선"(작업 폴더 `F:\Outsourcing\대부금융협회 애니메이션 제작`)이다.

## 1. 왜 만들었나

- **문제:** 기존 nkstudio.org 는 "샷 6초 이하 클립 생성 → 타임라인에 이어 붙이기" 구조다. 그래서 컷 경계마다 인물·공간·연기의 일관성과 맥락이 끊겼다.
- **효과가 확인된 방식:** 한국대부금융협회 TVC 를 Claude Code 와 대화로 만들 때 아래 방식이 효과적이었다.
  - 사건 단위 8~30초를 Seedance 2.5 reference-to-video 로 한 번에 생성
  - 참조 최대 30장에 역할과 적용 구간 지정
  - 480p 드래프트 → 검수 → draft-complete 1080p
  - ffmpeg 자동 검수
  - 문제 구간만 부분 재생성
  - 규칙·현황·제출 기록·교훈을 파일 메모리로 누적
- **목표:** 이 방식을 다중 사용자 상용 서비스로 사이트에 이식한다.
- **사용자 결정(2026-10-12):**
  - 엔진은 Claude Managed Agents + Cloud Run
  - 구독 토큰은 소유자만 쓰고, 그 외는 마스터 API 키 + 크레딧 차감
  - MVP 는 대화형 디렉터 + 시퀀스 생성 + 자동 검수 + 편집기 타임라인 연동

## 2. 구조

```
브라우저(ai-company-app "디렉터" 뷰, components/DirectorWorkspace.tsx)
   │ Bearer(사이트 세션 토큰) · SSE
   ▼
nk-director (Cloud Run, GCP elidus, asia-northeast3) — 무상태
   ├─ 게이트웨이: 세션 생성·메시지·승인·중단·SSE 중계·사용량→크레딧 정산
   └─ /mcp: 에이전트 도구 12종 → 사이트 /api/* 를 사용자 위임 토큰으로 호출
   ▲ MCP(볼트 static_bearer = 7일 위임 토큰)        │ @anthropic-ai/sdk 0.133.0 (beta)
   │                                                   ▼
Anthropic Managed Agents: agent "NK Director"(claude-opus-5-5, effort high)
   + environment nk-director-env (apt ffmpeg, pip numpy·scipy·matplotlib·faster-whisper,
     limited: storage.googleapis.com, huggingface)
   + skill nk-cf-director + 메모리 스토어(사용자별 작업 원칙 / 프로젝트별 기억)
```

- Cloud Run 에는 Atlas·GCS·DB 키를 두지 않는다. 크레딧·가격·저장·영상 생성은 모두 기존 사이트 API 를 그대로 쓴다.
- 사용자마다 세션별 격리 샌드박스를 쓰고, 세션 예산 상한(budget)을 건다.
  - 회원: 잔액(원가 환산)과 $10 중 작은 쪽
  - 소유자: $50

## 3. 위치·자격증명

| 항목 | 값 |
|---|---|
| 서비스 URL | https://nk-director-510034693257.asia-northeast3.run.app |
| 소스 | `director/` (src/server.ts, src/gateway/*, src/mcp/tools.ts, agent/system.md, scripts/setup.ts) |
| Anthropic 리소스 ID | `director/claude-lock.json` (environment, skill, agent) |
| Secret Manager(elidus) | `ANTHROPIC_API_KEY` = Console 키 "nk-director"(기본 워크스페이스, `sk-ant-usr` 형식). `DIRECTOR_SERVICE_SECRET` |
| Cloudflare Pages(nk-ai-studio) | `DIRECTOR_SERVICE_SECRET`(위와 같은 값, wrangler 로 등록) |
| Cloud Run 환경 변수 | `PUBLIC_BASE_URL`, `DIRECTOR_AGENT_ID`, `DIRECTOR_ENVIRONMENT_ID` |
| 실행 계정 | 510034693257-compute@developer.gserviceaccount.com (두 시크릿 읽기 권한 부여함) |

## 4. 운영 절차

- **서비스 코드 수정:** `cd director && gcloud run deploy nk-director --source . --region asia-northeast3 --project elidus --quiet`
- **스킬·시스템 프롬프트 수정:** 아래를 실행한다. 새로 만들지 않고 update 한다. 에이전트는 새 버전이 되고, 스킬은 새 버전이 되며, 세션은 최신 스킬을 쓴다.
  ```
  npm run build && ANTHROPIC_API_KEY="$(gcloud secrets versions access latest --secret=ANTHROPIC_API_KEY --project elidus)" PUBLIC_BASE_URL=https://nk-director-510034693257.asia-northeast3.run.app npm run setup
  ```
- **테스트:** `cd director && npx tsc -p tsconfig.json && ANTHROPIC_API_KEY=test node --test dist/test/*.test.js` (8건)
- **사이트:** 기존 규칙대로 테스트 → 버전 → 커밋 → 푸시 → 운영 확인.
- **세션 디버깅:** Console(platform.claude.com) → 관리형 에이전트 → 세션. 이벤트·도구 호출·비용이 보인다.
- **정리:** 세션 보관(archive)은 일상 정리다. 단, 에이전트·환경·메모리 스토어 보관은 되돌릴 수 없으니 하지 않는다.

## 5. 이번에 바꾼 사이트 코드 (커밋 3.1960 ~ 3.1967)

| 버전 | 내용 |
|---|---|
| 3.1960 | `director/skills/nk-cf-director/` 플레이북 스킬. SKILL.md + reference 6종 + scripts/qa_video.py. 이 PC 의 `~/.claude/skills/nk-cf-director` 는 `D:\Programs\claude-skills` 경유 junction 으로 같은 원본을 쓴다. |
| 3.1961 | 아래 항목 |
| 3.1962 | 디렉터 전용 사이트 API(아래) |
| 3.1963~3.1964 | director 서비스, claude-lock.json |
| 3.1965 | AI 기업 앱 디렉터 화면(메뉴 클래퍼보드 아이콘, ui.navigate "director") |
| 3.1966 | system.message 를 첫 사용자 메시지와 함께 보냄(단독 전송은 400) |
| 3.1967 | 편집기 타임라인 연동(아래) |

**3.1961 변경 내역**
- `video/status.ts`: 마스터 Atlas 키 고정을 버그로 보고 수정했다. 사용자 키 → 마스터 키 순으로 조회한다(`atlasKeysFor`, `fetchAtlasPrediction`).
- `video.ts`:
  - Seedance 2.5 `draft:true`(480p) 추가
  - `seedance-2.5-complete` 추가(`draftJobId` → `bytedance/seedance-2.5/draft-complete`)
  - 참조 오디오를 data: 그대로 보내던 것을 GCS 업로드 후 서명 URL 로 보낸다
  - `promptVerbatim` 옵션(자동 "No speech" 지시를 붙이지 않음)
- `video-pricing.ts`: 드래프트 = 480p, 완성 = 1080p 단가. 20초 완성 견적 $11.85 는 실측과 같다.
- `claude-auth.js resolveAuth`: 구독(OAuth) 토큰은 소유자(`env.AUTH_ID`) 계정만 쓴다. 회원은 본인 API 키, 없으면 마스터 API 키를 쓴다. 관련 테스트 3개 파일을 소유자 기준으로 고쳤다.
- `credits.ts withCreditCharge`: 소유자는 예약·차감을 건너뛴다(마스터 키 비용과의 이중 계산 방지).
- `agent/_shared.ts`: `video` 도구에 `gate: true`(승인 패널).

**3.1962 디렉터 전용 사이트 API**
- `/api/director/delegate`: 서비스 비밀이 필요하다. 7일 위임 토큰과 isOwner 를 준다.
- `/api/director/charge`: 누적 원가 센트 증가분만 ×1.3 으로 차감한다. 멱등이고, 소유자는 0 이다(`credits.ts chargeDirectorUsage`).
- `/api/director/state`: GCS `users/{uid}/director/state.json`. 비밀값은 거부한다.
- `/api/director/media-url`: 본인 저장 영역 읽기 서명 URL, 프로젝트 `director/` 업로드 서명 URL(`gcs.js signGcsObjectUrl`).
- `/api/project/sequences`: payload.sequences 전용(upsert·putTake·select·delete). GCS ifGenerationMatch 로 경합을 막는다.
- `project/save.ts`: 세대 확인 후 재병합해 저장한다. 화면이 들고 있던 옛 sequences 사본은 버리고 서버 값을 보존한다.

**3.1967 편집기 타임라인 연동**
- `post-production.js buildSequenceTimeline`: 선택 테이크를 컷 구간 클립 `vis-cut-<seq>-<cut>`(videoOffset = 컷 시작)으로 만든다. patch 테이크는 해당 컷을 대체한다.
- `postprod-render.js`: 같은 소스 영상은 한 번만 연다.
- 테스트 `director-endpoints.test.mjs`(9건), `director-timeline.test.mjs`(5건). 전체 1,863건 통과.

## 6. 데이터 형식

`director/skills/nk-cf-director/reference/schemas.md` 참고. 요약:

- `payload.sequences[]`
  - 시퀀스 필드: `{id, title, order, durationSec, cuts[], references[], prompt, takes[], selectedTakeIds[]}`
  - Cut: `{id, label, start, end, shot, action, acting, camera, sound, link, stillUrl}`
  - Take: `{id, kind: full|patch, range, replacesCuts, jobId, draft, draftOfTakeId, resolution, status, videoPath(gs://), cost, qa}`
- 기존 6초 상한(decomposer.js, pipeline-video.js)은 건드리지 않았다. 디렉터는 별도 경로이고, 그 값에 고정된 테스트가 많다.

## 7. 검증한 것 / 아직 안 한 것

**검증함**
- 운영 화면에서 세션 생성 → 메시지 → 에이전트가 MCP `project_overview` 호출 → 정확한 답. 프로젝트 "ABC 동요 배우기" 로 확인했고 비용은 $0.10(소유자 무과금 표시).
- 헬스체크, 무인증 401, CORS, MCP 도구 12종 응답.
- 자동 검수 스크립트가 대부금융협회 1080p 5편의 사람 검수 기록과 일치(장면 전환 시각, 음악 의심 구간).

**아직 안 함 / 다음 작업**
1. **실제 영상 생성 E2E:** 480p 4초 드래프트, 약 $0.55. 사용자 승인 대기 중이다. 승인 카드 → 제출 → video_status → 샌드박스 검수 → take 기록 → timeline_apply → /app 타임라인 확인.
2. **저장 Claude 토큰 암호화:** `app_settings.claude_oauth_token`·`claude_api_key` 가 평문이다. `CRED_ENC_KEY` 가 Pages 에 있는지 확인한 뒤 `agent/_shared.ts encryptSecret` 방식으로 바꾼다. `getSettingsRow` 에 env 전달이 필요하다.
3. **공유 프로젝트:** `media-url` 이 본인 저장 영역만 허용한다. 공유받은 프로젝트 미디어는 디렉터가 못 읽는다.
4. **Markdown 한글 굵게:** `**"…"**` 뒤에 한글이 붙으면 별표가 그대로 보인다(CommonMark 규칙). remark 플러그인이나 전처리로 해결한다.
5. **편집기 UI:** 시퀀스 클립임을 표시하는 것, "디렉터로 열기" 링크는 아직 없다.
6. **ID 페더레이션:** Cloud Run 이라 가능하다. 지금은 정적 API 키(만료 안 함)를 쓰므로, 안정화 후 전환을 검토한다.

## 7-1. 모든 컷 스틸 필수 (2026-10-14, v3.1996 · 에이전트 v7 · Cloud Run nk-director-00009)

- **사용자 결정:** 영상은 콘티의 모든 컷에 사용자가 확인한 스틸이 채워진 뒤에만 만든다.
- **강제 지점:** `src/mcp/tools.ts` `video_submit` → `stillsGate`. 제출 범위(full=전체, patch=replacesCuts)의 컷마다 `stillUrl` 이 있고 `stillApproved:true` 이고 그 스틸이 `referenceImages` 에 있어야 한다. 아니면 비용 없이 거절하고 할 일을 돌려준다.
- **경로 정리:** 에이전트가 `stillUrl` 뒤에 "(v3, 사용자 확인 대기)" 같은 메모를 붙여 저장해 콘티 패널 스틸이 깨졌다. `sequences.ts` 가 저장·읽기 때 `_shared/director-media-path.js` 로 경로와 메모(`stillNote`·`note`)를 나눈다.
- **영상 표시:** `Markdown.tsx` 가 `![…](gs://….mp4)`·인라인 `` `gs://….mp4` `` 를 그 자리에서 재생한다. 지침은 이미지 문법을 쓰게 한다.
- **아직 안 함:** 단계 화면(B, `DirectorSteps.tsx`)에는 컷별 스틸 지정·생성 기능이 없어서 이 규칙을 강제하지 않는다.

## 7-2. 일괄 승인 (2026-10-14, v3.2000 · 에이전트 v8 · Cloud Run nk-director-00010)

- **사용자 결정:** 사용자가 채팅으로 "승인"이라고 하면 승인 카드를 하나씩 누르지 않고 일괄 진행한다.
- **동작:** `src/gateway/approval.ts`. 승인 문장이나 "승인" 라벨의 버튼 답이 오면 세션 `metadata.autoApproveAt` 을 켠다. `stream.ts` 는 켜져 있는 동안 유료 도구(PAID_TOOLS) 확인 요청에 allow 를 보낸다.
- **풀리는 때:** 디렉터가 차례를 마칠 때(status_idle · end_turn), 승인이 아닌 새 메시지가 올 때, 60분이 지났을 때.
- **주의:** 자동 허용은 화면 스트림(SSE)이 연결돼 있을 때만 일어난다. 화면이 닫혀 있으면 승인 대기로 남는다.
- **화면:** 연달아 실행된 도구 호출은 `groupToolRuns` 가 한 줄로 접는다.

## 8. 주의

- 사이트 세션 토큰·API 키는 대화나 로그에 출력하지 않는다. 시크릿은 파이프로만 다룬다.
- 유료 생성(영상·이미지)은 항상 사용자 승인 후에만 한다. 에이전트 쪽도 always_ask 다.
- 사용자 규칙: 한국어로만 답한다. C 드라이브에 산출물을 남기지 않는다. 새 도구 설치는 먼저 묻는다.
