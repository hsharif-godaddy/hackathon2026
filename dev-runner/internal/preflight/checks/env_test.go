package checks

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestParseEnvFile(t *testing.T) {
	content := `# This is a comment
NODE_ENV=development
AUTH_TYPE=mock
QUOTED_DOUBLE="hello world"
QUOTED_SINGLE='single quoted'
EMPTY_DOUBLE=""
EMPTY_SINGLE=''
EMPTY_BARE=
NO_VALUE_KEY=somevalue
KEY_WITH_EQUALS=foo=bar
`
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}

	got, err := ParseEnvFile(path)
	if err != nil {
		t.Fatalf("ParseEnvFile: %v", err)
	}

	cases := []struct {
		key      string
		wantVal  string
		wantHave bool
	}{
		{"NODE_ENV", "development", true},
		{"AUTH_TYPE", "mock", true},
		{"QUOTED_DOUBLE", "hello world", true},
		{"QUOTED_SINGLE", "single quoted", true},
		{"EMPTY_DOUBLE", "", true},
		{"EMPTY_SINGLE", "", true},
		{"EMPTY_BARE", "", true},
		{"NO_VALUE_KEY", "somevalue", true},
		{"KEY_WITH_EQUALS", "foo=bar", true},
	}

	for _, tc := range cases {
		v, exists := got[tc.key]
		if exists != tc.wantHave {
			t.Errorf("key %q: exists=%v, want %v", tc.key, exists, tc.wantHave)
			continue
		}
		if v != tc.wantVal {
			t.Errorf("key %q: value=%q, want %q", tc.key, v, tc.wantVal)
		}
	}

	// Comments should not appear as keys.
	for k := range got {
		if len(k) > 0 && k[0] == '#' {
			t.Errorf("comment key leaked into map: %q", k)
		}
	}
}

func TestCheckEnvFile_Missing(t *testing.T) {
	dir := t.TempDir()
	// Use a project root where the env file definitely does not exist.
	result := checkEnvFile(dir, "app/.env", []string{"NODE_ENV"}, "Test Check", "Environment")

	if result.Status != preflight.StatusFail {
		t.Errorf("expected StatusFail for missing file, got %v", result.Status)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for missing file")
	}
}
