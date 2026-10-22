# 모션 키트 사용 설명서 (감독용)

영상 한 편 = HTML 한 장. 이 장을 헤드리스 크롬이 1초에 240장 찍고 4장씩 섞어 60fps 모션블러 영상을 만든다.
배경음악 박자에 효과음을 얹고 -14 LUFS로 맞춘다. 시즌1 홍보 영상 18편이 이 방식으로 만들어졌다(아래 실례 1·2 = 트랙 A, 실례 3 = 트랙 B).

## 1. 페이지 계약 (어기면 렌더 실패)
- `<html lang="ko" data-size="1080x1920">` — 무대 크기. 9:16은 `1080x1920`, 16:9는 `1920x1080`, 1:1은 `1080x1080`.
- `<head>`에 키트 CSS 2개(받은 경로 그대로): `fontsCss`, `baseCss`. 그리고 `<style>` 안에 `:root` 테마 변수(3절)와 이 편만의 CSS.
- `<body>` 안에 `<div id="stage">` 하나. 그 안에 모든 요소. 맨 위에 보통 `<div id="cam">…</div>`(카메라로 함께 움직일 층), 그 위에 자막 `<div id="heads"></div>`, `<div class="vignette"></div><div class="grain" id="grain"></div>`.
- 스크립트 순서: 키트 `motion.js` → 배경음악이 있으면 `assets/beats.js`(전역 `B` = 박자 시각 배열) → 이 편의 `<script>`.
- 이 편 스크립트는 반드시:
  - `async function seek(t) { … }` — t초의 화면을 **t만으로** 계산해 그린다. 이전 프레임 상태를 쓰지 않는다.
  - 마지막 줄 `window.READY = M.ready({ images: [미리 읽을 그림 경로…] }).then(() => { seek(0); return DUR; });` — DUR = 영상 길이(초).
- 금지: `setTimeout`/`setInterval`/`requestAnimationFrame`, CSS `transition`/`animation`, `Math.random()`(대신 `M.rng(시드)`·`M.hash(i)`), `Date`, 외부 주소(인터넷은 막혀 있다). 받은 자산·키트 파일만 상대 경로로 쓴다.
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

## 2.5 생성형 그래픽 도구 (입자·노이즈·하프톤·물리 — 시드 고정이라 어느 렌더 작업자에서 찍어도 같은 화면)
| 함수 | 뜻 |
|---|---|
| `M.rng(seed)` → `R()` | 0~1 난수 흐름. 씨앗 배열은 seek 밖에서 한 번만 만든다: `const R = M.rng(7); const P = Array.from({length: 2000}, () => ({ x: R(), y: R(), s: R() }))` |
| `M.hash(i, j, k)` | 정수 번호의 고정 0~1 값(타일 (열,행)·입자 i마다 다른 값) |
| `M.noise(x, y, z)` / `M.fbm(x, y, z, 겹수)` | 부드러운 3D 노이즈 -1~1. 움직이려면 z = t*속도. 흐름·일렁임·지형 |
| `M.tw(t, t0, d, ease)` | d초 동안 0→1, 이름 있는 곡선: `'outExpo'`(기본, 빠른 출발·긴 감속) `'inExpo'` `'inOutExpo'` `'outQuint'` `'inOutQuint'` `'inOutSine'` `'linear'` |
| `M.canvas(canvasEl)` → `ctx` | `<canvas class="layer" id="fx">`를 무대 크기 2D 캔버스로. seek(t)마다 `ctx.clearRect(0,0,M.W,M.H)` 후 처음부터 그린다 |
| `M.halftone(ctx, (x,y)=>0~1, {cell, color, x0, y0, w, h, square, max})` | 하프톤 점(구·파문·그러데이션을 점 크기로). 격자 기준 x0·y0는 고정 값으로(움직이면 점이 미끄러진다) |
| `M.bake({dur, fps, init, step, snap})` → `sim(t)` | 앞 상태가 필요한 움직임(낙하·충돌·튕김·흐름 꼬리)을 READY 전에 고정 간격으로 끝까지 미리 계산. seek(t)는 `sim(t)`(숫자 배열)만 읽는다. 화면 끝에서 반대편으로 넘어가는 값은 snap에 넣지 않는다(보간이 화면을 가로지른다) |
| `M.chars(el, {ko, en})` → `[span…]` | 글자 하나하나를 `<span class="ch">`로. 계단식 등장·외곽선 잔상·글자별 회전 |

