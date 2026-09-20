/**
 * 서버에 저장된 브랜드 레코드에서 캐릭터 신체 스펙을 읽는다.
 * 시나리오 요청이 브라우저 로컬 캐시에만 의존하지 않도록 하는 서버 측 단일 경로다.
 */

import { readGcsJson, resolveGcsEnv } from "./gcs.js";
import { buildAiVideoBrandPrefix } from "./storage.ts";

const brandRecordCache = new Map();
const BRAND_CACHE_TTL_MS = 3000;

function normalizeText(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeToken(value) {
  const clean = normalizeText(value).replace(/^@+/, "").replace(/\s+/g, "");
  return clean ? `@${clean}` : "";
}

function mergePhrases(values) {
  const out = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const parts = Array.isArray(value) ? value : String(value || "").split(/[,\n·]/);
    parts.forEach((part) => {
      const phrase = normalizeText(typeof part === "string" ? part : part?.text || part?.value);
      if (phrase && !out.includes(phrase)) out.push(phrase);
    });
  });
  return out.join(", ");
}

function sanitizeUserId(raw, env) {
  const normalize = (value) => {
    const cleaned = normalizeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
    return cleaned || "owner";
  };
  const direct = normalize(raw);
  if (direct !== "owner") return direct;
  const configured = normalize(env?.DEFAULT_USER_ID || env?.NK_DEFAULT_USER_ID || "");
  return configured || "owner";
}

export function buildBrandBodySpecObjectName(basePrefix, userId, brandId) {
  // 브랜드 저장 API와 반드시 같은 공용 경로 생성기를 쓴다. VIDEO_OUTPUT_GCS_URI가
  // gs://bucket/videos 처럼 서비스 폴더로 끝날 때 수동 조립하면
  // `videos/users/...`를 읽게 되어 실제 저장 위치 `users/...`를 영원히 못 찾는다.
  const brandPrefix = buildAiVideoBrandPrefix(basePrefix, sanitizeUserId(userId), brandId);
  return `${brandPrefix}/reference/data.json`;
}

/** 저장된 브랜드 JSON을 사용자 범위에서 직접 읽는다. */
export async function loadBrandRecord(env, userId, brandId) {
  const id = normalizeText(brandId);
  if (!id) return { found: false, brand: null, source: "no-brand-id" };
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    const error = new Error("invalid_brand_id");
    error.code = "INVALID_BRAND_ID";
    throw error;
  }
  let gcs;
  try {
    gcs = resolveGcsEnv(env);
  } catch (_) {
    const error = new Error("brand_body_spec_storage_not_configured");
    error.code = "BODY_SPEC_SOURCE_UNAVAILABLE";
    throw error;
  }
  const objectName = buildBrandBodySpecObjectName(gcs.basePrefix, sanitizeUserId(userId, env), id);
  const cacheKey = `${gcs.bucket}/${objectName}`;
  const cached = brandRecordCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let loaded;
  try {
    loaded = await readGcsJson(env, objectName);
  } catch (cause) {
    const error = new Error(`brand_body_spec_load_failed:${String(cause?.message || cause).slice(0, 160)}`);
    error.code = "BODY_SPEC_SOURCE_UNAVAILABLE";
    throw error;
  }
  if (!loaded.found) {
    const value = { found: false, brand: null, source: "server-not-found", objectName };
    brandRecordCache.set(cacheKey, { expiresAt: Date.now() + BRAND_CACHE_TTL_MS, value });
    return value;
  }
  const persisted = loaded.data;
  if (!persisted || typeof persisted !== "object") {
    const error = new Error("brand_body_spec_json_invalid");
    error.code = "BODY_SPEC_SOURCE_UNAVAILABLE";
    throw error;
  }
  const brand = persisted?.brand && typeof persisted.brand === "object" ? persisted.brand : persisted;
  const value = { found: true, brand, source: "server", objectName };
  brandRecordCache.set(cacheKey, { expiresAt: Date.now() + BRAND_CACHE_TTL_MS, value });
  return value;
}

function bodySpecFromBrandCharacter(row) {
  const raw = row && typeof row === "object" ? row : {};
  return {
    token: normalizeToken(raw.trigger || raw.token || raw.name || raw.displayName),
    appearance: mergePhrases([raw.description, raw.fixedTraits, raw.styleGuide]),
    negative: mergePhrases([raw.negativePrompt, raw.bannedTraits]),
    known: !!mergePhrases([raw.description, raw.fixedTraits, raw.styleGuide, raw.negativePrompt, raw.bannedTraits]),
  };
}

