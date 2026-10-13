// 싱크 다음(한메일) IMAP 도구 — 가짜 IMAP 서버로 로그인·읽기·휴지통 이동 흐름과 한국어 디코딩을 검증한다.
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

let modPromise;
function loadMail() {
  modPromise ??= (async () => {
    const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-daum-")), "out.mjs");
    await esbuild.build({ entryPoints: [path.join(root, "prototype/functions/api/agent/_daum-mail.ts")], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
    return import(pathToFileURL(outfile).href);
  })();
  return modPromise;
}

const bin = (bytes) => Buffer.from(bytes).toString("latin1");
const EUCKR_HANGUL = bin([0xc7, 0xd1, 0xb1, 0xdb]); // "한글"
const EUCKR_HELLO = bin([0xbe, 0xc8, 0xb3, 0xe7]);  // "안녕"
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** 명령마다 응답을 돌려주는 가짜 IMAP 서버. handler(tag, command) → 응답 문자열(latin1 바이트). */
function fakeServer(handler) {
  const sent = [];
  let push;
  const readable = new ReadableStream({ start(c) { push = c; c.enqueue(Buffer.from("* OK IMAP4 ready\r\n", "latin1")); } });
  let pending = "";
  const writable = new WritableStream({
    write(chunk) {
      pending += Buffer.from(chunk).toString("latin1");
      let i;
      while ((i = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 2);
        const [tag, ...rest] = line.split(" ");
        const cmd = rest.join(" ");
        sent.push(cmd);
        push.enqueue(Buffer.from(handler(tag, cmd), "latin1"));
      }
    },
  });
  return { sent, connector: async () => ({ readable, writable, close: async () => {} }) };
}

const literal = (s) => `{${Buffer.byteLength(s, "latin1")}}\r\n${s}`;

const MSG_MULTIPART = [
  `Subject: =?EUC-KR?B?${Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]).toString("base64")}?= =?UTF-8?B?${b64(" 계약서")}?=`,
  `From: =?UTF-8?B?${b64("김대리")}?= <kim@corp.test>`,
  "Date: Mon, 13 Oct 2026 09:00:00 +0900",
  'Content-Type: multipart/alternative; boundary="b1"',
  "",
  "--b1",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: base64",
  "",
  b64("계약서 검토 부탁드립니다. 오늘까지 회신 주세요."),
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "",
  "<p>html</p>",
  "--b1--",
  "",
].join("\r\n");
const MSG_RAW_EUCKR = [
  `Subject: [AD] ${EUCKR_HELLO}`,
  "From: promo@shop.test",
  'Content-Type: text/html; charset="euc-kr"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  `<div>${[...Buffer.from(EUCKR_HANGUL, "latin1")].map((b) => "=" + b.toString(16).toUpperCase()).join("")} =\r\n=C7=D2=C0=CE</div>`,
  "",
].join("\r\n");

// 편지함: 받은편지함 · 휴지통 · 스팸함(\Junk 표시) · 사용자가 만든 '광고'(&rRGs4A-)
const LIST_RESPONSE = '* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren) "/" "&1zTJwNG1-"\r\n'
  + '* LIST (\\HasNoChildren \\Junk) "/" "&wqTTONVo-"\r\n* LIST (\\HasNoChildren) "/" "&rRGs4A-"\r\n';

function readHandler(tag, cmd) {
  if (cmd === 'LIST "" "*"') return `${LIST_RESPONSE}${tag} OK\r\n`;
  if (cmd.startsWith("LOGIN")) return cmd.includes('"me@hanmail.net"') ? `${tag} NO [AUTHENTICATIONFAILED] invalid\r\n` : `${tag} OK LOGIN completed\r\n`;
  if (cmd === "CAPABILITY") return `* CAPABILITY IMAP4rev1 UIDPLUS MOVE\r\n${tag} OK done\r\n`;
  if (cmd === "EXAMINE INBOX") return `* 2 EXISTS\r\n* OK [UIDVALIDITY 99] ok\r\n${tag} OK [READ-ONLY] done\r\n`;
  if (cmd.startsWith("FETCH 1:2")) {
    return `* 1 FETCH (UID 41 FLAGS (\\Seen) BODY[]<0> ${literal(MSG_RAW_EUCKR)})\r\n`
      + `* 2 FETCH (UID 42 FLAGS () BODY[]<0> ${literal(MSG_MULTIPART)})\r\n${tag} OK done\r\n`;
  }
  if (cmd === "LOGOUT") return `* BYE\r\n${tag} OK bye\r\n`;
  return `${tag} BAD unexpected ${cmd}\r\n`;
}

test("받은편지함 읽기: 아이디로 다시 로그인하고, 인코딩 단어·EUC-KR 원문·base64·QP 본문을 한국어로 푼다", async () => {
  const { readDaumInbox } = await loadMail();
  const server = fakeServer(readHandler);
  const out = await readDaumInbox({ email: "me@hanmail.net", password: "app pass" }, { max: 5 }, { connector: server.connector });
  assert.deepEqual(server.sent.filter((c) => c.startsWith("LOGIN")), ['LOGIN "me@hanmail.net" "apppass"', 'LOGIN "me" "apppass"'], "주소가 거절되면 아이디로 다시 로그인, 앱 비밀번호 공백은 뺀다");
  assert.ok(server.sent.includes("EXAMINE INBOX"), "읽기 전용으로 연다(읽음 표시 안 바뀜)");
  assert.ok(server.sent.some((c) => c.includes("BODY.PEEK[]")));
  assert.equal(out.uidValidity, 99);
  assert.equal(out.total, 2);
  assert.deepEqual(out.folders, ["휴지통", "스팸함", "광고"], "옮길 수 있는 편지함 이름을 함께 준다");
  assert.deepEqual(out.emails.map((e) => e.uid), [42, 41], "최신 메일이 먼저");
  const [contract, ad] = out.emails;
  assert.equal(contract.subject, "한글 계약서");
  assert.equal(contract.from, "김대리 <kim@corp.test>");
  assert.equal(contract.unread, true);
  assert.equal(contract.snippet, "계약서 검토 부탁드립니다. 오늘까지 회신 주세요.");
  assert.equal(ad.subject, "[AD] 안녕");
  assert.equal(ad.unread, false);
  assert.equal(ad.snippet, "한글 할인");
  assert.equal(server.sent.at(-1), "LOGOUT", "끝나면 반드시 로그아웃");
});

test("로그인이 끝내 거절되면 IMAP 설정과 앱 비밀번호를 확인하라고 알린다", async () => {
  const { readDaumInbox } = await loadMail();
  const server = fakeServer((tag, cmd) => (cmd === "LOGOUT" ? `${tag} OK\r\n` : `${tag} NO [AUTHENTICATIONFAILED] bad\r\n`));
  await assert.rejects(
    readDaumInbox({ email: "me@hanmail.net", password: "x" }, {}, { connector: server.connector }),
    /IMAP 사용함[\s\S]*앱 비밀번호/,
  );
});

function trashHandler(caps) {
  return (tag, cmd) => {
    if (cmd.startsWith("LOGIN")) return `${tag} OK\r\n`;
    if (cmd === "CAPABILITY") return `* CAPABILITY IMAP4rev1 ${caps}\r\n${tag} OK\r\n`;
    if (cmd === "SELECT INBOX") return `* 5 EXISTS\r\n* OK [UIDVALIDITY 99] ok\r\n${tag} OK [READ-WRITE]\r\n`;
    if (cmd.startsWith("UID FETCH ")) {
      // 받은편지함에는 uid 41·42 만 있다.
      const h = `Subject: [AD] sale\r\nFrom: promo@shop.test\r\n\r\n`;
      const want = cmd.split(" ")[2].split(",").map(Number).filter((u) => u === 41 || u === 42);
      return want.map((u, i) => `* ${i + 1} FETCH (UID ${u} FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM)] ${literal(h)})\r\n`).join("") + `${tag} OK\r\n`;
    }
    if (cmd === 'LIST "" "*"') return `${LIST_RESPONSE}${tag} OK\r\n`;
    if (/^UID (MOVE|COPY|STORE|EXPUNGE)|^EXPUNGE/.test(cmd)) return `${tag} OK\r\n`;
    if (cmd === "LOGOUT") return `${tag} OK\r\n`;
    return `${tag} BAD unexpected ${cmd}\r\n`;
  };
}

test("휴지통 이동: 받은편지함에 있는 uid 만 '휴지통'(수정 UTF-7 이름)으로 MOVE 하고 무엇을 옮겼는지 돌려준다", async () => {
  const { trashDaumMail } = await loadMail();
  const server = fakeServer(trashHandler("MOVE UIDPLUS"));
  const out = await trashDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [41, 42, 77, 41], uidValidity: 99 }, { connector: server.connector });
  assert.ok(server.sent.includes('UID MOVE 41,42 "&1zTJwNG1-"'), server.sent.join(" | "));
  assert.equal(out.folder, "휴지통");
  assert.equal(out.trashed, 2);
  assert.deepEqual(out.missing, [77], "없는 uid 는 옮기지 않고 알린다");
  assert.equal(out.items[0].subject, "[AD] sale");
});

