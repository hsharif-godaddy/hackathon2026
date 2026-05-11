package checks

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DockerCheck verifies that docker is installed and the daemon is running.
// Reports the active context and kernel so devs can see at a glance whether
// they are on Docker Desktop, Lima (airo-sandbox), Colima, etc.
type DockerCheck struct{}

func (c *DockerCheck) Name() string     { return "Docker" }
func (c *DockerCheck) Category() string { return preflight.CategoryTools }

func (c *DockerCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	if _, err := exec.LookPath("docker"); err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "docker not installed",
		}
	}

	cmd := exec.CommandContext(ctx, "docker", "info", "--format", "{{.KernelVersion}}")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// docker info can fail for reasons beyond "daemon not running":
		// permission denied on the socket, missing context, bad DOCKER_HOST,
		// etc. Surface the first line of stderr so the preflight message is
		// actionable.
		detail := firstLine(strings.TrimSpace(stderr.String()))
		msg := "docker info failed"
		if detail != "" {
			msg = msg + ": " + detail
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  msg,
		}
	}
	kernel := strings.TrimSpace(stdout.String())

	// `docker info` doesn't expose the client-side active context name, so ask
	// the CLI. If `context show` fails, guess from inspected contexts:
	// desktop-linux first (Docker Desktop's default on macOS/Windows) and then
	// default (plain CLI install, Colima, etc.).
	ctxName := "unknown"
	if b, ctxErr := exec.CommandContext(ctx, "docker", "context", "show").Output(); ctxErr == nil {
		if name := strings.TrimSpace(string(b)); name != "" {
			ctxName = name
		}
	} else {
		for _, candidate := range []string{"desktop-linux", "default"} {
			if err := exec.CommandContext(ctx, "docker", "context", "inspect", candidate).Run(); err == nil {
				ctxName = candidate
				break
			}
		}
	}

	msg := fmt.Sprintf("context=%s", ctxName)
	if kernel != "" {
		msg += ", kernel=" + kernel
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  msg,
	}
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
