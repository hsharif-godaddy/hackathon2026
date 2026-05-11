package checks

import (
	"context"
	"os"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// SandboxCheck reports the state of the dev-supervisor sandbox flag. The flag
// is controlled explicitly via `pnpm run sandbox:on` / `pnpm run sandbox:off`
// (written to .envrc.local). This check only reports — it does not flip the
// toggle.
type SandboxCheck struct{}

func (c *SandboxCheck) Name() string     { return "Sandbox" }
func (c *SandboxCheck) Category() string { return preflight.CategoryTools }

func (c *SandboxCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	val, set := os.LookupEnv("DEV_SUPERVISOR_SANDBOX_ENABLED")
	msg := "DEV_SUPERVISOR_SANDBOX_ENABLED="
	if set {
		msg += val
	} else {
		msg += "unset (default)"
	}
	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  msg,
	}
}