test("MOVE 가 없는 서버는 복사 → 삭제 표시 → 해당 uid 만 정리(UIDPLUS)", async () => {
  const { trashDaumMail } = await loadMail();
  const server = fakeServer(trashHandler("UIDPLUS"));
  await trashDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: "41, 42, 77" }, { connector: server.connector });
  const steps = server.sent.filter((c) => /^UID (COPY|STORE|EXPUNGE)/.test(c));
  assert.deepEqual(steps, ['UID COPY 41,42 "&1zTJwNG1-"', "UID STORE 41,42 +FLAGS.SILENT (\\Deleted)", "UID EXPUNGE 41,42"]);
});

test("uidValidity 가 바뀌었으면 다른 메일을 옮기지 않도록 멈춘다", async () => {
  const { trashDaumMail } = await loadMail();
  const server = fakeServer(trashHandler("MOVE"));
  await assert.rejects(trashDaumMail({ email: "a@daum.net", password: "p" }, { uids: [41], uidValidity: 1 }, { connector: server.connector }), /uid 가 바뀌었어요/);
  assert.ok(!server.sent.some((c) => c.startsWith("UID MOVE")));
});

test("편지함 이동: 스팸은 서버 표시(\\Junk)로, 직접 만든 편지함은 한국어 이름으로 찾아 옮긴다", async () => {
  const { moveDaumMail } = await loadMail();
  let server = fakeServer(trashHandler("MOVE"));
  let out = await moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [41], folder: "spam" }, { connector: server.connector });
  assert.ok(server.sent.includes('UID MOVE 41 "&wqTTONVo-"'), server.sent.join(" | "));
  assert.equal(out.moved, 1);
  server = fakeServer(trashHandler("MOVE"));
  out = await moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [41, 42], folder: " 광고 " }, { connector: server.connector });
  assert.ok(server.sent.includes('UID MOVE 41,42 "&rRGs4A-"'), server.sent.join(" | "));
  assert.equal(out.folder, "광고");
});

