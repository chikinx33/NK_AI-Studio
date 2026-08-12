// 서식 폴더 이름이 바뀌어도 찾아낸다.
//
// 실측(2026-08-13): 사용자가 회사 파일에서 '_서식' → '서식' 으로 이름을 바꾸자
// form_fill 이 "현재 등록: 등록된 서식 없음" 만 반복했다. 루트 이름이 코드에 하나로 박혀 있었다.
// 지식(에이전트 메모)에 적어도 소용없다 — 서버가 GCS 를 뒤지는 경로는 코드가 정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const agentDir = join(repoRoot, "prototype/functions/api/agent");
const registry = await import(pathToFileURL(join(agentDir, "_form-registry.ts")).href);
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

test("★새 이름('서식')이 기본이고 옛 이름('_서식')도 계속 읽는다", () => {
  assert.deepEqual(registry.FORMS_ROOTS, ["서식", "_서식"]);
  assert.equal(registry.FORMS_ROOT, "서식", "안내 문구에 쓰는 기본 이름이 새 이름이어야 한다");
  assert.deepEqual(registry.SUPPLIER_PATHS, ["회사정보/공급자.json", "_회사정보/공급자.json"]);
});

test("manifest 는 자기가 있던 루트를 기억한다 (템플릿을 그 루트에서 읽어야 한다)", () => {
  const raw = JSON.stringify({
    formId: "quote-standard", name: "견적서 (표준)", dataSchema: "quote/v1",
    calculator: "quote-calc-v1", templates: { docx: "template.docx" },
  });
  assert.equal(registry.parseManifest(raw, "견적서-표준", "서식").root, "서식");
  assert.equal(registry.parseManifest(raw, "견적서-표준", "_서식").root, "_서식");
  assert.equal(registry.parseManifest(raw, "견적서-표준").root, "서식", "기본값은 새 이름");
});

test("템플릿 경로가 그 서식이 있던 루트를 따른다", () => {
  const source = read("prototype/functions/api/agent/_form-registry.ts");
  assert.match(source, /const path = `\$\{manifest\.root \|\| FORMS_ROOT\}\/\$\{manifest\.folder\}\/\$\{fileName\}`/);
});

test("목록·검색이 두 루트를 모두 훑는다", () => {
  const source = read("prototype/functions/api/agent/_form-registry.ts");
  const listForms = source.slice(source.indexOf("export async function listForms"), source.indexOf("export function matchForm"));
  assert.match(listForms, /for \(const root of FORMS_ROOTS\)/);
  // 한 루트가 없어도(404) 나머지를 계속 본다
  assert.match(listForms, /listSubfolders\(storage, root\)\.catch\(\(\) => \[\] as string\[\]\)/);
  // 같은 formId 가 양쪽에 있으면 앞 후보를 쓴다
  assert.match(listForms, /forms\.some\(\(existing\) => existing\.formId === manifest\.formId\)/);

  const findForm = source.slice(source.indexOf("export async function findForm"));
  assert.match(findForm, /for \(const root of FORMS_ROOTS\)/);
});

test("★못 찾으면 어디를 봤는지 알려준다", () => {
  const source = read("prototype/functions/api/agent/_form-registry.ts");
  assert.match(source, /폴더를 봤어요/);
  assert.match(source, /FORMS_ROOTS\.map\(\(root\) => `'\$\{root\}\/'`\)/);
});

test("공급자 정보도 폴더 이름 변경을 따라간다", () => {
  const shared = read("prototype/functions/api/agent/_shared.ts");
  const loader = shared.slice(shared.indexOf("async function loadFormSupplier"), shared.indexOf("/** Asia/Seoul 기준"));
  assert.match(loader, /for \(const path of SUPPLIER_PATHS\)/);
});
