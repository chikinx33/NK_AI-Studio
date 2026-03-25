# 개발 규칙 준수
수정/개선/보완 작업 진행 후 문제 발생 원인도 알려줘.
문제 개선 시 살을 덧붙이는 방법은 지양하고 항상 근본적인 원인 해결.
항상 한글로 존댓말 사용.
한글이 있는 파일은 UTF8 인코딩 유지.

## 작업 후 즉시 푸시 실행 절차(Assistant 실행 체크리스트)
- 이 규칙은 대화 상 별도 확인 없이, **Assistant가 매 작업을 마칠 때마다 자동으로 수행**한다.
- 코드/CSS/HTML/문서 등 어떤 변경이든 크기와 무관하게 **반드시** 버전업/커밋/푸시까지 진행한다.
- 유일한 예외: 사용자가 명시적으로 “커밋/푸시 하지 말라”고 지시한 경우.
- 훅/자동화가 동작하지 않는 환경이라도 Assistant는 직접 명령을 실행해 본 절차를 보장한다.
- 순서(항상 동일하게 수행):
  1) 테스트 실행: `npm test`(정의되어 있을 때. 실패 시 커밋 중단)
  2) 버전 증가: `prototype/js/config.js`의 `NK.config.APP_VERSION` 증가(패치 레벨 +1, 미증가 시 자동 증가)
  3) 스테이징: `git add -A`
  4) 커밋: 한국어 요약 메시지로 `git commit`
  5) 푸시: `git push origin main`
  6) 실패 시 즉시 원인 보고 및 재시도/우회 방안 제시

### 자동화(훅) 규정
- 로컬 훅 경로: `.githooks` (PowerShell `scripts/setup-hooks.ps1`로 설정)
- `pre-commit`
  - `npm test`를 실행해 실패 시 커밋 차단
  - `prototype/js/config.js` 버전이 변경되지 않았다면 자동으로 패치 버전을 +1 하고 스테이징
- `post-commit`
  - 커밋 성공 시 `origin/main`으로 자동 푸시(테스트가 필요하면 pre-commit에서 이미 보장)
- `pre-push`
  - 푸시 직전 `node --test prototype/tests/*.test.mjs`로 테스트 실패 시 푸시 차단
