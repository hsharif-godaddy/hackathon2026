package checks

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// KnowBCheck verifies that KnowB RAG configuration is present in agents/.env
// when the KnowB API base URL is configured. Also checks for the ssojwt binary.
type KnowBCheck struct{}

func (c *KnowBCheck) Name() string     { return "KnowB Config" }
func (c *KnowBCheck) Category() string { return preflight.CategoryEnvironment }

func (c *KnowBCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "agents", ".env")

	var issues []string

	env, err := ParseEnvFile(envPath)
	// When GOCODE_USE_S2S_AUTH=true, KnowB uses AWS IAM-based S2S tokens
	// instead of SSO_JWT, so SSO_JWT and ssojwt binary are not required.
	useS2S := env != nil && strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]) == "true"

	if err != nil {
		issues = append(issues, "agents/.env not found")
	} else if !useS2S {
		if v, ok := env["SSO_JWT"]; !ok || strings.TrimSpace(v) == "" {
			issues = append(issues, "SSO_JWT missing (set SSO_JWT or use GOCODE_USE_S2S_AUTH=true)")
		}
	}

	// ssojwt binary only needed when not using S2S auth
	if !useS2S {
		if _, err := exec.LookPath("ssojwt"); err != nil {
			issues = append(issues, "ssojwt binary not found in PATH")
		}
	}

	if len(issues) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("KnowB: %s", strings.Join(issues, "; ")),
			InstallHint:  "https://github.com/gdcorp-engineering/ssojwt",
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
