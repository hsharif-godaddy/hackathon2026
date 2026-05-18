package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// defaultLocalGettyAPIURL is the Getty Images proxy for local dev (IAM).
// See docs/mediasearch.md.
const defaultLocalGettyAPIURL = "https://getty-images-proxy.api.dev-godaddy.com"

// GettyFixer writes Getty-related entries in agents/.env. It does not set
// IMAGE_SEARCH_DRIVER (that remains a separate media-search choice).
//
// It verifies that GOCODE_USE_S2S_AUTH=true is set (IAM JWT via AWS SSO).
//
// When GETTY_IMAGE_PROXY_URL is unset or blank, it is set to defaultLocalGettyAPIURL.
//
// Prior to the migration this fixer fetched GETTY_TOKEN from AWS Secrets
// Manager. That path is gone — agents now use sso-jwt tokens directly.
type GettyFixer struct{}

func (f *GettyFixer) Fix(ctx context.Context, projectRoot string) error {
	_ = ctx
	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	env, err := preflight.ParseEnvFile(agentsEnvPath)
	if err != nil {
		if !os.IsNotExist(err) {
			return fmt.Errorf("reading agents/.env: %w", err)
		}
		env = map[string]string{}
	}

	goCodeS2S := strings.EqualFold(strings.TrimSpace(env["GOCODE_USE_S2S_AUTH"]), "true")

	if strings.TrimSpace(env["GETTY_IMAGE_PROXY_URL"]) == "" {
		if err := upsertEnvVarUnquoted(agentsEnvPath, "GETTY_IMAGE_PROXY_URL", defaultLocalGettyAPIURL); err != nil {
			return fmt.Errorf("writing GETTY_IMAGE_PROXY_URL: %w", err)
		}
	}

	if !goCodeS2S {
		return fmt.Errorf(
			"getty auth is not configured in agents/.env.\n\n" +
				"Set GOCODE_USE_S2S_AUTH=true (AWS SSO profile mints the IAM JWT).\n\n" +
				"See docs/mediasearch.md",
		)
	}

	return nil
}
