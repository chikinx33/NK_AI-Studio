// prototype/functions/api/agent/_xml-dom.ts
// 아주 작은 XML 트리 — Workers 에서 쓸 수 있는 ElementTree 대용.
//
// 왜 직접 만들었나:
//   ① Workers 에는 DOMParser 가 없다.
//   ② 일반 XML 라이브러리는 파싱 → 재직렬화 과정에서 원본을 바꾼다. 실제로 참조 프로토타입이 쓴
//      Python ElementTree 는 HWPX 를 통과시키면 루트를 <hs:sec> → <ns0:sec> 로 바꾸고
//      xmlns 선언 12개 중 10개를 버렸다. 한글이 그런 파일을 어디까지 받아 주는지 보장할 수 없다.
//   ③ 그래서 이 트리는 "손대지 않은 노드는 원본 바이트 그대로" 를 규칙으로 삼는다.
//      여는 태그의 원문(openRaw)을 들고 있다가 속성을 실제로 고쳤을 때만 다시 만든다.
//
// 네임스페이스 접두어(hp: · hs:)는 이름의 일부로 그대로 보존한다. 접두어를 해석하지 않으므로
// 접두어가 바뀌는 사고 자체가 생기지 않는다.

export interface XmlText {
  type: "text";
  /** 원본 그대로(엔티티 포함). 치환할 때만 바꾼다. */
  raw: string;
}

export interface XmlRaw {
  type: "raw"; // 선언(<?xml?>) · 주석 · CDATA · DOCTYPE — 손대지 않는다
  raw: string;
}

export interface XmlElement {
  type: "element";
  name: string;                 // "hp:tr" 처럼 접두어를 포함한 이름
  openRaw: string;              // 여는 태그 원문
  selfClosing: boolean;
  children: XmlNode[];
  parent: XmlElement | null;
  /** 속성을 고쳤을 때만 채워진다(고치지 않으면 openRaw 를 그대로 쓴다). */
  attrs?: { name: string; value: string; quote: string }[];
}

export type XmlNode = XmlText | XmlRaw | XmlElement;

export interface XmlDocument {
  children: XmlNode[];
}

const NAME_START = /[A-Za-z_]/;

export function escapeXmlText(value: any): string {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: any): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/** 여는 태그 원문에서 속성을 뽑는다(따옴표 종류까지 기억해 되돌릴 때 같은 모양을 쓴다). */
function parseAttributes(openRaw: string): { name: string; value: string; quote: string }[] {
  const attrs: { name: string; value: string; quote: string }[] = [];
  const pattern = /([A-Za-z_:][\w:.\-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const body = openRaw.replace(/^<\s*[^\s/>]+/, "");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body))) {
    attrs.push({
      name: match[1],
      value: match[3] !== undefined ? match[3] : match[4] || "",
      quote: match[2].startsWith('"') ? '"' : "'",
    });
  }
  return attrs;
}

/**
 * XML → 트리. 닫는 태그가 맞지 않으면 던진다(우리가 만든 편집이 구조를 깨뜨렸는지 여기서 걸린다).
 */
export function parseXml(xml: string): XmlDocument {
  const doc: XmlDocument = { children: [] };
  const stack: XmlElement[] = [];
  const push = (node: XmlNode) => {
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else doc.children.push(node);
  };

  let index = 0;
  while (index < xml.length) {
    const next = xml.indexOf("<", index);
    if (next === -1) {
      if (index < xml.length) push({ type: "text", raw: xml.slice(index) });
      break;
    }
    if (next > index) push({ type: "text", raw: xml.slice(index, next) });

    // 손대지 않는 덩어리들
    if (xml.startsWith("<!--", next)) {
      const end = xml.indexOf("-->", next);
      const stop = end === -1 ? xml.length : end + 3;
      push({ type: "raw", raw: xml.slice(next, stop) });
      index = stop;
      continue;
    }
    if (xml.startsWith("<![CDATA[", next)) {
      const end = xml.indexOf("]]>", next);
      const stop = end === -1 ? xml.length : end + 3;
      push({ type: "raw", raw: xml.slice(next, stop) });
      index = stop;
      continue;
    }
    if (xml.startsWith("<?", next) || xml.startsWith("<!", next)) {
      const end = xml.indexOf(">", next);
      const stop = end === -1 ? xml.length : end + 1;
      push({ type: "raw", raw: xml.slice(next, stop) });
      index = stop;
      continue;
    }

    // 닫는 태그
    if (xml.startsWith("</", next)) {
      const end = xml.indexOf(">", next);
      if (end === -1) throw new Error("XML 이 닫히지 않았어요.");
      const name = xml.slice(next + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new Error(`XML 구조가 맞지 않아요: </${name}> 의 짝을 찾지 못했습니다.`);
      }
      index = end + 1;
      continue;
    }

    if (!NAME_START.test(xml[next + 1] || "")) {
      // '<' 가 그냥 글자로 들어간 경우 — 텍스트로 둔다
      push({ type: "text", raw: xml.slice(next, next + 1) });
      index = next + 1;
      continue;
    }

    // 여는 태그 — 속성값 안의 '>' 를 태그 끝으로 오인하지 않게 따옴표를 따라간다
    let cursor = next + 1;
    let quote = "";
    while (cursor < xml.length) {
      const char = xml[cursor];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
      cursor += 1;
    }
    if (cursor >= xml.length) throw new Error("XML 여는 태그가 닫히지 않았어요.");

    const openRaw = xml.slice(next, cursor + 1);
    const selfClosing = /\/\s*>$/.test(openRaw);
    const nameMatch = /^<\s*([^\s/>]+)/.exec(openRaw);
    if (!nameMatch) throw new Error("XML 태그 이름을 읽지 못했어요.");

    const element: XmlElement = {
      type: "element",
      name: nameMatch[1],
      openRaw,
      selfClosing,
      children: [],
      parent: stack[stack.length - 1] || null,
    };
    push(element);
    if (!selfClosing) stack.push(element);
    index = cursor + 1;
  }

  if (stack.length) throw new Error(`XML 구조가 맞지 않아요: <${stack[stack.length - 1].name}> 가 닫히지 않았습니다.`);
  return doc;
}