function bodySpecFromKnowledgeCharacter(row) {
  const raw = row && typeof row === "object" ? row : {};
  return {
    token: normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name),
    appearance: mergePhrases([raw.appearance, raw.description, raw.fixedTraits, raw.styleGuide]),
    negative: mergePhrases([raw.negative, raw.negativePrompt, raw.bannedTraits]),
    known: !!mergePhrases([raw.appearance, raw.description, raw.fixedTraits, raw.styleGuide, raw.negative, raw.negativePrompt, raw.bannedTraits]),
  };
}

/**
 * 선택 캐릭터와 서버 브랜드 캐릭터를 토큰으로 결합한다.
 * 캐릭터 시트는 있는데 텍스트 신체 스펙이 비어 있으면 조용히 생성하지 않고 누락으로 보고한다.
 */
export function mergeCharacterBodySpecsFromBrand(characters = [], brand = null) {
  const selected = Array.isArray(characters) ? characters : [];
  const primary = Array.isArray(brand?.brandCharacters) ? brand.brandCharacters.map(bodySpecFromBrandCharacter) : [];
  const knowledge = Array.isArray(brand?.knowledgeCharacters) ? brand.knowledgeCharacters.map(bodySpecFromKnowledgeCharacter) : [];
  const specs = new Map();
  knowledge.concat(primary).forEach((spec) => {
    if (!spec.token) return;
    const key = spec.token.toLowerCase();
    const previous = specs.get(key) || { token: spec.token, appearance: "", negative: "", known: false };
    specs.set(key, {
      token: spec.token,
      appearance: spec.appearance || previous.appearance,
      negative: spec.negative || previous.negative,
      known: spec.known || previous.known,
    });
  });
  const registeredSheets = (Array.isArray(brand?.characterSheets) ? brand.characterSheets : []).filter((sheet) =>
    (Array.isArray(sheet?.items) && sheet.items.length > 0)
    || !!normalizeText(sheet?.mainAssetId || sheet?.assetId || sheet?.objectName || sheet?.url)
  );
  const sheetTokens = new Set(
    registeredSheets
      .map((sheet) => normalizeToken(sheet?.token || sheet?.trigger || sheet?.displayName || sheet?.name).toLowerCase())
      .filter(Boolean)
  );
  const sheetCharacterIds = new Set(
    registeredSheets
      .map((sheet) => normalizeText(sheet?.characterId || sheet?.id))
      .filter(Boolean)
  );
  const missingRequired = [];
  const merged = selected.map((character) => {
    const token = normalizeToken(character?.token || character?.trigger || character?.displayName || character?.name);
    const key = token.toLowerCase();
    const server = specs.get(key);
    const required = sheetTokens.has(key)
      || sheetCharacterIds.has(normalizeText(character?.characterId || character?.id))
      || character?.bodySpecRequired === true
      || !!normalizeText(character?.mainAssetId)
      || (Array.isArray(character?.referenceAssetIds) && character.referenceAssetIds.length > 0);
    if (!server) {
      const appearance = normalizeText(character?.appearance || character?.description);
      const known = character?.bodySpecKnown === true && !!appearance;
      if (required && !known) missingRequired.push(token);
      return { ...character, token, bodySpecRequired: required, bodySpecKnown: known };
    }
    const appearance = normalizeText(server.appearance);
    const negative = normalizeText(server.negative);
    const fallbackAppearance = normalizeText(character?.appearance || character?.description);
    const resolvedAppearance = appearance || fallbackAppearance;
    const known = !!server.known || (character?.bodySpecKnown === true && !!fallbackAppearance);
    // 네거티브가 비어 있는 것은 "금지할 신체 부위가 없음"일 수 있다. 시트가 있는 캐릭터는
    // 출처가 확인된 몸 설명(appearance)만 필수로 하고, 전역 금지어를 만들어 내지 않는다.
    if (required && (!known || !resolvedAppearance)) missingRequired.push(token);
    return {
      ...character,
      token,
      appearance: resolvedAppearance,
      negative: negative || normalizeText(character?.negative || character?.negativePrompt),
      bodySpecKnown: known,
      bodySpecRequired: required,
      bodySpecSource: "server-brand-record",
    };
  });
  return {
    characters: merged,
    matchedTokens: merged.filter((character) => specs.has(normalizeToken(character?.token).toLowerCase())).map((character) => normalizeToken(character?.token)),
    missingRequired: Array.from(new Set(missingRequired)),
  };
}

