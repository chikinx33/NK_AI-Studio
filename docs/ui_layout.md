# NK_Studio UI 기본 설계

## 디자인 방향

- Web-first PWA, 필요 시 동일 코드베이스로 Tauri 데스크톱 빌드
- 톤&매너: 짙은 챠콜 바탕, 오렌지 + 틸 듀얼 포인트
- 서체: `Space Grotesk` 또는 `General Sans`, 대체 `Pretendard`
- 인터랙션: 중요한 작업은 토스트, progress bar, 상태 피드백으로 보조

## 최상위 UX 원칙

- 이 시스템은 최종적으로 사용자가 사용하기 편리해야 한다.
- 복잡한 내부 레이어를 사용자에게 그대로 노출하지 않는다.
- 사용자는 항상 `현재 Project`, `현재 단계`, `다음 액션`을 즉시 이해할 수 있어야 한다.
- 자주 쓰는 작업은 짧고 빠르게, 고급 설정은 뒤로 숨긴다.

## 글로벌 프레임 (Project 중심 Creator OS)

- 좌측 사이드바: 로고, Project 전환, 핵심 메뉴, 예약/실패 작업 뱃지
- 상단바: 현재 Project, 빠른 생성 버튼, 검색/명령팔레트, 알림, 언어·테마 토글
- 메인 캔버스: 현재 단계에 맞는 작업 화면
- 하단 상태바: 생성/업로드/예약/분석 상태

사이드바 계층 예시

```text
NK_Studio
├ Project Home
├ Creative Studio
├ Content Library
├ Brand Studio
├ Channel Manager
├ Publish Queue
├ Knowledge Hub
└ Intelligence
```

## 화면 구조

### 1) Project Home

- 최근 콘텐츠
- 예약 게시
- 연결 채널 상태
- 빠른 액션: `새 콘텐츠 만들기`, `예약 게시 확인`, `최근 결과 이어서 운영`

### 2) Creative Studio

- 좌: Scene 리스트와 상태
- 중: Scene 상세, 프롬프트, 실패 사유
- 우: 재생성/재시도/직접 교체, 저장 후 Brand Studio로 보내기

### 3) Content Library

- 프로젝트의 공용 콘텐츠 저장소
- 필터: 타입, 생성 출처, 채널 사용 여부, 최근 수정일
- 빠른 액션: `Brand Studio로 보내기`, `채널용 변형 만들기`, `예약 게시`

### 4) Brand Studio

- 좌: 콘텐츠 유형 선택
- 중: SNS 게시물/쇼츠 홍보/홍보 이미지/블로그 글 생성 및 편집
- 우: 프로젝트 자산, 브랜드 규칙, 추천 캡션/해시태그

### 5) Media Lab

- 탭: Image / Video / Audio
- 이미지, 영상, 오디오별 생성과 미리보기

### 6) Timeline · Edit

- Scene 단위 미리보기
- 최소 컷/트림/자막 오버레이
- Test Mode 지원

### 7) Voice & Subtitles

- 자동 전사 결과
- 라인별 수정/잠금
- 음성 선택, 속도/감정, 자막 스타일

### 8) Publish Queue

- 채널별 게시 상태, 예약 시간, 완료/실패 상태, 오류 메시지
- 게시 전 미리보기, 캡션, 해시태그, 예약 시간 검토

### 9) Knowledge Hub

- 캐릭터
- 세계관
- 브랜드 규칙
- 금지 표현
- 참조 콘텐츠

### 10) Intelligence

- 초기: 채널별/콘텐츠별 성과 요약
- 장기: 추천과 전략 지원

### 11) Settings

- 모델 선택
- 저장소/백업
- 크레딧/결제
- 단축키

## 반응형 가이드

- `>= 1440`: 3컬럼 가능
- `1200 ~ 1024`: 우측 패널 드로어 전환
- `<= 768`: 사이드바 아이콘화, 필수 액션 중심 플로팅 바

## 초기 온보딩 흐름

1. Project 생성
2. 브랜드 요약, 핵심 메시지, 타깃 입력
3. Creative Studio 또는 Brand Studio 중 시작점 선택
4. Content Library를 공용 허브로 사용
5. Publish Queue에서 업로드 또는 예약 게시

## UI 비타협 원칙

- Project 문맥은 항상 보인다.
- 사용자가 길을 잃지 않게 현재 단계가 분명해야 한다.
- Creative 결과를 Brand 운영으로 넘길 때 추가 학습이 필요하면 안 된다.
- 실패는 숨기지 말고 원인과 다음 행동을 같이 보여줘야 한다.
