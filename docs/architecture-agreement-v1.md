# NK AI Studio Architecture Agreement v1

## 1. Product Vision

NK AI Studio의 최종 제품 정체성은 단순한 AI 생성툴이 아니라 `Creator Operating System`이다.

이 시스템은 창작자가 하나의 플랫폼에서 다음 활동을 운영할 수 있도록 설계된다.

- 콘텐츠 제작
- 브랜드 운영
- 채널 배포
- 반응 분석
- 전략 개선

즉 NK AI Studio는 다음 확장 구조를 목표로 한다.

- 콘텐츠 생성 도구
- 콘텐츠 운영 시스템
- 창작자 운영체제

## 2. Core Principle

모든 기능의 최상위 루트는 `Project`이다.

Project는 단순 폴더가 아니라 브랜드 운영 단위이며, 모든 콘텐츠 생성과 배포의 문맥이 된다.

예시 프로젝트:

- 모양새 친구들
- 우씨 성경앱
- 우울의 숲
- MinefieldMaster
- NK AI Studio
- 외주 광고 프로젝트

## 3. System Layers

NK AI Studio 전체 구조는 다음 레이어를 기준으로 확장한다.

- `Project Core`
- `Creative Studio`
- `Brand Studio`
- `Knowledge Hub`
- `Brand Intelligence`

구현 단계에서는 `Content Library`를 Creative 결과물과 Brand 운영을 연결하는 공용 저장 계층으로 사용한다.

## 4. Project Core

Project Core는 시스템의 루트이며 모든 기능이 공유한다.

Project에는 다음 정보가 포함된다.

- 프로젝트 이름
- 프로젝트 유형
- 브랜드 요약
- 핵심 메시지
- 타깃 사용자
- 브랜드 톤 앤 매너
- 키워드
- 대표 자산
- 연결 채널

## 5. Creative Studio

Creative Studio는 콘텐츠 제작 엔진이다.

주요 기능:

- 영상 제작
- 이미지 제작
- 음원 제작
- 문서 제작

Creative 결과물은 자동으로 `Content Library`에 저장된다.

## 6. Brand Studio

Brand Studio는 콘텐츠 운영 레이어이다.

Creative Studio에서 만든 결과물이나 외부/수동 업로드 콘텐츠를 실제 브랜드 콘텐츠로 운영한다.

주요 기능:

- SNS 콘텐츠 생성
- 캡션 생성
- 해시태그 생성
- 콘텐츠 변형
- 채널 선택
- 업로드
- 예약 게시

## 7. Knowledge Hub

Knowledge Hub는 프로젝트의 브랜드 지식 저장소이다.

저장 범위:

- 캐릭터 설정
- 세계관
- 브랜드 규칙
- 금지 표현
- 브랜드 톤
- 주요 메시지
- 참조 콘텐츠
- 과거 성공 사례

AI는 콘텐츠 생성 시 Knowledge Hub를 참고한다.

## 8. Brand Intelligence

Brand Intelligence는 분석 및 전략 레이어이다.

초기 단계 기능:

- 채널별 반응 분석
- 콘텐츠 유형 성과 분석
- 업로드 시간 성과 분석
- 해시태그 성과 분석

장기 목표:

- 콘텐츠 전략 추천
- 채널 전략 추천
- 콘텐츠 자동 제안

## 9. Release Roadmap

### V1: Brand Operations

- Project Core
- SNS 콘텐츠 생성
- 캡션 생성
- 해시태그 생성
- 채널 연결
- 예약 게시

### V1.5: Knowledge-driven Content

- Knowledge Hub
- 브랜드 기반 콘텐츠 생성

### V2: Brand Intelligence

- 반응 분석
- 콘텐츠 성과 분석
- 채널 분석

### V3: Creator OS

- 전략 추천
- 콘텐츠 자동 제안
- 브랜드 성장 지원 시스템

## 10. Critical Design Rule

Brand Studio는 독립된 기능 페이지가 아니다.

반드시 다음 흐름을 유지해야 한다.

`Creative 결과물 생성 -> Content Library 저장 -> Brand Studio 운영 -> 채널 배포 -> 반응 데이터 축적 -> Brand Intelligence 분석`

이 구조를 유지해야 NK AI Studio는 단순 생성툴이 아니라 Creator Operating System이 된다.

## 11. Usability Rule

이 시스템은 결국 사용자가 사용하기 편리해야 한다.

모든 구현은 다음 사용성 원칙을 따라야 한다.

- 사용자는 항상 현재 작업 중인 Project 문맥을 잃지 않아야 한다.
- 생성, 저장, 배포, 분석 흐름은 한 화면에서 다음 단계가 자연스럽게 이어져야 한다.
- 고급 기능보다 자주 쓰는 기능이 먼저 보여야 한다.
- 콘텐츠 제작 결과를 Brand 운영으로 넘기는 과정은 클릭 수와 판단 부담이 적어야 한다.
- 시스템 구조가 복잡해져도 사용자는 단순한 흐름으로 느껴야 한다.

이 원칙은 모든 UI/DB/모듈 설계보다 우선한다.

## 12. Development Checklist

다음 체크리스트를 기준으로 개발을 진행하고, 완료 시 하나씩 체크한다.

### V1 Foundation

- [x] Architecture Agreement v1 문서 확정
- [x] 사용 편의성 원칙을 최상위 설계 규칙으로 반영
- [x] `Content Library` 기초 서비스 추가
- [x] 대시보드에서 프로젝트별 콘텐츠 요약 표시
- [x] `Project Core` 데이터 구조를 Brand Studio 기준으로 확장
- [x] `Content Library` 전용 화면 골격 추가

### V1 Brand Operations

- [x] Brand Studio 화면 골격 추가
- [x] SNS 콘텐츠 유형 선택 UI 추가
- [x] 캡션 생성 흐름 추가
- [x] 해시태그 생성 흐름 추가
- [x] 채널 연결 구조 추가
- [x] 예약 게시 데이터 구조 추가

### V1.5 Knowledge-driven Content

- [x] Knowledge Hub 데이터 구조 추가
- [x] 브랜드 규칙 기반 생성 입력 연결
- [ ] 프로젝트별 참조 콘텐츠 저장 구조 추가

### V2 Brand Intelligence

- [ ] 게시 결과 수집 구조 추가
- [ ] 채널별 성과 분석 화면 추가
- [ ] 콘텐츠 유형 성과 분석 추가
- [ ] 업로드 시간/해시태그 성과 분석 추가

### V3 Creator OS

- [ ] 전략 추천 엔진 설계
- [ ] 콘텐츠 자동 제안 흐름 설계
- [ ] 브랜드 성장 지원 루프 연결
