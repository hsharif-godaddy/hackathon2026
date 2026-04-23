package checks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// ImageSearchEnvCheck verifies that image-search-service/.env exists and is
// configured. This is an optional service — only needed when working on media
// search features. Registered with OptIn: true in buildPreflightRunner.
type ImageSearchEnvCheck struct{}

func (c *ImageSearchEnvCheck) Name() string     { return "Image Search .env" }
func (c *ImageSearchEnvCheck) Category() string { return preflight.CategoryEnvironment }

func (c *ImageSearchEnvCheck) Run(_ context.Context, projectRoot string) preflight.CheckResult {
	result, _ := checkEnvFile(projectRoot, "image-search-service/.env", []string{
		"AWS_PROFILE",
		"GETTY_AUTH_TYPE",
		"ANTHROPIC_API_URL",
	}, c.Name(), c.Category())

	if result.Status != preflight.StatusPass {
		return result
	}

	// When using SSO JWT auth, verify the cert files exist on disk.
	envPath := filepath.Join(projectRoot, "image-search-service/.env")
	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("parsing image-search-service/.env: %v", err),
		}
	}

	if env["GETTY_AUTH_TYPE"] == "sso-jwt" {
		certPath := env["GETTY_CERT_PATH"]
		keyPath := env["GETTY_KEY_PATH"]
		if certPath == "" || keyPath == "" {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message:      "GETTY_AUTH_TYPE=sso-jwt but GETTY_CERT_PATH or GETTY_KEY_PATH not set",
			}
		}
		// Resolve relative paths relative to the env file directory.
		envDir := filepath.Dir(envPath)
		if !filepath.IsAbs(certPath) {
			certPath = filepath.Join(envDir, certPath)
		}
		if !filepath.IsAbs(keyPath) {
			keyPath = filepath.Join(envDir, keyPath)
		}
		if _, err := os.Stat(certPath); err != nil {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message:      fmt.Sprintf("Getty client cert not found at %s", certPath),
			}
		}
		if _, err := os.Stat(keyPath); err != nil {
			return preflight.CheckResult{
				Status:       preflight.StatusFail,
				Name:         c.Name(),
				Category:     c.Category(),
				FixAvailable: true,
				Message:      fmt.Sprintf("Getty client key not found at %s", keyPath),
			}
		}
	}

	return result
}
