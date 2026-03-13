# 브랜드 중심 운영 구조 전환 개발 기획서

## 1. 문서 목적

이 문서는 현재 `에피소드별 브랜드 운영` 구조를 `브랜드 중심 운영` 구조로 전환하기 위한 개발용 체크리스트 문서다.

개발 진행 시 이 문서의 체크 항목을 기준으로 하나씩 완료 처리한다.

## 2. 현재 문제 정의

- 현재 Brand Studio, Knowledge Hub, Brand Intelligence가 현재 선택된 `에피소드 draft/project` 기준으로 동작한다.
- 같은 브랜드(예: `모양새 친구들`) 안에 여러 에피소드가 있어도, 브랜드 문맥이 각 에피소드 payload에 분산 저장된다.
- 새 에피소드를 만들 때 기존 브랜드 문맥 일부를 상속받지만, 이후 수정은 현재 에피소드에만 반영된다.
- 그 결과 사용자는 브랜드 요약, 말투, 규칙, 금지 표현, 채널 운영 맥락을 반복 입력하거나 복사 붙여넣기 해야 한다.
- 분석도 브랜드 전체 성과가 아니라 현재 프로젝트 단위로 끊겨 보인다.

## 3. 전환 목표

목표는 `에피소드 제작 도구 + 에피소드별 브랜드 부가 기능`이 아니라 아래 구조를 만드는 것이다.

- `브랜드`는 운영의 최상위 단위다.
- `에피소드`, `이미지`, `글`, `SNS 게시물 초안`은 브랜드 하위 자산이다.
- Brand Studio는 특정 에피소드 상세 화면이 아니라 브랜드 운영 콘솔이다.
- Knowledge Hub는 브랜드 공용 지식 저장소다.
- Brand Intelligence는 브랜드 전체 성과를 기본으로 보고, 활동별 성과까지 분해 분석한다.

## 4. 사용자 기준 목표 시나리오

예시: `모양새 친구들`

1. 사용자는 `모양새 친구들` 브랜드를 한 번 만든다.
2. 브랜드 보이스, 규칙, 세계관, 금지 표현, 핵심 메시지, 채널 정보를 브랜드에 저장한다.
3. EP11을 만들면 브랜드 문맥은 자동으로 따라온다.
4. Brand Studio에서는 EP1~EP11, 대표 이미지, 카드뉴스, 글 초안 등 모든 브랜드 자산을 함께 선택할 수 있다.
5. 사용자는 선택한 자산을 Instagram, YouTube, TikTok, X 등 채널용 콘텐츠로 운영한다.
6. 분석은 `모양새 친구들 전체 성과`를 먼저 보고, 필요하면 에피소드별/활동별로 내려가서 본다.

## 5. 핵심 설계 원칙

- 제작 단위와 운영 단위를 분리한다.
- `에피소드 = 제작 단위`, `브랜드 = 운영 단위`로 고정한다.
- 브랜드 문맥은 공용 저장소에서 관리하고, 에피소드는 참조만 한다.
- 자주 쓰는 흐름은 `브랜드 선택 -> 자산 선택 -> 채널 운영 -> 분석` 순서로 단순화한다.
- 복사 붙여넣기 없이 브랜드 문맥이 자동 적용되게 한다.
- 분석은 반드시 `전체 요약 + 활동별 drill-down`을 함께 제공한다.

## 6. 목표 데이터 구조

### 6.1 Brand Core

- `brandId`
- `brandTitle`
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
- `connectedChannels`
- `referenceContents`
- `successCases`

### 6.2 Content Item

- `contentId`
- `brandId`
- `episodeId`
- `seriesId`
- `contentType`
- `title`
- `sourceProjectId`
- `sourceSceneId`
- `assetUrl`
- `text`
- `tags`
- `createdAt`

### 6.3 Channel Operation

- `brandId`
- `channelType`
- `accountName`
- `channelTone`
- `defaultHashtags`
- `publishPlan`
- `publishResults`

### 6.4 Analytics Dimensions

- `brandId`
- `contentId`
- `episodeId`
- `contentType`
- `channelType`
- `campaignId`
- `publishedAt`
- `hashtags`
- `metrics`

## 7. 화면 구조 목표

### 7.1 Brand Studio

- 상단: 브랜드 요약, 핵심 메시지, 공용 채널, 최근 성과
- 좌측: 브랜드 자산 필터
- 중앙: 운영할 자산 선택
- 우측: 캡션, 해시태그, 채널 선택, 예약 게시, 게시 결과

### 7.2 Knowledge Hub

- 브랜드 공용 지식 저장
- 에피소드 개별 입력 화면이 아니라 브랜드 설정 화면으로 동작

### 7.3 Brand Intelligence

- 기본값은 브랜드 전체 성과
- 에피소드별, 콘텐츠 유형별, 채널별, 시간대별, 해시태그별, 캠페인별 성과 분해 제공

## 8. 개발 단계 체크리스트

### Phase 0. 분석 정리

- [x] 현재 구조가 에피소드 단위 운영에 가깝다는 점 확인
- [x] 브랜드 중심 전환 방향 합의
- [x] 브랜드 전체 성과 + 활동별 성과 분석 필요성 정리
- [x] 개발용 체크리스트 문서 생성

