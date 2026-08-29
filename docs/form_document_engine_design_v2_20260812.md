# 서식 문서 엔진 설계서 (P0: 견적서)

> 문서 버전: **2.0** (v1.0 전면 개정) · 기준일: 2026-08-12
> 적용 대상: RAVIOK AI 회사 (`prototype/functions/api/agent/`, `ai-company-app/`, 신규 Cloud Run 서비스)
> SSOT: 이 문서. 구현 중 판단이 갈리면 이 문서를 고치고 나서 코드를 고친다.

## 0. 확정 사항

| 항목 | 결정 |
| --- | --- |
| P0 서식 | **견적서 1종** (표준 양식). 이후 양식을 계속 추가해 회사 자산으로 축적 |
| 출력 형식 | **DOCX · XLSX · PDF** 3종. 사용자가 선택 |
| 생성 위치 | **Cloudflare Workers** (docxtemplater + 자체 HWPX 렌더러 + SheetJS) |
| PDF | **Cloud Run 변환기 신설** (LibreOffice, 상태 없음). DOCX → PDF |
| 한글(HWPX) | ~~P0부터 포함~~ → **2026-08-12 폐기** (§0.2) |
| 엑셀 입력 | P0 포함 (클라이언트 파싱 → 텍스트화) |
| 단가 출처 | **매번 사용자가 지정.** 단가표 마스터데이터 없음 |

### 0.2 HWPX(한글) 폐기 — 2026-08-12

P0에 넣었다가 **뺐다.** 결정 근거는 실제로 치른 비용이다.

- **쓸 수 있는 라이브러리가 없었다.** DOCX는 docxtemplater(MIT)로 100줄. HWPX는 렌더러와 XML 트리를 새로 짜야 했고 신규 서버 코드 1,901줄 중 583줄이 HWPX 전용이 됐다
- **템플릿을 세 번 다시 만들었다** — 서식 미지정, 글자 크기 단위 오류(900pt), borderFill 유실
- **설계자가 결과를 볼 수 없다.** DOCX·XLSX·PDF는 렌더해서 눈으로 확인하고 고치지만 한글은 사용자가 열어봐야 한다. 확인 루프가 반복되며 사용자 시간을 세 번 썼다

