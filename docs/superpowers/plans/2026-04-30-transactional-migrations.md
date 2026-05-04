# Transactional + Idempotent Migrations

**Goal:** Make the customer-app migrations in `container-scripts/preview/sync-template-files.js` safe against mid-run failure. Specifically: **partial migration state is never committed**. If any migration throws, the uncommitted working-tree changes from this restart (manifest copies + whatever partial migration writes landed before the throw) are wiped by the next restart's `git reset --hard`, and sync re-runs idempotically.

Preserve idempotency so re-running converges naturally whether the previous run succeeded, was reverted, or partially-applied some safe cleanup.

**Model:** The transaction boundary is **the whole sync run at the restart-script level**, not per-migration. If any migration throws, `runMigrations` aborts immediately, `sync-template-files.js` exits non-zero, and `nomad_setup.sh`'s `set -e` skips the `git add . && git commit`. Partial working-tree state sits on disk until the next restart's `git reset --hard` — but it's never committed, never observed by a running app, and gets discarded before the next sync attempts.

The per-migration rollback / snapshot / `files[]` / `verify()` machinery from the earlier draft of this plan is dropped — redundant once we rely on the restart script's `git reset --hard` for the rollback and `set -e` for the "no commit on failure" invariant.

**Why this works:**

- `nomad_setup.sh` (restart path ~line 150) does: `git reset --hard` → `sync-template-files.js` → `git add . && git commit || true`.
- `set -e` is active in `nomad_setup.sh`. `sync-template-files.js` exiting non-zero aborts the script before the commit.
- Therefore: if migrations throw, the working-tree changes from this restart (including the `sync()` manifest copies) are not committed. Next restart's `git reset --hard` wipes them.
- On the next restart, `sync()` re-applies the manifest copies (hash-gated, idempotent) and `runMigrations` retries (state-gated, idempotent). Eventually converges or stays stuck on pre-sync state until the failing code is fixed.

**What this plan fixes vs what it explicitly does not:**

|                                                                              | Before                                 | After                                          |
| ---------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| Migration throws → partial state committed                                   | Yes (swallowed)                        | No (propagates to script exit)                 |
| HTML migrations run on half-migrated SSR app                                 | Yes (gate on `entry-server.tsx` alone) | No (gate on shared `isSsrInstalled` predicate) |
| `migrate-to-ssr-entry` leaves half-rewritten state if step 2 throws mid-step | Yes (per-step try/catch)               | No (throws propagate; restart-level reset)     |
| Idempotent re-run on already-migrated app                                    | Yes                                    | Yes                                            |
| Idempotent re-run after partial crash                                        | Yes                                    | Yes                                            |

**Non-goals:**

- Feature gate, rollout percent, or per-app allowlist.
- Changes to `sync()` itself (already covered by `git reset --hard` + deferred commit).
- Per-migration rollback. If you want the app to stay on pre-migration state, the whole sync run reverts via `git reset --hard`, not a Node-level snapshot.

---

## Design

### 1. The restart-script transaction boundary

Explicit contract that the rest of this plan relies on:

- `sync-template-files.js` either exits 0 (all migrations succeeded or were legitimately skipped / no-op) or non-zero (something threw).
- On non-zero exit, `set -e` in `nomad_setup.sh` aborts before the commit.
- Every migration must therefore:
  - **Throw** when the customer app is in a state the migration cannot safely handle and leaving the file mid-rewrite is unacceptable.
  - **Return `'skipped'`** when the migration's precondition isn't met and leaving the file untouched is the correct outcome (e.g., legacy app without `entry-server.tsx`).
  - **Return `'applied'`** on success, including when the body was a no-op because the target state was already reached.

This is the observable difference from today: we distinguish "can't safely proceed → throw and roll back the whole restart" from "no work needed or precondition not met → skip and continue."

**Status semantics (load-bearing — ops will read these events):**

- `'applied'` means the migration's `run` completed its work plan. That includes:
  - Genuine changes written (bare template → marked, `configure.js` deleted, etc.).
  - No writes needed because the target state was already reached (re-run on a migrated app).
  - **Safe partial writes on a customer-customized path.** Example: `migrate-to-ssr-entry` on an app with a customized `scripts.build` still cleans `vite-plugin-api-routes`/`esbuild` from deps (cleanup is safe regardless of build pipeline) but leaves the build script and `configure.js` untouched. That's the intended behavior, and the observable "is this app on SSR?" question is answered by `isSsrInstalled()` separately — so `'applied'` here means "migration did everything it could safely do," not "app is now on SSR."
