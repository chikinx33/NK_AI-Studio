# 모션 키트 사용 설명서 (감독용)

영상 한 편 = HTML 한 장. 이 장을 헤드리스 크롬이 1초에 240장 찍고 4장씩 섞어 60fps 모션블러 영상을 만든다.
배경음악 박자에 효과음을 얹고 -14 LUFS로 맞춘다. 시즌1 홍보 영상 18편이 이 방식으로 만들어졌다(아래 실례 2편).

## 1. 페이지 계약 (어기면 렌더 실패)
- `<html lang="ko" data-size="1080x1920">` — 무대 크기. 9:16은 `1080x1920`, 16:9는 `1920x1080`, 1:1은 `1080x1080`.
- `<head>`에 키트 CSS 2개(받은 경로 그대로): `fontsCss`, `baseCss`. 그리고 `<style>` 안에 `:root` 테마 변수(3절)와 이 편만의 CSS.
- `<body>` 안에 `<div id="stage">` 하나. 그 안에 모든 요소. 맨 위에 보통 `<div id="cam">…</div>`(카메라로 함께 움직일 층), 그 위에 자막 `<div id="heads"></div>`, `<div class="vignette"></div><div class="grain" id="grain"></div>`.
- 스크립트 순서: 키트 `motion.js` → 배경음악이 있으면 `assets/beats.js`(전역 `B` = 박자 시각 배열) → 이 편의 `<script>`.
- 이 편 스크립트는 반드시:
  - `async function seek(t) { … }` — t초의 화면을 **t만으로** 계산해 그린다. 이전 프레임 상태를 쓰지 않는다.
  - 마지막 줄 `window.READY = M.ready({ images: [미리 읽을 그림 경로…] }).then(() => { seek(0); return DUR; });` — DUR = 영상 길이(초).
- 금지: `setTimeout`/`setInterval`/`requestAnimationFrame`, CSS `transition`/`animation`, `Math.random()`(필요하면 인덱스로 만든 고정 값), `Date`, 외부 주소(인터넷은 막혀 있다). 받은 자산·키트 파일만 상대 경로로 쓴다.
- 영상(클립)은 소리가 없다. 소리는 전부 효과음 큐(6절)로 넣는다.

## 2. 함수 (`const { $, put, hide, sp, pop, io, ein, eout, lerp, tx, clamp } = M;`)
| 함수 | 뜻 |
|---|---|
| `M.W`, `M.H` | 무대 너비·높이(px) |
| `$(id)` | `document.getElementById` |
| `put(el, {x, y, s, sx, sy, r, a, show, w, h, f, z})` | 요소 중심을 (x,y)에 놓고 크기 s·회전 r(도)·투명도 a·filter f. 요소는 `class="a"`(절대 위치) |
| `hide(el)` | 숨김 |
| `sp(t, t0, f=2.4, z=0.72)` | t0부터 0→1 스프링(살짝 넘침). f 클수록 빠름, z 작을수록 튕김 |
| `pop(t, t0, f)` | 더 통통 튀는 스프링(등장용) |
| `io(t, t0, d)` / `ein` / `eout` | d초 동안 0→1 (부드럽게 / 가속 / 감속) |
| `M.hit(t, t0, amp, rate)` | t0에 맞은 뒤 0.6초간 줄어드는 충격(카메라 펀치·흔들림) |
| `lerp(a, b, p)`, `clamp(x, a, b)` | 보간, 자르기 |
| `M.beats(B)` → `b(i)` | i번째 박자 시각(초). 소수 가능(`b(2.5)`). 박자가 빠르면(150bpm 이상) `h = i => b(2*i)`처럼 두 박마다 |
| `tx({ko, en})` | 현재 언어 글 |
| `M.kinetic(container, lines, defY)` → `draw(t)` | **키네틱 자막**. lines = `[{s, e, step, y, ko, en}]`. `|`로 덩어리, `*강조*`는 강조색. s초부터 step초 간격으로 덩어리가 튀어나오고 e초에 위로 빠진다(e=null이면 유지) |
| `M.sticker(el, t, t0, t1, {x, y, r, s})` | **스티커**("쏙!", "+200", "2배!"): 기울어져 튀어나오고 흔들리다 t1에 빠짐. 요소 `class="a sticker"` |
| `M.keys(t, [[t, s, fx, fy], …])` | 키프레임 카메라: 시각별 확대 s와 초점(fx,fy) |
| `M.full(box, vw, vh)` / `M.fullAt(F, lt, cam, open)` | **실제 화면 꽉 채우기**: 클립(vw×vh)을 화면에 맞추고 뒤에 같은 클립을 흐리게. open 0→1이면 카드에서 전체 화면으로 열림. 반드시 `await` 할 promise를 돌려준다 |
| `M.clip(videoEl)` / `M.clipAt(c, lt)` | 클립을 카드 안 등에 그대로 쓸 때 |
| `M.flood(el, x, y, p, color)` | (x,y)에서 원이 화면을 덮는 전환. p 0→1 |
| `M.count(t, t0, d, from, to, decimals)` | 숫자 카운트(1,234 형식 문자열) |
| `M.grain(el, t)` | 필름 그레인(매 프레임 호출) |

