// prototype/functions/api/agent/_daum-mail.ts
// 다음(한메일) IMAP — 싱크가 받은편지함을 읽고 스팸을 휴지통으로 옮긴다.
//
// 다음 메일은 Gmail 같은 웹 API 가 없고 IMAP(imap.daum.net:993, SSL)만 연다. Cloudflare 런타임의
// TCP 소켓(connect)으로 직접 접속한다. 인증은 사용자가 설정에 등록한 메일 주소 + 앱 비밀번호.
//
// 소켓 모듈은 문자열 변수로 동적 import 한다 — 정적 import 면 Node 테스트 번들이 이 모듈을 찾지 못해 깨진다.
// 소켓에서 받은 바이트는 '바이트 = 글자 1개' 문자열(binary string)로 다뤄, IMAP 리터럴 {N} 의 바이트 수를
// 그대로 세고, 본문·제목은 나중에 각자 charset(UTF-8·EUC-KR 등)으로 디코딩한다.

export const DAUM_IMAP_HOST = "imap.daum.net";
export const DAUM_IMAP_PORT = 993;
const SOCKETS_MODULE = "cloudflare:sockets";

export interface MailCredentials { email: string; password: string }

/** 테스트에서 가짜 서버를 끼울 수 있게 소켓 생성을 주입받는다. */
export type SocketLike = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close: () => Promise<void> | void };
export type Connector = (host: string, port: number) => Promise<SocketLike>;

const defaultConnector: Connector = async (host, port) => {
  const { connect } = await import(SOCKETS_MODULE as string);
  return connect({ hostname: host, port }, { secureTransport: "on", allowHalfOpen: false });
};

// ── 바이트 ↔ 문자열 ─────────────────────────────────────────────────────────
function bytesToBinary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
}
function binaryToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const CHARSET_ALIASES: Record<string, string> = { "ks_c_5601-1987": "euc-kr", "ks_c_5601": "euc-kr", "cp949": "euc-kr", "x-windows-949": "euc-kr" };
/** 바이트(binary string)를 charset 으로 디코딩. 모르는 charset 이면 UTF-8 → EUC-KR 순으로 시도한다. */
export function decodeBytes(binary: string, charset = ""): string {
  const bytes = binaryToBytes(binary);
  const cs = (CHARSET_ALIASES[charset.toLowerCase()] || charset || "").toLowerCase();
  if (cs && cs !== "utf-8" && cs !== "utf8" && cs !== "us-ascii") {
    try { return new TextDecoder(cs).decode(bytes); } catch { /* 모르는 charset → 아래 추정 */ }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* UTF-8 아님 */ }
  try { return new TextDecoder("euc-kr").decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

// ── IMAP 연결 ──────────────────────────────────────────────────────────────
interface ImapResponse { lines: string[]; literals: string[][]; status: string; text: string }

class ImapError extends Error {}

class ImapConnection {
  private buf = "";
  private tag = 0;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  capabilities = new Set<string>();

  constructor(private socket: SocketLike) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read();
    if (done) throw new ImapError("메일 서버가 연결을 끊었어요.");
    this.buf += bytesToBinary(value);
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const i = this.buf.indexOf("\r\n");
      if (i >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        return line;
      }
      await this.fill();
    }
  }

  private async readBytes(n: number): Promise<string> {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  /** 응답 한 줄(리터럴 포함)을 읽는다. 리터럴 자리는 \u0000<번호>\u0000 로 바꾸고 내용은 따로 담는다. */
  private async readResponseLine(): Promise<{ line: string; literals: string[] }> {
    let line = await this.readLine();
    const literals: string[] = [];
    for (;;) {
      const m = /\{(\d+)\}$/.exec(line);
      if (!m) break;
      literals.push(await this.readBytes(Number(m[1])));
      line = `${line.slice(0, m.index)}\u0000${literals.length - 1}\u0000${await this.readLine()}`;
    }
    return { line, literals };
  }

  async greeting(): Promise<void> {
    const { line } = await this.readResponseLine();
    if (!/^\* (OK|PREAUTH)/i.test(line)) throw new ImapError(`메일 서버 응답이 이상해요: ${line.slice(0, 120)}`);
  }

  async command(cmd: string): Promise<ImapResponse> {
    const tag = `A${++this.tag}`;
    await this.writer.write(binaryToBytes(`${tag} ${cmd}\r\n`));
    const lines: string[] = [];
    const literals: string[][] = [];
    for (;;) {
      const r = await this.readResponseLine();
      if (r.line.startsWith(`${tag} `)) {
        const m = /^\S+ (OK|NO|BAD)\s*(.*)$/i.exec(r.line);
        const status = (m?.[1] || "BAD").toUpperCase();
        const text = m?.[2] || r.line;
        return { lines, literals, status, text };
      }
      lines.push(r.line);
      literals.push(r.literals);
    }
  }

  async ok(cmd: string, what: string): Promise<ImapResponse> {
    const r = await this.command(cmd);
    if (r.status !== "OK") throw new ImapError(`${what} 실패: ${r.text.slice(0, 160)}`);
    return r;
  }

  async close(): Promise<void> {
    try { await Promise.race([this.command("LOGOUT"), new Promise((resolve) => setTimeout(resolve, 1500))]); } catch { /* 이미 끊김 */ }
    try { await this.socket.close(); } catch { /* 무시 */ }
  }
}

/** IMAP 따옴표 문자열. 앱 비밀번호·주소는 ASCII 라 리터럴 없이 보낸다. */
function quote(s: string): string {
  if (/[^\x20-\x7e]/.test(s)) throw new ImapError("메일 주소·앱 비밀번호에 영문·숫자·기호 외의 글자가 들어 있어요. 다시 확인해 주세요.");
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: any;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new ImapError(`메일 서버가 ${Math.round(ms / 1000)}초 안에 응답하지 않았어요.`)), ms); })]);
  } finally { clearTimeout(timer); }
}

