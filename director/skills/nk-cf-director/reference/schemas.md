# 데이터 형식

nkstudio.org 디렉터와 로컬 작업이 같은 형식을 쓴다. 사이트에서는 프로젝트 `payload.sequences[]`에 저장하고(`sequence_save`·`take_record`), 로컬에서는 문서 폴더에 JSON으로 둔다.

## 1. Sequence (한 번의 생성으로 만드는 사건 단위)

```json
{
  "id": "seq-playground-a",
  "title": "안전한 운동장 · 골목",
  "order": 1,
  "durationSec": 20,
  "aspectRatio": "16:9",
  "style": "stylized 3D animated feature-film",
  "status": "conti|refs|drafting|review|completing|confirmed",
  "cuts": [ /* Cut[] */ ],
  "references": [ /* Reference[] — 배열 순서가 곧 @Image 번호 */ ],
  "prompt": "제출한(또는 제출할) 영문 시퀀스 프롬프트 전문",
  "takes": [ /* Take[] */ ],
  "selectedTakeIds": ["take-3", "take-5"],
  "notes": "결정 사항 메모",
  "updatedAt": "2026-10-13T10:00:00Z"
}
```

## 2. Cut (시퀀스 안의 시간 구간)

```json
{
  "id": "C05",
  "label": "CUT 5",
  "start": 4.2,
  "end": 5.5,
  "copy": "나레이션 : 금융도 마찬가지입니다 (편집용, 프롬프트 제외)",
  "shot": "MS · 부자 사이 눈높이 · 골목 끝 방향",
  "action": "아빠가 아이를 진정시키는 중, 카메라가 둘 사이로 푸시인",
  "acting": "아빠 걱정→안도",
  "camera": "push-in + rack focus 부자→여성",
  "sound": "아빠 안도의 숨, 먼 차 소리",
  "link": "C04 저지 동작 이어받음 → C06 공 인서트",
  "stillUrl": "gs://… 또는 컷/C05.png",
  "transition": "cut|continuous"
}
```

## 3. Reference

```json
{ "asset": "gs://…/characters/father-full.png", "role": "father appearance & outfit", "appliesTo": ["*"], "resolution": "1672x941", "generation": 1 }
```
- `appliesTo`: 컷 id 목록. `"*"`는 전체를 뜻한다.
- `generation`: AI 처리 세대 수. 원본 스틸은 1이고, 업스케일·편집을 거칠 때마다 1씩 올린다.

## 4. Take (생성 시도 1회)

```json
{
  "id": "take-3",
  "kind": "full|patch",
  "range": { "start": 2.3, "end": 6.6 },
  "replacesCuts": ["C03", "C04", "C05"],
  "model": "bytedance/seedance-2.5/reference-to-video",
  "jobId": "seedance-2.5:7be4bbfb…",
  "draft": true,
  "draftOfTakeId": null,
  "resolution": "480p",
  "durationSec": 4.04,
  "referenceCount": 7,
  "promptDigest": "프롬프트 해시 또는 앞 200자",
  "status": "queued|running|done|failed|rejected|confirmed",
  "videoUrl": "서명 URL(만료됨) — 재발급은 videoPath로",
  "videoPath": "users/…/videos/…mp4",
  "cost": { "credits": 70, "usd": 0.54 },
  "qa": {
    "sceneCuts": [1.54, 2.25],
    "musicSuspect": [[9.0, 20.0]],
    "transcript": [{ "t": 2.4, "text": "안 돼!" }],
    "pass": ["C03 공 중앙", "C05 랙포커스"],
    "fail": ["C06 공이 발 옆에 멈춤 4.9–5.4s"],
    "verdict": "pass|fail|partial"
  },
  "createdAt": "2026-10-12T09:00:00Z"
}
```
- `kind: patch`는 원래 테이크의 `range`를 대체한다. 편집기에서는 `replacesCuts`의 클립이 이 테이크의 구간으로 바뀐다.
- 1080p 완성 테이크는 `draftOfTakeId`로 드래프트 테이크를 가리킨다.
- 반려된 테이크도 지우지 않고 `status: rejected`와 사유를 남긴다. 단, 참조로는 절대 쓰지 않는다.

## 5. 프로젝트 메모리 파일 구성

메모리 스토어(사이트) 또는 프로젝트 폴더(로컬)에 아래 파일을 둔다. 파일 하나는 100KB 이하로 유지하고, 작게 나눈다.

| 경로 | 내용 |
|---|---|
| `/status.md` | 현재 기준본, 진행 중인 작업, 다음 할 일, 승인 대기 항목 |
| `/rules.md` | 이 프로젝트 고정 규칙(발주사·사용자 지시 원문 요약과 날짜). 예: "모든 인물은 리본 울타리 안", "기와지붕 금지" |
| `/feedback/NN-YYYYMMDD.md` | 발주사 피드백 회차별 요약과 반영 상태(반영/보류/질문) |
| `/characters.md` | 인물·마스코트 설정 문장(프롬프트에 그대로 쓰는 영문 포함), 시트 경로 |
| `/submissions.md` | 제출 기록: 날짜, 예측 ID, 모델·해상도·길이, 참조 수, 비용, 결과, 검수 요약 |
| `/lessons.md` | 이 프로젝트에서 새로 배운 것(왜 + 적용법) |

사용자 단위 메모리(모든 프로젝트 공통)에는 사용자의 작업 원칙과 취향만 둔다(예: "BGM 절대 금지", "편집은 사용자가 한다"). 비밀번호·API 키는 어떤 메모리에도 쓰지 않는다.
