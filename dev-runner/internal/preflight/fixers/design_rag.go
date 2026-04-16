package fixers

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/airo-ai-builder/dev-runner/internal/sso"
)

const designRAGKnowbURL = "https://knowb.api.int.test-godaddy.com"

// DesignRAGFixer acquires an SSO JWT via OAuth device flow and creates the design-rag/.env file.
type DesignRAGFixer struct {
	TokenCache *sso.TokenCache
}

func (f *DesignRAGFixer) Fix(ctx context.Context, projectRoot string) error {
	token, err := f.TokenCache.GetToken(ctx)
	if err != nil {
		return fmt.Errorf("acquiring SSO JWT: %w", err)
	}
	if token == "" {
		return fmt.Errorf("SSO JWT token was empty")
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
