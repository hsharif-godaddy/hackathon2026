package checks

import (
	"context"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// LocalFeaturesCheck verifies that NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true in app/.env.
// Without this, switchboard feature flag overrides don't apply locally, so flags
// like appbuilder-brandbook will always resolve to false.
type LocalFeaturesCheck struct{}

func (c *LocalFeaturesCheck) Name() string     { return "Local Features" }
func (c *LocalFeaturesCheck) Category() string { return preflight.CategoryEnvironment }

func (c *LocalFeaturesCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "app", ".env")

	env, err := ParseEnvFile(envPath)
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "app/.env not found (will be checked after env setup)",
		}
	}

	val, exists := env["NEXT_PUBLIC_ENABLE_LOCAL_FEATURES"]
	if exists && val == "true" {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "local feature flag overrides enabled",
		}
	}

	return preflight.CheckResult{
		Status:       preflight.StatusWarn,
		Name:         c.Name(),
		Category:     c.Category(),
		Message:      "NEXT_PUBLIC_ENABLE_LOCAL_FEATURES not set to true — switchboard flags won't use local overrides, optional features may not work",
		FixAvailable: true,
	}
}
