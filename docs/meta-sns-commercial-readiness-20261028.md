# Instagram Threads 상용 연결 점검과 검수 준비

2026년 10월 28일 기준으로 NK Studio의 Instagram·Threads 공개 고객 연결은 **Meta 설정과 심사가 남아 있어 완료되지 않았다**. 코드 보안 보완과 심사 자료 준비를 일반 고객의 실제 연결·게시 성공으로 취급하지 않는다. Discord는 이번 점검 대상에서 제외한다.

## 배포와 기존 연결

- 점검 시작 커밋은 `main`의 `9e8b61b5`, 로컬과 운영 `APP_VERSION`은 `3.2089`였다. `https://nkstudio.org/js/config.js`, `js/ui/sns-settings.js`, `js/ui/brand-studio.js`는 당시 로컬 파일과 내용이 정확히 같았다.
- 기존 `prototype/styles.css` 변경 26줄 추가·11줄 삭제는 이번 수정·커밋 대상에서 제외한다.
- 마스터 SNS 화면의 Shapes Instagram·YouTube·TikTok·Threads·X·Facebook 연결 표시를 확인했다. 이 관찰은 게시 성공이나 현재 플랫폼 토큰 유효성을 증명하지 않는다.
- 연결 저장 단위는 로그인한 NK Studio 사용자이다. 브랜드별 저장으로 전환하지 않는다.

## Meta 콘솔 초기 점검 현황

다음은 설정 변경 전 관찰이다. 사용자 승인 후 실제 저장한 최신 상태는 아래 후속 확인에 별도로 기록한다.

| 항목 | Instagram | Threads |
| --- | --- | --- |
| 부모 Meta 앱 | NK Studio `850359561442151` | 같은 부모 앱 |
| 제품 앱 ID | NK Studio-IG `1024665276551556` | `1706869183666612` |
| 게시 | 게시되지 않음 | 같은 부모 앱, 게시되지 않음 |
| 기본 권한 | `instagram_business_basic`: 테스트 준비 완료, 호출 363 | `threads_basic`: 테스트 준비 완료, 호출 353 |
| 게시 권한 | `instagram_business_content_publish`: 테스트 준비 완료, 호출 352 | `threads_content_publish`: 테스트 준비 완료, 호출 339 |
| 인사이트 권한 | `instagram_business_manage_insights`: 추가 버튼, 현재 이용 사례에 미추가 | `threads_manage_insights`: 추가 버튼, 현재 이용 사례에 미추가 |
| 검수 작업 | 기본 권한 옵션 메뉴에 앱 검수에 추가 | 동일한 권한 테이블에서 기본·게시 권한은 테스트 준비 완료 |
| OAuth 허용 URI | `https://nk-ai-studio.pages.dev/api/sns/callback/instagram` | `https://nk-ai-studio.pages.dev/auth/threads/callback` |
| 해제·삭제 콜백 | 승인 취소·데이터 삭제 요청 URL이 비어 있음. 별도 보안 콜백 준비, 콘솔 반영 필요 | 두 항목 모두 OAuth 콜백 URI로 설정되어 있어 수정 필요 |

권한 테이블의 새 UI는 Standard/Advanced라는 별도 열 대신 상태를 표시했다. **테스트 준비 완료와 API 호출 수를 고급 액세스 승인으로 해석하지 않는다.** Instagram 사용 사례 테스트는 진행 중, Threads 사용 사례 테스트는 완료로 표시됐다. 과거 전체 검수 제출·승인 이력은 현재 확인한 화면만으로 확정할 수 없다.

앱 기본 설정의 앱 도메인에는 `nk-ai-studio.pages.dev`만 등록되어 있었다. 개인정보처리방침 URL, 서비스 약관 URL, 사용자 데이터 삭제 안내 URL은 비어 있었다. 게시 화면에는 개인정보처리방침 설정을 요구하는 카드와 비활성 게시 버튼이 있었다.

앱을 관리하는 비즈니스 포트폴리오의 보안 센터에서 Meta for Developers 인증 사용 사례가 선택되어 있고, **인증 가능 / 인증 시작**으로 표시됐다. 완료 상태로 표시되지 않았다. 앱 대시보드에는 기술 제공업체 되기가 표시되며, 안내 창은 선택 후 되돌릴 수 없고 비즈니스 인증·앱 검수가 필요하다고 설명한다. 최종 선택·서류 제출은 수행하지 않았다.