/**
 * 로그인한 연결로 일을 하고 반드시 닫는다.
 * 다음은 아이디(@ 앞)나 전체 주소 중 하나로 로그인하므로 전체 주소가 거절되면 아이디로 한 번 더 시도한다.
 */
export async function withDaumImap<T>(
  cred: MailCredentials,
  work: (conn: ImapConnection) => Promise<T>,
  opts: { connector?: Connector; timeoutMs?: number } = {},
): Promise<T> {
  const email = String(cred.email || "").trim();
  const password = String(cred.password || "").replace(/\s+/g, "");
  if (!email || !password) throw new ImapError("다음 메일 주소와 앱 비밀번호가 등록되지 않았어요. ⚙️설정 → 에이전트 → 싱크 → '다음 한메일'에서 등록해 주세요.");
  const socket = await (opts.connector || defaultConnector)(DAUM_IMAP_HOST, DAUM_IMAP_PORT);
  const conn = new ImapConnection(socket);
  try {
    return await withTimeout((async () => {
      await conn.greeting();
      const ids = email.includes("@") ? [email, email.split("@")[0]] : [email];
      let login: ImapResponse | null = null;
      for (const id of ids) {
        login = await conn.command(`LOGIN ${quote(id)} ${quote(password)}`);
        if (login.status === "OK") break;
      }
      if (!login || login.status !== "OK") {
        throw new ImapError(`다음 메일 로그인에 실패했어요. 다음 메일 환경설정에서 'IMAP 사용함'이 켜져 있는지, 일반 비밀번호가 아니라 앱 비밀번호를 넣었는지 확인해 주세요. (서버 응답: ${String(login?.text || "").slice(0, 120)})`);
      }
      const caps = await conn.command("CAPABILITY");
      for (const line of caps.lines) {
        if (/^\* CAPABILITY /i.test(line)) for (const c of line.slice(13).split(/\s+/)) conn.capabilities.add(c.toUpperCase());
      }
      return await work(conn);
    })(), opts.timeoutMs ?? 25000);
  } finally {
    await conn.close();
  }
}

// ── 메일 파싱 ──────────────────────────────────────────────────────────────
function splitHeaderBody(raw: string): { headers: Record<string, string>; body: string } {
  const sep = raw.search(/\r?\n\r?\n/);
  const head = sep >= 0 ? raw.slice(0, sep) : raw;
  const body = sep >= 0 ? raw.slice(sep).replace(/^\r?\n\r?\n/, "") : "";
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (!(k in headers)) headers[k] = line.slice(i + 1).trim();
  }
  return { headers, body };
}

function param(value: string, name: string): string {
  const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, "i").exec(value || "");
  return m ? (m[1] ?? m[2] ?? "") : "";
}

