# 견적서 문서 엔진 설계서 (P0) — ⚠️ 폐기(v1.0)

> **이 문서는 폐기됐다. 참조하지 말 것.**
> 후속: [form_document_engine_design_v2_20260812.md](form_document_engine_design_v2_20260812.md) (v2.0)
> 무엇이 바뀌었는지는 v2 문서 §0.1. 코드도 v2 기준으로 옮겨졌다
> (`_quote-math.ts` → `_form-calc.ts`, `quote` 도구 → `form_list`·`form_fill`).

> 문서 버전: 1.0 · 기준일: 2026-08-12
> 적용 대상: RAVIOK AI 회사 (`prototype/functions/api/agent/`, `ai-company-app/`)
> SSOT: 이 문서. 구현 중 판단이 갈리면 이 문서를 고치고 나서 코드를 고친다.

## 0. 결정 사항 (사용자 확정)

| 항목 | 결정 |
| --- | --- |
| P0 범위 | **견적서 1종**만. 계약서·명세서·인보이스는 P1 이후 |
| 출력 형식 | **PDF + XLSX 둘 다.** 사용자가 버튼으로 선택 |
| 엑셀 입력 | **P0에 포함.** 첨부한 xlsx/csv를 읽고 근거로 사용 |
| 단가 출처 | **매번 사용자가 지정.** 단가표 마스터데이터 없음 |

가장 중요한 파생 규칙 하나: **단가를 사용자가 매번 준다는 것은, 에이전트가 단가를 지어내면 그 즉시 제품이 망가진다는 뜻이다.** 아래 §3의 `null` 처리와 §6의 export 차단은 타협 대상이 아니다.

---

## 1. 현재 상태와 격차 (재감사 결과)

| # | 항목 | 현재 | P0 조치 |
| --- | --- | --- | --- |
| 1 | 문서 데이터 구조 | `{heading, content}` 줄글만 (`generate-doc.ts` PDF_SYSTEM) | `quote/v1` 스키마 신설 |
| 2 | 금액 계산 | LLM이 텍스트로 계산, 검산 없음 | 계산 전담 코드 `quoteMath`, LLM은 계산 금지 |
| 3 | 엑셀 입력 | 첨부 MIME 차단 (`Chat.tsx:356`) | 클라이언트 파싱 → 텍스트화 |
| 4 | 회사 파일의 xlsx·pdf 읽기 | 텍스트류만 통과 (`company-files.ts:308`) | P0 범위 밖 (첨부 경로로 대체) |
| 5 | XLSX 산출 | 없음. `company_files_write`는 텍스트 1MB만 | 클라이언트 SheetJS 생성 |
| 6 | PDF 산출 | 브라우저 프린트, 줄글 템플릿 | A4 견적서 템플릿으로 교체 |
| 7 | 첨부 전파 | 첫 응답 에이전트만 (`_orchestrator.ts:1233, 1566`) | 그 턴의 모든 에이전트에 전달 |
| 8 | 공급자 정보 | 없음 | `_회사정보/견적서-공급자.json` (텍스트 JSON) |

---

## 2. 데이터 스키마 `quote/v1` (SSOT)

에이전트가 만드는 것은 **이 JSON 하나**다. PDF도 XLSX도 채팅 미리보기도 전부 이 JSON에서 파생된다. 화면별로 다른 구조를 만들지 않는다.

