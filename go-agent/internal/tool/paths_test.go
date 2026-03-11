package tool

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidatePath(t *testing.T) {
	t.Parallel()
	appRoot := "/app/workspace"

	tests := []struct {
		name    string
		path    string
		wantAbs string // expected absolute path; empty means expect error
		wantErr string // substring of expected error; empty means expect success
	}{
		// --- valid paths ---
		{
			name:    "simple file",
			path:    "main.go",
			wantAbs: "/app/workspace/main.go",
		},
		{
			name:    "nested file",
			path:    "src/components/App.tsx",
			wantAbs: "/app/workspace/src/components/App.tsx",
		},
		{
			name:    "directory path",
			path:    "src/",
			wantAbs: "/app/workspace/src",
		},
		{
			name:    "dotfile",
			path:    ".gitignore",
			wantAbs: "/app/workspace/.gitignore",
		},
		{
			name:    "dot directory",
			path:    ".config/settings.json",
			wantAbs: "/app/workspace/.config/settings.json",
		},
		{
			name:    "current dir prefix normalised",
			path:    "./src/main.go",
			wantAbs: "/app/workspace/src/main.go",
		},
		{
			name:    "internal up-then-back stays inside",
			path:    "src/../lib/util.go",
			wantAbs: "/app/workspace/lib/util.go",
		},

		// --- empty / missing path ---
		{
			name:    "empty string",
			path:    "",
			wantErr: "path is required",
		},

		// --- absolute paths ---
		{
			name:    "absolute unix path",
			path:    "/etc/passwd",
			wantErr: "path must be relative",
		},
		{
			name:    "absolute path to app root itself",
			path:    "/app/workspace/main.go",
			wantErr: "path must be relative",
		},

		// --- basic traversal ---
		{
			name:    "simple dot-dot",
			path:    "../secret.txt",
			wantErr: "outside app directory",
		},
		{
			name:    "double dot-dot",
			path:    "../../etc/passwd",
			wantErr: "outside app directory",
		},
		{
			name:    "deep traversal",
			path:    "../../../../../../../etc/shadow",
			wantErr: "outside app directory",
		},
		{
			name:    "traverse then back in (still escapes)",
			path:    "../../workspace/main.go",
			wantErr: "outside app directory",
		},

		// --- traversal with subdirectory prefix ---
		{
			name:    "subdir then traverse out",
			path:    "src/../../secret.txt",
			wantErr: "outside app directory",
		},
		{
			name:    "deeply nested then traverse out",
			path:    "a/b/c/../../../../etc/passwd",
			wantErr: "outside app directory",
		},

		// --- dot-dot disguised in various ways ---
		{
			name:    "trailing slash on dot-dot",
			path:    "../",
			wantErr: "outside app directory",
		},
		{
			name:    "dot-dot with current dir prefix",
			path:    "./../secret",
			wantErr: "outside app directory",
		},
		{
			name:    "multiple current-dir segments",
			path:    "././../../etc/passwd",
			wantErr: "outside app directory",
		},
		{
			name:    "redundant slashes with traversal",
			path:    "src//../../secret",
			wantErr: "outside app directory",
		},

		// --- null bytes and special characters ---
		{
			name:    "path with spaces",
			path:    "my files/doc.txt",
			wantAbs: "/app/workspace/my files/doc.txt",
		},
		{
			name:    "path with unicode",
			path:    "données/résumé.txt",
			wantAbs: "/app/workspace/données/résumé.txt",
		},

		// --- edge cases ---
		{
			name:    "just a dot",
			path:    ".",
			wantAbs: "/app/workspace",
		},
		{
			name:    "just dot-dot",
			path:    "..",
			wantErr: "outside app directory",
		},
		{
			name:    "dot-dot-dot is a valid filename",
			path:    "...",
			wantAbs: "/app/workspace/...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := ValidatePath(appRoot, tt.path)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				assert.Empty(t, got)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.wantAbs, got)
				// Double-check: result must be inside appRoot
				rel, relErr := filepath.Rel(appRoot, got)
				require.NoError(t, relErr)
				assert.False(t, filepath.IsAbs(rel))
				assert.False(t, rel == ".." || strings.HasPrefix(rel, "../"))
			}
		})
	}
}