shapes.ko와 raviok_official의 기존 Instagram·Threads 테스터 등록을 보존했다. beautyai_kr도 두 제품의 테스터 목록에 존재한다. 사용자가 제공한 직전 상태는 초대 대기이며, 이번 작업에서 본인 계정의 초대 수락·OAuth 동의·토큰 발급·저장·게시까지 확인한 것은 아니다.

## 코드 보완

1. 서명 없는 base64 사용자 ID state와 `owner` 기본값을 제거했다. 사용자·플랫폼·허용 origin·난수·10분 만료를 HMAC으로 서명한다.
2. 콜백에서는 사용자 설정을 변경하지 않고 인증 코드의 해시를 일회성 티켓에 보관한다. 실제 인증 코드는 콜백을 받은 브라우저에만 전달하며 서버에서 조회할 수 없다. 원래 NK 로그인 세션과 원래 브라우저의 별도 proof가 모두 일치해야 서버에서 토큰 교환과 저장이 가능하다. proof는 Meta에 보내지 않는다.
3. 운영 origin과 `pages.dev` 콜백 origin이 달라도 같은 사용자가 원래 운영 origin에서 저장을 완료한다. 정확한 postMessage 대상 origin과 발신 창·origin을 검사하며, 팝업 opener가 없어도 원래 origin으로 URL fragment를 통해 돌아와 같은 브라우저의 시작 proof와 로그인 세션을 확인해 완료한다. 인증 코드가 없는 원래 화면의 폴링만으로는 저장할 수 없다.
4. OAuth 팝업 메시지로 화면을 연결됨으로 만들지 않는다. 서버 설정 조회의 `connectionId`까지 일치해야 완료로 표시한다. 신규 파일 없음과 조회 실패를 캐시 연결 성공으로 대체하지 않는다.
5. 설정 저장은 `enabled` 등 허용된 설정만 변경한다. 클라이언트는 토큰, 계정 ID, 연결 성공 상태를 만들어낼 수 없다. GCS generation 충돌 검사는 채널 저장 경합과 해제 후 갱신 토큰 부활을 방지한다.
6. Instagram 게시에서 운영자 환경 토큰 폴백을 제거했다. Threads 사용 중지·재연결 필요 상태를 게시 전에 확인한다. 공유 소유자의 게시 자격증명 사용에는 프로젝트 editor 권한이 필요하고 viewer는 게시할 수 없다. 예약 실행도 실행 시 권한을 다시 검사한다.
7. 만료 전 장기 토큰 갱신, 실제 만료·권한 철회 표시, 별도 재연결을 처리한다. Instagram의 문서상 중첩 `data` 토큰 응답도 처리하며 장기 교환 실패를 60일 토큰 성공으로 저장하지 않는다. Threads 인증·Graph 호스트는 최신 공식 문서의 `.com`으로 맞췄다.
8. SNS 저장의 Facebook 객체 로그, Facebook 토큰 저장·재조회 로그, Threads 토큰 객체 로그를 제거했다. 토큰을 HTML로 내보내던 token-test와 부분 마스킹 진단 gcs-debug는 410으로 폐기했다. 연결 응답에는 표시용 필드만 허용한다.
9. NK 연결 해제는 해당 NK 사용자 자격증명만 지운다. Meta 앱 전체 권한을 자동 철회하면 같은 SNS 계정을 연결한 다른 NK 로그인의 권한까지 끊길 수 있어 별도 SNS 설정 조작으로 명확히 구분한다.
10. Meta의 서명된 해제·삭제 요청을 검증하는 콜백을 준비했다. 연결 인덱스는 신규 OAuth와 기존 사용자의 본인 설정 조회에서 등록한다. 인덱스로 찾지 못한 레거시 계정을 삭제 완료로 응답하지 않는다. 삭제 요청은 자격증명 제거 후 보관 데이터 검토용 실제 pending 접수증을 만들며 전체 삭제 완료를 주장하지 않는다.

## 콘솔 적용 값

기존 앱 ID·시크릿·콜백 URI는 유지한다. 부모 앱 ID와 제품 앱 ID가 다르다는 이유로 바꾸지 않는다.

