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

// helper to seed a single .env.local.<envName> file with arbitrary content.
func writeLocalEnvFile(t *testing.T, projectRoot, service, envName, content string) {
	t.Helper()
	dir := filepath.Join(projectRoot, service)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s/: %v", service, err)
	}
	path := filepath.Join(dir, ".env.local."+envName)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// helper to seed the per-environment .env.local.{dev,test,prod} files under
// root/service/ with the correct per-env managed vars — the shape the
// local-env checks require to reach Pass.
func writeLocalEnvFiles(t *testing.T, projectRoot, service string) {
	t.Helper()
	type envConfig struct {
		ssoHost    string
		asmBaseURL string
	}
	configs := map[string]envConfig{
		"dev":  {"sso.dev-godaddy.com", "https://asm-dp.api.int.dev-godaddy.com"},
		"test": {"sso.test-godaddy.com", "https://asm.api.int.test-godaddy.com"},
		"prod": {"sso.godaddy.com", "https://asm.api.int.godaddy.com"},
	}
	for envName, cfg := range configs {
		content := "SSO_HOST=" + cfg.ssoHost + "\n"
		if service == "agents" {
			content += "ASM_BASE_URL=" + cfg.asmBaseURL + "\n"
		}
		writeLocalEnvFile(t, projectRoot, service, envName, content)
	}
}

func TestS2SCertsCheck_AuthTypeMock(t *testing.T) {
	root := t.TempDir()
	writeAppEnv(t, root, "AUTH_TYPE=mock\n")

	result := (&S2SCertsCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip for AUTH_TYPE=mock, got %v: %s", result.Status, result.Message)
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
