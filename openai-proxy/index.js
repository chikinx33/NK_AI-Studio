// NK_Studio OpenAI 지역-우회 프록시 (GCP Cloud Run 용)
//
// 목적: Cloudflare Worker 가 OpenAI 로 나갈 때 간헐적으로 홍콩(HKG) 등 미지원 COLO 로 송출되어
// 403(빈 본문, 지역 차단)이 나는 문제를, 항상 "OpenAI 지원 지역"(예: 서울 asia-northeast3)에서
// 돌아가는 이 프록시를 거치게 해 100% 우회한다.
//
// 동작: 받은 요청을 그대로 https://api.openai.com 같은 경로로 전달하고 응답을 그대로 돌려준다.
// 인증(Authorization: Bearer <OpenAI 키>)은 호출자(Worker)가 그대로 넣어 보내므로 프록시는
// 키를 보관하지 않는다. 공개 엔드포인트 오남용을 막기 위해 공유 시크릿(x-nk-proxy-secret)을
// 검증한다(환경변수 OPENAI_PROXY_SECRET 설정 시).

const http = require("http");

const OPENAI_ORIGIN = "https://api.openai.com";
const SECRET = String(process.env.OPENAI_PROXY_SECRET || "").trim();
const PORT = Number(process.env.PORT) || 8080;

// 전달하지 않을(또는 재계산되어야 하는) 헤더.
const HOP_BY_HOP = new Set([
  "host", "connection", "content-length", "transfer-encoding",
  "x-nk-proxy-secret", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailers", "upgrade",
]);

const server = http.createServer(async (req, res) => {
  try {
    // 헬스체크 (Cloud Run 기동 확인용)
    if (req.method === "GET" && (req.url === "/" || req.url === "/healthz")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    // 공유 시크릿 검증 (설정된 경우에만)
    if (SECRET) {
      const got = String(req.headers["x-nk-proxy-secret"] || "");
      if (got !== SECRET) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden", detail: "invalid_proxy_secret" }));
        return;
      }
    }

    // 요청 바디 버퍼링 (JSON·멀티파트 이미지 모두 그대로 전달)
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    // 헤더 복사 (hop-by-hop / host / 시크릿 제거 — Content-Type 의 multipart boundary 는 보존)
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }

    const target = OPENAI_ORIGIN + req.url;
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: (req.method === "GET" || req.method === "HEAD") ? undefined : body,
    });

    const respHeaders = {};
    upstream.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      if (lk === "content-encoding" || lk === "transfer-encoding" || lk === "connection" || lk === "content-length") return;
      respHeaders[k] = v;
    });

    const outBuf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, respHeaders);
    res.end(outBuf);
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy_error", detail: String((e && e.message) || e) }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log("nk-openai-proxy listening on", PORT);
});
