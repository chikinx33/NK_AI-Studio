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
  const chat = read("ai-company-app/src/components/Chat.tsx");
  assert.match(chat, /recognition\.continuous = false/);
  assert.match(chat, /recognition\.interimResults = true/);
  assert.match(chat, /recognizedMessage = mergeSpeechDraft\(speechDraftBaseRef\.current, transcript\)/);
  assert.match(chat, /recognition\.onend = \(\) =>/);
  assert.match(chat, /onSendRef\.current\(text, currentAttachments\.length \? currentAttachments : undefined\)/);
  assert.match(chat, /!recognitionFailed && hasRecognizedSpeech && text && !busyRef\.current/);
  assert.match(chat, /if \(shouldRestart && speechModeEnabledRef\.current\) scheduleSpeechRecognitionRestart\(restartDelay\)/);
  assert.match(chat, /답변이 끝나면 자동으로 다시 듣습니다/);
  assert.match(chat, /if \(speechModeEnabledRef\.current\) stopSpeechInput\(\)/);
  assert.match(chat, /busyRef\.current \|\| streamingRef\.current \|\| agentPresentingRef\.current/);
  const app = read("ai-company-app/src/App.tsx");
  assert.match(app, /const \[presentationActive, setPresentationActive\] = useState\(false\)/);
  assert.match(app, /presentationRunningRef\.current = true;\s+setPresentationActive\(true\)/);
  assert.match(app, /else setPresentationActive\(false\)/);
  assert.match(app, /agentPresenting=\{presentationActive\}/);
  assert.doesNotMatch(chat, /음성.{0,20}확인/);
});

test("마이크 UI는 녹음 상태·미지원·권한 오류를 사용자에게 안내한다", () => {
  const chat = read("ai-company-app/src/components/Chat.tsx");
  const speech = read("ai-company-app/src/lib/speechRecognition.ts");
  assert.match(chat, /aria-pressed=\{speechModeEnabled\}/);
  assert.match(chat, /문장이 끝날 때마다 자동 전송하며 계속 듣습니다/);
  assert.match(chat, /disabled=\{!speechSupported \|\| isExpired\}/);
  assert.match(chat, /이 브라우저는 음성 입력을 지원하지 않습니다/);
  assert.match(chat, /<path d="M19 10v2a7 7 0 0 1-14 0v-2"/);
  assert.match(chat, /<rect x="9" y="2" width="6" height="13" rx="3"/);
  assert.match(speech, /마이크 권한이 차단되었습니다/);
  assert.match(speech, /사용할 수 있는 마이크를 찾지 못했습니다/);
});
