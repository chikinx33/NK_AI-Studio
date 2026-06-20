const fs = require('fs');
const cp = require('child_process');

function isStaged(path) {
  try {
    const out = cp.execSync('git diff --name-only --cached', { encoding: 'utf8' });
    return out.split(/\r?\n/).some((l) => l.trim() === path);
  } catch (_) { return false; }
}

function bumpVersion(file) {
  let txt = fs.readFileSync(file, 'utf8');
  const re = /config\.APP_VERSION\s*=\s*'(\d+)\.(\d+)'/;
  const m = txt.match(re);
  if (!m) return null;
  const maj = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const next = `${maj}.${min + 1}`;
  txt = txt.replace(re, `config.APP_VERSION = '${next}'`);
  fs.writeFileSync(file, txt, 'utf8');
  cp.execSync(`git add "${file}"`);
  process.stdout.write(`pre-commit: version bumped to ${next}\n`);
  return next;
}

// 캐시버스팅: HTML 의 로컬 에셋 참조(?v=X.Y)를 새 버전으로 일괄 갱신한다.
// 스크립트 태그에 버전 쿼리가 없으면 브라우저가 옛 JS 를 캐시해 배포가 화면에 안 보이는
// 문제가 반복됐다(예: pipeline-scene-row.js). config.js 버전과 ?v= 를 묶어 항상 함께 무효화.
function bumpHtmlAssetVersions(next) {
  const dir = 'prototype';
  let htmlFiles = [];
  try {
    htmlFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => `${dir}/${f}`);
  } catch (_) { return; }
  htmlFiles.forEach((file) => {
    let txt = fs.readFileSync(file, 'utf8');
    if (!/\?v=\d+\.\d+/.test(txt)) return; // 버전 쿼리를 쓰는 페이지만 갱신
    const updated = txt.replace(/\?v=\d+\.\d+/g, `?v=${next}`);
    if (updated === txt) return;
    fs.writeFileSync(file, updated, 'utf8');
    cp.execSync(`git add "${file}"`);
    process.stdout.write(`pre-commit: asset cache-bust updated in ${file}\n`);
  });
}

function main() {
  const target = 'prototype/js/config.js';
  try {
    if (!fs.existsSync(target)) return;
    if (!isStaged(target)) {
      const next = bumpVersion(target);
      if (next) bumpHtmlAssetVersions(next);
    }
  } catch (e) {
    process.stderr.write(`pre-commit bump failed: ${e.message}\n`);
    process.exit(1);
  }
}

main();