클립 마크업: `<div class="full" id="clip-full"><video class="blurbg" data-src="assets/파일.mp4"></video><video class="fg" data-src="assets/파일.mp4"></video></div>`
(`data-src`이고 `src`가 아니다. seek 안에서 `wait = M.fullAt(...)` 후 함수 끝에서 `if (wait) await wait;`)

## 3. 테마 변수 (`:root`에 이 편 색·글꼴을 정한다)
`--bg`(배경) `--ink`(글자·진한 색) `--accent` `--accent2` `--shadow` `--frame-shadow`
`--font-head` `--font-body` `--head-size`(108~124px) `--head-weight` `--en-scale`(0.9~0.95)
키네틱 자막: `--k-color`(글자, 보통 #fff) `--k-stroke`(외곽선, 진한 색) `--k-hi`(강조색) `--k-size`(110~130px, 16:9는 90~110px) `--k-stroke-w`
스티커: `--s-color`. 질감: `--grain`(.04~.08) `--vig`(.15~.3)
글꼴(font-family 이름 — 주제에 맞게 제목용 하나 + 본문용 하나):
- 깔끔·정보: `Pretendard`(45~920, 요즘 가장 세련된 고딕), `SUIT`(100~900), `"NK Sans"`(100~900)
- 강렬한 제목: `"Black Han Sans"`(아주 굵음), `"Do Hyeon"`(굵고 단단), `"Nanum Gothic ExtraBold"`
- 귀여움·친근: `Jua`, `Dongle`(700), `"Gowun Dodum"`(부드러운 고딕)
- 격식·감성·역사: `"NK Serif"`(200~900), `"Gowun Batang"`(400·700, 부드러운 명조)
- 손글씨: `"Nanum Pen Script"`, `Gaegu`(700), `"Hi Melody"`, `Nalgae`, `"KOTRA Hope"`
브랜드가 있으면 로고·캐릭터 그림의 색에서 팔레트를 뽑는다.

## 3.5 키트 자산 (경로는 받은 KIT 경로 기준)
- **아이콘(Lucide, 선 아이콘 2,171개)**: `KIT/icons/lucide/<이름>.svg` — 이름은 lucide.dev 이름(book-open, users, heart, trending-up, shield-check, clock, smartphone, bed, moon, sun, sparkles, map-pin, calendar, gift, rocket, lightbulb, chart-column, chart-pie, circle-check, triangle-alert 등).
  색을 입히려면 `<div class="ico" style="background:#FFD166;-webkit-mask:url(KIT/icons/lucide/heart.svg) center/contain no-repeat"></div>` 처럼 마스크로 쓴다(`<img>`는 검은 선).
- **3D 이모지(Fluent, 1,595개)**: `KIT/emoji/<영문 이름 밑줄>.png` (256px 투명 PNG). 예: open_book, rocket, light_bulb, money_bag, trophy, mobile_phone, seedling, thumbs_up, red_heart, sparkles, fire, star, check_mark_button, cross_mark, warning, alarm_clock, calendar, bar_chart, chart_increasing, chart_decreasing, gem_stone, wrapped_gift, party_popper, house, school, hospital, books, graduation_cap, man_technologist, people_hugging, smiling_face_with_smiling_eyes, thinking_face, sleeping_face, crying_face, globe_showing_asia_australia, sun, cloud, umbrella, christmas_tree, cat_face, dog_face. 쇼츠에서 아주 잘 먹히니 크게, 통통 튀게(`pop`), 살짝 흔들며 쓴다. 이름이 조금 틀리면 가장 가까운 것으로 바뀐다. 단, 납작한 실루엣·도형 스타일로 정한 편에는 쓰지 않는다(5.5절 2번).
- **라이브러리** (`<script src="KIT/vendor/…">`, 필요한 것만):
  - `d3.min.js` — 도표 모양 계산만(`d3.arc`, `d3.scaleLinear`, `d3.line`, `d3.pie`). `d3.transition`·타이머는 쓰지 않는다. 진행도는 `io/sp`로.
  - `flubber.min.js` — 도형 변형: `const f = flubber.interpolate(pathA, pathB); path.setAttribute('d', f(p))`.
  - `rough.js` — 손그림 느낌: `rough.svg(svgEl).rectangle(x,y,w,h,{ seed: 7, roughness: 2, fillStyle:'hachure' })`. **seed 를 꼭 고정**(안 그러면 프레임마다 흔들림). 매 프레임 새로 만들지 말고 한 번 만들어 두고 크기·투명도만 바꾼다.
  - `anime.umd.min.js`(v4) — 복잡한 연속 동작: `const tl = anime.createTimeline({ autoplay: false }).add(el, { translateX: [0, 300], duration: 800, ease: 'outBack' })` 를 만들고 seek(t)에서 `tl.seek(밀리초)`. **autoplay:false 필수**.
  - `gl-transitions.js` + `KIT/lib/gl-transition.js` — 그림·영상 프레임 사이 화면 전환 123종(CrossZoom, Dreamy, GlitchMemories, Swirl, CircleCrop, Directional, ripple, cube, Pixelize 등): `const tr = M.glTransition(canvasEl, 'CrossZoom'); tr.draw(fromImg, toImg, p)`. DOM 장면끼리가 아니라 **그림/영상끼리** 전환할 때.

## 4. 2026 쇼츠 문법 (시즌1이 좋아 보인 이유)
1. **이 영상만의 장면을 만든다.** 제목-본문-카드 반복 슬라이드 금지. 내용을 사물·인물·숫자의 **움직임**으로 보여 준다(로봇이 상자를 밀고 고양이가 쏙 들어간다, 곡괭이로 지뢰를 치자 땅이 내 색으로 번진다).
2. **첫 1~2초 갈고리**: 바로 움직임과 큰 자막. 로고·제목 카드로 시작하지 않는다.
3. **박자**: 등장·전환·자막 덩어리·스티커·효과음을 모두 `b(i)`에 맞춘다. 장면 길이는 박자 수로 정하고 균등하게 나누지 않는다(짧은 것, 긴 것, 멈춤).
4. **키네틱 자막**: 한 줄 2~4덩어리, 핵심 낱말 하나만 `*강조*`. 화면에 글은 한 번에 한 줄만.
5. **카메라**: 천천히 밀기 + 결정적 순간 펀치(`M.hit`)·흔들림, 핵심 쪽으로 확대(`M.keys`).
6. **스티커·효과**: 사건마다 짧은 외침 스티커, 등장 `pop`, 충격엔 플래시.
7. **실제 자산이 주인공**: 받은 로고·캐릭터·그림·클립을 크게, 여러 번, 움직이며 쓴다. 실제 클립이 있으면 4~6초 `M.full`로 꽉 채우고 카메라로 핵심 순간 확대.
8. **끝 카드**: `M.flood`로 배경색이 덮이고 → 로고(있으면) 통통 → 이름 외치기(키네틱 자막) → 알약(`class="a pill"`, 행동 유도 한 줄). 2.5~3.5초.
9. **질감**: `.vignette` + `.grain`(매 프레임 `M.grain`).

### 인포그래픽 조리법 (숫자·비교를 움직임으로)
- 큰 숫자: `el.textContent = M.count(t, b(4), 0.9, 0, 72) + '%'` + 박자마다 `tick`, 끝에 `ding`.
- 막대: 각 막대 높이 `h * sp(t, b(i0) + k*0.12, 2.2, 0.75)`, 막대 끝에 값 라벨, 가장 큰 막대에 스티커.
- 도넛·게이지: SVG `<circle stroke-dasharray>`의 `stroke-dashoffset`을 `io(...)`로. 가운데 `M.count`.
- 비교(전/후, A/B): 화면을 둘로 가르고 한쪽이 밀어내기, 승자 쪽 펀치.
- 순서(1→2→3): 아이콘·카드가 레일을 따라 박자마다 하나씩 `pop`, 카메라가 따라감.
- 사물·개념은 **3D 이모지**(주인공·스티커처럼 크게)와 **Lucide 아이콘**(정보·목록·버튼처럼 작게)으로 보여 준다. 받은 그림(브랜드·업무 파일)이 있으면 그 그림이 먼저다. 실루엣·도형 스타일 편은 3D 이모지 대신 직접 그린 SVG(5.5절 2번).
- 도넛·원그래프는 `d3.arc`, 막대·꺾은선은 `d3.scaleLinear`+`d3.line`, 모양이 바뀌는 순간은 `flubber`.
- **확인되지 않은 수치는 만들지 않는다.** 요청·콘티에 있는 숫자만 쓴다. 없으면 숫자 대신 행동·변화를 보여 준다.

## 5. 화면 배치
- 9:16(1080x1920) 쇼츠 가림 영역: 위 0~220px, 아래 1500px 이하(1920-420), 오른쪽 930px 이후의 y 1000~1600(버튼). 자막·중요한 것은 이 밖에.
  자막 기본 높이 1400~1500(`defY`), 실제 화면 위에서는 330 또는 1430~1500.
- 16:9(1920x1080): 자막 y 860~940, 좌우 여백 120px. 1:1(1080x1080): 자막 y 860~920.
- 글자는 크게(자막 110px 안팎, 16:9는 90px 안팎). 작은 설명 글 금지. 한 화면 요소 2~4개.
- 언어: 모든 화면 글을 `tx({ko, en})` 또는 kinetic의 `ko/en`으로 둘 다 쓴다(영어판도 렌더할 수 있게).

## 5.5 품질 점검표 (다 쓴 뒤 스스로 확인한다 — 검수 단계도 이 표로 본다)
시즌1 실례는 모두 9:16 세로다. 16:9·1:1은 아래를 특히 지킨다.
1. **화면을 채운다.** 주인공 요소는 화면 높이의 40~60%(16:9면 높이 430~650px). 넓은 배경 가운데에 작은 물건 하나만 두는 장면은 실패다.
   - 세 층으로 짠다: 뒤층(큰 숫자·지도·무늬·도형이 화면 끝까지), 가운데층(주인공), 앞층(화면 밖으로 살짝 잘리는 큰 사물·흐린 전경).
   - 16:9는 삼분할: 주인공을 왼쪽이나 오른쪽 1/3 선에 두고 반대편에 숫자·사물·두 번째 인물. 가운데 한 점 구도는 끝 카드에만.
   - 빈 배경이 화면의 절반을 넘으면 카메라를 밀어 넣거나(`M.keys` 확대) 요소를 키운다.
2. **그림 스타일은 한 편에 하나.** 처음에 정하고 끝까지 지킨다.
   - (가) 3D 이모지 중심 — 사람·사물 모두 이모지. 납작한 실루엣 사람을 섞지 않는다.
   - (나) 납작한 실루엣·도형(SVG로 직접 그림) + Lucide 선 아이콘 — 3D 이모지를 쓰지 않는다(사물도 SVG·아이콘으로).
   - (다) 받은 그림 중심 — 받은 그림의 결(실사·일러스트·픽셀)에 맞춰 이모지·아이콘을 고른다.
   - 글자 스티커(“쏙!”, “풍자!”)는 어느 스타일에서나 쓴다.
3. **전환은 이어 붙인다.** 장면이 바뀔 때 화면이 비거나 검게 되는 순간(0.15초 이상)을 만들지 않는다.
   - 다음 장면이 이전 장면을 덮거나 밀어내고(`M.flood`, 밀기), 같은 모양으로 넘어가거나(모자 → 모자, 원 → 지구), 카메라가 다음 요소로 옮겨 간다. 두 장면이 0.2~0.4초 겹치게 둔다.
   - 검게 닫는 아이리스·암전은 끝 카드에만.
   - 자막도 다음 줄이 들어오기 직전까지 이전 줄을 남겨 둔다(자막 없는 빈 구간을 만들지 않는다. 끝 카드는 예외).

## 6. 소리 큐 (두 번째 블록, JSON)
```json
{ "bgm": { "track": "기본 음악 id(요청 메시지가 고르라고 할 때만)", "volume": 0.55 }, "cues": [[박자번호 또는 "s초", "tag:용도" 또는 "파일", 음량0~1.2], …] }
```
- 배경음악은 렌더러가 넣는다(처음부터, 끝 0.9초 페이드). 요청 메시지의 "음악" 항목을 따른다:
  - 받은 음악이 있으면 그 곡(박자 스크립트 `assets/beats.js`).
  - "기본 음악에서 고른다"이면 목록에서 영상 분위기에 맞는 곡 하나를 골라 `"bgm": {"track": "<id>"}`로 쓰고, 페이지에 `<script src="KIT/music/<id>.beats.js"></script>`를 넣어 그 곡의 박자(B)를 쓴다.
  - 음악 없음이면 `"bgm": null`이고 박자 대신 초("s1.25")를 쓴다.
- 효과음은 **용도 태그**로 고른다: `"tag:whoosh"`, `"tag:pop"`, `"tag:coin"` … (태그 목록 참고). 렌더러가 그 용도의 소리 중 하나를 골라 넣고, 영상마다 다른 소리가 나온다. 받은 소리 자산은 `"assets/…"`.
- 효과음은 타격 지점이 박자에 오도록 렌더러가 당겨 준다. 박자 번호를 그대로 쓰면 된다.
- 한 편에 10~20개. 등장(pop/swish/open), 전환(whoosh), 충격(impact/thump), 숫자(tick·coin 여러 번 + ding), 성장(power-up), 실수(error), 끝(jingle/fanfare).

## 7. 출력 형식
설명 없이 아래 두 블록만:
1. ` ```html ` … 완전한 HTML … ` ``` `
2. ` ```json ` … 소리 큐 … ` ``` `
