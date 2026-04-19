package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadDotenv(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		env         map[string]string
		want        map[string]string
		missingFile bool
	}{
		{
			name:    "simple key-value",
			content: "FOO=bar\n",
			want:    map[string]string{"FOO": "bar"},
		},
		{
			name:    "double-quoted value",
			content: `FOO="hello world"` + "\n",
			want:    map[string]string{"FOO": "hello world"},
		},
		{
			name:    "single-quoted value",
			content: "FOO='hello world'\n",
			want:    map[string]string{"FOO": "hello world"},
		},
		{
			name:    "inline comment",
			content: "FOO=bar # this is a comment\n",
			want:    map[string]string{"FOO": "bar"},
		},
		{
			name:    "hash without space is not a comment",
			content: "FOO=bar#baz\n",
			want:    map[string]string{"FOO": "bar#baz"},
		},
		{
			name:    "comment lines skipped",
			content: "# comment\nFOO=bar\n",
			want:    map[string]string{"FOO": "bar"},
		},
		{
			name:    "empty lines skipped",
			content: "\n\nFOO=bar\n\n",
			want:    map[string]string{"FOO": "bar"},
		},
		{
			name:    "env var takes precedence",
			content: "FOO=from-dotenv\n",
			env:     map[string]string{"FOO": "from-env"},
			want:    map[string]string{"FOO": "from-env"},
		},
		{
			name:    "multiple keys",
			content: "AUTH_TYPE=jwt\nSSO_HOST=sso.dev-godaddy.com\n",
			want:    map[string]string{"AUTH_TYPE": "jwt", "SSO_HOST": "sso.dev-godaddy.com"},
		},
		{
			name:    "double-quoted value with hash",
			content: `FOO="value # still value"` + "\n",
			want:    map[string]string{"FOO": "value # still value"},
		},
		{
			name:    "inline comment with extra spaces",
			content: "FOO=bar  # comment\n",
			want:    map[string]string{"FOO": "bar"},
		},
		{
			name:        "missing file is no-op",
			missingFile: true,
			want:        map[string]string{},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			envPath := filepath.Join(dir, ".env")

			if tc.missingFile {
				loadDotenv(filepath.Join(dir, "nonexistent"))
				return
			}

			os.WriteFile(envPath, []byte(tc.content), 0o600)

			for k, v := range tc.env {
				t.Setenv(k, v)
			}

			for k := range tc.want {
				if _, inEnv := tc.env[k]; !inEnv {
					t.Setenv(k, "")
					os.Unsetenv(k)
				}
			}

			loadDotenv(envPath)

			for k, expected := range tc.want {
				got := os.Getenv(k)
				if got != expected {
					t.Errorf("%s: got %q, want %q", k, got, expected)
				}
			}
		})
	}
}