```jsonc
{
  "schema": "quote/v1",
  "docNo": "Q-20260812-001",        // 서버 생성. 형식 Q-YYYYMMDD-NNN
  "issuedAt": "2026-08-12",          // 서버 생성(Asia/Seoul)
  "validUntil": "2026-09-11",        // 기본 발행일+30일
  "title": "브랜드 영상 제작 견적서",

  "supplier": {                      // 공급자 = NK. 저장소에서 로드
    "name": "", "bizNo": "", "ceo": "", "address": "",
    "tel": "", "email": "", "stampUrl": ""
  },
  "client": {                        // 공급받는자
    "company": "", "person": "", "title": "",
    "tel": "", "email": "", "address": ""
  },

  "currency": "KRW",
  "items": [
    {
      "no": 1,
      "name": "메인 영상 기획·연출",   // 필수
      "spec": "60초 / 1편",           // 규격·비고. 선택
      "qty": 1,                       // 필수. 숫자
      "unit": "식",                   // 단위. 기본 "식"
      "unitPrice": 3000000,           // 필수. ★없으면 null (지어내기 금지)
      "note": ""
    }
  ],

  "discount": { "type": "amount", "value": 0, "label": "" },  // type: amount | percent
  "vat":      { "mode": "exclusive", "rate": 0.1 },           // exclusive | inclusive | exempt
  "rounding": { "unit": 1, "mode": "floor" },                 // 총액 원단위 절사. unit: 1|10|100|1000

  "terms": [                          // 거래 조건. 기본값 §5
    "본 견적서의 유효기간은 발행일로부터 30일입니다."
  ],
  "notes": "",

  "totals": null,                     // ★모델이 절대 채우지 않는다. 계산엔진이 채운다
  "missing": []                       // ★계산엔진이 채운다. 비어있지 않으면 export 차단
}
```

### 2.1 모델이 채우는 필드 / 코드가 채우는 필드

| 코드만 채움 (모델이 쓰면 무시하고 덮어씀) | 모델이 채움 |
| --- | --- |
| `docNo`, `issuedAt`, `totals`, `missing`, `items[].no` | `title`, `client`, `items[]`(name/spec/qty/unit/unitPrice/note), `discount`, `vat`, `rounding`, `terms`, `notes`, `validUntil` |
| `supplier` (저장소에서 로드) | — |

이유: 금액과 문서번호는 LLM이 만들면 재현되지 않는다. 서버가 모델 출력에서 `totals`·`docNo`·`issuedAt`·`missing` 키를 **무조건 삭제한 뒤** 자기가 계산해 넣는다.

---

## 3. 계산 엔진 `quoteMath` (서버 단독 SSOT)

**위치: `prototype/functions/api/agent/_quote-math.ts` (신규). 서버에서만 계산한다. 클라이언트는 계산하지 않고 서버가 준 `totals`를 표시만 한다.** PDF·XLSX·채팅 미리보기의 금액이 갈라지는 사고를 원천 차단하기 위해서다.

### 3.1 순서 (이 순서를 바꾸지 말 것)

```
1. line.amount   = round(qty × unitPrice)        // 항목별
2. subtotal      = Σ line.amount
3. discountAmount= type==="percent" ? round(subtotal × value / 100) : value
                   단, 0 ≤ discountAmount ≤ subtotal 로 clamp
4. taxBase       = subtotal − discountAmount
5. vat 분기
   exclusive : vatAmount = round(taxBase × rate)
               supplyAmount = taxBase
               grandTotalRaw = taxBase + vatAmount
   inclusive : supplyAmount = round(taxBase / (1 + rate))
               vatAmount    = taxBase − supplyAmount
               grandTotalRaw = taxBase
   exempt    : vatAmount = 0
               supplyAmount = taxBase
               grandTotalRaw = taxBase
6. grandTotal    = floor(grandTotalRaw / rounding.unit) × rounding.unit
7. roundingAdj   = grandTotal − grandTotalRaw        // 음수 또는 0
```

### 3.2 규칙

- **모든 금액은 정수 원.** 부동소수 누적 금지. `round`는 `Math.round` 하나만 쓰고 다른 반올림 함수를 만들지 않는다.
- `roundingAdj !== 0`이면 문서에 **'단수조정' 행을 반드시 표시**한다. 조용히 깎지 않는다.
- `qty`가 소수(0.5식 등)여도 `line.amount`는 정수로 반올림한다.
- `currency`는 P0에서 `KRW` 고정. 다른 값이 오면 에러.

### 3.3 `totals` 출력

```jsonc
"totals": {
  "lineAmounts": [3000000, 500000],
  "subtotal": 3500000,
  "discountAmount": 0,
  "taxBase": 3500000,
  "supplyAmount": 3500000,
  "vatAmount": 350000,
  "roundingAdj": 0,
  "grandTotal": 3850000,
  "grandTotalKo": "금삼백팔십오만원정"   // 한글 금액. 위변조 방지용 관행
}
```

