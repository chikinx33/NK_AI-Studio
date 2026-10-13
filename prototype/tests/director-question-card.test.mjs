import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('디렉터 버튼 질문 카드: 선택지·건너뛰기·직접 입력·취소를 그리고 답을 서버로 돌려준다', () => {
  const card = read('ai-company-app/src/components/DirectorQuestionCard.tsx');
  for (const label of ['건너뛰기', '직접 입력(선택)', '답하기', '취소', '권장']) assert.ok(card.includes(label), label);
  // 질문 하나·단일 선택이면 누르는 즉시 보낸다.
  assert.ok(card.includes('const instant = questions.length === 1 && !questions[0].multiSelect;'));
  // 한글 IME: Enter 는 keyup + isComposing 확인.
  assert.ok(card.includes('isComposing'));
  const ws = read('ai-company-app/src/components/DirectorWorkspace.tsx');
  assert.ok(ws.includes('case "question":'));
  assert.ok(ws.includes('case "question_answered":'));
  assert.ok(ws.includes('await answerDirectorQuestion(sessionId, q.eventId, answers, cancelled);'));
  // 질문이 열린 채 채팅을 보내면 그 질문을 닫는다(세션이 답을 기다리는 중).
  assert.ok(ws.includes('await sendDirectorMessage(sessionId, body, images, open);'));
});

test('디렉터: ask_user 는 화면이 실행하는 custom tool 이고, 지침은 결정을 버튼으로 묻게 한다', () => {
  const setup = read('director/scripts/setup.ts');
  assert.ok(setup.includes('type: "custom",') && setup.includes('name: "ask_user",'));
  const system = read('director/agent/system.md');
  assert.ok(system.includes('ask_user 도구로 묻는다'));
  const server = read('director/src/server.ts');
  assert.ok(server.includes('(stream|messages|confirm|answer|interrupt)$/'));
});
