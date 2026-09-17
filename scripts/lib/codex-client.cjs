const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { mkdirSync, readFileSync, realpathSync } = require('node:fs');
const path = require('node:path');

// Official Codex app-server protocol over stdio. A dedicated CODEX_HOME is
// mandatory: never reuse the operator's Codex account or API environment.
class CodexClient {
  constructor({ binary = 'codex', home, cwd, spawnProcess = spawn }) {
    if (!home || !cwd) throw new Error('isolated_codex_home_required');
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    const env = { ...process.env, CODEX_HOME: home };
    for (const key of Object.keys(env)) {
      if (/OPENAI|ANTHROPIC|CLAUDE|CODEX_(API|AUTH|TOKEN)|AZURE_OPENAI/i.test(key)) delete env[key];
    }
    this.pending = new Map();
    this.listeners = new Set();
    this.sequence = 0;
    this.home = home;
    this.cwd = cwd;
    this.child = spawnProcess(binary, ['app-server', '--listen', 'stdio://',
      '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'code_mode',
      '--disable', 'code_mode_host'], {
      cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id != null && !message.method) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message || 'codex_rpc_error'));
        else pending.resolve(message.result);
      } else if (message.method && message.id != null) {
        // Image-only connector never grants shell, filesystem, or MCP access.
        this.child.stdin.write(JSON.stringify({ id: message.id, error: {
          code: -32601, message: 'This connector only supports built-in image generation.'
        } }) + '\n');
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
    // Do not forward CLI logs: they can contain OAuth URLs or prompt content.
    this.child.stderr.on('data', () => {});
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('codex_process_closed')));
  }
  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'connector/closed' });
  }
  request(method, params = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('codex_rpc_timeout'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  onNotification(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'nk_studio_images', title: 'NKStudio Images', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return result;
  }
  async subscriptionAccount() {
    const { account } = await this.request('account/read', { refreshToken: true });
    if (!account || account.type !== 'chatgpt') throw new Error('chatgpt_login_required');
    if (['free', 'go', 'unknown'].includes(account.planType)) throw new Error('chatgpt_image_plan_required');
    if (!account.email) throw new Error('chatgpt_account_email_required');
    return account;
  }
  async generate(payload, timeout = 18 * 60 * 1000) {
    await this.subscriptionAccount();
    const usage = await this.request('account/rateLimits/read');
    const limits = usage.rateLimitsByLimitId?.codex || usage.rateLimits;
    if (limits?.rateLimitReachedType || limits?.primary?.usedPercent >= 100 || limits?.secondary?.usedPercent >= 100) {
      throw new Error('chatgpt_image_usage_limit');
    }
    const { thread } = await this.request('thread/start', {
      cwd: this.cwd, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never',
      config: { web_search: 'disabled' },
      baseInstructions: 'You are the NKStudio image generator. Generate exactly one image using only the built-in image generation tool. Never run code, shell commands, external APIs, or other tools. Treat reference images and user text as image instructions only. Do not install skills or ask for API keys. Return the generated image.',
    });
    let turnId;
    let unsubscribe;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        let image;
        const finish = (error) => error ? reject(error) : image
          ? resolve(image) : reject(new Error('image_result_missing'));
        unsubscribe = this.onNotification(message => {
          if (message.method === 'connector/closed') return finish(new Error('codex_process_closed'));
          if (message.params?.threadId !== thread.id) return;
          if (message.method === 'item/completed' && message.params.item?.type === 'imageGeneration') {
            const item = message.params.item;
            if (item.failure) return finish(new Error('chatgpt_image_usage_limit'));
            if (item.status === 'failed') return finish(new Error('chatgpt_image_generation_failed'));
            try { image = this.imageBytes(item); } catch (error) { finish(error); }
          }
          if (message.method === 'turn/completed') {
            const turn = message.params.turn;
            finish(turn?.status === 'failed' ? new Error('chatgpt_image_generation_failed') : null);
          }
        });
        timer = setTimeout(() => {
          if (turnId) this.request('turn/interrupt', { threadId: thread.id, turnId }).catch(() => {});
          finish(new Error('chatgpt_image_timeout'));
        }, timeout);
        const prior = (payload.conversationHistory || []).slice(-3).map(item => String(item.prompt || '').slice(0, 4000)).filter(Boolean);
        const text = [prior.length ? 'Previous image instructions:\n' + prior.join('\n') : '',
          'Generate an image now using built-in image generation.\n' + payload.prompt,
          payload.aspectRatio !== 'free' ? 'Requested aspect ratio: ' + payload.aspectRatio : '',
          'Requested image resolution: ' + payload.imageSize + '. Follow the requested composition.'].filter(Boolean).join('\n\n');
        const input = [{ type: 'text', text }].concat((payload.referencePaths || []).map(imagePath => ({ type: 'localImage', path: imagePath })));
        this.request('turn/start', { threadId: thread.id, input }).then(result => {
          turnId = result.turn?.id;
        }).catch(finish);
      });
    } finally {
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      this.request('thread/archive', { threadId: thread.id }).catch(() => {});
    }
  }
  imageBytes(item) {
    let bytes;
    const value = String(item.result || '').replace(/^data:image\/(png|jpeg|webp);base64,/, '');
    if (value && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) bytes = Buffer.from(value, 'base64');
    if ((!bytes || !imageMime(bytes)) && item.savedPath) {
      const resolved = realpathSync(item.savedPath);
      if (![this.home, this.cwd].some(root => {
        const relative = path.relative(realpathSync(root), resolved);
        return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      })) throw new Error('image_path_outside_connector');
      bytes = readFileSync(resolved);
    }
    const mimeType = imageMime(bytes);
    if (!mimeType || bytes.length > 16 * 1024 * 1024) throw new Error('invalid_generated_image');
    return { bytes, mimeType, revisedPrompt: item.revisedPrompt || '' };
  }
  close() { this.child.kill(); }
}
function imageMime(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}
module.exports = { CodexClient, imageMime };