### 3.4 `missing` — 단가 지어내기 방지 장치

계산 전에 검사한다.

```
items[i].name    비어있음        → missing.push({ index:i, field:"name" })
items[i].qty     null/NaN/음수   → missing.push({ index:i, field:"qty" })
items[i].unitPrice null/NaN/음수 → missing.push({ index:i, field:"unitPrice" })
client.company   비어있음        → missing.push({ field:"client.company" })
supplier.name    비어있음        → missing.push({ field:"supplier.name" })
```

`missing.length > 0`이면:
- `totals`는 **부분 계산까지만** 채우고 `grandTotal: null`로 둔다 (미리보기는 보여주되 금액은 `—`).
- 도구 결과에 `status: "needs_input"`을 실어 반환.
- 프론트는 **PDF·XLSX 다운로드 버튼을 비활성화**한다.
- 에이전트는 부족한 값을 **한 번에 모아서** 질문한다. 항목마다 따로 묻지 않는다.

---

## 4. 에이전트 도구 `quote`

[[raviok-agent-tool-pattern]]의 3곳 수정 패턴을 그대로 따른다.

### 4.1 `_shared.ts` — `runQuoteTool`

```
담당: ink(잉크)  ·  공유: core, edge
kind: "external"   (gate 없음 — 파일 생성은 사용자가 다운로드 버튼을 눌러야 일어남)
```

동작 순서:
1. `input.prompt` + `input.context` + (있으면) `input.baseQuote`(재작성용)를 받는다.
2. 공급자 정보 로드: `/api/agent/company-files?path=_회사정보/견적서-공급자.json&read=1`. 없으면 `supplier`를 빈 값으로 두고 `missing`에 올린다. (에이전트가 사용자에게 물어 `company_files_write`로 저장 → 다음부터 자동)
3. `callClaudeForJson(env, QUOTE_SYSTEM, userMsg)` 로 `quote/v1` JSON 생성.
4. **모델 출력에서 `totals`·`missing`·`docNo`·`issuedAt`·`supplier` 키를 삭제**하고 서버 값으로 대체.
5. `computeQuoteTotals()` 실행 → `totals`, `missing` 주입.
6. 반환: `{ kind: "quote", status: "ready" | "needs_input", quote: {...} }`

### 4.2 `QUOTE_SYSTEM` 프롬프트 핵심 지시

```
- 출력은 quote/v1 JSON만. 마크다운 코드블록 금지.
- ★단가(unitPrice)와 수량(qty)은 사용자가 말했거나 첨부 자료에 적힌 값만 쓴다.
  모르면 반드시 null 로 둔다. 시세·경험·유사 사례로 추정하지 않는다.
  "대략" "보통" 같은 근거로 숫자를 넣는 것을 금지한다.
- ★totals, docNo, issuedAt 은 절대 쓰지 않는다(서버가 계산).
- 금액 합계를 문장으로도 쓰지 않는다.
- 항목명은 고객이 읽고 무엇인지 알 수 있게 구체적으로. "기타" "일체" 같은 뭉뚱그린 항목 금지.
- vat.mode 는 사용자가 '부가세 포함'이라 하면 inclusive, '별도'면 exclusive, 면세 사업이면 exempt. 언급 없으면 exclusive.
- 한국어로 작성.
```

### 4.3 `AGENT_TOOLS` 등록 (`_shared.ts` 레지스트리)

```ts
quote: { agentId: "ink", agentIds: ["core", "edge"], kind: "external", run: runQuoteTool },
```

### 4.4 `_orchestrator.ts`

- `MY_TOOL_DESCRIPTIONS`:
  ```
  quote: `[[RUN: quote | {"prompt": "견적 대상·항목·수량·단가·고객사를 사용자가 말한 그대로", "context": "첨부 자료 등 참고 맥락(선택)"}]]  → 견적서 생성. 표·소계·부가세·총액이 들어간 정식 서식으로 만들고 PDF·엑셀로 내려받게 한다. 단가나 수량을 사용자가 말하지 않았으면 임의로 넣지 말고 null로 두면 시스템이 되물어 준다.`
  ```
