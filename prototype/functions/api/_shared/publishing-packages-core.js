// prototype/functions/api/_shared/publishing-packages-core.js
//
// 퍼블리싱 패키지 규칙 — DB·저장소 없이 판단하는 부분. 저장·복사는 publishing-packages.ts.
// 규격(범용): 업무 파일에서 post.md 가 들어 있는 폴더 하나 = 글 하나. 폴더 이름·위치는 해석하지 않는다(정보는 전부 post.md 안에).
//   post.md            머리말(--- … ---) + 본문(퍼블리싱 본문 표시: ## 소제목, **굵게**, - 목록, > 인용, [이미지 N], [글자](주소))
//   01.png, 02.jpg …   이미지(PNG·JPEG·GIF·WebP, 15MB). 이름 순서 = [이미지 N] 번호
//   *.mp4|webm|mov     첨부 영상(본문에 넣지 않는다). 복사하지 않고 업무 파일 경로를 가리킨다
//   translation.md     본문 번역 / notes.md 올리는 사람용 안내 / first-comment.md 올린 뒤 달 첫 댓글
//   result.json        NK_Studio 가 쓰는 게시 결과(가져올 때는 읽지 않는다)
// 사람용 설명: NK_Studio_Doc/docs/publishing-packages.md

export const PACKAGE_POST_FILE = "post.md";
export const PACKAGE_RESULT_FILE = "result.json";
/** 고른 폴더 아래 몇 단계까지 post.md 를 찾는지(고른 폴더 자신 = 0단계). */
export const PACKAGE_SCAN_DEPTH = 3;
/** 한 번에 찾는 패키지 수. 넘으면 앞에서부터 이만큼만 보여 주고 '더 있음'을 알린다. */
export const PACKAGE_SCAN_MAX = 60;
export const PACKAGE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const PACKAGE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const PACKAGE_TEXT_MAX_BYTES = 256 * 1024;
export const PACKAGE_IMAGES_MAX = 20;
export const PACKAGE_VIDEOS_MAX = 10;
/** 패키지에서 읽는 글 파일 → extras 칸. */
export const PACKAGE_TEXT_FILES = { "translation.md": "translation", "notes.md": "notes", "first-comment.md": "firstComment" };

const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
const VIDEO_TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const WORK_PATH_PREFIX = "@work/";
const WORK_FILES_ROOT = ".work-files";

/**
 * 업무 파일 경로(화면에 보이는 모양) → 저장소 상대 경로. 날짜 폴더(@work/YYYY-MM-DD/…)는 실제 저장 위치(.work-files/YYYY-MM-DD/…)로.
 * 반환: { ok, path } | { ok:false, error }
 */
export function normalizePackagePath(raw) {
  const s = String(raw == null ? "" : raw).normalize("NFC").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (s.length > 500) return { ok: false, error: "package_path_invalid" };
  const parts = s ? s.split("/") : [];
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part)) return { ok: false, error: "package_path_invalid" };
  }
  if (parts[0] === WORK_PATH_PREFIX.slice(0, -1)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "")) return { ok: false, error: "package_path_unsupported" };
    return { ok: true, path: [WORK_FILES_ROOT, ...parts.slice(1)].join("/") };
  }
  return { ok: true, path: parts.join("/") };
}

/** 저장 위치(.work-files/날짜/…) → 화면 경로(@work/날짜/…). 사람에게 보여 줄 때·영상 받기 주소에 쓴다. */
export function displayPackagePath(path) {
  const s = String(path || "");
  return s.startsWith(`${WORK_FILES_ROOT}/`) ? `${WORK_PATH_PREFIX}${s.slice(WORK_FILES_ROOT.length + 1)}` : s;
}

/** '2.png' 가 '10.png' 보다 앞(숫자는 숫자로). */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/**
 * 고른 폴더 아래 저장소 목록 → 패키지 목록. post.md 가 있는 폴더마다 바로 안의 파일만 모은다(더 깊은 폴더의 파일은 그 폴더 패키지 몫).
 * @param {Array<{path:string,size?:number,md5?:string,contentType?:string}>} entries 고른 폴더 기준이 아닌 업무 파일 상대 경로
 * @param {string} base 고른 폴더(저장소 상대 경로, 루트면 "")
 * @returns {{ packages: Array<{folder:string, files:Array<object>}>, truncated:boolean }}
 */
