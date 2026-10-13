// 디렉터 플레이북(nk-cf-director 스킬) → 사이트 함수용 모듈.
// 대화형 디렉터(A, Managed Agents)와 단계 화면(B, /api/director/assist)이 같은 제작 규칙을 쓰도록
// 스킬 reference 문서를 원본으로 두고 사이트 쪽 사본을 이 스크립트로만 만든다.
//   node scripts/sync-director-playbook.mjs          사본 갱신
//   node scripts/sync-director-playbook.mjs --check  사본이 원본과 다르면 실패(테스트가 같은 검사를 한다)
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SKILL = "director/skills/nk-cf-director/reference";
export const PLAYBOOK_TARGET = "prototype/functions/api/_shared/director-playbook.js";
export const PLAYBOOK_SOURCES = {
  PLAYBOOK_RULES: "rules.md",
  PLAYBOOK_CONTI: "conti-and-prompt.md",
  PLAYBOOK_SEEDANCE: "seedance.md",
  PLAYBOOK_QA: "qa-checklist.md",
};

const readSource = (file) => fs.readFileSync(path.join(root, SKILL, file), "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").trim();

export function buildPlaybookModule() {
  const lines = [
    "// 자동 생성 파일 — 손으로 고치지 않는다.",
    `// 원본: ${SKILL}/*.md · 갱신: node scripts/sync-director-playbook.mjs`,
    "",
  ];
  for (const [name, file] of Object.entries(PLAYBOOK_SOURCES)) {
    lines.push(`// ${file}`, `export const ${name} = ${JSON.stringify(readSource(file))};`, "");
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const out = path.join(root, PLAYBOOK_TARGET);
  const next = buildPlaybookModule();
  const cur = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (process.argv.includes("--check")) {
    if (cur !== next) { console.error(`${PLAYBOOK_TARGET} 가 스킬 원본과 다릅니다. node scripts/sync-director-playbook.mjs 를 실행하세요.`); process.exit(1); }
    console.log("director playbook: 최신");
  } else {
    fs.writeFileSync(out, next, "utf8");
    console.log(`${PLAYBOOK_TARGET} 갱신`);
  }
}