견적서는 거래처에 PDF·엑셀로 나간다. 한글이 실제로 필요한 곳은 **계약서·관공서 제출**이고, 그때는 [문체부 표준계약서](https://www.mcst.go.kr/site/s_data/generalData/dataList.jsp?pMenuCD=0405050000) hwp 원본에 태그만 심으면 되므로 **템플릿을 만들 필요 자체가 없다.** 지금 겪은 문제가 그때는 없다.

조치: `manifest.templates.hwpx = null`. `producibleFormats`가 템플릿 없는 포맷을 자동으로 제외하므로 사용자에게 노출되지 않는다. 렌더러 코드와 테스트는 삭제하되 git 이력에 남으므로, 한글이 다시 필요해지면 되살릴 수 있다.

이 문서의 §6.2(HWPX 렌더러)·§9.2(HWPX 태그 규칙)는 **비활성 참고 자료**다. 되살릴 때만 읽는다.

### 0.1 v1.0에서 무엇이 바뀌었나

| v1.0 | v2.0 | 이유 |
| --- | --- | --- |
| HTML을 코드가 직접 그려 PDF 생성 | **템플릿 파일(.docx/.hwpx)에 데이터 주입** | 서식 변경이 코드 수정이 되면 양식을 자산으로 쌓을 수 없다 |
| 견적서 전용 도구 `quote` | **범용 `form_list` / `form_fill`** | 양식을 계속 추가하려면 서식이 데이터여야 한다 |
| 클라이언트에서 파일 생성 | **Workers에서 생성 → GCS 저장** | 회사 파일·업무 탐색기에 자동 등록되고 메일 첨부가 가능해진다 |
| PDF = 브라우저 프린트 | **DOCX → Cloud Run 변환** | 포맷마다 생김새가 다르면 안 된다 |
| 출력 PDF·XLSX 2종 | **DOCX·HWPX·XLSX·PDF 4종** | 국내 계약·관공서는 HWP가 사실상 표준 |

---

## 1. 아키텍처 — 3계층

```
① 데이터            ② 서식 레지스트리          ③ 렌더러
─────────────      ────────────────────      ──────────────────────
quote/v1 JSON  →   _서식/견적서-표준/     →   DOCX  (docxtemplater, Workers)
(에이전트 생성)      manifest.json            HWPX  (자체 구현, Workers)
       ↓            template.docx            XLSX  (SheetJS, Workers)
계산 엔진           template.hwpx            PDF   (DOCX→Cloud Run 변환)
(서버 코드)         template.xlsx?                    ↓
       ↓                                       GCS 저장 → 회사 파일 등록
   totals 주입
```

**세 계층이 분리돼 있다는 게 이 설계의 전부다.** 새 양식을 추가할 때 ②만 늘어나고 ①③은 그대로다. 계산이 필요 없는 서식(계약서·공문·보고서)은 **코드 수정 0**으로 추가된다.

---

## 2. 서식 레지스트리 (자산화 구조) ★핵심

### 2.1 위치

회사 파일(GCS) 루트의 **`_서식/`** 폴더. 사용자가 파일 탐색기에서 직접 보고 템플릿을 올릴 수 있어야 한다. 이게 "회사 자산"의 실체다.

```
_서식/
  견적서-표준/
    manifest.json
    template.docx
    template.hwpx
  계약서-용역/        ← P1에서 폴더만 추가하면 동작
    manifest.json
    template.docx
    template.hwpx
```

### 2.2 `manifest.json`

```jsonc
{
  "formId": "quote-standard",
  "name": "견적서 (표준)",
  "category": "영업",
  "version": 1,
  "dataSchema": "quote/v1",        // §3
  "calculator": "quote-calc-v1",   // §4. 계산 없는 서식은 "none"
  "templates": {
    "docx": "template.docx",
    "hwpx": "template.hwpx",
    "xlsx": null                    // null이면 SheetJS 기본 표 생성
  },
  "pdfFrom": "docx",                // PDF를 어느 포맷에서 변환할지
  "outputName": "견적서_{client.company}_{issuedAt}",
  "repeaters": {                    // 반복 표 선언 (§4.5)
    "row":  { "source": "totals.rows",        "maxRows": 30 },
    "sum":  { "source": "totals.summaryRows", "maxRows": 6  },
    "info": { "source": "totals.infoRows",    "maxRows": 8  },
    "term": { "source": "totals.termRows",    "maxRows": 8  }
  },
  "description": "거래처 제출용 표준 견적서. 부가세 별도/포함/면세 지원."
}
```

### 2.3 새 양식 추가 절차 (사람이 하는 일)

1. 워드·한글에서 서식을 디자인하고 §9의 플레이스홀더 규칙대로 태그를 심는다
2. `_서식/<폴더>/`에 템플릿 파일과 `manifest.json`을 올린다
3. 끝. 배포도 코드 수정도 없다. 에이전트가 `form_list`로 즉시 인식한다

계산이 필요한 새 서식만 `calculator`를 코드에 추가한다.

---

## 3. 데이터 스키마 `quote/v1`

에이전트가 만드는 것은 **이 JSON 하나**다. DOCX·HWPX·XLSX·PDF 전부 여기서 파생된다. 포맷별로 다른 데이터를 만들지 않는다.

```jsonc
{
  "schema": "quote/v1",
  "docNo": "Q-20260812-001",        // 서버 생성. Q-YYYYMMDD-NNN
  "issuedAt": "2026-08-12",          // 서버 생성 (Asia/Seoul)
  "validUntil": "2026-09-11",        // 기본 발행일+30일
  "title": "브랜드 영상 제작 견적서",

  "supplier": {                      // 공급자 = NK. 저장소에서 로드
    "name": "", "bizNo": "", "ceo": "",
    "bizType": "",                   // 업태  ★조사로 추가
    "bizItem": "",                   // 종목  ★조사로 추가
    "address": "", "tel": "", "fax": "", "email": "",
    "manager": "", "managerTel": "", // 담당자(대표와 별개) ★조사로 추가
    "stampUrl": ""
  },
  "client": {
    "company": "", "person": "", "title": "",
    "tel": "", "email": "", "address": ""
  },
  "payment": {                       // ★조사로 추가 — 빠지면 고객이 입금을 못 한다
    "bank": "", "accountHolder": "", "accountNo": "",
    "terms": ""                      // 결제조건 문장
  },
  "delivery": {                      // ★조사로 추가
    "dueDate": "",                   // 납기일
    "place": ""                      // 납품장소
  },

  "currency": "KRW",
  "items": [
    {
      "group": "기획",                // 구간 분류. null 가능 ★조사로 추가
      "costType": "work",             // work | expense(실비) ★조사로 추가
      "name": "메인 영상 기획·연출",   // 필수
      "spec": "60초 / 1편",
      "qty": 1,                       // 필수
      "unit": "식",
      "unitPrice": 3000000,           // 필수. ★없으면 null (지어내기 금지)
      "note": ""
    }
  ],

  "discount": { "type": "amount", "value": 0, "label": "" },  // amount | percent
  "vat":      { "mode": "exclusive", "rate": 0.1 },           // exclusive | inclusive | exempt
  "rounding": { "unit": 1, "mode": "floor" },

  "terms": [],                        // 기본값 §5
  "notes": "",

  "totals": null,                     // ★모델이 절대 채우지 않는다
  "missing": []                       // ★계산엔진이 채운다. 비어있지 않으면 생성 차단
}
```

### 3.1 모델이 채우는 필드 / 코드가 채우는 필드

| 코드만 채움 (모델이 써도 삭제 후 덮어씀) | 모델이 채움 |
| --- | --- |
| `docNo`, `issuedAt`, `totals`, `missing`, `supplier`, `payment.bank/accountHolder/accountNo` | `title`, `client`, `items[]`, `discount`, `vat`, `rounding`, `terms`, `notes`, `validUntil`, `delivery`, `payment.terms` |

금액과 문서번호를 LLM이 만들면 재현되지 않는다. 계좌번호를 LLM이 만들면 **돈이 엉뚱한 곳으로 간다.** 서버가 모델 출력에서 해당 키를 **무조건 삭제한 뒤** 저장소 값으로 채운다.

### 3.2 조사 근거

견적서는 **법정 서식이 아니다.** 세금계산서(부가가치세법 제32조)·거래명세서와 달리 정해진 양식이 없고 거래 관행이 사실상의 표준이다. 위 필드는 아래 출처에서 공통으로 확인된 항목을 모은 것이다.

- 공급자에 **업태·종목**이 들어가는 것은 세금계산서 관행이 견적서로 이어진 것으로, 거의 모든 실무 양식에 있다
- **합계금액은 한글 + 아라비아숫자 병기**가 관행이다 (§4.3 `grandTotalText`)
- **결제정보(은행·예금주·계좌번호)** 와 **납기일·납품장소**는 '특이사항'란의 표준 구성이다
- `group`(구간 분류)과 `costType`(과업/실비)은 영상·디자인 제작 실무에서 나온 요구다. 구간을 나눠야 중도 취소 시 기청구 근거가 생기고, 실비(사진·유료폰트·출장비)를 분리하지 않으면 제작사가 떠안게 된다

---

## 4. 계산 엔진 `quote-calc-v1`

**위치: `prototype/functions/api/agent/_form-calc.ts` (신규). 서버에서만 계산한다.** 렌더러 4종은 서버가 준 `totals`를 표시만 한다. 포맷마다 계산하면 4개 파일의 금액이 갈라진다.

### 4.1 순서 (한 단계도 바꾸지 말 것)

```
1. line.amount    = round(qty × unitPrice)
2. subtotal       = Σ line.amount
3. discountAmount = type==="percent" ? round(subtotal × value / 100) : value
                    0 ≤ discountAmount ≤ subtotal 로 clamp
4. taxBase        = subtotal − discountAmount
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
6. grandTotal  = floor(grandTotalRaw / rounding.unit) × rounding.unit
7. roundingAdj = grandTotal − grandTotalRaw          // 0 또는 음수
8. rows 구성 (§4.5)
```

### 4.2 규칙

- **모든 금액은 정수 원.** 부동소수 누적 금지
- 반올림은 `Math.round` 하나만 쓴다. 다른 반올림 헬퍼를 만들지 않는다
- `roundingAdj !== 0`이면 문서에 **'단수조정' 행을 반드시 표시**한다. 조용히 깎지 않는다
- `qty`가 소수여도 `line.amount`는 정수로 반올림
- `currency`는 P0에서 `KRW` 고정

### 4.3 `totals` 출력

```jsonc
"totals": {
  "rows": [ /* §4.5 — 렌더러가 표에 그대로 뿌리는 행 배열 */ ],
  "lineAmounts": [3000000, 500000],
  "groupSubtotals": [{ "group": "기획", "amount": 1000000 }],
  "workAmount": 3500000,       // 과업비 합
  "expenseAmount": 0,          // 실비 합
  "subtotal": 3500000,
  "discountAmount": 0,
  "taxBase": 3500000,
  "supplyAmount": 3500000,
  "vatAmount": 350000,
  "roundingAdj": 0,
  "grandTotal": 3850000,
  "grandTotalKo": "일금 삼백팔십오만원정",
  "grandTotalText": "일금 삼백팔십오만원정 (₩3,850,000)"
}
```

`grandTotalText`(한글+숫자 병기)가 문서에 들어가는 값이다. 한글 금액 표기의 띄어쓰기는 관행이 갈리므로 **`일금 삼백팔십오만원정` 형태로 통일**한다. 국립국어원 공식 표기 확인은 자동 조회가 차단돼 하지 못했다 — 사용자가 다른 표기를 원하면 `grandTotalKo` 생성기 한 곳만 고치면 된다.

### 4.4 `missing` — 단가 지어내기 방지

계산 전에 검사한다.

```
items[i].name       비어있음        → { index:i, field:"name" }
items[i].qty        null/NaN/음수   → { index:i, field:"qty" }
items[i].unitPrice  null/NaN/음수   → { index:i, field:"unitPrice" }
client.company      비어있음        → { field:"client.company" }
supplier.name       비어있음        → { field:"supplier.name" }
totals.rows.length  maxRows 초과    → { field:"items", reason:"overflow" }
```

`payment`·`delivery`가 비어 있는 것은 `missing`이 아니다. 해당 줄을 문서에서 생략한다.

`missing.length > 0`이면:
- `totals`는 부분 계산까지만, `grandTotal: null`
- `status: "needs_input"` 반환
- **파일을 하나도 만들지 않는다.** 프론트는 다운로드 버튼 전부 비활성
- 에이전트는 부족한 값을 **한 번에 모아서** 질문한다. 항목마다 따로 묻지 않는다

### 4.5 `rows` 구성 — 렌더러를 단순하게 만드는 핵심

그룹 머리행·소계행·실비 구분을 **렌더러가 판단하지 않는다.** 계산 엔진이 완성된 행 배열을 만들어 주고, 렌더러 4종은 그걸 표에 그대로 뿌린다. 이 규칙 하나로 DOCX·HWPX·XLSX·PDF의 표 구조가 자동으로 같아진다.

행 하나의 형태 — **모든 값이 이미 포맷된 문자열**이다. 렌더러는 숫자를 만지지 않는다.

```jsonc
{
  "kind": "item",        // group | item | subtotal | expenseHead
  "no":   "1",
  "name": "메인 영상 기획·연출",
  "spec": "60초 / 1편",
  "qty":  "1",
  "unit": "식",
  "unitPrice": "3,000,000",
  "amount":    "3,000,000",
  "note": ""
}
```

구성 순서:

```
1. costType==="work" 항목을 group 등장 순서대로 묶는다
2. 그룹이 2개 이상이면 각 묶음 앞뒤에
     { kind:"group",    name:"■ 기획" }
     ...항목들...
     { kind:"subtotal", name:"소계", amount:"1,000,000" }
   그룹이 1개 이하이거나 전부 null이면 그룹행·소계행을 넣지 않는다
3. costType==="expense" 항목이 있으면 맨 뒤에
     { kind:"expenseHead", name:"■ 실비" }
     ...실비 항목들...
     { kind:"subtotal", name:"실비 소계", amount:"..." }
4. no 는 kind==="item" 에만 1부터 연번. 나머지 행은 빈 문자열
5. group·subtotal·expenseHead 행은 name 외의 칸을 빈 문자열로 둔다 (amount 제외)
```

**서식(굵게·음영)으로 행을 구분하지 않는다.** 템플릿의 모든 데이터 행은 같은 서식이고, 그룹행은 `■` 기호와 텍스트로 구분한다. 조건부 서식은 docxtemplater 기본 파서로 안전하게 다룰 수 없고, HWPX에서는 더 어렵다. 표현을 포기하고 안정성을 택한다.

### 4.6 집계·특이사항도 배열로 — 템플릿에 조건문을 두지 않는다

"할인이 0이면 할인 줄을 숨긴다", "계좌가 없으면 입금계좌 줄을 숨긴다" 같은 판단을 템플릿의 조건 태그로 처리하면 DOCX와 HWPX의 문법이 갈리고, HWPX에는 조건 태그가 아예 없다. **계산 엔진이 표시할 줄만 담은 배열을 만들어 준다.**

```jsonc
"totals": {
  "summaryRows": [                        // 값이 0이면 애초에 넣지 않는다
    { "label": "소계",      "amount": "3,500,000" },
    { "label": "부가세",    "amount": "350,000"   },
    { "label": "합계",      "amount": "3,850,000" }
    // 할인 0 → '할인' 줄 없음 / roundingAdj 0 → '단수조정' 줄 없음
  ],
  "infoRows": [                            // 빈 값은 넣지 않는다
    { "label": "유효기간",  "value": "2026-09-11 까지" },
    { "label": "납기일",    "value": "2026-09-30"      },
    { "label": "입금계좌",  "value": "국민은행 123-456-789 (예금주 ○○○)" }
    // delivery.place 비어있음 → '납품장소' 줄 없음
  ]
}
```

세 배열(`rows`·`summaryRows`·`infoRows`)은 manifest의 `repeaters`에 선언되고, 렌더러는 선언된 접두어(`{{row.` `{{sum.` `{{info.`)로 표를 찾아 채운다. **새 서식이 다른 반복 표를 필요로 하면 manifest에 한 줄 추가하면 된다** — 계약서의 조항 목록도 같은 방식이다.

---

## 5. 기본 거래 조건 (`terms` 기본값)

사용자가 따로 말하지 않으면 이 5개를 넣는다.

```
1. 본 견적서의 유효기간은 발행일로부터 30일입니다.
2. 상기 금액은 부가가치세 별도 금액입니다.        // vat.mode 에 따라 자동 치환
3. 대금 지급 조건은 계약 체결 시 50%, 납품 완료 시 50%입니다.
4. 작업 범위 변경 시 별도 협의 후 견적을 재산정합니다.
5. 본 견적에 명시되지 않은 항목은 포함되지 않습니다.
```

2번은 `vat.mode`에 따라: `exclusive` → "부가가치세 별도", `inclusive` → "부가가치세 포함", `exempt` → "면세 대상 거래".

---

## 6. 렌더러 4종

공통: **`missing.length > 0`이면 렌더러 진입 즉시 return.** 4곳 모두. 이중 방어.

### 6.0 값이 없는 선택 필드는 빈칸으로 채운다 — 포맷마다 다르면 안 된다

`missing`은 **필수 필드**(단가·수량·품명·고객사·공급자)만 본다. 선택 필드(`client.person`, `supplier.fax` 등)가 비어 있는 것은 결함이 아니라 정상이다. 그런데 렌더러 두 종의 동작이 갈리면 안 된다.

- DOCX는 `nullGetter: () => ""` 로 빈칸을 넣고 통과한다
- HWPX는 뷰에 **키 자체가 없으면** 치환하지 않고 남겨 두었다가 미치환 검사에서 실패한다

즉 **같은 데이터로 DOCX는 나오고 HWPX는 안 나온다.** `quote/v1`은 `runFormFillTool`의 정규화가 모든 키를 `""`로 채워 이 경로를 막지만, **manifest만 올려 추가한 서식에는 그 정규화가 없다.** "계산이 필요 없는 서식은 코드 수정 0"이라는 이 설계의 핵심 약속을 쓰는 순간 바로 만난다.

규칙: HWPX 렌더러는 미치환 태그를 두 부류로 나눈다.

- 뷰의 **최상위 키로 시작하는 경로**(`client.*`, `supplier.*`, `payment.*`, `totals.*` …) → **빈 문자열로 치환**. DOCX와 동일하게 관대하다
- 뷰에 **없는 접두어**로 시작하는 태그 → **실패**. 서식의 오타(`{{clinet.company}}`)는 계속 잡힌다

### 6.1 DOCX — `_render-docx.ts` (Workers)

- 라이브러리: **docxtemplater (MIT) + pizzip (MIT)**. 유료 모듈 사용 금지
- `_서식/<폴더>/template.docx`를 GCS에서 fetch → ArrayBuffer → PizZip → Docxtemplater
- **점 경로 해석기를 반드시 붙인다.** docxtemplater 기본 파서는 `{client.company}` 같은 점 경로를 해석하지 못해 전부 `undefined`가 된다 (실측 확인). 아래처럼 **속성 순회만 하는** 파서를 쓴다 — `eval`도 표현식 언어도 없다:
  ```js
  const dotParser = (tag) => ({ get(scope) {
    if (tag === ".") return scope;
    let cur = scope;
    for (const k of tag.split(".")) { if (cur == null) return ""; cur = cur[k]; }
    return cur ?? "";
  }});
  new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, parser: dotParser, nullGetter: () => "" });
  ```
- **`angular-expressions` 기반 파서는 쓰지 않는다** (템플릿 주입 위험). 위 점 경로 해석기로 충분하다
- 항목 표는 `{#totals.rows}` 행 반복 하나로 끝난다 (§4.5). 그룹·소계 판단을 템플릿에서 하지 않는다
- DOCX는 행 반복이 기본 지원되므로 `maxRows` 제한을 받지 않는다 (제한은 HWPX만)
- 출력: Uint8Array → GCS 업로드

### 6.2 HWPX — `_render-hwpx.ts` (Workers, 자체 구현)

HWPX(OWPML)는 DOCX와 같은 ZIP+XML 구조라 Workers에서 처리 가능하다. 검증된 라이브러리가 없어 직접 구현한다. 구조 참고는 **python-hwpx (Apache 2.0)** 를 읽어서 하되, 코드를 이식하지 않는다(Python→JS 이식은 라이선스 고지 의무가 생긴다).

라이브러리: **fflate (MIT)** 로 unzip/rezip.

처리 순서:
```
1. unzip → Contents/section0.xml (여러 개면 section*.xml 전부)
2. 텍스트 run 병합
   한글이 서식 경계에서 <hp:t>를 쪼개므로, 같은 <hp:run> 안의 인접 <hp:t>를
   하나로 합친 뒤 치환한다. ★이 단계를 빼면 {{client.company}}가
   {{client. / company}} 로 쪼개져 치환에 실패한다
3. 단순 필드 치환: {{client.company}} → 값
4. 항목 표 처리 (§6.2.1)
5. 남은 플레이스홀더 검사 (§6.2.2)
6. rezip. ★mimetype 파일은 압축하지 않고(STORED) 맨 앞에 둔다 — ZIP 규약
```

**이 알고리즘은 검증됐다.** `docs/hwpx_render_proto.py`(Python 프로토타입)가 표준 견적서 템플릿을 샘플 데이터로 채워 통과했다 — 남은 `{{` 0개, 표 4개의 `rowCnt`가 실제 행 수와 전부 일치, `mimetype` STORED 선두 유지, python-hwpx 재오픈 및 `validate()` 이슈 0건. **TypeScript 렌더러는 이 프로토타입을 그대로 옮기면 된다.** 행 삭제 후 `<hp:cellAddr rowAddr>` 재부여까지 프로토타입에 들어 있다.

한 가지 실측 사실: python-hwpx로 **생성한** 템플릿은 텍스트 run이 쪼개지지 않는다(0건). run 분할은 사람이 **한글에서 템플릿을 편집한 뒤**에 생긴다. 그래서 2단계(run 병합)는 생성 직후에는 무해하지만, 사용자가 서식을 손본 순간부터 필수가 된다 — 빼지 말 것.

#### 6.2.1 항목 표 — 고정 행 + 미사용 행 삭제

행 복제는 표 속성 갱신까지 얽혀 실패 위험이 크다. **템플릿에 데이터 행을 `maxRows`개 미리 만들어 두고, 안 쓴 행을 삭제한다.**

manifest의 `repeaters` 각각에 대해 같은 처리를 한다 (`row`·`sum`·`info`).

- 데이터 행 식별: 표(`<hp:tbl>`) 안에서 `{{<prefix>.` 를 포함한 `<hp:tr>`
- 위에서부터 i번째 데이터 행의 `{{row.name}}` → `totals.rows[i].name` 으로 치환
- `i >= 배열 길이` 인 행은 **`<hp:tr>` 노드째 삭제**
- 삭제 후 `<hp:tbl>` 의 `rowCnt` 속성을 실제 행 수로 갱신 (누락하면 한글이 파일을 거부한다)
- `totals.rows.length > maxRows` 이면 **에러로 중단.** 조용히 자르지 않는다.
  메시지: "항목이 많아 서식의 행 수(30)를 넘습니다. 서식의 행을 늘리거나 항목을 줄여 주세요."
- 그룹·소계행도 `rows`에 이미 들어 있으므로 렌더러는 `kind`를 볼 필요가 없다
- ★**데이터 행을 전부 지워 남은 `<hp:tr>`이 0개가 되면 `<hp:tbl>` 자체를 제거한다.**
  `rowCnt="0"` 인 빈 표를 남기면 **한컴오피스가 파일을 열지 못한다** — 2026-08-12 실측으로 확인했다.
  머리행이 있는 표(특이사항)는 머리행이 남으므로 이 경로를 타지 않는다. 머리행 없는 표(거래조건)만 해당된다.

#### 6.2.2 생성 후 자동 검증 (통과 못하면 실패 처리)

1. ZIP 무결성 — 다시 열어 엔트리 목록이 원본과 같은가
2. XML well-formed — 치환한 section*.xml 파싱 성공
3. **남은 플레이스홀더 0개** — 결과 XML에 `{{` 가 남아 있으면 실패
4. `rowCnt` 속성값 == 실제 `<hp:tr>` 개수

**한컴에서 실제로 열리는지는 사람이 최초 1회 확인한다.** 자동 검증만으로는 부족하다.

### 6.3 XLSX — `_render-xlsx.ts` (Workers)

- 라이브러리: **SheetJS (Apache 2.0, community edition)**
- `manifest.templates.xlsx`가 있으면 템플릿에 값 주입, 없으면 기본 표 생성
- 고객이 열어 수정할 수 있어야 하므로 **실제 엑셀 수식**을 넣는다
  - 항목 금액: `{ f: "D{r}*F{r}", v: totals.lineAmounts[i] }` — 수식 + 서버 계산값 캐시
  - 소계 `=SUM()`, 부가세, 합계도 수식 + 캐시
- 시트명 `견적서`, 금액 서식 `#,##0`, 열 너비 지정

### 6.4 PDF — Cloud Run 변환 서비스 (신규)

**`nk-doc-convert`** — 상태 없는 마이크로서비스. 문서를 만들지 않고 **변환만** 한다.

```
POST /convert
  Header: Authorization: Bearer <NK 내부 토큰>
  Body:   multipart 또는 raw bytes + ?from=docx
  Return: application/pdf bytes
```

- 베이스: LibreOffice headless. `soffice --headless --convert-to pdf --outdir /tmp <file>`
- 한글 폰트 설치 필수 (Noto Sans KR / 나눔). **폰트 빠지면 한글이 네모로 나온다**
- 동시성 1, 요청 타임아웃 60s, 최대 인스턴스 3
- 콜드스타트가 있으므로 Workers 쪽에서 첫 요청은 최대 90s 대기 허용, 실패 시 재시도 1회
- 배포 패턴은 기존 `openai-proxy`(Cloud Run)를 그대로 따른다
- **HWPX → PDF는 P0 범위 밖.** LibreOffice가 HWPX를 읽으려면 H2Orestart 확장이 필요한데 재현 품질을 보장할 수 없다. PDF는 `manifest.pdfFrom: "docx"` 경로만 쓴다. 사용자가 HWP 원본에서 PDF가 필요하면 한글에서 저장하도록 안내한다

---


### 6.5 UI — 상태가 다르면 카드도 달라야 한다

**사람이 카드를 보고 3초 안에 알아야 할 것 세 가지다.** ①지금 어떤 상태인가 ②내가 뭘 해야 하나 ③결과물을 어떻게 확인하나. 완료 카드 하나를 세 상태에 돌려쓰면 셋 다 답하지 못한다.

#### A. `needs_input` — 정보가 모자라 못 만듦

```
┌──────────────────────────────────┐
│ ⏸ 정보 필요           잉크 · 견적서(표준) │
│ 2D 애니메이션 제작 견적서              │
│                                  │
│ 이것만 알려주시면 이어서 만들어요:        │
│  · 고객사 이름                      │
│  · 우리 회사 정보 (공급자.json)        │
│                                  │
│ [ 이어서 만들기 ]              [ ✕ ] │
└──────────────────────────────────┘
```

- **다운로드 버튼을 그리지 않는다.** 비활성이 아니라 아예 없다. 없는 파일의 버튼은 "곧 생기나?"라는 오해만 만든다
- **`검토 승인`·`재검토`를 그리지 않는다.** 승인할 결과물이 없다. 승인 버튼이 보이는 순간 사용자는 "다 된 건가?"로 읽는다 — 이번 실사용에서 실제로 그렇게 읽혔다
- 부족한 항목은 문장이 아니라 **목록**으로. 문장은 훑어읽을 때 놓친다
- `이어서 만들기`는 채팅 입력창에 필요한 값을 묻는 문구를 채워 준다. 무엇을 어떻게 말해야 할지 고민하지 않게 한다
- 이 카드는 **'보고(검토 대기)' 목록에 두지 않는다.** 검토할 게 없다. 별도 묶음(`이어서 할 일`)으로 분리하거나 최소한 배지로 확실히 구분한다

#### B. `ready` — 완성

```
┌──────────────────────────────────┐
│ ✅ 작성 완료          잉크 · 견적서(표준) │
│ 2D 애니메이션 제작 견적서              │
│ (주)가나다 · 항목 3개                 │
│ 일금 일백일십만원정 (₩1,100,000)       │
│                                  │
│ [ 미리보기 ]   [ DOCX ]  [ XLSX ]    │
│ [ 업무 파일에 저장 ] [ 재작성 ]  [ ✕ ] │
└──────────────────────────────────┘
```

- **미리보기가 없으면 승인 버튼을 띄우지 않는다.** 내용을 보지 않고 누르는 승인은 견적서에서 위험하다 — 금액이 틀려도 그대로 거래처에 나간다
- 미리보기는 모달에 표로 렌더한다. **추가 계산이 필요 없다** — `totals.rows`·`summaryRows`·`infoRows`가 이미 완성된 문자열 배열이다(§4.5·§4.6). 그대로 표에 뿌리면 된다
- `검토 승인`은 이 맥락에서 무엇을 하는지 이름만으로 알 수 없다. 실제 동작은 "업무 파일의 그날 폴더에 등록"이므로 **버튼 아래 보조 문구로 그 사실을 적는다** (전역 라벨을 바꾸기 어렵다면 최소한 이것은 한다)

#### C. `error` — 실패

- 배지 `실패` + **실패 이유 원문**을 카드에도 표시(채팅과 같은 문구)
- `다시 시도` 버튼만. 승인·다운로드는 없다

#### 공통

- 상태 판정은 **서버가 준 `status` 하나로** 한다. 프론트가 `files.length` 같은 것으로 추측하지 않는다
- 같은 규칙을 채팅 말풍선(`ChatFileAttachments.tsx`)에도 적용한다. 두 화면이 다르게 보이면 안 된다

## 7. 에이전트 도구

[[raviok-agent-tool-pattern]]의 3곳 수정 패턴을 따른다. 담당은 **잉크(ink)**, 공유 **core·edge**.

### 7.1 `form_list` — 어떤 서식이 있는지

```
kind: "read", synthesize: true
[[RUN: form_list | {}]]
→ _서식/ 하위 폴더의 manifest.json을 모아 목록 반환
  { forms: [{ formId, name, category, description, formats: ["docx","hwpx","xlsx","pdf"] }] }
```

### 7.2 `form_fill` — 서식 채우기

```
kind: "external"  (gate 없음 — 파일 생성은 되돌리기 쉽고 회사 파일에만 저장된다)
[[RUN: form_fill | {"formId":"quote-standard", "formats":["docx","pdf"], "prompt":"…", "context":"…"}]]
```

동작 순서:
1. `_서식/<formId>/manifest.json` 로드. 없으면 `form_list`를 먼저 하라는 에러
2. 공급자 정보 로드: `_회사정보/공급자.json`. 없으면 `missing`에 올림
   (에이전트가 사용자에게 물어 `company_files_write`로 저장 → 다음부터 자동)
3. `manifest.dataSchema`에 맞는 시스템 프롬프트로 `callClaudeForJson` → 데이터 JSON
4. **모델 출력에서 `totals`·`missing`·`docNo`·`issuedAt`·`supplier` 키를 삭제**하고 서버 값으로 대체
5. `calculator`(=`quote-calc-v1`) 실행 → `totals`·`missing` 주입
6. `missing.length > 0` → `{ status:"needs_input", data, missing }` 반환하고 **여기서 종료**
7. 요청된 `formats` 각각을 렌더 → GCS `업무/<날짜>/<outputName>.<ext>` 에 저장
8. `company_work_items` 등록 → 업무 탐색기에 노출
9. 반환: `{ kind:"form", status:"ready", formId, data, files:[{format, path, signedUrl}] }`

### 7.3 시스템 프롬프트 핵심 지시 (`quote/v1`)

```
- 출력은 quote/v1 JSON만. 마크다운 코드블록 금지.
- ★단가(unitPrice)와 수량(qty)은 사용자가 말했거나 첨부 자료에 적힌 값만 쓴다.
  모르면 반드시 null 로 둔다. 시세·경험·유사 사례로 추정하지 않는다.
  "대략" "보통" 같은 근거로 숫자를 넣는 것을 금지한다.
- ★totals, docNo, issuedAt, supplier 는 절대 쓰지 않는다(서버가 채움).
- 금액 합계를 문장으로도 쓰지 않는다.
- 항목명은 고객이 읽고 무엇인지 알 수 있게 구체적으로. "기타" "일체" 같은 뭉뚱그린 항목 금지.
- vat.mode: 사용자가 '부가세 포함'이라 하면 inclusive, '별도'면 exclusive,
  면세 사업이면 exempt. 언급 없으면 exclusive.
- 한국어로 작성.
```

### 7.4 `_orchestrator.ts`

- `MY_TOOL_DESCRIPTIONS`:
  ```
  form_list: `[[RUN: form_list | {}]]  → 회사에 등록된 문서 서식 목록 조회. 사용자가 견적서·계약서 등 서식 작업을 요청하면 먼저 실행해 어떤 서식이 있는지 확인.`
  form_fill: `[[RUN: form_fill | {"formId":"서식 ID", "formats":["docx","pdf"], "prompt":"내용을 사용자가 말한 그대로", "context":"첨부 자료 등(선택)"}]]  → 서식에 내용을 채워 문서 파일 생성. formats는 docx·hwpx·xlsx·pdf 중 사용자가 원하는 것. 단가나 수량을 사용자가 말하지 않았으면 임의로 넣지 말 것 — 시스템이 되물어 준다.`
  ```
- `TOOL_LABELS`: `form_list: "서식 목록"`, `form_fill: "서식 작성"`

---

## 8. 엑셀·CSV 입력 파서

Claude API는 xlsx 바이너리를 읽지 못한다. **클라이언트에서 파싱해 텍스트로 바꿔 메시지 본문에 넣는다.** 텍스트가 되므로 §8.2의 첨부 전파 문제도 자동 해결된다.

### 8.1 `ai-company-app/src/lib/xlsxImport.ts` (신규)

```
입력: File (.xlsx | .xls | .csv | .tsv)
출력: string (메시지 본문에 덧붙일 텍스트)
```

```
[첨부파일: 2026 단가표.xlsx]
--- 시트: 영상제작 (32행 × 5열) ---
품목 | 규격 | 단위 | 단가 | 비고
메인 영상 기획·연출 | 60초 | 식 | 3000000 |
...
--- 시트 끝 ---
```

- 구분자 ` | `, 빈 셀은 공백
- 상한: **시트당 200행 × 40열**, 파일 전체 60,000자
- 초과 시 `※ 이후 N행 생략됨 — 필요한 범위를 알려주시면 그 부분만 다시 읽을게요.` 를 **반드시 표시**. 조용한 절단 금지
- 숫자 셀은 서식 없는 원시값 (`3000000`, `3,000,000원` 아님)

### 8.2 `Chat.tsx` 수정

- `ALLOWED_MIME`에 추가: `…spreadsheetml.sheet`, `application/vnd.ms-excel`, `text/csv`, `text/tab-separated-values`
- **일부 브라우저는 xlsx의 `file.type`을 빈 문자열로 준다 → 확장자로도 판정하는 폴백 필수**
- 스프레드시트는 `attachments`(base64)에 넣지 **않는다.** 텍스트화해서 `message` 본문 끝에 이어붙인다
- 첨부 칩에 표 아이콘 + 파일명 + `N행 읽음`
- `accept` 속성도 갱신

### 8.3 첨부 전파 수정 (`_orchestrator.ts`)

현재 `images`가 그 턴 **첫 발언 에이전트에게만** 전달된다(`:1233` 주석, `:1566`). 코어가 먼저 답하고 잉크에게 넘기면 **잉크는 첨부 PDF를 못 본 채 견적서를 쓴다.**

→ 그 턴에 발언하는 **모든 에이전트**에게 전달. 단 발언자가 4명을 넘으면 첫 4명까지만(토큰 상한), 이후는 앞선 발언 기록으로 맥락 확보.

---

## 9. 템플릿 작성 규칙 (사람이 지켜야 할 것) ★

서식 파일을 만드는 사람이 이걸 어기면 렌더러가 실패한다.

### 9.1 DOCX (워드)

| 대상 | 태그 |
| --- | --- |
| 단순 값 | `{client.company}` `{docNo}` `{supplier.bizType}` `{payment.accountNo}` |
| 합계 강조 | `{totals.grandTotalText}` |
| 항목 표 | 표의 데이터 **행 안에** `{#totals.rows}` … `{/totals.rows}`, 셀에 `{no}` `{name}` `{spec}` `{qty}` `{unit}` `{unitPrice}` `{amount}` `{note}` |
| 집계 표 | `{#totals.summaryRows}` … `{/totals.summaryRows}`, 셀에 `{label}` `{amount}` |
| 특이사항 표 | `{#totals.infoRows}` … `{/totals.infoRows}`, 셀에 `{label}` `{value}` |
| 거래 조건 목록 | `{#terms}{.}{/terms}` |

- 태그는 **한 번에 끊김 없이 타이핑**한다. 중간에 서식(굵게·색)이 바뀌면 워드가 태그를 쪼개고, docxtemplater가 못 읽는다
- 자동 맞춤법 교정으로 `{` 가 다른 문자로 바뀌지 않는지 확인

### 9.2 HWPX (한글)

| 대상 | 태그 |
| --- | --- |
| 단순 값 | `{{client.company}}` `{{docNo}}` `{{supplier.bizType}}` `{{payment.accountNo}}` |
| 합계 강조 | `{{totals.grandTotalText}}` |
| 항목 행 | `{{row.no}}` `{{row.name}}` `{{row.spec}}` `{{row.qty}}` `{{row.unit}}` `{{row.unitPrice}}` `{{row.amount}}` `{{row.note}}` |
| 집계 행 | `{{sum.label}}` `{{sum.amount}}` |
| 특이사항 행 | `{{info.label}}` `{{info.value}}` |

- **반복 표의 데이터 행을 manifest의 `maxRows`개만큼 미리 만들어 둔다** (항목 30, 집계 6, 특이사항 8). 각 행 전부 동일한 태그를 쓴다. 렌더러가 위에서부터 채우고 남는 행을 지운다
- 데이터 행에는 반드시 해당 접두어(`{{row.` `{{sum.` `{{info.`)로 시작하는 태그가 하나 이상 있어야 한다 (행 식별 기준)
- 태그는 **한 번에 끊김 없이 타이핑**하고 태그 전체의 글꼴·크기·굵기를 동일하게 유지한다. 중간에 서식이 바뀌면 한글이 텍스트를 쪼갠다
- 표 안에서 셀 병합은 데이터 행에 쓰지 않는다 (머리글 행은 무방)

### 9.2.1 HWPX 템플릿은 서식을 명시하지 않으면 못 쓴다 (실측)

**표 구조만 만들고 글자·정렬·테두리를 지정하지 않으면 한컴이 전부 기본값으로 그린다** — 좌측 정렬, 큰 글자, 음영 없음, 셀이 세로로 늘어남. 구조가 맞는 것과 문서가 쓸 만한 것은 별개다. 도구로 템플릿을 만들 때 반드시 지정할 것:

- `charPr`(글자) — `styles.ensure_run(size=...)`. **`size` 단위는 포인트다.** 라이브러리가 ×100 해서 `height`에 넣으므로 1/100pt 값(900 등)을 주면 900pt 글자가 되어 한 글자가 페이지를 덮는다
- `paraPr`(정렬) — 기본 문서에는 **CENTER/RIGHT가 아예 없다**(전부 JUSTIFY/LEFT). 만드는 API도 없다. `Contents/header.xml`의 `<hh:paraProperties>`에서 paraPr 0을 복제해 `<hh:align horizontal>`만 바꾸고 새 id로 추가한 뒤 `itemCnt`를 올려야 한다
- `borderFill`(테두리·음영) — 머리행 음영, 테두리 없는 표 구분
- ★**스타일 생성은 헤더 스냅샷보다 먼저 끝낸다.** 중간에 스냅샷을 떠서 저장 시 덮어쓰면 이후 만든 스타일이 사라지고, 본문이 없는 `borderFillIDRef`를 가리켜 파일이 깨진다

### 9.2.2 한컴 없이 잡을 수 있는 것은 자동으로 잡는다

템플릿을 만들거나 교체할 때마다 `check_hwpx.py`(서식 zip 동봉)를 돌린다. 한컴을 열지 않고 8가지를 검사한다 — **스타일 참조 무결성**(본문이 가리키는 id가 헤더에 있는가), **글자 크기 6~25pt 범위**, CENTER/RIGHT 존재, 자리표시자 쪼개짐, 반복 행 수, `mimetype` 규약, `ns0:` 오염, **행 0개인 표**. 위 §9.2.1의 두 사고는 모두 이 검사로 잡힌다.

### 9.3 공통

- 금액 표시는 **서식 문자열을 넣지 않는다.** 렌더러가 `3,850,000` 형태로 이미 포맷해 넣는다
- 로고·도장 이미지는 템플릿에 직접 넣는다 (플레이스홀더 아님)
- 서식을 고치면 `manifest.json`의 `version`을 올린다

---

## 10. 완료 검증 기준

전부 통과해야 완료다.

| # | 검증 | 기대 |
| --- | --- | --- |
| 1 | 단가 없이 "견적서 만들어줘" | 숫자를 지어내지 않고 부족한 값을 **한 번에 모아** 되물음. **파일이 하나도 안 만들어짐** |
| 2 | 항목 2개, 부가세 별도, 4포맷 전부 생성 | **DOCX·HWPX·XLSX·PDF 합계가 전부 동일** |
| 3 | 같은 견적서의 DOCX와 PDF | 생김새 동일 (PDF는 DOCX 변환이므로 자동 보장) |
| 4 | 부가세 포함(inclusive) | 공급가액 + 부가세 = 총액, 총액은 사용자가 말한 금액 그대로 |
| 5 | 면세(exempt) | 부가세 0, 거래조건 2번이 "면세 대상 거래"로 바뀜 |
| 6 | 할인 10% | subtotal 기준 계산, 총액 반영 |
| 7 | 원단위 절사(unit=1000) | '단수조정' 행이 문서에 보임 |
| 8 | 항목 3개 (maxRows=30) | **HWPX에서 남은 27행이 삭제되고 표가 3행으로 보임.** 빈 행 안 남음 |
| 9 | rows 31개 | 에러로 중단 + "행을 늘리거나 항목을 줄이라" 안내. 조용히 안 자름 |
| 8b | 그룹 3개 + 실비 2개 | 그룹 머리행·그룹 소계·실비 구분행이 DOCX·HWPX·XLSX·PDF에서 **동일한 순서**로 나옴 |
| 8c | 그룹 전부 null, 실비 없음 | 그룹행·소계행이 하나도 안 나오고 단순 표로 보임 |
| 8d | `payment`·`delivery` 비어 있음 | 해당 줄이 문서에서 생략됨. 빈 라벨만 남지 않음 |
| 8e | 공급자 정보 미설정 | 계좌번호·사업자번호를 **모델이 지어내지 않고** `missing`으로 처리 |
| 10 | **생성된 HWPX를 한컴오피스에서 열기** | 정상 열림. 표 깨짐·복구 대화상자 없음 |
| 11 | 생성된 문서에 `{{` 또는 `{` 잔여 | 0개. 있으면 실패 처리돼야 함 |
| 12 | PDF의 한글 | 네모(tofu) 없이 정상 출력 — Cloud Run 폰트 확인 |
| 13 | Cloud Run 콜드스타트 | 첫 요청도 90s 안에 PDF 반환. 실패 시 1회 재시도 |
| 14 | 생성 후 업무 탐색기 | 회사 파일에 자동 저장되고 항목으로 보임 |
| 15 | XLSX를 엑셀에서 열어 수량 변경 | 수식이 살아 있어 합계 재계산 |
| 16 | xlsx 첨부(300행) | 200행 읽고 "이후 100행 생략" 고지 표시 |
| 17 | PDF 첨부 후 코어→잉크 위임 | 잉크가 첨부 내용 반영 (§8.3) |
| 18 | 같은 지시 2회 | 항목·금액 동일 (문서번호·발행일만 다름) |
| 19 | `_서식/`에 폴더+manifest만 추가 | **코드 수정·배포 없이** `form_list`에 새 서식이 나타남 |
| 20 | `terms=[]` · `validUntil=""` 로 HWPX 렌더 | `rowCnt="0"` 표 0개. 거래조건 표가 **통째로 사라지고**, 머리행 있는 특이사항 표는 머리행만 남아 살아남음. 표 개수는 정확히 1개만 줄어듦 |
| 21 | 선택 필드(`client.person` 등) 키를 아예 뺀 데이터 | **DOCX·HWPX 둘 다 생성됨**(§6.0). 한쪽만 실패하면 안 됨 |
| 22 | 서식에 오타 태그(`{{clinet.company}}`) | HWPX·DOCX 모두 실패. 조용히 빈칸으로 넘어가지 않음 |
| 23 | 템플릿 교체 시 `check_hwpx.py` | 전 항목 통과(§9.2.2). 스타일 참조 무결성·글자 크기 범위가 핵심 |

---

## 11. 라이선스 확인 결과

| 대상 | 라이선스 | 판단 |
| --- | --- | --- |
| docxtemplater 코어 | **MIT / GPLv3 듀얼** | ✅ MIT 선택. 유료 모듈(xlsx·image·html)은 쓰지 않는다 |
| pizzip | MIT | ✅ |
| fflate | MIT | ✅ |
| SheetJS community | Apache 2.0 | ✅ |
| LibreOffice | MPL 2.0 | ✅ 서비스로 실행만 함 |
| python-hwpx | Apache 2.0 | ✅ **구조 참고만.** 코드 이식 시 고지 의무 발생 → 이식하지 않는다 |
| airmang/hwpx-skill · jkf87/hwpx-skill | MIT | ✅ 참고 가능. 단 Python이라 Workers에 못 붙음 |
| **anthropics/skills** docx·pdf·pptx·xlsx | **source-available, not open source** | ❌ **코드 차용 금지.** 설계 참고만 |
| H2Orestart (LibreOffice HWP 확장) | 확인 필요 | P0 범위 밖 (§6.4) |

---

## 12. 범위 밖 (P0에서 하지 않는다)

- 계약서·거래명세서·인보이스 서식 → **엔진은 P0에서 완성되므로, 템플릿+manifest만 올리면 P1에서 코드 없이 추가**
- 단가표 마스터데이터 (사용자 결정)
- HWPX → PDF 변환 (§6.4)
- 회사 파일에 올린 xlsx·pdf를 에이전트가 직접 읽기 (`company-files.ts:308` 확장) → P1
- PPTX 서식
- MCP 서버 연동 — RAVIOK는 MCP 클라이언트가 아니다. 붙이려면 별도 대형 과제
- 견적서 메일 발송 자동화 → 기존 `gmail_send`로 사용자가 별도 지시
- 견적 이력·버전 비교
- 기존 `ppt`·`pdf` 도구 정리 → 당분간 병존

---

## 13. 파일별 작업 목록

**신규 (서버 / Workers)**
- `prototype/functions/api/agent/_form-registry.ts` — `_서식/` 로드, manifest 파싱
- `prototype/functions/api/agent/_form-calc.ts` — `quote-calc-v1` (§4)
- `prototype/functions/api/agent/_render-docx.ts` — docxtemplater (§6.1)
- `prototype/functions/api/agent/_render-hwpx.ts` — 자체 구현 (§6.2)
- `prototype/functions/api/agent/_render-xlsx.ts` — SheetJS (§6.3)

**신규 (서비스)**
- `doc-convert/` — Cloud Run PDF 변환기. Dockerfile + 한글 폰트 (§6.4)

**신규 (클라이언트)**
- `ai-company-app/src/lib/xlsxImport.ts` — 엑셀 입력 파서 (§8.1)

**신규 (자산)**
- `_서식/견적서-표준/manifest.json` · `template.docx` · `template.hwpx` — GCS에 업로드

**수정**
- `_shared.ts` — `runFormListTool`, `runFormFillTool`, `AGENT_TOOLS` 등록, GCS 바이너리 업로드 내부 함수
- `_orchestrator.ts` — `MY_TOOL_DESCRIPTIONS`, `TOOL_LABELS`, 첨부 전파 (§8.3)
- `Chat.tsx` — MIME 확장 + 스프레드시트 분기 (§8.2)
- `Results.tsx` · `ChatFileAttachments.tsx` — `kind==="form"` 미리보기 + 포맷별 다운로드 버튼
- `lib/api.ts` (`:1307`, `:1434`) — `kind==="form"` 인식
- `ai-company-app/package.json` — `xlsx`(SheetJS) 추가 (클라이언트 파싱용)

**손대지 않음**
- `generate-doc.ts`, `docgen.ts`의 기존 ppt·pdf 경로
