# RAVIOK 에이전트 ↔ AI 스튜디오 전(全) 기능 도구화 설계서
> 2026-07-07 · 작성: 기획·설계(기획설계 담당) · 구현/배포: 코드(코딩 에이전트 + git 자동배포)
> 목적: **AI 스튜디오에서 사용자가 손으로 하는 모든 기능을, RAVIOK 에이전트가 각 직무에 맞게 직접 수행**할 수 있도록 도구(툴)로 노출하는 전체 청사진.

---

## 0. 역할·배포 전제 (고정)
- **나(설계)**: 이 문서처럼 "무엇을·어디에·어떤 계약으로" 만들지 설계·스펙만 담당.
- **코드(구현)**: 실제 파일 편집·구현.
- **배포**: 커밋하면 `.githooks`가 자동 처리 — pre-commit(테스트+`precommit-bump.js` 버전범프) → post-commit(`git push origin HEAD:main`) → Cloudflare Pages가 main 빌드·배포. **즉 커밋 = 라이브 배포.** (커밋 로그 `v3.xxxx`가 그 흔적)

---

## 1. 통합 패턴 — "스튜디오 기능 하나 = 에이전트 도구 하나" (코드가 반복 적용할 레시피)
모든 도구는 아래 3곳만 건드리면 추가된다. 기존 도구(image·video·scenario·web_search 등)가 정확히 이 구조다.

**위치: `prototype/functions/api/agent/`**
1. **`_shared.ts` — run 함수**: `async function run<Tool>Tool(input, ctx: ToolContext)`. 내부 스튜디오 API를 `fetch(internalUrl(ctx.request, "/api/..."), { headers: { Authorization: ctx.authHeader }})`로 서브리퀘스트(멀티테넌시: 같은 userId 자동 검증). `ToolContext = { request, env, authHeader, userId }`. (JSON 헬퍼 `callInternalJson`이 이미 있음)
2. **`_shared.ts` — `AGENT_TOOLS` 레지스트리**: `키: { agentId, agentIds?, kind, gate?, synthesize?, run }`.
   - `kind: "read"` = 검수/승인 없이 즉시 실행(조회). `synthesize: true` = 결과를 모델에 재투입해 자연어 답 합성.
   - `kind: "external"` = 생성/행동 잡. 검수패널로 산출.
   - `gate: true` = **승인 전 실행 금지**. 승인 시 `review.ts`가 `tool.run` 실행(외부·되돌리기 어려운 쓰기: 발행·삭제·브랜드/프로젝트 쓰기).
   - `agentIds: [...]` = 공유 직무(여러 에이전트가 같은 도구 사용).
3. **`_orchestrator.ts`**: `MY_TOOL_DESCRIPTIONS`(에이전트가 낼 `[[RUN: tool | {json}]]` 설명), `TOOL_LABELS`(코어 위임 라우팅용 라벨), read 도구는 `formatReadResult`에 표시 케이스.

> 이 3곳 패턴을 지키면 코어의 **자동 위임**(작업→담당 에이전트)과 **승인/검수 큐**가 공짜로 붙는다.

---

## 2. 게이트·안전 정책 (도구 kind/gate 결정 기준)
| 성격 | kind | gate | 예 |
|---|---|---|---|
| 조회(읽기) | read | – | *_get, *_list, *_library, describe, search, hashtags |
| 생성물(내 소유 산출) | external | – | image, video, scenario, music, tts, upscale, lipsync, ppt |
| 소유 데이터 쓰기(되돌리기 어려움) | external | ✅ | brand_save, brand_asset, project_create/save/delete, scene 저장, video_delete |
| 외부·비가역(남의 공간/발행) | external | ✅ | publish(발행·예약), sns 연결변경 |
> 코드 참고: `_shared.ts`의 `ALWAYS_GATE` 정규식(`삭제|배포|발송|게시|publish|send|deploy|rm`)이 reason 텍스트에도 걸려 이중 안전.

---

## 3. 전체 기능 매핑 (스튜디오 영역 → 에이전트 도구)
상태: ✅기존 도구 / 🟨2026-07-07 초안 구현(미배포) / 🟥신규 설계(코드가 구현)

