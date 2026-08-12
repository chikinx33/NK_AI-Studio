# NK 문서 변환기 (Cloud Run) — DOCX → PDF

서식 엔진이 만든 **DOCX 를 PDF 로 바꾸기만** 하는 마이크로서비스입니다.
문서를 만들지 않습니다 — 생성은 Workers(`_render-docx.ts`)가 하고, 여기는 변환 전용입니다.
그래야 PDF 와 DOCX 의 생김새가 어긋나지 않습니다(설계서 §6.4 · §10 #3).

| 항목 | 값 |
| --- | --- |
| 엔드포인트 | `POST /convert?from=docx` · `GET /healthz` |
| 인증 | `Authorization: Bearer <DOC_CONVERT_TOKEN>` (토큰 미설정이면 **모든 요청 거부**) |
| 요청 본문 | DOCX 바이트 그대로 |
| 응답 | `application/pdf` 바이트 |
| 상태 | 없음. `/tmp` 에서 변환하고 응답 후 바로 지움 |
| 범위 밖 | **HWPX → PDF** (H2Orestart 확장 필요 + 재현 품질 보장 불가) |

---

## 1. 배포 (gcloud)

> 사전: `gcloud` 로그인 + 프로젝트 선택, Cloud Run/Artifact Registry API 활성화.
> LibreOffice 이미지라 빌드에 5~10분 걸립니다.

이 디렉터리(`doc-convert/`)에서 실행:

```bash
TOKEN=$(openssl rand -hex 32) && echo "$TOKEN"
```

```bash
gcloud run deploy nk-doc-convert --source . --region asia-northeast3 --allow-unauthenticated --memory 2Gi --cpu 2 --concurrency 1 --timeout 60s --min-instances 0 --max-instances 3 --set-env-vars "DOC_CONVERT_TOKEN=$TOKEN"
```

- `--concurrency 1` · `--timeout 60s` · `--max-instances 3` — 설계서 §6.4 그대로입니다.
- `--min-instances 0` — 안 쓸 때 과금 0. 대신 첫 요청은 콜드스타트(이미지가 커서 20~60초)를 겪습니다.
  Workers 쪽에서 **90초까지 기다리고 1회 재시도**하도록 맞춰 뒀습니다.
- 메모리 2Gi 는 LibreOffice 가 한글 폰트를 올리고 변환하는 데 필요한 최소선입니다. 1Gi 로 줄이면
  큰 문서에서 OOM 으로 죽습니다.

배포 후 확인:

```bash
curl https://<서비스-URL>/healthz
```

한글이 실제로 나오는지까지 확인(★가장 중요 · §10 #12):

```bash
curl -X POST "https://<서비스-URL>/convert?from=docx" -H "Authorization: Bearer $TOKEN" --data-binary @견적서.docx -o 견적서.pdf
```

받은 PDF 를 열어 **한글이 네모(□□□)로 나오지 않는지** 눈으로 확인합니다. 네모가 보이면
폰트가 빠진 것이므로 Dockerfile 의 `fonts-noto-cjk` 설치를 먼저 확인하세요.

---

## 2. Cloudflare Pages 환경변수 등록

Cloudflare Pages 프로젝트 → Settings → Environment variables:

| 이름 | 값 |
| --- | --- |
| `DOC_CONVERT_URL` | 배포된 서비스 URL (끝 슬래시 없이) |
| `DOC_CONVERT_TOKEN` | 위에서 만든 `$TOKEN` 과 같은 값 |

**두 값이 없으면 PDF 는 만들어지지 않습니다.** 그 경우 form_fill 은 DOCX·HWPX·XLSX 만 만들고
"PDF 변환이 설정되지 않았어요"라고 알려 줍니다 — 다른 파일까지 실패하진 않습니다.

---

## 3. 로컬에서 시험

```bash
docker build -t nk-doc-convert . && docker run --rm -p 8080:8080 -e DOC_CONVERT_TOKEN=test nk-doc-convert
```

```bash
curl -X POST "http://localhost:8080/convert?from=docx" -H "Authorization: Bearer test" --data-binary @sample.docx -o sample.pdf
```

---

## 4. 비용

요청이 없으면 인스턴스가 0 으로 내려가 과금되지 않습니다(요청당 과금). 변환 한 건은 보통
2~5초 CPU 를 씁니다. 콜드스타트가 싫으면 `--min-instances 1` 로 올릴 수 있지만 그만큼 상시 과금됩니다.
