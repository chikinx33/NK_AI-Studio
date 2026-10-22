// 인포그래픽 영상 감독: 영상마다 장면 코드(HTML 한 장)와 소리 큐를 새로 쓰게 하는 프롬프트와, 그 결과의 검사·정리.
// 시즌1 홍보 영상(promo/_review_s1)을 만든 방식 그대로 — 템플릿에 글자를 채우지 않고 이 영상만의 장면을 짠다.
import {
  MOTION_KIT_EMOJI, MOTION_KIT_EXAMPLES, MOTION_KIT_GUIDE, MOTION_KIT_ICONS, MOTION_KIT_MUSIC, MOTION_KIT_SFX, MOTION_KIT_SFX_TAGS,
} from "./motion-director-kit.js";

export const MOTION_DIRECTOR_MODEL = "claude-opus-5-5";
// 생각(effort high) 토큰도 max_tokens 에 함께 계산된다. 32000 에서 운영 첫 시도가 잘렸다(2026-10-21).
// Opus 5.5 출력 상한은 128K. 64000 에서도 클라우드 첫 운영(30초 16:9, 7장면)이 660초 만에 잘렸다(2026-10-22) → 상한까지.
// 64K 를 660초에 썼으니 128K 는 20분 남짓: 시간 제한(motion-director.ts)과 프록시(nk-openai-proxy 3600초)도 함께 늘렸다.
export const MOTION_DIRECTOR_MAX_TOKENS = 128000;
export const MOTION_DIRECTOR_MAX_IMAGES = 12;
// 레퍼런스 영상 접촉 시트(4×4) 최대 장수 — prepare-motion-assets.mjs 의 MAX_SHEETS 와 같다
export const MOTION_REFERENCE_MAX_SHEETS = 12;

export const STAGE_SIZES = { "9:16": "1080x1920", "16:9": "1920x1080", "1:1": "1080x1080" };

const clip = (value, n) => String(value ?? "").slice(0, n);

// 키트 루트(작업 폴더 기준 상대 경로): prepared.kit.motion = ".../motion-kit/lib/motion.js"
export function kitRoot(prepared) {
  return String(prepared?.kit?.motion || "").replace(/\/lib\/motion\.js$/, "");
}

// 배경음악 방식: 받은 곡 / 기본 음악에서 고름 / 없음
export function musicMode(prepared) {
  if (prepared?.bgm) return "provided";
  return prepared?.noMusic ? "none" : "library";
}

export function buildMotionDirectorSystem() {
  const examples = MOTION_KIT_EXAMPLES.map((ex, i) => [
    `### 실례 ${i + 1}: ${ex.label}`,
    "테마(이 편에서는 :root 변수로 직접 쓴다):",
    "```css", ex.theme.trim(), "```",
    "장면 코드(경로 ../../../_motion/… 와 게임 그림 파일은 이 실례의 폴더 기준이다. 너는 'KIT/…'와 받은 자산 경로를 쓴다):",
    "```html", ex.html.trim(), "```",
    "소리 큐(효과음 이름은 그 게임 폴더 기준. 너는 tag:용도 를 쓴다):",
    "```json", ex.episode, "```",
  ].join("\n")).join("\n\n");
  return [
    "너는 2026년 쇼츠·광고 모션그래픽 감독이자 프런트엔드 개발자다. 받은 요청·콘티·자산으로 이 영상 한 편만을 위한 장면 코드를 새로 쓴다.",
    "템플릿(제목-본문-카드 반복)에 글자만 채우는 것은 실패다. 시즌1 실례처럼 내용을 사물·숫자·인물의 움직임으로 보여 주고, 모든 움직임을 음악 박자에 맞춘다.",
    "",
    MOTION_KIT_GUIDE,
    "",
    "## 효과음 용도 태그 (\"tag:이름\" | 느낌·쓰임 | 소리 개수)",
    MOTION_KIT_SFX,
    "",
    "## 시즌1 실례",
    examples,
  ].join("\n");
}

