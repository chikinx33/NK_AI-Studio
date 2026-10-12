# 콘티 · 참조 배치표 · 시퀀스 프롬프트

## 1. 콘티(컷 리스트) 작성

컷 하나에 아래를 모두 채운다. 빈칸이 있으면 생성하지 않는다.

| 항목 | 예시 |
|---|---|
| id / 시간 구간 | `C05` · 4.2–5.5s |
| 카피·나레이션(편집용) | "금융도 마찬가지입니다" (프롬프트에는 넣지 않음) |
| 샷 사이즈·앵글 | MS, 부자 사이 눈높이, 골목 끝 방향 |
| 진행 중인 행동 | 아빠가 아이 어깨를 잡아 진정시키는 중, 카메라는 둘 사이로 푸시인 |
| 표정 변화 | 아빠 걱정 → 안도 |
| 카메라 | 둘 사이로 푸시인 + 부자 → 여성 랙포커스 |
| 소리 | 아빠 안도의 숨, 먼 차 소리 (음악 없음) |
| 앞뒤 연결 | C04 저지 동작을 이어받음, C06 공 클로즈업으로 |
| 스틸(첫 프레임 구도) | `컷/C05.png` |

설계 점검:
- 인접 컷의 사이즈·앵글이 30도 이상 다른가? 차선·동선·소품이 이어지는가?
- 필로우 샷 1~2개가 들어갔는가? 감정이 큰 컷에만 과장을 배정했는가?
- 이전 버전에 있던 사건 비트가 모두 살아 있는가? 이번 버전이 그보다 풍부한가?
- 컷 사이 연결이 하드컷인가, 한 숏 연속 무브인가? 연속 무브는 "ONE CONTINUOUS CAMERA MOVE, no cut, no fade"로 명시한다.

## 2. 생성 단위 정하기

- 기본은 콘티 전체(최대 30초)를 **한 번에** 만드는 것이다.
- 공간·사건이 완전히 다르고 참조 간섭(골목 컷에 잔디가 섞이는 등)이 보이면 **공간 단위로 2~3분할**한다. 이때 각 분할에는 그 구간 참조만 넣는다.
- 컷 단위 4초 생성은 하지 않는다. 예외는 특정 문제를 고치는 부분 재생성뿐이다(seedance.md §4).

## 3. 참조 배치표

Seedance 2.5 R2V는 이미지 최대 30장을 받는다. 순서대로 `@Image1…`로 부른다. 표로 먼저 확정하고 프롬프트에 그대로 옮긴다.

| @ | 자산 | 역할 | 적용 구간 |
|---|---|---|---|
| Image1~4 | 인물 시트(전신·얼굴) | 외형·의상 고정 | 전체 또는 등장 컷 |
| Image5~11 | 배경 플레이트 | 공간 | 해당 컷 |
| Image12~14 | 소품(공·명함·폰 UI) | 소품 외형·글자 | 해당 컷 |
| Image15~ | 컷 스틸 | 각 컷 첫 프레임 구도 | 해당 컷 |

규칙:
- 자산(캐릭터·배경·소품)을 앞에, 컷 스틸을 뒤에 둔다.
- 실패·반려 결과물, 옛 룩의 플레이트는 넣지 않는다.
- 한 테이크 안에서 배경이 바뀌는 연속 무브라면 배경 참조를 하나로 통일하고 나머지는 글로 쓴다(디졸브 방지).
- 해상도는 모델 입력 조건(대략 300~6000px)을 확인한다. 업스케일은 AI 처리 1세대가 늘어난다는 점을 사용자에게 알린다.

## 4. 시퀀스 프롬프트 템플릿 (영문)

```
A {N}-second {style: stylized 3D animated TV commercial (feature-film CG, NOT photographic) | live-action commercial}, {light/time of day}.
Keep every character exactly as in the character sheets: @Image1 {name} ({face, hair, outfit, shoes}), @Image2 {…}.
{Global props: "One black-and-white soccer ball @Image12 throughout."}
{Global world rules: "No traditional tiled roofs; flat-roof villas only. Cars always stay inside their own lane. Every person stays inside the ribbon fence."}
No on-screen text, captions or logos except the printed props @Image13 and @Image14.

AUDIO: absolutely NO background music, no musical score, no melodic pads, no humming, no narration voice. Only natural sound effects and the characters' own short sounds listed below.

SHOT LIST (hard cuts unless noted; each shot starts from the composition of its storyboard frame):
0.0–1.5 (@Image15, @Image5) {SIZE/ANGLE}: {ongoing action}. {ACTING}. {CAMERA}. SFX {…}.
1.5–2.3 (@Image16) {…}
…
16.2–20.0 ONE CONTINUOUS CAMERA MOVE, no cut, no fade: starts on {…}, then the camera {…}, revealing {…}. Hold the final frame for about 1.5 seconds. SFX {…}. No music.
```

작성 요령:
- 시간 구간은 콘티와 같게 쓴다. 미세한 동작 박자까지 과도하게 강제하지는 않는다.
- 대사는 원어 그대로 따옴표 안에 쓴다(예: Father: "안 돼!"). 대사가 없는 컷에 입을 벌린 정지 표정을 지시하지 않는다.
- 인물 설정의 반복 실수(무화장, 손)와 프로젝트 고정 규칙(리본 안쪽, 마스코트 소품 글자)은 해당 컷 문장 안에 다시 쓴다.
- 금지 조건만 나열한 한 줄 프롬프트는 연기·긴장감이 없는 결과를 만든다. 행동 서술이 중심이고 금지는 보조다.

## 5. 실행안 제시 형식 (승인 요청)

| 안 | 구성 | 예상 비용 | 예상 시간 |
|---|---|---|---|
| A (권장) | 20초 1회: 480p 드래프트 → 검수 → 같은 드래프트를 1080p로 완성 | 드래프트 $x + 완성 $y = 약 $z | 드래프트 5~10분, 완성 10~15분 |
| B | 공간별 2분할 | … | … |

같이 묻는 것: 드래프트 횟수(권장 1회, 최대 2회), 비용 상한, 참조 업스케일 여부, 음향 생성 여부.
