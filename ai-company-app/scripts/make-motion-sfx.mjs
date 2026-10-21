// 모션 키트 기본 효과음 라이브러리를 만든다(한 번 실행해 결과 파일을 커밋한다).
// 1) synth/: 저작권 걱정 없는 범용 효과음을 직접 합성(잡음·필터·배음 계산, 시드 고정이라 다시 돌려도 같은 결과)
// 2) game/: 엔케 게임 3종(NEKOBAN·PuzzleKnight·ELIDUS)의 범용 효과음 사본(2026-10-21 엔케 승인)
// 3) index.json: 장면 코드를 짜는 AI가 고를 목록(이름·용도·길이·타격 지점)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMono } from "./motion-beats.mjs";
import { pickFfmpeg } from "./render-motion-page.mjs";

const SR = 48000;
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sfxDirectory = path.join(projectDirectory, "motion-kit", "sfx");

// ---------- 합성 도구 ----------
let seed = 20261021;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rand() * 2 - 1;
const buffer = (sec) => new Float64Array(Math.round(sec * SR));
const expSweep = (a, b, p) => a * Math.pow(b / a, Math.min(1, Math.max(0, p)));

// RBJ 바이쿼드 필터(시간마다 주파수가 바뀌어도 되게 표본마다 계수 계산)
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, freq, q = 0.8) => {
    const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; }
    const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function normalize(samples, peakDb = -1) {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? Math.pow(10, peakDb / 20) / peak : 1;
  // 끝 5ms 페이드로 딸깍 소리 방지
  const fade = Math.round(0.005 * SR);
  return samples.map((v, i) => v * gain * Math.min(1, (samples.length - 1 - i) / fade));
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24); header.writeUInt32LE(SR * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// 잡음을 대역 필터로 쓸어 올리고 내리는 "휙"
function whoosh(sec, from, peak, to, q) {
  const out = buffer(sec);
  const bp = biquad("bp");
  const top = 0.55;
  for (let i = 0; i < out.length; i++) {
    const p = i / out.length;
    const freq = p < top ? expSweep(from, peak, p / top) : expSweep(peak, to, (p - top) / (1 - top));
    const env = p < top ? Math.pow(p / top, 1.6) : Math.pow(1 - (p - top) / (1 - top), 2.2);
    out[i] = bp(noise(), freq, q) * env;
  }
  return out;
}

function tone(out, { start = 0, freq, freqEnd, glide = 0.05, decay, amp = 1, partials = [[1, 1]] }) {
  const offset = Math.round(start * SR);
  let phase = partials.map(() => 0);
  for (let i = 0; i + offset < out.length; i++) {
    const t = i / SR;
    const f = freqEnd ? expSweep(freq, freqEnd, t / glide) : freq;
    const attack = Math.min(1, t / 0.002);
    let v = 0;
    partials.forEach(([ratio, gain, extraDecay = 0], k) => {
      phase[k] += (2 * Math.PI * f * ratio) / SR;
      v += Math.sin(phase[k]) * gain * Math.exp(-t * extraDecay);
    });
    out[i + offset] += v * amp * attack * Math.exp(-t * decay);
  }
  return out;
}

function click(out, { start = 0, sec = 0.004, hp = 2500, amp = 0.6 } = {}) {
  const filter = biquad("hp");
  const offset = Math.round(start * SR);
  const n = Math.round(sec * SR);
  for (let i = 0; i < n && i + offset < out.length; i++) out[i + offset] += filter(noise(), hp, 0.7) * amp * (1 - i / n);
  return out;
}

const BELL = [[1, 1, 0], [2.76, 0.45, 2], [5.4, 0.22, 5], [8.93, 0.1, 9]];

const SYNTH = [
  { id: "whoosh", ko: "휙(장면 전환)", en: "whoosh (transition)", tags: ["whoosh"], make: () => whoosh(0.6, 260, 2600, 700, 1.1) },
  { id: "whoosh-long", ko: "휘익(느린 전환)", en: "long whoosh", tags: ["whoosh"], make: () => whoosh(1.1, 180, 1800, 400, 0.9) },
  { id: "whoosh-low", ko: "훅(묵직한 전환)", en: "low whoosh", tags: ["whoosh"], make: () => whoosh(0.7, 120, 900, 250, 1.0) },
  { id: "whoosh-bright", ko: "쉭(밝은 전환)", en: "bright whoosh", tags: ["whoosh", "swish"], make: () => whoosh(0.5, 900, 7000, 2500, 1.3) },
  { id: "whoosh-short", ko: "휙(짧은 전환)", en: "short whoosh", tags: ["whoosh", "swish"], make: () => whoosh(0.28, 400, 4200, 1200, 1.2) },
  { id: "swish", ko: "슉(빠른 등장)", en: "swish (fast entrance)", tags: ["swish", "whoosh"], make: () => whoosh(0.32, 700, 6500, 2000, 1.4) },
  { id: "pop", ko: "뽁(등장·스티커)", en: "pop (appear, sticker)", tags: ["pop"], make: () => click(tone(buffer(0.2), { freq: 950, freqEnd: 260, glide: 0.06, decay: 28 }), { sec: 0.003, amp: 0.4 }) },
  { id: "pop-up", ko: "뿅(올라오며 등장)", en: "bloop (rising appear)", tags: ["pop"], make: () => tone(buffer(0.22), { freq: 320, freqEnd: 1250, glide: 0.08, decay: 22 }) },
  { id: "ding", ko: "딩(강조·정답)", en: "ding (highlight)", tags: ["ding"], make: () => tone(buffer(1.4), { freq: 1320, decay: 2.6, partials: BELL }) },
  { id: "chime", ko: "띠리링(완료·성공)", en: "chime (complete)", tags: ["chime", "success"], make: () => {
    const out = buffer(1.3);
    [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(out, { start: i * 0.075, freq: f, decay: 3.2, amp: 0.7, partials: [[1, 1, 0], [2, 0.3, 4], [3, 0.12, 8]] }));
    return out;
  } },
  { id: "tick", ko: "똑(숫자·글자 하나)", en: "tick (counter, letter)", tags: ["tick"], make: () => click(tone(buffer(0.05), { freq: 2800, decay: 140, amp: 0.6 }), { sec: 0.002, hp: 4000, amp: 0.8 }) },
  { id: "thump", ko: "쿵(강한 등장·충격)", en: "thump (impact)", tags: ["thump", "impact-heavy"], make: () => {
    const out = tone(buffer(0.6), { freq: 130, freqEnd: 42, glide: 0.18, decay: 7 });
    const lp = biquad("lp");
    for (let i = 0; i < 0.05 * SR; i++) out[i] += lp(noise(), 900, 0.7) * (1 - i / (0.05 * SR)) * 0.8;
    return out.map((v) => Math.tanh(v * 1.6));
  } },
  { id: "riser", ko: "상승음(긴장·기대)", en: "riser (build-up)", tags: ["rise"], make: () => {
    const sec = 1.3;
    const out = buffer(sec);
    const bp = biquad("bp");
    let phase = 0;
    for (let i = 0; i < out.length; i++) {
      const p = i / out.length;
      const env = Math.pow(p, 2) * Math.min(1, (out.length - i) / (0.03 * SR));
      phase += (2 * Math.PI * expSweep(180, 900, p)) / SR;
      out[i] = (bp(noise(), expSweep(400, 6000, p), 1.3) * 0.9 + (Math.sin(phase) + 0.4 * Math.sin(2 * phase)) * 0.25) * env;
    }
    return out;
  } },
  { id: "sparkle", ko: "반짝(빛남·보상)", en: "sparkle (shine, reward)", tags: ["sparkle"], make: () => {
    const out = buffer(0.9);
    for (let k = 0; k < 14; k++) tone(out, { start: k * 0.045 + rand() * 0.02, freq: 2200 + rand() * 4200, decay: 18, amp: 0.35 * (1 - k / 16) });
    return out;
  } },
];

// 엔케 게임 효과음 중 장르를 타지 않는 범용 소리만
const GAMES = {
  nekoban: "F:\\NKW\\App\\NEKOBAN\\assets\\audio",
  puzzleknight: "F:\\NKW\\App\\PuzzleKnight\\assets\\audio\\sfx",
  elidus: "F:\\NKW\\App\\MinefieldMaster\\mines_craft_app\\assets\\sound",
};
const GAME_SFX = [
  ["nekoban", "sfx_click.wav", "딸깍(버튼)", "click (button)", ["click"]],
  ["nekoban", "sfx_move.wav", "톡(이동)", "step (move)", ["tap"]],
  ["nekoban", "sfx_push.wav", "드르륵(밀기)", "slide push", ["slide"]],
  ["nekoban", "sfx_goal.wav", "쏙(목표 도달)", "goal reached", ["pop", "success"]],
  ["nekoban", "sfx_clear.wav", "클리어 팡파레", "clear fanfare", ["fanfare"]],
  ["nekoban", "sfx_hint.wav", "힌트 반짝", "hint", ["sparkle"]],
  ["nekoban", "sfx_error.wav", "삐빅(오류)", "error buzz", ["error"]],
  ["puzzleknight", "ui_tap.wav", "탭", "tap", ["tap"]],
  ["puzzleknight", "ui_confirm.wav", "확인", "confirm", ["success"]],
  ["puzzleknight", "ui_popup_open.wav", "팝업 열림", "popup open", ["open"]],
  ["puzzleknight", "ui_tab_switch.wav", "탭 전환", "tab switch", ["switch"]],
  ["puzzleknight", "card_flip.wav", "카드 뒤집기", "card flip", ["card"]],
  ["puzzleknight", "level_up.wav", "레벨 업", "level up", ["power-up", "success"]],
  ["puzzleknight", "stat_up.wav", "수치 상승", "stat up", ["power-up"]],
  ["puzzleknight", "xp_gain.wav", "경험치 획득", "xp gain", ["coin"]],
  ["puzzleknight", "reward_appear.wav", "보상 등장", "reward appear", ["reward"]],
  ["puzzleknight", "reward_coin.wav", "동전", "coin", ["coin"]],
  ["puzzleknight", "reward_complete.wav", "보상 완료", "reward complete", ["reward", "success"]],
  ["puzzleknight", "reward_epic.wav", "대박 보상", "epic reward", ["reward"]],
  ["puzzleknight", "victory_sting.wav", "승리 짧은 음악", "victory sting", ["fanfare"]],
  ["puzzleknight", "roulette_tick.wav", "룰렛 똑딱", "roulette tick", ["tick"]],
  ["puzzleknight", "puzzle_line_clear.wav", "줄 지우기", "line clear", ["success", "sparkle"]],
  ["puzzleknight", "skill_charge_full.wav", "충전 완료", "charge full", ["rise"]],
  ["puzzleknight", "hit_critical.wav", "치명타", "critical hit", ["impact-heavy"]],
  ["elidus", "click01.mp3", "딸깍(타일)", "tile click", ["click"]],
  ["elidus", "score_up.mp3", "점수 상승", "score up", ["coin", "power-up"]],
  ["elidus", "flood_reveal.mp3", "넓게 펼쳐짐", "flood reveal", ["whoosh"]],
  ["elidus", "turn_change.mp3", "차례 전환", "turn change", ["switch"]],
  ["elidus", "game_over_victory.mp3", "승리", "victory", ["fanfare"]],
];

// 감독이 고르는 용도 태그(감독은 파일 이름 대신 "tag:<이름>"으로 요청하고 렌더러가 그중 하나를 고른다)
export const SFX_TAGS = {
  whoosh: "휙 — 장면 전환·움직임", swish: "슉 — 빠른 등장", rise: "상승음 — 긴장·기대", slide: "드르륵 — 밀기",
  pop: "뽁·뿅 — 등장·스티커", open: "열림 — 창·카드 등장", close: "닫힘 — 퇴장", switch: "딸깍 전환 — 탭·토글",
  click: "클릭 — 버튼·선택", tap: "톡 — 가벼운 터치", select: "선택 — 마우스 올림", tick: "똑 — 숫자·글자 하나씩",
  ding: "딩 — 강조·정답", chime: "띠리링 — 완료", success: "성공 — 확인·달성", sparkle: "반짝 — 빛남",
  coin: "동전·칩 — 숫자 증가·보상", reward: "보상 등장", "power-up": "상승 전자음 — 성장·업그레이드", "power-down": "하강 전자음 — 감소·실패",
  fanfare: "짧은 팡파레 — 끝·승리", jingle: "짧은 음악 징글 — 끝 카드·전환", error: "오류 — 틀림·경고", question: "물음 — 질문",
  glitch: "글리치 — 디지털·잡음", beep: "삐 — 기계·알림", laser: "레이저·잽 — SF·에너지", shimmer: "일렁임 — 마법·보호막",
  "impact-light": "가벼운 충격 — 톡 놓기", impact: "중간 충격 — 착지", "impact-heavy": "강한 충격 — 쾅",
  thump: "쿵 — 묵직한 등장", punch: "펀치 — 타격", bell: "종 — 묵직한 울림", explosion: "폭발",
  page: "책장 넘김 — 책·문서", card: "카드 — 넘김·놓기", dice: "주사위 — 운·무작위",
};

// Kenney CC0 효과음 팩(2026-10-21 엔케: 출처 표기 불필요·상업 가능 공개 자료만). [팩, 이름 규칙, 태그]
// 영상에 안 맞는 소리(발걸음·엔진·천·문 등)는 규칙에 없어서 빠진다.
const KENNEY_RULES = [
  ["interface-sounds", /^back/, ["close"]], ["interface-sounds", /^bong/, ["ding"]], ["interface-sounds", /^click/, ["click"]],
  ["interface-sounds", /^close/, ["close"]], ["interface-sounds", /^confirmation/, ["success"]], ["interface-sounds", /^drop/, ["pop"]],
  ["interface-sounds", /^error/, ["error"]], ["interface-sounds", /^glass/, ["sparkle", "ding"]], ["interface-sounds", /^glitch/, ["glitch"]],
  ["interface-sounds", /^maximize/, ["open", "swish"]], ["interface-sounds", /^minimize/, ["close", "swish"]], ["interface-sounds", /^open/, ["open"]],
  ["interface-sounds", /^pluck/, ["pop"]], ["interface-sounds", /^question/, ["question"]], ["interface-sounds", /^scratch/, ["glitch"]],
  ["interface-sounds", /^scroll/, ["tick"]], ["interface-sounds", /^select/, ["select", "click"]], ["interface-sounds", /^switch/, ["switch"]],
  ["interface-sounds", /^tick/, ["tick"]], ["interface-sounds", /^toggle/, ["switch"]],
  ["ui-audio", /^(click|mouseclick|mouserelease)/, ["click"]], ["ui-audio", /^rollover/, ["select"]], ["ui-audio", /^switch/, ["switch"]],
  ["digital-audio", /^(highUp|powerUp|phaserUp|zapThreeToneUp|threeTone|twoTone|zapTwoTone)/, ["power-up"]],
  ["digital-audio", /^(highDown|lowDown|phaserDown|zapThreeToneDown)/, ["power-down"]],
  ["digital-audio", /^(laser|zap)\d/, ["laser"]], ["digital-audio", /^pepSound/, ["pop"]], ["digital-audio", /^phaseJump/, ["swish"]],
  ["digital-audio", /^(tone|lowThreeTone|lowRandom)/, ["beep"]],
  ["impact-sounds", /^impactBell/, ["bell"]], ["impact-sounds", /^impactPunch/, ["punch"]], ["impact-sounds", /^impactMining/, ["impact"]],
  ["impact-sounds", /^impact\w+_light/, ["impact-light"]], ["impact-sounds", /^impact\w+_medium/, ["impact"]], ["impact-sounds", /^impact\w+_heavy/, ["impact-heavy"]],
  ["casino-audio", /^cards?-/, ["card"]], ["casino-audio", /^chips?-/, ["coin"]], ["casino-audio", /^(dice|die)-/, ["dice"]],
  ["music-jingles", /^jingles_/, ["jingle"]],
  ["rpg-audio", /^book/, ["page"]], ["rpg-audio", /^handleCoins/, ["coin"]], ["rpg-audio", /^metal(Click|Latch)/, ["click"]],
  ["sci-fi-sounds", /explosion/i, ["explosion"]], ["sci-fi-sounds", /^forceField/, ["shimmer"]], ["sci-fi-sounds", /^impactMetal/, ["impact-heavy"]],
  ["sci-fi-sounds", /^laser/, ["laser"]],
];

function peakSecond(samples, sr, windowSec = 0.6) {
  let best = 0, at = 0;
  const n = Math.min(samples.length, Math.round(windowSec * sr));
  for (let i = 0; i < n; i++) if (Math.abs(samples[i]) > best) { best = Math.abs(samples[i]); at = i; }
  return Math.round((at / sr) * 1000) / 1000;
}

const ffmpeg = pickFfmpeg();
const index = [];
await fs.mkdir(path.join(sfxDirectory, "synth"), { recursive: true });
await fs.mkdir(path.join(sfxDirectory, "game"), { recursive: true });
for (const item of SYNTH) {
  const samples = normalize(item.make());
  const file = `synth/${item.id}.wav`;
  await fs.writeFile(path.join(sfxDirectory, file), wav(samples));
  index.push({ id: item.id, file, ko: item.ko, en: item.en, tags: item.tags, source: "synth",
    durationSec: Math.round((samples.length / SR) * 1000) / 1000, peakSec: peakSecond(samples, SR) });
}
for (const [game, name, ko, en, tags] of GAME_SFX) {
  const source = path.join(GAMES[game], name);
  const file = `game/${game}-${name}`;
  await fs.copyFile(source, path.join(sfxDirectory, file));
  const samples = await decodeMono(ffmpeg, source, SR);
  index.push({ id: `${game}-${path.parse(name).name}`, file, ko, en, tags, source: game,
    durationSec: Math.round((samples.length / SR) * 1000) / 1000, peakSec: peakSecond(samples, SR) });
}
// Kenney 팩: node make-motion-sfx.mjs <kenney 내려받은 폴더(팩/x/…)> — 없으면 이미 넣어 둔 kenney/ 목록을 그대로 둔다
const kenneyDirectory = process.argv[2];
async function listAudio(directory) {
  const out = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await listAudio(full));
    else if (/\.(ogg|wav)$/i.test(entry.name)) out.push(full);
  }
  return out;
}
if (kenneyDirectory) {
  let kept = 0;
  let skipped = 0;
  for (const pack of await fs.readdir(kenneyDirectory)) {
    const files = await listAudio(path.join(kenneyDirectory, pack, "x")).catch(() => []);
    if (!files.length) continue;
    await fs.mkdir(path.join(sfxDirectory, "kenney", pack), { recursive: true });
    const license = path.join(kenneyDirectory, pack, "x", "License.txt");
    await fs.copyFile(license, path.join(sfxDirectory, "kenney", pack, "License.txt")).catch(() => {});
    for (const source of files) {
      const name = path.basename(source);
      const rule = KENNEY_RULES.find(([p, pattern]) => p === pack && pattern.test(name));
      if (!rule) { skipped++; continue; }
      const samples = await decodeMono(ffmpeg, source, SR);
      const durationSec = Math.round((samples.length / SR) * 1000) / 1000;
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      // 너무 길거나 거의 안 들리는 소리는 뺀다(징글만 8초까지)
      if (durationSec > (pack === "music-jingles" ? 8 : 6) || peak < 0.05) { skipped++; continue; }
      const file = `kenney/${pack}/${name}`;
      await fs.copyFile(source, path.join(sfxDirectory, file));
      index.push({ id: `kenney-${pack}-${path.parse(name).name}`, file, ko: rule[2].map((tag) => SFX_TAGS[tag].split(" — ")[0]).join("·"),
        en: `${pack} ${path.parse(name).name}`, tags: rule[2], source: "kenney", durationSec, peakSec: peakSecond(samples, SR) });
      kept++;
    }
  }
  console.log(`Kenney ${kept}개 넣음, ${skipped}개 뺌`);
} else {
  const previous = JSON.parse(await fs.readFile(path.join(sfxDirectory, "index.json"), "utf8").catch(() => "[]"));
  index.push(...previous.filter((item) => item.source === "kenney"));
}
for (const item of index) for (const tag of item.tags) if (!SFX_TAGS[tag]) throw new Error(`정의되지 않은 태그: ${tag} (${item.id})`);
await fs.writeFile(path.join(sfxDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
await fs.writeFile(path.join(sfxDirectory, "tags.json"), `${JSON.stringify(SFX_TAGS, null, 2)}\n`);
console.log(`효과음 ${index.length}개 → ${sfxDirectory}`);
