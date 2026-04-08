# Dev-Runner Preflight System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preflight check-and-fix system to the dev-runner so `pnpm dev` from a fresh clone sets up everything and launches all services.

**Architecture:** New `internal/preflight` package with check/fixer interfaces. Preflight runs as a phase inside the existing bubbletea TUI, using charmbracelet/huh for interactive fix forms. Checks run in parallel by category, results display as a styled checklist, and fixers walk through failures sequentially.

**Tech Stack:** Go 1.25, bubbletea v2, lipgloss v2, bubbles v2, charmbracelet/huh v2

**Spec:** `docs/superpowers/specs/2026-04-07-dev-runner-preflight-design.md`

---

## File Structure

### New Files

- `internal/preflight/check.go` — Check/Fixer interfaces, CheckResult, Status types
- `internal/preflight/runner.go` — Orchestrator: runs checks by category, collects results
- `internal/preflight/checks/node.go` — Node.js version manager + Node 22.16.0+
- `internal/preflight/checks/pnpm.go` — pnpm 10.17.0 via corepack
- `internal/preflight/checks/golang.go` — Go 1.25+
- `internal/preflight/checks/make.go` — make available
- `internal/preflight/checks/docker.go` — Docker installed + daemon running
- `internal/preflight/checks/aws.go` — AWS CLI installed + SSO session valid
- `internal/preflight/checks/hosts.go` — /etc/hosts entry
- `internal/preflight/checks/mkcert.go` — mkcert availability (optional/warn)
- `internal/preflight/checks/certs.go` — SSL certificates in app/certificates/
- `internal/preflight/checks/env.go` — .env files exist with required vars
- `internal/preflight/checks/jwt.go` — JWT RSA key pairs in .env files
- `internal/preflight/checks/mysql.go` — MySQL Docker container running
- `internal/preflight/fixers/fixer.go` — Fixer interface, CommandFixer helper
- `internal/preflight/fixers/aws.go` — aws sso login flow
- `internal/preflight/fixers/env.go` — .env generation via huh forms
- `internal/preflight/fixers/certs.go` — mkcert certificate generation
- `internal/preflight/fixers/jwt.go` — RSA key pair generation
- `internal/preflight/fixers/hosts.go` — /etc/hosts append with sudo
- `internal/preflight/fixers/mysql.go` — docker compose up app-mysql
- `internal/preflight/fixers/pnpm.go` — corepack enable + prepare
- `internal/tui/preflight_view.go` — Checklist + fix form rendering
- `internal/preflight/runner_test.go` — Runner tests
- `internal/preflight/checks/node_test.go` — Node check tests
- `internal/preflight/checks/env_test.go` — Env check tests
- `internal/preflight/fixers/jwt_test.go` — JWT fixer tests

### Modified Files

- `go.mod` — Add `charm.land/huh/v2` dependency
- `internal/tui/model.go` — Add Phase enum, preflight state fields, phase transitions
- `internal/tui/update.go` — Handle preflight messages, delegate to huh form
- `internal/tui/view.go` — Route View() based on phase
- `internal/tui/styles.go` — Add preflight-specific styles
- `dev-runner.yml` — Remove check-deps.sh hook

---

### Task 1: Add huh dependency and create check/fixer interfaces

**Files:**

- Modify: `dev-runner/go.mod`
- Create: `dev-runner/internal/preflight/check.go`
- Create: `dev-runner/internal/preflight/fixers/fixer.go`

- [ ] **Step 1: Add huh dependency**

```bash
cd dev-runner && go get charm.land/huh/v2@latest
```

- [ ] **Step 2: Create check.go with core types**

Create `dev-runner/internal/preflight/check.go`:

```go
package preflight

import "context"

// Status represents the result of a preflight check.
type Status int

const (
	StatusPass Status = iota
	StatusFail
	StatusWarn
	StatusSkip
)

func (s Status) String() string {
	switch s {
	case StatusPass:
		return "pass"
	case StatusFail:
		return "fail"
	case StatusWarn:
		return "warn"
	case StatusSkip:
		return "skip"
	default:
		return "unknown"
	}
}

// CheckResult holds the outcome of a single preflight check.
type CheckResult struct {
	Status       Status
	Name         string
	Category     string
	Message      string
	FixAvailable bool
	InstallHint  string // For unfixable items: install command or URL
}

// Check verifies a single prerequisite.
type Check interface {
	Name() string
	Category() string
	Run(ctx context.Context, projectRoot string) CheckResult
}

// Fixer resolves a failed check. It may run commands or prompt the user.
type Fixer interface {
	// Fix attempts to resolve the issue. Returns nil on success.
	Fix(ctx context.Context, projectRoot string) error
}

// CheckWithFixer pairs a Check with its optional Fixer.
type CheckWithFixer struct {
	Check Check
	Fixer Fixer // nil if not auto-fixable
}

// Category groups checks that run concurrently within the group.
// Categories themselves run sequentially (Tools → Environment → Services).
const (
	CategoryTools       = "Tools"
	CategoryEnvironment = "Environment"
	CategoryServices    = "Services"
)
```

- [ ] **Step 3: Create fixer.go with helper types**

Create `dev-runner/internal/preflight/fixers/fixer.go`:

```go
package fixers

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// RunCommand executes a shell command and returns its combined output.
// Used by fixers that shell out to tools like aws, docker, mkcert, etc.
func RunCommand(ctx context.Context, dir string, command string) (string, error) {
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Dir = dir
	cmd.Env = os.Environ()

	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

// RunCommandInteractive runs a command that may need user interaction
// (e.g., aws sso login opens a browser). It streams output and waits
// for completion or context cancellation.
func RunCommandInteractive(ctx context.Context, dir string, command string, onOutput func(string)) error {
	cmd := exec.Command("sh", "-c", command)
	cmd.Dir = dir
	cmd.Env = os.Environ()
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	doneCh := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			if cmd.Process != nil {
				_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
				select {
				case <-doneCh:
				case <-time.After(3 * time.Second):
					_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
				}
			}
		case <-doneCh:
		}
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if onOutput != nil {
			onOutput(scanner.Text())
		}
	}

	waitErr := cmd.Wait()
	close(doneCh)

	if ctx.Err() != nil {
		return ctx.Err()
	}
	return waitErr
}
```

- [ ] **Step 4: Run go mod tidy and verify compilation**

```bash
cd dev-runner && go mod tidy && go build ./...
```

- [ ] **Step 5: Commit**

```bash
cd dev-runner && git add go.mod go.sum internal/preflight/
git commit -m "feat(dev-runner): add preflight check/fixer interfaces and huh dependency"
```

---

### Task 2: Implement Tool checks (Node, pnpm, Go, make, Docker, AWS CLI, mkcert)

**Files:**

- Create: `dev-runner/internal/preflight/checks/node.go`
- Create: `dev-runner/internal/preflight/checks/pnpm.go`
- Create: `dev-runner/internal/preflight/checks/golang.go`
- Create: `dev-runner/internal/preflight/checks/make.go`
- Create: `dev-runner/internal/preflight/checks/docker.go`
- Create: `dev-runner/internal/preflight/checks/aws.go`
- Create: `dev-runner/internal/preflight/checks/mkcert.go`
- Test: `dev-runner/internal/preflight/checks/node_test.go`

- [ ] **Step 1: Create node.go — Node version manager + Node.js version check**

Create `dev-runner/internal/preflight/checks/node.go`:

