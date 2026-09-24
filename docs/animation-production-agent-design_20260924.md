# 애니메이션 제작 에이전트 파이프라인 — 설계·구현 지시문 v1

> 작성일: 2026-09-24
> 작성 근거: 한국대부금융협회 TVC 풀3D 제작 세션(안전한 운동장 편 · 계단 편, 2026-09-18~24)에서 사람 감독(NK)과 AI가 실제로 수행한 제작 흐름, 그리고 NK_Studio 저장소(`F:\NKW\App\NK_Studio`) 현행 코드 분석.
> 대상 독자: NK_Studio 개발 세션(Code). 이 문서 하나를 붙여 넣으면 구현 흐름을 지시할 수 있도록 작성했다.
> 상태: 설계 제안. 구현 순서는 9장, 완료 정의는 10장.

---

## 0. 이 문서를 받는 개발 세션에게

1. 먼저 저장소 규칙을 그대로 지킨다: `AGENTS.md` → `.trae/rules/nk-ai-studio.md` → `docs/prompt-rules.md` → `docs/storyboard-sheet-consistency-design.md`. 이 문서는 그 규칙 위에 **애니메이션(광고·에피소드) 제작 업무**를 얹는 것이며 기존 규칙을 대체하지 않는다.
2. 이 문서의 "현행" 서술은 2026-09-24 작업 트리(앱 버전 3.1899, 최신 커밋 `cc43c3ef`) 기준 코드 조사 결과다. 파일·행 번호가 어긋나면 코드가 우선이고, 어긋난 사실을 보고한다.
3. 구현은 9장의 P0→P4 순서로 하며, 단계마다 배포 가능해야 한다. 한 단계 안에서도 "데이터 모델 → 서버 도구 → 프롬프트 조립기 → 캔버스 표시 → 테스트" 순으로 간다.
4. 이 문서가 요구하는 것은 **새 화면을 많이 만드는 것이 아니다.** 사람이 채팅으로 지시하면 에이전트가 기존 도구·기존 캔버스·기존 승인 패널·기존 업무 탐색기 위에서 제작을 끝까지 끌고 가고, 사람은 정해진 게이트에서만 확인하는 구조를 만드는 것이다.
5. 한국어 파일은 UTF-8(BOM) 유지. 테스트 없이 핵심 경로를 확장하지 않는다(`docs/video-automation-commercial-roadmap.md` 1.3절).

---

## 1. 배경 — 실제로 검증된 제작 흐름

### 1.1 무슨 일이 있었나

- 발주사(한국대부금융협회)가 실사 감독컷을 반려하고 "이전에 본 애니메이션 스타일(풀3D)"로 다시 만들라고 요구했다. 피드백 PDF 1장과 카톡 이미지(8블록 콘티) 1장이 입력이었다.
- 사람 감독은 컨펌 순서를 **캐릭터 시트 → 스틸(스토리보드) → 영상** 으로 고정하고, 단계마다 직접 검토했다. 스토리보드 PPT는 영상 OK 이후에만 만들었다.
- AI는 다음을 수행했다: 피드백 원문 정리 → 샷리스트 → 캐릭터 시트(6회 반복 끝에 승인) → 앵글시트·소품시트·플레이트·텍스트 소품(전단·앱 UI)·연기시트 등 레퍼런스 17종 → 스틸 25컷(2×2 그리드 생성 후 크롭, 컷별 수정 라운드 2회) → 장소 단위 시퀀스 영상 5개(9~12초, Seedance 2.5 reference-to-video) → 문제 컷 재생성 → ffmpeg 러프컷 → 사람 편집(Premiere) → 편집본 분석(씬 검출·ASR) → 감독컷 PPTX/PDF(기존 콘티 템플릿) → 나레이션(Gemini TTS)·BGM(Suno) 프롬프트.
- 두 번째 에피소드(계단 편)는 같은 캐릭터·세계관을 재사용해 **한 번에 자율 진행**했다(레퍼런스 4종 → 스틸 11컷 → 시퀀스 3개 → 러프컷, 영상 비용 $8.75, 1차 통과).

### 1.2 이 흐름에서 얻은 결론(설계의 전제)

| # | 결론 | 근거 |
|---|---|---|
| A | **일관성은 문장이 아니라 이미지 자산이 만든다.** 캐릭터 시트·앵글시트·플레이트가 있으면 컷·시퀀스가 바뀌어도 인물·장소가 유지된다. | 앵글시트 없이 만든 v1 영상은 인물이 흔들렸고, 앵글시트 5장 + 플레이트를 역할 지정해 넣은 뒤 안정됨. `storyboard-sheet-consistency-design.md` 1절 원칙과 같다. |
| B | **역할 잠금(lock)이 있는 프롬프트가 재생성 횟수를 줄인다.** 캐스트·비율·축(스크린 디렉션)·손·소품 지속·한글 텍스트를 별도 블록으로 못 박는다. | 컷 9/10/22-23 재생성 원인이 모두 잠금 누락(인도 방향, 공을 든 팔, 인물 소실). 잠금 블록 추가 후 1회 통과. |
| C | **레퍼런스는 "누구인지"만, 구도·배경·포즈는 복사 금지를 명시**해야 한다. | 회색 배경 앵글시트를 넣으면 회색 배경·나열 포즈가 결과에 새어 나온다. |
| D | **영상은 컷이 아니라 장소 단위 시퀀스(9~12초)** 로 뽑고, 컷 길이는 "가이드"로만 준다. | 컷별 i2v는 연결이 끊기고 비용이 늘었다. 시퀀스 R2V가 자연스러운 하드컷 + 카메라 연출을 줬다. |
| E | **한글 텍스트는 이미지 생성 단계에서 렌더링**하고, 자소 힌트(`등=ㄷ+ㅡ+ㅇ`)와 `reads exactly:` 로 잠근다. 텍스트가 있는 컷은 그리드가 아니라 단일 이미지로 만든다. | 그리드 생성에서 "동록" 오타가 났고, 단일 생성+자소 잠금 후 해결. |
| F | **사람 게이트는 시트 단위**(컨택트 시트 한 장), 유료 단계 전에는 항상 고지+승인. 방식이 바뀌면 재승인. | I2V로 방식을 바꾼 재생성을 승인 없이 제출해 $2.1 낭비, 감독의 강한 지적. |
| G | **연출 의도를 규칙으로 승격**해야 "딸깍 영상"과 구분된다(3장). | "명령어 몇 줄로 나온 밋밋한 영상"이 반려 기준이었다. |
| H | **결과가 나오면 AI는 검토를 멈추고 사람이 본다.** 불필요한 자기 검수로 시간을 끌지 않는다. 단 기술 오류(비율·누락·손·텍스트)는 기본 확인. | 감독 지시 원문. |

---

## 2. 확립된 제작 프로세스(단계 정의)

아래 단계 이름·산출물·게이트는 그대로 시스템의 스테이지 이름이 된다.

