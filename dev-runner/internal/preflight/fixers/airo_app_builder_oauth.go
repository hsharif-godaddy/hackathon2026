package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const airoAppBuilderClientID = "ff0f30c5-c3f5-4e4d-943a-4576d71df47a"

var airoAppBuilderSecrets = []struct {
	secretPath string
	envVar     string
}{
	{"/Katana/Secrets/airobuilde/app/dev-private-ecs/AIRO_APP_BUILDER_CLIENT_SECRET", "AIRO_APP_BUILDER_CLIENT_SECRET"},
}

// AiroAppBuilderOAuthFixer fetches the app BFF OAuth secret from AWS Secrets
// Manager and writes the AIRO_APP_BUILDER_* credentials to app/.env. These are
// intentionally separate from the GODADDY_OAUTH_* credentials in agents/.env,
// which are still provisioned into generated apps for runtime checkout flows.
type AiroAppBuilderOAuthFixer struct{}

func (f *AiroAppBuilderOAuthFixer) Fix(ctx context.Context, projectRoot string) error {
	appEnvPath := filepath.Join(projectRoot, "app", ".env")

	type kv struct{ key, val string }
	writes := []kv{{"AIRO_APP_BUILDER_CLIENT_ID", airoAppBuilderClientID}}

	for _, s := range airoAppBuilderSecrets {
		value := os.Getenv(s.envVar)
		if strings.TrimSpace(value) == "" {
			fetched, err := fetchAWSSecret(ctx, projectRoot, s.secretPath, commerceProfile, commerceRegion)
			if err != nil {
				return fmt.Errorf("fetching %s: %w", s.envVar, err)
			}
			value = fetched
		}
		writes = append(writes, kv{s.envVar, strings.ReplaceAll(strings.TrimSpace(value), "\n", "\\n")})
	}

	for _, w := range writes {
		if err := upsertEnvVar(appEnvPath, w.key, w.val); err != nil {
			return fmt.Errorf("writing %s: %w", w.key, err)
		}
	}

	return nil
}
