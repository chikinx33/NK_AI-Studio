import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { addKnowledge } from "../lib/api";
import Markdown from "./Markdown";
import SoundToggle from "./SoundToggle";
import VoiceModeToggle from "./VoiceModeToggle";
import { actionString, useUiAction } from "../lib/uiActions";
import {
  collectSpeechTranscript,
  getSpeechRecognitionConstructor,
  mergeSpeechDraft,
  speechRecognitionErrorMessage,
  type SpeechRecognitionLike,
} from "../lib/speechRecognition";

export interface Turn {
  id?: string;
  role: "user" | "agent";
  agentId?: string;
  name?: string;
  emoji?: string;
  text: string;
  displayText?: string;
  streaming?: boolean;
  typing?: boolean;
  voicePreparing?: boolean;
  queued?: boolean; // 앞선 에이전트 발언이 끝날 때까지 화면 노출을 보류
  imagePreview?: string; // (레거시) 단일 첨부 미리보기 data URL
  imagePreviews?: string[]; // 첨부 이미지 data URL 목록 (사용자 메시지 버블에 표시)
  ts?: number; // 메시지 시각(ms) — 채팅 시각 표시용
}

export interface Attachment {
  base64: string;
  mimeType: string;
  name: string;
  preview: string; // 이미지면 data URL, 그 외(PDF 등)는 ""
}

export const MAX_ATTACHMENTS = 10;

/** 시각(ms) → "오후 3:05" 형식 (시:분만, 날짜 없음) */
export function formatChatTime(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

interface Props {
  turns: Turn[];
  busy: boolean;
  streaming?: boolean; // 실제 응답 진행 중 (중지 버튼 표시용)
  onStop?: () => void;
  draft: string;
  setDraft: (s: string) => void;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onToggleMode?: () => void;
  agents?: { id: string; name: string }[]; // 코어 제안에서 담당자 위임 버튼 감지용
  convDate?: string; // 이 채팅(대화)의 생성 날짜 (YYYY-MM-DD) — 헤더 표기용
  activeIds?: Set<string>; // 현재 활성(작업 중) 에이전트 ID 집합 — 입력 중 아바타 결정용
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  voiceMode?: "browser" | "server" | "cloud";
  onToggleVoiceMode?: () => void;
}

/** YYYY-MM-DD → YYYY.MM.DD (날짜 형식이 아니면 빈 문자열) */
export function formatConvDate(d?: string): string {
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.replace(/-/g, ".") : "";
}

export function visibleTurnText(t: Turn): string {
  return typeof t.displayText === "string" ? t.displayText : t.text;
}

function MessagesSquareIcon({ className }: { className?: string }) {
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
      <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

function UserRoundIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="8" r="5" />
      <path d="M20 21a8 8 0 0 0-16 0" />
    </svg>
  );
}

function MessageCircleIcon({ className }: { className?: string }) {
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
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
    </svg>
  );
}

/** 단톡방 말풍선 옆 아바타 — 실제 직원은 이미지, 도구/시스템은 이모지 폴백 */
function ChatAvatar({ turn }: { turn: Turn }) {
  const [failed, setFailed] = useState(false);
  const isReal = turn.agentId && !turn.agentId.startsWith("_");
  // 도구(_tool) 메시지는 aibot 이미지 사용, 실제 직원은 본인 아바타
  const src =
    turn.agentId === "_tool"
      ? `${import.meta.env.BASE_URL}avatars/aibot.png`
      : isReal
        ? `${import.meta.env.BASE_URL}avatars/${turn.agentId}.png`
        : null;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt={turn.name}
        onError={() => setFailed(true)}
        className="w-16 h-16 shrink-0 object-contain"
      />
    );
  }
  return (
    <div className="w-16 h-16 shrink-0 flex items-center justify-center text-4xl">
      {turn.emoji || "🤖"}
    </div>
  );
}

