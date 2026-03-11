package grep

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

func setupGrepDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	require.NoError(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "docs"), 0o755))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "vendor"), 0o755))

	files := map[string]string{
		"src/main.go": `package main

import "fmt"

func main() {
	fmt.Println("hello world")
}
`,
		"src/util.go": `package main

func add(a, b int) int {
	return a + b
}

func multiply(a, b int) int {
	return a * b
}
`,
		"docs/README.md": `# Project
This is a hello world project.
Use fmt.Println for output.
`,
		"vendor/lib.go": `package vendor
func Ignored() {}
`,
	}
	for path, content := range files {
		require.NoError(t, os.WriteFile(filepath.Join(dir, path), []byte(content), 0o644))
	}
	return dir
}

func execGrep(ctx context.Context, t *testing.T, g tool.Tool, input map[string]any) (string, error) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := g.Execute(ctx, data, &stream)
	return stream.String(), execErr
}

func TestGrepLiteralSearch(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "hello"})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.Contains(t, out, "hello world")
	assert.Contains(t, out, "docs/README.md")
}

func TestGrepRegexSearch(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query": "func \\w+\\(",
		"regex": true,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "func main(")
	assert.Contains(t, out, "func add(")
	assert.Contains(t, out, "func multiply(")
}

func TestGrepCaseInsensitive(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":         "HELLO",
		"caseSensitive": false,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "hello world")
}

func TestGrepCaseSensitive(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":         "HELLO",
		"caseSensitive": true,
	})
	require.NoError(t, err)
	assert.NotContains(t, out, "hello")
}

func TestGrepContextLines(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":        "fmt.Println",
		"contextLines": 1,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "fmt.Println")
	// Should have context lines around the match
	assert.Contains(t, out, "func main()")
}

func TestGrepMaxResults(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":      "func",
		"maxResults": 1,
	})
	require.NoError(t, err)
	// Should only have 1 match
	assert.Contains(t, out, "func")
}

func TestGrepIncludePatterns(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":           "hello",
		"includePatterns": []string{"*.go"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.NotContains(t, out, "README.md")
}

func TestGrepExcludePatterns(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query":           "hello",
		"excludePatterns": []string{"*.md"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.NotContains(t, out, "README.md")
}

func TestGrepPathFilter(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{
		"query": "hello",
		"paths": []string{"docs/"},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "docs/README.md")
	assert.NotContains(t, out, "src/main.go")
}

func TestGrepIgnoresVendor(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "Ignored"})
	require.NoError(t, err)
	assert.NotContains(t, out, "vendor")
}

func TestGrepNoResults(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "nonexistent_string_xyz"})
	require.NoError(t, err)
	assert.Contains(t, out, "No matches found")
}

func TestGrepToolMetadata(t *testing.T) {
	g := NewSearch()

	assert.Equal(t, "grepSearch", g.Name())
	assert.NotEmpty(t, g.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(g.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "query")
	assert.Contains(t, props, "regex")
	assert.Contains(t, props, "caseSensitive")
}

func TestGrepPathTraversal(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	_, err := execGrep(ctx, t, g, map[string]any{
		"query": "root",
		"paths": []string{"../../../etc"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside app directory")
}

func TestGrepGroupedByFile(t *testing.T) {
	dir := setupGrepDir(t)
	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "func"})
	require.NoError(t, err)
	// Output should have file headers
	assert.Contains(t, out, "src/main.go:")
	assert.Contains(t, out, "src/util.go:")
}

func TestGrepSkipsBinaryFiles(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "src"), 0o755))

	// Text file with searchable content
	require.NoError(t, os.WriteFile(filepath.Join(dir, "src", "main.go"), []byte("hello world\n"), 0o644))

	// Binary file: uses .bin2 (not .bin) to bypass the extension check and
	// exercise the null-byte sniff path instead.
	bin := make([]byte, 100)
	copy(bin, []byte("hello world"))
	bin[50] = 0 // null byte
	require.NoError(t, os.WriteFile(filepath.Join(dir, "src", "data.bin2"), bin, 0o644))

	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "hello"})
	require.NoError(t, err)
	assert.Contains(t, out, "src/main.go")
	assert.NotContains(t, out, "data.bin2", "binary file with null bytes should be skipped")
}

func TestGrepSkipsBlockedExtensions(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "logs"), 0o755))

	require.NoError(t, os.WriteFile(filepath.Join(dir, "main.go"), []byte("findme\n"), 0o644))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "logs", "app.log"), []byte("findme\n"), 0o644))

	ctx := tool.TestContext(dir)
	g := NewSearch()

	out, err := execGrep(ctx, t, g, map[string]any{"query": "findme"})
	require.NoError(t, err)
	assert.Contains(t, out, "main.go")
	assert.NotContains(t, out, "app.log", ".log files should be skipped via BlockedExtensions")
}

func TestGrepMissingScope(t *testing.T) {
	g := NewSearch()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"query": "test"})
	err := g.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
