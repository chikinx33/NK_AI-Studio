// prototype/functions/api/_shared/gemini-models.js
// Gemini 텍스트·비전 모델 이름의 단일 원천.
//
// 왜 모았나: 같은 기본값("gemini-2.5-flash")이 6개 파일에 흩어져 있었다. 구글이 그 모델을
// 신규 사용자에게 닫으면서 IP 시트 분석이 404 로 죽었는데, 고치려면 6군데를 다 찾아야 했다.
// 한 곳만 바꾸면 되게 여기로 모은다.
//
//   Gemini API error (404): This model models/gemini-2.5-flash is no longer available
//   to new users. Please update your code to use models/gemini-3.6-flash
//
// ★ TTS 모델(gemini-2.5-flash-preview-tts 등)은 별개 계열이다. 여기서 다루지 않는다.

/** 텍스트·비전 기본 모델. 위 404 안내가 지목한 후속 모델. */
export const GEMINI_TEXT_MODEL_DEFAULT = "gemini-3.6-flash";

/**
 * 프롬프트 분석·이미지 서술 등에 쓸 텍스트/비전 모델.
 * env 로 덮어쓸 수 있게 두되(모델 교체가 또 올 수 있다), 기본값은 한 곳에서만 정한다.
 */
export function geminiTextModel(env) {
  const picked = String(
    (env && (env.GEMINI_PROMPT_ANALYSIS_MODEL || env.GEMINI_TEXT_MODEL)) || ""
  ).trim();
  return picked || GEMINI_TEXT_MODEL_DEFAULT;
}

/** generateContent 엔드포인트 URL. 모델 이름을 URL 에 직접 박던 곳들을 여기로 모은다. */
export function geminiGenerateUrl(env, model) {
  const name = String(model || geminiTextModel(env)).trim();
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}:generateContent`;
}
