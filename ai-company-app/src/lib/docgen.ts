// ai-company-app/src/lib/docgen.ts
// 클라이언트 사이드 문서 생성.
// PPT: pptxgenjs → .pptx 직접 다운로드 (PowerPoint가 한글 렌더링 담당)
// PDF: 스타일 HTML → 브라우저 프린트 → PDF 저장 (브라우저가 한글 렌더링 담당)
import pptxgen from "pptxgenjs";

export interface PptSlide {
  title: string;
  bullets?: string[];
  notes?: string;
}

export interface PdfSection {
  heading: string;
  content: string;
}

// ── PPT 생성 ──────────────────────────────────────────────────────────────────

const BRAND_DARK = "1a1a2e";
const BRAND_ACCENT = "4f8ef7";
const TEXT_DARK = "1a1a1a";
const TEXT_MID = "555555";

export async function downloadPpt(title: string, slides: PptSlide[]) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE"; // 16:9 (33.867 x 19.05 cm)
  pptx.author = "NK Studio AI";
  pptx.subject = title;
  pptx.title = title;

  slides.forEach((slide, idx) => {
    const s = pptx.addSlide();

    if (idx === 0) {
      // ── 표지 ───────────────────────────────────────────────────────────────
      s.background = { color: BRAND_DARK };
      // 세로 중앙에 제목
      s.addText(slide.title || title, {
        x: 0.8, y: "30%", w: "85%", h: 2.4,
        fontSize: 40, bold: true, color: "ffffff",
        align: "center", valign: "middle",
      });
      // 하단 액센트 라인
      s.addShape(pptxgen.ShapeType.rect, {
        x: 3.5, y: 5.5, w: 6.8, h: 0.08,
        fill: { color: BRAND_ACCENT },
        line: { color: BRAND_ACCENT },
      });
      if (slide.bullets && slide.bullets.length > 0) {
        s.addText(slide.bullets.join("  ·  "), {
          x: 0.8, y: "62%", w: "85%", h: 0.7,
          fontSize: 16, color: "aaaacc", align: "center",
        });
      }
    } else {
      // ── 내용 슬라이드 ──────────────────────────────────────────────────────
      s.background = { color: "f8f9fc" };
      // 상단 타이틀 바
      s.addShape(pptxgen.ShapeType.rect, {
        x: 0, y: 0, w: "100%", h: 1.15,
        fill: { color: BRAND_DARK },
        line: { color: BRAND_DARK },
      });
      s.addText(slide.title, {
        x: 0.45, y: 0.18, w: "92%", h: 0.8,
        fontSize: 22, bold: true, color: "ffffff",
      });
      // 슬라이드 번호
      s.addText(`${idx}`, {
        x: 12.0, y: 0.2, w: 0.6, h: 0.7,
        fontSize: 13, color: "aaaacc", align: "right",
      });

      if (slide.bullets && slide.bullets.length > 0) {
        const bulletItems = slide.bullets.map((b) => ({
          text: b,
          options: { bullet: { type: "bullet" as const }, color: TEXT_DARK, fontSize: 18 },
        }));
        s.addText(bulletItems, {
          x: 0.6, y: 1.4, w: "90%", h: 5.1,
          valign: "top", lineSpacingMultiple: 1.5,
        });
      }

      if (slide.notes) {
        s.addNotes(slide.notes);
      }
    }
  });

  await pptx.writeFile({ fileName: `${sanitizeFileName(title)}.pptx` });
}

// ── PDF 생성 (브라우저 프린트 방식) ───────────────────────────────────────────

export function downloadPdfViaPrint(title: string, subtitle: string | undefined, sections: PdfSection[]) {
  const html = buildPdfHtml(title, subtitle, sections);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert("팝업이 차단되었어요. 팝업을 허용한 뒤 다시 시도해 주세요.");
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  // 폰트 로드 후 프린트
  setTimeout(() => win.print(), 800);
}

function buildPdfHtml(title: string, subtitle: string | undefined, sections: PdfSection[]): string {
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const sectionsHtml = sections
    .map(
      (s, i) => `
      <section>
        <h2><span class="num">${i + 1}.</span> ${esc(s.heading)}</h2>
        <p>${esc(s.content).replace(/\n/g, "<br>")}</p>
      </section>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    color: #1a1a1a; line-height: 1.8; padding: 48px 56px; max-width: 820px; margin: 0 auto;
    font-size: 14px;
  }
  header { border-bottom: 3px solid #1a1a2e; padding-bottom: 16px; margin-bottom: 36px; }
  header h1 { font-size: 26px; font-weight: 700; color: #1a1a2e; margin-bottom: 6px; }
  header .meta { font-size: 12px; color: #888; }
  section { margin-bottom: 32px; }
  h2 { font-size: 16px; font-weight: 700; color: #1a1a2e; margin-bottom: 10px; display: flex; align-items: baseline; gap: 6px; }
  h2 .num { color: #4f8ef7; font-size: 13px; }
  p { color: #333; }
  footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 12px; font-size: 11px; color: #aaa; text-align: right; }
  @page { margin: 18mm 20mm; }
  @media print {
    body { padding: 0; font-size: 13px; }
    header h1 { font-size: 22px; }
  }
</style>
</head>
<body>
  <header>
    <h1>${esc(title)}</h1>
    <div class="meta">${subtitle ? `${esc(subtitle)}  ·  ` : ""}${today}  ·  NK Studio AI</div>
  </header>
  ${sectionsHtml}
  <footer>NK Studio AI 생성 문서 — ${today}</footer>
</body>
</html>`;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(s: string): string {
  return String(s || "문서").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
}