### A. 브랜드 허브 — 담당: 코어(총괄), 픽셀(자산)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 명령 |
|---|---|---|---|---|---|
| `brand_list` | core | read | 🟥**신규 API** `/api/brand/list` 필요 | 🟥 | "브랜드 뭐뭐 있어?" |
| `brand_get` | core(+pixel·plot·ink·maki·edge·reach) | read·synth | `/api/brand/get` | 🟨 | "엘리더스 브랜드 보이스 알려줘" |
| `brand_save` | core | ext·gate | `/api/brand/save` | 🟨 | "엘리더스를 브랜드 허브에 생성/수정해줘" |
| `brand_delete` | core | ext·gate | `/api/brand/delete` | 🟥 | "이 브랜드 지워줘" |
| `brand_asset_register` | pixel(+core) | ext·gate | get+save 합성 | 🟨(`brand_asset`) | "이 이미지를 캐릭터 자산으로 등록" |
| `brand_asset_list` | pixel(+core·plot) | read·synth | `/api/ip/library?brandId=` | 🟨(`ip_library`) | "우리 캐릭터 자산 목록" |

### B. 프로젝트/에피소드 — 담당: 코어(총괄), 플롯(기획)  ★현재 완전 미구현
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `project_create` | core | ext·gate | `/api/project/init` (projectId 생성·폴더·빈 data.json) | 🟥 | "엘리더스 ep1 프로젝트 만들어" (에피소드=별도 projectId, 예 `elidus-ep1`) |
| `project_list` | core | read | `/api/project/list` | 🟥 | "내 프로젝트 목록" |
| `project_get` | plot(+core) | read·synth | `/api/project/get?projectId=` (payload+scenes) | 🟥 | "ep1 지금 상태 보여줘" |
| `project_save` | plot | ext·gate | `/api/project/save` (payload/scenes[] 저장) | 🟥 | 시나리오·씬 저장의 실체 |
| `project_delete` | core | ext·gate | `/api/project/delete` | 🟥 | |
| `project_share` | core | ext·gate | `/api/project/share` | 🟥 | 공유/협업 |

> **에피소드**: 스튜디오에 에피소드 전용 API 없음(episodeId는 저장 스코프 값). 실무상 **에피소드 = 개별 projectId**로 취급(`elidus-ep1`, `elidus-ep2`). project_create가 곧 에피소드 생성.

### C. 시나리오·씬 — 담당: 플롯(기획), 잉크(대사)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `scenario` | plot | ext | `/api/scenario` | ✅ | "시나리오 생성해" |
| `scenario_to_project` | plot | ext·gate | scenario 결과 → `project_save` 합성 | 🟥 | "생성한 시나리오를 ep1 씬으로 저장" (엔드투엔드 연결 고리) |
| `scene_shots` | plot | ext | `/api/scenario-shots`·`/api/scenario/shots` | 🟥 | "씬을 샷으로 분해" |
| `scene_locations` | plot | read·synth | `/api/scenario/locations` | 🟥 | "장소 뽑아줘" |
| `story_structure` | plot | read·synth | `/api/story-structure` | 🟥 | "스토리 구조 짜줘" |
| `scene_upsert` | plot | ext·gate | `project_get`→수정→`project_save` | 🟥 | "씬3 대사 바꿔"/"씬 추가" |
| `scene_dialogue` | ink | (scene_upsert 경유) | – | 🟥 | 대사·카피 온브랜드 작성 |

### D. 이미지 — 담당: 픽셀(디자인)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `image` | pixel | ext | `/api/imagen` | ✅ | "이미지 생성" |
| `image_describe` | pixel | read·synth | `/api/imagen-describe` | 🟨(`imagen_describe`) | "이 이미지 프롬프트로 뽑아줘" |
| `image_edit` | pixel | ext | 🟥**엔드포인트 확인 필요**(인페인트/마스크+엔진; UI: img-edit 모달) | 🟥 | "이 이미지 배경만 바꿔" |
| `image_upscale` | pixel | ext | `/api/upscale` | 🟨(`upscale`) | "2배 업스케일" |
| `image_library` | pixel(+plot·reach) | read·synth | `/api/image/library`·`/api/ai-image/library` | 🟨 | "생성한 이미지 목록" |
| `scene_still` | pixel | ext·gate | `image`→scene.imageDataUrl 부착(`project_save`) | 🟥 | "씬1 스틸컷 만들어" → 그 씬에 저장 |

