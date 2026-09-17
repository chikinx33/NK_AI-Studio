const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('../ai-company-app/node_modules/esbuild');
const directory = path.resolve(__dirname, '../.wrangler/image-connector-package');
fs.mkdirSync(directory, { recursive: true });
esbuild.buildSync({ entryPoints: [path.resolve(__dirname, 'nk-codex-images.cjs')],
  outfile: path.join(directory, 'nk-image-connector.cjs'), bundle: true, platform: 'node', target: 'node22', format: 'cjs' });
const bundle = fs.readFileSync(path.join(directory, 'nk-image-connector.cjs'));
fs.writeFileSync(path.join(directory, 'nk-image-connector.sha256'), crypto.createHash('sha256').update(bundle).digest('hex') + '\n');
for (const name of ['Install-NKStudio-Images.ps1', 'Start-NKStudio-Images.cmd']) fs.copyFileSync(path.join(__dirname, name), path.join(directory, name));
console.log(directory);
