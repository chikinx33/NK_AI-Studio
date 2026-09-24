// 카피가 IP 와 안 어울리던 원인(2026-09-24): 리치 등 9명은 페르소나가 한 줄 폴백이었고, 브랜드 허브 정의는
// 직원이 스스로 brand_get 을 부를 때만 보였다. 이제 11명 전원 페르소나가 있고, 브랜드·IP 정의는 턴마다 한 번 읽어
// 모든 직원의 시스템 프롬프트에 들어간다. 지목한 산출물의 장면 설명도 참조 줄에 실린다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const AGENTS = ["core", "edge", "radar", "maki", "plot", "ink", "pixel", "beat", "engi", "reach", "sync"];

test("11명 전원에게 페르소나가 있고, 글·그림 담당의 페르소나가 IP·타깃·원본 수정 규칙을 담는다", async () => {
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  const block = orch.slice(orch.indexOf("export const AGENT_PERSONAS"), orch.indexOf("/** 라비오크 stripThink 포팅"));
  for (const id of AGENTS) assert.match(block, new RegExp(`\\n  ${id}: \\[`), `${id} 페르소나`);
  assert.match(block, /리치다[\s\S]*브랜드 허브\(브랜드·IP 정의\)의 보이스·톤·타깃·금지 표현·캐릭터 성격을 확인하고/);
  assert.match(block, /범용 명절 인사·어른 밈·직장 유머·술·연애 코드는 쓰지 않는다/);
  assert.match(block, /잉크다[\s\S]*범용 문장\(누가 써도 같은 문장\)은 실패다/);
  assert.match(block, /픽셀이다[\s\S]*image_edit 으로 그 원본을 수정한다/);
  assert.match(block, /플롯이다[\s\S]*컷 리듬은 절대 균등 분배하지 않는다/);
  assert.match(block, /화풍을 임의로 정하지 않는다/);
});

test("브랜드 허브 정의가 턴마다 한 번 읽혀 모든 직원의 시스템 프롬프트에 들어간다", async () => {
  const orch = await read("prototype/functions/api/agent/_orchestrator.ts");
  assert.match(orch, /export interface BrandBrief \{/);
  assert.match(orch, /export function toBrandBrief\(brandId: string, raw: any\): BrandBrief \| null/);
  assert.match(orch, /knowledgeCharacters/);
  assert.match(orch, /export async function loadBrandBriefs\(ctx: \{ request: Request; authHeader: string \}\)/);
  assert.match(orch, /\.slice\(0, 3\)/, "브랜드 최대 3개(서브요청 한도)");
  assert.match(orch, /export function brandsBlock\(brands: BrandBrief\[\] \| undefined\): string/);
  assert.match(orch, /등록된 브랜드 정의가 없습니다\. 온브랜드 카피·기획이 필요하면 지어내지 말고/);
  assert.match(orch, /카피·캡션·해시태그·기획·이미지\/영상 프롬프트는 반드시 이 정의를 따른다/);
  assert.match(orch, /\$\{projectsBlock\}\$\{brandsBlock\(opts\.companyBrands\)\}\$\{pendingBlock\}/, "시스템 프롬프트에 삽입");
  assert.match(orch, /const cachedBrands = toolCtx\?\.request \? await loadBrandBriefs\(\{ request: toolCtx\.request, authHeader: toolCtx\.authHeader \}\) : \[\];/);
  assert.match(orch, /companyBrands: cachedBrands,/);
  assert.match(orch, /companyBrands\?: BrandBrief\[\];/);
});

test("지목한 산출물의 참조 줄에 장면 설명(프롬프트)이 실린다", async () => {
  const shared = await read("prototype/functions/api/agent/_shared.ts");
  assert.match(shared, /const scene = String\(input\?\.prompt \|\| out\.promptEcho \|\| ""\)\.replace\(\/\\s\+\/g, " "\)\.trim\(\)\.slice\(0, 400\);/);
  assert.match(shared, /if \(scene\) parts\.push\(`장면="\$\{scene\.replace\(\/"\/g, "'"\)\}"`\);/);
});
