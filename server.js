const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 14000;
const ROOT = path.join(__dirname, 'prototype');
const AGENT_VIDEO_ROOT = path.join(__dirname, 'tmp', 'agent-video');
const agentVideoJobs = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav'
};

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null;
  return p;
}

function sendFile(res, filePath, req) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    // ETag = mtime + size 기반 약한 검증자
    const etag = 'W/"' + crypto
      .createHash('sha1')
      .update(stat.mtimeMs + ':' + stat.size)
      .digest('base64')
      .slice(0, 16) + '"';
    // HTML은 항상 재검증, 정적 자산은 캐시 후 ETag로 304 검증
    const isHtml = ext === '.html';
    const cacheControl = isHtml
      ? 'no-cache'
      : 'public, max-age=0, must-revalidate';
    const ifNoneMatch = req && req.headers && req.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.writeHead(304, {
        'ETag': etag,
        'Cache-Control': cacheControl,
        'Access-Control-Allow-Origin': '*'
      });
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cacheControl,
      'ETag': etag,
      'Last-Modified': stat.mtime.toUTCString(),
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (_) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

async function postCompanySkillRenderCallback(job, status) {
  if (!job.callbackUrl || job.callbackDelivered) return;
  const token = String(process.env.COMPANY_SKILL_RENDERER_TOKEN || '').trim();
  if (!token) {
    job.error = 'COMPANY_SKILL_RENDERER_TOKEN 미설정';
    return;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Company-Skill-Render-Status': status
  };
  let body;
  if (status === 'completed') {
    headers['Content-Type'] = 'video/mp4';
    body = await fs.promises.readFile(job.outputPath);
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ error: job.error || 'Remotion 렌더 실패' });
  }
  const response = await fetch(job.callbackUrl, { method: 'POST', headers, body });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `렌더 콜백 실패 (HTTP ${response.status})`);
  }
  job.callbackDelivered = true;
}

