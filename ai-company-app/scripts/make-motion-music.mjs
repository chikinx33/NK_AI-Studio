// 모션 키트 기본 배경음악을 만든다(한 번 실행해 결과 파일을 커밋한다).
// 출처: OpenGameArt 의 라이선스가 CC0 하나뿐인 곡만(2026-10-21 엔케: 출처 표기 필요·비상업용 금지).
// 짧은 루프는 이어 붙이고 긴 곡은 자른 뒤 ogg 로 줄이고, 곡마다 박자표를 미리 만든다.
//   node scripts/make-motion-music.mjs <내려받은 곡 폴더(1/track.mp3 …)>
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beatsForFile } from "./motion-beats.mjs";
import { pickFfmpeg } from "./render-motion-page.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const musicDirectory = path.join(projectDirectory, "motion-kit", "music");
const TARGET_SEC = 130;

// [폴더 번호, id, 곡 이름, 작가, OpenGameArt 페이지, 분위기(한), 분위기(영)]
const TRACKS = [
  [1, "lofi-chill", "Chill Lofi Inspired", "omfgdude", "chill-lofi-inspired", "로파이·재즈 피아노, 편안하고 세련됨", "lofi jazzy piano, relaxed"],
  [2, "lofi-cup-of-tea", "A Cup of Tea", "TAD", "lofi-compilation", "로파이 비트, 잔잔한 일상", "lofi beat, cozy everyday"],
  [3, "lofi-cat-cafe", "Cat Caffe", "TAD", "lofi-compilation", "로파이, 귀엽고 아늑함", "lofi, cute and cozy"],
  [4, "lofi-countryside", "Countryside", "TAD", "lofi-compilation", "로파이, 시골·자연", "lofi, countryside nature"],
  [5, "lofi-hiphop", "Lofi Hip Hop", "omfgdude", "lofi-hip-hop", "로파이 힙합, 차분한 집중", "lofi hip hop, calm focus"],
  [6, "lullaby-bells", "Happy Lullaby", "cynicmusic", "happy-lullaby-song17", "종소리, 밝고 포근함(어린이·퍼즐)", "bells, happy and gentle"],
  [7, "piano-snowfall", "Snowfall", "Kistol", "snowfall", "피아노 왈츠, 서정적", "piano waltz, lyrical"],
  [8, "synthwave-calm", "Lifewave", "cynicmusic", "calm-relax-1-synthwave-421k", "잔잔한 신스·피아노, 휴식", "calm synth and piano"],
  [9, "guitar-sunset", "Sunset Plains", "Yoiyami", "sunset-plains", "어쿠스틱 기타, 평화로운 풍경", "acoustic guitar, peaceful"],
  [10, "guitar-nylon", "Etirwer", "Kistol", "etirwer", "나일론 기타, 소박함", "nylon guitar, simple"],
  [11, "downtempo-snow", "November Snow", "cynicmusic", "november-snow", "다운템포 전자 피아노, 차분", "downtempo electronic piano"],
  [12, "happy-clappy", "Happy Clappy Loop", "OwlishMedia", "happy-clappy-loop", "박수 피아노, 밝고 신남", "clapping piano, cheerful"],
  [13, "kids-march", "Children's March", "CleytonKauffman", "childrens-march-theme", "어린이 행진곡, 귀엽고 유쾌", "children's march, cute fun"],
  [14, "funk-groove", "Funked Up", "Joth", "funked-up", "70년대 펑크 그루브", "70s funk groove"],
  [15, "funk-night", "Wednesday Night", "Zane", "wednesday-night-funk-fusion", "펑크 퓨전, 세련된 경쾌함", "funk fusion, stylish upbeat"],
  [16, "funk-factory", "Rhythm Factory", "Zane", "rhythm-factory", "펑키, 에너지·재미", "funky, energetic fun"],
  [17, "synth-sky", "Sky Blue Street", "MintoDog", "sky-blue-street", "신스, 상쾌하고 긍정적", "synth, fresh and positive"],
  [18, "house-progress", "Progress", "josepharaoh99", "progress", "하우스, 희망·성장", "house, hopeful progress"],
  [19, "house-ocean", "Pacific Ocean", "josepharaoh99", "pacific-ocean", "트랩 하우스, 밝고 웅장함", "trap house, bright and big"],
  [20, "funk-bots", "Danza de Bots II", "LushoGames", "danza-d-bots-ii", "전자 펑크, 장난스러움", "electronic funk, playful"],
  [21, "bossa", "8bit Bossa", "Joth", "bossa-nova", "보사노바(8비트), 여유", "8-bit bossa nova, laid-back"],
  [22, "jazz-blues", "Jazzy Blues", "LushoGames", "jazzy-blues", "재즈 블루스, 여유롭고 멋짐", "jazz blues, cool"],
  [23, "piano-inspiring", "Pixelsphere Megamix", "glitchart", "the-hex-november-snow-the-charm-pixelsphere-megamix-steven-ruud-cynicmusic-remixed", "피아노, 감동·동기 부여", "piano, inspiring motivational"],
  [24, "piano-midnight", "Midnight", "AR", "midnight", "피아노·신스, 잔잔한 감동", "piano and synth, quietly moving"],
  [25, "piano-emotional", "Emotional Piano Loop", "extenz", "emotional-piano-loop", "피아노, 슬프고 진지함", "piano, sad and serious"],
  [26, "breakbeat-energy", "Awake Megawall", "cynicmusic", "awake-megawall-10", "브레이크비트, 강한 에너지", "breakbeat, intense energy"],
  [27, "rock-action", "Action Track", "LushoGames", "action-track", "록·테크노, 박진감", "rock techno, action"],
  [28, "techno-cute", "Tower Defense Theme", "DST", "tower-defense-theme", "테크노, 귀엽고 빠름", "techno, cute and quick"],
  [29, "eurobeat-fever", "Fever Stadium", "MintoDog", "fever-stadium", "유로비트, 질주·흥분", "eurobeat, racing excitement"],
];

