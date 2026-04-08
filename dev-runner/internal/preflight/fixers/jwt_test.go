package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestJWTFixer(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "app"), 0755)
	os.MkdirAll(filepath.Join(dir, "agents"), 0755)
	os.WriteFile(filepath.Join(dir, "app/.env"), []byte("NODE_ENV=development\n"), 0644)
	os.WriteFile(filepath.Join(dir, "agents/.env"), []byte("NODE_ENV=development\n"), 0644)

	fixer := &JWTFixer{}
	if err := fixer.Fix(context.Background(), dir); err != nil {
		t.Fatal(err)
	}

	appContent, _ := os.ReadFile(filepath.Join(dir, "app/.env"))
	if !strings.Contains(string(appContent), "JWT_PRIVATE_KEY=") {
		t.Error("app/.env missing JWT_PRIVATE_KEY")
	}
	if !strings.Contains(string(appContent), "JWT_PUBLIC_KEY=") {
		t.Error("app/.env missing JWT_PUBLIC_KEY")
	}

	agentsContent, _ := os.ReadFile(filepath.Join(dir, "agents/.env"))
	if !strings.Contains(string(agentsContent), "JWT_PUBLIC_KEY=") {
		t.Error("agents/.env missing JWT_PUBLIC_KEY")
	}
	if strings.Contains(string(agentsContent), "JWT_PRIVATE_KEY=") {
		t.Error("agents/.env should NOT have JWT_PRIVATE_KEY")
	}
}

func TestUpsertEnvVar(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	os.WriteFile(path, []byte("FOO=bar\nBAZ=qux\n"), 0644)

	upsertEnvVar(path, "FOO", "updated")
	content, _ := os.ReadFile(path)
	if !strings.Contains(string(content), `FOO="updated"`) {
		t.Errorf("expected FOO=updated, got: %s", content)
	}

	upsertEnvVar(path, "NEW_KEY", "value")
	content, _ = os.ReadFile(path)
	if !strings.Contains(string(content), `NEW_KEY="value"`) {
		t.Errorf("expected NEW_KEY=value, got: %s", content)
	}
}
