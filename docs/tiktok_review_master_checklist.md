# TikTok 심사 — 누적 감사 체크리스트 (SSOT)

- 최종 갱신: 2026-08-07 (6차 반려 직후)
- App ID: 7639434404980869140 / Production
- **이 문서의 목적: 다음 제출을 마지막 제출로 만드는 것.**

---

## 0. 왜 6번이나 반려됐는가 — 정직한 진단

심사관은 **한 번에 한 가지만** 지적한다. 그리고 나(설계 담당)는 **매번 그 한 가지만** 고쳤다.
그래서 고칠 때마다 다음 항목이 새로 걸렸다. 반려 축이 매번 달랐다:

| 회차 | 날짜 | 반려 사유 | 내가 놓친 것 |
|---|---|---|---|
| 1 | 2026-05-15 | 게시 전 확인 화면 | — |
| 2 | 2026-05-22 | 확인 화면 (재지적) | — |
| 3 | 2026-06-11 | 도메인 | 사이트 전반을 안 봄 |
| 4 | 2026-08-02 제출 | 데모 영상 | — |
| 5 | 2026-08-05 | **앱 아이콘 ≠ 웹사이트 ≠ 파비콘** | 심사관이 보는 3곳을 대조 안 함 |
| 6 | 2026-08-07 | **데모 영상에 full Website URL 미노출** | 아이콘만 고치고 **영상 요건은 재검증 안 함** |

**근본 원인: 반려 사유 하나만 대응하고, 나머지 요건을 매번 재감사하지 않았다.**
그래서 이 문서를 만든다. 제출 전에 **아래 전 항목을 매번 처음부터 다시** 확인한다.
"지난번에 통과했으니 괜찮다"는 판단을 하지 않는다.

---

## 1. 데모 영상 (요건 원문 대조)

포털 업로드 화면에 명시된 요건을 그대로 옮긴 것이다.

| # | 요건 원문 | 현재 상태 | 확인 |
|---|---|---|---|
| V1 | "shows the complete end-to-end flow of the integration with TikTok" | 영상 3개로 분리 커버 | ☐ |
| V2 | "All selected products and scopes must be clearly demonstrated" | user.info.basic=영상1 / video.publish=영상2 / video.upload=영상3 | ☐ |
| V3 | "should showcase the website or app where the features will actually be integrated" | ← **6차 반려 지점** | ☐ |
| V4 | **"make sure the domain of the website shown in the demo video matches the website URL you provide"** | ← **6차 반려 지점.** 등록 URL `https://nkstudio.org/` 와 영상 속 주소창이 일치해야 함 | ☐ |
| V5 | "The video should clearly show the user interface and user interactions" | 마우스 천천히, 2초 정지 | ☐ |
| V6 | "you are required to use a sandbox environment" (최초 승인 전) | 실서비스가 Sandbox 키(`sbaw2ybq48zaki9ohw`)로 동작 중 | ☐ |
| V7 | "Maximum 5 files, up to 50MB each" / mp4·mov | 3개 | ☐ |

### V3·V4 를 만족시키는 구체 조건 (2026-08-07 확정)
- Chrome **`전체 URL 항상 표시`** 를 켜서 주소창에 `https://` 가 **글자로** 찍혀야 한다.
  (Chrome 기본값은 `https://` 를 숨긴다 — 이게 6차 반려의 직접 원인으로 판단됨)
- **세 영상 전부** 시작 5초 안에 주소창의 `https://nkstudio.org/...` 를 보여준다.
  v1 대본은 영상 1에만 있었다.
- 전체화면(F11) 금지. 창 최대화. 주소창이 영상 내내 화면에 남아 있어야 한다.
- 주소창 글씨가 읽히는 해상도(1920×1080 권장).

→ 상세 촬영 대본: `docs/tiktok_demo_video_script.md` (v2)

---

## 2. 웹사이트 (App Review Guidelines 대조)

