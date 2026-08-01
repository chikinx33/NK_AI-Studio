# TikTok Direct Post 확인 모달 — 구현 명세서 (2026-08-01)

> **이 문서는 `docs/tiktok_app_review_resubmit_20260801.md` §4를 대체한다.**
> §4는 스케치였고, 이 문서는 그대로 구현 가능한 계약이다.
>
> **이건 선택 항목이 아니다.** 이 모달이 라이브에 없으면 웹사이트와 설명문을 아무리 고쳐도
> `video.publish`는 승인되지 않는다. 심사관은 데모 영상에서 이 화면을 **눈으로 확인**한다.
> 더 나쁜 건, 제출한 Review Description이 "확인 화면이 있다"고 서술하므로 모달 없이 재제출하면
> **문서와 데모가 서로 모순되는 상태**가 되어 신뢰도까지 잃는다. 순서를 반드시 지킬 것.

---

## 0. 심사 항목 ↔ UI 요소 ↔ 데모 영상 매핑

심사관이 체크하는 항목은 아래 7개다. 각 행이 모달의 한 요소이고, 데모 영상의 한 장면이다.

| # | TikTok 요구사항 | 모달 요소 | 현재 상태 |
|---|---|---|---|
| 1 | 게시될 계정을 사용자가 인지할 것 | 크리에이터 아바타 + 닉네임 + `@username` | ❌ 없음 |
| 2 | 공개범위를 사용자가 직접 선택. `creator_info`의 `privacy_level_options`만 노출 | Audience 라디오 그룹 | ❌ 서버 하드코딩 |
| 3 | 공개범위 **사전 선택 금지**, 미선택 시 게시 불가 | 초기값 없음 + Post 버튼 disabled | ❌ |
| 4 | 댓글/듀엣/스티치 **전부 기본 OFF**, 사용자가 직접 켤 것 | Interaction 체크박스 3종 | ❌ **역방향으로 구현됨** (아래 §1 참조) |
| 5 | 크리에이터가 막아둔 인터랙션은 회색 처리 | `comment_disabled` 등 반영 | ❌ |
| 6 | 상업적 콘텐츠 고지 토글 + 라벨 안내 + 정책 동의문 | Disclose content 토글 + 하위 2종 | ❌ 항상 false |
| 7 | 게시 진행/완료 상태 표시 | Posting → Posted + 게시물 링크 | △ 부분 |

---

## 1. ⚠️ 현재 코드가 가이드라인을 **정반대로** 구현하고 있는 지점

`prototype/functions/api/sns/publish.ts:394-396, 471`

```ts
disable_duet: false,
disable_comment: false,
disable_stitch: false,
```

`disable_* = false` 는 곧 **댓글·듀엣·스티치를 전부 켠 채로 게시**한다는 뜻이다.
TikTok 가이드라인 원문은 이렇다:

> "Users must manually turn on these interaction settings and **none should be checked by default**."

즉 기본값은 `disable_* = true`(전부 꺼짐)여야 하고, 사용자가 모달에서 체크한 것만 `false`로 내려가야 한다.
지금은 사용자에게 묻지도 않고 전부 켠다 — **가이드라인 위반이 코드에 박혀 있는 상태**다.
이건 모달을 만들면서 같이 뒤집어야 한다.

---

## 2. 코드 위치 지도 (실측)

| 역할 | 파일:라인 | 비고 |
|---|---|---|
| 프런트 게시 진입점 | `prototype/js/ui/brand-studio.js:3759` `snsPublishFormat(formatId, drafts, scheduledAt)` | 여기서 TikTok 분기를 잡아야 함 |
| 실제 fetch | `prototype/js/ui/brand-studio.js:3918` `fetch('/api/sns/publish')` | 모달 확정 후에만 도달해야 함 |
| 일괄 배포 호출부 | `prototype/js/ui/brand-studio.js:4006, 4069` | **여러 플랫폼을 한 번에 돌리는 루프** — §6 참조 |
| 서버 진입 | `prototype/functions/api/sns/publish.ts:911-916` `body = await request.json()` | 계약 확장 지점 |
| creator_info 조회 | `prototype/functions/api/sns/publish.ts:338` | 재사용해서 신규 API로 노출 |
| 영상 init | `prototype/functions/api/sns/publish.ts:387` `post/publish/video/init/` | |
| 사진 init | `prototype/functions/api/sns/publish.ts:461` `post/publish/content/init/` | |

