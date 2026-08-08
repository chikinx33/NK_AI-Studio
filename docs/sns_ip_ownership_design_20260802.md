# SNS 연결 IP 소유 단위 전환 설계서

- 작성일: 2026-08-02
- 대상: NK_Studio 브랜드 스튜디오 (`prototype/`)
- 상태: 설계 확정 · 1단계 착수 대기

---

## 0. 한 줄 요약

SNS 연결의 소유 단위를 **사용자 계정 → IP(브랜드)** 로 내린다.
그 전제로 **IP 컨텍스트 단일 원천과 게이트**를 먼저 세운다.

---

## 1. 배경 — 지금 무엇이 문제인가

현재 SNS 연결은 GCS 의 사용자 단위 파일 한 개에 저장된다.

```
gs://{bucket}/{basePrefix}/users/{userId}/userdata/sns-settings.json

{
  "sns": {
    "instagram": { "connected": true, "enabled": true, "username": "...", "accessToken": "..." },
    "youtube":   { ... },
    ...
  },
  "deployDefaults": { ... }
}
```

플랫폼당 슬롯이 **정확히 하나**다. 그래서 한 사용자가 IP를 여러 개 운영해도
인스타그램 계정은 하나뿐이고, 어느 IP에서 배포하든 같은 계정으로 나간다.

실제 운영은 그 반대다. IP마다 채널이 따로 있고, 그 채널의 **소유 주체도 서로 다르다.**
「모양새 친구들」의 인스타그램과 「판관 포청천」의 인스타그램은 다른 계정이며,
같은 슬롯을 공유해서는 안 된다.

### 확인된 현재 IP 목록 (2026-08-02, 운영 서버 조회)

| IP(브랜드) | seriesId |
|---|---|
| 모양새 친구들 | `projects1771052244218` |
| 판관 포청천 | `projects1780501423217` |
| Memoment | `projectsmemoment-ep1` |

---

## 2. 용어 확정 — IP = 시리즈(브랜드), 에피소드 = 프로젝트

이 구분을 흐리면 설계 전체가 어긋나므로 먼저 못을 박는다.

| 화면 표현 | 코드 상 개념 | 식별자 | 비고 |
|---|---|---|---|
| 브랜드 카드 (BRAND / 모양새 친구들) | series | `seriesId` | **이것이 IP다** |
| 에피소드 (6 에피소드) | project / draft | `projectId` | IP 하위 단위 |

현재 코드가 화면 간에 넘기는 `projectId` 는 **에피소드 id**다. IP id가 아니다.
`brandId` 도 존재하지만 `normalizeBrandId()` 가 소문자화 + 문자 제거를 하는 **손실 변환**이라,
서로 다른 두 IP가 같은 `brandId` 로 충돌할 수 있다. 충돌하면 두 IP의 SNS 계정이 합쳐진다 —
이번 작업이 막으려는 사고 그 자체다.

> **결정: IP 식별자는 `seriesId` 로 한다.** `brandId` 는 표시·분석용 보조값으로만 남긴다.
> 공유 레지스트리(`_shared/shares.ts`)도 이미 `seriesId` 를 저장하고 있어 정합이 맞는다.

---

## 3. 현재 IP 컨텍스트가 세 곳에서 따로 계산되고 있다

같은 질문("지금 어느 IP인가")에 세 파일이 각자 다르게 답한다.

| 파일 | 함수 | 무엇을 반환하나 | 문제 |
|---|---|---|---|
| `js/navigation.js` | `readCurrentContext()` (비공개) | `{ projectId, brandId }` | seriesId 없음. 외부에서 쓸 수 없음 |
| `js/ui/dashboard.js` | `resolveSelectedSeriesId()` | `seriesId` | 대시보드 안에서만 존재 |
| `js/ui/sns-settings.js` | `_currentProjectId()` | 에피소드 `projectId` | IP가 아니라 에피소드를 봄 |

여기에 `localStorage.nk_current_project` 는 `{ id, title }` 만 저장하고 **seriesId를 저장하지 않는다.**
그래서 페이지를 새로고침하면 IP를 스토어 조회 없이는 복원할 수 없다.

이 상태에서 SNS 연결만 IP 단위로 바꾸면, 화면마다 "지금 IP"의 답이 달라져
**A 브랜드를 연결한다고 생각했는데 B 브랜드에 계정이 붙는** 사고가 난다.
그래서 컨텍스트를 먼저 하나로 모은다.

