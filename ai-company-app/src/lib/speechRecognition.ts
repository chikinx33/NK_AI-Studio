export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

export interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}

export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechRecognitionWindow;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

export function collectSpeechTranscript(results: SpeechRecognitionResultListLike): string {
  const parts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const transcript = String(results[index]?.[0]?.transcript || "").trim();
    if (transcript) parts.push(transcript);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function mergeSpeechDraft(base: string, transcript: string): string {
  const cleanBase = base.trimEnd();
  const cleanTranscript = transcript.trim();
  if (!cleanBase) return cleanTranscript;
  if (!cleanTranscript) return cleanBase;
  return `${cleanBase} ${cleanTranscript}`;
}

export function speechRecognitionErrorMessage(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") return "마이크 권한이 차단되었습니다. 브라우저 주소창의 마이크 권한을 허용해 주세요.";
  if (code === "audio-capture") return "사용할 수 있는 마이크를 찾지 못했습니다.";
  if (code === "network") return "음성 인식 서비스에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.";
  if (code === "no-speech") return "말소리가 감지되지 않았습니다. 다시 눌러 말씀해 주세요.";
  if (code === "aborted") return "";
  return "음성을 인식하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
