// prototype/functions/api/sound/_character-voices.ts
// 여아·남아·캐릭터 보이스 — Gemini TTS 기본 보이스(전부 성인) + 고정 캐릭터 연기 지시문.
//
// Gemini TTS 에는 아이 목소리 보이스가 따로 없다. 그래서 가장 가벼운 성인 보이스를 바탕에 두고
// 나이·음역·말버릇을 지시문으로 연기시킨다(애니메이션에서 남아 역을 여성 성우가 맡는 것과 같은 방식).
//
// 지시문은 서버에만 둔다(단일 원천). 클라이언트는 `char:<id>` 만 보내고 표시용 이름·분류만 가진다
// (prototype/js/ui/ai-sound.js 의 CHARACTER_VOICES — id 가 여기와 일치해야 한다, 테스트가 검사).

export interface CharacterVoice { base: string; persona: string; }

export const CHARACTER_VOICES: Record<string, CharacterVoice> = {
  // ── 여아 ──
  "girl-5": {
    base: "Leda",
    persona: "Voice a 5-year-old Korean little girl: very high, tiny and sweet voice, short breaths, slightly slow and careful pronunciation like a small child still learning to talk, innocent and curious. Never sound like an adult woman imitating a child.",
  },
  "girl-8": {
    base: "Laomedeia",
    persona: "Voice a cheerful 8-year-old Korean elementary-school girl: high, bright and clear voice, quick bouncy rhythm, playful and energetic, with natural childlike rising excitement.",
  },
  "girl-shy": {
    base: "Achernar",
    persona: "Voice a shy 7-year-old Korean girl: soft, small, high voice, a little hesitant with tiny pauses, speaking quietly and gently as if a bit nervous.",
  },
  "girl-teen": {
    base: "Zephyr",
    persona: "Voice a lively 15-year-old Korean teenage girl: bright, light youthful voice, casual and expressive, quick natural rhythm with teenage enthusiasm.",
  },
  // ── 남아 ──
  "boy-5": {
    base: "Leda",
    persona: "Voice a 5-year-old Korean little boy (like a boy role performed by an anime voice actress): high, small, slightly husky child voice, simple eager delivery, short breaths, innocent and a bit clumsy.",
  },
  "boy-8": {
    base: "Autonoe",
    persona: "Voice a mischievous 8-year-old Korean boy (like a boy role performed by an anime voice actress): high, energetic, slightly rough childish voice, fast and cheeky, full of playful confidence.",
  },
  "boy-smart": {
    base: "Erinome",
    persona: "Voice a smart, calm 10-year-old Korean boy (like a boy role performed by an anime voice actress): clear, high but steady child voice, precise pronunciation, thoughtful and a little serious.",
  },
  "boy-teen": {
    base: "Puck",
    persona: "Voice a 15-year-old Korean teenage boy whose voice is just breaking: light, youthful male voice, energetic and a bit awkward, casual natural rhythm.",
  },
  // ── 캐릭터 ──
  "char-rabbit": {
    base: "Laomedeia",
    persona: "Voice a boastful, hyperactive cartoon rabbit character for a Korean children's animation: high, springy, fast voice, cocky and teasing, words bouncing with excitement.",
  },
  "char-turtle": {
    base: "Schedar",
    persona: "Voice a wise, gentle old cartoon turtle character for a Korean children's animation: slow, calm and warm voice, relaxed pace with long easy pauses between phrases, unshakable and kind.",
  },
  "char-mascot": {
    base: "Zephyr",
    persona: "Voice a tiny, cute magical mascot creature for a Korean animation: very high squeaky voice, lively chatter, exaggerated adorable reactions and quick excited breaths.",
  },
  "char-robot": {
    base: "Iapetus",
    persona: "Voice a friendly cartoon robot character for a Korean animation: even, slightly mechanical and clipped delivery, precise syllables, flat but warm tone with tiny pauses like processing.",
  },
  "char-grandpa": {
    base: "Algenib",
    persona: "Voice a kind old Korean grandfather storyteller character: aged, slightly raspy low voice, slow and warm, chuckling softly, telling a story to grandchildren.",
  },
  "char-grandma": {
    base: "Gacrux",
    persona: "Voice a warm old Korean grandmother storyteller character: aged, gentle and slightly shaky voice, slow loving cadence, soothing as if telling a bedtime story.",
  },
  "char-princess": {
    base: "Aoede",
    persona: "Voice a graceful young princess heroine for a Korean animation: clear, elegant, melodic voice, gentle dignity and kindness in every line.",
  },
  "char-hero": {
    base: "Sadachbia",
    persona: "Voice a passionate young hero of a Korean action animation: bright, energetic young male voice, determined and brave, rising intensity on key words.",
  },
  "char-witch": {
    base: "Despina",
    persona: "Voice a sly, wicked witch villain for a Korean animation: smooth voice with a sneaky, mocking tone, playful menace, drawn-out words and a sinister little laugh in the voice.",
  },
  "char-villain": {
    base: "Fenrir",
    persona: "Voice a dark, overwhelming demon-lord villain for a Korean animation: deep resonant voice, slow sinister cadence, arrogant and threatening, every word heavy with menace.",
  },
};

export const CHARACTER_PREFIX = "char:";

// providerVoiceId → 실제 Gemini 보이스 이름 + 캐릭터 지시문. `char:<id>` 가 아니면 persona 없음.
export function resolveCharacterVoice(providerVoiceId: string): { base: string; persona: string; id: string } | null {
  const raw = String(providerVoiceId || "").trim();
  if (!raw.startsWith(CHARACTER_PREFIX)) return null;
  const id = raw.slice(CHARACTER_PREFIX.length);
  const c = CHARACTER_VOICES[id];
  return c ? { base: c.base, persona: c.persona, id } : null;
}
