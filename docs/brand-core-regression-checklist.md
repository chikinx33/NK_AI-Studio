# 브랜드 중심 운영 회귀 체크리스트

본 체크리스트는 1차로 `코드 경로 검증` 기준으로 업데이트했다.
브라우저에서 실제 클릭/입력/저장 흐름까지 확인이 필요한 항목은 하단 `회귀 관찰 포인트`에 남긴다.

## 1. 기존 프로젝트 호환

- [x] 기존 `projectId`만 있는 링크로 `brand.html` 진입 시 화면이 열린다.
- [x] 기존 `projectId`만 있는 링크로 `knowledge.html` 진입 시 화면이 열린다.
- [x] 기존 `projectId`만 있는 링크로 `analytics.html` 진입 시 화면이 열린다.
- [x] 기존 초안에 `brandId`가 없어도 자동으로 브랜드 컨텍스트가 붙는다.
- [x] 기존 초안의 `publishResults`가 Brand Intelligence에서 계속 집계된다.

## 2. 브랜드 저장소 마이그레이션

- [x] 기존 초안이 있는 상태에서 앱을 열면 Brand Core 저장소가 자동으로 생성된다.
- [x] 여러 에피소드가 같은 시리즈일 때 하나의 `brandId`로 묶인다.
- [x] 기존 채널 연결 정보가 Brand Core `connectedChannels`로 보존된다.
- [x] 기존 Knowledge Hub 정보가 Brand Core에 보존된다.
- [x] 기존 게시 결과가 Brand Core `brandStudioPublishResults`로 보존된다.

## 3. 브랜드 중심 운영

- [x] Brand Studio가 브랜드 단위로 열리고 대표 프로젝트가 자동 선택된다.
- [x] Knowledge Hub가 브랜드 공용 설정으로 열린다.
- [x] Brand Intelligence가 브랜드 전체 성과를 먼저 보여준다.
- [x] 분석 필터에서 에피소드/채널/콘텐츠 유형/시즌/캠페인/운영 목적 drill-down이 동작한다.

## 4. 링크와 내비게이션

- [x] 사이드바에서 Brand Studio 진입 시 `brandId`가 함께 유지된다.
- [x] 사이드바에서 Knowledge Hub 진입 시 `brandId`가 함께 유지된다.
- [x] 사이드바에서 Brand Intelligence 진입 시 `brandId`가 함께 유지된다.
- [x] 화면 간 이동 후에도 현재 브랜드 컨텍스트가 유지된다.

## 5. 회귀 관찰 포인트

- [ ] 에피소드 생성 후 기존 브랜드와 분리되지 않는지 확인한다.
- [ ] 브랜드 수정 후 다른 에피소드 진입 화면에서도 같은 브랜드 문맥이 보이는지 확인한다.
- [ ] 게시 결과 추가/삭제 후 Brand Studio와 Brand Intelligence 집계가 동시에 맞는지 확인한다.