| 단계 | ID | 입력 | AI 작업 | 산출물(자산) | 사람 게이트 |
|---|---|---|---|---|---|
| 0 브리프 | `brief` | 발주 텍스트, 피드백 문서, (있으면) 발주사 콘티 이미지 | 요구사항을 항목화, 금지·필수 정리, 8블록 내용 텍스트화. **발주사 콘티 이미지는 내용 파악에만 쓰고 생성 참조로 주입하지 않는다.** | `brief.md`(요구사항 표), 샷리스트 v1 | 요구사항 표 확인 |
| 1 캐릭터 | `character` | 브랜드 허브의 기존 캐릭터 시트 / 신규 요구 | 기존 시트가 있으면 **재사용**(생성 안 함). 신규면 참조 없이 순수 프롬프트로 시트 생성 → 승인 반복. 승인 시 브랜드 허브에 등록. | 캐릭터 시트(정면 대형·반측면·후면·표정4·동작4), 신체 스펙 텍스트 | **필수.** 시트 승인 전 다음 단계 금지 |
| 2 레퍼런스 | `reference` | 승인 캐릭터, 샷리스트의 장소·소품·텍스트 | 앵글시트(인물별), 소품시트, 장소 플레이트(정방향·리버스·와이드, 인물 없음), 텍스트 소품(전단·앱 UI 등 한글), 연기시트, (필요 시) 마스코트 비율 시트 | 레퍼런스 세트 + 색인 문서 | 컨택트 시트 1장 확인(선택. 감독이 "바로 스틸로" 하면 생략 가능) |
| 3 스틸 | `still` | 샷리스트, 레퍼런스 세트 | 컷별 프롬프트 조립(잠금 블록) → 2×2 그리드 생성·크롭(텍스트 컷은 단일) → 컨택트 시트 → 컷별 수정 라운드 | 컷 스틸(16:9), 스토리보드 컨택트 시트 | **필수.** 컷 단위 수정 지시를 받고 지정 컷만 재생성 |
| 4 영상 | `video` | 승인 스틸, 레퍼런스, 연출 의도 | 시퀀스 분할(장소·9~12초) → 시퀀스 프롬프트(REFERENCE ROLES + LOCKS + ACTING INTENT + SHOT list) → **비용 고지·승인** → 제출 → 프레임 그리드 QC → 문제 컷 재생성 | 시퀀스 클립(mov/mp4, last frame), 프레임 그리드 | **필수(유료).** 결과가 나오면 AI는 멈추고 사람이 확인 |
| 5 조립 | `assembly` | 시퀀스 클립 | 러프컷 concat, 길이표, 나레이션·BGM 프롬프트(Gemini TTS/Suno), 사람 편집본이 오면 분석(씬 검출·ASR·프레임 추출) | 러프컷 mp4, 오디오 프롬프트 md, 편집본 분석 | 사람 편집 |
| 6 보고 | `report` | 승인 자산 전부 | 컷표(컷·시간·오디오·사이즈·연출·메모) + 프레임 → 감독컷 PPTX/PDF(기존 콘티 템플릿), 진행 로그 갱신 | PPTX, PDF, 상태 문서 | 발표용 확인 |
| 7 배포 | `publish` | 최종 mp4, 캡션 | 채널별 초안 → 승인 → 게시 | 게시 기록 | **필수(외부 쓰기)** |

각 단계 산출물은 **회사 업무 탐색기(work library)와 제작 캔버스 양쪽**에 남아야 한다(8장).

---

## 3. 연출 원칙 — 시스템 규칙으로 승격할 감독 의도

프롬프트 조립기와 품질 게이트가 반드시 반영해야 하는 항목이다. 문구는 감독의 실제 지시에서 가져왔다.

1. **주인공은 사람.** 마스코트는 안내자·동반자. 예외(가족 구성원 설정)는 프로젝트에 명시된 경우만.
2. **연기 = 절제된 애니메이션식 과장.** "예비 동작 → 주동작 → 홀드"가 실사보다 한 단계 크고 또렷한 것. 고무 팔다리·상시 흔들림·슬랩스틱은 에피소드가 코믹 톤으로 지정된 경우에만. 감정이 큰 컷에만 배정, 일상 컷은 절제.
3. **카메라는 컷별로 의도.** 스냅 줌·휩·랙포커스·크레인·저공 돌리·턴어라운드·POV를 **지정 컷에만**. 얼굴 CU와 필로우 샷은 거의 고정.
4. **필로우 샷 필수.** 시퀀스마다 서사와 무관한 환기 인서트 1~2개(0.7~1.5초: 잎 사이 햇살, 곤충, 정지한 공, 전단 귀퉁이).
5. **배경은 로케이션 헌팅급.** 전경/중경/원경 깊이, 곡선 동선, 수관 프레임, 시간대 광선, 정돈된 디테일. "documentary"는 질감에만.
6. **축 고정(스크린 디렉션 락).** 인도·벽·트럭 진행 방향을 컷마다 재명시. 리버스 컷은 별도 플레이트.
7. **핸즈 락·소품 지속 락.** 누가 무엇을 어느 손에 들었는지, 컷 경계에서 인물이 사라지지 않음.
8. **텍스트 규칙.** 화면 텍스트는 허용된 소품(전단·앱·리본 라벨)만, `reads exactly` + 자소 힌트. 자막·로고·나레이션 문장은 프롬프트에 넣지 않는다(후반). 정식 로고는 AI로 만들지 않는다.
9. **풀3D 일관성.** 얼굴·몸·옷·손·신발·배경 모두 한 3D 세계. 실사 피부·사진 질감·실사 배경 합성 금지. 한국인 인상은 자연스럽게, 특정 스튜디오 복제 금지.
10. **자율성.** 프롬프트는 의도(INTENT)를 전달하고 실행 세부는 모델에 맡긴다. 숫자로 못 박는 것은 길이·축·인원·소품 같은 연속성 항목뿐.
11. **"딸깍" 금지.** 위 2~4가 하나도 없는 시퀀스 프롬프트는 품질 게이트에서 `warning`.

---

## 4. 승인·비용 게이트 규칙

1. 게이트 순서는 2장의 표를 따른다. 캐릭터 시트 미승인 상태에서 스틸·영상 도구는 실행을 거부한다(현행 `scene_still`의 `requireStoryboard`·`assertSetPlateReady` 와 같은 방식).
2. **유료 생성 전 고지 항목**: 공급자, 정확한 모델 ID, 해상도·길이, 생성 횟수, 예상 비용(USD 또는 크레딧), 예상 시간. 사용자 상한(`costControl.maxAmountUsd`)을 넘으면 실행하지 않는다.
3. **"승인"은 직전에 명시한 범위에만 유효.** 방식(R2V→I2V, 그리드→단일), 참조 세트, 구도가 바뀌면 무료 산출물(스틸)까지만 만들고 멈춘 뒤 재승인.
4. **재생성은 지정 컷만.** 지정하지 않은 컷을 함께 다시 만들지 않는다.
5. 무료 경로(ChatGPT 구독 커넥터)라도 몇 장 만들지 먼저 알린다.
6. 외부 쓰기(게시·삭제·덮어쓰기)는 기존 `gate` 도구 규칙 그대로.
7. 결과가 도착하면 자동 QC(기술 오류만) 후 **멈추고** 컨택트 시트/프레임 그리드와 함께 보고한다. 자기 판단으로 재생성하지 않는다.

---

## 5. NK_Studio 현행 구조와의 대응(재사용 지도)

### 5.1 에이전트 런타임(재사용)

- 에이전트는 텍스트 마커 `[[RUN: tool | {json}]]`, `[[CALL: agent | 지시]]`, `[[UI_ACTION: {...}]]` 를 쓰고 서버가 파싱·실행한다(`prototype/functions/api/agent/_orchestrator.ts` 853~868행). 도구 레지스트리는 `AGENT_TOOLS`(`_shared.ts` 7276행~), 프롬프트용 설명은 `MY_TOOL_DESCRIPTIONS`(`_orchestrator.ts` 368행~). `ToolDef = {agentId, agentIds?, kind: read|local|external, gate?, synthesize?, longRunning?, precheck?, approvalKey?, prepare?, run}`.
- 승인은 `agent_jobs.status='review_pending'` → `POST /api/agent/review {id, decision}`(`agent/review.ts`)로 실행. 승인 시 `fileJobAsWorkItem` 이 `company_work_items` 에 등록. 클라이언트 `Approvals.tsx` 는 4초 폴링.
- 비동기 대기는 예외 던지기 방식: 이미지 `throwPendingImage(imageJobId)`, 영상 `throwPendingVideo(videoJobId)`. `GET /api/agent/jobs` 폴링마다 `reconcileSubscriptionJobs` / `reconcileVideoJobs` 가 진행시킨다. 완료 메시지는 `addMessage({backgroundJobId})` 로 1회만 기록.
- 페르소나(11명): 코어(총괄) · 플롯(구조·컷) · 픽셀(이미지·영상) · 잉크(문안) · 비트(음향) · 리치(배포) · 싱크(PM·파일) · 레이더·엣지·마키·엔지. 애니메이션 제작은 **플롯·픽셀·비트·잉크·리치**를 쓰고 코어가 총괄한다.
- 텍스트 LLM 기본: 코어 `claude-opus-4-8`, 나머지 `claude-sonnet-4-6`(`_shared/cloud-models.js`).
- 플랫폼: Cloudflare Pages Functions(요청당 약 30초), Neon Postgres(`DATABASE_URL`), GCS. **프로젝트 payload·scenes 는 DB가 아니라 GCS `…/projects/{projectId}/reference/data.json`** 에 저장(`api/project/save.ts`).

### 5.2 SkillJob 플랫폼(재사용)

