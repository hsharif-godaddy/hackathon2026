package fixers

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

const knowbAPIURL = "https://knowb.api.int.test-godaddy.com"

// KnowBFixer generates an SSO JWT and configures KnowB in agents/.env.
type KnowBFixer struct{}

func (f *KnowBFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("ssojwt"); err != nil {
		return fmt.Errorf("ssojwt not found in PATH — install from https://github.com/gdcorp-engineering/ssojwt")
	}

	// ssojwt prints prompts/browser-opening text to stderr and the JWT to stdout.
	// Use RunCommandStdout to capture only stdout, avoiding the prompt text
	// (e.g., "Opening https://ssojwt...") polluting the token value.
	out, err := RunCommandStdout(ctx, projectRoot, "ssojwt", "-e", "test")
	if err != nil {
		return fmt.Errorf("ssojwt -e test: %w", err)
	}
	token := strings.TrimSpace(out)
	if token == "" {
		return fmt.Errorf("ssojwt returned empty token")
	}

	agentsEnvPath := filepath.Join(projectRoot, "agents", ".env")

	if err := upsertEnvVar(agentsEnvPath, "SSO_JWT", token); err != nil {
		return fmt.Errorf("writing SSO_JWT: %w", err)
	}
	if err := upsertEnvVar(agentsEnvPath, "GODADDY_API_BASE_URL", knowbAPIURL); err != nil {
		return fmt.Errorf("writing GODADDY_API_BASE_URL: %w", err)
	}

	return nil
}
