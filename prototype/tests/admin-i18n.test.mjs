import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("central translations dictionary defines admin/share keys in both ko and en", () => {
  const src = read("prototype/core.js");
  const keys = [
    "admin_no_access", "admin_title", "admin_save_apply", "admin_m_set_master_pw",
    "admin_perm_videogen", "admin_deletion_pending", "admin_delete_at", "admin_restore",
    "admin_confirm_restore", "admin_restore_done", "share_project", "share_received", "share_revoke",
  ];
  // 각 키는 ko/en 양쪽에 존재해야 한다(2회 이상 등장).
  for (const k of keys) {
    const count = (src.match(new RegExp("\\b" + k + ":", "g")) || []).length;
    assert.ok(count >= 2, `key ${k} should appear in both ko and en (found ${count})`);
  }
});

test("admin-users.js uses the central dictionary (t reads NK.core.translations) and no hardcoded gate string", () => {
  const src = read("prototype/js/ui/admin-users.js");
  assert.match(src, /NK\.core\.translations\[curLang\(\)\]/);
  assert.match(src, /t\('admin_no_access'\)/);
  // 하드코딩된 한국어 게이트 문구가 더 이상 직접 들어있지 않다
  assert.doesNotMatch(src, /마스터\(최고 관리자\)만 접근할 수 있는 페이지입니다\./);
});

test("dashboard share UI uses the central dictionary (dt reads NK.core.translations)", () => {
  const src = read("prototype/js/ui/dashboard.js");
  assert.match(src, /function dt\(key\)/);
  assert.match(src, /NK\.core\.translations\[dlang\(\)\]/);
  assert.match(src, /dt\('share_project'\)/);
});
