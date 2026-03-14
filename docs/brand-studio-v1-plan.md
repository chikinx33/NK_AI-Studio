# Brand Studio V1 Plan

## 1. Goal

Brand Studio V1의 목표는 `Project 중심 SNS 운영 시스템`을 만드는 것이다.

V1은 Creator OS의 전체 완성본이 아니라, 다음 단계로 확장 가능한 `Brand Operations`의 최소 실전 버전이어야 한다.

핵심 범위:

- 프로젝트 문맥 유지
- SNS용 콘텐츠 생성
- 캡션 생성
- 해시태그 생성
- 채널 연결
- 업로드/예약 게시

## 2. Module Structure

### Project Core

- `project-service`
- `project-profile-service`
- `project-asset-service`
- `project-channel-service`

### Content Library

- `content-library-service`
- `content-transform-service`
- `content-version-service`

### Brand Studio

- `brand-content-service`
- `caption-service`
- `hashtag-service`
- `publish-service`
- `schedule-service`

### Channel Hub

- `channel-connection-service`
- `channel-adapter-youtube`
- `channel-adapter-instagram`
- `channel-adapter-tiktok`
- `channel-adapter-x`

### Future-ready Layers

- `knowledge-service`
- `brand-intelligence-service`

V1에서는 Future-ready Layers를 얇은 데이터 구조만 먼저 준비하고, 실제 운영 기능은 후속 버전에서 붙인다.

## 3. Data Model

### projects

- `id`
- `name`
- `slug`
- `project_type`
- `description`
- `status`
- `created_at`
- `updated_at`

### project_profiles

- `project_id`
- `brand_summary`
- `core_message`
- `target_audience`
- `brand_voice`
- `brand_tone`
- `brand_keywords`
- `brand_rules`
- `brand_story`
- `brand_character`

### project_assets

- `id`
- `project_id`
- `asset_type`
- `title`
- `source_type`
- `file_url`
- `metadata_json`

### contents

- `id`
- `project_id`
- `content_type`
- `source_type`
- `origin_engine`
- `origin_ref_id`
- `title`
- `body_text`
- `media_url`
- `thumbnail_url`
- `status`
- `created_at`
- `updated_at`

### content_variants

- `id`
- `content_id`
- `channel_type`
- `variant_type`
- `caption`
- `hashtags`
- `media_url`
- `status`

### channels

- `id`
- `project_id`
- `channel_type`
- `account_name`
- `account_ref`
- `auth_status`
- `settings_json`

### publish_jobs

- `id`
- `project_id`
- `content_variant_id`
- `channel_id`
- `publish_type`
- `scheduled_at`
- `published_at`
- `status`
- `remote_post_id`
- `error_message`

### analytics_snapshots

- `id`
- `publish_job_id`
- `captured_at`
- `views`
- `likes`
- `comments`
- `shares`
- `clicks`

## 4. UI Structure

### 4.1 Project Home

역할:

- 프로젝트의 현재 브랜드 운영 상태 요약
- 최근 콘텐츠
- 예약 게시
- 연결 채널

사용자 편의 규칙:

- 가장 자주 쓰는 액션을 상단에 배치
- `새 SNS 콘텐츠 만들기`와 `예약 게시 확인`을 첫 화면에서 바로 접근 가능하게 유지

### 4.2 Content Studio

역할:

- SNS 게시물, 쇼츠 홍보, 홍보 이미지, 블로그 글 생성

구조:

- 좌측: 콘텐츠 유형 선택
- 중앙: 생성 입력과 결과 편집
- 우측: 프로젝트 자산, 참조 콘텐츠, 브랜드 가이드

사용자 편의 규칙:

- 콘텐츠 생성과 편집을 같은 흐름 안에서 처리
- 사용자에게 `다음 단계` 버튼을 명확히 노출

### 4.3 Content Library

역할:

- Creative 결과물과 Brand 결과물을 공통 관리

사용자 편의 규칙:

- 타입, 출처, 프로젝트, 채널 기준 필터 제공
- Creative 결과물을 Brand Studio로 넘기는 빠른 액션 제공

### 4.4 Channel Manager

역할:

- 프로젝트별 채널 연결과 기본 게시 설정 관리

사용자 편의 규칙:

- 채널별 연결 상태를 한눈에 보여주기
- 실패/미연결 상태를 명확한 언어로 설명

### 4.5 Publisher

역할:

- 업로드, 예약 게시, 게시 이력 확인

사용자 편의 규칙:

- 게시 전 미리보기 필수
- 예약 시간, 채널, 캡션, 해시태그를 한 화면에서 검토 가능하게 설계

## 5. UX Non-Negotiables

- Project 문맥은 모든 화면 상단에서 항상 보여야 한다.
- 사용자는 현재 작업이 `Creative`, `Brand`, `Publish`, `Analyze` 중 어디인지 즉시 이해해야 한다.
- 복잡한 내부 구조를 사용자에게 직접 노출하지 않는다.
- 사용자가 자주 반복하는 작업은 최대 3단계 이내로 끝나야 한다.
- 실패한 작업은 원인과 다음 행동을 같이 보여줘야 한다.

## 6. Delivery Order

1. Project Core 정리
2. Content Library 공통화
3. Brand Studio V1 UI/DB/API
4. Channel 연결 및 예약 게시
5. Brand Hub 입력 구조 준비
6. Analytics 수집 구조 준비

## 7. Success Criteria

- 사용자가 Project 하나를 선택한 뒤 Brand 콘텐츠를 1분 안에 생성 시작할 수 있어야 한다.
- Creative 결과물을 Brand Studio로 넘길 때 추가 학습 없이 이해 가능해야 한다.
- 예약 게시 흐름이 수동 메모 없이 완료되어야 한다.
- 사용자는 `이 플랫폼이 복잡하다`보다 `내 프로젝트를 한 곳에서 관리한다`는 인상을 받아야 한다.