### E. 영상 — 담당: 픽셀(디자인)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `video` | pixel | ext | `/api/video`(+`/status` 폴링) | ✅ | "영상 생성" |
| `video_lipsync` | pixel | ext | `/api/video/lipsync`(+status) | 🟨(`lipsync`) | "입모양 맞춰줘" |
| `video_upload` | pixel | ext | `/api/video/upload` | 🟥 | "이 영상 올려서 소스로 써" |
| `video_delete` | pixel | ext·gate | `/api/video/delete` | 🟥 | "이 영상 삭제" |
| `video_library` | pixel(+plot·reach) | read·synth | `/api/video/library` | 🟨 | "영상 자산 목록" |
| `scene_video` | pixel | ext·gate | `video`→scene 부착(`project_save`) | 🟥 | "씬1 영상 만들어" → 그 씬에 저장 |

### F. 사운드 — 담당: 비트(사운드)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `music` | beat | ext | `/api/music` | ✅ | "BGM 만들어" |
| `sound`(효과음) | beat | ext | `/api/sfx`·`/api/sound/sfx-generate` | ✅ | "효과음 만들어" |
| `narration` (TTS) | beat | ext | `/api/tts` | 🟨 | "이 대본 내레이션" |
| `voice_generate` | beat | ext | `/api/sound/voice-generate` (ElevenLabs 세그먼트·캐릭터 더빙) | 🟥 | "캐릭터별 더빙" |
| `voices_list` | beat | read | `/api/voices`·`/api/tts/voices` | 🟥 | "쓸 수 있는 목소리?" |
| `sound_assets` | beat | read | `/api/sound/assets` | 🟥 | "사운드 자산 목록" |

### G. 포스트프로덕션 = **렌더링 + 다운로드** — 담당: 픽셀
> 사용자 결정(2026-07-07): **디테일 편집 설정은 보류.** 단, **기본 세팅된 상태에서 최종 렌더링·다운로드는 반드시 가능**해야 함. → 아래 2도구만 우선 도구화하고, 컷편집·자막 등 세부 편집은 범위 밖(보류).

| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 비고 |
|---|---|---|---|---|---|
| `render_final` | pixel | ext | `/api/postprod/transcode` 제출 → `/api/postprod/transcode/status` 폴링 → `{projectPrefix}/postprod/final/{stamp}/final-render.mp4` | 🟥 | 입력 `sourceObjectName`(씬 세팅 완료된 소스 영상)+`aspectRatio`(기본 16:9)+`sourceDurationSec`. **디테일 설정은 전달만·기본값 사용**. status가 done이면 `outputObjectName` 반환 |
| `asset_download` | pixel(+sync) | read | 라이브러리 `signedUrl` 재사용 또는 objectName→서명URL 발급(🟥필요 시 `/api/media/sign` 신규) | 🟥 | 최종 렌더/이미지/영상/오디오의 **다운로드 링크**를 사람에게 제공. "완성본 다운로드 링크 줘" |

> ⚠️ 한계: `transcode`는 **단일 소스 영상 → final-render.mp4**. 여러 씬 클립을 하나로 **이어붙이는(concat) 합성**이 별도로 필요하면(현재 소스가 이미 합쳐진 1개 영상이 아니라면) concat 단계 확인 필요 — §6 참고. 임의 NLE 컷편집은 보류.

### H. 문서 — 담당: 플롯(발표), 잉크(문서)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 |
|---|---|---|---|---|
| `ppt` | plot | ext | (agent PPT) | ✅ |
| `pdf` | ink | ext | (agent PDF) | ✅ |
| `doc_generate` | ink | ext | `/api/agent/generate-doc` (type: ppt/pdf) | 🟥(선택) |

