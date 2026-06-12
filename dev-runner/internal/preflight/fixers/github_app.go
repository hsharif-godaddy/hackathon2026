package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const githubAppSlug = "godaddy-airo-builder"

var githubAppSecrets = []struct {
	secretPath string
	envVar     string
}{
	{"/Katana/Secrets/airobuilde/app/test/GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_ID"},
	{"/Katana/Secrets/airobuilde/app/test/GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_CLIENT_SECRET"},
}

// GitHubAppFixer fetches GitHub App OAuth credentials from AWS Secrets Manager,
// writes them along with the app slug to app/.env and enables git remote sync
// in agents/.env
type GitHubAppFixer struct{}

func (f *GitHubAppFixer) Fix(ctx context.Context, projectRoot string) error {
	appEnvPath := filepath.Join(projectRoot, "app", ".env")
	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	type kv struct{ key, val string }
	appWrites := []kv{{"GITHUB_APP_SLUG", githubAppSlug}}

	for _, s := range githubAppSecrets {
		value := os.Getenv(s.envVar)
		if strings.TrimSpace(value) == "" {
			fetched, err := fetchAWSSecret(ctx, projectRoot, s.secretPath, s2sCertsAWSProfile, s2sCertsAWSRegion)
			if err != nil {
				return fmt.Errorf("fetching %s: %w", s.envVar, err)
			}
			value = fetched
		}
		appWrites = append(appWrites, kv{s.envVar, strings.TrimSpace(value)})
	}

	for _, w := range appWrites {
		if err := upsertEnvVar(appEnvPath, w.key, w.val); err != nil {
			return fmt.Errorf("writing %s to app/.env: %w", w.key, err)
		}
	}

	if err := upsertEnvVarUnquoted(agentsEnvPath, "ENABLE_GIT_REMOTE_SYNC", "true"); err != nil {
		return fmt.Errorf("writing ENABLE_GIT_REMOTE_SYNC to agents/.env: %w", err)
	}

	return nil
}
