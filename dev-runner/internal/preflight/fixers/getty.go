package fixers

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	gettyAPIURL     = "https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net"
	gettySecretPath = "/Katana/Secrets/airobuilde/app/dev-private-ecs/GETTY_TOKEN"
	gettyProfile    = "airobuild-dev-private-sso"
	gettyRegion     = "us-west-2"
)

// GettyFixer fetches the Getty Images proxy token from AWS Secrets Manager
// and writes it along with the API URL to agents/.env.
type GettyFixer struct{}

func (f *GettyFixer) Fix(ctx context.Context, projectRoot string) error {
	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	token, err := fetchAWSSecret(ctx, projectRoot, gettySecretPath, gettyProfile, gettyRegion)
	if err != nil {
		return fmt.Errorf("fetching GETTY_TOKEN: %w", err)
	}

	if err := upsertEnvVarUnquoted(agentsEnvPath, "IMAGE_SEARCH_DRIVER", "getty"); err != nil {
		return fmt.Errorf("writing IMAGE_SEARCH_DRIVER: %w", err)
	}
	if err := upsertEnvVar(agentsEnvPath, "GETTY_API_URL", gettyAPIURL); err != nil {
		return fmt.Errorf("writing GETTY_API_URL: %w", err)
	}
	escapedToken := strings.ReplaceAll(strings.TrimSpace(token), "\n", "\\n")
	if err := upsertEnvVar(agentsEnvPath, "GETTY_TOKEN", escapedToken); err != nil {
		return fmt.Errorf("writing GETTY_TOKEN: %w", err)
	}

	return nil
}
