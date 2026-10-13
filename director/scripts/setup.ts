// 디렉터 에이전트·환경·스킬을 Anthropic 에 만들거나 갱신한다(제어면). 실행할 때마다 새로 만들지 않고
// claude-lock.json 의 ID 로 update 한다(에이전트는 새 버전, 스킬은 새 버전).
//   ANTHROPIC_API_KEY=… PUBLIC_BASE_URL=https://nk-director-….run.app node dist/scripts/setup.js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic, { toFile } from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");               // director/
const lockPath = path.join(root, "claude-lock.json");
const skillDir = path.join(root, "skills", "nk-cf-director");
const systemPrompt = fs.readFileSync(path.join(root, "agent", "system.md"), "utf8");
const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
if (!publicBase) throw new Error("PUBLIC_BASE_URL 이 필요합니다(Cloud Run 서비스 주소).");
const mcpUrl = `${publicBase}/mcp`;
const ENV_NAME = "nk-director-env";
const AGENT_NAME = "NK Director";

type Lock = { environmentId?: string; skillId?: string; skillVersion?: string; agentId?: string; agentVersion?: number; mcpUrl?: string };
const lock: Lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : {};
const client = new Anthropic();

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

async function skillFiles() {
  return Promise.all(walk(skillDir).filter((p) => !/__pycache__|\.pyc$/.test(p)).map(async (p) => {
    const rel = path.relative(path.dirname(skillDir), p).split(path.sep).join("/"); // nk-cf-director/…
    return toFile(fs.readFileSync(p), rel);
  }));
}

async function ensureEnvironment(): Promise<string> {
  const config: any = {
    type: "cloud",
    packages: { apt: ["ffmpeg"], pip: ["numpy", "scipy", "matplotlib", "faster-whisper"] },
    networking: {
      type: "limited",
      allow_package_managers: true,
      allow_mcp_servers: true,
      // 서명 URL 로 영상·이미지를 받고 올린다. faster-whisper 모델은 Hugging Face 에서 받는다.
      allowed_hosts: ["storage.googleapis.com", "huggingface.co", "*.huggingface.co", "*.hf.co"],
    },
  };
  if (lock.environmentId) {
    await client.beta.environments.update(lock.environmentId, { config } as any);
    return lock.environmentId;
  }
  for await (const env of client.beta.environments.list()) {
    if ((env as any).name === ENV_NAME) { await client.beta.environments.update(env.id, { config } as any); return env.id; }
  }
  const env = await client.beta.environments.create({ name: ENV_NAME, config } as any);
  return env.id;
}

async function ensureSkill(): Promise<{ id: string; version: string }> {
  const files = await skillFiles();
  if (lock.skillId) {
    const v = await client.skills.versions.create(lock.skillId, { files });
    return { id: lock.skillId, version: v.id };
  }
  const s = await client.skills.create({ files, display_name: "nk-cf-director" });
  return { id: s.id, version: s.latest_version_id };
}

async function ensureAgent(skill: { id: string; version: string }): Promise<{ id: string; version: number }> {
  const paid = ["video_submit", "video_complete", "image_generate"];
  const body: any = {
    name: AGENT_NAME,
    description: "nkstudio.org 대화형 CF 연출 디렉터 — Seedance 2.5 시퀀스 생성·검수·편집기 연동",
    model: { id: "claude-opus-5-5", effort: "high" },
    system: systemPrompt,
    tools: [
      {
        type: "agent_toolset_20260401",
        // 샌드박스는 세션마다 격리돼 있고 외부 접속이 제한돼 있어 파일·bash 도구는 바로 실행한다.
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        configs: [{ name: "web_fetch", enabled: false }, { name: "web_search", enabled: false }],
      },
      {
        type: "mcp_toolset",
        mcp_server_name: "nk-studio",
        default_config: { enabled: true, permission_policy: { type: "always_allow" } },
        // 돈이 드는 생성은 사용자가 화면에서 승인해야 실행된다.
        configs: paid.map((name) => ({ name, permission_policy: { type: "always_ask" } })),
      },
      {
        // 사용자 화면이 실행하는 도구: 선택지를 버튼으로 띄우고 고른 답을 돌려준다(세션은 답이 올 때까지 기다린다).
        type: "custom",
        name: "ask_user",
        description: "사용자에게 결정을 받을 때 쓴다(안 고르기, 구도·스타일·길이 확인, 다음 단계 제안). 화면에 선택지 버튼으로 뜨고, " +
          "사용자가 고른 답이 결과로 온다. 화면이 '건너뛰기'·'직접 입력'·'취소'를 자동으로 붙이므로 선택지에 넣지 않는다. " +
          "권장안은 첫 번째에 두고 recommended:true. 질문 1~4개를 한 번에 묻는다. 비교 표·근거는 이 도구를 부르기 전 답변에 쓴다.",
        input_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array", minItems: 1, maxItems: 4,
              items: {
                type: "object",
                properties: {
                  question: { type: "string", description: "질문 문장(물음표로 끝나게)" },
                  header: { type: "string", description: "짧은 꼬리표(12자 이내), 예: 다음 단계·구도·스타일" },
                  multiSelect: { type: "boolean", description: "여러 개를 고를 수 있으면 true" },
                  options: {
                    type: "array", minItems: 2, maxItems: 4,
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string", description: "버튼 글자(짧게). 비용이 들면 예상 크레딧을 괄호로" },
                        description: { type: "string", description: "이 선택이 무엇을 하는지·장단점 한두 문장" },
                        recommended: { type: "boolean" },
                      },
                      required: ["label"],
                    },
                  },
                },
                required: ["question", "options"],
              },
            },
          },
          required: ["questions"],
        },
      },
    ],
    mcp_servers: [{ type: "url", name: "nk-studio", url: mcpUrl }],
    // 버전을 고정하지 않는다 → 세션은 최신 스킬을 쓴다(스킬 문서를 고치면 setup 한 번으로 반영).
    skills: [{ type: "custom", skill_id: skill.id }],
    metadata: { service: "nk-director" },
  };
  if (lock.agentId) {
    const a: any = await client.beta.agents.update(lock.agentId, body);
    return { id: a.id, version: a.version };
  }
  const a: any = await client.beta.agents.create(body);
  return { id: a.id, version: a.version };
}

const environmentId = await ensureEnvironment();
console.log("environment", environmentId);
const skill = await ensureSkill();
console.log("skill", skill.id, skill.version);
const agent = await ensureAgent(skill);
console.log("agent", agent.id, "version", agent.version);
const next: Lock = { environmentId, skillId: skill.id, skillVersion: skill.version, agentId: agent.id, agentVersion: agent.version, mcpUrl };
fs.writeFileSync(lockPath, JSON.stringify(next, null, 2) + "\n");
console.log(`claude-lock.json 갱신. Cloud Run 환경 변수: DIRECTOR_AGENT_ID=${agent.id} DIRECTOR_ENVIRONMENT_ID=${environmentId}`);
