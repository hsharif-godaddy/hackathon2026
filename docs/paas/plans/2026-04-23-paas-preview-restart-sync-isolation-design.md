# PaaS Preview Restart Sync Isolation

## 1. Summary

The preview container's restart-time setup script (`container-scripts/preview/nomad_setup.sh`) unconditionally re-applies template files from the base Docker image on every restart. This behavior was introduced in [PR #1515](https://github.com/gdcorp-partners/airo-app-builder/pull/1515) to keep AAB customer apps continuously patched against upstream template drift. For **PaaS** apps, the same logic is corrupting customer code: every restart mutates `package.json`, overwrites hash-matched source files (`App.tsx`, `vite.config.ts`, `RootLayout.tsx`, …), and commits the mutations to the customer's own git history.

The fix is to detect PaaS allocations inside `nomad_setup.sh` and short-circuit the entire RESTART path for them, while preserving a minimum viable `node_modules` recovery path that honors the customer's package manager.

### 1.1 Why this is surfacing now (and why it was hard to catch earlier)

A PaaS container can reach the RESTART path from four distinct triggers. The customer's upload can succeed cleanly and the app can break hours or days later:

1. **Provisioning.** First container boot. `.git/config` absent → FIRST-START runs → no corruption, because we're populating an empty directory which is exactly what FIRST-START is designed for.
2. **ZIP / git-pull upload.** `ProjectImportService.processImport()` extracts, writes `.airo/config.json`, commits to `main`, then issues a restart. On the next boot `.git/config` is present → RESTART path fires against fresh customer code. _First point at which corruption can occur._
3. **Task crash / Nomad reschedule.** Any non-graceful termination reschedules the allocation; the new container boots, hits RESTART, and sync runs against whatever state is currently committed (possibly already polluted from a prior restart).
4. **Fleet-wide reload** from an upstream infra change — image rebuild, Nomad version bump, host drain, etc. Every PaaS allocation restarts at roughly the same time and every allocation runs the RESTART path in parallel.

The fourth trigger is the highest-volume and the most likely explanation for "the app was fine yesterday and broken today" reports — a single upstream action fans out to every PaaS app simultaneously.

**Why detection was slow.** `sync-template-files.js` only replaces a file when the customer's current MD5 hash matches one of ~6–12 known AAB template hashes (see the `known_hashes` arrays in `container-scripts/preview/sync-template-files.js:43-149`). Most customer files never match, so the script silently no-ops for the majority of PaaS apps. Corruption surfaces only when (a) a PaaS app happens to ship an unmodified copy of a template file (e.g. a customer kept the shadcn `sonner.tsx` or the stock `tailwind.config.js`), OR (b) `sync-package-additions.js` grafts a template-only dependency into the customer's `package.json` and the follow-on `npm install` drifts a transitive semver forward into an ERESOLVE conflict (exactly what the Grafana log in §3.3 shows). The script has a second, worse vector too: its `MIGRATIONS` section (§4) mutates `package.json` and `.gitignore` _without any hash gating_. Incidence is a function of customer-code overlap with template hashes and of specific strings in customer build scripts — not of how many PaaS apps we run — so the overall rate is low, intermittent, and looks like random unexplained app breakage in Grafana until a direct log inspection ties it to the RESTART sync.

## 2. Scope

**In scope**

- Preview container (`container-scripts/preview/nomad_setup.sh`) behavior for PaaS apps on RESTART.
- `node_modules` recovery for PaaS after ephemeral disk wipe.
- PaaS detection pattern reuse from PR #2976 (publish container).

**Out of scope**

- AAB behavior — no regression permitted, zero code change on the AAB path.
- Publish container (`app-publish/Dockerfile.dev` / `container-scripts/publish/*`) — already handled in PR #2976.
- `local-control-plane/` — local dev does not allocate PaaS jobs.
- Infrastructure changes in `mhp-core` / pioneer-infra — solution must work with existing `PRODUCT_ID.VALUE` contract.

