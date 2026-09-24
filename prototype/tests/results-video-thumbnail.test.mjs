// 보고 카드·크게 보기: 영상·오디오 산출물의 주소를 <img> 에 넣으면 깨진 그림이 뜬다(2026-09-24 보고).
// 영상은 비디오 아이콘/플레이어, 오디오는 음표 아이콘/플레이어로 그린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("보고 카드 썸네일과 크게 보기가 영상·오디오를 <img> 로 그리지 않는다", async () => {
  const src = await readFile("ai-company-app/src/components/Results.tsx", "utf8");
  assert.match(src, /function VideoIcon\(/);
  assert.match(src, /m16 13 5\.223 3\.482a\.5\.5 0 0 0 \.777-\.416V7\.87a\.5\.5 0 0 0-\.752-\.432L16 10\.5/, "lucide video 경로");
  assert.match(src, /function MusicIcon\(/);
  // 카드: kind 를 먼저 보고 아이콘, 그 다음에야 <img>
  assert.match(src, /\{it\.kind === "video"\s*\? <span[^>]*title="영상"><VideoIcon className="h-5 w-5" \/><\/span>\s*: it\.kind === "audio"\s*\? <span[^>]*title="오디오"><MusicIcon className="h-5 w-5" \/><\/span>\s*: it\.url\s*\? <img src=\{it\.url\}/);
  // 크게 보기: 플레이어
  assert.match(src, /item\.url && item\.kind === "video"\s*\? <video src=\{item\.url\} controls playsInline/);
  assert.match(src, /item\.url && item\.kind === "audio"\s*\? <audio src=\{item\.url\} controls/);
});

test("채팅 입력창의 지목 칩도 영상·오디오는 아이콘으로 그린다", async () => {
  const chat = await readFile("ai-company-app/src/components/Chat.tsx", "utf8");
  assert.match(chat, /function VideoIcon\(/);
  assert.match(chat, /: reference\.mediaKind === "video"\s*\? <span[^>]*title="영상"><VideoIcon className="h-5 w-5" \/><\/span>\s*: reference\.mediaKind === "audio"\s*\? <span[^>]*title="오디오"><MusicIcon className="h-5 w-5" \/><\/span>\s*: reference\.url\s*\? <img src=\{reference\.url\}/);
});
