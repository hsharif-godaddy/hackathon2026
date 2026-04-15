package checks

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GettyCheck verifies that Getty Images proxy credentials are configured
// in agents/.env when the getty image search driver is enabled, and
// validates that the token is accepted by the proxy.
type GettyCheck struct{}

func (c *GettyCheck) Name() string     { return "Getty Proxy" }
func (c *GettyCheck) Category() string { return preflight.CategoryEnvironment }

func (c *GettyCheck) Run(ctx context.Context, projectRoot string) preflight.CheckResult {
	envPath := filepath.Join(projectRoot, "agents", ".env")

	env, err := preflight.ParseEnvFile(envPath)
	if err != nil {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "agents/.env not found; skipping Getty check",
		}
	}

	driver := strings.TrimSpace(env["IMAGE_SEARCH_DRIVER"])
	if strings.EqualFold(driver, "getty") {
		// Fall through to validate credentials below.
	} else if driver == "" {
		// Not configured at all - media search will fail at runtime without a driver.
		return preflight.CheckResult{
			Status:       preflight.StatusFail,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "IMAGE_SEARCH_DRIVER not set; media search will fail at runtime",
			InstallHint:  "Run the fixer to fetch Getty credentials from AWS Secrets Manager",
		}
	} else {
		// Explicitly set to something other than getty (e.g. unsplash) - respect that.
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("IMAGE_SEARCH_DRIVER=%s; Getty proxy not required", driver),
		}
	}

	apiURL := strings.TrimSpace(env["GETTY_API_URL"])
	token := strings.TrimSpace(env["GETTY_TOKEN"])

	var missing []string
	if apiURL == "" {
		missing = append(missing, "GETTY_API_URL")
	}
	if token == "" {
		missing = append(missing, "GETTY_TOKEN")
	}

	if len(missing) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("IMAGE_SEARCH_DRIVER=getty but missing %s in agents/.env", strings.Join(missing, ", ")),
			InstallHint:  "./setup.sh",
		}
	}

	// Validate the token actually works by making a lightweight test request
	if err := validateGettyToken(ctx, apiURL, token); err != nil {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      fmt.Sprintf("Getty token is invalid or expired: %v", err),
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  "Getty proxy credentials configured and valid",
	}
}

// validateGettyToken makes a minimal search request to verify the token is accepted.
func validateGettyToken(ctx context.Context, apiURL, token string) error {
	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	url := strings.TrimRight(apiURL, "/") + "/v1/search?phrase=test&page_size=1"
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("x-app-key", "airo-app-builder")
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("connecting to proxy: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("token rejected (HTTP %d)", resp.StatusCode)
	}
	// Any other non-server-error status is fine — the token was accepted
	if resp.StatusCode >= 500 {
		return fmt.Errorf("proxy server error (HTTP %d)", resp.StatusCode)
	}
	return nil
}