```go
package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const (
	requiredNodeMajor = 22
	requiredNodeMinor = 16
	requiredNodePatch = 0
)

// NodeVersionManagerCheck verifies one of mise, fnm, asdf, or nvm is available.
type NodeVersionManagerCheck struct{}

func (c *NodeVersionManagerCheck) Name() string     { return "Node version manager" }
func (c *NodeVersionManagerCheck) Category() string  { return preflight.CategoryTools }

func (c *NodeVersionManagerCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	managers := []string{"mise", "fnm", "asdf", "nvm"}
	for _, m := range managers {
		if _, err := exec.LookPath(m); err == nil {
			return preflight.CheckResult{
				Status:   preflight.StatusPass,
				Name:     c.Name(),
				Category: c.Category(),
				Message:  m + " found",
			}
		}
	}
	return preflight.CheckResult{
		Status:      preflight.StatusFail,
		Name:        c.Name(),
		Category:    c.Category(),
		Message:     "not found",
		InstallHint: "Install one of: mise, fnm, asdf, or nvm\nbrew install mise",
	}
}

// NodeCheck verifies Node.js >= 22.16.0.
type NodeCheck struct{}

func (c *NodeCheck) Name() string     { return fmt.Sprintf("Node.js %d.%d.%d+", requiredNodeMajor, requiredNodeMinor, requiredNodePatch) }
func (c *NodeCheck) Category() string { return preflight.CategoryTools }

func (c *NodeCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "node", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not found",
			InstallHint: "Install Node.js 22+: brew install node@22",
		}
	}

	version := strings.TrimSpace(strings.TrimPrefix(string(out), "v"))
	major, minor, patch := parseVersion(version)

	if major > requiredNodeMajor ||
		(major == requiredNodeMajor && minor > requiredNodeMinor) ||
		(major == requiredNodeMajor && minor == requiredNodeMinor && patch >= requiredNodePatch) {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "v" + version,
		}
	}

	return preflight.CheckResult{
		Status:      preflight.StatusFail,
		Name:        c.Name(),
		Category:    c.Category(),
		Message:     "v" + version + " (too old)",
		InstallHint: fmt.Sprintf("Upgrade to Node.js >= %d.%d.%d", requiredNodeMajor, requiredNodeMinor, requiredNodePatch),
	}
}

func parseVersion(v string) (int, int, int) {
	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 3 {
		return 0, 0, 0
	}
	// Strip any suffix after patch (e.g., "0-rc1")
	patchStr := strings.SplitN(parts[2], "-", 2)[0]
	major, _ := strconv.Atoi(parts[0])
	minor, _ := strconv.Atoi(parts[1])
	patch, _ := strconv.Atoi(patchStr)
	return major, minor, patch
}
```

- [ ] **Step 2: Create pnpm.go**

Create `dev-runner/internal/preflight/checks/pnpm.go`:

```go
package checks

import (
	"context"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const requiredPnpmVersion = "10.17.0"

// PnpmCheck verifies pnpm is available at the required version.
type PnpmCheck struct{}

func (c *PnpmCheck) Name() string     { return "pnpm " + requiredPnpmVersion }
func (c *PnpmCheck) Category() string { return preflight.CategoryTools }

func (c *PnpmCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "pnpm", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "not found",
			FixAvailable: true,
			InstallHint:  "Run: corepack enable && corepack prepare",
		}
	}

	version := strings.TrimSpace(string(out))
	if version == requiredPnpmVersion {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  version,
		}
	}

	return preflight.CheckResult{
		Status:       preflight.StatusFail,
		Name:         c.Name(),
		Category:     c.Category(),
		Message:      version + " (need " + requiredPnpmVersion + ")",
		FixAvailable: true,
		InstallHint:  "Run: corepack enable && corepack prepare pnpm@" + requiredPnpmVersion + " --activate",
	}
}
```

- [ ] **Step 3: Create golang.go**

Create `dev-runner/internal/preflight/checks/golang.go`:

```go
package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const requiredGoMajor = 1
const requiredGoMinor = 25

// GoCheck verifies Go >= 1.25.
type GoCheck struct{}

func (c *GoCheck) Name() string     { return fmt.Sprintf("Go %d.%d+", requiredGoMajor, requiredGoMinor) }
func (c *GoCheck) Category() string { return preflight.CategoryTools }

func (c *GoCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "go", "version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not found",
			InstallHint: "Install Go: brew install go",
		}
	}

	// "go version go1.25.7 darwin/arm64"
	fields := strings.Fields(string(out))
	if len(fields) < 3 {
		return preflight.CheckResult{
			Status:  preflight.StatusFail,
			Name:    c.Name(),
			Category: c.Category(),
			Message: "unknown version",
		}
	}

	versionStr := strings.TrimPrefix(fields[2], "go")
	major, minor, _ := parseVersion(versionStr)

	if major > requiredGoMajor || (major == requiredGoMajor && minor >= requiredGoMinor) {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  versionStr,
		}
	}

	return preflight.CheckResult{
		Status:      preflight.StatusFail,
		Name:        c.Name(),
		Category:    c.Category(),
		Message:     versionStr + " (too old)",
		InstallHint: fmt.Sprintf("Upgrade to Go >= %d.%d: brew upgrade go", requiredGoMajor, requiredGoMinor),
	}
}
```

- [ ] **Step 4: Create make.go**

Create `dev-runner/internal/preflight/checks/make.go`:

```go
package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// MakeCheck verifies make is available.
type MakeCheck struct{}

func (c *MakeCheck) Name() string     { return "make" }
func (c *MakeCheck) Category() string { return preflight.CategoryTools }

func (c *MakeCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	if _, err := exec.LookPath("make"); err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not found",
			InstallHint: "Install Xcode CLI tools: xcode-select --install",
		}
	}
	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "available",
	}
}
```

- [ ] **Step 5: Create docker.go**

Create `dev-runner/internal/preflight/checks/docker.go`:

```go
package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DockerCheck verifies Docker is installed and daemon is running.
type DockerCheck struct{}

func (c *DockerCheck) Name() string     { return "Docker" }
func (c *DockerCheck) Category() string { return preflight.CategoryTools }

func (c *DockerCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	if _, err := exec.LookPath("docker"); err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not installed",
			InstallHint: "Install Docker Desktop: https://docker.com/products/docker-desktop",
		}
	}

	// docker info succeeds only if daemon is running
	if err := exec.CommandContext(ctx, "docker", "info").Run(); err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "daemon not running",
			InstallHint: "Start Docker Desktop",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "running",
	}
}
```

- [ ] **Step 6: Create aws.go**

Create `dev-runner/internal/preflight/checks/aws.go`:

```go
package checks

import (
	"context"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const DefaultAWSProfile = "airobuild-dev-private-sso"

// AWSCLICheck verifies the AWS CLI is installed.
type AWSCLICheck struct{}

func (c *AWSCLICheck) Name() string     { return "AWS CLI" }
func (c *AWSCLICheck) Category() string { return preflight.CategoryTools }

func (c *AWSCLICheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "aws", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not found",
			InstallHint: "Install AWS CLI: brew install awscli",
		}
	}

	version := strings.Fields(strings.TrimSpace(string(out)))
	msg := "installed"
	if len(version) > 0 {
		msg = version[0]
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  msg,
	}
}

// AWSSSOCheck verifies an active AWS SSO session.
type AWSSSOCheck struct {
	Profile string
}

func (c *AWSSSOCheck) Name() string     { return "AWS SSO session" }
func (c *AWSSSOCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AWSSSOCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	profile := c.Profile
	if profile == "" {
		profile = DefaultAWSProfile
	}

	err := exec.CommandContext(ctx, "aws", "sts", "get-caller-identity",
		"--profile", profile,
		"--query", "Arn",
		"--output", "text",
	).Run()

	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "expired or not configured",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "authenticated (" + profile + ")",
	}
}
```

- [ ] **Step 7: Create mkcert.go**

Create `dev-runner/internal/preflight/checks/mkcert.go`:

```go
package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// MkcertCheck verifies mkcert is available. This is optional (warn, not fail).
type MkcertCheck struct{}

func (c *MkcertCheck) Name() string     { return "mkcert" }
func (c *MkcertCheck) Category() string { return preflight.CategoryTools }

func (c *MkcertCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	if _, err := exec.LookPath("mkcert"); err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusWarn,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "not found (optional)",
			InstallHint: "brew install mkcert",
		}
	}
	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "available",
	}
}
```

- [ ] **Step 8: Write a basic test for node version parsing**

Create `dev-runner/internal/preflight/checks/node_test.go`:

```go
package checks

import "testing"

func TestParseVersion(t *testing.T) {
	tests := []struct {
		input                  string
		major, minor, patch    int
	}{
		{"22.22.2", 22, 22, 2},
		{"22.16.0", 22, 16, 0},
		{"20.0.0", 20, 0, 0},
		{"22.16.0-rc1", 22, 16, 0},
		{"1.25.7", 1, 25, 7},
	}

	for _, tt := range tests {
		major, minor, patch := parseVersion(tt.input)
		if major != tt.major || minor != tt.minor || patch != tt.patch {
			t.Errorf("parseVersion(%q) = %d.%d.%d, want %d.%d.%d",
				tt.input, major, minor, patch, tt.major, tt.minor, tt.patch)
		}
	}
}
```

- [ ] **Step 9: Run tests**

```bash
cd dev-runner && go test ./internal/preflight/... -v
```

Expected: PASS

- [ ] **Step 10: Verify full build**

```bash
cd dev-runner && go build ./...
```

- [ ] **Step 11: Commit**

```bash
cd dev-runner && git add internal/preflight/checks/
git commit -m "feat(dev-runner): add tool checks (node, pnpm, go, make, docker, aws, mkcert)"
```

---

### Task 3: Implement Environment checks (hosts, env files, JWT, certs) and Services checks (MySQL)

**Files:**

