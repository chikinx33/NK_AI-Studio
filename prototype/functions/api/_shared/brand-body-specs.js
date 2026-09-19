/**
 * 서버에 저장된 브랜드 레코드에서 캐릭터 신체 스펙을 읽는다.
 * 시나리오 요청이 브라우저 로컬 캐시에만 의존하지 않도록 하는 서버 측 단일 경로다.
 */

import { readGcsJson, resolveGcsEnv } from "./gcs.js";

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

function normalizeBasePrefix(value) {
  return normalizeText(value).replace(/^\/+|\/+$/g, "");
}

function buildBrandObjectName(basePrefix, userId, brandId) {
  const root = normalizeBasePrefix(basePrefix);
  const safeBrandId = normalizeText(brandId).replace(/[^a-zA-Z0-9._-]+/g, "_") || "brand";
  const userRoot = `${root ? `${root}/` : ""}users/${sanitizeUserId(userId)}`;
  return `${userRoot}/ai-video/brands/${safeBrandId}/reference/data.json`;
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
  const objectName = buildBrandObjectName(gcs.basePrefix, sanitizeUserId(userId, env), id);
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
  };
}

function bodySpecFromKnowledgeCharacter(row) {
  const raw = row && typeof row === "object" ? row : {};
  return {
    token: normalizeToken(raw.token || raw.trigger || raw.displayName || raw.name),
    appearance: mergePhrases([raw.appearance, raw.description, raw.fixedTraits, raw.styleGuide]),
    negative: mergePhrases([raw.negative, raw.negativePrompt, raw.bannedTraits]),
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
    const previous = specs.get(key) || { token: spec.token, appearance: "", negative: "" };
    specs.set(key, {
      token: spec.token,
      appearance: spec.appearance || previous.appearance,
      negative: spec.negative || previous.negative,
    });
  });
  const sheetTokens = new Set(
    (Array.isArray(brand?.characterSheets) ? brand.characterSheets : [])
      .map((sheet) => normalizeToken(sheet?.token || sheet?.trigger || sheet?.displayName || sheet?.name).toLowerCase())
      .filter(Boolean)
  );
  const missingRequired = [];
  const merged = selected.map((character) => {
    const token = normalizeToken(character?.token || character?.trigger || character?.displayName || character?.name);
    const key = token.toLowerCase();
    const server = specs.get(key);
    if (!server) {
      if (sheetTokens.has(key)) missingRequired.push(token);
      return { ...character, token };
    }
    const appearance = normalizeText(server.appearance);
    const negative = normalizeText(server.negative);
    if (sheetTokens.has(key) && (!appearance || !negative)) missingRequired.push(token);
    return {
      ...character,
      token,
      appearance: appearance || normalizeText(character?.appearance),
      negative: negative || normalizeText(character?.negative || character?.negativePrompt),
    };
  });
  return {
    characters: merged,
    matchedTokens: merged.filter((character) => specs.has(normalizeToken(character?.token).toLowerCase())).map((character) => normalizeToken(character?.token)),
    missingRequired: Array.from(new Set(missingRequired)),
  };
}

export async function resolveServerCharacterBodySpecs({ env, userId, brandId, characters = [] }) {
  const selected = Array.isArray(characters) ? characters : [];
  if (!selected.length) return { characters: selected, source: "no-characters", matchedTokens: [], missingRequired: [] };
  if (!normalizeText(brandId)) {
    return {
      characters: selected,
      source: "client-no-brand-id",
      matchedTokens: selected.filter((character) => character?.appearance || character?.negative || character?.negativePrompt).map((character) => normalizeToken(character?.token)),
      missingRequired: [],
    };
  }
  const loaded = await loadBrandRecord(env, userId, brandId);
  if (!loaded.found) {
    const error = new Error("brand_body_spec_record_not_found");
    error.code = "BODY_SPEC_SOURCE_NOT_FOUND";
    throw error;
  }
  const merged = mergeCharacterBodySpecsFromBrand(selected, loaded.brand);
  if (merged.missingRequired.length) {
    const error = new Error(`character_body_spec_required:${merged.missingRequired.join(",")}`);
    error.code = "CHARACTER_BODY_SPEC_REQUIRED";
    error.tokens = merged.missingRequired;
    throw error;
  }
  return { ...merged, source: loaded.source };
}