## 3. Background

### 3.1 PR #1515 — why the sync logic exists

PR #1515 introduced _mode-based conditional startup_ to solve a thundering-herd problem during fleet-wide restarts. Two paths were created in a single unified `nomad_setup.sh`:

| Path                                                             | Trigger               | Operations                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FIRST-START (`container-scripts/preview/nomad_setup.sh:117-150`) | `.git/config` absent  | `git init` → copy `$BASE_APP_DIR` → `npm ci` → initial commit                                                                                                                                                      |
| RESTART (`container-scripts/preview/nomad_setup.sh:45-115`)      | `.git/config` present | lock cleanup → `git reset --hard` → checkout `main` → `sync-package-additions.js` → conditional `npm install` → rsync `dev-tools/` + `airo-secrets/` → `.npmrc` copy → `sync-template-files.js` → commit each step |

The RESTART path exists so that **AAB** apps pick up upstream template fixes (e.g., the `@dr.pogodin/react-helmet` dependency, cookie banner wiring, Vite config improvements) without requiring per-app migrations. `sync-template-files.js` uses MD5 known-hash gating (`container-scripts/preview/sync-template-files.js:43-149`) to only overwrite files the customer hasn't modified.

For AAB this is correct: the customer doesn't own `vite.config.ts`, so replacing it with the latest template is a win. For PaaS the premise is inverted — the customer owns every file.

### 3.2 PaaS lifecycle (as-is)

PaaS apps are created and restarted by code in `agents/src/services/ProjectImportService.ts` and `agents/src/services/GitOpsService.ts`:

1. **Provisioning.** Control plane (mgmt-airo / mhp-core) allocates a Nomad job with `PRODUCT_ID.VALUE = "paas-nodejs-v1"` (or sibling product IDs) written to `/alloc/config.json`. Container comes up with the v8 base template in `/app-template/` and an empty `/app`.
2. **First-start.** `nomad_setup.sh` detects no `.git/config` → runs FIRST-START: `git init`, copies template into `/app`, `npm ci`, initial commit. At this point `/app` contains template code, not customer code.
3. **Code upload.** User uploads a zip or triggers git-pull. `ProjectImportService.processImport()` (`agents/src/services/ProjectImportService.ts:113-634`) orchestrates:
   - Extraction (with `cleanAppDirBeforeExtract: true` for `paas-nodejs-v1` → base template files are wiped before customer code lands).
   - `detectPackageManager()` probes for `pnpm-lock.yaml` / `yarn.lock` / falls back to `npm` (`agents/src/services/AppRestartService.ts:84-112`).
   - `performFullRestartCycle()` runs the package-manager-appropriate install + build.
   - `createPaasConfig()` writes `.airo/config.json` with `productId`, `cleanAppDirBeforeExtract`, and `runtime.{dev,build,serve}.command` (`agents/src/services/AppRestartService.ts:520-561`).
   - `gitCommit()` commits all customer code to `main` (`agents/src/services/ProjectImportService.ts:548`, `:1142-…`).
   - `restartDevServer()` starts the customer's process using their `startCommand`.
4. **Subsequent restarts** (zip upload kick, fleet reload, container crash, Nomad reschedule) re-run `nomad_setup.sh`. At this point `.git/config` exists → RESTART path fires → PaaS customer files are mutated.

### 3.3 Evidence — the bug in production

Grafana log for app `uh39tiw6r6` (`product_id=paas-nodejs-v1`, `task_name=publish`, single-container PaaS publish with deferred setup), events `09:36:39` → `09:36:42`:

