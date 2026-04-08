# Dev-Runner Preflight System Design

**Date:** 2026-04-07
**Status:** Implemented
**Replaces:** `setup.sh`, `setup/check-deps.sh`, `setup/src/index.ts`

## Summary

Add a preflight check-and-fix system to the dev-runner Go binary so that `pnpm dev` is the only command needed from a freshly cloned repo. The preflight phase runs inside the existing bubbletea TUI as its first phase, using inline forms and the existing lipgloss/bubbles stack for a cohesive developer experience.

## Goals

- **Single command:** `pnpm dev` from a fresh clone sets up everything and launches all services
- **Replace setup.sh entirely:** All checks and fixes move to native Go — no dependency on Node.js for setup
- **Check-first dashboard:** Run all checks upfront (~2-3s), show pass/fail checklist, then walk through fixes
- **Fast subsequent runs:** Checks always run but complete in 2-3 seconds; auto-advance when all pass
- **Seamless TUI integration:** Preflight is a phase inside the bubbletea app, not a separate program

## Architecture

### Phase Lifecycle

```
TUI launches immediately
  -> Phase: PreflightChecking      — spinner checklist, checks running in parallel by category
  -> Phase: PreflightDashboard     — full results; all pass -> auto-advance after ~1s
  -> Phase: PreflightSelectFixes   — inline checkbox list to choose which items to fix
  -> Phase: PreflightEnvForm       — inline text inputs for env configuration (if needed)
  -> Phase: PreflightFixing        — run selected fixers sequentially
  -> Phase: PreflightVerifying     — re-run fixed checks to confirm resolution
  -> Phase: Hooks                  — existing: pnpm install, pnpm build
  -> Phase: Running                — existing: process management with tabs
```

### Package Structure

```
dev-runner/
  internal/
    preflight/
      runner.go             # Orchestrates checks, collects results
      check.go              # Check interface, CheckResult, Status types
      checks/
        node.go             # Node.js version manager + Node 22.16.0+
        pnpm.go             # pnpm 10.17.0 via corepack
        golang.go           # Go 1.25+
        docker.go           # Docker installed + daemon running
        aws.go              # AWS CLI + SSO session validity
        hosts.go            # /etc/hosts entry for local.gasket.dev-godaddy.com
        mkcert.go           # mkcert availability
        certs.go            # SSL certificates exist in app/certificates/
        env.go              # .env files exist with required vars
        jwt.go              # JWT RSA key pairs present
        mysql.go            # MySQL container running
        make.go             # make available
      fixers/
        fixer.go            # Fixer interface — returns huh.Form or runs a command
        aws.go              # aws sso login flow
        docker.go           # docker compose up for services
        env.go              # .env file generation via huh forms
        certs.go            # mkcert certificate generation
        jwt.go              # RSA key pair generation (crypto/rsa)
        hosts.go            # /etc/hosts append (with sudo)
        mysql.go            # docker compose up app-mysql -d
    tui/
      model.go              # Phase enum added, preflight state fields
      update.go             # New message handlers for preflight messages
      view.go               # Phase-based routing in View()
      preflight_view.go     # NEW: checklist rendering + fix form rendering
      pane.go               # Unchanged
      settings.go           # Unchanged
      styles.go             # Extended with preflight-specific styles
```

### Separation of Concerns

- `preflight/` is pure logic: checks return `CheckResult`, fixers return `huh.Form` or run commands
- `tui/preflight_view.go` handles rendering: consumes results and forms, produces lipgloss-styled views
- Clean boundary between domain logic and presentation

## Check System

### Interface

```go
type Status int

const (
    StatusPass Status = iota
    StatusFail
    StatusWarn
    StatusSkip
)

type CheckResult struct {
    Status       Status
    Name         string   // Display name, e.g. "Node.js 22.16.0+"
    Category     string   // "Tools", "Environment", "Services"
    Message      string   // Short status: "v22.22.2" or "not found"
    FixAvailable bool     // Whether a Fixer exists for this check
    InstallHint  string   // For unfixable items: "brew install node@22"
}

type Check interface {
    Name() string
    Category() string
    Run(ctx context.Context) CheckResult
}

type Fixer interface {
    Fix(ctx context.Context) error
}
```

### Check Inventory

