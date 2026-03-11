package fileops

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

func setupDirTree(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Create directory structure
	dirs := []string{
		"src",
		"src/components",
		"docs",
		".hidden",
	}
	for _, d := range dirs {
		require.NoError(t, os.MkdirAll(filepath.Join(dir, d), 0o755))
	}

	files := map[string]string{
		"README.md":                 "# readme",
		"src/index.ts":              "export {}",
		"src/app.ts":                "const app = 1",
		"src/components/Button.tsx": "<button/>",
		"docs/guide.md":             "# guide",
		".hidden/secret.txt":        "secret",
	}
	for path, content := range files {
		require.NoError(t, os.WriteFile(filepath.Join(dir, path), []byte(content), 0o644))
	}

	return dir
}

func execDirListing(ctx context.Context, t *testing.T, dl tool.Tool, input map[string]any) string {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	require.NoError(t, dl.Execute(ctx, data, &stream))
	return stream.String()
}

func TestDirectoryListingRoot(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "docs/")
	assert.Contains(t, out, "README.md")
	// Hidden dirs should not appear by default
	assert.NotContains(t, out, ".hidden")
}

func TestDirectoryListingSubdir(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"path": "src"})
	assert.Contains(t, out, "components/")
	assert.Contains(t, out, "index.ts")
	assert.Contains(t, out, "app.ts")
}

func TestDirectoryListingPattern(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"pattern": "*.md"})
	assert.Contains(t, out, "README.md")
}

func TestDirectoryListingDirectoriesOnly(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"directoriesOnly": true})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "docs/")
	assert.NotContains(t, out, "README.md")
}

func TestDirectoryListingMaxDepth(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"maxDepth": 1})
	assert.Contains(t, out, "src/")
	assert.Contains(t, out, "README.md")
	// Components dir is at depth 2, should not appear
	assert.NotContains(t, out, "components")
	assert.NotContains(t, out, "Button.tsx")
}

func TestDirectoryListingShowHidden(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"showHidden": true})
	assert.Contains(t, out, ".hidden/")
}

func TestDirectoryListingIgnoresNodeModules(t *testing.T) {
	dir := setupDirTree(t)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte("x"), 0o644,
	))

	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()
	out := execDirListing(ctx, t, dl, map[string]any{})
	assert.NotContains(t, out, "node_modules")
}

func TestDirectoryListingSearch(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	out := execDirListing(ctx, t, dl, map[string]any{"search": "button"})
	assert.Contains(t, out, "Button.tsx")
}

func TestDirectoryListingToolMetadata(t *testing.T) {
	dl := NewDirectoryListing()

	assert.Equal(t, "directoryListing", dl.Name())
	assert.NotEmpty(t, dl.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(dl.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "path")
	assert.Contains(t, props, "pattern")
	assert.Contains(t, props, "maxDepth")
}

func TestDirectoryListingPathTraversal(t *testing.T) {
	dir := setupDirTree(t)
	ctx := tool.TestContext(dir)
	dl := NewDirectoryListing()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "../../etc"})
	err := dl.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside app directory")
}

func TestDirectoryListingMissingScope(t *testing.T) {
	dl := NewDirectoryListing()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{})
	err := dl.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
