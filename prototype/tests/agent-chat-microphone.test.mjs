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

test("마이크는 한 발화를 자동 종료하고 인식 문장을 즉시 전송한다", () => {
  const chat = read("ai-company-app/src/components/Chat.tsx");
  assert.match(chat, /recognition\.continuous = false/);
  assert.match(chat, /recognition\.interimResults = true/);
  assert.match(chat, /recognizedMessage = mergeSpeechDraft\(speechDraftBaseRef\.current, transcript\)/);
  assert.match(chat, /recognition\.onend = \(\) =>/);
  assert.match(chat, /onSendRef\.current\(text, currentAttachments\.length \? currentAttachments : undefined\)/);
  assert.match(chat, /!recognitionFailed && hasRecognizedSpeech && text && !busyRef\.current/);
  assert.doesNotMatch(chat, /음성.{0,20}확인/);
});

test("마이크 UI는 녹음 상태·미지원·권한 오류를 사용자에게 안내한다", () => {
  const chat = read("ai-company-app/src/components/Chat.tsx");
  const speech = read("ai-company-app/src/lib/speechRecognition.ts");
  assert.match(chat, /aria-pressed=\{speechListening\}/);
  assert.match(chat, /말씀을 마치면 자동으로 전송됩니다/);
  assert.match(chat, /이 브라우저는 음성 입력을 지원하지 않습니다/);
  assert.match(chat, /<path d="M19 10v2a7 7 0 0 1-14 0v-2"/);
  assert.match(chat, /<rect x="9" y="2" width="6" height="13" rx="3"/);
  assert.match(speech, /마이크 권한이 차단되었습니다/);
  assert.match(speech, /사용할 수 있는 마이크를 찾지 못했습니다/);
});
