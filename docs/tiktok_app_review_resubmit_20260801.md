# TikTok 앱 심사 재제출 설계서 (2026-08-01)

> 대상 앱: TikTok for Developers App `7639434404980869140` (status: pending → rejected)
> 원칙: **"통과에 필수인 것만"**. 랜딩 페이지 디자인 개편은 이 문서 범위 밖(사용자 지시로 중단 상태 유지).

---

## 1. 반려 사유 해부

리뷰어 노트 원문은 두 덩어리다.

| # | 리뷰어 지적 | 실제 의미 | 상태 |
|---|---|---|---|
| A-1 | "Website URL should not be login page URL" | 제출한 URL이 로그인 화면으로 떨어졌다 | 🔴 |
| A-2 | "Your website URL cannot be a landing page or login page. You must have an externally facing fully developed website." | 히어로+CTA 한 장짜리 랜딩은 '완성된 웹사이트'로 안 쳐준다. 서비스를 설명하는 **공개 하위 페이지들**이 있어야 한다 | 🔴 |
| A-3 | "a test account needs to be provided in Apply Reason" | 로그인이 필요한 부분이 있으면 심사용 계정을 Apply Reason에 텍스트로 박아야 한다 | 🔴 |
| B | "The Review Description provided is insufficient. Please provide a detailed description explaining what your app does, what scopes you are requesting, and how the data obtained from each scope will be used" | 스코프별로 **어디서 호출 / 무엇을 받고 / 어떻게 쓰고 / 어디에 저장하고 / 언제 삭제하는지**를 다 써야 한다 | 🔴 |

### 리뷰어가 아직 지적하지 않았지만 다음 라운드에 터질 것 (선제 처리)

| # | 문제 | 근거 |
|---|---|---|
| C-1 | **`video.upload` 스코프를 요청하는데 코드에 사용처가 0** | `functions/api/sns/connect/tiktok.ts:28`에서 요청. 그러나 `publish/inbox` 계열 엔드포인트 호출이 리포지토리 전체에 없음. 심사는 "요청한 모든 스코프를 데모로 증명"을 요구 → 증명 불가 스코프 = 반려 사유 |
| C-2 | **Direct Post UX 가이드라인 미준수** | `functions/api/sns/publish.ts`가 `privacy_level`을 서버에서 `SELF_ONLY`로 강제하고 `brand_content_toggle:false`, `disable_comment:false` 등을 하드코딩. 사용자에게 **게시 전 확인 화면**이 없음. TikTok은 Direct Post 승인 조건으로 (a) 크리에이터 닉네임 표시 (b) `creator_info` 기반 공개범위 선택 (c) 댓글/듀엣/스티치 토글 (d) 상업적 콘텐츠 고지 를 **UI로 보여줄 것**을 요구하고, 데모 영상에서 확인한다 |
| C-3 | 사이트가 한국어 전용 | 심사관은 영어권. 공개 페이지가 읽히지 않으면 "fully developed" 판정 자체가 안 됨. `terms.html` / `privacy.html`은 이미 KO/EN 병기라 문제 없음 |

---

## 2. 확정 사항

### 2-1. 요청 스코프: **3개** (사용자 확정 2026-08-01)

| 스코프 | TikTok 제품 | 코드상 실제 사용처 | 유지 |
|---|---|---|---|
| `user.info.basic` | Login Kit | `functions/auth/tiktok/callback.ts:197` — `open_id, display_name, username` | ✅ |
| `video.publish` | Content Posting API (Direct Post) | `functions/api/sns/publish.ts` — `creator_info/query` → `video/init` \| `content/init` → `status/fetch` | ✅ |
| `video.list` | Display API | `functions/api/sns/analytics/sync.ts:404` — 조회수·좋아요·댓글·공유 수집 | ✅ |
| ~~`video.upload`~~ | Content Posting API (inbox) | **사용처 없음** | ❌ 제거 |

### 2-2. 제출할 Website URL

```
https://nkstudio.org/
```

단, 아래 §3 공개 페이지가 배포된 **이후에** 제출한다. 지금 상태로 다시 내면 A-2로 똑같이 반려된다.
Review Description 안에 `https://nkstudio.org/tiktok` 을 별도로 명시해서 리뷰어를 바로 그 페이지로 유도한다.

---

## 3. 웹사이트 요건 — 최소 구성 (A-1 / A-2 해결)

TikTok의 판정 기준은 세 가지다: ① 로그인 없이 열리는가 ② 서비스를 설명하는 페이지가 **여러 장** 있는가 ③ Terms / Privacy 링크가 **메뉴 안에 숨지 않고 바로** 보이는가.

### 신규 페이지 2장 (이게 최소치다)