function requestSnapshotResult(characters, source, warnings = []) {
  const selected = Array.isArray(characters) ? characters : [];
  const matchedTokens = [];
  const incompleteTokens = [];
  const missingRequired = [];
  selected.forEach((character) => {
    const token = normalizeToken(character?.token || character?.trigger || character?.displayName || character?.name);
    const appearance = normalizeText(character?.appearance || character?.description);
    const negative = normalizeText(character?.negative || character?.negativePrompt);
    const required = character?.bodySpecRequired === true
      || !!normalizeText(character?.mainAssetId)
      || (Array.isArray(character?.referenceAssetIds) && character.referenceAssetIds.length > 0);
    const known = character?.bodySpecKnown !== false && !!appearance;
    if (known) matchedTokens.push(token);
    if (!known) incompleteTokens.push(token);
    if (required && !known) missingRequired.push(token);
  });
  const bodySpecWarnings = Array.from(new Set(
    (Array.isArray(warnings) ? warnings : []).concat(
      incompleteTokens.length ? [`character_body_spec_snapshot_incomplete:${incompleteTokens.filter(Boolean).join(",")}`] : []
    )
  ));
  return {
    characters: selected.map((character) => ({
      ...character,
      bodySpecRequired: character?.bodySpecRequired === true
        || !!normalizeText(character?.mainAssetId)
        || (Array.isArray(character?.referenceAssetIds) && character.referenceAssetIds.length > 0),
      bodySpecKnown: character?.bodySpecKnown !== false && !!normalizeText(character?.appearance || character?.description),
    })),
    source,
    matchedTokens: Array.from(new Set(matchedTokens.filter(Boolean))),
    missingRequired: Array.from(new Set(missingRequired.filter(Boolean))),
    incompleteTokens: Array.from(new Set(incompleteTokens.filter(Boolean))),
    bodySpecWarnings,
  };
}

/**
 * 브랜드 원본을 찾지 못해도 요청에 실린 프로젝트 스냅샷으로 이어 간다.
 * 저장된 브랜드 원본이 실제로 존재하는 경우에만 시트-텍스트 누락을 하드 오류로 본다.
 * 이 구분이 없으면 예전 프로젝트나 아직 브랜드 레코드가 없는 프로젝트가 생성 자체를 못 한다.
 */
export function resolveCharacterBodySpecsFromRecord(characters = [], loaded = null) {
  const selected = Array.isArray(characters) ? characters : [];
  if (!loaded?.found) {
    const fallback = requestSnapshotResult(
      selected,
      selected.some((character) => character?.appearance || character?.description || character?.negative || character?.negativePrompt)
        ? "request-snapshot"
        : "legacy-no-body-spec",
      loaded?.source === "server-not-found" ? ["brand_body_spec_record_not_found"] : []
    );
    return fallback;
  }
  const merged = mergeCharacterBodySpecsFromBrand(selected, loaded.brand);
  return { ...merged, source: loaded.source, incompleteTokens: [], bodySpecWarnings: [] };
}

export async function resolveServerCharacterBodySpecs({ env, userId, brandId, characters = [], loadRecord = loadBrandRecord }) {
  const selected = Array.isArray(characters) ? characters : [];
  if (!selected.length) return { characters: selected, source: "no-characters", matchedTokens: [], missingRequired: [] };
  if (!normalizeText(brandId)) {
    const snapshot = requestSnapshotResult(selected, "client-no-brand-id");
    if (snapshot.missingRequired.length) {
      const error = new Error(`character_body_spec_required:${snapshot.missingRequired.join(",")}`);
      error.code = "CHARACTER_BODY_SPEC_REQUIRED";
      error.tokens = snapshot.missingRequired;
      throw error;
    }
    return snapshot;
  }
  let loaded;
  try {
    loaded = await loadRecord(env, userId, brandId);
  } catch (error) {
    // GCS가 일시적으로 불가해도 완전한 프로젝트 스냅샷이 있으면 생성 흐름을 살린다.
    // 스냅샷도 없을 때만 기존 503을 유지해 일관성 정보 없이 조용히 생성하지 않는다.
    const snapshot = requestSnapshotResult(selected, "request-snapshot", [String(error?.message || "brand_body_spec_load_failed")]);
    if (snapshot.missingRequired.length) {
      const requiredError = new Error(`character_body_spec_required:${snapshot.missingRequired.join(",")}`);
      requiredError.code = "CHARACTER_BODY_SPEC_REQUIRED";
      requiredError.tokens = snapshot.missingRequired;
      throw requiredError;
    }
    if (snapshot.matchedTokens.length && snapshot.incompleteTokens.length === 0) return snapshot;
    throw error;
  }
  const merged = resolveCharacterBodySpecsFromRecord(selected, loaded);
  if (merged.missingRequired.length) {
    const error = new Error(`character_body_spec_required:${merged.missingRequired.join(",")}`);
    error.code = "CHARACTER_BODY_SPEC_REQUIRED";
    error.tokens = merged.missingRequired;
    throw error;
  }
  return merged;
}
