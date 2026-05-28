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

// GettyFixer writes Getty-specific entries in agents/.env. It does not set
// IMAGE_SEARCH_DRIVER (that remains a separate media-search choice).
//
// Global S2S auth vars (USE_S2S_AUTH, S2S_AWS_PROFILE) are managed by
// EnvFixer; this fixer only handles Getty-specific config.
//
// Removes legacy GETTY_TOKEN and GETTY_API_URL if present.
//
// When GETTY_IMAGE_PROXY_URL is unset or blank, it is set to defaultLocalGettyAPIURL.
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

	for _, legacy := range []string{"GETTY_TOKEN", "GETTY_API_URL"} {
		if strings.TrimSpace(env[legacy]) != "" {
			if err := removeEnvVar(agentsEnvPath, legacy); err != nil {
				return fmt.Errorf("removing %s: %w", legacy, err)
			}
		}
	}

	if strings.TrimSpace(env["GETTY_IMAGE_PROXY_URL"]) == "" {
		if err := upsertEnvVarUnquoted(agentsEnvPath, "GETTY_IMAGE_PROXY_URL", defaultLocalGettyAPIURL); err != nil {
			return fmt.Errorf("writing GETTY_IMAGE_PROXY_URL: %w", err)
		}
	}

	s2s := strings.EqualFold(strings.TrimSpace(env["USE_S2S_AUTH"]), "true")
	if !s2s {
		return fmt.Errorf(
			"USE_S2S_AUTH=true is not set in agents/.env.\n\n" +
				"Run the main env fixer first to configure S2S auth",
		)
	}

	return nil
}
