package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func writeDesignRAGEnv(t *testing.T, projectRoot, content string) {
	t.Helper()
	dir := filepath.Join(projectRoot, "design-rag")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir design-rag/: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatalf("write design-rag/.env: %v", err)
	}
}

func TestDesignRAGCheck_NotConfigured(t *testing.T) {
	root := t.TempDir()

	result := (&DesignRAGCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

func TestDesignRAGCheck_ConfiguredComplete(t *testing.T) {
	root := t.TempDir()
	writeDesignRAGEnv(t, root, `SSO_JWT=test-token
KNOWB_URL=https://knowb.api.int.test-godaddy.com
`)

	result := (&DesignRAGCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestDesignRAGCheck_ConfiguredMissingVars(t *testing.T) {
	root := t.TempDir()
	writeDesignRAGEnv(t, root, "SSO_JWT=test-token\n")

	result := (&DesignRAGCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing vars, got %v: %s", result.Status, result.Message)
	}
}
