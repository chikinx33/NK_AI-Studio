# Brand Core 데이터 모델 정의서

## 1. 문서 목적

이 문서는 NK_Studio를 `에피소드별 브랜드 운영 구조`에서 `브랜드 중심 운영 구조`로 전환하기 위한 기준 데이터 모델을 정의한다.

이 문서의 목적은 다음 네 가지다.

- `brandId`, `seriesId`, `episode/project`의 역할을 분리한다.
- 브랜드 공용 문맥과 에피소드 개별 문맥의 경계를 명확히 한다.
- Brand Studio, Brand Hub, Brand Intelligence가 어느 엔티티를 기준으로 동작해야 하는지 고정한다.
- 기존 draft payload를 새 구조로 옮길 때의 호환 정책을 정의한다.

## 2. 핵심 결론

- 앞으로 운영의 최상위 단위는 `Brand Core`다.
- `seriesId`는 제작 묶음 또는 연재 묶음을 나타내는 보조 식별자다.
- 현재의 `draft/project`는 에피소드 또는 개별 제작 단위로 본다.
- Brand Studio, Brand Hub, Brand Intelligence는 기본적으로 `brandId`를 기준으로 동작한다.

정리하면:

- `brandId`: 브랜드 운영 루트
- `seriesId`: 연작/시즌/제작 묶음
- `projectId` 또는 현재 draft `id`: 개별 에피소드/개별 제작 단위

## 3. 엔티티 정의

### 3.1 Brand Core

브랜드 공용 운영 문맥을 저장하는 최상위 엔티티다.

필드:

- `brandId`
- `brandTitle`
- `brandSlug`
- `brandSummary`
- `coreMessage`
- `targetAudience`
- `brandVoice`
- `brandTone`
- `brandStory`
- `brandCharacter`
- `worldSetting`
- `brandRules`
- `bannedExpressions`
- `brandKeywords`
- `connectedChannels`
- `referenceContents`
- `referenceContentEntries`
- `successCases`
- `createdAt`
- `updatedAt`
- `status`

설명:

- Brand Hub의 기본 저장 대상은 `Brand Core`다.
- Brand Studio의 캡션/해시태그 기본값은 `Brand Core`를 우선 참조한다.
- Brand Intelligence의 기본 집계 축은 `Brand Core`다.

### 3.2 Series

브랜드 아래에서 여러 에피소드나 시즌을 묶는 제작/편성 단위다.

필드:

- `seriesId`
- `brandId`
- `seriesTitle`
- `seasonLabel`
- `description`
- `createdAt`
- `updatedAt`

설명:

- `모양새 친구들 시즌1`, `모양새 친구들 쇼츠`, `모양새 친구들 카드뉴스` 같은 묶음을 표현할 수 있다.
- 모든 브랜드가 반드시 여러 series를 가져야 하는 것은 아니다.
- 초기 호환 단계에서는 기존 `seriesId`, `seriesTitle`를 그대로 사용하되, 상위에 `brandId`를 추가한다.

### 3.3 Episode Project

영상 제작, 이미지 생성, 글 작성 등 실제 Creative 작업이 일어나는 개별 작업 단위다.

필드:

- `projectId`
- `brandId`
- `seriesId`
- `episodeTitle`
- `episodeNumber`
- `projectType`
- `topic`
- `payload`
- `scenes`
- `header`
- `createdAt`
- `updatedAt`
- `status`

설명:

- 현재 `draft.id`는 `projectId`로 본다.
- 이 엔티티는 제작 결과와 개별 작업 상태를 저장한다.
- 공용 브랜드 정보의 소유자가 아니며, 필요한 경우 brand 참조 + 부분 override만 가진다.

### 3.4 Content Item

브랜드 운영에 사용할 수 있는 실제 자산 단위다.

필드:

- `contentId`
- `brandId`
- `seriesId`
- `projectId`
- `episodeId`
- `contentType`
- `title`
- `sourceType`
- `sourceProjectId`
- `sourceSceneId`
- `text`
- `assetUrl`
- `thumbnailUrl`
- `tags`
- `channelFit`
- `createdAt`
- `updatedAt`

설명:

