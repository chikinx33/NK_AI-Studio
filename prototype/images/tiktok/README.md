# /tiktok 페이지 스크린샷

`prototype/tiktok.html`(→ https://nkstudio.org/tiktok) §2 "How the TikTok integration works"에
배선된 실제 UI 스크린샷. 배선·캡션은 이미 들어가 있고, **아래 4개 파일만 넣으면 된다.**
파일이 없으면 깨진 이미지 대신 캡션만 남지만, 그 상태로 재제출하면 안 된다 —
심사관이 우리 주장을 눈으로 대조하는 유일한 수단이다.

명세 원문: `docs/tiktok_screenshot_spec_20260801.md`

| 파일명 | 배치 | 프레임 안에 반드시 있어야 하는 것 |
|---|---|---|
| `01-connect.png` | 1. Connect | TikTok 카드 "Connected" 상태, 연결된 display name + `@username`, Disconnect 버튼 |
| `02-confirm-dialog.png` | 3. Review & Approve | 확인 모달 **초기 상태** — 아바타+닉네임+`@username`, 미디어 썸네일+캡션, 공개범위 **전부 미선택**, Comment/Duet/Stitch **전부 해제**, `Post to TikTok` **비활성(회색)**, 하단 `Music Usage Confirmation` 동의문 |
| `03-disclosure.png` | 3. Review & Approve | `Disclose video content` ON + `Branded content` 체크, `Paid partnership` 배너, 동의문이 `Branded Content Policy and Music Usage Confirmation` 으로 바뀐 것, (가능하면) `Only you` 비활성 |
| `04-analytics.png` | 4. Publish & Measure | 조회수·좋아요·댓글·공유가 **0이 아닌 실제 값**, 썸네일, TikTok 원본 링크 |

> `02-confirm-dialog.png` 는 값을 다 채운 뒤에 찍으면 "사전 선택 없음 + 기본 전부 꺼짐 +
> 미선택 시 게시 불가" 증거가 통째로 사라진다. **반드시 초기 상태로.**

## 촬영 공통 규칙

- **주소창에 `nkstudio.org` 도메인이 보이게** 찍는다. localhost·pages.dev 화면 금지
  (심사관이 제출 URL과 화면이 같은 서비스인지 대조한다).
- 데스크톱 1440×900 기준, 가로 1200px 이상으로 저장.
- UI 언어를 **영어**로 전환한 상태에서 촬영.
- PNG, **각 500KB 이하**로 압축. (`prototype/tests/tiktok-direct-post.test.mjs` 가
  파일이 존재할 때 크기를 검사하므로, 넘으면 `npm test` 가 실패한다.)
- 가릴 것: 실제 이메일, 결제 정보, 다른 SNS 계정의 실명.
  **TikTok 계정명·아바타는 가리지 말 것** — 그게 증거다.

## 2단계(Create)는 스크린샷 없음

TikTok API 를 전혀 호출하지 않는 단계라 명세상 생략 가능으로 정리했다.
에디터 화면을 넣고 싶으면 `tiktok.html` 의 2단계 `flow-step` 안에 `flow-shot` figure 를
추가하면 되지만, 없어도 심사 요건에는 영향이 없다.
