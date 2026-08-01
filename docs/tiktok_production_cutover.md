# TikTok 프로덕션 앱 전환 절차 (심사 통과 후)

> 작성 2026-08-02. **심사 통과 전에는 실행하지 말 것.**
> 이 문서 없이 키만 바꾸면 기존 연결 사용자가 전원 조용히 깨진다.

---

## 1. 현재 상태 — 실서비스가 Sandbox 앱으로 돌고 있다

Cloudflare 환경변수 `TIKTOK_CLIENT_KEY` 가 `sb` 로 시작한다(`sbaw2ybq48zaki9ohw`).
`sb` 접두는 TikTok Sandbox 앱을 뜻한다. 즉 nkstudio.org 는 지금 심사 대상인 프로덕션
앱이 아니라 Sandbox 앱으로 OAuth·게시를 하고 있다.

| 포털 앱 | 용도 | 비고 |
|---|---|---|
| **NK AI Studio** (Production) | 심사 대상 | 승인 후 여기로 전환 |
| **NK Platform Sandbox** (`7639447423890425876`) | 현재 실동작 | 전환 후에도 개발용으로 유지 |

두 앱 모두 Website / Terms / Privacy / Redirect URI 가 `nkstudio.org` 로 맞춰져 있다
(2026-08-02 확인).

---

## 2. 전환 시 무엇이 깨지는가

액세스·리프레시 토큰은 **발급한 client_key 에 묶여 있다.** client_key/secret 을 프로덕션
값으로 바꾸는 순간, Sandbox 앱으로 받아둔 기존 토큰은 전부 무효가 된다.

영향 받는 코드 경로 (전부 `env.TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` 사용):

| 파일 | 증상 |
|---|---|
| `functions/api/_shared/tiktok-token.ts` | 토큰 갱신이 `tiktok_refresh_failed` 로 throw |
| `functions/api/sns/publish.ts` | 게시 시 400 "재연결해 주세요" |
| `functions/api/sns/tiktok/creator-info.ts` | 확인 모달이 412 `tiktok_reconnect_required` |
| `functions/api/sns/tiktok/inbox.ts` | 초안함 전송 400 |
| `functions/api/sns/analytics/sync.ts` | TikTok 동기화 실패 |
| `functions/auth/tiktok/callback.ts` | (재연결 시 새 키로 정상 발급) |

**즉 연결된 모든 사용자가 SNS 설정에서 TikTok 을 한 번 재연결해야 한다.**

> ⚠️ 알려진 빈틈: 전환 시 기존 연결을 일괄로 `needsReconnect` 로 표시하는 수단이 없다.
> 지금은 사용자가 게시를 시도해야 비로소 "재연결해 주세요" 에러를 만난다.
> 사용자가 많아지기 전이라면 그대로 진행해도 되지만, 규모가 커지면 GCS 의 각 사용자
> `sns-settings.json` 에 `sns.tiktok.needsReconnect = true` 를 일괄 세팅하는 스크립트를
> 먼저 만들 것. (SNS 설정 화면이 이 플래그를 이미 읽어 "재연결 필요" 배지를 띄운다)

---

## 3. 전환 순서 — 한 번에, 같은 시점에

`TIKTOK_APP_AUDITED=true` 를 키 교체와 **분리하면 안 된다.** 프로덕션 키 없이 audited 만
켜면 Sandbox 앱으로 공개 게시를 시도하다 TikTok 이 거부한다.

1. 포털에서 Production 앱(**NK AI Studio**) 승인 확인.
2. Production 앱의 **Redirect URI** 에 `https://nkstudio.org/auth/tiktok/callback` 등록 확인.
3. Production 앱의 **URL properties** 에 `https://nkstudio.org/api/sns/tiktok-media` 가
   verified 인지 확인 (사진 게시 PULL_FROM_URL 에 필요).
4. Cloudflare Pages 환경변수를 **한 번에** 교체:
   ```
   TIKTOK_CLIENT_KEY    = <production client key>   # sb 로 시작하지 않아야 한다
   TIKTOK_CLIENT_SECRET = <production client secret>
   TIKTOK_APP_AUDITED   = true
   ```
5. 재배포(환경변수 변경은 새 배포가 있어야 반영된다).
6. 본인 계정으로 **재연결 → 게시 → 초안함 전송** 1회 완주 확인.
   - 확인 모달에서 `SELF_ONLY` 외 공개 범위가 **선택 가능해졌는지** 반드시 확인.
     이게 되면 audited 반영이 성공한 것이다.
7. 기존 사용자에게 재연결 안내(공지/메일).

---

## 4. 롤백

환경변수를 Sandbox 값으로 되돌리고 재배포하면 된다. 단 **롤백 시점 이후 프로덕션 키로
재연결한 사용자는 다시 깨진다.** 전환은 되도록 한 방향으로 끝내고, 문제가 있으면
`TIKTOK_APP_AUDITED=false` 만 되돌려 공개 게시를 막는 쪽을 먼저 시도할 것
(키는 그대로 두면 연결은 유지된다).

---

## 5. 전환 후 함께 정리할 것

- `video.list`(Display API) 별도 신청 → 승인되면 `connect/tiktok.ts` scope 에 추가하고,
  Analytics 의 TikTok 카드와 `/tiktok` 페이지·제출 문서를 같이 되살린다.
  (스코프를 바꾸면 **코드 / `prototype/tiktok.html` EN·KO / `docs/tiktok_review_description_1000.txt`**
  3곳을 반드시 함께 수정 — `npm test` 가 3자 일치를 검사한다)
- 영상 분할 업로드(chunked upload) 구현 → 현재 64MB 가드 해제.
- `publish.ts` 64MB 초과 에러 메시지 영문 병기.
