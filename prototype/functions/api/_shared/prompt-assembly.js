/**
 * _shared/prompt-assembly.js — 씬 이미지/영상 프롬프트 조립의 서버측 단일 원천 (ESM, 순수 함수).
 *
 * 왜 있는가: 브라우저(pipeline-image.js buildImagePrompt / pipeline-video.js promptBase)가 조립하는
 * 프롬프트와 에이전트 도구(agent/_shared.ts runSceneStillTool·runSceneVideoTool)가 쓰는 프롬프트가
 * 서로 달랐다. 같은 컷을 사람이 누르든 에이전트가 만들든 모델이 받는 문장이 같아야 한다.
 * 이 파일은 브라우저 조립 순서를 블록 단위로 그대로 옮긴 것이고,
 * tests/prompt-assembly-parity.test.mjs 가 브라우저 원본과 리터럴 문자열·순서를 비교해 표류를 막는다.
 *
 * 규칙: window / NK 전역 참조 금지. 입력은 씬 객체·헤더·payload 뿐.
 */

import { buildShotCameraHint, buildCameraDirectionHint } from "../scenario/shots/vocab.js";
import { buildBlockingLines } from "./stage-geometry.js";

// ── 공통 유틸 ─────────────────────────────────────────────────────────────

export function toBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    var x = v.trim().toLowerCase();
    if (x === 'true' || x === '1' || x === 'yes' || x === 'on') return true;
    if (x === 'false' || x === '0' || x === 'no' || x === 'off') return false;
  }
  return !!fallback;
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/[<>]/g, '').trim();
}

