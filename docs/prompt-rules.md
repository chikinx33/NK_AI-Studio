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

## 5. 이미지 프롬프트(pipeline.js)
- **Primary visual (scene.shot)**만 렌더 지시.  
- 보조 가드:  
  - `Render ONLY the primary visual; ignore unrelated narrative elements.`  
  - shot에 인물 키워드가 없으면 `Do not add human figures...`  
  - shot에 수학/공식 키워드가 있으면 공식/그리드 명확히 표현 지시.  
- **Style lock**: 사용자가 선택한 스타일만 사용, 다른 룩 추가 금지.  
- **Background context**: Common header를 `do NOT render`로 표시해 참고용만 전달.  
- **Narration**: `context only, do NOT draw text/characters`.  
- **Aspect ratio** 포함.  
- 목적: shot 우선, 컨텍스트는 참고만 하도록 단순화.

## 6. 에러 로깅
- `api.js`: imagen/video 요청 실패 시 `status`와 원문 `detail`을 Error에 담아 throw.
- `pipeline.js`: 이미지/영상 생성/폴링 실패 시 콘솔에 detail 출력, 씬 `imgError`/`videoError`에 상세 포함, 알림에도 표시.

## 7. 기타 규칙
- Tone/Style 자유입력이 있으면 태그 무시(우선순위 고정).
- 선택 태그/톤/스타일 버튼은 단일 선택.
- Version 관리: 코드 수정 시 `prototype/js/config.js`의 `APP_VERSION`을 즉시 증가.

## 8. 참고 흐름
- 프론트 폼 → `/api/scenario` → OpenAI → scenes 보정/저장 → 렌더.
- 이미지 생성: 씬 선택 → finalPrompt(shot 중심) → `/api/imagen`(Vertex) → imageDataUrl 저장.
- 영상 생성: promptText/shot/script 등 → `/api/video` → status 폴링.
