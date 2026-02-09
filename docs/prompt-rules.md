# 프롬프트 생성 규칙 (NK_Studio)

본 문서는 2026-02-09 기준 프리프로덕션/이미지·영상 생성 파이프라인에서 사용되는 프롬프트 규칙을 정리한다. (UTF-8)

## 1. 입력 항목과 역할
- **Topic(주제)**: 줄거리/소재만 결정. 톤·스타일 금지.
- **Genre(purposeCategory) + Tags(purposeTags)**: 서술 관점/전개 틀을 결정. 각 태그 관점 문장을 최소 1개 포함. 낯선 태그는 상식적 관행으로 추론.
- **Audience(Target) + Needs**: 어휘 난이도·예시 선택에만 영향. 플롯/스타일을 바꾸지 않음.
- **Duration**: 씬 개수·길이 분배만 결정. 감정/스타일에 영향 금지.
- **Tone**: 말투·정서 표현. 시각 묘사 금지. 자유입력 있으면 태그 무시(단일 선택).
- **Style**: 시각적 룩·질감·조명. 내러티브/톤 금지. 자유입력 있으면 태그 무시(단일 선택).
- **Mandatory(extraNotes/banned)**: 변형 없이 반드시 적용/금지. 충돌 시 톤/스타일보다 우선.
- **AspectRatio**: 16:9, 9:16, 1:1 등.

## 2. 장르 목적 자동 적용
- 장르별 한 줄 목적을 사전에 정의(예: 지식·교양 → “정확·명료한 설명, 과장 금지, 이해 우선”). 정의가 없으면 모델이 추론.

## 3. 시나리오 프롬프트 구조
- **System**: 역할 분리, 태그별 관점 포함, 톤/스타일 우선순위(자유입력>태그), Mandatory 우선, Scene 수/estSec 규칙, title/shot 필수, 마크다운 금지 등.
- **User**: Topic, Genre, Tags, Target, Needs, Tone/Style(자유·태그), Mandatory, AspectRatio, Duration를 라벨로 명시. 태그별 관점 문장 포함, Audience는 어휘/예시만 조정하도록 강조.

## 4. 후처리(scenario)
- OpenAI 응답 `scenes[]`에 대해 shot/estSec/title 누락 시 보정.
- `rebalanceEstSec`로 총 길이를 목표(Duration)과 맞추도록 비례 재분배(최소 3초).
- 실패 시 `fallbackScenes`로 기본 시나리오 반환.

## 5. Common / Visual 역할 분리 (이미지·영상 공통)
- **Common(공통)**: 전 프로젝트에 적용되는 시각 톤·룩·연출 가이드만 적는다.  
  - 포함: 스타일 키워드(렌더링 방식/질감/조명 기조), 색·무드, 카메라 경향(고정/핸드헬드), 연속성 규칙(씬 간 색/조명/캐릭터 일관), 금지/강조 요소.  
  - 제외: 화면 비율, 분량, 스토리 플롯 설명(Story용), 각 씬 개별 디테일.
- **Visual(shot)**: 해당 씬 하나를 그릴 구체 연출.  
  - 포함: 주피사체/배경, 행동, 카메라 앵글·렌즈·구도, 조명·시간대, 색감, 질감, 필요한 소 props, 인물 유무, 텍스트 표시 여부(없음 권장).  
  - 한 문장 안에서 필요시 “no people / no text” 등 부정도 함께 명시해 네거티브 남발을 줄인다.
- 렌더 우선순위: **Visual > Style lock > Common**. Common은 참고용이며 “do NOT render” 표시로 전달.

### 개선된 예시 (위 수학 시나리오)
- Common 예시  
  - “Photoreal, clean studio lighting, deep teal/dark navy palette, sharp focus, thin neon highlights on mathematical lines; camera steady tripod; keep shots consistent in palette/lighting across scenes; no anime/cel shading; no subtitles/speech bubbles.”
- Scene 1 Visual 예시  
  - “Wide shot, dark lab wall, glowing ζ(s)=0 formula floating in front of a glass board, only equations and grid visible, no people, no text overlays, photoreal lighting, subtle volumetric light.”
- Scene 2 Visual 예시  
  - “Medium shot of hands annotating a printed complex plane chart on a desk, soft key light from left, shallow depth of field, no faces visible, no on-screen text.”
- Scene 3 Visual 예시  
  - “Close-up of a monitor showing a clean line chart of zero distributions, dark UI, teal accent lines, no speech bubbles, photoreal.”

## 6. 이미지 프롬프트(pipeline.js) 구성
- Primary visual: `scene.shot`(위 Visual)를 그대로 렌더 지시.
- Style lock: 선택 스타일만 사용, 다른 룩 추가 금지.
- Background context: Common을 `do NOT render`로 전달(톤·룩 참고만).
- Narration 미반영: 텍스트/인물 유인을 줄이기 위해 narration은 렌더하지 않는 컨텍스트로만 전달.
- Aspect ratio는 별도 파라미터로 전달하며 Common/Visual 문구에는 포함하지 않는다.

## 7. 에러 로깅
- `api.js`: imagen/video 요청 실패 시 `status`와 원문 `detail`을 Error에 담아 throw.
- `pipeline.js`: 이미지/영상 생성/폴링 실패 시 콘솔에 detail 출력, 씬 `imgError`/`videoError`에 상세 포함, 알림에도 표시.

## 8. 기타 규칙
- Tone/Style 자유입력이 있으면 태그 무시(우선순위 고정).
- 선택 태그/톤/스타일 버튼은 단일 선택.
- Version 관리: 코드 수정 시 `prototype/js/config.js`의 `APP_VERSION`을 즉시 증가.

## 9. 참고 흐름
- 프론트 폼 → `/api/scenario` → OpenAI → scenes 보정/저장 → 렌더.
- 이미지 생성: 씬 선택 → finalPrompt(shot 중심) → `/api/imagen`(Vertex) → imageDataUrl 저장.
- 영상 생성: promptText/shot/script 등 → `/api/video` → status 폴링.
