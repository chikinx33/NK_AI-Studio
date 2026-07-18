# AI 회사 Phase 0 공통 Skill 플랫폼 기술 설계

> 문서 버전: 0.1
> 기준일: 2026-07-19
> 상위 기준: `docs/ai-company-skills-master-plan.md`
> 상태: 구현 착수

## 1. 목적

마스터 플랜의 첫 실행 항목인 `공통 Skill 정의와 SkillJob 데이터 모델 확정`을 구현 가능한 계약으로 분리합니다. 이 문서는 기존 인포그래픽 기능을 중단하지 않으면서 공통 업무 엔진으로 이전하기 위한 Phase 0 기술 기준입니다.

## 2. 현재 구조와 분리 원칙

기존 `agent_jobs`는 단일 에이전트 도구 실행과 검수 이력을 위한 모델입니다. 새 `SkillJob`은 다음 책임이 추가되므로 기존 테이블에 상태와 JSON 필드를 계속 덧붙이지 않습니다.

- 채팅과 직접 UI의 동일한 정규화 입력
- 페이지 이동과 재시작 후 서버 상태 복원
- 중복 실행 방지
- 다중 에이전트 업무 보고
- 비용 예상과 실제 사용량
- 품질 게이트와 자동 수정
- 승인 상태
- 산출물 종류와 버전 계보
- 회사 업무 탐색기 항목과 연결

따라서 `company_skill_jobs`와 `company_skill_artifacts`를 공통 Skill 전용 모델로 추가하고, 기존 인포그래픽 API는 어댑터를 통해 단계적으로 연결합니다. 기존 `agent_jobs`는 현재 에이전트 실행 기능의 호환성을 위해 유지합니다.

## 3. Skill 정의 계약

`companySkills.ts`의 Skill 정의는 표시 정보와 실행 계약을 구분합니다. `available` 상태는 다음 실행 메타데이터를 반드시 가져야 하며, `coming-soon`은 구현 진행 중 일부만 가질 수 있습니다.

- `categoryId`
- `inputSchema`
- `executorId`
- `previewType`
- `artifactTypes`
- `requiredCapabilities`
- `permissionPolicy`
- `costPolicy`
- `qualityGateIds`

이 구분으로 실행 계약이 없는 Skill을 실수로 `available`로 전환하면 TypeScript 빌드에서 실패합니다.

첫 입력 스키마 ID는 `company-skill/infographic/v1`입니다. 공통 입력 봉투는 `invocationMode`, `request`, `conversationId`, `companyId`, `references`, `idempotencyKey`를 사용하고 Skill별 값은 `options`에 둡니다.

## 4. SkillJob 상태 계약

정상 상태 흐름은 다음과 같습니다.

```text
draft → validating → planning → running → reviewing → completed
                                         ↘ revision ↗
```

실행 중 상태에서는 `failed` 또는 `cancelled`로 이동할 수 있습니다. `revision`은 수정 범위에 따라 `running` 또는 `reviewing`으로 돌아갑니다. `failed` 재시도는 저장된 실패 단계에 맞춰 검증·계획·실행·검수 단계로 돌아갈 수 있습니다. `completed`와 `cancelled`는 종결 상태입니다.

상태 전이는 `SKILL_JOB_TRANSITIONS`와 `COMPANY_SKILL_JOB_TRANSITIONS`를 기준으로 검사합니다. 임의 문자열 상태 변경은 허용하지 않습니다.

## 5. 영속 모델

### 5.1 `company_skill_jobs`

핵심 식별자는 `user_id`, `category_id`, `skill_id`, `invocation_mode`입니다. 입력, 해석된 브리프, 실행 계획, 보고, 비용, 품질, 승인, 오류는 서로 독립된 JSON 필드로 저장합니다. `progress`는 0~100, `version`은 1 이상으로 제한합니다.

`idempotency_key`는 사용자 단위 부분 고유 인덱스를 사용합니다. 같은 사용자의 동일 실행 키는 업무를 두 번 생성하지 않으며, 다른 사용자의 키와는 충돌하지 않습니다.