### I. 지식 허브 — 담당: 레이더(리서치)/전원
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 |
|---|---|---|---|---|
| 지식 add/list/del | 전원 | (기존 `[[KNOW]]` 마커) | `company-knowledge` | ✅ |
| `knowledge_search` | radar | read·synth | `/api/knowledge/search` (RAG) | 🟥 |
| `knowledge_stats` | radar | read | `/api/knowledge/stats` | 🟥 |

### J. SNS 발행·예약·채널 — 담당: 리치(배포), 마키(마케팅)
| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 | 예시 |
|---|---|---|---|---|---|
| `publish` | reach | ext·gate | `/api/sns/publish` (scheduledAt 예약 포함) | ✅+🟨 | "인스타에 발행/예약" |
| `reservations_list` | reach | read | 🟥 예약 큐 조회(스토리지 확인 필요) | 🟥 | "예약된 발행 뭐 있어?" |
| `sns_channels_status` | reach | read | `/api/sns/token-test`·`/api/agent/integrations` | 🟥 | "어떤 채널 연결됨?" |
| `hashtags` | maki(+reach) | read·synth | `/api/hashtags` | 🟨 | "해시태그 뽑아줘" |
> SNS 연결(OAuth 개설: `/api/sns/connect/{ig,yt,tiktok,x,threads,fb}`)은 **사용자 본인 인증 필요 → 에이전트는 상태조회만, 연결 개설은 사람.**

### K. 미디어/라이브러리 — 담당: 픽셀
| 도구 | 담당 | kind | 엔드포인트 | 상태 |
|---|---|---|---|---|
| `media_library` | pixel | read·synth | `/api/library`·`/api/media/proxy` | 🟥(라이브러리 통합 조회) |

### L. 분석·지표 — 담당: 엣지(전략)
| 도구 | 담당 | kind | 엔드포인트 | 상태 | 비고 |
|---|---|---|---|---|---|
| `sheets_read` | edge | read·synth | Google Sheets | ✅ | 매출·KPI |
| `analytics` | edge | read·synth | 🟥 데이터 소스 확인 필요(analytics.html) | 🟥 | 발행 성과·조회수 집계원 파악 후 |

### M. 유저·설정·크레딧 — 담당: 싱크(비서)  ★결정: 전면 노출(조회 즉시 / 변경 승인 게이트)
> 사용자 결정(2026-07-07): **이 RAVIOK는 나 전용 회사 — 나를 가장 잘 파악해야 한다.** 따라서 userdata도 에이전트가 수행 가능하게 노출. 단, 계정·결제·SNS 설정 **변경은 되돌리기 어려우니 승인 게이트**를 태운다(조회는 즉시). *읽기 정보(프로필·선호)는 에이전트 개인화의 근거로 활용 — 예: 코어가 브리핑 톤·우선순위를 내 취향에 맞춤.*

| 도구 | 담당 | kind/gate | 엔드포인트 | 상태 |
|---|---|---|---|---|
| `profile_get` | sync(+core·edge·maki 공유) | read·synth | `/api/userdata/profile/get` | 🟥 채택 |
| `profile_save` | sync | ext·gate | `/api/userdata/profile/save` | 🟥 채택 |
| `favorites_get` | sync(+pixel·plot 공유) | read | `/api/userdata/favorites/get` | 🟥 채택 |
| `favorites_save` | sync | ext·gate | `/api/userdata/favorites/save` | 🟥 채택 |
| `sns_prefs_get` | reach(+maki) | read | `/api/userdata/sns/get` (발행 채널 선호·기본값) | 🟥 채택 |
| `sns_prefs_save` | reach | ext·gate | `/api/userdata/sns/save` | 🟥 채택 |
| `subscription_get` | sync | read | `/api/userdata/subscription` (크레딧/구독 잔량) | 🟥 채택 |
> ⚠️ 단, **SNS OAuth 연결 개설/해제(`/api/sns/connect/*`)는 본인 인증이 필요 → 여전히 사람이 직접**(userdata/sns의 '설정·선호'와는 다름). `sns_prefs_*`는 어떤 채널을 기본으로 쓸지 등의 **환경설정**만.

### N. 관리자 — `/api/admin/*` : **에이전트 비노출**(관리자 전용).

