package checks

import (
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// RustCheck verifies that rustc >= 1.85 and cargo are installed.
type RustCheck struct{}

func (c *RustCheck) Name() string     { return "Rust" }
func (c *RustCheck) Category() string { return preflight.CategoryTools }

func (c *RustCheck) Run(ctx context.Context, _ string) preflight.CheckResult {
	out, err := exec.CommandContext(ctx, "rustc", "--version").Output()
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "not installed (only needed for dev-supervisor work)",
		}
	}

	version := parseRustcVersion(strings.TrimSpace(string(out)))
	if version == "" {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("could not parse rustc version from: %s", strings.TrimSpace(string(out))),
		}
	}

	major, minor, _ := parseVersion(version)

	const (
		reqMajor = 1
		reqMinor = 85
	)

	ok := major > reqMajor || (major == reqMajor && minor >= reqMinor)
	if !ok {
		return preflight.CheckResult{
			Status:   preflight.StatusWarn,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("rustc %s found, need >= %d.%d for dev-supervisor work", version, reqMajor, reqMinor),
		}
	}

	_, cargoErr := exec.CommandContext(ctx, "cargo", "--version").Output()
	if cargoErr != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusWarn,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("rustc %s found but cargo missing", version),
		}
	}

	source := "system"
	if _, rustupErr := exec.LookPath("rustup"); rustupErr == nil {
		source = "rustup"
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("rustc %s (%s)", version, source),
	}
}

// parseRustcVersion extracts the semver from "rustc 1.95.0 (59807616e 2026-04-14)".
func parseRustcVersion(output string) string {
	fields := strings.Fields(output)
	if len(fields) >= 2 && fields[0] == "rustc" {
		return fields[1]
	}
	return ""
}
