package checks

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
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

	// Config is correct; now confirm the JWT embedded in GOPROXY still
	// authenticates. Expired / revoked tokens here cause private gdcorp Go
	// modules to fail with 401 during build.
	token := jfrog.TokenFromProxyURL(goproxy)
	if token == "" {
		return preflight.CheckResult{
			Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
			Message:      "GOPROXY has no embedded Artifactory token -- private gdcorp Go modules will fail to download",
			FixAvailable: true,
		}
	}

	if err := jfrog.Probe(ctx, token); err != nil {
		if errors.Is(err, jfrog.ErrUnauthorized) {
			return preflight.CheckResult{
				Status: preflight.StatusFail, Name: c.Name(), Category: c.Category(),
				Message:      "Artifactory rejected the token embedded in GOPROXY (expired or revoked) -- go build will fail with 401",
				FixAvailable: true,
			}
		}
		// Anything else (timeout, DNS, TLS, 5xx) is inconclusive. Surface
		// the underlying error so a developer with e.g. a corporate-MITM
		// cert error doesn't chase phantom "offline" causes.
		return preflight.CheckResult{
			Status: preflight.StatusPass, Name: c.Name(), Category: c.Category(),
			Message: fmt.Sprintf("GOPROXY configured for Artifactory (probe inconclusive: %v)", err),
		}
	}

	return preflight.CheckResult{
		Status: preflight.StatusPass, Name: c.Name(), Category: c.Category(),
		Message: "GOPROXY configured for Artifactory, token verified",
	}
}
