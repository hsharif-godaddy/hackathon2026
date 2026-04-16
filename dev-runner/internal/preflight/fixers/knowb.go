package fixers

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/sso"
)

const knowbAPIURL = "https://knowb.api.int.test-godaddy.com"

// KnowBFixer acquires an SSO JWT via OAuth device flow and configures KnowB in agents/.env.
type KnowBFixer struct {
	TokenCache *sso.TokenCache
}

func (f *KnowBFixer) Fix(ctx context.Context, projectRoot string) error {
	token, err := f.TokenCache.GetToken(ctx)
	if err != nil {
		return fmt.Errorf("acquiring SSO JWT: %w", err)
	}
	if token == "" {
		return fmt.Errorf("SSO JWT token was empty")
	}

	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	if err := upsertEnvVar(agentsEnvPath, "SSO_JWT", token); err != nil {
		return fmt.Errorf("writing SSO_JWT: %w", err)
	}
	if err := upsertEnvVar(agentsEnvPath, "KNOWB_URL", knowbAPIURL); err != nil {
		return fmt.Errorf("writing KNOWB_URL: %w", err)
	}

	return nil
}