---

## 4. 목표 구조

### 4.1 저장 구조

```
gs://{bucket}/{basePrefix}/users/{userId}/userdata/sns-settings.json

{
  "schemaVersion": 2,
  "ips": {
    "projects1771052244218": {
      "instagram": { "connected": true, "enabled": true, "username": "...", "accessToken": "..." },
      "youtube":   { ... }
    },
    "projects1780501423217": {
      "instagram": { "connected": true, ... }
    }
  },
  "deployDefaults": { ... }
}
```

- 레코드도 토큰도 IP별로 완전히 독립.
- 최상위 `sns` 키는 v2 전환 시 `ips` 로 이관 후 제거한다(§7).

### 4.2 규칙

| 항목 | 규칙 |
|---|---|
| 소유 단위 | IP(seriesId) |
| 1계정:1IP | **원칙이되 강제 아님.** 이미 다른 IP에 붙은 계정으로 연결하면 경고 후 사용자가 확인하면 진행 |
| 해제 | IP별 독립. A IP에서 해제해도 B IP는 유지 |
| 공유 프로젝트 | 그 IP의 연결(= 제공자 것)을 읽기 전용으로 따름. 공유받은 쪽은 연결/해제/토글 불가 |
| 컨텍스트 없음 | 브랜드 관리 페이지로 되돌림. 하위 페이지는 IP 없이 열리지 않음 |

---

## 5. IP 컨텍스트 게이트

브랜드 관리 페이지(`brand-dashboard.html?view=brands`)를 거치지 않으면 하위 페이지를 열 수 없다.

### 5.1 게이트 대상 (전수)

| 화면 | 파일 | 게이트 조건 |
|---|---|---|
| 에피소드 | `brand-dashboard.html?view=episodes` | `view=episodes` 일 때만 |
| 허브센터 | `knowledge.html` | 항상 |
| 콘텐츠 저장소 | `library.html` | 항상 |
| 성과분석 | `analytics.html` | 항상 |
| SNS 연결 | `sns-settings.html` | 항상 |
| 브랜드 | `brand.html` | 항상 |

`brand-dashboard.html?view=brands` 는 게이트의 **목적지**이므로 대상이 아니다.
`dashboard.html` / `admin.html` / `ai-*` 스테이지도 대상이 아니다.

### 5.2 여섯 페이지의 공통 로드 목록 (확인 완료)

여섯 페이지 모두 다음을 이미 로드한다 —
`core.js`, `js/config.js`, `js/utils.js`, `store.js`, `api.js`, `js/state.js`,
`js/auth.js`, `js/navigation.js`, `js/service/project.js`, `js/ui/common.js`, `script.js`.

따라서 새 가드 파일 한 개를 추가하고 여섯 파일에 `<script>` 한 줄씩만 넣으면 된다.

> `knowledge.html` 과 `library.html` 만 `?v=` 캐시 버스터가 빠져 있다. 가드 스크립트를 넣을 때
> 이 두 파일도 다른 페이지와 같은 `?v=` 규칙으로 맞춘다. 안 맞추면 가드가 캐시된 구버전에서
> 동작하지 않는다.

---

## 6. 작업 단계

각 단계는 **사용자가 끝까지 완주할 수 있는 흐름 하나**다. UI와 그 UI가 하는 일은 같은 단계에 둔다.
커밋 = 라이브 배포이므로, 아직 동작이 없는 요소는 렌더하지 않는다.

### 1단계 — IP 컨텍스트 단일 원천 + 게이트

**산출**: `js/ip-context.js` (신규), 여섯 HTML의 스크립트 한 줄, 기존 세 곳의 중복 계산 제거.

- `NK.ipContext.resolve()` → `{ ipId, ipTitle, projectId, projectTitle }`
- `NK.ipContext.require()` → 없으면 `brand-dashboard.html?view=brands` 로 이동
- `navigation.readCurrentContext()` / `dashboard.resolveSelectedSeriesId()` / `sns-settings._currentProjectId()` 는
  전부 이 단일 원천을 호출하도록 교체
- `localStorage.nk_current_project` 에 `seriesId` 를 함께 저장(새로고침 복원용)
- 스테이지 URL에 `ipId` 를 함께 전파

**사용자가 보는 것**: 브랜드를 거치지 않고 하위 페이지에 들어가면 브랜드 목록으로 되돌아온다.
그 외 화면 변화 없음.

