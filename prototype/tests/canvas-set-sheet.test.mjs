// 캔버스 배경 바의 "세트 시트 생성"(바이블 E2, 설계서 4.1 2단계) — 캔버스 우선 개발 원칙.
//  - 배경 바 제목은 "배경", 숫자 칩 옆 다이아몬드 별(lucide sparkle) 버튼이 장소마다 set_sheet 잡을 하나씩 만든다.
//  - 서버 set_sheet: 장소 1개 = 2×2(정면·후면·부감·로우, 인물 없음) 시트 1장. 프롬프트는 _shared/storyboard-sheet.js 단일 원천.
//    결과는 payload.storyboardSheets(kind bible-set) + episodeLocations[].setSheet. 마스터 플레이트가 있으면 참조로 붙인다.
//  - 그래프 장소 노드가 플레이트·변형·세트 시트를 싣고, 배경 카드가 시트(바이블 배지)를 보여 준다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');

test('★배경 바: 제목 "배경", 숫자 옆 sparkle 버튼 → 장소마다 set_sheet 잡(시트 없는 장소 우선, 전부 있으면 확인 후 재생성)', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /label: "배경" \}/, 'LANE_STYLE.locations.label');
  assert.match(src, /key: "locations", kind: "locations", orient: "column", index: 0, label: "배경",/);
  assert.doesNotMatch(src, /장소 · 배경/);
  assert.match(src, /function SparkleIcon\(\{ className \}/);
  assert.match(src, /M9\.937 15\.5A2 2 0 0 0 8\.5 14\.063/, 'lucide sparkle(다이아몬드 별) 경로');
  assert.match(src, /\{l\.kind === "locations" && \([\s\S]*?<SparkleIcon className="h-4 w-4" \/>/);
  assert.match(src, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}\s*\n\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); openSetSheetModal\(\); \}\}/, '바 드래그·전체 선택과 겹치지 않게');
  assert.match(src, /const openSetSheetModal = \(\) => \{/);
  assert.match(src, /const missing = locationNodes\.filter\(\(n\) => !n\.data\?\.setSheet\);/);
  assert.match(src, /setSheetModal\(\{ step: "pick", selected: new Set\(\(missing\.length \? missing : locationNodes\)\.map\(\(n\) => n\.id\)\), resolution: String\(settings\.image\.size\) === "4K" \? "4K" : "2K" \}\);/, '시트 없는 장소가 기본 선택, 모두 있으면 전부(재생성)');
  assert.match(src, /const AUTO_APPROVE_TYPES = \["scene_still", "scene_video", "scene_upsert", "scene_reorder", "set_sheet"\];/);
});

