# ChatGPT 구독 이미지 연결

NKStudio 이미지 생성 화면에서 `GPT 이미지 · 내 ChatGPT 구독`을 선택하면 사용자 PC의 공식 Codex app-server가 이미지를 생성하고 NKStudio 저장소에 자동 저장합니다. API 키·운영자의 계정·운영자의 이미지 크레딧으로 전환하지 않습니다. 첫 연결과 ChatGPT 로그인은 사용자가 직접 확인합니다.

## 최초 연결

1. 랜딩페이지 API 설정의 `내 ChatGPT 이미지 구독 연결`을 엽니다.
2. Windows 연결 프로그램을 내려받아 압축을 푼 뒤 `Start-NKStudio-Images.cmd`를 실행합니다.
3. 연결 프로그램이 여는 화면에서 본인의 ChatGPT 구독 계정으로 로그인합니다.
4. `NKStudio 계정에 연결`을 누르고 표시된 NKStudio 계정과 ChatGPT 이메일을 확인한 뒤 `이 계정에 연결`을 누릅니다.
5. 이미지 생성 화면에서 `GPT 이미지 · 내 ChatGPT 구독`을 선택하고 생성합니다. 결과는 세션 저장소에 자동 저장되며 에피소드를 선택했다면 에피소드 저장소에도 저장됩니다.

연결 프로그램이 실행 중인 PC가 필요합니다. 창을 종료하거나 PC가 꺼지면 새로운 생성 요청은 중단됩니다. 다음 사용 시 같은 실행 파일을 다시 실행합니다. 연결은 30일 동안 유효합니다. 다른 NKStudio 계정은 `Start-NKStudio-Images.cmd --new-profile`로 별도 ChatGPT 인증 프로필을 만들어 연결합니다. 이전 프로필의 구독을 다른 NKStudio 계정으로 자동 재사용하지 않습니다.

## 인증과 작업 처리

- 공식 `codex app-server --listen stdio://`와 `account/login/start`의 ChatGPT OAuth를 사용합니다. 브라우저 쿠키·비공개 ChatGPT API·자동 클릭을 사용하지 않습니다.
- OAuth 자격 증명은 해당 PC의 `%LOCALAPPDATA%\NKStudio\CodexImages\profiles\<id>\auth`에만 보관합니다. Codex 운영자 계정의 홈과 API 환경 변수는 읽지 않습니다.
- 상위 Codex 앱의 `CODEX_*` 환경 변수도 제거한 뒤 전용 `CODEX_HOME`만 지정합니다. 기존 앱의 도구 파이프·권한 프로필·계정 연결 설정을 연결 프로그램에 상속하지 않습니다.
- NKStudio 서버는 연결 토큰의 SHA-256 해시만 보관합니다. 실제 연결 토큰은 PC에만 보관합니다. 이 토큰은 해당 사용자의 이미지 작업 수신·결과 저장에만 사용하며 일반 로그인 토큰으로 교환하지 않습니다.
- 작업 생성·조회·연결 해제는 NKStudio 로그인으로 인증합니다. 결과 저장은 서버에 저장된 작업 소유자와 프로젝트 권한으로 결정합니다. 클라이언트 `userId`를 신뢰하지 않습니다.
- 구독 이미지 요청은 NKStudio의 API 이미지 크레딧 과금 경로를 거치지 않습니다. ChatGPT 구독의 사용 한도가 적용됩니다. 사용 한도 이후의 OpenAI 자체 크레딧 적용은 OpenAI 계정 정책에 따르며, 연결 프로그램은 크레딧을 구매하거나 사용량 초기화를 요청하지 않습니다.
- 소유자당 한 번에 하나의 생성만 허용합니다. 동일 요청 ID와 결과 업로드 재전송은 같은 작업을 사용합니다. 연결 오류·사용 한도 오류로 이미지 생성을 자동 반복하지 않습니다.
- 참고 이미지는 최대 16장·합계 12MB입니다. PC에서 읽을 수 있는 이미지 데이터 또는 NKStudio/GCS의 HTTPS 이미지 주소만 허용합니다. 이미지 결과는 실제 PNG/JPEG/WebP인지 확인하고 최대 16MB만 저장합니다.
- 저장 실패 시 생성 이미지는 PC의 전용 이미지 폴더에 보존합니다. 자동 업로드 재시도는 생성 자체를 반복하지 않습니다. 작업은 20분 후 실패 상태가 되어 수동 재시도를 결정할 수 있습니다.
- shell·code mode·웹 검색 도구를 비활성화하고 이미지 생성만 요청합니다. 추가 권한 요청은 승인하지 않습니다.
- 내장 이미지 도구 호출에 필요한 공식 `code_mode_host` 중개 기능은 사용합니다. 셸과 일반 code mode는 계속 비활성화하며 파일 시스템은 읽기 전용으로 제한합니다.

## 빌드와 배포

Node 22 이상으로 `node scripts/build-image-connector.cjs`를 실행한 뒤 `.wrangler/image-connector-package/*`를 `prototype/downloads/NKStudio-Image-Connector.zip`으로 압축합니다. ZIP에는 소스 연결 프로그램·해시·시작 CMD·설치 PowerShell만 포함하며 인증 파일은 포함하지 않습니다. 설치 프로그램은 공식 Node.js 배포 파일의 SHA-256을 확인하고 공식 `@openai/codex` 패키지를 전용 폴더에 설치합니다. 시스템 Node.js나 PATH를 영구 변경하지 않습니다.

기존 GitHub main → Cloudflare Pages 배포 경로를 사용합니다. `/api/codex-images`에서 DB 테이블을 준비하며 기존 `DATABASE_URL`과 이미지 저장용 GCS 설정을 사용합니다. OpenAI API 키는 필요하지 않습니다.

공식 문서: [Codex 제품 연동](https://learn.chatgpt.com/docs/app-server), [이미지 생성](https://learn.chatgpt.com/docs/image-generation), [구독 사용량](https://learn.chatgpt.com/docs/pricing).