function decodeQP(s: string): string {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
function decodeB64(s: string): string {
  // 패딩(=)을 떼고 다시 채운다. 본문 앞부분만 받아 중간에서 잘린 base64 도 남은 만큼 푼다.
  let clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  try { return atob(clean + "==".slice(0, (4 - (clean.length % 4)) % 4)); } catch { return ""; }
}

/** 제목·보낸이 헤더: =?charset?B|Q?…?= 인코딩 단어와 8비트 원문(EUC-KR 등)을 모두 풀어낸다. */
export function decodeHeader(value: string): string {
  const v = String(value || "").replace(/\?=\s+=\?/g, "?==?");
  const decoded = v.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, text) => {
    const bin = enc.toUpperCase() === "B" ? decodeB64(text) : decodeQP(String(text).replace(/_/g, " "));
    return `\u0001${encodeURIComponent(decodeBytes(bin, cs))}\u0001`;
  });
  // 인코딩 단어 밖의 8비트 바이트는 charset 표시 없이 온 원문이다.
  return decoded.split("\u0001").map((part, i) => (i % 2 ? decodeURIComponent(part) : (/[\x80-\xff]/.test(part) ? decodeBytes(part) : part))).join("").trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/** MIME 원문(앞부분만 받아도 됨)에서 읽을 수 있는 본문을 꺼낸다 — text/plain 우선, 없으면 text/html. */
function extractText(raw: string, depth = 0): { text: string; html: boolean } | null {
  const { headers, body } = splitHeaderBody(raw);
  const ctype = headers["content-type"] || "text/plain";
  if (/^multipart\//i.test(ctype) && depth < 4) {
    const boundary = param(ctype, "boundary");
    if (!boundary) return null;
    const parts = body.split(`--${boundary}`).slice(1).filter((p) => !p.startsWith("--"));
    let htmlFallback: { text: string; html: boolean } | null = null;
    for (const p of parts) {
      const got = extractText(p.replace(/^\r?\n/, ""), depth + 1);
      if (got && !got.html && got.text.trim()) return got;
      if (got && got.html && !htmlFallback) htmlFallback = got;
    }
    return htmlFallback;
  }
  if (!/^text\/(plain|html)/i.test(ctype)) return null;
  const cte = String(headers["content-transfer-encoding"] || "").toLowerCase();
  const bin = cte === "base64" ? decodeB64(body) : cte === "quoted-printable" ? decodeQP(body) : body;
  const text = decodeBytes(bin, param(ctype, "charset"));
  const isHtml = /^text\/html/i.test(ctype);
  return { text: isHtml ? htmlToText(text) : text, html: isHtml };
}

export interface MailSummary { uid: number; subject: string; from: string; date: string; unread: boolean; snippet: string }

export function summarizeMessage(uid: number, flags: string, raw: string, snippetChars = 160): MailSummary {
  const { headers } = splitHeaderBody(raw);
  const body = extractText(raw);
  return {
    uid,
    subject: decodeHeader(headers.subject || "") || "(제목 없음)",
    from: decodeHeader(headers.from || ""),
    date: headers.date || "",
    unread: !/\\Seen/i.test(flags),
    snippet: (body?.text || "").replace(/\s+/g, " ").trim().slice(0, snippetChars),
  };
}

/** FETCH 응답 줄들 → (uid, flags, 원문) */
function parseFetch(res: ImapResponse): { uid: number; flags: string; raw: string }[] {
  const out: { uid: number; flags: string; raw: string }[] = [];
  res.lines.forEach((line, i) => {
    if (!/^\* \d+ FETCH /i.test(line)) return;
    const uid = Number(/UID (\d+)/i.exec(line)?.[1] || 0);
    const flags = /FLAGS \(([^)]*)\)/i.exec(line)?.[1] || "";
    const lit = /\u0000(\d+)\u0000/.exec(line);
    const raw = lit ? res.literals[i][Number(lit[1])] : "";
    if (uid) out.push({ uid, flags, raw });
  });
  return out;
}

// ── 메일함 찾기 ────────────────────────────────────────────────────────────
/** IMAP 수정 UTF-7(메일함 이름) → 문자열. "&1zTJwNG1-" → "휴지통" */
export function decodeMailboxName(name: string): string {
  return name.replace(/&([^-]*)-/g, (_, b64) => {
    if (!b64) return "&";
    const bin = atob(b64.replace(/,/g, "/") + "===".slice((b64.length + 3) % 4));
    let s = "";
    for (let i = 0; i + 1 < bin.length; i += 2) s += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return s;
  });
}