- 서버 레지스트리 `SERVER_COMPANY_SKILLS`(`agent/_company-skill-registry.ts` 23행): 현재 `infographic`, `video_pipeline` 두 개. 입력 정규화 `normalizeCompanySkillJobInput`(112행)에 스킬별 분기 필요.
- 실행기 `COMPANY_SKILL_EXECUTORS`(`_company-skill-executors.ts` 191행), 수명주기 `runCompanySkillJob`(207행): validating → planning → 비용 게이트 → 임대(lease) → running → `execute` → (`continueRunning` 이면 running 유지) → reviewing → completed.
- 상태·전이 `_skill-jobs.ts`; 이벤트 `company_skill_job_events(stage|agent-report|quality|warning|error|approval|artifact)`; 산출물 `company_skill_artifacts(kind source|preview|final|manifest|report)`; 저장 경로 `…/ai-company/work-library/{KST일자}/{workItemId}/…`.
- 비용 게이트 `_company-skill-costs.ts`: `video_pipeline` 은 대기 스텝이 있으면 항상 승인 필요, 금액은 `quoteCredits` 로 크레딧 표기. `actual_cost` 는 항상 `unavailable`(공급자 사용량 미회수).
- 엔드포인트: `POST /api/agent/skills/{skillId}/jobs`(`?wait=1`), `GET /api/agent/skill-jobs/{id}`, `/approve`, `/continue`, `/retry`, `/cancel`, `/artifacts`.
- **주의:** `video_pipeline` 의 배치 재개는 `VideoPipelinePanel.tsx` 가 열려 있을 때만 `continue` 를 호출한다(10초 간격). 패널을 닫으면 멈춘다. 애니메이션 파이프라인은 이 의존을 제거해야 한다(7.1).
- 클라이언트 `companySkills.ts` 에서 `video_pipeline` 카테고리가 `video-production`, 서버는 `design-content` 로 불일치(정리 대상).

### 5.3 생성 공급자(재사용)

| 용도 | 현행 경로 | 비고 |
|---|---|---|
| 이미지(시트·플레이트·스틸) | `/api/imagen`(`api/imagen.ts`). 사용자 설정이 ChatGPT 구독이면 `codex-images` 큐로 202 → 로컬 커넥터(`scripts/nk-codex-images.cjs`)가 생성·업로드. 아니면 Atlas(`google/nano-banana-2`, `openai/gpt-image-2*`) | 참조 최대 16장(Gemini 14). 구독 경로는 사용자 PC 커넥터가 켜져 있어야 함, 작업 20분 만료, 소유자당 1개 실행. **이 세션에서 쓴 `codex-imagegen` 스킬과 동일한 원리**(Codex app-server 내장 image_gen). |
| 영상 | `/api/video`(`api/video.ts`, `atlasOnly=true`). `seedance-2.5` → `bytedance/seedance-2.5/reference-to-video`(4~30초), `seedance-r2v`(2.0), `veo`, `veo-full`, `kling*`, `wan`, `vidu-q3`, `grok*` | 이 세션의 채택 모델 = Seedance 2.5 R2V 720p($0.30/s). 엔드카드는 I2V. `return_last_frame`, mov 출력 옵션이 서버 계약에 있는지 P1에서 확인. |
| 이미지 역프롬프트/검수 | `/api/imagen-describe` | 자동 QC(한글 오타·손·텍스트 유무)에 활용 |
| 음향 | `music`(ElevenLabs BGM), `sound`(SFX), `narration`(Google TTS), `voice_generate` | 이 세션에서는 ElevenLabs 나레이션이 "AI 티"로 반려되어 **Gemini TTS 프롬프트 산출 + 사람 생성**으로 대체. Suno BGM은 프롬프트만 산출. |
| 최종 조립 | `render_final` → `/api/postprod/transcode` | 러프컷 concat 용도로 재사용 |
| PPT | `ppt` 도구, `pptxgenjs`(ai-company-app 의존성) | 감독컷 PPTX 생성에 재사용 |

### 5.4 데이터·캔버스(재사용 + 확장 대상)

- 캔버스 노드 타입은 고정: `common | location | character | cut`, 엣지 `sequence | cutRef | location | character | commonOverride`(`ai-company-app/src/lib/api.ts` 1968행). 레인 `prompt | scene | characters | locations`. 배치는 `payload.canvasLayout`. 그래프는 서버 `agent/production-graph.ts` 가 `data.json` 에서 만든다. **캔버스는 `/api/project/save` 를 직접 부르지 않고 모든 쓰기는 에이전트 잡**(계약 테스트 `prototype/tests/agent-mode-canvas-contract.test.mjs`).
- `cut` 노드: `still{url,ref,history}`, `clip{url,status,jobId}`, `storyboard{sheetId,panelIndex,status,url}`, 카메라 어휘(`shotType, cameraMove, cameraDirection, cameraElevation`), `beats`, `lineage`. 배지 "콘티/스틸/스틸 생성 중".
- `location` 노드: `angle-top` 부감 마스터, `variants[]`, `setSheet`. 배지 "부감 마스터/바이블/플레이트".
- `character` 노드: `payload.characters[]` 의 `token, name, description, imageUrl`. **바이블 캐릭터 시트(`storyboardSheets[kind=bible-characters]`)는 저장만 되고 그래프·캔버스가 읽지 않는다.**
- 기존 자산 등록 `POST /api/agent/production-assets` 의 `target` 은 `cut | location` 만.
- 시트 모델 `payload.storyboardSheets[]`(`kind: bible-characters|bible-set|board`, `panels[{index, role, ref, objectName, status, label}]`, `stale`). 서버 프롬프트 빌더 `_shared/storyboard-sheet.js`(`planSheets`, `buildBibleCharacterSheetPrompt` 3×3, `buildBibleSetSheetPrompt` 2×2, `SET_ANGLES`, `CHARACTER_ANGLES`). 생성·크롭·패널 승인 UI는 프로토타입(`prototype/ui/pipeline-storyboard-sheet.js`)에 있음.
- 브랜드 허브(GCS `…/brands/{brandId}/reference/data.json`): `characterSheets[{characterId, displayName, token, items[{sheetId, imageDataUrl(gs://), isPrimary}]}]`(캐릭터당 ≤4), `brandCharacters[{trigger, name, description, negativePrompt}]`, `environmentAssets[{token, kind: background|prop, items[]}]`(≤16), `brandVoice/worldSetting/brandRules/bannedExpressions`. 신체 스펙은 **자유 텍스트 2칸**(`description`, `negativePrompt`)이고 `body-grammar.js` 가 부정문을 규칙화한다. 등록 도구 `brand_asset`(gate, `prepare`), `ip_describe`, `ip_text_save`.
- 배포: `publish`(gate, `prepare`) → `/api/sns/publish`; 채널 `instagram, youtube(shorts), tiktok(초안함 inbox), threads, x, facebook`; 예약은 YouTube만. `publish_history`, `sns_channels_status`.
- 업무 탐색기: `company_work_items`, 가상 날짜 폴더 `@work/{date}/{workId}`, `company-files.ts`.

---

## 6. 갭 분석 — 지금 없는 것

| # | 갭 | 영향 | 해결 절 |
|---|---|---|---|
| G1 | **애니메이션 제작 전체를 끌고 가는 Skill/실행기가 없다.** `video_pipeline` 은 "승인 콘티 → 스틸 → 컷별 영상"만 하고, 브리프·캐릭터·레퍼런스·시퀀스·보고·배포 단계가 없다. | 사람이 단계마다 도구를 지시해야 함 | 7.1 |
| G2 | **레퍼런스 자산 유형이 부족.** 앵글시트(인물), 소품시트, 방향별 플레이트(정방향/리버스/와이드), 텍스트 소품(한글 전단·앱 UI), 연기시트, 비율 시트를 담을 모델·도구·카드가 없다. `set_angle` 은 부감 파생 방위, `environmentAssets` 는 브랜드 범위. | 영상 R2V 참조 세트를 구성할 수 없음 | 7.2, 7.3 |
| G3 | **시퀀스(장소 단위 영상 생성 단위) 개념이 없다.** 컷별 i2v 만 있음. Seedance 2.5 R2V 의 다중 참조·역할 지정·`return_last_frame` 계약이 서버 도구에 노출되어 있지 않음(확인 필요). | 검증된 방식(D)을 재현 불가 | 7.2, 7.3, 7.5 |
| G4 | **잠금 블록 기반 프롬프트 조립기가 없다.** 현행 조립기는 컷 분해 어휘 + 공통 헤더 + 시트 참조. CAST/PROPORTION/SCREEN DIRECTION/HANDS/PERSISTENCE/TEXT(자소)/ACTING INTENT/CAMERA INTENT 블록이 없다. | 재생성 반복 | 7.4 |
| G5 | **캐릭터 신체 스펙이 구조화되어 있지 않다**(자유 텍스트 2칸). 비율(마스코트 키 = 성인 무릎 등)·의상 고정 문구·금지 부위가 필드로 없다. | 컷마다 비율 흔들림 | 7.2 |
| G6 | **바이블 캐릭터 시트를 캔버스가 읽지 않고**, `sheetPanelRef` 가 `normalizeLineage` 화이트리스트에 없어 저장 시 소실. | 시트 자산이 화면에서 보이지 않음 | 7.8, P0 |
| G7 | **컨택트 시트/프레임 그리드 형식의 보고가 없다.** 채팅 보고는 텍스트, 산출물은 개별 이미지. | 사람이 시트 단위로 승인할 수 없음 | 7.7 |
| G8 | **감독컷 문서(PPTX/PDF) 자동 생성 경로가 없다.** `ppt` 도구는 범용. | 발표·인계 수작업 | 7.7 |
| G9 | **편집본 분석(씬 검출·ASR·대표 프레임)이 없다.** | 사람 편집본 기준 콘티 재작성 수작업 | 7.7 (P4) |
| G10 | 파이프라인 재개가 브라우저 패널 폴링에 의존(`continue`). | 채팅에서 시작한 잡이 멈춤 | 7.1 |
| G11 | `production-assets` 타깃이 `cut|location` 만. 캐릭터·레퍼런스·시퀀스에 기존 이미지를 붙일 수 없음. | 사람이 만든 자산 등록 불가 | 7.8 |
| G12 | 발주사 콘티 이미지처럼 **"내용만 읽고 참조로 주입하지 않는" 입력 구분**이 없다(`references[].role` 에 `brief-only` 없음). | 발주사 구도 복제 위험 | 7.1 입력 계약 |
| G13 | 실제 공급자 비용 회수(`actual_cost`) 없음. | 보고서 비용 칸 공백 | 7.5 (P3) |

