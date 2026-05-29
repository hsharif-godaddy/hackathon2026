package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// AiroAppBuilderOAuthCheck verifies that app/.env has the OAuth credentials
// used by the app BFF MCP proxy to exchange the logged-in customer JWT for a
// short-lived upstream Commerce MCP bearer token.
type AiroAppBuilderOAuthCheck struct{}

func (c *AiroAppBuilderOAuthCheck) Name() string     { return "AAB MCP OAuth" }
func (c *AiroAppBuilderOAuthCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AiroAppBuilderOAuthCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "app", ".env")

	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "app/.env not found; AAB MCP OAuth credentials need provisioning",
		}
	}

	requiredVars := []string{
		"AIRO_APP_BUILDER_CLIENT_ID",
		"AIRO_APP_BUILDER_CLIENT_SECRET",
	}

	var missing []string
	for _, key := range requiredVars {
		if v, ok := env[key]; !ok || strings.TrimSpace(v) == "" {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("AAB MCP OAuth credentials missing from app/.env (%s)", strings.Join(missing, ", ")),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "AAB MCP OAuth credentials configured",
	}
}
