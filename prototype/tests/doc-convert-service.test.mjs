// PDF 변환 서비스 검증 — 설계서 docs/form_document_engine_design_v2_20260812.md §6.4.
// 서비스를 실제로 띄워 HTTP 계약(인증·지원 포맷·헬스체크)을 확인한다.
// LibreOffice 자체 변환은 배포 환경에서만 돌므로 여기서는 다루지 않는다
// (한글 폰트 확인은 사람이 배포 후 §10 #12 로 확인 — doc-convert/README.md 참고).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const PORT = 8791;
const TOKEN = "test-token";
const base = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, [join(repoRoot, "doc-convert/server.js")], {
    env: { ...process.env, PORT: String(PORT), DOC_CONVERT_TOKEN: TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // 기동 로그를 기다린다(포트가 열리기 전에 요청하면 ECONNREFUSED).
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("서비스가 뜨지 않았어요")), 10_000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("error", reject);
  });
});

after(() => {
  child?.kill();
});

test("헬스체크는 토큰 없이도 ok", async () => {
  const response = await fetch(`${base}/healthz`);
  assert.equal(response.status, 200);
  assert.equal((await response.text()).trim(), "ok");
});

test("토큰이 없거나 틀리면 변환하지 않는다 (공개 URL 이므로)", async () => {
  const noToken = await fetch(`${base}/convert?from=docx`, { method: "POST", body: "x" });
  assert.equal(noToken.status, 403);

  const wrongToken = await fetch(`${base}/convert?from=docx`, {
    method: "POST",
    headers: { Authorization: "Bearer nope" },
    body: "x",
  });
  assert.equal(wrongToken.status, 403);
});

test("★HWPX 는 변환하지 않는다 (범위 밖 — 조용히 이상한 PDF 를 내놓지 않는다)", async () => {
  const response = await fetch(`${base}/convert?from=hwpx`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: "x",
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, "unsupported_source");
  assert.match(body.detail, /docx → pdf/);
});

test("빈 본문은 400", async () => {
  const response = await fetch(`${base}/convert?from=docx`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "empty_body");
});

test("변환 외의 경로는 404 — 문서를 만드는 기능은 없다", async () => {
  const response = await fetch(`${base}/generate`, { method: "POST" });
  assert.equal(response.status, 404);
});

test("Dockerfile 에 한글 폰트가 들어 있다 (빠지면 PDF 한글이 네모로 나온다)", () => {
  const dockerfile = read("doc-convert/Dockerfile");
  assert.match(dockerfile, /fonts-noto-cjk/);
  assert.match(dockerfile, /libreoffice-writer/);
  assert.match(dockerfile, /fc-cache/);
});

test("배포 설정이 설계서 §6.4 와 같다 (동시성 1 · 60s · 최대 3 · 최소 0)", () => {
  const readme = read("doc-convert/README.md");
  assert.match(readme, /--concurrency 1/);
  assert.match(readme, /--timeout 60s/);
  assert.match(readme, /--max-instances 3/);
  assert.match(readme, /--min-instances 0/);
});

test("Workers 쪽은 콜드스타트를 90초까지 기다리고 1회 재시도한다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /DOC_CONVERT_TIMEOUT_MS = 90_000/);
  const convert = shared.slice(shared.indexOf("async function convertDocxToPdf"));
  assert.match(convert, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
  assert.match(convert, /AbortSignal\.timeout\(DOC_CONVERT_TIMEOUT_MS\)/);
  assert.match(convert, /"%PDF"/); // 오류 페이지를 PDF 로 저장하지 않는다
});

test("PDF 변환이 실패해도 나머지 파일은 그대로 준다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const tool = shared.slice(shared.indexOf("export async function runFormFillTool"));
  assert.match(tool, /warnings\.push\(/);
  assert.match(tool, /PDF 변환에 실패했어요\. 워드에서 PDF로 저장해 주세요/);
  // pdf 는 직접 렌더하지 않고 manifest.pdfFrom 을 변환한다
  assert.match(tool, /manifest\.pdfFrom/);
});