---

## 7. 목표 설계

### 7.1 새 Skill `animation_production`(SkillJob)

- ID: `animation_production`, 카테고리 `video-production`(클라이언트·서버 동일하게 맞춘다), 실행기 `animation-production-adapter-v1`, 입력 스키마 `company-skill/animation-production/v1`, 권한 `project-write`, 비용 정책 `estimate-before-paid-provider`.
- 호출 방식 두 가지(채팅 `agent` / 캔버스 패널 `manual`)는 같은 `SkillJobInput` 을 쓴다(마스터 플랜 3.1절).
- **입력 계약(`options`)**

```ts
type AnimationProductionOptions = {
  projectId: string;                 // 제작 캔버스 프로젝트(에피소드)
  brandId?: string;                  // 캐릭터·세계관 원천
  episodeBrief: string;              // 발주 텍스트(요구사항 원문)
  storyBlocks?: string[];            // 발주사 콘티의 블록별 내용(텍스트화). 이미지 자체는 넣지 않는다
  style: 'full-3d' | 'live-3d-mascot' | '2d-motion'; // AGENTS 스타일 기준
  mood?: string;                     // 예: "어두운 배경 + 슬랩스틱 코믹"
  targetDurationSec?: number;        // 콘텐츠 우선, 패딩 금지
  aspectRatio: '16:9' | '9:16' | '1:1';
  stages: Array<'brief'|'character'|'reference'|'still'|'video'|'assembly'|'report'|'publish'>;
  gates: { character: 'required'; reference: 'optional'|'required'; still: 'required'; video: 'required'; publish: 'required' };
  image: { provider: 'chatgpt-subscription'|'atlas', size: '2K'|'4K' };
  video: { model: 'seedance-2.5', resolution: '720p'|'1080p', sequenceSecMin: 9, sequenceSecMax: 12, returnLastFrame: true };
  textLocks?: Array<{ id: string; reads: string; jamoHint?: string; where: string }>; // 한글 화면 텍스트
  reuse: { characters: 'existing-first' };  // 기존 시트 있으면 생성 금지
  autonomy: 'gate-only' | 'ask-each-step';  // 계단 편처럼 한 번에 진행 vs 단계마다 질문
};
```

- `references[].role` 에 **`brief-only`** 를 추가한다. 이 역할의 이미지는 코어·플롯이 내용을 읽는 데만 쓰고, 어떤 생성 호출에도 첨부되지 않는다(G12). 실행기와 조립기 양쪽에서 필터링하고 테스트로 고정한다.
- **스테이지 = 2장의 ID.** `execution_plan.stages[{id, status: pending|running|awaiting-approval|done|skipped|failed, gate, artifacts[], costEstimate}]`. `current_stage` 에 기록.
- **게이트 대기**는 `approval_state` 가 아니라 **스테이지 단위 승인 이벤트**로 처리한다. `POST /skill-jobs/{id}/approve {decision, scope: {stageId, gateId}}` 로 확장(현행 `hasMatchingCostApproval` 의 `scope.gateId` 매칭을 스테이지에도 적용). 승인되지 않은 스테이지는 실행하지 않는다.
- **재개(G10):** `continueRunning` 잡은 `GET /api/agent/jobs` 폴링 시 `reconcileVideoJobs` 옆에 `reconcileAnimationJobs` 를 두어 **채팅 화면·승인 패널·캔버스 어느 쪽이 열려 있어도** 진행한다. 30초 한도 안에서 스텝 하나만 처리하고 임대를 해제한다.
- **범위 잠금:** 재생성 요청은 `revision {stageId, targetIds: sceneId[]|sequenceId[], approach: 'same'|'changed'}` 로 받는다. `approach='changed'` 이면 무료 산출물까지 만든 뒤 `awaiting-approval` 로 멈춘다(4장 3항).
- 에이전트 배정: 코어(총괄·보고), 플롯(브리프·샷리스트·시퀀스 분할·컷표), 픽셀(시트·레퍼런스·스틸·영상 프롬프트·QC), 잉크(한글 텍스트 소품 문안·나레이션 대본), 비트(TTS/BGM 프롬프트·오디오 분석), 리치(배포). 업무 보고는 `agent_reports` + `agent-report` 이벤트로.

### 7.2 데이터 모델 확장(`data.json` payload · scene)

모든 추가 필드는 **저장 화이트리스트 4곳**(`project/save.ts` `normalizeScene`/`normalizeLineage`, `get.ts`, pipeline 재조립, 컷 평탄화)에 넣고 체인 테스트를 둔다(설계서 3.3절 규칙).

**(a) 캐릭터 구조화 스펙 — 브랜드 `brandCharacters[]` 와 프로젝트 `payload.characters[]` 공통**

```ts
bodySpec: {
  species: 'human' | 'mascot' | 'animal' | 'object';
  ageLook?: string;              // "late thirties"
  heightRef?: string;            // "adult knee height", "170cm"
  proportionLock?: string;       // 마스코트: "head:body 1:1, never taller than an adult's knee"
  wardrobeLock: string[];        // ["light heather-grey henley", "dark indigo jeans", "white low-top sneakers"]
  faceLock?: string;             // "short black side-parted hair, warm almond eyes"
  absentParts: string[];         // ["fingers"] → body-grammar 연동
  handedness?: 'left'|'right';   // 소품 기본 손
  ethnicityHint?: 'korean-natural'; // 노골적 표현 금지, 자연스러운 인상
}
sheets: { character?: AssetRef; angle?: AssetRef; expression?: AssetRef; acting?: AssetRef }; // 브랜드 characterSheets items 와 연결(sheetId)
```
`description/negativePrompt` 는 유지하되 조립기는 `bodySpec` 이 있으면 그것을 CAST LOCK 문장으로 컴파일한다. `bodySpec` 이 없고 시트만 있으면 현행 `CHARACTER_BODY_SPEC_REQUIRED` 규칙대로 보완을 요청한다.

**(b) 레퍼런스 키트 — `payload.referenceKit`**

```ts
referenceKit: {
  items: Array<{
    id: string;
    kind: 'angle-sheet' | 'prop-sheet' | 'plate' | 'text-prop' | 'acting-sheet' | 'proportion-sheet' | 'style-anchor';
    label: string;                       // "앵글시트-아빠", "플레이트-골목-리버스"
    subject?: string;                    // characterToken | locationId | propName
    plate?: { locationId: string; view: 'forward'|'reverse'|'wide'|'top'|'detail'; screenSide?: 'sidewalk-left'|'sidewalk-right' };
    textLockId?: string;                 // text-prop 이 잠근 한글
    objectName: string;                  // GCS
    status: 'pending'|'approved'|'rejected';
    prompt: string; version: number; createdAt: string;
    doNotCopy: string[];                 // ["grey studio background", "row layout", "neutral pose"] → REFERENCE ROLES 에 자동 삽입
  }>;
  contactSheetObjectName?: string;       // 레퍼런스 컨택트 시트
}
```
장소 플레이트는 기존 `episodeLocations[].variants` 에 `id: 'view-forward'|'view-reverse'|'view-wide'` 로도 미러링해 현행 `scene_still` 의 세트 준비 게이트(`assertSetPlateReady`)와 호환한다.

