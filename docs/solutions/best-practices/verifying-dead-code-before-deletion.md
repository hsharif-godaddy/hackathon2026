---
title: Verify dead-code deletions against invisible consumers
date: 2026-06-10
category: best-practices
module: app
problem_type: best_practice
component: development_workflow
severity: high
applies_when:
  - "Removing a dependency from package.json that a source grep finds no importer for"
  - "Deleting a module, file, or export during a dead-code or cleanup pass"
  - "Acting on dead-code-tool output (fallow, unused-export/unused-dep reports)"
  - "Local typecheck/lint/build pass but CI unit tests fail with `Cannot find package` or `Cannot find module`"
related_components:
  - cds
  - testing
tags:
  - dead-code
  - dependency-removal
  - cds
  - generated-files
  - monorepo
  - orphaned-tests
  - ci-failure
  - verification
---

# Verify dead-code deletions against invisible consumers

## Context

During a dead-code cleanup you remove a dependency or module because nothing seems to import it. The standard check — grep the committed TypeScript source for importers — returns zero hits, so it looks dead. Local `pnpm typecheck`, `lint`, and `build` all pass. You ship it. Then CI fails, or the app breaks at runtime, on something the grep never saw.

This is a verification-method failure, not a judgment failure. The grep answers the wrong question. "Does any committed `.ts/.tsx` import this?" is a proxy for the real question — "does the build or runtime resolve this?" — and the proxy diverges in predictable ways: generated artifacts that aren't committed, non-TS scripts wired through `package.json`, build-config dependency lists, runtime module-specifier strings, and orphaned test files.

One airo-app-builder cleanup (commit `701d4b867`, driven by `fallow dead-code --unresolved-imports`) produced **four** over-deletions this way — each invisible to a committed-source importer grep, each passing local checks. (session history)

## Guidance

The decisive question is **"does the build/runtime resolve it?"** — not "does committed source import it?" Restructure verification around that.

1. **Grep beyond committed `.ts/.tsx`.** Include `.js`, `.mjs`, `.cjs`, build configs, generator scripts, and `package.json` scripts. Do not exclude test files — that exclusion is exactly what hid `eventsource`. Reuse the comprehensive pattern from the pnpm-hoisting writeup rather than re-deriving it (see Related).

   ```bash
   # Insufficient (what failed): source-only, test-excluded
   grep -rn "axios" --include="*.ts" --include="*.tsx" app/src

   # Sufficient: every resolvable surface, no test exclusion
   grep -rnE "from ['\"]<pkg>['\"]|require\(['\"]<pkg>['\"]\)" . \
     --include="*.ts" --include="*.tsx" \
     --include="*.js" --include="*.mjs" --include="*.cjs" \
     --include="*.json" | grep -v node_modules
   ```

2. **Cross-check what the build actually resolves, not just what source mentions.** Two fast tells: does `origin/main` still declare the dep, and does a generator script or build config list it? If a generator emits a dep, the dep is required even with zero static importers.

   ```bash
   git show origin/main:app/package.json | grep <pkg>          # still on main?
   grep -rn "<pkg>" app/scripts/ --include="*.config.js" app/   # listed by a generator/config?
   ```

3. **Run the CI-equivalent build, which regenerates artifacts — do not trust local typecheck.** Local checks read stale committed/generated files; CI regenerates gitignored artifacts (like `app/cds/deps-esm.js`) fresh, which is when a missing dep surfaces. Run the unit tests that load the artifact chain.

4. **When deleting a module, delete its orphaned tests too, and grep test files for importers of the deleted path.** A surviving `foo.test.ts` after `foo.ts` is removed fails with `Cannot find module './foo'`.

   ```bash
   git rm src/hooks/useInbox.ts
   grep -rln "useInbox" --include="*.test.ts" --include="*.test.tsx" src/ | xargs -r git rm
   ```

5. **For CDS specifically:** externalized deps are declared in `app/scripts/generate-cds-deps.js` and `app/cds.host.esm.config.js`, and emitted into the gitignored `app/cds/deps-esm.js`. Verify against the real CDN registry hash — never `cdsVersion=local`, which hides externalization gaps. Runtime breakage (e.g. a deleted shim) shows up only there, not in typecheck. (auto memory [claude])

## Why This Works

The grep-the-TS-source check gives a false negative that survives every local gate, so failure lands in CI or production runtime — the most expensive places to find it. Checking what the build/runtime resolves closes the gap because it inspects the same surfaces the deploy does: generated artifacts, configs, scripts, and the actual dependency graph.

