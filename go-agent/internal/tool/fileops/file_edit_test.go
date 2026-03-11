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

func execTextEditor(ctx context.Context, t *testing.T, te tool.Tool, input map[string]any) (string, error) {
	t.Helper()
	data, err := json.Marshal(input)
	require.NoError(t, err)
	var stream tool.BufferedStream
	execErr := te.Execute(ctx, data, &stream)
	return stream.String(), execErr
}

func TestTextEditorStrReplace(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello world\n"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "hello.txt",
		"old_str": "hello world",
		"new_str": "goodbye world",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "replaced")

	content, _ := os.ReadFile(filepath.Join(dir, "hello.txt"))
	assert.Equal(t, "goodbye world\n", string(content))
}

func TestTextEditorStrReplacePreservesPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "script.sh")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/bash\necho old\n"), 0o755))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "script.sh",
		"old_str": "echo old",
		"new_str": "echo new",
	})
	require.NoError(t, err)

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
}

func TestTextEditorStrReplaceNotFound(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "hello.txt"), []byte("hello world\n"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "hello.txt",
		"old_str": "not in file",
		"new_str": "replacement",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestTextEditorStrReplaceMultipleMatches(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "dup.txt"), []byte("foo\nbar\nfoo\n"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "dup.txt",
		"old_str": "foo",
		"new_str": "baz",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "multiple")
}

func TestTextEditorCreate(t *testing.T) {
	dir := t.TempDir()

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "sub/new.txt",
		"file_text": "new content\n",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "created")

	content, _ := os.ReadFile(filepath.Join(dir, "sub", "new.txt"))
	assert.Equal(t, "new content\n", string(content))
}

func TestTextEditorCreateOverwritesExisting(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "exists.txt"), []byte("old"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "exists.txt",
		"file_text": "new content",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "created")

	content, _ := os.ReadFile(filepath.Join(dir, "exists.txt"))
	assert.Equal(t, "new content", string(content))
}

func TestTextEditorCreateOverwritePreservesPermissions(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "script.sh")
	require.NoError(t, os.WriteFile(path, []byte("#!/bin/bash\necho old\n"), 0o755))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "script.sh",
		"file_text": "#!/bin/bash\necho new\n",
	})
	require.NoError(t, err)

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o755), info.Mode().Perm())
}

func TestTextEditorCreateImmutable(t *testing.T) {
	dir := t.TempDir()

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "locked.txt",
		"file_text": "// TREAT AS IMMUTABLE\nsome content",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")
}

func TestTextEditorView(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "view.txt"), []byte("line1\nline2\n"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "view.txt",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "line1")
	assert.Contains(t, out, "line2")
}

func TestTextEditorViewRange(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "multi.txt"),
		[]byte("line1\nline2\nline3\nline4\nline5\n"), 0o644,
	))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":    "view",
		"path":       "multi.txt",
		"view_range": []int{2, 4},
	})
	require.NoError(t, err)
	assert.NotContains(t, out, "line1")
	assert.Contains(t, out, "line2")
	assert.Contains(t, out, "line3")
	assert.Contains(t, out, "line4")
	assert.NotContains(t, out, "line5")
}

func TestTextEditorViewRangeInverted(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "multi.txt"),
		[]byte("line1\nline2\nline3\nline4\nline5\n"), 0o644,
	))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":    "view",
		"path":       "multi.txt",
		"view_range": []int{5, 2},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "must be >= start")
}

func TestTextEditorViewDirectory(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "src", "sub"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "src", "main.go"), []byte("x"), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "src",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "main.go")
	assert.Contains(t, out, "sub/")
}

func TestTextEditorInsert(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "insert.txt"),
		[]byte("line1\nline2\nline3\n"), 0o644,
	))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "insert.txt",
		"insert_line": 1,
		"insert_text": "inserted",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "inserted text")

	content, _ := os.ReadFile(filepath.Join(dir, "insert.txt"))
	assert.Equal(t, "line1\ninserted\nline2\nline3\n", string(content))
}

func TestTextEditorInsertAtBeginning(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "begin.txt"),
		[]byte("line1\nline2\n"), 0o644,
	))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "begin.txt",
		"insert_line": 0,
		"insert_text": "header",
	})
	require.NoError(t, err)

	content, _ := os.ReadFile(filepath.Join(dir, "begin.txt"))
	assert.Equal(t, "header\nline1\nline2\n", string(content))
}

func TestTextEditorPathTraversal(t *testing.T) {
	dir := t.TempDir()
	ctx := tool.TestContext(dir)
	te := NewTextEditor()

	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "../../../tmp/evil.txt",
		"file_text": "pwned",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "outside app directory")
}

func TestTextEditorToolMetadata(t *testing.T) {
	te := NewTextEditor()

	assert.Equal(t, "str_replace_based_edit_tool", te.Name())
	assert.NotEmpty(t, te.Description())

	var schema map[string]any
	require.NoError(t, json.Unmarshal(te.InputSchema(), &schema))
	props := schema["properties"].(map[string]any)
	assert.Contains(t, props, "command")
	assert.Contains(t, props, "path")
	assert.Contains(t, props, "insert_line")
	assert.Contains(t, props, "view_range")
}

func TestTextEditorInvalidCommand(t *testing.T) {
	dir := t.TempDir()
	ctx := tool.TestContext(dir)
	te := NewTextEditor()

	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "drop_tables",
		"path":    "x.txt",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown command")
}

func TestTextEditorBlockedFile(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "package-lock.json"), []byte("{}"), 0o644,
	))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "package-lock.json",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestTextEditorImmutableFile(t *testing.T) {
	dir := t.TempDir()
	content := "// TREAT AS IMMUTABLE\nconst x = 1;\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "locked.js"), []byte(content), 0o644))

	ctx := tool.TestContext(dir)
	te := NewTextEditor()

	// str_replace should fail
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "str_replace",
		"path":    "locked.js",
		"old_str": "const x = 1;",
		"new_str": "const x = 2;",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")

	// insert should fail
	_, err = execTextEditor(ctx, t, te, map[string]any{
		"command":     "insert",
		"path":        "locked.js",
		"insert_line": 1,
		"insert_text": "// injected",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "immutable")

	// view should still work
	out, err := execTextEditor(ctx, t, te, map[string]any{
		"command": "view",
		"path":    "locked.js",
	})
	require.NoError(t, err)
	assert.Contains(t, out, "TREAT AS IMMUTABLE")
}

func TestTextEditorCreateBlockedFile(t *testing.T) {
	dir := t.TempDir()
	ctx := tool.TestContext(dir)
	te := NewTextEditor()

	// create inside node_modules should be blocked
	_, err := execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "node_modules/pkg/index.js",
		"file_text": "module.exports = {}",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")

	// create with blocked extension should be blocked
	_, err = execTextEditor(ctx, t, te, map[string]any{
		"command":   "create",
		"path":      "data.sqlite",
		"file_text": "binary",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "blocked")
}

func TestTextEditorMissingScope(t *testing.T) {
	te := NewTextEditor()

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{
		"command": "view",
		"path":    "any.txt",
	})
	err := te.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