| 설정 | 적용 값 |
| --- | --- |
| 앱 도메인 추가 | `nkstudio.org` — 기존 `nk-ai-studio.pages.dev` 유지 |
| 개인정보처리방침 | `https://nkstudio.org/privacy` |
| 약관 | `https://nkstudio.org/terms` |
| 데이터 삭제 안내 URL | `https://nkstudio.org/data-deletion` |
| Instagram 해제 콜백 | `https://nkstudio.org/api/sns/meta/events?platform=instagram&type=deauthorize` |
| Instagram 삭제 콜백 | `https://nkstudio.org/api/sns/meta/events?platform=instagram&type=deletion` |
| Threads 제거 콜백 | `https://nkstudio.org/api/sns/meta/events?platform=threads&type=deauthorize` |
| Threads 삭제 콜백 | `https://nkstudio.org/api/sns/meta/events?platform=threads&type=deletion` |
| 서비스·권한 설명 | `https://nkstudio.org/meta-integration` |

권한 심사 요청에는 실제 사용하는 기본·게시·인사이트 권한을 각각 포함한다. Instagram 댓글·메시지 등 이번 사용 범위 밖의 권한을 공개 연결의 선행 조건으로 추가하지 않는다. 앱 아이콘·카테고리·개발자 연락처·웹 플랫폼 주소도 심사 제출 전 누락 여부를 확인해야 한다. 현재 앱 아이콘과 카테고리는 기본 설정에서 비어 있는 것으로 표시됐다.

비즈니스 인증에 필요한 법인 정보·증빙과 본인 확인은 운영자가 실제 자료로 진행한다. 기술 제공업체 여부의 되돌릴 수 없는 최종 선택, 접근 권한 추가 및 Meta 동의·제출은 승인 절차를 따른다. 공개 연결 완료는 두 제품의 필요한 승인 상태를 콘솔에서 다시 확인한 후 판단한다.

## 사용자 승인 후 실제 반영과 남은 단계

사용자는 정책 URL·도메인·콜백 저장, 두 인사이트 권한 추가와 기술 제공업체 확정을 명시적으로 승인했다. 비즈니스 본인 확인과 최종 심사 제출은 이번 승인과 별도 단계이다.

- 앱 도메인에 `nkstudio.org`를 추가하고 기존 도메인을 유지했다. 개인정보처리방침·약관·데이터 삭제 안내 URL을 저장한 뒤 기본 설정을 다시 열어 영속 저장을 확인했다.
- Instagram의 승인 취소·삭제 콜백을 위 값으로 저장하고 모달을 다시 열어 확인했다. Threads의 제거·삭제 콜백도 위 값으로 저장하고 변경 저장됨 메시지를 확인했다. OAuth 허용 URI와 제품 앱 ID는 변경하지 않았다.
- 두 인사이트 권한의 첫 추가 시도에서 Meta 일반 오류가 표시됐다. 그러나 기술 제공업체 확정 이후 다시 확인한 두 권한은 모두 `테스트 준비 완료`, 호출 5로 표시됐고 미제출 검수 초안에도 포함되어 있었다. 화면 오류만으로 실패를 확정하거나, 반영된 상태를 다시 추가하지 않았다. 오류와 실제 반영 시점의 인과관계는 확인되지 않았다.
- `예. 기술 제공업체입니다` 선택을 확정했고 인증·앱 검수 메뉴가 열렸다. 이는 **기술 제공업체 액세스 인증 완료가 아니다**.
- 인증 화면은 비즈니스 `모양새뚜뮤` (`1725600280852730`)를 **인증되지 않음**으로 명시했다. 액세스 인증은 비즈니스 인증을 먼저 완료해야 하며 시작 버튼이 비활성 상태였다. 회사 증빙·본인 확인·OTP 제출은 실행하지 않았다.
- 앱 검수 화면은 **제출되지 않음 / 새 요청**으로 표시했고 아래 여섯 권한을 모두 포함했다. 다른 기존 Facebook·메시지·댓글 등의 요청도 같은 초안에 남아 있다. 이번 범위 밖 요청을 임의로 삭제하지 않았으며 최종 제출 전 실제 사용하는 범위를 검토해야 한다.