| Category | Check | Pass Condition | Fixer | Notes |
|----------|-------|---------------|-------|-------|
| **Tools** | Node.js version manager | `mise`, `fnm`, `asdf`, or `nvm` in PATH | No | Instructions only |
| | Node.js | `node --version` >= 22.16.0 | No | Instructions only |
| | pnpm | `pnpm --version` == 10.17.0 | Yes | `corepack enable && corepack prepare` |
| | Go | `go version` >= 1.25 | No | Instructions only |
| | make | `make --version` succeeds | No | Instructions only |
| | Docker | `docker info` succeeds | No | Instructions: start Docker Desktop |
| | AWS CLI | `aws --version` succeeds | No | Instructions only |
| | mkcert | `mkcert --version` succeeds | No | Optional (warn, not fail) |
| **Environment** | `/etc/hosts` | Contains `127.0.0.1 local.gasket.dev-godaddy.com` | Yes | Append with sudo prompt |
| | AWS SSO session | `aws sts get-caller-identity --profile <profile>` | Yes | `aws sso login` with browser flow |
| | App `.env` | File exists with required vars | Yes | huh form: provider, API key, auth type |
| | Agents `.env` | File exists with required vars | Yes | huh form: synced with app values |
| | JWT keys | RSA key pairs in both `.env` files | Yes | Generate via `crypto/rsa` |
| | SSL certificates | Cert files in `app/certificates/` | Yes | Run `mkcert` |
| **Services** | MySQL container | `docker ps` shows `airo-app-mysql` | Yes | `docker compose up app-mysql -d` |

### Execution Order

Categories run sequentially (Tools -> Environment -> Services) since later checks depend on earlier ones. Within each category, checks run concurrently via goroutines. Each check sends a `preflightCheckDoneMsg` through bubbletea's command system.

## UI Design

### Phase: Checking (animated)

```
  Preflight Checks

  Tools
    ✓ Node.js              v22.22.2
    ✓ pnpm                 10.17.0
    ✓ Go                   1.25.7
    ✓ Docker               running
    ◌ AWS CLI              checking...

  Environment
    ◌ /etc/hosts           waiting...
    ◌ App .env             waiting...
```

Spinner (`◌`) per check while running. Resolves to `✓` (green), `✗` (red), or `⚠` (yellow/optional). Uses lipgloss for colors and layout.

### Phase: Dashboard (all checks complete)

```
  Preflight Checks                            3 issues found

  Tools
    ✓ Node.js              v22.22.2
    ✓ pnpm                 10.17.0
    ✓ Go                   1.25.7
    ✓ make                 available
    ✓ Docker               running
    ✓ AWS CLI              2.15.0
    ⚠ mkcert               not found (optional)

  Environment
    ✗ AWS SSO session      expired
    ✗ App .env             missing
    ✗ Agents .env          missing
    ✓ /etc/hosts           configured
    ✓ SSL certificates     valid

  Services
    ✓ MySQL                running

  ─────────────────────────────────────────────────────
  3 items need attention. Press enter to fix, q to quit.
```

**All-pass fast path:** Dashboard renders fully green, shows "All clear" for ~1 second, then auto-transitions to hooks phase.

### Phase: Fixing (huh forms inline)

Each fixer renders its huh form in the main content area. Between forms, a brief "✓ Fixed" appears.

**AWS SSO fix:**
```
  Fix: AWS SSO Session

  ? AWS profile   > airobuild-dev-private-sso
                     airobuild-prod-sso
                     custom...

  Opening browser for SSO login...
  ✓ Authenticated as user@godaddy.com
```

**Env file generation:**
```
  Fix: App Environment

  ? AI Model Provider    > GoCode (recommended)
                            OpenAI Direct

  ? API Key              > ••••••••••••••••

  ? Auth Type            > jwt (recommended)
                            mock
                            none

  ? Commerce OAuth       > Skip (configure later)
                            Fetch from AWS Secrets Manager

  ✓ Generated app/.env
```

**Simple fixes (spinner + done):**
```
  Fix: MySQL Container

  Starting MySQL container...
  ✓ airo-app-mysql running on port 3306
```

### Phase: Verifying

Re-runs only previously-failed checks. Same checklist rendering. If all now pass, transitions to hooks. If still failing, returns to dashboard with remaining failures.

## Env File Generation

### Template Approach