### Phase 1. 데이터 모델 재설계

- [x] `Brand Core` 엔티티 정의
- [x] 기존 `seriesId`, `seriesTitle`, `episodeTitle`와 `brandId` 관계 정의
- [x] 에피소드 draft가 브랜드 문맥을 직접 저장하지 않고 참조하도록 구조 설계
- [x] 기존 payload에서 브랜드 필드를 어디까지 유지할지 마이그레이션 정책 결정
- [x] 브랜드 공용 채널/분석/자산 구조 정의

완료 기준:
- 브랜드/에피소드/자산/분석 데이터 경계가 문서와 코드에서 동일하게 설명된다.

### Phase 2. 저장소 및 서비스 계층 개편

- [x] `project.js`에서 브랜드와 에피소드 책임 분리
- [x] 브랜드 조회/생성/수정 서비스 추가
- [x] 에피소드 생성 시 `brandId` 연결 구조 추가
- [x] 공용 자산 조회 서비스 추가
- [x] 브랜드 단위 게시 결과/분석 데이터 저장 경로 추가

완료 기준:
- 새 에피소드를 만들어도 브랜드 공통 문맥을 다시 입력하지 않는다.

### Phase 3. Brand Studio 전환

- [x] Brand Studio 진입 기준을 `projectId` 중심에서 `brandId` 중심으로 전환
- [x] 브랜드 하위 전체 자산 선택 UI 추가
- [x] 영상/이미지/글/게시물 초안을 한 화면에서 선택 가능하게 구성
- [x] 채널 연결을 브랜드 공용 설정으로 이동
- [x] 예약 게시와 게시 결과를 브랜드 기준으로 저장

완료 기준:
- 사용자가 EP11 하나가 아니라 `모양새 친구들` 브랜드 전체 자산으로 운영할 수 있다.

### Phase 4. Knowledge Hub 전환

- [x] Knowledge Hub를 브랜드 공용 설정 화면으로 전환
- [x] 브랜드 보이스, 규칙, 금지 표현, 성공 사례를 브랜드 레벨에 저장
- [x] 새 에피소드 생성 시 Knowledge 자동 연결
- [x] 에피소드 개별 override 허용 범위 정의

완료 기준:
- 브랜드 문맥을 에피소드마다 복붙하지 않아도 된다.

### Phase 5. Brand Intelligence 고도화

- [x] 기본 대시보드를 브랜드 전체 성과 기준으로 변경
- [x] 에피소드별 성과 분석 추가
- [x] 콘텐츠 유형별 성과 분석 추가
- [x] 채널별 성과 분석 추가
- [x] 업로드 시간대별 성과 분석 추가
- [x] 해시태그별 성과 분석 추가
- [x] 캠페인/시즌/운영 목적별 필터 구조 설계
- [x] 전체 성과에서 세부 활동으로 drill-down 가능하게 설계

완료 기준:
- 사용자가 `브랜드 전체 성장`과 `각 활동별 성과`를 모두 확인할 수 있다.

### Phase 6. 마이그레이션 및 안정화

- [x] 기존 에피소드 payload의 브랜드 정보 이관 스크립트 또는 호환 로직 추가
- [x] 기존 프로젝트가 깨지지 않도록 fallback 처리
- [x] 기존 Brand Studio 진입 링크 호환 처리
- [x] 회귀 테스트 체크리스트 작성

완료 기준:
- 기존 프로젝트 데이터가 손실 없이 새 구조에서 열리고 운영된다.

## 9. 개발 시 확인할 사용자 경험 체크리스트

- [x] 사용자가 브랜드와 에피소드를 혼동하지 않는다.
- [x] 새 에피소드 생성 시 브랜드 문맥 재입력이 필요 없다.
- [x] Brand Studio에서 여러 에피소드 자산을 함께 선택할 수 있다.
- [x] 캡션/해시태그 기본값이 브랜드 문맥을 먼저 반영한다.
- [x] 분석 첫 화면에서 브랜드 전체 상태를 바로 이해할 수 있다.
- [x] 분석 화면에서 에피소드/콘텐츠 유형/채널/시간대별 성과를 쉽게 비교할 수 있다.

## 10. 바로 다음 개발 순서

1. 회귀 체크리스트를 기준으로 수동 검증을 실행
2. 저장/오류 피드백을 `alert()` 중심에서 인라인 피드백으로 전환
3. 접근성 기준으로 라벨, 포커스, 키보드 흐름을 보강
4. 사이드바와 대시보드에서도 브랜드/에피소드 구분 문구를 일관화

## 11. Phase 1 산출물

- [x] [Brand Core 데이터 모델 정의서](/f:/NKW/App/NK_Studio/docs/brand-core-data-model.md)
- [x] [브랜드/에피소드 Override 정책](/f:/NKW/App/NK_Studio/docs/brand-override-policy.md)
- [x] [브랜드 중심 운영 회귀 체크리스트](/f:/NKW/App/NK_Studio/docs/brand-core-regression-checklist.md)