- 영상, 이미지, 글, 게시물 초안, 카드뉴스 초안 등을 모두 하나의 공용 자산 모델로 다룬다.
- Brand Studio는 이 목록에서 운영할 자산을 선택한다.

### 3.5 Channel Profile

브랜드 공용 채널 설정 단위다.

필드:

- `channelProfileId`
- `brandId`
- `channelType`
- `accountName`
- `accountRef`
- `authStatus`
- `channelTone`
- `defaultHashtags`
- `settings`
- `createdAt`
- `updatedAt`

설명:

- 현재처럼 에피소드마다 채널을 다시 연결하지 않는다.
- 브랜드 단위로 연결하고, 모든 운영 화면에서 재사용한다.

### 3.6 Publish Record

브랜드 자산을 실제 채널 운영 단위로 저장하는 엔티티다.

필드:

- `publishId`
- `brandId`
- `seriesId`
- `projectId`
- `contentId`
- `channelProfileId`
- `channelType`
- `contentType`
- `campaignId`
- `caption`
- `hashtags`
- `scheduledAt`
- `publishedAt`
- `status`
- `remotePostId`
- `note`
- `metrics`

설명:

- 예약 게시, 게시 완료, 실패, 수동 입력 결과를 모두 이 엔티티로 통합한다.
- Brand Intelligence는 여기서 집계를 시작한다.

## 4. ID 관계 정의

### 4.1 기본 관계

- 하나의 `Brand Core`는 여러 `Series`를 가질 수 있다.
- 하나의 `Series`는 여러 `Episode Project`를 가질 수 있다.
- 하나의 `Brand Core`는 여러 `Content Item`을 직접 가질 수 있다.
- 하나의 `Episode Project`는 여러 `Content Item`의 원본이 될 수 있다.
- 하나의 `Brand Core`는 여러 `Channel Profile`을 가진다.
- 하나의 `Brand Core`는 여러 `Publish Record`를 가진다.

### 4.2 예시

브랜드:

- `brandId = brand_moyangsae`
- `brandTitle = 모양새 친구들`

시리즈:

- `seriesId = moyangsae_main_story`
- `seriesTitle = 메인 에피소드`

에피소드:

- `projectId = 20260313_ep11`
- `brandId = brand_moyangsae`
- `seriesId = moyangsae_main_story`
- `episodeTitle = EP11 새로운 친구 등장`

즉 EP11은 `모양새 친구들` 브랜드에 속한 하나의 제작 단위이지, 별도 브랜드가 아니다.

## 5. 소유권 규칙

### 5.1 Brand Core가 소유하는 것

- 브랜드 요약
- 핵심 메시지
- 브랜드 보이스
- 브랜드 톤
- 브랜드 스토리
- 브랜드 캐릭터
- 세계관
- 브랜드 규칙
- 금지 표현
- 브랜드 키워드
- 참조 콘텐츠
- 성공 사례
- 연결 채널

### 5.2 Episode Project가 소유하는 것

- 주제
- 에피소드 제목
- 씬
- 생성된 이미지/영상
- 개별 에피소드용 메모
- 필요 시 에피소드 한정 override

### 5.3 허용할 override

초기 제안:

- 허용: `coreMessage`, `targetAudience`, 특정 캠페인용 해시태그, 에피소드 설명
- 비허용 또는 제한: `brandVoice`, `brandRules`, `bannedExpressions`, `connectedChannels`

이유:

- 브랜드 일관성을 해치는 필드는 브랜드 공용값을 유지해야 한다.
- 에피소드별로 바꿔야 하는 정보는 캠페인성 문구나 포커스 메시지에 한정하는 것이 안전하다.

## 6. 화면 기준 데이터 소스

### 6.1 Scenario / Creative Studio

- 기본 문맥: `Episode Project`
- 참고 문맥: `Brand Core`

### 6.2 Content Library

- 기본 문맥: `brandId`
- 보기 단위: 브랜드 전체 자산 + 에피소드/타입 필터

### 6.3 Brand Studio

- 기본 문맥: `brandId`
- 선택 단위: `Content Item`
- 참고 문맥: `Brand Core`, `Channel Profile`