The four real over-deletions, all from one cleanup:

- **axios** — removed from `app/package.json`; no committed `.ts/.tsx` import. But `app/scripts/generate-cds-deps.js` lists it as a CDS-externalized dep and `app/cds.host.esm.config.js` references it. CI regenerated the gitignored `app/cds/deps-esm.js`, which imports axios → `Failed to resolve import "axios" from "cds/deps-esm.js"` / `Cannot find package 'axios'` → 8 app unit-test files failed (all load the CDS deps chain). Local typecheck/lint/build passed because `deps-esm.js` is not committed.
- **eventsource** — devDep used by `agents/tests/test-sse.js`, a standalone `.js` script wired via the `test:sse` package.json script. The `.test.`/`__tests__` exclusion in the importer grep skipped it.
- **cdsEventsShim.ts** — module deleted; broke the paywall modal at runtime with `Failed to resolve module specifier 'events'` / `Can't resolve '../src/lib/cdsEventsShim'` from the generated `deps-esm.js`. Invisible to typecheck; surfaced only on `pnpm run dev` and against the real CDN registry. (session history)
- **gray-matter** — removed from root `package.json`; `scripts/validate-skill.mjs` (a root `.mjs` script, run by the pre-commit hook) still imported it → `ERR_MODULE_NOT_FOUND`. The source grep missed the `.mjs` script. (session history)

Plus an orphaned test: **useInbox.test.ts** survived deletion of `useInbox.ts` → `Cannot find module './useInbox'`. Each was a real, resolvable dependency the proxy check declared dead.

## When to Apply

- Removing any dependency from a `package.json` during cleanup, especially in `app/` (CDS externalization) or any package with generator scripts or build configs.
- Deleting a module, hook, util, or shim — particularly anything imported by module-specifier strings (CDS shims, dynamic imports) rather than static `import` statements.
- Acting on dead-code-tool output. Treat "0 importers" as a hypothesis to confirm against the build, not a verdict. `fallow`'s `--unused-files` check does catch orphaned test files; its `--unused-deps` does not see generated-artifact or non-TS-script consumers. (session history)
- Any time local `typecheck/lint/build` pass but the change touches generated artifacts (`app/cds/deps-esm.js`), non-TS scripts, or runtime specifiers — run the CI-equivalent build before trusting the green.

## Examples

**Before — the trap (looks dead, isn't):**
```bash
$ grep -rn "axios" --include="*.ts" --include="*.tsx" app/src
# (0 results) → "unused" → removed from app/package.json
$ pnpm typecheck && pnpm lint && pnpm build   # all pass locally
# CI regenerates app/cds/deps-esm.js:
#   Failed to resolve import "axios" from "cds/deps-esm.js"
#   Cannot find package 'axios'
# → 8 app unit-test files fail
```

**After — the resolve-aware check (catches it):**
```bash
$ git show origin/main:app/package.json | grep axios          # main still declares it
"axios": "^1.16.0",
$ grep -rn "axios" app/scripts/generate-cds-deps.js \
        app/cds.host.esm.config.js                            # generator + config list it
app/scripts/generate-cds-deps.js: { specifier: 'axios', importName: 'axios', importPath: 'axios' },
# Verdict: required (CDS-externalized), do NOT remove.
```

**Orphaned test after module deletion:**
```bash
$ git rm src/hooks/useInbox.ts
$ pnpm test
# FAIL src/hooks/useInbox.test.ts → Cannot find module './useInbox'
$ grep -rln "useInbox" --include="*.test.ts" src/ | xargs -r git rm   # delete the orphan too
```

## Related

- `docs/solutions/build-errors/pnpm-workspace-hoisting-script-dependency.md` — the pnpm/root-script instance of this blind spot (gray-matter removed from root, `.mjs` script still imported it). Reuse its comprehensive grep pattern.
- `docs/solutions/integration-issues/cds-esm-events-polyfill-missing-from-import-map.md` — the cdsEventsShim instance; covers the generated-`deps-esm.js` / import-map externalization mechanics this generalizes.
- `docs/solutions/best-practices/feature-flag-cleanup-orphaned-artifacts-2026-03-31.md` — the under-deletion counterpart (orphans left behind) to this over-deletion pattern.
- `docs/solutions/best-practices/fallow-audit-scoped-to-pr-files.md` — scoping fallow output to PR-changed files; notes fallow's unused-dependency false positives.
