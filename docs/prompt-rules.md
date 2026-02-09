# 프롬프트 생성 규칙 (정상 한글판)

## 1. 입력 항목 & 선택값
- **주제(topic)**: 자유 입력. (자유입력 우선 규칙 적용)
- **장르(purposeCategory) + 세부 태그(purposeTags)**  
  - 키즈 · 영유아: 유아 교육, 키즈 놀이, 키즈 학습, 동요, 율동, 동화  
  - 스토리 · 서사: 동화, 창작, 에피소드, 세계관, 판타지, 힐링  
  - 지식 · 교양: 상식, 과학, 수학, 역사, 인문학, 철학, 심리, 시사  
  - 교육 · 학습: 공부법, 시험 대비, 자격증, 언어 학습, 코딩, 튜토리얼  
  - 음식 · 요리: 레시피, 먹방, 맛집 소개, 요리 과정, 음식 리뷰, 홈쿡  
  - 여행 · 관광: 국내 여행, 해외 여행, 관광지 소개, 숨은 명소, 랜선 여행  
  - 라이프 · 일상: 브이로그, 일상 기록, 루틴, 자취, 육아, 직장 생활  
  - 리뷰 · 추천: 제품, 서비스, 콘텐츠 추천, 앱, 게임, 책, 영화  
  - 엔터테인먼트: 코미디, 패러디, 챌린지, 리액션, 밈 콘텐츠  
  - 게임: 게임 플레이, 공략, 하이라이트, 게임 리뷰, 모바일 게임  
  - 음악 · 사운드: 음악 소개, BGM, 커버, ASMR, 사운드 콘텐츠  
  - 스포츠 · 피트니스: 운동 루틴, 스트레칭, 홈트레이닝, 스포츠 해설, 경기 요약  
  - 취미 · 크리에이티브: 그림, DIY, 공예, 디자인, 글쓰기, 사진  
  - 비즈니스 · 경제: 창업, 재테크, 경제 상식, 마케팅, 브랜딩  
  - 테크 · IT: AI, 신기술, 앱 소개, 기기 리뷰, 생산성 툴  
  - 힐링 · 감성: 명상, 위로, 힐링 영상, 감성 브이로그, 자연 풍경  
  - 종교 · 신앙: 말씀 묵상, 설교 요약, 신앙 이야기, 간증, 기도  
  - 사회 · 공감: 인터뷰, 다큐형 콘텐츠, 사회 이슈, 공감 토크

- **시청 타겟(target)**: (드롭다운 단일 선택)  
  영유아 · 학습/놀이/감성 발달 / 아동 · 기초 학습/호기심/놀이/이야기 / 청소년 · 학습/시험/자기 정체성/엔터테인먼트 / 청년 · 엔터테인먼트/감성/힐링/정보/자기계발 / 직장인 · 업무 효율/실용 정보/자기계발/스트레스 해소 / 중장년 · 생활 정보/가정/경제/건강/취미/노후 설계 / 시니어 · 건강/여가/힐링/회고/정치 / 전 연령 · 공감/정보/엔터테인먼트

- **학습/니즈(needs)**:  
  학습, 놀이, 엔터테인먼트, 스토리, 감성, 힐링, 공감, 실용 정보, 생활 정보, 업무 효율, 생산성, 자기계발, 시험, 진로, 커리어, 창업, 경제, 재테크, 소비, 노후 설계, 정치, 사회 이슈, 시사, 건강, 운동, 식습관, 여가, 취미, 여행, 스트레스 해소, 멘탈 관리, 관계, 가정, 자녀, 연애, 소통, 자기 성찰, 라이프스타일

- **영상 길이(duration)**: 15s, 30s, 45s, 1m(60s), 30m(1800s), 1h(3600s), 2h(7200s)

- **톤(tones)**:  
  담백, 신뢰, 차분, 유머, 경쾌, 진지, 따뜻, 공감, 감성, 중립, 풍자, 설득, 전문, 친근, 위로, 동기부여, 논리, 정보, 스토리

- **스타일(styles)**:  
  실사, 만화, 애니메이션, 일러스트, 모션그래픽, 인포그래픽, 슬라이드형, 스케치, 미니멀, 심플, 레트로, 시네마틱

- **추가 항목(banned)**: 자유 입력(추가 설명/제약) — 이름과 달리 “강제 규칙”으로 사용.
- **영상 비율(aspectRatio)**: 16:9, 9:16, 1:1 등 비율 버튼 값.

## 2. Common Prompt 구성 흐름 (핵심 규칙)
1) **scenario.html / scenario.js**  
   - payload에 topic, purposeCategory, purposeTags, target, needs, duration, tones/tone, styles/style, aspectRatio, banned을 저장.  
   - 톤/스타일 태그는 다중 선택 → 배열(`tones`, `styles`)과 쉼표 문자열(`tone`, `style`)을 함께 보관.  
   - 시청 타겟은 단일 선택(`target`)만 사용한다.