**(c) 컷(scene) 추가 필드**

```ts
sequenceId?: string;                 // 영상 생성 단위
screenDirection?: { sidewalk?: 'left'|'right'; travel?: 'toward-camera'|'away'|'left-to-right'|'right-to-left'; reverseOf?: sceneId };
handsLock?: string;                  // "ball under the father's LEFT arm"
persistence?: string[];              // 컷 경계에서 유지할 인물·소품
textLockIds?: string[];
actingIntent?: { level: 'calm'|'clear'|'big'; note: string };   // 3장 2항
cameraIntent?: { move: 'static'|'snap-zoom'|'whip'|'rack-focus'|'push-in'|'crane'|'low-dolly'|'turnaround'|'pov'|'tilt'; note: string };
isPillow?: boolean;
sheetPanelRef?: { sheetId, panelIndex, objectName };  // 설계서 3.3 — 최상위 필드로 승격, 화이트리스트 추가(G6)
gridSource?: { sheetObjectName, cell: number };       // 2×2 그리드에서 크롭된 경우
```

**(d) 시퀀스 — `payload.sequences[]`**

```ts
sequences: Array<{
  id: string; label: string;              // "S1 골목 사건"
  locationId: string; cutIds: string[];  // 순서 스냅샷(시트와 같은 stale 규칙)
  targetSec: number;                     // 9~12
  referenceIds: string[];                // referenceKit.items.id, 제출 순서 = @Image 번호
  keyStillSceneIds?: string[];           // 구도 참조로 넣을 스틸
  prompt: string; promptVersion: number;
  model: 'seedance-2.5'; resolution: '720p'|'1080p'; generateAudio: boolean; returnLastFrame: boolean;
  submissions: Array<{ predictionId, videoJobId, status, objectName?, lastFrameObjectName?, frameGridObjectName?, costUsd?, submittedAt }>;
  approvedSubmissionId?: string;
  status: 'draft'|'awaiting-approval'|'submitted'|'qc'|'approved'|'rejected'|'stale';
}>;
```

**(e) 보고·조립 — `payload.production`**

```ts
production: {
  brief: { requirements: Array<{id, text, source, mustNot?: boolean}>; storyBlocks: string[]; shotListObjectName?: string };
  roughCut?: { objectName, durationSec, cutTable: Array<{cut, in, out, sequenceId}> };
  editAnalysis?: { sourceObjectName, cuts: Array<{n, in, out, frameObjectName, transcript?}>, transcriptObjectName? };
  audioPrompts?: { narration?: objectName; bgm?: objectName };
  directorCut?: { pptxObjectName, pdfObjectName, version: number };
  statusLog: Array<{ at, stage, summary, costUsd? }>;
}
```

### 7.3 에이전트 도구(신규·확장)

모두 `AGENT_TOOLS` 에 `ToolDef` 로 추가하고 `MY_TOOL_DESCRIPTIONS` 에 설명을 넣는다. `IMAGE_PRODUCING_TOOLS` 에 이미지 생성 도구를 추가해 구독 큐 대기·재개가 그대로 동작하게 한다.

| 도구 | 소유 | kind | gate | 역할 |
|---|---|---|---|---|
| `anim_brief` | plot(+core) | read | – | 브리프·`brief-only` 이미지에서 요구사항 표·스토리 블록·샷리스트 v1 생성. `payload.production.brief` 저장은 `project_save` 로. |
| `character_resolve` | pixel(+core) | read | – | 브랜드 허브에서 토큰별 기존 시트·bodySpec 유무를 조회. "재사용/신규 필요" 판정만 한다. |
| `character_sheet` | pixel | external | **G** | 신규 캐릭터 시트 생성(참조 없음, 순수 프롬프트, 라운드 번호·이전 반려 사유를 프롬프트에 반영). 승인 시 `brand_asset` 등록까지 연결. |
| `character_bodyspec_save` | pixel(+core) | local | **G** | 구조화 bodySpec 저장(브랜드·프로젝트). |
| `reference_plan` | pixel(+plot) | read | – | 샷리스트에서 필요한 레퍼런스 목록(인물별 앵글시트, 장소별 플레이트 뷰, 소품, 텍스트 소품, 연기시트)과 장수·예상 비용 산출. |
| `reference_generate` | pixel | external | **G** | `referenceKit` 항목 생성. `kind` 별 프롬프트 템플릿(7.4). 텍스트 소품은 단일 이미지 + 자소 잠금. |
| `reference_contact_sheet` | pixel(+core) | local | – | 승인 대상 항목을 격자 한 장으로 합성(서버 캔버스 또는 클라이언트 크롭 유틸 재사용) → GCS. 보고 메시지에 첨부. |
| `still_prompt_build` | pixel(+plot) | read | – | 컷별 잠금 블록 프롬프트 조립·미리보기(생성 안 함). 감독이 프롬프트를 먼저 보고 싶을 때. |
| `still_generate` | pixel | external | **G** | 컷 스틸 생성. 텍스트 락이 있는 컷은 단일, 나머지는 2×2 그리드 → 여백선 검출 크롭(`storyboard-sheet.js` 크롭 재사용) → 각 컷 `imageDataUrl` + `gridSource`. 기존 `scene_still` 을 대체하지 않고 **`mode:'animation'`** 옵션으로 확장하는 것도 허용(중복 구현 금지). |
| `storyboard_contact_sheet` | pixel(+core) | local | – | 승인 스틸을 컷 번호 순으로 4×N 컨택트 시트로 합성. |
| `sequence_plan` | plot(+pixel) | read | – | 장소·길이 규칙으로 컷을 시퀀스로 묶고 참조 세트·예상 비용 산출. `payload.sequences` 초안. |
| `sequence_prompt_build` | pixel(+plot) | read | – | 7.4의 시퀀스 프롬프트 템플릿으로 조립. 3장 규칙 검사 결과(`warnings`) 동봉. |
| `sequence_video` | pixel | external | **G** | Seedance 2.5 R2V 제출(`/api/video` 확장, 7.5). `videoJobId` pending → 완료 시 `submissions[]` 갱신, 프레임 그리드 생성, 컷 QC 메모. |
| `sequence_frame_grid` | pixel | local | – | 완성 클립을 2fps 타일 그리드로 만들어 GCS 저장(QC·보고용). 서버에서 ffmpeg 가 없으므로 **로컬 커넥터 확장 또는 Atlas/외부 프레임 추출 API** 중 하나를 P2에서 결정. |
| `rough_cut` | pixel(+plot) | external | – | 승인 시퀀스를 순서대로 concat(`render_final` 재사용) + 컷표 저장. |
| `audio_prompts` | beat(+ink) | read | – | 나레이션 대본·톤(Gemini TTS AI Studio 형식), BGM 감정 곡선·Suno 스타일 프롬프트 산출(md). |
| `edit_analysis` | pixel(+plot) | external | – | 사람 편집본 mp4 → 씬 검출·대표 프레임·ASR(Atlas Seed ASR 등) → `production.editAnalysis`. (P4) |
| `director_cut_doc` | plot(+ink) | external | **G** | 컷표 + 프레임으로 감독컷 PPTX/PDF(4컷/페이지, 편집 가능 텍스트, 정식 로고). `pptxgenjs` 또는 템플릿 복제. 업무 탐색기에 `final`+`report` 로 등록. |
| `production_status_log` | core(+sync) | local | – | `production.statusLog` 추가 + 업무 항목 요약 갱신(PROJECT_STATUS 역할). |
| `publish` | reach | – | G | 기존 도구 그대로. 입력에 `sequences`/`roughCut` 산출물 참조 허용. |

`animation_production` 실행기는 위 도구를 **내부 함수로 직접 호출**한다(현행 `_video-pipeline-executor.ts` 가 `AGENT_TOOLS.scene_still.run` 을 부르는 방식). 채팅에서 단일 도구를 따로 부르는 것도 가능해야 한다(감독이 "컷 4만 POV로 다시" 처럼 지시할 때).

### 7.4 프롬프트 조립기 — `functions/api/_shared/animation-prompts.js`(신규, 순수 함수)