/** 트리 → XML. 고치지 않은 노드는 원본 바이트 그대로 나간다. */
export function serializeXml(doc: XmlDocument | XmlNode[]): string {
  const nodes = Array.isArray(doc) ? doc : doc.children;
  let out = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "raw") {
      out += node.raw;
      continue;
    }
    out += openTagOf(node);
    out += serializeXml(node.children);
    if (!node.selfClosing) out += `</${node.name}>`;
  }
  return out;
}

function openTagOf(element: XmlElement): string {
  if (!element.attrs) return element.openRaw; // 속성을 안 고쳤으면 원문 그대로
  const attrs = element.attrs
    .map((attr) => ` ${attr.name}=${attr.quote}${attr.quote === '"' ? escapeAttr(attr.value) : escapeXmlText(attr.value)}${attr.quote}`)
    .join("");
  return `<${element.name}${attrs}${element.selfClosing ? "/" : ""}>`;
}

// ── 조회·수정 (ElementTree 에서 쓰던 만큼만) ────────────────────────────────

export function isElement(node: XmlNode): node is XmlElement {
  return node.type === "element";
}

/** 자손 전체에서 이름이 같은 요소 (ElementTree 의 iter). */
export function findAll(root: XmlDocument | XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.name === name) found.push(node);
      walk(node.children);
    }
  };
  walk(Array.isArray((root as XmlDocument).children) ? (root as any).children : []);
  return found;
}

/** 바로 아래 자식만 (표의 행을 고를 때 — 중첩된 표의 행이 섞이지 않는다). */
export function childElements(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((node): node is XmlElement => isElement(node) && node.name === name);
}

/**
 * 자손을 훑되 지정한 이름의 요소 안으로는 들어가지 않는다.
 * (행의 셀 주소를 다시 매길 때 중첩된 표의 셀까지 건드리지 않기 위해)
 */
export function findAllExcluding(element: XmlElement, name: string, stopAt: string): XmlElement[] {
  const found: XmlElement[] = [];
  const walk = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      if (!isElement(node)) continue;
      if (node.name === stopAt) continue;
      if (node.name === name) found.push(node);
      walk(node.children);
    }
  };
  walk(element.children);
  return found;
}

export function getAttribute(element: XmlElement, name: string): string | null {
  const attrs = element.attrs || parseAttributes(element.openRaw);
  const found = attrs.find((attr) => attr.name === name);
  return found ? found.value : null;
}

/** 속성 변경 — 이 순간부터 그 요소의 여는 태그만 다시 만들어진다(나머지는 원본 유지). */
export function setAttribute(element: XmlElement, name: string, value: string): void {
  if (!element.attrs) element.attrs = parseAttributes(element.openRaw);
  const found = element.attrs.find((attr) => attr.name === name);
  if (found) found.value = value;
  else element.attrs.push({ name, value, quote: '"' });
}

/** 요소 안의 글자(태그 제외). 자리표시자를 찾을 때 쓴다. */
export function textContent(element: XmlElement): string {
  let out = "";
  const walk = (nodes: XmlNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") out += node.raw;
      else if (isElement(node)) walk(node.children);
    }
  };
  walk(element.children);
  return out;
}

/** 이 요소의 텍스트 노드들(직계 자식). <hp:t> 처럼 글자를 담는 요소에 쓴다. */
export function textNodes(element: XmlElement): XmlText[] {
  return element.children.filter((node): node is XmlText => node.type === "text");
}

export function removeChild(parent: XmlElement, child: XmlNode): void {
  const index = parent.children.indexOf(child);
  if (index >= 0) parent.children.splice(index, 1);
}

/** 요소의 내용을 글자 하나로 바꾼다(값은 이스케이프한다). */
export function setTextContent(element: XmlElement, value: string): void {
  element.children = [{ type: "text", raw: escapeXmlText(value) }];
  if (element.selfClosing) {
    element.selfClosing = false;
    element.openRaw = element.openRaw.replace(/\s*\/\s*>$/, ">");
    if (element.attrs) element.attrs = element.attrs.slice();
  }
}