test("없는 편지함이면 아무것도 옮기지 않고 있는 편지함 이름을 알려 준다", async () => {
  const { moveDaumMail } = await loadMail();
  const server = fakeServer(trashHandler("MOVE"));
  await assert.rejects(
    moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [41], folder: "거래처" }, { connector: server.connector }),
    /'거래처' 편지함을 찾지 못했어요\. 지금 있는 편지함: 받은편지함, 휴지통, 스팸함, 광고/,
  );
  assert.ok(!server.sent.some((c) => /^UID (MOVE|COPY|FETCH)/.test(c)), "편지함 확인 전엔 메일을 건드리지 않는다");
  await assert.rejects(
    moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [41], folder: "INBOX" }, { connector: fakeServer(trashHandler("MOVE")).connector }),
    /이미 .받은편지함.에 있어요/,
  );
});

// 휴지통(&1zTJwNG1-)에는 uid 7·8·9 가 있다.
function purgeHandler(caps = "UIDPLUS") {
  return (tag, cmd) => {
    if (cmd.startsWith("LOGIN")) return `${tag} OK\r\n`;
    if (cmd === "CAPABILITY") return `* CAPABILITY IMAP4rev1 ${caps}\r\n${tag} OK\r\n`;
    if (cmd === 'LIST "" "*"') return `${LIST_RESPONSE}${tag} OK\r\n`;
    // 휴지통(&1zTJwNG1-)과 스팸함(&wqTTONVo-) 모두 uid 7·8·9 가 있는 셈으로 둔다.
    if (/^(EXAMINE|SELECT) "&(1zTJwNG1|wqTTONVo)-"$/.test(cmd)) return `* 3 EXISTS\r\n* OK [UIDVALIDITY 55] ok\r\n${tag} OK\r\n`;
    if (cmd === "UID SEARCH ALL") return `* SEARCH 7 8 9\r\n${tag} OK\r\n`;
    if (cmd.startsWith("UID FETCH ")) {
      const want = cmd.split(" ")[2].split(",").map(Number).filter((u) => [7, 8, 9].includes(u));
      const withHeader = cmd.includes("HEADER.FIELDS");
      return want.map((u, i) => {
        const h = `Subject: old ${u}\r\nFrom: x@y.test\r\n\r\n`;
        return `* ${i + 1} FETCH (UID ${u}${withHeader ? ` FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM)] ${literal(h)}` : ""})\r\n`;
      }).join("") + `${tag} OK\r\n`;
    }
    if (cmd.startsWith("UID MOVE") || cmd.startsWith("UID STORE") || cmd.startsWith("UID EXPUNGE") || cmd === "EXPUNGE" || cmd === "LOGOUT") return `${tag} OK\r\n`;
    return `${tag} BAD unexpected ${cmd}\r\n`;
  };
}

