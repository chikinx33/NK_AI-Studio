/* 모델 제공사의 "잔액 부족" 응답을 알아보는 단일 원천.
 *
 * 예전에는 같은 정규식이 Claude 기반 엔드포인트 5곳에 복사돼 있었고,
 * 전부 Anthropic 의 실제 문구를 놓쳤다. 실제 응답은
 *   {"type":"invalid_request_error",
 *    "message":"Your credit balance is too low to access the Anthropic API. ..."}
 * 인데, 복사된 패턴은 "billing_error" 타입과 언더바가 든 credit_balance 만 봤다.
 * 그래서 잔액이 바닥나도 402(CREDIT_EXHAUSTED)가 아니라 일반 500 이 나갔고,
 * 화면에는 아무 안내도 뜨지 않았다.
 *
 * 문구는 제공사 사정으로 언제든 바뀐다. 새 표현을 만나면 여기에만 추가할 것.
 */

const PATTERNS = [
  /"billing_error"/i,
  /credit[_ ]balance/i,          // "credit_balance" / "credit balance" 모두
  /insufficient[_ ]?(credit|quota|funds)/i,
  /too low to access/i,          // Anthropic 현행 문구
  /exceeded your current quota/i,
  /billing[_ ]?hard[_ ]?limit/i,
];

/**
 * 응답 본문(그리고 있으면 HTTP 상태)이 잔액 부족을 뜻하는가.
 * @param {string} text  제공사 응답 본문 원문
 * @param {number} [status]  HTTP 상태. 402 는 그 자체로 잔액 부족이다.
 */
export function isCreditExhausted(text, status) {
  if (status === 402) return true;
  const s = String(text || "");
  if (!s) return false;
  return PATTERNS.some((re) => re.test(s));
}

export default isCreditExhausted;