| 제품 | 요청 권한 | 확인된 현재 상태 | 일반 고객 공개 연결 |
| --- | --- | --- | --- |
| Instagram | `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_insights` | 모두 테스트 준비 완료, 미제출 검수 초안에 포함 | 미완료: 인증·필요 권한 심사·게시 후 역할 없는 프로페셔널 사용자 검증 필요 |
| Threads | `threads_basic`, `threads_content_publish`, `threads_manage_insights` | 모두 테스트 준비 완료, 미제출 검수 초안에 포함 | 미완료: 인증·필요 권한 심사·게시 후 역할 없는 적격 사용자 검증 필요 |

새 검수 페이지에서 인증·앱 설정·허용되는 사용 방법·데이터 처리·검수자 지침이 필수 단계로 제시됐고 최종 제출 버튼은 비활성 상태였다. 현재 초안 외 과거 전체 승인 이력을 단정하지 않는다. 아이콘·카테고리, 실제 심사 로그인, 권한별 실제 녹화, 운영 데이터 처리 답변은 사실 확인 후 완성해야 한다. 준비된 재현 절차·게시안은 아래와 같으며 실제 녹화·실제 게시를 완료했다고 주장하지 않는다.

코드 릴리스 `00658778` (3.2090), `169c7b30` (3.2091)은 GitHub main과 운영에 반영됐다. 3.2091의 운영 설정·SNS JS·공개 안내 페이지·검수 이미지 일치를 확인했다. 운영에서 비인증 연결/완료/해제/상태 요청은 401, 폐기 진단 경로는 410, 위조 Meta 서명은 400이었다. 운영 SNS 화면을 다시 열어 기존 Shapes 여섯 채널 표시가 유지됨을 확인했다. 실제 토큰 유효성·게시 성공의 증명은 아니다.

증거 화면은 비공개 로컬 `tmp/sns-review/`에 저장했다(저장소 커밋 제외). 기본 설정 저장, 제품별 콜백 저장, Instagram 권한 상태, 기술 제공업체 메뉴, 인증 미완료와 검수 미제출 화면을 포함한다. 작업을 마친 브라우저 탭은 닫았다.

## 심사자 재현 절차

심사 전용 NK 계정은 실제 로그인 가능한 별도 계정으로 준비하고, 자격증명은 Meta의 비공개 심사 필드에만 전달한다. 이 문서·저장소·스크린캐스트에 비밀번호를 적지 않는다. 운영자 계정을 고객에게 공유하지 않는다.

1. `https://nkstudio.org`에 심사 전용 NK 계정으로 로그인하고 영어 UI로 전환한다.
2. `/meta-integration`에서 권한별 목적과 `/privacy`, `/terms`, `/data-deletion`을 확인한다.
3. `/sns-settings`에서 대상 플랫폼 연결을 누르고 본인 적격 SNS 계정으로 동의한다. Instagram은 비즈니스/크리에이터 계정을 사용한다.
4. 반환 후 서버 저장 확인과 계정 사용자명을 보여준다. 다시 로드해도 같은 연결이 표시되는지 확인한다.
5. 브랜드 스튜디오·퍼블리싱에서 검수용 콘텐츠와 정확한 목적지 계정을 보여준 뒤 게시한다. 즉시 게시와 예약 실행을 나눠 기록한다. 플랫폼 게시물 ID와 실제 SNS 게시 화면을 확인한다.
6. 성과 화면에서 해당 계정 콘텐츠를 동기화하고 각 insights 권한의 실제 사용을 보여준다. 앱이 사용하는 각 권한의 성공 API 호출 요건을 콘솔에서 확인한다.
7. A 계정 연결·해제·게시 전후 B 계정의 저장 상태와 목적지가 그대로인지 확인한다. 공유 viewer 거절, editor 허용, 공유 권한 철회 후 예약 실행 거절을 확인한다.
8. 연결 해제 후 저장된 자격증명을 사용할 수 없는지, 플랫폼 권한 철회 후 재연결 안내가 나오는지 확인한다. 데이터 삭제 접수와 실제 처리 완료를 구분한다.

공개 승인 후에는 **앱 역할이 없는** 적격 일반 사용자로 3~8을 반복해야 한다. 테스터 초대·수락은 개발 검증에 한정되며 일반 고객 공개 검증을 대체하지 못한다.

