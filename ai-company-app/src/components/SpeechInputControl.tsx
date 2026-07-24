import { useEffect, useRef, useState } from "react";
import {
  collectSpeechTranscript,
  getSpeechRecognitionConstructor,
  mergeSpeechDraft,
  speechRecognitionErrorMessage,
  type SpeechRecognitionLike,
} from "../lib/speechRecognition";

interface UseSpeechInputOptions {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  busy: boolean;
  streaming?: boolean;
  agentPresenting?: boolean;
  isExpired: boolean;
  draft: string;
  setDraft: (value: string) => void;
  onRecognized: (text: string) => void;
  focusInput?: () => void;
}

export interface SpeechInputState {
  enabled: boolean;
  supported: boolean;
  listening: boolean;
  error: string;
  toggle: () => void;
  clearError: () => void;
}

export function useSpeechInput({
  enabled,
  onEnabledChange,
  busy,
  streaming,
  agentPresenting,
  isExpired,
  draft,
  setDraft,
  onRecognized,
  focusInput,
}: UseSpeechInputOptions): SpeechInputState {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const enabledRef = useRef(enabled);
  const draftBaseRef = useRef("");
  const draftRef = useRef(draft);
  const busyRef = useRef(busy);
  const streamingRef = useRef(!!streaming);
  const agentPresentingRef = useRef(!!agentPresenting);
  const isExpiredRef = useRef(isExpired);
  const onEnabledChangeRef = useRef(onEnabledChange);
  const onRecognizedRef = useRef(onRecognized);
  const focusInputRef = useRef(focusInput);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const supported = !!getSpeechRecognitionConstructor();

  enabledRef.current = enabled;
  draftRef.current = draft;
  busyRef.current = busy;
  streamingRef.current = !!streaming;
  agentPresentingRef.current = !!agentPresenting;
  isExpiredRef.current = isExpired;
  onEnabledChangeRef.current = onEnabledChange;
  onRecognizedRef.current = onRecognized;
  focusInputRef.current = focusInput;

  function clearRestartTimer() {
    if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }

  function scheduleRestart(delay = 250) {
    if (!mountedRef.current || !enabledRef.current || recognitionRef.current) return;
    clearRestartTimer();
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!mountedRef.current || !enabledRef.current || busyRef.current || streamingRef.current || agentPresentingRef.current || isExpiredRef.current) return;
      startRecognitionSession();
    }, delay);
  }

  function startRecognitionSession() {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition || !mountedRef.current || !enabledRef.current || recognitionRef.current || busyRef.current || streamingRef.current || agentPresentingRef.current || isExpiredRef.current) return;
    draftBaseRef.current = draftRef.current;
    const recognition = new Recognition();
    let recognizedMessage = "";
    let hasRecognizedSpeech = false;
    let recognitionFailed = false;
    let restartDelay = 250;
    let shouldRestart = true;
    recognition.lang = document.documentElement.lang?.startsWith("en") ? "en-US" : "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      if (!mountedRef.current) return;
      const transcript = collectSpeechTranscript(event.results);
      if (!transcript) return;
      hasRecognizedSpeech = true;
      setError("");
      recognizedMessage = mergeSpeechDraft(draftBaseRef.current, transcript);
      setDraft(recognizedMessage);
    };
    recognition.onerror = (event) => {
      if (!mountedRef.current) return;
      recognitionFailed = true;
      if (event.error === "no-speech" || event.error === "aborted") return;
      const message = speechRecognitionErrorMessage(event.error);
      if (message) setError(message);
      if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "audio-capture") {
        shouldRestart = false;
        enabledRef.current = false;
        onEnabledChangeRef.current(false);
      } else {
        restartDelay = event.error === "network" ? 2000 : 1000;
      }
    };
    recognition.onend = () => {
      const isCurrentSession = recognitionRef.current === recognition;
      if (isCurrentSession) recognitionRef.current = null;
      if (!mountedRef.current || !isCurrentSession) return;
      setListening(false);
      const text = recognizedMessage.trim();
      if (!recognitionFailed && hasRecognizedSpeech && text && !busyRef.current) onRecognizedRef.current(text);
      if (shouldRestart && enabledRef.current) scheduleRestart(restartDelay);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      setError("마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      if (enabledRef.current) scheduleRestart(1000);
    }
  }

  function stop() {
    enabledRef.current = false;
    onEnabledChangeRef.current(false);
    clearRestartTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    recognition?.abort();
    setListening(false);
    setError("");
    requestAnimationFrame(() => focusInputRef.current?.());
  }

  function start() {
    if (!supported || isExpiredRef.current) return;
    setError("");
    enabledRef.current = true;
    onEnabledChangeRef.current(true);
    if (!busyRef.current && !streamingRef.current && !agentPresentingRef.current) startRecognitionSession();
  }

  function toggle() {
    if (enabledRef.current) stop();
    else start();
  }

  useEffect(() => {
    mountedRef.current = true;
    if (enabledRef.current) scheduleRestart(0);
    return () => {
      mountedRef.current = false;
      clearRestartTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearRestartTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort();
      setListening(false);
      return;
    }
    if (busy || streaming || agentPresenting || isExpired) {
      clearRestartTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      recognition?.abort();
      setListening(false);
      return;
    }
    scheduleRestart(150);
  }, [enabled, busy, streaming, agentPresenting, isExpired]);

  return { enabled, supported, listening, error, toggle, clearError: () => setError("") };
}

export function MicrophoneIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="13" rx="3" />
    </svg>
  );
}

export function SpeechInputButton({
  enabled,
  listening,
  supported,
  isExpired,
  onToggle,
}: {
  enabled: boolean;
  listening: boolean;
  supported: boolean;
  isExpired: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!supported || isExpired}
      aria-pressed={enabled}
      aria-label={enabled ? "마이크 모드 끄기" : "마이크 모드 켜기"}
      title={!supported ? "이 브라우저는 음성 입력을 지원하지 않습니다" : enabled ? "마이크 모드 켜짐 · 누르면 끄기" : "마이크 모드 켜기 · 문장마다 자동 전송"}
      className={`relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-35 ${enabled ? "border-red-500 bg-red-950/70 text-red-300" : "border-edge bg-ink text-gray-400 hover:bg-edge hover:text-white"}`}
    >
      {listening && <span className="absolute inset-1 animate-ping rounded-lg border border-red-400/60" />}
      <MicrophoneIcon className="relative h-4 w-4" />
    </button>
  );
}

export function SpeechInputStatus({
  enabled,
  listening,
  waiting,
  error,
}: {
  enabled: boolean;
  listening: boolean;
  waiting: boolean;
  error: string;
}) {
  if (!enabled && !error) return null;
  return (
    <div className="mt-1.5 min-h-4 px-1 text-xs" role="status" aria-live="polite">
      {enabled ? (
        <span className="text-red-300">
          {listening
            ? "● 마이크 모드 켜짐 · 문장이 끝날 때마다 자동 전송하며 계속 듣습니다."
            : waiting
              ? "● 마이크 모드 켜짐 · 답변이 끝나면 자동으로 다시 듣습니다."
              : "● 마이크 모드 켜짐 · 다음 발화를 준비하고 있습니다."}
        </span>
      ) : (
        <span className="text-amber-300">{error}</span>
      )}
    </div>
  );
}