- `TOOL_LABELS`: `quote: "견적서 작성"`

---

## 5. 기본 거래 조건 (`terms` 기본값)

사용자가 따로 말하지 않으면 이 5개를 넣는다. 문구를 임의로 바꾸지 않는다.

```
1. 본 견적서의 유효기간은 발행일로부터 30일입니다.
2. 상기 금액은 부가가치세 별도 금액입니다.        // vat.mode 에 따라 자동 치환
3. 대금 지급 조건은 계약 체결 시 50%, 납품 완료 시 50%입니다.
4. 작업 범위 변경 시 별도 협의 후 견적을 재산정합니다.
5. 본 견적에 명시되지 않은 항목은 포함되지 않습니다.
```

2번은 `vat.mode`에 따라: `exclusive` → "부가가치세 별도", `inclusive` → "부가가치세 포함", `exempt` → "면세 대상 거래".

---

## 6. 산출 렌더러 (클라이언트)

### 6.1 공통 차단 규칙

`quote.missing.length > 0` 이면 PDF·XLSX 함수는 **즉시 return하고 아무 파일도 만들지 않는다.** 버튼도 비활성 상태여야 한다. 이중 방어.

### 6.2 PDF — `ai-company-app/src/lib/quoteRender.ts` → `downloadQuotePdf(quote)`

기존 `downloadPdfViaPrint`의 프린트 방식은 유지하되 템플릿을 교체한다.

레이아웃 (A4 세로, 여백 15mm):
```
┌──────────────────────────────────────────────┐
│  견 적 서                    No. Q-20260812-001│
│                              발행일 2026-08-12 │
├─────────────────────┬────────────────────────┤
│ 공급받는자           │ 공급자                  │
│ (주)고객사 귀중       │ 상호/사업자번호/대표    │
│ 담당 홍길동 부장      │ 주소/전화/이메일  [인]  │
├─────────────────────┴────────────────────────┤
│  아래와 같이 견적합니다.                       │
│  합계금액  금삼백팔십오만원정  (₩3,850,000)     │  ← 굵게, 테두리 강조
├──┬──────────┬──────┬───┬──┬────────┬────────┤
│No│  품목     │ 규격  │수량│단위│  단가  │  금액  │
├──┼──────────┼──────┼───┼──┼────────┼────────┤
│ 1│…         │…     │ 1 │식│3,000,000│3,000,000│
├──┴──────────┴──────┴───┴──┴────────┴────────┤
│                        소계        3,500,000 │
│                        할인               0  │
│                        부가세        350,000 │
│                        단수조정           0  │  ← roundingAdj≠0일 때만
│                        합계        3,850,000 │  ← 강조
├──────────────────────────────────────────────┤
│ 거래 조건                                     │
│ 1. …                                          │
└──────────────────────────────────────────────┘
```

- 폰트: `Noto Sans KR` (기존 docgen.ts와 동일한 구글폰트 import 유지)
- 금액은 우측 정렬 + 천단위 콤마. `toLocaleString("ko-KR")`
- **항목이 많아 2페이지 이상이 되면 표 헤더를 매 페이지 반복**한다 (`<thead>` + `thead {display: table-header-group}`)
- 합계 블록과 거래 조건은 페이지 중간에서 잘리지 않게 `break-inside: avoid`
- `supplier.stampUrl`이 있으면 공급자 블록 우측에 도장 이미지 겹쳐 배치 (없으면 `(인)` 텍스트)
- 품명이 길면 줄바꿈 허용(`word-break: keep-all`), 잘라내지 않는다
- 하단 우측에 페이지 번호

### 6.3 XLSX — `downloadQuoteXlsx(quote)`

SheetJS(`xlsx`)로 생성. **고객이 열어서 수정할 수 있어야 하므로 셀에 실제 수식을 넣는다.**

