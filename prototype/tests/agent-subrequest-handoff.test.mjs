// 레이더가 "🔎 web_fetch 조회 중이에요…" 에서 멈춘 원인(2026-10-13): CF 무료 플랜 요청당 서브요청 50번.
// 조회 → 결과 정리 → 후속 조회를 한 요청 안에서 연쇄로 돌리다 한도를 넘었고, 그 뒤로는 DB 저장도 막혀
// 결과도 실패 안내도 남지 못한 채 done 만 나갔다. 이제 여유를 세어 모자라면 새 요청으로 넘겨 이어서 한다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

async function bundle(entry) {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-handoff-")), "out.mjs");
  await esbuild.build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

// 레이더 1:1 대화: web_search → 정리하면서 web_fetch 를 또 부른다 → 정리. 서브요청은 fetch 1번 = 1번.
function installFakeNetwork(limit) {
  const state = { count: 0, claudeCalls: 0, limit };
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    state.count += 1;
    if (state.count > state.limit) throw new Error("Too many subrequests by single Worker invocation.");
    let body = {};
    try { body = JSON.parse(init.body || "{}"); } catch {}
    if (url.endsWith("/sql")) {
      const q = String(body.query || "");
      if (/INSERT INTO agent_messages/.test(q) && /RETURNING/.test(q)) {
        const p = body.params || [];
        return json({ rows: [{ id: `m${state.count}`, role: p[2], agent_id: p[3], name: p[4], text: p[5], files: [], pending: p[7] }] });
      }
      return json({ rows: [] });
    }
    if (/anthropic\.com/.test(url)) {
      state.claudeCalls += 1;
      const text = state.claudeCalls === 1
        ? "찾아볼게요. [[RUN: web_search | {\"query\":\"한메일 IMAP\"}]]"
        : state.claudeCalls === 2
          ? "IMAP 이 열려 있어요. [[RUN: web_fetch | {\"url\":\"https://cs.daum.net/faq/266.html\"}]]"
          : "페이지를 열어 확인했어요.";
      return json({ content: [{ type: "text", text }] });
    }
    if (/tavily\.com\/search/.test(url)) return json({ answer: "IMAP 지원", results: [] });
    if (/tavily\.com\/extract/.test(url)) return json({ results: [{ raw_content: "가".repeat(500) }] });
    return json({});
  };
  return state;
}

function makeDeps(state, sent, preamble) {
  const env = { DATABASE_URL: "postgres://u:p@db.example.test/neondb", ANTHROPIC_API_KEY: "sk-test", TAVILY_API_KEY: "tv-test" };
  return {
    env,
    deps: {
      userId: "u1", conversationId: "main", focusAgent: "radar",
      firstMessage: "한메일도 IMAP 되는지 찾아봐줘",
      toolCtx: { request: new Request("https://nkstudio.org/api/agent/chat"), env, authHeader: "", userId: "u1", conversationId: "main" },
      sql: async (query, params = []) => {
        const res = await fetch("https://db.example.test/sql", { method: "POST", body: JSON.stringify({ query, params }) });
        return (await res.json()).rows || [];
      },
      onMessage: async (m) => { sent.push(m); },
      subrequestsLeft: () => state.limit - state.count - preamble,
    },
  };
}