---

## 3. 신규 API — `GET /api/sns/tiktok/creator-info`

신규 파일: `prototype/functions/api/sns/tiktok/creator-info.ts`

`publish.ts:323` 부근의 `creator_info/query` 호출 로직을 공용 함수로 빼서 양쪽이 같이 쓴다.
(중복 구현 금지 — 두 곳이 갈라지면 모달이 보여주는 값과 실제 게시 값이 어긋난다.)

**Response 200**

```json
{
  "ok": true,
  "creatorNickname": "NK Studio",
  "creatorUsername": "nkstudio",
  "creatorAvatarUrl": "https://p16-sign...",
  "privacyLevelOptions": ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  "commentDisabled": false,
  "duetDisabled": false,
  "stitchDisabled": true,
  "maxVideoPostDurationSec": 600,
  "appAudited": false
}
```

- `creatorAvatarUrl` 의 TTL은 2시간. 캐시하지 말고 모달을 열 때마다 새로 조회한다.
- `appAudited` 는 환경변수 `TIKTOK_APP_AUDITED`(기본 `"false"`)를 읽어서 내려준다.
  **심사 통과 후 이 값만 `true`로 바꾸면 공개 게시가 열리도록** 설계할 것. 로직 재배포 불필요.

**Response 412** — TikTok 미연결 / 토큰 만료
```json
{ "ok": false, "error": "tiktok_reconnect_required" }
```

**Response 502** — TikTok API 실패
```json
{ "ok": false, "error": "creator_info_unavailable", "detail": "..." }
```
→ 프런트는 모달을 열되 **게시 버튼을 비활성**하고 "Could not load your TikTok account settings. Please try again." 을 띄운다.
**절대 기본값으로 추측해서 게시하면 안 된다.**

---

## 4. `POST /api/sns/publish` 계약 변경

### 4-1. 요청 바디 추가 필드 (platform === "tiktok" 일 때만)

```jsonc
{
  "platform": "tiktok",
  // ... 기존 필드 (mediaType, mediaGcsPath, caption, ...)
  "tiktok": {
    "privacyLevel": "SELF_ONLY",     // 필수. creator_info가 준 값 중 하나
    "allowComment": false,           // 사용자가 체크한 것만 true
    "allowDuet": false,
    "allowStitch": false,
    "commercialContent": false,      // Disclose 토글
    "brandOrganic": false,           // "Your brand"
    "brandedContent": false,         // "Branded content"
    "consentAcknowledged": true      // 동의문이 화면에 표시된 상태로 확정했음
  }
}
```

### 4-2. 서버 검증 매트릭스 (전부 구현할 것)

| 조건 | 응답 | 이유 |
|---|---|---|
| `tiktok.privacyLevel` 누락/빈값 | `400 privacy_level_required` | 묵시적 기본값 금지. 옛 클라이언트가 조용히 게시하는 경로를 원천 차단 |
| `privacyLevel` 이 `creator_info.privacy_level_options` 에 없음 | `400 privacy_level_not_allowed` | 조작된 요청 방어 |
| `appAudited === false` && `privacyLevel !== "SELF_ONLY"` | `SELF_ONLY` 로 강제 다운그레이드 + 응답에 `"downgradedTo":"SELF_ONLY","reason":"app_not_audited"` | 승인 전 공개 노출 차단 |
| `brandedContent === true` && `privacyLevel === "SELF_ONLY"` | `400 branded_content_cannot_be_private` | TikTok 규칙: 브랜디드 콘텐츠는 비공개 불가 |
| `commercialContent === true` && `brandOrganic === false` && `brandedContent === false` | `400 commercial_disclosure_incomplete` | 토글만 켜고 종류 미선택 |
| `consentAcknowledged !== true` | `400 consent_required` | 동의문 미표시 상태의 게시 차단 |
| 영상 길이 > `maxVideoPostDurationSec` | `400 video_too_long` | |

