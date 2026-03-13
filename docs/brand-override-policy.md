# 브랜드/에피소드 Override 정책

## 1. 목적

이 문서는 `브랜드 공통 문맥`과 `에피소드 개별 운영값`의 경계를 정의한다.

기본 원칙은 다음과 같다.

- 브랜드 정체성과 운영 규칙은 `Brand Core`가 소유한다.
- 에피소드는 제작/운영 실행값만 개별로 가진다.
- 에피소드 화면에서 보이는 값도 우선순위는 `에피소드 override -> Brand Core 기본값` 순서다.

## 2. Brand Core 고정 필드

아래 필드는 브랜드 공용값으로 본다.

- `brandSummary`
- `coreMessage`
- `brandVoice`
- `brandTone`
- `brandStory`
- `brandCharacter`
- `worldSetting`
- `brandRules`
- `bannedExpressions`
- `brandKeywords`
- `referenceContents`
- `referenceContentEntries`
- `successCases`
- `connectedChannels`

이 필드는 Knowledge Hub 또는 Brand Studio의 브랜드 설정에서 수정하며, 수정 즉시 같은 브랜드의 다른 에피소드에도 공통으로 적용된다.

## 3. Episode Override 허용 필드

아래 필드는 에피소드 단위 override를 허용한다.

- `episodeTitle`
- `projectType`
- `targetAudience`
- `contentStyle`
- `purposeTags`
- `brandStudioSelectedAssetIds`
- `brandStudioAssetTypeFilter`
- `brandStudioAssetProjectFilter`
- `brandStudioContentType`
- `brandStudioCaptionDraft`
- `brandStudioHashtagDraft`
- `brandStudioAutoSuggestion`

이 값은 에피소드별 홍보 목적, 운영 포맷, 선택 자산, 초안 문구처럼 개별 편차가 필요한 필드다.

## 4. 저장 정책

- Brand Core 필드는 `brand.js` 저장소를 기준으로 저장한다.
- 에피소드 payload에는 기존 호환을 위해 일부 필드를 유지할 수 있다.
- 화면 렌더링 시 브랜드 컨텍스트가 있으면 Brand Core 값을 우선 사용한다.

## 5. 게시 운영 데이터

다음 값은 브랜드 운영 데이터로 간주한다.

- `brandStudioChannels`
- `brandStudioPublishPlan`
- `brandStudioPublishResults`

단, 게시 결과에는 어느 에피소드에서 발생한 운영인지 추적하기 위해 `projectId`, `projectTitle`을 함께 저장한다.

## 6. 새 에피소드 생성 규칙

- 새 에피소드는 기존 브랜드의 `brandId`를 그대로 참조한다.
- Brand Core 고정 필드는 새 에피소드에 자동 연결된다.
- Episode Override 허용 필드는 새 에피소드에서 독립적으로 작성한다.

## 7. 다음 확장 포인트

- 시즌/캠페인 단위의 중간 계층이 필요하면 `Brand Core -> Season -> Episode` 3단계 override 체계로 확장한다.
- 현재 V1에서는 `브랜드 공통`과 `에피소드 개별` 2단계만 운영한다.
