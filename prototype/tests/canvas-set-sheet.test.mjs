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
  assert.match(src, /const AUTO_APPROVE_TYPES = \["scene_still", "scene_video", "scene_upsert", "scene_reorder", "set_sheet", "location_merge", "scene_split", "style_anchor_set"\];/);
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
  assert.match(src, /className="absolute bottom-3 left-3 z-30 flex max-w-\[420px\] select-text flex-col items-start gap-1\.5" data-testid="job-dock"/);
  assert.match(src, /const \[jobDockOpen, setJobDockOpen\] = useState\(false\);/);
  assert.match(src, /\{active\.length \? `작업 \$\{active\.length\}개 진행 중` : errors\.length \? `오류 \$\{errors\.length\}` : "작업 완료"\}/);
  assert.match(src, /\{j\.status === "review_pending" && <button type="button" onClick=\{\(\) => void approveNow\(j\.jobId\)\}/, '승인 대기면 그 자리에서 승인');
  assert.match(src, /const approveNow = async \(jobId: string\) => \{/);
  assert.match(src, /끝난 항목 지우기/);
  // 세트 시트 모달: 대상·해상도 선택 → "생성"이 곧 확인(만들자마자 승인) → 같은 모달에서 진행
  assert.match(src, /const \[sheetModal, setSheetModal\] = useState<\{ step: "pick" \| "progress"; selected: Set<string>; resolution: "2K" \| "4K"; usePlate\?: boolean \} \| null>\(null\);/);
  assert.match(src, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); openSetSheetModal\(\); \}\}/, '별 버튼은 모달을 연다');
  assert.match(src, /const generateSetSheets = async \(ids: Set<string>, resolution: "2K" \| "4K", usePlate = false\) => \{/);
  assert.match(src, /const res = await createAgentJob\("set_sheet", \{ projectId, locationName: name, resolution, \.\.\.providerArg\(settings\), usePlate \}\);\s*\n[\s\S]{0,300}await approveItem\(res\.jobId\)/, '모달의 생성 = 확인이므로 바로 승인');
  assert.match(src, /<div className="text-\[13px\] font-bold text-white">세트 시트 생성<\/div>/);
  assert.match(src, /<option value="2K">2K<\/option>\s*\n\s*<option value="4K">4K<\/option>/);
  assert.match(src, /setSheetModal\(\{ \.\.\.m, step: "progress" \}\); void generateSetSheets\(m\.selected, m\.resolution, !!m\.usePlate\);/);
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

test('★Gemini 지역 거부(User location is not supported) → Vertex(global) 우회: 같은 요청을 서비스 계정으로 다시 보내고 응답에 경로를 남긴다', () => {
  const imagen = read('prototype/functions/api/imagen.ts');
  assert.match(imagen, /const vertexProjectId = String\(env\.GOOGLE_CLOUD_PROJECT \|\| env\.GCS_PROJECT_ID \|\| ""\)\.trim\(\);/);
  assert.match(imagen, /const vertexModel = String\(env\.GEMINI_VERTEX_IMAGE_MODEL \|\| ""\)\.trim\(\) \|\| geminiModel\.replace\(\/-preview\$\/i, ""\);/);
  assert.match(imagen, /https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/\$\{vertexProjectId\}\/locations\/global\/publishers\/google\/models\/\$\{encodeURIComponent\(vertexModel\)\}:generateContent/);
  assert.match(imagen, /Authorization: `Bearer \$\{accessToken\}`,\s*\n\s*"x-goog-user-project": vertexProjectId,/);
  assert.match(imagen, /const locationBlocked = !!geminiRes && !geminiRes\.ok && \/User location is not supported\|FAILED_PRECONDITION\/i\.test\(geminiText\);/);
  assert.match(imagen, /if \(locationBlocked && vertexAvailable\) \{\s*\n\s*geminiLocationFallback = `ai-studio\(\$\{geminiRes\?\.status\}\) → vertex-global`;\s*\n\s*await callVertex\(\);/);
  assert.match(imagen, /GEMINI_IMAGE_VIA_VERTEX/, '환경변수로 처음부터 Vertex 강제 가능');
  assert.match(imagen, /geminiEndpoint: geminiEndpointUsed,\s*\n\s*geminiLocationFallback,/, '성공 응답에도 경로를 남긴다');
  assert.match(imagen, /modelUsed = geminiModelUsed \|\| geminiModel;/);
});

test('★세트 시트 모달 재진입·복사: 진행 중이면 별 버튼이 진행 화면을 다시 열고, 오류 문구는 선택·복사 가능', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const running = pending\.filter\(\(j\) => j\.type === "set_sheet" && !JOB_DONE\.includes\(j\.status\)\);\s*\n\s*if \(running\.length\) \{/);
  assert.match(src, /setSheetModal\(\{ step: "progress", selected: new Set\(locationNodes\.filter\(\(n\) => names\.has\(String\(n\.data\?\.name \|\| n\.label\)\)\)/);
  assert.match(src, /별 버튼을 다시 누르면 이 진행 화면이 열려요/);
  assert.match(src, /다시 만들기/);
  assert.match(src, /className="w-\[560px\] max-w-\[94%\] select-text overflow-hidden/, '캔버스의 select-none 을 모달에서 해제');
  assert.match(src, /<pre className="max-h-40 select-text overflow-auto whitespace-pre-wrap break-words text-\[11px\] leading-snug text-red-200">\{text\}<\/pre>/);
  assert.match(src, /void navigator\.clipboard\.writeText\(text\); setNotice\("오류 문구를 복사했어요\."\);/);
  assert.match(src, /flex max-w-\[420px\] select-text flex-col items-start gap-1\.5" data-testid="job-dock"/);
  assert.match(src, /title="오류 문구 복사">복사<\/button>/);
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
  assert.match(shared, /import \{ buildBibleSetSheetPrompt, buildHubContext, SET_ANGLES \} from "\.\.\/_shared\/storyboard-sheet\.js";/);
  assert.match(shared, /set_sheet: \{ agentId: "pixel", kind: "external", gate: true, run: runSetSheetTool \}/);
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const name = String\(input\?\.locationName \|\| input\?\.name \|\| input\?\.setName \|\| ""\)\.trim\(\);/);
  assert.match(fn, /const promptInput = \{ header, hub: hubContext, set: \{ name: promptSetName, description: promptSetDesc \}, aspect, hasStyleRef: false, hasPlateRef: false, nameWasSentence: looksLikeSentenceLocation\(rawSetName\) \};/);
  assert.match(fn, /buildBibleSetSheetPrompt\(promptInput\)/);
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
  assert.match(fn, /const nextPayload: any = \{ episodeLocations: locations, storyboardSheets: sheets \};/);
  assert.match(fn, /callInternalJson\(ctx, "\/api\/project\/save", \{ body: \{ projectId, payload: nextPayload \} \}\)/);
  assert.doesNotMatch(fn, /scenes:/, '컷 데이터는 건드리지 않는다(콘티는 컷 imageDataUrl 에 들어가지 않는다)');
  const orch = read('prototype/functions/api/agent/_orchestrator.ts');
  assert.match(orch, /set_sheet: `\[\[RUN: set_sheet \| \{"projectId"/);
  assert.match(orch, /set_sheet: "세트 시트\(바이블\) 생성"/);
});

test('★배경 카드 선택 → 상세에 세트 시트를 크게(2×2 앵글 라벨), 플레이트 띠, 다시 만들기; 클릭하면 라이트박스', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const \[lightbox, setLightbox\] = useState<\{ url: string; title: string; objectName\?: string \} \| null>\(null\);/);
  assert.match(src, /const mainUrl = String\(sheet\?\.url \|\| plateUrl \|\| ""\);/);
  assert.match(src, /className="block max-h-\[60vh\] w-full cursor-zoom-in object-contain"/);
  assert.match(src, /const angleNames = \["정면", "후면", "부감", "로우"\];/);
  assert.match(src, /\{i \+ 1\} · \{name\}/, '2×2 칸마다 번호·앵글 라벨');
  assert.match(src, /\{sheet \? "세트 시트 다시 만들기" : "세트 시트 만들기"\}/);
  assert.match(src, /setSheetModal\(\{ step: "pick", selected: new Set\(\[selected\.id\]\)/, '이 장소만 선택된 채 모달');
  assert.match(src, /아직 세트 시트가 없어요\. 배경 바의 별 버튼으로 만들어요\./);
  assert.match(src, /className="absolute inset-0 z-50 grid place-items-center bg-black\/85 p-6" onClick=\{\(\) => setLightbox\(null\)\}/);
});

test('★세트 정체성: 같은 세트로 보이는 장소는 카드에 "중복 의심", 상세에서 핵심 이름으로 합치기(location_merge, 자동 승인)', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /import \{ suggestLocationMerges \} from "\.\.\/lib\/locationNames";/);
  assert.match(src, /const mergeSuggestions = useMemo\(\(\) => suggestLocationMerges\(locationNodes\.map\(\(n\) => String\(n\.data\?\.name \|\| n\.label\)\)\), \[locationNodes\]\);/);
  assert.match(src, /const mergeLocations = async \(from: string\[\], into: string\) => \{/);
  assert.match(src, /for \(const f of from\) await enqueue\("location_merge", \{ projectId, from: f, into \}, `장소 합치기 · \$\{f\} → \$\{into\}`, undefined, into\);/);
  assert.match(src, /<Chip tone="red">중복 의심<\/Chip>/);
  assert.match(src, /같은 세트로 보이는 장소가 있어요<\/div>/);
  assert.match(src, /const AUTO_APPROVE_TYPES = \["scene_still", "scene_video", "scene_upsert", "scene_reorder", "set_sheet", "location_merge", "scene_split", "style_anchor_set"\];/);
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /location_merge: \{ agentId: "plot", kind: "external", gate: true, run: runLocationMergeTool \}/);
  assert.match(shared, /location_suggest: \{ agentId: "plot", kind: "read", run: runLocationSuggestTool \}/);
  const i = shared.indexOf('async function runLocationMergeTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const merged = applyLocationMerge\(scenes, from, into\);/);
  assert.match(fn, /if \(!target\.setSheet && src\.setSheet\) \{ target\.setSheet = src\.setSheet; inherited\.push\("setSheet"\); \}/, '남는 쪽에 없는 자산만 물려받는다');
  assert.match(fn, /locations\.splice\(fi, 1\);/);
  assert.match(fn, /body: \{ projectId, scenes: merged\.scenes, payload: \{ episodeLocations: locations, storyboardSheets: sheets \} \}/);
});

test('★스타일 앵커: 첫 세트 시트가 프로젝트 그림체 기준이 되고, 이후 시트는 그것을 style 참조로 받는다 · 정면 플레이트 참조는 선택(기본 끔)', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const anchor = \(payload\.styleAnchor && typeof payload\.styleAnchor === "object" && payload\.styleAnchor\.objectName\) \? payload\.styleAnchor : null;/);
  assert.match(fn, /referenceKind: "style"/);
  assert.match(fn, /const usePlate = input\?\.usePlate === true && !!\(loc\.refObjectName && bucket\);/, '플레이트 참조는 명시할 때만');
  assert.match(fn, /if \(!anchor\) nextPayload\.styleAnchor = \{ objectName: img\.objectName, sheetId, setName: String\(loc\.name \|\| name\), createdAt: sheet\.createdAt \};/);
  assert.match(fn, /becameStyleAnchor: !anchor/);
  const sheet = read('prototype/functions/api/_shared/storyboard-sheet.js');
  assert.match(sheet, /A STYLE ANCHOR image is provided: it is a DIFFERENT set from this project\./);
  assert.match(sheet, /if \(input && input\.hasPlateRef\) \{/);
  const imagen = read('prototype/functions/api/imagen.ts');
  assert.match(imagen, /: \(rkRaw === "style" \|\| rkRaw === "style-anchor"\) \? "style"/);
  assert.match(imagen, /is the project's STYLE ANCHOR — a different subject\/place\. Match its rendering style/);
  assert.match(imagen, /One reference image is the project's STYLE ANCHOR \(\$\{subject\}\)\./);
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  assert.match(graph, /styleAnchor: \(payload\.styleAnchor && typeof payload\.styleAnchor === "object" && payload\.styleAnchor\.objectName\)/);
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /<Chip tone="amber">스타일 기준<\/Chip>/);
  assert.match(src, /정면 플레이트 참조\s*\n\s*<\/label>/);
  assert.match(src, /void generateSetSheets\(m\.selected, m\.resolution, !!m\.usePlate\);/);
  assert.match(src, /createAgentJob\("set_sheet", \{ projectId, locationName: name, resolution, \.\.\.providerArg\(settings\), usePlate \}\)/);
});

test('★배경 카드 클릭 흐름: 이미지 영역=크게 보기, 텍스트 영역=선택 토글(여러 장), ⓘ=상세; 2장 이상 선택하면 배경 바에 합치기 → 남길 이름 고르는 모달', () => {
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const zone = \(\(e\.target as HTMLElement \| null\)\?\.closest\?\.\("\[data-zone\]"\) as HTMLElement \| null\)\?\.dataset\?\.zone \|\| "";/);
  assert.match(src, /if \(d\.zone === "image"\) \{\s*\n\s*const url = String\(ln\.data\.setSheet\?\.url \|\| ln\.data\.plateUrl \|\| ""\);\s*\n\s*if \(url\) setLightbox\(/);
  assert.match(src, /setMulti\(\(prev\) => \{ const next = new Set\(prev\); next\.has\(d\.id!\) \? next\.delete\(d\.id!\) : next\.add\(d\.id!\); return next; \}\);\s*\n\s*return;\s*\n\s*\}\s*\n\s*if \(\(d\.kind === "node" \|\| d\.kind === "cut"\) && d\.id && !d\.moved\) \{/, '배경 카드는 상세를 열지 않고 선택만 토글');
  assert.match(src, /data-zone="image" title="누르면 크게 볼 수 있어요"/);
  assert.match(src, /data-zone="text" title="누르면 선택돼요/);
  assert.match(src, /data-zone="detail" onPointerDown=\{\(e\) => e\.stopPropagation\(\)\} onClick=\{\(e\) => \{ e\.stopPropagation\(\); setSelectedId\(n\.id\); \}\}/);
  assert.match(src, /const picked = locationNodes\.filter\(\(n\) => multi\.has\(n\.id\)\);\s*\n\s*if \(picked\.length < 2\) return null;/);
  assert.match(src, /setMergeModal\(\{ names, into \}\)/);
  assert.match(src, /<div className="text-\[13px\] font-bold text-white">배경 합치기<\/div>/);
  assert.match(src, /<input type="radio" name="merge-into"/);
  assert.match(src, /placeholder="예: 소녀의 방"/);
  assert.match(src, /setMergeModal\(null\); setMulti\(new Set\(\)\); void mergeLocations\(from, into\);/);
  assert.doesNotMatch(src, /window\.confirm\(`\$\{from\.map/, '합치기는 모달이 곧 확인');
});

test('★세트 시트 그림체 참조는 허브에서: 앵커 없으면 브랜드 캐릭터 시트 → 기존 스틸 → 기존 플레이트 순으로 style 참조 · 창작자가 스타일 기준 지정(style_anchor_set)', () => {
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const got: any = await runBrandGetTool\(\{ brandId \}, ctx\);/, '브랜드 캐릭터 시트');
  assert.match(fn, /do NOT draw this character — the set is empty/);
  assert.match(fn, /styleSource = "brand-character-sheets";/);
  assert.match(fn, /styleSource = "project-still";/);
  assert.match(fn, /styleSource = "existing-plate";/);
  assert.match(fn, /const hasStyleRefs = referenceImages\.some\(\(r\) => r\.referenceKind === "style"\);/);
  assert.match(fn, /promptInput\.hasStyleRef = hasStyleRefs;/);
  assert.match(shared, /style_anchor_set: \{ agentId: "pixel", kind: "external", gate: true, run: runStyleAnchorSetTool \}/);
  assert.match(shared, /body: \{ projectId, payload: \{ styleAnchor: anchor \} \}/);
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /const setStyleAnchor = async \(objectName: string, label: string\) => \{/);
  assert.match(src, /await enqueue\("style_anchor_set", \{ projectId, objectName, setName: label \}, `스타일 기준 지정 · \$\{label\}`\);/);
  assert.match(src, />이 이미지를 스타일 기준으로<\/button>/);
  assert.match(src, /"scene_split", "style_anchor_set"\];/);
  const graph = read('prototype/functions/api/agent/production-graph.ts');
  assert.match(graph, /url: toDisplayUrl\(v\.refObjectName\), objectName: String\(v\.refObjectName \|\| ""\)/);
});

test('★브랜드 허브가 세트 시트 프롬프트의 첫 블록이다: 톤&매너·세계관/배경·스토리·규칙·금지·참조 + 배경·소품 자산 이미지가 최우선 스타일 참조', async () => {
  const { buildHubContext, buildBibleSetSheetPrompt } = await import('../functions/api/_shared/storyboard-sheet.js');
  const payload = {
    brandVoice: '따뜻하고 호기심 많은 어린이 시선의 말투', worldSetting: '도형 생명체가 살아가는 밝은 자연 세계 · 마을, 들판, 숲, 하늘 등 단순하고 상징적인 공간',
    brandStory: '세상을 이루는 가장 기본적인 요소인 모양과 색이 살아 움직이는 세계', brandRules: ['어려운 단어 대신 직관적 표현', '캐릭터 간 대화 중심'], bannedExpressions: ['폭력'], successCases: ['밝은 원색 팔레트'],
  };
  const hub = buildHubContext(payload);
  assert.match(hub, /^\[BRAND HUB — this project's identity/);
  assert.match(hub, /WORLD \/ BACKGROUND \(the set MUST belong to this world\): 도형 생명체가 살아가는 밝은 자연 세계/);
  assert.match(hub, /TONE & MANNER: 따뜻하고 호기심 많은/);
  assert.match(hub, /BRAND RULES \(obey\): 어려운 단어 대신 직관적 표현 \| 캐릭터 간 대화 중심/);
  assert.match(hub, /AVOID: 폭력/);
  assert.match(hub, /REFERENCE \/ WHAT WORKED: 밝은 원색 팔레트/);
  assert.equal(buildHubContext({}), '', '허브가 비면 블록도 없다');
  assert.equal(buildHubContext({ knowledgeHub: { worldSetting: '숲' } }).includes('WORLD / BACKGROUND'), true, 'knowledgeHub 중첩도 읽는다');
  const prompt = buildBibleSetSheetPrompt({ header: 'STYLE: 3D', hub, set: { name: '놀이방', description: '장난감' }, aspect: '16:9' });
  const iHeader = prompt.indexOf('STYLE: 3D'); const iHub = prompt.indexOf('[BRAND HUB'); const iGrid = prompt.indexOf('SET SHEET:');
  assert.ok(iHeader < iHub && iHub < iGrid, '헤더 → 허브 블록 → 격자 순');
  const shared = read('prototype/functions/api/agent/_shared.ts');
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /const hubContext = buildHubContext\(payload\);/);
  assert.match(fn, /hub: hubContext,/);
  assert.match(fn, /const envAssets: any\[\] = Array\.isArray\(payload\.environmentAssets\)/, '허브 배경·소품 자산이 최우선 스타일 참조');
  assert.match(fn, /styleSource = "hub-environment-assets";/);
  assert.match(fn, /hubContextUsed: !!hubContext,/);
  const scen = read('prototype/functions/api/scenario.js');
  assert.match(scen, /\[브랜드 허브 — 세계관\/배경 \(세트는 반드시 이 세계 안의 공간\)\]/);
  assert.match(scen, /\[브랜드 허브 — 톤&매너\]/);
  assert.match(scen, /\[브랜드 허브 — 규칙\]/);
});

test('★모델 차이·검증: 캔버스 기본 공급자는 "스튜디오 기본"(서버 기본 = 예전 이미지와 같은 모델), 시트마다 diag(모델·경로·참조 수·그림체 출처·허브 블록·프롬프트) 기록·표시', () => {
  const cs = read('ai-company-app/src/lib/canvasSettings.ts');
  assert.match(cs, /export type ImageProvider = "studio" \| "gemini" \| "openai";/);
  assert.match(cs, /\{ id: "studio", label: "스튜디오 설정 따름 \(제작 화면의 이미지생성 모델\)" \},/);
  assert.match(cs, /image: \{ aspect: "16:9", size: "1K", count: 1, provider: "studio" \},/);
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.match(src, /\.\.\.providerArg\(settings\), usePlate \}/, 'set_sheet 는 명시한 공급자만 보낸다');
  assert.doesNotMatch(src, /provider: settings\.image\.provider, imageSize/, 'scene_still 도 명시한 공급자만');
  assert.match(src, /이 시트는 어떻게 만들어졌나/);
  assert.match(src, /"brand-character-sheets": "브랜드 캐릭터 시트\(그림체만\)"/);
  const shared = read('prototype/functions/api/agent/_shared.ts');
  assert.match(shared, /geminiEndpoint: data\.geminiEndpoint \|\| "",/);
  assert.match(shared, /referenceImageCount: Number\(data\.referenceImageCount\) \|\| 0,/);
  const i = shared.indexOf('async function runSetSheetTool(');
  const fn = shared.slice(i, shared.indexOf('\n}\n', i));
  assert.match(fn, /diag: \{\s*\n\s*provider: String\(img\.provider \|\| ""\), model: String\(img\.model \|\| ""\), geminiEndpoint:/);
  assert.match(fn, /promptHead: String\(prompt\)\.slice\(0, 1200\),/);
  assert.match(fn, /createdAt: sheet\.createdAt, diag: sheet\.diag \} \};/);
  assert.match(read('prototype/functions/api/agent/production-graph.ts'), /diag: \(sheet\?\.diag && typeof sheet\.diag === "object"\) \? sheet\.diag/);
  assert.match(read('prototype/functions/api/imagen.ts'), /item\.referenceKind === "prop" \|\| item\.referenceKind === "style"\)/, 'style 참조에도 이미지별 지시문');
});

test('★"스튜디오 설정 따름"은 제작 화면의 이미지생성 모델(localStorage nk_ai_image_provider)을 읽어 같은 모델로 보낸다', () => {
  const cs = read('ai-company-app/src/lib/canvasSettings.ts');
  assert.match(cs, /export const STUDIO_IMAGE_PROVIDER_KEY = "nk_ai_image_provider";/);
  assert.match(cs, /raw === "openai" \|\| raw === "gemini" \|\| raw === "gpt25-flare" \|\| raw === "gpt25-sunburst"/);
  assert.match(cs, /return s\.image\.provider === "studio" \? readStudioImageProvider\(\) : s\.image\.provider;/);
  assert.match(cs, /export function providerArg\(s: CanvasSettings\): \{ provider\?: string \}/);
  assert.match(read('prototype/js/config.js'), /IMAGE_PROVIDER: 'nk_ai_image_provider',/, '스튜디오와 같은 키');
  const src = read('ai-company-app/src/components/ProductionCanvas.tsx');
  assert.equal((src.match(/\.\.\.providerArg\(settings\)/g) || []).length, 3, 'set_sheet + scene_still 두 곳 = 3곳');
  assert.match(src, /모델: <span className="text-gray-300">/);
});