- Create: `dev-runner/internal/preflight/checks/hosts.go`
- Create: `dev-runner/internal/preflight/checks/env.go`
- Create: `dev-runner/internal/preflight/checks/jwt.go`
- Create: `dev-runner/internal/preflight/checks/certs.go`
- Create: `dev-runner/internal/preflight/checks/mysql.go`
- Test: `dev-runner/internal/preflight/checks/env_test.go`

- [ ] **Step 1: Create hosts.go**

Create `dev-runner/internal/preflight/checks/hosts.go`:

```go
package checks

import (
	"context"
	"os"
	"runtime"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const hostsEntry = "127.0.0.1"
const hostsHostname = "local.gasket.dev-godaddy.com"

// HostsCheck verifies /etc/hosts has the required entry.
type HostsCheck struct{}

func (c *HostsCheck) Name() string     { return "/etc/hosts" }
func (c *HostsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *HostsCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	// Skip on WSL2
	if runtime.GOOS == "linux" {
		if data, err := os.ReadFile("/proc/version"); err == nil {
			if strings.Contains(strings.ToLower(string(data)), "microsoft") {
				return preflight.CheckResult{
					Status:   preflight.StatusSkip,
					Name:     c.Name(),
					Category: c.Category(),
					Message:  "skipped (WSL2)",
				}
			}
		}
	}

	data, err := os.ReadFile("/etc/hosts")
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "cannot read /etc/hosts",
			FixAvailable: true,
		}
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") {
			continue
		}
		if strings.Contains(line, hostsEntry) && strings.Contains(line, hostsHostname) {
			return preflight.CheckResult{
				Status:   preflight.StatusPass,
				Name:     c.Name(),
				Category: c.Category(),
				Message:  "configured",
			}
		}
	}

	return preflight.CheckResult{
		Status:       preflight.StatusFail,
		Name:         c.Name(),
		Category:     c.Category(),
		Message:      "missing " + hostsHostname,
		FixAvailable: true,
	}
}
```

- [ ] **Step 2: Create env.go — checks for .env files with required vars**

Create `dev-runner/internal/preflight/checks/env.go`:

```go
package checks

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// Required env vars for each file (key only, we check existence not value).
var appRequiredVars = []string{
	"NODE_ENV",
	"AUTH_TYPE",
}

var agentsRequiredVars = []string{
	"NODE_ENV",
	"AUTH_TYPE",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
}

// AppEnvCheck verifies app/.env exists with required vars.
type AppEnvCheck struct{}

func (c *AppEnvCheck) Name() string     { return "App .env" }
func (c *AppEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AppEnvCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	return checkEnvFile(projectRoot, "app/.env", appRequiredVars, c.Name(), c.Category())
}

// AgentsEnvCheck verifies agents/.env exists with required vars.
type AgentsEnvCheck struct{}

func (c *AgentsEnvCheck) Name() string     { return "Agents .env" }
func (c *AgentsEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AgentsEnvCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	return checkEnvFile(projectRoot, "agents/.env", agentsRequiredVars, c.Name(), c.Category())
}

func checkEnvFile(projectRoot, relPath string, requiredVars []string, name, category string) preflight.CheckResult {
	absPath := filepath.Join(projectRoot, relPath)

	if _, err := os.Stat(absPath); os.IsNotExist(err) {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         name,
			Category:     category,
			Message:      "missing",
			FixAvailable: true,
		}
	}

	vars, err := ParseEnvFile(absPath)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         name,
			Category:     category,
			Message:      "cannot read: " + err.Error(),
			FixAvailable: true,
		}
	}

	var missing []string
	for _, key := range requiredVars {
		val, ok := vars[key]
		if !ok || val == "" || val == `""` || val == "''" {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         name,
			Category:     category,
			Message:      fmt.Sprintf("missing vars: %s", strings.Join(missing, ", ")),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     name,
		Category: category,
		Message:  "configured",
	}
}

// ParseEnvFile reads a .env file and returns key-value pairs.
// Supports KEY=VALUE, KEY="VALUE", KEY='VALUE', and comments.
func ParseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	vars := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := parseEnvLine(line)
		if ok {
			vars[key] = value
		}
	}
	return vars, scanner.Err()
}

func parseEnvLine(line string) (string, string, bool) {
	idx := strings.IndexByte(line, '=')
	if idx < 1 {
		return "", "", false
	}
	key := strings.TrimSpace(line[:idx])
	value := strings.TrimSpace(line[idx+1:])

	// Strip surrounding quotes
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}

	return key, value, true
}
```

- [ ] **Step 3: Create jwt.go**

Create `dev-runner/internal/preflight/checks/jwt.go`:

```go
package checks

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// JWTKeysCheck verifies JWT key pairs exist in app and agents .env files.
type JWTKeysCheck struct{}

func (c *JWTKeysCheck) Name() string     { return "JWT keys" }
func (c *JWTKeysCheck) Category() string { return preflight.CategoryEnvironment }

func (c *JWTKeysCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	appEnv := filepath.Join(projectRoot, "app/.env")
	agentsEnv := filepath.Join(projectRoot, "agents/.env")

	appVars, err := ParseEnvFile(appEnv)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "app/.env not readable",
			FixAvailable: true,
		}
	}

	agentsVars, _ := ParseEnvFile(agentsEnv)

	appPrivate := strings.TrimSpace(appVars["JWT_PRIVATE_KEY"])
	appPublic := strings.TrimSpace(appVars["JWT_PUBLIC_KEY"])
	agentsPublic := strings.TrimSpace(agentsVars["JWT_PUBLIC_KEY"])

	if appPrivate == "" || appPublic == "" {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "missing in app/.env",
			FixAvailable: true,
		}
	}

	if agentsPublic == "" {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "missing in agents/.env",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "configured",
	}
}
```

- [ ] **Step 4: Create certs.go**

Create `dev-runner/internal/preflight/checks/certs.go`:

```go
package checks

import (
	"context"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// CertsCheck verifies SSL certificates exist in app/certificates/.
type CertsCheck struct{}

func (c *CertsCheck) Name() string     { return "SSL certificates" }
func (c *CertsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *CertsCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	certsDir := filepath.Join(projectRoot, "app", "certificates")

	entries, err := os.ReadDir(certsDir)
	if err != nil || len(entries) == 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "missing",
			FixAvailable: true,
		}
	}

	// Look for at least a .pem or .crt file
	hasCert := false
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() && (len(name) > 4) {
			ext := name[len(name)-4:]
			if ext == ".pem" || ext == ".crt" || ext == ".key" {
				hasCert = true
				break
			}
		}
	}

	if !hasCert {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "no cert files found",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "valid",
	}
}
```

- [ ] **Step 5: Create mysql.go**

Create `dev-runner/internal/preflight/checks/mysql.go`:

```go
package checks

import (
	"context"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const mysqlContainerName = "airo-app-mysql"

// MySQLCheck verifies the MySQL Docker container is running.
type MySQLCheck struct{}

func (c *MySQLCheck) Name() string     { return "MySQL" }
func (c *MySQLCheck) Category() string { return preflight.CategoryServices }

func (c *MySQLCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "docker", "ps",
		"--filter", "name="+mysqlContainerName,
		"--format", "{{.Status}}",
	).Output()

	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "cannot check (docker not available?)",
			FixAvailable: true,
		}
	}

	status := strings.TrimSpace(string(out))
	if status == "" {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "container not running",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "running",
	}
}
```

- [ ] **Step 6: Write env parsing test**

Create `dev-runner/internal/preflight/checks/env_test.go`:

```go
package checks

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseEnvFile(t *testing.T) {
	dir := t.TempDir()
	envFile := filepath.Join(dir, ".env")

	content := `# Comment
NODE_ENV=development
AUTH_TYPE=jwt
OPENAI_API_KEY="sk-test-123"
OPENAI_BASE_URL='https://example.com'
EMPTY_VAR=
QUOTED_EMPTY=""
`
	if err := os.WriteFile(envFile, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	vars, err := ParseEnvFile(envFile)
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		key, want string
	}{
		{"NODE_ENV", "development"},
		{"AUTH_TYPE", "jwt"},
		{"OPENAI_API_KEY", "sk-test-123"},
		{"OPENAI_BASE_URL", "https://example.com"},
		{"EMPTY_VAR", ""},
		{"QUOTED_EMPTY", ""},
	}

	for _, tt := range tests {
		got, ok := vars[tt.key]
		if !ok {
			t.Errorf("missing key %q", tt.key)
			continue
		}
		if got != tt.want {
			t.Errorf("vars[%q] = %q, want %q", tt.key, got, tt.want)
		}
	}
}

func TestCheckEnvFile_Missing(t *testing.T) {
	result := checkEnvFile(t.TempDir(), "nonexistent/.env", []string{"FOO"}, "test", "test")
	if result.Status != 1 { // StatusFail
		t.Errorf("expected StatusFail for missing file, got %v", result.Status)
	}
}
```

