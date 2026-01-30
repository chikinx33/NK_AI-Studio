# NK Studio 스크립트 리팩터링 계획서

이 문서는 `script.js` 파일의 비대화를 해소하고 유지보수성을 높이기 위한 단계별 리팩터링 계획을 정의합니다. 
**원칙**: "한 번에 하나씩", "기존 기능 유지", "사용자 승인 후 진행"

## 진행 현황 요약
- [ ] Phase 1: 유틸리티(Utils) 분리 및 모듈화 기초
- [ ] Phase 2: 설정 및 상수(Config) 분리
- [ ] Phase 3: 상태 관리(State) 분리
- [ ] Phase 4: API 서비스(Service) 분리
- [ ] Phase 5: UI 컴포넌트(UI) 분리

---

## 상세 실행 계획

### Phase 1: 유틸리티(Utils) 분리 및 모듈화 기초
가장 의존성이 적은 순수 함수들을 분리하여 안전하게 모듈 시스템을 도입합니다.
**작업 내용:**
1. 프로젝트 구조 개선: `js` 디렉토리 생성 및 `index.html`에 `type="module"` 적용.
2. `js/utils.js` 생성: 다음 함수들을 이동.
   - `parseEst`: 시간 문자열 파싱
   - `pixelateDataUrl`, `blurDataUrl`: 이미지 처리
   - `truncateTitle` (존재 시): 문자열 처리
   - `getFileName`: URL에서 파일명 추출
   - 날짜 포맷팅 등 기타 헬퍼 함수
3. `script.js`에서 `import` 구문 추가 및 해당 함수들 제거.

### Phase 2: 설정 및 상수(Config) 분리
코드 곳곳에 산재된 하드코딩된 값과 설정 데이터를 통합 관리합니다.
**작업 내용:**
1. `js/config.js` 생성: 다음 상수들을 이동.
   - `APP_VERSION`, `DRAFT_KEY`, `PIPELINE_KEY`
   - `purposeCategories`, `purposeNeeds`, `toneList`, `styleList` 등 데이터셋
   - 기본값 설정 (Default header strings 등)
2. `script.js`에서 `import` 하여 사용하도록 변경.

### Phase 3: 상태 관리(State) 분리
여러 함수에서 공유되는 전역 변수들을 중앙 저장소로 모아 관리합니다.
**작업 내용:**
1. `js/store.js` 생성:
   - `pipelineState`, `scenesState`, `currentDraftId` 등의 전역 상태 이동.
   - 상태를 읽고 쓰는(get/set) 메서드 구현.
   - `localStorage` 로드/저장 로직 캡슐화.
2. `script.js` 및 다른 모듈에서 `store`를 통해 상태에 접근하도록 변경.

### Phase 4: API 서비스(Service) 분리
서버 통신 로직을 비즈니스 로직으로 분리하여 UI 코드와 격리합니다.
**작업 내용:**
1. `js/api.js` 생성:
   - `uploadImage`, `uploadVideo`, `project/delete` 등 업로드/삭제 관련 API.
   - `generateImage`, `checkVideoStatus` 등 생성 관련 API.
   - `fetchGlobalHeader` 등 조회 API.
2. 공통 에러 핸들링 및 인증 헤더 처리 로직 통합.

### Phase 5: UI 컴포넌트(UI) 분리
가장 방대한 UI 렌더링 로직을 기능별 파일로 쪼갭니다.
**작업 내용:**
1. `js/ui/` 디렉토리 생성.
2. `js/ui/pipeline.js`: `renderPipelinePage` 및 관련 이벤트 핸들러 이동.
3. `js/ui/library.js`: `openLibrary`, `renderLibrary` 등 라이브러리 모달 관련 이동.
4. `js/ui/dashboard.js`: 대시보드 및 드래프트 관리 로직 이동.
5. `script.js`는 애플리케이션 초기화(Entry Point) 역할만 수행.

---

## 검수 및 진행 방식
1. 각 Phase 작업 완료 후 사용자가 테스트 및 코드 리뷰를 수행합니다.
2. 사용자의 "승인(Check)"이 있어야만 다음 Phase로 넘어갑니다.
3. 문제가 발생하면 즉시 롤백하고 원인을 분석합니다.
