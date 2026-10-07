// 웹 문서는 본문·댓글·수정 이력을 한 객체로 저장한다. 저장소 세대 번호로 동시 수정을 막는다.
export const DOCUMENT_TYPE = "application/vnd.nk.document+json";
export const DOCUMENT_SUFFIX = ".nkdoc.json";
export const isCompanyDocument = (path: string, type = "") => path.toLowerCase().endsWith(DOCUMENT_SUFFIX) || type.startsWith(DOCUMENT_TYPE);

export class DocumentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface DocumentSnapshot {
  revision: number; title: string; content: string; category: string; status: string;
  pinned: boolean; updatedAt: string; editor: string;
}
export interface CompanyDocument extends DocumentSnapshot {
  kind: "nk-document"; createdAt: string;
  comments: Array<{ id: string; text: string; author: string; createdAt: string }>;
  history: DocumentSnapshot[];
}

function field(value: unknown, label: string, max: number, empty = true) {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new DocumentError(`${label}을 확인해 주세요. 최대 ${max}자입니다.`);
  return value;
}
export function parseCompanyDocument(value: any): CompanyDocument {
  if (value?.kind !== "nk-document" || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.comments) || !Array.isArray(value.history)) throw new DocumentError("업무 문서 형식이 올바르지 않습니다.");
  field(value.title, "제목", 120, false);
  field(value.content, "본문", 100000);
  return value;
}

export function updateCompanyDocument(previous: CompanyDocument | null, input: any, author: string, now = new Date().toISOString()): CompanyDocument {
  const action = input.action;
  if (!["document_save", "document_comment", "document_restore"].includes(action)) throw new DocumentError("지원하지 않는 문서 작업입니다.");
  if (!previous && action !== "document_save") throw new DocumentError("문서를 찾지 못했습니다.", 404);
  const old = previous;
  const result: CompanyDocument = old ? structuredClone(old) : {
    kind: "nk-document", title: "", content: "", category: "업무 메모", status: "작성 중", pinned: false,
    revision: 0, createdAt: now, updatedAt: now, editor: author, comments: [], history: [],
  };
  if (action === "document_save") {
    if (input.title !== undefined || !old) result.title = field(input.title, "제목", 120, false).trim();
    if (input.content !== undefined || !old) result.content = field(input.content ?? "", "본문", 100000);
    if (input.category !== undefined) result.category = field(input.category, "분류", 40, false).trim();
    if (input.status !== undefined) {
      if (!["작성 중", "검토 중", "확정"].includes(input.status)) throw new DocumentError("문서 상태를 확인해 주세요.");
      result.status = input.status;
    }
    if (input.pinned !== undefined) {
      if (typeof input.pinned !== "boolean") throw new DocumentError("고정 여부는 true 또는 false여야 합니다.");
      result.pinned = input.pinned;
    }
  } else if (action === "document_comment") {
    if (result.comments.length >= 200) throw new DocumentError("문서별 댓글은 200개까지 저장할 수 있습니다.");
    result.comments.push({ id: crypto.randomUUID(), text: field(input.text, "댓글", 4000, false).trim(), author, createdAt: now });
  } else {
    const snapshot = result.history.find((item) => item.revision === Number(input.revision));
    if (!snapshot) throw new DocumentError("복원할 수정 이력을 찾지 못했습니다.", 404);
    for (const key of ["title", "content", "category", "status", "pinned"] as const) (result as any)[key] = snapshot[key];
  }
  if (old && action !== "document_comment") {
    const { revision, title, content, category, status, pinned, updatedAt, editor } = old;
    result.history = [...old.history, { revision, title, content, category, status, pinned, updatedAt, editor }].slice(-20);
  }
  result.revision += 1;
  result.updatedAt = now;
  result.editor = author;
  // 큰 한글 문서도 최신 본문은 유지하고 오래된 복원 지점부터 줄인다.
  while (new TextEncoder().encode(JSON.stringify(result)).byteLength > 4 * 1024 * 1024 && result.history.length) result.history.shift();
  return result;
}

export function documentSummary(document: CompanyDocument) {
  return { title: document.title, category: document.category, status: document.status, pinned: document.pinned,
    editor: document.editor, commentCount: document.comments.length, revision: document.revision };
}
