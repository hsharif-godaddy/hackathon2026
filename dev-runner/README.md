# Dev Runner

A TUI process manager for the Airo local development environment, built with [Bubble Tea v2](https://charm.land/bubbletea).

Runs all three local dev processes (Agents, App, Control Plane) in a single terminal with a rich interactive interface.

> **Supported platforms:** Dev Runner relies on POSIX process management (process groups, Unix signals) and is supported on macOS, Linux, and Windows via WSL. Native Windows (outside WSL) is not supported.

## Features

- **Preflight checks** — Validates tools, environment, and services before starting; groups checks by category (Tools, Environment, Services) with pass/fail/warn/skip status
- **Auto-fix system** — Fixable issues can be resolved automatically; inline checkbox selector lets you choose which items to fix, inline env form collects configuration values without leaving the TUI
- **Tabbed views** — Combined "All" view showing all process output, or switch to individual full-screen views
- **Pre-start hooks** — Run setup commands (install, build) before starting processes, displayed in a scrollable viewport
- **Error detection** — Configurable error patterns with visual alerts (🔔 bell + error count badge on tabs)
- **Health checks** — Periodic HTTP health checks with adaptive intervals; status dot turns yellow (pending), green (healthy), or red (unhealthy)
- **Log search** — `/` opens incremental search within individual process views, `n`/`N` to cycle matches, `Enter` to advance
- **Mouse scroll** — Mouse wheel scrolls log panes; toggle mouse capture with `m` to enable text selection
- **Auto-follow** — Logs auto-scroll to bottom; scrolling up pauses follow, reaching bottom resumes
- **Settings menu** — Restart individual/all processes (re-runs hooks), clear logs, clear errors, exit
- **Quit confirmation** — `q` prompts for confirmation before shutting down
- **Graceful shutdown** — Sends SIGTERM to process groups, escalates to SIGKILL after 5s timeout; double Ctrl+C during shutdown forces immediate exit
- **Color preservation** — Pipes with `FORCE_COLOR=1` preserve ANSI colors from child processes

## Quick Start

```bash
# From the monorepo root (this is the default dev command):
pnpm run dev

# Or directly:
cd dev-runner && make run
```

### Cleaning generated state

dev-runner can remove generated files, build artifacts, and caches it has accumulated. Same picker, five entry points (three CLI + two in-TUI):

```bash
pnpm run clean             # Interactive: opens the picker, then quits (no dev session)
pnpm run dev --clean       # Opens the picker before preflight; on confirm continues into preflight + dev
pnpm run dev --clean-all   # Skips the picker, removes every group, then continues into preflight + dev
```

Plus two in-TUI shortcuts: press `c` on the preflight dashboard, or open the settings menu with `s` and choose **"Clean + Restart..."** (works from the running phase, stops processes, runs the picker, re-runs preflight + hooks, restarts).

Scripts/CI can still use the non-interactive CLI: `dev-runner clean --all`, `--build`, `--runtime`, `--env`, `--node-modules`, `--yes` / `-y`. Any flag opts out of the TUI; with no flags and no TTY, dev-runner falls back to the legacy `[y/N]` prompt with the legacy default scope (build + runtime + env).

**Groups:**

| Group              | Default in picker | Includes                                                                                       |
| ------------------ | ----------------- | ---------------------------------------------------------------------------------------------- |
| Build artifacts    | ✓ on              | Go service `dist/`, JS package `dist/`, `app/.next`, `.turbo/`, `*.tsbuildinfo`, Playwright artifacts, etc. |
| Runtime data       | off               | `local-control-plane.db*`, `.dev-bms/` (preflight seed marker)                                 |
| Env files & certs  | off               | `agents/.env*`, `app/.env*`, `image-search-service/certs/*`, `local-control-plane/.env`, etc.  |
| node_modules       | ✓ on              | Every `node_modules/` under the project root (slow — needs `pnpm install` after)               |

**CLI flags for `dev-runner clean`:** `--all`, `--build`, `--runtime`, `--env`, `--node-modules`, `--yes` / `-y`. With no group flag the legacy scope (build + runtime + env) is used.

> **Note:** A `Workspace Build` preflight check guards against missing workspace `dist/` directories. Discovery is dynamic: walks `workspace:` deps from `app/` and `agents/` and keeps packages that have a `build` script and resolve consumers into `dist/`. If any are missing, the dashboard offers a fix that runs `pnpm exec turbo run build --filter=<each-closure-pkg>` — scoped to exactly that closure rather than full `pnpm build`, so the apps' production builds aren't pulled in. Turbo caches per package; repeat builds cache-hit in ~5s, cold build after `--clean-all` is ~30-60s. Normal startups skip the build entirely.

## Preflight Checks

On startup, dev-runner runs a comprehensive set of preflight checks before launching processes. These validate that all required tools, environment configuration, and services are ready.

**Check categories:**

- **Tools** — Node.js (via fnm/nvm), pnpm, Go, make, Docker, AWS CLI, Artifactory auth
- **Environment** — /etc/hosts entry, AWS SSO session, app/.env & agents/.env files, JWT keys, Gasket dev certs, S2S client certs, Commerce OAuth, Getty proxy, KnowB config, Design RAG
- **Services** — Required ports (3000, 4000, 4100, 8443) are available, MySQL container running

**Lifecycle phases:**

1. **Checking** — Runs all checks and displays results
2. **Dashboard** — Shows pass/fail/warn summary with fix options
3. **Fix Selection** — Inline checkbox list to choose which items to auto-fix (all selected by default)
4. **Env Form** — Inline form to collect env configuration (GoCode auth method, API key, base URL, app auth type, AWS profile) when .env files need generation. `GoCode Auth: s2s` enables IAM JWT via AWS SSO (see GETTING_STARTED.md).
5. **Fixing** — Runs selected fixers sequentially, re-verifies fixed items
6. **Hooks** — Pre-start hooks (`direnv allow`, then `pnpm install`). Workspace-package builds are no longer a hook — they're an on-demand preflight fixer (see `Workspace Build` check)
7. **Running** — Process manager with tabbed views

**Dashboard keys:** `Enter` to select fixes, `s` to skip (warnings only), `c` to open the clean picker, `q` to quit.

**Fix selector keys:** `space` to toggle, `a` to select all, `n` to deselect all, `enter` to confirm, `esc` to cancel.

**Env form keys:** `tab`/`↓` next field, `shift+tab`/`↑` previous field, `enter` to submit (or advance), `esc` to cancel.

## Key Bindings

| Key                 | Action                                            |
| ------------------- | ------------------------------------------------- |
| `Tab` / `Shift+Tab` | Cycle between All and individual process views    |
| `1`, `2`, `3`       | Jump to specific process tab                      |
| `0` or `a`          | Jump to All (combined) view                       |
| `s` or `?`          | Open settings menu                                |
| `/`                 | Open search bar (individual views only)           |
| `n` / `N`           | Next/previous search match                        |
| `Enter`             | Next search match (in search mode)                |
| `Esc`               | Close search / clear error alerts                 |
| `F`                 | Toggle auto-follow (on/off shown in status bar)   |
| `g` / `G`           | Jump to top/bottom of log                         |
| `m`                 | Toggle mouse capture (on/off shown in status bar) |
| `q`                 | Quit (with confirmation dialog)                   |
| `Ctrl+C`            | Quit immediately (no confirmation)                |

## Configuration

All configuration lives in `dev-runner/dev-runner.yml`. To customize locally without affecting others, copy it to `dev-runner/dev-runner.local.yml` — this file is gitignored and will be loaded instead when present.

```yaml
processes:
  - name: App # Display name (shown in tab)
    command: pnpm run dev # Shell command to run
    dir: app # Working directory (relative to project root)
    errorPatterns: # Strings that mark a line as an error
      - "FATAL"
      - "Module not found"
    healthCheck: # Optional HTTP health check
      url: https://localhost:3000/api/health
      unhealthyInterval: 10s # Poll frequency while unhealthy (default 10s)
      healthyInterval: 60s # Poll frequency once healthy (default 60s)
      insecure: true # Skip TLS verification

hooks:
  preStart: # Run sequentially before starting processes
    - name: Install dependencies
      command: pnpm install
      dir: .
```

## Development

```bash
make build    # Build binary to dist/dev-runner
make test     # Run unit tests
make lint     # Run golangci-lint
make fmt-fix  # Format code
make check    # Run all checks (fmt, vet, lint, test)
```

## Architecture

```text
dev-runner/
├── cmd/dev-runner/main.go       # Entry point, config loading, Bubble Tea init
├── dev-runner.yml               # Process & hook configuration
├── internal/
│   ├── config/config.go         # YAML config parsing & validation
│   ├── hooks/hooks.go           # Pre-start hook runner with streaming output
│   ├── preflight/
│   │   ├── check.go             # Check/Fixer interfaces, CheckResult, Status types
│   │   ├── runner.go            # Orchestrates checks by category, RunAll/RunFailed/FixableChecks
│   │   ├── checks/              # Individual check implementations (tools, env, services)
│   │   └── fixers/              # Auto-fix implementations (env generation, AWS, certs, etc.)
│   ├── process/
│   │   ├── manager.go           # Process lifecycle (start/stop/restart), process groups
│   │   └── scanner.go           # Output scanning for error patterns
│   └── tui/
│       ├── model.go             # Root Bubble Tea model, phases, messages
│       ├── update.go            # Message handling, key bindings, state transitions
│       ├── view.go              # Main View() dispatch to phase renderers
│       ├── preflight_view.go    # Preflight dashboard, fix selector, fixing views
│       ├── env_form.go          # Inline env configuration form
│       ├── styles.go            # Lipgloss styles & color theme
│       ├── pane.go              # Scrollable log pane with search highlighting
│       └── settings.go          # Settings overlay menu
├── go.mod
├── Makefile
└── README.md
```
