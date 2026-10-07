import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../ai-company-app/package.json", import.meta.url));
const ts = require("typescript"), { JSDOM } = require("jsdom");
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const compiled = { exports: {} };
new Function("module", "exports", ts.transpileModule(read("ai-company-app/src/lib/companyTheme.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(compiled, compiled.exports);
const { installCompanyTheme, readCompanyTheme } = compiled.exports;
const page = () => new JSDOM('<!doctype html><meta name="theme-color"><input value="저장하지 않은 내용">', { url: "https://nkstudio.org/ai-company/" });

test("기업 테마는 랜딩 페이지의 공유 설정과 세부 테마를 읽고 저장소를 덮어쓰지 않는다", () => {
  const { window } = page();
  window.localStorage.setItem("nk_theme", "light");
  window.localStorage.setItem("nk_theme_variant", "light-mint");
  const cleanup = installCompanyTheme(window);
  assert.equal(window.document.documentElement.dataset.theme, "light");
  assert.equal(window.document.documentElement.dataset.themeVariant, "light-mint");
  assert.equal(window.localStorage.length, 2);
  assert.equal(window.document.querySelector('meta').content, "#f7f9fd");
  cleanup(); window.close();
});

test("다른 탭의 테마 변경·설정 삭제는 즉시 반영하고 입력 화면은 유지한다", () => {
  const { window } = page();
  const input = window.document.querySelector('input');
  const cleanup = installCompanyTheme(window);
  window.localStorage.setItem("nk_theme", "light");
  window.dispatchEvent(new window.StorageEvent("storage", { key: "nk_theme" }));
  assert.equal(window.document.documentElement.dataset.theme, "light");
  assert.equal(window.document.querySelector('input'), input);
  assert.equal(input.value, "저장하지 않은 내용");
  window.localStorage.clear();
  window.dispatchEvent(new window.StorageEvent("storage", { key: null }));
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  cleanup(); window.close();
});

test("페이지 재방문은 최신 설정을 읽고 구독 해제 후에는 반응하지 않는다", () => {
  const { window } = page();
  const cleanup = installCompanyTheme(window);
  window.localStorage.setItem("nk_theme", "light");
  window.dispatchEvent(new window.Event("pageshow"));
  assert.equal(window.document.documentElement.style.colorScheme, "light");
  window.localStorage.setItem("nk_theme", "dark");
  window.dispatchEvent(new window.Event("focus"));
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  cleanup();
  window.localStorage.setItem("nk_theme", "light");
  window.dispatchEvent(new window.Event("focus"));
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  window.close();
});

test("저장소 차단·잘못된 값은 랜딩과 같은 다크 기본값으로 처리한다", () => {
  assert.deepEqual(readCompanyTheme({ getItem() { throw new Error("denied"); } }), { theme: "dark", variant: "dark-classic" });
  assert.deepEqual(readCompanyTheme({ getItem(key) { return key === "nk_theme" ? "light" : "dark-forest"; } }), { theme: "light", variant: "light-classic" });
  const { window } = page();
  Object.defineProperty(window, "localStorage", { get() { throw new Error("denied"); } });
  const cleanup = installCompanyTheme(window);
  assert.equal(window.document.documentElement.dataset.theme, "dark");
  cleanup(); window.close();
});

test("임베드 테마 메시지는 같은 출처의 부모 창에서 온 경우만 적용한다", () => {
  const { window } = page();
  const child = page().window;
  Object.defineProperty(child, 'parent', { value: window });
  const cleanup = installCompanyTheme(child);
  const send = (source, origin, theme) => child.dispatchEvent(new window.MessageEvent('message', { source, origin, data: { type:'theme-apply', theme, variant:'light-sky' } }));
  send(window, 'https://evil.example', 'light');
  assert.equal(child.document.documentElement.dataset.theme, 'dark');
  send(child, window.location.origin, 'light');
  assert.equal(child.document.documentElement.dataset.theme, 'dark');
  send(window, window.location.origin, 'light');
  assert.equal(child.document.documentElement.dataset.themeVariant, 'light-sky');
  cleanup(); child.close(); window.close();
});

test("로딩 화면도 앱 시작 전에 공유 테마를 적용한다", () => {
  const html = read("ai-company-app/index.html");
  const { window } = page();
  window.localStorage.setItem('nk_theme', 'light');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new Function('document', 'localStorage', script)(window.document, window.localStorage);
  assert.equal(window.document.documentElement.dataset.theme, 'light');
  assert.ok(html.indexOf(script) < html.indexOf('id="root"'));
  window.close();
});

test("기업의 기본·세부 테마 주요 색상은 스튜디오 팔레트와 일치한다", () => {
  const studio = read('prototype/styles.css'), company = read('ai-company-app/src/companyTheme.css');
  const mapping = { bg:'bg', panel:'panel', border:'edge', text:'text', muted:'muted' };
  let count = 0;
  for (const [,selector,body] of studio.matchAll(/(\[data-theme="(?:dark|light)"\](?:\[data-theme-variant="[^"]+"\])?)\s*\{([^}]+)\}/g)) {
    if (!body.includes('--bg:')) continue;
    const block = company.slice(company.indexOf(':root' + selector)).match(/\{([^}]+)\}/)[1];
    for (const [name,token] of Object.entries(mapping)) {
      const hex = body.match(new RegExp(`--${name}: (#\\w{6});`))?.[1];
      if (!hex) continue;
      const rgb = hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(' ');
      assert.ok(block.includes(`--company-${token}: ${rgb};`), selector + ' ' + name);
    }
    count++;
  }
  assert.equal(count, 10);
});
