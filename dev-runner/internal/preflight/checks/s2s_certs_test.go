package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

// helper to write an app/.env with the given content.
func writeAppEnv(t *testing.T, projectRoot, content string) {
	t.Helper()
	dir := filepath.Join(projectRoot, "app")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir app/: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatalf("write app/.env: %v", err)
	}
}

// helper to write an agents/.env with the given content.
func writeAgentsEnv(t *testing.T, projectRoot, content string) {
	t.Helper()
	dir := filepath.Join(projectRoot, "agents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir agents/: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatalf("write agents/.env: %v", err)
	}
}

func TestS2SCertsCheck_AuthTypeNone(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "AUTH_TYPE=none\n")

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip for AUTH_TYPE=none, got %v: %s", result.Status, result.Message)
	}
}

func TestS2SCertsCheck_AuthTypeEmpty(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "AUTH_TYPE=\n")

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip for empty AUTH_TYPE, got %v: %s", result.Status, result.Message)
	}
}

func TestS2SCertsCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing .env, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable to be true")
	}
}

func TestS2SCertsCheck_JWTWithAllCerts(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, `AUTH_TYPE=jwt
GRAPHQL_CLIENT_CERT=test-cert-data
GRAPHQL_CLIENT_KEY=test-key-data
TESTPILOT_CLIENT_CERT=test-cert-data
TESTPILOT_CLIENT_KEY=test-key-data
`)

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass with all certs, got %v: %s", result.Status, result.Message)
	}
}

func TestS2SCertsCheck_JWTMissingAll(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "AUTH_TYPE=jwt\n")

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing certs, got %v: %s", result.Status, result.Message)
	}
	if result.InstallHint == "" {
		t.Error("expected InstallHint to be set")
	}
}

func TestS2SCertsCheck_JWTMissingTestPilot(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, `AUTH_TYPE=jwt
GRAPHQL_CLIENT_CERT="cert"
GRAPHQL_CLIENT_KEY="key"
`)

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn for missing TestPilot certs, got %v: %s", result.Status, result.Message)
	}
}