- 항목 행 금액: `{ f: "D{r}*F{r}", v: totals.lineAmounts[i] }` — 수식과 서버 계산값을 **함께** 저장. 엑셀이 열릴 때 수식으로 재계산되고, 계산 안 하는 뷰어에서는 캐시된 서버 값이 보인다.
- 소계 `=SUM(G시작:G끝)`, 부가세 `=ROUND(taxBase*0.1,0)`, 합계 `=소계-할인+부가세`
- 시트명 `견적서`. 열 너비 지정, 금액 열 서식 `#,##0`
- 상단 공급자/공급받는자 블록과 하단 거래 조건은 병합 셀로 PDF와 동일한 정보를 담는다
- **PDF와 XLSX의 합계는 반드시 같은 `totals.grandTotal`에서 나온다.** XLSX가 수식으로 다른 값을 내면 그건 계산엔진 버그이므로 §9의 검증에서 잡는다

### 6.4 UI 연결

- `Results.tsx`, `ChatFileAttachments.tsx`에 `kind === "quote"` 분기 추가
- 미리보기: 채팅 안에서 §6.2와 같은 표 형태로 렌더 (기존 ppt/pdf 미리보기 자리)
- 버튼 2개: `PDF 내려받기` · `엑셀 내려받기`. `status === "needs_input"`이면 둘 다 비활성 + "단가가 비어 있어요" 안내

---

## 7. 엑셀·CSV 입력 파서 (P0)

### 7.1 방식

Claude API는 xlsx 바이너리를 읽지 못한다. 따라서 **클라이언트에서 파싱해 텍스트로 바꾼 뒤 메시지 본문에 넣는다.** 서버 변경이 필요 없고, 텍스트가 되므로 §8의 첨부 전파 문제도 자동으로 해결된다.

### 7.2 `ai-company-app/src/lib/xlsxImport.ts` (신규)

```
입력: File (.xlsx | .xls | .csv | .tsv)
출력: string  (메시지 본문에 덧붙일 텍스트 블록)
```

형식:
```
[첨부파일: 2026 단가표.xlsx]
--- 시트: 영상제작 (32행 × 5열) ---
품목 | 규격 | 단위 | 단가 | 비고
메인 영상 기획·연출 | 60초 | 식 | 3000000 |
...
--- 시트 끝 ---
```

- 셀 구분자 ` | `, 빈 셀은 공백
- 상한: **시트당 200행 × 40열**, 파일 전체 60,000자
- 상한 초과 시 잘라내고 마지막 줄에 `※ 이후 N행 생략됨 — 필요한 범위를 알려주시면 그 부분만 다시 읽을게요.` 를 **반드시 표시**한다. 조용한 절단 금지
- 숫자 셀은 서식 없는 원시값으로 (`3000000`, `3,000,000원` 아님)
- 시트가 여러 개면 전부 포함하되 상한 안에서

### 7.3 `Chat.tsx` 수정

- `ALLOWED_MIME`에 추가:
  `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel`, `text/csv`, `text/tab-separated-values`
  (일부 브라우저는 xlsx의 `file.type`을 빈 문자열로 준다 → **확장자로도 판정**하는 폴백 필요)
- 스프레드시트는 `attachments`(base64) 배열에 넣지 **않는다.** `xlsxImport`로 텍스트화해서 별도 `sheetTexts` 상태에 담고, 전송 시 `message` 본문 끝에 이어붙인다.
- 첨부 칩 UI에는 표 아이콘 + 파일명 + `N행 읽음` 표시
- `accept` 속성도 함께 갱신

---

## 8. 첨부 전파 수정 (`_orchestrator.ts`)

현재 `images`가 그 턴의 **첫 발언 에이전트에게만** 전달된다(`:1566`). 코어가 먼저 답하고 잉크에게 견적서를 넘기면 **잉크는 첨부 PDF를 보지 못한 채 견적서를 쓴다.**

조치: `speak()` 호출 시 `images: deps.images`를 그 턴에 발언하는 **모든 에이전트**에게 전달한다. (엑셀은 §7로 이미 본문 텍스트라 전파됨. PDF만 해당)

- 상한: 첨부 10개 유지. 턴당 발언자 수만큼 토큰이 늘어나므로, 발언자가 4명을 넘으면 첫 4명까지만 전달하고 이후 발언자는 앞선 발언 기록(텍스트)으로 맥락을 받는다.

