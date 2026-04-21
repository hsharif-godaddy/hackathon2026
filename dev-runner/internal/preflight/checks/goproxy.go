package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GoProxyCheck verifies that GOPROXY is configured to use GoDaddy's
// Artifactory Go virtual repo. Without this, `go run` / `go build` in
// local-control-plane fails for private github.com/gdcorp-golang/* modules.
type GoProxyCheck struct{}

func (c *GoProxyCheck) Name() string     { return "Go Artifactory Proxy" }
func (c *GoProxyCheck) Category() string { return preflight.CategoryEnvironment }

func (c *GoProxyCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "go", "env", "GOPROXY", "GONOPROXY", "GONOSUMDB", "GOPRIVATE").Output()
	if err != nil {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message: fmt.Sprintf("could not read go env: %v", err),
		}
	}

	lines := strings.SplitN(string(out), "\n", 5)
	if len(lines) < 4 {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message: "unexpected output from go env",
		}
	}
	goproxy, gonoproxy, gonosumdb, goprivate := lines[0], lines[1], lines[2], lines[3]

	if !strings.Contains(goproxy, "gdartifactory1.jfrog.io") {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message:      "GOPROXY not configured for Artifactory -- local-control-plane build will fail for private Go modules",
			FixAvailable: true,
		}
	}

	// GONOPROXY="" (never explicitly set) is equivalent to "none" when
	// GOPRIVATE is also unset -- skip it to avoid a false positive for
	// developers who manually configured GOPROXY outside this fixer.
	if gonoproxy != "" && gonoproxy != "none" {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message:      "GONOPROXY not set to 'none' -- all modules should route through the Artifactory proxy",
			FixAvailable: true,
		}
	}

	if !strings.Contains(gonosumdb, "github.com/gdcorp-*") {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message:      "GONOSUMDB not set for gdcorp modules -- checksum verification will fail for private Go modules",
			FixAvailable: true,
		}
	}

	// Only warn if GONOPROXY is empty (meaning GOPRIVATE controls proxy bypass).
	// When GONOPROXY="none", Go routes all modules through the proxy regardless
	// of GOPRIVATE, so stale GOPRIVATE entries are harmless.
	if gonoproxy == "" && strings.Contains(goprivate, "gdcorp-") {
		return preflight.CheckResult{
			Status: preflight.StatusWarn, Name: c.Name(), Category: c.Category(),
			Message:      "GOPRIVATE includes gdcorp modules -- this bypasses the proxy and may cause checksum mismatches",
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status: preflight.StatusPass, Name: c.Name(), Category: c.Category(),
		Message: "GOPROXY configured for Artifactory",
	}
}
