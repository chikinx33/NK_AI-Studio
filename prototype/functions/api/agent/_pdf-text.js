// prototype/functions/api/agent/_pdf-text.js
// PDF 본문 텍스트 추출기 — 외부 라이브러리 없이 Workers 에서 돈다(함수 빌드에 npm 의존성이 없다).
//
// 2026-09-25: 직원이 업무 파일의 한글 PDF(Shapes 소개서)를 못 읽었다. 옛 추출기는 "(…)" 문자열만 보고
// 글꼴 표를 안 읽어서, 한글 PDF 의 일반적인 형태 — Type0(Identity-H) 글꼴 + ToUnicode 표 + 16진 문자열
// <05B8…>Tj — 를 통째로 놓쳤다. 여기서는
//  - 객체 스트림(/ObjStm, 압축된 객체 묶음) 안의 글꼴·페이지 객체까지 찾고
//  - 글꼴마다 ToUnicode CMap(bfchar/bfrange)을 읽어 코드 → 유니코드로 바꾸며
//  - 16진 <…>·리터럴 (…) 문자열, TJ 배열, Td/Tm/T* 줄바꿈을 해석해
// 페이지 순서대로 텍스트를 만든다. 그림만 있는(스캔) PDF 는 빈 문자열을 돌려준다.
//
// 지원: FlateDecode(zlib) 스트림, Type0/TrueType/Type1 글꼴, 페이지 트리(Kids), 폼 XObject 안의 글.
// 미지원: LZW/ASCII85 등 다른 필터, 암호화 PDF, 글꼴 내장 cmap 만 있고 ToUnicode 가 없는 CID 글꼴(그 글자는 빠진다).

/** 바이트를 1:1 로 문자로 바꾼다(TextDecoder("latin1") 은 windows-1252 라 값이 바뀐다). */
function latin1(bytes) {
  let out = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return out;
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 스트림 본문을 푼다. FlateDecode 만 지원, 그 외 필터는 null. */
async function decodeStream(obj, bytes) {
  if (!obj || obj.streamStart < 0) return null;
  const filter = /\/Filter\s*(?:\[\s*)?\/(\w+)/.exec(obj.dict);
  let slice = bytes.subarray(obj.streamStart, obj.streamEnd);
  if (!filter) return slice;
  if (filter[1] !== "FlateDecode" && filter[1] !== "Fl") return null;
  try { return await inflate(slice); } catch { /* 끝에 붙은 공백·개행을 떼고 한 번 더 */ }
  let end = obj.streamEnd;
  while (end > obj.streamStart && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d || bytes[end - 1] === 0x20)) end -= 1;
  slice = bytes.subarray(obj.streamStart, end);
  try { return await inflate(slice); } catch { return null; }
}

/** 최상위 객체 "N G obj … endobj" 를 모두 찾는다. 스트림은 위치만 기억한다(그림은 절대 풀지 않는다). */
function parseTopLevelObjects(latin) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(latin))) {
    const num = Number(m[1]);
    const bodyStart = m.index + m[0].length;
    const streamAt = latin.indexOf("stream", bodyStart);
    const endobjAt = latin.indexOf("endobj", bodyStart);
    if (endobjAt < 0) break;
    let dict;
    let streamStart = -1;
    let streamEnd = -1;
    if (streamAt >= 0 && streamAt < endobjAt) {
      dict = latin.slice(bodyStart, streamAt);
      let start = streamAt + "stream".length;
      if (latin[start] === "\r") start += 1;
      if (latin[start] === "\n") start += 1;
      const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let end = -1;
      if (lengthMatch) {
        end = start + Number(lengthMatch[1]);
        if (end > endobjAt || latin.indexOf("endstream", end) < 0) end = -1;
      }
      if (end < 0) {
        end = latin.lastIndexOf("endstream", endobjAt);
        if (end < start) end = start;
        while (end > start && (latin[end - 1] === "\n" || latin[end - 1] === "\r")) end -= 1;
      }
      streamStart = start;
      streamEnd = end;
      re.lastIndex = endobjAt + 6;
    } else {
      dict = latin.slice(bodyStart, endobjAt);
      re.lastIndex = endobjAt + 6;
    }
    objects.set(num, { num, dict, streamStart, streamEnd });
  }
  return objects;
}

