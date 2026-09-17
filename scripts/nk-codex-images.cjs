const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { CodexClient, imageMime } = require('./lib/codex-client.cjs');

const NK_ORIGIN = 'https://nkstudio.org';
const API = NK_ORIGIN + '/api/codex-images';
// 랜딩의 연결 모달이 이 PC의 연결 프로그램을 찾는 고정 주소. 연결 프로그램은 별도 창을 띄우지 않는다.
const LOCAL_PORT = 47831;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  const tokenHash = crypto.createHash('sha256').update(profile.token).digest('hex');
  let client;
  let ready = false;
  let account;
  let paired = false;
  let message = 'ChatGPT 계정 확인 중 / Checking your ChatGPT account';
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Host 는 루프백 고정 주소만(DNS 리바인딩 차단), 응답은 NKStudio 페이지에만 준다.
    // tokenHash 가 다른 사이트로 새면 남의 NKStudio 계정에 이 PC의 구독이 묶일 수 있다.
    if (request.headers.host !== `127.0.0.1:${LOCAL_PORT}` || request.headers.origin !== NK_ORIGIN) {
      response.writeHead(403); return response.end();
    }
    response.setHeader('Access-Control-Allow-Origin', NK_ORIGIN);
    response.setHeader('Vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.writeHead(204); return response.end();
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/status') {
      return response.end(JSON.stringify({ ready, signedIn: !!account, email: account?.email || '',
        plan: account?.planType || '', tokenHash: account ? tokenHash : '', paired, message }));
    }
    if (request.method === 'POST' && request.url === '/login') {
      if (!ready) { response.writeHead(503); return response.end(JSON.stringify({ error: 'connector_starting' })); }
      if (account) return response.end(JSON.stringify({ signedIn: true }));
      try {
        const login = await client.request('account/login/start', { type: 'chatgpt', useHostedLoginSuccessPage: true });
        if (!login.authUrl || !/^https:\/\/(auth\.openai\.com|chatgpt\.com)\//.test(login.authUrl)) throw new Error('invalid_codex_login_url');
        return response.end(JSON.stringify({ authUrl: login.authUrl }));
      } catch {
        response.writeHead(502); return response.end(JSON.stringify({ error: 'codex_login_unavailable' }));
      }
    }
    response.writeHead(404); return response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', error => reject(new Error(error.code === 'EADDRINUSE' ? 'connector_already_running' : 'connector_port_unavailable')));
    server.listen(LOCAL_PORT, '127.0.0.1', resolve);
  });
  console.log('NKStudio 이미지 연결 프로그램 실행 중 · NKStudio 이미지 생성의 \'연결\' 창에서 계속해 주세요.');
  console.log('NKStudio image connector is running. Continue in the Connect dialog on NKStudio. Keep this window open.');
  client = new CodexClient({ binary: process.env.NK_CODEX_BINARY || 'codex', home, cwd: workRoot });
  await client.initialize();
  ready = true;
  let stopping = false;
  const stop = () => { stopping = true; client.close(); server.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  while (!stopping) {
    try {
      try { account = await client.subscriptionAccount(); } catch (error) {
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
  // 로컬 주소를 열어 둔 채 남으면 모달이 멈춘 연결 프로그램을 실행 중으로 본다.
  process.exit(1);
});
module.exports = { referencePaths, connectorRequest };
