package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// JWTKeysCheck verifies that JWT key variables are present in app/.env and
// agents/.env.
type JWTKeysCheck struct{}

func (c *JWTKeysCheck) Name() string     { return "JWT Keys" }
func (c *JWTKeysCheck) Category() string { return preflight.CategoryEnvironment }

func (c *JWTKeysCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	var missing []string

	// Check app/.env for JWT_PRIVATE_KEY and JWT_PUBLIC_KEY.
	appEnv, err := ParseEnvFile(filepath.Join(projectRoot, "app/.env"))
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("could not read app/.env: %v", err),
			FixAvailable: true,
		}
	}

	for _, key := range []string{"JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY"} {
		v, exists := appEnv[key]
		if !exists || v == "" {
			missing = append(missing, fmt.Sprintf("app/.env:%s", key))
		}
	}

	// Check agents/.env for JWT_PUBLIC_KEY.
	agentsEnv, err := ParseEnvFile(filepath.Join(projectRoot, "agents/.env"))
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("could not read agents/.env: %v", err),
			FixAvailable: true,
		}
	}

	if v, exists := agentsEnv["JWT_PUBLIC_KEY"]; !exists || v == "" {
		missing = append(missing, "agents/.env:JWT_PUBLIC_KEY")
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			Message:      fmt.Sprintf("missing JWT keys: %s", strings.Join(missing, ", ")),
			FixAvailable: true,
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "JWT keys present in app/.env and agents/.env",
	}
}
