import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("AI 기업 채팅은 표준·webkit 음성 인식 API를 모두 지원한다", () => {
  const speech = read("ai-company-app/src/lib/speechRecognition.ts");
  assert.match(speech, /speechWindow\.SpeechRecognition \|\| speechWindow\.webkitSpeechRecognition/);
  assert.match(speech, /collectSpeechTranscript/);
  assert.match(speech, /mergeSpeechDraft/);
});

test("마이크 모드는 인식 문장을 즉시 전송하고 다음 발화를 계속 기다린다", () => {
  const control = read("ai-company-app/src/components/SpeechInputControl.tsx");
  assert.match(control, /recognition\.continuous = false/);
  assert.match(control, /recognition\.interimResults = true/);
  assert.match(control, /recognizedMessage = mergeSpeechDraft\(draftBaseRef\.current, transcript\)/);
  assert.match(control, /recognition\.onend = \(\) =>/);
  assert.match(control, /if \(!mountedRef\.current \|\| !isCurrentSession\) return/);
  assert.match(control, /onRecognizedRef\.current\(text\)/);
  assert.match(control, /!recognitionFailed && hasRecognizedSpeech && text && !busyRef\.current/);
  assert.match(control, /if \(shouldRestart && enabledRef\.current\) scheduleRestart\(restartDelay\)/);
  assert.match(control, /답변이 끝나면 자동으로 다시 듣습니다/);
  assert.match(control, /busyRef\.current \|\| streamingRef\.current \|\| agentPresentingRef\.current/);
  const app = read("ai-company-app/src/App.tsx");
  assert.match(app, /const \[presentationActive, setPresentationActive\] = useState\(false\)/);
  assert.match(app, /presentationRunningRef\.current = true;\s+setPresentationActive\(true\)/);
  assert.match(app, /else setPresentationActive\(false\)/);
  assert.match(app, /agentPresenting=\{presentationActive\}/);
  assert.doesNotMatch(control, /음성.{0,20}확인/);
});

test("일반 채팅과 VN 모드는 동일한 마이크 UI와 상태를 공유한다", () => {
  const chat = read("ai-company-app/src/components/Chat.tsx");
  const visualNovel = read("ai-company-app/src/components/VisualNovel.tsx");
  const control = read("ai-company-app/src/components/SpeechInputControl.tsx");
  const speech = read("ai-company-app/src/lib/speechRecognition.ts");
  assert.match(chat, /<SpeechInputButton/);
  assert.match(chat, /<SpeechInputStatus/);
  assert.match(visualNovel, /<SpeechInputButton/);
  assert.match(visualNovel, /<SpeechInputStatus/);
  assert.match(control, /aria-pressed=\{enabled\}/);
  assert.match(control, /문장이 끝날 때마다 자동 전송하며 계속 듣습니다/);
  assert.match(control, /disabled=\{!supported \|\| isExpired\}/);
  assert.match(control, /이 브라우저는 음성 입력을 지원하지 않습니다/);
  assert.match(control, /<path d="M19 10v2a7 7 0 0 1-14 0v-2"/);
  assert.match(control, /<rect x="9" y="2" width="6" height="13" rx="3"/);
  assert.match(speech, /마이크 권한이 차단되었습니다/);
  assert.match(speech, /사용할 수 있는 마이크를 찾지 못했습니다/);
});

test("마이크 모드는 화면 전환과 무관하게 유지되고 채팅 밖에서도 코어 UI 명령을 보낸다", () => {
  const app = read("ai-company-app/src/App.tsx");
  const sidebar = read("ai-company-app/src/components/Sidebar.tsx");
  const control = read("ai-company-app/src/components/SpeechInputControl.tsx");
  assert.match(app, /const \[speechModeEnabled, setSpeechModeEnabled\] = useState\(false\)/);
  assert.match(app, /const speechInput = useSpeechInput\(/);
  assert.match(app, /draft: centerView === "chat" \? draft : ""/);
  assert.match(app, /void send\(text, undefined, today\)/);
  assert.match(app, /conversationId === activeConvRef\.current/);
  assert.match(app, /conversationId, signal: controller\.signal/);
  assert.match(app, /coreOverlay=\{centerView !== "chat" \? \(/);
  assert.match(app, /absolute bottom-1\.5 left-1\.5 z-30/);
  assert.doesNotMatch(app, /코어 전역 음성 명령/);
  assert.doesNotMatch(app, /어느 화면에서든 마이크로 UI를 제어할 수 있습니다/);
  assert.doesNotMatch(app, /fixed bottom-4 right-4/);
  assert.match(sidebar, /coreOverlay\?: ReactNode/);
  assert.match(sidebar, /overlay=\{coreOverlay\}/);
  assert.equal((app.match(/speechInput=\{speechInput\}/g) || []).length, 2);
  assert.match(control, /return \(\) => \{\s+mountedRef\.current = false;/);
  assert.doesNotMatch(control, /return \(\) => \{[\s\S]{0,200}onEnabledChangeRef\.current\(false\)/);
});

test("VN 모드 사용자 입력창은 스크롤을 유지하면서 스크롤바 표시만 숨긴다", () => {
  const visualNovel = read("ai-company-app/src/components/VisualNovel.tsx");
  const css = read("ai-company-app/src/index.css");
  assert.match(visualNovel, /<textarea[\s\S]*className="no-scrollbar flex-1 resize-none overflow-y-auto/);
  assert.match(css, /\.no-scrollbar \{ scrollbar-width: none; -ms-overflow-style: none; \}/);
  assert.match(css, /\.no-scrollbar::\-webkit-scrollbar \{ width: 0; height: 0; display: none; \}/);
  assert.doesNotMatch(visualNovel, /vn-scrollbars-hidden/);
});