/** 객체 스트림(/Type /ObjStm) 안의 객체들을 꺼낸다 — 글꼴·페이지 사전이 대개 여기에 있다. */
async function expandObjectStreams(objects, bytes) {
  for (const obj of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(obj.dict)) continue;
    const data = await decodeStream(obj, bytes);
    if (!data) continue;
    const text = latin1(data);
    const n = Number((/\/N\s+(\d+)/.exec(obj.dict) || [])[1] || 0);
    const first = Number((/\/First\s+(\d+)/.exec(obj.dict) || [])[1] || 0);
    const header = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = header[i * 2];
      const offset = header[i * 2 + 1];
      if (!Number.isFinite(num) || !Number.isFinite(offset)) break;
      const next = i + 1 < n ? header[(i + 1) * 2 + 1] : text.length - first;
      const dict = text.slice(first + offset, first + next);
      if (!objects.has(num)) objects.set(num, { num, dict, streamStart: -1, streamEnd: -1 });
    }
  }
}

/** "12 0 R" 참조를 따라간다. 직접 값이면 그대로. */
function deref(objects, value) {
  const m = /^\s*(\d+)\s+\d+\s+R\s*$/.exec(String(value || ""));
  if (!m) return null;
  return objects.get(Number(m[1])) || null;
}

/** 사전 문자열에서 /Key 의 값을 대략 꺼낸다(참조·이름·숫자·<<…>>·[…]). */
function dictValue(dict, key) {
  const idx = dict.search(new RegExp(`/${key}(?![A-Za-z0-9_])`));
  if (idx < 0) return "";
  let i = idx + key.length + 1;
  while (i < dict.length && /\s/.test(dict[i])) i += 1;
  if (dict.startsWith("<<", i)) {
    let depth = 0;
    for (let j = i; j < dict.length - 1; j++) {
      if (dict.startsWith("<<", j)) { depth += 1; j += 1; }
      else if (dict.startsWith(">>", j)) { depth -= 1; j += 1; if (depth === 0) return dict.slice(i, j + 1); }
    }
    return dict.slice(i);
  }
  if (dict[i] === "[") {
    let depth = 0;
    for (let j = i; j < dict.length; j++) {
      if (dict[j] === "[") depth += 1;
      else if (dict[j] === "]") { depth -= 1; if (depth === 0) return dict.slice(i, j + 1); }
    }
    return dict.slice(i);
  }
  const ref = /^(\d+)\s+\d+\s+R/.exec(dict.slice(i));
  if (ref) return ref[0];
  const token = /^\/?[^\s/<>\[\]]+/.exec(dict.slice(i));
  return token ? token[0] : "";
}

/** /Resources 처럼 인라인 사전이거나 참조인 값을 사전 문자열로. */
function resolveDict(objects, value) {
  if (!value) return "";
  if (value.startsWith("<<")) return value;
  const obj = deref(objects, value);
  return obj ? obj.dict : "";
}

// ── 글꼴: ToUnicode CMap ───────────────────────────────────────────────────

function hexToCode(hex) { return parseInt(hex, 16); }
function hexToString(hex) {
  // UTF-16BE 코드 유닛 나열 → 문자열(서로게이트 쌍 포함)
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
  let out = "";
  for (let i = 0; i + 4 <= clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  if (clean.length % 4 === 2) out += String.fromCharCode(parseInt(clean.slice(-2), 16));
  return out;
}

/** bfchar/bfrange 를 읽어 코드 → 문자열 표와 코드 바이트 길이를 만든다. */
function parseToUnicode(cmapText) {
  const map = new Map();
  let codeBytes = 0;
  const range = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  let m;
  while ((m = range.exec(cmapText))) {
    const first = /<([0-9A-Fa-f]+)>/.exec(m[1]);
    if (first) codeBytes = Math.max(codeBytes, Math.ceil(first[1].length / 2));
  }
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bfchar.exec(cmapText))) {
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]*)>/g;
    let p;
    while ((p = pair.exec(m[1]))) map.set(hexToCode(p[1]), hexToString(p[2]));
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfrange.exec(cmapText))) {
    const body = m[1];
    const entry = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f\s]*>|\[[^\]]*\])/g;
    let e;
    while ((e = entry.exec(body))) {
      const lo = hexToCode(e[1]);
      const hi = hexToCode(e[2]);
      if (hi < lo || hi - lo > 65535) continue;
      if (e[3].startsWith("[")) {
        const items = [...e[3].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => hexToString(x[1]));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      } else {
        const dst = hexToString(e[3].slice(1, -1));
        if (!dst) continue;
        const last = dst.charCodeAt(dst.length - 1);
        const head = dst.slice(0, -1);
        for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(last + (c - lo)));
      }
    }
  }
  return { map, codeBytes };
}

