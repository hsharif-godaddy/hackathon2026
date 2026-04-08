package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// S2SCertsCheck verifies that S2S client certificates (GraphQL and TestPilot)
// are configured in app/.env when AUTH_TYPE requires real authentication.
// Without these, venture API, Product Graph, and TestPilot calls fail at runtime.
type S2SCertsCheck struct{}

func (c *S2SCertsCheck) Name() string     { return "S2S Client Certs" }
func (c *S2SCertsCheck) Category() string { return preflight.CategoryEnvironment }

func (c *S2SCertsCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "app", ".env")

	env, err := ParseEnvFile(envPath)
	if err != nil {
		// .env doesn't exist yet — warn with fix available so it can be run after env generation
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "app/.env not found; S2S certs need to be fetched after env setup",
		}
	}

	authType := strings.TrimSpace(env["AUTH_TYPE"])
	if authType == "" || authType == "none" {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "AUTH_TYPE is none; S2S certs not required",
		}
	}

	requiredVars := []string{
		"GRAPHQL_CLIENT_CERT",
		"GRAPHQL_CLIENT_KEY",
		"TESTPILOT_CLIENT_CERT",
		"TESTPILOT_CLIENT_KEY",
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
			Message: fmt.Sprintf(
				"AUTH_TYPE=%s but missing %s in app/.env — S2S API calls will fail. "+
					"Set AUTH_TYPE=none for mock mode, or fetch certs via ./setup.sh",
				authType, strings.Join(missing, ", "),
			),
			InstallHint: "./setup.sh",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "S2S client certificates configured (GraphQL + TestPilot)",
	}
}