function CopyIcon({ className }: { className?: string }) {
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
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function RepeatIcon({ className }: { className?: string }) {
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
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ListTodoIcon({ className }: { className?: string }) {
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
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <rect x="3" y="4" width="6" height="6" rx="1" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
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
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </svg>
  );
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  );
}

function MicrophoneIcon({ className }: { className?: string }) {
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
      <rect width="8" height="13" x="8" y="2" rx="4" />
      <path d="M18 10a6 6 0 0 1-12 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

function PauseIcon({ className }: { className?: string }) {
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
      <rect x="14" y="3" width="5" height="18" rx="1" />
      <rect x="5" y="3" width="5" height="18" rx="1" />
    </svg>
  );
}

function BrainIcon({ className }: { className?: string }) {
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
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
  );
}

// (에이전트 메시지 렌더는 Markdown 컴포넌트로 일원화 — react-markdown + remark-gfm)

export default function Chat({ turns, busy, streaming, onStop, draft, setDraft, onSend, onToggleMode, agents, convDate, activeIds, voiceEnabled, onToggleVoice, voiceMode, onToggleVoiceMode }: Props) {
  // 대화창은 날짜(conversationId)로 구분됨. 자정이 지나 오늘이 아닌 대화창은 종료(입력 막힘).
  const isExpired = (() => {
    if (!convDate) return false;
    const d = new Date();
    const today = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return convDate !== today;
  })();
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechDraftBaseRef = useRef("");
  const didInitScroll = useRef(false);

  // 이미지/파일 첨부 state — 여러 개 동시 첨부 지원
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const dragDepth = useRef(0); // 자식 요소 진입/이탈로 인한 깜빡임 방지용 카운터
  const speechSupported = !!getSpeechRecognitionConstructor();

  const ALLOWED_MIME = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];

  const readFile = useCallback((file: File): Promise<Attachment | null> => {
    return new Promise((resolve) => {
      if (!ALLOWED_MIME.includes(file.type)) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1] || "";
        const preview = file.type.startsWith("image/") ? dataUrl : "";
        resolve({ base64, mimeType: file.type, name: file.name, preview });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, []);

  // 여러 파일을 한 번에 첨부(최대 MAX_ATTACHMENTS). 허용 형식만 통과.
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const read = await Promise.all(list.map(readFile));
    const valid = read.filter((a): a is Attachment => !!a);
    if (!valid.length) return;
    setAttachments((prev) => [...prev, ...valid].slice(0, MAX_ATTACHMENTS));
  }, [readFile]);

  const removeAttachment = useCallback((i: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  // 입력칸 자동 높이 — 줄 수만큼 세로로 확장(최대치 넘으면 스크롤)
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => () => {
    speechRecognitionRef.current?.abort();
    speechRecognitionRef.current = null;
  }, []);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [injectedIdx, setInjectedIdx] = useState<number | null>(null);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<number>>(new Set());
  useUiAction((action) => {
    if (action.action !== "chat.messages") return;
    const operation = actionString(action, "operation");
    if (operation === "expand_all") setExpandedMsgs(new Set(turns.map((_, index) => index)));
    else if (operation === "collapse_all") setExpandedMsgs(new Set());
  }, "chat");
  const toggleExpand = (i: number) =>
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  const LONG_CHARS = 600; // 이보다 길면 접어서 보여줌

  useEffect(() => {
    if (turns.length === 0) return;
    const el = endRef.current;
    if (!el) return;
    if (!didInitScroll.current) {
      // 단톡방 진입: 애니메이션 없이 즉시 맨 아래로 (레이아웃 반영 후 1회 보정)
      didInitScroll.current = true;
      el.scrollIntoView({ behavior: "auto", block: "end" });
      requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "end" }));
    } else {
      // 이후 새 메시지는 부드럽게
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns]);

  function injectKnowledge(i: number, text: string) {
    setInjectedIdx(i); // 즉시 피드백 (서버 적재는 백그라운드 — retire 판정이 느릴 수 있음)
    setTimeout(() => setInjectedIdx((c) => (c === i ? null : c)), 1500);
    void addKnowledge(text.trim()).catch(() => {});
  }

  async function copyText(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* 클립보드 불가(비보안 컨텍스트 등) — 무시 */
    }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1200);
  }

  function submit() {
    const t = draft.trim();
    if ((!t && !attachments.length) || busy || speechListening) return;
    onSend(t, attachments.length ? attachments : undefined);
    setDraft("");
    setAttachments([]);
  }

  function stopSpeechInput() {
    speechRecognitionRef.current?.stop();
  }

  function startSpeechInput() {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition || busy || streaming || isExpired) return;
    setSpeechError("");
    speechDraftBaseRef.current = draft;
    const recognition = new Recognition();
    recognition.lang = document.documentElement.lang?.startsWith("en") ? "en-US" : "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const transcript = collectSpeechTranscript(event.results);
      setDraft(mergeSpeechDraft(speechDraftBaseRef.current, transcript));
    };
    recognition.onerror = (event) => {
      const message = speechRecognitionErrorMessage(event.error);
      if (message) setSpeechError(message);
    };
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
      setSpeechListening(false);
      requestAnimationFrame(() => taRef.current?.focus());
    };
    speechRecognitionRef.current = recognition;
    setSpeechListening(true);
    try {
      recognition.start();
    } catch {
      speechRecognitionRef.current = null;
      setSpeechListening(false);
      setSpeechError("마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  function toggleSpeechInput() {
    if (speechListening) stopSpeechInput();
    else startSpeechInput();
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); await addFiles(files); }
  }

  // ── 드래그 앤 드롭: 채팅 영역 어디에 놓아도 첨부 ──
  function onDropZoneDragEnter(e: React.DragEvent) {
    if (isExpired || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }
  function onDropZoneDragOver(e: React.DragEvent) {
    if (isExpired || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function onDropZoneDragLeave(e: React.DragEvent) {
    if (isExpired) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }
  async function onDropZoneDrop(e: React.DragEvent) {
    if (isExpired) return;
    const files = e.dataTransfer.files;
    if (files && files.length) {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      await addFiles(files);
    }
  }

  return (
    <div
      className={`flex-1 flex flex-col h-full min-h-0 ${dragOver ? "chat-dropzone-active" : ""}`}
      onDragEnter={onDropZoneDragEnter}
      onDragOver={onDropZoneDragOver}
      onDragLeave={onDropZoneDragLeave}
      onDrop={onDropZoneDrop}
    >
      {/* 아이콘 전용 행 — 대시보드·그래프·설정과 동일한 방식 */}
      <div className="flex justify-center pt-3 pb-1 text-gray-400">
        <MessagesSquareIcon className="h-10 w-10" />
      </div>
      <div className="px-5 py-3 border-b border-edge flex items-center gap-2">
        <div className="ml-auto flex items-center gap-2">
          {formatConvDate(convDate) && (
            <span className="text-xs text-gray-400 tabular-nums" title="이 대화의 생성 날짜">
              {formatConvDate(convDate)}
            </span>
          )}
          {onToggleMode && (
            <button
              onClick={onToggleMode}
              className="text-xs px-2.5 py-1 rounded-lg bg-violet-800/60 hover:bg-violet-700 text-violet-100"
              title="VN 모드로 전환"
            >
              <span className="inline-flex items-center gap-1">
                <UserRoundIcon className="h-4 w-4" /> 일반채팅
              </span>
            </button>
          )}
          <SoundToggle enabled={voiceEnabled} onToggle={onToggleVoice} />
          {voiceEnabled && voiceMode && onToggleVoiceMode && (
            <VoiceModeToggle mode={voiceMode} onToggle={onToggleVoiceMode} />
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2 relative">
        {turns.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-5">
            <div className="text-center text-gray-500">
              <MessageCircleIcon className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p>직원들과 대화를 시작하세요.</p>
              <p className="text-xs mt-2 leading-relaxed">
                "코어 거기 있나?" · "@엔지 메모장 앱 어떻게 돼가?" <br />
                "엣지야, 수익화 아이디어 좀 줘" · "어제 요청한 건 어떻게 됐어?"
              </p>
            </div>
          </div>
        )}

        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="group flex items-end justify-end gap-1.5">
              <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={() => copyText(i, t.text)}
                  title={copiedIdx === i ? "복사됨" : "복사"}
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white"
                >
                  <CopyIcon className={`h-3.5 w-3.5 ${copiedIdx === i ? "text-emerald-400" : ""}`} />
                </button>
                <button
                  onClick={() => onSend(t.text)}
                  disabled={busy}
                  title="다시 쓰기"
                  className="grid h-7 w-7 place-items-center rounded-lg text-gray-400 transition hover:bg-edge hover:text-white disabled:opacity-30"
                >
                  <RepeatIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex max-w-[78%] flex-col items-end">
                {t.ts && <div className="mb-0.5 mr-1 text-[10px] text-gray-600">{formatChatTime(t.ts)}</div>}
                {(() => {
                  const previews = t.imagePreviews?.length ? t.imagePreviews : (t.imagePreview ? [t.imagePreview] : []);
                  const hasAttachment = previews.length > 0;
                  return (
                    <div className="rounded-2xl rounded-br-sm px-4 py-2 bg-emerald-700 text-white text-sm whitespace-pre-wrap">
                      {hasAttachment && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {previews.map((src, i) => (
                            <img key={i} src={src} alt="첨부 이미지" className="max-h-48 w-auto rounded-lg object-contain" />
                          ))}
                        </div>
                      )}
                      {t.text && t.text !== "[이미지 첨부됨]" ? t.text : !hasAttachment ? t.text : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (() => {
            const shownText = visibleTurnText(t);
            const revealing = !!(t.streaming || t.typing || t.voicePreparing);
            return (
            <div key={i} className="flex items-start justify-start gap-2">
              <ChatAvatar turn={t} />
              <div className="max-w-[78%]">
                <div className="mb-0.5 flex items-baseline gap-1.5">
                  <span className="text-xs text-gray-400">{t.name}</span>
                  {t.ts && <span className="text-[10px] text-gray-600">{formatChatTime(t.ts)}</span>}
                </div>
                <div className="group relative rounded-2xl rounded-tl-sm px-4 py-2 pb-6 bg-panel border border-edge text-sm whitespace-pre-wrap">
                  {t.agentId === "_tool" && t.text.startsWith("🔐") ? (
                    <span className="inline-flex items-baseline gap-1.5">
                      <ListTodoIcon className="h-4 w-4 shrink-0 translate-y-0.5 text-amber-300" />
                      {t.text.replace(/^🔐\s*/, "")}
                    </span>
                  ) : shownText ? (
                    (() => {
                      // 코드 블록(```)이 있는 메시지는 자르지 않는다 — 중간에 잘리면 코드가 깨지고
                      // 다운로드도 잘린 코드만 받게 된다. (코드는 블록 안에서 스크롤됨)
                      const hasCode = shownText.includes("```");
                      const isLong = !revealing && !hasCode && shownText.length > LONG_CHARS;
                      const isOpen = expandedMsgs.has(i);
                      const shown = isLong && !isOpen ? shownText.slice(0, LONG_CHARS) : shownText;
                      return (
                        <>
                          <Markdown text={shown} />
                          {isLong && !isOpen && <span className="text-gray-500">… </span>}
                          {isLong && (
                            <button
                              onClick={() => toggleExpand(i)}
                              className="ml-1 align-baseline text-[11px] font-medium text-emerald-400 hover:underline"
                            >
                              {isOpen ? "접기" : "더 보기"}
                            </button>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    <span className="text-gray-500">…</span>
                  )}
                  {/* 코어 제안에 등장한 담당자 → 원클릭 위임 (협업이 실제로 흐르게) */}
                  {!t.streaming && t.agentId === "core" && t.text && agents && (() => {
                    const mentioned = agents.filter((a) => a.id !== "core" && t.text.includes(a.name));
                    if (mentioned.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-edge/60 pt-2">
                        <span className="text-[10px] text-gray-500">위임:</span>
                        {mentioned.map((a) => (
                          <button
                            key={a.id}
                            disabled={busy}
                            onClick={() => onSend(`${a.name}, 코어가 방금 제안한 작업을 직접 맡아 진행해줘.`)}
                            className="rounded-lg border border-emerald-700 bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-200 transition hover:bg-emerald-900/60 disabled:opacity-40"
                          >
                            {a.name}에게 시키기
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                  {revealing && <span className="inline-block w-1.5 h-4 ml-0.5 bg-emerald-400 animate-pulse align-middle" />}
                  {!revealing && t.text && t.agentId && !t.agentId.startsWith("_") && (
                    <div className="absolute bottom-1 right-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => injectKnowledge(i, t.text)}
                        title={injectedIdx === i ? "회사 지식에 추가됨" : "이 내용을 회사 지식에 추가"}
                        className="grid h-6 w-6 place-items-center rounded-md bg-panel/90 text-gray-500 transition hover:bg-edge hover:text-white"
                      >
                        <BrainIcon className={`h-3.5 w-3.5 ${injectedIdx === i ? "text-emerald-400" : ""}`} />
                      </button>
                      <button
                        onClick={() => copyText(i, t.text)}
                        title={copiedIdx === i ? "복사됨" : "이 대화 복사"}
                        className="grid h-6 w-6 place-items-center rounded-md bg-panel/90 text-gray-500 transition hover:bg-edge hover:text-white"
                      >
                        <CopyIcon className={`h-3.5 w-3.5 ${copiedIdx === i ? "text-emerald-400" : ""}`} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })()
        )}
        {busy && !turns[turns.length - 1]?.streaming && (() => {
          // 사이드바 하이라이트(activeIds)와 반드시 일치시킨다 — 같은 출처를 우선으로 본다.
          // 우선순위: ① activeIds 비코어 → ② activeIds 첫 항목(코어 등) → ③ 유저 멘션 → ④ 마지막 발언자 → ⑤ 코어
          const activeArr = activeIds ? [...activeIds] : [];
          const activeNonCore = activeArr.find((id) => id !== "core");
          const lastAgentTurn = [...turns].reverse().find((t) => t.role === "agent" && t.agentId);
          const lastUserText = [...turns].reverse().find((t) => t.role === "user")?.text ?? "";
          const firstNamedAgent = agents?.reduce<{ id: string; idx: number } | null>((best, a) => {
            const idx = lastUserText.indexOf(a.name);
            if (idx === -1) return best;
            return !best || idx < best.idx ? { id: a.id, idx } : best;
          }, null);
          const resolvedId = activeNonCore ?? activeArr[0] ?? firstNamedAgent?.id ?? lastAgentTurn?.agentId ?? "core";
          const resolved = agents?.find((a) => a.id === resolvedId);
          const tid = resolved?.id ?? resolvedId;
          const tname = resolved?.name ?? lastAgentTurn?.name ?? "코어";
          return (
            <div className="flex items-start justify-start gap-2">
              <img
                src={`${import.meta.env.BASE_URL}avatars/${tid}.png`}
                alt={tname}
                className="h-8 w-8 shrink-0 rounded-lg object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
              />
              <div className="max-w-[78%]">
                <div className="text-xs text-gray-400 mb-0.5">{tname}</div>
                <div className="inline-block rounded-2xl rounded-tl-sm border border-edge bg-panel px-4 py-3">
                  <span className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" />
                  </span>
                </div>
              </div>
            </div>
          );
        })()}
        <div ref={endRef} />
      </div>

      {isExpired ? (
        <div className="px-4 pb-4 pt-3 border-t border-edge text-center">
          <p className="text-xs text-gray-500">🌙 본 대화창은 자정이 지나 종료되었습니다.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-1.5 text-xs font-medium text-emerald-400 transition hover:underline"
          >
            오늘 대화로 가기
          </button>
        </div>
      ) : (
      <div className="px-4 pb-4 pt-2 border-t border-edge">
        {/* 첨부 미리보기 — 여러 개를 가로로 나열 */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                {a.preview ? (
                  <img src={a.preview} alt={a.name} className="h-16 w-16 rounded-lg object-cover border border-edge" />
                ) : (
                  <div className="flex h-16 items-center gap-1.5 rounded-lg border border-edge bg-ink px-2 py-1.5 text-xs text-gray-400">
                    📄 <span className="max-w-[120px] truncate">{a.name}</span>
                  </div>
                )}
                <button
                  onClick={() => removeAttachment(i)}
                  className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-gray-800 text-gray-300 text-[10px] leading-none ring-1 ring-edge hover:bg-gray-700 hover:text-white"
                  title="첨부 제거"
                >✕</button>
              </div>
            ))}
            <span className="text-[11px] text-gray-500">{attachments.length}/{MAX_ATTACHMENTS}</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* 숨김 파일 입력 — 다중 선택 허용 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
          {/* 파일 첨부 버튼 */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || attachments.length >= MAX_ATTACHMENTS}
            title={attachments.length >= MAX_ATTACHMENTS ? `최대 ${MAX_ATTACHMENTS}개까지 첨부할 수 있어요` : "이미지/파일 첨부 (여러 개 가능)"}
            className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border transition disabled:opacity-40 ${attachments.length ? "border-emerald-600 bg-emerald-900/40 text-emerald-300" : "border-edge bg-ink text-gray-400 hover:bg-edge hover:text-white"}`}
          >
            <PaperclipIcon className="h-4 w-4" />
          </button>
          <textarea
            ref={taRef}
            spellCheck={false}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (speechError) setSpeechError(""); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={handlePaste}
            rows={1}
            placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈) · @이름으로 직원 지목"
            className="no-scrollbar flex-1 resize-none overflow-y-auto bg-ink border border-edge rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-600"
          />
          <button
            type="button"
            onClick={toggleSpeechInput}
            disabled={!speechSupported || busy || streaming}
            aria-pressed={speechListening}
            aria-label={speechListening ? "음성 입력 중지" : "음성으로 입력"}
            title={!speechSupported ? "이 브라우저는 음성 입력을 지원하지 않습니다" : speechListening ? "듣는 중 · 누르면 중지" : "음성으로 입력"}
            className={`relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border transition disabled:cursor-not-allowed disabled:opacity-35 ${speechListening ? "border-red-500 bg-red-950/70 text-red-300" : "border-edge bg-ink text-gray-400 hover:bg-edge hover:text-white"}`}
          >
            {speechListening && <span className="absolute inset-1 animate-ping rounded-lg border border-red-400/60" />}
            <MicrophoneIcon className="relative h-4 w-4" />
          </button>
          {streaming ? (
            <button
              onClick={onStop}
              title="응답 중지하고 다시 입력"
              className="grid h-[42px] place-items-center px-4 rounded-xl bg-red-700 hover:bg-red-600"
            >
              <PauseIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={busy || speechListening}
              title="전송"
              className="grid h-[42px] place-items-center px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40"
            >
              <PlayIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        {(speechListening || speechError) && (
          <div className="mt-1.5 min-h-4 px-1 text-xs" role="status" aria-live="polite">
            {speechListening ? (
              <span className="text-red-300">● 듣고 있습니다. 말씀을 마치면 입력창에 자동으로 반영됩니다.</span>
            ) : (
              <span className="text-amber-300">{speechError}</span>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