### 4-3. TikTok API 로 내려보낼 값 매핑

```ts
post_info: {
  title: caption,
  privacy_level: effectivePrivacyLevel,          // 다운그레이드 적용 후
  disable_comment: !tiktok.allowComment,         // ★ 반전 주의
  disable_duet:    !tiktok.allowDuet,            // 사진 게시에는 미전송
  disable_stitch:  !tiktok.allowStitch,          // 사진 게시에는 미전송
  brand_content_toggle: !!tiktok.brandedContent,
  brand_organic_toggle: !!tiktok.brandOrganic,
}
```

`disable_*` 기본값 `false` 하드코딩(§1)은 **전부 제거**한다.

---

## 5. 모달 UI 명세

신규 파일 권장: `prototype/js/ui/tiktok-consent-modal.js`
기존 모달 스타일 토큰 재사용. **새 디자인 시스템 만들지 말 것.**

### 5-1. 공개 인터페이스

```js
// resolve → 사용자가 확정한 설정 객체 (§4-1 의 tiktok 오브젝트)
// reject / resolve(null) → 사용자가 취소
NK.tiktokConsentModal.open({
  mediaType: 'video' | 'image',
  mediaPreviewUrl: '...',
  caption: '...',
  videoDurationSec: 42        // mediaType==='video' 일 때만
}) // => Promise<TikTokPostSettings|null>
```

### 5-2. 요소별 명세 — 영문 문구는 **아래 원문 그대로** 쓸 것 (심사관이 대조한다)

**① 계정 헤더**
- 아바타(원형 40px) + `creatorNickname` + 회색 `@creatorUsername`
- `creator-info` 로딩 중에는 스켈레톤, 실패 시 §3의 에러 문구

**② 미디어 프리뷰 + 캡션**
- 썸네일 + 캡션 전문(읽기 전용으로 충분). 사용자가 "무엇이 나가는지" 보는 게 목적

**③ Audience — 라디오 그룹**
- 라벨: `Who can view this video` (사진이면 `Who can view this photo`)
- `privacyLevelOptions` **순서 그대로**, 아래 표기로 렌더:

| API 값 | 표기 |
|---|---|
| `PUBLIC_TO_EVERYONE` | `Public` |
| `FOLLOWER_OF_CREATOR` | `Followers` |
| `MUTUAL_FOLLOW_FRIENDS` | `Friends` |
| `SELF_ONLY` | `Only you` |

- ★**초기 선택 없음.** 미선택이면 Post 버튼 `disabled`
- `appAudited === false` → `SELF_ONLY` 외 항목 `disabled` + 툴팁
  `Available after TikTok app review`
- `brandedContent === true` 로 바뀌면 `SELF_ONLY` 를 `disabled` 처리하고,
  이미 선택돼 있었다면 선택을 해제한 뒤 아래 문구 표시:
  `Branded content visibility cannot be set to private.`

**④ Interaction — 체크박스 3종**
- 라벨: `Allow users to`
- 항목: `Comment` / `Duet` / `Stitch`
- ★**3개 모두 기본 해제(unchecked).** 사용자가 켠 것만 허용된다
- `commentDisabled`/`duetDisabled`/`stitchDisabled` 가 `true`인 항목은 `disabled` + 회색 + 툴팁
  `Turned off in your TikTok account settings`
- `mediaType === 'image'` 이면 Duet / Stitch 는 **렌더하지 않는다**

