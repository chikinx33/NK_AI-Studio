# `/tiktok` 페이지 스크린샷 명세 (2026-08-01)

> 대상: `prototype/images/tiktok/` (현재 README.md만 존재)
> 이게 §7 체크리스트 2번 항목이고, **남은 유일한 재제출 차단 요인**이다.
> "스크린샷 있으면 좋음"이 아니다 — 심사관이 `/tiktok` 페이지에서 우리 주장을 눈으로
> 대조하는 유일한 수단이고, 없으면 그 페이지는 그냥 텍스트 마케팅 문서로 읽힌다.

---

## 촬영 공통 규칙

- **브라우저 주소창이 보이게** 찍는다. `nkstudio.org` 도메인이 이미지 안에 있어야 한다.
  (심사관은 제출한 Website URL과 화면이 같은 서비스인지 대조한다. localhost·pages.dev 금지)
- 데스크톱 뷰포트 1440×900 기준, 가로 폭 1200px 이상으로 저장
- UI 언어는 **영어**로 전환한 상태에서 촬영
- 파일 형식 PNG, 각 500KB 이하로 압축 (페이지 로딩이 느리면 그것도 감점 요인)
- **가려야 할 것**: 실제 이메일 주소, 결제 정보, 다른 SNS 계정의 실명.
  TikTok 계정명·아바타는 **가리지 말 것** (이게 증거다)

---

## 4장 명세

### `01-connect.png` — Connect (`user.info.basic`)

**촬영 위치:** Settings > SNS Connections, TikTok 연결이 **완료된 직후** 상태

**반드시 프레임 안에 있어야 하는 것**
- TikTok 카드가 "Connected" 상태
- **연결된 계정의 display name과 `@username`이 화면에 표시된 것**
- Disconnect 버튼 (연결 해제 수단이 있다는 증거 — Privacy Policy의 삭제 조항과 짝을 이룬다)

**캡션(페이지에 함께 넣을 문구)**
`After authorizing, the connected TikTok account is shown so the user always knows which account will be posted to.`

---

### `02-confirm-dialog.png` — Direct Post 확인 모달 ★가장 중요★

**촬영 위치:** TikTok 게시 버튼 → 확인 모달이 열린 직후, **아무것도 선택하지 않은 초기 상태**

**반드시 프레임 안에 있어야 하는 것**
- 크리에이터 아바타 + 닉네임 + `@username`
- 미디어 썸네일 + 캡션
- `Who can view this video` 라디오 그룹이 **전부 미선택**인 상태
- `Allow users to` 의 Comment / Duet / Stitch가 **전부 해제**된 상태
- `Post to TikTok` 버튼이 **비활성(회색)** 인 상태
- 하단 동의문 `By posting, you agree to TikTok's Music Usage Confirmation.`

> ★이 한 장이 "사전 선택 없음 + 기본 전부 꺼짐 + 미선택 시 게시 불가"를 동시에 증명한다.
> 값을 다 채운 상태로 찍으면 이 증거가 사라진다. **반드시 초기 상태로 찍을 것.**

**캡션**
`Nothing is pre-selected. The user must choose the audience and explicitly turn on each interaction before the post button becomes available.`

---

### `03-disclosure.png` — 상업적 콘텐츠 고지

**촬영 위치:** 같은 모달에서 `Disclose video content` 토글 ON → `Branded content` 체크한 상태

**반드시 프레임 안에 있어야 하는 것**
- `Disclose video content` 토글이 ON
- `Your brand` / `Branded content` 두 체크박스와 각각의 설명문
- **`Your photo/video will be labeled as 'Paid partnership'.` 안내 배너**
- 하단 동의문이 `Branded Content Policy and Music Usage Confirmation` 으로 바뀐 것
- (가능하면) `Only you` 옵션이 비활성으로 바뀐 것까지 같은 프레임에

**캡션**
`Commercial content disclosure is off by default. When the user turns it on, the resulting TikTok label and the applicable policies are shown before posting.`

---

### `04-analytics.png` — Analytics (`video.list`)

**촬영 위치:** Analytics > Performance dashboard, TikTok 데이터가 **실제로 채워진** 상태

**반드시 프레임 안에 있어야 하는 것**
- TikTok 게시물 행/카드에 조회수·좋아요·댓글·공유 수치가 **0이 아닌 실제 값**으로 표시
- 썸네일(`cover_image_url`)
- TikTok 원본으로 나가는 링크(`embed_link`)가 보이는 것

> 수치가 전부 0이거나 비어 있으면 "video.list를 왜 요청하나"가 되어 역효과다.
> 데이터가 안 차면 먼저 게시 → 몇 시간 뒤 동기화 후 촬영할 것.

**캡션**
`Performance data retrieved with video.list is shown only to the account owner, with thumbnails and links back to the original posts on TikTok.`

---

## 페이지 배치

`/tiktok` 페이지 §2 "How the TikTok integration works" 4단계에 1:1로 붙인다.

| 단계 | 이미지 |
|---|---|
| 1. Connect | `01-connect.png` |
| 2. Create | (기존 에디터 화면이 있으면 활용, 없으면 생략 가능) |
| 3. Review & Approve | `02-confirm-dialog.png` + `03-disclosure.png` |
| 4. Publish & Measure | `04-analytics.png` |

각 이미지에 위 캡션을 `<figcaption>` 으로 붙일 것. 이미지만 있고 설명이 없으면
심사관이 무엇을 보라는 건지 알 수 없다.

`alt` 속성도 캡션과 동일하게 채운다 (접근성 + 이미지 로딩 실패 시 대비).
