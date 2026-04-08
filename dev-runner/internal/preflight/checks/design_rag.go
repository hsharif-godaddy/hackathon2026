package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// DesignRAGCheck verifies that the design-rag/.env file has required
// configuration when present. This is an optional experimental feature.
type DesignRAGCheck struct{}

func (c *DesignRAGCheck) Name() string     { return "Design RAG" }
func (c *DesignRAGCheck) Category() string { return preflight.CategoryEnvironment }

func (c *DesignRAGCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "design-rag", ".env")

	env, err := ParseEnvFile(envPath)
	if err != nil {
		// design-rag/.env doesn't exist — optional feature, skip.
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "design-rag/.env not found; Design RAG not configured",
		}
	}

	requiredVars := []string{"SSO_JWT", "KNOWB_URL"}

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
			Message:      fmt.Sprintf("design-rag/.env exists but missing %s", strings.Join(missing, ", ")),
			InstallHint:  "./setup.sh",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("Design RAG configured with %d vars", len(env)),
	}
}