export function findPackages(entries, base, maxDepth = PACKAGE_SCAN_DEPTH, max = PACKAGE_SCAN_MAX) {
  const root = base ? `${base}/` : "";
  const byFolder = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const path = String(e?.path || "");
    if (!path.startsWith(root)) continue;
    const slash = path.lastIndexOf("/");
    const folder = slash >= 0 ? path.slice(0, slash) : "";
    const name = path.slice(slash + 1);
    // 점으로 시작하는 이름은 저장소가 쓰는 숨은 표시 파일(빈 폴더 표시 등)이라 뺀다.
    if (!name || name.startsWith(".")) continue;
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push({ name, path, size: Number(e.size) || 0, md5: String(e.md5 || ""), contentType: String(e.contentType || "") });
  }
  const depthOf = (folder) => (folder === base ? 0 : folder.slice(root.length).split("/").length);
  const all = [...byFolder.entries()]
    .filter(([folder, files]) => (folder === base || folder.startsWith(root)) && depthOf(folder) <= maxDepth
      && files.some((f) => f.name.toLowerCase() === PACKAGE_POST_FILE))
    .map(([folder, files]) => ({ folder, files: files.sort((a, b) => naturalCompare(a.name, b.name)) }))
    .sort((a, b) => naturalCompare(a.folder, b.folder));
  return { packages: all.slice(0, max), truncated: all.length > max };
}

/** 패키지 안 파일을 역할별로 나눈다. result.json·모르는 파일은 뺀다. */
export function classifyPackageFiles(files) {
  const out = { post: null, images: [], videos: [], texts: {}, ignored: [] };
  for (const f of Array.isArray(files) ? files : []) {
    const lower = f.name.toLowerCase();
    if (lower === PACKAGE_POST_FILE) out.post = f;
    else if (PACKAGE_TEXT_FILES[lower]) out.texts[PACKAGE_TEXT_FILES[lower]] = f;
    else if (IMAGE_RE.test(lower)) out.images.push(f);
    else if (VIDEO_RE.test(lower)) out.videos.push(f);
    else if (lower !== PACKAGE_RESULT_FILE) out.ignored.push(f);
  }
  out.images.sort((a, b) => naturalCompare(a.name, b.name));
  out.videos.sort((a, b) => naturalCompare(a.name, b.name));
  return out;
}

export function videoContentType(name) {
  return VIDEO_TYPES[String(name).toLowerCase().split(".").pop()] || "video/mp4";
}

/**
 * 패키지 지문: 가져올 때 쓰는 파일들의 이름·크기·md5(저장소 목록에 있는 값). 같으면 다시 읽지 않는다.
 * result.json 은 NK_Studio 가 쓰는 파일이라 넣지 않는다(결과를 쓸 때마다 '바뀜'이 되지 않게).
 */
export function packageFingerprintSource(files) {
  const c = classifyPackageFiles(files);
  const used = [c.post, ...c.images, ...c.videos, ...Object.values(c.texts)].filter(Boolean);
  return used.map((f) => `${f.name}|${f.size}|${f.md5}`).sort().join("\n");
}

// ── post.md ─────────────────────────────────────────────────────────────────

function stripComment(v) {
  let quote = "";
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(v[i - 1]))) return v.slice(0, i).trimEnd();
  }
  return v;
}

