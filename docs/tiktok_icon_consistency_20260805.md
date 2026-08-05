# TikTok 5차 반려 대응 — 브랜드 아이콘 일원화 설계서

- 작성일: 2026-08-05
- App ID: 7639434404980869140 (Production)
- 반려 사유(원문): *"Icon does not match brand. The app icon submitted in the Basic Info does not match the icon displayed on the website. Please ensure the same icon is used consistently across both the TikTok, the website and Browser tab (favicon), then resubmit for review"*
- 이 문서가 SSOT다. 아이콘/로고 관련 변경은 전부 여기 기준으로 한다.

---

## 1. 원인 (파일로 확인한 사실)

심사관은 ①포털 Basic Info 아이콘 ②`nkstudio.org` 화면 로고 ③브라우저 탭 파비콘 **3개를 나란히 비교**한다.
셋이 전부 달랐다.

| # | 노출 지점 | 반려 시점 상태 | 판정 |
|---|---|---|---|
| 1 | TikTok 포털 Basic Info 앱 아이콘 | 뇌 일러스트 (`tiktok-app-icon-1024.png`) | 기준값 |
| 2 | 브라우저 탭 / `favicon.svg` | 검은 라운드 사각 + 흰 NK 모노그램 | ❌ #1과 완전 다름 |
| 3 | 랜딩 헤더 `index.html:144` `<div class="logo"><i></i>` | 20px 원뿔 그라디언트 색덩어리 (CSS로 그림) | ❌ 로고 자체가 없음 |
| 4 | 로그인 카드 `app.html:74` | 뇌 일러스트 `logo(500500).png` | #1과 같음 |
| 5 | privacy/terms/support/tiktok.html 푸터 | 뇌 일러스트 | #1과 같음 |
| 6 | 인앱 헤더 `.brand-mark` (`styles.css:499`) | 뇌 일러스트 `images/logo.png` | #1과 같음 |
| 7 | JSON-LD Organization logo (`index.html:48`) | 뇌 일러스트 | #1과 같음 |
| 8 | OG 카드 `og-landing.png` | **NK 모노그램** | ❌ #1과 다름 |

### 1-2. 전수조사에서 추가로 나온 더 큰 구멍
`prototype/` HTML 34개 중 **19개에 `<link rel="icon">`이 아예 없다.**

```
admin / ai-image / ai-image-stage / ai-video / analytics / brand / brand-dashboard /
brand-studio / dashboard / image-dashboard / knowledge / library / media / scenario /
scenes / sns-settings / video-dashboard / video-gen-dashboard / ai-company/index
```

그리고 루트에 **`/favicon.ico`가 없었다.** 파비콘 선언이 없는 페이지는 브라우저가
`/favicon.ico`를 찾다가 실패 → **탭 아이콘이 빈칸**으로 뜬다.

여기에 **`sns-settings.html`이 포함된다.** 데모 영상 1(계정 연결)에서 심사관이 실제로 들어가는
바로 그 페이지다. 심사관 입장에서는 "TikTok 연동 화면의 탭 아이콘이 비어 있다" 가 된다.
`ai-company/index.html`은 apple-touch-icon이 `/ai-company/avatars/core.png`(AI 직원 아바타)로
잡혀 있어 **또 다른 3번째 마크**를 노출하고 있었다.

> 이 항목은 1~4차 반려(확인화면·도메인·데모영상)와 축이 달라 기존 체크리스트에 없었다.
> 재발 방지를 위해 §5 체크리스트에 영구 편입한다.

---

## 2. 결정: 정본 마크 = **NK 모노그램** (`favicon.svg`)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="0" y="0" width="64" height="64" rx="12" ry="12" fill="#000"/>
  <path d="M12 48V16L36 48V16 M36 32L56 16 M36 32L58 48"
        fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

**근거**
- 이미 파비콘 + OG 카드 2곳의 정본이다. 뇌 일러스트를 정본으로 하면 이 2개를 새로 만들어야 한다.
- 벡터 원본이 있어 어떤 크기로도 동일 픽셀을 재생성할 수 있다. "동일 아이콘" 입증이 쉽다.
- 16px 탭에서도 판독된다. 뇌 일러스트는 16px에서 뭉개져 "같은 아이콘"으로 안 보일 위험이 있다.

**`favicon.svg`는 수정하지 않는다.** 나머지 전부를 여기에 맞춘다.

### 2-1. 생성 완료된 자산 (모두 `favicon.svg`에서 렌더링, 이미 로컬 배치됨)

| 파일 | 크기 | 용도 |
|---|---|---|
| `prototype/images/tiktok-app-icon-1024.png` | 1024² | **TikTok 포털 업로드용** |
| `prototype/images/logo.png` | 512² | JSON-LD, `.brand-mark` 인앱 헤더 |
| `prototype/images/logo(500500).png` | 500² | 로그인 카드, 법적 페이지 푸터 |
| `prototype/apple-touch-icon.png` | 180² | iOS 홈화면 |
| `prototype/favicon.ico` | 16/32/48 멀티 | 파비콘 선언 없는 페이지 폴백 |
| `prototype/favicon-32.png` | 32² | PNG 폴백 |
| `prototype/favicon-16.png` | 16² | PNG 폴백 |

**파일명을 기존 그대로 유지**했으므로 4·5·6·7번 지점은 HTML 수정 없이 자동 교체된다.
구 자산은 `_brand_backup_20260805/`에 백업해 뒀다(레포 밖, 배포 대상 아님).

---

## 3. 코드 수정 지점 (3건)

