# NK 지역-우회 프록시 (Cloud Run) — OpenAI · Anthropic 공용

Cloudflare Worker 가 OpenAI 로 나갈 때 간헐적으로 **홍콩(HKG)** 등 미지원 COLO 로 송출되어
빈 본문 403(지역 차단)이 나는 문제를 영구히 없애기 위한 초경량 프록시입니다.
**OpenAI 지원 지역(서울 등)** 에서 돌아가는 이 프록시를 거치면 GPT 가 100% 동작합니다.

OpenAI 키는 호출자(Worker)가 `Authorization` 헤더로 그대로 보내므로, **프록시는 키를 보관하지 않습니다.**
공개 엔드포인트 오남용을 막기 위해 공유 시크릿(`x-nk-proxy-secret`)을 검증합니다.

---

## 1. 배포 (gcloud)

> 사전: `gcloud` 로그인 + 프로젝트 선택, Cloud Run/Artifact Registry API 활성화.
> 리전은 **반드시 OpenAI 지원 국가**여야 합니다. 한국(서울 `asia-northeast3`)은 지원 지역이고 지연도 낮습니다.
> (홍콩 `asia-east2` 같은 미지원 지역은 절대 사용 금지.)

이 디렉터리(`openai-proxy/`)에서 실행:

```bash
# 1) 강력한 랜덤 시크릿 생성 (한 번만, 어딘가에 보관)
SECRET=$(openssl rand -hex 32)
echo "$SECRET"

# 2) 소스에서 바로 배포 (Dockerfile 불필요 — Node 버킷빌드팩 자동 사용)
gcloud run deploy nk-openai-proxy \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --memory 256Mi \
  --cpu 1 \
  --max-instances 3 \
  --set-env-vars "OPENAI_PROXY_SECRET=$SECRET"
```

배포가 끝나면 서비스 URL(`https://nk-openai-proxy-xxxxxxxx-an.a.run.app`)이 출력됩니다.

확인:

```bash
curl https://nk-openai-proxy-xxxxxxxx-an.a.run.app/healthz   # -> ok
```

---

## 2. Cloudflare(Worker) 환경변수 등록

Cloudflare Pages 프로젝트 → Settings → Environment variables 에 추가:

| 이름 | 값 |
|---|---|
| `OPENAI_BASE_URL` | `https://nk-openai-proxy-xxxxxxxx-an.a.run.app` (배포된 서비스 URL, 끝 슬래시 없이) |
| `OPENAI_PROXY_SECRET` | 위에서 만든 `$SECRET` 와 동일한 값 |

저장 후 재배포(또는 다음 배포)부터 적용됩니다.

---

## 3. 동작 원리

- `imagen.ts` 는 `OPENAI_BASE_URL` 이 설정되면 `https://api.openai.com` 대신 그 주소로 호출하고,
  `OPENAI_PROXY_SECRET` 이 있으면 `x-nk-proxy-secret` 헤더를 함께 보냅니다.
- 프록시는 시크릿을 검증한 뒤 요청을 그대로 `https://api.openai.com` 으로 전달하고 응답을 돌려줍니다.
- 프록시가 **서울**에서 돌아가므로 OpenAI 입장에선 항상 지원 지역에서 온 요청 → 지역 차단 없음.

설정을 지우면(`OPENAI_BASE_URL` 제거) 즉시 원래 동작(직접 호출 + 지역 차단 시 Gemini 폴백)으로 돌아갑니다.

---

## 비용

요청을 잠깐 전달만 하므로 CPU/메모리 사용이 매우 작습니다. Cloud Run 은 트래픽이 없으면
인스턴스가 0 으로 줄어 비용이 거의 들지 않습니다(요청당 과금).


---

## 4. Anthropic(Claude) 도 이 프록시로

### 왜 필요한가 — 측정으로 확정된 사실 (2026-08)

설정 → 인증 진단의 '도달 검사' 결과:

```
도달 검사 (직접):       ❌ 도달 못 함 (403) · HKG · 11ms
도달 검사 (게이트웨이): ❌ 도달 못 함 (403) · HKG · 17ms
```

- 구독(OAuth)과 API 키가 **똑같이** 403 `Request not allowed` → 자격증명 문제가 아니다.
- `x-request-id` 가 없고 7~17ms 만에 응답 → Anthropic 서버까지 가지도 못하고 엣지에서 잘렸다.
- COLO 가 **HKG(홍콩)** → OpenAI 때와 같은 지역 차단이다.
- **Cloudflare AI Gateway 로는 해결되지 않는다.** 게이트웨이를 켜 둔 상태에서도 같은 403 이고
  COLO 도 HKG 다. 게이트웨이의 송출 지역이 바뀌지 않기 때문이다.

그래서 지원 지역(서울)에서 도는 이 프록시를 거쳐야 한다. 경로 접두어로 대상을 가른다:

| 경로 | 전달 대상 |
| --- | --- |
| `/anthropic/*` | `https://api.anthropic.com/*` |
| 그 외 | `https://api.openai.com/*` (기존 그대로) |

### 설정

프록시는 이미 위에서 배포한 그 서비스를 그대로 쓴다(재배포만 필요).
Cloudflare Pages 환경변수에 아래를 넣는다:

```
ANTHROPIC_GATEWAY_BASE = https://nk-openai-proxy-510034693257.asia-northeast3.run.app/anthropic
```

시크릿은 따로 넣지 않아도 된다. Worker 는 `ANTHROPIC_PROXY_SECRET` 이 없으면
이미 설정돼 있는 `OPENAI_PROXY_SECRET` 을 그대로 쓴다(프록시가 둘 다 같은 값을 검증한다).
둘을 다르게 쓰고 싶을 때만 `ANTHROPIC_PROXY_SECRET` 을 추가한다.

`anthropicMessagesUrl()` 이 여기에 `/v1/messages` 를 붙이므로 최종 목적지는
`https://nk-openai-proxy-510034693257.asia-northeast3.run.app/anthropic/v1/messages` 가 된다.

> `ANTHROPIC_GATEWAY_BASE` 가 `CF_AI_GATEWAY_URL` 보다 우선하므로, 기존 변수는
> 지우지 않아도 된다(대시보드에서 값을 지우는 조작은 실수하기 쉬워 피하는 편이 낫다).

### 실측 (2026-08-29, 서울 배포 후)

```
GET /anthropic/v1/models  +  x-nk-proxy-secret
  → 401 authentication_error · request_id 있음 · cf-ray COLO=KIX   ← Anthropic 도달
시크릿 없이 같은 요청
  → 403 invalid_proxy_secret                                       ← 공개 프록시 아님
헬스체크는 /healthz 가 아니라 / 를 쓴다(/healthz 는 Google Frontend 가 가로챈다).
```

### 확인

설정 → 인증 진단을 다시 눌러 `도달 검사 (게이트웨이)` 가 **✅ Anthropic 도달 (401)** 로
바뀌면 성공이다(401 은 진단이 키를 안 붙이기 때문이며 정상이다). 그 다음 라이브 테스트가 통과한다.