/** 글꼴 객체 → 디코더 { codeBytes, decode(bytes[]) }. */
async function buildFont(objects, bytes, fontObj, cache) {
  if (cache.has(fontObj.num)) return cache.get(fontObj.num);
  const dict = fontObj.dict;
  const subtype = (/\/Subtype\s*\/(\w+)/.exec(dict) || [])[1] || "";
  const encoding = dictValue(dict, "Encoding");
  // 코드 길이는 글꼴 종류가 정한다: Type0(CID) 은 2바이트, TrueType/Type1 같은 단순 글꼴은 항상 1바이트.
  // ToUnicode 표의 codespacerange 만 믿으면 안 된다 — 단순 글꼴인데 <0000><FFFF> 로 써 두는 제작 도구가 있어
  // 숫자·영문·기호(1바이트 글꼴)가 통째로 사라졌다(2026-09-25 소개서에서 확인).
  const simpleFont = /^(TrueType|Type1|Type3|MMType1)$/.test(subtype);
  let codeBytes = simpleFont ? 1 : (subtype === "Type0" || /Identity-[HV]|UCS2|UTF16/.test(encoding) ? 2 : 1);
  let map = new Map();
  const toUnicode = deref(objects, dictValue(dict, "ToUnicode"));
  if (toUnicode) {
    const data = await decodeStream(toUnicode, bytes);
    if (data) {
      const parsed = parseToUnicode(latin1(data));
      map = parsed.map;
      if (!simpleFont && parsed.codeBytes) codeBytes = parsed.codeBytes;
    }
  }
  // 커서 이동(Td/Tm)이 진짜 빈칸인지 판단하려고 글자 폭을 어림한다(em 단위).
  // CID 글꼴은 /DW(기본 1000), 단순 글꼴은 /Widths 평균, 없으면 0.5em. 정밀할 필요는 없다 — 빈칸(≥0.3em)만 가르면 된다.
  let advanceEm = codeBytes === 2 ? 1 : 0.5;
  if (codeBytes === 2) {
    const descendant = deref(objects, (dictValue(dict, "DescendantFonts").match(/(\d+)\s+\d+\s+R/) || [])[0] || "");
    const dw = descendant ? Number((/\/DW\s+(\d+)/.exec(descendant.dict) || [])[1] || 1000) : 1000;
    advanceEm = (dw || 1000) / 1000;
  } else {
    const widths = dictValue(dict, "Widths");
    const nums = widths.startsWith("[") ? widths.slice(1, -1).trim().split(/\s+/).map(Number).filter((n) => n > 0) : [];
    if (nums.length) advanceEm = nums.reduce((a, b) => a + b, 0) / nums.length / 1000;
  }
  const font = {
    codeBytes,
    advanceEm,
    decode(codes) {
      let out = "";
      for (let i = 0; i < codes.length; i += codeBytes) {
        const code = codeBytes === 2 ? ((codes[i] << 8) | (codes[i + 1] ?? 0)) : codes[i];
        const mapped = map.get(code);
        if (mapped !== undefined) out += mapped;
        else if (codeBytes === 1) out += String.fromCharCode(code); // WinAnsi/Standard 근사
        // Type0 인데 표에 없는 코드는 알 수 없는 글리프 — 건너뛴다
      }
      return out;
    },
  };
  cache.set(fontObj.num, font);
  return font;
}

