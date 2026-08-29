/**
 * 노래 구간(song section) 모델 — 가사의 단일 출처.
 *
 * 왜 별도 개념인가:
 *   컷(비트)과 노래 소절은 자연스러운 길이가 다르다.
 *     컷      2~5초   (연출은 세밀하고 차등적일수록 좋다)
 *     소절    4~10초
 *     후렴    길면 20초까지 (알파벳 전곡 등)
 *   v3.1583 까지는 가사 1구간 = 비트 1개로 묶었는데, 그러면 컷을 잘게 쪼갤수록
 *   가사가 부서지고 가사에 맞추면 컷이 늘어졌다. 둘 중 하나는 반드시 깨진다.
 *
 * 그래서 구간은 자기 durationSec 을 갖고 **여러 씬에 걸친다**.
 * 씬과 구간은 인덱스가 아니라 **시간축**으로 묶는다:
 *   씬   [sceneStart, sceneEnd)
 *   구간 [sectionStart, sectionEnd)
 * 이 매핑 하나로 자막 타이밍과 음원 청크 경계가 동시에 정해진다.
 *
 * @typedef {Object} SongSection
 * @property {string} id          sec_01 …
 * @property {string} role        hook | verse | chorus | bridge
 * @property {string} label       [1절] / [후렴] — 표시용
 * @property {string} text        실제로 부를 가사 (@토큰 없음, 줄바꿈 정규화됨)
 * @property {number} durationSec 이 구간을 부르는 시간
 * @property {number} startSec    누적 시작 시각
 * @property {boolean} isRefrain  후렴 여부
 */

// 자막이 읽히고 한 소절로 들리려면 최소 3초는 있어야 한다.
export const MIN_SECTION_SEC = 3;

/**
 * 3~6세가 따라 부를 수 있는 속도의 상한(음절/초).
 * Twinkle Twinkle 이 약 1.6, 알파벳송이 1.8~2.2 다. 2.0 을 기준으로 잡는다.
 * 이 값이 곧 "영상 N초에 넣을 수 있는 총 음절 수 = N × 2" 예산이 된다.
 */
export const SYLLABLES_PER_SEC = 2;

/**
 * 부르는 음절 수를 센다. 길이 배분의 기준이 되는 유일한 객관 지표다.
 *
 * durationSec 을 AI 가 정하게 두면 감으로 찍는다. 실제로 v3.1584 결과에서
 * 16음절 소절에 3초를 줘 초당 5.3음절(랩 속도)이 나왔다.
 * 글자 수는 셀 수 있으므로, 시간은 여기서 계산한다.
 */
