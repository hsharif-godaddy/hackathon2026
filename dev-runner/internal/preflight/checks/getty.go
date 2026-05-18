package checks

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// GettyCheck verifies Getty Images proxy settings in agents/.env when Getty
// is in scope: IMAGE_SEARCH_DRIVER=getty or non-empty GETTY_IMAGE_PROXY_URL.
//
// Agents call the GoDaddy Getty Images proxy directly. Auth uses
// GOCODE_USE_S2S_AUTH=true (IAM JWT via AWS SSO profile).
//
// GETTY_IMAGE_PROXY_URL is optional (the agent picks a default per NODE_ENV).
// GETTY_TOKEN is no longer used; we surface a warning if it's still set.
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

	s2sEnabled := strings.EqualFold(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]), "true")

	if !s2sEnabled {
		return preflight.CheckResult{
			Status:       preflight.StatusWarn,
			Name:         c.Name(),
			Category:     c.Category(),
			FixAvailable: true,
			Message:      "Getty is in scope but GOCODE_USE_S2S_AUTH=true is not set in agents/.env",
			InstallHint: "Set GOCODE_USE_S2S_AUTH=true and configure AWS SSO (see docs/mediasearch.md). " +
				"Run the Getty preflight fixer to add a default GETTY_IMAGE_PROXY_URL.",
		}
	}

	apiURL := gettyURL
	if apiURL == "" {
		apiURL = defaultGettyDevURL
	}

	if legacy := strings.TrimSpace(env["GETTY_TOKEN"]); legacy != "" {
		return preflight.CheckResult{
			Status:   preflight.StatusWarn,
			Name:     c.Name(),
			Category: c.Category(),
			Message:  "GETTY_TOKEN is set but no longer used by agents (Bearer-to-airo-proxy path was removed). Safe to remove from agents/.env.",
		}
	}

	return preflight.CheckResult{
		Status:   preflight.StatusPass,
		Name:     c.Name(),
		Category: c.Category(),
		Message:  fmt.Sprintf("Getty configured (auth=GOCODE_USE_S2S_AUTH, url=%s)", apiURL),
	}
}