/** 리소스 사전의 /Font << /F1 1 0 R … >> → 이름 → 글꼴 객체 */
function fontRefsOf(objects, resourcesDict) {
  const fontDict = resolveDict(objects, dictValue(resourcesDict, "Font"));
  const refs = new Map();
  const re = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(fontDict))) {
    const obj = objects.get(Number(m[2]));
    if (obj) refs.set(m[1], obj);
  }
  return refs;
}

// ── 콘텐츠 스트림 해석 ────────────────────────────────────────────────────

/** 리터럴 문자열 (…) 의 바이트를 돌려준다(이스케이프·중첩 괄호 처리). 반환: [bytes, 다음 인덱스] */
function readLiteral(text, start) {
  const out = [];
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      const next = text[i + 1];
      if (/[0-7]/.test(next || "")) {
        const oct = /^[0-7]{1,3}/.exec(text.slice(i + 1, i + 4))[0];
        out.push(parseInt(oct, 8) & 0xff);
        i += oct.length;
      } else {
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[next];
        if (esc !== undefined) out.push(esc);
        else if (next === "\n" || next === "\r") { /* 줄 이음 */ }
        else if (next !== undefined) out.push(next.charCodeAt(0) & 0xff);
        i += 1;
      }
      continue;
    }
    if (ch === "(") { if (depth > 0) out.push(40); depth += 1; continue; }
    if (ch === ")") { depth -= 1; if (depth === 0) return [out, i + 1]; out.push(41); continue; }
    out.push(ch.charCodeAt(0) & 0xff);
  }
  return [out, i];
}

function readHex(text, start) {
  const end = text.indexOf(">", start);
  const hex = text.slice(start + 1, end < 0 ? text.length : end).replace(/[^0-9A-Fa-f]/g, "");
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
  return [out, end < 0 ? text.length : end + 1];
}

/**
 * 콘텐츠 스트림 하나를 텍스트로. 글꼴 이름(Tf)에 따라 문자열을 디코딩하고,
 * Td·TD·T*·Tm·'·" 연산자로 줄을 나눈다. 같은 줄 안의 가로 이동은 공백으로 본다.
 */
