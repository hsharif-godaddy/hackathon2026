package checks

import (
	"context"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

const mysqlContainerName = "airo-app-mysql"

// MySQLCheck verifies that the airo-app-mysql Docker container is running.
type MySQLCheck struct{}

func (c *MySQLCheck) Name() string     { return "MySQL Container" }
func (c *MySQLCheck) Category() string { return preflight.CategoryServices }

func (c *MySQLCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	out, err := exec.CommandContext(
		ctx,
		"docker", "ps",
		"--filter", "name="+mysqlContainerName,
		"--format", "{{.Status}}",
	).Output()

	if err != nil {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     "docker command failed; is Docker running?",
			InstallHint: "https://docs.docker.com/get-docker/",
		}
	}

	status := strings.TrimSpace(string(out))
	if status == "" {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      mysqlContainerName + " container is not running",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  mysqlContainerName + ": " + status,
	}
}