### 6.4 Brand Hub

- 기본 문맥: `brandId`
- 저장 대상: `Brand Core`

### 6.5 Brand Intelligence

- 기본 문맥: `brandId`
- 세부 필터: `seriesId`, `projectId`, `contentType`, `channelType`, `campaignId`

## 7. 분석 집계 규칙

Brand Intelligence는 다음 두 층을 동시에 제공해야 한다.

### 7.1 브랜드 전체 요약

- 총 게시 수
- 총 조회수
- 총 반응수
- 전체 성장 추이
- 상위 채널
- 상위 콘텐츠 유형
- 최근 성과

### 7.2 활동별 세부 분석

- 에피소드별 성과
- 콘텐츠 유형별 성과
- 채널별 성과
- 업로드 시간대별 성과
- 해시태그별 성과
- 시즌/캠페인별 성과
- 브랜드 공통 콘텐츠 vs 에피소드 홍보 콘텐츠 성과

## 8. 기존 구조와의 호환 정책

현재 구조:

- `seriesId`, `seriesTitle`가 사실상 브랜드 비슷한 역할까지 같이 맡고 있다.
- 브랜드 문맥이 개별 draft `payload` 안에 중복 저장된다.
- 게시 결과와 분석 데이터도 현재 프로젝트 기준 payload에 저장된다.

전환 중 호환 정책:

### 8.1 유지할 것

- 기존 `seriesId`, `seriesTitle`
- 기존 `draft.id`
- 기존 `payload.brandSummary`, `payload.brandVoice`, `payload.brandRules` 등 읽기 호환

### 8.2 새로 추가할 것

- `brandId`
- `payload.brandRef`
- 브랜드 공용 저장소
- 브랜드 단위 채널/게시/분석 저장소

### 8.3 읽기 우선순위

1. 새 브랜드 저장소
2. `payload.brandRef`
3. 기존 payload의 브랜드 필드

이 우선순위로 읽으면 기존 프로젝트도 당장 깨지지 않는다.

### 8.4 쓰기 우선순위

- 신규 수정은 브랜드 공용 저장소에 쓴다.
- 호환 단계에서는 필요한 최소 필드만 기존 payload에도 미러링한다.
- 최종 단계에서는 payload 미러링을 제거한다.

## 9. 마이그레이션 정책

### 9.1 자동 매핑 기준

- 같은 `seriesId`를 가진 기존 draft들은 우선 하나의 `brandId` 후보로 묶는다.
- `seriesTitle`은 초기 `brandTitle` 후보로 사용한다.
- 가장 최신 draft의 브랜드 문맥을 우선 브랜드 기본값 후보로 삼는다.

### 9.2 충돌 처리 기준

같은 `seriesId` 아래 draft마다 브랜드 정보가 다르면:

- 최신 수정본 우선
- 충돌 필드는 관리자가 검토 가능하도록 이관 로그에 남김

### 9.3 게시 결과 이관 기준

- 기존 `brandStudioPublishResults`, `publishResults`, `analyticsSnapshots`는
  모두 `brandId` 기준 Publish Record로 재정규화한다.

## 10. 구현 시 주의사항

- 브랜드 중심으로 바꾸더라도 Creative 작업의 현재 에피소드 문맥은 잃으면 안 된다.
- 사용자는 여전히 `EP11 작업 중`임을 알아야 하지만, 운영 화면에서는 `모양새 친구들 브랜드 운영 중`임을 더 크게 느껴야 한다.
- Brand Studio를 brand 기준으로 바꾸더라도 에피소드 필터와 빠른 선택은 반드시 제공해야 한다.

## 11. Phase 1 완료 판정

다음 조건을 만족하면 Phase 1 문서 작업은 완료로 본다.

- `Brand Core` 정의가 고정됐다.
- `brandId`, `seriesId`, `projectId` 관계가 명확해졌다.
- 브랜드 공용값과 에피소드 개별값의 소유권이 분리됐다.
- 분석이 브랜드 전체 요약 + 활동별 세부 분석 구조로 정의됐다.
- 기존 payload를 새 구조로 옮기는 호환 정책이 문서화됐다.
