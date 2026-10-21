// 인포그래픽 영상 감독: 영상마다 장면 코드(HTML 한 장)와 소리 큐를 새로 쓰게 하는 프롬프트와, 그 결과의 검사·정리.
// 시즌1 홍보 영상(promo/_review_s1)을 만든 방식 그대로 — 템플릿에 글자를 채우지 않고 이 영상만의 장면을 짠다.
import { MOTION_KIT_EXAMPLES, MOTION_KIT_GUIDE, MOTION_KIT_SFX } from "./motion-director-kit.js";

export const MOTION_DIRECTOR_MODEL = "claude-opus-5-5";
export const MOTION_DIRECTOR_MAX_TOKENS = 32000;
export const MOTION_DIRECTOR_MAX_IMAGES = 12;

export const STAGE_SIZES = { "9:16": "1080x1920", "16:9": "1920x1080", "1:1": "1080x1080" };

const clip = (value, n) => String(value ?? "").slice(0, n);

export function buildMotionDirectorSystem() {
  const examples = MOTION_KIT_EXAMPLES.map((ex, i) => [
    `### 실례 ${i + 1}: ${ex.label}`,
    "테마(이 편에서는 :root 변수로 직접 쓴다):",
    "```css", ex.theme.trim(), "```",
    "장면 코드(경로 ../../../_motion/… 와 게임 그림 파일은 이 실례의 폴더 기준이다. 너는 아래 '이 편의 경로'를 쓴다):",
    "```html", ex.html.trim(), "```",
    "소리 큐(효과음 이름은 그 게임 폴더 기준. 너는 효과음 라이브러리 이름을 쓴다):",
    "```json", ex.episode, "```",
  ].join("\n")).join("\n\n");
  return [
    "너는 2026년 쇼츠·광고 모션그래픽 감독이자 프런트엔드 개발자다. 받은 요청·콘티·자산으로 이 영상 한 편만을 위한 장면 코드를 새로 쓴다.",
    "템플릿(제목-본문-카드 반복)에 글자만 채우는 것은 실패다. 시즌1 실례처럼 내용을 사물·숫자·인물의 움직임으로 보여 주고, 모든 움직임을 음악 박자에 맞춘다.",
    "",
    MOTION_KIT_GUIDE,
    "",
    "## 효과음 라이브러리 (파일 | 느낌 | 용도 | 길이·타격 지점)",
    MOTION_KIT_SFX,
    "",
    "## 시즌1 실례",
    examples,
  ].join("\n");
}

function beatSummary(prepared, durationSec) {
  const bgm = prepared?.bgm;
  if (!bgm) return "배경음악 없음 → 박자 대신 초 단위로 시간을 정하고, 소리 큐의 bgm은 null.";
  const beats = Array.isArray(prepared?.beatTimes) ? prepared.beatTimes : [];
  const until = beats.filter((b) => b <= durationSec + 6);
  return [
    `배경음악: ${bgm.name} (${bgm.durationSec ?? "?"}초, 약 ${bgm.bpm} BPM, 박자 ${bgm.beatCount}개). 스크립트: ${bgm.beatsScript} (전역 B).`,
    until.length ? `박자 시각(초, 앞부분): ${until.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function storyboard(spec) {
  if (!spec || !Array.isArray(spec.scenes)) return "(콘티 초안 없음)";
  const lines = [`제목: ${clip(spec.title, 120)}`];
  if (spec.narration) lines.push(`내레이션 초안: ${clip(spec.narration, 800)}`);
  spec.scenes.slice(0, 10).forEach((scene, i) => {
    const data = scene.visualData || {};
    const numbers = data.dataMode === "quantitative" && Array.isArray(data.values)
      ? ` · 수치: ${data.values.map((v, k) => `${clip(data.labels?.[k], 30)} ${v}${clip(data.unit, 8)}`).join(", ")}`
      : "";
    lines.push(`${i + 1}. [${scene.kind}] ${clip(scene.title, 120).replace(/\n/g, " ")} — ${clip(scene.body, 200)}${numbers}`);
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
    `시청 대상: ${clip(input.audience, 120)} · 톤: ${clip(input.tone, 120)} · 스타일: ${clip(input.style, 120)}`,
    prepared.brand ? `브랜드: ${clip(prepared.brand.title, 80)} (로고·캐릭터 그림이 자산에 있으면 주인공으로 쓴다)` : "브랜드: 없음",
    "",
    "# 콘티 초안 (기획 회의 결과 — 내용과 수치의 근거. 장면 구성·문장은 더 좋게 바꿔도 되지만 없는 사실·수치는 만들지 않는다)",
    storyboard(spec),
    "",
    "# 이 편의 경로 (그대로 쓴다)",
    `motion.js: ${kit.motion} · base.css: ${kit.baseCss} · fonts.css: ${kit.fontsCss}`,
    "",
    "# 받은 자산 (assets/… 상대 경로. 아래 그림 미리보기 참고)",
    items.length ? "```json\n" + JSON.stringify(items, null, 1) + "\n```" : "(받은 그림·클립·소리 없음 → 도형·글자·숫자 움직임으로 만든다)",
    "",
    "# 음악",
    beatSummary(prepared, durationSec),
    "",
    "두 블록(```html, ```json)만 출력한다.",
  ].join("\n");
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

// 모델 출력 → { html, episode, problems }. problems가 있으면 렌더하지 않고 고치게 한다.
export function parseMotionDirectorOutput(text, { aspectRatio = "16:9", prepared = {} } = {}) {
  const problems = [];
  const html = (String(text || "").match(/```html\s*\n([\s\S]*?)\n```/) || [])[1] || "";
  const json = (String(text || "").match(/```json\s*\n([\s\S]*?)\n```/) || [])[1] || "";
  let page = html.trim();
  if (!page) problems.push("```html 블록이 없다");
  const size = STAGE_SIZES[aspectRatio] || STAGE_SIZES["16:9"];
  if (page) {
    // 무대 크기는 요청 화면비로 고정한다(모델이 빠뜨리거나 틀려도 렌더러가 같은 크기로 찍게)
    page = /<html\b[^>]*\bdata-size=/i.test(page)
      ? page.replace(/(<html\b[^>]*\bdata-size=)["'][^"']*["']/i, `$1"${size}"`)
      : page.replace(/<html\b/i, `<html data-size="${size}"`);
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
      const okFile = typeof file === "string" && CUE_FILE.test(file) && (!file.startsWith("assets/") || known.has(file));
      if (!okAt || !okFile) return [];
      return [[at, file, Math.min(1.5, Math.max(0, Number(gain) || 0.8))]];
    });
    const bgm = prepared?.bgm
      ? { file: prepared.bgm.file, start: 0, volume: Math.min(0.9, Math.max(0.2, Number(raw?.bgm?.volume) || 0.55)) }
      : null;
    if (!bgm && cues.some(([at]) => typeof at === "number")) problems.push("배경음악이 없으면 소리 큐 시점은 \"s초\"로 써야 한다");
    episode = { bgm, beats: prepared?.bgm ? prepared.bgm.beats : null, cues };
  } catch (error) {
    problems.push(String(error?.message || error));
  }
  return { html: page, episode, problems };
}