- [ ] **Step 7: Run tests and verify build**

```bash
cd dev-runner && go test ./internal/preflight/... -v && go build ./...
```

- [ ] **Step 8: Commit**

```bash
cd dev-runner && git add internal/preflight/checks/
git commit -m "feat(dev-runner): add environment and service checks (hosts, env, jwt, certs, mysql)"
```

---

### Task 4: Implement the preflight Runner (orchestrator)

**Files:**

- Create: `dev-runner/internal/preflight/runner.go`
- Test: `dev-runner/internal/preflight/runner_test.go`

- [ ] **Step 1: Create runner.go**

Create `dev-runner/internal/preflight/runner.go`:

```go
package preflight

import (
	"context"
	"sync"
)

// Runner orchestrates preflight checks by category.
// Categories run sequentially; checks within a category run concurrently.
type Runner struct {
	Categories []CategoryGroup
}

// CategoryGroup holds checks for a single category.
type CategoryGroup struct {
	Name   string
	Checks []CheckWithFixer
}

// RunAll executes all checks and returns results.
// Categories run in order. Within each category, checks run concurrently.
func (r *Runner) RunAll(ctx context.Context, projectRoot string) []CheckResult {
	var allResults []CheckResult

	for _, cat := range r.Categories {
		results := r.runCategory(ctx, projectRoot, cat)
		allResults = append(allResults, results...)
	}

	return allResults
}

// RunFailed re-runs only checks that previously failed.
func (r *Runner) RunFailed(ctx context.Context, projectRoot string, failedNames map[string]bool) []CheckResult {
	var allResults []CheckResult

	for _, cat := range r.Categories {
		var toRun []CheckWithFixer
		for _, cwf := range cat.Checks {
			if failedNames[cwf.Check.Name()] {
				toRun = append(toRun, cwf)
			}
		}
		if len(toRun) == 0 {
			continue
		}
		group := CategoryGroup{Name: cat.Name, Checks: toRun}
		results := r.runCategory(ctx, projectRoot, group)
		allResults = append(allResults, results...)
	}

	return allResults
}

func (r *Runner) runCategory(ctx context.Context, projectRoot string, cat CategoryGroup) []CheckResult {
	results := make([]CheckResult, len(cat.Checks))
	var wg sync.WaitGroup

	for i, cwf := range cat.Checks {
		wg.Add(1)
		go func(idx int, c Check) {
			defer wg.Done()
			results[idx] = c.Run(ctx, projectRoot)
		}(i, cwf.Check)
	}

	wg.Wait()
	return results
}

// FailedChecks returns CheckWithFixer entries whose checks failed and have fixers.
func (r *Runner) FailedChecks(results []CheckResult) []CheckWithFixer {
	nameToFixer := make(map[string]CheckWithFixer)
	for _, cat := range r.Categories {
		for _, cwf := range cat.Checks {
			nameToFixer[cwf.Check.Name()] = cwf
		}
	}

	var failed []CheckWithFixer
	for _, result := range results {
		if result.Status == StatusFail && result.FixAvailable {
			if cwf, ok := nameToFixer[result.Name]; ok && cwf.Fixer != nil {
				failed = append(failed, cwf)
			}
		}
	}
	return failed
}

// HasFailures returns true if any check failed (not warn).
func HasFailures(results []CheckResult) bool {
	for _, r := range results {
		if r.Status == StatusFail {
			return true
		}
	}
	return false
}

// FailedNames returns a set of names that failed.
func FailedNames(results []CheckResult) map[string]bool {
	names := make(map[string]bool)
	for _, r := range results {
		if r.Status == StatusFail {
			names[r.Name] = true
		}
	}
	return names
}
```

- [ ] **Step 2: Write runner test**

Create `dev-runner/internal/preflight/runner_test.go`:

```go
package preflight

import (
	"context"
	"testing"
)

// fakeCheck is a test helper that returns a fixed result.
type fakeCheck struct {
	name     string
	category string
	result   CheckResult
}

func (f *fakeCheck) Name() string     { return f.name }
func (f *fakeCheck) Category() string { return f.category }
func (f *fakeCheck) Run(_ context.Context, _ string) CheckResult {
	return f.result
}

func TestRunnerRunAll(t *testing.T) {
	runner := &Runner{
		Categories: []CategoryGroup{
			{
				Name: "Tools",
				Checks: []CheckWithFixer{
					{Check: &fakeCheck{
						name:     "Node.js",
						category: "Tools",
						result:   CheckResult{Status: StatusPass, Name: "Node.js", Category: "Tools", Message: "v22.22.2"},
					}},
					{Check: &fakeCheck{
						name:     "Go",
						category: "Tools",
						result:   CheckResult{Status: StatusFail, Name: "Go", Category: "Tools", Message: "not found"},
					}},
				},
			},
		},
	}

	results := runner.RunAll(context.Background(), "/tmp")
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Status != StatusPass {
		t.Errorf("expected Node.js pass, got %v", results[0].Status)
	}
	if results[1].Status != StatusFail {
		t.Errorf("expected Go fail, got %v", results[1].Status)
	}
}

func TestHasFailures(t *testing.T) {
	results := []CheckResult{
		{Status: StatusPass},
		{Status: StatusWarn},
	}
	if HasFailures(results) {
		t.Error("expected no failures")
	}

	results = append(results, CheckResult{Status: StatusFail})
	if !HasFailures(results) {
		t.Error("expected failures")
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd dev-runner && go test ./internal/preflight/... -v
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd dev-runner && git add internal/preflight/runner.go internal/preflight/runner_test.go
git commit -m "feat(dev-runner): add preflight runner orchestrator"
```

---

### Task 5: Implement fixers (pnpm, hosts, aws, mysql, certs)

**Files:**

- Create: `dev-runner/internal/preflight/fixers/pnpm.go`
- Create: `dev-runner/internal/preflight/fixers/hosts.go`
- Create: `dev-runner/internal/preflight/fixers/aws.go`
- Create: `dev-runner/internal/preflight/fixers/mysql.go`
- Create: `dev-runner/internal/preflight/fixers/certs.go`

- [ ] **Step 1: Create pnpm.go fixer**

Create `dev-runner/internal/preflight/fixers/pnpm.go`:

```go
package fixers

import "context"

// PnpmFixer enables corepack and prepares the required pnpm version.
type PnpmFixer struct{}

func (f *PnpmFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := RunCommand(ctx, projectRoot, "corepack enable"); err != nil {
		return err
	}
	_, err := RunCommand(ctx, projectRoot, "corepack prepare pnpm@10.17.0 --activate")
	return err
}
```

- [ ] **Step 2: Create hosts.go fixer**

Create `dev-runner/internal/preflight/fixers/hosts.go`:

```go
package fixers

import (
	"context"
	"fmt"
)

// HostsFixer appends the required entry to /etc/hosts using sudo.
type HostsFixer struct{}

func (f *HostsFixer) Fix(ctx context.Context, projectRoot string) error {
	entry := "127.0.0.1  local.gasket.dev-godaddy.com"
	cmd := fmt.Sprintf(`echo '%s' | sudo tee -a /etc/hosts > /dev/null`, entry)
	_, err := RunCommand(ctx, projectRoot, cmd)
	return err
}
```

- [ ] **Step 3: Create aws.go fixer**

Create `dev-runner/internal/preflight/fixers/aws.go`:

```go
package fixers

import (
	"context"
	"fmt"
	"os/exec"
	"time"
)

// AWSSSOFixer runs aws sso login for the selected profile and polls for success.
type AWSSSOFixer struct {
	Profile string
}

func (f *AWSSSOFixer) Fix(ctx context.Context, projectRoot string) error {
	profile := f.Profile
	if profile == "" {
		profile = "airobuild-dev-private-sso"
	}

	// Start the SSO login (opens browser)
	err := RunCommandInteractive(ctx, projectRoot,
		fmt.Sprintf("aws sso login --profile %s", profile), nil)
	if err != nil {
		return fmt.Errorf("aws sso login failed: %w", err)
	}

	// Poll for up to 120s to verify the session is active
	deadline := time.Now().Add(120 * time.Second)
	for time.Now().Before(deadline) {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := exec.CommandContext(ctx, "aws", "sts", "get-caller-identity",
			"--profile", profile).Run()
		if err == nil {
			return nil
		}
		time.Sleep(2 * time.Second)
	}

	return fmt.Errorf("SSO login timed out after 120s")
}
```

- [ ] **Step 4: Create mysql.go fixer**