```
09:36:39.867  autostart.executing_deferred_setup
09:36:39.881  setup: === RESTART PATH detected ===
09:36:39.884  setup: Restoring working tree from HEAD...
09:36:40.007  setup: HEAD is now at b3f90c2 Sync upstream template files 1776694620   ← prior sync already polluted PaaS git history
09:36:40.017  setup: Syncing package.json updates from template...                     ← sync-package-additions.js running against customer package.json
09:36:40.072  setup: ✅ No additions needed, target is up to date
09:36:40.100  setup: Installing dependencies with npm install (this may take a few minutes)...
09:36:42.208  setup: npm error ERESOLVE unable to resolve dependency tree
              setup: npm error peer react@"19" from @dr.pogodin/react-helmet@3.1.1
              setup: npm error   react@"^18.3.1" from the root project
09:36:42.246  startup.setup.failed / autostart.deferred_setup_failed
```

Two distinct failures are visible:

1. **Silent corruption (already happened).** The git HEAD is `b3f90c2 Sync upstream template files 1776694620` — a commit authored by `nomad_setup.sh` on a previous restart. PaaS customer source files were replaced with base-template versions whenever the hash happened to match a known AAB hash. There is no alert on this; the customer's code just drifts away from what they uploaded.
2. **Downstream crash (today's symptom).** After `git reset --hard` restored the polluted HEAD, `npm install` (not `npm ci`) resolved `@dr.pogodin/react-helmet@^3.0.5` forward to `3.1.1`, which peer-depends on `react@19`, which conflicts with the project's `react@^18.3.1`. Container never becomes ready; app serves 503.

## 4. Operation-by-operation risk analysis

Every operation in the RESTART path (`nomad_setup.sh:45-115`), evaluated for PaaS:

| Line    | Operation                                                        | PaaS impact                                                                                                                                                                                                                                                                                                                                                                                                     | Decision                                                          |
| ------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 54-56   | `rm -f .git/index.lock …`                                        | Safe. Customer may hold a lock after a crash; clearing it is correct for any git repo.                                                                                                                                                                                                                                                                                                                          | **Keep (if we keep any git handling)**                            |
| 62      | `git reset --hard`                                               | Destructive. Customer's own upload flow commits before restart (`ProjectImportService.ts:548`), so typically a no-op. But any in-flight state, abandoned rebase, or partially committed upload would be discarded.                                                                                                                                                                                              | **Skip for PaaS**                                                 |
| 68-74   | Checkout `main`                                                  | PaaS always commits on `main` today (`performFullRestartCycle` → `gitCommit`). Checking out `main` is a no-op in the happy path, but precludes future PaaS features like branch-based previews.                                                                                                                                                                                                                 | **Skip for PaaS**                                                 |
| 77-82   | `sync-package-additions.js` (template → customer `package.json`) | **HARMFUL.** Injects AAB template deps (e.g. `@dr.pogodin/react-helmet`) into customer `package.json`.                                                                                                                                                                                                                                                                                                          | **Skip for PaaS**                                                 |
| 83      | `git commit "Sync upstream package.json …"`                      | Side effect of the above; if the sync is a no-op there's nothing to commit. Still, the commit itself pollutes PaaS history when it fires.                                                                                                                                                                                                                                                                       | **Skip for PaaS (automatic once 77-82 is skipped)**               |
| 85-89   | `npm install` when `node_modules` missing                        | Two problems: (a) hard-codes `npm`, ignoring pnpm/yarn lockfiles; (b) uses `npm install` not `npm ci`, so semver-drift forward. This is the actual crash in the log above.                                                                                                                                                                                                                                      | **Replace for PaaS** with a package-manager-aware recovery (§5.3) |
| 92      | `git commit "Update package-lock.json …"`                        | Commits a lockfile the customer may not own, on their branch.                                                                                                                                                                                                                                                                                                                                                   | **Skip for PaaS**                                                 |
| 96-99   | rsync `dev-tools/` and `airo-secrets/` from `$BASE_APP_DIR`      | AAB-only directories. Creates files in the customer's repo that they never wrote.                                                                                                                                                                                                                                                                                                                               | **Skip for PaaS**                                                 |
| 105     | `git commit "Sync upstream dev tools and airo-secrets …"`        | As above — foreign commit on customer history.                                                                                                                                                                                                                                                                                                                                                                  | **Skip for PaaS**                                                 |
| 103-106 | `cp $BASE_APP_DIR/.npmrc → .npmrc` + commit                      | Overwrites a file the customer likely owns (registry selection). Current template `.npmrc` points to `registry.npmjs.org` directly; for a fleet reload at scale, _every_ PaaS container hits the public npm registry and risks IP-based rate-limiting / blocks. See §6.3 (Open Question).                                                                                                                       | **Skip for PaaS**                                                 |
| 110     | `sync-template-files.js`                                         | **The headline bug.** Hash-based replacement of `App.tsx`, `RootLayout.tsx`, `vite.config.ts`, `index.html`, `tailwind.config.js`, `sonner.tsx`, `CookieBanner*`, `analytics.js`, `configure.js` — none of which PaaS customers want touched. Migrations (`MIGRATIONS` in `sync-template-files.js`) also fire: `remove-bundle-js-build-step` and `remove-public-assets-gitignore` are AAB migrations, not PaaS. | **Skip for PaaS**                                                 |
| 111     | `git commit "Sync upstream template files …"`                    | The `b3f90c2` commit seen in the Grafana log.                                                                                                                                                                                                                                                                                                                                                                   | **Skip for PaaS (automatic once 110 is skipped)**                 |

**Conclusion:** every file-mutating or history-mutating operation in the RESTART path is wrong for PaaS. The only remotely valuable behavior is `node_modules` recovery, and even that is currently broken for non-npm package managers.

> **Migrations deserve a special callout.** `sync-template-files.js` runs two `MIGRATIONS` (`remove-bundle-js-build-step`, `remove-public-assets-gitignore` — `container-scripts/preview/sync-template-files.js:157-234`) that are **not hash-gated**. They unconditionally edit `package.json` (strip `&& node bundle.js` from build scripts, delete the `bundle` script, delete `build:vite` if redundant with `build`) and `.gitignore` (strip `public/assets` entries). For any PaaS app whose `package.json` happens to reference `bundle.js`, or whose `.gitignore` happens to contain `public/assets`, this is unconditional silent corruption — no hash collision required. Hash-gating stops file-replacement at least some of the time; migrations stop nothing. This is the stronger reason why the entire `sync-template-files.js` invocation must be skipped for PaaS, not surgically gated.

## 5. Proposed design

### 5.1 Principle

`nomad_setup.sh` must treat PaaS allocations as **opaque, customer-owned application state**. The script's job reduces to a single responsibility for PaaS: ensure the container can start the customer's process — nothing more.

### 5.2 Detection

The publish container does not do explicit PaaS detection today — it distinguishes by _archive content_: pre-built `dist/server.bundle.mjs|cjs` → AAB fast path, otherwise → full-source build path (see `container-scripts/publish/run-app.sh:86-114`). That implicit discriminator works for publish because an AAB archive and a PaaS archive never ship sources in the same shape. Preview has no equivalent implicit signal — both AAB and PaaS see a live `/app` working tree — so preview needs an **explicit** check. Two sources of truth are available inside the container:

- **`/alloc/config.json`** — written by Nomad/mhp-core at allocation time; contains `PRODUCT_ID.VALUE`. Authoritative per-allocation, always present in production.
- **`.airo/config.json`** at `/app/.airo/config.json` — written by `createPaasConfig()` (`agents/src/services/AppRestartService.ts:520-561`) and committed to git in Phase 11 of `ProjectImportService.processImport()` (`agents/src/services/ProjectImportService.ts:548`). Persists across restarts via git; absent only before the first successful PaaS import.

Use `/alloc/config.json` as primary (it is the allocation's ground truth) and `.airo/config.json` as fallback (in case a future execution environment writes the productId into the app directory but not to a Nomad alloc file):

```bash
is_paas_flow() {
  local product_id=""

  # Primary: /alloc/config.json (Nomad — authoritative per-allocation, written at job start)
  if [[ -n "${NOMAD_ALLOC_DIR:-}" && -f "${NOMAD_ALLOC_DIR}/config.json" ]]; then
    product_id=$(jq -r '.PRODUCT_ID.VALUE // empty' "${NOMAD_ALLOC_DIR}/config.json" 2>/dev/null || true)
  fi

  # Fallback: committed .airo/config.json (survives across reschedules independent of Nomad)
  if [[ -z "$product_id" && -f "$CUSTOMER_APP_DIR/.airo/config.json" ]]; then
    product_id=$(jq -r '.productId // empty' "$CUSTOMER_APP_DIR/.airo/config.json" 2>/dev/null || true)
  fi

  # Require a non-empty suffix — bare "paas-" must not match
  [[ "$product_id" =~ ^paas-.+ ]]
}
```

Properties:

- **Correct on cold-start after fleet reload.** `/alloc/config.json` is present from container boot; detection works on the very first line of the script.
- **Correct after any reschedule.** Both files outlive container restarts (one is re-written by Nomad, one is stored in git).
- **No false positives.** `^paas-.+` regex requires the prefix plus at least one character, so `paas-` alone (unlikely but defensible) does not match. AAB apps never carry a `paas-*` productId in either source.
- **No false negatives on existing PaaS apps.** Every PaaS app that has completed one successful import has a committed `.airo/config.json` with `productId`, so even if `/alloc/config.json` were ever missing, the fallback catches it.

**`jq` hardening.** `jq` is present in the preview runtime image (`app-templates/v8/Dockerfile.dev:101` — verified). If a future image change removes it, the calls above emit empty strings via `2>/dev/null || true` and the function returns false — we fall through to the AAB path, which is a _correctness regression for PaaS_ (silent corruption returns) rather than a crash. Gate the function with a `command -v jq` check that logs loudly so the regression is visible in Grafana, not silent:

```bash
if ! command -v jq >/dev/null 2>&1; then
  log_warn "is_paas_flow: jq missing; defaulting to AAB path (POTENTIAL PAAS CORRUPTION RISK)"
  return 1
fi
```

### 5.3 PaaS RESTART behavior

When `is_paas_flow` returns true on the RESTART path, perform only the minimum needed for process startup:

```bash
if [ -f "$CUSTOMER_APP_DIR/.git/config" ]; then
  if is_paas_flow; then
    log_step "=== RESTART PATH (PaaS) ==="
    cd "$CUSTOMER_APP_DIR"

    # 1. Stale lock cleanup — safe, needed if container crashed mid-git-operation
    rm -f .git/index.lock .git/refs/heads/*.lock .git/packed-refs.lock

    # 2. Node_modules recovery — only if missing (ephemeral disk wipe).
    #    Honor customer's package manager, not hard-coded npm.
    if [ ! -d node_modules ]; then
      log_step "node_modules missing, running install with detected package manager"
      pm=npm
      [ -f pnpm-lock.yaml ] && pm=pnpm
      [ -f yarn.lock ] && pm=yarn
      case "$pm" in
        pnpm) pnpm install --frozen-lockfile ;;
        yarn) yarn install --frozen-lockfile ;;
        npm)  npm ci --no-fund --no-audit ;;   # ci, not install — respect lockfile
      esac
      # NOTE: No git commit. Lockfile state belongs to the customer.
    fi

    log_step "=== RESTART SETUP COMPLETE (PaaS) ==="
    exit 0
  fi

  # ─── existing AAB RESTART block, unchanged ───
  ...
fi
```

Key properties:

- **Idempotent.** Running on a clean workspace is a no-op.
- **No git mutations.** No reset, no commit, no branch switch. The customer's git history is preserved byte-for-byte.
- **Package-manager correct.** Mirrors the detection used by `detectPackageManager()` (`agents/src/services/AppRestartService.ts:84-112`) during zip/git imports, so PaaS recovery matches PaaS provisioning.
- **Uses `ci` / `--frozen-lockfile`.** Prevents the semver-drift crash seen in the Grafana log.

**Why `npm ci` and not `npm install --legacy-peer-deps`?** The publish container uses `CI=true NODE_ENV=development npm install --legacy-peer-deps --no-fund --no-audit` (`container-scripts/publish/build-and-run.sh:51`) because it installs against a fresh extraction of the customer's archive, where a stale lockfile vs `package.json` is a real possibility. Preview RESTART is the opposite scenario: we are rehydrating `node_modules` from the _same_ committed `package.json` + lockfile pair that already produced a successful install during FIRST-START or the last import. `npm ci` / `--frozen-lockfile` is the correct default — deterministic, fast, and fails loudly if the committed state was tampered with (which, post-fix, it should not be). If post-rollout telemetry shows `npm ci` failures above baseline, we can relax to `--legacy-peer-deps`; do not preemptively do so.

**yarn support asymmetry (pre-existing, not introduced by this design).** `detectPackageManager()` recognizes yarn (`yarn.lock`). The publish container does **not** — `container-scripts/publish/build-and-run.sh:22-30` explicitly errors out if neither `package-lock.json` nor `pnpm-lock.yaml` is present. Preview RESTART supporting yarn matches agent-side import behavior, but a yarn-based PaaS app will still fail at publish time. Tracked as a separate follow-up (see Open Question #7); not in scope for this fix.

### 5.4 FIRST-START behavior

Leave FIRST-START unchanged. Rationale:

- `.git/config` is absent before _any_ customer activity — we genuinely have nothing to distinguish PaaS from AAB at this point from `.airo/config.json`. `/alloc/config.json` _is_ available, so detection is technically possible, but adds complexity.
- The existing FIRST-START path (`git init`, copy template, `npm ci`, initial commit) produces a bootstrap state that the PaaS zip-upload flow immediately wipes and overwrites (`cleanAppDirBeforeExtract: true`). So any "wasted" work here is bounded to a single template copy + `npm ci`, which is tolerable cost for simplicity.
- If future telemetry shows FIRST-START cost is meaningful for PaaS, we can branch on `/alloc/config.json` there too — but that's a future optimization, not a correctness fix.

Explicit non-goal: do **not** try to detect PaaS in FIRST-START today.

### 5.5 No changes outside `nomad_setup.sh`

The entire fix is contained in this one script. No Go changes in `dev-supervisor/`, no TypeScript changes in `agents/` or `app/`, no Dockerfile changes. This is intentional — minimum blast radius, maximum reviewer clarity, simple rollback (revert the script).

**Iteration note.** An earlier revision of this PR (commit `ce594df09`) extracted the PaaS branch into a separate `container-scripts/preview/nomad_setup_paas.sh` and added a `COPY` line to `app-templates/v8/Dockerfile.dev` for it. Review feedback flagged that this widened the blast radius beyond the stated goal. Commit `f3e08d027` inlined the PaaS branch back into `nomad_setup.sh`, deleted `nomad_setup_paas.sh`, and removed the Dockerfile `COPY` — restoring the single-file, no-image-change invariant. The final PR diff touches only this script (plus this design doc); no Dockerfile edit is required for deploy or rollback.

## 6. Open questions

1. **PaaS fleet reload + npm registry rate limits.** The current template `.npmrc` points directly at `registry.npmjs.org`:

   ```
   registry=https://registry.npmjs.org/
   @godaddy:registry=https://registry.npmjs.org/
   @opentelemetry:registry=https://registry.npmjs.org/
   ```

   If infra triggers a fleet-wide restart of N PaaS containers, and M of them lost `node_modules` to ephemeral disk wipes, we get M simultaneous install calls against the public registry. PR #1515 solved the AAB version of this problem with _deferred setup_, but deferral helps only when setup starts — it doesn't change total request volume. **Action:** confirm with infra / GoCode whether there's a GoDaddy artifactory cache in front of public npm we should point PaaS at. If yes, point the container's `.npmrc` at it (without pulling from `$BASE_APP_DIR/.npmrc`, which this design explicitly stops doing). Not blocking the core fix — today's behavior also hits public npm directly — but this converts a known risk into a tracked follow-up.

2. **`HEAD` already polluted.** For PaaS apps that have _already_ been restarted under the current logic, git history contains spurious "Sync upstream template files" / "Sync upstream package.json" commits, and the working tree may have template versions of files instead of customer versions. This design stops the bleeding but does not heal existing wounds. **Action:** decide whether to run a one-time remediation pass — `git log --author='Airo AI Builder' --grep='^Sync upstream' --pretty=format:%H` on each PaaS app to quantify, then either `git revert` in-place, or ask customers to re-upload. Owner: PaaS team. Track separately; not blocking.

3. **Dev-supervisor health-check behavior on early exit.** PR #1515 added a "deferred setup pending" branch in `dev-supervisor/internal/proxy/http/health.go` that returns 200 while setup is in progress. With our early `exit 0` for PaaS, setup completes quickly and this branch is irrelevant — but I need to verify that a failed `install --frozen-lockfile` doesn't leave the process in a state where dev-supervisor tries to start the customer command against a broken tree. **Verified (2026-04-24):** `set -e` causes `nomad_setup.sh` to propagate a non-zero exit when the install step fails. `dev-supervisor/internal/processmanager/setup.go:136-137` logs `startup.setup.failed` and returns an error; `dev-supervisor/internal/proxy/http/autostart.go:33-35` logs `autostart.deferred_setup_failed` and returns HTTP 500. A broken install surfaces as a loud HTTP error on the first request — it cannot silently start against missing `node_modules`.

4. **Publish container parity (PR #2976).** If that PR's PaaS detection helper is factored as a sourceable shell file, reuse it rather than duplicating `is_paas_flow()`. **Action:** read PR #2976 end to end; if reusable, source it; if not, file a follow-up to extract a shared `container-scripts/lib/paas-detect.sh`.

5. **Prefix contract discoverability.** Design assumes `paas-*` prefix is the correct discriminator. If infra ever ships a PaaS-like product under a different prefix, this check will silently miss it. **Action:** document the prefix contract in `container-scripts/README.md` and add a comment in `nomad_setup.sh` pointing to `PAAS_NODEJS_V1_PRODUCT_ID` as the canonical constant.

6. **`cleanAppDirBeforeExtract` is gated on an exact `paas-nodejs-v1` match, not the `paas-*` prefix.** `createPaasConfig()` (`agents/src/services/AppRestartService.ts:553-555`) sets `cleanAppDirBeforeExtract = true` only when `productId === PAAS_NODEJS_V1_PRODUCT_ID`, using strict equality. Our RESTART detection uses the looser `paas-*` prefix (intentional, for forward compatibility). When the second PaaS product lands (`paas-python-v1`, `paas-go-v1`, …), preview RESTART will correctly skip sync, but `ProjectImportService` will **not** clean the template directory before extraction — which could leave AAB template files mixed with customer files. **Action:** align the AppRestartService gate to `productId?.startsWith('paas-')` when adding a second PaaS product; not blocking today.

7. **yarn parity between preview and publish.** Preview supports yarn; publish rejects it. A yarn-based PaaS customer sees a working preview and a failing publish, which is worse than failing fast at import. **Action:** either add yarn support to publish, or reject yarn uploads at import validation time. Track with PaaS team; not blocking this fix.

## 7. Implementation plan

Sequenced for minimum blast radius and a clean rollback at each step.

### Phase 0 — Pre-flight (no code change)

- Pull `startup.setup.failed` events filtered by `product_id=paas-*` over the last 7 days to quantify blast radius.
- Confirm PR #2976 merged state and its detection convention. Decide reuse vs duplication.
- Confirm `jq` is in the preview image (`app-templates/v8/Dockerfile.dev`).
- Ping infra on Open Question #1 (npm cache proxy). Log the answer; do not block on it.

### Phase 1 — Script change

- Add `is_paas_flow()` helper at the top of `container-scripts/preview/nomad_setup.sh`.
- Add the PaaS branch inline in the RESTART block, guarded solely by `is_paas_flow`. AAB path bit-identical.
- Update `container-scripts/README.md` with the new branch and detection convention.
- Shellcheck + a smoke test that sources the script with a mocked `.airo/config.json`.

### Phase 2 — Verify in dev/test

- Pick 1-2 test PaaS apps. Trigger restart (zip upload or manual reschedule). Verify:
  - Log shows `=== RESTART PATH (PaaS) ===`.
  - No `Sync upstream*` commits appear on the customer's main branch.
  - `node_modules` present → script is a no-op.
  - `node_modules` absent → correct package manager runs `ci` / `--frozen-lockfile`, install succeeds.
- Confirm at least one AAB app on the same image is unchanged (detection does not false-positive).
- Monitor: `startup.setup.failed` rate for `product_id=paas-*` drops to zero.

### Phase 3 — Production rollout

- Ship the image to production. Monitor 48 hours.
- Rollback = revert the script commit and redeploy (no runtime toggle).
- File Open Question #2 (remediation of already-polluted repos) as a separate initiative.

### Phase 4 — Parity and cleanup

- If PR #2976 / publish can share a `paas-detect.sh` helper, extract it.
- Document the `paas-*` prefix contract in the container-scripts README.
- Add a Grafana alert on `startup.setup.failed` when `product_id=paas-*` — that should now be approximately zero; any occurrences indicate a regression or newly introduced PaaS breakage.

## 8. Risks & rollback

| Risk                                                                            | Likelihood                                           | Impact                                                                     | Mitigation                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detection false-negative → PaaS app takes AAB code path → continued corruption  | Low                                                  | High                                                                       | Phase 2 manual verification on 1-2 test PaaS apps before production ship; alert on post-rollout `startup.setup.failed` filtered by `product_id=paas-*`                                |
| Detection false-positive → AAB app skipped sync → drifts from template          | Very low (`paas-*` prefix is strict)                 | Medium (AAB apps survive without template updates; they just miss patches) | Code review; Phase 2 verification includes at least one AAB app to confirm unchanged behavior                                                                                         |
| `npm ci` / `--frozen-lockfile` failure (lockfile out of sync with package.json) | Medium (some customer zips may have stale lockfiles) | Medium (app fails to start)                                                | Error surfaces as 503 via dev-supervisor; customer re-uploads with consistent lockfile. Failure is loud and actionable — strictly better than today's silent-corruption failure mode. |
| `jq` not installed in image at some point in future                             | Low                                                  | Low                                                                        | Function fails closed → AAB path runs → same behavior as today. Add explicit `command -v jq` check with a warning log, or preinstall guarantee.                                       |

Rollback: revert the script commit and redeploy the preview image. Because the change is confined to `nomad_setup.sh`, the rebuilt image is bit-identical to the current production image except for the single script — a clean, reviewable revert.

## 9. Success criteria

- Zero `Sync upstream*` commits authored on any PaaS app's git history after rollout (measured via `git log --author='Airo AI Builder' --grep='^Sync upstream'` on a sample of PaaS apps).
- Zero `startup.setup.failed` events with `product_id=paas-*` related to template sync or ERESOLVE package conflicts (Grafana).
- No regression in AAB `startup.setup.*` success rate.
- PaaS container cold-start (ephemeral disk wipe case) completes successfully for apps using npm, yarn, and pnpm — verified in Phase 2.