export function estimateSyllables(text) {
  const raw = String(text == null ? "" : text);
  if (!raw.trim()) return 0;
  // 한글은 글자 하나가 음절 하나다.
  const hangul = (raw.match(/[가-힣]/g) || []).length;
  // 한글을 걷어낸 나머지에서 라틴 단어를 센다.
  const rest = raw.replace(/[가-힣]/g, " ");
  let latin = 0;
  for (const word of rest.split(/[^A-Za-z']+/)) {
    if (!word) continue;
    // 홀로 선 알파벳(A, B, C)은 이름 그대로 한 음절씩 읽는다.
    if (word.length === 1) { latin += 1; continue; }
    const groups = word.toLowerCase().replace(/e$/, "").match(/[aeiouy]+/g);
    latin += Math.max(1, groups ? groups.length : 1);
  }
  // 숫자는 자릿수만큼 읽는 것으로 어림잡는다.
  const digits = (raw.match(/\d/g) || []).length;
  return hangul + latin + digits;
}

/** 이 가사를 부르는 데 최소 몇 초가 필요한가. */
export function minSecondsFor(text) {
  return Math.max(MIN_SECTION_SEC, Math.ceil(estimateSyllables(text) / SYLLABLES_PER_SEC));
}

const ROLE_BY_MARKER = [
  { re: /(후렴|chorus|refrain)/i, role: "chorus" },
  { re: /(훅|hook|intro|도입)/i, role: "hook" },
  { re: /(브릿지|bridge)/i, role: "bridge" },
];

export function roleFromLabel(label) {
  const raw = String(label || "");
  for (const { re, role } of ROLE_BY_MARKER) {
    if (re.test(raw)) return role;
  }
  return "verse";
}

export function labelForRole(role, verseNo, lang) {
  const en = lang === "en";
  if (role === "chorus") return en ? "[Chorus]" : "[후렴]";
  if (role === "hook") return en ? "[Hook]" : "[훅]";
  if (role === "bridge") return en ? "[Bridge]" : "[브릿지]";
  return en ? `[Verse ${verseNo}]` : `[${verseNo}절]`;
}

/** Eleven Music 등 외부 음악 엔진이 알아듣는 영어 구간 태그. */
export function englishTagForRole(role, verseNo) {
  if (role === "chorus") return "[Chorus]";
  if (role === "hook") return "[Hook]";
  if (role === "bridge") return "[Bridge]";
  return `[Verse ${verseNo}]`;
}

/**
 * 부를 수 있는 형태로 가사 본문을 정리한다.
 * - @토큰 제거: 가사는 노래로 불리고 자막으로 뜬다. @ 는 캐릭터 자산 매칭용 표기라
 *   여기 남으면 음악 엔진이 "at 네모" 로 읽고 자막에도 그대로 새겨진다.
 *   화면 연출용 @토큰은 씬의 visual 이 따로 들고 있으므로 잃는 정보가 없다.
 * - " / " 는 작사 AI 가 즐겨 쓰는 줄바꿈 기호다. 진짜 줄바꿈으로 바꾼다.
 */
export function cleanLyricText(value) {
  return String(value == null ? "" : value)
    .replace(/@+/g, "")
    .replace(/\s*\/\s*/g, "\n")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * 구간 길이 합을 영상 길이에 정확히 맞춘다.
 * 비례 축소/확대 후 정수 초로 반올림하고, 반올림 오차는 가장 긴 구간에 몰아 준다.
 * 모든 구간은 MIN_SECTION_SEC 이상을 보장한다.
 */
export function fitSectionDurations(sections, totalSec) {
  const target = Math.max(MIN_SECTION_SEC, Math.round(Number(totalSec) || 0));
  const list = Array.isArray(sections) ? sections.slice() : [];
  if (!list.length) return [];
  // 구간이 너무 많아 최소 길이조차 못 주면 뒤쪽을 잘라낸다 (앞이 노래의 뼈대다).
  const maxCount = Math.max(1, Math.floor(target / MIN_SECTION_SEC));
  const kept = list.slice(0, maxCount);

  // v3.1586: 배분 기준은 AI 가 찍은 durationSec 이 아니라 **음절 수**다.
  // AI 의 시간 감각은 믿을 수 없다 — 실제로 16음절 소절에 3초(초당 5.3음절, 랩 속도)를 줬다.
  // 음절 비례로 나누면 어느 한 소절만 짓눌리는 일이 없어지고, 전체가 같은 속도로 불린다.
  // 가사가 비어 음절을 셀 수 없을 때만 AI 값으로 돌아간다.
  const weights = kept.map((s) => {
    const syl = estimateSyllables(s.text);
    return syl > 0 ? syl : Math.max(1, Number(s.durationSec) || 1);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0) || kept.length;
  const scaled = weights.map((w) => Math.max(MIN_SECTION_SEC, Math.round((w / weightSum) * target)));

  let diff = target - scaled.reduce((a, b) => a + b, 0);
  // 오차는 여유 있는(긴) 구간부터 흡수시킨다 — 짧은 구간을 더 줄이면 최소 길이가 깨진다.
  while (diff !== 0) {
    const order = scaled
      .map((v, i) => ({ v, i }))
      .sort((a, b) => (diff > 0 ? a.v - b.v : b.v - a.v));
    let moved = false;
    for (const { i } of order) {
      if (diff === 0) break;
      if (diff > 0) { scaled[i] += 1; diff -= 1; moved = true; }
      else if (scaled[i] > MIN_SECTION_SEC) { scaled[i] -= 1; diff += 1; moved = true; }
    }
    if (!moved) break; // 더 줄일 수 없으면 포기 (총합이 최소치에 걸린 경우)
  }

  let cursor = 0;
  return kept.map((s, i) => {
    const durationSec = scaled[i];
    const syllables = estimateSyllables(s.text);
    const out = Object.assign({}, s, {
      durationSec,
      startSec: cursor,
      syllables,
      // 초당 음절. 2.0 을 넘으면 따라 부르기 벅차다는 신호다.
      syllablesPerSec: durationSec > 0 ? Math.round((syllables / durationSec) * 100) / 100 : 0,
    });
    cursor += durationSec;
    return out;
  });
}

/**
 * v3.1586: 붙어 있는 같은 가사 구간을 하나로 합친다.
 *
 * AI 가 같은 절을 두 구간에 그대로 복사해 내는 일이 있다. 그대로 두면 같은 문장이
 * 두 번 자막에 뜨고, 각 구간이 절반씩만 시간을 받아 둘 다 못 부를 속도가 된다.
 * 후렴은 예외다 — 후렴이 연달아 나오는 건 실제로 두 번 부르는 구성일 수 있다.
 */
export function mergeAdjacentDuplicates(sections) {
  const out = [];
  for (const sec of Array.isArray(sections) ? sections : []) {
    const prev = out[out.length - 1];
    const bothChorus = prev && prev.role === "chorus" && sec.role === "chorus";
    if (prev && !bothChorus && prev.text === sec.text) {
      prev.durationSec = (Number(prev.durationSec) || 0) + (Number(sec.durationSec) || 0);
      continue;
    }
    out.push(Object.assign({}, sec));
  }
  return out;
}

/**
 * 작사 결과를 노래로 성립하는 형태로 강제한다.
 *
 * 프롬프트로만 요구하면 지켜지지 않는 것들을 코드가 보장한다:
 *   ① 후렴 텍스트는 전부 동일 (달라지면 반복으로 안 들린다)
 *   ② 후렴 최소 2회 (한 번이면 반복이 아니라 그냥 한 줄이다)
 *   ③ 마지막은 후렴 (노래는 후렴으로 끝나야 끝난 느낌이 난다)
 *   ④ 절 번호는 순서대로 다시 매긴다 (AI 는 전부 [1절] 로 쓰는 일이 잦다)
 *   ⑤ 길이 합 = 영상 길이
 */
export function normalizeSongSections(rawSections, { durationSec = 0, lang = "ko" } = {}) {
  const list = (Array.isArray(rawSections) ? rawSections : [])
    .map((item) => {
      const label = String(item?.label || item?.section || "").trim();
      return {
        role: String(item?.role || "").trim() || roleFromLabel(label),
        text: cleanLyricText(item?.text),
        durationSec: Number(item?.durationSec) || 0,
      };
    })
    .filter((item) => item.text);
  if (!list.length) return [];

  // ① 후렴 문장 통일 — 첫 후렴이 기준. 후렴이 하나도 없으면 마지막 구간을 후렴으로 승격.
  let chorusText = (list.find((s) => s.role === "chorus") || {}).text;
  if (!chorusText) {
    list[list.length - 1].role = "chorus";
    chorusText = list[list.length - 1].text;
  }
  list.forEach((s) => { if (s.role === "chorus") s.text = chorusText; });

  // ③ 마지막은 후렴
  if (list[list.length - 1].role !== "chorus") {
    list.push({ role: "chorus", text: chorusText, durationSec: list[list.length - 1].durationSec });
  }

  // ② 후렴 최소 2회 — 부족하면 노래 중간(절 다음)에 한 번 더 끼운다.
  if (list.filter((s) => s.role === "chorus").length < 2) {
    const insertAt = Math.max(1, Math.floor(list.length / 2));
    list.splice(insertAt, 0, {
      role: "chorus",
      text: chorusText,
      durationSec: list[insertAt - 1]?.durationSec || MIN_SECTION_SEC,
    });
  }

  // ④ 절 번호 다시 매기기 + 라벨 확정
  let verseNo = 0;
  const labelled = list.map((s) => {
    if (s.role === "verse") verseNo += 1;
    return {
      role: s.role,
      verseNo: s.role === "verse" ? verseNo : 0,
      label: labelForRole(s.role, s.role === "verse" ? verseNo : 0, lang),
      text: s.text,
      durationSec: s.durationSec,
      isRefrain: s.role === "chorus",
    };
  });

  // ⑥ 붙어 있는 중복 구간 병합 → ⑤ 길이 합 = 영상 길이
  const merged = mergeAdjacentDuplicates(labelled);
  return fitSectionDurations(merged, durationSec).map((s, i) => Object.assign({}, s, {
    id: `sec_${String(i + 1).padStart(2, "0")}`,
  }));
}

/**
 * 씬과 구간을 시간축으로 묶는다.
 *
 * 각 씬은 자기 [start,end) 와 가장 많이 겹치는 구간에 속한다.
 * 가사는 **그 구간이 처음 등장하는 씬에만** 싣는다 — 걸친 모든 씬에 넣으면
 * 자막이 같은 소절을 여러 번 띄우고 음원 청크도 중복된다.
 *
 * @returns {Array} 씬마다 { sectionId, sectionLabel, lyrics, isRefrain, isSectionStart }
 */
export function mapScenesToSections(scenes, sections) {
  const list = Array.isArray(sections) ? sections : [];
  if (!list.length) return (Array.isArray(scenes) ? scenes : []).map(() => null);

  const totalSection = list.reduce((a, s) => a + (Number(s.durationSec) || 0), 0);
  const sceneList = Array.isArray(scenes) ? scenes : [];
  const totalScene = sceneList.reduce((a, s) => a + (Number(s?.estSec) || 0), 0);
  // 씬 총합과 구간 총합이 어긋나면(리밸런스 시점 차이) 씬 시간축을 구간 쪽에 맞춰 읽는다.
  const scale = totalScene > 0 && totalSection > 0 ? totalSection / totalScene : 1;

  const seenSection = new Set();
  let cursor = 0;
  return sceneList.map((scene) => {
    const dur = Math.max(0, (Number(scene?.estSec) || 0) * scale);
    const start = cursor;
    const end = cursor + dur;
    cursor = end;

    let best = null;
    let bestOverlap = -1;
    for (const sec of list) {
      const s0 = Number(sec.startSec) || 0;
      const s1 = s0 + (Number(sec.durationSec) || 0);
      const overlap = Math.min(end, s1) - Math.max(start, s0);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = sec; }
    }
    if (!best) return null;
    const isSectionStart = !seenSection.has(best.id);
    seenSection.add(best.id);
    return {
      sectionId: best.id,
      sectionLabel: best.label,
      sectionRole: best.role,
      // 이 구간이 시작되는 씬에만 가사를 싣는다 (자막·음원 중복 방지).
      lyrics: isSectionStart ? best.text : "",
      // 가사를 싣지 않는 씬도 지금 흐르는 소절은 알아야 화면을 거기 맞출 수 있다.
      sectionText: best.text,
      isRefrain: !!best.isRefrain,
      isSectionStart,
    };
  });
}

/** 음악 엔진에 넘길 청크. 구간 하나가 청크 하나 — 경계가 자막 경계와 같아진다. */
export function sectionsToSongChunks(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => String(s?.text || "").trim())
    .map((s) => ({
      text: `${englishTagForRole(s.role, s.verseNo || 1)}\n${cleanLyricText(s.text)}`,
      durationMs: Math.max(MIN_SECTION_SEC, Number(s.durationSec) || MIN_SECTION_SEC) * 1000,
      isRefrain: !!s.isRefrain,
    }));
}