기존 `storyboard-sheet.js`·`prompt-assembly.js`·`body-grammar.js`·`buildHubContext` 를 재사용하고, 그 위에 잠금 블록을 쌓는다. 모든 블록은 **영어 문장**, 한글은 `reads exactly:` 안에만.

**(a) 스틸·레퍼런스 공통 골격(순서 고정)**

```
[HEAD]        생성 지시 한 줄("Generate the image directly. No planning, no questions.")  ← 구독 커넥터 경로에서 필수
[HUB]         buildHubContext(payload): 톤·세계관·브랜드 규칙·금지 표현
[STYLE]       스타일별 고정 문단. full-3d: "fully computer-animated 3D feature film … ENVIRONMENTS ARE ANIMATION TOO … nothing photographic, nothing 2D/anime … quietly Korean features"
[MOOD]        에피소드 무드(선택). 예: dusk storm + comic slapstick + CITY LOCK(no castles/spires/…)
[CAST LOCK]   화면에 나오는 캐릭터만. bodySpec → "FATHER - Korean, late thirties, … ; light heather-grey henley, dark indigo jeans, white low-top sneakers."
[PROPORTION LOCK] 마스코트·아동 비율 문장
[LOCATION]    플레이트 서술(정방향/리버스 중 이 컷의 뷰) + 로케이션 미감 지시(3장 5항)
[SCREEN DIRECTION LOCK] scene.screenDirection → "sidewalk on the LEFT, truck comes toward camera"
[HANDS / PERSISTENCE LOCK] scene.handsLock, persistence[]
[TEXT LOCK]   textLocks → "reads exactly: 등록 대부업체 … every syllable correctly formed (등 = ㄷ+ㅡ+ㅇ) … No other text anywhere."  텍스트 없는 컷: "Absolutely no text, letters, numbers, logos or watermarks."
[LAYOUT]      SINGLE(16:9 one still, heads inside with headroom) | GRID(2×2, thin white gutters, each cell complete 16:9)
[SHOT]        컷 번호, 사이즈·앵글·높낮이(현행 cameraHintOf), 화면 t=0 서술(composition), 연기 포즈(actingIntent), 필로우면 "No people."
```
규칙: 텍스트 락이 있는 컷 → 항상 SINGLE. 앵글시트·연기시트는 `plain very light warm-grey studio background` + `no text/labels/numbers`. 플레이트는 `NO people, NO mascot`.

**(b) 레퍼런스 kind 별 템플릿**

- `angle-sheet`: 한 줄에 정면·3/4·측면·후면 전신 + 표정 3(선택). 캐릭터 시트가 아니라 **영상 참조용**이므로 배경 무지·포즈 중립.
- `prop-sheet`: 소품 여러 개를 한 장에 나열(디자인만). 
- `plate`: view 별(forward/reverse/wide/top). reverse 는 `set-plates.js` 의 REVERSE ANGLE 지시문 재사용 + `screenSide` 반전 명시.
- `text-prop`: 실물 크기 정면, 문안은 잉크가 작성한 `reads exactly` 목록, 허접해 보이지 않게 실제 디자인(앱 UI = 앱 이름·헤드라인·버튼).
- `acting-sheet`: 상단 4 포즈·하단 4 포즈, 컷의 큰 연기만 골라 넣음.
- `proportion-sheet`: 성인·아동·마스코트 나란히 눈높이선.

**(c) 시퀀스 영상 프롬프트 템플릿(Seedance 2.5 R2V)**

```
FORMAT: {sec} seconds, {aspect}, 24fps, real-time speed. Coverage for a {목적}, built as a sequence of clean hard cuts. Shot durations below are guides, not rules.
STYLE: {STYLE 블록}
REFERENCE ROLES: @Image1 is the FATHER … Use it only for who he is; do not copy its grey studio background, its row layout or its neutral standing pose. @Image3 is the LANE seen forward … Use it for every shot except shot 9. …   ← referenceKit.items 순서 + doNotCopy 자동 생성
SCREEN DIRECTION LOCK / FRAMING LOCK(whole heads inside) / SEASON LOCK / PROPORTION LOCK / RIBBON LOCK(프로젝트 소품) / HANDS LOCK / PERSISTENCE LOCK
ACTING INTENT: this is an animated film … anticipation, strong pose, short hold, one step bigger than real people … Big acting belongs only to shots {big}; shots {calm} are calm.
SHOT n, ~{sec}s, {size/angle}, {camera intent}: {action · gaze · pose}. {location sound / short line "…"}   ← 컷마다 한 문단, 필로우 샷 포함
CONTINUITY: same people, same clothes, same props, same light. Exactly {n} people.
AUDIO: location sound only … the spoken lines "…" exactly as written. No music. No narration. No voice-over. No subtitles.   ← 금칙어(chime/bell 등 저작권 필터 유발) 자동 제거
CONSTRAINTS: no on-screen text/logos/watermarks. No injury. No slow motion. No duplicated people. Five fingers per hand. Not photographic, not 2D.
```
조립기는 3장 규칙 검사기를 내장한다: 카메라 의도 컷 0개, 필로우 샷 0개, 큰 연기 컷이 전체의 50% 초과, 나레이션 문장 포함, 텍스트 락 없는 화면 텍스트 → `warnings[]`(막지 않음, 감독 판단).

### 7.5 생성 라우팅·비용

- **이미지**: 현행 `/api/imagen` 라우팅을 그대로 쓴다. 사용자 이미지 설정이 ChatGPT 구독이면 커넥터 큐(비용 0, NK 크레딧 미차감), 아니면 Atlas. 참조 상한(16장/12MB)을 조립기가 미리 검사한다. 시트류는 기본 `2K`, 텍스트 소품·스틸은 `2K`, 시트 셀이 작으면 `4K` 옵션(설계서 2.2.1).
- **영상**: `/api/video` 의 `seedance-2.5` 경로에 **다중 참조 이미지(역할 순서 보존)·`generate_audio`·`return_last_frame`·출력 컨테이너**를 서버 계약으로 노출한다(현재 지원 여부를 P1 초에 코드로 확인하고, 없으면 `video-specs.ts` 와 `video.ts` 에 추가). 엔드카드·정지 그림 컷은 `bytedance/seedance-2.5/image-to-video`(첫/끝 프레임).
- **비용 고지 표준 문장**(채팅·패널 공통): `공급자 Atlas Cloud · 모델 bytedance/seedance-2.5/reference-to-video · 720p · 12초 × 1회 · 예상 $3.60 · 약 4~6분 · 현재 잔액 $18.26`. 잔액은 `/api/credits/quote` 또는 Atlas balance 조회로 채운다. 잔액이 부족하면 제출하지 않고 충전 필요 금액을 말한다.
- **실비 회수(G13)**: Atlas prediction 응답의 사용량·요금 필드가 있으면 `provider_usage`/`actual_cost` 에 기록(P3).
- **TTS/BGM**: 자동 생성하지 않는다(반려 이력). 프롬프트 산출까지만 하고, 감독이 요청할 때만 `narration`/`music` 도구 사용.

### 7.6 품질 게이트

자동 검사(기술 오류만, `passed|warning|failed`):
- 비율·해상도(16:9, 크롭 경계 깨짐), 파일 무결성.
- 텍스트: 텍스트 락 컷은 `/api/imagen-describe` 로 화면 문구를 읽어 `reads` 와 비교(불일치 = `failed`). 텍스트 없는 컷에 문자가 보이면 `warning`.
- 캐스트: 시트 대비 색·의상 키워드 일치(describe 결과 비교, `warning`).
- 축·손·인원: 프롬프트 락과 describe 결과의 좌우·인원 불일치 → `warning`.
- 3장 규칙 검사기(7.4) 결과.
- 영상: 길이 오차, 프레임 그리드 생성 성공, `last_frame` 존재.

사람 게이트는 **시트 단위**다. 컨택트 시트(캐릭터·레퍼런스·스토리보드) 또는 프레임 그리드(영상) 한 장과 표를 함께 보내고 `awaiting-approval` 로 멈춘다. `failed` 가 있으면 대표안 확정을 막고 지정 항목 재생성만 제안한다(자동 재생성 금지).

### 7.7 보고 형식

- **단계 완료 메시지(채팅)** — 고정 형식:
  1) 한 줄 결과(무엇을 몇 장/몇 초, 비용) 2) 컨택트 시트/프레임 그리드 이미지 3) 표(항목·상태·QC·메모) 4) 다음 게이트 요청 한 문장("승인하시면 S1·S2·S4 를 동시 제출합니다. 예상 $9.30"). 감독의 지시 표현("승인", "이 컷만", "멈춰")을 그대로 인식한다.