function startAgentVideoRender(jobId, spec, res, callbackUrl = '') {
  const jobDirectory = path.join(AGENT_VIDEO_ROOT, jobId);
  const propsPath = path.join(jobDirectory, 'props.json');
  const outputPath = path.join(jobDirectory, 'raviok-agent-video.mp4');
  fs.mkdir(jobDirectory, { recursive: true }, (mkdirError) => {
    if (mkdirError) return sendJson(res, { error: mkdirError.message }, 500);
    fs.writeFile(propsPath, JSON.stringify({ spec }), 'utf8', (writeError) => {
      if (writeError) return sendJson(res, { error: writeError.message }, 500);
      const job = {
        id: jobId,
        status: 'rendering',
        progress: 1,
        outputPath,
        error: '',
        log: [],
        callbackUrl,
        callbackDelivered: false
      };
      agentVideoJobs.set(jobId, job);
      const script = path.join(__dirname, 'ai-company-app', 'scripts', 'render-agent-video.mjs');
      const child = spawn(process.execPath, [script, propsPath, outputPath], {
        cwd: path.join(__dirname, 'ai-company-app'),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const collect = (chunk) => {
        const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
        job.log.push(...lines);
        if (job.log.length > 80) job.log.splice(0, job.log.length - 80);
        for (const line of lines) {
          const match = line.match(/Rendered\s+(\d+)\/(\d+)/i) || line.match(/Rendering frame\s+(\d+)\/(\d+)/i);
          if (match) job.progress = Math.min(99, Math.max(job.progress, Math.round((Number(match[1]) / Number(match[2])) * 100)));
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.on('error', (error) => {
        job.status = 'error';
        job.error = error.message;
        void postCompanySkillRenderCallback(job, 'failed').catch((callbackError) => {
          job.log.push(String(callbackError.message || callbackError));
        });
      });
      child.on('exit', (code) => {
        fs.stat(outputPath, (statError, stat) => {
          if (code === 0 && !statError && stat.isFile() && stat.size > 0) {
            job.status = 'done';
            job.progress = 100;
            void postCompanySkillRenderCallback(job, 'completed').catch((callbackError) => {
              job.error = String(callbackError.message || callbackError);
              job.log.push(job.error);
            });
          } else {
            job.status = 'error';
            job.error = job.log.slice(-8).join('\n') || `Remotion 렌더 실패(exit=${code})`;
            void postCompanySkillRenderCallback(job, 'failed').catch((callbackError) => {
              job.log.push(String(callbackError.message || callbackError));
            });
          }
        });
      });
      sendJson(res, { jobId, status: 'rendering', progress: 1 });
    });
  });
}

const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url);
    let pathname = decodeURIComponent(parsed.pathname || '/');
    if (pathname === '/company-skill-render' && req.method === 'POST') {
      const expected = String(process.env.COMPANY_SKILL_RENDERER_TOKEN || '').trim();
      const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!expected) return sendJson(res, { error: 'COMPANY_SKILL_RENDERER_TOKEN 미설정' }, 503);
      const expectedHash = crypto.createHash('sha256').update(expected).digest();
      const suppliedHash = crypto.createHash('sha256').update(supplied).digest();
      if (!supplied || !crypto.timingSafeEqual(expectedHash, suppliedHash)) {
        return sendJson(res, { error: 'renderer_unauthorized' }, 401);
      }
      return readJsonBody(req)
        .then((body) => {
          const jobId = String(body?.jobId || '');
          const callbackUrl = String(body?.callbackUrl || '');
          if (!/^[0-9a-f-]{36}$/i.test(jobId) || !body?.spec || !Array.isArray(body.spec.scenes)) {
            return sendJson(res, { error: '유효한 SkillJob과 Agent Video 명세가 필요합니다.' }, 400);
          }
          let parsedCallback;
          try { parsedCallback = new URL(callbackUrl); } catch (_) { return sendJson(res, { error: '유효한 콜백 URL이 필요합니다.' }, 400); }
          if (!['https:', 'http:'].includes(parsedCallback.protocol)) {
            return sendJson(res, { error: 'HTTP(S) 콜백 URL만 사용할 수 있습니다.' }, 400);
          }
          const existing = agentVideoJobs.get(jobId);
          if (existing) {
            if (existing.status === 'done' && !existing.callbackDelivered) {
              existing.callbackUrl = callbackUrl;
              void postCompanySkillRenderCallback(existing, 'completed').catch((error) => {
                existing.error = String(error.message || error);
              });
            }
            return sendJson(res, { jobId, status: existing.status, accepted: true }, 202);
          }
          startAgentVideoRender(jobId, body.spec, res, callbackUrl);
        })
        .catch((error) => sendJson(res, { error: error.message || '요청을 읽지 못했습니다.' }, 400));
    }
    if (pathname === '/local-agent-video/render' && req.method === 'POST') {
      return readJsonBody(req)
        .then((body) => {
          if (!body || typeof body.spec !== 'object' || !Array.isArray(body.spec.scenes)) {
            return sendJson(res, { error: '유효한 Agent Video 명세가 필요합니다.' }, 400);
          }
          const jobId = crypto.randomUUID();
          startAgentVideoRender(jobId, body.spec, res);
        })
        .catch((error) => sendJson(res, { error: error.message || '요청을 읽지 못했습니다.' }, 400));
    }
    if (pathname === '/local-agent-video/status' && req.method === 'GET') {
      const jobId = String(new URL(req.url, 'http://localhost').searchParams.get('jobId') || '');
      const job = agentVideoJobs.get(jobId);
      if (!job) return sendJson(res, { error: '렌더 작업을 찾을 수 없습니다.' }, 404);
      return sendJson(res, {
        jobId,
        status: job.status,
        progress: job.progress,
        error: job.error || undefined,
        downloadUrl: job.status === 'done' ? `/local-agent-video/download?jobId=${encodeURIComponent(jobId)}` : undefined
      });
    }
    if (pathname === '/local-agent-video/download' && req.method === 'GET') {
      const jobId = String(new URL(req.url, 'http://localhost').searchParams.get('jobId') || '');
      const job = agentVideoJobs.get(jobId);
      if (!job || job.status !== 'done') return sendJson(res, { error: '완료된 렌더 파일을 찾을 수 없습니다.' }, 404);
      res.setHeader('Content-Disposition', 'attachment; filename="raviok-agent-video.mp4"');
      return sendFile(res, job.outputPath, req);
    }
    if (pathname === '/' || pathname === '/index.html') {
      const file = safeJoin(ROOT, 'index.html');
      if (!file) throw new Error('bad_path');
      return sendFile(res, file, req);
    }
    const filePath = safeJoin(ROOT, pathname.replace(/^\/+/, ''));
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }
    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        return sendFile(res, indexPath, req);
      }
      // Extensionless URL fallback: /terms → terms.html, /privacy → privacy.html
      if (err && !path.extname(filePath)) {
        const htmlPath = filePath + '.html';
        return sendFile(res, htmlPath, req);
      }
      return sendFile(res, filePath, req);
    });
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log('Local preview server listening at http://localhost:' + PORT + '/');
});