function unquote(v) {
  const s = String(v).trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function splitInlineList(inner) {
  const out = [];
  let cur = "";
  let quote = "";
  for (const ch of inner) {
    if (quote) { cur += ch; if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ",") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(unquote).map((x) => x.trim()).filter(Boolean);
}

/**
 * 머리말(YAML 의 쉬운 부분만): `키: 값`, 따옴표 글자, [a, b] 목록, 아래 줄 `- 값` 목록, `# 설명` 꼬리.
 * 반환: { meta, body, hasFrontMatter }
 */
export function parseFrontMatter(text) {
  const src = String(text == null ? "" : text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = src.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { meta: {}, body: src.trim(), hasFrontMatter: false };
  const meta = {};
  let listKey = "";
  for (const raw of m[1].split("\n")) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const item = raw.match(/^\s+-\s+(.*)$/) || raw.match(/^-\s+(.*)$/);
    if (item && listKey) { meta[listKey].push(unquote(stripComment(item[1]))); continue; }
    const kv = raw.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = stripComment(kv[2]).trim();
    listKey = "";
    if (!value) { meta[key] = []; listKey = key; continue; }
    if (value.startsWith("[") && value.endsWith("]")) { meta[key] = splitInlineList(value.slice(1, -1)); continue; }
    meta[key] = unquote(value);
  }
  return { meta, body: src.slice(m[0].length).replace(/^\n+/, "").trimEnd(), hasFrontMatter: true };
}

/**
 * 게시 시각 → ISO. 시간대가 없으면 한국 시간으로 본다('2026-10-22 20:00', '2026-10-22T20:00').
 * 날짜만 있으면 "" (시각이 꼭 있어야 일정이 된다). 못 읽으면 "".
 */
export function parsePackageTime(raw) {
  const s = String(raw == null ? "" : raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return "";
  const zone = m[6] ? (m[6].toUpperCase() === "Z" ? "Z" : m[6].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : "+09:00";
  const ms = Date.parse(`${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:${m[4] || "00"}${zone}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
}

const scalar = (v) => (Array.isArray(v) ? v.join(" ") : String(v == null ? "" : v)).trim();

/**
 * post.md → 글 정보. 반환: { ok, post, warnings } | { ok:false, error }.
 * post: { title, body, channel, target, scheduledAt(ISO|""), tags[], brand, lang, id }
 */
export function parsePackagePost(text) {
  const { meta, body, hasFrontMatter } = parseFrontMatter(text);
  if (!hasFrontMatter) return { ok: false, error: "front_matter_missing" };
  const title = scalar(meta.title);
  if (!title) return { ok: false, error: "title_required" };
  const warnings = [];
  const rawTime = scalar(meta.scheduledAt ?? meta.scheduled_at ?? meta.date);
  const scheduledAt = parsePackageTime(rawTime);
  if (!rawTime) warnings.push("scheduled_at_missing");
  else if (!scheduledAt) warnings.push("scheduled_at_invalid");
  const channel = scalar(meta.channel);
  if (!channel) warnings.push("channel_missing");
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : scalar(meta.tags).split(/[\s,]+/).filter(Boolean);
  if (!body.trim()) warnings.push("body_empty");
  return {
    ok: true,
    post: {
      title, body, channel, target: scalar(meta.target), scheduledAt, tags,
      brand: scalar(meta.brand), lang: scalar(meta.lang).slice(0, 10) || "ko", id: scalar(meta.id),
    },
    warnings,
  };
}

/** 글 externalId: 머리말 id, 없으면 폴더 경로. 160자를 넘는 경로는 앞부분 + 지문으로 줄인다(같은 폴더는 늘 같은 값). */
export function packageExternalId(id, folder, hashHex = "") {
  const own = String(id || "").replace(/[\u0000-\u001f]+/g, " ").trim();
  if (own) return own.slice(0, 160);
  const path = displayPackagePath(folder);
  if (path.length <= 160) return path;
  return `${path.slice(0, 140)}#${String(hashHex).slice(0, 16)}`;
}

/** [이미지 N] 표시 중 이미지 수를 넘는 번호(빠진 이미지 파일). */
export function missingImageMarkers(body, imageCount) {
  const out = new Set();
  for (const m of String(body || "").matchAll(/\[\s*(?:이미지|사진|image|photo)\s*(\d{1,2})\s*\]/gi)) {
    const n = Number(m[1]);
    if (n > imageCount) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
