# dev-runner prewarm — Design

**Date:** 2026-06-04
**Branch:** `dev-runner-prewarm`
**Status:** Approved (ready for implementation plan)

## Problem

Creating a new app in local dev is slow. The dominant cost is in `local-control-plane`:
`Up()` calls `ensureImages()` on **every** app create (`local-control-plane/internal/docker/manager.go:54`),
which runs `docker buildx build` for two images — `aab-template-v8:latest`
(`app-templates/v8/Dockerfile.dev`) and `aab-publish:latest` (`app-publish/Dockerfile.dev`).

- When nothing changed → docker layer-cache hit, ~1s (the happy path noted in the
  `ensureImages` comment).
- When `dev-supervisor` (Rust/Go), `container-scripts`, or the template's `package.json`
  changed → the expensive stages rebuild **synchronously, blocking the app from coming up**:
  - Rust `cargo build --release` (airo-workspace PID1): ~2–5 min — invalidated by any file in `dev-supervisor/rust/`.
  - Go build (dev-supervisor + airo-sandbox): ~1–2 min — invalidated by any `.go`/`go.mod`/`go.sum` in `dev-supervisor/`.
  - `npm ci` of ~549MB node_modules: ~1–3 min — invalidated by `app-templates/v8/package*.json`.
  - management-scripts `npm ci`, gitleaks download: ~30–60s.

There is **no `--cache-from`/`--cache-to`** configured — the build relies purely on the
Docker daemon's layer cache. So the leverage is: **warm that layer cache ahead of time**, and
the per-app `ensureImages()` collapses back to a ~1s cache hit even after a `dev-supervisor` change.

A second, smaller cost exists today: the existing `app/scripts/prewarm.mjs` warms **Next.js route
compilation** in the `app` process (cold dev compile of a route can take >10s the first time). It
is a manual script, not wired into the dev flow.

## Goal

Make both warmable paths first-class, on-demand operations in **dev-runner** (the Go TUI process
manager), triggered manually so they never slow dev startup:

1. **API** — compile Next.js routes by GETting them (port `prewarm.mjs` logic to Go).
2. **Docker** — warm the docker layer cache for both images so the next per-app `ensureImages()`
   is a cache hit.

### Decisions (locked)

- **Trigger:** plain `dev-runner` **never auto-runs** prewarm — it's available on demand via the
  `w` keybinding. The `dev-runner prewarm` subcommand is an explicit opt-in startup mode: it boots
  the full dev environment and then **auto-fires prewarm once all services are healthy**.
- **Docker wiring:** an internal HTTP endpoint on `local-control-plane` that reuses the *exact*
  existing build invocation (cache-key parity is mandatory — any drift in build-args/contexts
  would produce a different cache key and the per-app build would still rebuild from scratch).
  The endpoint is **local-only**, guarded by a loopback `RemoteAddr` check.
- **API wiring:** port the route-warming (the ~100-route list + GET loop) into dev-runner Go and
  remove `app/scripts/prewarm.mjs`.

## Components

### 1. New package `dev-runner/internal/prewarm/`

UI-agnostic, pure functions so both the TUI picker and the CLI subcommand share logic.

- `task.go` — a small task model shared by picker + CLI:
  ```go
  type Task int
  const ( TaskAPI Task = iota; TaskDocker )
  type Selection struct { API, Docker bool }
  func (s Selection) Empty() bool
  ```
