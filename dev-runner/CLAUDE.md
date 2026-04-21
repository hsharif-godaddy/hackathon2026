# dev-runner

TUI process manager for local development. Built with Bubble Tea v2.

## Critical Constraint: Public Dependencies Only

**dev-runner MUST NOT depend on any GoDaddy-internal Go modules** (e.g. `github.com/gdcorp-golang/*`, `github.com/gdcorp-identity/*`, `github.com/gdcorp-partners/*`).

dev-runner is the tool that sets up Artifactory access for other services. If it required private modules itself, it could not be built before the proxy is configured - a bootstrap deadlock. All Go dependencies in `go.mod` must resolve through the public module proxy.

## Key Commands

```bash
make build    # Build binary to dist/dev-runner
make run      # Run directly with go run
make check    # fmt, vet, lint, test
make tidy     # go mod tidy
```

## Architecture

- `cmd/dev-runner/main.go` - Entry point, config loading
- `dev-runner.yml` - Process & hook configuration (local override: `dev-runner.local.yml`)
- `internal/config/` - YAML config parsing
- `internal/hooks/` - Pre-start hook runner
- `internal/preflight/` - Check/Fixer framework
  - `checks/` - Individual check implementations
  - `fixers/` - Auto-fix implementations
- `internal/process/` - Process lifecycle, output scanning
- `internal/tui/` - Bubble Tea model, views, styles

## Preflight Check/Fixer Pattern

Checks implement `preflight.Check` (Name, Category, Run). Fixers implement `preflight.Fixer` (Fix). Interactive fixers implement `preflight.TerminalFixer` (NeedsTerminal). Registered in `internal/tui/model.go` `buildPreflightRunner()`.

Categories run sequentially: Tools -> Environment -> Services. Checks within a category run concurrently.

## Conventions

- Uses Bubble Tea v2 (`charm.land/bubbletea/v2`)
- Lipgloss v2 for styling
- POSIX-only (process groups, Unix signals) - macOS/Linux/WSL