완료 후 `work_item_id`로 `company_work_items`에 연결합니다. `parent_work_id`, `version`, `lineage`는 재작업과 파생 관계를 보존합니다.

### 5.2 `company_skill_artifacts`

산출물은 SkillJob과 1:N 관계이며 `source`, `preview`, `final`, `manifest`, `report`를 구분합니다. 모든 행에 `user_id`를 중복 저장해 조회 시 사용자 격리를 쿼리 조건으로 강제할 수 있게 합니다.

논리 저장 경로는 상위 문서 기준을 그대로 사용합니다.

```text
users/{userId}/ai-company/work-library/{YYYY-MM-DD}/{workId}/
```

## 6. 구현 체크리스트

- [x] 공통 Skill 정의 타입과 `available` 실행 계약 강제
- [x] 인포그래픽 실행 메타데이터 등록
- [x] 인포그래픽 v1 입력 스키마 등록
- [x] 클라이언트 `SkillJob`, 보고, 비용, 승인, 품질, 산출물 타입 정의
- [x] 서버 `company_skill_jobs`, `company_skill_artifacts` 스키마 정의
- [x] 사용자 단위 상태 조회 인덱스와 중복 실행 방지 인덱스 정의
- [x] 상태 전이 계약 정의
- [x] 사용자 격리 생성·조회 저장소 구현
- [x] 허용 상태와 현재 상태를 함께 검사하는 원자적 상태 전이 구현
- [x] 생성·조회·취소·재시도·승인·산출물 조회 API 구현
- [x] 브라우저 클라이언트 API 계약 구현
- [x] 공통 실행기 레지스트리와 실행 수명주기 구현
- [x] 실행 임대 토큰과 만료 기반 중복 워커 방지 구현
- [x] 인포그래픽 공통 실행기 어댑터 구현
- [x] 직접 UI와 채팅 호출 경로 전환
- [ ] 실제 산출물 레코드와 manifest 저장 연결
- [x] 인포그래픽 브라우저 새로고침 상태 복원 연결
- [ ] 통합 테스트와 실패 복구 테스트

## 7. 다음 구현 순서

1. 인포그래픽 실행 결과의 source·manifest·report를 `company_skill_artifacts`에 등록합니다.
2. artifact `version`과 `lineage`를 업무 버전 정보에 연결합니다.
3. 단계별 에이전트 업무 보고 이벤트 표준을 저장하고 클라이언트가 복원할 수 있게 합니다.
4. 실DB에서 사용자 격리·중복 실행·취소·실패·재시도·복원을 통합 테스트합니다.
5. 비용 예상·승인·상한 게이트와 공통 3열 UI 슬롯을 구현합니다.

## 8. 세션 인수인계 상태

- 마지막 갱신일: 2026-07-19
- 현재 단계: 공통 실행기·인포그래픽 어댑터 완료, 실제 산출물 레코드 연결 착수 전
- 마지막 완료 파일: `prototype/functions/api/agent/_company-skill-executors.ts`
- 다음 시작 파일: `prototype/functions/api/agent/_skill-jobs.ts`의 산출물 등록 저장 함수
- 연결 대상: 인포그래픽 실행기 결과의 `workItemId`, 장면 명세, 업무 보고를 `company_skill_artifacts` source·manifest·report로 저장
- 검증 상태: 루트 `npm test` 289개, 앱 프로덕션 빌드, 관련 서버 함수 esbuild 번들 통과
- 미완료 사실: `company_skill_artifacts` 조회 계약과 테이블만 존재하며 실제 인포그래픽 산출물 레코드는 아직 등록되지 않습니다.
- 호환 상태: 직접 UI와 채팅 도구 모두 공통 SkillJob 생성 API를 사용하고, 공통 어댑터 내부에서 기존 `/api/agent/agent-video` 제작 구현을 재사용합니다.