---

## 4. 엔드투엔드 프로덕션 오케스트레이션 (도구가 다 붙었을 때의 흐름)
```
사용자: "엘리더스 ep1 만들어서 씬1 스틸컷·영상까지 뽑아줘"
  코어 → project_create(elidus-ep1)                        [B]
  코어 → 플롯 위임: scenario → scenario_to_project(ep1)     [C] 씬 저장
  코어 → 픽셀 위임: scene_still(ep1, scene1)               [D] 이미지 생성+씬 부착
                    scene_video(ep1, scene1)               [E] 영상 생성+씬 부착
  코어 → 비트 위임: narration/music/sound                  [F]
  (선택) postprod_transcode → publish(scheduledAt)         [G][J]
  ↳ 쓰기·발행 단계는 ✅승인 큐에서 사람이 확정
```
현재는 [C]~[E]의 "프로젝트/씬 부착" 고리가 없어 개별 생성만 되고 묶이지 않음 → **B·C·D(scene_still)·E(scene_video)가 최우선 갭.**

---

## 5. 구현 우선순위 (코드용 Phase)
- **P0 (엔드투엔드 뼈대)**: `project_create`·`project_get`·`project_list`·`project_save` → `scenario_to_project` → `scene_still`·`scene_video`. (이게 있어야 "프로젝트 만들어~영상까지"가 진짜로 돌아감)
- **P1 (2026-07-07 초안 배포)**: brand_get/save/asset·image_describe·upscale·lipsync·libraries·narration·hashtags·publish예약 — 이미 코드 초안 존재, **검토 후 배포**.
- **P2 (렌더·다운로드·사운드 확장)**: **`render_final`·`asset_download`(★렌더링·다운로드 — 우선순위 상향)**·voice_generate·voices_list·scene_shots·scene_upsert·video_upload/delete. (image_edit는 엔드포인트 확인 후)
- **P3 (운영·조회·개인화)**: brand_list·brand_delete·project_delete/share·knowledge_search/stats·reservations_list·sns_channels_status·media_library·analytics·**userdata(profile_get/save·favorites_get/save·sns_prefs_get/save·subscription_get)**.
- **신규 백엔드 API 필요**: `/api/brand/list`, 예약큐 조회, image_edit 경로 명확화, analytics 집계원.

---

## 5.5 구현 상태 노트 (코드 반영 — 2026-07-07)
> 실제 코드 구현/배포 현황. `prototype/functions/api/agent/_shared.ts`(run+레지스트리) · `_orchestrator.ts`(설명·라벨·formatReadResult).

- **STEP 0/P1 (배포됨)**: brand_get/save/asset·imagen_describe·upscale·lipsync·image/video/ip_library·narration·hashtags·publish(scheduledAt) — 등록 완료.
- **STEP 1/P0 (배포됨, v3.1290)**: `project_create`·`project_list`·`project_get`·`project_save`·`scenario_to_project`·`scene_still`·`scene_video`. 소유 데이터 쓰기는 전부 `gate:true`. 씬 이미지/영상은 `gs://` 영속 경로로 부착(save가 `data:`는 버리고 gs/https만 보존).
- **STEP 2/P2 (배포됨)**: `render_final`·`asset_download`·`voice_generate`·`voices_list`·`sound_assets`·`scene_shots`·`scene_locations`·`story_structure`·`scene_upsert`·`video_delete`.
  - `render_final`: POST `/api/postprod/transcode` → GET `/api/postprod/transcode/status?jobName=&outputObjectName=` 폴링(최대 ~4분) → `signedUrl`. **소스가 이미 1개 합본 영상이라는 전제**(concat 단계 미확인 → §6-2).
  - `asset_download`: `signedUrl` 있으면 그대로, 없으면 `objectName`→`/api/media/proxy?objectName=…&token=…` 다운로드 링크.
  - **`scene_shots`는 ext(비게이트)** — 분해 결과를 검수 패널로 반환하되 프로젝트에 자동 저장하지 않음(저장은 `scene_upsert`/`project_save`).
