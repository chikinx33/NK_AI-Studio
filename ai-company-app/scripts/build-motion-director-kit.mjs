// 감독(장면 코드 작성) 지침을 사이트 함수가 읽을 수 있는 JS 모듈로 만든다.
// motion-kit/KIT.md·examples/·sfx/index.json 을 고치면 이 스크립트를 다시 돌린다(테스트가 최신인지 검사한다).
//   node ai-company-app/scripts/build-motion-director-kit.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitDirectory = path.join(projectDirectory, "motion-kit");
export const OUTPUT = path.resolve(projectDirectory, "..", "prototype", "functions", "api", "_shared", "motion-director-kit.js");

const read = async (file) => (await fs.readFile(path.join(kitDirectory, file), "utf8")).replace(/^﻿/, "").replace(/\r\n/g, "\n");

export async function buildMotionDirectorKit() {
  const guide = await read("KIT.md");
  const examples = [];
  for (const [id, label] of [
    ["nb_s1_01", "NEKOBAN 1편 — 실제 캐릭터 스프라이트로 만든 이야기 장면 → 실제 플레이 화면 꽉 채우기 → 끝 카드 (빠른 음악이라 h(i)=b(2i))"],
    ["el_s1_01", "ELIDUS 1편 — DOM으로 판을 직접 짜서 폭발·번짐·카메라 펀치 → 실제 화면 → 끝 카드"],
  ]) {
    examples.push({
      id,
      label,
      theme: await read(`examples/${id}/theme.css`),
      html: await read(`examples/${id}/index.html`),
      episode: JSON.stringify(JSON.parse(await read(`examples/${id}/episode.json`))),
    });
  }
  const sfx = JSON.parse(await read("sfx/index.json"))
    .map((item) => `${item.file} | ${item.ko} | ${item.tags.join(",")} | ${item.durationSec}s, 타격 ${item.peakSec}s`)
    .join("\n");
  const source = `// 자동 생성 파일 — 손으로 고치지 말 것. 원본: ai-company-app/motion-kit (KIT.md, examples/, sfx/index.json)
// 다시 만들기: node ai-company-app/scripts/build-motion-director-kit.mjs
export const MOTION_KIT_GUIDE = ${JSON.stringify(guide)};
export const MOTION_KIT_EXAMPLES = ${JSON.stringify(examples)};
export const MOTION_KIT_SFX = ${JSON.stringify(sfx)};
`;
  return source;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await buildMotionDirectorKit();
  await fs.writeFile(OUTPUT, source);
  console.log(`감독 지침 → ${OUTPUT} (${Math.round(source.length / 1024)}KB)`);
}
