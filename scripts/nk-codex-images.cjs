const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { CodexClient, imageMime } = require('./lib/codex-client.cjs');

const API = 'https://nkstudio.org/api/codex-images';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function connectorRequest(token, body, multipart = false) {
  const response = await fetch(API, { method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'X-NK-Image-Connector': token, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body), redirect: 'error' });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'connector_request_failed');
    error.status = response.status;
    throw error;
  }
  return data;
}

async function referencePaths(payload, work) {
  const paths = [];
  for (const [index, item] of (payload.referenceImages || []).entries()) {
    const url = String(item.imageDataUrl || '');
    let bytes;
    if (/^data:image\/(png|jpeg|webp);base64,/.test(url)) {
      bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    } else {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['storage.googleapis.com', 'nkstudio.org'].includes(parsed.hostname)
        || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) throw new Error('reference_image_unavailable');
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
      if (!response.ok || Number(response.headers.get('Content-Length')) > 8 * 1024 * 1024) throw new Error('reference_image_unavailable');
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('reference_image_unavailable'); }
        chunks.push(Buffer.from(value));
      }
      bytes = Buffer.concat(chunks);
    }
    const mime = imageMime(bytes);
    if (!mime || bytes.length > 8 * 1024 * 1024) throw new Error('reference_image_unavailable');
    const target = path.join(work, `reference-${index}.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'}`);
    fs.writeFileSync(target, bytes, { mode: 0o600 });
    paths.push(target);
  }
  return paths;
}

