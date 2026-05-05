package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// loadEnvForCheck parses an env file and returns a read-error result if the
// file is missing or unreadable. On success it returns (nil, env).
func loadEnvForCheck(projectRoot, relPath, name, category string) (*preflight.CheckResult, map[string]string) {
	env, err := preflight.ParseEnvFile(filepath.Join(projectRoot, relPath))
	if err != nil {
		if os.IsNotExist(err) {
			return &preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         name,
				Category:     category,
				Message:      fmt.Sprintf("%s not found", relPath),
				FixAvailable: true,
			}, nil
		}
		return &preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     name,
			Category: category,
			Message:  fmt.Sprintf("could not read %s: %v", relPath, err),
		}, nil
	}
	return nil, env
}

// validateEnv checks a pre-parsed env map for required vars.
func validateEnv(env map[string]string, relPath string, requiredVars []string, name, category string) preflight.CheckResult {
	var missing []string
	for _, key := range requiredVars {
		if v, ok := env[key]; !ok || v == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         name,
			Category:     category,
			Message:      fmt.Sprintf("%s missing required vars: %s", relPath, strings.Join(missing, ", ")),
			FixAvailable: true,
		}
	}
	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     name,
		Category: category,
		Message:  fmt.Sprintf("%s present with required vars", relPath),
	}
}

// checkEnvFile parses the env file and validates required vars in one call.
func checkEnvFile(projectRoot, relPath string, requiredVars []string, name, category string) (preflight.CheckResult, map[string]string) {
	fail, env := loadEnvForCheck(projectRoot, relPath, name, category)
	if fail != nil {
		return *fail, nil
	}
	return validateEnv(env, relPath, requiredVars, name, category), env
}

// AppEnvCheck verifies that app/.env exists and contains required variables.
type AppEnvCheck struct{}

func (c *AppEnvCheck) Name() string     { return "App .env" }
func (c *AppEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AppEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	result, env := checkEnvFile(projectRoot, "app/.env", []string{
		"NODE_ENV",
		"AUTH_TYPE",
		"AWS_PROFILE",
	}, c.Name(), c.Category())

	if result.Status == preflight.StatusPass && env["AUTH_TYPE"] == "none" {
		result.Status = preflight.StatusFail
		result.Message = "AUTH_TYPE=none is no longer supported; use jwt or mock"
		result.FixAvailable = true
	}

	return result
}

// AgentsEnvCheck verifies that agents/.env exists and contains required variables.
type AgentsEnvCheck struct{}

func (c *AgentsEnvCheck) Name() string     { return "Agents .env" }
func (c *AgentsEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AgentsEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	fail, env := loadEnvForCheck(projectRoot, "agents/.env", c.Name(), c.Category())
	if fail != nil {
		return *fail
	}
	s2s := strings.EqualFold(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]), "true")

	required := []string{"NODE_ENV", "AUTH_TYPE"}
	if s2s {
		required = append(required,
			"AWS_PROFILE",
			"GOCODE_USE_S2S_AUTH",
			"OPENAI_BASE_URL",
			"ANTHROPIC_BASE_URL",
		)
	} else {
		required = append(required,
			"OPENAI_API_KEY",
			"OPENAI_BASE_URL",
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_BASE_URL",
		)
	}

	result := validateEnv(env, "agents/.env", required, c.Name(), c.Category())
	if result.Status != preflight.StatusPass {
		return result
	}

	if s2s {
		// Stale api-key credentials would shadow the S2S placeholder; flag them
		// as fixable so EnvFixer regenerates agents/.env cleanly.
		var stale []string
		for _, key := range []string{"OPENAI_API_KEY", "ANTHROPIC_API_KEY"} {
			if strings.TrimSpace(env[key]) != "" {
				stale = append(stale, key)
			}
		}
		if len(stale) > 0 {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message:      fmt.Sprintf("agents/.env has GOCODE_USE_S2S_AUTH=true but stale api-key vars set: %s", strings.Join(stale, ", ")),
			}
		}

		// BASE_URL vars must point at the S2S GoCode endpoint -- the api-key
		// LiteLLM proxy URL would route the IAM JWT to a backend that rejects it.
		var mismatched []string
		for _, key := range []string{"OPENAI_BASE_URL", "ANTHROPIC_BASE_URL"} {
			if strings.TrimSpace(env[key]) != preflight.S2SGoCodeEndpoint {
				mismatched = append(mismatched, key)
			}
		}
		if len(mismatched) > 0 {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message: fmt.Sprintf(
					"agents/.env has GOCODE_USE_S2S_AUTH=true but %s do not equal %s",
					strings.Join(mismatched, ", "),
					preflight.S2SGoCodeEndpoint,
				),
			}
		}
	}

	return result
}