test("휴지통 읽기: folder 로 휴지통을 읽기 전용으로 연다", async () => {
  const { readDaumInbox } = await loadMail();
  const server = fakeServer((tag, cmd) => (cmd.startsWith("FETCH ") ? `${tag} OK\r\n` : purgeHandler()(tag, cmd)));
  const out = await readDaumInbox({ email: "me@hanmail.net", password: "p" }, { folder: "휴지통" }, { connector: server.connector });
  assert.ok(server.sent.includes('EXAMINE "&1zTJwNG1-"'), server.sent.join(" | "));
  assert.equal(out.mailbox, "휴지통");
  assert.equal(out.uidValidity, 55);
});

test("휴지통 영구 삭제: 승인 전 목록을 확정하고, 승인되면 그 목록 중 남아 있는 것만 지운다", async () => {
  const { previewDaumPurge, purgeDaumMailbox } = await loadMail();
  let server = fakeServer(purgeHandler());
  const plan = await previewDaumPurge({ email: "me@hanmail.net", password: "p" }, { all: true }, { connector: server.connector });
  assert.deepEqual(plan.uids, [9, 8, 7]);
  assert.equal(plan.folder, "휴지통");
  assert.equal(plan.uidValidity, 55);
  assert.deepEqual(plan.items.map((e) => e.subject), ["old 9", "old 8", "old 7"]);
  assert.ok(!server.sent.some((c) => /STORE|EXPUNGE/.test(c)), "확정 단계에선 아무것도 지우지 않는다");

  // 승인 사이에 uid 9 는 이미 사라졌고 10 은 원래 목록에 없다 → 7·8 만 지운다.
  server = fakeServer(purgeHandler());
  const out = await purgeDaumMailbox({ email: "me@hanmail.net", password: "p" }, { uids: [7, 8, 10], uidValidity: 55 }, { connector: server.connector });
  assert.ok(server.sent.includes('SELECT "&1zTJwNG1-"'));
  assert.ok(server.sent.includes("UID STORE 7,8 +FLAGS.SILENT (\\Deleted)"), server.sent.join(" | "));
  assert.ok(server.sent.includes("UID EXPUNGE 7,8"));
  assert.equal(out.deleted, 2);
});

test("복구: 휴지통 메일을 휴지통 uid 기준으로 받은편지함·직접 만든 편지함으로 옮긴다", async () => {
  const { moveDaumMail } = await loadMail();
  let server = fakeServer(purgeHandler("MOVE UIDPLUS"));
  let out = await moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [8, 99], uidValidity: 55, from: "휴지통", folder: "받은편지함" }, { connector: server.connector });
  assert.ok(server.sent.includes('SELECT "&1zTJwNG1-"'), "원래 편지함(휴지통)을 연다");
  assert.ok(server.sent.includes("UID MOVE 8 INBOX"), server.sent.join(" | "));
  assert.equal(out.source, "휴지통");
  assert.equal(out.folder, "받은편지함");
  assert.deepEqual(out.missing, [99]);
  assert.equal(out.items[0].subject, "old 8");

  server = fakeServer(purgeHandler("MOVE"));
  out = await moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [7], from: "trash", folder: "광고" }, { connector: server.connector });
  assert.ok(server.sent.includes('UID MOVE 7 "&rRGs4A-"'));

  // 휴지통 uidValidity(55)가 아닌 값이면 멈춘다 — 받은편지함 uid 를 섞어 엉뚱한 메일을 옮기지 않게.
  server = fakeServer(purgeHandler("MOVE"));
  await assert.rejects(moveDaumMail({ email: "me@hanmail.net", password: "p" }, { uids: [7], uidValidity: 99, from: "휴지통", folder: "받은편지함" }, { connector: server.connector }), /uid 가 바뀌었어요/);
  assert.ok(!server.sent.some((c) => c.startsWith("UID MOVE")));
});

