// 제작 캔버스: 한 흐름으로 만든(디렉터 확정) 에피소드는 완성 영상을 첫 컷 영상 칸에 보이고, 컷 카드 글은 한 줄(넘치면 …)로(2026-10-14).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8").split("\r\n").join("\n");
const esbuild = createRequire(import.meta.url)("../../ai-company-app/node_modules/esbuild");
async function bundle(entry) {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nk-graph-")), "out.mjs");
  await esbuild.build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", outfile, logLevel: "silent" });
  return import(pathToFileURL(outfile).href);
}

const payload = {
  directorConfirmed: { sequences: [{ id: "s1", takeId: "t1" }, { id: "s2", takeId: "t9" }] },
  sequences: [
    { id: "s2", cuts: [{ id: "x" }], takes: [{ id: "t9", videoPath: "gs://b/users/u/v2.mp4" }] },
    { id: "s1", cuts: [{ id: "a" }, { id: "b" }, { id: "c" }], takes: [{ id: "t0", videoPath: "gs://b/draft.mp4" }, { id: "t1", videoPath: "gs://b/users/u/v1.mp4" }] },
  ],
};

test("완성 영상은 확정 순서대로 각 시퀀스의 첫 컷 자리에", async () => {
  const { directorWholeVideos, buildProductionGraph } = await bundle("prototype/functions/api/agent/production-graph.ts");
  const m = directorWholeVideos(payload);
  assert.deepEqual([...m.entries()], [[0, "gs://b/users/u/v1.mp4"], [3, "gs://b/users/u/v2.mp4"]]);
  assert.equal(directorWholeVideos({}).size, 0);

  const scenes = [1, 2, 3, 4].map((id) => ({ id, imagePath: `gs://b/users/u/${id}.png` }));
  const g = buildProductionGraph({ projectId: "p", payload, scenes });
  const cuts = g.nodes.filter((n) => n.type === "cut");
  assert.equal(cuts[0].data.clip.whole, true);
  assert.match(cuts[0].data.clip.url, /v1\.mp4/);
  assert.equal(cuts[0].data.clip.ref, "");
  assert.equal(cuts[1].data.clip.url, "");
  assert.equal(cuts[3].data.clip.whole, true);
  // 컷 영상 개수에는 넣지 않는다(컷별 영상이 아니다)
  assert.equal(g.summary.clips, 0);
  // 컷 자체 영상이 있으면 그걸 쓴다
  const own = buildProductionGraph({ projectId: "p", payload, scenes: [{ id: 1, videoPath: "gs://b/users/u/own.mp4" }] });
  assert.equal(own.nodes.find((n) => n.type === "cut").data.clip.whole, false);
});

test("컷 카드: 머리글·화면·행동 한 줄(넘치면 …), 완성본 배지", () => {
  const src = read("ai-company-app/src/components/ProductionCanvas.tsx");
  assert.match(src, /<Chip className="min-w-0 max-w-\[55%\] truncate" title=\{String\(n\.data\.cameraMove\)\}>/);
  assert.match(src, /<p className="truncate text-\[11px\] leading-snug text-secondary" title=/);
  assert.match(src, /<p className="mt-0\.5 truncate text-\[11px\] leading-snug text-muted" title=/);
  assert.match(src, /n\.data\.clip\?\.whole && !vd\.running/);
  assert.match(src, />완성본<\/Chip>/);
});