## 시연 자료와 게시안

- 화면 녹화 순서: NK 로그인 → 연결 버튼 → 플랫폼 계정·권한 동의 → 서버 저장 확인 → 계정·콘텐츠 확인 → 게시 성공·실제 SNS 화면 → 예약·성과 → 해제·재연결. 권한별 영어 설명과 캡션을 붙인다.
- 검수용 이미지: `/assets/sns-review/connection-test.png`, 1080 × 1080 PNG.
- 검토용 게시안: beautyai_kr Instagram·Threads에 `NK Studio SNS 연동 점검용 테스트 게시물입니다.`와 위 이미지. **게시 계정·콘텐츠 최종 확인 전 실행하지 않는다.** Shapes에는 테스트 게시를 하지 않는다.
- 실제 동의·게시 화면 녹화는 계정 소유자의 필요한 동의와 플랫폼 요건 충족 후 촬영한다. 준비한 절차나 모의 테스트를 실제 시연 영상으로 제출하지 않는다.

## 삭제 요청 운영

서명된 삭제 요청은 `admin/meta-deletion-<확인 코드>.json`에 pending 상태로 기록된다. 운영자는 실제로 보관된 해당 플랫폼 보고서·프로필·플랫폼 유래 데이터와 연결 인덱스 보존 여부를 검토하고, 필요한 삭제를 수행한 뒤 처리 결과를 신청자에게 안내한다. 이 업무를 처리할 담당자와 7일 이내 대응 절차가 필요하다. 자격증명 제거만으로 pending을 완료로 바꾸지 않는다. 플랫폼 게시물 자체는 해당 SNS에서 관리한다.

이번 코드 변경은 기존 계정 토큰을 일괄 변경·삭제하지 않는다. 개인정보가 들어갈 수 있는 과거 로그의 실제 보존·접근 범위는 별도 운영 확인 대상이며, 로그의 비밀값을 추출해 문서에 붙이지 않는다.

## 자동 검증 결과

전체 테스트 2,261개 중 2,260개 통과, 1개 건너뜀, 실패 0개를 확인했다. SNS 서버 경로 12개는 브라우저 런타임용 번들 검사를 통과했다. 새 보안 회귀 테스트 22개는 실제 서버 핸들러와 모의 GCS·플랫폼 응답으로 사용자 격리, 위조·만료·재사용, 다른 브라우저로 전달된 OAuth URL, opener 없는 콜백, 저장 경합, 해제·갱신, 서명된 플랫폼 철회·삭제 접수, 모의 게시의 목적지 토큰을 검증한다. 모의 게시 결과는 실제 Instagram·Threads 연결·게시 검증을 대체하지 않는다.

마지막 문서 푸시 시 원격 main의 동시 변경으로 일반 푸시가 거절되어 원격 `d65b48d7`의 다른 SNS OAuth 보완까지 보존해 리베이스했다. 기존 사용자 CSS를 복원한 뒤 변경 패치 해시가 통합 전과 같음을 확인했다. 통합 후 전체 테스트는 2,274개 중 2,273개 통과, 1개 건너뜀, 실패 0개였다. 중복된 3.2092 릴리스 번호 대신 3.2093으로 갱신한다. 강제 푸시나 기존 원격 변경 삭제는 하지 않았다.

## 공식 근거

- [Instagram API와 적격 계정](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login)
- [Instagram 비즈니스 로그인과 Advanced Access 요건](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)
- [Instagram 앱 검수와 심사자 지침·녹화 자료](https://developers.facebook.com/documentation/instagram-platform/app-review)
- [Threads 역할 없는 사용자 권한 승인·공개 요건](https://developers.facebook.com/documentation/threads/get-started)
- [Threads OAuth와 제품 앱 ID](https://developers.facebook.com/documentation/threads/get-started/get-access-tokens-and-permissions)
- [Meta 기술 제공업체](https://developers.facebook.com/docs/development/release/tech-providers/)
- [Meta 비즈니스 인증](https://developers.facebook.com/docs/development/release/business-verification)

공식 문서는 2026년 10월 28일 로그인한 브라우저에서 확인했다. 일부 공식 안내의 범위·이름 예시와 콘솔 표기가 다르므로, 실제 요청 권한 이름과 콘솔 상태를 함께 확인한다.
