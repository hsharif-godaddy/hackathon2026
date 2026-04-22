package projectenv

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveFallsBackToProjectEnvFiles(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	agentsDir := filepath.Join(root, "agents")

	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	if err := os.MkdirAll(agentsDir, 0o755); err != nil {
		t.Fatalf("mkdir agents: %v", err)
	}

	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("GODADDY_API_BASE_URL=https://api.dev-godaddy.com\n"), 0o644); err != nil {
		t.Fatalf("write app/.env: %v", err)
	}
	if err := os.WriteFile(filepath.Join(agentsDir, ".env"), []byte("GODADDY_OAUTH_CLIENT_ID=agent-client-id\n"), 0o644); err != nil {
		t.Fatalf("write agents/.env: %v", err)
	}

	t.Setenv("PROJECT_ROOT", root)
	t.Setenv("GODADDY_API_BASE_URL", "")
	t.Setenv("GODADDY_OAUTH_CLIENT_ID", "")

	if got := Resolve("GODADDY_API_BASE_URL"); got != "https://api.dev-godaddy.com" {
		t.Fatalf("Resolve(GODADDY_API_BASE_URL) = %q, want app/.env value", got)
	}

	if got := Resolve("GODADDY_OAUTH_CLIENT_ID"); got != "agent-client-id" {
		t.Fatalf("Resolve(GODADDY_OAUTH_CLIENT_ID) = %q, want agents/.env value", got)
	}
}

func TestResolvePrefersProcessEnv(t *testing.T) {
	root := t.TempDir()
	appDir := filepath.Join(root, "app")
	if err := os.MkdirAll(appDir, 0o755); err != nil {
		t.Fatalf("mkdir app: %v", err)
	}
	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("GODADDY_API_BASE_URL=https://api.dev-godaddy.com\n"), 0o644); err != nil {
		t.Fatalf("write app/.env: %v", err)
	}

	t.Setenv("PROJECT_ROOT", root)
	t.Setenv("GODADDY_API_BASE_URL", "https://override.example.com")

	if got := Resolve("GODADDY_API_BASE_URL"); got != "https://override.example.com" {
		t.Fatalf("Resolve(GODADDY_API_BASE_URL) = %q, want process env value", got)
	}
}
