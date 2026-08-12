// prototype/functions/api/agent/_form-registry.ts
// 서식 레지스트리 — 설계서 docs/form_document_engine_design_v2_20260812.md §2 의 구현체.
//
// 회사 파일(GCS)의 `_서식/` 폴더가 서식 저장소다. 사람이 파일 탐색기에서 폴더를 만들고
// manifest.json + 템플릿을 올리면 그 순간부터 에이전트가 쓴다. ★코드 수정도 배포도 없다.
// 이 파일에 서식 이름을 하드코딩하는 순간 그 자산화 구조가 무너진다 — 넣지 말 것.
//
// GCS 저수지 접근(토큰·목록·바이트 읽기)도 여기에 둔다. company-files.ts 의 헬퍼는
// 그 파일 안에 갇혀 있어(모듈 비공개) 재사용할 수 없어서 같은 패턴으로 최소한만 옮겼다.
import { getGoogleAccessToken, resolveGcsEnv } from "../_shared/gcs.js";

const GCS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** `_서식/` — 서식 저장소 루트(회사 파일 기준 상대 경로). */
export const FORMS_ROOT = "_서식";
/** 공급자(우리 회사) 정보 파일(§7.2 2단계). */
export const SUPPLIER_PATH = "_회사정보/공급자.json";
/** 생성 문서가 저장되는 곳. 업무 탐색기의 날짜 폴더와 같은 이름 규칙. */
export const OUTPUT_ROOT = "업무";

export interface CompanyStorage {
  bucket: string;
  token: string;
  userProject: string;
  rootPrefix: string; // 이 사용자의 회사 파일 루트 (…/company-files/)
}

/**
 * 반복 영역 하나. HWPX 는 템플릿에 행을 미리 만들어 두고 남는 행을 지우는 방식이라
 * (§6.2.1 — 행 복제는 실패 위험이 커서 하지 않는다) 접두어마다 몇 행까지 있는지가 계약이다.
 * 예: { "row": { source: "totals.rows", maxRows: 30 } } → {{row.name}} 이 든 행이 30개.
 */
export interface FormRepeater {
  source: string;
  maxRows: number;
}

export interface FormManifest {
  formId: string;
  name: string;
  category: string;
  version: number;
  dataSchema: string;
  calculator: string;
  templates: Record<string, string | null>;
  repeaters: Record<string, FormRepeater>;
  pdfFrom: string;
  outputName: string;
  maxItemRows: number;
  description: string;
  /** 이 서식이 들어 있는 `_서식/` 하위 폴더 이름 (formId 와 다를 수 있다). */
  folder: string;
}

// ── GCS 접근 (company-files.ts 와 같은 패턴) ─────────────────────────────────

export async function companyStorage(env: any, userId: string): Promise<CompanyStorage> {
  // storage.ts 는 확장자 없는 경로라 번들러만 해석할 수 있다. 호출 시점에 불러오면
  // manifest 파싱 같은 순수 함수를 테스트에서 그냥 import 할 수 있다(번들 결과는 동일).
  const { buildAiVideoProjectPrefix } = await import("../_shared/storage");
  const ctx = resolveGcsEnv(env);
  const token = await getGoogleAccessToken({
    clientEmail: ctx.clientEmail,
    privateKeyPem: ctx.privateKeyRaw,
    scope: GCS_SCOPE,
  });
  return {
    bucket: ctx.bucket,
    token,
    userProject: ctx.userProject,
    rootPrefix: `${buildAiVideoProjectPrefix(ctx.basePrefix, userId, "ai-company")}/company-files/`,
  };
}

function billingHeaders(storage: CompanyStorage, useBilling: boolean) {
  return {
    Authorization: `Bearer ${storage.token}`,
    ...(useBilling && storage.userProject ? { "X-Goog-User-Project": storage.userProject } : {}),
  };
}

/** requester-pays 버킷이 아닌 경우 userProject 가 400/403 을 만든다 — 그때는 빼고 재시도. */
async function gcsFetch(storage: CompanyStorage, makeRequest: (useBilling: boolean) => Promise<Response>) {
  let response = await makeRequest(true);
  if (!response.ok && storage.userProject && (response.status === 400 || response.status === 403)) {
    response = await makeRequest(false);
  }
  return response;
}

