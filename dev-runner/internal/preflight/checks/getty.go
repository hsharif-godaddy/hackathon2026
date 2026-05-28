package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GettyCheck verifies Getty-specific proxy settings in agents/.env when Getty
// is in scope: IMAGE_SEARCH_DRIVER=getty or non-empty GETTY_IMAGE_PROXY_URL.
//
// Global S2S auth vars (USE_S2S_AUTH, S2S_AWS_PROFILE) are validated by
// AgentsEnvCheck; this check only covers Getty-specific config: proxy URL
// and legacy vars (GETTY_TOKEN, GETTY_API_URL).
//
// GETTY_IMAGE_PROXY_URL is optional (the agent picks a default per NODE_ENV).
type GettyCheck struct{}

func (c *GettyCheck) Name() string     { return "Getty Proxy" }
func (c *GettyCheck) Category() string { return preflight.CategoryEnvironment }

// defaultGettyDevURL is used as the preflight liveness target when
// agents/.env doesn't specify GETTY_IMAGE_PROXY_URL.
const defaultGettyDevURL = "https://getty-images-proxy.api.dev-godaddy.com"

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
	gettyURL := strings.TrimSpace(env["GETTY_IMAGE_PROXY_URL"])
	gettyDriver := strings.EqualFold(driver, "getty")
	hasGettyURL := gettyURL != ""
	gettyInScope := gettyDriver || hasGettyURL

	// Another image driver with no Getty URL — nothing to validate.
	if driver != "" && !gettyDriver && !hasGettyURL {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  fmt.Sprintf("IMAGE_SEARCH_DRIVER=%s; Getty proxy not required", driver),
		}
	}

	if !gettyInScope {
		return preflight.CheckResult{
			Status:   preflight.StatusSkip,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "Getty not configured (set IMAGE_SEARCH_DRIVER=getty or GETTY_IMAGE_PROXY_URL); skipping Getty check",
		}
	}

	s2sEnabled := strings.EqualFold(strings.TrimSpace(env["USE_S2S_AUTH"]), "true")

	if !s2sEnabled {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "Getty is in scope but USE_S2S_AUTH=true is not set in agents/.env",
			InstallHint: "Set USE_S2S_AUTH=true and configure AWS SSO (see docs/mediasearch.md). " +
				"Run the Getty preflight fixer to add a default GETTY_IMAGE_PROXY_URL.",
		}
	}

	var legacyVars []string
	if strings.TrimSpace(env["GETTY_TOKEN"]) != "" {
		legacyVars = append(legacyVars, "GETTY_TOKEN")
	}
	if strings.TrimSpace(env["GETTY_API_URL"]) != "" {
		legacyVars = append(legacyVars, "GETTY_API_URL")
	}
	if len(legacyVars) > 0 {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message: fmt.Sprintf(
				"%s no longer used by agents. Remove from agents/.env.",
				strings.Join(legacyVars, " and "),
			),
		}
	}

	apiURL := gettyURL
	if apiURL == "" {
		apiURL = defaultGettyDevURL
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("Getty configured (url=%s)", apiURL),
	}
}
