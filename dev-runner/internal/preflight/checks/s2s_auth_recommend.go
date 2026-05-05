package checks

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// S2SAuthRecommendCheck warns when agents/.env is configured for GoCode
// api-key auth instead of S2S (IAM JWT). The api-key path remains supported
// as a fallback (e.g. when S2S is degraded), so this is informational --
// registered as OptIn in the TUI so the migration fix isn't pre-selected.
type S2SAuthRecommendCheck struct{}

func (c *S2SAuthRecommendCheck) Name() string     { return "GoCode S2S auth (recommended)" }
func (c *S2SAuthRecommendCheck) Category() string { return preflight.CategoryEnvironment }

func (c *S2SAuthRecommendCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	env, err := preflight.ParseEnvFile(filepath.Join(projectRoot, "agents/.env"))
	if err != nil {
		// AgentsEnvCheck owns the missing/unreadable case; stay quiet here.
		// Distinguish the two so the message isn't misleading on permission/IO
		// errors where the file actually exists.
		message := "agents/.env not present yet"
		if !os.IsNotExist(err) {
			message = "agents/.env not readable (AgentsEnvCheck will report details)"
		}
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  message,
		}
	}

	if strings.EqualFold(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]), "true") {
		return preflight.CheckResult{
			Status:   preflight.StatusPass,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "GOCODE_USE_S2S_AUTH=true",
		}
	}

	// Only nudge once the api-key path is actually wired up. If required
	// vars are missing AgentsEnvCheck will fail and drive the user through
	// EnvFixer's form, which already offers the S2S choice.
	for _, key := range []string{
		"OPENAI_API_KEY", "OPENAI_BASE_URL",
		"ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
	} {
		if strings.TrimSpace(env[key]) == "" {
			return preflight.CheckResult{
				Status:   preflight.StatusPass,
				Name:     c.Name(),
				Category: c.Category(),
				Message:  "api-key mode incomplete -- AgentsEnvCheck will handle",
			}
		}
	}

	return preflight.CheckResult{
		Status:       preflight.StatusWarn,
		Name:         c.Name(),
		Category:     c.Category(),
		FixAvailable: true,
		Message: "Using GoCode api-key auth. " +
			"S2S (IAM JWT) is recommended for local dev; api-key mode " +
			"remains supported as a fallback. Select this fix to migrate.",
	}
}