interface Mailbox { attrs: string; raw: string; label: string }

async function listMailboxes(conn: ImapConnection): Promise<Mailbox[]> {
  const res = await conn.ok('LIST "" "*"', "편지함 목록 조회");
  return res.lines.map((line, i) => {
    const m = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i.exec(line);
    if (!m) return null;
    let raw = m[2].trim();
    const lit = /^\u0000(\d+)\u0000$/.exec(raw);
    if (lit) raw = res.literals[i][Number(lit[1])];
    else if (raw.startsWith('"')) raw = raw.slice(1, -1).replace(/\\(.)/g, "$1");
    return { attrs: m[1], raw, label: decodeMailboxName(raw) };
  }).filter((b): b is Mailbox => !!b && !/\\Noselect/i.test(b.attrs));
}

// 휴지통·스팸편지함은 서버가 표시(\Trash·\Junk)를 주면 그걸, 없으면 흔한 이름으로 찾는다.
const SPECIAL_BOXES: Record<string, { attr: RegExp; names: string[]; label: string }> = {
  trash: { attr: /\\Trash/i, names: ["휴지통", "trash", "deleted messages", "deleted items", "지운편지함"], label: "휴지통" },
  spam: { attr: /\\Junk/i, names: ["스팸편지함", "스팸메일함", "스팸", "spam", "junk", "junk e-mail", "bulk mail"], label: "스팸편지함" },
};
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const INBOX: Mailbox = { attrs: "", raw: "INBOX", label: "받은편지함" };

/**
 * 편지함 찾기. 비우거나 "inbox"·"받은편지함" 이면 받은편지함, "trash"·"spam"(또는 휴지통·스팸) 은 특수 편지함,
 * 그 외는 사용자가 만든 편지함 이름.
 */
function resolveMailbox(boxes: Mailbox[], target: string): Mailbox {
  const want = String(target || "").trim();
  if (!want || ["inbox", "받은편지함"].includes(norm(want))) return INBOX;
  const key = ["trash", "휴지통"].includes(norm(want)) ? "trash" : ["spam", "junk", "스팸", "스팸편지함", "스팸메일함"].includes(norm(want)) ? "spam" : "";
  const special = key ? SPECIAL_BOXES[key] : null;
  const box = special
    ? boxes.find((b) => special.attr.test(b.attrs)) || boxes.find((b) => special.names.includes(b.label.toLowerCase()))
    : boxes.find((b) => b.label === want) || boxes.find((b) => norm(b.label) === norm(want));
  const names = boxes.map((b) => b.label).filter((l) => l.toUpperCase() !== "INBOX").join(", ").slice(0, 300);
  if (!box) throw new ImapError(`'${special?.label || want}' 편지함을 찾지 못했어요. 지금 있는 편지함: 받은편지함, ${names}`);
  return box.label.toUpperCase() === "INBOX" ? INBOX : box;
}

function uidList(uids: unknown): number[] {
  const list = (Array.isArray(uids) ? uids : String(uids || "").split(/[,\s]+/))
    .map((u) => Number(u)).filter((u) => Number.isInteger(u) && u > 0);
  return Array.from(new Set(list));
}

// ── 도구 본체 ──────────────────────────────────────────────────────────────
/**
 * 편지함 최근 N통(또는 안 읽은 메일만). 기본은 받은편지함, folder 로 휴지통·스팸·직접 만든 편지함도 본다.
 * EXAMINE·BODY.PEEK 라 읽음 표시를 바꾸지 않는다.
 */