#### ① `prototype/tiktok.html` → `https://nkstudio.org/tiktok` — **최우선**

심사관이 실제로 읽는 페이지. **영어 우선**, 하단에 한국어 병기(기존 `terms.html` / `privacy.html`과 동일한 2단 구조 재사용).

담을 섹션:

1. **What NK AI Studio is** — 3~4문단. AI로 기획·글·이미지·영상·사운드를 만들고, 사람이 승인한 뒤에만 연결된 SNS에 게시하고, 성과를 분석하는 플랫폼.
2. **How the TikTok integration works** — 4단계 흐름 (Connect → Create → Review & Approve → Publish & Measure). 각 단계에 실제 UI 스크린샷 1장씩. *(스크린샷 없으면 이 페이지의 설득력이 절반으로 떨어진다. 반드시 넣을 것.)*
3. **Permissions we request** — 스코프 3개를 표로. 열: Scope / What we access / Why / What we store. §5의 Review Description 본문을 그대로 재사용.
4. **What we never do** — 자동/무단 게시 없음, 타 사용자에게 노출 없음, 판매·모델학습 사용 없음, 영상 파일 재호스팅 없음.
5. **Data retention & deletion** — 연결 해제 시 토큰·캐시 즉시 삭제, 계정 삭제 시 전량 삭제.
6. **Contact** — `chikinx1@gmail.com`, 응답 기한 명시(예: within 3 business days).
7. 하단 고정 링크: Terms of Service / Privacy Policy / Home.

#### ② `prototype/support.html` → `https://nkstudio.org/support`

영어 우선. 담을 것: 지원 이메일 + 응답 기한, FAQ 6~8개(계정 연결 방법 / 게시 실패 시 / 연결 해제 방법 / 데이터 삭제 요청 방법 / 지원 플랫폼 목록 / 요금), Terms·Privacy 링크.

### 기존 페이지 손볼 것 (디자인 변경 아님, 링크/언어만)

| 대상 | 작업 |
|---|---|
| `prototype/index.html` | 푸터에 `TikTok Integration`(`/tiktok`), `Support`(`/support`) 링크 2개 추가. **히어로·레이아웃·카피는 절대 건드리지 말 것** (랜딩 개편 중단 상태 유지) |
| `prototype/index.html` | `?lang=en` 쿼리로 진입 시 영어가 즉시 렌더되는지 확인. 안 되면 그것만 수정 |
| `prototype/terms.html`, `privacy.html` | 푸터에 `/tiktok`, `/support`, `/` 링크 추가해 공개 페이지끼리 상호 연결 (리뷰어가 "menu navigation 없이 접근 가능"을 확인함) |
| `prototype/sitemap.xml` | `/tiktok`, `/support` 2개 URL 추가, `lastmod` 갱신 |
| `prototype/privacy.html` | TikTok 항목(현재 388행 "연동 예정" 목록)을 **"현재 연동 중"** 으로 승격하고, 수집 항목을 스코프 3개 기준으로 정확히 기재 (`open_id, display_name, username, access/refresh token, 게시 publish_id·post id, 영상 메트릭`) |

> ⚠️ 이 §3은 랜딩 디자인 개편이 **아니다.** 공개 하위 페이지 추가 + 링크 배선일 뿐이다. 랜딩 비주얼 재작업은 레퍼런스 수령 전까지 계속 중단.

---

## 4. Direct Post 확인 화면 (C-2 해결) — 데모 영상의 핵심

현재 `publish.ts`는 사용자에게 아무것도 묻지 않고 서버에서 값을 정한다. 심사 통과에 이건 치명적이다. **Review Description에 "확인 화면이 있다"고 쓰려면 실제로 있어야 한다** — 데모 영상과 문서가 어긋나면 즉시 반려된다.

### 신규 API: `GET /api/sns/tiktok/creator-info`

`publish.ts`의 `creator_info/query` 호출 로직을 재사용해 프런트로 다음을 반환:

```json
{
  "ok": true,
  "creatorNickname": "...",
  "creatorAvatarUrl": "...",
  "privacyLevelOptions": ["SELF_ONLY", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "PUBLIC_TO_EVERYONE"],
  "commentDisabled": false,
  "duetDisabled": false,
  "stitchDisabled": false,
  "maxVideoPostDurationSec": 600,
  "appAudited": false
}
```

### 신규 UI: 게시 전 확인 모달

TikTok 게시 버튼 → 즉시 발행 ❌ → **모달을 먼저 띄운다**:

- 상단: 크리에이터 아바타 + 닉네임 (`@username`)
- 캡션 입력 + 미디어 썸네일 프리뷰
- **Who can view this video** — 라디오. `privacyLevelOptions`만 렌더. **초기 선택 없음(unselected)** — TikTok 가이드라인이 사전선택을 금지한다. 미선택 시 게시 버튼 비활성
  - `appAudited: false`면 `SELF_ONLY` 외 옵션은 disabled + 툴팁 `"Available after TikTok app review"`
