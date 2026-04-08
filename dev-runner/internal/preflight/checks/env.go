package checks

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// ParseEnvFile reads a .env file and returns a map of key → value.
// Supports:
//   - KEY=VALUE
//   - KEY="VALUE"
//   - KEY='VALUE'
//
// Ignores blank lines and lines starting with #.
func ParseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	result := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if k, v, ok := parseEnvLine(line); ok {
			result[k] = v
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

// parseEnvLine parses a single line from a .env file.
// Returns (key, value, true) on success, ("", "", false) otherwise.
func parseEnvLine(line string) (string, string, bool) {
	trimmed := strings.TrimSpace(line)
	// Skip blanks and comments.
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return "", "", false
	}

	idx := strings.IndexByte(trimmed, '=')
	if idx < 0 {
		return "", "", false
	}

	key := strings.TrimSpace(trimmed[:idx])
	if key == "" {
		return "", "", false
	}

	value := trimmed[idx+1:]

	// Strip optional surrounding quotes (single or double).
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			value = value[1 : len(value)-1]
		}
	}

	return key, value, true
}

// checkEnvFile is the shared implementation for env file checks.
func checkEnvFile(projectRoot, relPath string, requiredVars []string, name, category string) preflight.CheckResult {
	absPath := filepath.Join(projectRoot, relPath)

	env, err := ParseEnvFile(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         name,
				Category:     category,
				Message:      fmt.Sprintf("%s not found", relPath),
				FixAvailable: true,
			}
		}
		return preflight.CheckResult{
			Status:   preflight.StatusFail,
			Name:     name,
			Category: category,
			Message:  fmt.Sprintf("could not read %s: %v", relPath, err),
		}
	}

	var missing []string
	for _, key := range requiredVars {
		v, exists := env[key]
		if !exists || v == "" {
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

// AppEnvCheck verifies that app/.env exists and contains required variables.
type AppEnvCheck struct{}

func (c *AppEnvCheck) Name() string     { return "App .env" }
func (c *AppEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AppEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	return checkEnvFile(projectRoot, "app/.env", []string{
		"NODE_ENV",
		"AUTH_TYPE",
		"AWS_PROFILE",
	}, c.Name(), c.Category())
}

// AgentsEnvCheck verifies that agents/.env exists and contains required variables.
type AgentsEnvCheck struct{}

func (c *AgentsEnvCheck) Name() string     { return "Agents .env" }
func (c *AgentsEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *AgentsEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	return checkEnvFile(
		projectRoot,
		"agents/.env",
		[]string{
			"NODE_ENV",
			"AUTH_TYPE",
			"OPENAI_API_KEY",
			"OPENAI_BASE_URL",
			"ANTHROPIC_API_KEY",
			"ANTHROPIC_BASE_URL",
			"ANTHROPIC_MODEL",
		},
		c.Name(),
		c.Category(),
	)
}
