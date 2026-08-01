# TikTok 재제출 — 엔케님 최종 체크리스트 (v3.1432 기준)

코드 작업은 끝났습니다. 아래는 **전부 엔케님이 직접 하셔야 하는 것**이고, 순서대로 하시면 됩니다.

---

## A. 스크린샷 4장 (제일 먼저)

`prototype/images/tiktok/` 에 넣으면 페이지에 자동으로 붙습니다.
파일별 상세 요건은 `docs/tiktok_screenshot_spec_20260801.md` 또는 그 폴더의 `README.md`.

- [ ] `01-connect.png` — Settings > SNS Connections, TikTok 연결 완료 직후 (계정명 + `@username` + Disconnect 버튼)
- [ ] `02-confirm-dialog.png` — **★확인 모달을 연 직후, 아무것도 선택 안 한 초기 상태★**
      공개범위 전부 미선택 / Comment·Duet·Stitch 전부 해제 / Post 버튼 회색 — 이 셋이 한 프레임에
- [ ] `03-disclosure.png` — Disclose ON + Branded content 체크 → `Paid partnership` 배너
- [ ] `04-analytics.png` — Analytics 대시보드, 수치가 **0이 아닌 실제 값**

공통: 주소창에 `nkstudio.org` 가 보이게 / UI 영어 / PNG 500KB 이하 (초과 시 `npm test` 실패로 잡힙니다)

---

## B. 라이브 실동작 확인

- [ ] `https://nkstudio.org/tiktok` 이 **로그아웃 상태에서** 열리는가
- [ ] `https://nkstudio.org/support` 가 로그아웃 상태에서 열리는가
- [ ] 모달 하단 `Branded Content Policy` / `Music Usage Confirmation` 링크가 새 탭에서 실제로 열리는가
- [ ] **네트워크 탭에서 `/api/sns/publish` 요청 바디 확인** — 모달에서 Comment만 체크했다면
      `allowComment:true, allowDuet:false, allowStitch:false` 로 나가는지
- [ ] TikTok 연결 → 게시 → Analytics 동기화까지 1회 완주

---

## C. TikTok Developer Portal 설정

- [ ] **Scopes 에서 `video.upload` 체크 해제** ← ★코드만 고쳐선 안 바뀝니다. 포털에서 직접 꺼야 심사 대상에서 빠집니다★
      최종 상태: `user.info.basic` / `video.publish` / `video.list` 3개만 체크
- [ ] **URL properties** 에 `https://nkstudio.org/api/sns/tiktok-media` 가 **verified** 인지 확인
      (미인증이면 사진 게시가 실패합니다)
- [ ] Website URL → `https://nkstudio.org/`
- [ ] Terms of Service URL → `https://nkstudio.org/terms`
- [ ] Privacy Policy URL → `https://nkstudio.org/privacy`

---

## D. 데모 영상 3개

샷 리스트: `docs/tiktok_direct_post_modal_spec_20260801.md` §8
각 50MB 이하, 화면에 `nkstudio.org` 도메인이 보여야 함.

- [ ] 영상 1 — Connect (약 40초)
- [ ] 영상 2 — **Direct Post 확인 모달 (약 90초) ★가장 중요★**
      미선택 상태 → Post 버튼 안 눌림을 보여주고 → 선택 → Disclose → 게시까지
- [ ] 영상 3 — Analytics (약 30초)

---

## E. Review Description 붙여넣기

- [ ] `docs/tiktok_review_description_EN.txt` 의 **VERSION A** 를 복사
      (글자수 제한에 걸리면 VERSION B)
- [ ] `<TEST_ID>` / `<TEST_PW>` 두 자리를 실제 심사용 계정 값으로 치환
- [ ] 붙여넣기 전 한 번 훑어서, 그 사이 바뀐 구현이 없는지 확인

---

## F. Resubmit

- [ ] A~E 전부 체크된 뒤에 제출

---

## 승인 후 할 일 (지금 하지 마세요)

- [ ] Cloudflare 환경변수 `TIKTOK_APP_AUDITED=true` 로 변경 → 공개 게시 열림 (코드 재배포 불필요)
- [ ] 영상 분할 업로드 구현 — 현재 64MB 초과 영상은 게시가 막혀 있음.
      1080×1920 기준 2~3분 이상 렌더가 여기 걸립니다.
- [ ] 64MB 초과 에러 메시지 영문 병기
