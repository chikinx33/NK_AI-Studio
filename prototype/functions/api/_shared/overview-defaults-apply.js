// 브랜드 허브 '개요 생성' 기본값(brand.overviewDefaults) → 새 에피소드 payload.
// 화면 쪽 같은 규칙: prototype/js/service/project.js project.applyOverviewDefaults (테스트가 둘을 같은 입력으로 맞대어 본다).
// 값이 있는 항목만 덮고, 주제·이야기는 기본값에 없다. 이미 있는 에피소드에는 쓰지 않는다 — 새 에피소드를 만들 때만 부른다.

const text = (v) => String(v == null ? "" : v).trim();
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

export function applyOverviewDefaults(payload, defaults) {
  const base = { ...(payload || {}) };
  const d = defaults && typeof defaults === "object" ? defaults : null;
  if (!d) return base;
  if (text(d.purposeCategory)) base.purposeCategory = text(d.purposeCategory);
  if (list(d.purposeTags).length) base.purposeTags = list(d.purposeTags).slice(0, 1);
  if (text(d.target)) base.target = text(d.target);
  if (list(d.needs).length) base.needs = list(d.needs).slice(0, 1);
  if (text(d.duration) || text(d.durationCustom)) {
    base.duration = text(d.duration);
    base.durationMode = d.durationMode === "custom" ? "custom" : "preset";
    base.durationCustom = text(d.durationCustom);
  }
  if (text(d.aspectRatio)) base.aspectRatio = text(d.aspectRatio);
  if (list(d.tones).length) { base.tones = list(d.tones).slice(0, 1); base.tone = ""; }
  if (list(d.styles).length) { base.styles = list(d.styles).slice(0, 1); base.style = ""; }
  const voice = text(d.voiceMode);
  if (voice) {
    base.voiceMode = voice;
    base.narrationEnabled = voice === "narration";
    base.dubbingEnabled = voice === "dubbing";
    base.songEnabled = voice === "song";
  }
  const tokens = list(d.characters).map((t) => text(t).toLowerCase()).filter(Boolean);
  if (tokens.length) {
    const known = Array.isArray(base.knowledgeCharacters) ? base.knowledgeCharacters
      : (base.knowledgeHub && Array.isArray(base.knowledgeHub.characters) ? base.knowledgeHub.characters : []);
    base.characters = tokens.map((token) => {
      const hit = known.find((c) => c && text(c.token).toLowerCase() === token) || {};
      return { ...hit, token: hit.token || token, displayName: hit.displayName || hit.name || token.replace(/^@/, ""), isActive: true };
    });
    base.charactersEnabled = true;
  }
  base.overviewDefaultsAppliedAt = text(d.generatedAt);
  return base;
}
