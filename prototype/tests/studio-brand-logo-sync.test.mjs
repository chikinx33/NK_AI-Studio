import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// 로그인 카드 로고·제목은 계정별로 서버에 저장되고, AI 기업 사이드바가 같은 값을 쓴다.
test("studio brand endpoint stores title/logo per account under userdata", () => {
  const src = read("prototype/functions/api/userdata/brand.ts");
  assert.match(src, /export const onRequestGet/);
  assert.match(src, /export const onRequestPost/);
  assert.match(src, /buildUserDataObject\(basePrefix, sanitizeUserId\(userId\), BRAND_FILE\)/);
  assert.match(src, /readBrand\(env, auth\.userId\)/);
  // data:image 만 허용
  assert.match(src, /\^data:image\\\/\(png\|jpeg\|webp\|gif\);base64,/);
});

test("launcher login card saves logo/title to the server and syncs on login", () => {
  const api = read("prototype/api.js");
  assert.match(api, /api\.userdataBrandGet = async function/);
  assert.match(api, /api\.userdataBrandSave = async function/);
  const script = read("prototype/script.js");
  assert.match(script, /await saveLoginBrandServer\(user, \{ iconDataUrl \}\)/);
  assert.match(script, /saveLoginBrandServer\(user, \{ title:/);
  assert.match(script, /syncLoginBrandFromServer\(user\);/);
});

test("AI company sidebar shows the account logo and can register it", () => {
  const sidebar = read("ai-company-app/src/components/Sidebar.tsx");
  assert.match(sidebar, /getStudioBrand\(\)/);
  assert.match(sidebar, /saveStudioBrandIcon\(dataUrl\)/);
  assert.match(sidebar, /src=\{brandIcon \|\| `\$\{import\.meta\.env\.BASE_URL\}logo\.png`\}/);
  assert.match(sidebar, /en \? "Register logo image" : "로고 이미지 등록"/);
});
