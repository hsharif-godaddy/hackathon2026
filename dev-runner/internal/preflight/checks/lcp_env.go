package checks

import (
	"context"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// LCPEnvCheck verifies that local-control-plane/.env exists and contains the
// auth configuration variables used to persist and synchronize local control
// plane settings.
type LCPEnvCheck struct{}

func (c *LCPEnvCheck) Name() string     { return "Control Plane .env" }
func (c *LCPEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *LCPEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	return checkEnvFile(projectRoot, "local-control-plane/.env", []string{
		"AUTH_TYPE",
		"SSO_HOST",
	}, c.Name(), c.Category())
}
