import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('디렉터 다음 메시지 제안: 답변 끝 <!--next:--> 를 본문에서 떼고 입력창 제안(Tab)으로 쓴다', () => {
  const lib = read('ai-company-app/src/lib/director.ts');
  assert.ok(lib.includes('export function splitSuggestion(text: string)'));
  assert.ok(lib.includes(String.raw`/<!--\s*next:\s*([\s\S]*?)-->/gi`));
  const ws = read('ai-company-app/src/components/DirectorWorkspace.tsx');
  // 본문은 제안 주석을 뗀 body 로 그린다(복사 버튼도 같은 body 를 쓴다).
  assert.ok(ws.includes('const body = splitSuggestion(it.text).body;'));
  assert.ok(ws.includes('<Markdown text={body} />'));
  assert.ok(ws.includes('e.key === "Tab" && !e.shiftKey && suggestion && !draft'));
  // 작업 중이거나 질문·승인 카드가 떠 있으면 제안하지 않는다.
  assert.ok(ws.includes('if (status === "running" || thinking || questions.length || approvals.length) return "";'));
  const system = read('director/agent/system.md');
  assert.ok(system.includes('`<!--next: 문장-->`'));
});