async function main() {
  const root = process.env.NK_IMAGE_CONNECTOR_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'NKStudio', 'CodexImages');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const profileFile = path.join(root, 'profile.json');
  let profile = {};
  if (fs.existsSync(profileFile) && !process.argv.includes('--new-profile')) profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  if (!profile.id) {
    profile = { id: crypto.randomUUID(), token: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(profileFile, JSON.stringify(profile), { mode: 0o600 });
  }
  const home = path.join(root, 'profiles', profile.id, 'auth');
  const workRoot = path.join(root, 'profiles', profile.id, 'images');
  const client = new CodexClient({ binary: process.env.NK_CODEX_BINARY || 'codex', home, cwd: workRoot });
  await client.initialize();
  let account;
  let loginUrl = '';
  let message = 'ChatGPT 계정 확인 중 / Checking your ChatGPT account';
  try { account = await client.subscriptionAccount(); } catch {
    const login = await client.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true });
    loginUrl = login.authUrl;
    if (!loginUrl || !/^https:\/\/(auth\.openai\.com|chatgpt\.com)\//.test(loginUrl)) throw new Error('invalid_codex_login_url');
    message = '본인 ChatGPT 구독 계정으로 로그인해 주세요 / Sign in with your own ChatGPT subscription';
  }
  const tokenHash = crypto.createHash('sha256').update(profile.token).digest('hex');
  const nonce = crypto.randomBytes(24).toString('hex');
  let paired = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'GET' || ![`/${nonce}`, `/${nonce}/status`].includes(request.url)) {
      response.writeHead(404); return response.end();
    }
    const nkUrl = `https://nkstudio.org/codex-connect.html#connector=${tokenHash}&email=${encodeURIComponent(account?.email || '')}&plan=${encodeURIComponent(account?.planType || '')}`;
    if (request.url.endsWith('/status')) {
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ email: account?.email || '', plan: account?.planType || '', loginUrl, nkUrl: account ? nkUrl : '', paired, message }));
    }
    const scriptNonce = crypto.randomBytes(16).toString('hex');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`);
    response.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NKStudio 이미지 구독 연결</title>
      <style>[hidden]{display:none!important}body{background:#10141d;color:#e6edf8;font:16px system-ui;max-width:560px;margin:9vh auto;padding:24px}h1{font-size:25px}a{display:block;background:#1367d8;color:white;padding:14px;border-radius:10px;margin:18px 0;text-decoration:none}p{line-height:1.7}.muted{color:#9caac3}</style>
      <h1>NKStudio · ChatGPT 이미지 연결</h1><p id="state">${escapeHtml(message)}</p><p id="account"></p>
      <a id="login" href="${escapeHtml(loginUrl || '#')}" target="_blank" rel="noopener noreferrer" ${account ? 'hidden' : ''}>① 내 ChatGPT로 로그인 / Sign in</a>
      <a id="connect" href="${escapeHtml(account ? nkUrl : '#')}" target="_blank" rel="noopener noreferrer" ${account ? '' : 'hidden'}>② NKStudio 계정에 연결 / Connect NKStudio</a>
      <p class="muted">최초 연결 후 NKStudio에서 생성 버튼을 누르면 이미지가 자동 저장됩니다. 연결 프로그램이 실행 중이어야 합니다.<br>After setup, generate and save images from NKStudio. Keep this connector running.</p>
      <script nonce="${scriptNonce}">setInterval(async()=>{try{const r=await fetch(location.pathname+'/status');const s=await r.json();document.getElementById('state').textContent=s.message;document.getElementById('account').textContent=s.email?(s.email+' · '+s.plan):'';document.getElementById('login').hidden=!!s.email;document.getElementById('connect').hidden=!s.nkUrl;document.getElementById('connect').href=s.nkUrl||'#';if(s.paired)document.getElementById('connect').textContent='연결 완료 · NKStudio 열기 / Open NKStudio';}catch{}},2000)</script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const setupUrl = `http://127.0.0.1:${server.address().port}/${nonce}`;
  // Setup URL contains no OpenAI credential or worker token.
  console.log('NKSTUDIO_SETUP_URL=' + setupUrl);
  if (!process.argv.includes('--no-browser')) {
    if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', setupUrl], { windowsHide: true, stdio: 'ignore' }).unref();
  }
  let stopping = false;
  const stop = () => { stopping = true; client.close(); server.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while (!stopping) {
    try {
      try { account = await client.subscriptionAccount(); loginUrl = ''; } catch (error) {
        account = null;
        message = error.message === 'chatgpt_image_plan_required'
          ? '이미지 생성을 지원하는 ChatGPT 구독이 필요합니다 / A supported ChatGPT subscription is required'
          : 'ChatGPT 로그인이 필요합니다 / ChatGPT sign-in is required';
        await sleep(3000); continue;
      }
      const heartbeat = await connectorRequest(profile.token, { operation: 'heartbeat', authMode: 'chatgpt', email: account.email, plan: account.planType });
      if (profile.userId && profile.userId !== heartbeat.userId) throw new Error('connector_owner_changed');
      if (!profile.userId) {
        profile.userId = heartbeat.userId;
        fs.writeFileSync(profileFile, JSON.stringify(profile), { mode: 0o600 });
      }
      paired = true;
      message = `연결 완료 · NKStudio ${profile.userId} / Connected. Images will save automatically.`;
      const job = heartbeat.job;
      if (job) {
        const heartbeatTimer = setInterval(() => connectorRequest(profile.token, { operation: 'heartbeat', busy: true,
          authMode: 'chatgpt', email: account?.email || '', plan: account?.planType || '' }).catch(() => {}), 15000);
        try {
        if (!/^[a-f0-9-]{36}$/.test(job.id)) throw new Error('invalid_job_id');
        const work = path.join(workRoot, job.id);
        fs.mkdirSync(work, { recursive: true, mode: 0o700 });
        message = '이미지 생성 중 / Generating image';
        let image;
        try {
          const references = await referencePaths(job.payload, work);
          image = await client.generate({ ...job.payload, referencePaths: references });
        } catch (error) {
          await connectorRequest(profile.token, { operation: 'failed', jobId: job.id, error: error.message });
          message = '이미지 생성 실패 · NKStudio에서 안내를 확인해 주세요 / See NKStudio for the error';
          continue;
        }
        const output = path.join(work, 'generated-image');
        fs.writeFileSync(output, image.bytes, { mode: 0o600 });
        // Retry storage only, always with the same job and image. Never repeat
        // generation after a network failure or quota error.
        let saved = false;
        for (let retry = 0; retry < 5 && !stopping; retry++) {
          const form = new FormData();
          form.set('jobId', job.id);
          form.set('file', new Blob([image.bytes], { type: image.mimeType }), 'generated-image');
          try {
            await connectorRequest(profile.token, form, true);
            saved = true; break;
          } catch (error) {
            if ([403,404].includes(error.status)) break;
            await sleep((retry + 1) * 3000);
          }
        }
        if (saved) {
          // Remove only files this job created; no recursive path operations.
          for (const filename of ['generated-image', ...fs.readdirSync(work).filter(name => /^reference-\d+\.(png|jpg|webp)$/.test(name))]) {
            fs.rmSync(path.join(work, filename), { force: true });
          }
          message = '이미지 자동 저장 완료 / Image saved automatically';
        } else {
          message = '저장 연결 오류 · 생성 이미지는 이 PC에 보존했습니다 / Image retained on this PC after a storage error';
        }
        } finally { clearInterval(heartbeatTimer); }
      }
    } catch (error) {
      paired = false;
      if (error.message === 'connector_owner_changed') { message = '계정이 다릅니다. 새 연결 프로필을 사용해 주세요 / Use a new connector profile for another account'; stop(); break; }
      message = error.message === 'connector_not_paired'
        ? 'NKStudio 계정에 연결해 주세요 / Connect your NKStudio account'
        : '플랫폼 연결 대기 중 / Waiting for NKStudio connection';
    }
    await sleep(4000);
  }
}
if (require.main === module) main().catch(error => {
  console.error('NKStudio image connector could not start: ' + (/^[a-z0-9_]+$/.test(error.message) ? error.message : 'connector_start_failed'));
  process.exitCode = 1;
});
module.exports = { referencePaths, connectorRequest };
