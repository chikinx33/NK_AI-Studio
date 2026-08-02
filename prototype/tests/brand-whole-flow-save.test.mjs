import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * 저장 버튼은 단계 하나가 아니라 "작업 흐름 전체"를 저장한다.
 *
 * 예전에는 활성 초안 탭 하나의 필드만 담아 brandStudioFormatDrafts 로 보냈다.
 * 포맷을 고르고 저장을 눌러도 그 선택은 이 저장에 실리지 않았고, 다른 코드가
 * 덮어쓰면 그대로 사라졌다. 실제로 TikTok 을 고르고 저장한 뒤 새로고침하면
 * 해제돼 있었다.
 */

const src = fs.readFileSync(path.join(process.cwd(), "prototype/js/ui/brand-studio.js"), "utf8");

/** 함수 본문을 중괄호 균형으로 잘라 온다. */
function functionBody(name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} 을(를) 찾지 못했다`);
  let depth = 0;
  let i = src.indexOf("{", at);
  const from = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(from, i + 1);
}

test("저장 패치가 네 단계 상태를 모두 담는다", () => {
  const body = functionBody("buildWholeFlowPatch");
  const REQUIRED = {
    "brandStudioSelectedAssetIds": "01 자산 선택",
    "brandStudioSelectedFormats": "02 포맷 선택",
    "brandStudioFormatDrafts": "03 초안",
    "brandStudioDeployedFormats": "04 배포 상태",
    "brandStudioActiveDraftTab": "활성 초안 탭",
  };
  const missing = Object.entries(REQUIRED)
    .filter(([key]) => !body.includes(key))
    .map(([key, label]) => `${label}(${key})`);
  assert.deepEqual(missing, [], `저장에서 빠진 상태: ${missing.join(", ")}`);
});

test("저장은 활성 탭 하나가 아니라 모든 포맷의 입력을 읽는다", () => {
  const body = functionBody("buildWholeFlowPatch");
  assert.match(
    body,
    /querySelectorAll\('\[data-draft-field\]\[data-draft-format\]'\)/,
    "화면 전체의 초안·배포 입력을 훑지 않는다"
  );
  assert.ok(
    !/bsf-format-draft-panel\[data-draft-format="' \+ currentFmtId/.test(body),
    "여전히 활성 패널 하나만 읽는다"
  );
});

test("저장 버튼 핸들러가 전체 흐름 패치를 쓴다", () => {
  const at = src.indexOf("if (action === 'brand-save-format-draft')");
  assert.ok(at > 0, "저장 핸들러를 찾지 못했다");
  const body = src.slice(at, at + 900);
  assert.match(body, /buildWholeFlowPatch\(\)/, "저장 핸들러가 전체 흐름 패치를 쓰지 않는다");
  // 단계별로 쪼개 저장하면 이 커밋의 취지가 무너진다
  assert.ok(
    !/updatePayload\(projectId, \{ brandStudioFormatDrafts:/.test(body),
    "저장 핸들러가 여전히 초안만 따로 저장한다"
  );
});

test("저장된 포맷 선택을 자동 선택이 덮어쓰지 않는다", () => {
  // 페이지를 열 때마다 포맷 단계 진입에서 selectedFormats 가 recommended 집합으로
  // 통째로 교체되고 저장까지 됐다. 저장 버튼을 눌러도 새로고침하면 풀려 있던 원인.
  assert.match(src, /var _hasUserFormatChoice = selectedFormats\.length > 0;/, "저장된 선택 여부를 기억하지 않는다");
  assert.match(src, /newStep === 2 && !_hasUserFormatChoice/, "자동 선택이 저장된 선택을 무시하지 않는다");

  const at = src.indexOf("if (action === 'brand-toggle-format')");
  assert.ok(at > 0);
  const toggle = src.slice(at, at + 1200);
  assert.match(toggle, /_hasUserFormatChoice = true/, "직접 고른 뒤에도 자동 선택이 끼어들 수 있다");
});

test("자산 URL 도착 전에는 선택 포맷을 지우지 않는다", () => {
  // 하이드레이션 전에는 hasVideo/hasImage 가 false 라 멀쩡한 선택이 지워지고 저장된다.
  const body = functionBody("refreshFormatCardStates");
  assert.match(
    body,
    /if \(!hasUnhydratedSelectedMedia\(\)\) pruneUnavailableSelectedFormats\(\)/,
    "하이드레이션 가드 없이 prune 을 호출한다"
  );
  // 초기 렌더 경로의 가드도 그대로 있어야 한다
  assert.match(src, /if \(!hasUnhydratedSelectedMedia\(\)\) pruneUnavailableSelectedFormats\(\);/);
});

test("입력 타입별로 값을 읽는 경로가 하나로 모여 있다", () => {
  const body = functionBody("readFieldValue");
  for (const kind of ["contenteditable", "checkbox", "radio"]) {
    assert.ok(body.includes(kind), `${kind} 처리가 없다`);
  }
  // 선택되지 않은 라디오는 값을 덮어쓰면 안 된다
  assert.match(body, /el\.checked \? String\(el\.value \|\| ''\)\.trim\(\) : undefined/);
});
