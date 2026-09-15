import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8").split("\r\n").join("\n");

/**
 * AI 기업 앱은 화면이 열려 있기만 하면 패널마다 2~8초 간격으로 DB 를 조회해,
 * 아무 일도 없는 시간에도 Neon 전송량·컴퓨트를 소모했다(2026-09-16 전송 한도 초과).
 * 목록 새로고침은 "활동 중(요청 직후·진행 중 작업)"일 때만 주기적으로 돈다.
 */

test("panels refresh through the activity-aware hook, not bare intervals", () => {
  const cases = [
    ["ai-company-app/src/components/Approvals.tsx", /useLiveRefresh\(refresh, 4000\);/],
    ["ai-company-app/src/components/Results.tsx", /useLiveRefresh\(refresh, 4000\);/],
    ["ai-company-app/src/components/Knowledge.tsx", /useLiveRefresh\(refresh, 8000\);/],
    ["ai-company-app/src/components/Skills.tsx", /useLiveRefresh\(refresh, 5000\);/],
    ["ai-company-app/src/components/Dashboard.tsx", /useLiveRefresh\(load, 6000\);/],
    ["ai-company-app/src/components/GraphView.tsx", /setInterval\(\(\) => \{ if \(isLiveActive\(\)\) void reload\(\); \}, 3000\)/],
    ["ai-company-app/src/components/ProductionCanvas.tsx", /setInterval\(\(\) => \{ if \(isLiveActive\(\)\) void tick\(\); \}, 5_000\)/],
  ];
  for (const [rel, pattern] of cases) assert.match(read(rel), pattern, rel);

  const app = read("ai-company-app/src/App.tsx");
  // 로컬 서버용 하트비트는 클라우드에서 의미가 없어 제거
  assert.doesNotMatch(app, /setInterval\(ping, 10_000\)/);
  assert.doesNotMatch(app, /\}, 2000\);\n    return \(\) => \{ stopped = true; clearInterval\(t\); \};/);
  assert.match(app, /if \(\(r\.working \?\? \[\]\)\.length\) markActive\(\);/);
});

test("scheduled alarms and the daily brief still fire without constant polling", () => {
  const app = read("ai-company-app/src/App.tsx");
  // 알람: 다음 발화 시각에 맞춘 타이머
  assert.match(app, /function scheduleNextReminder\(upcoming: \{ fire_at: string \}\[\]\)/);
  assert.match(app, /nextReminderTimerRef\.current = window\.setTimeout\(\(\) => \{ void reminderPollRef\.current\(\); \}, wait\);/);
  // 브리핑·다른 기기 알람: 매시 정각 직후 확인
  assert.match(app, /now\.getHours\(\) \+ 1, 0, 5\)/);
  assert.doesNotMatch(app, /const t = setInterval\(poll, 15000\);/);
  // 자율 근무는 켜 둔 동안 활동 중
  assert.match(app, /if \(!stopped\) \{ markActive\(\); autonomousStep\(activeConvRef\.current\)/);
});

test("user write requests mark activity and hidden studio stages pause", () => {
  const main = read("ai-company-app/src/main.tsx");
  assert.match(main, /if \(method !== "GET"\) markActive\(\);/);
  const live = read("ai-company-app/src/lib/liveSync.ts");
  assert.match(live, /if \(type === "stage-hidden"\) stageHidden = true;/);
  assert.match(live, /return !stageHidden && pageVisible\(\) && Date\.now\(\) < activeUntil;/);
  const nav = read("prototype/js/navigation.js");
  assert.match(nav, /f\.contentWindow\.postMessage\(\{ type: 'stage-hidden' \}, '\*'\)/);
});

test("studio credit gauge does not poll the credit DB on a timer", () => {
  const common = read("prototype/js/ui/common.js");
  assert.doesNotMatch(common, /setInterval\(common\.refreshCreditGauge, 30000\)/);
  assert.match(common, /window\.addEventListener\('nk:credits-changed'/);
  assert.match(common, /if \(document\.visibilityState === 'visible'\) common\.refreshCreditGauge\(\);/);
});