| # | 요건 | 현재 상태 | 판정 |
|---|---|---|---|
| W1 | "A valid official website that houses information about your web and services" | `https://nkstudio.org/` | ☐ |
| W2 | **"Not a landing page or login page"** / "externally facing fully developed website" | ⚠️ **루트가 스크롤 없는 원페이지 히어로다.** 아직 지적된 적 없으나 **남은 최대 리스크** | ⚠️ |
| W3 | "Privacy Policy and Terms of Service … without having to open a menu … links must be active" | 랜딩 푸터에 `이용약관`·`개인정보처리방침` 노출, 메뉴 안 아님. `/terms` `/privacy` 200 응답 실측 확인(2026-08-07) | ✅ |
| W4 | 유효한 Redirect URI | `https://nkstudio.org/auth/tiktok/callback` 200 실측 확인 | ✅ |
| W5 | 앱 아이콘 = 웹사이트 로고 = 파비콘 (5차 반려 사유) | 정본 `favicon.svg` NK 모노그램으로 29개 페이지 통일. 포털 아이콘 교체 완료 | ✅ |
| W6 | URL 소유 인증 파일 | `prototype/` 에 `tiktok*.txt` 3개. **삭제 금지** | ✅ |

### W2 리스크에 대한 판단
랜딩 개편은 [[landing-revamp-2026-07-31]] 기준 **중단 상태**이고, 심사관이 5·6차에서 사이트를 보고도
이 항목은 지적하지 않았다. 따라서 **지금 손대지 않는다.** 다만 7차에서 이 사유로 반려되면
곧바로 이 항목부터 대응한다. 선제 개편은 랜딩 레퍼런스를 받은 뒤에 한다.

---

## 3. 포털 제출 내용

| # | 항목 | 현재 값 | 확인 |
|---|---|---|---|
| P1 | Production 토글 (Sandbox 아님) | — | ☐ |
| P2 | App icon 1024×1024 | NK 모노그램 | ☐ |
| P3 | Products | Login Kit / Content Posting API | ☐ |
| P4 | Scopes | user.info.basic / video.publish / video.upload — **셋 다 영상에 시연될 것** | ☐ |
| P5 | Review description | 999자 (`docs/tiktok_review_description_1000.txt`) | ☐ |
| P6 | Terms / Privacy / Web URL | `https://nkstudio.org/terms` · `/privacy` · `/` | ☐ |
| P7 | Platforms | Web 체크 | ☐ |
| P8 | 데모 영상 | 재촬영본 3개 | ☐ |

### 포털 조작 순서 (틀리면 작업이 날아간다)
`Not approved` 상태에는 Save 버튼이 없다. 반드시 이 순서:
1. **Production** 토글 확인
2. 우상단 `Return to Draft` → 모달 `Confirm` → 상태 `Draft`, Save/Submit 등장
3. **여기서** 파일 업로드·수정 (Draft 전환이 미저장 변경을 날린다)
4. `Save` → "Saved" 토스트 확인
5. `App review` 탭에서 Products/Scopes/영상/description 유실 없는지 확인
6. `Submit for review` → 사유 입력(120자) → `Submit`

---

## 4. 제출 직전 최종 확인 (매번 전부 다시 한다)

- [ ] §1 V1~V7 전부 ☑
- [ ] 찍은 영상을 **직접 재생해서** 주소창 `https://nkstudio.org` 를 눈으로 확인
- [ ] §2 W1~W6 전부 ☑ (시크릿 창에서)
- [ ] §3 P1~P8 전부 ☑
- [ ] 과거 6개 반려 사유를 위 표에서 하나씩 짚어 **전부** 해소됐는지 재확인
- [ ] 제출 사유문 120자 이내 작성

---

## 5. 이번 제출 사유문 (초안, 113자)

```
Re-recorded all demo videos so the full website URL https://nkstudio.org is clearly visible in the address bar.
```
