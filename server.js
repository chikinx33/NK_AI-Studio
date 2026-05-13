const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = 14000;
const ROOT = path.join(__dirname, 'prototype');

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

const server = http.createServer((req, res) => {
  try {
    const parsed = url.parse(req.url);
    let pathname = decodeURIComponent(parsed.pathname || '/');
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