Create `dev-runner/internal/preflight/fixers/mysql.go`:

```go
package fixers

import "context"

// MySQLFixer starts the MySQL container via docker compose.
type MySQLFixer struct{}

func (f *MySQLFixer) Fix(ctx context.Context, projectRoot string) error {
	_, err := RunCommand(ctx, projectRoot, "docker compose up app-mysql -d")
	return err
}
```

- [ ] **Step 5: Create certs.go fixer**

Create `dev-runner/internal/preflight/fixers/certs.go`:

```go
package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// CertsFixer generates SSL certificates using mkcert.
type CertsFixer struct{}

func (f *CertsFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("mkcert"); err != nil {
		return fmt.Errorf("mkcert not installed — install with: brew install mkcert")
	}

	certsDir := filepath.Join(projectRoot, "app", "certificates")
	if err := os.MkdirAll(certsDir, 0755); err != nil {
		return fmt.Errorf("creating certificates dir: %w", err)
	}

	// Install the local CA
	if _, err := RunCommand(ctx, projectRoot, "mkcert -install"); err != nil {
		return fmt.Errorf("mkcert -install failed: %w", err)
	}

	// Generate certs for local dev domain
	certFile := filepath.Join(certsDir, "localhost.pem")
	keyFile := filepath.Join(certsDir, "localhost-key.pem")
	cmd := fmt.Sprintf("mkcert -cert-file %s -key-file %s localhost local.gasket.dev-godaddy.com 127.0.0.1 ::1",
		certFile, keyFile)
	if _, err := RunCommand(ctx, projectRoot, cmd); err != nil {
		return fmt.Errorf("mkcert cert generation failed: %w", err)
	}

	return nil
}
```

- [ ] **Step 6: Verify build**

```bash
cd dev-runner && go build ./...
```

- [ ] **Step 7: Commit**

```bash
cd dev-runner && git add internal/preflight/fixers/
git commit -m "feat(dev-runner): add fixers (pnpm, hosts, aws, mysql, certs)"
```

---

### Task 6: Implement JWT fixer and env file generator fixer

**Files:**

- Create: `dev-runner/internal/preflight/fixers/jwt.go`
- Create: `dev-runner/internal/preflight/fixers/env.go`
- Test: `dev-runner/internal/preflight/fixers/jwt_test.go`

- [ ] **Step 1: Create jwt.go fixer — RSA key generation in pure Go**

Create `dev-runner/internal/preflight/fixers/jwt.go`:

```go
package fixers

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// JWTFixer generates RSA key pairs and injects them into .env files.
type JWTFixer struct{}

func (f *JWTFixer) Fix(ctx context.Context, projectRoot string) error {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("generating RSA key: %w", err)
	}

	privPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(privateKey),
	})

	pubBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return fmt.Errorf("marshaling public key: %w", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})

	privStr := strings.TrimSpace(string(privPEM))
	pubStr := strings.TrimSpace(string(pubPEM))

	// Update app/.env with both keys
	appEnvPath := filepath.Join(projectRoot, "app/.env")
	if err := upsertEnvVar(appEnvPath, "JWT_PRIVATE_KEY", privStr); err != nil {
		return fmt.Errorf("updating app/.env: %w", err)
	}
	if err := upsertEnvVar(appEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("updating app/.env: %w", err)
	}

	// Update agents/.env with public key only
	agentsEnvPath := filepath.Join(projectRoot, "agents/.env")
	if err := upsertEnvVar(agentsEnvPath, "JWT_PUBLIC_KEY", pubStr); err != nil {
		return fmt.Errorf("updating agents/.env: %w", err)
	}

	return nil
}

// upsertEnvVar adds or replaces a key in a .env file.
// For multiline values, wraps in double quotes.
func upsertEnvVar(path string, key string, value string) error {
	content, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	quotedValue := `"` + value + `"`
	newLine := key + "=" + quotedValue

	lines := strings.Split(string(content), "\n")
	found := false
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+"=") {
			lines[i] = newLine
			found = true
			break
		}
	}

	if !found {
		lines = append(lines, "", newLine)
	}

	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644)
}
```

- [ ] **Step 2: Write JWT fixer test**

Create `dev-runner/internal/preflight/fixers/jwt_test.go`:

```go
package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJWTFixer(t *testing.T) {
	dir := t.TempDir()

	// Create minimal .env files
	appEnv := filepath.Join(dir, "app/.env")
	agentsEnv := filepath.Join(dir, "agents/.env")
	os.MkdirAll(filepath.Join(dir, "app"), 0755)
	os.MkdirAll(filepath.Join(dir, "agents"), 0755)
	os.WriteFile(appEnv, []byte("NODE_ENV=development\n"), 0644)
	os.WriteFile(agentsEnv, []byte("NODE_ENV=development\n"), 0644)

	fixer := &JWTFixer{}
	if err := fixer.Fix(context.Background(), dir); err != nil {
		t.Fatal(err)
	}

	// Verify app/.env has both keys
	appContent, _ := os.ReadFile(appEnv)
	if !strings.Contains(string(appContent), "JWT_PRIVATE_KEY=") {
		t.Error("app/.env missing JWT_PRIVATE_KEY")
	}
	if !strings.Contains(string(appContent), "JWT_PUBLIC_KEY=") {
		t.Error("app/.env missing JWT_PUBLIC_KEY")
	}

	// Verify agents/.env has public key only
	agentsContent, _ := os.ReadFile(agentsEnv)
	if !strings.Contains(string(agentsContent), "JWT_PUBLIC_KEY=") {
		t.Error("agents/.env missing JWT_PUBLIC_KEY")
	}
	if strings.Contains(string(agentsContent), "JWT_PRIVATE_KEY=") {
		t.Error("agents/.env should NOT have JWT_PRIVATE_KEY")
	}
}

func TestUpsertEnvVar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	os.WriteFile(path, []byte("FOO=bar\nBAZ=qux\n"), 0644)

	// Update existing key
	upsertEnvVar(path, "FOO", "updated")
	content, _ := os.ReadFile(path)
	if !strings.Contains(string(content), `FOO="updated"`) {
		t.Errorf("expected FOO=updated, got: %s", content)
	}

	// Add new key
	upsertEnvVar(path, "NEW_KEY", "value")
	content, _ = os.ReadFile(path)
	if !strings.Contains(string(content), `NEW_KEY="value"`) {
		t.Errorf("expected NEW_KEY=value, got: %s", content)
	}
}
```

- [ ] **Step 3: Create env.go fixer — .env file generation with huh forms**

Create `dev-runner/internal/preflight/fixers/env.go`:

```go
package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"charm.land/huh/v2"
)

// EnvFixer generates .env files for app and agents using huh forms.
type EnvFixer struct {
	// Target is "app" or "agents"
	Target string
	// SyncFrom provides values from the other target's fixer (for agents syncing from app).
	SyncFrom *EnvValues
}

// EnvValues holds collected form values.
type EnvValues struct {
	AIProvider string
	APIKey     string
	BaseURL    string
	Model      string
	AuthType   string
}

func (f *EnvFixer) Fix(ctx context.Context, projectRoot string) error {
	if f.Target == "agents" && f.SyncFrom != nil {
		return f.generateAgentsEnv(projectRoot, f.SyncFrom)
	}

	values, err := f.collectValues()
	if err != nil {
		return err
	}

	// Store collected values for agents to sync from
	if f.SyncFrom == nil {
		f.SyncFrom = values
	}

	if f.Target == "app" {
		return f.generateAppEnv(projectRoot, values)
	}
	return f.generateAgentsEnv(projectRoot, values)
}

func (f *EnvFixer) collectValues() (*EnvValues, error) {
	values := &EnvValues{
		BaseURL: "https://caas-gocode-prod.caas-prod.prod.onkatana.net",
		Model:   "claude-sonnet-4",
	}

	// Check for env var default
	if envKey := os.Getenv("APPBUILDER_GOCODE_API_TOKEN"); envKey != "" {
		values.APIKey = envKey
	}

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title("GoCode API Key").
				Description("Get your key at: https://caas.open-webui.godaddy.com/workspace/apiKeys").
				Placeholder("sk-...").
				EchoMode(huh.EchoModePassword).
				Value(&values.APIKey).
				Validate(func(s string) error {
					if strings.TrimSpace(s) == "" {
						return fmt.Errorf("API key is required")
					}
					return nil
				}),

			huh.NewInput().
				Title("GoCode Base URL").
				Value(&values.BaseURL),

			huh.NewInput().
				Title("AI Model").
				Value(&values.Model),

			huh.NewSelect[string]().
				Title("Authentication Type").
				Options(
					huh.NewOption("JWT - Full auth with SSO (recommended)", "jwt"),
					huh.NewOption("Mock - Test users", "mock"),
					huh.NewOption("None - No authentication", "none"),
				).
				Value(&values.AuthType),
		),
	).WithTheme(huh.ThemeFunc(huh.ThemeCatppuccin))

	if err := form.Run(); err != nil {
		return nil, err
	}

	return values, nil
}

func (f *EnvFixer) generateAppEnv(projectRoot string, v *EnvValues) error {
	content := fmt.Sprintf(`# Airo Builder - App Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development
