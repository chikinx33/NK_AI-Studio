import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const analyze = () => read("prototype/functions/api/ip/analyze.ts");
const hub = () => read("prototype/js/ui/knowledge-hub.js");

test("시트 분석 엔드포인트는 두 속성만 스키마로 강제한다", () => {
  const src = analyze();
  assert.match(src, /export const onRequestPost/);
  assert.match(src, /generationConfig\.responseMimeType = "application\/json"/);
  // 5칸 → 2칸. 같은 내용을 나눠 적게 만드는 칸(fixedTraits·bannedTraits·styleGuide)은 없앴다.
  assert.match(src, /required: \["description", "negativePrompt"\]/);
  assert.doesNotMatch(src, /fixedTraits: \{ type/);
  assert.doesNotMatch(src, /styleGuide: \{ type/);
  // 시트는 최대 4장까지 함께 본다(같은 캐릭터의 다른 각도를 통합)
  assert.match(src, /const MAX_IMAGES = 4/);
  assert.match(src, /analyzedImages: usable/);
});

test("분석 지시문이 추측 금지와 긍정 서술을 요구한다", () => {
  const src = analyze();
  // 한 각도에서 안 보이는 것을 '없는 것'으로 적으면 오히려 품질이 나빠진다
  assert.match(src, /한 각도에서 단순히 안 보이는 것은 넣지 마세요/);
  assert.match(src, /Never guess from one angle where something is merely hidden/);
  // 이미지 모델은 부정문을 약하게 처리하므로 생김새는 긍정문으로만 쓰게 한다.
  assert.match(src, /형태는 반드시 긍정문으로/);
  assert.match(src, /Write shapes POSITIVELY/);
  // 부정 표현이 갈 곳은 negativePrompt 한 칸뿐이라고 못박는다.
  assert.match(src, /부정 표현은 오직 이 칸에만 씁니다/);
  assert.match(src, /This is the ONLY place negations belong/);
  // 두 칸 모두 요청 언어로 — 화면 언어와 저장 내용이 어긋나면 사용자가 읽고 고칠 수 없다.
  assert.match(src, /두 필드 모두 한국어로 작성하세요/);
  assert.doesNotMatch(src, /negativePrompt 는 영어로 작성/);
  // 그림체도 생김새 칸에 함께 적는다(캐릭터별 화풍 칸을 따로 두지 않는다).
  assert.match(src, /그림체도 여기에 함께 적으세요/);
  // 브랜드 맥락(세계관·규칙·다른 캐릭터)을 함께 넣는다
  assert.match(src, /push\("World setting", brandContext\?\.worldSetting\)/);
  assert.match(src, /push\("Other registered characters", brandContext\?\.otherCharacters\)/);
});

test("신체 부위는 부위 이름으로 부르게 못박는다", () => {
  const src = analyze();
  // 실제로 겪은 일: 손가락 없는 팔을 "타원형 돌기" 로 바꿔 적었다. 이미지 모델은 이름으로
  // 부위의 위치·역할을 정하므로, 이렇게 쓰면 몸에 혹이 붙고 팔이 사라져 포즈를 못 잡는다.
  assert.match(src, /신체 부위는 반드시 부위 이름으로 부르세요/);
  assert.match(src, /팔은 손가락이 없어도 팔이고/);
  assert.match(src, /ALWAYS name body parts by what they are/);
  assert.match(src, /An arm without fingers is still an arm/);
  // 이름을 바꾸지 말고 '형태' 로 표현하라는 대안까지 줘야 실제로 지켜진다.
  assert.match(src, /손가락 구분 없는 뭉툭한 타원형 팔/);
  assert.match(src, /rounded mitten-like arm with no separated fingers/);
});

test("초안을 고치면 근거를 밝히게 한다", () => {
  const src = read("prototype/functions/api/agent/_orchestrator.ts");
  const line = src.split(String.fromCharCode(10)).find((l) => l.includes("ip_describe: `[[RUN:"));
  assert.ok(line, "ip_describe 설명을 못 찾음");
  // "스타일 가이드 기준으론…" 처럼 출처를 뭉뚱그리면 사용자가 확인할 수 없다.
  assert.match(line, /허브 규칙을 따랐다면 그 규칙을 그대로 인용하고/);
  assert.match(line, /제 판단입니다/);
  assert.match(line, /신체 부위의 이름을 바꾸지 말 것/);
});

test("IP 라이브러리에 AI 자동 채우기 버튼이 있다", () => {
  const src = hub();
  assert.match(src, /data-action="character-props-ai"/);
  // Lucide wand-sparkles
  assert.match(src, /m21\.64 3\.64-1\.28-1\.28a1\.21 1\.21 0 0 0-1\.72 0L2\.36 18\.64/);
  // summary 안의 버튼이라 기본 토글을 막아야 한다
  assert.match(src, /if \(action === 'character-props-ai'\)[\s\S]{0,200}evt\.preventDefault\(\)/);
  assert.match(src, /if \(aiFillBusyToken\) return/);
});

test("분석 결과는 초안만 채우고 저장하지 않는다", () => {
  const src = hub();
  // syncBrandCharField = 모달 드래프트 갱신. 저장은 '저장' 버튼에서만 일어난다.
  // 서버가 옛 5칸으로 답해도 normalizeTextProps 로 2칸에 합쳐 받는다.
  assert.match(src, /normalizeTextProps\(res \|\| \{\}\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'description', merged\.description\)/);
  assert.match(src, /syncBrandCharField\(aiToken, 'negativePrompt', merged\.negativePrompt\)/);
  const handler = src.slice(src.indexOf("if (action === 'character-props-ai')"), src.indexOf("if (action === 'character-sheet-set-primary')"));
  assert.doesNotMatch(handler, /syncBrandAndProject|persistShared/);
});

test("시트가 없으면 분석을 시도하지 않는다", () => {
  const src = hub();
  assert.match(src, /if \(!aiSheets\.length\) \{ alert\(ipLibraryUiText\.aiFillNoSheet\); return; \}/);
  assert.match(analyze(), /등록된 시트 이미지가 필요해요/);
});

test("자동 채우기 문구는 한국어·영어 양쪽에 있다", () => {
  const src = hub();
  for (const key of [
    "propsTitle", "aiFill", "aiFillTitle", "aiFilling", "aiFillNoSheet", "aiFillDone", "aiFillFail",
    // 5칸 → 2칸 개편으로 새로 생긴 라벨·플레이스홀더
    "appearanceLabel", "appearancePlaceholder",
    "negativeLabel", "negativePlaceholder",
  ]) {
    const hits = src.match(new RegExp(`${key}:`, "g")) || [];
    assert.ok(hits.length >= 2, `${key} 문구가 ko/en 양쪽에 있어야 합니다 (현재 ${hits.length}곳)`);
  }
});

test("IP 라이브러리 사전은 ko/en 키가 정확히 짝을 이룬다", () => {
  const src = hub();
  const start = src.indexOf("function getIpLibraryUiText");
  assert.ok(start > 0, "사전 함수를 못 찾음");
  const body = src.slice(start, src.indexOf("\n  function ", start + 10));
  const split = body.indexOf("      : {");
  assert.ok(split > 0, "ko/en 분기를 못 찾음");
  const keysOf = (text) => new Set([...text.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]));
  const en = keysOf(body.slice(0, split));
  const ko = keysOf(body.slice(split));
  const onlyEn = [...en].filter((k) => !ko.has(k));
  const onlyKo = [...ko].filter((k) => !en.has(k));
  assert.deepEqual(onlyEn, [], `영어에만 있는 키: ${onlyEn.join(", ")}`);
  assert.deepEqual(onlyKo, [], `한국어에만 있는 키: ${onlyKo.join(", ")}`);
  assert.ok(en.size >= 30, `사전 키가 너무 적음(${en.size})`);
});

test("텍스트 속성 입력 폼에 한국어를 직접 박아 넣지 않는다", () => {
  const src = hub();
  // 검사 대상은 텍스트 속성 폼 마크업 — 라벨·힌트·placeholder 가 모두 사전을 거쳐야 한다.
  const start = src.indexOf(`'<div class="character-props-form">'`);
  const end = src.indexOf(`'</details>'`, start);
  assert.ok(start > 0 && end > start, "텍스트 속성 폼 영역을 못 찾음");
  const body = src.slice(start, end);
  const hardcoded = body
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line)) // 주석 줄은 대상 아님
    .flatMap((line) => [...line.matchAll(/'[^'\n]*[가-힣][^'\n]*'/g)].map((m) => m[0]));
  assert.deepEqual(hardcoded, [], `사전을 거치지 않은 한글: ${hardcoded.join(" / ")}`);
});

