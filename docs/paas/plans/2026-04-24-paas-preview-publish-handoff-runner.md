# Isolate PaaS publish flow into a dedicated runner

## Why

`container-scripts/publish/build-and-run.sh` currently serves both AAB and PaaS, with PaaS branches scattered through via `IS_PAAS_FLOW` / `SKIP_INSTALL` / `SKIP_BUILD` gates. One shared script means PaaS-only changes can regress AAB (recent dist-validation removal did exactly that). AAB has active users; we want PaaS changes to stop touching the AAB path.

## What changes

Add a **pre-extract** dispatch in `run-app.sh`: once `ARCHIVE_PATH` is resolved, if `is_paas_flow`, `exec /publish/paas-run.sh`. `paas-run.sh` owns its full lifecycle (cleanup → extract → install/build → start). AAB continues through the shared extraction helper into bundle detection or `build-and-run.sh`. Extraction logic is factored into `process_archive()` in `common.sh` so both runners share one implementation.

```
run-app.sh (entrypoint)
   │
   ├─▶ SUSPENDED                       → status-page.js
   ├─▶ resolve ARCHIVE_PATH
   ├─▶ is_paas_flow?  YES              → exec paas-run.sh            ◀── NEW (pre-extract)
   │                                       • cleanAppDirBeforeExtract
   │                                       • process_archive (shared)
   │                                       • pnpm | yarn | npm detect
   │                                       • trust node_modules from archive
   │                                       • recovery: install + build if missing
   │                                       • no migrations (preview ran them)
   │                                       • exec "$PM" start
   │
   ├─▶ process_archive  (AAB)
   ├─▶ dist/server.bundle.{mjs,cjs}    → exec node …                 (AAB fast path)
   └─▶ exec build-and-run.sh                                         (AAB legacy/fallback, linear)
```

## PaaS runtime contract

- Preview (long-running) runs install + build on import and ships `node_modules` in the archive (`PaaSPublishStrategy` sets `includeSource: true` + `includeNodeModules: true`). `paas-run.sh` trusts that.
- Customer owns `package.json` `scripts.start`. Preview derives `runtime.serve.command` in `.airo/config.json` from it (with minor massaging — dev-script fallback, defaults). `paas-run.sh` prefers that custom command and falls back to `$pm start` when the config is missing.
- Recovery: if `node_modules` is missing, install with the lockfile-appropriate command (matching `preview/nomad_setup.sh`), then run `runtime.build.command` from `.airo/config.json` (always set by preview as `$pm run build` or a customer override), falling back to `$pm run build` when the config is absent. Install itself has no custom-command override (no `runtime.install.command` in `PaasConfig`).
- No migrations (preview handles them for PaaS). No `create_env_file` (customer apps read `process.env.PORT` directly).

## Files to modify

1. **`container-scripts/publish/common.sh`** — add shared `process_archive()` function (archive existence/readability checks, `tar zxf`, `cd "$APP_DIR"`, timing log). Uses globals `DIST_DIR`, `ARCHIVE_PATH`, `APP_DIR`.
2. **`container-scripts/publish/run-app.sh`** —
   - Move PaaS dispatch to run **before** extraction (right after `ARCHIVE_PATH` is resolved):
     ```bash
     if is_paas_flow; then
         log "PaaS flow detected - delegating to paas-run.sh"
         export ARCHIVE_PATH
         exec /publish/paas-run.sh
     fi
     ```
   - Delete the inline `cleanAppDirBeforeExtract` block (was PaaS-only by data; now owned by paas-run.sh).
   - Replace the inline extract + `cd` block with a single `process_archive` call.
3. **`container-scripts/publish/paas-run.sh`** — new, executable. Prepends cleanup block + `process_archive` call, detects pm (pnpm > yarn > npm by lockfile), reads `runtime.{build,serve}.command` from `.airo/config.json`, trusts or recovers `node_modules` (build uses custom-cmd-or-`$pm run build`), loads customer + db env, execs custom serve command or `$pm start`.
4. **`container-scripts/publish/build-and-run.sh`** — strip `IS_PAAS_FLOW`, `SKIP_INSTALL`, `SKIP_BUILD` branches, the PaaS migration short-circuit, and the `CUSTOM_BUILD_CMD` / `CUSTOM_SERVE_CMD` reads (`.airo/config.json` is only written for PaaS, which no longer reaches this script). Result: linear AAB-only script.
5. **`CLAUDE.md`** — add `paas-run.sh` row to the Publish Flow table; note the new pre-extract dispatch order in `run-app.sh`.
6. **`gdcorp-commerce/pioneer-infra`** (separate PR) — `docker/airo-app-builder-publish/Dockerfile` COPYs scripts individually. Add:
   ```dockerfile
   COPY --chown=agent:agent app/container-scripts/publish/paas-run.sh /publish/paas-run.sh
   ```

## Why stripping PaaS branches from `build-and-run.sh` is safe for AAB

`is_paas_flow` matches `productId =~ ^paas-.+`, which is never true for AAB. Every AAB invocation today already takes the `else` branch of each `SKIP_*` gate and the non-PaaS continuation of the migration chain. Removing branches taken by 0% of AAB traffic cannot change AAB behavior.

## Side effects / bugs this also fixes

- **yarn on PaaS publish**: preview supports pnpm/yarn/npm; publish's `build-and-run.sh` rejects `yarn.lock` outright. `paas-run.sh` supports yarn by lockfile detection. The publish image does not install yarn today — chose fail-fast (existing `command -v "$PM"` check) over installing yarn. Revisit if a real customer ships `yarn.lock`.
- **npm resolution divergence**: preview uses `npm ci --no-fund --no-audit`; publish uses `npm install --legacy-peer-deps`. `paas-run.sh` recovery mirrors preview.

## Verification

- `bash -n` on `paas-run.sh` and the modified `build-and-run.sh`.
- `grep -nE 'IS_PAAS_FLOW|SKIP_INSTALL|SKIP_BUILD' container-scripts/publish/` should match nothing in `build-and-run.sh` after the change.
- PaaS e2e (local control plane): import → publish. Logs should show `"PaaS flow detected - delegating to paas-run.sh"` then `"node_modules present - trusting preview…"`; app serves on `process.env.PORT`.
- PaaS recovery: delete `node_modules` before publish; confirm install + build run, then `$pm start`.
- AAB regression: legacy source archive publish. Logs should match pre-change baseline except for the removed PaaS/SKIP log lines. `paas-run.sh` must not be invoked.
- `pnpm --filter @airo/agents test:unit "publish"` / `"PaaSPublish"` still pass (agents-side code unchanged).

## Open points — feedback welcome

1. **Yarn in publish image.** Keeping the fail-fast error. Confirm no PaaS customer relies on `yarn.lock` in production today.
2. **`.airo/config.json` serve bridge.** Intentionally dropped on the PaaS path. Kept functional on AAB. OK?
3. **External Dockerfile PR.** Separate PR in `pioneer-infra` — must merge before this one is deployable.
