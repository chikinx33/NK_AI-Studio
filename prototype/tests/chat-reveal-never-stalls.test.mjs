import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = () => read("ai-company-app/src/App.tsx");
const api = () => read("ai-company-app/src/lib/api.ts");

// 증상: 발언 하나가 노출 중 멈추면 뒤 발언들이 큐에 갇혀 화면에 아무것도 안 나온다.
// (예: TTS 응답 지연·오디오 ended 미발생·백그라운드 탭 타이머 억제)

test("TTS 합성 요청에 시간 상한이 있다", () => {
  const src = api();
  assert.match(src, /export function timeoutSignal\(ms: number\): AbortSignal/);
  // 서버(MeloTTS) · 클라우드(Gemini) 양쪽 모두
  assert.match(src, /"\/api\/tts\/melo"[\s\S]{0,220}signal: timeoutSignal\(60000\)/);
  assert.match(src, /"\/api\/tts"[\s\S]{0,900}signal: timeoutSignal\(45000\)/);
});

test("오디오 재생과 브라우저 낭독이 끝나지 않아도 빠져나온다", () => {
  const src = app();
  // ended/error/pause 가 안 와도 재생 길이 기준 상한으로 종료
  assert.match(src, /audio\.onloadedmetadata = \(\) => \{[\s\S]{0,200}arm\(\(dur \/ Math\.max\(0\.5, speed\)\) \* 1000 \+ 15000\)/);
  assert.match(src, /arm\(60000\)/);
  // speechSynthesis end 이벤트 누락 대비 — 예상시간 2배로 레이스
  assert.match(src, /Promise\.race\(\[handle\.done, presentationDelay\(Math\.min\(estMs \* 2 \+ 15000, 180000\)\)\]\)/);
});

test("노출 감시 타이머가 큐를 풀어준다", () => {
  const src = app();
  assert.match(src, /function revealCapMs\(text: string\)/);
  assert.match(src, /const timedOut = await Promise\.race\(\[\s*\n\s*revealAgentTurn\(item\.turnId, item\.agentId, item\.text\)\.then\(\(\) => false\)/);
  assert.match(src, /if \(timedOut\) \{\s*\n\s*stopSpeech\(\);\s*\n\s*forceRevealTurn\(item\.turnId, item\.text\);/);
  // 강제 노출 후 뒤늦게 끝난 TTS·타이핑이 자막을 되돌리지 못하게 막는다
  assert.match(src, /function forceRevealTurn\(turnId: string, fullText: string\)/);
  assert.match(src, /revealSettledRef\.current\.add\(turnId\)/);
  assert.match(src, /if \(revealSettledRef\.current\.has\(turnId\)\) return Promise\.resolve\(\)/);
  assert.match(src, /if \(revealSettledRef\.current\.has\(turnId\)\) return;/);
});

test("실시간 발언이 안 끝나도 큐를 다시 확인한다", () => {
  const src = app();
  // 예전엔 그냥 return 해서 큐가 영구 정지했다
  assert.match(src, /if \(liveTurnIsVisible\) \{[\s\S]{0,400}void processPresentationQueue\(\);\s*\n\s*\}, 500\)/);
  assert.doesNotMatch(src, /if \(presentationRunningRef\.current \|\| liveTurnIsVisible\) return;/);
});

test("백그라운드 탭에서는 타이핑 대신 즉시 노출한다", () => {
  const src = app();
  assert.match(src, /if \(typeof document !== "undefined" && document\.hidden\) \{[\s\S]{0,220}displayText: fullText/);
});

test("자막이 빈 채 남은 발언을 주기적으로 되살린다", () => {
  const src = app();
  assert.match(src, /turn\.displayText === "" && !!turn\.id && !queuedIds\.has\(turn\.id\)/);
  assert.match(src, /\}, 5000\);\s*\n\s*return \(\) => clearInterval\(t\);/);
});
