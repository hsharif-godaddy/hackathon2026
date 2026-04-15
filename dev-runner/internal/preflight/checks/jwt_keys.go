package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// JWTKeysCheck verifies that JWT signing keys are configured in both
// app/.env (private + public) and agents/.env (public only).
type JWTKeysCheck struct{}

func (c *JWTKeysCheck) Name() string     { return "JWT Keys" }
func (c *JWTKeysCheck) Category() string { return preflight.CategoryEnvironment }

func (c *JWTKeysCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	appEnv, appErr := preflight.ParseEnvFile(filepath.Join(projectRoot, "app", ".env"))
	agentsEnv, agentsErr := preflight.ParseEnvFile(filepath.Join(projectRoot, "agents", ".env"))

	// Both files missing -> skip (the env checks will catch that).
	// Non-existence errors (permission denied, etc.) -> fail with real error.
	if appErr != nil && agentsErr != nil {
		if os.IsNotExist(appErr) && os.IsNotExist(agentsErr) {
			return preflight.CheckResult{
				Status:   preflight.StatusSkip,
				Name:     c.Name(),
				Category: c.Category(),
				Message:  "env files not found; skipping JWT check",
			}
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("could not read env files: app=%v, agents=%v", appErr, agentsErr),
		}
	}

	var missing []string

	if appErr != nil {
		// AppEnvCheck already reports missing app/.env; skip that file here.
	} else {
		if strings.TrimSpace(appEnv["JWT_PRIVATE_KEY"]) == "" {
			missing = append(missing, "JWT_PRIVATE_KEY in app/.env")
		}
		if strings.TrimSpace(appEnv["JWT_PUBLIC_KEY"]) == "" {
			missing = append(missing, "JWT_PUBLIC_KEY in app/.env")
		}
	}

	if agentsErr != nil {
		// AgentsEnvCheck already reports missing agents/.env; skip that file here.
	} else {
		if strings.TrimSpace(agentsEnv["JWT_PUBLIC_KEY"]) == "" {
			missing = append(missing, "JWT_PUBLIC_KEY in agents/.env")
		}
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("missing JWT keys: %s", strings.Join(missing, ", ")),
			InstallHint:  "Run the fixer to generate an RSA key pair",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "JWT keys configured in app and agents",
	}
}