test("두 칸은 한 줄에 6:4 로 놓이고, 라벨 밑 설명 구문은 없다", () => {
  const src = hub();
  // 설명 구문(character-props-hint)은 세로 길이만 잡아먹어 걷어냈다.
  assert.doesNotMatch(src, /character-props-hint/);
  assert.match(src, /character-props-label-appearance/);
  assert.match(src, /character-props-label-negative/);

  const css = read("prototype/styles.css");
  // 두 칸을 6:4 로 나란히. 좁은 화면에서는 한 줄로 접힌다.
  assert.match(css, /\.character-props-form > \.disclosure-inner \{[\s\S]*?grid-template-columns: 6fr 4fr;/);
  assert.match(css, /@media \(max-width: 720px\) \{\s*\.character-props-form > \.disclosure-inner \{\s*grid-template-columns: 1fr;/);
  // AI 안내는 두 칸 위에 한 줄로 걸쳐야 한다.
  assert.match(css, /\.character-props-ai-notice \{\s*grid-column: 1 \/ -1;/);
});

test("언어를 바꾸면 열려 있던 모달도 다시 그린다", () => {
  const src = hub();
  // 페이지 본문은 공통 런타임 로컬라이저가 처리하지만, 모달은 렌더 시점에 문자열을
  // 박아 넣으므로 재렌더가 없으면 이전 언어가 남아 화면이 섞인다.
  assert.match(src, /window\.addEventListener\('nk:lang-changed'/);
  assert.match(src, /rerenderCharacterModal = renderCharacterManagerModal/);
  // 같은 언어로 재진입하면 무한 재귀가 되므로 반드시 걸러야 한다.
  assert.match(src, /if \(lastAppliedLang === next\) return;/);
  // 리스너는 페이지 수명당 한 번만 — renderProject 가 여러 번 돌아도 중복 등록 금지.
  assert.match(src, /if \(window\.__knowledgeHubLangBound\) return;/);
});

test("API 클라이언트에 ipAnalyze 가 있다", () => {
  const src = read("prototype/api.js");
  assert.match(src, /api\.ipAnalyze = async function/);
  assert.match(src, /withBase\('\/api\/ip\/analyze'\)/);
  // 이미지 여러 장 분석이라 기본 타임아웃보다 길게 잡는다
  assert.match(src, /\(opts && opts\.timeoutMs\) \|\| 90000/);
});

test("Gemini 실패 사유가 사용자에게 그대로 전달된다", () => {
  const src = analyze();
  // 클라이언트(api.js e())는 error 필드만 표시하므로 사유를 그 문자열에 넣어야 한다
  assert.match(src, /error: `Gemini API error \(\$\{attempt\.res\.status\}\): \$\{geminiErrorMessage\(attempt\.text\)\}`/);
  assert.match(src, /function geminiErrorMessage\(text: string\)/);
  assert.match(src, /String\(\(parsed as any\)\?\.error\?\.message/);
  // 진단에 필요한 값(모델·이미지 수·용량)도 함께 내려준다
  assert.match(src, /model: geminiModel,\s*\n\s*analyzedImages: usable,\s*\n\s*inlineBytes,/);
});

test("스키마가 거절되면 스키마 없이 한 번 더 시도한다", () => {
  const src = analyze();
  assert.match(src, /let attempt = await callGemini\(true\)/);
  assert.match(src, /const retry = await callGemini\(false\)/);
  assert.match(src, /schemaFallback = true/);
  // 폴백 경로에서도 JSON만 받도록 지시하고, 코드펜스가 섞여도 파싱한다
  assert.match(src, /const JSON_ONLY_HINT/);
  assert.match(src, /function extractJsonBlock\(text: string\)/);
});

test("시트는 보내기 전에 줄여서 502(Worker 사망)를 막는다", () => {
  const src = hub();
  // 시트는 업로드 원본 그대로 data: URL 로 보관된다. 4장을 원해상도로 실어 보내면
  // 본문이 수십 MB 가 되고, 본문 파싱 중 Worker 가 죽어 Cloudflare 502 가 나온다.
  assert.match(src, /function shrinkForAnalyze/);
  assert.match(src, /ANALYZE_MAX_EDGE = 1024/);
  // 보내는 사본만 줄인다 — 저장된 원본은 그대로 둔다.
  assert.match(src, /Promise\.all\(aiSheets\.map\(shrinkForAnalyze\)\)/);
  // 원격 URL(gs://, https)은 서버가 직접 받아오므로 줄일 대상이 아니다.
  assert.match(src, /data:image[\s\S]{0,40}test\(raw\)[\s\S]{0,40}resolve\(raw\)/);
  // 투명 배경이 검게 깔리지 않도록 흰 바탕을 먼저 칠한다.
  assert.match(src, /ctx\.fillStyle = '#ffffff'/);
});

test("본문이 너무 크면 읽기 전에 413 으로 끊는다", () => {
  const src = analyze();
  // request.json() 으로 읽고 나면 이미 늦다(메모리 초과는 try/catch 로 못 잡는다).
  assert.match(src, /const MAX_REQUEST_BYTES = 12 \* 1024 \* 1024/);
  const guard = src.indexOf("declaredBytes");
  const parse = src.indexOf("await request.json()");
  assert.ok(guard > 0 && guard < parse, "크기 검사가 본문 파싱보다 앞서야 합니다");
  assert.match(src, /\}, 413\);/);
});

test("Cloudflare 가 끊기 전에 우리가 먼저 사유를 붙여 응답한다", () => {
  const src = analyze();
  // 요청이 CF 제한을 넘으면 우리 JSON 이 아니라 502 페이지가 화면에 그대로 뜬다.
  // 그래서 Gemini 호출에 예산을 걸고 초과하면 우리가 504 + 사유로 끝낸다.
  assert.match(src, /const TOTAL_BUDGET_MS = Math\.max\(5000, Number\(env\.IP_ANALYZE_BUDGET_MS\) \|\| 20000\)/);
  assert.match(src, /new AbortController\(\)/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /if \(attempt\.timedOut\) return timeoutResponse\("schema"\)/);
  assert.match(src, /if \(retry\.timedOut\) return timeoutResponse\("retry"\)/);
  // 사유를 좁히려면 어느 단계에서 몇 초 걸렸는지가 필요하다.
  // 사유를 좁히려면 어느 단계에서 몇 초 걸렸는지가 필요하다.
  assert.ok(src.includes("stage,") && src.includes("elapsedMs: elapsed(),"), "단계·소요시간을 응답에 담아야 합니다");
  // 네트워크 실패로 res 가 없을 수 있다 — 그때 res.ok 를 읽으면 함수가 죽는다.
  assert.match(src, /if \(!attempt\.res\) \{/);
  assert.match(src, /if \(!retry\.res\) \{/);
});

test("생각 시간은 스키마 시도에만 끄고, 폴백에는 넣지 않는다", () => {
  const src = analyze();
  // gemini-2.5-flash 는 기본으로 '생각'을 해서 이미지가 붙으면 지연이 크게 는다.
  assert.match(src, /thinkingConfig = \{ thinkingBudget: 0 \}/);
  // 이 필드를 모르는 모델은 400 을 낸다. 폴백까지 붙이면 두 번 다 실패한다.
  const schemaBlock = src.slice(src.indexOf("if (useSchema) {"), src.indexOf("const controller"));
  assert.ok(schemaBlock.includes("thinkingConfig"), "thinkingConfig 는 useSchema 분기 안에 있어야 합니다");
});

test("모든 외부 호출에 시간 제한이 있다 (하나라도 멈추면 CF 502 가 된다)", () => {
  const src = analyze();
  // 함수가 응답을 못 만들면 우리 JSON 이 아니라 Cloudflare 502 페이지가 그대로 뜬다.
  // 그래서 밖으로 나가는 호출은 전부 시간 제한을 걸어 둔다.
  assert.match(src, /function withTimeout<T>/);
  assert.ok(src.includes("await withTimeout("), "토큰 발급에 시간 제한이 있어야 합니다");
  assert.ok(src.includes("\"gcs_token\""), "토큰 단계 이름이 있어야 합니다");
  assert.match(src, /withTimeout\(fetch\(resolvedUrl, \{ headers \}\), 8000, "sheet_fetch"\)/);
  assert.match(src, /signal: controller\.signal/);
});

test("GCS 토큰은 원격 시트가 있을 때만 발급한다", () => {
  const src = analyze();
  // data: URL 만 있을 땐 RS256 서명 + OAuth 왕복이 통째로 낭비이자 멈춤 위험이다.
  assert.match(src, /const needsGcsToken = imageUrls\.some\(\(u\) => !\/\^data:\/i\.test\(u\)\)/);
  assert.match(src, /if \(needsGcsToken\) \{/);
  // 자격증명이 없어도 data: URL 만이면 진행돼야 한다.
  const guard = src.indexOf("Missing GOOGLE_CLIENT_EMAIL");
  const branch = src.indexOf("if (needsGcsToken) {");
  assert.ok(branch > 0 && guard > branch, "자격증명 검사는 needsGcsToken 안에 있어야 합니다");
});

test("예산 타이머는 핸들러 맨 앞에서 시작한다", () => {
  const src = analyze();
  // 예전엔 Gemini 호출 직전에 시작해서, 토큰·이미지 단계에서 시간을 다 써도
  // 예산이 남은 것처럼 보였다. 그래서 예산이 걸려도 502 가 났다.
  const timer = src.indexOf("const startedAt = Date.now()");
  const tryStart = src.indexOf("  try {");
  assert.ok(timer > 0 && timer < tryStart, "startedAt 은 try 블록보다 앞이어야 합니다");
});

test("시트가 커도 요청 크기를 넘기지 않는다", () => {
  const src = analyze();
  assert.match(src, /const MAX_INLINE_BYTES = 6 \* 1024 \* 1024/);
  assert.match(src, /if \(usable > 0 && inlineBytes \+ bytes > MAX_INLINE_BYTES\) \{ skippedForSize\+\+; continue; \}/);
  // 1장도 못 넣는 상황은 만들지 않는다(usable > 0 조건)
  assert.match(src, /skippedForSize,/);
});