---

## 9. 완료 검증 기준

구현 완료로 보려면 아래가 **전부** 통과해야 한다.

| # | 검증 | 기대 |
| --- | --- | --- |
| 1 | 단가를 말하지 않고 "견적서 만들어줘" | 숫자를 지어내지 않고 부족한 값을 **한 번에 모아** 되물음. 다운로드 버튼 비활성 |
| 2 | 항목 2개·부가세 별도 | PDF 합계 = XLSX 합계 = 채팅 미리보기 합계, 3곳 동일 |
| 3 | 부가세 포함(inclusive) | 공급가액 + 부가세 = 총액, 총액은 사용자가 말한 금액 그대로 |
| 4 | 면세(exempt) | 부가세 0, 거래조건 2번 문구가 "면세 대상 거래"로 바뀜 |
| 5 | 할인 10% | subtotal 기준으로 계산, 총액에 반영 |
| 6 | 원단위 절사(unit=1000) | '단수조정' 행이 문서에 보임 |
| 7 | 항목 60개 | PDF 2페이지 이상, **매 페이지 표 헤더 반복**, 합계 블록 안 잘림 |
| 8 | 품명 40자 장문 | 줄바꿈되고 잘리지 않음 |
| 9 | xlsx 첨부(300행) | 200행까지 읽고 "이후 100행 생략" 고지 표시 |
| 10 | csv 첨부 | 동일하게 동작 |
| 11 | PDF 첨부 후 코어→잉크 위임 | 잉크가 첨부 내용을 반영 (§8) |
| 12 | 공급자 정보 최초 1회 입력 | `_회사정보/견적서-공급자.json`에 저장되고 다음 견적서에 자동 반영 |
| 13 | XLSX를 엑셀에서 열어 수량 변경 | 수식이 살아 있어 합계가 재계산됨 |
| 14 | 같은 지시 2회 실행 | 항목·금액이 동일 (문서번호·발행일만 다름) |

---

## 10. 범위 밖 (P0에서 하지 않는다)

- 계약서·거래명세서·인보이스·발주서 → P1
- 단가표 마스터데이터 저장·자동 조회 → 사용자 결정에 따라 하지 않음
- 회사 파일에 올린 xlsx·pdf를 에이전트가 직접 읽기 (`company-files.ts:308` 확장) → P1
- DOCX 출력
- 서버측 PDF/XLSX 생성 (Cloudflare Workers에서 바이너리 생성) → 클라이언트 생성으로 충분
- 견적서 발송(메일) 자동화 → `gmail_send` 기존 도구로 사용자가 별도 지시
- 견적 이력 관리·버전 비교

---

## 11. 파일별 작업 목록

**신규**
- `prototype/functions/api/agent/_quote-math.ts` — 계산 엔진 (§3)
- `ai-company-app/src/lib/quoteRender.ts` — PDF·XLSX 렌더러 (§6)
- `ai-company-app/src/lib/xlsxImport.ts` — 엑셀 입력 파서 (§7)

**수정**
- `prototype/functions/api/agent/_shared.ts` — `QUOTE_SYSTEM`, `runQuoteTool`, `AGENT_TOOLS` 등록
- `prototype/functions/api/agent/_orchestrator.ts` — `MY_TOOL_DESCRIPTIONS`, `TOOL_LABELS`, 첨부 전파 (§8)
- `ai-company-app/src/components/Chat.tsx` — MIME 확장 + 스프레드시트 분기 (§7.3)
- `ai-company-app/src/components/Results.tsx` — `kind==="quote"` 분기
- `ai-company-app/src/components/ChatFileAttachments.tsx` — `kind==="quote"` 미리보기·버튼
- `ai-company-app/src/lib/api.ts` — `quote`를 결과 아이템으로 인식 (`:1307, 1434`)
- `ai-company-app/package.json` — `xlsx`(SheetJS) 추가

**손대지 않음**
- `generate-doc.ts`, `docgen.ts`의 기존 ppt/pdf 경로 (그대로 둔다)
