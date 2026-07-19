// 브라우저 내장 무료 TTS (Web Speech API · speechSynthesis)
// 서버 호출/과금 없이 클라이언트에서 즉시 텍스트를 읽어준다.
// - 생성 대기가 없어 자막(타자기)과 음성 싱크가 자연스럽다.
// - onboundary 진행률로 자막을 음성 속도에 맞춰 드러낼 수 있다.

export function browserTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

// getVoices()는 최초에 빈 배열을 주고 voiceschanged 이후 채워지는 브라우저가 있다.
export function ensureVoicesLoaded(): Promise<SpeechSynthesisVoice[]> {
  if (!browserTtsSupported()) return Promise.resolve([]);
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now && now.length) {
    cachedVoices = now;
    return Promise.resolve(now);
  }
  if (voicesReady) return voicesReady;
  voicesReady = new Promise<SpeechSynthesisVoice[]>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cachedVoices = synth.getVoices() || [];
      resolve(cachedVoices);
    };
    synth.addEventListener?.("voiceschanged", finish, { once: true } as AddEventListenerOptions);
    // 일부 브라우저는 voiceschanged를 안 쏘기도 해서 폴링 겸 타임아웃 백업.
    let tries = 0;
    const poll = window.setInterval(() => {
      const v = synth.getVoices();
      if ((v && v.length) || tries++ > 20) {
        window.clearInterval(poll);
        finish();
      }
    }, 100);
  });
  return voicesReady;
}

// 사용 가능한 한국어 음성이 하나라도 있는지.
export async function hasKoreanVoice(): Promise<boolean> {
  const voices = await ensureVoicesLoaded();
  return voices.some((v) => /^ko/i.test(v.lang));
}

export interface BrowserVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  korean: boolean;
}

// 설정 드롭다운용 음성 목록. 한국어 음성을 앞에 두고 정렬한다.
export async function listBrowserVoices(): Promise<BrowserVoiceInfo[]> {
  const voices = await ensureVoicesLoaded();
  return voices
    .map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, korean: /^ko/i.test(v.lang) }))
    .sort((a, b) => (a.korean === b.korean ? a.name.localeCompare(b.name) : a.korean ? -1 : 1));
}

function currentVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices.length) return cachedVoices;
  return browserTtsSupported() ? window.speechSynthesis.getVoices() : [];
}

// voiceURI 지정이 있으면 그 음성, 없으면 언어(lang) 기준으로 고른다.
function pickVoice(lang: string, voiceURI?: string): SpeechSynthesisVoice | null {
  const voices = currentVoices();
  if (!voices.length) return null;
  if (voiceURI) {
    const exact = voices.find((v) => v.voiceURI === voiceURI);
    if (exact) return exact;
  }
  const target = lang.toLowerCase();
  const short = target.split("-")[0];
  // 정확히 일치 → 언어코드 일치 → 첫 번째 순으로 폴백.
  return (
    voices.find((v) => v.lang.toLowerCase() === target) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(short)) ||
    null
  );
}

export interface BrowserSpeakOptions {
  text: string;
  lang?: string;          // 기본 ko-KR
  voiceURI?: string;      // 특정 브라우저 음성 지정(없으면 lang으로 자동 선택)
  rate?: number;          // 0.1~10 (기본 1)
  pitch?: number;         // 0~2 (기본 1)
  volume?: number;        // 0~1 (기본 1)
  onBoundary?: (progress: number) => void; // 0~1 진행률(자막 싱크용)
  onStart?: () => void;
  signal?: AbortSignal;   // 중단(음성 끄기 등)
}

export interface BrowserSpeakHandle {
  done: Promise<void>;
  cancel: () => void;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// 텍스트를 읽는다. onBoundary로 읽기 진행률(0~1)을 흘려보내 자막 싱크에 쓴다.
export function speakBrowserTts(opts: BrowserSpeakOptions): BrowserSpeakHandle {
  if (!browserTtsSupported() || !opts.text.trim()) {
    return { done: Promise.resolve(), cancel: () => {} };
  }
  const synth = window.speechSynthesis;
  const text = opts.text;
  const total = Array.from(text).length || 1;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang || "ko-KR";
  u.rate = clamp(opts.rate ?? 1, 0.1, 10);
  u.pitch = clamp(opts.pitch ?? 1, 0, 2);
  u.volume = clamp(opts.volume ?? 1, 0, 1);
  const voice = pickVoice(u.lang, opts.voiceURI);
  if (voice) {
    u.voice = voice;
    if (voice.lang) u.lang = voice.lang;
  }

  let cancelled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const cleanup = () => {
    u.onend = null;
    u.onerror = null;
    u.onboundary = null;
    u.onstart = null;
    opts.signal?.removeEventListener("abort", cancel);
  };
  function cancel() {
    if (cancelled) return;
    cancelled = true;
    cleanup();
    try { synth.cancel(); } catch { /* ignore */ }
    resolveDone();
  }

  u.onstart = () => opts.onStart?.();
  u.onboundary = (ev) => {
    if (cancelled || !opts.onBoundary) return;
    const idx = typeof ev.charIndex === "number" ? ev.charIndex : 0;
    opts.onBoundary(clamp(idx / total, 0, 1));
  };
  u.onend = () => {
    if (cancelled) return;
    cleanup();
    opts.onBoundary?.(1);
    resolveDone();
  };
  u.onerror = () => {
    if (cancelled) return;
    cleanup();
    resolveDone();
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      cancel();
      return { done, cancel };
    }
    opts.signal.addEventListener("abort", cancel, { once: true });
  }

  // 이전 발화가 남아있으면 정리 후 시작.
  try { synth.cancel(); } catch { /* ignore */ }
  synth.speak(u);

  return { done, cancel };
}

// 전역 중단(음성 전체 끄기).
export function cancelBrowserTts() {
  if (browserTtsSupported()) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}
