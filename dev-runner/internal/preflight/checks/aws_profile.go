package checks

import (
	"context"
	"fmt"
	"os"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// AWSProfileCheck fails when AWS_PROFILE is set in the shell environment.
// The app and agents read AWS_PROFILE from their .env files; an AWS_PROFILE
// in the shell environment silently overrides those values and can cause
// authentication failures that are hard to diagnose.
type AWSProfileCheck struct{}

func (c *AWSProfileCheck) Name() string     { return "AWS_PROFILE env var" }
func (c *AWSProfileCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AWSProfileCheck) Run(_ context.Context, _ string) preflight.CheckResult {
	profile := os.Getenv("AWS_PROFILE")
	if profile != "" {
		return preflight.CheckResult{
			Status:      preflight.StatusFail,
			Name:        c.Name(),
			Category:    c.Category(),
			Message:     fmt.Sprintf("AWS_PROFILE=%q is set in your shell environment and will override .env settings", profile),
			InstallHint: "unset AWS_PROFILE  # remove from your shell profile to avoid auth surprises",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "not set in shell environment",
	}
}
