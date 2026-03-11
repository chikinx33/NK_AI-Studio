# NK_Studio Code Review Findings

## High

### Garbled source text is present in code and docs

Affected areas include prompt docs, UI copy, and server-side prompt builders.

Impact:

- prompt intent can drift
- Korean UI becomes unreliable
- future refactors are less safe because comments and strings are not trustworthy

## High

### Current project resolution was duplicated across modules

Previously, `script.js` and `pipeline.js` each resolved the active project independently from multiple sources.

Impact:

- page restore bugs
- wrong project loaded after navigation
- inconsistent save target for pipeline/server sync

Mitigation:

- shared project resolution has now started in `prototype/js/service/project.js`

## Medium

### `prototype/script.js` has excessive responsibility

It currently handles bootstrap, state restore, sidebar, dialogs, theme/lang propagation, auth UI, and project overlay behavior.

Impact:

- fragile initialization order
- hard to test
- hard to change safely

## Medium

### `prototype/ui/pipeline.js` mixes rendering with long-running workflow logic

Impact:

- difficult debugging
- repeated state writes
- hidden coupling between render and network behavior

## Medium

### Persistence model is not fully normalized

Current project-related state still spans:

- runtime state
- selected draft snapshot
- current project summary
- local draft list
- server snapshot
- pipeline cache

Impact:

- race conditions during restore
- stale titles or mismatched project IDs

## Medium

### API and local fallback behavior is powerful but hard to reason about

Examples:

- server fetch with local fallback
- auto upload on missing remote data
- reference fallback path loading

Impact:

- recovery behavior is implicit
- hidden writes can occur during load

## Next recommended verification

- manual navigation test across dashboard, scenario, scenes, and media
- confirm project selection survives refresh
- confirm a newly created project is the one saved by the production pipeline
- confirm deleting a project clears sidebar and active project state correctly
