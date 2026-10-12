# nk-director

nkstudio.org 의 대화형 CF 연출 디렉터. Claude Managed Agents(에이전트 루프·사용자별 격리 샌드박스·메모리)를 쓰고,
이 서비스(Cloud Run)는 **화면 ↔ 세션 중계, 크레딧 정산, 에이전트용 MCP 도구**만 맡는다. Atlas·GCS·DB 키는 두지 않는다.
크레딧·가격·저장·영상 생성은 모두 사이트 API(`/api/video`, `/api/credits/*`, `/api/project/*`, `/api/director/*`)를 그대로 쓴다.

```
브라우저(ai-company-app 디렉터 화면) ──SSE──▶ nk-director ──▶ Anthropic Managed Agents
                                               ▲  /mcp            (agent "NK Director", env "nk-director-env",
                                               └──────────────────  skill nk-cf-director, 메모리 스토어)
                                     사이트 API ◀── 사용자 위임 토큰(볼트 static_bearer)
```

## 폴더
| 경로 | 내용 |
|---|---|
| `src/server.ts` | HTTP 라우터(게이트웨이 + `/mcp`) |
| `src/gateway/` | 세션 생성·메시지·승인·중단·SSE 중계·크레딧 정산·사용자 상태 |
| `src/mcp/tools.ts` | 에이전트 도구(프로젝트·시퀀스·테이크·미디어·견적·영상·이미지) |
| `agent/system.md` | 에이전트 시스템 프롬프트 |
| `skills/nk-cf-director/` | 플레이북 스킬(로컬 Claude Code 와 공용 원본) |
| `scripts/setup.ts` | 에이전트·환경·스킬 생성/갱신 → `claude-lock.json` |

## 비밀값 (GCP Secret Manager, 프로젝트 `elidus`)
- `ANTHROPIC_API_KEY` — Anthropic Console 마스터 API 키(기본 워크스페이스). 구독 토큰은 쓰지 않는다.
- `DIRECTOR_SERVICE_SECRET` — 사이트(Cloudflare Pages `nk-ai-studio`)와 같은 값.

## 배포
```bash
cd director
gcloud run deploy nk-director --source . --region asia-northeast3 --allow-unauthenticated \
  --timeout 3600 --min-instances 0 --max-instances 5 --memory 512Mi --cpu 1 \
  --set-secrets ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DIRECTOR_SERVICE_SECRET=DIRECTOR_SERVICE_SECRET:latest \
  --set-env-vars PUBLIC_BASE_URL=<서비스 URL>,DIRECTOR_AGENT_ID=<agent_…>,DIRECTOR_ENVIRONMENT_ID=<env_…>
```
처음에는 URL 을 모르므로 ① 한 번 배포해 URL 을 얻고 ② `npm run build && PUBLIC_BASE_URL=… npm run setup` 으로
에이전트를 만들고 ③ 환경 변수를 넣어 다시 배포한다. 스킬·시스템 프롬프트를 고치면 `npm run setup` 만 다시 돌린다.

## 비용
- Cloud Run: 유휴 0 인스턴스.
- Managed Agents: 세션 실행 시간당 $0.08 + 모델 토큰(Opus 5.5). 회원 세션은 잔액·상한으로 예산을 걸고, 사용량은 `/api/director/charge` 로 크레딧 정산(소유자 무과금).
