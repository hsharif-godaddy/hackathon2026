package fixers

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const designRAGKnowbURL = "https://knowb.api.int.test-godaddy.com"

// DesignRAGFixer generates an SSO JWT and creates the design-rag/.env file.
type DesignRAGFixer struct{}

func (f *DesignRAGFixer) Fix(ctx context.Context, projectRoot string) error {
	if _, err := exec.LookPath("ssojwt"); err != nil {
		return fmt.Errorf("ssojwt not found in PATH — install from https://github.com/gdcorp-engineering/ssojwt")
	}

	// ssojwt prints prompts/browser-opening text to stderr and the JWT to stdout.
	// Use RunCommandStdout to capture only stdout.
	out, err := RunCommandStdout(ctx, projectRoot, "ssojwt", "-e", "test")
	if err != nil {
		return fmt.Errorf("ssojwt -e test: %w", err)
	}
	token := strings.TrimSpace(out)
	if token == "" {
		return fmt.Errorf("ssojwt returned empty token")
	}

	envDir := filepath.Join(projectRoot, "design-rag")
	if err := os.MkdirAll(envDir, 0755); err != nil {
		return fmt.Errorf("creating design-rag/: %w", err)
	}

	envPath := filepath.Join(envDir, ".env")
	content := fmt.Sprintf("SSO_JWT=%q\nKNOWB_URL=%s\n", token, designRAGKnowbURL)
	if err := os.WriteFile(envPath, []byte(content), 0600); err != nil {
		return fmt.Errorf("writing design-rag/.env: %w", err)
	}

	return nil
}
