package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GoCheck verifies that go >= 1.25 is installed.
type GoCheck struct{}

func (c *GoCheck) Name() string     { return "Go" }
func (c *GoCheck) Category() string { return preflight.CategoryTools }

func (c *GoCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "go", "version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "go not found",
		}
	}

	// Output looks like: "go version go1.25.7 darwin/arm64"
	raw := strings.TrimSpace(string(out))
	version := parseGoVersion(raw)
	if version == "" {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("could not parse go version from: %s", raw),
		}
	}

	major, minor, _ := parseVersion(version)

	const (
		reqMajor = 1
		reqMinor = 25
	)

	ok := major > reqMajor || (major == reqMajor && minor >= reqMinor)
	if !ok {
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("go %s found, need >= %d.%d", version, reqMajor, reqMinor),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("go %s", version),
	}
}

// parseGoVersion extracts the semver-like string from "go version go1.25.7 darwin/arm64".
// Returns the version number without the "go" prefix (e.g. "1.25.7").
func parseGoVersion(output string) string {
	// Find the token starting with "go1."
	for _, token := range strings.Fields(output) {
		if strings.HasPrefix(token, "go1.") || strings.HasPrefix(token, "go0.") {
			return strings.TrimPrefix(token, "go")
		}
	}
	return ""
}