// Header에서 화면비/분량 문구를 제거해 프롬프트에 중복 반영되지 않도록 정리
// (prototype/ui/pipeline.js cleanHeader 이식 — 정규식 목록·순서 동일)
export function cleanHeader(text) {
  if (!text) return '';
  const stripTokens = (line) => {
    return line
      .replace(/비주얼\s*스타일[^.\n]*/gi, '')
      .replace(/종횡비[^.\n]*/gi, '')
      .replace(/^\s*\d+\s*:\s*\d+\s*$/g, '') // 16:9 등 비율만 있는 줄 제거
      .replace(/[#>\-\s]*\d+\s*:\s*\d+\s*/gi, '') // 문장 내 비율 토큰 제거
      .replace(/aspect\s*ratio[^.\n]*/gi, '')
      .replace(/화면\s*비율[^.\n]*/gi, '')
      .replace(/target\s*duration[^.\n]*/gi, '')
      .replace(/[#>\-\s]*타겟\s*[:.]?\s*\d+\s*(초|s)?\s*[.]?/gi, '')
      .replace(/[#>\-\s]*target\s*[:.]?\s*\d+\s*s?\s*[.]?/gi, '')
      .replace(/타겟\s*\d+\s*(초|s)?\s*[.]?/gi, '')
      .replace(/^\s*\d+\s*(초|s)\s*$/gi, '')
      .replace(/분량[^.\n]*/gi, '')
      .replace(/연속성[^.\n]*/gi, '')
      .replace(/이야기의?\s*흐름[^.\n]*/gi, '')
      .replace(/흐름이\s*자연스럽[^.\n]*/gi, '')
      .replace(/매끄럽게\s*연결[^.\n]*/gi, '')
      .replace(/일관되도록\s*유지[^.\n]*/gi, '')
      .replace(/필수\s*지침\s*없음/gi, '')
      .replace(/규칙\s*없음/gi, '')
      .replace(/^#+\s*/g, '') // Markdown 헤더 기호 제거
      .replace(/##+/g, '') // 남은 이중 해시 제거
      .replace(/\s{2,}/g, ' ')
      .trim();
  };
  return String(text)
    .split(/\n+/)
    .map(stripTokens)
    .filter(Boolean)
    .join('\n')
    .trim();
}

// sceneLocation 에서 Common 헤더(common) 와 중복되는 시작 부분을 잘라낸다.
// 예: common="...배경: 중세 판타지 전장. ...", sceneLocation="중세 판타지 전장 — 광활한 평원"
//     → "광활한 평원" 만 남김 (중세 판타지 전장 은 Common 에 이미 있음)
export function dedupeLocationAgainstCommon(loc, common) {
  var s = String(loc || '').trim();
  if (!s || !common) return s;
  // common 텍스트 안에 sceneLocation 의 시작 단어들이 등장하는지 검사.
  // 가장 긴 prefix 부터 시도해 매칭되면 잘라냄.
  var maxLen = Math.min(s.length, 80);
  for (var len = maxLen; len >= 4; len--) {
    var head = s.slice(0, len).trim();
    if (!head) continue;
    // 끝이 구분자/공백이면 빼고 비교
    var headStripped = head.replace(/[\s—\-:·、,/]+$/u, '');
    if (headStripped.length < 4) continue;
    if (common.indexOf(headStripped) !== -1) {
      // 매칭 — slice 해서 잘라낸 뒤 선두 구분자 제거
      return s.slice(len).replace(/^[\s—\-:·、,/]+/u, '').trim();
    }
  }
  return s;
}

// ── 샷 안의 시간(beats) ────────────────────────────────────────────────
// 한 컷 안에서 보이는 것이 달라지는 연출("발만 보이다가 틸트업해 전신")은 하나의 샷이고,
// 그 변화는 beats 로 적힌다. 스틸컷은 그 샷의 **첫 프레임(t=0)** 이어야 한다.
function readBeats(row) {
  var raw = row && row.beats;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  var out = [];
  raw.forEach(function (b) {
    if (!b || typeof b !== 'object') return;
    var what = normalizeText(b.what || b.text);
    if (!what) return;
    var at = Number(b.at);
    out.push({ at: (isFinite(at) && at > 0) ? at : 0, what: what });
  });
  return out.length >= 2 ? out : null;
}

export function firstFrameText(row) {
  var beats = readBeats(row);
  return beats ? beats[0].what : '';
}

// beats → "0.0s-2.5s: ..." 시간표 텍스트. 비트가 없으면 빈 문자열.
export function buildBeatTimeline(scene, durationSec) {
  var raw = scene && scene.beats;
  if (!Array.isArray(raw) || raw.length < 2) return '';
  var total = Number(durationSec) || 0;
  var rows = [];
  raw.forEach(function (b) {
    if (!b || typeof b !== 'object') return;
    var what = String(b.what || b.text || '').trim();
    if (!what) return;
    var at = Number(b.at);
    rows.push({ at: (isFinite(at) && at > 0) ? at : 0, what: what });
  });
  if (rows.length < 2) return '';
  return rows.map(function (row, i) {
    var next = rows[i + 1];
    var end = next ? next.at : total;
    var from = row.at.toFixed(1);
    var to = (end > row.at ? end : row.at).toFixed(1);
    return from + 's-' + to + 's: ' + row.what;
  }).join('\n');
}

// ── 이미지(스틸) 프롬프트 ───────────────────────────────────────────────

// 브라우저: COMMON 은 컷별(scene.common). 미설정이면 프로젝트 공통(st.header)으로 폴백.
// 서버는 "비어 있지 않은 문자열"일 때만 컷 공통을 쓴다 — /api/project/get 이 미설정도 ""로
// 정규화해 보내므로 `!= null` 검사로는 헤더 폴백이 영영 안 걸린다.
function resolveCommonSource(scene, header) {
  var own = scene && typeof scene.common === 'string' ? scene.common : '';
  return own.trim() ? own : String(header || '');
}

// 카메라 방위 + 블로킹(공간 기하). pipeline-image.js appendStageGeometry 이식.
// 블로킹 문장은 화면 텍스트에 실제로 등장하는 @토큰으로만 제한한다 — 화면 밖 캐릭터를 끌어들이지 않도록.
// 단순화: 브라우저는 캐릭터 해석용 텍스트(buildCharacterResolutionPrompt)에서 토큰을 뽑지만,
// 서버는 캐릭터 레지스트리가 없으므로 scene.composition || scene.shot 에서 직접 뽑는다.
function appendStageGeometry(blocks, scene) {
  var cameraDirection = String((scene && scene.cameraDirection) || 'front');
  try {
    var dirHint = buildCameraDirectionHint(cameraDirection, 'en');
    if (dirHint) blocks.push(dirHint);
  } catch (_) {}
  try {
    var blocking = scene && scene.blocking;
    if (blocking) {
      var compSource = String((scene && (scene.composition || scene.shot)) || '');
      var tokens = compSource.match(/@[0-9A-Za-z가-힣_]{1,24}/g);
      var line = buildBlockingLines(blocking, cameraDirection, tokens && tokens.length ? tokens : null);
      if (line) blocks.push(line);
    }
  } catch (_) {}
}

/**
 * 씬 스틸컷 프롬프트. pipeline-image.js buildImagePrompt 의 블록 순서를 그대로 따른다:
 * common → Location(중복 제거) → Composition(첫 프레임 | 화면 | 비주얼 | 행동 최후 보루)
 *   → 카메라 힌트 → 방위 힌트 → 블로킹 → 텍스트/워터마크 금지.
 * @param scene   씬 객체
 * @param header  프로젝트 공통 헤더(scene.common 이 비었을 때 폴백)
 * @param opts    예약(현재 미사용)
 */
export function buildSceneImagePrompt(scene, header, opts = {}) {
  void opts;
  var common = cleanHeader(resolveCommonSource(scene, header));
  var rawLocation = String((scene && (scene.sceneLocation || scene.location)) || '').trim();
  var sceneLocation = dedupeLocationAgainstCommon(rawLocation, common);
  var composition = String((scene && scene.composition) || '').trim();
  var action = String((scene && scene.action) || '').trim();
  var primaryVisual = String((scene && scene.shot) || '').trim();
  var cameraHint = '';
  try {
    cameraHint = buildShotCameraHint(scene && scene.shotType, scene && scene.cameraMove, 'en');
  } catch (_) { cameraHint = ''; }
  var promptBlocks = [];
  if (common) promptBlocks.push(common);
  if (sceneLocation) promptBlocks.push('Location: ' + sceneLocation);
  // 화면(composition)은 "정지 상태"(스틸 컷)라서 이미지 생성에만 쓴다. 행동(action)은 영상용이므로
  // 이미지 프롬프트엔 넣지 않는다. 시간에 따라 변하는 샷이면 스틸컷은 그 시작 프레임만 그린다.
  var firstFrame = firstFrameText(scene);
  if (firstFrame) {
    promptBlocks.push('Composition: ' + firstFrame);
    promptBlocks.push('This still is the FIRST FRAME of the shot (t=0). Render ONLY what is visible at that instant. Do NOT render the end state of the camera move or anything the move is about to reveal — the reveal happens later in the video.');
  } else if (composition) {
    promptBlocks.push('Composition: ' + composition);
  } else if (primaryVisual) {
    promptBlocks.push(primaryVisual);
  } else if (action) {
    promptBlocks.push('Composition: ' + action); // 화면·비주얼이 모두 없을 때만 최후 보루
  }
  if (cameraHint) promptBlocks.push(cameraHint);
  appendStageGeometry(promptBlocks, scene);
  promptBlocks.push('텍스트/워터마크를 넣지 말고, 지정된 스타일만 사용.');
  return promptBlocks.join('\n').replace(/[;]+/g, ',').replace(/\s+,/g, ',').trim();
}

// ── 영상 프롬프트 ───────────────────────────────────────────────────────

// pipeline-video.js buildSelections 이식 — 헤더가 없을 때 payload 선택값으로 Global 을 만든다.
export function buildSelections(payload) {
  var statePayload = payload || {};
  var audience = statePayload.target || '';
  return [
    statePayload.topic ? 'Topic: ' + statePayload.topic : '',
    statePayload.purposeCategory ? 'Genre/Purpose: ' + statePayload.purposeCategory : '',
    Array.isArray(statePayload.purposeTags) && statePayload.purposeTags.length ? 'Tags: ' + statePayload.purposeTags.join(', ') : '',
    audience ? 'Audience: ' + audience : '',
    ((Array.isArray(statePayload.tones) && statePayload.tones.length) || statePayload.tone)
      ? 'Tone: ' + ([]).concat(statePayload.tones || [], statePayload.tone || '').filter(Boolean).join(', ')
      : '',
    ((Array.isArray(statePayload.styles) && statePayload.styles.length) || statePayload.style)
      ? 'Style: ' + ([]).concat(statePayload.styles || [], statePayload.style || '').filter(Boolean).join(', ')
      : '',
    statePayload.needs && statePayload.needs.length ? 'Needs: ' + statePayload.needs.join(', ') : ''
  ].filter(Boolean).join('\n');
}

// ── 더빙 대본 (pipeline-scene-row.js buildVoiceScriptForVideo 이식) ────────

function normalizeDialogueForScript(value) {
  if (Array.isArray(value)) {
    return value.map(function (d) {
      return {
        speaker: String((d && d.speaker) || '').trim(),
        line: String((d && d.line) || '').trim()
      };
    }).filter(function (d) { return d.speaker || d.line; });
  }
  if (typeof value === 'string') {
    return value.split('\n').map(function (line) {
      return String(line || '').trim();
    }).filter(Boolean).map(function (line) {
      var idx = line.indexOf(':');
      if (idx > -1) {
        return {
          speaker: line.slice(0, idx).trim(),
          line: line.slice(idx + 1).trim()
        };
      }
      return { speaker: '', line: line };
    }).filter(function (d) { return d.speaker || d.line; });
  }
  return [];
}

function isSongMode(payload) {
  return toBool((payload || {}).songEnabled, false);
}

function extractNarrationDisplay(text) {
  var raw = String(text || '').trim();
  if (!raw) return '';
  var first = raw.split(/\n+/).map(function (x) { return String(x || '').trim(); }).find(Boolean) || raw;
  var m = first.match(/^(?:나레이션|Narration)\s*[:：]?\s*["“”]?([\s\S]*?)["“”]?\s*$/i);
  return m ? String(m[1] || '').trim() : raw;
}

// 브라우저 isVoiceFeatureEnabled(pipeline-scene-row.js) — 노래 모드도 "음성 기능 켜짐"으로 본다.
export function isVoiceFeatureEnabled(payload) {
  var p = payload || {};
  return !!(toBool(p.narrationEnabled, false) || toBool(p.dubbingEnabled, false) || toBool(p.songEnabled, false));
}

export function buildVoiceScriptForVideo(scene, payload) {
  var p = payload || {};
  var narrationEnabled = toBool(p.narrationEnabled, false);
  var dubbingEnabled = toBool(p.dubbingEnabled, false);
  // 노래 모드에서 가사는 영상 생성 프롬프트에 넣지 않는다(자막처럼 새기거나 립싱크 시도로 그림을 망친다).
  if (isSongMode(p)) return '';
  if (!narrationEnabled && !dubbingEnabled) return '';

  // 사용자가 명시적으로 편집했으면(빈 값 포함) 그 값을 그대로 사용 — 자동 대사로 폴백하지 않음.
  if (scene && scene.scriptEdited) return String(scene.script || '').trim();
  var existing = String((scene && scene.script) || '').trim();
  if (existing) return existing;

  var narration = String((scene && scene.narration) || '').trim();
  if (!narration) narration = extractNarrationDisplay((scene && scene.lines) || '');
  var dialogue = normalizeDialogueForScript((scene && scene.dialogue) || []);

  if (dubbingEnabled && !dialogue.length && narration) {
    dialogue = [{ speaker: '@narrator', line: narration }];
  }

  var rows = [];
  if (narrationEnabled && narration) rows.push('나레이션 "' + narration + '"');
  if (dubbingEnabled && dialogue.length) {
    rows.push('대사');
    dialogue.forEach(function (d) {
      rows.push((d.speaker || '@narrator') + ' "' + (d.line || '...') + '"');
    });
  }
  if (rows.length) return rows.join('\n').trim();

  var fallback = extractNarrationDisplay((scene && scene.lines) || '');
  return fallback ? ('나레이션 "' + fallback + '"') : '';
}

// voiceMode('none'|'narration'|'dubbing') 가 오면 payload 플래그보다 우선한다.
function resolveVoicePayload(payload, opts) {
  var p = Object.assign({}, payload || {});
  var mode = String((opts && opts.voiceMode) || '').trim().toLowerCase();
  if (mode === 'none') { p.narrationEnabled = false; p.dubbingEnabled = false; p.songEnabled = false; }
  else if (mode === 'narration') { p.narrationEnabled = true; p.dubbingEnabled = false; }
  else if (mode === 'dubbing') { p.dubbingEnabled = true; }
  return p;
}

/**
 * 씬 영상 프롬프트. pipeline-video.js 의 씬 단위 promptBase 를 그대로 따른다.
 *  - scene.promptText 가 비어 있지 않으면 그것을 그대로 쓴다(브라우저 덮어쓰기 규칙).
 *  - 아니면 Global / Scene Visual / Shot timeline / Scene Duration 블록.
 *  - 음성 꺼짐이면 무발화 지시 한 줄, 켜짐이면 더빙 대본 블록을 브라우저와 같은 문장으로 덧붙인다.
 * @param scene    씬 객체
 * @param header   프로젝트 공통 헤더(없으면 payload 선택값으로 Global 을 만든다)
 * @param payload  프로젝트 payload(narrationEnabled/dubbingEnabled/songEnabled 등)
 * @param opts     { voiceMode?: 'none'|'narration'|'dubbing' }
 */
export function buildSceneVideoPrompt(scene, header, payload = {}, opts = {}) {
  var sc = scene || {};
  var statePayload = resolveVoicePayload(payload, opts);
  var sharedContext = String(header || '') || buildSelections(statePayload);
  // 한 컷 안에서 보이는 것이 달라지는 샷은 beats 로 시간표가 적혀 있다.
  // 그대로 "0.0s-2.5s / 2.5s-4.0s" 형식으로 실어 보내야 모델이 언제 무엇을 드러낼지 안다.
  var sceneDurationSec = Math.max(Number(sc.estSec) || 0, 1);
  var timeline = buildBeatTimeline(sc, sceneDurationSec);
  // 카메라·공간 블록: 샷 카메라 힌트 + 방위 + 블로킹. 이미지와 같은 문장을 영상 모델도 받는다
  // (pipeline-video.js buildVideoCameraLines 이식 — 문장 원천은 vocab/stage-geometry 로 같다).
  var cameraLines = [];
  try {
    var ch = buildShotCameraHint(sc.shotType, sc.cameraMove, 'en');
    if (ch) cameraLines.push(ch);
  } catch (_) {}
  appendStageGeometry(cameraLines, sc);
  var promptBase = [
    'Global',
    sharedContext,
    'Scene Visual',
    (sc.shot || ''),
    cameraLines.length ? 'Camera' : '',
    cameraLines.join('\n'),
    timeline ? 'Shot timeline (what is visible over time)' : '',
    timeline,
    'Scene Duration',
    (sceneDurationSec + 's.')
  ].filter(Boolean).join('\n');
  var finalPrompt = (sc.promptText && String(sc.promptText).trim()) ? String(sc.promptText) : promptBase;
  if (!finalPrompt || !finalPrompt.trim()) return '';

  var voiceEnabled = isVoiceFeatureEnabled(statePayload);
  if (!voiceEnabled) {
    var noVoiceDirective = 'No speech, no dialogue, no voice-over, no lip sync, keep mouths closed.';
    if (!/no\s*speech|lip\s*sync|voice-?over/i.test(finalPrompt)) {
      finalPrompt = finalPrompt + '\n' + noVoiceDirective;
    }
  } else {
    // 더빙/나레이션 ON: 대본을 프롬프트에 주입해 캐릭터가 화면 안에서 말하며 입 모양을 맞추게 한다.
    try {
      var dubScript = String(buildVoiceScriptForVideo(sc, statePayload) || '').trim();
      if (dubScript && finalPrompt.indexOf(dubScript) === -1) {
        finalPrompt = finalPrompt +
          '\n\n[대사/립싱크] The character(s) speak the following lines on camera with accurate lip-sync. ' +
          'Match mouth movements precisely to the spoken words:\n' + dubScript;
      }
    } catch (_) { }
  }
  return finalPrompt;
}

// ── 구조 설명(패리티 테스트·그래프 엔드포인트용) ───────────────────────────

/** 프롬프트 종류별 블록 라벨을 조립 순서대로 돌려준다. */
export function describePromptSections(kind) {
  if (kind === 'video') {
    return ['Global', 'Scene Visual', 'Camera', 'Shot timeline (what is visible over time)', 'Scene Duration'];
  }
  return ['common', 'Location:', 'Composition:', 'camera', 'direction', 'blocking', 'no-text'];
}