- 고정폭 라벨: `class="mono"`(글꼴 `var(--font-mono)`, 크기 `--mono-size` 18~22px, 대문자·자간). 장면 번호·타임코드·눈금·FIG. 표기.
- 그리는 양: 한 프레임에 점·입자 2만 개 이하, 캔버스 1~2장. 1초에 240장을 찍으므로 프레임마다 DOM 요소를 새로 만들지 않는다(만들어 두고 위치만 바꾼다). WebGL·three.js는 쓰지 않는다(렌더러에 GPU가 없다).
- 입자 흐름 예: 흩어진 위치 `sx = p.x*W + M.noise(p.x*3, p.y*3, t*.25)*170` → 모일 위치(원·글자·도형) `ox` 사이를 `M.tw`로 보간, 입자마다 `p.s`로 도착 시각을 조금씩 어긋나게.

## 3. 테마 변수 (`:root`에 이 편 색·글꼴을 정한다)
`--bg`(배경) `--ink`(글자·진한 색) `--accent` `--accent2` `--shadow` `--frame-shadow`
`--font-head` `--font-body` `--head-size`(108~124px) `--head-weight` `--en-scale`(0.9~0.95)
키네틱 자막: `--k-color`(글자, 보통 #fff) `--k-stroke`(외곽선, 진한 색) `--k-hi`(강조색) `--k-size`(110~130px, 16:9는 90~110px) `--k-stroke-w`
스티커: `--s-color`. 질감: `--grain`(.04~.08) `--vig`(.15~.3). 고정폭 라벨: `--font-mono`(키트 기본값 그대로) `--mono-size`
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

## 4. 연출 트랙 — 한 편에 하나만
요청 메시지의 "연출 트랙"을 따른다. "자동"이면 직접 고른다:
- **트랙 A 쇼츠 팝**: 어린이·게임·생활 정보·SNS 바이럴, 밝고 경쾌한 요청, 3D 이모지·캐릭터가 주인공인 편.
- **트랙 B 에디토리얼 모션**: 브랜드·서비스·제품 소개, 기술·디자인·금융·교양 정보, "고급스럽게·세련되게·미니멀" 요청, 채널 범퍼·로고 인트로.
- 레퍼런스 영상(5.6절)을 받았으면 그 결에 더 가까운 트랙.
고른 트랙은 장면 코드 `<head>` 맨 위에 `<!-- track: pop -->` 또는 `<!-- track: editorial -->`로 적는다. 두 트랙을 섞지 않는다.

### 두 트랙 공통
1. **이 영상만의 장면을 만든다.** 제목-본문-카드 반복 슬라이드 금지. 내용을 사물·인물·숫자·도형의 **움직임**으로 보여 준다(로봇이 상자를 밀고 고양이가 쏙 들어간다, 곡괭이로 지뢰를 치자 땅이 내 색으로 번진다, 흩어진 점이 한 궤도로 모인다).
2. **첫 1~2초 갈고리**: 바로 움직임. 로고·제목 카드로 시작하지 않는다.
3. **박자**: 등장·전환·글자·효과음을 모두 `b(i)`에 맞춘다. 장면 길이는 박자 수로 정하고 균등하게 나누지 않는다(짧은 것, 긴 것, 멈춤).
4. **실제 자산이 주인공**: 받은 로고·캐릭터·그림·클립을 크게, 여러 번, 움직이며 쓴다. 실제 클립이 있으면 4~6초 `M.full`로 꽉 채우고 카메라로 핵심 순간 확대.

### 트랙 A — 쇼츠 팝 (시즌1 문법, 실례 1·2)
1. **키네틱 자막**: 한 줄 2~4덩어리, 핵심 낱말 하나만 `*강조*`. 화면에 글은 한 번에 한 줄만.
2. **카메라**: 천천히 밀기 + 결정적 순간 펀치(`M.hit`)·흔들림, 핵심 쪽으로 확대(`M.keys`).
3. **스티커·효과**: 사건마다 짧은 외침 스티커, 등장 `pop`, 충격엔 플래시.
4. **끝 카드**: `M.flood`로 배경색이 덮이고 → 로고(있으면) 통통 → 이름 외치기(키네틱 자막) → 알약(`class="a pill"`, 행동 유도 한 줄). 2.5~3.5초.
5. **질감**: `.vignette` + `.grain`(매 프레임 `M.grain`).

### 트랙 B — 에디토리얼 모션 (실례 3 ORBIT)
1. **모티프 하나가 처음부터 끝까지 이어진다.** 점·선·종이 한 장·격자 중 하나를 정하고, 장면 전환은 그 모티프의 변신이다(점 → 물방울 파문 → 입자 궤도의 중심 → 하프톤 행성 → 빈 칸 → 로고의 마침표). 장면마다 새 물건을 꺼내지 않는다.
2. **색은 2~3개.** 바탕(먹색 또는 종이색) + 잉크 + 강조색 하나. 강조색은 화면의 15% 이하, 모티프와 결정적 순간에만. 그러데이션·그림자·외곽선 자막·자막 상자 없음. 바탕과 잉크를 뒤집는 반전(먹 → 종이)은 한 편에 한두 번.
3. **타이포가 주인공.** 큰 낱말 하나(16:9 160~300px, 9:16 140~220px, 굵기 800~920, 자간 -3~-7%)를 `M.chars`로 글자 단위로 솟게(stagger .03~.06초). 외곽선 잔상 2~3겹을 한 박 늦게 겹치기, 마스크 밖에서 밀려 들어오기, 흩어졌다 모이기. 문장형 자막·키네틱 외곽선 자막·스티커는 쓰지 않는다.
4. **HUD·그리드 질감.** 네 귀퉁이와 가장자리에 고정폭 라벨(`class="mono"`): 작품 이름·연도, 타임코드, 장면 번호(`02 / ORBIT`), `FIG. 01 — …` 설명표, 눈금자·진행 표시. 정보가 아니라 화면의 질서다. 가장자리 여백 64~96px에 정렬하고 한 화면에 4~6개.
5. **생성형 그래픽으로 화면을 채운다**(2.5절): 입자 비·흐름·소용돌이·궤도, 하프톤 점 구·파문, 노이즈 흐름선, 타일 격자가 대각선 물결로 뒤집히기, 물리(떨어짐·튀어 오름) 미리 계산. 3D 이모지·캐릭터 스티커 대신 이것들이 화면 크기를 맡는다.
6. **움직임 곡선이 정확하다.** 튕김(`pop`·`sticker`·`M.hit` 흔들림) 없음. 빠르게 출발해 길게 감속하고 정확히 멈춘다(`M.tw` outExpo·inOutExpo). 등장 .5~.9초, 퇴장은 inExpo로 더 짧게.
7. **숫자·도표는 단정하게.** 큰 숫자 + 가는 구분선(2px) + 고정폭 설명표. 막대·선은 평평하고 가늘게(1.5~2px), 값은 점으로. 숫자는 글자 단위로 솟거나 카운트.
8. **끝 카드**: 모티프가 로고(또는 이름)로 수렴하고, 바탕이 한 번 뒤집히며(`M.flood` 종이색 번짐), 행동 유도는 고정폭 글자 테두리 알약 하나. 2.5~4초.
9. **소리**: 효과음은 적게(6~12개) — whoosh·swish·tick·glitch·impact-light·thump·shimmer·ding. 만화 소리(pop·coin·fanfare·reward)는 쓰지 않는다.
10. **질감**: `.grain`은 약하게(`--grain` .02~.04), `.vignette`는 쓰지 않거나 아주 약하게.

### 인포그래픽 조리법 (숫자·비교를 움직임으로)
- 큰 숫자: `el.textContent = M.count(t, b(4), 0.9, 0, 72) + '%'` + 박자마다 `tick`, 끝에 `ding`.
- 막대: 각 막대 높이 `h * sp(t, b(i0) + k*0.12, 2.2, 0.75)`(트랙 B는 `M.tw`), 막대 끝에 값 라벨, 가장 큰 막대에 스티커(트랙 A만).
- 도넛·게이지: SVG `<circle stroke-dasharray>`의 `stroke-dashoffset`을 `io(...)`로. 가운데 `M.count`.
- 비교(전/후, A/B): 화면을 둘로 가르고 한쪽이 밀어내기, 승자 쪽 펀치(트랙 B는 펀치 대신 바탕 반전).
- 순서(1→2→3): 아이콘·카드가 레일을 따라 박자마다 하나씩 `pop`, 카메라가 따라감(트랙 B는 점이 레일을 따라 이동하며 칸을 채움).
- 트랙 A의 사물·개념은 **3D 이모지**(주인공·스티커처럼 크게)와 **Lucide 아이콘**(정보·목록·버튼처럼 작게)으로 보여 준다. 받은 그림(브랜드·업무 파일)이 있으면 그 그림이 먼저다. 실루엣·도형 스타일 편은 3D 이모지 대신 직접 그린 SVG(5.5절 2번).
- 트랙 B의 사물·개념은 생성형 그래픽·도형·하프톤·가는 선 아이콘(Lucide)으로. 받은 로고·제품 화면은 그대로 크게 쓴다.
- 도넛·원그래프는 `d3.arc`, 막대·꺾은선은 `d3.scaleLinear`+`d3.line`, 모양이 바뀌는 순간은 `flubber`.
- **확인되지 않은 수치는 만들지 않는다.** 요청·콘티에 있는 숫자만 쓴다. 없으면 숫자 대신 행동·변화를 보여 준다.

## 5. 화면 배치
- 9:16(1080x1920) 쇼츠 가림 영역: 위 0~220px, 아래 1500px 이하(1920-420), 오른쪽 930px 이후의 y 1000~1600(버튼). 자막·중요한 것은 이 밖에(트랙 B의 HUD 라벨도).
  자막 기본 높이 1400~1500(`defY`), 실제 화면 위에서는 330 또는 1430~1500.
- 16:9(1920x1080): 자막 y 860~940, 좌우 여백 120px. 1:1(1080x1080): 자막 y 860~920.
- 트랙 A: 글자는 크게(자막 110px 안팎, 16:9는 90px 안팎). 작은 설명 글 금지. 한 화면 요소 2~4개.
- 트랙 B: 큰 낱말 하나 + 고정폭 라벨(18~22px, 가장자리·FIG. 표기)만 작게 허용. 문장형 설명 글은 여기서도 금지. 주인공 그래픽 하나 + 글자 한 덩어리.
- 언어: 모든 화면 글을 `tx({ko, en})` 또는 kinetic·`M.chars`의 `ko/en`으로 둘 다 쓴다(영어판도 렌더할 수 있게).

## 5.5 품질 점검표 (다 쓴 뒤 스스로 확인한다 — 검수 단계도 이 표로 본다)
시즌1 실례는 모두 9:16 세로다. 16:9·1:1은 아래를 특히 지킨다.
1. **화면을 채운다.** 주인공 요소는 화면 높이의 40~60%(16:9면 높이 430~650px). 넓은 배경 가운데에 작은 물건 하나만 두는 장면은 실패다.
   - 세 층으로 짠다: 뒤층(큰 숫자·지도·무늬·도형·입자장이 화면 끝까지), 가운데층(주인공), 앞층(화면 밖으로 살짝 잘리는 큰 사물·흐린 전경·HUD).
   - 16:9는 삼분할: 주인공을 왼쪽이나 오른쪽 1/3 선에 두고 반대편에 숫자·사물·두 번째 인물. 가운데 한 점 구도는 끝 카드에만(트랙 B는 모티프가 가운데서 시작하는 첫 장면도 된다).
   - 빈 배경이 화면의 절반을 넘으면 카메라를 밀어 넣거나(`M.keys` 확대) 요소를 키운다.
2. **그림 스타일은 한 편에 하나.** 처음에 정하고 끝까지 지킨다.
   - 트랙 A는 아래 셋 중 하나:
     - (가) 3D 이모지 중심 — 사람·사물 모두 이모지. 납작한 실루엣 사람을 섞지 않는다.
     - (나) 납작한 실루엣·도형(SVG로 직접 그림) + Lucide 선 아이콘 — 3D 이모지를 쓰지 않는다(사물도 SVG·아이콘으로).
     - (다) 받은 그림 중심 — 받은 그림의 결(실사·일러스트·픽셀)에 맞춰 이모지·아이콘을 고른다.
     - 글자 스티커(“쏙!”, “풍자!”)는 트랙 A 어느 스타일에서나 쓴다.
   - (라) 트랙 B — 생성형 그래픽·도형·하프톤·타이포·가는 선 아이콘만. 3D 이모지·글자 스티커·통통 튀는 움직임이 하나라도 섞이면 실패(받은 로고·제품 화면은 쓴다).
3. **전환은 이어 붙인다.** 장면이 바뀔 때 화면이 비거나 검게 되는 순간(0.15초 이상)을 만들지 않는다.
   - 다음 장면이 이전 장면을 덮거나 밀어내고(`M.flood`, 밀기), 같은 모양으로 넘어가거나(모자 → 모자, 원 → 지구, 점 → 행성), 카메라가 다음 요소로 옮겨 간다. 두 장면이 0.2~0.4초 겹치게 둔다.
   - 검게 닫는 아이리스·암전은 끝 카드에만.
   - 자막도 다음 줄이 들어오기 직전까지 이전 줄을 남겨 둔다(자막 없는 빈 구간을 만들지 않는다. 끝 카드는 예외).

## 5.6 레퍼런스 영상 (요청 메시지에 접촉 시트가 오면)
접촉 시트 = 레퍼런스 영상을 일정 간격으로 찍어 4×4로 모은 그림(왼쪽 위 → 오른쪽 아래 순서, 간격·시간 범위는 요청 메시지에 적혀 있다). 연속한 칸을 비교하면 움직임 곡선과 전환이 보인다.
1. 먼저 분석한다: ① 색 수·바탕·강조색 쓰는 법 ② 글꼴 결(굵기·크기 대비·자간)과 배치 그리드 ③ 장면 전환 방식(무엇이 무엇으로 변신·밀기·덮기·카메라 이동) ④ 움직임 곡선(튕김 / 급정지 / 긴 감속, 등장 길이) ⑤ 컷 길이 리듬(컷 시각 목록)·박자 맞춤 ⑥ 화면 밀도·여백·질감(HUD·그레인·하프톤·입자).
2. 이 분석을 이 영상의 내용·자산으로 옮긴다. 레퍼런스의 글자·로고·인물·고유 그림·문구는 베끼지 않는다(결만 가져온다). 내용 사실은 여전히 콘티에서만.
3. 연출 트랙이 지정되어 있으면 트랙이 우선이고, 레퍼런스에서는 전환·움직임·리듬을 가져온다. "자동"이면 레퍼런스에 가까운 트랙을 고른다.
4. 장면 코드 `<head>` 맨 위 트랙 주석 다음에 `<!-- reference: ① … ② … ③ … ④ … ⑤ … ⑥ … -->`로 분석을 한 줄씩 적는다(검수 단계가 이 요약대로 됐는지 본다).

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
- 한 편에 10~20개(트랙 B는 6~12개, 4절). 등장(pop/swish/open), 전환(whoosh), 충격(impact/thump), 숫자(tick·coin 여러 번 + ding), 성장(power-up), 실수(error), 끝(jingle/fanfare).

## 7. 출력 형식
설명 없이 아래 두 블록만(트랙 주석·레퍼런스 주석은 html 블록 `<head>` 맨 위에):
1. ` ```html ` … 완전한 HTML … ` ``` `
2. ` ```json ` … 소리 큐 … ` ``` `
