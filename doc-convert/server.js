// NK_Studio 문서 변환기 (GCP Cloud Run 용)
//
// 하는 일은 딱 하나다: 받은 DOCX 를 LibreOffice 로 PDF 로 바꿔 돌려준다.
// ★문서를 만들지 않는다. 생성은 Workers(_render-docx.ts)가 하고 여기는 변환 전용이다.
//   이 경계를 흐리면 "PDF 만 모양이 다른" 사고가 다시 생긴다.
//
// 상태 없음: 파일은 /tmp 에만 잠깐 있다가 응답 후 지운다.
// 인증: Authorization: Bearer <DOC_CONVERT_TOKEN>. 토큰이 없으면 아무도 못 쓴다(공개 URL 이므로).

const http = require("http");
const { execFile } = require("child_process");
const { mkdtemp, writeFile, readFile, rm, readdir } = require("fs/promises");
const { tmpdir } = require("os");
const path = require("path");

const PORT = Number(process.env.PORT) || 8080;
const TOKEN = String(process.env.DOC_CONVERT_TOKEN || "").trim();
const MAX_BYTES = Number(process.env.DOC_CONVERT_MAX_BYTES || 20 * 1024 * 1024);
// Cloud Run 요청 타임아웃(60s)보다 먼저 끊어야 호출자가 이유를 받는다.
const SOFFICE_TIMEOUT_MS = Number(process.env.DOC_CONVERT_TIMEOUT_MS || 50_000);
const SOFFICE = process.env.SOFFICE_BIN || "soffice";

// P0 범위: DOCX → PDF 만. HWPX 는 LibreOffice 확장(H2Orestart)이 필요하고 재현 품질을
// 보장할 수 없어서 설계서 §6.4 에서 범위 밖으로 뒀다. 조용히 이상한 PDF 를 내놓지 않는다.
const SUPPORTED_SOURCES = new Set(["docx"]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** 길이가 달라도 같은 시간이 걸리게 비교(타이밍으로 토큰을 알아내지 못하게). */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function authorized(req) {
  if (!TOKEN) return false; // 토큰 미설정 = 아무도 못 쓴다(실수로 공개되는 쪽이 더 위험하다)
  const header = String(req.headers.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return !!match && safeEqual(match[1].trim(), TOKEN);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error(`문서가 너무 큽니다(${MAX_BYTES} 바이트 초과).`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function runSoffice(args) {
  return new Promise((resolve, reject) => {
    execFile(SOFFICE, args, { timeout: SOFFICE_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || "");
        error.stderr = String(stderr || "");
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

async function convertToPdf(bytes, extension) {
  const workDir = await mkdtemp(path.join(tmpdir(), "nk-convert-"));
  const inputPath = path.join(workDir, `input.${extension}`);
  try {
    await writeFile(inputPath, bytes);
    // UserInstallation 을 요청마다 따로 두면 첫 실행 프로필 생성과 동시 요청이 서로 방해하지 않는다.
    await runSoffice([
      "--headless",
      "--norestore",
      "--nolockcheck",
      `-env:UserInstallation=file://${path.join(workDir, "profile")}`,
      "--convert-to",
      "pdf",
      "--outdir",
      workDir,
      inputPath,
    ]);
    const produced = (await readdir(workDir)).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!produced) throw new Error("LibreOffice 가 PDF 를 만들지 못했습니다.");
    return await readFile(path.join(workDir, produced));
  } finally {
    // 상태 없음 — 성공하든 실패하든 흔적을 남기지 않는다.
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      send(res, 200, "ok", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    if (req.method !== "POST" || url.pathname !== "/convert") {
      send(res, 404, { error: "not_found" });
      return;
    }

    if (!authorized(req)) {
      send(res, 403, { error: "forbidden", detail: "invalid_token" });
      return;
    }

    const from = String(url.searchParams.get("from") || "docx").toLowerCase();
    if (!SUPPORTED_SOURCES.has(from)) {
      send(res, 400, {
        error: "unsupported_source",
        detail: `'${from}' 는 변환할 수 없어요. 지금은 docx → pdf 만 지원합니다.`,
      });
      return;
    }

    const body = await readBody(req);
    if (!body.length) {
      send(res, 400, { error: "empty_body", detail: "문서 바이트가 비어 있습니다." });
      return;
    }

    const started = Date.now();
    const pdf = await convertToPdf(body, from);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "X-Convert-Ms": String(Date.now() - started),
    });
    res.end(pdf);
  } catch (error) {
    const timedOut = error && (error.killed || error.signal === "SIGTERM");
    send(res, timedOut ? 504 : 500, {
      error: timedOut ? "convert_timeout" : "convert_failed",
      detail: String((error && error.message) || error).slice(0, 500),
      stderr: String((error && error.stderr) || "").slice(0, 500),
    });
  }
});

server.listen(PORT, () => {
  console.log(`[doc-convert] listening on ${PORT} (token ${TOKEN ? "set" : "MISSING — 모든 요청 거부"})`);
});
