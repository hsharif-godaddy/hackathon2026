package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// ShellEnvConflictCheck warns when the shell environment exports variables
// that would override agents/.env at runtime. dotenv does not override
// pre-existing env vars, so shell-level OPENAI_BASE_URL / ANTHROPIC_BASE_URL
// / OPENAI_API_KEY silently supersede what dev-runner wrote -- a common
// foot-gun when switching into S2S mode, because the stale prod GoCode URL
// receives the IAM JWT and rejects it as a non-Virtual-Key.
//
// Not fixable from the TUI: the user must edit their shell profile.
type ShellEnvConflictCheck struct{}

func (c *ShellEnvConflictCheck) Name() string     { return "Shell env conflicts" }
func (c *ShellEnvConflictCheck) Category() string { return preflight.CategoryEnvironment }

// varsToCheck are the env vars whose shell-level export causes confusion.
// Keep this list narrow -- it's only vars dev-runner actively manages in
// agents/.env.
var shellConflictVars = []string{
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_BASE_URL",
	"GOCODE_USE_S2S_AUTH",
}

func (c *ShellEnvConflictCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	// Parse agents/.env so we can compare values. If it doesn't exist yet we
	// still warn, since the shell value would win once the file is created.
	fileEnv, _ := preflight.ParseEnvFile(filepath.Join(projectRoot, "agents/.env"))

	var conflicts []string
	for _, key := range shellConflictVars {
		shellVal, shellSet := os.LookupEnv(key)
		if !shellSet {
			continue
		}
		fileVal := strings.TrimSpace(fileEnv[key])
		if fileVal == strings.TrimSpace(shellVal) {
			// Shell and file agree -- no surprise, no conflict.
			continue
		}
		conflicts = append(conflicts, key)
	}

	if len(conflicts) == 0 {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "No shell-level overrides of agents/.env variables",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusWarn,
		Name:     c.Name(),
		Category: c.Category(),
		Message: fmt.Sprintf(
			"Shell exports %s; these override agents/.env at runtime. Unset them in your shell profile (~/.zshrc etc.) or the agents service will use stale values.",
			strings.Join(conflicts, ", "),
		),
	}
}