function musicSection(prepared, durationSec) {
  const mode = musicMode(prepared);
  if (mode === "none") return "배경음악 없음(사용자가 음악 없이 하기로 함) → 박자 대신 초 단위로 시간을 정하고, 소리 큐의 bgm은 null.";
  if (mode === "provided") {
    const bgm = prepared.bgm;
    const beats = Array.isArray(prepared?.beatTimes) ? prepared.beatTimes : [];
    const until = beats.filter((b) => b <= durationSec + 6);
    return [
      `받은 배경음악: ${bgm.name} (${bgm.durationSec ?? "?"}초, 약 ${bgm.bpm} BPM, 박자 ${bgm.beatCount}개). 박자 스크립트: ${bgm.beatsScript} (전역 B). 소리 큐의 bgm 에는 volume 만.`,
      until.length ? `박자 시각(초, 앞부분): ${until.join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    "기본 음악에서 고른다: 아래에서 영상 분위기에 가장 맞는 곡 하나를 골라 소리 큐에 \"bgm\": {\"track\": \"<id>\", \"volume\": 0.5} 로 쓰고,",
    "페이지에 <script src=\"KIT/music/<id>.beats.js\"></script> 를 넣어 그 곡의 박자(B)로 맞춘다. 곡은 모두 130초, BPM 은 분석값(150 이상이면 두 박마다 쓰는 게 자연스럽다).",
    ...MOTION_KIT_MUSIC.map((track) => `- ${track.id} | ${track.ko} | ${track.bpm} BPM`),
  ].join("\n");
}

// 연출 트랙(motion-kit/KIT.md 4절): 사용자가 고른 값, 없으면 감독이 요청에서 고른다
export function motionStyleOf(input) {
  return input?.motionStyle === "pop" || input?.motionStyle === "editorial" ? input.motionStyle : "auto";
}

function trackSection(input, prepared) {
  const style = motionStyleOf(input);
  if (style === "pop") return "연출 트랙: 트랙 A 쇼츠 팝(사용자 지정). 설명서 4절 트랙 A를 따르고 <!-- track: pop --> 로 적는다.";
  if (style === "editorial") return "연출 트랙: 트랙 B 에디토리얼 모션(사용자 지정). 설명서 4절 트랙 B와 실례 3을 따르고 <!-- track: editorial --> 로 적는다. 3D 이모지·스티커·통통 튀는 움직임은 하나도 쓰지 않는다.";
  return `연출 트랙: 자동 — 설명서 4절 기준으로 요청·자산${prepared?.reference ? "·레퍼런스 영상" : ""}에 맞는 트랙 하나를 골라 <!-- track: … --> 로 적는다.`;
}

// 레퍼런스 영상(접촉 시트는 호출부가 이미지로 붙인다): 시트별 시간 범위·컷 시각·박자
export function referenceSection(reference) {
  if (!reference || !Array.isArray(reference.sheets) || !reference.sheets.length) return "";
  const sheets = reference.sheets.slice(0, MOTION_REFERENCE_MAX_SHEETS);
  const cuts = Array.isArray(reference.cuts) ? reference.cuts : [];
  const starts = [0, ...cuts];
  const shots = [...cuts, reference.span].map((at, i) => Math.round((at - starts[i]) * 100) / 100);
  return [
    "# 레퍼런스 영상 (연출 참고 — 설명서 5.6절)",
    `위 접촉 시트 ${sheets.length}장은 사용자가 고른 레퍼런스 영상 "${clip(reference.name, 80)}"(${reference.width || "?"}x${reference.height || "?"}, 앞 ${reference.span}초)을 ${reference.step}초 간격으로 찍어 4×4로 모은 것이다(각 장 왼쪽 위 → 오른쪽 아래).`,
    ...sheets.map((sheet, i) => `- 시트 ${i + 1}: ${sheet.from}~${sheet.to}초`),
    cuts.length
      ? `컷이 바뀌는 시각(초): ${cuts.join(", ")} → 컷 길이(초): ${shots.join(", ")}`
      : "컷 감지: 없음(한 컷 안에서 변신·카메라 이동으로 이어지는 영상일 수 있다 — 시트로 확인)",
    reference.bpm ? `레퍼런스 음악: 약 ${reference.bpm} BPM, 박자 시각(초, 앞부분): ${(reference.beats || []).slice(0, 48).join(", ")} — 컷·등장이 박자에 어떻게 맞는지 본다` : "",
    "먼저 ①색 ②글꼴·그리드 ③전환 방식 ④움직임 곡선 ⑤컷 리듬·박자 ⑥밀도·질감을 분석하고, 그 결을 이 영상의 내용·자산으로 옮긴다. 레퍼런스의 글자·로고·인물·고유 그림·문구는 베끼지 않는다.",
    "분석은 <head> 맨 위 트랙 주석 다음에 <!-- reference: ① … ⑥ … --> 로 적는다.",
  ].filter(Boolean).join("\n");
}

function storyboard(spec) {
  if (!spec || !Array.isArray(spec.scenes)) return "(콘티 초안 없음)";
  const lines = [`제목: ${clip(spec.title, 120)}`];
  if (spec.narration) lines.push(`내레이션 초안: ${clip(spec.narration, 800)}`);
  spec.scenes.slice(0, 10).forEach((scene, i) => {
    // 수치는 기획 회의가 확인한 facts 만(단위 그대로). 옛 템플릿용 visualData 는 채움 값이 섞여 쓰지 않는다.
    const facts = Array.isArray(scene.facts) && scene.facts.length
      ? ` · 수치: ${scene.facts.map((f) => `${clip(f.label, 30)} ${f.value}${clip(f.unit, 12)}`).join(", ")}`
      : "";
    const idea = scene.idea ? ` · 움직임 아이디어: ${clip(scene.idea, 200)}` : "";
    lines.push(`${i + 1}. ${clip(scene.title, 120).replace(/\n/g, " ")}${scene.body ? ` — ${clip(scene.body, 200)}` : ""}${facts}${idea}`);
  });
  return lines.join("\n");
}

// 사용자 메시지(글). 그림 미리보기는 호출부가 이미지 블록으로 붙인다.
export function buildMotionDirectorRequest({ input = {}, spec = null, prepared = {} }) {
  const aspect = STAGE_SIZES[input.aspectRatio] ? input.aspectRatio : "16:9";
  const durationSec = Math.min(60, Math.max(10, Number(input.durationSec) || 30));
  const items = (Array.isArray(prepared.items) ? prepared.items : []).map((item) => ({
    role: item.role, name: clip(item.name, 60), file: item.file,
    ...(item.width ? { size: `${item.width}x${item.height}` } : {}),
    ...(item.durationSec ? { durationSec: item.durationSec } : {}),
    ...(item.peakSec != null ? { peakSec: item.peakSec } : {}),
  }));
  const kit = prepared.kit || {};
  return [
    "# 요청",
    `영상 요청: ${clip(input.prompt, 1600)}`,
    `길이: 약 ${durationSec}초 (끝 카드 포함, 박자에 맞춰 ±2초 허용) · 화면: ${aspect} → <html data-size="${STAGE_SIZES[aspect]}">`,
    "시청 대상·톤·스타일: 따로 주지 않는다. 영상 요청 글에서 읽어 정한다(요청에 없으면 주제에 가장 잘 맞게).",
    prepared.brand ? `브랜드: ${clip(prepared.brand.title, 80)} (로고·캐릭터 그림이 자산에 있으면 주인공으로 쓴다)` : "브랜드: 없음",
    trackSection(input, prepared),
    "",
    "# 콘티 초안 (기획 회의 결과 — 내용과 수치의 근거. 장면 구성·문장은 더 좋게 바꿔도 되지만 없는 사실·수치는 만들지 않는다)",
    storyboard(spec),
    "",
    "# 이 편의 경로",
    `KIT = ${kitRoot(prepared)} (설명서의 'KIT/…'를 이 경로로 쓴다)`,
    `motion.js: ${kit.motion} · base.css: ${kit.baseCss} · fonts.css: ${kit.fontsCss}`,
    "",
    "# 받은 자산 (assets/… 상대 경로. 아래 그림 미리보기 참고)",
    items.length ? "```json\n" + JSON.stringify(items, null, 1) + "\n```" : "(받은 그림·클립·소리 없음 → 그림 스타일(설명서 5.5절 2번) 하나를 정하고 그 스타일로 화면을 채운다: 트랙 A는 3D 이모지 중심 또는 직접 그린 SVG·아이콘 중심, 트랙 B는 생성형 그래픽·도형·타이포)",
    "",
    ...(prepared.reference ? [referenceSection(prepared.reference), ""] : []),
    `다 쓴 뒤 설명서 5.5절 품질 점검표(화면 채우기 · 스타일 하나 · 이어지는 전환)로 스스로 확인한다.${aspect === "9:16" ? "" : ` 이 편은 ${aspect}이라 시즌1(9:16) 실례 구도를 그대로 옮기지 말고 가로 화면을 채운다.`}`,
    "",
    "# 음악",
    musicSection(prepared, durationSec),
    "",
    "두 블록(```html, ```json)만 출력한다.",
  ].join("\n");
}

// 검수(확인 루프): 감독이 방금 쓴 장면 코드를 찍은 정지 화면 + 자동 검사 결과를 보고 점검표대로 스스로 고친다.
// 고칠 게 없으면 "OK" 한 줄. 정지 화면은 호출부가 이미지로 붙인다(시각 순서).
export const MOTION_REVIEW_MAX_IMAGES = 16;
export function buildMotionReviewRequest({ input = {}, prepared = {}, html = "", episode = null, frameTimes = [], findings = [] }) {
  const aspect = STAGE_SIZES[input.aspectRatio] ? input.aspectRatio : "16:9";
  const durationSec = Math.min(60, Math.max(10, Number(input.durationSec) || 30));
  return [
    "# 검수",
    `위 정지 화면 ${frameTimes.length}장은 네가 방금 쓴 장면 코드를 실제로 찍은 것이다(시각: ${frameTimes.map((t) => `${t}초`).join(", ")}).`,
    "설명서 5.5절 품질 점검표와 아래 자동 검사 결과로 이 영상을 본다:",
    "1. 화면 채우기 — 넓은 배경 가운데 작은 물건 하나만 있는 장면이 있나(주인공 크기 화면 높이 40~60%, 세 층, 16:9 삼분할).",
    "2. 그림 스타일·트랙 하나 — 3D 이모지와 납작한 실루엣·도형이 한 영상에 섞였나. 장면 코드 맨 위 <!-- track: … --> 가 editorial 인데 이모지·스티커·통통 튀는 움직임이 있나(또는 pop 인데 트랙 B 문법이 섞였나).",
    "3. 이어지는 전환 — 장면 사이에 화면이 비거나 검게 되는 순간이 있나(끝 카드 제외).",
    "4. 자막·글자 — 글자끼리 겹치거나, 잘리거나, 다른 요소에 가려지거나, 화면 밖으로 나가나.",
    "5. 사실 — 콘티에 없는 수치·사실을 만들지 않았나.",
    ...(prepared?.reference ? ["6. 레퍼런스 — 장면 코드 맨 위 <!-- reference: … --> 분석(전환·움직임 곡선·컷 리듬·색·질감)이 실제 장면에 구현됐나. 레퍼런스의 글자·로고를 베끼지 않았나."] : []),
    "",
    "# 자동 검사 결과",
    findings.length ? findings.map((line) => `- ${line}`).join("\n") : "- 빈 화면·암전 구간 없음",
    "",
    "# 출력",
    "- 고칠 것이 없으면 다른 말 없이 OK 한 줄만 쓴다.",
    "- 고칠 것이 있으면 문제가 있는 부분만 고친다. 잘 된 장면·타이밍·문장·음악·소리 큐는 그대로 둔다(전체 길이도 그대로).",
    "- 고쳤으면 전체 HTML 과 전체 소리 큐를 두 블록(```html, ```json)으로 다시 출력한다.",
    "",
    `# 이 편의 정보: 화면 ${aspect} (<html data-size="${STAGE_SIZES[aspect]}">), 약 ${durationSec}초, KIT = ${kitRoot(prepared)}`,
    "",
    "# 지금 장면 코드",
    "```html", String(html).slice(0, 200_000), "```",
    "",
    "# 지금 소리 큐",
    "```json", JSON.stringify(episode || {}), "```",
  ].join("\n");
}

// 검수 응답이 "고칠 것 없음"인가(코드 블록 없이 OK)
export function isReviewApproved(text) {
  const body = String(text || "").trim();
  return !/```html/i.test(body) && /^\s*(?:\*\*)?OK(?:\*\*)?\b/i.test(body);
}

// 부분 수정: 지금 장면 코드에서 요청한 부분만 고친다(가리킨 장면 정지 화면은 호출부가 이미지로 붙인다)
export function buildMotionRevisionRequest({ input = {}, prepared = {}, html = "", episode = null, request = "", frameTimes = [] }) {
  const aspect = STAGE_SIZES[input.aspectRatio] ? input.aspectRatio : "16:9";
  const durationSec = Math.min(60, Math.max(10, Number(input.durationSec) || 30));
  return [
    "# 수정 요청 (이 부분만 고친다)",
    clip(request, 2000),
    frameTimes.length ? `사용자가 가리킨 장면: ${frameTimes.map((t) => `${t}초`).join(", ")} (위 정지 화면)` : "",
    "",
    "# 규칙",
    "- 요청한 부분만 바꾸고, 나머지 장면·타이밍·문장·색·움직임은 한 글자도 바꾸지 않는다.",
    "- 요청이 장면 하나를 가리키면 그 시각 앞뒤 장면만 고친다. 전체 길이는 그대로 둔다.",
    "- 바꾼 결과로 소리 큐가 어긋나면 그 큐만 옮긴다.",
    "- 수정한 전체 HTML 과 전체 소리 큐를 두 블록(```html, ```json)으로 다시 출력한다.",
    "",
    `# 이 편의 정보: 화면 ${aspect} (<html data-size="${STAGE_SIZES[aspect]}">), 약 ${durationSec}초, KIT = ${kitRoot(prepared)}`,
    "",
    "# 지금 장면 코드",
    "```html", String(html).slice(0, 200_000), "```",
    "",
    "# 지금 소리 큐",
    "```json", JSON.stringify(episode || {}), "```",
  ].filter((line) => line !== "").join("\n");
}

