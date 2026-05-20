# Container Scripts

Publish and preview container entrypoints. **When modifying publish logic, check both agents service and these scripts.**

## Publish Flow Architecture

| Component        | Location                 | Role                                                                                                                                               |
| ---------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive Creation | `agents/src/utils/git.ts`            | Creates tarball, validates dist/ for dist-only archives                                                                        |
| Publish Route    | `agents/src/server/routes/publish.ts`| API endpoint, orchestrates flow                                                                                                |
| Run Script       | `publish/run-app.sh`                 | Entrypoint. Extracts archive, dispatches PaaS early, else routes to AAB bundle / build-and-run.sh                              |
| PaaS Runner      | `publish/paas-run.sh`                | PaaS-only. Trusts preview's node_modules, runs `$pm start` from `scripts.start`. Recovery: install + build if missing. No migrations. |
| AAB Build Script | `publish/build-and-run.sh`           | AAB-only (legacy/fallback). Installs deps, builds, runs migrations, then auto-detects and serves a dist/ entry point           |

**Dispatch order in `run-app.sh`:** suspended-site check → resolve `ARCHIVE_PATH` → `is_paas_flow` → `paas-run.sh` (PaaS, which then owns cleanup + extract) OR `process_archive` → AAB `dist/server.bundle.{mjs,cjs}` fast path → `build-and-run.sh` fallback (AAB). Once dispatched to `paas-run.sh`, the AAB path is never reached and vice versa.

**PaaS runtime contract:** customer defines `scripts.start` (and optionally `scripts.build`) in `package.json`. Preview container (long-running) runs install + build after zip/git import; the archive ships `node_modules` verbatim. `paas-run.sh` trusts that and execs `$pm start`. Customer apps read `process.env.PORT` directly.

**Archive-time dist validation:** `git.ts` validates that `dist/` exists when creating a dist-only archive (source not included). Full-source archives skip this check because the container rebuilds. There is no corresponding deploy-time dist check in `build-and-run.sh` — it relies on the serve step finding an entry point under `dist/`.

## V4 Directory Structure

Per-app workspace at `/tmp/airo-app-builder/{appId}/`. Host → container (Preview/Publish) mounts:

| Host              | Container                       | Purpose                                     |
| ----------------- | ------------------------------- | ------------------------------------------- |
| `preview/`        | `/app` (preview)                | Agent-generated workspace (never hand-edit) |
| `publish/`        | `/app` (publish)                | Publish workspace (never hand-edit)         |
| `git-repo/`       | `/app/.git` (preview only)      | Git repository                              |
| `assets/public/`  | `/shared-storage/public/assets` | Public persistent assets                    |
| `assets/private/` | `/private`                      | Private persistent assets                   |
| `dist/`           | `/dist`                         | Build archives                              |
| `alloc/`          | `/alloc`                        | `config.json` + secrets                     |