- **업무 보고(`agent_reports`)**: 에이전트명·상태·결정과 근거·산출물·남은 위험(마스터 플랜 6장 형식).
- **감독컷 문서**: 기존 콘티 PPTX 규격(16:9, 4컷/페이지, 컷 라벨·타임·오디오·연출 텍스트 상자, 마지막 페이지 4컷 미만이면 제작 확인 사항 박스, 정식 로고). `director_cut_doc` 은 `final`(pptx, pdf) + `report`(컷표 json) 로 업무 탐색기에 등록하고 `production.directorCut` 에 경로 저장. 렌더 검수 PNG 를 `preview` 로 저장.
- **상태 로그**: 단계마다 `production.statusLog` 와 업무 항목 요약을 갱신해 새 세션·다른 에이전트가 이어받을 수 있게 한다.

### 7.8 제작 캔버스 등록

원칙: 캔버스 계약(고정 노드 타입, 쓰기는 잡으로만)을 지키면서 **최소 확장**한다.

1. `character` 노드 데이터 확장: `sheetUrl`(브랜드 대표 시트), `angleSheetUrl`, `bodySpecSummary`, `approved`. 그래프가 `storyboardSheets[kind=bible-characters]` 와 `referenceKit(angle-sheet)` 를 읽어 채운다(G6). 배지 "시트 승인/미승인".
2. **새 노드 타입 `reference`**(레인 `references`): `referenceKit.items` 1건 = 카드 1개. 배지 = kind 한글(앵글시트·소품·플레이트·텍스트·연기). 클릭 시 프롬프트·버전·`doNotCopy` 표시. 승인/거절은 잡(`reference_review`)으로. 계약 테스트의 고정 타입 목록에 `reference` 를 추가하고 문서화한다.
3. `location` 노드: `variants` 에 `view-forward/reverse/wide` 를 표시(기존 `angle-top` 옆), 배지 "정방향/리버스/와이드".
4. `cut` 노드: `sequenceId` 별 색 띠, `cameraIntent`/`isPillow` 아이콘, `textLockIds` 아이콘, 배지 "콘티/스틸/영상(시퀀스 S1)". 그리드 크롭 컷은 `gridSource` 툴팁.
5. **새 노드 타입 `sequence`**(씬 레인 위 묶음 바로 표시, 별도 카드 아님): 컷 묶음·길이·상태·클립 재생·프레임 그리드·비용. 승인/재생성 버튼은 잡으로.
6. `production-assets` 타깃 확장: `{type:'character', token}`, `{type:'reference', kind, subject}`, `{type:'sequence', sequenceId}` — 감독이 직접 만든 이미지·클립을 등록할 수 있게(G11).
7. 캔버스 에이전트 모드 접두사(`[캔버스 프로젝트 … 선택 컷 …]`)에 **선택 시퀀스·선택 레퍼런스**를 추가해 "이 시퀀스만 다시" 지시가 서버에서 해석되게 한다. `UI_ACTION_ALLOWLIST` 에 `canvas.focusSequence`, `canvas.focusReference` 추가.
8. 새 UI 는 만들지 않는다: 승인은 기존 승인 패널, 산출물은 기존 업무 탐색기, 진행은 기존 `VideoPipelinePanel` 을 일반화한 `ProductionPipelinePanel`(스테이지 목록·게이트·비용) 하나만.

### 7.9 배포

- 최종 mp4(또는 감독 편집본 업로드본)를 `sequences`/`roughCut` 산출물로 지목 → 기존 `publish` 도구가 채널별 초안을 만들고 승인 후 게시. TikTok 은 초안함 규칙 유지. 감독컷 PDF 는 게시물이 아니라 업무 탐색기 공유 링크로.
- 배포 결과는 `publish_history` 로 확인하고 `production.statusLog` 에 남긴다.

---

## 8. 저장 위치 규칙(자산이 두 곳에 보여야 한다)

| 자산 | 프로젝트(`data.json`) | 업무 탐색기(work library) | 캔버스 |
|---|---|---|---|
| 브리프·샷리스트 | `production.brief` | `report`(md) | 상단 정보 칩 |
| 캐릭터 시트 | 브랜드 `characterSheets` + `payload.characters[].sheets` | `final`(png) | `character` 카드 |
| 레퍼런스 | `referenceKit.items` (+ `episodeLocations.variants` 미러) | `final`(png), 컨택트 시트 `preview` | `reference` 카드, `location` 배지 |
| 스틸 | `scenes[].imageDataUrl` + `gridSource/sheetPanelRef` | 스토리보드 컨택트 시트 `preview` | `cut` 카드 |
| 시퀀스 클립 | `sequences[].submissions` | `final`(mov/mp4), 프레임 그리드 `preview` | `sequence` 바, `cut.clip` |
| 러프컷·편집 분석 | `production.roughCut/editAnalysis` | `final`(mp4), `report`(json) | 상단 재생 |
| 감독컷 문서 | `production.directorCut` | `final`(pptx, pdf), `report` | 상단 링크 |
| 프롬프트·비용·QC | `sequences[].prompt`, `referenceKit.items[].prompt`, `statusLog` | `source`(json), `manifest` | 카드 상세 |

모든 파일은 GCS `objectName` 으로만 참조한다(`data:` URL 영속화 금지, 기존 규칙).

---

## 9. 구현 순서(단계마다 배포 가능)

### P0 — 데이터 모델·조립기·계약(생성 호출 없음)
- 7.2 (a)~(e) 필드와 저장 화이트리스트 4곳, 체인 테스트. `sheetPanelRef` 최상위 승격(G6).
- `_shared/animation-prompts.js` 순수 함수 + 단위 테스트(잠금 블록 순서, 텍스트 락 → SINGLE 강제, `brief-only` 참조 제외, 3장 규칙 검사기, REFERENCE ROLES 자동 생성).
- `references[].role='brief-only'` 정규화·필터.
- `production-graph.ts` 가 `bible-characters`·`referenceKit`·`sequences` 를 읽어 노드 데이터에 채움(캔버스 표시는 P2).
- 클라이언트·서버 `video_pipeline` 카테고리 불일치 정리.
- 완료 정의: 루트 `npm test` 통과, 실제 `data.json` 라운드트립에서 새 필드 보존.

### P1 — 도구와 Skill 실행기(브리프→캐릭터→레퍼런스→스틸)
- `anim_brief`, `character_resolve`, `character_sheet`, `character_bodyspec_save`, `reference_plan`, `reference_generate`, `reference_contact_sheet`, `still_prompt_build`, `still_generate`(또는 `scene_still mode:'animation'`), `storyboard_contact_sheet`, `production_status_log`.
- `animation_production` 스킬 등록(레지스트리·정규화·실행기·비용 게이트·스테이지 승인 scope), `reconcileAnimationJobs` 재개(G10).
- `/api/video` seedance-2.5 다중 참조·last_frame 계약 확인·보완(코드 조사 결과를 문서에 기록).
- 완료 정의: 채팅 한 문장("이 브리프로 계단 편 만들어. 캐릭터는 기존 아빠·생금이 재사용")으로 캐릭터 판정 → 레퍼런스 컨택트 시트 → 승인 → 스틸 컨택트 시트까지 도달. 각 게이트에서 멈추고 표준 보고 형식으로 메시지가 남는다. 구독 커넥터·Atlas 양쪽 경로 테스트.

### P2 — 시퀀스 영상·QC·캔버스
- `sequence_plan`, `sequence_prompt_build`, `sequence_video`, `sequence_frame_grid`(프레임 추출 방식 결정), `rough_cut`.
- 캔버스: `reference` 노드·레인, `sequence` 바, `character/location/cut` 배지·아이콘, `production-assets` 타깃 확장, `ProductionPipelinePanel`, 계약 테스트 갱신.
- 완료 정의: 승인 스틸에서 시퀀스 3개 제출 → 비용 고지·승인 → 완료 후 프레임 그리드 보고 → "컷 4만 POV로 다시" 지시가 해당 시퀀스의 지정 컷만 재생성(방식 변경 시 재승인 멈춤 확인) → 러프컷 mp4 가 업무 탐색기에 등록.

### P3 — 보고·문서·비용 회수
- `director_cut_doc`(PPTX/PDF, 렌더 검수), `audio_prompts`, 실비 회수(`actual_cost`), 상태 로그 → 업무 항목 요약 동기화.
- 완료 정의: 계단 편 러프컷 기준 감독컷 PPTX 3페이지가 텍스트 편집 가능 상태로 생성되고 넘침이 없다.