test("서브요청 여유가 모자라면 후속 조회를 시작하지 않고 미뤘다가 새 요청에서 끝까지 답한다", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { runGroupChat } = await bundle("prototype/functions/api/agent/_orchestrator.ts");
    // 앞 단계(인증·권한·사용자 메시지 저장)가 6번 쓴 셈 — 첫 조회는 여유가 있고 후속 조회에서 바닥난다.
    const state = installFakeNetwork(50 - 6);
    const sent = [];
    const { env, deps } = makeDeps(state, sent, 0);
    deps.subrequestsLeft = () => state.limit - state.count;
    const first = await runGroupChat(env, deps);
    assert.ok(state.count <= state.limit, `첫 요청이 한도를 넘었습니다: ${state.count}`);
    assert.deepEqual(first.deferred.map((r) => r.tool), ["web_fetch"]);
    assert.ok(!sent.some((m) => /web_fetch 조회 중이에요/.test(m.text)), "미룬 조회는 '조회 중' 안내를 내지 않는다");

    // 새 요청 = 새 50번.
    state.count = 0;
    state.limit = 50;
    const second = await runGroupChat(env, deps, { resumeRuns: first.deferred });
    assert.equal(second.deferred.length, 0);
    const texts = sent.map((m) => m.text);
    const noticeAt = texts.findIndex((t) => /web_fetch 조회 중이에요/.test(t));
    assert.ok(noticeAt >= 0);
    assert.equal(texts.at(-1), "페이지를 열어 확인했어요.", "마지막 말이 진행 안내로 끝나면 안 된다");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("저장이 막혀도 결과·실패 안내는 화면으로 보낸다 — 진행 안내로 끝난 채 조용히 끝나지 않는다", async () => {
  const realFetch = globalThis.fetch;
  try {
    const { runGroupChat } = await bundle("prototype/functions/api/agent/_orchestrator.ts");
    // 여유 계산을 끈 상태(예상 밖 지출)에서 후속 조회의 '조회 중' 안내 직후 한도를 넘긴다.
    const state = installFakeNetwork(36);
    const sent = [];
    const { env, deps } = makeDeps(state, sent, 0);
    delete deps.subrequestsLeft;
    await runGroupChat(env, deps).catch(() => null);
    const last = sent.at(-1)?.text || "";
    assert.ok(!/조회 중이에요…$/.test(last), `마지막 말이 진행 안내입니다: ${last}`);
    assert.ok(sent.some((m) => String(m.id).startsWith("local-")), "저장 못 한 발언도 화면에는 간다");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("이어하기 토큰은 서버 서명이라 다른 사용자·대화·변조를 받아들이지 않는다", async () => {
  const { signResume, verifyResume, startSubrequestBudget } = await bundle("prototype/functions/api/agent/_turn-handoff.ts");
  const env = { AUTH_SESSION_SECRET: "test-secret" };
  const runs = [{ tool: "web_fetch", reason: "{\"url\":\"https://a.test\"}", agentId: "radar" }];
  const token = await signResume(env, { userId: "u1", conversationId: "main", runs, hop: 1 });
  assert.deepEqual((await verifyResume(env, token, "u1", "main"))?.runs, runs);
  assert.equal(await verifyResume(env, token, "u2", "main"), null);
  assert.equal(await verifyResume(env, token, "u1", "other"), null);
  const [body, sig] = token.split(".");
  assert.equal(await verifyResume(env, `${body}x.${sig}`, "u1", "main"), null);

  const realFetch = globalThis.fetch;
  try {
    const budget = startSubrequestBudget(50);
    await fetch("data:text/plain,hi").catch(() => null);
    assert.equal(budget.used(), 1);
    assert.equal(budget.left(), 49);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("chat.ts 는 미룬 단계를 같은 요청에서 다시 돌리지 않고 새 요청으로 넘긴다", () => {
  const chat = read("prototype/functions/api/agent/chat.ts");
  assert.match(chat, /const budget = startSubrequestBudget\(\);\s*\n\s*try \{/, "인증 전부터 센다");
  assert.match(chat, /subrequestsLeft: budget\.left/);
  assert.match(chat, /continueInFreshRequest\(request, \{ conversationId, focusAgent, clientNow, resume: token \}, sse\)/);
  assert.doesNotMatch(chat, /round < 2 && Array\.isArray\(produced\?\.deferred\)/, "같은 요청 안 재실행은 바닥난 한도를 그대로 쓴다");
  // 저장 실패여도 안내는 화면에 간다
  assert.match(chat, /msg: saved \|\| \{ id: `local-\$\{crypto\.randomUUID\(\)\}`/);
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  const budgetAt = orch.indexOf("if (subrequestsLeft() < TOOL_STEP_SUBREQUESTS)");
  const noticeAt = orch.indexOf("${r.tool} 조회 중이에요…");
  assert.ok(budgetAt > 0 && noticeAt > budgetAt, "서브요청 확인이 '조회 중' 안내보다 앞에 있어야 합니다");
});
