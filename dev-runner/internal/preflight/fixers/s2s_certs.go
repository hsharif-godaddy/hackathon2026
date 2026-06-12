package fixers

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	s2sCertsAWSProfile = "airobuild-dev-private-sso"
	s2sCertsAWSRegion  = "us-west-2"
)

var s2sCertSecrets = []struct {
	secretPath string
	envVar     string
}{
	{"/Katana/Secrets/airobuilde/app/test/GRAPHQL_CLIENT_CERT", "GRAPHQL_CLIENT_CERT"},
	{"/Katana/Secrets/airobuilde/app/test/GRAPHQL_CLIENT_KEY", "GRAPHQL_CLIENT_KEY"},
}

// S2SCertsFixer fetches GraphQL client certificates from
// AWS Secrets Manager and writes them to app/.env.
type S2SCertsFixer struct{}

func (f *S2SCertsFixer) Fix(ctx context.Context, projectRoot string) error {
	appEnvPath := filepath.Join(projectRoot, "app", ".env")

	for _, s := range s2sCertSecrets {
		value, err := fetchAWSSecret(ctx, projectRoot, s.secretPath, s2sCertsAWSProfile, s2sCertsAWSRegion)
		if err != nil {
			return fmt.Errorf("fetching %s: %w", s.envVar, err)
		}

		// Escape newlines for .env storage
		escaped := strings.ReplaceAll(strings.TrimSpace(value), "\n", "\\n")
		if err := upsertEnvVar(appEnvPath, s.envVar, escaped); err != nil {
			return fmt.Errorf("writing %s to app/.env: %w", s.envVar, err)
		}
	}

	return nil
}

// fetchAWSSecret retrieves a secret from AWS Secrets Manager.
func fetchAWSSecret(ctx context.Context, dir, secretID, profile, region string) (string, error) {
	out, err := RunCommand(ctx, dir, "aws", "secretsmanager", "get-secret-value",
		"--secret-id", secretID,
		"--profile", profile,
		"--region", region,
		"--query", "SecretString",
		"--output", "text",
	)
	if err != nil {
		return "", fmt.Errorf("aws secretsmanager: %w\nOutput: %s", err, out)
	}
	if strings.TrimSpace(out) == "" || strings.TrimSpace(out) == "null" {
		return "", fmt.Errorf("empty secret returned for %s", secretID)
	}
	return out, nil
}
