package fileops

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/supervisor"
	"github.com/gdcorp-partners/airo-app-builder/go-agent/internal/tool"
)

// setupReadFileServer creates a test HTTP server that mocks the supervisor /fs/read endpoint.
// files maps relative path -> file content.
func setupReadFileServer(
	t *testing.T, files map[string]string,
) (*httptest.Server, *supervisor.ClientFactory, context.Context) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/fs/read":
			var req supervisor.FSReadRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(map[string]string{"error": "bad_request", "message": err.Error()})
				return
			}
			content, ok := files[req.Path]
			if !ok {
				w.WriteHeader(http.StatusNotFound)
				json.NewEncoder(w).Encode(map[string]string{"error": "not_found", "message": "file does not exist"})
				return
			}
			json.NewEncoder(w).Encode(supervisor.FSReadResponse{
				Content:   content,
				Size:      int64(len(content)),
				TotalSize: int64(len(content)),
				Encoding:  "utf-8",
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	factory := supervisor.NewClientFactory()
	addr := "http://" + srv.Listener.Addr().String()
	ctx := tool.TestContextWithSupervisor("", addr)

	return srv, factory, ctx
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
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"sample.txt": "line one\nline two\nline three\nline four\nline five\n",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "sample.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: sample.txt")
	assert.Contains(t, out, "Total lines: 5")
	assert.Contains(t, out, "     1|line one")
	assert.Contains(t, out, "     5|line five")
}

func TestReadFilePartialRead(t *testing.T) {
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"sample.txt": "line one\nline two\nline three\nline four\nline five\n",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

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
	srv, factory, ctx := setupReadFileServer(t, map[string]string{})
	defer srv.Close()
	rf := NewReadFile(factory)

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "nonexistent.txt"})
	err := rf.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not exist")
}

func TestReadFileNestedPath(t *testing.T) {
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"sub/nested.txt": "nested content\n",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "sub/nested.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: sub/nested.txt")
	assert.Contains(t, out, "     1|nested content")
}

func TestReadFileStartLineBeyondEnd(t *testing.T) {
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"sample.txt": "line one\nline two\nline three\nline four\nline five\n",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "sample.txt", "startLine": 100})
	err := rf.Execute(ctx, data, &stream)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "start line")
}

func TestReadFileToolMetadata(t *testing.T) {
	rf := NewReadFile(supervisor.NewClientFactory())

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
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"package-lock.json":         "{}",
		"node_modules/pkg/index.js": "x",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

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
	srv, factory, ctx := setupReadFileServer(t, map[string]string{
		"empty.txt": "",
	})
	defer srv.Close()
	rf := NewReadFile(factory)

	out, errStr := execReadFile(ctx, t, rf, map[string]any{"path": "empty.txt"})
	assert.Empty(t, errStr)
	assert.Contains(t, out, "File: empty.txt")
	assert.Contains(t, out, "Total lines: 0")
	assert.Contains(t, out, "File size: 0 bytes")
}

func TestReadFileMissingScope(t *testing.T) {
	rf := NewReadFile(supervisor.NewClientFactory())

	var stream tool.BufferedStream
	data, _ := json.Marshal(map[string]any{"path": "any.txt"})
	err := rf.Execute(context.Background(), data, &stream)
	require.ErrorIs(t, err, tool.ErrNoScope)
}