### P4 — 편집본 분석·배포 연결·자율 모드
- `edit_analysis`(씬 검출·ASR·대표 프레임) → 감독컷 ver2 재생성.
- `publish` 입력에 제작 산출물 지목, `autonomy:'gate-only'` 로 브리프→러프컷 1회 자율 진행 시나리오.
- 완료 정의: 11장의 수용 시나리오 통과.

---

## 10. 수용 기준(전 단계 공통)

1. 캐릭터 시트 미승인 상태에서 스틸·영상 도구 호출은 거부 메시지와 함께 실패한다.
2. 유료 생성 제출 전 채팅에 공급자·모델·해상도·길이·횟수·예상 비용·잔액이 한 문장으로 남는다. 상한 초과·잔액 부족이면 제출되지 않는다.
3. `brief-only` 이미지는 어떤 생성 요청 payload 에도 나타나지 않는다(테스트).
4. 텍스트 락 컷은 그리드로 생성되지 않는다. 한글 문구 불일치는 `failed` 로 기록되고 대표안 확정을 막는다.
5. "이 컷만 다시" 지시는 지정 컷 외의 어떤 자산도 재생성하지 않는다. 방식이 바뀌면 무료 산출물 후 `awaiting-approval`.
6. 결과 도착 후 시스템이 스스로 재생성하는 일이 없다(로그로 확인).
7. 모든 산출물이 8장 표의 세 곳(프로젝트 payload·업무 탐색기·캔버스)에 동시에 보인다.
8. 채팅을 닫아도 `continueRunning` 잡이 어느 화면의 폴링으로든 진행된다.
9. 새 세션의 에이전트가 `production.statusLog` 와 업무 항목만 읽고 현재 단계를 정확히 말할 수 있다.

---

## 11. 수용 시나리오 — 계단 편 재현

입력(채팅 한 번): 브랜드 `한국대부금융협회`, 에피소드 "계단 편 · 넘지 말아야 할 선", 브리프 텍스트 8블록(발주사 콘티 이미지는 `brief-only`), `style: full-3d`, `mood: 어두운 배경 + 슬랩스틱 코믹`, `reuse.characters: existing-first`, `autonomy: gate-only`, 텍스트 락 `대출 / 당일 대출 / 24시간 대출 / 무직자 OK`, `불법사금융 위험지역`.

기대 흐름:
1. 플롯이 요구사항 표·샷리스트(10컷)를 만들고 코어가 보고.
2. 픽셀이 아빠·생금이 기존 시트를 찾아 "재사용, 생성 없음"으로 판정. bodySpec 없으면 기존 시트에서 초안 작성 후 저장 승인 요청.
3. 레퍼런스 계획: 계단광장 플레이트, 거대벽 플레이트, 리본길·아치 플레이트, 연기시트 = 4장, 비용 0(구독) 고지 → 생성 → 컨택트 시트 → **게이트(선택)**.
4. 스틸 11컷(텍스트 락 컷 2개는 단일, 나머지 2×2) → 컨택트 시트 → **게이트**. 감독 "컷 4 POV, 인물 없음, 4초로" → 컷 4만 재생성 → 재보고.
5. 시퀀스 3개(계단 11s·구출 9s·리본공원 9s) 프롬프트 + 비용 $8.70 고지 → **게이트** → 제출 → 프레임 그리드 보고 → 멈춤.
6. 승인 후 러프컷(29초) 생성·등록, 나레이션·BGM 프롬프트 md 산출.
7. 감독 편집본 업로드 → 편집본 분석 → 감독컷 ver2 PPTX/PDF → 업무 탐색기.
8. 캔버스에 캐릭터 2·레퍼런스 4·컷 11·시퀀스 3·문서 링크가 보인다.

---

## 12. 리스크와 주의

- **Cloudflare 30초 한도**: 시트 생성·크롭·컨택트 시트 합성은 호출 하나로 끝나게 설계(크롭·합성은 클라이언트 유틸 재사용 또는 커넥터 위임). 배치는 스텝 1개씩.
- **구독 이미지 커넥터는 사용자 PC 가 켜져 있어야 한다.** 오프라인이면 조용히 Atlas 로 넘기지 말고(현행 규칙) 사용자에게 알린다.
- **Seedance 저작권 오디오 필터**: `chime/bell` 등 단어가 실패를 유발한 이력. 조립기 금칙어 목록으로 제거.
- **한글 렌더**: 자소 힌트가 있어도 실패할 수 있으므로 텍스트 락 컷은 후보 2장 생성 옵션을 둔다(무료 경로일 때만 기본 2).
- **스타일 드리프트**: 시퀀스마다 STYLE 블록·앵글시트·`styleAnchor` 를 반복 첨부. 디즈니풍·실사풍 이탈은 QC `warning` 으로 표기하고 사람이 판단.
- **레퍼런스 장수**: 3~6장이 최적이었다. 16장 상한을 채우지 않는다.
- **비용 승인 없는 유료 생성은 어떤 경로로도 발생하면 안 된다.** 자동 승인 설정("생성 전 확인: 안 함")은 무료 이미지에만 적용하고 유료 영상·외부 쓰기에는 적용하지 않는다.
- **발주사 자료 저작권·구도 복제**: `brief-only` 격리를 테스트로 고정.

---

## 부록 A. 이번 세션의 실패→교정 목록(조립기·QC 규칙의 근거)

| 실패 | 교정 | 승격된 규칙 |
|---|---|---|
| 실사 참조 이미지로 캐릭터 시트 → "괴물 같은 실사 합성" | 참조 전면 제거, 순수 프롬프트 | 신규 캐릭터는 참조 없음 |
| "너무 흔한 3D 스타일" | 살짝 한국인 인상, 노골적 표현 금지 | STYLE 블록 문구 |
| 실사 질감 잔존 | fabric weave·hair strands·realistic skin 제거 | 금칙 질감 목록 |
| 배경만 실사 | "ENVIRONMENTS ARE ANIMATION TOO" 문단 | STYLE 블록 필수 문단 |
| 라벨 "동록" 오타 | 단일 이미지 + 자소 힌트 + `reads exactly` | TEXT LOCK → SINGLE |
| 인도 방향·시선·배경 뒤바뀜 | SCREEN DIRECTION LOCK, 리버스 플레이트 분리 | screenDirection 필드 |
| 공을 든 팔이 바뀜 | HANDS LOCK | handsLock 필드 |
| 컷 경계에서 인물 소실 | PERSISTENCE LOCK | persistence 필드 |
| 앵글시트 회색 배경이 결과에 새어 나옴 | REFERENCE ROLES 에 "do not copy background/layout/pose" | doNotCopy 자동 삽입 |
| 오디오 프롬프트의 chime → 저작권 필터 실패 | 단어 제거 | 금칙어 목록 |
| 승인 없이 I2V 로 방식 변경 제출($2.1) | 방식 변경 시 무료 산출물 후 재승인 | 4장 3항 |
| ElevenLabs 나레이션 "AI 티", 블록별 생성은 흐름 끊김 | Gemini TTS 프롬프트 산출, 생성은 사람 | 7.5 TTS 방침 |
| Suno v1 "서커스 톤" | 브랜드 필름 스코어 방향으로 v2 | BGM 프롬프트 원칙(코믹은 화면이, 음악은 세련) |
| 플레이트가 판타지 성으로 | CITY LOCK(현대 한국 도시, 성·첨탑·폭포 금지) | MOOD 블록 예시 |
| 컷별 i2v 연결 끊김 | 장소 단위 9~12초 R2V 시퀀스 | 7.2 (d) |

## 부록 B. 용어

- **캐릭터 시트**: 디자인 확정용(정면 대형·반측면·후면·표정·동작). 브랜드 자산.
- **앵글시트**: 영상 참조용 전신 다각도 1행. 프로젝트 레퍼런스.
- **플레이트**: 인물 없는 장소 이미지. 뷰(정방향·리버스·와이드·부감)별.
- **텍스트 소품**: 한글이 들어가는 전단·앱 UI·라벨의 정면 이미지.
- **콘티 / 스틸컷**: 설계서 2.0절 정의 그대로. 이 문서의 "스틸"은 스틸컷.
- **시퀀스**: 같은 장소·연속 컷을 한 번의 R2V 로 만드는 영상 단위(9~12초).
- **컨택트 시트 / 프레임 그리드**: 사람 게이트용 한 장 요약 이미지.
- **감독컷 문서**: 편집본 기준 컷표 PPTX/PDF.