/** prefix 아래의 하위 '폴더' 목록(상대 경로). delimiter 로 한 단계만 본다. */
export async function listSubfolders(storage: CompanyStorage, relativePrefix: string): Promise<string[]> {
  const prefix = `${storage.rootPrefix}${relativePrefix ? `${relativePrefix}/` : ""}`;
  const folders = new Set<string>();
  let pageToken = "";
  do {
    const response = await gcsFetch(storage, (useBilling) => {
      const params = new URLSearchParams({ prefix, delimiter: "/", maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      if (useBilling && storage.userProject) params.set("userProject", storage.userProject);
      return fetch(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(storage.bucket)}/o?${params}`, {
        headers: billingHeaders(storage, useBilling),
      });
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `GCS 목록 조회 실패 (HTTP ${response.status})`);
    for (const value of Array.isArray(payload.prefixes) ? payload.prefixes : []) {
      const name = String(value).slice(prefix.length).replace(/\/$/, "");
      if (name) folders.add(name);
    }
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return [...folders].sort((a, b) => a.localeCompare(b, "ko"));
}

/** 회사 파일 하나를 바이트로 읽는다. 없으면 null (호출부가 상황에 맞는 에러를 낸다). */
export async function readCompanyBytes(storage: CompanyStorage, relativePath: string): Promise<Uint8Array | null> {
  const objectName = `${storage.rootPrefix}${relativePath}`;
  const response = await gcsFetch(storage, (useBilling) => {
    const params = new URLSearchParams({ alt: "media" });
    if (useBilling && storage.userProject) params.set("userProject", storage.userProject);
    return fetch(
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(storage.bucket)}/o/${encodeURIComponent(objectName)}?${params}`,
      { headers: billingHeaders(storage, useBilling) }
    );
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`회사 파일을 읽지 못했어요: ${relativePath} (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function readCompanyText(storage: CompanyStorage, relativePath: string): Promise<string | null> {
  const bytes = await readCompanyBytes(storage, relativePath);
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** 바이너리 업로드. 생성한 문서를 회사 파일에 그대로 저장한다(텍스트 전용 도구로는 못 한다). */
export async function writeCompanyBytes(
  storage: CompanyStorage,
  relativePath: string,
  bytes: Uint8Array,
  contentType: string
): Promise<{ path: string; size: number; contentType: string }> {
  const objectName = `${storage.rootPrefix}${relativePath}`;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const response = await gcsFetch(storage, (useBilling) => {
    const params = new URLSearchParams({ uploadType: "media", name: objectName });
    if (useBilling && storage.userProject) params.set("userProject", storage.userProject);
    return fetch(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(storage.bucket)}/o?${params}`, {
      method: "POST",
      headers: { ...billingHeaders(storage, useBilling), "Content-Type": contentType || "application/octet-stream" },
      body,
    });
  });
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `회사 파일 저장 실패 (HTTP ${response.status})`);
  return { path: relativePath, size: bytes.byteLength, contentType };
}

// ── manifest ────────────────────────────────────────────────────────────────

const REQUIRED_KEYS = ["formId", "name", "dataSchema", "calculator", "templates"] as const;

/** manifest.json 파싱 — 필수 키가 없으면 서식을 만든 사람이 바로 고칠 수 있게 말해 준다(§2.2). */
export function parseManifest(raw: string, folder: string): FormManifest {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    throw new Error(`_서식/${folder}/manifest.json 이 올바른 JSON 이 아니에요: ${String(error?.message || error)}`);
  }
  const missingKeys = REQUIRED_KEYS.filter((key) => parsed?.[key] === undefined || parsed?.[key] === null || parsed?.[key] === "");
  if (missingKeys.length) {
    throw new Error(`_서식/${folder}/manifest.json 에 필수 항목이 없어요: ${missingKeys.join(", ")}`);
  }
  if (typeof parsed.templates !== "object" || Array.isArray(parsed.templates)) {
    throw new Error(`_서식/${folder}/manifest.json 의 templates 는 {"docx": "template.docx"} 형태의 객체여야 해요.`);
  }
  const templates: Record<string, string | null> = {};
  for (const [format, file] of Object.entries(parsed.templates)) {
    templates[String(format).toLowerCase()] = file === null || file === undefined || file === "" ? null : String(file);
  }
  const repeaters: Record<string, FormRepeater> = {};
  for (const [prefix, config] of Object.entries(parsed.repeaters || {})) {
    const source = String((config as any)?.source || "").trim();
    if (!source) throw new Error(`_서식/${folder}/manifest.json 의 repeaters.${prefix} 에 source 가 없어요.`);
    repeaters[String(prefix)] = { source, maxRows: Math.max(1, Number((config as any)?.maxRows || 20) || 20) };
  }
  const name = String(parsed.name);
  // 항목 표의 행 수 상한. repeaters 를 쓰면 그 값이, 아니면 maxItemRows 가 기준이다.
  const itemRowSource = Object.values(repeaters).find((repeater) => /rows$/i.test(repeater.source) && !/summary|info|term/i.test(repeater.source));
  return {
    formId: String(parsed.formId),
    name,
    category: String(parsed.category || ""),
    version: Number(parsed.version || 1) || 1,
    dataSchema: String(parsed.dataSchema),
    calculator: String(parsed.calculator),
    templates,
    repeaters,
    pdfFrom: String(parsed.pdfFrom || "docx").toLowerCase(),
    outputName: String(parsed.outputName || `${name}_{issuedAt}`),
    maxItemRows: Math.max(1, Number(parsed.maxItemRows || itemRowSource?.maxRows || 20) || 20),
    description: String(parsed.description || ""),
    folder,
  };
}

