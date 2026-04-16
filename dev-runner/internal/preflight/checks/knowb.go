package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// KnowBCheck verifies that KnowB RAG configuration is present in agents/.env.
type KnowBCheck struct{}

func (c *KnowBCheck) Name() string     { return "KnowB Config" }
func (c *KnowBCheck) Category() string { return preflight.CategoryEnvironment }

func (c *KnowBCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "agents", ".env")

	var issues []string

	env, err := preflight.ParseEnvFile(envPath)
	// When GOCODE_USE_S2S_AUTH=true, KnowB uses AWS IAM-based S2S tokens
	// instead of SSO_JWT, so SSO_JWT is not required.
	useS2S := env != nil && strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]) == "true"

	if err != nil {
		issues = append(issues, "agents/.env not found")
	} else if !useS2S {
		if v, ok := env["SSO_JWT"]; !ok || strings.TrimSpace(v) == "" {
			issues = append(issues, "SSO_JWT missing (set SSO_JWT or use GOCODE_USE_S2S_AUTH=true)")
		}
	}

	if len(issues) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("KnowB: %s", strings.Join(issues, "; ")),
		}
	}

	msg := "KnowB configuration present"
	if useS2S {
		msg = "KnowB configured (S2S auth via AWS IAM)"
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  msg,
	}
}