const FORBIDDEN = [
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(|requestAnimationFrame\s*\(/, "타이머(setTimeout/setInterval/requestAnimationFrame)를 쓰면 안 된다"],
  [/Math\.random\s*\(/, "Math.random()을 쓰면 안 된다(프레임마다 달라짐)"],
  [/\bnew Date\b|Date\.now\s*\(/, "현재 시각을 쓰면 안 된다"],
  [/(?:src|href)\s*=\s*["']https?:/i, "외부 주소를 불러오면 안 된다"],
  [/@import\s+url\(\s*["']?https?:/i, "외부 CSS를 불러오면 안 된다"],
];
// CSS 안에서만 검사한다(스크립트 객체 키 transition: 등은 허용)
const CSS_FORBIDDEN = /(?:^|[;{\s])(?:transition|animation)\s*:/i;

const CUE_FILE = /^(?:(?:synth|game)\/[\w.-]+|assets\/[\w가-힣.-]+)$/;
const SFX_TAGS = new Set(MOTION_KIT_SFX_TAGS);
const ICONS = new Set(MOTION_KIT_ICONS);
const EMOJI = new Set(MOTION_KIT_EMOJI);
const MUSIC = new Set(MOTION_KIT_MUSIC.map((track) => track.id));

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

// 없는 아이콘·이모지 이름 → 가장 가까운 실제 이름(낱말이 많이 겹치고 글자 차이가 적은 것)
export function closestName(name, names, separator) {
  // 구분자만 다른 이름(light-bulb ↔ lightbulb)은 같은 것으로 본다
  const squash = (value) => value.split(separator).join("");
  const same = names.find((candidate) => squash(candidate) === squash(name));
  if (same) return same;
  const words = new Set(name.split(separator).filter(Boolean));
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of names) {
    const parts = candidate.split(separator);
    const shared = parts.filter((p) => words.has(p)).length;
    const score = shared * 10 - editDistance(name, candidate) - Math.abs(parts.length - words.size);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

// 모델 출력 → { html, episode, problems, fixes }. problems가 있으면 렌더하지 않고 고치게 한다. fixes 는 자동으로 바로잡은 것.
export function parseMotionDirectorOutput(text, { aspectRatio = "16:9", prepared = {} } = {}) {
  const problems = [];
  const fixes = [];
  const html = (String(text || "").match(/```html\s*\n([\s\S]*?)\n```/) || [])[1] || "";
  const json = (String(text || "").match(/```json\s*\n([\s\S]*?)\n```/) || [])[1] || "";
  let page = html.trim();
  if (!page) problems.push("```html 블록이 없다");
  const size = STAGE_SIZES[aspectRatio] || STAGE_SIZES["16:9"];
  const root = kitRoot(prepared);
  if (page) {
    // 무대 크기는 요청 화면비로 고정한다(모델이 빠뜨리거나 틀려도 렌더러가 같은 크기로 찍게)
    page = /<html\b[^>]*\bdata-size=/i.test(page)
      ? page.replace(/(<html\b[^>]*\bdata-size=)["'][^"']*["']/i, `$1"${size}"`)
      : page.replace(/<html\b/i, `<html data-size="${size}"`);
    // 설명서의 'KIT/…' 표기를 실제 경로로
    if (root) page = page.replace(/(["'(])KIT\//g, `$1${root}/`);
    // 없는 아이콘·이모지 이름은 가장 가까운 실제 이름으로
    page = page.replace(/(icons\/lucide\/)([a-z0-9-]+)(\.svg)/g, (all, a, name, c) => {
      if (ICONS.has(name)) return all;
      const fixed = closestName(name, MOTION_KIT_ICONS, "-");
      fixes.push(`아이콘 ${name} → ${fixed}`);
      return a + fixed + c;
    });
    page = page.replace(/(emoji\/)([a-z0-9_]+)(\.png)/g, (all, a, name, c) => {
      if (EMOJI.has(name)) return all;
      const fixed = closestName(name, MOTION_KIT_EMOJI, "_");
      fixes.push(`이모지 ${name} → ${fixed}`);
      return a + fixed + c;
    });
    if (!/id=["']stage["']/.test(page)) problems.push('<div id="stage">가 없다');
    if (!/async\s+function\s+seek\s*\(/.test(page)) problems.push("async function seek(t)가 없다");
    if (!/window\.READY\s*=/.test(page)) problems.push("window.READY = …가 없다");
    if (prepared?.kit?.motion && !page.includes(prepared.kit.motion)) problems.push(`motion.js 경로가 다르다(${prepared.kit.motion})`);
    const scrubbed = page.replace(/xmlns(?::\w+)?=["']http:\/\/www\.w3\.org\/[^"']*["']/g, "");
    for (const [pattern, message] of FORBIDDEN) if (pattern.test(scrubbed)) problems.push(message);
    const css = [...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1])
      .concat([...page.matchAll(/\sstyle=["']([^"']*)["']/gi)].map((m) => m[1])).join("\n");
    if (CSS_FORBIDDEN.test(css)) problems.push("CSS transition/animation 대신 seek(t)에서 계산해야 한다");
  }
  let episode = null;
  try {
    const raw = json ? JSON.parse(json) : null;
    if (!raw || typeof raw !== "object") throw new Error("```json 소리 큐 블록이 없다");
    const known = new Set((prepared?.items || []).filter((item) => item.role === "audio").map((item) => item.file));
    const cues = (Array.isArray(raw.cues) ? raw.cues : []).slice(0, 60).flatMap((cue) => {
      if (!Array.isArray(cue)) return [];
      const [at, file, gain] = cue;
      const okAt = (typeof at === "number" && at >= 0) || (typeof at === "string" && /^s\d+(\.\d+)?$/.test(at));
      const okFile = typeof file === "string" && (
        (file.startsWith("tag:") && SFX_TAGS.has(file.slice(4)))
        || (CUE_FILE.test(file) && (!file.startsWith("assets/") || known.has(file))));
      if (!okAt || !okFile) return [];
      return [[at, file, Math.min(1.5, Math.max(0, Number(gain) || 0.8))]];
    });
    const volume = Math.min(0.9, Math.max(0.2, Number(raw?.bgm?.volume) || 0.55));
    const mode = musicMode(prepared);
    let bgm = null;
    let beats = null;
    if (mode === "provided") {
      bgm = { file: prepared.bgm.file, start: 0, volume };
      beats = prepared.bgm.beats;
    } else if (mode === "library" && root) {
      let track = String(raw?.bgm?.track || "");
      if (!MUSIC.has(track)) {
        const fixed = closestName(track || "lofi-chill", MOTION_KIT_MUSIC.map((t) => t.id), "-");
        fixes.push(`배경음악 ${track || "(없음)"} → ${fixed}`);
        track = fixed;
      }
      bgm = { file: `${root}/music/${track}.ogg`, start: 0, volume, track };
      beats = `${root}/music/${track}.beats.json`;
      // 페이지가 고른 곡의 박자(B)를 쓰게: 다른 곡 박자 스크립트는 바꾸고, 없으면 head 에 넣는다
      if (page) {
        const script = `${root}/music/${track}.beats.js`;
        page = page.replace(/[^"'\s]*music\/[a-z0-9-]+\.beats\.js/g, script);
        if (!page.includes(script)) page = page.replace(/<\/head>/i, `<script src="${script}"></script>\n</head>`);
      }
    }
    if (!bgm && cues.some(([at]) => typeof at === "number")) problems.push("배경음악이 없으면 소리 큐 시점은 \"s초\"로 써야 한다");
    episode = { bgm, beats, cues };
  } catch (error) {
    problems.push(String(error?.message || error));
  }
  return { html: page, episode, problems, fixes };
}
