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
  if (!m) return false;
  const maj = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const next = `${maj}.${min + 1}`;
  txt = txt.replace(re, `config.APP_VERSION = '${next}'`);
  fs.writeFileSync(file, txt, 'utf8');
  cp.execSync(`git add "${file}"`);
  process.stdout.write(`pre-commit: version bumped to ${next}\n`);
  return true;
}

function main() {
  const target = 'prototype/js/config.js';
  try {
    if (!fs.existsSync(target)) return;
    if (!isStaged(target)) {
      bumpVersion(target);
    }
  } catch (e) {
    process.stderr.write(`pre-commit bump failed: ${e.message}\n`);
    process.exit(1);
  }
}

main();