2) **pipeline.js에서 Common Prompt 조립**  
   - selections: Topic / Genre·Purpose / Tags / Audience / Needs / AspectRatio / TargetDuration.  
   - Narrative & Tone Rules  
     - 자유입력 tone이 있으면 그대로 사용.  
     - 없으면 tone 태그를 문장으로 생성해 삽입.  
   - Visual Style Rules  
     - 자유입력 style이 있으면 그대로 사용.  
     - 없으면 style 태그를 문장으로 생성해 삽입.  
   - Constraint (Mandatory Directives)  
     - 다음 조건은 반드시 지켜야 하며, 해석이나 완화 없이 그대로 반영한다:  
       `[추가 항목 원문]`  
     - banned라는 이름과 달리 포함/제외 모두 가능한 “강제 규칙”임을 명시.  
   - 프롬프트 기본 뼈대:
     ```
     Global
     <프로젝트 헤더>
     <selections>
     Narrative & Tone Rules
     <tone 자유입력 또는 tone 태그 문장>
     Visual Style Rules
     <style 자유입력 또는 style 태그 문장>
     Mandatory Directives
     다음 지침은 모든 씬에서 반드시 반영한다:
     <추가 항목 원문>
     Scene Visual
     <scene.shot>
     Scene Duration
     <estSec>s
     ```
   - 사용자가 씬별 promptText를 직접 적으면 그대로 사용, 없으면 위 구조를 사용.
3) **NK.api.videoStart → functions/api/video/video.ts**  
   - payload: projectId, sceneId, promptText, script, aspectRatio, durationSeconds, imageDataUrl.  
   - promptText를 그대로 Vertex(Veo)에 전달, 생성된 mp4는 `nkstudio-video-out/projects/{projectId}/video/`에 저장하고 signed URL(playbackUrl)로 반환.

## 3. 디버그 포인트
- pipeline.js: `console.log('videoStart payload', { promptText, ... })`로 최종 프롬프트 확인.  
- functions/api/video/video.ts: `video_request` 로그로 서버에 전달된 promptText 확인.  
- 결과가 기대와 다르면 selections·tone/style 문장화·Mandatory Directives가 모두 포함됐는지 확인.

## 4. 저장·재생 경로
- payload와 씬 정보는 localStorage + 프로젝트 저장 API로 보관.  
- 영상 결과는 `nkstudio-video-out/projects/{projectId}/video/`에 mp4로 저장, playbackUrl로 재생.

## 5. 태그 선택 규칙
- 톤, 스타일 태그는 다중 선택 가능.  
- 시청 타겟은 태그 없이 드롭다운 단일 선택만 사용한다.  
- 선택된 배열을 `tones`/`styles`에 저장하고, 표시·호환을 위해 쉼표 문자열을 `tone`/`style`에도 기록한다.

## 6. 자유입력 우선 규칙 (Override Rule)
- 원칙  
  - 자유입력 값이 존재하면: 그 값을 우선 사용하고, 태그는 보조 설명으로만 덧붙인다.  
  - 자유입력이 공란이면: 선택한 태그를 문장화하여 사용한다.  
- 적용 범위  
  - topic  
  - tone (자유입력 / tone 태그)  
  - style (자유입력 / style 태그)

## 7. 추가 항목(banned) 역할 재정의 = Constraint Directives
- 이름은 banned이지만 “강제 규칙 묶음”으로 사용한다.  
- 포함되는 의미: 반드시 포함해야 할 요소, 반드시 피해야 할 요소, 특히 강조해야 할 방향성.  
- 해석·의역하지 않고 원문을 그대로 규칙으로 반영한다.

## 8. 추가 항목 처리 규칙 (명시화)
- 입력 해석: 사용자가 쓴 문장을 요약·분해·의역하지 않는다.  
- 승격: 입력 전체를 “반드시 지켜야 할 조건”으로 승격한다.  
- Common Prompt 반영 위치(고정):
  ```
  Mandatory Directives
  다음 지침은 모든 씬에서 반드시 반영한다:
  [추가 항목 원문 그대로]
  ```
  (예: “어린이용 귀여운 표현 금지”, “다큐멘터리 톤 유지, 과장 연출 배제”, “실제 과학적 설명처럼 보이도록” 등은 그대로 삽입)

## 9. Scene Visual Prompt 적용 시 주의
- Scene Visual(shot) 작성 시 추가 항목을 다시 적지 않는다.  
- 톤·스타일 지시도 반복하지 않는다.  
- 연출 묘사는 Mandatory Directives를 위반하지 않도록만 주의해서 작성한다.  
- 위반 여부 판단은 Common Prompt 단계의 Mandatory Directives가 통제한다.