/**
 * `_서식/` 전체 스캔. manifest 가 깨진 폴더는 목록에서 빼고 이유를 함께 돌려준다 —
 * 하나가 잘못됐다고 나머지 서식까지 못 쓰게 만들지 않는다.
 */
export async function listForms(storage: CompanyStorage): Promise<{ forms: FormManifest[]; problems: { folder: string; error: string }[] }> {
  const folders = await listSubfolders(storage, FORMS_ROOT);
  const forms: FormManifest[] = [];
  const problems: { folder: string; error: string }[] = [];
  for (const folder of folders) {
    try {
      const raw = await readCompanyText(storage, `${FORMS_ROOT}/${folder}/manifest.json`);
      if (raw === null) {
        problems.push({ folder, error: "manifest.json 이 없어요." });
        continue;
      }
      forms.push(parseManifest(raw, folder));
    } catch (error: any) {
      problems.push({ folder, error: String(error?.message || error) });
    }
  }
  return { forms, problems };
}

/**
 * formId 로 서식 찾기. 폴더 이름(견적서-표준)과 formId(quote-standard)가 다를 수 있어
 * 폴더 이름으로도 찾아 준다 — 사용자가 둘 중 무엇을 말할지 모른다.
 */
export async function findForm(storage: CompanyStorage, formId: string): Promise<FormManifest> {
  const wanted = String(formId || "").trim();
  if (!wanted) throw new Error("어떤 서식인지(formId) 알려주세요. form_list 로 목록을 먼저 확인하세요.");

  // 폴더 이름이 그대로 오면 목록 스캔 없이 바로 읽는다(빠른 경로).
  const direct = await readCompanyText(storage, `${FORMS_ROOT}/${wanted}/manifest.json`).catch(() => null);
  if (direct !== null) return parseManifest(direct, wanted);

  const { forms } = await listForms(storage);
  const found = forms.find((form) => form.formId === wanted)
    || forms.find((form) => form.formId.toLowerCase() === wanted.toLowerCase() || form.name === wanted);
  if (!found) {
    const known = forms.map((form) => `${form.formId}(${form.name})`).join(", ") || "등록된 서식 없음";
    throw new Error(`'${wanted}' 서식을 찾지 못했어요. form_list 로 목록을 확인하세요. 현재 등록: ${known}`);
  }
  return found;
}

/** 템플릿 파일 bytes. 포맷에 템플릿이 없으면 null(XLSX 처럼 기본 생성이 가능한 포맷용). */
export async function loadTemplate(
  storage: CompanyStorage,
  manifest: FormManifest,
  format: string
): Promise<Uint8Array | null> {
  const fileName = manifest.templates[String(format).toLowerCase()];
  if (!fileName) return null;
  const path = `${FORMS_ROOT}/${manifest.folder}/${fileName}`;
  const bytes = await readCompanyBytes(storage, path);
  if (!bytes) {
    throw new Error(`서식 템플릿 파일이 없어요: ${path} — 회사 파일의 그 폴더에 올려 주세요.`);
  }
  return bytes;
}

/** outputName 의 {client.company} · {issuedAt} 같은 자리를 데이터로 채운다. */
export function renderOutputName(pattern: string, data: any): string {
  const resolved = String(pattern || "문서").replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, path: string) => {
    const value = String(path).split(".").reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), data);
    return value === null || value === undefined ? "" : String(value);
  });
  // 파일 이름에 쓸 수 없는 문자만 지운다(하이픈·공백은 이름의 일부라 남긴다).
  const FORBIDDEN = String.raw`\/:*?"<>|`;
  const cleaned = resolved
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32 && !FORBIDDEN.includes(ch))
    .join("");
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 100) || "문서";
}