test("스팸함 비우기는 uid 없이 all 한 번으로 — 서버가 스팸함 전체 uid 를 찾아 확정하고 그 목록만 지운다", async () => {
  const { previewDaumPurge, purgeDaumMailbox } = await loadMail();
  let server = fakeServer(purgeHandler());
  const plan = await previewDaumPurge({ email: "me@hanmail.net", password: "p" }, { folder: "스팸함", all: true }, { connector: server.connector });
  assert.ok(server.sent.includes('EXAMINE "&wqTTONVo-"'), "\\Junk 표시된 스팸함을 연다");
  assert.ok(server.sent.includes("UID SEARCH ALL"));
  assert.equal(plan.folder, "스팸함");
  assert.equal(plan.target, "스팸함");
  assert.deepEqual(plan.uids, [9, 8, 7]);

  server = fakeServer(purgeHandler());
  const out = await purgeDaumMailbox({ email: "me@hanmail.net", password: "p" }, { target: plan.target, uids: plan.uids, uidValidity: plan.uidValidity }, { connector: server.connector });
  assert.ok(server.sent.includes('SELECT "&wqTTONVo-"'));
  assert.ok(server.sent.includes("UID EXPUNGE 9,8,7"), server.sent.join(" | "));
  assert.equal(out.deleted, 3);
  assert.equal(out.folder, "스팸함");
});

test("휴지통·스팸함 밖의 편지함은 영구 삭제하지 않는다", async () => {
  const { previewDaumPurge } = await loadMail();
  const server = fakeServer(purgeHandler());
  await assert.rejects(previewDaumPurge({ email: "me@hanmail.net", password: "p" }, { folder: "광고", all: true }, { connector: server.connector }), /휴지통·스팸편지함에서만/);
  assert.ok(!server.sent.some((c) => c.startsWith("UID SEARCH")));
});

test("휴지통이 다시 만들어져 uidValidity 가 다르면 아무것도 지우지 않는다", async () => {
  const { purgeDaumMailbox } = await loadMail();
  const server = fakeServer(purgeHandler());
  await assert.rejects(purgeDaumMailbox({ email: "a@daum.net", password: "p" }, { uids: [7], uidValidity: 1 }, { connector: server.connector }), /아무것도 지우지 않았어요/);
  assert.ok(!server.sent.some((c) => /STORE|EXPUNGE/.test(c)));
});

test("휴지통 영구 삭제는 승인 게이트를 거치고 승인 카드에 지울 메일이 보인다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /daum_mail_purge: \{ agentId: "sync", kind: "external", gate: true, prepare: prepareDaumMailPurgeInput, run: runDaumMailPurgeTool \}/);
  assert.match(shared, /영구 삭제\*\*해요\. 삭제하면 되살릴 수 없어요/);
  assert.match(read("prototype/functions/api/agent/review.ts"), /if \(type === "daum_mail_purge"\) \{/);
  const api = read("ai-company-app/src/lib/api.ts");
  assert.match(api, /daum_mail_purge: "다음 메일 영구 삭제"/);
  // 편지함 전체 비우기에서 uid 를 모으러 읽기를 되풀이하지 않도록 직원에게 알린다(2026-10-13 끊김 원인).
  assert.match(read("prototype/functions/api/agent/_orchestrator.ts"), /uid 를 모으지 말고 \{"folder": …, "all": true\} 로 바로 한 번만 부른다/);
  assert.match(api, /"publish", "daum_mail_purge"\]\)/, "되돌릴 수 없는 외부 작업 배지");
});

test("메일함 이름 수정 UTF-7 디코딩", async () => {
  const { decodeMailboxName } = await loadMail();
  assert.equal(decodeMailboxName("&1zTJwNG1-"), "휴지통");
  assert.equal(decodeMailboxName("A&-B"), "A&B");
});

test("싱크 도구·설정 카드·연결 테스트가 연결돼 있다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /daum_mail_read: \{ agentId: "sync", kind: "read", synthesize: true, run: runDaumMailReadTool \}/);
  assert.match(shared, /daum_mail_trash: \{ agentId: "sync", kind: "read", run: runDaumMailTrashTool \}/);
  assert.match(shared, /daum_mail_move: \{ agentId: "sync", kind: "read", run: runDaumMailMoveTool \}/);
  const integ = read("prototype/functions/api/agent/integrations.ts");
  assert.match(integ, /daum_mail: \{\s*provider: "daum_mail", agentId: "sync"/);
  assert.match(integ, /key: "app_password", label: "앱 비밀번호", required: true, secret: true/, "앱 비밀번호는 암호화 저장(secret)");
  assert.match(read("prototype/functions/api/agent/integration-test.ts"), /if \(tool === "daum_mail"\) \{/);
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /daum_mail_trash: `\[\[RUN: daum_mail_trash \| \{"uids"/);
  assert.match(read("ai-company-app/src/components/Integrations.tsx"), /daum_mail: "다음 한메일/);
});
