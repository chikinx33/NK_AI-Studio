# 모션 키트 (HTML 한 장 = 영상 한 편)

원본: `F:\NKW\App\Game-Management\promo\_motion` (시즌1 홍보 영상 18편을 만든 키트). `lib/`는 원본을 그대로 복사했다.

## 원리
- 영상 한 편은 1080x1920 HTML 한 장이다. 모든 움직임은 `async function seek(t)` 안에서 시간만으로 계산한다(타이머·CSS 전환 금지).
- 페이지는 `window.READY = M.ready({...}).then(() => DUR)`로 길이(초)를 알린다.
- `scripts/render-motion-page.mjs`가 이 PC의 크롬을 헤드리스로 띄워 1초에 240장을 찍고, 4장씩 섞어 60fps 모션블러를 만들고, 배경음악·효과음을 박자에 얹어 -14 LUFS로 맞춘다.

## 렌더
```
node scripts/render-motion-page.mjs <page.html> <out.mp4> [--lang ko] [--episode episode.json] [--audio-dir <폴더>] [--allow-root <폴더>] [--workers 3]
```
- `--episode`: `{ bgm: {file, start, volume}, beats, cues: [[박자 번호 또는 "s초", 파일, 음량], ...] }` (원본 키트와 같은 형식)
- `--audio-dir`: 음악·효과음 파일 이름을 찾을 폴더(절대 경로·페이지 폴더 다음 순서)
- `--allow-root`: 페이지가 읽을 수 있는 폴더. 이 밖의 파일과 모든 인터넷 요청은 막는다(기본은 페이지 폴더)
- 크롬·ffmpeg 위치는 `MOTION_CHROME`, `MOTION_FFMPEG` 환경 변수로 바꿀 수 있다. ffmpeg는 `tmix`·`loudnorm`이 있는 전체 빌드가 필요하다(Remotion에 딸린 ffmpeg는 안 됨)
- 렌더는 낮은 우선순위로 돈다. 동시에 여러 편을 돌리지 않는다(2026-10-21 렌더 3개 동시 실행으로 PC 다운)