- `'skipped'` means the body of `run` did not write anything — precondition-gated early-return. Examples: legacy app without `entry-server.tsx`; bare-template `entry.ts` with empty API dir (rewriting would drop the health handler import); HTML file missing required structural elements.

A reader who wants "is this app on SSR?" should not look at `.applied` vs `.skipped` — they should look at whether `isSsrInstalled()` subsequently returns true. The events describe the migration's behavior; the predicate describes the app's state.

### 2. Shared `isSsrInstalled()` predicate

Downstream HTML migrations (`inject-ssr-markers`, `strip-stale-index-title`) are currently gated on `existsSync('src/entry-server.tsx')`. That file is synced independently in the `ssrMigration` group, so it can land even when `migrate-to-ssr-entry` finished on its customized-`scripts.build` branch (safe dep-cleanup ran; build script + `configure.js` preserved because the custom pipeline still references them). The HTML migrations then run on an app that is NOT on SSR, injecting dead marker comments that no server replaces.

Replace the file-existence check with a predicate that answers "is SSR actually installed and running?" — the same post-state `migrate-to-ssr-entry` aims to produce:

```js
function isSsrInstalled(customerDir) {
  const entryPath = join(customerDir, "src/server/entry.ts");
  const entryServerPath = join(customerDir, "src/entry-server.tsx");
  const pkgPath = join(customerDir, "package.json");
  const configurePath = join(customerDir, "src/server/configure.js");

  if (!existsSync(entryServerPath)) return false;
  if (!existsSync(entryPath)) return false;
  if (existsSync(configurePath)) return false;

  const entry = readFileSync(entryPath, "utf8");
  if (!/\/\/ <api-imports>[\s\S]*?\/\/ <\/api-imports>/.test(entry))
    return false;
  if (!/\/\/ <api-registrations>[\s\S]*?\/\/ <\/api-registrations>/.test(entry))
    return false;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.scripts?.build?.includes("--ssr")) return false;
    if (pkg.dependencies?.["vite-plugin-api-routes"]) return false;
    if (pkg.devDependencies?.["vite-plugin-api-routes"]) return false;
  } catch {
    return false;
  }

  return true;
}
```

The predicate is used by:

- `inject-ssr-markers`: before injecting markers, require `isSsrInstalled(customerDir) === true`. Otherwise `return 'skipped'`.
- `strip-stale-index-title`: same gate.
- (Optionally) `migrate-to-ssr-entry` itself: if `isSsrInstalled` is already true at the top, return `'skipped'` without re-parsing.