async function textOfContent(objects, bytes, content, fontRefs, fontCache, depth, visited) {
  const text = latin1(content);
  const lines = [];
  let line = "";
  let font = null;
  let fontSize = 1;
  let lastTmY = null;
  let lastTmX = null;
  let tmScale = 1;
  // 마지막 위치 지정(Td/Tm/BT) 이후 글자가 진행한 거리(텍스트 공간 단위 = em × 글자 크기).
  // Td 의 가로 이동이 이 값과 비슷하면 그냥 다음 글자 자리로 옮긴 것이고, 0.3em 넘게 크면 빈칸이다.
  let penAdvance = 0;
  const operands = [];
  const flush = () => { if (line.trim()) lines.push(line.replace(/[ \t]+/g, " ").trim()); line = ""; };
  const append = (s) => {
    line += s;
    penAdvance += (font ? Array.from(s).length * font.advanceEm : s.length * 0.5) * fontSize;
  };
  const spaceIfNeeded = () => { if (line && !/\s$/.test(line)) line += " "; };
  const decodeBytes = (arr) => (font ? font.decode(arr) : latin1(Uint8Array.from(arr)));

  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === "%") { const nl = text.indexOf("\n", i); i = nl < 0 ? n : nl + 1; continue; }
    if (ch === "(") { const [b, next] = readLiteral(text, i); operands.push({ str: b }); i = next; continue; }
    if (ch === "<" && text[i + 1] === "<") { // 인라인 사전(BDC 의 속성 등) — 통째로 건너뛴다
      let d = 0; let j = i;
      for (; j < n - 1; j++) {
        if (text.startsWith("<<", j)) { d += 1; j += 1; }
        else if (text.startsWith(">>", j)) { d -= 1; j += 1; if (d === 0) { j += 1; break; } }
      }
      i = j; operands.length = 0; continue;
    }
    if (ch === "<") { const [b, next] = readHex(text, i); operands.push({ str: b }); i = next; continue; }
    if (ch === "[") {
      // TJ 배열: 문자열과 커닝 숫자. 큰 음수(왼쪽으로 크게 벌림)는 단어 사이 공백.
      const items = [];
      let j = i + 1;
      while (j < n && text[j] !== "]") {
        const c = text[j];
        if (/\s/.test(c)) { j += 1; continue; }
        if (c === "(") { const [b, next] = readLiteral(text, j); items.push({ str: b }); j = next; continue; }
        if (c === "<") { const [b, next] = readHex(text, j); items.push({ str: b }); j = next; continue; }
        const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(text.slice(j, j + 32));
        if (num) { items.push({ num: Number(num[0]) }); j += num[0].length; continue; }
        j += 1;
      }
      operands.push({ arr: items });
      i = j + 1;
      continue;
    }
    if (ch === "/") {
      const name = /^\/([^\s/<>\[\]()]*)/.exec(text.slice(i, i + 128));
      operands.push({ name: name ? name[1] : "" });
      i += name ? name[0].length : 1;
      continue;
    }
    const num = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(text.slice(i, i + 32));
    if (num) { operands.push({ num: Number(num[0]) }); i += num[0].length; continue; }
    const op = /^[A-Za-z'"*]+/.exec(text.slice(i, i + 8));
    if (!op) { i += 1; continue; }
    i += op[0].length;
    const o = op[0];
    switch (o) {
      case "Tf": {
        const nameArg = operands.find((x) => x.name !== undefined);
        const sizeArg = operands.filter((x) => x.num !== undefined).pop();
        const ref = nameArg ? fontRefs.get(nameArg.name) : null;
        font = ref ? await buildFont(objects, bytes, ref, fontCache) : null;
        fontSize = sizeArg ? Math.abs(sizeArg.num) || 1 : 1;
        break;
      }
      case "Tj": { const s = operands.find((x) => x.str); if (s) append(decodeBytes(s.str)); break; }
      case "'": case '"': { flush(); const s = operands.filter((x) => x.str).pop(); if (s) append(decodeBytes(s.str)); break; }
      case "TJ": {
        const arr = operands.find((x) => x.arr);
        if (arr) for (const item of arr.arr) {
          if (item.str) append(decodeBytes(item.str));
          else if (item.num !== undefined) {
            penAdvance -= (item.num / 1000) * fontSize;
            if (item.num < -180) spaceIfNeeded();
          }
        }
        break;
      }
      case "Td": case "TD": {
        const nums = operands.filter((x) => x.num !== undefined).map((x) => x.num);
        const ty = nums[nums.length - 1] ?? 0;
        const tx = nums[nums.length - 2] ?? 0;
        if (Math.abs(ty) > 0.5 * Math.max(fontSize, 0.01)) flush();
        else if (tx - penAdvance > 0.3 * fontSize) spaceIfNeeded();
        penAdvance = 0;
        break;
      }
      case "T*": flush(); penAdvance = 0; break;
      case "Tm": {
        const nums = operands.filter((x) => x.num !== undefined).map((x) => x.num);
        const a = nums[0]; const x = nums[4]; const y = nums[5];
        if (lastTmY !== null && y !== undefined && Math.abs(y - lastTmY) > 0.5) flush();
        else if (lastTmY !== null && lastTmX !== null && x !== undefined) {
          // 같은 줄: 이전 글의 끝(lastTmX + 진행량×배율)보다 0.3em 넘게 오른쪽이면 빈칸
          const expectedX = lastTmX + penAdvance * tmScale;
          if (x - expectedX > 0.3 * fontSize * tmScale) spaceIfNeeded();
        }
        if (y !== undefined) lastTmY = y;
        if (x !== undefined) lastTmX = x;
        if (a !== undefined && Math.abs(a) > 0.0001) tmScale = Math.abs(a);
        penAdvance = 0;
        break;
      }
      case "BT": lastTmY = null; lastTmX = null; penAdvance = 0; break;
      case "ET": flush(); break;
      case "Do": {
        // 폼 XObject 안의 글(표지·머리글 등). 그림은 건너뛴다.
        const nameArg = operands.find((x) => x.name !== undefined);
        const xobj = nameArg ? fontRefs.__xobjects?.get(nameArg.name) : null;
        if (xobj && depth < 3 && !visited.has(xobj.num) && /\/Subtype\s*\/Form\b/.test(xobj.dict)) {
          visited.add(xobj.num);
          flush();
          const data = await decodeStream(xobj, bytes);
          if (data) {
            const inner = fontRefsOf(objects, resolveDict(objects, dictValue(xobj.dict, "Resources")) || "");
            attachXObjects(objects, inner, resolveDict(objects, dictValue(xobj.dict, "Resources")));
            const sub = await textOfContent(objects, bytes, data, inner.size ? inner : fontRefs, fontCache, depth + 1, visited);
            if (sub) lines.push(sub);
          }
        }
        break;
      }
      default: break;
    }
    operands.length = 0;
  }
  flush();
  return lines.join("\n");
}

