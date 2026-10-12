# 컨펌 후 후처리 (로컬 GPU 환경)

사용자가 **명시적으로 컨펌한 영상에만** 적용한다. 검토 중이거나 반려된 영상에는 하지 않는다. 원본 오디오는 바꾸지 않는다(스트림 복사).

## 1. 30fps 납품본: RIFE 보간

FFmpeg `minterpolate`는 빠른 움직임(공 튐, 다이브)에서 이중상과 얼굴 뭉개짐을 만든다. 쓰지 않는다. 단순 프레임 복제나 fps 태그 변경을 보간이라고 부르지 않는다.

도구: REAL-Video-Enhancer 백엔드 + `rife4.25.pkl` (예: `D:\Programs\REAL-Video-Enhancer`).

1. **정수 배율**로 24 → 120fps 보간한다(`--interpolate_factor 5`, `--scene_detect_method mean`, 중간본 `ffv1` 무손실).
   - 비정수 배율(1.25)을 주면 2배로 올린 뒤 30fps 태그만 붙어서 영상이 느려진다(4초 → 6.4초).
2. FFmpeg 후처리: `scale=in_color_matrix=bt601:out_color_matrix=bt709,select='not(mod(n\,4))',setpts=N/30/TB`, `-frames:v ceil(원본프레임×5/4)`.
   - 원본 파일의 오디오는 `-c:a copy`로 매핑한다.
   - HEVC 4:4:4 10bit crf12로 저장한 뒤 `hevc_metadata`로 bt709 태그를 붙인다.
3. 검수 항목: 프레임 수(원본 × 1.25), 길이(±0.01초), 오디오 해시 동일 여부, 원본 대비 평균 색 차이(1단계 미만), 빠른 동작 구간 확대.

## 2. 4K 업스케일

- 모델: `realesr-general-x4v3`에 `--override_upscale_scale 2`를 주면 1920×1080 → 3840×2160이 바로 나온다(8K 중간 단계·축소 없음).
- 비교 결과: 속눈썹·니트 결·명함 글자에서 lanczos·Nomos8k보다 선명했다.
- 순서: 무손실 FFV1 중간본 → bt601→bt709 보정 → HEVC 4:4:4 10bit crf14, 원본 오디오 복사, bt709 태그.
- 업스케일본을 다시 AI 생성 입력으로 쓸 때는 세대가 하나 늘어난다는 점을 기록한다(rules B2).

## 3. 정리

- 컨펌 위치에는 컷별 최종본 1개만 둔다. 같은 컷의 다른 해상도·fps 버전은 제작 위치로 옮긴다(삭제가 아님).
- 미리보기 mp4·480p 시안 정리는 사용자 승인 후 휴지통으로 보낸다(영구 삭제 아님). 파일 수와 용량을 보고한다.