A migration body throwing for parse errors inside `isSsrInstalled` is wrong — the predicate is a cheap read-only check and must return a boolean, never throw. (That's why the `JSON.parse` is inside a try/catch returning false, not propagating.)

### 3. Remove inner try/catch from migrations

Each SSR migration today has one or more internal try/catch blocks that log-and-continue. Remove them so errors propagate:

- `migrate-to-ssr-entry`: remove the three try/catch wrappers around step 1 (`entry.ts`), step 2 (`package.json`), step 3 (`configure.js` delete).
- `inject-ssr-markers`: remove the outer try/catch.
- `strip-stale-index-title`: remove the outer try/catch.
- Pre-existing migrations (`remove-bundle-js-build-step`, `remove-public-assets-gitignore`): audit and remove any `try/catch` that swallows errors. If they throw today and are caught only by `runMigrations`, the next item takes care of that.

Critically, preserve the **non-throwing early-returns** that exist today for customer-customized apps — those are correct behavior. Per §1 status semantics, the right status depends on whether `run` wrote anything:

- `return 'skipped'` (body wrote nothing):
  - `migrate-to-ssr-entry` when `entry.ts` has an unexpected shape (not bare template, not marked block) — nothing was written.
  - `migrate-to-ssr-entry` when `entry.ts` is bare and the API dir is empty — can't safely rewrite, nothing written.
  - `inject-ssr-markers` when the empty `<div id="app"></div>` is missing (customer already put content in there) — nothing written.
  - `inject-ssr-markers` when `</head>` is missing (malformed HTML) — nothing written.
- `return 'applied'` (body performed safe writes even though SSR isn't fully installed):
  - `migrate-to-ssr-entry` when `scripts.build` is a customized pipeline that doesn't normalize to `vite build` — dep cleanup ran, build script + `configure.js` preserved.

These are "this app cannot be fully migrated right now, do what's safe and move on" — the customer will finish the migration manually if they care, or the app's on-disk state is already correct for them. Throwing on those would loop the entire restart.

### 4. Remove the swallow in `runMigrations`

Today:

```js
for (const migration of MIGRATIONS) {
  console.log(`Migration: ${migration.id} — ${migration.description}`);
  try {
    migration.run(customerDir, syncedFiles);
  } catch (error) {
    console.error(`  ⚠️  Migration failed: ${...}`);
  }
}
```

Replace with:

```js
function runMigrations(customerDir, syncedFiles) {
  console.log("");
  console.log("=== Running Migrations ===");

  for (const migration of MIGRATIONS) {
    console.log(`Migration: ${migration.id} — ${migration.description}`);
    const start = Date.now();
    let status = "applied";
    try {
      const result = migration.run(customerDir, syncedFiles);
      if (result === "skipped") status = "skipped";
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(
        JSON.stringify({
          event: `migration.${migration.id}.failed`,
          migrationId: migration.id,
          durationMs: Date.now() - start,
          error: errorMsg,
        }),
      );
      throw error; // aborts runMigrations; sync exits non-zero; nomad_setup.sh skips commit
    }
    console.log(
      JSON.stringify({
        event: `migration.${migration.id}.${status}`,
        migrationId: migration.id,
        durationMs: Date.now() - start,
      }),
    );
  }
}
```

The explicit `throw` re-raise is the pivot point: this is where we stop swallowing. Everything downstream (sync-template-files.js main, nomad_setup.sh) is already set up to treat a non-zero exit as "don't commit." We just have to stop eating the error.

### 5. Structured log events

Three events emitted per migration, one event per run:

- `migration.<id>.applied` — ran successfully (including no-op cases where the body made no changes because the target state was already reached). Includes `durationMs`.
- `migration.<id>.skipped` — precondition not met; body wrote nothing (legacy app without SSR sentinel, bare-template `entry.ts` with empty API dir, ambiguous HTML, etc.). Includes `durationMs`.
- `migration.<id>.failed` — threw. Includes `durationMs` and `error`. Emitted once, before the re-raise.

Ops can alert on repeated `.failed` events for the same `migrationId` (signals a broken migration in the fleet), and on a rising rate of `.skipped` (signals many customer-customized apps diverging from the template).

### 6. Failure contract (explicit)

Every migration obeys:

| Situation                                                                                                                                           | Action                                                | Log event               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------- |
| Target state already reached                                                                                                                        | Proceed; body is no-op; return `'applied'`            | `.applied`              |
| Applied change successfully                                                                                                                         | Proceed; return `'applied'`                           | `.applied`              |
| Customer-customized path; only safe writes performed (e.g. dep cleanup with custom build script preserved)                                          | Proceed; return `'applied'` (see §1 status semantics) | `.applied`              |
| Precondition not met and body writes nothing (legacy app without SSR sentinel, bare-template entry.ts with empty API dir, ambiguous HTML structure) | `return 'skipped'`                                    | `.skipped`              |
| Filesystem error, JSON parse error mid-rewrite, any unexpected state                                                                                | `throw`                                               | `.failed` then re-raise |

And the script-level contract:

- `runMigrations` calls migrations in array order.
- On first throw, `runMigrations` re-raises.
- `sync-template-files.js` exits non-zero.
- `nomad_setup.sh`'s `set -e` skips `git add . && git commit`.
- Next restart's `git reset --hard` discards the uncommitted working-tree state.

### 7. What stays idempotent

All existing state-based gates in migration bodies stay:

- `migrate-to-ssr-entry` detects marked-block vs bare-template shape of `entry.ts` and rewrites in place.
- `inject-ssr-markers` short-circuits when both markers already present.
- `strip-stale-index-title` short-circuits when no bare `<title>` exists.

Adding `isSsrInstalled()` as a stronger gate for HTML migrations tightens the precondition; it does not change idempotency. A re-run on a successfully migrated app: `isSsrInstalled` → true, both markers present → `strip-stale-index-title` gate passes but no `<title>` to strip → return `'applied'` with no writes.

---

## File Structure

- `container-scripts/preview/sync-template-files.js`
  - Add `isSsrInstalled(customerDir)` helper.
  - Strip inner try/catch from each migration.
  - Retain non-throwing early-returns for customer-customized shapes; change them to `return 'skipped'` when no writes happened, `return 'applied'` when only safe writes happened (see §1 status semantics).
  - Replace `inject-ssr-markers` and `strip-stale-index-title` `existsSync(entry-server.tsx)` gates with `isSsrInstalled(customerDir)`.
  - Replace `runMigrations` body with the re-raising version from §4, including structured event logs.
- `agents/src/utils/__tests__/sync-migrations.test.ts`
  - Keep existing idempotency + partial-crash + customized-app coverage.
  - Add new tests per §Tasks.

No new helper file, no snapshot/restore primitives, no `files[]` declarations.

---

## Tasks

### Task 1: Add `isSsrInstalled()` predicate

**Files:**

- Modify: `container-scripts/preview/sync-template-files.js`

- [ ] Add `isSsrInstalled(customerDir)` as a top-level function above the `MIGRATIONS` array. Body per §2. Never throws: wraps JSON.parse in try/catch that returns false.
- [ ] Export via the existing ESM exports if tests need direct access.

### Task 2: Tighten HTML migration gates

**Files:**

- Modify: `container-scripts/preview/sync-template-files.js`

- [ ] In `inject-ssr-markers.run`, replace the `existsSync(entry-server.tsx)` gate with `isSsrInstalled(customerDir)`. Early-return path becomes `return 'skipped'`.
- [ ] In `strip-stale-index-title.run`, same replacement.
- [ ] Update the existing "synced index.html" early-return (`if (syncedFiles.has('index.html')) return;`) to also return `'skipped'` — it's a precondition miss, not an implicit success.

### Task 3: Remove inner try/catch; convert early-returns to `'skipped'`

**Files:**

- Modify: `container-scripts/preview/sync-template-files.js`

- [ ] `migrate-to-ssr-entry`: remove the three try/catch wrappers. Convert the top `existsSync(entryServerPath)` guard to `return 'skipped'`.
- [ ] `migrate-to-ssr-entry`: split the "No API handlers found" early-return based on current entry.ts shape:
  - If `alreadyMarked` (entry.ts is post-migration with marked blocks, just no routes to register) → `return 'applied'`. The target shape is preserved; downstream `isSsrInstalled()` will evaluate normally.
  - If `bareTemplate` (entry.ts still has the pre-migration `healthGet` import) → `return 'skipped'`. Rewriting bare → marked without routes would drop the health import and leave entry.ts unrunnable. Migration cannot safely install SSR here.
- [ ] `migrate-to-ssr-entry`: convert "entry.ts does not match expected template markers" branch to `return 'skipped'` (customer customized; unsafe to rewrite).
- [ ] `migrate-to-ssr-entry`: the customized-`scripts.build` branch performs safe dep-cleanup writes (removing `vite-plugin-api-routes`, `esbuild`) and then leaves build script + `configure.js` alone. That is the migration's intended behavior for this shape, so the whole migration returns `'applied'` (see status semantics in §1). `isSsrInstalled()` will subsequently return false because `configure.js` remains, correctly gating downstream HTML migrations.
- [ ] `inject-ssr-markers`: remove outer try/catch. Each early-return that represents "can't safely proceed" becomes `return 'skipped'`.
- [ ] `strip-stale-index-title`: remove outer try/catch. Early-returns for missing file / missing marker / no title → `return 'skipped'`.
- [ ] Pre-existing `remove-bundle-js-build-step` and `remove-public-assets-gitignore`: audit, strip inner try/catch if present, align with `'skipped' | 'applied'` return contract.

### Task 4: Replace `runMigrations` with re-raising version

**Files:**

- Modify: `container-scripts/preview/sync-template-files.js`

- [ ] Replace `runMigrations` body with §4's version.
- [ ] Verify that the existing human-readable console logs are preserved alongside the new JSON event lines (both useful — humans scan the former, Loki filters the latter).
- [ ] Confirm `sync()` still calls `runMigrations` after the manifest pass and that any throw propagates to Node's top-level (causing non-zero exit).
- [ ] Export `runMigrations` as a named ESM export so the failure-propagation tests (Task 5) can invoke it directly with a seeded `customerDir` + `syncedFiles` and an fs spy. `MIGRATIONS` is already exported; adding `runMigrations` keeps the test surface explicit rather than going through `sync()` and mocking the manifest pass.

### Task 5: Tests — failure propagation

**Files:**

- Modify: `agents/src/utils/__tests__/sync-migrations.test.ts`

- [ ] Test: a migration thrown by an fs spy (e.g. `writeFileSync` throws) propagates out of `runMigrations`. Spy on `console.log` and assert a `migration.<id>.failed` JSON event was logged.
- [ ] Test: a later migration does NOT run after an earlier one throws.
- [ ] Test: non-throwing success logs `migration.<id>.applied` with `durationMs` as a number.
- [ ] Test: non-throwing `'skipped'` logs `migration.<id>.skipped` with `durationMs`.

### Task 6: Tests — dependency gate via `isSsrInstalled()`

**Files:**

- Modify: `agents/src/utils/__tests__/sync-migrations.test.ts`

- [ ] Test: `isSsrInstalled()` returns false for every combination of (missing entry-server.tsx / missing entry.ts / configure.js present / entry.ts missing markers / scripts.build lacks --ssr / vite-plugin-api-routes still in deps / malformed package.json).
- [ ] Test: `isSsrInstalled()` returns true only when all conditions are met.
- [ ] Test: `inject-ssr-markers` on an app where `entry-server.tsx` exists but `isSsrInstalled()` is false (e.g. customer has customized `scripts.build` so `migrate-to-ssr-entry` returned `'applied'` with only safe dep-cleanup writes and `configure.js` preserved) → markers are NOT injected; `migration.inject-ssr-markers.skipped` logged. This is the core dependency-bug regression test.
- [ ] Test: `strip-stale-index-title` same coverage.

### Task 7: Tests — customized-app safety preserved

**Files:**

- Modify: `agents/src/utils/__tests__/sync-migrations.test.ts`

- [ ] Extend existing `preserves customised build scripts and keeps configure.js` to additionally assert: `migrate-to-ssr-entry` returns `'applied'` and emits the `.applied` event (safe dep-cleanup writes happened, build script + `configure.js` preserved — see §1 status semantics). Subsequent `inject-ssr-markers` / `strip-stale-index-title` return `'skipped'` because `isSsrInstalled()` is false (configure.js still present → predicate false).
- [ ] Test: `migrate-to-ssr-entry` on an already-migrated app (all post-conditions met) returns `'applied'` and performs no writes. Assert via an fs spy on `writeFileSync` / `unlinkSync` that no writes or deletes occurred (more deterministic than mtime, which has filesystem-resolution flakiness).

### Task 8: Tests — idempotency + partial-crash recovery

**Files:**

- Modify: `agents/src/utils/__tests__/sync-migrations.test.ts`

- [ ] Existing tests stay green (`is idempotent on already-marked entry.ts`, `recovers from a partial-crash where step 1 landed but step 2 did not`, `treats an already-SSR build script as a converged state`).
- [ ] Add: starting from a manually induced partial state (e.g. `entry.ts` is marked but `package.json` still has legacy build script), running the full `runMigrations` sequence converges to fully-migrated state without errors.

### Task 9: Verify end-to-end

- [ ] `pnpm --filter @airo/agents test:unit "sync-migrations"` — all existing + new tests pass.
- [ ] `pnpm typecheck && pnpm lint`.
- [ ] Local dry-run against a seeded customer dir representing a legacy app: verify the full sequence converges, logs show `.applied` for each migration, final state matches `isSsrInstalled() === true`.
- [ ] Forced-failure dry-run: patch one migration locally to throw; verify `runMigrations` re-raises, structured `.failed` event is emitted once, subsequent migrations do not run, `sync-template-files.js` exits non-zero.

---

## Rollout

Ships as part of the existing `deverton/ssr-seo-foundation` branch / PR #3184. Purely a correctness improvement over what's already being reviewed. No release sequencing.