test('★모든 생성 행위는 상태가 보인다: 잡 상태 띠(대기·승인 대기·실행 중·완료·오류, 승인 버튼) · 별 버튼 스피너 · 배경 카드 칩', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /interface PendingJob \{ jobId: string; type: string; sceneId\?: string \| number; status: string; label: string; target\?: string; error\?: string; updatedAt\?: number \}/);
  assert.match(src, /function jobStatusText\(j: PendingJob\): string \{/);
  assert.match(src, /case "review_pending": return "승인 대기";/);
  assert.match(src, /case "error": return `오류\$\{j\.error \? `: \$\{j\.error\}` : ""\}`;/);
  assert.match(src, /const error = String\(\(job as any\)\?\.error \|\| \(job as any\)\?\.output\?\.error \|\| ""\)\.trim\(\);/, '서버 오류 문구를 가져온다');
  // 상태는 레이아웃을 밀지 않는 떠 있는 작업 독(absolute, 왼쪽 아래)으로 — 상단 띠는 화면이 튀어 폐기
  assert.doesNotMatch(src, /data-testid="job-strip"/, '상단 상태 띠(레이아웃 밀림) 금지');
  assert.match(src, /className="absolute bottom-3 left-3 z-30 flex max-w-\[420px\] flex-col items-start gap-1\.5" data-testid="job-dock"/);
  assert.match(src, /const \[jobDockOpen, setJobDockOpen\] = useState\(false\);/);
  assert.match(src, /\{active\.length \? `작업 \$\{active\.length\}개 진행 중` : errors\.length \? `오류 \$\{errors\.length\}` : "작업 완료"\}/);
  assert.match(src, /\{j\.status === "review_pending" && <button type="button" onClick=\{\(\) => void approveNow\(j\.jobId\)\}/, '승인 대기면 그 자리에서 승인');
  assert.match(src, /const approveNow = async \(jobId: string\) => \{/);
  assert.match(src, /끝난 항목 지우기/);
  // 세트 시트 모달: 대상·해상도 선택 → "생성"이 곧 확인(만들자마자 승인) → 같은 모달에서 진행
  assert.match(src, /const \[sheetModal, setSheetModal\] = useState<\{ step: "pick" \| "progress"; selected: Set<string>; resolution: "2K" \| "4K" \} \| null>\(null\);/);
  assert.match(src, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); openSetSheetModal\(\); \}\}/, '별 버튼은 모달을 연다');
  assert.match(src, /const generateSetSheets = async \(ids: Set<string>, resolution: "2K" \| "4K"\) => \{/);
  assert.match(src, /const res = await createAgentJob\("set_sheet", \{ projectId, locationName: name, resolution, provider: settings\.image\.provider \}\);\s*\n[\s\S]{0,300}await approveItem\(res\.jobId\)/, '모달의 생성 = 확인이므로 바로 승인');
  assert.match(src, /<div className="text-\[13px\] font-bold text-white">세트 시트 생성<\/div>/);
  assert.match(src, /<option value="2K">2K<\/option>\s*\n\s*<option value="4K">4K<\/option>/);
  assert.match(src, /setSheetModal\(\{ \.\.\.m, step: "progress" \}\); void generateSetSheets\(m\.selected, m\.resolution\);/);
  assert.match(src, /닫아도 작업은 계속되고 왼쪽 아래 작업 독에서 볼 수 있어요/);
  // 잡 생성 자체가 실패해도 오류로 남는다
  assert.match(src, /setPending\(\(prev\) => \[\{ jobId: `local-\$\{Date\.now\(\)\}`, type, sceneId, status: "error", label, target, error: \(e as Error\)\.message/);
  // 별 버튼: 진행 중이면 스피너 + 비활성
  assert.match(src, /const setSheetActive = pending\.some\(\(p\) => p\.type === "set_sheet" && !JOB_DONE\.includes\(p\.status\)\);/);
  assert.match(src, /\{setSheetActive \? <RefreshIcon className="h-4 w-4 animate-spin" \/> : <SparkleIcon className="h-4 w-4" \/>\}/);
  assert.match(src, /aria-busy=\{setSheetActive\}/);
  // 배경 카드: 그 장소의 잡 상태 칩 + 오류 문구
  assert.match(src, /const locJob = n\.type === "location" \? pending\.find\(\(j\) => j\.type === "set_sheet" && String\(j\.target \|\| ""\) === String\(n\.data\.name \|\| n\.label\)\)/);
  assert.match(src, /\{locJob && !JOB_DONE\.includes\(locJob\.status\) && <Chip tone="amber">\{locJob\.status === "review_pending" \? "승인 대기" : "시트 생성 중"\}<\/Chip>\}/);
  assert.match(src, /\{locJob && locJob\.status === "error" && <Chip tone="red">오류<\/Chip>\}/);
  assert.match(src, /label: `세트 시트 · \$\{n\.label\}`, target: name, updatedAt: Date\.now\(\)/, '잡에 대상 장소를 기록');
});

test('★배경 카드: 세트 시트(바이블 배지·해상도) → 마스터 플레이트 → 없음 순으로 보여 주고 시트 유무 칩을 단다', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /\(n\.data\.setSheet\?\.url \|\| n\.data\.plateUrl\) \? \(/);
  assert.match(src, /withMediaToken\(String\(n\.data\.setSheet\?\.url \|\| n\.data\.plateUrl\)\)/);
  assert.match(src, /\{n\.data\.setSheet\?\.url \? "바이블" : "플레이트"\}/);
  assert.match(src, /\{n\.data\.setSheet \? <Chip tone="emerald">시트<\/Chip> : <Chip>시트 없음<\/Chip>\}/);
});

test('★그래프 장소 노드가 episodeLocations 의 플레이트·변형·세트 시트(패널 상태 포함)를 싣는다', () => {
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  assert.match(graph, /const locationAssets = \(name: string\) => \{/);
  assert.match(graph, /plateUrl: toDisplayUrl\(hit\.refObjectName \|\| ""\),/);
  assert.match(graph, /setSheet: sheetMeta \? \{/);
  assert.match(graph, /panels: Array\.isArray\(sheet\?\.panels\)/);
  assert.match(graph, /data: \{ name: loc, \.\.\.locationAssets\(loc\) \}/);
});

test('★서버 set_sheet 도구: 게이트 · 장소 1개 · buildBibleSetSheetPrompt 단일 원천 · 마스터 플레이트 참조 · storyboardSheets+episodeLocations 저장', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /import \{ buildBibleSetSheetPrompt, SET_ANGLES \} from "\.\.\/_shared\/storyboard-sheet\.js";/);
  assert.match(shared, /set_sheet: \{ agentId: "pixel", kind: "external", gate: true, run: runSetSheetTool \}/);
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const name = String\(input\?\.locationName \|\| input\?\.name \|\| input\?\.setName \|\| ""\)\.trim\(\);/);
  assert.match(fn, /buildBibleSetSheetPrompt\(\{ header, set: \{ name: String\(loc\.name \|\| name\), description: String\(loc\.description \|\| ""\) \}, aspect \}\)/);
  assert.match(fn, /referenceKind: "environment"/, '마스터 플레이트가 있으면 참조');
  assert.match(fn, /runImagenTool\(\{ prompt, aspectRatio: aspect, projectId, referenceImages, generationMode: "text-to-image", imageSize: resolution/);
  // 1차 실패 시 해상도 기본값·참조 없이 한 번 더, 두 시도의 오류를 모두 남긴다(원인 분리)
  assert.match(fn, /fallback = "default-size-no-reference";/);
  assert.match(fn, /runImagenTool\(\{ prompt, aspectRatio: aspect, projectId, referenceImages: \[\], generationMode: "text-to-image", \.\.\.providerOpt \}, ctx\)/);
  assert.match(fn, /세트 시트 생성 실패 — 1차\(/);
  assert.match(fn, /fallback, firstError,/);
  // imagen 오류는 상세(메시지·코드·힌트)까지 올린다 — "Gemini API error" 한 줄 금지
  assert.match(shared, /const detailMsg = String\(data\?\.message \|\| data\?\.detail\?\.error\?\.message \|\| data\?\.detail\?\.message \|\| ""\)\.trim\(\);/);
  assert.match(shared, /if \(data\?\.hint\) parts\.push\(`· \$\{String\(data\.hint\)\.slice\(0, 160\)\}`\);/);
  assert.match(fn, /kind: "bible-set"/);
  assert.match(fn, /panels: SET_ANGLES\.map\(/);
  assert.match(fn, /grid: \{ cols: 2, rows: 2 \}/);
  assert.match(fn, /callInternalJson\(ctx, "\/api\/project\/save", \{ body: \{ projectId, payload: \{ episodeLocations: locations, storyboardSheets: sheets \} \} \}\)/);
  assert.doesNotMatch(fn, /scenes:/, '컷 데이터는 건드리지 않는다(콘티는 컷 imageDataUrl 에 들어가지 않는다)');
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.match(orch, /set_sheet: `\[\[RUN: set_sheet \| \{"projectId"/);
  assert.match(orch, /set_sheet: "세트 시트\(바이블\) 생성"/);
});