**이 단계에서는 SNS 저장 구조를 건드리지 않는다.**

### 2단계 — 저장 구조 v2 전환 + 마이그레이션

- `userdata/sns/get.ts` · `save.ts` 를 `ips[ipId][platform]` 로 전환, `ipId` 필수 파라미터화
- 서버 읽기 지점 전수 전환:
  `sns/publish.ts`, `sns/analytics/sync.ts`, `sns/callback/instagram.ts`, `sns/gcs-debug.ts`,
  `youtube/refresh-info.ts`, `agent/_shared.ts`,
  `_shared/facebook-token.ts`, `_shared/threads-token.ts`, `_shared/tiktok-token.ts`,
  `_shared/x-token.ts`, `_shared/youtube-token.ts`,
  `auth/tiktok/callback.ts`, `auth/facebook/callback.ts`, `auth/threads/callback.ts`,
  `auth/x/callback.ts`, `auth/youtube/callback.ts`
- **1회성 마이그레이션**: 기존 최상위 `sns` 블록을 `ips["projects1771052244218"]`(모양새 친구들)로 이관.
  실사용자가 NK 본인뿐이므로 안내 문구는 불필요. 이관 후 최상위 `sns` 키 제거.

### 3단계 — OAuth 경로에 ipId 전달

- `api/sns/connect/*.ts` 6종의 `state` 에 `ipId` 추가 (현재 `{ userId, ts }`)
- 대응 콜백 6종이 `state.ipId` 로 저장 위치 결정
- 클라이언트 `apiGet('/api/sns/connect/' + platform)` 에 `?ipId=` 부착
- `ipId` 없는 요청은 400 으로 거절 (조용히 사용자 단위로 저장되는 폴백을 두지 않는다)

### 4단계 — 연결 화면 IP 대응 + 중복 경고

- `sns-settings.js` 가 `ips[현재 ipId]` 만 읽고 씀
- 상단에 "지금 〈모양새 친구들〉의 채널을 연결하고 있습니다" 표시
- 다른 IP에 이미 붙은 계정으로 연결 시도 시:
  "이 계정은 이미 〈판관 포청천〉에 연결돼 있습니다. 그래도 연결할까요?" → 확인 시 진행
- 공유받은 프로젝트는 읽기 전용 유지
- 로컬 캐시 키 `nk_sns_states` 를 `nk_sns_states::{ipId}` 로 분리

### 5단계 — 배포 경로 검증

- 배포 시 후보 채널이 그 IP의 연결만 나오는지
- 초안/포맷 카드가 IP별 연결 상태를 올바로 읽는지
- 회귀 테스트: 화면별 목록이 단일 원천과 일치하는지 강제

---

## 7. 마이그레이션 상세

| 항목 | 내용 |
|---|---|
| 대상 | `users/{userId}/userdata/sns-settings.json` 의 최상위 `sns` |
| 이관처 | `ips["projects1771052244218"]` (모양새 친구들) |
| 방식 | `get.ts` 최초 읽기 시 `schemaVersion` 이 없으면 1회 변환 후 저장 |
| 대상 사용자 | NK 본인/테스트 계정뿐 — 외부 사용자 없음 (2026-08-02 확인) |
| 사후 | 최상위 `sns` 키 제거. v1 폴백 코드는 남기지 않는다 |

---

## 8. 하지 않을 것

- 화면 단위로 쪼갠 지시 — 개념(IP 컨텍스트, 연결 소유 단위) 단위로만 쪼갠다
- 동작 없는 UI 선출고 — 버튼과 그 버튼이 하는 일은 같은 커밋
- `ipId` 누락 시 사용자 단위로 저장하는 조용한 폴백 — 이게 있으면 IP 분리가 무의미해진다
- `brandId` 를 IP 키로 사용 — 손실 변환이라 충돌 위험

---

## 9. 검증 기준

1. 브랜드를 거치지 않고 여섯 페이지 URL을 직접 열면 전부 브랜드 목록으로 되돌아온다
2. IP를 바꾸면 SNS 연결 화면의 카드 상태가 함께 바뀐다
3. A IP에서 인스타 해제 후에도 B IP의 인스타는 연결 상태를 유지한다
4. 배포 시 후보 채널이 현재 IP의 연결만 나온다
5. 서버 파일에 최상위 `sns` 키가 남아 있지 않다
