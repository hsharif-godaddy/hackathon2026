# Dev Runner

A TUI process manager for the Airo local development environment, built with [Bubble Tea v2](https://charm.land/bubbletea).

Runs all three local dev processes (Agents, App, Control Plane) in a single terminal with a rich interactive interface.

> **Supported platforms:** Dev Runner relies on POSIX process management (process groups, Unix signals) and is supported on macOS, Linux, and Windows via WSL. Native Windows (outside WSL) is not supported.

## Features

- **Tabbed views** — Combined "All" view showing all process output, or switch to individual full-screen views
- **Pre-start hooks** — Run setup commands (dependency checks, install, build) before starting processes, displayed in a scrollable viewport
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
    - name: Check dependencies
      command: bash setup/check-deps.sh --integrated
      dir: .
    - name: Install dependencies
      command: pnpm install
      dir: .
    - name: Build packages
      command: pnpm build
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
│   ├── process/
│   │   ├── manager.go           # Process lifecycle (start/stop/restart), process groups
│   │   └── scanner.go           # Output scanning for error patterns
│   └── tui/
│       ├── model.go             # Root Bubble Tea model & state
│       ├── update.go            # Message handling, key bindings, state transitions
│       ├── view.go              # Rendering (tabs, panes, status bar, dialogs)
│       ├── styles.go            # Lipgloss styles & color theme
│       ├── pane.go              # Scrollable log pane with search highlighting
│       └── settings.go          # Settings overlay menu
├── go.mod
├── Makefile
└── README.md
```