- **STEP 3/P3 (배포됨)**: `brand_list`(★신규 API `/api/brand/list` 생성)·`brand_delete`·`project_delete`·`project_share`·`knowledge_search`·`knowledge_stats`·`sns_channels_status`·`media_library`(image+video 통합)·`profile_get/save`·`favorites_get/save`·`sns_prefs_get/save`·`subscription_get`.
  - `sns_channels_status`: 상태 조회 소스로 `/api/agent/integrations` 사용(`/api/sns/token-test`은 OAuth 디버그 플로우라 미사용).
  - `subscription_get`: 엔드포인트는 `/api/userdata/subscription/get`(서브폴더).
  - userdata 변경(profile/favorites/sns_prefs save)은 전부 `gate:true`. `sns_prefs_save`는 서버가 read-modify-write 머지.
- **보류(코드가 의도적으로 미구현)**:
  - `image_edit`: 인페인트/마스크 편집 엔드포인트 미확인(§6-1) → 확정 시 P2에 추가.
  - `video_upload`: `/api/video/upload`가 **multipart 파일 전용**이라 URL 기반 에이전트가 쓸 수 없음. URL-ingest 변형 API가 생기면 도구화(현재 제외).
  - `reservations_list`(예약큐 경로 미확인 §6-4)·`analytics`(집계 소스 미확인 §6-3) → 소스 확정 후 도구화.
- **게이트 장시간 폴링 리스크**: `scene_video`·`render_final`은 승인 시 `review.ts` POST 안에서 폴링(3~4분) → CF 응답 한계 초과 가능. 기존 `video` 도구와 동일 제약. 타임아웃 상습 시 비동기 잡(워커) 방식 전환 필요.

## 6. 미해결·확인 필요 (코드/사용자 결정)
1. **image_edit 엔드포인트**: 인페인트/마스크 편집이 어느 API인지(imagen edit? 별도 nano-banana?) 확인 필요.
2. **포스트프로덕션**: ✅**결정됨** — 디테일 편집설정 보류, **`render_final`(최종 렌더)+`asset_download`(다운로드)만 도구화**. 확인 필요: 씬 클립이 여러 개일 때 `transcode` 입력 전 **concat(이어붙이기) 단계가 별도로 존재하는지**(없다면 소스가 이미 1개 합본이라는 전제) — 코드가 파이프라인 확인.
3. **분석(analytics) 데이터 소스**: 발행 성과·조회수를 어디서 집계하는지(SNS API 회수? 시트?) 확정 후 도구화.
4. **예약 큐 스토리지**: reservations(⏰) 목록을 읽는 경로 확인.
5. **개인설정·크레딧(userdata)**: ✅**결정됨(2026-07-07, 업데이트)** — 나 전용 회사이므로 **전면 노출**: 조회(profile/favorites/sns_prefs/subscription)는 즉시, **변경(profile/favorites/sns_prefs save)은 승인 게이트**. 단 SNS OAuth 연결 개설/해제만 사람 직접(본인 인증).

---

## 부록. 담당 에이전트별 도구 요약
- **core(총괄)**: brand_list/get/save/delete, project_create/list/delete/share, 위임
- **plot(기획)**: scenario(_to_project), scene_shots/locations/upsert, project_get/save, story_structure, ppt
- **ink(작가)**: scene_dialogue, pdf, doc_generate, 카피
- **pixel(디자인)**: image(_edit/_describe/_upscale/_library), scene_still, video(_lipsync/_upload/_delete/_library), scene_video, brand_asset, media_library, **render_final(최종 렌더), asset_download(다운로드)**
- **beat(사운드)**: music, sound(sfx), narration, voice_generate, voices_list, sound_assets
- **maki(마케팅)**: hashtags, naver_datalab
- **reach(배포)**: publish(예약), reservations_list, sns_channels_status
- **radar(리서치)**: web_search, web_fetch, knowledge_search/stats
- **edge(전략)**: sheets_read, analytics
- **sync(비서)**: gmail/calendar/drive/reminder, profile_get/save, favorites_get/save, subscription_get (개인화 근거 — 나를 파악)
- **engi(개발)**: github, 코드박스(웹훅·백엔드 연동)
