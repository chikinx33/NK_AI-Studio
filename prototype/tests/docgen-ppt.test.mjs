// PPT 보안 의존성 갱신 후 실제 생성된 문서의 한글, 본문, 발표 메모를 검증합니다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { downloadPpt } from '../../ai-company-app/src/lib/docgen.ts';
const require = createRequire(new URL('../../ai-company-app/package.json', import.meta.url));
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');

test('PPT 생성: 한글 표지·내용·글머리 항목·발표 메모와 파일명 보존', async () => {
  let result;
  const original = pptxgen.prototype.writeFile;
  pptxgen.prototype.writeFile = async function(options) {
    result = { name: options.fileName, data: await this.write({ outputType: 'nodebuffer' }) };
  };
  try {
    await downloadPpt('보안 업데이트: 확인', [
      { title: '한글 표지', bullets: ['첫 항목'] },
      { title: '내용 슬라이드', bullets: ['항목 하나', '항목 둘'], notes: '한글 발표 메모' }
    ]);
    assert.equal(result.name, '보안 업데이트_ 확인.pptx');
    const zip = await JSZip.loadAsync(result.data);
    assert.equal(zip.file(/^ppt\/slides\/slide\d+\.xml$/).length, 2);
    const cover = await zip.file('ppt/slides/slide1.xml').async('string');
    const content = await zip.file('ppt/slides/slide2.xml').async('string');
    const notes = await zip.file('ppt/notesSlides/notesSlide2.xml').async('string');
    assert.match(cover, /한글 표지/);
    assert.match(content, /내용 슬라이드/);
    assert.match(content, /항목 하나/);
    assert.match(content, /항목 둘/);
    assert.match(notes, /한글 발표 메모/);
  } finally {
    pptxgen.prototype.writeFile = original;
  }
});
