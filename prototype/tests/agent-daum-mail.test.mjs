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

function readHandler(tag, cmd) {
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
    if (cmd.startsWith("UID FETCH 41,42,77")) {
      const h = `Subject: [AD] sale\r\nFrom: promo@shop.test\r\n\r\n`;
      return `* 1 FETCH (UID 41 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM)] ${literal(h)})\r\n* 2 FETCH (UID 42 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM)] ${literal(h)})\r\n${tag} OK\r\n`;
    }
    if (cmd === 'LIST "" "*"') return `* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren) "/" "&1zTJwNG1-"\r\n* LIST (\\HasNoChildren) "/" "&wqTTONVo-"\r\n${tag} OK\r\n`;
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

test("메일함 이름 수정 UTF-7 디코딩", async () => {
  const { decodeMailboxName } = await loadMail();
  assert.equal(decodeMailboxName("&1zTJwNG1-"), "휴지통");
  assert.equal(decodeMailboxName("A&-B"), "A&B");
});

test("싱크 도구·설정 카드·연결 테스트가 연결돼 있다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /daum_mail_read: \{ agentId: "sync", kind: "read", synthesize: true, run: runDaumMailReadTool \}/);
  assert.match(shared, /daum_mail_trash: \{ agentId: "sync", kind: "read", run: runDaumMailTrashTool \}/);
  const integ = read("prototype/functions/api/agent/integrations.ts");
  assert.match(integ, /daum_mail: \{\s*provider: "daum_mail", agentId: "sync"/);
  assert.match(integ, /key: "app_password", label: "앱 비밀번호", required: true, secret: true/, "앱 비밀번호는 암호화 저장(secret)");
  assert.match(read("prototype/functions/api/agent/integration-test.ts"), /if \(tool === "daum_mail"\) \{/);
  const orch = read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /daum_mail_trash: `\[\[RUN: daum_mail_trash \| \{"uids"/);
  assert.match(read("ai-company-app/src/components/Integrations.tsx"), /daum_mail: "다음 한메일/);
});
