# NK OpenAI 지역-우회 프록시 (Cloud Run)

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
