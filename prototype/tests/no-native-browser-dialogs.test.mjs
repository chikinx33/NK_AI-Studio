import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function walk(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, extensions);
    return extensions.has(path.extname(entry.name)) ? [full] : [];
  });
}

function rel(file) {
  return path.relative(cwd, file).replaceAll("\\", "/");
}

function executableLine(line) {
  return line
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\/\/.*$/, "");
}

test("사용자 확인과 입력은 브라우저 기본 confirm·prompt를 사용하지 않는다", () => {
  const legacyFiles = [
    path.join(cwd, "prototype/core.js"),
    path.join(cwd, "prototype/script.js"),
    ...walk(path.join(cwd, "prototype/ui"), new Set([".js"])),
    ...walk(path.join(cwd, "prototype/js/ui"), new Set([".js"])),
    ...walk(path.join(cwd, "prototype/js/service"), new Set([".js"])),
  ];
  const reactFiles = walk(path.join(cwd, "ai-company-app/src"), new Set([".ts", ".tsx"]));
  const violations = [];

  for (const file of [...legacyFiles, ...reactFiles]) {
    const source = fs.readFileSync(file, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      const code = executableLine(line);
      if (/\bwindow\.(?:confirm|prompt)\s*\(/.test(code)) {
        violations.push(`${rel(file)}:${index + 1} ${line.trim()}`);
      }
      if (legacyFiles.includes(file) && /(^|[^.\w])(?:confirm|prompt)\s*\(/.test(code)) {
        violations.push(`${rel(file)}:${index + 1} ${line.trim()}`);
      }
    });
    if (/\bnative(?:Alert|Confirm|Prompt)\b/.test(source)) violations.push(`${rel(file)}: native browser dialog bridge`);
  }

  assert.deepEqual(violations, [], `브라우저 기본 대화창 호출을 앱 모달로 바꿔 주세요:\n${violations.join("\n")}`);
});

test("레거시와 AI 회사 앱 모두 전역 alert를 서비스 모달로 연결한다", () => {
  const core = fs.readFileSync(path.join(cwd, "prototype/core.js"), "utf8");
  const main = fs.readFileSync(path.join(cwd, "ai-company-app/src/main.tsx"), "utf8");
  const appDialog = fs.readFileSync(path.join(cwd, "ai-company-app/src/lib/appDialog.tsx"), "utf8");
  const codexConnect = fs.readFileSync(path.join(cwd, "prototype/codex-connect.html"), "utf8");

  assert.match(core, /window\.alert = function \(message\)/);
  assert.match(core, /dialog\.alert\(message, \{ title: '알림' \}\)/);
  assert.match(main, /installAppDialogAlertBridge\(\)/);
  assert.match(main, /<AppDialogHost \/>/);
  assert.match(appDialog, /window\.alert = \(message\?: unknown\) => \{ void appDialog\.alert/);
  assert.match(codexConnect, /<script src="(?:\.\/)?core\.js/);
});