export async function readDaumInbox(
  cred: MailCredentials,
  input: { max?: number; unreadOnly?: boolean; folder?: string },
  opts: { connector?: Connector } = {},
): Promise<any> {
  const max = Math.min(Math.max(Number(input?.max) || 10, 1), 20);
  const unreadOnly = input?.unreadOnly === true || String(input?.unreadOnly) === "true";
  return withDaumImap(cred, async (conn) => {
    const boxes = await listMailboxes(conn);
    const box = resolveMailbox(boxes, String(input?.folder || ""));
    const mailboxLabel = box.label;
    const ex = await conn.ok(`EXAMINE ${box === INBOX ? "INBOX" : quote(box.raw)}`, `${mailboxLabel} 열기`);
    const exists = Number(ex.lines.map((l) => /^\* (\d+) EXISTS/i.exec(l)?.[1]).find(Boolean) || 0);
    const uidValidity = Number(ex.lines.map((l) => /UIDVALIDITY (\d+)/i.exec(l)?.[1]).find(Boolean) || 0);
    let fetched: { uid: number; flags: string; raw: string }[] = [];
    let unseenTotal: number | undefined;
    const items = "(UID FLAGS BODY.PEEK[]<0.16000>)";
    if (unreadOnly) {
      const s = await conn.ok("UID SEARCH UNSEEN", "안 읽은 메일 찾기");
      const all = (s.lines.find((l) => /^\* SEARCH/i.test(l)) || "").replace(/^\* SEARCH\s*/i, "").split(/\s+/).map(Number).filter((n) => n > 0);
      unseenTotal = all.length;
      const pick = all.sort((a, b) => a - b).slice(-max);
      if (pick.length) fetched = parseFetch(await conn.ok(`UID FETCH ${pick.join(",")} ${items}`, "메일 읽기"));
    } else if (exists > 0) {
      const from = Math.max(1, exists - max + 1);
      fetched = parseFetch(await conn.ok(`FETCH ${from}:${exists} ${items}`, "메일 읽기"));
    }
    const emails = fetched.sort((a, b) => b.uid - a.uid).map((m) => summarizeMessage(m.uid, m.flags, m.raw));
    // 옮길 수 있는 편지함 이름 — 싱크가 "광고 편지함으로 옮겨" 같은 요청에서 실제 이름을 고르게 한다.
    const folders = boxes.map((b) => b.label).filter((l) => l.toUpperCase() !== "INBOX");
    return {
      kind: "daum_mail_list", account: cred.email, mailbox: mailboxLabel, uidValidity, total: exists, folders,
      ...(unseenTotal !== undefined ? { unreadTotal: unseenTotal } : {}),
      count: emails.length, emails,
    };
  }, opts);
}

/**
 * uid 로 지목한 메일을 한 편지함(from, 기본 받은편지함)에서 다른 편지함(folder)으로 옮긴다.
 * 휴지통 → 받은편지함 같은 복구도 같은 길이다. 옮기기 전에 제목을 읽어 무엇을 옮겼는지 보고한다.
 * uid·uidValidity 는 '원래 있던 편지함' 기준이다(daum_mail_read 를 그 편지함으로 읽은 결과).
 */
