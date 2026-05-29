package checks

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func writeAiroAppBuilderOAuthAppEnv(t *testing.T, root string, content string) {
	t.Helper()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestAiroAppBuilderOAuthCheck_Configured(t *testing.T) {
	root := t.TempDir()
	writeAiroAppBuilderOAuthAppEnv(t, root, `AIRO_APP_BUILDER_CLIENT_ID=test-id
AIRO_APP_BUILDER_CLIENT_SECRET=test-secret
`)

	result := (&AiroAppBuilderOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Fatalf("expected pass, got %v: %s", result.Status, result.Message)
	}
}

func TestAiroAppBuilderOAuthCheck_MissingCredsWarnsWithFix(t *testing.T) {
	root := t.TempDir()
	writeAiroAppBuilderOAuthAppEnv(t, root, `NODE_ENV=development
`)

	result := (&AiroAppBuilderOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Fatalf("expected warn, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Fatalf("expected fix to be available")
	}
	if !strings.Contains(result.Message, "AIRO_APP_BUILDER_CLIENT_ID") || !strings.Contains(result.Message, "AIRO_APP_BUILDER_CLIENT_SECRET") {
		t.Fatalf("expected missing vars in message, got %q", result.Message)
	}
}

func TestAiroAppBuilderOAuthCheck_MissingEnvWarnsWithFix(t *testing.T) {
	root := t.TempDir()

	result := (&AiroAppBuilderOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Fatalf("expected warn, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Fatalf("expected fix to be available")
	}
}