- `routes.go` — the route list ported verbatim from `prewarm.mjs` (pages, auth/config/well-known,
  apps, sites, servers, subscriptions/entitlements/grants/token-budget, database, domains, develop,
  secrets, analytics/misc — the same `_warmup` dynamic-segment convention). Plus:
  ```go
  func WarmAPI(ctx context.Context, baseURL string, out io.Writer) error
  ```
  - Uses a **scoped** `*http.Client` with `Transport.TLSClientConfig.InsecureSkipVerify = true`
    (replaces the script's process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` hack; the dev proxy serves
    an mkcert cert undici/Go won't otherwise trust). The insecure client is confined to this package.
  - `CheckRedirect` returning `http.ErrUseLastResponse` (manual redirect, like the script).
  - `waitForReady` polling `GET <baseURL>/` until it answers (default host
    `https://local.gasket.dev-godaddy.com:8443`), then warms all routes with **bounded concurrency**
    (e.g. a worker pool / semaphore) — the script's `Promise.all` fan-out, bounded so we don't open
    ~100 sockets at once.
  - Streams one line per route (`status  ms  path`) to `out`. Per-route errors are logged, non-fatal.
  - Timeouts mirror the script: ready timeout ~120s, per-route timeout ~120s (cold compile can
    exceed 10s), ready-probe ~5s.
- `images.go`:
  ```go
  func WarmImages(ctx context.Context, controlPlaneURL string, out io.Writer) error
  ```
  POSTs `<controlPlaneURL>/api/_debug/prewarm-images`, streams/relays the JSON result (built images
  + duration) to `out`, returns an error on non-2xx or transport failure.

### 2. local-control-plane internal endpoint

- `internal/docker/manager.go`: add an exported wrapper so the build logic stays single-sourced:
  ```go
  // PrewarmImages builds the template + publish images, warming the docker
  // layer cache so a subsequent per-app Up()→ensureImages() is a cache hit.
  // It runs the identical buildx invocation ensureImages() uses.
  func (m *Manager) PrewarmImages() error { return m.ensureImages() }
  ```
  (`ensureImages`/`buildImage`/`buildPublishImage` stay unchanged — parity is the whole point.)
- `internal/api/router.go`: register beside the existing `/api/_debug/*` routes:
  ```go
  r.HandleFunc("/api/_debug/prewarm-images", srv.PrewarmImages).Methods("POST")
  ```
- New handler `internal/api/prewarm.go`:
  - **Loopback guard:** parse `r.RemoteAddr`; if the host is not `127.0.0.1`/`::1`/loopback,
    respond `403`. This enforces "local only" by construction (LCP is a dev-only binary that is
    never deployed; the guard is defense-in-depth).
  - Calls `srv.DockerManager.PrewarmImages()`, timing it; responds
    `200 {"images":["aab-template-v8:latest","aab-publish:latest"],"durationMs":N}` or
    `500 {"error": ...}`.
  - The build is synchronous within the request (caller streams/awaits); builds can take minutes on
    a cold cache, so the handler sets no aggressive write deadline and the dev-runner/CLI client uses
    a long timeout.

### 3. dev-runner TUI integration (`internal/tui/`)

Mirror the existing `clean_picker.go` pattern (`huh.NewMultiSelect`, `initX/updateX/renderX`).

- New `prewarm_picker.go`:
  - `prewarmGroups` = `{API routes (selected), Docker images (selected)}` — both default-on.
  - `initPrewarmPicker` builds the multi-select form (`huh.NewOption(...).Selected(true)`).
  - `updatePrewarmPicker` handles `huh.StateCompleted` (assemble `prewarm.Selection`, run if
    non-empty) / `huh.StateAborted` (close).
  - `renderPrewarmPicker` / `renderPrewarming` (spinner + streamed output; on failure show
    `✗ prewarm failed` + output and require Enter/q, mirroring `renderCleaning`).
- New model fields (`model.go`): `prewarmPickerForm *huh.Form`, `prewarmPickerValue *[]int`,
  `prewarmRunning bool`, `prewarmOutput string`, `prewarmErr error`.
- Keybinding: add a `Prewarm` binding to `RunningKeyMap` (`keymap.go`) bound to `w` (confirmed
  unused — taken letters: q, a, 0–3, m, F, /, n, N, d, s, ?, g, G). In `handleKey` (`update.go`),
  when `m.phase == PhaseRunning && !m.anyModalOpen()`, `key.Matches(msg, m.runningKeys.Prewarm)`
  opens the picker. Intercept all keys while `prewarmPickerForm != nil` (as probe/e2e pickers do).
  Add `w` to `RunningKeyMap.ShortHelp()` so it appears in the footer.
  - Note: E2E and Clean+Restart are reached as Settings-menu **Actions** (`ActionRunE2E`,
    `ActionCleanRestart`), not top-level keys. A direct `w` key matches the user's "hit a key"
    intent; optionally also surface it as a Settings Action (`ActionPrewarm`) for discoverability.
    Direct key is the primary path.
- Execution `tea.Cmd` (goroutine): runs selected `prewarm.WarmAPI(appURL)` and/or
  `prewarm.WarmImages(cpURL)` with output captured to a `SafeBuffer`, emits `prewarmDoneMsg`.
  Spinner ticks while running (event loop stays responsive, like `runClean`). The picker confirm
  and the auto-fire path (below) share this one `runPrewarm(sel)` command.
- **Auto-fire (for `dev-runner prewarm`)**: `NewModel` gains an optional `prewarmOnHealthy
  *prewarm.Selection` (nil for plain `dev-runner`; set when the `prewarm` subcommand is used). Add a
  guard field `prewarmAutoFired bool`. In the `healthCheckMsg` handler (`update.go:266`, the point
  after `Healthy` is set), once **every process that has a `HealthCheck` reports
  `Healthy != nil && *Healthy == true`** for the first time, and `prewarmOnHealthy != nil &&
  !prewarmAutoFired`, set `prewarmAutoFired = true` and return `runPrewarm(*prewarmOnHealthy)`.
  Health checks are only scheduled after `PhaseRunning` (`update.go:263`), so the auto-fire never
  races startup. It fires once per session; the `w` key remains available for re-runs afterward.
- URLs: control-plane from existing `m.controlPlaneBaseURL`; **new helper `appBaseURL(cfg)`**
  mirroring `controlPlaneBaseURL` — reads the "App" process `HealthCheck.URL`
  (`https://local.gasket.dev-godaddy.com:8443/api/health`) → scheme+host, default
  `https://local.gasket.dev-godaddy.com:8443`.

### 4. dev-runner CLI subcommand (`cmd/dev-runner/main.go`)

A **startup mode** dispatched like the existing `clean` subcommand (`os.Args[1] == "prewarm"`), but
unlike `clean` it does **not** short-circuit the dev session — it boots the normal TUI (preflight →
hooks → processes) and auto-fires prewarm once services are healthy:

```
dev-runner prewarm [--api] [--docker]
  No task flags → both (default).
  --api      auto-warm Next.js routes only after startup
  --docker   auto-warm docker images only after startup
```

- `parsePrewarmFlags(args) (prewarm.Selection, error)` — mirrors `parseCleanFlags`; no task flags ⇒ both.
- Builds the model with `prewarmOnHealthy = &sel` (the auto-fire mode from §3) and runs the normal
  `tea.Program`. It manages processes exactly like a plain `dev-runner` run — the only difference is
  the one-shot auto-fire after first all-healthy. (Clean-startup flags like `--clean` are not
  combined with `prewarm` in this pass.)
- `devUsage`/help text updated; `prewarm` documented in `dev-runner/README.md` and `CLAUDE.md`.

### 5. Cleanup

- Delete `app/scripts/prewarm.mjs`.
- Remove the `"prewarm"` script from root `package.json` and `app/package.json`.
- Note the migration in the PR description: `pnpm prewarm` → `dev-runner prewarm --api`.

## Data flow

```
key `w` / `dev-runner prewarm`
  → Selection {API, Docker}
  → goroutine:
      API:    prewarm.WarmAPI(appBaseURL)      → GET ~100 routes (compile-on-GET)
      Docker: prewarm.WarmImages(cpBaseURL)
                → POST /api/_debug/prewarm-images   (loopback-guarded)
                → Manager.PrewarmImages() → ensureImages()  (identical buildx)
                → docker layer cache warmed
  → next app create: Up() → ensureImages()  = cache hit (~1s)
```

## Error handling

- **API:** per-route GET failures are logged but non-fatal (compile-on-GET; 405/401/redirect are
  expected). `WarmAPI` returns an error only when the server never becomes ready within the timeout.
- **Docker:** a build failure from the endpoint → `✗ prewarm failed` + captured output (TUI) /
  non-zero exit (CLI). Control-plane unreachable or Docker daemon down → a clear message
  (`WarmImages` distinguishes connection refused from a 500 build error).
- **Empty selection:** no-op (mirrors `clean.Selection.Empty()`).
- **Loopback guard:** non-local `RemoteAddr` → `403` with an explanatory body.

## Testing (Go-only — fast `make check`, no monorepo `pnpm install` needed)

- `internal/prewarm`:
  - route list is non-empty and every entry is a well-formed absolute path.
  - `WarmAPI` against an `httptest.Server`: all routes hit, redirects followed manually, a route
    returning 500 doesn't abort the run, ready-wait succeeds/expires correctly.
  - `Selection` assembly from picker indices / CLI flags.
- `local-control-plane`:
  - handler calls `PrewarmImages` (inject a fake/stub builder via a small interface or a manager
    seam) and returns the expected JSON.
  - loopback guard: `127.0.0.1` allowed, a non-loopback `RemoteAddr` → `403`.
- `dev-runner`:
  - `parsePrewarmFlags` table test (mirrors `parseCleanFlags` tests): no flags ⇒ both; `--api` /
    `--docker` ⇒ single; unknown flag ⇒ error.
  - picker index → `prewarm.Selection` mapping.
  - auto-fire detection: an "all health-checked processes healthy" predicate fires `runPrewarm`
    exactly once when `prewarmOnHealthy` is set, and never when it's nil (plain `dev-runner`).

## Out of scope (noted, not built here)

These were found during investigation but are deliberately deferred:

- First-boot in-container `npm ci` (~8–12s): the image bakes `/node_modules` + a precomputed
  `.npm-install-hash`, but `container-scripts/preview/nomad_setup.sh` only honors that hash on the
  *restart* path, not first-start.
- Template copied twice (host `cp -a` then again inside the container).
- Per-app MySQL DB provisioning + duplicate SSL-cert writes (minor).

## Constraints honored

- **dev-runner must not depend on GoDaddy-internal Go modules** — prewarm shells out to nothing
  internal; HTTP + `crypto/tls` + stdlib only. Docker work is delegated to LCP over HTTP.
- **Cache-key parity** — the docker warm reuses `ensureImages()` verbatim via `PrewarmImages()`;
  no buildx command is duplicated in dev-runner.
