package checks

import (
	"context"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestCommerceOAuthCheck_NotEnabled(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&CommerceOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip when not enabled, got %v: %s", result.Status, result.Message)
	}
}

func TestCommerceOAuthCheck_EnabledWithCreds(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, `ENABLE_COMMERCE_AGENT=true
GODADDY_OAUTH_CLIENT_ID=test-id
GODADDY_OAUTH_CLIENT_SECRET=test-secret
GODADDY_OAUTH_ENCRYPTION_KEY=test-key
`)

	result := (&CommerceOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestCommerceOAuthCheck_EnabledMissingCreds(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "ENABLE_COMMERCE_AGENT=true\n")

	result := (&CommerceOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing creds, got %v: %s", result.Status, result.Message)
	}
}

func TestCommerceOAuthCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&CommerceOAuthCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip for missing env, got %v: %s", result.Status, result.Message)
	}
}
