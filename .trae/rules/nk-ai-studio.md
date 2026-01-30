* 개발 작업을 마친 후 사이드 바 하단의 버전을 업데이트하세요.
* 수정/개선/보완 작업 진행 한 후 문제 발생 원인도 알려주세요.
* 모든 설명은 사용자 관점에서 알기 쉽게 설명해주세요.
* 프로젝트 저장 규칙

- 대상 범위: 씬 페이지에서 생성·업로드되는 모든 데이터
- 저장 경로: basePrefix/projects/{projectId}/{folder}/ 표준 경로 사용
- 폴더 구분: image, video, bgm, sfx, caption, reference
- 결정 기준: 현재 파이프라인의 draftId(= 선택된 프로젝트 id)를 projectId로 사용
- 일관성: 이미지 생성, 영상 생성, 파일 업로드, 라이브러리 조회 모두 동일 경로 규칙 준수

왜 필요한가

- 프로젝트별 자산을 분리해 관리·삭제·조회가 명확해집니다
- 대시보드에서 특정 프로젝트 선택 후 씬 작업을 해도, 다른 프로젝트 폴더로 저장되는 오류를 방지합니다

현재 구현 상태 요약

- 폴더 초기화: 프로젝트 생성 시 image/video/sfx/bgm/caption/reference 폴더에 .keep 생성
- 이미지 생성: projects/{projectId}/image/에 저장
- 영상 생성: projects/{projectId}/videos/{sceneId}/{jobId}/에 저장
- 업로드(이미지/영상): projects/{projectId}/{해당 폴더}/에 저장
- 라이브러리 조회: projects/{projectId}/{해당 폴더}/ prefix로 목록 조회
- 씬 진입 시 draftId 동기화: 대시보드의 “영상 생성” 버튼을 통해 기존 파이프라인에 새 프로젝트 id를 반영해 저장 폴더가 항상 현재 프로젝트로 유지