**⑤ Commercial content disclosure**
- 토글 라벨: `Disclose video content` (사진이면 `Disclose photo content`)
- 토글 설명: `Turn on to disclose that this video promotes goods or services in exchange for something of value. Your video could promote yourself, a third party, or both.`
- ★기본 OFF
- ON 시 체크박스 2개 노출:
  - `Your brand` — 설명 `You are promoting yourself or your own business. This video will be classified as Brand Organic.`
  - `Branded content` — 설명 `You are promoting another brand or a third party. This video will be classified as Branded Content.`
- 라벨 안내 배너 (선택에 따라 **하나만** 표시):

| 선택 | 표시 문구 (원문 고정) |
|---|---|
| `Your brand` 만 | `Your photo/video will be labeled as 'Promotional content'. This cannot be changed once your video is posted.` |
| `Branded content` 포함(단독 또는 둘 다) | `Your photo/video will be labeled as 'Paid partnership'. This cannot be changed once your video is posted.` |

- 토글은 켰는데 둘 다 미선택이면 Post 버튼 `disabled`

**⑥ 동의문 — 모달 하단 고정**

| 조건 | 문구 (원문 고정) |
|---|---|
| 기본 / `Your brand` 만 | `By posting, you agree to TikTok's `[`Music Usage Confirmation`](https://www.tiktok.com/legal/page/global/music-usage-confirmation/en)`.` |
| `Branded content` 포함 | `By posting, you agree to TikTok's `[`Branded Content Policy`](https://www.tiktok.com/legal/page/global/bc-policy/en)` and `[`Music Usage Confirmation`](https://www.tiktok.com/legal/page/global/music-usage-confirmation/en)`.` |

- 두 링크는 반드시 **실제 클릭 가능한 새 탭 링크**. 텍스트만 있으면 안 된다

**⑦ 버튼**
- `Cancel` / `Post to TikTok`
- Post 활성 조건: 공개범위 선택됨 && (Disclose OFF || 하위 1개 이상 선택) && creator-info 로딩 성공
- 클릭 후: 버튼을 `Posting to TikTok...` + 스피너로 바꾸고 잠금
- 완료 시: `Your video has been posted to TikTok.` + 게시물 링크
- 실패 시: 에러 문구를 모달 안에 표시하고 **입력값을 유지한 채** 재시도 허용

**⑧ 영상 길이 초과**
- `videoDurationSec > maxVideoPostDurationSec` 이면 Post 비활성 +
  `This video is longer than your TikTok limit of {N} seconds.`

---

## 6. ⚠️ 일괄 배포(one-click) 경로 — 반드시 같이 처리

`snsPublishFormat` 은 `brand-studio.js:4006, 4069` 에서 **여러 플랫폼을 루프로 돌린다.**
지금 구조 그대로면 "한 번에 배포" 버튼 하나로 TikTok에 확인 없이 게시된다.
이건 TikTok이 명시적으로 금지하는 패턴이고, 심사관이 이 버튼을 누르면 즉시 반려다.

**처리 방식:**

```js
// snsPublishFormat 안, requestBody 조립 직전
if (formatId === 'tiktok') {
  return NK.tiktokConsentModal.open({...}).then(function (settings) {
    if (!settings) return { skipped: true, reason: 'user_cancelled' };
    requestBody.tiktok = settings;
    return doPublish(requestBody);
  });
}
```

- 여러 플랫폼 일괄 배포 시 TikTok 모달은 **그 순서에서 한 번 뜬다.** 다른 플랫폼은 영향 없음
- 사용자가 취소하면 TikTok만 skip, 나머지 플랫폼은 정상 진행
- **예약 발행(`scheduledAt`)에 TikTok을 포함시키지 말 것.** 사용자가 없는 시점에 확인 화면 없이
  게시되는 경로가 되어 가이드라인 위반이다. TikTok 포맷은 예약 UI에서 제외하거나,
  "TikTok은 즉시 게시만 지원합니다 / TikTok supports immediate posting only" 로 안내한다

---

## 7. 수용 기준 — 재제출 전 자가 점검

전부 ✅ 여야 재제출한다. 하나라도 ❌면 재제출하지 않는다.

- [ ] `connect/tiktok.ts` scope 에 `video.upload` 없음
- [ ] `https://nkstudio.org/tiktok` 이 로그인 없이 열리고, 스크린샷이 들어가 있음
- [ ] `https://nkstudio.org/support` 가 로그인 없이 열림
- [ ] 모든 공개 페이지 푸터에 Terms / Privacy 링크가 **직접** 보임
- [ ] TikTok 게시 버튼 → 확인 모달이 뜬다 (즉시 발행되지 않는다)
- [ ] 모달에 아바타 + 닉네임 + `@username` 이 보인다
- [ ] 공개범위가 **아무것도 선택 안 된 상태**로 열리고, 그 상태에서 Post 버튼이 눌리지 않는다
- [ ] Comment / Duet / Stitch 가 **전부 해제된 상태**로 열린다
- [ ] `creator_info` 가 disabled로 준 항목이 회색 처리된다
- [ ] Disclose 토글 → `Your brand` / `Branded content` → 라벨 안내 문구가 §5-2 원문 그대로 뜬다
- [ ] `Branded content` + `Only you` 조합이 UI에서 막힌다
- [ ] Branded Content Policy / Music Usage Confirmation 링크가 실제로 열린다
- [ ] `disable_comment` 등이 사용자가 체크한 값의 **반전**으로 전송된다 (네트워크 탭에서 확인)
- [ ] `tiktok.privacyLevel` 없이 `/api/sns/publish` 를 직접 호출하면 400
- [ ] 일괄 배포 버튼으로도 TikTok 모달이 반드시 뜬다
- [ ] Developer Portal > URL properties 에 `https://nkstudio.org/api/sns/tiktok-media` verified
- [ ] 실서비스에서 연결 → 게시 → Analytics 동기화가 1회 완주됨

---

## 8. 데모 영상 샷 리스트

3개 영상으로 쪼개는 걸 권장(각 50MB 이하, 도메인이 `nkstudio.org`로 보여야 함).

**영상 1 — Login Kit (`user.info.basic`), 약 40초**
1. `nkstudio.org` 홈 → Sign in
2. Settings > SNS Connections
3. Connect TikTok 클릭 → TikTok 인증 화면 → Authorize
4. 돌아온 화면에 **연결된 계정명이 표시되는 것**을 2초 이상 정지해서 보여줌

**영상 2 — Direct Post (`video.publish`), 약 90초 ★가장 중요★**
1. 프로젝트에서 생성된 영상과 캡션 확인
2. Publish to TikTok 클릭 → **확인 모달 등장**
3. 아바타·닉네임 위에 커서 2초 정지
4. Audience 라디오가 **미선택 상태**인 것을 보여주고, Post 버튼이 비활성인 것을 클릭 시도로 보여줌
5. Audience 선택 (`Only you`) — 비활성 옵션의 툴팁도 한 번 노출
6. Comment 체크 → Duet/Stitch 는 해제 상태 유지 (기본 OFF임을 보여줌)
7. Disclose 토글 ON → `Branded content` 선택 → **'Paid partnership' 안내 문구**가 뜨는 걸 2초 정지
8. 하단 동의문과 두 링크를 2초 정지
9. Post to TikTok → `Posting to TikTok...` → 완료 메시지 + 게시물 링크
10. TikTok 앱/웹에서 실제 게시물 확인

**영상 3 — Display API (`video.list`), 약 30초**
1. Analytics 이동 → Sync
2. 조회수/좋아요/댓글/공유가 채워진 표와 차트
3. 썸네일 클릭 → TikTok 원본으로 이동하는 것

공통: 커서를 천천히, 각 화면 2초 이상 정지, 영어 자막 권장.