/** 리소스의 /XObject 표를 글꼴 표에 얹어 둔다(Do 해석용). */
function attachXObjects(objects, fontRefs, resourcesDict) {
  const xDict = resolveDict(objects, dictValue(resourcesDict || "", "XObject"));
  const refs = new Map();
  const re = /\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = re.exec(xDict))) { const obj = objects.get(Number(m[2])); if (obj) refs.set(m[1], obj); }
  fontRefs.__xobjects = refs;
}

// ── 페이지 트리 ────────────────────────────────────────────────────────────

function pageObjectsInOrder(objects) {
  const catalog = [...objects.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const root = catalog ? deref(objects, dictValue(catalog.dict, "Pages")) : null;
  const out = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || seen.has(node.num) || depth > 64) return;
    seen.add(node.num);
    if (/\/Type\s*\/Page\b/.test(node.dict)) { out.push(node); return; }
    const kids = dictValue(node.dict, "Kids");
    for (const m of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(objects.get(Number(m[1])), depth + 1);
  };
  walk(root, 0);
  if (out.length) return out;
  // 카탈로그를 못 찾으면 객체 번호순(대개 페이지 순서와 같다)
  return [...objects.values()].filter((o) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a.num - b.num);
}

/** 페이지의 /Resources — 없으면 부모(Pages)에서 물려받는다. */
function pageResources(objects, page) {
  let node = page;
  for (let depth = 0; node && depth < 64; depth++) {
    const value = dictValue(node.dict, "Resources");
    if (value) return resolveDict(objects, value);
    node = deref(objects, dictValue(node.dict, "Parent"));
  }
  return "";
}

async function pageContent(objects, bytes, page) {
  const value = dictValue(page.dict, "Contents");
  const refs = value.startsWith("[") ? [...value.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])) : (() => { const m = /(\d+)\s+\d+\s+R/.exec(value); return m ? [Number(m[1])] : []; })();
  const parts = [];
  for (const num of refs) {
    const obj = objects.get(num);
    const data = obj ? await decodeStream(obj, bytes) : null;
    if (data) parts.push(data);
  }
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.length + 1, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { joined.set(p, offset); offset += p.length; joined[offset] = 0x0a; offset += 1; }
  return joined;
}

/**
 * PDF 바이트 → 페이지별 텍스트. 글이 하나도 없으면(스캔본) 빈 배열.
 * @returns {Promise<string[]>} 페이지 순서의 텍스트(빈 페이지는 "")
 */
export async function extractPdfPages(bytes) {
  const latin = latin1(bytes);
  const objects = parseTopLevelObjects(latin);
  await expandObjectStreams(objects, bytes);
  const pages = pageObjectsInOrder(objects);
  const fontCache = new Map();
  const out = [];
  for (const page of pages) {
    const resources = pageResources(objects, page);
    const fontRefs = fontRefsOf(objects, resources);
    attachXObjects(objects, fontRefs, resources);
    const content = await pageContent(objects, bytes, page);
    if (!content) { out.push(""); continue; }
    try {
      out.push(await textOfContent(objects, bytes, content, fontRefs, fontCache, 0, new Set()));
    } catch {
      out.push("");
    }
  }
  return out;
}

/** 페이지들을 한 문서 텍스트로. 페이지 사이는 "[p.N]" 표시 — 직원이 몇 쪽인지 말할 수 있게. */
export async function extractPdfText(bytes) {
  const pages = await extractPdfPages(bytes);
  const chunks = [];
  pages.forEach((text, index) => {
    const body = text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    if (body) chunks.push(`[p.${index + 1}]\n${body}`);
  });
  return chunks.join("\n\n");
}