function run(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args.map(String), { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("exit", (code) => (code === 0 ? resolve(err) : reject(new Error(err.slice(-400)))));
  });
}

async function durationOf(ffmpeg, file) {
  const text = await run(ffmpeg, ["-hide_banner", "-i", file, "-f", "null", "-"]).catch((e) => String(e.message));
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

const sourceDirectory = process.argv[2];
if (!sourceDirectory) {
  console.error("사용법: node scripts/make-motion-music.mjs <내려받은 곡 폴더>");
  process.exit(1);
}
const ffmpeg = pickFfmpeg();
await fs.mkdir(musicDirectory, { recursive: true });
const index = [];
for (const [folder, id, title, author, slug, ko, en] of TRACKS) {
  const files = await fs.readdir(path.join(sourceDirectory, String(folder)));
  const source = path.join(sourceDirectory, String(folder), files.find((f) => f.startsWith("track.")));
  const sourceSec = await durationOf(ffmpeg, source);
  const loops = sourceSec > 0 && sourceSec < TARGET_SEC ? Math.ceil(TARGET_SEC / sourceSec) - 1 : 0;
  const out = path.join(musicDirectory, `${id}.ogg`);
  await run(ffmpeg, ["-y", "-v", "error", ...(loops ? ["-stream_loop", loops] : []), "-i", source, "-t", TARGET_SEC,
    "-af", `afade=t=out:st=${TARGET_SEC - 3}:d=3`, "-ac", 2, "-ar", 44100, "-c:a", "libvorbis", "-q:a", 4, out]);
  const { beats, bpm } = await beatsForFile(ffmpeg, out);
  await fs.writeFile(path.join(musicDirectory, `${id}.beats.js`), `var B=${JSON.stringify(beats)};`);
  await fs.writeFile(path.join(musicDirectory, `${id}.beats.json`), JSON.stringify(beats));
  const entry = {
    id, title, ko, en, file: `music/${id}.ogg`, beatsScript: `music/${id}.beats.js`, beats: `music/${id}.beats.json`,
    bpm: Math.round(bpm * 10) / 10, firstBeat: beats[0], durationSec: Math.round((await durationOf(ffmpeg, out)) * 10) / 10,
    looped: loops > 0, author, license: "CC0", source: `https://opengameart.org/content/${slug}`,
  };
  index.push(entry);
  console.log(`${id}\t${entry.bpm} BPM\t${entry.durationSec}초${loops ? ` (루프 ${loops + 1}번)` : ""}`);
}
await fs.writeFile(path.join(musicDirectory, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
await fs.writeFile(path.join(musicDirectory, "LICENSE.md"), `﻿# 모션 키트 기본 배경음악 라이선스

모든 곡은 OpenGameArt.org 에서 라이선스가 **CC0(퍼블릭 도메인 헌정) 하나뿐**인 곡만 골랐다(2026-10-21 확인).
출처 표기 없이 상업적으로 쓸 수 있다. 곡별 작가·원본 페이지는 index.json 의 author·source.
https://creativecommons.org/publicdomain/zero/1.0/
`);
console.log(`배경음악 ${index.length}곡 → ${musicDirectory}`);
