---
title: Review Catches What Plans Miss
date: 2026-05-08
module: paywall
category: workflow-issues
problem_type: workflow_issue
component: development_workflow
severity: medium
applies_when:
  - Multi-iteration integration work against shared infra (CDS ESM, auth shims, bridge code)
  - Plan covers primary flow but not runtime modes (StrictMode, local:dev vs local:test vs local:prod)
  - Work depends on ordering in an immediate upstream module not read during planning
  - Fire-and-forget paths (preloaders, cache warmers) whose silent failure mimics silent success
related_components:
  - testing_framework
  - tooling
tags:
  - planning
  - code-review
  - retrospective
  - test-matrix
  - upstream-dependencies
  - adversarial-review
---

# Review Catches What Plans Miss

## Context

PR [#3126](https://github.com/gdcorp-partners/airo-app-builder/pull/3126) (feat/upp-esm-conversion) fixed paywall modals broken by Next.js 16's React 19 canary. 29 files, ~1558 non-lock lines, 30 iteration commits across a week. The author ran `pnpm dev` repeatedly and saw modals open. Cross-referenced three repos. Browser-verified against test CDN hash `33dcd35`.

A 12-persona adversarial review then found 20 findings. 4 P1, 11 P2, 5 P3. Three P1s hit cross-reviewer convergence: StrictMode `mountedRef` early-return, `warmCache` import-map race, `cdsVersion` leak in `local:test`/`local:prod`.

The 6 "genuine misses" (excluding scope-deferred and polish findings) share a signature. Each required stepping OUT of the author's working context into a neighboring one: StrictMode (not plain dev), `local:test`/`local:prod` (not `local:dev`), cds-loader internals (not our repo), double-mutation cascades (not single-mutation), empty-registry edge (not populated-registry), loaderMode drift (not current behavior).

Call this **cross-context blind spots**. Iteration did not catch them because iteration stays inside the working context. Planning did not catch them because planning optimized "what do we build to hit the goal?" not "what adjacent context breaks this?"

The same pattern showed up earlier in the arc (session history): a mixed-content red herring cost hours of debugging when the actual cause was 5 `@ux/*` transitive deps missing from an import map because UPP was pre-built with `cds-cli@0.0.88` instead of `0.0.91`. The failure was visible only by reading cds-cli's condition-matching stage end-to-end. (session history)

## Guidance

### 1. Explicit test matrix in the plan

Before writing code, enumerate the axes the change crosses. Each row is a scenario; columns are env-flags and conditions. For PR 3126 the matrix would have read:

| Scenario | StrictMode | GASKET_ENV | NODE_ENV | CDS version source |
|---|---|---|---|---|
| local:dev | on | local.dev | development | local stub |
| local:test | on | local.test | development | remote registry |
| local:prod | off | local.prod | development | remote registry |
| Nomad prod | off | production | production | remote registry |

A row for `local:test` would have surfaced the `cdsVersion` leak immediately. A StrictMode column would have forced the author to ask "does my run-once guard survive double-invoke?" during self-review.

### 2. Source-read the immediate upstream dependency

When code polls, subscribes to, or relies on ordering in a third-party lib, read that lib's relevant path end-to-end before calling it done. For PR 3126, 30 minutes reading `@venture/cds-loader`'s `setupImportMap` (esm-loader.js:1379 to 2149) would have exposed the gap between `window.__CDS_IMPORT_MAP_SETUP__ = true` (sync flag at line 1379) and the import-map `<script>` attachment plus bare-specifier resolution (async, later in the `setupPromise` IIFE). No amount of iterating on our code reveals that ordering.

The same rule caught a different case during the arc: the CDS team's clarification that CDS #271's `afterResolve` hook was redundant with #269's `byDependency.commonjs` because the two handle the same `@babel/runtime/helpers/esm` resolution problem at condition-match stage. Reading the upstream PRs end-to-end avoided shipping a redundant Airo-side workaround. (session history)

### 3. Adversarial reviewer mid-plan, not only at PR

Run an adversarial persona pass once the plan has shape but before implementation locks in. Prompt it to find cascade modes, silent success, env-gated drift. Finding #12 in the PR 3126 review (empty-registry reporting success because `setupPromise` flags `__CDS_IMPORT_MAP_SETUP__=true` synchronously before the promise rejects) is exactly the shape an adversary catches and a builder misses.

The mid-plan pass is cheap: one agent, ~5 minutes, targeted at the specific integration points. It is not a replacement for PR-time review — it is a pre-implementation cost-shift so the issues surface before 30 commits of iteration lock them in.

## Why This Matters

Planning and iteration run the same cognitive mode: forward construction toward a goal. Review runs backward: given this artifact, what fails?

Forward mode optimizes for the context you chose. It does not ask "what if the context is different?" StrictMode double-invoke is the cleanest example. `mountedRef.current = true` looks like a textbook run-once guard. It passes every dev test because StrictMode-on-dev double-invoke cancels the first effect's timers via cleanup, then short-circuits the second effect via the ref. Timers never rearm. Invisible in the mode the author was in.

Same shape for CdsEsmPreload outside the paywall ErrorBoundary (one line after `</ErrorBoundary>`): forward mode reads "mount preload near the target"; review mode reads "what blast radius does this component have if it throws?" A one-line placement slip turns a best-effort cache warm into a page crash.

Even the fix application step is vulnerable. The `__CDS_IMPORT_MAP_PROMISE__` fix to the warmCache race was silently neutralized in this session — the fixer claimed `cds-loader@0.0.86` exposes the promise, but a runtime probe showed `undefined`. The fallback to `Promise.resolve()` restored pre-fix behavior. Without the browser verification step, we would have shipped "a fix" that was actually a no-op. (session history)

## When to Apply

Fires when at least one of:

- Integrating a third-party lib your repo does not own, especially one with runtime initialization ordering.
- Environment-gated behavior: `NODE_ENV`, `GASKET_ENV`, StrictMode, `local:*` variants, feature flags that change which code path runs.
- Shim or bridge code between two systems' conventions (UMD and ESM, React 18 and 19, two auth models). (see [config-before-shim feedback] — auto memory [claude])
- Fire-and-forget performance paths: preloaders, cache warmers, background initializers whose silent failure mimics silent success.
- Assertion gaps in test mocks where the new contract is not locked in (e.g., `ComponentLoader` tests that never assert `type='…Esm'` or `loaderMode='esm'`).

## Examples

**Before (PR 3126 baseline).** Plan reads "convert UMD to ESM, add CdsEsmPreload, verify modals open in dev." 30 iteration commits. Review finds 20.

**After (retrospective applied).** Plan includes:

- Test matrix across StrictMode on/off and `local:dev`/`local:test`/`local:prod`/Nomad-prod. `local:test` row includes explicit "cdsVersion resolves to remote registry version, not `'local'`" assertion.
- Planning step: read `cds-loader`'s `setupImportMap` end-to-end, document the sync flag versus async import-map attachment gap, design `warmCache` to await `setupPromise` not poll the flag.
- Mid-plan adversarial pass targeting cascade modes. Prompts: "what if registry is empty?", "what if MutationObserver fires twice?", "what if the preload throws?"
- Assertion-contract row in each container test: `ComponentLoader` mock asserts the new `type` and `loaderMode` so a revert to UMD fails loudly.

Sample test-matrix row that would have caught the `cdsVersion` leak:

```ts
describe('cdsVersion resolution per GASKET_ENV', () => {
  it.each([
    ['local.dev', 'local-stub'],
    ['local.test', 'remote-registry'],
    ['local.prod', 'remote-registry'],
  ])('%s resolves to %s', (env, expected) => {
    // ...
  })
})
```

The `local.test` row fails on the pre-fix code because the layout Script wrote `cdsVersion='local'` whenever `NODE_ENV=development`, which is true for all three `pnpm local:*` commands. Planning surfaces the gap before implementation.

Sample mid-plan adversarial prompt that would have caught the empty-registry silent success:

> The plan includes a hidden `<CdsComponentLoader>` that polls `window.__CDS_IMPORT_MAP_SETUP__` and fires `callWarmCache(registry)` on flip. List every state where the flag can become true but warmCache silently no-ops. Which of those states report success to the user? Which emit no analytics?

## Related

- [`cds-esm-react19-compat-shims-2026-04-23.md`](../best-practices/cds-esm-react19-compat-shims-2026-04-23.md) — the technical design doc for PR 3126 (complementary angle; *what* shipped vs. *what we missed*)
- [`nextjs16-vendored-react-canary-breaks-cds-upp.md`](../best-practices/nextjs16-vendored-react-canary-breaks-cds-upp.md) — the root-cause narrative that triggered PR 3126
- [`smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md`](../developer-experience/smoke-test-cds-esm-against-prod-cdn-from-local-dev-2026-05-08.md) — documents the `NODE_ENV=development` leak into `local:test` that the test-matrix rule would have caught
- [`shared-api-blast-radius-assessment-2026-04-28.md`](../best-practices/shared-api-blast-radius-assessment-2026-04-28.md) — sibling pattern (reviewer caught 7 other issues); this doc generalizes to *why* it happens
- [`split-large-parallel-subagent-branches-into-focused-prs-2026-04-16.md`](../best-practices/split-large-parallel-subagent-branches-into-focused-prs-2026-04-16.md) — complementary prescription (split PRs) for the same tension (planning/execution speed vs. review quality)
- [`verify-subagent-claims-before-relaying-2026-04-28.md`](../best-practices/verify-subagent-claims-before-relaying-2026-04-28.md) — the `__CDS_IMPORT_MAP_PROMISE__` silent-neutralization incident in this session is a direct instance
- PR [#3126](https://github.com/gdcorp-partners/airo-app-builder/pull/3126) — source of the retrospective
