# NK Studio · 자체 호스팅 TTS (MeloTTS · Cloud Run)

에이전트 음성용 **무료·오픈소스 한국어 TTS** 서버입니다.
Gemini TTS 처럼 호출당 과금이 없고(오픈소스·MIT), Cloud Run 컴퓨트 시간만 듭니다.
브라우저 speechSynthesis 와 달리 **모든 사용자에게 동일한 목소리**를 제공합니다.

- 모델: [MeloTTS](https://github.com/myshell-ai/MeloTTS) (MIT 라이선스 · 상용 가능)
- 컴퓨트: **CPU 전용** (GPU 불필요) → 서울 리전(`asia-northeast3`) 그대로 사용 가능
- 호출 경로: 웹 → Cloudflare Function `/api/tts/melo` → (공유 시크릿) → 이 서버

> 목소리 복제(voice cloning)는 지원하지 않습니다. 한국어 화자는 1종이며,
> 직원별 구분은 **속도(speed)+피치(semitones)** 로 처리합니다.

---

## 1. 배포 (gcloud)

> 사전: `gcloud` 로그인 + 프로젝트 선택, Cloud Run/Cloud Build/Artifact Registry API 활성화.
> openai-proxy 와 같은 프로젝트/리전을 쓰면 관리가 편합니다.

이 디렉터리(`melo-tts/`)에서 실행:

```bash
# 1) 공유 시크릿 생성 (한 번만, 어딘가에 보관 — Cloudflare 에도 같은 값을 넣습니다)
SECRET=$(openssl rand -hex 32)
echo "$SECRET"

# 2) 소스에서 바로 배포 (Dockerfile 사용)
gcloud run deploy nk-melo-tts \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --timeout 120 \
  --concurrency 4 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "MELO_TTS_SECRET=$SECRET,MELO_LANGUAGE=KR"
```

배포가 끝나면 서비스 URL(예: `https://nk-melo-tts-xxxx-du.a.run.app`)이 출력됩니다.

### 콜드스타트 vs 상시가동

- `--min-instances 0` : 유휴 시 0원. 단, 첫 요청은 모델 로드로 **10~30초** 지연.
- 지연이 싫으면 `--min-instances 1` : 항상 1대 유지(월 고정비 발생, 첫 응답 빠름).

메모리는 4Gi 권장(모델+torch). 부족하면 `--memory 8Gi` 로 올리세요.

---

## 2. Cloudflare 환경변수 등록

Pages 프로젝트(prototype) 설정 → 환경변수에 추가:

| 변수 | 값 |
|---|---|
| `MELO_TTS_URL` | 위 Cloud Run 서비스 URL |
| `MELO_TTS_SECRET` | 1단계에서 만든 `$SECRET` |

`/api/tts/melo` Function 이 이 값으로 서버측에서 호출합니다(시크릿은 브라우저에 노출되지 않음).

---

## 3. 동작 확인

```bash
# 헬스체크
curl https://<서비스URL>/

# 합성 테스트(시크릿 필요) — test.wav 로 저장
curl -X POST https://<서비스URL>/tts \
  -H "content-type: application/json" \
  -H "x-nk-proxy-secret: $SECRET" \
  -d '{"text":"안녕하세요. 엔케 스튜디오입니다.","speed":1.0,"semitones":0}' \
  --output test.wav
```

웹에서는 상단 음성 방식 토글을 **🖥️ 서버 음성**으로 두면 이 서버로 낭독합니다.

---

## API

`POST /tts` (헤더 `x-nk-proxy-secret` 필수)

```json
{ "text": "읽을 문장", "speed": 1.0, "semitones": 0.0, "language": "KR" }
```

- `speed`: 0.5~2.0 (기본 1.0)
- `semitones`: 반음 단위 피치 시프트(±). 남성 −, 여성 + 로 직원 구분.

응답: `audio/wav` 바이너리.

---

## 트러블슈팅

- **빌드에서 MeloTTS 설치 실패**: 네트워크/버전 이슈. `python -m unidic download` 는 `|| true`
  로 무시하도록 되어 있습니다. torch 버전(2.2.2)이 안 맞으면 Dockerfile 에서 조정하세요.
- **첫 요청 500 / 느림**: 모델 미캐시. 빌드 warm-up 이 스킵됐을 수 있음 → 첫 요청이 로드를 마치면 이후는 정상.
- **한국어 발음 어색**: MeloTTS KR 한계. 더 좋은 품질이 필요하면 문서의 XTTS(비상용·GPU) 대안 참고.
