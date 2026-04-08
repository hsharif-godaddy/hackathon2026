package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// MakeCheck verifies that make is available on PATH.
type MakeCheck struct{}

func (c *MakeCheck) Name() string     { return "make" }
func (c *MakeCheck) Category() string { return preflight.CategoryTools }

func (c *MakeCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	path, err := exec.LookPath("make")
	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "make not found",
			InstallHint: "xcode-select --install",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  path,
	}
}