PORT=3000
HTTPS_PORT=8443

SHOW_USAGE_COST=true

AUTH_TYPE=%s
NEXT_PUBLIC_USE_MOCK_LOGIN=%s
`, v.AuthType, boolStr(v.AuthType == "mock"))

	envPath := filepath.Join(projectRoot, "app/.env")
	if err := writeFileAtomic(envPath, content); err != nil {
		return err
	}

	// Generate environment-specific files
	if err := generateAppEnvSpecific(projectRoot); err != nil {
		return err
	}

	return nil
}

func (f *EnvFixer) generateAgentsEnv(projectRoot string, v *EnvValues) error {
	content := fmt.Sprintf(`# Airo Builder - Agents Environment Configuration
# Generated by dev-runner preflight

NODE_ENV=development

AUTH_TYPE=%s

OPENAI_API_KEY="%s"
OPENAI_BASE_URL="%s"
OPENAI_MODEL="%s"

DEFAULT_PROVIDER=anthropic
ANTHROPIC_API_KEY="%s"
ANTHROPIC_BASE_URL="%s"
ANTHROPIC_MODEL="%s"

APP_TEMPLATE_DIR=app-templates/v8
SHOW_USAGE_COST=true

ENABLE_DATABASE_AGENT=false
ENABLE_COMMERCE_AGENT=false
ENABLE_SOCIAL=false

MYSQL_ROOT_HOST=localhost
MYSQL_ROOT_PORT=3306
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASS=

GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
GODADDY_API_BASE_URL=https://api.dev-godaddy.com
AGENT_URL=http://localhost:4000

DOWNLOAD_TEMP_DIR="/tmp/apps/archives"
CHANNEL_ID=web

ENABLE_AI_DEVTOOLS=true
`, v.AuthType, v.APIKey, v.BaseURL, v.Model,
		v.APIKey, v.BaseURL, v.Model)

	envPath := filepath.Join(projectRoot, "agents/.env")
	if err := writeFileAtomic(envPath, content); err != nil {
		return err
	}

	// Generate environment-specific files
	if err := generateAgentsEnvSpecific(projectRoot); err != nil {
		return err
	}

	return nil
}

func generateAppEnvSpecific(projectRoot string) error {
	envs := map[string]struct{ appURL, ssoHost, mgmtURL string }{
		"app/.env.local.dev": {
			appURL:  "https://local.gasket.dev-godaddy.com:8443",
			ssoHost: "sso.dev-godaddy.com",
			mgmtURL: "http://localhost:4100",
		},
		"app/.env.local.test": {
			appURL:  "https://airo-builder.test-godaddy.com",
			ssoHost: "sso.test-godaddy.com",
			mgmtURL: "https://mgmt.nstk.net",
		},
		"app/.env.local.prod": {
			appURL:  "https://airo-builder.godaddy.com",
			ssoHost: "sso.godaddy.com",
			mgmtURL: "https://mgmt.woosaas.godaddy.com",
		},
	}

	for relPath, cfg := range envs {
		content := fmt.Sprintf(`# Environment-specific configuration (generated by dev-runner)
NEXT_PUBLIC_APP_URL=%s
SSO_LOGIN_URL=https://%s/login
SSO_LOGOUT_URL=https://%s/logout
LOGIN_REDIRECT_URL=%s/
MGMT_AIRO_BASE_URL=%s
`, cfg.appURL, cfg.ssoHost, cfg.ssoHost, cfg.appURL, cfg.mgmtURL)

		if err := writeFileAtomic(filepath.Join(projectRoot, relPath), content); err != nil {
			return err
		}
	}
	return nil
}

func generateAgentsEnvSpecific(projectRoot string) error {
	envs := map[string]struct{ jwksURL, ssoHost string }{
		"agents/.env.local.dev": {
			jwksURL: "https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json",
			ssoHost: "sso.dev-godaddy.com",
		},
		"agents/.env.local.test": {
			jwksURL: "https://airo-builder.test-godaddy.com/.well-known/jwks.json",
			ssoHost: "sso.test-godaddy.com",
		},
		"agents/.env.local.prod": {
			jwksURL: "https://airo-builder.godaddy.com/.well-known/jwks.json",
			ssoHost: "sso.godaddy.com",
		},
	}

	for relPath, cfg := range envs {
		content := fmt.Sprintf(`# Environment-specific configuration (generated by dev-runner)
JWKS_URL=%s
SSO_HOST=%s
`, cfg.jwksURL, cfg.ssoHost)

		if err := writeFileAtomic(filepath.Join(projectRoot, relPath), content); err != nil {
			return err
		}
	}
	return nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// writeFileAtomic writes content to a temp file then renames, preventing partial writes.
func writeFileAtomic(path string, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmp, err := os.CreateTemp(dir, ".env-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()

	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return os.Rename(tmpPath, path)
}
```

- [ ] **Step 4: Run tests and verify build**

```bash
cd dev-runner && go test ./internal/preflight/... -v && go build ./...
```

- [ ] **Step 5: Commit**

```bash
cd dev-runner && git add internal/preflight/fixers/env.go internal/preflight/fixers/jwt.go internal/preflight/fixers/jwt_test.go
git commit -m "feat(dev-runner): add JWT and env file fixers with huh forms"
```

---

### Task 7: Integrate preflight into the TUI model — Phase enum and state

**Files:**

- Modify: `dev-runner/internal/tui/model.go`
- Modify: `dev-runner/internal/tui/styles.go`

- [ ] **Step 1: Add Phase enum and preflight state to model.go**

Add the Phase type and new message types at the top of model.go, after existing message types (after line 50):

```go
// --- Preflight phase ---

type Phase int

const (
	PhasePreflightChecking  Phase = iota
	PhasePreflightDashboard
	PhasePreflightFixing
	PhasePreflightVerifying
	PhaseHooks
	PhaseRunning
)

type preflightCheckDoneMsg struct {
	Result preflight.CheckResult
}

type preflightAllChecksDoneMsg struct {
	Results []preflight.CheckResult
}

type preflightFixDoneMsg struct {
	Err       error
	FixerName string
}

type preflightVerifyDoneMsg struct {
	Results []preflight.CheckResult
}

type preflightAutoAdvanceMsg struct{}
```

- [ ] **Step 2: Add preflight fields to Model struct**

Add these fields to the Model struct (after the hookAutoFollow field, around line 81):

```go
	// Preflight state
	phase              Phase
	preflightRunner    *preflight.Runner
	preflightResults   []preflight.CheckResult
	preflightFixQueue  []preflight.CheckWithFixer
	preflightFixIndex  int
	preflightFixForm   *huh.Form
	preflightFixStatus string // "Fixing: <name>..."
	preflightAppEnvValues *fixers.EnvValues // shared between app and agents env fixers
```

- [ ] **Step 3: Add imports to model.go**

Add to the import block:

```go
	"charm.land/huh/v2"
	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/fixers"
```

- [ ] **Step 4: Create the preflight runner builder in model.go**

Add a function to build the default runner with all checks and fixers:

```go
// buildPreflightRunner creates a Runner with all standard checks grouped by category.
func buildPreflightRunner() *preflight.Runner {
	appEnvFixer := &fixers.EnvFixer{Target: "app"}
	agentsEnvFixer := &fixers.EnvFixer{Target: "agents", SyncFrom: nil}

	return &preflight.Runner{
		Categories: []preflight.CategoryGroup{
			{
				Name: preflight.CategoryTools,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.NodeVersionManagerCheck{}},
					{Check: &checks.NodeCheck{}},
					{Check: &checks.PnpmCheck{}, Fixer: &fixers.PnpmFixer{}},
					{Check: &checks.GoCheck{}},
					{Check: &checks.MakeCheck{}},
					{Check: &checks.DockerCheck{}},
					{Check: &checks.AWSCLICheck{}},
					{Check: &checks.MkcertCheck{}},
				},
			},
			{
				Name: preflight.CategoryEnvironment,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.HostsCheck{}, Fixer: &fixers.HostsFixer{}},
					{Check: &checks.AWSSSOCheck{}, Fixer: &fixers.AWSSSOFixer{}},
					{Check: &checks.AppEnvCheck{}, Fixer: appEnvFixer},
					{Check: &checks.AgentsEnvCheck{}, Fixer: agentsEnvFixer},
					{Check: &checks.JWTKeysCheck{}, Fixer: &fixers.JWTFixer{}},
					{Check: &checks.CertsCheck{}, Fixer: &fixers.CertsFixer{}},
				},
			},
			{
				Name: preflight.CategoryServices,
				Checks: []preflight.CheckWithFixer{
					{Check: &checks.MySQLCheck{}, Fixer: &fixers.MySQLFixer{}},
				},
			},
		},
	}
}
```