export async function moveDaumMail(
  cred: MailCredentials,
  input: { uids?: unknown; uidValidity?: number; folder?: string; from?: string },
  opts: { connector?: Connector } = {},
): Promise<{ moved: number; source: string; folder: string; items: { uid: number; subject: string; from: string }[]; missing?: number[] }> {
  const uids = uidList(input?.uids).slice(0, 30);
  if (!uids.length) throw new ImapError("옮길 메일의 uid 가 필요해요. 먼저 daum_mail_read 로 메일이 있는 편지함을 읽고 그 결과의 uid 를 그대로 넣어 주세요.");
  if (!String(input?.folder || "").trim()) throw new ImapError("옮길 편지함 이름(folder)이 필요해요. 예: \"받은편지함\", \"spam\", \"휴지통\", 또는 직접 만든 편지함 이름");
  return withDaumImap(cred, async (conn) => {
    // 편지함을 먼저 확인한다 — 없는 편지함이면 아무것도 건드리지 않고 있는 편지함 이름을 알려 준다.
    const boxes = await listMailboxes(conn);
    const source = resolveMailbox(boxes, String(input?.from || ""));
    const target = resolveMailbox(boxes, String(input.folder));
    if (source.raw === target.raw) throw new ImapError(`메일이 이미 '${source.label}'에 있어요. 옮길 다른 편지함 이름을 알려 주세요.`);
    const sel = await conn.ok(`SELECT ${source === INBOX ? "INBOX" : quote(source.raw)}`, `${source.label} 열기`);
    const uidValidity = Number(sel.lines.map((l) => /UIDVALIDITY (\d+)/i.exec(l)?.[1]).find(Boolean) || 0);
    if (input?.uidValidity && uidValidity && Number(input.uidValidity) !== uidValidity) {
      throw new ImapError(`'${source.label}'이 그사이 다시 만들어져 uid 가 바뀌었어요. daum_mail_read 로 다시 읽은 뒤 옮겨 주세요.`);
    }
    const found = parseFetch(await conn.ok(`UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])`, "옮길 메일 확인"));
    const missing = uids.filter((u) => !found.some((m) => m.uid === u));
    if (!found.length) return { moved: 0, source: source.label, folder: target.label, items: [], missing };
    const set = found.map((m) => m.uid).join(",");
    const box = target === INBOX ? "INBOX" : quote(target.raw);
    if (conn.capabilities.has("MOVE")) {
      await conn.ok(`UID MOVE ${set} ${box}`, `${target.label} 이동`);
    } else {
      await conn.ok(`UID COPY ${set} ${box}`, `${target.label} 복사`);
      await conn.ok(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`, `${source.label}에서 빼기`);
      await conn.ok(conn.capabilities.has("UIDPLUS") ? `UID EXPUNGE ${set}` : "EXPUNGE", `${source.label} 정리`);
    }
    const items = found.map((m) => {
      const s = summarizeMessage(m.uid, m.flags, m.raw);
      return { uid: s.uid, subject: s.subject, from: s.from };
    });
    return { moved: items.length, source: source.label, folder: target.label, items, ...(missing.length ? { missing } : {}) };
  }, opts);
}

/** 휴지통 이동(영구 삭제 아님). */
export async function trashDaumMail(
  cred: MailCredentials,
  input: { uids?: unknown; uidValidity?: number },
  opts: { connector?: Connector } = {},
): Promise<any> {
  const r = await moveDaumMail(cred, { uids: input?.uids, uidValidity: input?.uidValidity, folder: "trash" }, opts);
  return { kind: "daum_mail_trash", trashed: r.moved, folder: r.folder, items: r.items, ...(r.missing ? { missing: r.missing } : {}) };
}

// ── 휴지통·스팸편지함 영구 삭제 ────────────────────────────────────────────
// 되살릴 수 없으므로 ①승인 전에 지울 메일을 uid 목록으로 확정해 보여 주고(previewDaumPurge)
// ②승인되면 그 목록만 지운다(purgeDaumMailbox). 승인 사이에 새로 들어온 메일은 지우지 않는다.
// 영구 삭제는 버리는 편지함(휴지통·스팸편지함)에서만 한다 — 다른 편지함 메일은 먼저 휴지통으로 옮겨야 한다.
// "스팸함 비워줘" 를 uid 를 모아 오는 일로 만들면 직원이 20통씩 읽기를 되풀이하다 턴이 끊긴다(2026-10-13).
// 그래서 all 이면 서버가 편지함 전체 uid 를 직접 찾는다.
const PURGE_LIMIT = 1000;

async function openPurgeBox(conn: ImapConnection, folder: string, readOnly: boolean): Promise<{ box: Mailbox; uidValidity: number }> {
  const want = String(folder || "trash").trim();
  const key = ["spam", "junk", "스팸", "스팸편지함", "스팸메일함", "스팸함"].includes(norm(want)) ? "spam"
    : ["trash", "휴지통"].includes(norm(want)) ? "trash" : "";
  if (!key) throw new ImapError(`영구 삭제는 휴지통·스팸편지함에서만 할 수 있어요. '${want}' 메일은 먼저 daum_mail_trash(또는 daum_mail_move)로 휴지통에 옮긴 뒤 지워 주세요.`);
  const box = resolveMailbox(await listMailboxes(conn), key);
  const res = await conn.ok(`${readOnly ? "EXAMINE" : "SELECT"} ${quote(box.raw)}`, `${box.label} 열기`);
  return { box, uidValidity: Number(res.lines.map((l) => /UIDVALIDITY (\d+)/i.exec(l)?.[1]).find(Boolean) || 0) };
}

function headerItems(found: { uid: number; flags: string; raw: string }[]) {
  return found.map((m) => {
    const s = summarizeMessage(m.uid, m.flags, m.raw);
    return { uid: s.uid, subject: s.subject, from: s.from };
  });
}

/** 지울 대상 확정: all 이면 지금 그 편지함 전체(최대 1000통), uids 를 주면 그 편지함에 실제로 있는 것만. */
export async function previewDaumPurge(
  cred: MailCredentials,
  input: { folder?: string; uids?: unknown; all?: boolean },
  opts: { connector?: Connector } = {},
): Promise<{ target: string; folder: string; uidValidity: number; uids: number[]; items: { uid: number; subject: string; from: string }[]; more: number }> {
  const all = input?.all === true || String(input?.all) === "true";
  const asked = uidList(input?.uids);
  if (!all && !asked.length) throw new ImapError("지울 메일을 정해 주세요. 편지함 전체면 {\"folder\": \"spam\", \"all\": true}, 일부면 그 편지함을 daum_mail_read 로 읽은 결과의 uid 를 넣어 주세요.");
  const target = String(input?.folder || "trash");
  return withDaumImap(cred, async (conn) => {
    const opened = await openPurgeBox(conn, target, true);
    let uids: number[];
    if (all) {
      const s = await conn.ok("UID SEARCH ALL", `${opened.box.label} 메일 찾기`);
      uids = (s.lines.find((l) => /^\* SEARCH/i.test(l)) || "").replace(/^\* SEARCH\s*/i, "").split(/\s+/).map(Number).filter((n) => n > 0);
    } else {
      uids = parseFetch(await conn.ok(`UID FETCH ${asked.join(",")} (UID)`, "지울 메일 확인")).map((m) => m.uid);
    }
    uids = uids.sort((a, b) => b - a).slice(0, PURGE_LIMIT);
    if (!uids.length) throw new ImapError(all ? `${opened.box.label}이 이미 비어 있어요.` : `지정한 메일이 ${opened.box.label}에 없어요.`);
    const shown = uids.slice(0, 10);
    const items = headerItems(parseFetch(await conn.ok(`UID FETCH ${shown.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])`, "지울 메일 제목 확인")));
    return { target, folder: opened.box.label, uidValidity: opened.uidValidity, uids, items, more: uids.length - items.length };
  }, opts);
}

/** 승인된 uid 목록만 그 편지함(휴지통·스팸편지함)에서 영구 삭제한다. */
export async function purgeDaumMailbox(
  cred: MailCredentials,
  input: { target?: string; uids?: unknown; uidValidity?: number },
  opts: { connector?: Connector } = {},
): Promise<any> {
  const uids = uidList(input?.uids).slice(0, PURGE_LIMIT);
  if (!uids.length) throw new ImapError("영구 삭제할 메일 목록이 비어 있어요.");
  return withDaumImap(cred, async (conn) => {
    const opened = await openPurgeBox(conn, String(input?.target || "trash"), false);
    if (input?.uidValidity && opened.uidValidity && Number(input.uidValidity) !== opened.uidValidity) {
      throw new ImapError(`${opened.box.label}이 그사이 다시 만들어져 승인한 목록과 맞지 않아요. 아무것도 지우지 않았어요 — 다시 요청해 주세요.`);
    }
    const present = parseFetch(await conn.ok(`UID FETCH ${uids.join(",")} (UID)`, "지울 메일 확인")).map((m) => m.uid);
    if (!present.length) return { kind: "daum_mail_purge", deleted: 0, folder: opened.box.label };
    const set = present.join(",");
    await conn.ok(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`, "삭제 표시");
    // UIDPLUS 가 있으면 승인한 uid 만 지운다. 없으면 그 편지함에서 삭제 표시된 메일을 정리한다(그 편지함 안에서만).
    await conn.ok(conn.capabilities.has("UIDPLUS") ? `UID EXPUNGE ${set}` : "EXPUNGE", "영구 삭제");
    return { kind: "daum_mail_purge", deleted: present.length, folder: opened.box.label };
  }, opts);
}

/** 연결 테스트 — 로그인 + 받은편지함 개수(부수효과 없음). */
export async function checkDaumMail(cred: MailCredentials, opts: { connector?: Connector } = {}): Promise<{ total: number; unread: number }> {
  return withDaumImap(cred, async (conn) => {
    const st = await conn.ok("STATUS INBOX (MESSAGES UNSEEN)", "받은편지함 확인");
    const line = st.lines.find((l) => /^\* STATUS/i.test(l)) || "";
    return { total: Number(/MESSAGES (\d+)/i.exec(line)?.[1] || 0), unread: Number(/UNSEEN (\d+)/i.exec(line)?.[1] || 0) };
  }, opts);
}