### A. 랜딩 헤더 로고 — `prototype/styles.landing-page.css` 39–40행

HTML은 건드리지 않고 CSS만 바꾼다. 변경 최소화.

```css
/* AS-IS */
.logo i{width:20px;height:20px;border-radius:6px;display:block;
  background:conic-gradient(from 200deg,var(--c1),var(--c5),var(--c4),var(--c2),var(--c3),var(--c1))}

/* TO-BE */
.logo i{width:20px;height:20px;display:block;
  background:url("favicon.svg") center/contain no-repeat}
```

`border-radius:6px` 제거: SVG가 자체 라운드(rx 12/64)를 갖고 있어 CSS로 한 번 더 깎으면
파비콘과 모서리가 미세하게 달라진다. 심사 기준은 "동일 아이콘"이므로 원본 형태 그대로 노출한다.

### B. 파비콘 선언 전역 통일 — HTML 34개 전부

모든 페이지 `<head>`에 아래 5줄이 있어야 한다. **루트 상대경로(`/`)로 쓴다** —
`ai-company/`가 하위 디렉터리라 상대경로면 깨진다.

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="shortcut icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
```

- 기존 `<link rel="icon" type="image/svg+xml" href="favicon.svg">` 1줄만 있는 10개 페이지 → 위 5줄로 교체
- 파비콘 선언이 없는 19개 페이지 → 위 5줄 추가
- `ai-company/index.html` → 기존 `<link rel="apple-touch-icon" href="/ai-company/avatars/core.png" />` **삭제** 후 위 5줄 추가
- `?v=` 캐시버스터는 붙이지 않는다 (커밋 훅이 관리하는 패턴과 충돌 방지)

### C. 인앱 헤더 마크 배경색 — `prototype/styles.css` 498행

새 아이콘은 모서리가 투명이라 기존 남색 배경이 모서리에 비친다.

```css
/* AS-IS */  background: #0b1224;
/* TO-BE */  background: transparent;
```

### 범위 밖 (건드리지 말 것)
- `favicon.svg` 자체 — 정본이다. 1바이트도 바꾸지 않는다.
- `og-landing.png` / `og-landing.svg` — 이미 모노그램. 정상.
- 랜딩 히어로·레이아웃·문구 — 랜딩 개편은 중단 상태 유지.
- `prototype/tiktok*.txt` URL 인증 파일 3개 — 삭제 금지.
- TikTok 스코프·제품·데모영상·Review Description — 이번 반려 사유와 무관. 그대로 재제출.

---

## 4. TikTok 포털 작업 (배포 완료 후에 할 것)

**순서를 지킨다. 사이트가 먼저 바뀌어 있어야 한다.**

1. 배포 완료 확인 → `https://nkstudio.org/` 탭 아이콘이 NK 모노그램인지 눈으로 확인
2. 포털 → 앱 선택 → 상단 토글이 **Production**인지 확인 (Sandbox 아님)
3. Basic Info → App icon → `prototype/images/tiktok-app-icon-1024.png` 업로드
   - 업로드 경로 주의: Windows 경로는 거부된다. `device_stage_files`로 올린 뒤
     `/mnt/user-data/uploads/...` 경로로 `file_upload` 할 것 (10MB/호출 상한)
4. Save → 아이콘 썸네일이 실제로 모노그램으로 바뀌었는지 확인
5. Submit for review

**제출 사유 (120자 제한 / 아래 118자)**

```
Unified app icon: portal icon, website logo and favicon now use the same NK mark across all pages on nkstudio.org.
```

---

## 5. 재제출 전 검증 체크리스트

사이트 배포 후, **시크릿 창**에서(파비콘 캐시 회피) 아래를 전부 눈으로 확인한다.

- [ ] `https://nkstudio.org/` — 탭 아이콘 = NK 모노그램
- [ ] `https://nkstudio.org/` — 좌상단 헤더 로고 = NK 모노그램 (그라디언트 덩어리 아님)
- [ ] `https://nkstudio.org/app.html` — 탭 + 로그인 카드 로고 = NK 모노그램
- [ ] `https://nkstudio.org/sns-settings.html` — **탭 아이콘이 빈칸이 아닐 것** ← 5차 반려 핵심
- [ ] `https://nkstudio.org/tiktok.html` — 탭 + 푸터 로고
- [ ] `https://nkstudio.org/privacy.html` / `terms.html` / `support.html` — 탭 + 푸터
- [ ] `https://nkstudio.org/ai-company/` — 탭 아이콘 (아바타 이미지가 아닐 것)
- [ ] `https://nkstudio.org/favicon.ico` 직접 접근 시 200 응답
- [ ] 포털 Basic Info 썸네일 = 위와 동일한 마크
- [ ] 포털 Production 탭에서 작업했는지 재확인

### 영구 규칙 (다음 심사에도 적용)
> **브랜드 마크는 한 곳에서만 정의한다.** 정본은 `prototype/favicon.svg` 하나뿐이고,
> 모든 래스터 자산은 여기서 렌더링해 생성한다. 새 HTML 페이지를 만들 때는 §3-B의 5줄을
> 무조건 포함한다. 로고 이미지를 새로 만들거나 다른 마크를 쓰는 일은 하지 않는다.

---

## 6. 승인 후 할 일 (기존 목록 유지)
`TIKTOK_APP_AUDITED=true` / 영상 분할 업로드(현재 64MB 가드) / 64MB 에러 메시지 영문 병기 /
creator_info 프리페치 / `video.list` Display API 별도 신청 / 사진 게시용 title 입력란 분리
