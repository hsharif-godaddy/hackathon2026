package checks

import (
	"context"
	"os/exec"
	"runtime"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// MkcertCheck verifies that mkcert is available. Missing mkcert is a warning,
// not a hard failure — local HTTPS via Gasket dev certs works without it,
// but mkcert provides trusted certificates that avoid browser warnings.
type MkcertCheck struct{}

func (c *MkcertCheck) Name() string     { return "mkcert" }
func (c *MkcertCheck) Category() string { return preflight.CategoryTools }

func (c *MkcertCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	path, err := exec.LookPath("mkcert")
	if err != nil {
		hint := mkcertInstallHint()
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      "mkcert not found (optional — provides trusted local HTTPS certificates)",
			FixAvailable: true,
			InstallHint:  hint,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  path,
	}
}

func mkcertInstallHint() string {
	switch runtime.GOOS {
	case "darwin":
		return "brew install mkcert"
	case "linux":
		return "sudo apt-get install mkcert (or see https://github.com/FiloSottile/mkcert#installation)"
	default:
		return "see https://github.com/FiloSottile/mkcert#installation"
	}
}
