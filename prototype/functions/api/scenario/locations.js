// prototype/functions/api/scenario/locations.js
// 에피소드 공간(로케이션) 추출 — LLM(Claude)이 씬들을 보고 "실제로 구분되는 물리적 공간"으로 묶는다.
// 규칙 기반 추출의 과분할(같은 수영장을 7개로 쪼갬) 문제를 해결한다.
//
// 입력:  { scenes: [...], language: "ko"|"en" }
// 출력:  { locations: [{ id, name, description, refObjectName:"", sceneIds:[...] }] }
//   - description: 캐릭터·동작·카메라 없는 "빈 배경 플레이트" 묘사(이미지 생성용)
import { authorizeRequest } from "../_shared/auth.js";
import { buildClaudeSystem, anthropicMessagesUrl, studioAuth, isClaudeAuthRequired, CLAUDE_AUTH_REQUIRED } from "../_shared/claude-auth.js";

const corsHeaders = (origin) => ({
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
});
const send = (data, status, origin) => new Response(JSON.stringify(data), { status: status || 200, headers: corsHeaders(origin) });

export const onRequestOptions = async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request.headers.get("Origin")) });

export const onRequestPost = async ({ request, env }) => {
  const origin = request.headers.get("Origin");
  try {
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return send({ error: auth.error }, auth.status, origin);

    const body = await request.json().catch(() => ({}));
    const scenes = Array.isArray(body && body.scenes) ? body.scenes : [];
    const lang = (body && body.language) === "en" ? "en" : "ko";
    if (!scenes.length) return send({ locations: [] }, 200, origin);

    // 토큰 절약: 장소/화면 묘사만 추려 다이제스트화. 인덱스(#)로 씬 매핑.
    const digest = scenes.map((s, i) => {
      const loc = String((s && (s.sceneLocation || s.location)) || "").trim();
      const vis = String((s && (s.visual || s.composition || s.shot)) || "").trim().replace(/\s+/g, " ").slice(0, 220);
      return `#${i} [장소] ${loc || "(미지정)"} [화면] ${vis}`;
    }).join("\n");

    const system = buildLocationsSystem(lang);
    const user = (lang === "en"
      ? "Scenes of one episode (with per-scene location/frame description). Group them into the episode's actually-distinct physical spaces.\n\n"
      : "한 에피소드의 씬 목록(씬별 장소/화면 묘사). 이 에피소드에서 실제로 구분되는 물리적 공간으로 묶어라.\n\n") + digest;

    let ah;
    try {
      ah = await studioAuth(env, auth.userId);
    } catch (e) {
      if (isClaudeAuthRequired(e)) return send({ error: CLAUDE_AUTH_REQUIRED }, 412, origin);
      return send({ error: String((e && e.message) || e) }, 500, origin);
    }

    const res = await fetch(anthropicMessagesUrl(env), {
      method: "POST",
      headers: ah.headers,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1600,
        temperature: 0.2,
        system: buildClaudeSystem(ah.subscription, system),
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return send({ error: "llm_error", status: res.status, detail: String(t).slice(0, 240) }, 502, origin);
    }
    const data = await res.json().catch(() => ({}));
    const text = Array.isArray(data && data.content) ? data.content.map((c) => (c && c.text) || "").join("") : "";
    const locations = parseLocations(text, scenes);
    return send({ locations }, 200, origin);
  } catch (e) {
    return send({ error: String((e && e.message) || e) }, 500, origin);
  }
};

function buildLocationsSystem(lang) {
  if (lang === "en") {
    return `You organize LOCATIONS for video pre-production.
Input: per-scene location/frame descriptions of one episode.
Goal: identify the episode's actually-distinct physical spaces (= a place you'd build as ONE set) and group scenes by them.
Core principle: WHEN IN DOUBT, MERGE. Use as FEW locations as possible. An episode usually needs only 1-3.

MUST merge (never split these into separate locations):
- (State/time) Same place differing only by state or time: "dry basin" vs "water-filled pool", "day" vs "night", "first half" vs "later" -> all ONE place. Water filling/draining is just a state change of the same pool.
- (Sub-areas) Parts attached to one space: "pool" + "tiled deck beside the pool" + "water surface" -> one "Pool" location. Same set, camera just moved.
- (Phrasing) Same place written differently per scene: "front-yard outdoor pool" = "outdoor pool" = "play pool".

IGNORE (not location names): "low angle", "1:1 frame", "close-up", "splash", "dry", "later" and other camera/framing/state/time words.

Split ONLY when a character must physically TRAVEL to a clearly different place (e.g. indoors vs yard vs street vs pool entrance), not just a camera move. If there is no such travel, output a single location.

For each space, write a "background-plate description": the BASE empty environment only — architecture, structure, materials, colors, lighting, fixed props — NO characters, NO action, NO camera, NO momentary state (no splash). One paragraph for image generation.
Map each space to the scene indexes (#) that use it (every scene must belong to exactly one location).

Output JSON only, no markdown:
{"locations":[{"name":"Pool","description":"<empty background plate>","sceneIndexes":[0,1,2]}]}`;
  }
  return `너는 영상 프리프로덕션의 "공간(로케이션) 정리 담당"이다.
입력: 한 에피소드의 씬별 장소/화면 묘사.
목표: 이 에피소드에서 "실제로 구분되는 물리적 공간(=하나의 세트로 지을 장소)"을 식별해 씬을 묶는다.
핵심 원칙: **애매하면 무조건 병합한다. 장소 수는 최대한 적게.** 보통 한 에피소드는 1~3개면 충분하다.

반드시 하나로 병합해야 하는 경우(별도 장소로 쪼개면 안 됨):
- (상태/시간 차이) 같은 장소의 상태·시간만 다른 것. 예: "빈 웅덩이" ↔ "물이 가득 찬 수영장", "낮" ↔ "밤", "에피소드 전반" ↔ "후반" → 전부 같은 장소. 물이 차고 빠지는 건 같은 수영장의 상태 변화일 뿐이다.
- (하위 구역) 한 공간에 붙어 있는 부분. 예: "수영장" + "수영장 옆 타일 바닥/데크" + "수영장 수면" → 하나의 "수영장" 장소. 같은 세트 안에서 카메라만 옮긴 것이다.
- (다른 표현) 씬마다 다르게 적은 같은 곳. 예: "주택 앞마당 야외 수영장" = "야외 수영장" = "물놀이 풀장".

무시할 것(장소 이름 아님): "낮은 앵글", "1:1 프레임", "클로즈업", "물보라", "바닥이 드러난", "후반" 같은 카메라/프레이밍/상태/시점 표현.

진짜로 분리할 때만: 카메라 이동이 아니라 인물이 "이동"해야 닿는 명백히 다른 장소(예: 집 안 vs 마당 vs 길거리 vs 수영장 입구). 이런 게 없으면 1개로 끝내라.

각 공간에 "배경 플레이트 묘사"를 쓴다: 캐릭터·동작·카메라·순간상태(물보라 등) 없이 그 공간의 "기본 빈 배경"만(건축·구조·재질·색·조명·고정 소품). 이미지 생성용 한 문단.
각 공간이 어느 씬(#번호)들에 쓰이는지 sceneIndexes 로 매핑한다(모든 씬이 빠짐없이 한 곳에 속해야 한다).

출력: JSON 만. 마크다운/설명 금지.
{"locations":[{"name":"수영장","description":"<빈 배경 플레이트 묘사>","sceneIndexes":[0,1,2]}]}`;
}

function slugify(s) {
  const base = String(s || "").toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^a-z0-9가-힣\-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return base || "loc";
}

function parseLocations(text, scenes) {
  let raw = String(text || "").trim();
  // 코드펜스/잡음 제거 후 첫 { ~ 마지막 } 만 취함
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) raw = raw.slice(a, b + 1);
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { obj = null; }
  const list = obj && Array.isArray(obj.locations) ? obj.locations : [];
  const usedSlugs = {};
  return list.map((l) => {
    const name = String((l && l.name) || "").trim() || "장소";
    let id = slugify(name);
    while (usedSlugs[id]) id = id + "-2";
    usedSlugs[id] = true;
    const idxs = Array.isArray(l && l.sceneIndexes) ? l.sceneIndexes : [];
    const sceneIds = [];
    idxs.forEach((i) => {
      const sc = scenes[Number(i)];
      const sid = sc && sc.id != null ? String(sc.id) : "";
      if (sid && sceneIds.indexOf(sid) < 0) sceneIds.push(sid);
    });
    return {
      id,
      name,
      description: String((l && l.description) || "").trim(),
      refObjectName: "",
      sceneIds,
    };
  }).filter((l) => l.name);
}
