package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// MkcertCheck verifies that mkcert is available. Missing mkcert is a warning,
// not a hard failure — it is optional for local HTTPS setup.
type MkcertCheck struct{}

func (c *MkcertCheck) Name() string     { return "mkcert" }
func (c *MkcertCheck) Category() string { return preflight.CategoryTools }

func (c *MkcertCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	path, err := exec.LookPath("mkcert")
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusWarn,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "mkcert not found (optional — needed for local HTTPS)",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  path,
	}
}
