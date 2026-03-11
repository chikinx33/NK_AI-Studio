# NK_Studio Refactoring Priorities

## Priority 1: Encoding recovery

Goal: make prompts, UI strings, and docs trustworthy again.

Tasks:

- identify garbled files
- confirm expected encoding and editor settings
- convert source files to UTF-8
- restore broken Korean strings
- re-check prompt-related files first:
  - `docs/prompt-rules.md`
  - `prototype/functions/api/scenario.js`
  - `prototype/functions/api/video.ts`
  - `prototype/core.js`
  - `prototype/js/ui/dashboard.js`

Reason:

- broken Korean affects prompt quality directly
- broken UI copy slows validation and debugging
- this blocks safe refactoring because source intent is unclear

## Priority 2: Project context unification

Goal: one authoritative way to resolve the current project.

Tasks:

- move all current-project read/write rules into `prototype/js/service/project.js`
- stop reading `projectId`, `nk_selected_draft`, `nk_current_project`, and runtime state independently in UI modules
- make UI modules depend on service methods only

Status:

- started
- `script.js` and `pipeline.js` now use shared project resolution methods

Next targets:

- `prototype/js/ui/dashboard.js`
- `prototype/js/ui/scenario.js`
- `prototype/js/ui/post-production.js`
- `prototype/js/navigation.js`

## Priority 3: Split `script.js`

Goal: reduce top-level boot complexity and isolate responsibilities.

Suggested extraction:

- `app/bootstrap`
- `app/theme-sync`
- `app/stage-restore`
- `app/project-overlay`
- `app/sidebar`

Reason:

- current file mixes app init, UI behavior, and state restoration
- changes in one area can break unrelated page boot behavior

## Priority 4: Split `pipeline.js`

Goal: separate state orchestration from DOM rendering and asset generation.

Suggested extraction:

- project loading/sync
- scene row rendering
- image generation
- video generation and polling
- media modal helpers
- aspect-ratio fix utilities

Reason:

- current file is too large and mixes concerns heavily
- difficult to test and difficult to reason about regressions

## Priority 5: Persistence contract cleanup

Goal: define one canonical project payload and one sync strategy.

Needed decisions:

- local draft is cache or source of truth?
- when server and local differ, which wins?
- when should `nk_pipeline_last` be invalidated?
- should `currentProject` always contain full draft, never summary?

## Recommended execution order

1. encoding recovery
2. finish project context unification
3. extract `script.js`
4. extract `pipeline.js`
5. clean server/local persistence contract
