package checks

import (
	"context"
	"os/exec"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DockerCheck verifies that docker is installed and the daemon is running.
type DockerCheck struct{}

func (c *DockerCheck) Name() string     { return "Docker" }
func (c *DockerCheck) Category() string { return preflight.CategoryTools }

func (c *DockerCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	// First: is the binary on PATH?
	if _, err := exec.LookPath("docker"); err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "docker not installed",
		}
	}

	// Second: is the daemon running?
	if err := exec.CommandContext(ctx, "docker", "info").Run(); err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "docker daemon not running",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "docker installed and daemon running",
	}
}