- **Allow users to** — Comment / Duet / Stitch 체크박스. `creator_info`가 disabled로 준 항목은 체크 불가 + 회색 처리. (사진 게시는 Duet/Stitch 미노출)
- **Disclose video content** — 토글. 켜면 하위 체크박스 2개:
  - `Your brand` → `brand_organic_toggle: true`
  - `Branded content` → `brand_content_toggle: true`
  - Branded content 선택 시 공개범위에서 `SELF_ONLY` 제거(TikTok 규칙: 브랜디드 콘텐츠는 비공개 불가)
  - 고지 문구 자동 표시: 둘 다 → `"Your photo/video will be labeled as 'Paid partnership'"`, Your brand만 → `"...labeled as 'Promotional content'"`
  - 하단 동의문: `By posting, you agree to TikTok's` + [Branded Content Policy](https://www.tiktok.com/legal/page/global/bc-policy/en) + `and` + [Music Usage Confirmation](https://www.tiktok.com/legal/page/global/music-usage-confirmation/en) (브랜디드 콘텐츠 미선택 시엔 Music Usage Confirmation만)
- 버튼: `Post to TikTok` — 누른 뒤 `Posting to TikTok...` 상태 표시 → 완료 시 `Your video has been posted to TikTok` + 해당 게시물 링크

### `publish.ts` 계약 변경

`privacy_level` / `disable_comment` / `disable_duet` / `disable_stitch` / `brand_content_toggle` / `brand_organic_toggle` 를 **요청 바디에서 받는다.**

서버 측 방어는 유지:
- 바디에 `privacy_level`이 없으면 400 (묵시적 기본값 금지)
- `appAudited: false` 상태에서 `SELY_ONLY` 외 값이 들어오면 `SELF_ONLY`로 강제 다운그레이드 + 응답에 사유 포함
- `brand_content_toggle: true` + `privacy_level: SELF_ONLY` 조합은 400

---

## 5. Review Description 제출 원문

→ `tiktok_review_description_EN.txt` 별도 파일. 그대로 복사해서 붙여넣는다.
`<TEST_ID>` / `<TEST_PW>` 두 자리만 실제 값으로 치환할 것.

**주의:** 이 원문은 §4의 확인 모달이 **배포된 이후**에 제출해야 사실과 일치한다. 순서를 지킬 것.

---

## 6. 데모 영상 요건

- 최대 5개, 각 50MB 이하
- 화면에 보이는 도메인이 제출한 Website URL(`nkstudio.org`)과 **일치해야** 함 — localhost·pages.dev 화면 금지
- 스코프 3개가 전부 등장해야 함:
  1. `user.info.basic` — Settings → Connect TikTok → OAuth 동의 → 돌아와서 연결된 계정명이 화면에 표시되는 장면
  2. `video.publish` — 영상 생성 → **§4 확인 모달에서 공개범위·토글·상업적 콘텐츠 고지를 직접 선택하는 장면** → Post → 완료 상태
  3. `video.list` — Analytics 대시보드에 조회수/좋아요/댓글/공유가 채워진 장면
- 커서 이동을 천천히, 각 화면 2초 이상 정지. 자막(영어) 권장

---

## 7. 재제출 순서 (이 순서를 지킬 것)

1. `connect/tiktok.ts` scope 문자열에서 `video.upload` 제거 → 배포
2. `tiktok.html` / `support.html` 작성 + 푸터·사이트맵·privacy 배선 → 배포
3. §4 확인 모달 + `creator-info` API + `publish.ts` 계약 변경 → 배포
4. 배포된 실서비스에서 TikTok 연결 → 게시 → 분석 전 과정 1회 실동작 확인
5. 데모 영상 촬영 (§6)
6. 포털에서 수정:
   - Scopes: `video.upload` 체크 해제
   - Website URL: `https://nkstudio.org/`
   - Terms URL: `https://nkstudio.org/terms` / Privacy URL: `https://nkstudio.org/privacy`
   - Review Description: §5 원문 (테스트 계정 포함)
   - Demo video 업로드
7. Resubmit

---

## 8. 포털 URL properties 확인 (놓치기 쉬움)

`functions/api/sns/tiktok-media.ts` 주석대로, 사진 게시(PULL_FROM_URL)는 도메인 소유 인증이 필요하다.
TikTok Developer Portal → URL properties 에 아래가 **verified** 상태인지 확인:

```
https://nkstudio.org/api/sns/tiktok-media
```

미인증이면 사진 게시가 심사 중 실패하고, 데모 영상도 못 찍는다.