- [ ] **Step 5: Update NewModel to initialize preflight state**

Modify `NewModel` to start in preflight phase instead of hooks. Change the return statement to set `phase: PhasePreflightChecking` and add `preflightRunner: buildPreflightRunner()`. Remove `hookRunning: true` from the initializer — hooks will start after preflight completes.

Replace the existing `NewModel` function body:

The key change is replacing `hookRunning: true` with `phase: PhasePreflightChecking` and not starting hooks in Init(). Instead, Init() kicks off the preflight check command:

```go
func NewModel(cfg *config.Config, projectRoot string) Model {
	mgr := process.NewManager(cfg.Processes, projectRoot)

	panes := make([]Pane, len(cfg.Processes))
	for i, p := range cfg.Processes {
		panes[i] = NewPane(p.Name, 80, 24)
	}

	ti := textinput.New()
	ti.Placeholder = "Search..."
	ti.CharLimit = 200

	items := buildSettingsItems(cfg)

	return Model{
		config:           cfg,
		projectRoot:      projectRoot,
		manager:          mgr,
		panes:            panes,
		activeTab:        0,
		lastErrorCount:   make([]int, len(cfg.Processes)),
		healthGeneration: make([]int, len(cfg.Processes)),
		mouseEnabled:     true,
		bellAllowed:      true,
		hookAutoFollow:   true,
		hookViewport:     newSoftWrapViewport(80, 24),
		searchInput:      ti,
		settingsItems:    items,
		phase:            PhasePreflightChecking,
		preflightRunner:  buildPreflightRunner(),
	}
}
```

- [ ] **Step 6: Update Init() to start preflight instead of hooks**

Replace the Init function:

```go
func (m Model) Init() tea.Cmd {
	runner := m.preflightRunner
	projectRoot := m.projectRoot
	return tea.Batch(
		m.tickCmd(),
		func() tea.Msg {
			results := runner.RunAll(context.Background(), projectRoot)
			return preflightAllChecksDoneMsg{Results: results}
		},
	)
}
```

- [ ] **Step 7: Add preflight styles to styles.go**

Add to `dev-runner/internal/tui/styles.go`:

```go
	preflightPassStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#00ff00"))

	preflightFailStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#ff0000"))

	preflightWarnStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#ffff00"))

	preflightSkipStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("#666666"))

	preflightCategoryStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("62")).
		MarginTop(1)

	preflightHeaderStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("15")).
		MarginBottom(1)

	preflightFooterStyle = lipgloss.NewStyle().
		Foreground(lipgloss.Color("244")).
		MarginTop(1)

	preflightFixTitleStyle = lipgloss.NewStyle().
		Bold(true).
		Foreground(lipgloss.Color("62")).
		MarginBottom(1)
```

- [ ] **Step 8: Verify build**

```bash
cd dev-runner && go build ./...
```

- [ ] **Step 9: Commit**

```bash
cd dev-runner && git add internal/tui/model.go internal/tui/styles.go
git commit -m "feat(dev-runner): add preflight phase and state to TUI model"
```

---

### Task 8: Wire preflight messages into Update() and add preflight view rendering

**Files:**

- Modify: `dev-runner/internal/tui/update.go`
- Create: `dev-runner/internal/tui/preflight_view.go`
- Modify: `dev-runner/internal/tui/view.go`

- [ ] **Step 1: Add preflight message handlers to Update()**

Add these cases to the `switch msg := msg.(type)` block in `Update()` in update.go, before the `case hookOutputMsg:` case:

```go
	case preflightAllChecksDoneMsg:
		m.preflightResults = msg.Results
		if preflight.HasFailures(msg.Results) {
			m.phase = PhasePreflightDashboard
		} else {
			// All pass — show briefly then auto-advance
			m.phase = PhasePreflightDashboard
			cmds = append(cmds, tea.Tick(1*time.Second, func(_ time.Time) tea.Msg {
				return preflightAutoAdvanceMsg{}
			}))
		}

	case preflightAutoAdvanceMsg:
		if m.phase == PhasePreflightDashboard && !preflight.HasFailures(m.preflightResults) {
			m.phase = PhaseHooks
			m.hookRunning = true
			ctx, cancel := context.WithCancel(context.Background())
			m.hookCancel = cancel
			hookCmd, hookDone := startHookRun(ctx, m.projectRoot, m.config.Hooks.PreStart)
			m.hookDone = hookDone
			cmds = append(cmds, hookCmd)
		}

	case preflightFixDoneMsg:
		if msg.Err != nil {
			m.preflightFixStatus = fmt.Sprintf("Fix failed: %v", msg.Err)
		} else {
			m.preflightFixIndex++
		}

		if m.preflightFixIndex >= len(m.preflightFixQueue) {
			// All fixes attempted — verify
			m.phase = PhasePreflightVerifying
			runner := m.preflightRunner
			projectRoot := m.projectRoot
			failedNames := preflight.FailedNames(m.preflightResults)
			cmds = append(cmds, func() tea.Msg {
				results := runner.RunFailed(context.Background(), projectRoot, failedNames)
				return preflightVerifyDoneMsg{Results: results}
			})
		} else {
			// Run next fixer
			cmds = append(cmds, m.runNextFixer())
		}

	case preflightVerifyDoneMsg:
		// Merge verification results back
		verified := make(map[string]preflight.CheckResult)
		for _, r := range msg.Results {
			verified[r.Name] = r
		}
		for i, r := range m.preflightResults {
			if v, ok := verified[r.Name]; ok {
				m.preflightResults[i] = v
			}
		}

		if preflight.HasFailures(m.preflightResults) {
			m.phase = PhasePreflightDashboard
		} else {
			m.phase = PhasePreflightDashboard
			cmds = append(cmds, tea.Tick(1*time.Second, func(_ time.Time) tea.Msg {
				return preflightAutoAdvanceMsg{}
			}))
		}
```

- [ ] **Step 2: Add handleKey for preflight phases**

In `handleKey()` in update.go, add handling for preflight dashboard before the existing `if m.hookRunning` block:

```go
	// Preflight phase key handling
	if m.phase == PhasePreflightDashboard {
		switch key {
		case "enter":
			fixable := m.preflightRunner.FailedChecks(m.preflightResults)
			if len(fixable) > 0 {
				m.preflightFixQueue = fixable
				m.preflightFixIndex = 0
				m.phase = PhasePreflightFixing
				return m.runNextFixer()
			}
		case "q":
			m.quitting = true
			return tea.Quit
		}
		return nil
	}

	if m.phase < PhaseHooks {
		return nil // No other keys during preflight
	}
```

- [ ] **Step 3: Add runNextFixer method to update.go**

Add this method to update.go:

```go
func (m *Model) runNextFixer() tea.Cmd {
	if m.preflightFixIndex >= len(m.preflightFixQueue) {
		return nil
	}
	cwf := m.preflightFixQueue[m.preflightFixIndex]
	name := cwf.Check.Name()
	m.preflightFixStatus = "Fixing: " + name + "..."
	fixer := cwf.Fixer
	projectRoot := m.projectRoot
	return func() tea.Msg {
		err := fixer.Fix(context.Background(), projectRoot)
		return preflightFixDoneMsg{Err: err, FixerName: name}
	}
}
```

- [ ] **Step 4: Update hooksCompleteMsg handler for phase awareness**

Modify the existing `case hooksCompleteMsg:` handler in Update() to set phase:

```go
	case hooksCompleteMsg:
		m.hookRunning = false
		m.hookErr = msg.Err
		m.refreshHookViewport()
		if msg.Err == nil {
			m.phase = PhaseRunning
			m.manager.StartAll()
			cmds = append(cmds, m.scheduleHealthChecks())
		}
```

- [ ] **Step 5: Create preflight_view.go**

Create `dev-runner/internal/tui/preflight_view.go`:

```go
package tui

import (
	"fmt"
	"strings"

	"charm.land/lipgloss/v2"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func (m Model) renderPreflightChecking() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Preflight Checks"))
	b.WriteString("\n\n")
	b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Render("Checking prerequisites..."))
	b.WriteString("\n")

	if len(m.preflightResults) > 0 {
		b.WriteString(m.renderCheckResults())
	}

	return b.String()
}

func (m Model) renderPreflightDashboard() string {
	var b strings.Builder

	failCount := 0
	for _, r := range m.preflightResults {
		if r.Status == preflight.StatusFail {
			failCount++
		}
	}

	header := "Preflight Checks"
	if failCount > 0 {
		header += fmt.Sprintf("  %s",
			preflightFailStyle.Render(fmt.Sprintf("%d issue(s) found", failCount)))
	} else {
		header += "  " + preflightPassStyle.Render("All clear ✓")
	}
	b.WriteString(preflightHeaderStyle.Render(header))
	b.WriteString("\n")

	b.WriteString(m.renderCheckResults())

	if failCount > 0 {
		b.WriteString("\n")
		fixable := m.preflightRunner.FailedChecks(m.preflightResults)
		if len(fixable) > 0 {
			b.WriteString(preflightFooterStyle.Render(
				fmt.Sprintf("%d item(s) can be auto-fixed. Press Enter to fix, q to quit.", len(fixable))))
		} else {
			b.WriteString(preflightFooterStyle.Render(
				"No auto-fixes available. Install missing tools and run again."))
		}
	}

	return b.String()
}

func (m Model) renderPreflightFixing() string {
	var b strings.Builder
	b.WriteString(preflightFixTitleStyle.Render("Fixing Issues"))
	b.WriteString("\n\n")

	for i, cwf := range m.preflightFixQueue {
		name := cwf.Check.Name()
		if i < m.preflightFixIndex {
			b.WriteString(preflightPassStyle.Render("  ✓ " + name))
			b.WriteString("\n")
		} else if i == m.preflightFixIndex {
			b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("62")).Bold(true).
				Render("  ◌ " + name + "..."))
			b.WriteString("\n")
		} else {
			b.WriteString(preflightSkipStyle.Render("  · " + name))
			b.WriteString("\n")
		}
	}

	if m.preflightFixStatus != "" {
		b.WriteString("\n")
		b.WriteString(lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Render(m.preflightFixStatus))
	}

	return b.String()
}

func (m Model) renderPreflightVerifying() string {
	var b strings.Builder
	b.WriteString(preflightHeaderStyle.Render("Verifying fixes..."))
	b.WriteString("\n\n")
	b.WriteString(m.renderCheckResults())
	return b.String()
}

func (m Model) renderCheckResults() string {
	var b strings.Builder

	// Group by category preserving order
	type catGroup struct {
		name    string
		results []preflight.CheckResult
	}
	var groups []catGroup
	seen := make(map[string]int)

	for _, r := range m.preflightResults {
		idx, ok := seen[r.Category]
		if !ok {
			idx = len(groups)
			seen[r.Category] = idx
			groups = append(groups, catGroup{name: r.Category})
		}
		groups[idx].results = append(groups[idx].results, r)
	}

	for _, g := range groups {
		b.WriteString(preflightCategoryStyle.Render("  " + g.name))
		b.WriteString("\n")

		for _, r := range g.results {
			icon, style := statusIcon(r.Status)
			line := fmt.Sprintf("    %s %-24s %s",
				style.Render(icon),
				r.Name,
				lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Render(r.Message))
			b.WriteString(line)
			b.WriteString("\n")

			if r.Status == preflight.StatusFail && r.InstallHint != "" && !r.FixAvailable {
				for _, hint := range strings.Split(r.InstallHint, "\n") {
					b.WriteString(fmt.Sprintf("      %s\n",
						lipgloss.NewStyle().Foreground(lipgloss.Color("244")).Italic(true).Render(hint)))
				}
			}
		}
	}

	return b.String()
}

func statusIcon(s preflight.Status) (string, lipgloss.Style) {
	switch s {
	case preflight.StatusPass:
		return "✓", preflightPassStyle
	case preflight.StatusFail:
		return "✗", preflightFailStyle
	case preflight.StatusWarn:
		return "⚠", preflightWarnStyle
	case preflight.StatusSkip:
		return "○", preflightSkipStyle
	default:
		return "?", preflightSkipStyle
	}
}
```

- [ ] **Step 6: Update View() to route based on phase**

Replace the rendering logic in `View()` in view.go. The `if m.hookRunning || m.hookErr != nil` block and the tab/content rendering should be replaced with phase-based routing:

```go
	} else {
		var sections []string

		switch m.phase {
		case PhasePreflightChecking:
			sections = append(sections, m.renderPreflightChecking())
		case PhasePreflightDashboard:
			sections = append(sections, m.renderPreflightDashboard())
		case PhasePreflightFixing:
			sections = append(sections, m.renderPreflightFixing())
		case PhasePreflightVerifying:
			sections = append(sections, m.renderPreflightVerifying())
		case PhaseHooks:
			sections = append(sections, m.renderHookView())
		case PhaseRunning:
			sections = append(sections, m.renderTabBar())
			sections = append(sections, m.renderContent())
			if m.searchOpen {
				sections = append(sections, m.renderSearchBar())
			}
			sections = append(sections, m.renderStatusBar())
		}
```

Also update the condition for hookRunning check. The existing `m.hookRunning` in handleKey should be replaced with phase awareness — the block `if m.hookRunning { return nil }` should be changed to check `m.phase == PhaseHooks && m.hookRunning`.

- [ ] **Step 7: Update handleKey hookRunning guard**

In handleKey(), replace:

```go
	if m.hookRunning {
		return nil
	}
```

with:

```go
	if m.phase == PhaseHooks {
		return nil
	}
```

- [ ] **Step 8: Update mouse wheel handling for hook phase**

In the `case tea.MouseWheelMsg:` handler, replace `if m.hookRunning || m.hookErr != nil` with `if m.phase == PhaseHooks`.

- [ ] **Step 9: Update viewport forwarding guard**

The condition `if m.ready && !m.settingsOpen && !m.searchOpen && !m.hookRunning` should become `if m.ready && !m.settingsOpen && !m.searchOpen && m.phase == PhaseRunning`.

- [ ] **Step 10: Update settings RestartAll to set phase back to hooks**

In `executeSettingsAction()`, the `ActionRestartAll` case should set `m.phase = PhaseHooks`:

```go
	case ActionRestartAll:
		m.phase = PhaseHooks
		m.hookRunning = true
		// ... rest stays the same
```

- [ ] **Step 11: Verify build**

```bash
cd dev-runner && go build ./...
```

- [ ] **Step 12: Commit**

```bash
cd dev-runner && git add internal/tui/
git commit -m "feat(dev-runner): wire preflight phases into TUI update and view"
```

---

### Task 9: Update dev-runner.yml and remove check-deps hook

**Files:**

- Modify: `dev-runner/dev-runner.yml`

- [ ] **Step 1: Remove the check-deps.sh hook from dev-runner.yml**

Replace the hooks section in `dev-runner/dev-runner.yml`:

```yaml
hooks:
  preStart:
    - name: Install dependencies
      command: pnpm install
      dir: .
    - name: Build packages
      command: pnpm build
      dir: .
```

The "Check dependencies" hook (`bash setup/check-deps.sh --integrated`) is removed because all its checks are now handled natively by the preflight system.

- [ ] **Step 2: Verify build and run smoke test**

```bash
cd dev-runner && go build ./... && make build
```

- [ ] **Step 3: Commit**

```bash
git add dev-runner/dev-runner.yml
git commit -m "feat(dev-runner): remove check-deps hook, now handled by preflight"
```

---

### Task 10: End-to-end verification and cleanup

**Files:**

- Modify: `dev-runner/go.mod` (tidy)

- [ ] **Step 1: Run go mod tidy**

```bash
cd dev-runner && go mod tidy
```

- [ ] **Step 2: Run all tests**

```bash
cd dev-runner && go test ./... -v
```

Expected: All tests pass.

- [ ] **Step 3: Run the full check suite**

```bash
cd dev-runner && make check
```

This runs fmt, vet, lint, and test.

- [ ] **Step 4: Build the binary**

```bash
cd dev-runner && make build
```

- [ ] **Step 5: Manual smoke test**

Run the dev-runner to verify the preflight UI appears:

```bash
cd dev-runner && make run
```

Verify:

- TUI launches immediately
- Preflight checklist appears with spinners resolving to pass/fail
- Dashboard shows results grouped by category
- If any checks fail, pressing Enter walks through fixers
- After fixes, verification re-runs failed checks
- On all-pass, auto-advances to hooks (pnpm install, pnpm build)
- Then transitions to normal process management TUI

- [ ] **Step 6: Final commit with go.sum updates**

```bash
cd dev-runner && git add go.mod go.sum
git commit -m "chore(dev-runner): tidy go modules after preflight addition"
```

---
