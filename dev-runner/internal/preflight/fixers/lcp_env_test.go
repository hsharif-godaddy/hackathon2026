package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLCPEnvFixer_SyncsJWTAuthType(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "app", "AUTH_TYPE=jwt\n")
	if err := os.MkdirAll(filepath.Join(root, "local-control-plane"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := (&LCPEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "local-control-plane", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "AUTH_TYPE=jwt") {
		t.Errorf("expected AUTH_TYPE=jwt, got:\n%s", s)
	}
	if !strings.Contains(s, "SSO_HOST=sso.dev-godaddy.com") {
		t.Errorf("expected SSO_HOST=sso.dev-godaddy.com, got:\n%s", s)
	}
}

func TestLCPEnvFixer_NormalizesMockToNone(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "app", "AUTH_TYPE=mock\n")
	if err := os.MkdirAll(filepath.Join(root, "local-control-plane"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := (&LCPEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "local-control-plane", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	if !strings.Contains(string(content), "AUTH_TYPE=none") {
		t.Errorf("expected AUTH_TYPE=none for mock input, got:\n%s", string(content))
	}
}

func TestLCPEnvFixer_PreservesCustomVarsOnUpsert(t *testing.T) {
	root := t.TempDir()
	writeEnv(t, root, "app", "AUTH_TYPE=jwt\n")
	lcpDir := filepath.Join(root, "local-control-plane")
	if err := os.MkdirAll(lcpDir, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := "AUTH_TYPE=none\nSSO_HOST=sso.dev-godaddy.com\nMY_CUSTOM_VAR=keepme\n"
	if err := os.WriteFile(filepath.Join(lcpDir, ".env"), []byte(existing), 0o600); err != nil {
		t.Fatal(err)
	}

	if err := (&LCPEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(lcpDir, ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	s := string(content)
	if !strings.Contains(s, "AUTH_TYPE=jwt") {
		t.Errorf("expected AUTH_TYPE to be updated to jwt, got:\n%s", s)
	}
	if !strings.Contains(s, "MY_CUSTOM_VAR=keepme") {
		t.Errorf("expected custom var to be preserved, got:\n%s", s)
	}
}

func TestLCPEnvFixer_DefaultsToNoneWhenAppEnvMissing(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "local-control-plane"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := (&LCPEnvFixer{}).Fix(context.Background(), root); err != nil {
		t.Fatalf("Fix() failed: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(root, "local-control-plane", ".env"))
	if err != nil {
		t.Fatalf("reading .env: %v", err)
	}
	if !strings.Contains(string(content), "AUTH_TYPE=none") {
		t.Errorf("expected AUTH_TYPE=none when app/.env missing, got:\n%s", string(content))
	}
}
