package fixers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

func TestUpsertEnvVarUnquoted(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	os.WriteFile(path, []byte("FOO=bar\n"), 0644)

	upsertEnvVarUnquoted(path, "FOO", "updated")
	content, _ := os.ReadFile(path)
	if !strings.Contains(string(content), "FOO=updated") {
		t.Errorf("expected FOO=updated, got: %s", content)
	}
	if strings.Contains(string(content), `FOO="updated"`) {
		t.Errorf("expected unquoted value, got: %s", content)
	}
}