Env files are built from Go templates embedded in the binary (no external files). Values are collected via huh forms.

### App `.env` Fields

| Field | huh Type | Default | Notes |
|-------|----------|---------|-------|
| AI Provider | Select | GoCode | GoCode or OpenAI Direct |
| API Key | Input (masked) | — | Required |
| AI Model | Input | `claude-sonnet-4` | Pre-filled from provider |
| Base URL | Input | GoCode prod URL | Auto-set from provider |
| Auth Type | Select | `jwt` | jwt, mock, none |
| Commerce OAuth | Confirm | No | If yes, fetches from AWS Secrets Manager |

### Agents `.env` Fields

Synced from app answers:
- AI provider, API key, model, base URL — copied from app
- Auth type — copied from app
- MySQL creds — defaults: root/rootpassword/localhost:3306
- Template dir — default: `app-templates/v8`

### Environment-Specific Files

`*.env.local.dev`, `*.env.local.test`, `*.env.local.prod` are generated automatically — deterministic content (SSO URLs, management API URLs). No user input needed.

### JWT Key Generation

Pure Go: `crypto/rsa` generates 2048-bit RSA key pair, PEM-encoded, injected into both `.env` files.

### Existing File Handling

If `.env` exists, the check parses it and validates required vars. The fixer only triggers if vars are missing. Offers three options:
- Add missing values only (preserves existing content)
- Regenerate entirely
- Skip

Writes to a temp file first, atomically renames on success — no partial files on Ctrl+C.

## Error Handling

### Unfixable Failures

Tools without fixers (Node.js, Go, make, Docker install, AWS CLI) show inline install instructions:

```
  ✗ Node.js    not found
    Install: brew install node@22
    Or visit: https://nodejs.org
```

User presses `q` to exit, installs manually, runs `pnpm dev` again.

### Fixer Failures

If a fixer fails (e.g., `aws sso login` times out), the check stays `✗`. After all fixers run, the verification re-run shows remaining failures. User can retry or quit.

### Ctrl+C During Preflight

Context cancellation propagates to all running checks and fixers. Env generation uses atomic temp file writes — no partial `.env` files. Exit is clean.

### Docker Daemon Not Running

Distinct from Docker not installed. "Not installed" shows install instructions. "Not running" shows a message to start Docker Desktop with a polling spinner that checks `docker info` every 3 seconds until it responds or user presses escape to skip.

### AWS SSO Browser Flow

Profile selection via huh select: default `airobuild-dev-private-sso`, also offers `airobuild-prod-sso` and custom input. Shells out to `aws sso login --profile <selected>`. TUI shows spinner "Waiting for browser authentication..." and polls `aws sts get-caller-identity --profile <selected>` until success or 120s timeout.

## Integration with Existing Dev-Runner

### TUI Model Changes

New fields in `Model`:
- `phase Phase` — current lifecycle phase
- `preflightResults []CheckResult` — collected check results
- `preflightFixer *huh.Form` — currently active huh form (nil when not fixing)
- `preflightFixIndex int` — which fixer we're on
- `preflightRunner *preflight.Runner` — orchestrator reference

Existing `hookRunning` / `hookDone` booleans fold into the `Phase` enum.

### New bubbletea Messages

```go
type preflightCheckDoneMsg struct { result CheckResult }
type preflightAllChecksDoneMsg struct {}
type preflightFixDoneMsg struct { err error }
type preflightVerifyDoneMsg struct { results []CheckResult }
```

### Config Changes

`dev-runner.yml` hooks section drops `check-deps.sh`:

```yaml
hooks:
  - name: Install dependencies
    command: pnpm install
  - name: Build packages
    command: pnpm build
```

### New Go Dependency

`github.com/charmbracelet/huh` — forms library. lipgloss and bubbles already present.

### What Stays the Same

- Entire TUI: tabs, panes, search, settings, error detection, health checks
- Process management and lifecycle
- Hooks system (still runs pnpm install / pnpm build)
- `dev-runner.yml` schema (just fewer hooks)
- Makefile, build process

## Migration

- `setup.sh` remains in the repo but is no longer the primary path. Add a note at the top pointing to `pnpm dev`.
- `setup/check-deps.sh` `--integrated` flag no longer called by dev-runner hooks.
- No breaking changes to `dev-runner.yml` — the schema is the same, just one fewer hook entry.
