package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// CommerceOAuthCheck verifies that GoDaddy Commerce OAuth credentials are
// configured in agents/.env. The check is skipped only when the user has
// explicitly set ENABLE_COMMERCE_AGENT=false to opt out.
type CommerceOAuthCheck struct{}

func (c *CommerceOAuthCheck) Name() string     { return "Commerce OAuth" }
func (c *CommerceOAuthCheck) Category() string { return preflight.CategoryEnvironment }

func (c *CommerceOAuthCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "agents", ".env")

	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "agents/.env not found; skipping Commerce OAuth check",
		}
	}

	// Explicit opt-out: user has set ENABLE_COMMERCE_AGENT=false (case-insensitive).
	if strings.EqualFold(strings.TrimSpace(env["ENABLE_COMMERCE_AGENT"]), "false") {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "ENABLE_COMMERCE_AGENT=false; Commerce OAuth not required",
		}
	}

	requiredVars := []string{
		"GODADDY_OAUTH_CLIENT_ID",
		"GODADDY_OAUTH_CLIENT_SECRET",
		"GODADDY_OAUTH_ENCRYPTION_KEY",
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
			Message:      fmt.Sprintf("Commerce OAuth credentials missing (%s); set ENABLE_COMMERCE_AGENT=false in agents/.env to skip", strings.Join(missing, ", ")),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Commerce OAuth credentials configured",
	}
}
