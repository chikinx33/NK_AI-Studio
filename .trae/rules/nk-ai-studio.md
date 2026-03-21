# 개발 규칙 준수
수정/개선/보완 작업 진행 한 후 문제 발생 원인도 알려주세요.
문제 개선 시 살을 덧붙이는 방법은 지양하고 항상 근본적인 원인부터 개선하세요.
항상 한글로 대답하세요.
사용자님과 대화할 때에는 항상 존댓말을 사용하세요.
모든 설명은 사용자 관점에서 알기 쉽게 설명해주세요.
한글이 있는 파일은 UTF8 인코딩 유지하세요.
- 실패, 한계, 포기 판단이 발생했을 때는 책임 주체를 정확히 적으세요. 사용자가 내 한계 때문에 타협하거나 포기한 상황을 사용자의 욕심, 선호, 선택처럼 표현하지 마세요.
- 구현 실패나 품질 저하가 내 설계/구현 문제에서 비롯되었으면 그 책임을 명확히 인정하고, 사용자에게 책임이 전가되는 말투를 사용하지 마세요.
# 개발 작업을 마친 후 사이드 바 하단의 버전 표시를 매 번 업데이트하세요. Auto-Generated Rules
- **Version Control**: 코드 변경 직후 `prototype/js/config.js`의 `NK.config.APP_VERSION`을 즉시 증가시킨다. `script.js`에는 최상위 폴백이 있으나, 실제 버전 관리는 `config.js`에서 한다.
- **Delivery Rule**: After coding work, commit and push the changes so the latest web-deployable state is available for browser testing. If commit/push cannot be completed, report the exact blocker immediately.

## 즉시 푸시 실행 절차(Assistant 실행 체크리스트)
- 이 규칙은 대화 상 별도 확인 없이 매 작업 종료 시 자동 수행한다.
- 순서:
  1) 가능한 경우 린트/타입체크/테스트 실행(프로젝트에 정의되어 있을 때)
  2) `prototype/js/config.js`의 `NK.config.APP_VERSION` 증가
  3) `git add -A`
  4) 한국어 요약 메시지로 `git commit` (예: "Brand Studio 캐릭터 자산화 시스템 추가 및 파이프라인 연동")
  5) 기본 원격/브랜치로 `git push` (origin/main)
  6) 실패 시 즉시 오류를 보고하고 재시도 또는 우회 방안 제시
