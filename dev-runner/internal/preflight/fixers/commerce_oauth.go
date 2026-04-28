package fixers

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	commerceClientID = "c16c68eb-0c20-437c-90bd-1c78911b3d48"
	commerceProfile  = "airobuild-dev-private-sso"
	commerceRegion   = "us-west-2"
)

var commerceSecrets = []struct {
	secretPath string
	envVar     string
}{
	{"/Katana/Secrets/airobuilde/app/dev-private-ecs/GODADDY_OAUTH_CLIENT_SECRET", "GODADDY_OAUTH_CLIENT_SECRET"},
	{"/Katana/Secrets/airobuilde/app/dev-private-ecs/GODADDY_OAUTH_ENCRYPTION_KEY", "GODADDY_OAUTH_ENCRYPTION_KEY"},
}

// CommerceOAuthFixer fetches GoDaddy Commerce OAuth credentials from
// AWS Secrets Manager and writes them to agents/.env.
type CommerceOAuthFixer struct{}

func (f *CommerceOAuthFixer) Fix(ctx context.Context, projectRoot string) error {
	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	type kv struct{ key, val string }
	writes := []kv{{"GODADDY_OAUTH_CLIENT_ID", commerceClientID}}

	for _, s := range commerceSecrets {
		value, err := fetchAWSSecret(ctx, projectRoot, s.secretPath, commerceProfile, commerceRegion)
		if err != nil {
			return fmt.Errorf("fetching %s: %w", s.envVar, err)
		}
		writes = append(writes, kv{s.envVar, strings.ReplaceAll(strings.TrimSpace(value), "\n", "\\n")})
	}

	// Write ENABLE_COMMERCE_AGENT last so a partial failure on any fetch
	// leaves the env without the flag, keeping the check in Warn+FixAvailable.
	writes = append(writes, kv{"ENABLE_COMMERCE_AGENT", "true"})

	for _, w := range writes {
		if err := upsertEnvVar(agentsEnvPath, w.key, w.val); err != nil {
			return fmt.Errorf("writing %s: %w", w.key, err)
		}
	}

	return nil
}
