package fileops

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

func setupTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Create a sample file with known content
	content := "line one\nline two\nline three\nline four\nline five\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "sample.txt"), []byte(content), 0o644))

	// Create a nested file
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "sub"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "sub", "nested.txt"), []byte("nested content\n"), 0o644))

	return dir
}

func execReadFile(ctx context.Context, t *testing.T, rf tool.Tool, input map[string]any) (string, string) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := rf.Execute(ctx, data, &stream)
	if execErr != nil {
		return "", execErr.Error()
	}
	return stream.String(), stream.ErrorString()
}

func TestReadFileFullFile(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "sample.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: sample.txt")
	assert.Contains(t, out, "Total lines: 5")
	assert.Contains(t, out, "     1|line one")
	assert.Contains(t, out, "     5|line five")
}

func TestReadFilePartialRead(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	out, errStr := execReadFile(ctx, t, rf, map[string]any{
		"path":      "sample.txt",
		"startLine": 2,
		"numLines":  2,
	})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "Lines 2-3 of 5")
	assert.Contains(t, out, "     2|line two")
	assert.Contains(t, out, "     3|line three")
	assert.NotContains(t, out, "line one")
	assert.NotContains(t, out, "line four")
}

func TestReadFileNotFound(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "nonexistent.txt"})
	err := rf.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestReadFilePathTraversal(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "../../../etc/passwd"})
	err := rf.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside app directory")
}

func TestReadFileNestedPath(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "sub/nested.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: sub/nested.txt")
	assert.Contains(t, out, "     1|nested content")
}

func TestReadFileStartLineBeyondEnd(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "sample.txt", "startLine": 100})
	err := rf.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "start line")
}

func TestReadFileToolMetadata(t *testing.T) {
	rf := NewReadFile()

	assert.Equal(t, "readFile", rf.Name())
	assert.NotEmpty(t, rf.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(rf.InputSchema(), &schema))
	props, ok := schema["properties"].(map[string]any)
	require.True(t, ok)
	assert.Contains(t, props, "path")
	assert.Contains(t, props, "startLine")
	assert.Contains(t, props, "numLines")
}

func TestReadFileBlockedFiles(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()

	// Create blocked files
	require.NoError(t, os.WriteFile(filepath.Join(dir, "package-lock.json"), []byte("{}"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "node_modules", "pkg"), 0o755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "node_modules", "pkg", "index.js"), []byte("x"), 0o644,
	))

	tests := []struct {
		path string
	}{
		{"package-lock.json"},
		{"node_modules/pkg/index.js"},
	}
	for _, tt := range tests {
		var stream tool.BufferedStream
		data, _ := json.Marshal(map[string]any{"path": tt.path})
		err := rf.Execute(ctx, data, &stream)
		require.Error(t, err, "expected blocked: %s", tt.path)
		assert.Contains(t, err.Error(), "blocked")
	}
}

func TestReadFileEmptyFile(t *testing.T) {
	dir := setupTestDir(t)
	ctx := tool.TestContext(dir)
	rf := NewReadFile()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "empty.txt"), []byte(""), 0o644))

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "empty.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: empty.txt")
	assert.Contains(t, out, "Total lines: 0")
	assert.Contains(t, strings.ToLower(out), "file size: 0 bytes")
}

func TestReadFileMissingScope(t *testing.T) {
	rf := NewReadFile()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "any.txt"})
	err := rf.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
